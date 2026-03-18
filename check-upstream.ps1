Set-Location $PSScriptRoot

function Show-Toast($title, $body) {
  [Windows.UI.Notifications.ToastNotificationManager,
   Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
  [Windows.Data.Xml.Dom.XmlDocument,
   Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] | Out-Null

  $xml = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent(
    [Windows.UI.Notifications.ToastTemplateType]::ToastText02)
  $xml.GetElementsByTagName('text')[0].AppendChild($xml.CreateTextNode($title)) | Out-Null
  $xml.GetElementsByTagName('text')[1].AppendChild($xml.CreateTextNode($body))  | Out-Null

  $toast = [Windows.UI.Notifications.ToastNotification]::new($xml)
  [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier(
    'Usage4Claude — Upstream Check').Show($toast)
}

# ── Trigger the workflow ───────────────────────────────────────────────────
Show-Toast "Checking upstream..." "Queuing workflow on GitHub Actions..."

$result = gh workflow run upstream-sync.yml --repo SpillKernelX/Usage4Claude-Windows 2>&1

if ($LASTEXITCODE -eq 0) {
  Show-Toast "Upstream check triggered" "Opening Actions page in your browser..."
  Start-Sleep -Seconds 2
  Start-Process "https://github.com/SpillKernelX/Usage4Claude-Windows/actions/workflows/upstream-sync.yml"
} else {
  Show-Toast "Upstream check failed" $result
}
