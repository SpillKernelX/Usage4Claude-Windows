Set-Location $PSScriptRoot

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

function Show-Balloon($title, $body) {
  $icon = New-Object System.Windows.Forms.NotifyIcon
  $icon.Icon = [System.Drawing.Icon]::new((Join-Path $PSScriptRoot 'icon.ico'))
  $icon.BalloonTipIcon  = [System.Windows.Forms.ToolTipIcon]::Info
  $icon.BalloonTipTitle = $title
  $icon.BalloonTipText  = $body
  $icon.Visible = $true
  $icon.ShowBalloonTip(4000)
  Start-Sleep -Milliseconds 600
  $icon.Visible = $false
  $icon.Dispose()
}

# ── Trigger the workflow ───────────────────────────────────────────────────
Show-Balloon "Usage4Claude" "Checking upstream macOS repo for changes..."

$result = gh workflow run upstream-sync.yml --repo SpillKernelX/Usage4Claude-Windows 2>&1

if ($LASTEXITCODE -eq 0) {
  Show-Balloon "Upstream check triggered" "Opening Actions page in your browser..."
  Start-Sleep -Seconds 1
  Start-Process "https://github.com/SpillKernelX/Usage4Claude-Windows/actions/workflows/upstream-sync.yml"
} else {
  Show-Balloon "Upstream check failed" "$result"
}
