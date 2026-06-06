param(
  [string]$JobId
)

$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$validationDir = Join-Path $repoRoot 'artifacts\validation'
$hardwareDir = Join-Path $repoRoot 'artifacts\hardware'
$evidenceDir = Join-Path $repoRoot 'artifacts\evidence'
$assetDir = Join-Path $repoRoot 'submission\final-assets'
$screenshotDir = Join-Path $assetDir 'screenshots'

function Read-JsonFile {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Path
  )

  if (-not (Test-Path $Path)) {
    throw "Required file not found: $Path"
  }

  Get-Content $Path -Raw | ConvertFrom-Json
}

function Copy-Artifact {
  param(
    [Parameter(Mandatory = $true)]
    [string]$SourcePath,
    [Parameter(Mandatory = $true)]
    [string]$DestinationPath
  )

  if (-not (Test-Path $SourcePath)) {
    throw "Required artifact not found: $SourcePath"
  }

  Copy-Item -LiteralPath $SourcePath -Destination $DestinationPath -Force
}

$qualificationPath = Join-Path $validationDir 'live-host-qualification.json'
$doctorPath = Join-Path $validationDir 'live-doctor.json'
$healthPath = Join-Path $validationDir 'live-health.json'
$liveValidationPath = Join-Path $validationDir 'live-validation.json'
$hardwarePath = Join-Path $hardwareDir 'hardware-summary.json'
$eventsPath = Join-Path $evidenceDir 'events.jsonl'

$qualification = Read-JsonFile -Path $qualificationPath
$doctor = Read-JsonFile -Path $doctorPath
$health = Read-JsonFile -Path $healthPath
$liveValidation = Read-JsonFile -Path $liveValidationPath
$hardware = Read-JsonFile -Path $hardwarePath

$selectedJobId = if (-not [string]::IsNullOrWhiteSpace($JobId)) {
  $JobId
} elseif ($qualification.validation.jobId) {
  [string]$qualification.validation.jobId
} elseif ($liveValidation.jobId) {
  [string]$liveValidation.jobId
} else {
  throw 'Could not determine job id for the approved markdown export.'
}

$exportPath = Join-Path $evidenceDir "$selectedJobId.md"
$selectedEventLines = @()
if (Test-Path $eventsPath) {
  $selectedEventLines = Get-Content $eventsPath | Where-Object {
    if ([string]::IsNullOrWhiteSpace($_)) {
      return $false
    }

    try {
      $event = $_ | ConvertFrom-Json
      return $event.jobId -eq $selectedJobId
    } catch {
      return $false
    }
  }
}

if ($selectedEventLines.Count -eq 0) {
  throw "No evidence events found for approved job id $selectedJobId"
}

New-Item -ItemType Directory -Force -Path $assetDir | Out-Null
New-Item -ItemType Directory -Force -Path $screenshotDir | Out-Null

$copiedFiles = @(
  @{ Source = $doctorPath; Destination = Join-Path $assetDir 'live-doctor.json' },
  @{ Source = $qualificationPath; Destination = Join-Path $assetDir 'live-host-qualification.json' },
  @{ Source = $healthPath; Destination = Join-Path $assetDir 'live-health.json' },
  @{ Source = $liveValidationPath; Destination = Join-Path $assetDir 'live-validation.json' },
  @{ Source = $hardwarePath; Destination = Join-Path $assetDir 'hardware-summary.json' },
  @{ Source = $exportPath; Destination = Join-Path $assetDir 'approved-export.md' }
)

foreach ($entry in $copiedFiles) {
  Copy-Artifact -SourcePath $entry.Source -DestinationPath $entry.Destination
}

$filteredEventsDestination = Join-Path $assetDir 'events.jsonl'
$selectedEventLines | Set-Content -Path $filteredEventsDestination

$screenshotChecklist = @(
  'mobile-intake.png',
  'peer-console-runtime.png',
  'peer-console-pairing.png',
  'peer-console-summary.png',
  'peer-console-grounded-answer.png',
  'completed-export.png',
  'hardware-model-status.png'
)

$checklistPath = Join-Path $assetDir 'SCREENSHOT_CHECKLIST.txt'
@(
  'Capture and save these files into submission/final-assets/screenshots:',
  ''
) + ($screenshotChecklist | ForEach-Object { "- $_" }) | Set-Content -Path $checklistPath

@(
  '# Screenshot Placeholders',
  '',
  'Save the final submission screenshots in this folder using these filenames:',
  ''
) + ($screenshotChecklist | ForEach-Object { "- $_" }) | Set-Content -Path (Join-Path $screenshotDir 'README.md')

$copiedFileNames = @($copiedFiles | ForEach-Object { Split-Path $_.Destination -Leaf }) + 'events.jsonl'

$manifest = [ordered]@{
  capturedAt = (Get-Date).ToString('o')
  qualificationStatus = $qualification.qualificationStatus
  recommendedRole = $qualification.recommendedRole
  jobId = $selectedJobId
  runtime = [ordered]@{
    requestedMode = $health.runtime.requestedMode
    effectiveMode = $health.runtime.effectiveMode
    liveProfile = $health.runtime.liveProfile
    providerStarted = $health.runtime.providerStarted
  }
  host = [ordered]@{
    computerName = $hardware.computerName
    osName = $hardware.osName
    cpuName = $hardware.cpuName
    totalMemoryGb = $hardware.totalMemoryGb
  }
  validation = [ordered]@{
    documentCount = $liveValidation.documentCount
    hasVoiceNote = $liveValidation.hasVoiceNote
    attachmentNames = $liveValidation.attachmentNames
    attachmentMode = $liveValidation.attachmentMode
  }
  copiedFiles = $copiedFileNames
  filteredEvidenceEvents = $selectedEventLines.Count
  screenshotChecklist = $screenshotChecklist
  pendingManualAssets = @(
    'screenshots in submission/final-assets/screenshots',
    'demo video link in submission/SUBMISSION_COPY.md'
  )
}

$manifest | ConvertTo-Json -Depth 6 | Set-Content -Path (Join-Path $assetDir 'freeze-manifest.json')
$manifest | ConvertTo-Json -Depth 6
