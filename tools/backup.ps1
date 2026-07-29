# One-click backup script.
# Usage:
#   .\tools\backup.ps1              # commit with default "study" message + timestamp
#   .\tools\backup.ps1 "my message" # commit with custom message
$env:Path = "$env:LOCALAPPDATA\Programs\Git\cmd;" + $env:Path

Push-Location $PSScriptRoot\..
try {
    $msg = if ($args.Count -gt 0) { $args -join ' ' } else { "study: sync $(Get-Date -Format 'yyyy-MM-dd HH:mm')" }
    Write-Host "[backup] adding changes..."
    git add .
    $changes = git status --porcelain
    if (-not $changes) {
        Write-Host "[backup] nothing to commit."
        return
    }
    Write-Host "[backup] committing: $msg"
    git commit -m "$msg"
    Write-Host "[backup] pushing to origin/main..."
    git push
    Write-Host "[backup] done."
} finally {
    Pop-Location
}
