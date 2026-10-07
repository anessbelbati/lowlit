# Lowlit in one step. In PowerShell:
#
#     irm https://getlowlit.pages.dev/install.ps1 | iex
#
# What it does, in this order:
#   1. checks that this is Windows 10 or 11, and that Git and Node.js 22 or newer are installed;
#   2. puts Lowlit's code in a folder of your own (%USERPROFILE%\lowlit), or brings that folder up to date;
#   3. runs "npm install" there, which downloads Electron and the terminal parts, ready built;
#   4. opens the window.
# It asks for no administrator rights, installs no other program, changes no setting of Windows and deletes nothing.
# Run the same line again to update. To remove Lowlit: quit it, then delete the folder (its own settings are in
# %APPDATA%\lowlit).
#
#     $env:LOWLIT_DIR = 'D:\tools\lowlit'    another folder for the code
#     $env:LOWLIT_NO_START = '1'             everything but opening the window
#     $env:LOWLIT_REPO                       another place to fetch the code from (the project's own tests use it)
& {
  $ErrorActionPreference = 'Stop'
  function Say([string]$text) { Write-Host "lowlit: $text" }
  function Same([string]$a, [string]$b) { ($a -replace '\.git$', '').TrimEnd('/') -eq ($b -replace '\.git$', '').TrimEnd('/') }
  # Git and npm print their progress where PowerShell expects errors: in a window that reads those lines itself (the
  # ISE, a run sent to a file) each one would end the install
  function Run([string]$program, [string[]]$with) {
    $ErrorActionPreference = 'Continue'
    & $program @with
  }

  try {
    if ($env:OS -ne 'Windows_NT' -or [Environment]::OSVersion.Version.Major -lt 10) {
      throw 'Lowlit was not installed: it runs on Windows 10 and 11 only, for now.'
    }
    $repo = if ($env:LOWLIT_REPO) { $env:LOWLIT_REPO } else { 'https://github.com/anessbelbati/lowlit' }
    $dir = if ($env:LOWLIT_DIR) { $env:LOWLIT_DIR } else { Join-Path $HOME 'lowlit' }
    $dir = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($dir).TrimEnd('\')
    $window = Join-Path $dir 'app\node_modules\electron\dist\electron.exe'

    if (-not (Get-Command git.exe -ErrorAction SilentlyContinue)) {
      throw 'Lowlit was not installed: Git was not found. Install it (winget install --id Git.Git -e), open a new PowerShell and run the line again.'
    }
    # npm by its program's name: asked for plainly, PowerShell picks npm.ps1, which Windows refuses to run by default
    $npm = Get-Command npm.cmd, npm.exe -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not (Get-Command node.exe -ErrorAction SilentlyContinue) -or -not $npm) {
      throw 'Lowlit was not installed: Node.js was not found. Install it (winget install --id OpenJS.NodeJS.LTS -e), open a new PowerShell and run the line again.'
    }
    $node = "$(& node.exe -v)" -replace '^v', ''
    if ([int]($node -split '\.')[0] -lt 22) {
      throw "Lowlit was not installed: it needs Node.js 22 or newer, and this is $node (winget upgrade --id OpenJS.NodeJS.LTS -e)."
    }

    # a copy that is running keeps its files open, and may be holding chats: it is never closed from here. The part
    # that holds the chats ends some seconds after the window, so a quit is waited for, not asked for twice.
    function Running {
      try {
        @(Get-CimInstance Win32_Process -Filter "Name = 'electron.exe'" -Property ExecutablePath | Where-Object { $_.ExecutablePath -eq $window }).Count
      } catch { 0 }
    }
    if (Running) {
      Say "it is running from $dir. Quit it from its icon near the clock: this goes on by itself once it has closed."
      for ($i = 0; $i -lt 90 -and (Running); $i++) { Start-Sleep -Seconds 1 }
      if (Running) {
        throw "Lowlit was not updated: it is still running from $dir. Quit it from its icon near the clock, then run the line again."
      }
    }

    if (Test-Path -LiteralPath (Join-Path $dir '.git')) {
      $from = [string](Run git.exe '-C', $dir, 'remote', 'get-url', 'origin')
      if ($LASTEXITCODE -ne 0) { throw "Lowlit was not updated: Git could not read the folder $dir. What it printed above says why." }
      if (-not (Same $from $repo)) {
        throw "Lowlit was not installed: the folder $dir holds another project. Set `$env:LOWLIT_DIR to another folder and run the line again."
      }
      Say "bringing $dir up to date"
      Run git.exe '-C', $dir, 'pull', '--ff-only'
      if ($LASTEXITCODE -ne 0) {
        throw "Lowlit was not updated: Git could not bring $dir up to date. If you changed files there, 'git -C `"$dir`" status' lists them."
      }
    } else {
      if ((Test-Path -LiteralPath $dir) -and @(Get-ChildItem -LiteralPath $dir -Force | Select-Object -First 1).Count) {
        throw "Lowlit was not installed: the folder $dir already holds something else. Set `$env:LOWLIT_DIR to another folder and run the line again."
      }
      Say "putting the code in $dir"
      Run git.exe 'clone', '--depth', '1', $repo, $dir
      if ($LASTEXITCODE -ne 0) { throw 'Lowlit was not installed: Git could not fetch the code. What it printed above says why.' }
    }

    Say 'fetching its parts (Electron and the terminal): a minute or two'
    Push-Location -LiteralPath $dir
    try {
      Run $npm.Source 'install', '--no-fund', '--no-audit'
    } finally {
      Pop-Location
    }
    if ($LASTEXITCODE -ne 0) { throw 'Lowlit was not installed: npm install did not finish. What it printed above says why.' }
    if (-not (Test-Path -LiteralPath $window)) { throw "Lowlit was not installed: Electron's program is missing ($window)." }

    if (-not (Get-Command claude -ErrorAction SilentlyContinue)) {
      Say 'note: the "claude" command was not found. The window opens, but a chat needs Claude Code installed and logged in.'
    }
    if ($env:LOWLIT_NO_START -eq '1') {
      Say "ready in $dir (not opened: LOWLIT_NO_START is set)"
      return
    }
    $app = Join-Path $dir 'app'
    Start-Process -FilePath $window -ArgumentList ('"{0}"' -f $app) -WorkingDirectory $app
    Say "opening. It lives in $dir. Settings (Ctrl ,) > Opening Lowlit adds it to the Start menu. To update, run this line again."
  } catch {
    $why = "$($_.Exception.Message)"
    if ($why -notmatch '^Lowlit was not ') { $why = "Lowlit was not installed: $why" }
    Write-Host $why -ForegroundColor Red
    # run as a file, the caller is told by the exit code; pasted as the one line, the window it was typed in stays open
    if ($PSCommandPath) { exit 1 }
  }
}
