param(
  [Parameter(Mandatory = $true)]
  [ValidatePattern('^[a-z0-9-]+$')]
  [string]$Phase,
  [Parameter(Mandatory = $true)]
  [int]$ProcessId,
  [string]$OutDir = 'native-probe-out',
  [switch]$StopAfterCapture
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class PathBlenderNativeCapture {
  [StructLayout(LayoutKind.Sequential)]
  public struct RECT { public int Left, Top, Right, Bottom; }
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr hWnd, IntPtr hdcBlt, uint flags);
}
'@

New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

function Write-ProcessEvidence([string]$Name) {
  $rows = @(Get-CimInstance Win32_Process -Filter "Name = 'pathblender-desktop.exe' OR Name = 'msedgewebview2.exe'" -ErrorAction SilentlyContinue |
    ForEach-Object { [pscustomobject]@{ name = $_.Name; pid = $_.ProcessId; ppid = $_.ParentProcessId; commandLine = $_.CommandLine } })
  [pscustomobject]@{ phase = $Phase; capturedAt = (Get-Date).ToUniversalTime().ToString('o'); processes = $rows } |
    ConvertTo-Json -Depth 5 | Out-File -FilePath (Join-Path $OutDir $Name) -Encoding utf8
  Write-Host "[DEBUG-window-restart] $Name`: $($rows.Count) app/WebView process(es)"
}

function Get-ImageStats([System.Drawing.Bitmap]$Bitmap) {
  $colors = [System.Collections.Generic.HashSet[int]]::new()
  $samples = 0
  $nonWhite = 0
  $opaque = 0
  for ($y = 0; $y -lt $Bitmap.Height; $y += 8) {
    for ($x = 0; $x -lt $Bitmap.Width; $x += 8) {
      $pixel = $Bitmap.GetPixel($x, $y)
      $null = $colors.Add($pixel.ToArgb())
      $samples++
      if ($pixel.R -lt 245 -or $pixel.G -lt 245 -or $pixel.B -lt 245) { $nonWhite++ }
      if ($pixel.A -gt 0) { $opaque++ }
    }
  }
  return [pscustomobject]@{
    width = $Bitmap.Width
    height = $Bitmap.Height
    sampledPixels = $samples
    sampledColors = $colors.Count
    nonWhiteFraction = [Math]::Round($nonWhite / $samples, 5)
    opaqueFraction = [Math]::Round($opaque / $samples, 5)
  }
}

$proc = Get-Process -Id $ProcessId -ErrorAction Stop
if ($proc.ProcessName -ne 'pathblender-desktop') { throw "[DEBUG-window-restart] PID $ProcessId is $($proc.ProcessName), not pathblender-desktop" }
$deadline = (Get-Date).AddSeconds(30)
do {
  $proc.Refresh()
  if ($proc.HasExited) { throw "[DEBUG-window-restart] PID $ProcessId exited before a native window was available" }
  $handle = $proc.MainWindowHandle
  if ($handle -ne [IntPtr]::Zero) { break }
  Start-Sleep -Milliseconds 500
} while ((Get-Date) -lt $deadline)
if ($handle -eq [IntPtr]::Zero) { throw "[DEBUG-window-restart] PID $ProcessId has no native window after 30s" }
Start-Sleep -Seconds 15
$proc.Refresh()
$handle = $proc.MainWindowHandle
$foregroundRequested = [PathBlenderNativeCapture]::SetForegroundWindow($handle)
$focusDeadline = (Get-Date).AddSeconds(5)
do {
  $foreground = [PathBlenderNativeCapture]::GetForegroundWindow()
  if ($foreground -eq $handle) { break }
  Start-Sleep -Milliseconds 100
} while ((Get-Date) -lt $focusDeadline)
$rect = [PathBlenderNativeCapture+RECT]::new()
if (-not [PathBlenderNativeCapture]::GetWindowRect($handle, [ref]$rect)) { throw '[DEBUG-window-restart] GetWindowRect failed' }

Write-ProcessEvidence "$Phase-before-stop.json"
$bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
$screen = [System.Drawing.Bitmap]::new($bounds.Width, $bounds.Height)
$graphics = [System.Drawing.Graphics]::FromImage($screen)
try { $graphics.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size) } finally { $graphics.Dispose() }
$screenPath = Join-Path $OutDir "$Phase-screen.png"
$screen.Save($screenPath)
$screenStats = Get-ImageStats $screen
$screen.Dispose()

$width = $rect.Right - $rect.Left
$height = $rect.Bottom - $rect.Top
if ($width -le 0 -or $height -le 0) { throw "[DEBUG-window-restart] Invalid window rectangle ${width}x${height}" }
$window = [System.Drawing.Bitmap]::new($width, $height)
$graphics = [System.Drawing.Graphics]::FromImage($window)
$hdc = $graphics.GetHdc()
try { $printed = [PathBlenderNativeCapture]::PrintWindow($handle, $hdc, 2) } finally {
  $graphics.ReleaseHdc($hdc)
  $graphics.Dispose()
}
$windowPath = Join-Path $OutDir "$Phase-printwindow.png"
$window.Save($windowPath)
$windowStats = Get-ImageStats $window
$window.Dispose()

[pscustomobject]@{
  phase = $Phase
  capturedAt = (Get-Date).ToUniversalTime().ToString('o')
  pid = $proc.Id
  title = $proc.MainWindowTitle
  mainWindowHandle = $handle.ToInt64()
  foregroundRequested = $foregroundRequested
  foregroundObserved = ($foreground -eq $handle)
  foregroundHandle = $foreground.ToInt64()
  rect = @{ left = $rect.Left; top = $rect.Top; right = $rect.Right; bottom = $rect.Bottom }
  printWindowReturned = $printed
  screen = $screenStats
  printWindow = $windowStats
  stopRequested = [bool]$StopAfterCapture
  debugEnvironment = [pscustomobject]@{
    appBrowserArgs = $env:PB_DEBUG_WEBVIEW_BROWSER_ARGS
    appDataDir = $env:PB_DEBUG_WEBVIEW_DATA_DIR
    webView2Arguments = $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS
  }
} | ConvertTo-Json -Depth 5 | Out-File -FilePath (Join-Path $OutDir "$Phase-result.json") -Encoding utf8
Write-Host "[DEBUG-window-restart] $Phase pid=$($proc.Id) title='$($proc.MainWindowTitle)' PrintWindow=$printed nonWhite=$($windowStats.nonWhiteFraction) colors=$($windowStats.sampledColors)"

if ($StopAfterCapture) {
  $proc.Dispose()
  $running = Get-Process -Id $ProcessId -ErrorAction SilentlyContinue
  if ($running) { Stop-Process -Id $ProcessId -Force }
  $deadline = (Get-Date).AddSeconds(30)
  do {
    Start-Sleep -Milliseconds 500
    $running = Get-Process -Id $ProcessId -ErrorAction SilentlyContinue
    if ($running -and $running.HasExited) {
      $running.Dispose()
      $running = $null
    }
  } while ($running -and (Get-Date) -lt $deadline)
  if ($running) { throw "[DEBUG-window-restart] PID $ProcessId still running 30s after forced stop" }
  Write-ProcessEvidence "$Phase-after-stop.json"
}
