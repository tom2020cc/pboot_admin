# Launch a process in a hidden window (no visible terminal), detached, with output logged to files.
# Usage:
#   powershell -NoProfile -ExecutionPolicy Bypass -File tools\start-hidden.ps1 -Exe <exe> -CmdArgs "<args>" -Dir <workdir> -Log <logbase>
# Examples:
#   node service:   -Exe "node" -CmdArgs "launch.js" -Dir "...\seo_publish_tool" -Log "...\logs\seo"
#   pnpm service:   -Exe "cmd"  -CmdArgs "/c pnpm run start:dev" -Dir "...\backend" -Log "...\logs\backend"
param(
  [Parameter(Mandatory = $true)][string]$Exe,
  [string]$CmdArgs = "",
  [Parameter(Mandatory = $true)][string]$Dir,
  [Parameter(Mandatory = $true)][string]$Log
)

$out = "$Log.out.log"
$err = "$Log.err.log"
$logDir = Split-Path -Parent $out
if ($logDir -and !(Test-Path $logDir)) {
  New-Item -ItemType Directory -Path $logDir -Force | Out-Null
}

if ($CmdArgs) {
  Start-Process -FilePath $Exe -ArgumentList $CmdArgs -WorkingDirectory $Dir -WindowStyle Hidden -RedirectStandardOutput $out -RedirectStandardError $err
} else {
  Start-Process -FilePath $Exe -WorkingDirectory $Dir -WindowStyle Hidden -RedirectStandardOutput $out -RedirectStandardError $err
}
