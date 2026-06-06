param(
  [string]$DocumentPath,
  [string]$VoiceNotePath,
  [switch]$NoSyntheticAttachments
)

$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$port = if ([string]::IsNullOrWhiteSpace($env:MEDMESH_PORT)) {
  '4768'
} else {
  $env:MEDMESH_PORT
}
$startupTimeoutSeconds = if ([string]::IsNullOrWhiteSpace($env:MEDMESH_VALIDATE_STARTUP_TIMEOUT_SEC)) {
  900
} else {
  [int]$env:MEDMESH_VALIDATE_STARTUP_TIMEOUT_SEC
}
$jobTimeoutSeconds = if ([string]::IsNullOrWhiteSpace($env:MEDMESH_VALIDATE_JOB_TIMEOUT_SEC)) {
  300
} else {
  [int]$env:MEDMESH_VALIDATE_JOB_TIMEOUT_SEC
}
$env:MEDMESH_PORT = $port
$env:MEDMESH_QVAC_MODE = 'live'
$env:MEDMESH_APP_URL = if ([string]::IsNullOrWhiteSpace($env:MEDMESH_APP_URL)) {
  "http://localhost:$port"
} else {
  $env:MEDMESH_APP_URL.TrimEnd('/')
}
$peerUrl = $env:MEDMESH_APP_URL
$validationDir = Join-Path $repoRoot 'artifacts\validation'
$healthPath = Join-Path $validationDir 'live-health.json'
$stdoutLog = Join-Path $validationDir 'live-validate-peer.out.log'
$stderrLog = Join-Path $validationDir 'live-validate-peer.err.log'
$inputDir = Join-Path $validationDir 'demo-inputs'

$proc = $null
$client = $null

function Stop-ProcessTree {
  param(
    [Parameter(Mandatory = $true)]
    [int]$ProcessId
  )

  $children = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
      $_.ParentProcessId -eq $ProcessId
    })

  foreach ($child in $children) {
    Stop-ProcessTree -ProcessId $child.ProcessId
  }

  Stop-Process -Id $ProcessId -Force -ErrorAction SilentlyContinue
}

function New-DemoDocumentImage {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Path
  )

  Add-Type -AssemblyName System.Drawing

  $bitmap = New-Object System.Drawing.Bitmap 1280, 880
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  try {
    $graphics.Clear([System.Drawing.Color]::White)
    $titleFont = New-Object System.Drawing.Font('Segoe UI', 28, [System.Drawing.FontStyle]::Bold)
    $bodyFont = New-Object System.Drawing.Font('Segoe UI', 18, [System.Drawing.FontStyle]::Regular)
    $brush = [System.Drawing.Brushes]::Black

    $lines = @(
      'EMERGENCY REFERRAL NOTE',
      'Patient alias: PT-LIVE',
      'Chief complaint: Shortness of breath and confusion',
      'SpO2: 89%    HR: 122    RR: 30',
      'Medication seen on scene: Albuterol inhaler',
      'Interventions: Oxygen started, seated upright',
      'Priority: Verify airway, SpO2 trend, medication history',
      'Behavioral note: Anxious and intermittently disoriented'
    )

    $graphics.DrawString($lines[0], $titleFont, $brush, 56, 48)
    for ($i = 1; $i -lt $lines.Count; $i++) {
      $graphics.DrawString($lines[$i], $bodyFont, $brush, 72, 110 + (($i - 1) * 84))
    }

    $graphics.DrawRectangle([System.Drawing.Pens]::Black, 40, 32, 1190, 804)
    $bitmap.Save($Path, [System.Drawing.Imaging.ImageFormat]::Png)
  }
  finally {
    $graphics.Dispose()
    $bitmap.Dispose()
  }
}

function New-DemoVoiceNote {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Path
  )

  Add-Type -AssemblyName System.Speech
  $synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
  try {
    $synth.Rate = -1
    $synth.Volume = 100
    $synth.SetOutputToWaveFile($Path)
    $synth.Speak('Patient has shortness of breath, confusion, and low oxygen saturation. Oxygen has been started. Receiving team should verify airway status, repeat pulse oximetry, and confirm inhaler history.')
  }
  finally {
    $synth.Dispose()
  }
}

