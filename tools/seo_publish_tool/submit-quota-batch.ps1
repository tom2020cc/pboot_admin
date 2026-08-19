# Google Indexing API 每日配额批量提交脚本（配额 200/天，太平洋零点重置）
# 用法: powershell -File submit-quota-batch.ps1 [数量]   默认 200
param(
  [int]$MaxCount = 200
)

$ErrorActionPreference = 'Stop'
$Api = 'http://localhost:5288'

function Utf8Json([string]$s) { [System.Text.Encoding]::UTF8.GetBytes($s) }

# 0. 各语言首页不在 report 里，手工放到最前面
$homepages = @(
  'https://shanbo.cc/',   # 主域 = 英文站
  'https://cn.shanbo.cc/',
  'https://es.shanbo.cc/',
  'https://fr.shanbo.cc/',
  'https://ru.shanbo.cc/',
  'https://ar.shanbo.cc/',
  'https://pt.shanbo.cc/'
)

# 1. 取 URL 报告，按 priority 从高到低排序（首页/高权重栏目优先）
$report = Invoke-RestMethod "$Api/api/report" -TimeoutSec 60
$urls = @($homepages) + @($report.urls | Where-Object { $_.url -match '^https?://' } |
  Sort-Object { [double]($_.priority -as [double]) } -Descending |
  Select-Object -ExpandProperty url -Unique)
$urls = @($urls | Select-Object -Unique)

if (-not $urls.Count) { throw 'report 里没有可提交 URL' }
Write-Host ("候选 URL 总数: {0}, 本次上限: {1}" -f $urls.Count, $MaxCount)

$batchSize = 20
$ok = 0; $fail = 0; $samples = @(); $i = 0
while ($i -lt $urls.Count -and ($ok + $fail) -lt $MaxCount) {
  $batch = @($urls[$i..([Math]::Min($i + $batchSize - 1, $urls.Count - 1))])
  $body = Utf8Json (@{ urls = $batch } | ConvertTo-Json -Compress)
  try {
    $r = Invoke-RestMethod "$Api/api/google-indexing/submit" -Method Post -ContentType 'application/json; charset=utf-8' -Body $body -TimeoutSec 120
  } catch {
    Write-Host "批次请求失败: $($_.Exception.Message)"
    break
  }
  foreach ($item in @($r.results)) {
    if ($item.ok) { $ok++ } else {
      $fail++
      if ($samples.Count -lt 3) { $samples += ("{0} => {1}" -f $item.url, $item.message) }
    }
  }
  Write-Host ("进度: {0}/{1}  成功 {2}  失败 {3}" -f ($ok + $fail), [Math]::Min($urls.Count, $MaxCount), $ok, $fail)

  # 遇 429 配额耗尽：立即停止，不再烧请求
  $quotaHit = @($r.results | Where-Object { $_.status -eq 429 }).Count -gt 0
  if ($quotaHit) {
    Write-Host '>>> 遇到 429（当日配额耗尽），停止提交。'
    break
  }
  $i += $batchSize
}

Write-Host ''
Write-Host ("===== 完成: 成功 {0}, 失败 {1} =====" -f $ok, $fail)
if ($samples.Count) { Write-Host "失败样例:"; $samples | ForEach-Object { Write-Host "  $_" } }
