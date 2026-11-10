# Click at a screen position on the app window (for UI verification).
# Usage: click.ps1 -X 145 -Y 390
param(
  [int]$X = 145,
  [int]$Y = 390,
  [string]$Proc = "mywether"
)

$sig = @"
using System;
using System.Runtime.InteropServices;
public class Clicker {
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint dwFlags, int dx, int dy, uint dwData, IntPtr dwExtraInfo);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
}
"@
Add-Type -TypeDefinition $sig

$pids = @(Get-Process -Name $Proc -ErrorAction SilentlyContinue | ForEach-Object { [uint32]$_.Id })
$found = New-Object System.Collections.ArrayList
$cb = [Clicker+EnumWindowsProc]{
  param($h, $l)
  if ([Clicker]::IsWindowVisible($h)) {
    $p = [uint32]0
    [void][Clicker]::GetWindowThreadProcessId($h, [ref]$p)
    if ($pids -contains $p) { [void]$found.Add($h) }
  }
  return $true
}
[void][Clicker]::EnumWindows($cb, [IntPtr]::Zero)
if ($found.Count -eq 0) { Write-Error "no window"; exit 1 }
[void][Clicker]::SetForegroundWindow($found[0])
Start-Sleep -Milliseconds 250

[void][Clicker]::SetCursorPos($X, $Y)
Start-Sleep -Milliseconds 120
[Clicker]::mouse_event(0x0002, 0, 0, 0, [IntPtr]::Zero)
Start-Sleep -Milliseconds 60
[Clicker]::mouse_event(0x0004, 0, 0, 0, [IntPtr]::Zero)
Start-Sleep -Milliseconds 400
Write-Host "clicked $X,$Y"
