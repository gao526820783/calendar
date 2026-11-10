# Capture mywether main window screenshot (Win32 PrintWindow)
# NOTE: keep this file ASCII-only (PS 5.1 reads no-BOM files as ANSI).
param(
  [string]$Out = "D:\weather\preview\shot.png",
  [string]$Proc = "mywether"
)

Add-Type -AssemblyName System.Drawing

$sig = @"
using System;
using System.Runtime.InteropServices;
using System.Drawing;

public class WinCap {
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr hwnd, IntPtr hdcBlt, uint nFlags);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hwnd, out RECT lpRect);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
}
"@

Add-Type -TypeDefinition $sig -ReferencedAssemblies System.Drawing

$target = Get-Process -Name $Proc -ErrorAction SilentlyContinue
if (-not $target) { Write-Error "process '$Proc' not running"; exit 1 }
$pids = @($target | ForEach-Object { [uint32]$_.Id })
Write-Host ("pids: " + ($pids -join ","))

$found = New-Object System.Collections.ArrayList
$cb = [WinCap+EnumWindowsProc]{
  param($h, $l)
  if ([WinCap]::IsWindowVisible($h)) {
    $pid2 = [uint32]0
    [void][WinCap]::GetWindowThreadProcessId($h, [ref]$pid2)
    if ($pids -contains $pid2) { [void]$found.Add($h) }
  }
  return $true
}
[void][WinCap]::EnumWindows($cb, [IntPtr]::Zero)

if ($found.Count -eq 0) { Write-Error "no visible window for '$Proc'"; exit 1 }

$hwnd = $found[0]
$r = New-Object WinCap+RECT
[void][WinCap]::GetWindowRect($hwnd, [ref]$r)
$w = $r.Right - $r.Left
$h = $r.Bottom - $r.Top
Write-Host "window: $w x $h at $($r.Left),$($r.Top)"

$bmp = New-Object System.Drawing.Bitmap($w, $h)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$hdc = $g.GetHdc()
# flag 2 = PW_RENDERFULLCONTENT
[void][WinCap]::PrintWindow($hwnd, $hdc, 2)
$g.ReleaseHdc($hdc)
$g.Dispose()
$bmp.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()
Write-Host "saved $Out"
