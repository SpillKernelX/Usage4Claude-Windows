param(
  [Parameter(Mandatory)][string]$Version
)

if ($Version -notmatch '^\d+\.\d+\.\d+$') {
  Write-Error "Version must be in format X.Y.Z  (e.g. .\release.ps1 1.0.1)"
  exit 1
}

Set-Location $PSScriptRoot

# ── 1. Bump version in package.json ───────────────────────────────────────
$pkg = Get-Content package.json -Raw | ConvertFrom-Json
$pkg.version = $Version
$pkg | ConvertTo-Json -Depth 10 | Set-Content package.json
Write-Host "package.json → $Version"

# ── 2. Bump CURRENT_VERSION in main.js ────────────────────────────────────
$main = Get-Content main.js -Raw
$main = $main -replace "const CURRENT_VERSION = '[^']*'", "const CURRENT_VERSION = '$Version'"
Set-Content main.js $main
Write-Host "main.js      → $Version"

# ── 3. Commit, tag, push ──────────────────────────────────────────────────
git add package.json main.js
git commit -m "chore: release v$Version"
git tag "v$Version"
git push origin main
git push origin "v$Version"

Write-Host ""
Write-Host "Released v$Version — GitHub Actions is building the installer."
Write-Host "Track: https://github.com/SpillKernelX/Usage4Claude-Windows/actions"
