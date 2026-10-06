<#
Starts Lowlit hidden, on a profile of its own, with its self-test switched on, waits for it to end and prints
the test's report. The profile is never the person's own: a second start on that one would only bring their window
to the front. Nothing here closes, restarts or looks into a window the run did not start itself.

  powershell -NoProfile -ExecutionPolicy Bypass -File dev\run-selftest.ps1 -Name states -Only states
  powershell -NoProfile -ExecutionPolicy Bypass -File dev\run-selftest.ps1 -Name consoles -Skip states -Only widths
  powershell -NoProfile -ExecutionPolicy Bypass -File dev\run-selftest.ps1 -Name leave -Only leave
  powershell -NoProfile -ExecutionPolicy Bypass -File dev\run-selftest.ps1 -Name nest -Only nest
  powershell -NoProfile -ExecutionPolicy Bypass -File dev\run-selftest.ps1 -Name back -Only back -ProfileName leave -Keep -Expect auto
  powershell -NoProfile -ExecutionPolicy Bypass -File dev\run-selftest.ps1 -Name picture -Only picture -Dom
  powershell -NoProfile -ExecutionPolicy Bypass -File dev\run-selftest.ps1 -Name redraw125 -Only redraw -Scale 1.25

What it prints: the lines of report.txt, how the run ended, and counts of what it left behind. Never a command
line, and nothing out of report.json (it holds process and session ids).
#>
param(
  [string]$Name = 'run',
  [string]$Only = '',
  [string]$Skip = '',
  [switch]$Type,
  [string]$Close = '',
  [string]$Console = '',
  [switch]$Dom,
  [string]$Ready = '',
  [string]$Expect = '',
  [string]$ProfileName = '',
  [switch]$Keep,
  # the run leaves its chats running in the keeper on purpose, for the next run on its profile (-Only keep)
  [switch]$Leaves,
  [string]$AgentArgs = '',
  # drawn as on a screen at another scaling: 1.25 for 125%
  [double]$Scale = 0,
  [int]$TimeoutSec = 150,
  [switch]$Quiet
)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$safe = '^[A-Za-z0-9_-]{1,40}$'
if ($Name -notmatch $safe) { throw "a run name holds letters, digits, - and _ only: $Name" }
if (-not $ProfileName) { $ProfileName = $Name }
if ($ProfileName -notmatch $safe) { throw "a profile name holds letters, digits, - and _ only: $ProfileName" }

$app = Split-Path -Parent $PSScriptRoot
$electron = Join-Path $app 'node_modules\electron\dist\electron.exe'
if (-not (Test-Path $electron)) { throw "Electron is not installed in $app" }
$base = Join-Path $env:LOCALAPPDATA 'lowlit-dev'
$out = Join-Path $base "runs\$Name"
$profileDir = Join-Path $base "profiles\$ProfileName"

if (Test-Path $out) { Remove-Item -Recurse -Force -Confirm:$false $out }
New-Item -ItemType Directory -Force $out | Out-Null
if ((Test-Path $profileDir) -and -not $Keep) { Remove-Item -Recurse -Force -Confirm:$false $profileDir }
New-Item -ItemType Directory -Force $profileDir | Out-Null

# only what this run asks for reaches the app: nothing left over from the shell that started it
foreach ($n in 'DESK_SELFTEST_ONLY', 'DESK_SELFTEST_SKIP', 'DESK_SELFTEST_TYPE', 'DESK_SELFTEST_CLOSE', 'DESK_SELFTEST_EXPECT',
    'DESK_SELFTEST_READY', 'DESK_SELFTEST_AGENT_ARGS', 'DESK_CONSOLE', 'DESK_RENDERER', 'DESK_SCALE', 'ELECTRON_RUN_AS_NODE') {
  if (Test-Path "Env:$n") { Remove-Item "Env:$n" }
}
$env:DESK_HIDDEN = '1'
$env:DESK_SELFTEST = $out
$env:DESK_PROFILE_DIR = $profileDir
if ($Only) { $env:DESK_SELFTEST_ONLY = $Only }
if ($Skip) { $env:DESK_SELFTEST_SKIP = $Skip }
if ($Type) { $env:DESK_SELFTEST_TYPE = '1' }
if ($Close) { $env:DESK_SELFTEST_CLOSE = $Close }
if ($Expect) { $env:DESK_SELFTEST_EXPECT = $Expect }
if ($Ready) { $env:DESK_SELFTEST_READY = $Ready }
if ($AgentArgs) { $env:DESK_SELFTEST_AGENT_ARGS = $AgentArgs }
if ($Console) { $env:DESK_CONSOLE = $Console }
if ($Dom) { $env:DESK_RENDERER = 'dom' }
if ($Scale -gt 0) { $env:DESK_SCALE = $Scale.ToString([System.Globalization.CultureInfo]::InvariantCulture) }

# a run without -Only, or one that only leaves the made-up sessions out, starts a real agent CLI in a console; so does -Only redraw
$holdsAgent = ($Only -eq '' -or $Only -eq 'redraw')

