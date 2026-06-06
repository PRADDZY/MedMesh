$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$submissionDir = Join-Path $repoRoot 'submission'
$assetDir = Join-Path $submissionDir 'final-assets'
$screenshotDir = Join-Path $assetDir 'screenshots'
$copyPath = Join-Path $submissionDir 'SUBMISSION_COPY.md'
$manifestPath = Join-Path $assetDir 'freeze-manifest.json'
$qualificationPath = Join-Path $assetDir 'live-host-qualification.json'
$validationPath = Join-Path $assetDir 'live-validation.json'
$eventsPath = Join-Path $assetDir 'events.jsonl'

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

$issues = New-Object System.Collections.Generic.List[string]
$warnings = New-Object System.Collections.Generic.List[string]

$manifest = Read-JsonFile -Path $manifestPath
$qualification = Read-JsonFile -Path $qualificationPath
$validation = Read-JsonFile -Path $validationPath
$submissionCopy = Get-Content $copyPath -Raw

if ($qualification.qualificationStatus -ne 'approved') {
  $issues.Add('Live host qualification is not approved.')
}

if ($validation.effectiveMode -ne 'live') {
  $issues.Add('Final live validation does not report effectiveMode=live.')
}

if ($validation.jobStatus -ne 'completed') {
  $issues.Add('Final live validation job is not completed.')
}

$validatedDocumentCount = if ($null -ne $validation.documentCount) {
  [int]$validation.documentCount
} else {
  0
}

if ($validatedDocumentCount -lt 1) {
  $issues.Add('Final live validation does not include a document photo.')
}

if (-not $validation.hasVoiceNote) {
  $issues.Add('Final live validation does not include a voice note.')
}

if (-not (Test-Path $eventsPath)) {
  $issues.Add('Frozen events.jsonl is missing.')
} else {
  $events = @(Get-Content $eventsPath | Where-Object { -not [string]::IsNullOrWhiteSpace($_) } | ForEach-Object { $_ | ConvertFrom-Json })
  $jobIds = @($events | ForEach-Object { $_.jobId } | Where-Object { $_ } | Sort-Object -Unique)
  if ($jobIds.Count -ne 1 -or $jobIds[0] -ne $qualification.validation.jobId) {
    $issues.Add('Frozen events.jsonl is not curated to a single approved live job.')
  }
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

$missingScreenshots = @($expectedScreenshots | Where-Object {
    -not (Test-Path (Join-Path $screenshotDir $_))
  })
if ($missingScreenshots.Count -gt 0) {
  $issues.Add("Missing screenshots: $($missingScreenshots -join ', ')")
}

if ($submissionCopy -match 'Add the final video URL after recording\.') {
  $issues.Add('Demo video URL is still a placeholder.')
}

if ($submissionCopy -match 'tree/feat-medmesh-v1') {
  $issues.Add('Submission copy still points judges to the feature branch URL.')
}

try {
  $originMain = (git -C $repoRoot rev-parse origin/main).Trim()
  $head = (git -C $repoRoot rev-parse HEAD).Trim()
  git -C $repoRoot merge-base --is-ancestor $head origin/main | Out-Null
  if ($LASTEXITCODE -ne 0) {
    $warnings.Add('Current HEAD is not yet contained in origin/main.')
  }
} catch {
  $warnings.Add("Could not verify whether origin/main contains the current work: $($_.Exception.Message)")
}

$result = [ordered]@{
  checkedAt = (Get-Date).ToString('o')
  status = if ($issues.Count -eq 0) { 'ready' } else { 'blocked' }
  approvedQualification = $qualification.qualificationStatus
  validatedEffectiveMode = $validation.effectiveMode
  validatedJobStatus = $validation.jobStatus
  validatedDocumentCount = $validatedDocumentCount
  validatedHasVoiceNote = $validation.hasVoiceNote
  expectedScreenshots = $expectedScreenshots
  missingScreenshots = $missingScreenshots
  issues = @($issues)
  warnings = @($warnings)
}

$result | ConvertTo-Json -Depth 6

if ($issues.Count -gt 0) {
  throw "Submission check blocked."
}
