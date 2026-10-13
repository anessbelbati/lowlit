'use strict';
// Windows 11 (25H2, build 26200) keeps the security token of every program that starts another program while its
// focus lock holds, until the computer restarts: win32kfull's foreground check takes a reference to it and never gives
// it back, and every sign-in sets the lock to 24.9 days, so it holds all the time. A computer whose chats run commands
// all day fills its kernel memory by gigabytes a day, and every program takes longer to start until the restart. With
// the lock at 0 the check is skipped and nothing is kept. Windows takes the change only from the program in front, or
// one it started: main asks for it while this window is in front (main.cjs leakFix). The holder, measured:
// github.com/bentoner/windows-token-leak; the sign-in that sets the lock again: github.com/gunrgbcr/windows-token-leak-logon-fix
const path = require('node:path');
const { execFile } = require('node:child_process');

const SCRIPT = path.join(__dirname, 'focuslock.ps1');
const POWERSHELL = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
const MODES = ['read', 'stop', 'restore'];

/**
 * mode: 'read', 'stop' (the lock at 0) or 'restore' (the person's own setting back). Answers what Windows said, in
 * milliseconds: { before, after, error }, error being Windows' own number (87: asked by a program not in front) or 0;
 * { failed } when PowerShell gave no answer.
 */
function focusLock(mode) {
  return new Promise((done) => {
    if (!MODES.includes(mode)) { done({ failed: `no such mode: ${mode}` }); return; }
    execFile(POWERSHELL, ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', SCRIPT, '-Mode', mode],
      { windowsHide: true, timeout: 30000 }, (err, out, said) => {
        const line = String(out || '').trim().split(/\r?\n/).pop() || '';
        try {
          const r = JSON.parse(line);
          if ([r.before, r.after, r.error].every(Number.isFinite)) { done({ before: r.before, after: r.after, error: r.error }); return; }
        } catch { /* not the line it prints */ }
        done({ failed: String(said || (err && err.message) || 'no answer').trim().split(/\r?\n/)[0].slice(0, 200) });
      });
  });
}

module.exports = { focusLock };