$started = Get-Date
$watch = [System.Diagnostics.Stopwatch]::StartNew()
$p = Start-Process -FilePath $electron -ArgumentList ('"{0}"' -f $app) -PassThru `
  -RedirectStandardOutput (Join-Path $out 'stdout.log') -RedirectStandardError (Join-Path $out 'stderr.log')
$null = $p.Handle
$ended = $p.WaitForExit($TimeoutSec * 1000)
$stopped = $false
if (-not $ended) {
  # an agent CLI that just started must not be cut off: it is given the time to be past its first seconds
  if ($holdsAgent) { $ended = $p.WaitForExit(20000) }
  if (-not $ended) {
    Stop-Process -Id $p.Id -Force -Confirm:$false -ErrorAction SilentlyContinue
    $stopped = $true
    $null = $p.WaitForExit(5000)
  }
}
$watch.Stop()

# what the run left behind: every program that descends from the app this run started, and is younger than the run.
# A run that ends abruptly leaves its consoles to its keeper, which closes each once it is 16 s old (keeper.cjs).
$left = @()
for ($try = 0; $try -lt $(if ($Leaves) { 1 } else { 18 }); $try++) {
  $all = Get-CimInstance Win32_Process -Property ProcessId, ParentProcessId, Name, CreationDate
  $byParent = @{}
  foreach ($x in $all) {
    $key = [int]$x.ParentProcessId
    if (-not $byParent.ContainsKey($key)) { $byParent[$key] = New-Object System.Collections.ArrayList }
    $null = $byParent[$key].Add($x)
  }
  $left = @()
  $queue = New-Object System.Collections.Queue
  $queue.Enqueue([int]$p.Id)
  $seen = @{}
  while ($queue.Count -gt 0) {
    $id = $queue.Dequeue()
    if ($seen.ContainsKey($id)) { continue }
    $seen[$id] = $true
    if (-not $byParent.ContainsKey($id)) { continue }
    foreach ($child in $byParent[$id]) {
      if ($child.CreationDate -and $child.CreationDate -lt $started.AddSeconds(-2)) { continue }
      $left += $child
      $queue.Enqueue([int]$child.ProcessId)
    }
  }
  if ($left.Count -eq 0) { break }
  Start-Sleep -Milliseconds 1500
}

$report = Join-Path $out 'report.txt'
Write-Output "=== $Name ==="
if (Test-Path $report) {
  $lines = Get-Content -Encoding UTF8 $report
  if ($Quiet) { $lines = $lines | Where-Object { $_ -match '^(FAIL|RESULT)' } }
  $lines | ForEach-Object { Write-Output $_ }
} else {
  Write-Output 'FAIL  the run wrote no report'
}
Write-Output ''
$how = if ($stopped) { "stopped by the runner after $TimeoutSec s" } else { "ended by itself with code $($p.ExitCode)" }
Write-Output ("run: {0} s, {1}" -f [math]::Round($watch.Elapsed.TotalSeconds), $how)
if ($left.Count -eq 0) {
  Write-Output 'left running by the run: nothing'
} elseif ($Leaves) {
  $names = ($left | Group-Object Name | ForEach-Object { "$($_.Count) x $($_.Name)" }) -join ', '
  Write-Output "left running on purpose, for the next run on this profile: $($left.Count) program(s): $names"
} else {
  $names = ($left | Group-Object Name | ForEach-Object { "$($_.Count) x $($_.Name)" }) -join ', '
  Write-Output "LEFT RUNNING by the run: $($left.Count) program(s): $names"
}

# the consoles (and the agent) the test itself wrote down: gone, or not. Their ids stay in here.
$json = Join-Path $out 'report.json'
if (Test-Path $json) {
  try {
    $notes = Get-Content -Raw -Encoding UTF8 $json | ConvertFrom-Json
    $ids = @()
    if ($notes.shells) { $ids += @($notes.shells) }
    if ($notes.agent) { if ($notes.agent.pid) { $ids += $notes.agent.pid }; if ($notes.agent.shellPid) { $ids += $notes.agent.shellPid } }
    $ids = @($ids | Where-Object { $_ } | Select-Object -Unique)
    if ($ids.Count -gt 0) {
      $alive = 0
      foreach ($id in $ids) {
        $proc = Get-Process -Id $id -ErrorAction SilentlyContinue
        if (-not $proc) { continue }
        $young = $true
        try { $young = $proc.StartTime -ge $started.AddSeconds(-2) } catch { $young = $true }
        if ($young) { $alive++ }
      }
      $word = if ($alive -eq 0) { 'PASS' } else { 'FAIL' }
      Write-Output "$word  of the $($ids.Count) program(s) the test wrote down, $alive still run"
    }
  } catch {
    Write-Output 'note: report.json could not be read'
  }
}

# what the run's own profile holds for the next start (counts only)
$deskFile = Join-Path $profileDir 'desk.json'
if (Test-Path $deskFile) {
  try {
    $desk = Get-Content -Raw -Encoding UTF8 $deskFile | ConvertFrom-Json
    Write-Output ("profile '{0}': marked as running: {1}; chats on record: {2}; on screen at once: {3} (last more than one: {4})" -f `
      $ProfileName, $desk.running, @($desk.open | Where-Object { $_ }).Count, $desk.tiles, $desk.split)
  } catch {
    Write-Output "profile '$ProfileName': its settings file could not be read"
  }
}

$pictures = @(Get-ChildItem -Path $out -Filter *.png -ErrorAction SilentlyContinue | Sort-Object Name)
if ($pictures.Count -gt 0) { Write-Output ("pictures: {0} ({1})" -f $pictures.Count, (($pictures | ForEach-Object { $_.BaseName }) -join ', ')) }
foreach ($log in 'stdout.log', 'stderr.log') {
  $file = Join-Path $out $log
  if ((Test-Path $file) -and (Get-Item $file).Length -gt 0) { Write-Output ("{0}: {1} line(s), kept in the run folder" -f $log, @(Get-Content $file).Count) }
}
Write-Output "folder: $out"
