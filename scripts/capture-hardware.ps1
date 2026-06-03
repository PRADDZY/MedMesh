$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$outputDir = Join-Path $repoRoot 'artifacts\hardware'
New-Item -ItemType Directory -Force -Path $outputDir | Out-Null
$outputPath = Join-Path $outputDir 'hardware-summary.json'

$osInfo = Get-CimInstance Win32_OperatingSystem
$cpuInfo = Get-CimInstance Win32_Processor | Select-Object -First 1
$gpuInfo = Get-CimInstance Win32_VideoController | Select-Object Name, AdapterRAM

$summary = [PSCustomObject]@{
  capturedAt = (Get-Date).ToString('o')
  computerName = $env:COMPUTERNAME
  osName = $osInfo.Caption
  osVersion = $osInfo.Version
  cpuName = $cpuInfo.Name.Trim()
  cpuCores = $cpuInfo.NumberOfCores
  logicalProcessors = $cpuInfo.NumberOfLogicalProcessors
  totalMemoryGb = [Math]::Round(($osInfo.TotalVisibleMemorySize * 1KB) / 1GB, 1)
  gpus = @($gpuInfo | ForEach-Object {
    [PSCustomObject]@{
      name = $_.Name
      adapterRamGb = if ($_.AdapterRAM) { [Math]::Round($_.AdapterRAM / 1GB, 1) } else { $null }
    }
  })
  medmeshDeviceLabel = $env:MEDMESH_DEVICE_LABEL
  medmeshGpuLabel = $env:MEDMESH_GPU_LABEL
}

$summary | ConvertTo-Json -Depth 6 | Set-Content -Path $outputPath
$summary | ConvertTo-Json -Depth 6
