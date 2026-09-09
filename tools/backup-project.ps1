param([string]$DestinationRoot = 'E:\phpstudy_pro\project-backups')
$ErrorActionPreference = 'Stop'
$source = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$destination = [IO.Path]::GetFullPath((Join-Path $DestinationRoot ('pboot-admin-before-seo-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))))
if ($destination.StartsWith($source + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Backup must be outside the source workspace.' }
New-Item -ItemType Directory -Path $destination | Out-Null
$project = Join-Path $destination 'project'
& robocopy $source $project /E /XJ /R:1 /W:1 /NFL /NDL /NJH /NJS /NP /XD node_modules dist backups tmp logs artifacts coverage /XF '*.log' '*.tsbuildinfo'
if ($LASTEXITCODE -ge 8) { throw "Robocopy failed: $LASTEXITCODE" }
$manifest = foreach ($file in Get-ChildItem -LiteralPath $project -File -Force -Recurse) {
  $relative = $file.FullName.Substring($project.Length + 1)
  $original = Join-Path $source $relative
  $hash = (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash
  if ($hash -ne (Get-FileHash -LiteralPath $original -Algorithm SHA256).Hash) { throw "Source changed during backup: $relative" }
  [pscustomobject]@{ Path = $relative; Bytes = $file.Length; SHA256 = $hash }
}
$manifest | Export-Csv -LiteralPath (Join-Path $destination 'manifest.csv') -NoTypeInformation -Encoding UTF8
Write-Output "BACKUP_VERIFIED=$destination"
Write-Output "FILES=$($manifest.Count)"
exit 0