function Resolve-ValidationInputs {
  param(
    [string]$RequestedDocumentPath,
    [string]$RequestedVoiceNotePath,
    [switch]$DisableSyntheticAttachments
  )

  New-Item -ItemType Directory -Force -Path $inputDir | Out-Null

  $resolvedDocumentPath = $RequestedDocumentPath
  $resolvedVoiceNotePath = $RequestedVoiceNotePath
  $attachmentMode = 'provided'

  if ($DisableSyntheticAttachments) {
    $attachmentMode = 'none'
  } elseif ([string]::IsNullOrWhiteSpace($resolvedDocumentPath) -and [string]::IsNullOrWhiteSpace($resolvedVoiceNotePath)) {
    $attachmentMode = 'synthetic'

    try {
      $resolvedDocumentPath = Join-Path $inputDir 'emergency-note.png'
      New-DemoDocumentImage -Path $resolvedDocumentPath
    } catch {
      Write-Warning "Could not generate synthetic document image: $($_.Exception.Message)"
      $resolvedDocumentPath = $null
    }

    try {
      $resolvedVoiceNotePath = Join-Path $inputDir 'voice-note.wav'
      New-DemoVoiceNote -Path $resolvedVoiceNotePath
    } catch {
      Write-Warning "Could not generate synthetic voice note: $($_.Exception.Message)"
      $resolvedVoiceNotePath = $null
    }

    if ([string]::IsNullOrWhiteSpace($resolvedDocumentPath) -and [string]::IsNullOrWhiteSpace($resolvedVoiceNotePath)) {
      $attachmentMode = 'fallback-none'
    }
  }

  if (-not [string]::IsNullOrWhiteSpace($resolvedDocumentPath) -and -not (Test-Path $resolvedDocumentPath)) {
    throw "Document path not found: $resolvedDocumentPath"
  }

  if (-not [string]::IsNullOrWhiteSpace($resolvedVoiceNotePath) -and -not (Test-Path $resolvedVoiceNotePath)) {
    throw "Voice note path not found: $resolvedVoiceNotePath"
  }

  [PSCustomObject]@{
    AttachmentMode = $attachmentMode
    DocumentPath = $resolvedDocumentPath
    VoiceNotePath = $resolvedVoiceNotePath
  }
}

function New-MultipartFileContent {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Path,
    [Parameter(Mandatory = $true)]
    [string]$ContentType
  )

  $bytes = [System.IO.File]::ReadAllBytes($Path)
  $content = [System.Net.Http.ByteArrayContent]::new($bytes)
  $content.Headers.ContentType = [System.Net.Http.Headers.MediaTypeHeaderValue]::Parse($ContentType)
  return $content
}

