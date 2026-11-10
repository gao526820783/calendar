# Click on a horizontal strip position (to verify drag does not trigger the select dropdown).
# Usage: stripclick.ps1 -X 200 -Y 435
param(
  [int]$X = 200,
  [int]$Y = 435,
  [string]$Proc = "mywether"
)

$sig = @"
using System;
using System.Runtime.InteropServices;
public class StripClick {
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint dwFlags, int dx, int dy, uint dwData, IntPtr dwExtraInfo);
}
"@
Add-Type -TypeDefinition $sig

[void][StripClick]::SetCursorPos($X, $Y)
Start-Sleep -Milliseconds 150
[StripClick]::mouse_event(0x0002, 0, 0, 0, [IntPtr]::Zero)
Start-Sleep -Milliseconds 60
[StripClick]::mouse_event(0x0004, 0, 0, 0, [IntPtr]::Zero)
Start-Sleep -Milliseconds 500
Write-Host "clicked strip at $X,$Y"
