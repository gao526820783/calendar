# Print window rect + client area origin for the app window (debug coordinates).
param([string]$Proc = "mywether")

$sig = @"
using System;
using System.Runtime.InteropServices;
public class Coord {
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hwnd, out RECT lpRect);
  [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr hwnd, out RECT lpRect);
  [DllImport("user32.dll")] public static extern bool ClientToScreen(IntPtr hWnd, ref POINT lpPoint);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X, Y; }
}
"@
Add-Type -TypeDefinition $sig

$pids = @(Get-Process -Name $Proc -ErrorAction SilentlyContinue | ForEach-Object { [uint32]$_.Id })
$found = New-Object System.Collections.ArrayList
$cb = [Coord+EnumWindowsProc]{
  param($h, $l)
  if ([Coord]::IsWindowVisible($h)) {
    $p = [uint32]0
    [void][Coord]::GetWindowThreadProcessId($h, [ref]$p)
    if ($pids -contains $p) { [void]$found.Add($h) }
  }
  return $true
}
[void][Coord]::EnumWindows($cb, [IntPtr]::Zero)

foreach ($hwnd in $found) {
  $wr = New-Object Coord+RECT
  [void][Coord]::GetWindowRect($hwnd, [ref]$wr)
  $cr = New-Object Coord+RECT
  [void][Coord]::GetClientRect($hwnd, [ref]$cr)
  $pt = New-Object Coord+POINT
  $pt.X = 0; $pt.Y = 0
  [void][Coord]::ClientToScreen($hwnd, [ref]$pt)
  Write-Host ("hwnd=0x{0:X}  win=({1},{2})-({3},{4})  size={5}x{6}  clientOrigin=({7},{8})  clientSize={9}x{10}" -f `
    [int64]$hwnd, $wr.Left, $wr.Top, $wr.Right, $wr.Bottom, `
    ($wr.Right-$wr.Left), ($wr.Bottom-$wr.Top), $pt.X, $pt.Y, `
    ($cr.Right-$cr.Left), ($cr.Bottom-$cr.Top))
}
