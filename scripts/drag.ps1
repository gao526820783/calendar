# Simulate a mouse drag on the app window to verify horizontal drag-scroll.
# Usage: drag.ps1 -X1 200 -Y1 400 -X2 80 -Y2 400 [-Out shot.png]
param(
  [int]$X1 = 260,
  [int]$Y1 = 400,
  [int]$X2 = 80,
  [int]$Y2 = 400,
  [string]$Out = "D:\weather\preview\drag.png",
  [string]$Proc = "mywether",
  [int]$Steps = 24,
  [int]$PreDelayMs = 150
)

Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms

$sig = @"
using System;
using System.Runtime.InteropServices;
public class Drag {
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint dwFlags, int dx, int dy, uint dwData, IntPtr dwExtraInfo);
}
"@
Add-Type -TypeDefinition $sig

$MOUSEEVENTF_LEFTDOWN = 0x0002
$MOUSEEVENTF_LEFTUP   = 0x0004

# locate window
$sig2 = @"
using System;
using System.Runtime.InteropServices;
public class WinFind {
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hwnd, out RECT lpRect);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
}
"@
Add-Type -TypeDefinition $sig2

$pids = @(Get-Process -Name $Proc -ErrorAction SilentlyContinue | ForEach-Object { [uint32]$_.Id })
$found = New-Object System.Collections.ArrayList
$cb = [WinFind+EnumWindowsProc]{
  param($h, $l)
  if ([WinFind]::IsWindowVisible($h)) {
    $p = [uint32]0
    [void][WinFind]::GetWindowThreadProcessId($h, [ref]$p)
    if ($pids -contains $p) { [void]$found.Add($h) }
  }
  return $true
}
[void][WinFind]::EnumWindows($cb, [IntPtr]::Zero)
if ($found.Count -eq 0) { Write-Error "no window"; exit 1 }
$hwnd = $found[0]
[void][WinFind]::SetForegroundWindow($hwnd)
Start-Sleep -Milliseconds 300

Write-Host "drag: ($X1,$Y1) -> ($X2,$Y2)"
[void][Drag]::SetCursorPos($X1, $Y1)
Start-Sleep -Milliseconds 120
[Drag]::mouse_event($MOUSEEVENTF_LEFTDOWN, 0, 0, 0, [IntPtr]::Zero)
Start-Sleep -Milliseconds $PreDelayMs

for ($i = 1; $i -le $Steps; $i++) {
  $t = $i / $Steps
  $x = [int]($X1 + ($X2 - $X1) * $t)
  $y = [int]($Y1 + ($Y2 - $Y1) * $t)
  [void][Drag]::SetCursorPos($x, $y)
  Start-Sleep -Milliseconds 16
}
Start-Sleep -Milliseconds 200
[Drag]::mouse_event($MOUSEEVENTF_LEFTUP, 0, 0, 0, [IntPtr]::Zero)
Start-Sleep -Milliseconds 400
Write-Host "drag done"
