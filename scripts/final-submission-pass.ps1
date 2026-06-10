$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$submissionDir = Join-Path $repoRoot 'submission'
$assetDir = Join-Path $submissionDir 'final-assets'
$screenshotDir = Join-Path $assetDir 'screenshots'
$copyPath = Join-Path $submissionDir 'SUBMISSION_COPY.md'
$qualificationPath = Join-Path $assetDir 'live-host-qualification.json'
$validationPath = Join-Path $assetDir 'live-validation.json'
$doctorPath = Join-Path $assetDir 'live-doctor.json'
$healthPath = Join-Path $assetDir 'live-health.json'
$reportPath = Join-Path $repoRoot 'artifacts\validation\final-submission-pass.json'

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

function Get-GitValue {
  param(
    [Parameter(Mandatory = $true)]
    [string[]]$Args
  )

  $output = & git -C $repoRoot @Args 2>$null
  if ($LASTEXITCODE -ne 0) {
    return $null
  }

  ($output | Out-String).Trim()
}

$expectedScreenshots = @(
  'mobile-intake.png',
  'peer-console-runtime.png',
  'peer-console-pairing.png',
  'peer-console-summary.png',
  'peer-console-grounded-answer.png',
  'completed-export.png',
  'hardware-model-status.png'
)

$qualification = Read-JsonFile -Path $qualificationPath
$validation = Read-JsonFile -Path $validationPath
$doctor = Read-JsonFile -Path $doctorPath
$health = Read-JsonFile -Path $healthPath
$submissionCopy = Get-Content $copyPath -Raw

$validatedDocumentCount = 0
if ($null -ne $validation.documentCount) {
  $validatedDocumentCount = [int]$validation.documentCount
}

$missingScreenshots = @($expectedScreenshots | Where-Object {
    -not (Test-Path (Join-Path $screenshotDir $_))
  })

$videoReady = -not ($submissionCopy -match 'Add the final video URL after recording\.')
$repoStatus = @(git -C $repoRoot status --short)
$repoClean = $repoStatus.Count -eq 0
$currentBranch = Get-GitValue -Args @('branch', '--show-current')
$head = Get-GitValue -Args @('rev-parse', 'HEAD')
$originMain = Get-GitValue -Args @('rev-parse', 'origin/main')
$headOnOriginMain = $false
if ($head -and $originMain) {
  & git -C $repoRoot merge-base --is-ancestor $head origin/main | Out-Null
  $headOnOriginMain = $LASTEXITCODE -eq 0
}

$blockers = New-Object System.Collections.Generic.List[string]
$notes = New-Object System.Collections.Generic.List[string]

if ($qualification.qualificationStatus -ne 'approved') {
  $blockers.Add('Live qualification is not approved.')
}

if ($validation.effectiveMode -ne 'live') {
  $blockers.Add('Live validation is not reporting effectiveMode=live.')
}

if ($validation.jobStatus -ne 'completed') {
  $blockers.Add('Live validation job is not completed.')
}

if ($validatedDocumentCount -lt 1) {
  $blockers.Add('Final proof bundle is missing a document photo.')
}

if (-not $validation.hasVoiceNote) {
  $blockers.Add('Final proof bundle is missing a voice note.')
}

if ($missingScreenshots.Count -gt 0) {
  $blockers.Add("Missing screenshots: $($missingScreenshots -join ', ')")
}

if (-not $videoReady) {
  $blockers.Add('Demo video URL is still a placeholder in submission/SUBMISSION_COPY.md.')
}

if (-not $repoClean) {
  $notes.Add('Working tree is not clean. Commit or remove local changes before pressing submit.')
}

if ($currentBranch -ne 'main') {
  $notes.Add("Current branch is '$currentBranch'. Submit from 'main'.")
}

if (-not $headOnOriginMain) {
  $notes.Add('Current HEAD is not confirmed on origin/main yet.')
}

$result = [ordered]@{
  checkedAt = (Get-Date).ToString('o')
  readyForSubmit = $blockers.Count -eq 0
  blockers = @($blockers)
  notes = @($notes)
  runtime = [ordered]@{
    requestedMode = $doctor.requestedMode
    effectiveMode = $validation.effectiveMode
    liveProfile = $health.runtime.liveProfile
    qualificationStatus = $qualification.qualificationStatus
    providerStarted = $qualification.runtime.providerStarted
  }
  proof = [ordered]@{
    documentCount = $validatedDocumentCount
    hasVoiceNote = [bool]$validation.hasVoiceNote
    attachmentMode = $validation.attachmentMode
    approvedJobId = $qualification.validation.jobId
  }
  repo = [ordered]@{
    branch = $currentBranch
    head = $head
    originMain = $originMain
    headOnOriginMain = $headOnOriginMain
    clean = $repoClean
  }
  manualAssets = [ordered]@{
    missingScreenshots = $missingScreenshots
    videoLinkPresent = $videoReady
  }
  nextActions = @(
    'Capture the seven required screenshots into submission/final-assets/screenshots.',
    'Record and upload the final demo video using submission/DEMO_SCRIPT.md.',
    'Replace the placeholder demo link in submission/SUBMISSION_COPY.md.',
    'Run pnpm.cmd submission:check for the final green gate.'
  )
}

$resultJson = $result | ConvertTo-Json -Depth 6
$reportDir = Split-Path -Parent $reportPath
if (-not (Test-Path $reportDir)) {
  New-Item -ItemType Directory -Path $reportDir | Out-Null
}
$resultJson | Set-Content -Path $reportPath
$resultJson
