Set-Location $PSScriptRoot

Write-Host "Triggering upstream sync check..."
gh workflow run upstream-sync.yml --repo SpillKernelX/Usage4Claude-Windows

Start-Sleep -Seconds 2

# Open the Actions page so you can watch it run
Start-Process "https://github.com/SpillKernelX/Usage4Claude-Windows/actions/workflows/upstream-sync.yml"
