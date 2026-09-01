param(
  [Parameter(Mandatory = $true)][int]$Port,
  [Parameter(Mandatory = $true)][string]$Root,
  [ValidateSet("Status", "Stop")][string]$Mode = "Status"
)

$projectRoot = [IO.Path]::GetFullPath($Root).TrimEnd("\")
$connections = @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
if (!$connections.Count) {
  exit 0
}

$marker = "pboot-admin-20260729"
$identityMatches = $false
foreach ($hostName in @("localhost", "127.0.0.1")) {
  try {
    $response = Invoke-WebRequest -UseBasicParsing -Uri "http://${hostName}:$Port/project-identity" -TimeoutSec 2
    if ([string]$response.Content -like "*$marker*") {
      $identityMatches = $true
      break
    }
  } catch {
    # A non-HTTP listener can still be identified by its command line below.
  }
}

$owned = @()
foreach ($processId in ($connections | Select-Object -ExpandProperty OwningProcess -Unique)) {
  $process = Get-CimInstance Win32_Process -Filter "ProcessId = $processId" -ErrorAction SilentlyContinue
  $commandLine = [string]$process.CommandLine
  if ($commandLine.IndexOf($projectRoot, [StringComparison]::OrdinalIgnoreCase) -ge 0) {
    $owned += $processId
  }
}
if ($identityMatches -and !$owned.Count) {
  $owned = @($connections | Select-Object -ExpandProperty OwningProcess -Unique)
}

if ($Mode -eq "Stop") {
  foreach ($processId in $owned) {
    Stop-Process -Id $processId -Force -ErrorAction SilentlyContinue
    Write-Output "Stopped project PID $processId on port $Port"
  }
  if (!$owned.Count) {
    Write-Output "Skipped port $Port because it belongs to another project"
  }
  exit 0
}

if ($owned.Count) {
  exit 10
}
exit 20
