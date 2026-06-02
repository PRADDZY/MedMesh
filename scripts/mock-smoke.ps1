$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$peerUrl = 'http://localhost:4747'
$proc = $null
$client = $null

try {
  Add-Type -AssemblyName System.Net.Http
  $proc = Start-Process -FilePath 'pnpm.cmd' -ArgumentList '--filter','@medmesh/peer-core','exec','tsx','src/index.ts' -WorkingDirectory $repoRoot -WindowStyle Hidden -PassThru
  Start-Sleep -Seconds 6

  $health = Invoke-RestMethod -Uri "$peerUrl/health" -Method Get

  $packet = @{
    id = 'demo-case-1'
    presetId = 'emergency'
    status = 'queued'
    captureDeviceLabel = 'Android handset'
    peerBaseUrl = $peerUrl
    pairingCode = 'DEMO42'
    structuredIntake = @{
      patientAlias = 'PT-ALPHA'
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

  for ($i = 0; $i -lt 12; $i++) {
    Start-Sleep -Seconds 1
    $current = Invoke-RestMethod -Uri "$peerUrl/api/jobs/$($job.id)" -Method Get
    if ($current.status -in @('completed', 'failed')) {
      break
    }
  }

  [PSCustomObject]@{
    healthMode = $health.runtime.mode
    pairingCode = $health.pairing.code
    jobId = $current.id
    jobStatus = $current.status
    summary = $current.summary.overview
    grounded = $current.groundedAnswers[0].answer
  } | ConvertTo-Json -Depth 6
}
finally {
  if ($client) {
    $client.Dispose()
  }
  if ($proc -and -not $proc.HasExited) {
    Stop-Process -Id $proc.Id -Force
  }
}
