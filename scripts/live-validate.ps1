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
$env:MEDMESH_PORT = $port
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

try {
  Add-Type -AssemblyName System.Net.Http
  New-Item -ItemType Directory -Force -Path $validationDir | Out-Null
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
      notes = 'Receiving team should verify airway and med history.'
    }
    attachments = @()
    createdAt = (Get-Date).ToString('o')
    updatedAt = (Get-Date).ToString('o')
  } | ConvertTo-Json -Depth 8

  $client = [System.Net.Http.HttpClient]::new()
  $multipart = [System.Net.Http.MultipartFormDataContent]::new()
  $content = [System.Net.Http.StringContent]::new($packet, [System.Text.Encoding]::UTF8, 'application/json')
  $multipart.Add($content, 'packet')

  $response = $client.PostAsync("$peerUrl/api/jobs", $multipart).Result
  if (-not $response.IsSuccessStatusCode) {
    throw "POST failed: $($response.StatusCode) $($response.Content.ReadAsStringAsync().Result)"
  }

  $job = $response.Content.ReadAsStringAsync().Result | ConvertFrom-Json
  $current = $job

  for ($i = 0; $i -lt 20; $i++) {
    Start-Sleep -Seconds 1
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
