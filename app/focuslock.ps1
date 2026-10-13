# Lowlit: Windows' focus lock (ForegroundLockTimeout), for how long after a key or a click Windows keeps other programs
# from coming in front, in milliseconds. Asked for by focuslock.cjs.
# -Mode read: the live value. stop: the live value 0. restore: the value the person's own Windows setting names in the
# registry (Windows' 200000 when it names none). Only the live value changes: Windows sets it again at every sign-in.
# Windows takes a change only from the program in front, or one it started; any other is answered with error 87 and
# nothing changes. Answers with one line: {"before":ms,"after":ms,"error":Windows' own number, or 0}.
param([ValidateSet('read', 'stop', 'restore')][string]$Mode = 'read')
$ErrorActionPreference = 'Stop'
Add-Type -Namespace FocusLock -Name Native -MemberDefinition @'
[DllImport("user32.dll", EntryPoint = "SystemParametersInfoW", SetLastError = true)] public static extern bool Read(uint action, uint param, out uint value, uint winIni);
[DllImport("user32.dll", EntryPoint = "SystemParametersInfoW", SetLastError = true)] public static extern bool Write(uint action, uint param, System.IntPtr value, uint winIni);
'@
function Live { $v = [uint32]0; if ([FocusLock.Native]::Read(0x2000, 0, [ref]$v, 0)) { [long]$v } else { -1 } }
$before = Live
$err = 0
if ($Mode -ne 'read') {
  $want = 0
  if ($Mode -eq 'restore') {
    $want = 200000
    $own = Get-ItemProperty -LiteralPath 'HKCU:\Control Panel\Desktop' -Name ForegroundLockTimeout -ErrorAction SilentlyContinue
    if ($own -and $own.ForegroundLockTimeout -is [int] -and $own.ForegroundLockTimeout -ge 0) { $want = [long]$own.ForegroundLockTimeout }
  }
  if ($before -ne $want -and -not [FocusLock.Native]::Write(0x2001, 0, [IntPtr]$want, 0)) { $err = [Runtime.InteropServices.Marshal]::GetLastWin32Error() }
}
'{{"before":{0},"after":{1},"error":{2}}}' -f $before, (Live), $err
