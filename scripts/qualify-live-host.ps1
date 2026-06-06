param(
  [switch]$DryRun
)

$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$validationDir = Join-Path $repoRoot 'artifacts\validation'
$hardwareDir = Join-Path $repoRoot 'artifacts\hardware'
$qualificationMode = if ($DryRun) { 'dry' } else { 'live' }
$enforceGate = -not $DryRun

$hardwarePath = Join-Path $hardwareDir 'hardware-summary.json'
$doctorPath = Join-Path $validationDir 'live-doctor.json'
$prewarmPath = Join-Path $validationDir 'live-prewarm.json'
$healthPath = Join-Path $validationDir 'live-health.json'
$liveValidationPath = Join-Path $validationDir 'live-validation.json'
$qualificationPath = Join-Path $validationDir 'live-host-qualification.json'
$stdoutLog = Join-Path $validationDir 'live-validate-peer.out.log'
$stderrLog = Join-Path $validationDir 'live-validate-peer.err.log'

function Read-JsonFile {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Path
  )

  if (-not (Test-Path $Path)) {
    return $null
  }

  return (Get-Content $Path -Raw | ConvertFrom-Json)
}

function Invoke-PnpmScript {
  param(
    [Parameter(Mandatory = $true)]
    [string]$ScriptName
  )

  & pnpm.cmd $ScriptName
  if ($LASTEXITCODE -ne 0) {
    throw "pnpm $ScriptName exited with code $LASTEXITCODE"
  }
}

function Remove-StaleArtifact {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Path
  )

  if (-not (Test-Path $Path)) {
    return
  }

  for ($attempt = 1; $attempt -le 5; $attempt++) {
    try {
      if (Test-Path $Path) {
        Remove-Item -LiteralPath $Path -Force
      }
      return
    } catch {
      if ($attempt -eq 5) {
        throw
      }
      Start-Sleep -Seconds 2
    }
  }
}

New-Item -ItemType Directory -Force -Path $validationDir | Out-Null
New-Item -ItemType Directory -Force -Path $hardwareDir | Out-Null

@(
  $prewarmPath,
  $doctorPath,
  $healthPath,
  $liveValidationPath,
  $qualificationPath,
  $stdoutLog,
  $stderrLog
) | ForEach-Object { Remove-StaleArtifact -Path $_ }

$liveValidationSucceeded = $false
$validationExitCode = $null
$failureReason = $null
$prewarmWarning = $null

try {
  & powershell -ExecutionPolicy Bypass -File (Join-Path $repoRoot 'scripts\capture-hardware.ps1') | Out-Null
  Invoke-PnpmScript -ScriptName 'doctor:live'

  if ($DryRun) {
    Invoke-PnpmScript -ScriptName 'prepare:live:dry'
  } else {
    $env:MEDMESH_QVAC_MODE = 'live'
    try {
      Invoke-PnpmScript -ScriptName 'prepare:live'
    } catch {
      $prewarmWarning = $_.Exception.Message
    }
    & powershell -ExecutionPolicy Bypass -File (Join-Path $repoRoot 'scripts\live-validate.ps1')
    $validationExitCode = $LASTEXITCODE
    if ($validationExitCode -eq 0) {
      $liveValidationSucceeded = $true
    } else {
      $failureReason = "validate:live exited with code $validationExitCode"
    }
  }
} catch {
  $failureReason = $_.Exception.Message
}

$hardware = Read-JsonFile -Path $hardwarePath
$prewarm = Read-JsonFile -Path $prewarmPath
$doctor = Read-JsonFile -Path $doctorPath
$health = Read-JsonFile -Path $healthPath
$liveValidation = Read-JsonFile -Path $liveValidationPath

$gate = [ordered]@{
  preflightOk = if ($prewarm -and $prewarm.preflight) { [bool]$prewarm.preflight.ok } else { $null }
  requestedModeLive = if ($health) { $health.runtime.requestedMode -eq 'live' } else { $null }
  effectiveModeLive = if ($health) { $health.runtime.effectiveMode -eq 'live' } else { $null }
  validationJobCompleted = if ($liveValidation) { $liveValidation.jobStatus -eq 'completed' } else { $null }
}

$qualificationStatus = if ($DryRun) {
  if ($gate.preflightOk) { 'candidate' } else { 'blocked' }
} else {
  if ($gate.preflightOk -and $gate.requestedModeLive -and $gate.effectiveModeLive -and $gate.validationJobCompleted) {
    'approved'
  } else {
    'blocked'
  }
}

