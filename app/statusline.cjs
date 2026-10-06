#!/usr/bin/env node
'use strict';
// Lowlit's status line. After each turn of a chat Claude Code runs the status line command and hands it that chat's
// figures as JSON on stdin: its usage limits (Pro and Max plans), its cost, its prompt cache
// (https://code.claude.com/docs/en/statusline). This keeps the last of them where Lowlit reads them,
// %LOCALAPPDATA%\AgentFocus\statusline.json (the Perch widget keeps the same file), and prints one short line under
// the chat's prompt. Nothing leaves the computer. One entry in ~/.claude/settings.json turns it on, its path written
// with forward slashes (Claude Code runs it through Git Bash):
//   "statusLine": { "type": "command", "command": "node C:/path/to/lowlit/app/statusline.cjs" }
// A status line of your own stays: with --pass this prints the JSON it was given, unchanged, for the next command:
//   "command": "node C:/path/to/lowlit/app/statusline.cjs --pass | <your own command>"
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const FILE = path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'AgentFocus', 'statusline.json');
const PASS = process.argv.includes('--pass');

const pause = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

/** The JSON swapped in whole, so Lowlit (which looks twice a second) never reads half of it. */
function keep(text) {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  const part = `${FILE}.${process.pid}.part`;
  fs.writeFileSync(part, text);
  for (let i = 0; i < 5; i++) {
    try { fs.renameSync(part, FILE); return; } catch { pause(20); }
  }
  // still held by a reader: written in place, which Lowlit reads again at its next look if it caught it half done
  try { fs.writeFileSync(FILE, text); } finally { fs.rmSync(part, { force: true }); }
}

function line(told) {
  const parts = [];
  const model = told.model && (told.model.display_name || told.model.id);
  if (model) parts.push(String(model));
  const share = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Math.round(Number(v)));
  const context = share(told.context_window && told.context_window.used_percentage);
  if (context !== null) parts.push(`context ${context}%`);
  const limits = told.rate_limits || {};
  for (const [key, name] of [['five_hour', '5h'], ['seven_day', 'week']]) {
    const used = share(limits[key] && limits[key].used_percentage);
    if (used !== null) parts.push(`${name} ${used}%`);
  }
  return parts.join(' · ');
}

function main() {
  if (process.stdin.isTTY) {
    console.log('Lowlit\'s status line: Claude Code runs it and hands it JSON on stdin. See the comment at the top of this file.');
    return;
  }
  const raw = fs.readFileSync(0, 'utf8');
  let told = null;
  try { told = JSON.parse(raw.replace(/^\uFEFF/, '')); } catch { /* not JSON: nothing to keep */ }
  if (told && typeof told === 'object' && typeof told.session_id === 'string' && told.session_id) {
    try { keep(raw); } catch { /* a status line never fails the chat: the next turn tries again */ }
  }
  process.stdout.write(PASS ? raw : `${told && typeof told === 'object' ? line(told) : ''}\n`);
}

main();
