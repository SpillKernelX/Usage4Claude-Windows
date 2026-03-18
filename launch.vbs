Set WshShell = CreateObject("WScript.Shell")
WshShell.CurrentDirectory = WshShell.ExpandEnvironmentStrings(Replace(WScript.ScriptFullName, WScript.ScriptName, ""))
WshShell.Run "cmd /c npx electron .", 0, False