try {
  Add-Type -AssemblyName System.Net.Http
  New-Item -ItemType Directory -Force -Path $validationDir | Out-Null

  $validationInputs = Resolve-ValidationInputs -RequestedDocumentPath $DocumentPath -RequestedVoiceNotePath $VoiceNotePath -DisableSyntheticAttachments:$NoSyntheticAttachments
  $resolvedDocumentPath = $validationInputs.DocumentPath
  $resolvedVoiceNotePath = $validationInputs.VoiceNotePath

  $proc = Start-Process -FilePath 'pnpm.cmd' -ArgumentList '--filter','@medmesh/peer-core','exec','tsx','src/index.ts' -WorkingDirectory $repoRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput $stdoutLog -RedirectStandardError $stderrLog

  $deadline = (Get-Date).AddSeconds($startupTimeoutSeconds)
  $health = $null

  while ((Get-Date) -lt $deadline) {
    if ($proc.HasExited) {
      $stderr = if (Test-Path $stderrLog) { Get-Content $stderrLog -Raw } else { '' }
      $stdout = if (Test-Path $stdoutLog) { Get-Content $stdoutLog -Raw } else { '' }
      throw "peer-core exited before health check.`nSTDERR:`n$stderr`nSTDOUT:`n$stdout"
    }

    try {
      $health = Invoke-RestMethod -Uri "$peerUrl/health" -Method Get
      break
    } catch {
      Start-Sleep -Seconds 5
    }
  }

  if (-not $health) {
    $stderr = if (Test-Path $stderrLog) { Get-Content $stderrLog -Raw } else { '' }
    $stdout = if (Test-Path $stdoutLog) { Get-Content $stdoutLog -Raw } else { '' }
    throw "peer-core did not become ready within $startupTimeoutSeconds seconds.`nSTDERR:`n$stderr`nSTDOUT:`n$stdout"
  }

  $health | ConvertTo-Json -Depth 8 | Set-Content -Path $healthPath

  if ($health.runtime.effectiveMode -ne 'live') {
    throw "Expected effectiveMode=live but got requested=$($health.runtime.requestedMode), effective=$($health.runtime.effectiveMode), error=$($health.runtime.liveInitError)"
  }

  $attachments = @()
  if (-not [string]::IsNullOrWhiteSpace($resolvedDocumentPath)) {
    $attachments += @{
      id = 'doc-live-1'
      kind = 'document-photo'
      name = [System.IO.Path]::GetFileName($resolvedDocumentPath)
      localUri = $resolvedDocumentPath
      mimeType = 'image/png'
      size = (Get-Item $resolvedDocumentPath).Length
      createdAt = (Get-Date).ToString('o')
    }
  }
  if (-not [string]::IsNullOrWhiteSpace($resolvedVoiceNotePath)) {
    $attachments += @{
      id = 'voice-live-1'
      kind = 'voice-note'
      name = [System.IO.Path]::GetFileName($resolvedVoiceNotePath)
      localUri = $resolvedVoiceNotePath
      mimeType = 'audio/wav'
      size = (Get-Item $resolvedVoiceNotePath).Length
      createdAt = (Get-Date).ToString('o')
    }
  }

  $packet = @{
    id = 'live-case-1'
    presetId = 'emergency'
    status = 'queued'
    captureDeviceLabel = 'Android handset'
    peerBaseUrl = $peerUrl
    pairingCode = $health.pairing.code
    structuredIntake = @{
      patientAlias = 'PT-LIVE'
      ageBand = 'Adult'
      chiefComplaint = 'Shortness of breath and confusion'
      urgencyLevel = 'Immediate'
      transportMode = 'Ambulance'
      allergies = 'Unknown'
      medications = 'Inhaler noted on scene'
      interventions = 'Oxygen started, seated upright'
      mentalHealthContext = 'Anxious and intermittently disoriented'
      redFlags = 'Dropping SpO2, confusion'
      vitals = @{
        spo2 = '89%'
        heartRate = '122'
        respiratoryRate = '30'
      }
      notes = 'Receiving team should verify airway, SpO2 trend, attached referral note, and medication history.'
    }
    attachments = $attachments
    createdAt = (Get-Date).ToString('o')
    updatedAt = (Get-Date).ToString('o')
  } | ConvertTo-Json -Depth 8

  $client = [System.Net.Http.HttpClient]::new()
  $multipart = [System.Net.Http.MultipartFormDataContent]::new()
  $content = [System.Net.Http.StringContent]::new($packet, [System.Text.Encoding]::UTF8, 'application/json')
  $multipart.Add($content, 'packet')

  if (-not [string]::IsNullOrWhiteSpace($resolvedDocumentPath)) {
    $documentContent = New-MultipartFileContent -Path $resolvedDocumentPath -ContentType 'image/png'
    $multipart.Add($documentContent, 'documents', [System.IO.Path]::GetFileName($resolvedDocumentPath))
  }

  if (-not [string]::IsNullOrWhiteSpace($resolvedVoiceNotePath)) {
    $voiceContent = New-MultipartFileContent -Path $resolvedVoiceNotePath -ContentType 'audio/wav'
    $multipart.Add($voiceContent, 'voiceNote', [System.IO.Path]::GetFileName($resolvedVoiceNotePath))
  }

  $response = $client.PostAsync("$peerUrl/api/jobs", $multipart).Result
  if (-not $response.IsSuccessStatusCode) {
    throw "POST failed: $($response.StatusCode) $($response.Content.ReadAsStringAsync().Result)"
  }

  $job = $response.Content.ReadAsStringAsync().Result | ConvertFrom-Json
  $current = $job

  $jobDeadline = (Get-Date).AddSeconds($jobTimeoutSeconds)
  while ((Get-Date) -lt $jobDeadline) {
    Start-Sleep -Seconds 2
    $current = Invoke-RestMethod -Uri "$peerUrl/api/jobs/$($job.id)" -Method Get
    if ($current.status -in @('completed', 'failed')) {
      break
    }
  }

  if ($current.status -ne 'completed') {
    throw "Live validation job did not complete: $($current.status)"
  }

  $outputPath = Join-Path $validationDir 'live-validation.json'
  $report = [PSCustomObject]@{
    capturedAt = (Get-Date).ToString('o')
    requestedMode = $health.runtime.requestedMode
    effectiveMode = $health.runtime.effectiveMode
    healthPath = $healthPath
    providerTopic = $health.runtime.providerTopic
    providerPublicKey = $health.runtime.providerPublicKey
    deviceLabel = $health.runtime.hardware.deviceLabel
    cpuModel = $health.runtime.hardware.cpuModel
    totalMemoryGb = $health.runtime.hardware.totalMemoryGb
    evidenceDir = $health.artifactPaths.evidenceDir
    jobId = $current.id
    jobStatus = $current.status
    summary = $current.summary.overview
    grounded = $current.groundedAnswers[0].answer
    documentCount = $current.inputSummary.documentCount
    hasVoiceNote = $current.inputSummary.hasVoiceNote
    attachmentNames = $current.inputSummary.attachmentNames
    attachmentMode = $validationInputs.AttachmentMode
    documentPath = $resolvedDocumentPath
    voiceNotePath = $resolvedVoiceNotePath
  }

  $report | ConvertTo-Json -Depth 6 | Set-Content -Path $outputPath
  $report | ConvertTo-Json -Depth 6
}
finally {
  if ($client) {
    $client.Dispose()
  }
  if ($proc) {
    Stop-ProcessTree -ProcessId $proc.Id
  }
}
