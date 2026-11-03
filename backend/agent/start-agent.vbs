Option Explicit
' Launch the tray host with wscript, no window (0 = hidden)
Dim fso, shell, dir, cmd
Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")
dir = fso.GetParentFolderName(WScript.ScriptFullName)
cmd = "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & dir & "\agent-tray.ps1" & """"
shell.Run cmd, 0, False
