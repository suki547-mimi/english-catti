<#
.SYNOPSIS
Pack the pre-generated pronunciation library into a single zip so it can be
attached to a GitHub Release. Only `us/` + `uk/` (headword audio) are packed;
`sentences/` is a machine-local edge-tts cache and should be regenerated on
each PC.

Produces:
  data/audio_pack.zip           - the archive (gitignored)
  data/audio-manifest.json      - tag / asset / sha256 / size / files (in git)

After running, upload the zip to a release on GitHub. The manifest tells
`tools/fetch_audio.ps1` on another PC what to download.

.EXAMPLE
  .\tools\pack_audio.ps1                     # tag defaults to audio-v1
  .\tools\pack_audio.ps1 -Tag audio-v2       # bump when re-packing
#>
[CmdletBinding()]
param(
    [string]$Tag = 'audio-v1'
)

$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$audioDir = Join-Path $root 'data\audio'
$dst = Join-Path $root 'data\audio_pack.zip'
$manifestPath = Join-Path $root 'data\audio-manifest.json'

if (-not (Test-Path (Join-Path $audioDir 'us'))) { throw "no data/audio/us found; nothing to pack" }
if (-not (Test-Path (Join-Path $audioDir 'uk'))) { throw "no data/audio/uk found; nothing to pack" }
if (-not (Get-Command tar.exe -ErrorAction SilentlyContinue)) { throw "tar.exe not found; needs Windows 10 1803+" }

if (Test-Path $dst) { Remove-Item $dst -Force }

Write-Host "[pack_audio] archiving us/ + uk/ into $dst ..." -ForegroundColor Cyan
$t0 = Get-Date
& tar.exe --format=zip -cf $dst -C $audioDir us uk
if ($LASTEXITCODE -ne 0) { throw "tar failed with exit $LASTEXITCODE" }

Write-Host "[pack_audio] hashing ..."
$size = (Get-Item $dst).Length
$sha = (Get-FileHash $dst -Algorithm SHA256).Hash.ToLower()
$fileCount = (Get-ChildItem (Join-Path $audioDir 'us'), (Join-Path $audioDir 'uk') -File -Recurse).Count

$manifest = [ordered]@{
    tag        = $Tag
    asset      = 'audio_pack.zip'
    size_bytes = $size
    file_count = $fileCount
    sha256     = $sha
    packed_at  = (Get-Date).ToString('o')
    contents   = @('us', 'uk')
    note       = 'sentences/ (dynamic edge-tts cache) is intentionally excluded'
}
$manifest | ConvertTo-Json -Depth 4 | Set-Content -Path $manifestPath -Encoding UTF8

$elapsed = [int]((Get-Date) - $t0).TotalSeconds
$sizeMB = [math]::Round($size / 1MB, 1)
Write-Host ""
Write-Host "[pack_audio] done in ${elapsed}s: $fileCount files, $sizeMB MB" -ForegroundColor Green
Write-Host "            sha256: $sha"
Write-Host ""
Write-Host "Next: upload $dst to GitHub Releases as tag '$Tag'." -ForegroundColor Yellow
Write-Host "  Option A (gh CLI):"
Write-Host "    gh release create $Tag `"$dst`" --title `"Audio library $Tag`" --notes `"$fileCount headword mp3 files (US+UK, $sizeMB MB)`""
Write-Host "  Option B (web):"
Write-Host "    https://github.com/suki547-mimi/english-catti/releases/new?tag=$Tag"
Write-Host ""
Write-Host "Then commit + push the manifest:"
Write-Host "  .\tools\backup.ps1 `"audio manifest: $Tag ($fileCount files, $sizeMB MB)`""
