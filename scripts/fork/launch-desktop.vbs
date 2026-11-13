Option Explicit
Dim shell, files, script, command, result
Set shell = CreateObject("WScript.Shell")
Set files = CreateObject("Scripting.FileSystemObject")
script = files.BuildPath(files.GetParentFolderName(WScript.ScriptFullName), "start.ps1")
command = "powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File " & Chr(34) & script & Chr(34)
result = shell.Run(command, 0, True)
If result <> 0 Then
  MsgBox "G3Code could not start. Run scripts\fork\start.ps1 from the checkout to see the error.", vbExclamation, "G3Code"
End If
