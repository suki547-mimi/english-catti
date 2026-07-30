# One-click rebuild + reinstall the English CATTI extension.
# Usage:   .\english-extension\rebuild-install.ps1
Push-Location $PSScriptRoot
try {
    Write-Host "[1/3] Compile TypeScript..." -ForegroundColor Cyan
    npm run compile
    if ($LASTEXITCODE -ne 0) { Write-Host "compile failed" -ForegroundColor Red; return }

    Write-Host "[2/3] Package .vsix..." -ForegroundColor Cyan
    npx --yes @vscode/vsce package --no-dependencies --allow-missing-repository --allow-star-activation --skip-license 2>&1 | Select-Object -Last 5
    $vsix = Get-ChildItem "*.vsix" | Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if (-not $vsix) { Write-Host "no vsix produced" -ForegroundColor Red; return }
    Write-Host "  built: $($vsix.Name)"

    Write-Host "[3/3] Install into main VS Code..." -ForegroundColor Cyan
    code --install-extension $vsix.FullName --force 2>&1 | Select-Object -Last 3
    Write-Host "Done. Please restart VS Code windows to pick up the new build." -ForegroundColor Green
} finally {
    Pop-Location
}