if (-not $failureReason) {
  if (-not $gate.preflightOk) {
    if ($prewarm -and $prewarm.preflight -and $prewarm.preflight.error) {
      $failureReason = $prewarm.preflight.error
    } elseif ($health -and $health.runtime.liveInitError) {
      $failureReason = $health.runtime.liveInitError
    }
  } elseif (-not $DryRun -and -not $gate.effectiveModeLive) {
    $failureReason = if ($health) {
      "Host stayed degraded: $($health.runtime.liveInitError)"
    } else {
      'Live validation did not produce a health snapshot.'
    }
  } elseif (-not $DryRun -and -not $gate.validationJobCompleted) {
    $failureReason = if ($liveValidation) {
      "Validation job ended with status $($liveValidation.jobStatus)"
    } else {
      'Live validation report was not written.'
    }
  }
}

if (-not $failureReason -and $doctor -and $doctor.probes -and $doctor.probes.fullWorker -and -not $doctor.probes.fullWorker.booted -and $doctor.liveProfile -eq 'full') {
  $failureReason = if ($doctor.probes.fullWorker.error) {
    $doctor.probes.fullWorker.error
  } elseif ($doctor.probes.fullWorker.stderr) {
    $doctor.probes.fullWorker.stderr
  } else {
    'Full worker probe did not boot successfully.'
  }
}

$modelSources = if ($health) {
  @($health.runtime.models | ForEach-Object {
    [ordered]@{
      name = $_.name
      modelType = $_.modelType
      source = $_.source
      status = $_.status
      error = $_.error
    }
  })
} elseif ($prewarm) {
  @($prewarm.selectedModels | ForEach-Object {
    [ordered]@{
      name = $_.label
      modelType = $_.key
      source = $_.source
      status = $_.status
      error = $null
    }
  })
} else {
  @()
}
$modelSources = [object[]]$modelSources
if ($null -eq $modelSources) {
  $modelSources = @()
}

if ($prewarm -and $prewarm.preflight -and $prewarm.preflight.error -and $qualificationStatus -eq 'blocked') {
  $failureReason = $prewarm.preflight.error
}

$summary = [ordered]@{
  capturedAt = (Get-Date).ToString('o')
  qualificationMode = $qualificationMode
  qualificationStatus = $qualificationStatus
  accepted = $qualificationStatus -eq 'approved'
  recommendedRole = switch ($qualificationStatus) {
    'approved' { 'approved-live-demo-host' }
    'candidate' { 'candidate-live-host' }
    default { 'dev-or-controller-only' }
  }
  gate = $gate
  host = [ordered]@{
    computerName = $hardware.computerName
    osName = $hardware.osName
    osVersion = $hardware.osVersion
    cpuName = $hardware.cpuName
    totalMemoryGb = $hardware.totalMemoryGb
    gpus = $hardware.gpus
  }
  runtime = if ($health) {
    [ordered]@{
      requestedMode = $health.runtime.requestedMode
      effectiveMode = $health.runtime.effectiveMode
      health = $health.runtime.health
      liveInitError = $health.runtime.liveInitError
      providerStarted = $health.runtime.providerStarted
      providerTopic = $health.runtime.providerTopic
    }
  } else {
    $null
  }
  validation = if ($liveValidation) {
    [ordered]@{
      succeeded = $liveValidationSucceeded
      requestedMode = $liveValidation.requestedMode
      effectiveMode = $liveValidation.effectiveMode
      jobId = $liveValidation.jobId
      jobStatus = $liveValidation.jobStatus
      summary = $liveValidation.summary
      documentCount = $liveValidation.documentCount
      hasVoiceNote = $liveValidation.hasVoiceNote
      attachmentMode = $liveValidation.attachmentMode
    }
  } else {
    [ordered]@{
      succeeded = $liveValidationSucceeded
      requestedMode = $null
      effectiveMode = $null
      jobId = $null
      jobStatus = $null
      summary = $null
      documentCount = $null
      hasVoiceNote = $null
      attachmentMode = $null
    }
  }
  prewarmWarning = $prewarmWarning
  modelSources = $modelSources
  artifacts = [ordered]@{
    hardwareSummary = $hardwarePath
    liveDoctor = if (Test-Path $doctorPath) { $doctorPath } else { $null }
    livePrewarm = $prewarmPath
    liveHealth = if (Test-Path $healthPath) { $healthPath } else { $null }
    liveValidation = if (Test-Path $liveValidationPath) { $liveValidationPath } else { $null }
    peerStdoutLog = if (Test-Path $stdoutLog) { $stdoutLog } else { $null }
    peerStderrLog = if (Test-Path $stderrLog) { $stderrLog } else { $null }
  }
  screenshotChecklist = @(
    'peer-console-pairing.png',
    'peer-console-runtime.png',
    'peer-console-summary.png',
    'peer-console-grounded-answer.png',
    'mobile-intake.png',
    'completed-export.png',
    'hardware-model-status.png'
  )
  failureReason = $failureReason
}

$summary | ConvertTo-Json -Depth 8 | Set-Content -Path $qualificationPath
$summary | ConvertTo-Json -Depth 8

if ($enforceGate -and $qualificationStatus -ne 'approved') {
  throw "Live host qualification blocked. See $qualificationPath"
}
