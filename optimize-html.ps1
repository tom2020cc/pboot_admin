$targetDir = "E:\phpstudy_pro\WWW\shanbo-rig.c\template\cn\html"
$results = @()
$totalBefore = 0
$totalAfter = 0

function Optimize-HTML {
    param([string]$content)

    # Remove excessive blank lines (3+ consecutive newlines -> 2 newlines)
    $content = $content -replace '(\r?\n){3,}', "`n`n"

    # Remove trailing spaces at end of lines
    $content = $content -replace '[ \t]+(\r?\n)', '$1'

    # Compress multiple spaces to single space (but not within strings or PbootCMS tags)
    # Only between HTML tags where it's safe
    $content = $content -replace '>\s+<', '><'

    # Remove spaces around equals in attributes
    $content = $content -replace '\s*=\s*', '='

    # Remove HTML comments (but preserve conditional comments)
    $content = $content -replace '<!--(?!\[if)(?!.*?<!\[endif\]).*?-->', ''

    # Remove empty script tags
    $content = $content -replace '<script[^>]*>\s*</script>', ''

    # Remove empty style tags
    $content = $content -replace '<style[^>]*>\s*</style>', ''

    # Trim trailing/leading whitespace from each line while preserving structure
    $lines = $content -split '\r?\n'
    $lines = $lines | ForEach-Object { $_.TrimEnd() }
    $content = $lines -join "`n"

    # Remove completely empty lines between tags (not lines with content)
    $content = $content -replace '\n\s*\n\s*\n', "`n`n"

    # Final trim
    $content = $content.Trim()

    return $content
}

Get-ChildItem -Path $targetDir -Filter "*.html" -Recurse | ForEach-Object {
    $file = $_
    $relativePath = $file.FullName.Replace("$targetDir\", "")

    Write-Host "Processing: $relativePath" -ForegroundColor Cyan

    # Read original content
    $originalContent = Get-Content -Path $file.FullName -Raw -Encoding UTF8
    $beforeSize = $originalContent.Length

    # Optimize
    $optimizedContent = Optimize-HTML -content $originalContent
    $afterSize = $optimizedContent.Length

    # Write back
    [System.IO.File]::WriteAllText($file.FullName, $optimizedContent, [System.Text.UTF8Encoding]::new($false))

    $saved = $beforeSize - $afterSize
    $savedKB = [math]::Round($saved / 1KB, 2)

    $totalBefore += $beforeSize
    $totalAfter += $afterSize

    $results += [PSCustomObject]@{
        File = $relativePath
        BeforeBytes = $beforeSize
        AfterBytes = $afterSize
        SavedBytes = $saved
        SavedKB = $savedKB
    }

    Write-Host "  Before: $beforeSize bytes | After: $afterSize bytes | Saved: $savedKB KB" -ForegroundColor Green
}

Write-Host "`n========================================" -ForegroundColor Yellow
Write-Host "OPTIMIZATION REPORT" -ForegroundColor Yellow
Write-Host "========================================`n" -ForegroundColor Yellow

$results | Sort-Object -Property SavedBytes -Descending | ForEach-Object {
    $pct = if ($_.BeforeBytes -gt 0) { [math]::Round(($_.SavedBytes / $_.BeforeBytes) * 100, 1) } else { 0 }
    Write-Host "$($_.File)"
    Write-Host "  Before: $($_.BeforeBytes) bytes | After: $($_.AfterBytes) bytes | Saved: $($_.SavedKB) KB ($pct%)" -ForegroundColor Green
}

$totalSavedKB = [math]::Round(($totalBefore - $totalAfter) / 1KB, 2)
$totalPct = if ($totalBefore -gt 0) { [math]::Round((($totalBefore - $totalAfter) / $totalBefore) * 100, 1) } else { 0 }

Write-Host "`n========================================" -ForegroundColor Yellow
Write-Host "TOTAL STATISTICS" -ForegroundColor Yellow
Write-Host "========================================" -ForegroundColor Yellow
Write-Host "Files processed: $($results.Count)" -ForegroundColor Cyan
Write-Host "Total before: $totalBefore bytes ($([math]::Round($totalBefore / 1KB, 2)) KB)" -ForegroundColor Cyan
Write-Host "Total after: $totalAfter bytes ($([math]::Round($totalAfter / 1KB, 2)) KB)" -ForegroundColor Cyan
Write-Host "Total saved: $($totalBefore - $totalAfter) bytes ($totalSavedKB KB)" -ForegroundColor Green
Write-Host "Reduction: $totalPct%" -ForegroundColor Green
Write-Host "`nOptimization complete!" -ForegroundColor Yellow
