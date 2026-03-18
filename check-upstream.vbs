Set WshShell = CreateObject("WScript.Shell")
WshShell.CurrentDirectory = WshShell.ExpandEnvironmentStrings(Replace(WScript.ScriptFullName, WScript.ScriptName, ""))
WshShell.Run "powershell -ExecutionPolicy Bypass -WindowStyle Hidden -File check-upstream.ps1", 0, False
