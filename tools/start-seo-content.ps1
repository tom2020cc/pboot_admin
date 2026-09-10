param([switch]$CheckOnly)
$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$entry = Join-Path $root 'tools\seo-content-worker\index.cjs'
$node = (Get-Command node -ErrorAction Stop).Source
if (!(Test-Path -LiteralPath (Join-Path $root 'backend\dist\common\ai-json.js'))) {
    throw 'Build the backend first: cd backend; pnpm run build'
}
& $node $entry --check
if ($LASTEXITCODE -ne 0) {
    throw 'Worker check failed. Check backend/.env and restart the updated backend API.'
}
if ($CheckOnly) { exit 0 }
$running = @(Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object {
    $_.CommandLine -and $_.CommandLine.Contains($entry) -and $_.CommandLine -notmatch '--check'
})
if ($running.Count) {
    Write-Output 'SEO content worker already running. No duplicate process started.'
    exit 0
}
& (Join-Path $PSScriptRoot 'start-hidden.ps1') -Exe $node -CmdArgs ('"' + $entry + '"') -Dir $root -Log (Join-Path $root 'logs\seo-content-worker')
Write-Output 'SEO content worker started in the background. Website and global switches were not changed.'
