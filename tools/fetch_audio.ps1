<#
.SYNOPSIS
Download and unpack the pre-generated pronunciation library from a GitHub
Release, using data/audio-manifest.json as the source of truth. Idempotent:
if the local audio already matches the manifest's file count, does nothing.

Handles private repos via (in order):
  1. `gh` CLI  (recommended — `winget install --id GitHub.cli` then `gh auth login`)
  2. $env:GITHUB_TOKEN with Invoke-WebRequest
  3. Bails out with a manual-download hint

.EXAMPLE
  .\tools\fetch_audio.ps1
  .\tools\fetch_audio.ps1 -Force            # re-download + overwrite
#>
[CmdletBinding()]
param(
    [string]$Repo = 'suki547-mimi/english-catti',
    [switch]$Force
)

$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$manifestPath = Join-Path $root 'data\audio-manifest.json'
$audioDir = Join-Path $root 'data\audio'
$stagePath = Join-Path $root 'data\audio_pack.zip'

if (-not (Test-Path $manifestPath)) {
    throw "no data/audio-manifest.json — run tools\pack_audio.ps1 on the source machine and push the manifest first"
}
$manifest = Get-Content $manifestPath -Raw | ConvertFrom-Json
$tag = $manifest.tag
$asset = $manifest.asset
$sha256Expected = $manifest.sha256
$expectedFiles = [int]$manifest.file_count

Write-Host "[fetch_audio] manifest: $tag / $asset ($expectedFiles files)" -ForegroundColor Cyan

# Idempotent skip: already have the expected count of mp3 files.
if (-not $Force) {
    $usDir = Join-Path $audioDir 'us'
    $ukDir = Join-Path $audioDir 'uk'
    if ((Test-Path $usDir) -and (Test-Path $ukDir)) {
        $have = (Get-ChildItem $usDir, $ukDir -File -Recurse -ErrorAction SilentlyContinue).Count
        if ($have -ge $expectedFiles) {
            Write-Host "[fetch_audio] already have $have mp3 files; skipping (use -Force to redownload)" -ForegroundColor Green
            return
        }
        Write-Host "[fetch_audio] found $have / $expectedFiles files locally; will refresh" -ForegroundColor Yellow
    }
}

if (Test-Path $stagePath) { Remove-Item $stagePath -Force }

$gh = Get-Command gh -ErrorAction SilentlyContinue
if ($gh) {
    Write-Host "[fetch_audio] using gh CLI ..."
    & gh release download $tag --repo $Repo --pattern $asset --dir (Join-Path $root 'data') --clobber
    if ($LASTEXITCODE -ne 0) { throw "gh release download failed (exit $LASTEXITCODE)" }
}
elseif ($env:GITHUB_TOKEN) {
    Write-Host "[fetch_audio] using GITHUB_TOKEN via REST API ..."
    $releaseUrl = "https://api.github.com/repos/$Repo/releases/tags/$tag"
    $headers = @{
        Authorization = "Bearer $env:GITHUB_TOKEN"
        'User-Agent'  = 'english-catti-fetch'
        Accept        = 'application/vnd.github+json'
    }
    $rel = Invoke-RestMethod -Uri $releaseUrl -Headers $headers
    $assetInfo = $rel.assets | Where-Object { $_.name -eq $asset } | Select-Object -First 1
    if (-not $assetInfo) { throw "release $tag has no asset named $asset" }
    Invoke-WebRequest -Uri $assetInfo.url `
        -Headers @{ Authorization = "Bearer $env:GITHUB_TOKEN"; Accept = 'application/octet-stream'; 'User-Agent' = 'english-catti-fetch' } `
        -OutFile $stagePath
}
else {
    Write-Host ""
    Write-Host "❌ Cannot download automatically. Pick one:" -ForegroundColor Yellow
    Write-Host "  1. Install gh CLI:  winget install --id GitHub.cli   然后 gh auth login"
    Write-Host "  2. Or set a PAT:    `$env:GITHUB_TOKEN = 'ghp_...'"
    Write-Host ""
    Write-Host "Or download manually then re-run:"
    Write-Host "  https://github.com/$Repo/releases/tag/$tag"
    Write-Host "  Save '$asset' to '$stagePath', then rerun this script."
    exit 1
}

if (-not (Test-Path $stagePath)) { throw "download did not produce $stagePath" }

Write-Host "[fetch_audio] verifying sha256 ..."
$sha256Actual = (Get-FileHash $stagePath -Algorithm SHA256).Hash.ToLower()
if ($sha256Actual -ne $sha256Expected) {
    throw "sha256 mismatch: expected $sha256Expected, got $sha256Actual"
}

Write-Host "[fetch_audio] extracting to $audioDir ..."
New-Item -ItemType Directory -Force -Path $audioDir | Out-Null
$t0 = Get-Date
& tar.exe -xf $stagePath -C $audioDir
if ($LASTEXITCODE -ne 0) { throw "tar extract failed (exit $LASTEXITCODE)" }
$elapsed = [int]((Get-Date) - $t0).TotalSeconds

Remove-Item $stagePath -Force
$mp3Count = (Get-ChildItem $audioDir -Recurse -Filter *.mp3 -File).Count
Write-Host "[fetch_audio] done in ${elapsed}s: $mp3Count mp3 files under $audioDir" -ForegroundColor Green
