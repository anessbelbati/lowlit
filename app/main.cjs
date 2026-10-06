'use strict';
// One window for every agent session: real consoles running the real agent
// CLIs, and a dashboard read from the files those CLIs write on disk. The
// window never sees a login and never talks to Anthropic. Only once the person
// switches it on in Settings does it ask Jev, through OpenRouter, two narrow
// questions with their own key (jev.cjs).
const { app, BrowserWindow, Menu, Tray, clipboard, dialog, globalShortcut, ipcMain, nativeImage, nativeTheme, powerMonitor, protocol, safeStorage, screen, shell } = require('electron');
const { Worker } = require('node:worker_threads');
const { spawn } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const HIDDEN = process.env.DESK_HIDDEN === '1';
const SELFTEST_DIR = process.env.DESK_SELFTEST || '';
if (SELFTEST_DIR) {
  // A hidden test run that dies must say so in its report, not in an error box on the screen.
  process.on('uncaughtException', (err) => {
    try {
      fs.mkdirSync(SELFTEST_DIR, { recursive: true });
      fs.appendFileSync(path.join(SELFTEST_DIR, 'report.txt'), `FAIL  crashed: ${err && err.stack ? err.stack : err}\n`);
    } catch {
      // nowhere left to report to
    }
    process.exit(70);
  });
}
// A test copy keeps its own profile so it can never collide with the window in use.
if (process.env.DESK_PROFILE_DIR) app.setPath('userData', process.env.DESK_PROFILE_DIR);
if (SELFTEST_DIR) app.commandLine.appendSwitch('js-flags', '--expose-gc');
// After its graphics process crashes, Chromium keeps a page off the graphics chip until the app starts again: the
// terminals would stay on their slow renderer and Noir's light would never come back. Allowed only before ready.
let gpuUnblocked = false;
try {
  app.disableDomainBlockingFor3DAPIs();
  gpuUnblocked = true;
} catch {
  // an Electron without it: the page still keeps its ground black (noir.js)
}
// a test run drawn as on a screen at another scaling (DESK_SCALE=1.25: 125%)
if (SELFTEST_DIR && Number(process.env.DESK_SCALE) > 0) app.commandLine.appendSwitch('force-device-scale-factor', String(Number(process.env.DESK_SCALE)));
const { Chats } = require('./chats.cjs');
const { Tail } = require('./replay.cjs');
const { repoOf, copyOf, projectName, originOf, inside, sameFolder, statusOf, branchesOf, switchTo } = require('./git.cjs');
const Jev = require('./jev.cjs');
const { hideSecrets } = require('./find.cjs');
const { Servers, scriptsOf } = require('./servers.cjs');
const { Browser, askList, ASK_FIRST } = require('./browser.cjs');
const { Door, register, unregister, PORT: BROWSER_PORT } = require('./browser-mcp.cjs');
const { Keeper } = require('./keeper.cjs');
const { Viewer, SCHEME: VIEWER_SCHEME, EXTENSIONS: VIEWER_EXTENSIONS } = require('./viewer.cjs');
const { Work, takeWork } = require('./work.cjs');

// The Viewer's files reach the window's page by an address of their own (viewer.cjs), streamed in parts as a video
// needs, and readable by the page's canvas: told to Chromium before the app is ready, as it must be.
protocol.registerSchemesAsPrivileged([{ scheme: VIEWER_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } }]);

const windowsBuild = Number(os.release().split('.')[2]) || 0;
// DESK_CONSOLE=inbox picks the console engine built into Windows instead of the one shipped with the app.
const ENGINE = process.env.DESK_CONSOLE === 'inbox' ? 'inbox' : 'bundled';
const SESSIONS_DIR = path.join(os.homedir(), '.claude', 'sessions');
const JOBS_DIR = path.join(os.homedir(), '.claude', 'jobs');
const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const JOB_ID = /^[0-9a-f]{6,40}$/i;
const APP_ID = 'Lowlit.App';
const ICON = path.join(__dirname, '..', 'assets', 'icon.ico');
const LAUNCHER = path.join(__dirname, 'Lowlit.vbs');
const WSCRIPT = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'wscript.exe');
const OLD_MS = 3 * 86400e3;
const RANGES = ['today', '7d', '30d'];
const ACCOUNT_KEY = /^[0-9a-f]{8}$/;
// the colour of the top of the page: the window buttons Windows draws sit on it, and it shows before the page has loaded
const BASE = '#0a0a0b';
// The Nest: the chat that works in the person's record, a key away from any program. Ctrl with Alt is left alone, as
// in the window: on many keyboards that is how @ # { [ are typed.
const NEST_KEY = 'CommandOrControl+Shift+Space';
const NEST_FLAG = '--nest';

let win = null;
let tray = null;
let worker = null;
let finder = null;
let quitting = false;
let latest = { at: 0, chats: [], ended: [], leaving: [], plan: null, accounts: null }; // the watcher's newest picture
let latestRes = null;                       // and what the programs under the sessions use, as last measured
const took = [];                            // how long its last looks took, in ms
const watcherErrors = [];                   // what it reported as going wrong, newest last (a handful kept)
const asks = new Map();                     // questions put to the watcher, waiting for their answer
let askSeq = 0;
const lastState = new Map();                // session -> its state at the last look
let pageCalls = -1;                         // the waits the window counts as calling for the person; -1 until it says
const limitNoted = new Set();               // usage windows, per account, a "nearly used up" note already went out for
const diskNoted = new Set();                // drive and day a "nearly full" note already went out for
const MB = 1048576;
const sizeWords = (n) => (n >= 1024 * MB ? `${(n / (1024 * MB)).toFixed(1)} GB` : `${Math.round(n / MB)} MB`);
const PLAN_NAMES = { five: '5-hour limit', week: 'weekly limit' };
let resetTimer = null;                       // the next known reset, even while the watcher has no changed picture
let resetAfter = 0;                         // let the previous note finish before another account reset is shown
let resetWaiting = [];                     // expired readings waiting their turn, even if the next picture replaces them
const RESET_NOTE_GAP = 10000;
const NEARLY = 90;                          // percent of a usage limit at which a note goes out, once per window
// what closing the window with chats in it does: 'ask', 'always' (keep them for next time), 'never' (start fresh), 'tray' (hide by the clock)
const CLOSE_CHOICES = ['ask', 'always', 'never', 'tray', 'gaming'];
// permission modes Claude Code takes on its command line, besides bypassing them ("default" needs no word)
const MODES = ['acceptEdits', 'auto', 'manual', 'dontAsk', 'plan'];
// how many chats can share the screen
const TILES = [1, 2, 4];
const LOOKS = ['noir', 'grey'];
const NEST_LOOKS = ['lamp', 'night', 'plain'];
// where the cards show: this window's own, and the notes over the other programs (his word, 6 Oct morning: "top right
// not top left"). A 'left' or 'right' kept from the hours before, when the top left was the default and was saved with
// the rest, is no choice of his: it gives way to the default
const CORNERS = ['top-right', 'top-left'];
// the model and the thinking a Claude Code chat can be started with (--model, --effort); '' leaves it to Claude Code
const MODELS = ['opus', 'sonnet', 'fable'];
const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];
const CLAUDE_FIRST = { model: '', effort: 'max', spaces: {} };
let settings = {
  starter: '', open: [], trayNoted: false, bounds: null, maximized: false, keepChats: 'ask',
  // the person kept their things at the last close: the servers that ran then and are gone now start again
  serversBack: true,
  // the notes at the top of the screen (cards: false, none at all): when a chat wants the person, for the chats
  // of this window and for sessions in other terminals, when a chat of this window finishes, when a usage limit is
  // nearly used up or resets, when a drive is nearly full, and when a shift's time is up. corner: where they and the
  // window's own cards show, 'top-right' or 'top-left'
  notify: { cards: true, here: true, elsewhere: false, finished: false, nest: true, limit: true, resets: true, disk: true, shift: true, corner: 'top-right' },
  resetNoted: [],
  fontSize: 16,
  inspector: false,
  // how many chats share the screen (1, 2 or 4), and how many when it was last more than one
  tiles: 2,
  split: 2,
  // the window is opened see-through, with the desktop blurred behind its sidebar and title bar; true switches that off
  solid: false,
  // 'noir': black, with the light of a lamp past the top left corner drawn in fine dots; 'grey': the look before it.
  // A 'black' kept from before becomes 'noir'
  look: 'noir',
  // the light of the Noir look drifts while the window is in front; false: it stands still
  motion: true,
  // what the person calls their accounts: account -> name
  accountNames: {},
  // the workspaces: [{ id, name, folders, color, sessions }]. A chat belongs to the workspace that lists its folder, or a
  // folder above it, and to every workspace that lists its session
  spaces: [],
  // the workspace in front; '' shows every chat. also: the others shown next to it
  space: '',
  also: [],
  // sessions pinned on top of the list, and inside their workspace
  pins: { top: [], space: [] },
  record: { folder: '' },
  // the Nest's key works from any program (NEST_KEY); false: only in this window
  nestKey: true,
  // the Nest's own mood while it is open: 'lamp' (warm), 'night' (cool and calm) or 'plain' (the look of the rest)
  nestLook: 'lamp',
  // the Browser: offered to the chats (in Claude Code's own list of tools) unless switched off; the panel opens by
  // itself when a chat opens a page; the port its door answers on, and the key Claude Code is given for it; the sites
  // a chat opens only on the person's yes (browser.cjs ASK_FIRST)
  browser: { on: false, popOpen: false, port: 0, token: '', ask: ASK_FIRST.slice() },
  // the floating card over every other program: switched on, small, also over this window, and where it was put
  float: { on: false, small: false, overDesk: false, x: null, y: null },
  // the shift clock in the title bar and the record of the day (work.cjs): on, ActivityWatch read, the usual shifts
  work: takeWork(undefined),
  // what every Claude Code chat is started with, and a workspace's own: { [space id]: { model, effort } }, where ''
  // is the same as for every chat. Claude Code keeps no thinking above xhigh for the next session by itself
  claude: CLAUDE_FIRST,
};
let glassOn = false;                        // the window was opened see-through this time
let nestKeyState = 'off';                   // the Nest's key from any program: 'on', 'off' (switched off, or a hidden test window), 'taken' (by another program)
let summoned = null;                        // how the window was before the Nest's key brought it up: { hidden, minimized }
let nestAsked = false;                      // the Nest was asked for before the page was up (a start or a second launch with --nest)
let previous = [];                          // the chats that were open when the app last quit, or went down
let front = '';                             // the chat in front in the window, as the page last said
let ending = false;                         // Windows is shutting down or signing out: no questions, the chats are kept
let endTimer = null;                        // ... unless it turns out not to: then this takes that back
let restore = '';                           // what becomes of `previous` at this start: 'auto' (they open), 'crash' (the same, after a crash), 'ask', or ''
let restoring = false;                      // they are being opened again right now: the list kept on disk is left alone until they all are
let restoreUntil = 0;                       // ... or until this moment, should the page never say it is done
let starters = [];
let browser = null;                         // the pages the chats drive, laid over the window (browser.cjs)
let door = null;                            // Claude Code's way in to them, on this computer only (browser-mcp.cjs)
let viewer = null;                          // the pictures, videos and sounds shown beside the chats (viewer.cjs)
let work = null;                            // the shift running and the record of the day (work.cjs)
let browserTimer = null;
let keeper = null;                          // the program that holds the consoles through a restart (keeper.cjs)
let keeperReady = Promise.resolve();        // ... and the consoles it held for this window, taken up again
let adoption = null;                        // what the page is told of those: { n, how }
let gamedNote = null;                       // back from gaming mode, said once: { chats, servers: names, lost: names }
const tails = new Map();                    // chat -> what its console printed lately, for a page that starts over
// The page has asked what there is: from then on it is told what changes. A page that is loading, or gone, is told
// nothing, so nothing older than what it asked for can reach it after its answer.
let pageUp = false;

const isDir = (p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };
const leaf = (p) => String(p || '').split(/[\\/]/).filter(Boolean).pop() || '';
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const send = (channel, ...args) => { if (pageUp && win && !win.isDestroyed() && !win.webContents.isDestroyed() && !win.webContents.isCrashed()) win.webContents.send(channel, ...args); };
const logFile = () => path.join(app.getPath('userData'), 'desk.log');
function log(text) {
  try {
    if (fs.existsSync(logFile()) && fs.statSync(logFile()).size > 1024 * 1024) fs.writeFileSync(logFile(), '');
    fs.appendFileSync(logFile(), `${new Date().toISOString()} ${text}\n`);
  } catch {
    // a log that cannot be written is not worth stopping for
  }
}

// ---- what is kept between runs ----
const settingsFile = () => path.join(app.getPath('userData'), 'desk.json');
let saveTimer = null;
/** Takes the names given to accounts from `from` into `into`: an empty name takes the old one away. */
function takeNames(into, from) {
  if (!from || typeof from !== 'object') return into;
  for (const [key, value] of Object.entries(from)) {
    if (!ACCOUNT_KEY.test(key) || typeof value !== 'string') continue;
    const name = value.replace(/\s+/g, ' ').trim().slice(0, 40);
    if (name) into[key] = name; else delete into[key];
  }
  return into;
}
const SPACE_ID = /^w[0-9a-z]{1,12}$/;
const SPACES_MAX = 12;
const SPACE_FOLDERS_MAX = 200;
const SPACE_COLORS = ['rose', 'olive', 'mint', 'teal', 'sky', 'indigo', 'purple'];
const takeKeys = (list, max) => [...new Set((Array.isArray(list) ? list : []).filter((key) => typeof key === 'string' && READ_KEY.test(key)))].slice(-max);
const takePins = (pins) => ({ top: takeKeys(pins && pins.top, 40), space: takeKeys(pins && pins.space, 40) });
function takeAlso(list, spaces, space) {
  if (!space) return [];
  const ids = new Set(spaces.map((s) => s.id));
  return [...new Set((Array.isArray(list) ? list : []).filter((id) => typeof id === 'string' && id !== space && ids.has(id)))].slice(0, 11);
}
/**
 * The workspaces as they were handed over, made fit to keep: ids of one fixed shape, a short name each, and
 * folders that are whole paths on this machine, each in one workspace only (the first that lists it). Nothing
 * here is ever run or opened: a folder is only compared with the folder a chat works in. null: not a list.
 */
function takeSpaces(list) {
  if (!Array.isArray(list)) return null;
  const out = [];
  const ids = new Set();
  const taken = new Set();
  for (const s of list) {
    if (out.length >= SPACES_MAX) break;
    if (!s || typeof s !== 'object' || typeof s.id !== 'string' || !SPACE_ID.test(s.id) || ids.has(s.id)) continue;
    const name = typeof s.name === 'string' ? s.name.replace(/\s+/g, ' ').trim().slice(0, 24) : '';
    if (!name) continue;
    const folders = [];
    for (const f of Array.isArray(s.folders) ? s.folders : []) {
      if (folders.length >= SPACE_FOLDERS_MAX) break;
      if (typeof f !== 'string' || !f || f.length > 260 || !path.win32.isAbsolute(f)) continue;
      const whole = path.win32.normalize(f);
      const root = path.win32.parse(whole).root;
      // a drive or a share by name: "\folder" alone says nothing about where it is
      if (root.length < 3) continue;
      const tidy = whole.length > root.length ? whole.replace(/\\+$/, '') : root;
      if (taken.has(tidy.toLowerCase())) continue;
      taken.add(tidy.toLowerCase());
      folders.push(tidy);
    }
    ids.add(s.id);
    out.push({ id: s.id, name, folders, color: SPACE_COLORS.includes(s.color) ? s.color : '', sessions: takeKeys(s.sessions, 200) });
  }
  return out;
}
/**
 * What a Claude Code chat is started with, made fit to keep: words from the two fixed lists or '' only, and a choice
 * of its own only for a workspace that exists. was: what there was, for whatever `c` leaves out.
 */
function takeClaude(c, was, spaces) {
  const from = c && typeof c === 'object' ? c : {};
  const pick = (v, list, old) => (v === '' || list.includes(v) ? v : old);
  const out = { model: pick(from.model, MODELS, was.model), effort: pick(from.effort, EFFORTS, was.effort), spaces: {} };
  const given = from.spaces && typeof from.spaces === 'object' ? from.spaces : {};
  for (const { id } of spaces) {
    const old = Object.hasOwn(was.spaces, id) ? was.spaces[id] : { model: '', effort: '' };
    const v = Object.hasOwn(given, id) && given[id] && typeof given[id] === 'object' ? given[id] : {};
    const own = { model: pick(v.model, MODELS, old.model), effort: pick(v.effort, EFFORTS, old.effort) };
    if (own.model || own.effort) out.spaces[id] = own;
  }
  return out;
}
function loadSettings() {
  let kept = {};
  try { kept = JSON.parse(fs.readFileSync(settingsFile(), 'utf8')) || {}; } catch { /* first run */ }
  settings = { ...settings, ...kept, notify: { ...settings.notify, ...(kept.notify && typeof kept.notify === 'object' ? kept.notify : {}) } };
  if (!CORNERS.includes(settings.notify.corner)) settings.notify.corner = 'top-right';
  if (!Array.isArray(settings.open)) settings.open = [];
  settings.fontSize = clamp(Math.round(Number(settings.fontSize)) || 16, 10, 26);
  settings.inspector = Boolean(settings.inspector);
  if (!TILES.includes(settings.tiles)) settings.tiles = 2;
  if (settings.split !== 4) settings.split = 2;
  settings.solid = Boolean(kept.solid);
  if (!LOOKS.includes(settings.look)) settings.look = 'noir';
  settings.motion = kept.motion !== false;
  if (!CLOSE_CHOICES.includes(settings.keepChats)) settings.keepChats = 'ask';
  settings.serversBack = settings.serversBack !== false;
  // what the third version kept its own see-through switch in
  delete settings.glass;
  settings.accountNames = takeNames({}, kept.accountNames);
  settings.resetNoted = takeResetNotes(kept.resetNoted);
  settings.spaces = takeSpaces(kept.spaces) || [];
  if (!settings.spaces.some((s) => s.id === settings.space)) settings.space = '';
  settings.also = takeAlso(kept.also, settings.spaces, settings.space);
  settings.pins = takePins(kept.pins);
  settings.claude = takeClaude(kept.claude, CLAUDE_FIRST, settings.spaces);
  settings.record = { folder: SELFTEST_DIR ? '' : kept.record && typeof kept.record.folder === 'string' ? recordFolder(kept.record.folder) : '' };
  settings.nestKey = kept.nestKey !== false;
  settings.nestLook = NEST_LOOKS.includes(kept.nestLook) ? kept.nestLook : 'lamp';
  const b = kept.browser && typeof kept.browser === 'object' ? kept.browser : {};
  settings.browser = {
    on: b.on === true,
    popOpen: b.popOpen === true,
    port: Number.isInteger(b.port) && b.port > 1024 && b.port < 65536 ? b.port : BROWSER_PORT,
    token: typeof b.token === 'string' && /^[0-9a-f]{48}$/.test(b.token) ? b.token : crypto.randomBytes(24).toString('hex'),
    ask: askList(b.ask) || ASK_FIRST.slice(),
  };
  const f = kept.float && typeof kept.float === 'object' ? kept.float : {};
  settings.float = { on: f.on === true, small: f.small === true, overDesk: f.overDesk === true,
    x: Number.isFinite(f.x) ? f.x : null, y: Number.isFinite(f.y) ? f.y : null };
  settings.work = takeWork(kept.work);
}
function writeSettings() {
  clearTimeout(saveTimer);
  saveTimer = null;
  try {
    fs.mkdirSync(path.dirname(settingsFile()), { recursive: true });
    fs.writeFileSync(settingsFile() + '.tmp', JSON.stringify(settings, null, 1));
    fs.renameSync(settingsFile() + '.tmp', settingsFile());
  } catch (err) {
    log(`settings not saved: ${err.message}`);
  }
}
const saveSettings = () => { if (!saveTimer) saveTimer = setTimeout(writeSettings, 400); };

// ---- files named by a console ----
/** A file's whole name, checked without opening it. Relative names need the chat's folder. */
function filePath(file, cwd) {
  if (typeof file !== 'string' || !file || file.length > 520 || file.includes('\0')) return '';
  if (/^[\\/]/.test(file) || (/^[A-Za-z]:/.test(file) && !/^[A-Za-z]:[\\/]/.test(file))) return '';
  if (!path.win32.isAbsolute(file) && (typeof cwd !== 'string' || !cwd)) return '';
  try {
    const whole = path.win32.isAbsolute(file) ? path.win32.normalize(file) : path.win32.resolve(cwd, file);
    return fs.statSync(whole).isFile() ? whole : '';
  } catch { return ''; }
}
function pathFiles(files, cwd) {
  if (!Array.isArray(files)) return [];
  if (files.length > 20) return Array(files.length).fill(false);
  return Array.from(files, (file) => Boolean(filePath(file, cwd)));
}
function findEditor(searchPath = process.env.PATH || '') {
  const dirs = searchPath.split(';').map((dir) => dir.trim().replace(/^"|"$/g, '')).filter(Boolean);
  for (const [launcher, program] of [['cursor.cmd', 'Cursor.exe'], ['code.cmd', 'Code.exe'], ['windsurf.cmd', 'Windsurf.exe']]) {
    for (const dir of dirs) {
      try {
        const exe = path.resolve(dir, '..', program);
        if (fs.statSync(path.join(dir, launcher)).isFile() && fs.statSync(exe).isFile()) return exe;
      } catch { /* not installed in this folder */ }
    }
  }
  return '';
}
function editorArgs(file, line, column) {
  const place = (n) => Number.isInteger(n) && n > 0 && n <= 9999999;
  return ['--goto', place(line) ? file + ':' + line + ':' + (place(column) ? column : 1) : file];
}
let editorExe = '';
let editorNoted = false;
let editorOverride = false;
const fileStarts = [];
function chatFolder(id) {
  if (typeof id !== 'string') return '';
  const session = sessionIn(id);
  const chat = chats.all.get(id);
  return session && session.cwd || chat && chat.cwd || '';
}
function openChatFile(id, name, line, column) {
  const file = filePath(name, chatFolder(id));
  if (!file) return { opened: false };
  if (!editorExe && !editorOverride) editorExe = findEditor();
  if (!editorExe) {
    try {
      if (HIDDEN) fileStarts.push({ folder: file }); else shell.showItemInFolder(file);
      const notice = editorNoted ? '' : 'No code editor was found (Cursor, VS Code, Windsurf): the file is shown in its folder instead.';
      editorNoted = true;
      return { opened: true, shown: true, notice };
    } catch { return { opened: false }; }
  }
  const args = editorArgs(file, line, column);
  if (HIDDEN) { fileStarts.push({ exe: editorExe, args }); return { opened: true, shown: false, notice: '' }; }
  // The launcher is only a signpost: a terminal's file name never passes through a shell.
  return new Promise((done) => {
    try {
      const child = spawn(editorExe, args, { detached: true, stdio: 'ignore' });
      child.once('error', () => { editorExe = ''; done({ opened: false }); });
      child.once('spawn', () => { child.unref(); done({ opened: true, shown: false, notice: '' }); });
    } catch { editorExe = ''; done({ opened: false }); }
  });
}

// ---- the ways a chat can be started ----
const onPath = (name) => (process.env.PATH || '').split(';').some((dir) => dir && ['.exe', '.cmd', '.ps1', '.bat']
  .some((ext) => { try { return fs.statSync(path.join(dir, name + ext)).isFile(); } catch { return false; } }));

function findStarters() {
  const list = [{ id: 'claude', name: 'Claude Code', command: 'claude', agent: 'claude', passes: true }];
  // A function in the PowerShell profile that starts the CLI with the person's own flags is how they start chats.
  try {
    const profile = fs.readFileSync(path.join(app.getPath('documents'), 'WindowsPowerShell', 'Microsoft.PowerShell_profile.ps1'), 'utf8');
    for (const m of profile.matchAll(/^[ \t]*function[ \t]+([A-Za-z][\w-]*)[ \t]*\{([^}]*)\}/gm)) {
      // passes: it hands extra words on to claude, so a flag added after its name reaches the CLI
      if (/(^|[\s;&|(])claude(\s|$)/m.test(m[2])) list.push({ id: m[1], name: m[1], command: m[1], agent: 'claude', passes: /[$@]args\b/i.test(m[2]) });
    }
  } catch {
    // no profile: the plain command is all there is
  }
  if (onPath('codex')) list.push({ id: 'codex', name: 'Codex', command: 'codex', agent: 'codex' });
  list.push({ id: 'shell', name: 'PowerShell', command: '', agent: '' });
  return list;
}
/** The person's own function when there is one, until they pick something else. */
const claudeStarter = () => starters.find((s) => s.id === settings.starter && s.agent === 'claude')
  || starters.find((s) => s.agent === 'claude' && s.id !== 'claude') || starters[0];
const defaultStarter = () => starters.find((s) => s.id === settings.starter) || claudeStarter();

/**
 * When the newest Claude Code session that may be running in a chat started.
 * Read straight from the CLI's own files: the watcher's picture is a couple of seconds old.
 */
function newestStart(chatId) {
  const where = new Map(latest.chats.map((c) => [c.session, c.chat]));
  let newest = 0;
  let names = [];
  try { names = fs.readdirSync(SESSIONS_DIR); } catch { return 0; }
  for (const name of names) {
    if (!/^\d+\.json$/.test(name)) continue;
    try {
      const rec = JSON.parse(fs.readFileSync(path.join(SESSIONS_DIR, name), 'utf8'));
      const chat = where.get(rec.sessionId);
      // one traced to another chat of this window is that chat's concern; one not traced yet may be this chat's
      if (chat && chat !== chatId) continue;
      process.kill(Number(name.slice(0, -5)), 0);
      newest = Math.max(newest, Number(rec.startedAt) || 0);
    } catch {
      // gone, or mid-write
    }
  }
  return newest;
}

/** Whether a conversation runs right now in some program on this machine, read straight from the CLI's own files. */
function runningNow(sessionId) {
  let names = [];
  try { names = fs.readdirSync(SESSIONS_DIR); } catch { return false; }
  for (const name of names) {
    if (!/^\d+\.json$/.test(name)) continue;
    try {
      if (JSON.parse(fs.readFileSync(path.join(SESSIONS_DIR, name), 'utf8')).sessionId !== sessionId) continue;
      process.kill(Number(name.slice(0, -5)), 0);
      return true;
    } catch (err) {
      if (err && err.code === 'EPERM') return true;
    }
  }
  return false;
}

/**
 * Whether a background session is still there to look at, read straight from the CLI's own files: its job is on
 * disk and has not ended (done or stopped, unless it waits for the person), or a program of it still runs. Only its
 * state and tempo are read.
 */
function jobLives(id, jobsDir = JOBS_DIR, sessionsDir = SESSIONS_DIR) {
  let job = null;
  try { job = JSON.parse(fs.readFileSync(path.join(jobsDir, id, 'state.json'), 'utf8')); } catch { return false; }
  if (!((job.state === 'done' || job.state === 'stopped') && job.tempo !== 'blocked')) return true;
  let names = [];
  try { names = fs.readdirSync(sessionsDir); } catch { return false; }
  for (const name of names) {
    if (!/^\d+\.json$/.test(name)) continue;
    try {
      if (JSON.parse(fs.readFileSync(path.join(sessionsDir, name), 'utf8')).jobId !== id) continue;
      process.kill(Number(name.slice(0, -5)), 0);
      return true;
    } catch (err) {
      if (err && err.code === 'EPERM') return true;
    }
  }
  return false;
}

const chats = new Chats({
  engine: ENGINE,
  newestStart,
  onOutput: (id, data) => {
    // what a console printed in its last moment, after its end was taken in, belongs to no chat any more
    if (!chats.all.has(id)) return;
    let tail = tails.get(id);
    if (!tail) tails.set(id, tail = new Tail());
    tail.append(data);
    send('desk:output', id, data, tail.seq);
  },
  onExit: (id, code) => { tails.delete(id); send('desk:exit', id, code); },
  onChange: () => {
    send('desk:chats', chats.list());
    tellWatcher();
    saveOpen();
  },
});

/** Which console, and which background session, belongs to which chat: how the watcher ties what it finds on disk to the chats here. */
function tellWatcher() {
  // the keeper's number: what it takes is the app's own, though after a restart it no longer runs under the app
  if (worker) worker.postMessage({ type: 'shells', pairs: chats.shells(), jobs: chats.jobs(), folders: chats.list().map(({ id, cwd }) => [id, cwd]), keeper: (keeper && keeper.pid) || 0 });
}

/** The Claude Code session running in a chat of this window, as the watcher last saw it. */
const sessionIn = (chatId) => latest.chats
  .filter((c) => c.chat === chatId && c.provider === 'claude' && c.session)
  .sort((a, b) => b.at - a.at)[0];

/**
 * What is kept of one open chat, to bring it back next time. c: the chat. s: the session the watcher sees in it,
 * if any. inFront: it is the chat in front in the window.
 */
function keptOf(c, s, inFront) {
  // the view of a background session comes back as a view of that session, while the session is still there
  if (c.job) return { cwd: c.cwd, job: c.job, title: c.title || '', named: false, front: Boolean(inFront), id: c.id };
  // its agent was left with /exit and none was started since: a plain shell is what is open, and that is what comes back
  const left = !s && c.left;
  // A session nothing was ever asked of has no transcript, so there is nothing to pick up: it is started afresh.
  // A chat opened to pick a conversation up holds that conversation until its session shows something newer:
  // the watcher sees a session a few seconds after its program starts, and the app can go down before that.
  const live = s && s.turn ? s.session : '';
  const resume = live || (left ? '' : c.holds || '');
  return {
    cwd: c.cwd, starter: left ? 'shell' : c.starter,
    // the name the person gave it; otherwise the one it went by, for saying what came back
    title: c.title || (s ? s.title || s.name || '' : ''), named: Boolean(c.named),
    resume, mode: live ? s.mode || '' : resume ? c.mode || '' : '', front: Boolean(inFront),
    // its console, should the keeper still hold it at the next start: then it is taken up, not opened again
    id: c.id,
  };
}

/**
 * What is brought back next time: every chat open now, kept as it changes, so a crash, a forced close or a
 * machine that goes down loses nothing. Each with its folder, how it was started, the name the person gave it,
 * the conversation in it and the permission mode that conversation was in.
 */
function saveOpen() {
  if (quitting) return;
  // Last time's chats are still being opened again, one after the other: the list on disk stays whole until they
  // all are, so an end in the middle of it loses none of them.
  if (restoring && Date.now() < restoreUntil) return;
  restoring = false;
  const now = chats.list().filter((c) => !c.closing && !c.pendingClose).map((c) => keptOf(c, sessionIn(c.id), c.id === front));
  // nothing open, and last time's chats neither reopened nor dismissed: they stay on offer
  if (!now.length && previous.length) return;
  if (JSON.stringify(now) === JSON.stringify(settings.open)) return;
  settings.open = now;
  saveSettings();
}

/**
 * The words that start a Claude Code chat in this folder on the model and the thinking picked in Settings: those of
 * the workspace it is in (the one that lists the deepest folder around it), else those for every chat. Only words from
 * the fixed lists come back.
 */
function claudeFlags(cwd) {
  const key = (p) => String(p || '').replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase();
  const at = key(cwd);
  let space = '';
  let depth = -1;
  if (at) {
    for (const s of settings.spaces) {
      for (const f of s.folders) {
        const k = key(f);
        if (k.length > depth && (at === k || at.startsWith(`${k}\\`))) { space = s.id; depth = k.length; }
      }
    }
  }
  const own = space && Object.hasOwn(settings.claude.spaces, space) ? settings.claude.spaces[space] : null;
  const model = (own && own.model) || settings.claude.model;
  const effort = (own && own.effort) || settings.claude.effort;
  return `${model ? ` --model ${model}` : ''}${effort ? ` --effort ${effort}` : ''}`;
}

/**
 * How a chat that is asked for gets started: the starter it goes through, the command typed into its shell, the
 * background session it is the view of, the conversation it picks up and the permission mode that was in.
 * Nothing is started here. Only ids of a fixed shape and words from a fixed list ever reach the command line.
 */
function planChat(ask) {
  const starter = starters.find((s) => s.id === ask.starter) || defaultStarter();
  if (ask.worktree !== undefined && typeof ask.worktree !== 'boolean') return { error: 'The folder copy choice must be on or off.' };
  if (ask.worktree === true && (starter.agent !== 'claude' || ask.resume || ask.attach || ask.restore === true || !repoOf(ask.cwd))) {
    return { error: 'A copy of its own needs a new Claude Code chat in a folder that is in git.' };
  }
  if (ask.worktree === true && !starter.passes) {
    return { error: `${starter.name} does not hand extra words on to claude, so it cannot ask for a copy of its own. Start this one with Claude Code.` };
  }
  if (typeof ask.attach === 'string' && JOB_ID.test(ask.attach)) {
    // last time's view of a background session that has ended since: nothing to look at, and the list says it ended
    if (ask.restore === true && !jobLives(ask.attach)) return { error: 'Its background session has ended.', gone: true };
    // the view of a background session: the plain CLI, whatever chats are usually started with
    return { starter, via: starters[0], command: `claude attach ${ask.attach}`, job: ask.attach, holds: '', mode: '' };
  }
  if (typeof ask.resume === 'string' && SESSION_ID.test(ask.resume)) {
    // one of last time's chats whose conversation was picked up meanwhile in another program: opened here too, it would run twice
    if (ask.restore === true && runningNow(ask.resume)) return { error: 'Its conversation already runs in another program.', elsewhere: true };
    const via = starter.agent === 'claude' ? starter : claudeStarter();
    const mode = ask.mode === 'bypassPermissions' || MODES.includes(ask.mode) ? ask.mode : '';
    // The plain command starts in the default permission mode: the conversation is put back in the one it was in.
    // The person's own starter sets the mode itself (theirs bypasses permissions) and is left to: a second mode on
    // the same line would fight it.
    const flags = via.id !== 'claude' || !mode ? '' : mode === 'bypassPermissions' ? ' --dangerously-skip-permissions' : ` --permission-mode ${mode}`;
    // without them a conversation picked up again thinks at Claude Code's own level, which is never max
    const tune = via.passes ? claudeFlags(ask.cwd) : '';
    return { starter, via, command: `${via.command} --resume ${ask.resume}${flags}${tune}`, job: '', holds: ask.resume, mode };
  }
  const flags = ask.worktree === true ? ' --worktree' : '';
  const tune = starter.agent === 'claude' && starter.passes ? claudeFlags(ask.cwd) : '';
  return { starter, via: starter, command: starter.command + flags + tune, job: '', holds: '', mode: '' };
}

function createChat(ask) {
  if (!ask || typeof ask !== 'object') return { error: 'Nothing to start.' };
  if (typeof ask.cwd !== 'string' || !isDir(ask.cwd)) return { error: 'That folder no longer exists.' };
  const p = planChat(ask);
  if (p.error) {
    if ((p.elsewhere || p.gone) && Number.isInteger(ask.order)) previous = previous.filter((c) => c.order !== ask.order);
    return p;
  }
  // What the person picks for a new chat is what the next new chat starts with. A chat that comes back from last
  // time, or that picks a conversation up, changes nothing about that.
  if (!p.job && !p.holds && ask.restore !== true && ask.starter && p.starter.id === ask.starter && settings.starter !== p.starter.id) {
    settings.starter = p.starter.id;
    saveSettings();
  }
  const title = typeof ask.title === 'string' ? ask.title.replace(/\s+/g, ' ').trim().slice(0, 120) : '';
  const chat = chats.create({ cwd: ask.cwd, command: p.command, starter: p.via.id, title, named: ask.named === true && Boolean(title), job: p.job, holds: p.holds, mode: p.mode });
  // one of last time's chats is back: a page that starts over meanwhile goes on with the ones still to come
  if (ask.restore === true && Number.isInteger(ask.order)) previous = previous.filter((c) => c.order !== ask.order);
  return chats.list().find((c) => c.id === chat.id);
}

// ---- the watcher thread ----
let restarts = 0;
let watcherSince = 0;
function startWatcher() {
  watcherSince = Date.now();
  const thread = new Worker(path.join(__dirname, 'watch.cjs'), {
    workerData: {
      home: os.homedir(),
      localAppData: process.env.LOCALAPPDATA || '',
      cacheFile: path.join(app.getPath('userData'), 'tally.jsonl'),
      endedFile: path.join(app.getPath('userData'), 'ended.json'),
      accountsFile: path.join(app.getPath('userData'), 'accounts.json'),
      // a test run walks no transcripts unless it asks to
      counting: !SELFTEST_DIR,
      // what the programs under the sessions use, through a small helper program
      measure: true,
      // where Claude Code keeps a chat's working files: the folder Windows stores for it (chats started before it
      // was set keep theirs in the usual temp folder), as every chat here gets it (chats.cjs sessionEnv)
      // A test run measures none of it: the real drives would put their warning on its page mid-check, and its own
      // phase brings made-up folders and drives.
      disk: SELFTEST_DIR ? { tempRoots: [], drives: false }
        : { tempRoots: [chats.env && chats.env.CLAUDE_CODE_TMPDIR, process.env.CLAUDE_CODE_TMPDIR, os.tmpdir()] },
    },
    // It reads megabytes of JSON a second and keeps almost none of it: a small heap is cleaned sooner.
    resourceLimits: { maxOldGenerationSizeMb: 160, maxYoungGenerationSizeMb: 8 },
  });
  worker = thread;
  thread.on('message', (m) => {
    if (m.type === 'snapshot') {
      took.push(m.tookMs);
      if (took.length > 50) took.shift();
      track(m.data);
      send('desk:snapshot', m.data);
    } else if (m.type === 'res') {
      latestRes = m.data;
      send('desk:res', m.data);
    } else if (m.type === 'answer') {
      const done = asks.get(m.ask);
      asks.delete(m.ask);
      if (done) done(m.data);
    } else if (m.type === 'error') {
      log(`watcher: ${m.message}`);
      watcherErrors.push(String(m.message));
      if (watcherErrors.length > 20) watcherErrors.shift();
    }
  });
  thread.on('error', (err) => log(`watcher stopped: ${err && err.stack ? err.stack : err}`));
  thread.on('exit', (code) => {
    if (worker !== thread) return;
    worker = null;
    if (quitting || code === 0) return;
    // one that ran a good while before it stopped starts again with a clean slate
    if (Date.now() - watcherSince > 10 * 60e3) restarts = 0;
    // without it the dashboard goes stale: bring it back, a few times at most, and say so when that fails
    if (++restarts > 3) {
      log(`watcher ended with code ${code} ${restarts} times in a row; left stopped`);
      send('desk:command', 'stale');
      return;
    }
    log(`watcher ended with code ${code}; starting it again`);
    setTimeout(() => { if (!quitting && !worker) { startWatcher(); presence(); } }, 2000);
  });
  tellWatcher();
}

/** The person asks for the watcher back, after it was left stopped. */
function watchAgain() {
  if (worker || quitting) return;
  restarts = 0;
  startWatcher();
  presence();
}

/** Stops the watcher once it has saved what it counted; one that has not ended within 4 s is ended. */
function stopWatcher() {
  const thread = worker;
  if (!thread) return Promise.resolve();
  // from here its end is expected: the watch over its exit leaves it alone
  worker = null;
  for (const done of asks.values()) done(null);
  asks.clear();
  return new Promise((resolve) => {
    const late = setTimeout(() => { log('the watcher did not stop within 4 s; ended'); thread.terminate(); }, 4000);
    thread.once('exit', () => { clearTimeout(late); resolve(); });
    thread.postMessage({ type: 'stop' });
  });
}

/** Puts a question to the watcher; null when it does not answer. */
function askWatcher(type, more, timeout = 15000) {
  return new Promise((resolve) => {
    if (!worker) { resolve(null); return; }
    const ask = ++askSeq;
    asks.set(ask, resolve);
    try { worker.postMessage({ ...more, type, ask }); } catch { asks.delete(ask); resolve(null); return; }
    setTimeout(() => { if (asks.delete(ask)) resolve(null); }, timeout);
  });
}

// ---- the servers the person pins (servers.cjs): looked at every 3 s while their page is in sight, every 20 s otherwise ----
let servers = null;
let serversWatched = false;
let serversTimer = null;
let serversAsked = '';           // a test run: what the question before ending a program said
function serversTick() {
  clearTimeout(serversTimer);
  serversTimer = null;
  if (!servers || quitting) return;
  const seen = win && !win.isDestroyed() && win.isVisible() && !win.isMinimized();
  const next = () => { if (!quitting) serversTimer = setTimeout(serversTick, serversWatched && seen ? 3000 : 20000); };
  // nothing pinned and nothing started: only the page, while it is open, has anything to show
  if (!serversWatched && !servers.busy) { next(); return; }
  servers.look().catch(() => {}).finally(next);
}
/** What a server starts with: what a chat gets (chats.cjs), less what only a chat's own console is for. */
function serverEnv() {
  const env = { ...(chats.env || process.env) };
  for (const name of Object.keys(env)) if (/^DESK_/i.test(name)) delete env[name];
  delete env.AGENTFOCUS_HOST;
  delete env.CLAUDE_CODE_FORCE_SYNC_OUTPUT;
  // Python holds back what it prints while that goes to a file
  env.PYTHONUNBUFFERED = '1';
  return env;
}
/** Asked before a program this app did not start is ended: which program, on which ports, in which folder. */
async function confirmStop(info) {
  const what = `${info.label && info.label !== info.name ? `${info.name} (${info.label})` : info.name}${info.ports.length ? ` on port ${info.ports.join(', ')}` : ''}${info.folder ? `, in ${info.folder}` : ''}`;
  const detail = `Lowlit did not start it.${info.programs > 1 ? ` The ${info.programs} programs it is made of stop with it.` : ''}`;
  if (HIDDEN) { serversAsked = `Stop ${what}? ${detail}`; return true; }
  if (!win || win.isDestroyed()) return false;
  const { response } = await dialog.showMessageBox(win, { type: 'question', buttons: ['Stop it', 'Leave it running'], defaultId: 1, cancelId: 1, message: `Stop ${what}?`, detail });
  return response === 0;
}

// ---- Jev: off until the person switches it on in Settings and gives an OpenRouter key (jev.cjs) ----
let jev = null;
let jevStub = null;              // a test run's made-up OpenRouter: a self-test never reaches the network
/** One request to OpenRouter: { status, json }. */
async function jevPost(url, headers, body, ms) {
  if (SELFTEST_DIR) return jevStub ? jevStub(url, body) : { status: 503, json: null };
  const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(ms) });
  let json = null;
  try { json = await res.json(); } catch { json = null; }
  return { status: res.status, json };
}
const folderKey = (p) => path.normalize(String(p)).replace(/[\\/]+$/, '').toLowerCase();
// Claude Code names a conversation's folder after the folder it ran in, every sign but letters and digits a dash
const projectKey = (p) => String(p).replace(/[^A-Za-z0-9]/g, '-').toLowerCase();
let mineOf = null;
let mineList = [];
/** His ops record, by the path the app reads it from and by where it really is (one is a junction to the other). */
function mineFolders() {
  if (mineOf === settings.record.folder) return mineList;
  mineOf = settings.record.folder;
  const list = new Set();
  for (const f of [settings.record.folder]) {
    if (!f) continue;
    list.add(folderKey(f));
    try { list.add(folderKey(fs.realpathSync.native(f))); } catch { /* not there */ }
  }
  mineList = [...list];
  return mineList;
}
/** A folder in his ops record: what a chat working there says never goes to Jev. */
function isMine(folder) {
  if (typeof folder !== 'string' || !folder) return false;
  const keys = [folderKey(folder)];
  try { keys.push(folderKey(fs.realpathSync.native(folder))); } catch { /* gone since */ }
  return mineFolders().some((m) => keys.some((k) => k === m || k.startsWith(`${m}\\`)));
}
/** A search result from a conversation in his ops record, told by its folder or by the name of its conversation folder. */
function mineResult(r) {
  if (isMine(r.cwd)) return true;
  const p = String(r.project || '').toLowerCase();
  return Boolean(p) && mineFolders().some((m) => { const k = projectKey(m); return p === k || p.startsWith(`${k}-`); });
}

/** A turn that just finished, put to Jev: what it wants from the person. Nothing waits on the answer. */
async function judge(c) {
  if (isMine(c.cwd)) return;
  const final = await askWatcher('final', { key: c.key }, 5000);
  if (!final || !jev) return;
  try { await jev.judgeTurn({ ...final, key: c.key, since: c.since }); } catch (err) { log(`jev: ${err.message}`); }
}

// what Jev made of a search, by the words searched and the results it was shown: asking again costs nothing
const sorts = new Map();
const passageOf = (r) => [r.title || r.prompt || '', ...(r.moments || []).map((m) => `${m.verb || m.kind}: ${m.text}`)].filter(Boolean).join('\n');
/**
 * A search with its first twenty results in the order Jev puts them, best answer first. A result from a
 * conversation in his ops record is never shown to Jev: it keeps its place. null: Jev is off, or did not answer.
 */
async function findSorted(q) {
  if (typeof q !== 'string' || !q.trim() || !jev || !jev.ready()) return null;
  const query = q.trim().slice(0, 500);
  const answer = await askFinder('search', { q: query });
  const results = answer && answer.ready && Array.isArray(answer.results) ? answer.results : [];
  const top = results.slice(0, 20);
  const open = top.map((r) => !mineResult(r));
  const sent = top.filter((_r, i) => open[i]);
  if (sent.length < 2) return null;
  const stamp = `${query}\n${sent.map((r) => r.id).join(',')}`;
  let order = sorts.get(stamp);
  if (!order) {
    const scores = await jev.rerank(query, sent.map(passageOf));
    if (!scores) return null;
    order = sent.map((r, i) => ({ id: r.id, s: scores[i], i })).sort((a, b) => b.s - a.s || a.i - b.i).map((x) => x.id);
    sorts.set(stamp, order);
    if (sorts.size > 40) sorts.delete(sorts.keys().next().value);
  }
  const byId = new Map(sent.map((r) => [r.id, r]));
  const queue = order.map((id) => byId.get(id));
  return { ...answer, results: [...top.map((r, i) => (open[i] ? queue.shift() : r)), ...results.slice(20)], sorted: true };
}

// The folder is only read by the watcher; it is never a command or an argument to a program.
function recordFolder(folder) {
  return typeof folder === 'string' && folder.length <= 400 && !folder.includes('\0') && path.isAbsolute(folder) ? path.normalize(folder) : '';
}
const RECORD_PARTS = ['summary', 'today', 'projects', 'project', 'todos', 'feed', 'projectOf', 'search'];
const RECORD_KINDS = ['step', 'decision', 'fact', 'task', 'note', 'fail'];
const RECORD_SLUG = /^[a-z0-9-]+$/i;
const recordAnswers = [];
function recordRequest(ask) {
  if (!ask || typeof ask !== 'object' || !RECORD_PARTS.includes(ask.part)) return null;
  const request = { part: ask.part };
  for (const key of ['slug', 'client']) {
    if (ask[key] === undefined) continue;
    if (typeof ask[key] !== 'string' || ask[key].length > 200 || !RECORD_SLUG.test(ask[key])) return null;
    request[key] = ask[key];
  }
  if (ask.part === 'project' && !request.slug) return null;
  if (ask.task !== undefined) {
    if (ask.part !== 'project' || typeof ask.task !== 'string' || !ask.task || ask.task.length > 200 || ask.task.includes('\0')) return null;
    request.task = ask.task;
  }
  if (ask.before !== undefined) {
    if (!Number.isSafeInteger(ask.before) || ask.before < 0) return null;
    request.before = ask.before;
  }
  if (ask.kinds !== undefined) {
    if (!Array.isArray(ask.kinds) || ask.kinds.length > 6 || ask.kinds.some((kind) => !RECORD_KINDS.includes(kind))) return null;
    request.kinds = [...new Set(ask.kinds)];
  }
  if (ask.query !== undefined) {
    if (typeof ask.query !== 'string' || ask.query.length > 200) return null;
    request.query = ask.query.trim();
  }
  if (ask.folders !== undefined) {
    if (!Array.isArray(ask.folders) || ask.folders.length > 40 || ask.folders.some((f) => typeof f !== 'string' || f.length > 400 || f.includes('\0'))) return null;
    request.folders = ask.folders.slice();
  }
  if (ask.part === 'projectOf' && !request.folders) return null;
  return request;
}
async function askRecord(ask) {
  const request = recordRequest(ask);
  const folder = settings.record.folder;
  const answer = !request ? { ready: false } : !folder ? { set: false }
    : await askWatcher('record', { folder, request }, 2900).catch(() => null) || { ready: false };
  const current = folder === settings.record.folder ? answer : { ready: false };
  if (SELFTEST_DIR) recordAnswers.push(current);
  return current;
}
function startTestRecord(folder) {
  const inside = (root, file) => {
    const rel = path.relative(root, file);
    return Boolean(rel) && rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel);
  };
  if (!SELFTEST_DIR || !recordFolder(folder) || !inside(path.resolve(SELFTEST_DIR), path.resolve(folder))
    || !inside(fs.realpathSync(SELFTEST_DIR), fs.realpathSync(folder))) throw new Error('The record test needs its own folder in the run folder.');
  settings.record = { folder: path.resolve(folder) };
  recordAnswers.length = 0;
  return shownSettings();
}

// ---- the finder thread ----
let finderConfig = null;
let finderRestarts = 0;
let finderSince = 0;
let finderRestart = null;
let findSeq = 0;
const findAsks = new Map();
let findProgress = { files: 0, filesDone: 0, bytes: 0, bytesDone: 0, building: false };
const findNotReady = () => ({ ready: false, results: [], understood: [], progress: { ...findProgress } });

function startFinder() {
  // In a test run only the phase can provide a home: the real one is never a fallback.
  if (quitting || finder || !finderConfig) return;
  clearTimeout(finderRestart);
  finderRestart = null;
  finderSince = Date.now();
  const thread = new Worker(path.join(__dirname, 'find.cjs'), {
    workerData: finderConfig,
    resourceLimits: { maxOldGenerationSizeMb: 128, maxYoungGenerationSizeMb: 8 },
  });
  finder = thread;
  thread.on('message', (m) => {
    if (finder !== thread || !m || typeof m !== 'object') return;
    if (m.type === 'progress') {
      findProgress = m.progress;
      send('desk:find-progress', findProgress);
    } else if (Object.hasOwn(m, 'id')) {
      const done = findAsks.get(m.id);
      if (done) done(m.result);
    }
  });
  // An error can carry transcript words or paths: only the fact it stopped belongs in the log.
  thread.on('error', () => log('finder stopped'));
  thread.on('exit', (exitCode) => {
    if (finder !== thread) return;
    finder = null;
    for (const done of findAsks.values()) done(findNotReady());
    if (quitting || exitCode === 0) return;
    if (Date.now() - finderSince > 10 * 60e3) finderRestarts = 0;
    if (++finderRestarts > 3) { log('finder stopped repeatedly; left stopped'); return; }
    log('finder stopped; starting it again');
    finderRestart = setTimeout(() => { finderRestart = null; startFinder(); }, 2000);
  });
}

/** Stops after its read positions are saved; a thread that does not answer is ended after 3 s. */
function stopFinder() {
  clearTimeout(finderRestart);
  finderRestart = null;
  const thread = finder;
  finder = null;
  for (const done of findAsks.values()) done(findNotReady());
  if (!thread) return Promise.resolve();
  return new Promise((resolve) => {
    const late = setTimeout(() => { log('the finder did not stop within 3 s; ended'); thread.terminate().then(resolve, resolve); }, 3000);
    thread.once('exit', () => { clearTimeout(late); resolve(); });
    try { thread.postMessage({ type: 'stop' }); } catch { clearTimeout(late); thread.terminate().then(resolve, resolve); }
  });
}

/** Every question has a deadline, including questions put while the first pass is still being built. */
function askFinder(type, more) {
  return new Promise((resolve) => {
    if (!finder) { resolve(findNotReady()); return; }
    const id = ++findSeq;
    const done = (result) => {
      if (!findAsks.delete(id)) return;
      clearTimeout(late);
      resolve(result);
    };
    const late = setTimeout(() => done(findNotReady()), 3000);
    findAsks.set(id, done);
    try { finder.postMessage({ ...more, type, id }); } catch { done(findNotReady()); }
  });
}

/** Only a home and index inside the run folder may be handed to the test thread. */
async function startTestFinder(home, store, now) {
  const inside = (file) => {
    if (!SELFTEST_DIR || typeof file !== 'string' || !path.isAbsolute(file)) return false;
    const relative = path.relative(path.resolve(SELFTEST_DIR), path.resolve(file));
    return Boolean(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
  };
  if (!inside(home) || !inside(store)) throw new Error('The finder test needs its own home and index in the run folder.');
  await stopFinder();
  finderConfig = { home, store, ...(Number.isFinite(now) ? { now } : {}) };
  finderRestarts = 0;
  findProgress = { files: 0, filesDone: 0, bytes: 0, bytesDone: 0, building: true };
  startFinder();
}

/** The name a session goes by, as the page shows it. */
function nameOf(c) {
  const chat = c.chat && chats.all.get(c.chat);
  return (chat && chat.title) || (c.named && c.name) || c.title || c.name || leaf(c.cwd) || 'Chat';
}

let trayFigures = null;
/** The note on the Lowlit icon near the clock: who waits (as the window counts them), what works, the account's limits. */
function trayTip() {
  if (!tray || !trayFigures) return;
  const { needs, working, plan, who } = trayFigures;
  const bits = ['Lowlit'];
  const calling = pageCalls >= 0 ? pageCalls : needs;
  if (calling) bits.push(`${calling} need${calling === 1 ? 's' : ''} you`);
  if (working) bits.push(`${working} working`);
  const limits = [plan.five && `5h ${Math.round(plan.five.used)}%`, plan.week && `week ${Math.round(plan.week.used)}%`].filter(Boolean).join(', ');
  if (limits) bits.push(who ? `${who}: ${limits}` : limits);
  else if (who) bits.push(who);
  // Windows cuts a tooltip off at 127 characters
  tray.setToolTip(bits.join(' · ').slice(0, 120));
}

// ---- the notes (his ask, 5 Oct night: "show them top right of the screen with a x button, a possibility to jump to
// ---- that window and a possibility to disable them in settings"; 6 Oct night "top left always", that morning "top
// ---- right not top left", so the corner is a setting, the top right unless changed): a card each, in a window of
// ---- their own at the top of the screen, over
// ---- every other program, while this window is not in front. × closes a card, Go there brings this window up where it
// ---- points; coming back to this window clears them all, as it shows the same.
const NOTES_W = 376;              // a card, 360px, and the margin its shadow falls in (notes.css)
const NOTES_EDGE = 4;             // from the corner of the screen to the window: the cards stand 12px in
const NOTES_MAX = 5;              // cards at once: one more pushes out the oldest that may go
const NOTE_MS = 12000;            // a card that does not wait for the person goes after this, unless the pointer is on the cards
let notesWin = null;
let notes = [];                   // newest first: { id, kind, title, what, body, place, target, key, stays, at }
let noteSeq = 0;
let noteMs = NOTE_MS;
let notesInTest = false;          // a hidden test window makes the chats' cards only when its test asks

const deskInFront = () => Boolean(win) && !win.isDestroyed() && win.isVisible() && !win.isMinimized() && win.isFocused();

/**
 * A card on top of the others; a card about the same chat before it goes. stays: it waits for the person, until it is
 * opened or closed, the chat stops waiting, or this window comes in front. Switched off in Settings: none.
 */
function noteUp({ kind, title, what = '', body = '', place = '', target = '', key = '', stays = false }) {
  if (!settings.notify.cards) return '';
  const one = (s, n) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, n);
  const n = { id: `n${++noteSeq}`, kind, title: one(title, 120), what: one(what, 60), body: one(body, 280), place: one(place, 80), target: one(target, 80), key, stays, at: Date.now() };
  notes = [n, ...notes.filter((x) => !key || x.key !== key)];
  while (notes.length > NOTES_MAX) {
    const i = notes.map((x) => !x.stays).lastIndexOf(true);
    notes.splice(i >= 0 ? i : notes.length - 1, 1);
  }
  notesSync();
  return n.id;
}

function noteDrop(test) {
  const before = notes.length;
  notes = notes.filter((x) => !test(x));
  if (notes.length !== before) notesSync();
}

/** A chat that wants the person, finished, or is the Nest that answered. */
function chatNote(c, finished, nest) {
  const words = String(c.words || '').replace(/\s+/g, ' ').trim();
  const place = leaf(c.cwd || '');
  if (nest) return noteUp({ kind: 'nest', title: 'The Nest', what: 'answered', body: words || 'Its answer is ready.', target: c.chat, key: c.key });
  const kind = finished ? 'done' : c.state === 'error' ? 'error' : 'needs';
  const name = nameOf(c);
  return noteUp({ kind, title: name, what: finished ? 'finished' : kind === 'error' ? 'stopped on an error' : 'needs you',
    body: words || (finished ? 'Its turn is over.' : 'It is waiting for you.'), place: place && place !== name ? place : '',
    target: c.chat || `row:${c.key}`, key: c.key, stays: !finished });
}

/** The cards' window: made when there is a card, at the top of the screen the pointer is on; shown while this window is not in front, never in a hidden test. */
function notesSync() {
  if (!notes.length || quitting) { notesClose(); return; }
  if (!notesWin || notesWin.isDestroyed()) makeNotes();
  else notesTell();
  const want = !HIDDEN && !deskInFront();
  const up = notesWin.isVisible();
  if (want && !up) { notesPlace(); notesWin.showInactive(); }
  else if (!want && up) notesWin.hide();
}

/**
 * The corner Settings names, at the top of the screen the pointer is on. The floating card stands in the top left
 * corner unless it was moved: where it lies over the cards' column, they go under it.
 */
function notesSpot() {
  const area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
  const x = settings.notify.corner === 'top-left' ? area.x + NOTES_EDGE : area.x + area.width - NOTES_W - NOTES_EDGE;
  const y = area.y + NOTES_EDGE;
  if (!floatUp()) return { x, y };
  const f = floatWin.getBounds();
  const across = f.x < x + NOTES_W && x < f.x + f.width;
  // the card in the top half of the screen, above where the cards begin or over it: they start below it, the margins of
  // the two windows (8px of shadow each) laid one over the other
  if (!across || f.y > area.y + area.height / 2 || f.y + f.height <= y) return { x, y };
  return { x, y: Math.min(f.y + f.height - 6, area.y + Math.round(area.height / 2)) };
}

/** The cards' window moved to where it belongs now: its corner, the screen the pointer is on, under the floating card. */
function notesPlace() {
  if (!notesWin || notesWin.isDestroyed()) return;
  const at = notesSpot();
  const b = notesWin.getBounds();
  if (b.x !== at.x || b.y !== at.y) notesWin.setBounds({ x: at.x, y: at.y, width: NOTES_W, height: b.height });
}

/**
 * Over every other window, for good. Electron parks a window made "always on top" just behind the taskbar, and
 * Windows takes "topmost" off a window placed behind one that is not topmost itself, which the taskbar is not while a
 * full-screen program is in front: a card made at such a moment was an ordinary window from then on, under the next
 * one to come in front. The level above the usual one is not parked behind the taskbar.
 */
function keepOnTop(w) {
  w.setAlwaysOnTop(true, 'screen-saver');
}

function makeNotes() {
  const at = notesSpot();
  notesWin = new BrowserWindow({
    x: at.x, y: at.y, width: NOTES_W, height: 120,
    show: false, frame: false, transparent: true, backgroundColor: '#00000000', hasShadow: false,
    resizable: false, maximizable: false, minimizable: false, fullscreenable: false,
    // over every other window, never on the taskbar, and never taking the keyboard from what is being typed into
    alwaysOnTop: true, skipTaskbar: true, focusable: false,
    title: 'Lowlit notes',
    icon: ICON,
    webPreferences: {
      preload: path.join(__dirname, 'notes-preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      // its cards go on their own time while every other window is in front: that is when it is seen
      backgroundThrottling: false,
    },
  });
  keepOnTop(notesWin);
  notesWin.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  notesWin.webContents.on('will-navigate', (event) => event.preventDefault());
  notesWin.webContents.on('did-finish-load', notesTell);
  notesWin.on('closed', () => { notesWin = null; });
  notesWin.loadFile(path.join(__dirname, 'notes.html')).catch((err) => log(`notes not loaded: ${err.message}`));
}

/** Hands the cards to their page. Sent while it loads, it is lost; did-finish-load sends it again. */
function notesTell() {
  if (!notesWin || notesWin.isDestroyed()) return;
  notesWin.webContents.send('notes:model', notes.map(({ id, kind, title, what, body, place, target, stays, at }) => ({ id, kind, title, what, body, place, open: Boolean(target), stays, at })),
    { look: settings.look, ms: noteMs, corner: settings.notify.corner });
}

function notesClose() {
  if (notesWin && !notesWin.isDestroyed()) notesWin.destroy();
  notesWin = null;
}

/** A chat of this window that works in the record's folder itself: the Nest's chat, as the page counts it. */
function isNestChat(chatId) {
  const chat = chatId ? chats.all.get(chatId) : null;
  if (!chat || !chat.cwd) return false;
  const k = folderKey(chat.cwd);
  return nestFolders().some((f) => folderKey(f) === k);
}

/** "18:20" for a moment today, "Thu 8 Oct, 09:00" for another day. */
function whenOf(at) {
  const d = new Date(at);
  const time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  return d.toDateString() === new Date().toDateString() ? time : `${d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}, ${time}`;
}

/** The last fifty reset windows dealt with, oldest first, without names or session details. */
function takeResetNotes(list) {
  return [...new Set((Array.isArray(list) ? list : []).filter((id) => typeof id === 'string' && /^[0-9a-f]{8}\|(five|week)\|[1-9]\d{0,15}$/.test(id)
    && Number(id.split('|')[2]) <= 8640000000000000))].sort((a, b) => Number(a.split('|')[2]) - Number(b.split('|')[2]) || a.localeCompare(b)).slice(-50);
}

/** Expired high readings are dealt with once, including those quieted at startup, by a switch or by current work. */
function resetDecisions(data, kept, now, first, on, after = 0, pending = []) {
  const memory = takeResetNotes(kept);
  const seen = new Set(memory);
  const oldest = memory.length === 50 ? Number(memory[0].split('|')[2]) : 0;
  const live = data.accounts && Array.isArray(data.accounts.list) ? data.accounts.list : [];
  const current = (data.accounts && data.accounts.current) || (live.find((a) => a.here) || {}).key;
  const list = [...pending.map((a) => ({ ...a, here: a.key === current })), ...live];
  // A picture has no account on each chat: a working Claude chat may belong to the account in use.
  const working = (data.chats || []).some((c) => c.provider !== 'codex' && (c.state === 'working' || c.state === 'compacting'));
  const due = [];
  let next = 0;
  for (const a of list) {
    if (!a || !/^[0-9a-f]{8}$/.test(a.key)) continue;
    for (const name of ['five', 'week']) {
      const w = a[name];
      if (!w || !Number.isFinite(w.used) || w.used < 90 || !Number.isFinite(w.until) || w.until <= 0) continue;
      if (w.until > now) { if (!next || w.until < next) next = w.until; continue; }
      const id = `${a.key}|${name}|${w.until}`;
      if (seen.has(id) || w.until <= oldest) continue;
      seen.add(id);
      const here = a.here || a.key === (data.accounts && data.accounts.current);
      due.push({ id, a, name, until: w.until, say: Boolean(on && !first && !(here && working)) });
    }
  }
  const waiting = due.filter((d) => d.say).sort((a, b) => a.until - b.until);
  const said = now >= after ? waiting.slice(0, 1) : [];
  // The page holds one note at a time. Deferred windows stay untold until there is room for them.
  if (waiting.length > said.length) next = Math.min(next || Infinity, after > now ? after : now + RESET_NOTE_GAP);
  const record = takeResetNotes([...memory, ...due.filter((d) => !d.say).map((d) => d.id), ...said.map((d) => d.id)]);
  return { kept: record, due: said.filter((d) => record.includes(d.id)), next,
    waiting: waiting.slice(said.length).map((d) => ({ key: d.a.key, email: d.a.email, [d.name]: d.a[d.name] })) };
}

function trackResets(data, now, first, testing) {
  const cfg = testing ? testing.settings : settings;
  const result = resetDecisions(data, cfg.resetNoted, now, first, cfg.notify.resets && (Boolean(testing) || !HIDDEN), testing ? testing.after || 0 : resetAfter, testing ? testing.waiting || [] : resetWaiting);
  if (testing) testing.waiting = result.waiting;
  else resetWaiting = result.waiting;
  if (JSON.stringify(result.kept) !== JSON.stringify(cfg.resetNoted)) {
    cfg.resetNoted = result.kept;
    // Keep the record before showing a note, so closing just afterwards cannot repeat it.
    if (!testing) writeSettings();
  }
  const looking = !testing && Boolean(win) && !win.isDestroyed() && win.isVisible() && !win.isMinimized() && win.isFocused();
  for (const d of result.due) {
    const who = cfg.accountNames[d.a.key] || (d.a.email ? d.a.email.split('@')[0] : d.a.key);
    const title = `${who} has room again`;
    const at = new Date(d.until).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
    const body = `Its ${PLAN_NAMES[d.name]} reset at ${at}.`;
    if (testing) testing.notes.push({ title, body, target: 'stats' });
    else if (looking) send('desk:command', 'card', { text: `${title}. ${body}`, kind: 'reset', title, body, target: 'stats' });
    else noteUp({ kind: 'reset', title, body, target: 'stats' });
    if (testing) testing.after = now + RESET_NOTE_GAP;
    else resetAfter = now + RESET_NOTE_GAP;
  }
  if (!testing) {
    clearTimeout(resetTimer);
    resetTimer = result.next ? setTimeout(() => { resetTimer = null; if (!quitting) trackResets(latest, Date.now(), false); }, Math.min(2147483647, Math.max(1, result.next - now + 25))) : null;
  }
  return result.kept;
}

function track(data) {
  const first = latest.at === 0;
  latest = data;
  const now = Date.now();
  let nudge = false;
  const wanted = [];
  let needs = 0;
  let working = 0;
  const keys = new Set();
  for (const c of data.chats) {
    keys.add(c.key);
    // a background record nobody runs any more and nobody answered for days is not counted, as in the window
    const stale = c.kind === 'bg' && !c.pid && now - c.at > OLD_MS;
    if (!stale && (c.state === 'attention' || c.state === 'error')) needs++;
    if (c.state === 'working' || c.state === 'compacting') working++;
    const before = lastState.get(c.key);
    lastState.set(c.key, c.state);
    if (first || !before || before === c.state) continue;
    const finished = c.state === 'idle' && (before === 'working' || before === 'compacting');
    if (finished && !stale && jev && jev.ready()) judge(c);
    const wants = c.state === 'attention' || c.state === 'error';
    if (!wants && !finished) continue;
    if (c.chat) nudge = true;
    // the Nest's chat is the one he leaves to think while he does something else: its answer is said (his ask, 4 Oct)
    const nest = finished && isNestChat(c.chat);
    const on = nest ? settings.notify.nest : finished ? Boolean(c.chat) && settings.notify.finished : c.chat ? settings.notify.here : settings.notify.elsewhere;
    if (on) wanted.push({ c, finished, nest });
  }
  for (const key of lastState.keys()) if (!keys.has(key)) lastState.delete(key);
  // a card that waits for the person goes once its chat no longer waits, or is gone
  if (notes.some((n) => n.stays)) noteDrop((n) => n.stays && n.key && lastState.get(n.key) !== 'attention' && lastState.get(n.key) !== 'error');
  // a session wants the person, or just finished, while they are looking elsewhere: a card each, the newest on top
  const looking = deskInFront();
  const nestSaid = wanted.find((w) => w.nest);
  if ((!HIDDEN || notesInTest) && !looking) {
    if (nudge && !HIDDEN && win && !win.isDestroyed()) win.flashFrame(true);
    for (const w of wanted) chatNote(w.c, w.finished, w.nest);
    if (wanted.length) resetAfter = now + RESET_NOTE_GAP;
  } else if (nestSaid) {
    // in the window: the page says it, unless the Nest is what is in front (a hidden test window is told the same way)
    const words = String(nestSaid.c.words || '').replace(/\s+/g, ' ').trim();
    send('desk:command', 'nest-answered', words.length > 160 ? `${words.slice(0, 159)}…` : words);
  }
  // A usage limit of the account in use that is nearly used up is said once per window: on a card in the page when it
  // is being looked at, on a note over the other programs when not. The limits are those of whichever account is logged in, so it is named.
  const plan = data.plan || {};
  const me = data.accounts && Array.isArray(data.accounts.list) ? data.accounts.list.find((a) => a.here) : null;
  const who = me ? settings.accountNames[me.key] || String(me.email || '').split('@')[0] : '';
  for (const name of Object.keys(PLAN_NAMES)) {
    const w = plan[name];
    const said = `${me ? me.key : ''}|${name}|${w ? w.until : 0}`;
    if (!w || w.used < NEARLY || limitNoted.has(said)) continue;
    limitNoted.add(said);
    // already that far when the app started: the sidebar shows it, and a note would be old news
    if (first || HIDDEN || !settings.notify.limit) continue;
    const title = `${Math.round(w.used)}% of your ${PLAN_NAMES[name]} is used`;
    const rest = `${who ? `Account ${who}. ` : ''}It resets at ${whenOf(w.until)}.`;
    if (looking) send('desk:command', 'card', { text: `${title}. ${rest}`, kind: 'limit', title, body: rest, target: 'stats' });
    else noteUp({ kind: 'limit', title, body: `${rest} As Claude Code last reported it.`, target: 'stats' });
    resetAfter = now + RESET_NOTE_GAP;
  }
  // A drive nearly full is said on a card once a day, when the window is not being looked at: the page's notes
  // say it in any case, with the chats that hold the most.
  for (const d of Array.isArray(data.drives) ? data.drives : []) {
    const said = `${d.drive}|${new Date(now).toDateString()}`;
    if (!d.low || diskNoted.has(said)) continue;
    if (first || HIDDEN || !settings.notify.disk || looking) { diskNoted.add(said); continue; }
    diskNoted.add(said);
    const most = data.chats.map((c) => ({ c, held: c.disk ? c.disk.folders.filter((f) => f.drive === d.drive).reduce((sum, f) => sum + (f.bytes || 0), 0) : 0 }))
      .sort((a, b) => b.held - a.held)[0];
    const holder = most && most.held >= 100 * MB ? ` ${nameOf(most.c)} holds ${sizeWords(most.held)} of working files there.` : '';
    noteUp({ kind: 'disk', title: `Drive ${d.drive} is nearly full`, body: `${sizeWords(d.free)} left.${holder} Claude Code does not delete a chat's working files when it ends.`,
      target: most && most.c.chat ? most.c.chat : '' });
  }
  trackResets(data, now, first);
  trayFigures = { needs, working, plan, who };
  trayTip();
  // a conversation that ended in a chat of this window: that chat is a plain shell from now on
  for (const e of data.ended || []) if (e.chat) chats.release(e.chat);
  saveOpen();
}

/** The watcher looks less often while nobody can see the window, and the page stops its small animations when it is not in front. */
function presence() {
  if (!win || win.isDestroyed()) return;
  const seen = win.isVisible() && !win.isMinimized();
  floatSync(false);
  // the floating card shows what the watcher sees: while it is up, the watcher keeps the pace of a window in sight
  if (worker) worker.postMessage({ type: 'pace', ms: paceNow() });
  send('desk:command', !seen ? 'away' : win.isFocused() ? 'live' : 'seen');
  if (win.isFocused()) win.flashFrame(false);
  // back in this window, which shows the same: the notes have done their part
  if (deskInFront()) noteDrop(() => true);
  else if (notes.length) notesSync();
}

// ---- shortcuts in the Start menu, on the desktop, in the "start with Windows" folder: made only when asked ----
const LINKS = {
  startmenu: () => path.join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Lowlit.lnk'),
  desktop: () => path.join(app.getPath('desktop'), 'Lowlit.lnk'),
  startup: () => path.join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup', 'Lowlit.lnk'),
};
/** Where the shortcut of that kind goes: '' when Windows cannot say where the folder is (a Desktop moved to a drive that is gone). */
const linkFile = (kind) => { try { return Object.hasOwn(LINKS, kind) ? LINKS[kind]() : ''; } catch { return ''; } };
const linkState = () => Object.fromEntries(Object.keys(LINKS).map((kind) => { const file = linkFile(kind); return [kind, Boolean(file) && fs.existsSync(file)]; }));
/** Writes a shortcut that starts this app the way the taskbar does. flags: passed on to the window. */
function writeLink(file, flags) {
  return shell.writeShortcutLink(file, fs.existsSync(file) ? 'replace' : 'create', {
    target: WSCRIPT,
    args: `"${LAUNCHER}"${flags ? ' ' + flags : ''}`,
    cwd: __dirname,
    description: 'Lowlit: every agent chat in one window',
    icon: ICON,
    iconIndex: 0,
    appUserModelId: APP_ID,
  });
}

// ---- newer code on disk. The page and the watcher can be loaded again under running chats; this file, the
// ---- consoles and the bridge to the page cannot: for those the app is closed and opened again. ----
const filesIn = (dir, pattern) => { try { return fs.readdirSync(dir).filter((n) => pattern.test(n)).map((n) => path.join(dir, n)); } catch { return []; } };
const CODE = {
  page: () => [path.join(__dirname, 'index.html'), path.join(__dirname, 'float.html'), ...filesIn(__dirname, /\.js$/), ...filesIn(path.join(__dirname, 'styles'), /\.css$/)],
  watcher: () => ['watch.cjs', 'find.cjs', 'transcript.cjs', 'accounts.cjs', 'procs.cjs', 'procs.ps1', 'record.cjs', 'prices.cjs'].map((n) => path.join(__dirname, n)),
  app: () => ['main.cjs', 'chats.cjs', 'replay.cjs', 'preload.cjs', 'float-preload.cjs', 'jev.cjs', 'servers.cjs', 'browser.cjs', 'browser-mcp.cjs', 'browser-look.cjs', 'keeper.cjs'].map((n) => path.join(__dirname, n)),
};
const code = (() => {
  const groups = Object.fromEntries(Object.keys(CODE).map((name) => [name, { loaded: 0, seen: 0, newer: false }]));
  const newest = (name) => Math.max(0, ...CODE[name]().map((f) => { try { return fs.statSync(f).mtimeMs; } catch { return 0; } }));
  let said = '';
  /** 'restart' when code under the running chats is newer, 'reload' when only what can be loaded again is, else ''. */
  const now = () => (groups.app.newer ? 'restart' : groups.page.newer || groups.watcher.newer ? 'reload' : '');
  const tell = () => { const next = now(); if (next !== said) { said = next; send('desk:version', next); } };
  return {
    now,
    newer: (name) => groups[name].newer,
    /** What is on disk for `name` now is what runs. */
    loaded(name) { const at = newest(name); Object.assign(groups[name], { loaded: at, seen: at, newer: false }); tell(); },
    /** A file still being written is not offered: a time counts once it is read twice, and is 3 s old. Only times are read. */
    look(at = Date.now()) {
      for (const g of Object.keys(groups)) {
        const group = groups[g];
        const t = newest(g);
        if (t === group.seen && at - t >= 3000) group.newer = t > group.loaded;
        group.seen = t;
      }
      tell();
    },
  };
})();

/** Loads the page, the first time or again. Until it asks what there is, it is told nothing. */
function loadPage(first = false) {
  pageUp = false;
  // the pages of the Browser step aside until the new page says where its panel is
  if (browser) browser.hide();
  code.loaded('page');
  if (first) win.loadFile(path.join(__dirname, 'index.html')).catch((err) => log(`page not loaded: ${err.message}`));
  else {
    win.webContents.reloadIgnoringCache();
    // the floating card's page is made of the same files
    if (floatWin && !floatWin.isDestroyed()) floatWin.webContents.reloadIgnoringCache();
  }
}

let reloading = null;
/**
 * The page loaded again, and the watcher too when its code is newer. The consoles live in this process and are not
 * touched: the new page draws each chat again from what it printed lately (replay.cjs).
 */
function reloadWindow() {
  if (reloading) return reloading;
  reloading = (async () => {
    if (quitting || !win || win.isDestroyed()) return false;
    if (code.newer('watcher')) {
      await Promise.all([stopWatcher(), stopFinder()]);
      if (quitting) return false;
      restarts = 0;
      finderRestarts = 0;
      startWatcher();
      startFinder();
      code.loaded('watcher');
      presence();
    }
    if (!win || win.isDestroyed()) return false;
    loadPage();
    return true;
  })().finally(() => { reloading = null; });
  return reloading;
}

// The page's own program can die (the graphics driver, memory) while the chats run on here. It is loaded again a
// moment later, three times in a minute at most: one that keeps dying is left as it is, said once in the log.
let pageDeaths = [];
function pageGone(_event, details) {
  pageUp = false;
  if (browser) browser.hide();
  if (quitting || details.reason === 'clean-exit') return;
  const now = Date.now();
  pageDeaths = pageDeaths.filter((at) => now - at < 60000);
  pageDeaths.push(now);
  if (pageDeaths.length > 3) {
    if (pageDeaths.length === 4) log(`the page died 4 times in a minute (${details.reason}); not loaded again`);
    return;
  }
  log(`the page died (${details.reason}); loading it again`);
  setTimeout(() => { if (!quitting && win && !win.isDestroyed()) loadPage(); }, 500);
}

// ---- what the page may ask for ----
function logoUrl() {
  try {
    return nativeImage.createFromPath(path.join(__dirname, '..', 'assets', 'logo.png')).resize({ width: 64, height: 64, quality: 'best' }).toDataURL();
  } catch {
    return '';
  }
}
const shownSettings = () => ({ notify: { ...settings.notify }, fontSize: settings.fontSize, inspector: settings.inspector, tiles: settings.tiles, split: settings.split,
  solid: settings.solid, look: settings.look, motion: settings.motion, keepChats: settings.keepChats, accountNames: { ...settings.accountNames }, links: linkState(), record: { ...settings.record },
  spaces: settings.spaces.map((s) => ({ id: s.id, name: s.name, folders: s.folders.slice(), color: s.color, sessions: s.sessions.slice() })),
  space: settings.space, also: settings.also.slice(), pins: { top: settings.pins.top.slice(), space: settings.pins.space.slice() }, nestKey: settings.nestKey, nestKeyState, nestLook: settings.nestLook,
  // the key Claude Code is given for the browser stays here
  browser: { on: settings.browser.on, popOpen: settings.browser.popOpen, ask: settings.browser.ask.slice() },
  float: { on: settings.float.on, small: settings.float.small, overDesk: settings.float.overDesk },
  work: { on: settings.work.on, aw: settings.work.aw, auto: settings.work.auto, gap: settings.work.gap, shifts: settings.work.shifts.map((s) => ({ ...s })) },
  claude: { model: settings.claude.model, effort: settings.claude.effort,
    spaces: Object.fromEntries(Object.entries(settings.claude.spaces).map(([id, v]) => [id, { ...v }])),
    // the usual way of starting Claude Code, and whether a flag added after its name reaches the CLI
    via: starters.length ? { name: claudeStarter().name, passes: Boolean(claudeStarter().passes) } : null } });

ipcMain.handle('desk:info', async () => {
  // the consoles a keeper held for this window are its chats again before the page is told what there is
  await keeperReady;
  pageUp = true;
  const nestNow = nestAsked;
  nestAsked = false;
  // said once: a page loaded again later takes its place from its own store
  const adopted = adoption;
  adoption = null;
  const place = typeof settings.place === 'string' ? settings.place : '';
  if (place) { delete settings.place; saveSettings(); }
  const gamed = gamedNote;
  gamedNote = null;
  return {
    adopted,
    place,
    // back from gaming mode: what comes back, and the servers that cannot
    gamed,
    // the folders a chat must work in to be the Nest's, and whether the Nest was asked for before the page was up
    nest: { folders: nestFolders(), asked: nestNow },
    build: windowsBuild,
    // DESK_RENDERER=dom: draw with plain page text instead of the graphics card, should that ever garble.
    renderer: process.env.DESK_RENDERER === 'dom' ? 'dom' : 'webgl',
    logo: logoUrl(),
    home: os.homedir(),
    starters: starters.map(({ id, name, agent, passes }) => ({ id, name, agent, passes: Boolean(passes) })),
    starter: defaultStarter().id,
    previous,
    restore,
    size: { cols: chats.cols, rows: chats.rows },
    chats: chats.list(),
    snapshot: latest,
    res: latestRes,
    findProgress,
    settings: shownSettings(),
    jev: jev ? jev.view() : null,
    servers: servers ? servers.view : null,
    work: work ? work.view() : null,
    hidden: HIDDEN,
    glass: glassOn,
    version: code.now(),
    // the watcher stopped too often and was left stopped (said once, to a page that may be gone since)
    stale: !worker && restarts > 3,
  };
});
// What a chat's console printed lately, for a page that has just started (replay.cjs), and its size, so it is drawn
// as it was. Whatever was waiting to go out goes first: it is in the answer, and the page skips it when it comes.
ipcMain.handle('desk:tail', (_event, id) => {
  const chat = typeof id === 'string' ? chats.all.get(id) : null;
  if (!chat) return null;
  chats.flush();
  const tail = tails.get(id);
  return { ...(tail ? tail.snapshot() : { data: '', seq: 0 }), cols: chat.term.cols, rows: chat.term.rows };
});
// newer code under the running chats cannot be loaded by the page: it says so instead
ipcMain.handle('desk:reload', () => (code.newer('app') ? 'restart' : reloadWindow()));
// the app closes and opens again (for newer code under it); the chats keep running. false: they could not be kept
ipcMain.handle('desk:restart', () => restartKeeping());
// answered once its console has said which program it is (the keeper says so a moment after it starts it)
ipcMain.handle('desk:create', async (_event, ask) => {
  const chat = createChat(ask);
  if (!chat || chat.error || chat.pid) return chat;
  await chats.started(chat.id);
  return chats.list().find((c) => c.id === chat.id) || chat;
});
// the New chat panel's question about a folder: is it in git, on which branch, and which other copies are there
ipcMain.handle('desk:repository', (_event, cwd) => repoOf(cwd));

// ---- a chat's project and branch, from the button on its strip: how its copy stands, and another branch ----
const BRANCHES_SHOWN = 12;
/** The copy of the project Lowlit itself runs from ('' outside git). */
const ownCopy = () => { const at = copyOf(__dirname); return at ? at.top : ''; };
/** The sessions at work in a copy: a switch of its branch would change their files under them. */
const busyIn = (top) => latest.chats.filter((c) => c.cwd && inside(c.cwd, top) && (c.state === 'working' || c.state === 'compacting'));
const sessionName = (c) => (c.chat && chats.all.has(c.chat) && chats.all.get(c.chat).title) || c.title || c.name || 'Another chat';

/** What the branch menu of a chat shows: its project, how its copy stands, its newest branches. null outside git. */
async function gitInfo(id) {
  const chat = typeof id === 'string' ? chats.all.get(id) : null;
  const at = chat ? copyOf(chat.cwd) : null;
  if (!at) return null;
  const [status, all] = await Promise.all([statusOf(at.top), branchesOf(at.top)]);
  const list = all || [];
  const shown = list.slice(0, BRANCHES_SHOWN);
  // the branch it is on stays in sight, however long ago its last commit
  const here = status && !status.detached && list.find((b) => b.name === status.branch);
  if (here && !shown.includes(here)) shown.unshift(here);
  const own = ownCopy();
  return { repo: projectName(at), remote: Boolean(originOf(at.common)), top: at.top, copy: at.copy, self: Boolean(own) && sameFolder(own, at.top), status,
    branches: shown, more: list.length - shown.length, busy: busyIn(at.top).map(sessionName) };
}

/** Puts a chat's copy on another of its branches, never under a session at work or over changes not committed. */
async function gitSwitch(id, name) {
  const chat = typeof id === 'string' ? chats.all.get(id) : null;
  const at = chat ? copyOf(chat.cwd) : null;
  if (!at) return { error: 'This folder is not in a git project.' };
  const own = ownCopy();
  if (own && sameFolder(own, at.top)) return { error: "Lowlit runs from this folder: another branch would change the app's own files under it. Switch it with Lowlit closed." };
  const busy = busyIn(at.top);
  if (busy.length) return { error: `${sessionName(busy[0])} is at work in this folder. Switch once it has finished.` };
  const [status, all] = await Promise.all([statusOf(at.top), branchesOf(at.top)]);
  if (!status || !all) return { error: 'git could not say how this folder stands.' };
  const target = typeof name === 'string' ? all.find((b) => b.name === name) : null;
  if (!target) return { error: 'That branch is not in this project any more.' };
  if (!status.detached && status.branch === name) return { ok: true, branch: name };
  if (target.elsewhere) return { error: `${name} is open in another copy of the project (${target.elsewhere}). A branch can be open in one copy at a time.` };
  if (status.changed > 0) return { error: `${status.changed} file${status.changed === 1 ? ' has' : 's have'} changes not committed. Commit them first, then switch.` };
  const done = await switchTo(at.top, name);
  if (worker) worker.postMessage({ type: 'git' });
  log(`git: a chat's folder ${done.ok ? 'was put on another branch' : 'stayed on its branch: git refused'}`);
  return done.ok ? { ok: true, branch: name } : { error: done.error };
}
ipcMain.handle('desk:git', (_event, id) => gitInfo(id));
ipcMain.handle('desk:git-switch', (_event, id, name) => gitSwitch(id, name));
ipcMain.on('desk:input', (_event, id, data) => {
  if (typeof id === 'string' && typeof data === 'string') chats.input(id, data);
});
// what the window found slow: a line in the log, six a minute at most, for when the person says it felt slow
const slowLines = [];
ipcMain.on('desk:slow', (_event, what) => {
  const now = Date.now();
  while (slowLines.length && now - slowLines[0] > 60000) slowLines.shift();
  if (typeof what !== 'string' || slowLines.length >= 6) return;
  slowLines.push(now);
  log(`slow: ${what.replace(/\s+/g, ' ').slice(0, 400)}`);
});
// the window's other lines, of the kinds main knows (how typing went, a change of its scaling, a redraw by hand): at
// most 6 a minute together
const NOTE_KINDS = new Set(['typing', 'screen']);
const noteLines = [];
const noteRoom = () => {
  const now = Date.now();
  while (noteLines.length && now - noteLines[0] > 60000) noteLines.shift();
  if (noteLines.length >= 6) return false;
  noteLines.push(now);
  return true;
};
ipcMain.on('desk:note', (_event, kind, what) => {
  if (!NOTE_KINDS.has(kind) || typeof what !== 'string' || !noteRoom()) return;
  log(`${kind}: ${what.replace(/\s+/g, ' ').slice(0, 400)}`);
});
// drawn again by hand: the window is repainted, and the log says when the person found it drawn wrong
ipcMain.on('desk:redraw', () => {
  if (!win || win.isDestroyed()) return;
  repaint();
  if (noteRoom()) log(`screen: drawn again by hand (F5 or the palette), on the ${onScreen ? onScreen.name : 'unknown'} screen`);
});
ipcMain.on('desk:resize', (_event, id, size) => {
  if (typeof id === 'string') chats.resize(id, size && size.cols, size && size.rows);
});
ipcMain.on('desk:rename', (_event, id, title) => {
  if (typeof id === 'string' && typeof title === 'string') chats.rename(id, title);
});
// Answers the time until which the chat can still be taken back, or false when it is kept.
ipcMain.handle('desk:close', async (_event, id) => {
  const chat = typeof id === 'string' ? chats.all.get(id) : null;
  if (!chat) return false;
  const s = sessionIn(id);
  // closing the view of a background session stops nothing: the session carries on without it
  if (!chat.job && s && (s.state === 'working' || s.state === 'compacting') && !HIDDEN) {
    const { response } = await dialog.showMessageBox(win, {
      type: 'question',
      buttons: ['Close chat', 'Keep it'],
      defaultId: 1,
      cancelId: 1,
      message: 'This chat is still working.',
      detail: 'Closing it stops the agent in the middle of its task. The conversation is saved: it is listed on the left under "Ended in the last day", and in History.',
    });
    if (response !== 0) return false;
  }
  return chats.holdClose(id);
});
ipcMain.handle('desk:unclose', (_event, id) => (typeof id === 'string' ? chats.undoClose(id) : false));
ipcMain.handle('desk:pick-folder', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog(win, { properties: ['openDirectory'], title: 'Folder for the new chat' });
  return canceled || !filePaths.length ? null : filePaths[0];
});
ipcMain.handle('desk:recent', async () => (SELFTEST_DIR && settings.record.folder ? null : await askWatcher('recent')) || { chats: [], folders: [] });
ipcMain.handle('desk:usage', (_event, range) => askWatcher('usage', { range: RANGES.includes(range) ? range : 'today' }));
// what was typed into a prompt box, ever, that holds the words asked for: read from Claude Code's own prompt history
ipcMain.handle('desk:typed', async (_event, query) => {
  if (SELFTEST_DIR && settings.record.folder) return [];
  if (typeof query !== 'string' || query.trim().length < 3) return [];
  return (await askWatcher('typed', { query: query.slice(0, 200) })) || [];
});
ipcMain.handle('desk:find', (_event, q) => {
  if (typeof q !== 'string' || q.trim().length < 1) return { ready: true, results: [], understood: [], progress: { ...findProgress } };
  return askFinder('search', { q: q.trim().slice(0, 500) });
});
// asked once the words searched have stayed the same for a moment: one call to Jev per search
ipcMain.handle('desk:find-sort', (_event, q) => findSorted(q));
// Jev's switch and key. The key comes in once and is locked away; what goes back says only whether there is one.
ipcMain.handle('desk:jev', (_event, what, value) => {
  if (!jev) return null;
  if (what === 'on' && typeof value === 'boolean') return jev.setOn(value);
  if (what === 'key' && typeof value === 'string') return jev.setKey(value);
  return jev.view();
});
// One page of a conversation, read from its transcript: what was asked, said and done. The page names a session
// by its id; which file that is, is worked out by the watcher, among the CLI's own transcripts only.
const READ_KEY = /^(job:[0-9a-f]{6,40}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;
const AGENT_KEY = /^[0-9a-z]{6,40}$/i;
const offset = (n) => (Number.isFinite(n) && n >= 0 ? Math.floor(n) : undefined);
ipcMain.handle('desk:read', (_event, ask) => {
  if (!ask || typeof ask.key !== 'string' || !READ_KEY.test(ask.key)) return null;
  const agent = typeof ask.agent === 'string' && AGENT_KEY.test(ask.agent) ? ask.agent : '';
  return askWatcher('read', { key: ask.key, agent, before: offset(ask.before) || 0, after: offset(ask.after) });
});
ipcMain.handle('desk:history', () => askWatcher('history'));
ipcMain.handle('desk:record', (_event, ask) => askRecord(ask));
// The servers page: what runs, and what the person asks of it. A program this app did not start is named by its number
// and start time as the page was shown it; servers.cjs checks both again before anything is ended.
const SERVER_ID = /^s[0-9a-z]{6,12}$/;
const holderOf = (x) => (x && Number.isInteger(x.pid) && Number.isFinite(x.started) ? { pid: x.pid, started: x.started } : null);
ipcMain.handle('desk:servers', async (_event, what, a, b) => {
  if (!servers) return null;
  const id = typeof a === 'string' && SERVER_ID.test(a) ? a : '';
  const plain = (x) => (x && typeof x === 'object' ? x : null);
  if (what === 'view') return servers.view;
  if (what === 'watch') { serversWatched = a === true; if (serversWatched) serversTick(); return servers.view; }
  if (what === 'look') return servers.fresh();
  if (what === 'start') return id ? servers.start(id) : null;
  if (what === 'stop') return id ? servers.stop(id, holderOf(b)) : null;
  if (what === 'restart') return id ? servers.restart(id, holderOf(b)) : null;
  if (what === 'stop-loose') return typeof a === 'string' ? servers.stopLoose(a, holderOf(b)) : null;
  if (what === 'add') return plain(a) ? servers.add(a) : null;
  if (what === 'update') return id && plain(b) ? servers.update(id, b) : null;
  if (what === 'remove') return id ? servers.remove(id) : null;
  if (what === 'hide') return servers.hide(a, b !== false);
  if (what === 'output') return id ? servers.output(id) : null;
  if (what === 'guess') return typeof a === 'string' ? servers.guess(a) : null;
  if (what === 'scripts') return typeof a === 'string' ? scriptsOf(a) : [];
  if (what === 'pick-folder') {
    const { canceled, filePaths } = await dialog.showOpenDialog(win, { properties: ['openDirectory'], title: 'The folder the server runs in' });
    return canceled || !filePaths.length ? null : filePaths[0];
  }
  return null;
});
// the person asks for everything to be read again now: sessions, who is logged in, what the chats last said about the limits
ipcMain.handle('desk:refresh', () => askWatcher('refresh'));
// Shows a conversation's own file in Explorer.
ipcMain.handle('desk:show-file', async (_event, key, agent) => {
  if (typeof key !== 'string' || !READ_KEY.test(key) || HIDDEN) return false;
  const file = await askWatcher('file', { key, agent: typeof agent === 'string' && AGENT_KEY.test(agent) ? agent : '' });
  const root = path.join(os.homedir(), '.claude', 'projects') + path.sep;
  if (typeof file !== 'string' || !file.toLowerCase().startsWith(root.toLowerCase()) || !fs.existsSync(file)) return false;
  shell.showItemInFolder(file);
  return true;
});
ipcMain.on('desk:forget', (_event, id) => {
  if (worker && typeof id === 'string' && SESSION_ID.test(id)) worker.postMessage({ type: 'forget', id });
});
ipcMain.on('desk:previous-done', () => {
  previous = [];
  restoring = false;
  saveOpen();
});
ipcMain.handle('desk:settings', (_event, patch) => {
  if (patch && typeof patch === 'object') {
    const notify = patch.notify && typeof patch.notify === 'object' ? patch.notify : {};
    for (const key of Object.keys(settings.notify)) if (typeof notify[key] === 'boolean' && typeof settings.notify[key] === 'boolean') settings.notify[key] = notify[key];
    if (!settings.notify.cards) noteDrop(() => true);
    if (CORNERS.includes(notify.corner) && notify.corner !== settings.notify.corner) { settings.notify.corner = notify.corner; notesPlace(); notesTell(); }
    if (Number.isFinite(patch.fontSize)) settings.fontSize = clamp(Math.round(patch.fontSize), 10, 26);
    if (typeof patch.inspector === 'boolean') settings.inspector = patch.inspector;
    if (TILES.includes(patch.tiles)) settings.tiles = patch.tiles;
    if (patch.split === 2 || patch.split === 4) settings.split = patch.split;
    if (typeof patch.solid === 'boolean') settings.solid = patch.solid;
    if (LOOKS.includes(patch.look) && patch.look !== settings.look) { settings.look = patch.look; frameColors(); notesTell(); }
    if (typeof patch.motion === 'boolean') settings.motion = patch.motion;
    if (CLOSE_CHOICES.includes(patch.keepChats)) settings.keepChats = patch.keepChats;
    takeNames(settings.accountNames, patch.accountNames);
    const spaces = takeSpaces(patch.spaces);
    if (spaces) settings.spaces = spaces;
    if (typeof patch.space === 'string') settings.space = patch.space;
    // the workspace in front is one that exists: taken away, the window shows every chat again
    if (!settings.spaces.some((s) => s.id === settings.space)) settings.space = '';
    settings.also = takeAlso(Object.hasOwn(patch, 'also') ? patch.also : settings.also, settings.spaces, settings.space);
    if (Object.hasOwn(patch, 'pins')) settings.pins = takePins(patch.pins);
    // a workspace taken away takes its own model and thinking with it
    settings.claude = takeClaude(patch.claude, settings.claude, settings.spaces);
    if (!SELFTEST_DIR && patch.record && typeof patch.record.folder === 'string') settings.record = { folder: recordFolder(patch.record.folder.trim()) };
    if (typeof patch.nestKey === 'boolean' && patch.nestKey !== settings.nestKey) { settings.nestKey = patch.nestKey; nestKey(); }
    if (NEST_LOOKS.includes(patch.nestLook)) settings.nestLook = patch.nestLook;
    if (patch.browser && typeof patch.browser === 'object') {
      if (typeof patch.browser.popOpen === 'boolean') { settings.browser.popOpen = patch.browser.popOpen; if (browser) browser.popOpen = patch.browser.popOpen; }
      if (typeof patch.browser.on === 'boolean' && patch.browser.on !== settings.browser.on) { settings.browser.on = patch.browser.on; offerBrowser(); }
      const ask = askList(patch.browser.ask);
      if (ask) settings.browser.ask = ask;
    }
    if (patch.float && typeof patch.float === 'object') floatSet(patch.float);
    if (patch.work && typeof patch.work === 'object') {
      settings.work = takeWork(patch.work, settings.work);
      // the clock switched on or off, or the usual shifts moved: what the title bar shows moves with them
      if (work) send('desk:work', work.view());
    }
    saveSettings();
  }
  return shownSettings();
});
// The Browser: what its panel asks for, and where the panel's page area is (browser.cjs)
ipcMain.handle('desk:browser', (_event, what, a, b) => (browser && typeof what === 'string' ? browser.ask(what, a, b) : null));
ipcMain.on('desk:browser-place', (_event, p) => { if (browser) browser.place(p); });
// The Viewer's page: what it holds, the person's own files (picked or dropped), a copy the page could not do without,
// a file shown in its folder or opened in its own program.
ipcMain.handle('desk:viewer', async (_event, what, a, b) => {
  if (!viewer || typeof what !== 'string') return null;
  if (what === 'view') return viewer.view();
  if (what === 'dialog') {
    if (!win || win.isDestroyed() || HIDDEN) return { shown: 0, refused: [] };
    const r = await dialog.showOpenDialog(win, { title: 'Open pictures, videos or sounds', properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Pictures, videos and sounds', extensions: VIEWER_EXTENSIONS }, { name: 'Every file', extensions: ['*'] }] });
    if (r.canceled || !r.filePaths.length) return { shown: 0, refused: [] };
    return viewer.request('open', r.filePaths, typeof a === 'string' ? a : '');
  }
  if (what === 'reveal' || what === 'external') {
    const r = await viewer.request('path', a);
    if (!r.path) return r;
    if (what === 'reveal') { shell.showItemInFolder(r.path); return {}; }
    // a file whose name does not say what it is could be a program: it is never started
    if (!r.known) return { error: 'Only a file named as a picture, a video or a sound is opened in its own program.' };
    const said = await shell.openPath(r.path);
    return said ? { error: said } : {};
  }
  return viewer.request(what, a, b);
});
ipcMain.on('desk:viewer-reply', (_event, id, result) => { if (viewer) viewer.answer(Number(id), result && typeof result === 'object' ? result : {}); });
// The shift clock: ('view'), ('day', working day), ('week'), and what the person does with it (work.cjs act)
ipcMain.handle('desk:work', (_event, what, value) => {
  if (!work || typeof what !== 'string') return null;
  if (what === 'view') return work.view();
  if (what === 'day') return work.dayView(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : undefined);
  if (what === 'week') return work.weekView();
  if (['start', 'usual', 'length', 'add', 'end'].includes(what)) return work.act(what, value);
  return null;
});
ipcMain.handle('desk:shortcut', (_event, kind, on) => {
  const file = linkFile(kind);
  try {
    if (!file || HIDDEN) return linkState();
    // started with Windows, it waits by the clock instead of opening over whatever is on screen
    if (on) writeLink(file, kind === 'startup' ? '--tray' : '');
    else fs.rmSync(file, { force: true });
  } catch (err) {
    log(`shortcut ${kind}: ${err.message}`);
  }
  return linkState();
});
// Copy and paste go through here: the page itself has no access to the clipboard.
ipcMain.handle('desk:clip-read', () => clipboard.readText());
ipcMain.on('desk:clip-write', (_event, text) => {
  if (typeof text === 'string' && text) clipboard.writeText(text.slice(0, 4 * 1024 * 1024));
});
ipcMain.on('desk:open-url', (_event, url) => {
  // web addresses only: nothing a terminal prints may start a program
  if (typeof url === 'string' && url.length < 2048 && /^https?:\/\/[^\s]+$/i.test(url)) shell.openExternal(url).catch(() => {});
});
ipcMain.on('desk:open-folder', (_event, dir) => {
  if (typeof dir === 'string' && isDir(dir)) shell.openPath(dir);
});
ipcMain.handle('desk:paths-exist', (_event, id, files) => pathFiles(files, chatFolder(id)));
ipcMain.handle('desk:open-file', (_event, id, file, line, column) => openChatFile(id, file, line, column));
ipcMain.on('desk:badge', (_event, image, text, n) => {
  // the window leaves out the waits the person has seen: the note on the Lowlit icon near the clock counts as it does
  pageCalls = Number.isInteger(n) && n >= 0 ? n : -1;
  trayTip();
  if (!win || win.isDestroyed() || HIDDEN) return;
  // the small mark on the taskbar button: how many sessions want the person
  if (typeof image === 'string' && image.startsWith('data:image/png;base64,') && image.length < 60000) {
    win.setOverlayIcon(nativeImage.createFromDataURL(image), String(text || '').slice(0, 80));
  } else {
    win.setOverlayIcon(null, '');
  }
});
ipcMain.on('desk:watch-again', () => watchAgain());
// the person asks to quit from the window: the same as closing it
ipcMain.on('desk:quit', () => leave());
// The person's answer to "what about your chats?": keep them for next time, start fresh, or keep running by the
// clock. remember: the same answer every time from now on (Settings can change it).
const ANSWERS = { keep: 'always', fresh: 'never', tray: 'tray', gaming: 'gaming' };
ipcMain.on('desk:leave', (_event, how, remember) => {
  if (!Object.hasOwn(ANSWERS, how)) return;
  if (remember === true) { settings.keepChats = ANSWERS[how]; saveSettings(); }
  if (how === 'tray') toTray(); else if (how === 'gaming') gaming(); else quit(how === 'keep');
});
// gaming mode asked for from the window (its search box), whatever the standing choice for a close
ipcMain.on('desk:gaming', () => gaming());
// which chat is in front: it is put in front again when the chats come back
ipcMain.on('desk:front', (_event, id) => {
  front = typeof id === 'string' ? id.slice(0, 20) : '';
  saveOpen();
});
// The Nest was closed. With its key, a window the key brought up goes back to how it was, by the clock or in the
// taskbar; closed any other way, the window stays where it is and how it was is forgotten.
ipcMain.on('desk:nest-left', (_event, byKey) => {
  const was = summoned;
  summoned = null;
  if (byKey !== true || !was || !win || win.isDestroyed()) return;
  if (was.hidden && tray) win.hide();
  else if (was.hidden || was.minimized) win.minimize();
});

// ---- the Browser: web pages the chats open, read and click in, beside them in this window ----
/** The chat this window knows by its program's number: who drives a page, as the panel names it. */
function chatOfPid(pid) {
  const c = pid ? latest.chats.find((x) => x.pid === pid) : null;
  return c ? { name: nameOf(c), key: c.key || '', chat: c.chat || '', cwd: c.cwd || '' } : null;
}

/** The Browser's pages, and Claude Code's way in to them on this computer only (browser-mcp.cjs). */
async function startBrowser() {
  browser = new Browser({
    win,
    send: (view) => send('desk:browser', view),
    command: (_name, arg) => send('desk:browser-do', arg),
    log,
    // what a test run downloads stays in its own folder
    downloads: SELFTEST_DIR ? path.join(SELFTEST_DIR, 'downloads') : app.getPath('downloads'),
    hidden: HIDDEN,
    record: nestFolders,
    ask: () => settings.browser.ask,
  });
  browser.popOpen = settings.browser.popOpen;
  browser.door = { on: settings.browser.on, listed: false, said: '', busy: false, port: 0 };
  door = new Door({ browser, viewer, token: settings.browser.token, log, who: chatOfPid });
  // a test run takes whatever port is free: the person's own window may hold the usual one
  const ports = SELFTEST_DIR ? [0] : [...new Set([settings.browser.port, ...Array.from({ length: 10 }, (_, i) => BROWSER_PORT + i)])];
  for (const port of ports) {
    try { await door.listen(port); break; } catch (err) { log(`browser: port ${port} is taken (${err.code || err.message})`); }
  }
  if (!door.port) {
    browser.door = { ...browser.door, said: 'no port was free for it on this computer.' };
    browser.changed();
    return;
  }
  browser.door.port = door.port;
  if (!SELFTEST_DIR && door.port !== settings.browser.port) { settings.browser.port = door.port; saveSettings(); }
  browserTimer = setInterval(() => browser.sweep((owner) => door.gone(owner)), 60000);
  // Claude Code's list of tools is the person's own: a test run never writes to it
  if (!SELFTEST_DIR) offerBrowser();
}

/**
 * The shift clock and the record of the day (work.cjs). The time since the last key or mouse move comes from Windows;
 * the chat in front is the one the page last said. A test run steps the clock by hand.
 */
function startWork() {
  work = new Work({
    file: path.join(app.getPath('userData'), 'work.json'),
    cfg: () => settings.work,
    idle: () => powerMonitor.getSystemIdleTime(),
    focused: () => Boolean(win) && !win.isDestroyed() && win.isVisible() && !win.isMinimized() && win.isFocused(),
    front: () => {
      const c = front ? latest.chats.find((x) => x.chat === front) : null;
      return c && c.key ? { key: c.key, title: nameOf(c), cwd: c.cwd || '' } : null;
    },
    own: path.basename(process.execPath),
    log,
    changed: () => send('desk:work', work.view()),
    over: shiftOver,
  });
  if (!SELFTEST_DIR) {
    work.start();
    return;
  }
  // a test run never asks the person's ActivityWatch: what it would answer is the test's own
  work.ask = async () => null;
  work.load();
}
/** A shift's time is up: on a card in the window when the person is looking at it, on a note over the other programs otherwise. */
function shiftOver(s) {
  const title = `${s.name === 'Shift' || s.name === 'Countdown' ? 'Your countdown' : `Your ${s.name.toLowerCase()} shift`}: the time is up`;
  const length = Math.round(((s.end - s.start) / 3600e3) * 4) / 4;
  const body = `${length} hour${length === 1 ? '' : 's'} since ${new Date(s.start).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}. The clock counts on until you stop.`;
  if (deskInFront()) send('desk:command', 'card', { text: `${title}. ${body}`, kind: 'shift', title, body, target: 'stats' });
  else if (settings.notify.shift && !HIDDEN) noteUp({ kind: 'shift', title, body, target: 'stats' });
}


/** The Viewer: what it shows lives here, and its files reach the page only by the names it gives them (viewer.cjs). */
function startViewer() {
  viewer = new Viewer({ send, log, dir: path.join(app.getPath('userData'), 'viewer-cache'), record: nestFolders, where: (drv) => drv.cwd || '' });
  protocol.handle(VIEWER_SCHEME, (request) => viewer.serve(request));
}

/** Puts the browser in Claude Code's own list of tools, or takes it out, as Settings has it. One change at a time. */
let offering = false;
let offerAgain = false;
async function offerBrowser() {
  if (!door || !door.port || !browser || SELFTEST_DIR) return;
  if (offering) { offerAgain = true; return; }
  offering = true;
  try {
    do {
      offerAgain = false;
      const on = settings.browser.on;
      browser.door = { ...browser.door, on, busy: true };
      browser.changed();
      const r = on ? await register({ port: door.port, token: settings.browser.token, env: chats.env, log })
        : await unregister({ env: chats.env, log });
      browser.door = { on, listed: on && r.ok, said: r.said, busy: false, port: door.port };
      browser.changed();
    } while (offerAgain && !quitting);
  } finally {
    offering = false;
  }
}

// ---- the Nest: the chat that works in the person's record, one key away from any program ----
/**
 * The folders a chat must work in to be the Nest's: the record's folder as Settings has it, and where it really is
 * (one can be a junction to the other). Whole paths, for the page to compare with the folder of each chat.
 */
function nestFolders() {
  const f = settings.record.folder;
  if (!f || !isDir(f)) return [];
  const list = new Set([path.resolve(f)]);
  try { list.add(fs.realpathSync.native(f)); } catch { /* the folder went away meanwhile */ }
  return [...list];
}

/** The key from any program, held while Settings has it on. A program that holds it already keeps it: Settings says so. */
function nestKey() {
  if (nestKeyState === 'on') globalShortcut.unregister(NEST_KEY);
  nestKeyState = 'off';
  // a hidden test window never takes a key away from the person's own
  if (HIDDEN || !settings.nestKey) return;
  let ok = false;
  try { ok = globalShortcut.register(NEST_KEY, nestPressed); } catch (err) { log(`the Nest's key: ${err.message}`); }
  nestKeyState = ok ? 'on' : 'taken';
  if (!ok) log(`the Nest's key ${NEST_KEY} is held by another program`);
}

/**
 * The key, pressed in any program: the window comes up with the Nest in front. Pressed while the window is in front,
 * the Nest opens or closes, and a window the key brought up goes back to how it was (desk:nest-left).
 */
function nestPressed() {
  if (!win || win.isDestroyed() || quitting) return;
  const inFront = win.isVisible() && !win.isMinimized() && win.isFocused();
  if (!inFront) {
    summoned = { hidden: !win.isVisible(), minimized: win.isMinimized() };
    showWindow();
  }
  openNest(inFront ? 'toggle' : 'open');
}

/** The Nest, asked for by its key, the tray or the taskbar: the page opens it now, or as soon as it is up. */
function openNest(how = 'open') {
  if (pageUp) send('desk:command', 'nest', how);
  else nestAsked = true;
}

/** "Open the Nest" in the menu of the app's button on the taskbar: the app started the way the taskbar starts it, with --nest. */
function nestTask() {
  try {
    app.setUserTasks([{ program: WSCRIPT, arguments: `"${LAUNCHER}" ${NEST_FLAG}`, iconPath: ICON, iconIndex: 0,
      title: 'Open the Nest', description: 'The chat of your record, with what only you can do today' }]);
  } catch (err) {
    log(`the taskbar menu: ${err.message}`);
  }
}

// ---- the floating card: the chat in front, in a small window of its own over every other program. The page says
// ---- what it shows (desk:float); float.js draws it. It steps aside while this window is in front, where it would lie
// ---- over the window's own top left corner, unless the person keeps it there too. ----
let floatWin = null;
let floatModel = null;            // what the page last said it shows; null: nothing to show
let floatPeek = 0;                // switched on a moment ago: shown over this window too until then
let floatPeekTimer = null;
const FLOAT_W = 336;              // the card, 320px, and the margin its shadow falls in (float.css)
const FLOAT_EDGE = 4;             // from the corner of the screen to the window: the card stands 12px in
const FLOAT_PEEK_MS = 4000;

const floatUp = () => Boolean(floatWin && !floatWin.isDestroyed() && floatWin.isVisible());
const deskSeen = () => Boolean(win && !win.isDestroyed() && win.isVisible() && !win.isMinimized());
/** The watcher looks every 2 s while this window or the card can be seen, every 6 s otherwise. */
const paceNow = () => (deskSeen() || floatUp() ? 2000 : 6000);

/** Where the card goes: where it was put, while that is on a screen that is plugged in; else the top left corner of the screen the window is on. */
function floatSpot() {
  const f = settings.float;
  if (Number.isFinite(f.x) && Number.isFinite(f.y)) {
    const area = screen.getDisplayMatching({ x: f.x, y: f.y, width: FLOAT_W, height: 80 }).workArea;
    if (f.x >= area.x - 8 && f.x + 120 <= area.x + area.width && f.y >= area.y - 8 && f.y + 40 <= area.y + area.height) return { x: Math.round(f.x), y: Math.round(f.y) };
  }
  const area = (win && !win.isDestroyed() ? screen.getDisplayMatching(win.getBounds()) : screen.getPrimaryDisplay()).workArea;
  return { x: area.x + FLOAT_EDGE, y: area.y + FLOAT_EDGE };
}

/** Whether the card lies over this window, where it is or where it would go. */
function floatOverDesk() {
  if (!deskSeen()) return false;
  const a = floatWin && !floatWin.isDestroyed() ? floatWin.getBounds() : { ...floatSpot(), width: FLOAT_W, height: 200 };
  const b = win.getBounds();
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

/**
 * The card shows while it is switched on and has something to show. While this window is in front, which shows the
 * same, it steps aside if it would lie over it. A hidden test window never shows it.
 */
function floatWanted() {
  if (!settings.float.on || !floatModel || HIDDEN || quitting) return false;
  if (settings.float.overDesk || Date.now() < floatPeek) return true;
  return !(win.isFocused() && floatOverDesk());
}

/** The card made, shown, hidden or closed to match. pace: the watcher is told when it comes or goes (presence tells it itself). */
function floatSync(pace = true) {
  if (!settings.float.on || quitting) { floatClose(); return; }
  if (!floatWin || floatWin.isDestroyed()) makeFloat();
  const was = floatUp();
  const want = floatWanted();
  if (want && !was) floatWin.showInactive();
  else if (!want && was) floatWin.hide();
  // the notes stand under the card where they meet: it came or went
  if (want !== was) notesPlace();
  if (pace && want !== was && worker) worker.postMessage({ type: 'pace', ms: paceNow() });
}

function makeFloat() {
  const at = floatSpot();
  floatWin = new BrowserWindow({
    x: at.x, y: at.y, width: FLOAT_W, height: 160,
    show: false, frame: false, transparent: true, backgroundColor: '#00000000', hasShadow: false,
    resizable: false, maximizable: false, minimizable: false, fullscreenable: false,
    // over every other window, never on the taskbar, and never taking the keyboard from what is being typed into
    alwaysOnTop: true, skipTaskbar: true, focusable: false,
    title: 'Lowlit card',
    icon: ICON,
    webPreferences: {
      preload: path.join(__dirname, 'float-preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      // its figures tick while every other window is in front: that is when it is looked at
      backgroundThrottling: false,
    },
  });
  keepOnTop(floatWin);
  floatWin.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  floatWin.webContents.on('will-navigate', (event) => event.preventDefault());
  floatWin.webContents.on('did-finish-load', floatTell);
  // where it is put is kept (written once it rests: saveSettings waits)
  floatWin.on('move', () => {
    if (!floatWin || floatWin.isDestroyed()) return;
    const b = floatWin.getBounds();
    settings.float.x = b.x;
    settings.float.y = b.y;
    saveSettings();
    notesPlace();
  });
  floatWin.on('closed', () => { floatWin = null; });
  floatWin.loadFile(path.join(__dirname, 'float.html')).catch((err) => log(`floating card not loaded: ${err.message}`));
}

/** Hands the card what it shows, and how (small, also over this window). Sent while its page loads, it is lost; did-finish-load sends it again. */
function floatTell() {
  if (!floatWin || floatWin.isDestroyed()) return;
  floatWin.webContents.send('float:model', floatModel, { small: settings.float.small, overDesk: settings.float.overDesk });
}

function floatClose() {
  clearTimeout(floatPeekTimer);
  if (floatWin && !floatWin.isDestroyed()) floatWin.destroy();
  floatWin = null;
}

/** Its switches: { on, small, overDesk }. Switched on, it shows for a moment even over this window, so it can be seen where it is. */
function floatSet(patch) {
  const f = settings.float;
  if (typeof patch.small === 'boolean') f.small = patch.small;
  if (typeof patch.overDesk === 'boolean') f.overDesk = patch.overDesk;
  if (typeof patch.on === 'boolean' && patch.on !== f.on) {
    f.on = patch.on;
    if (f.on) {
      floatPeek = Date.now() + FLOAT_PEEK_MS;
      clearTimeout(floatPeekTimer);
      floatPeekTimer = setTimeout(() => floatSync(), FLOAT_PEEK_MS + 50);
    } else floatModel = null;
  }
  saveSettings();
  floatTell();
  floatSync();
}

// What the card shows, from the page: drawn there as words, so only its size is looked at here
ipcMain.on('desk:float', (_event, model) => {
  let size = Infinity;
  try { size = JSON.stringify(model).length; } catch { /* not plain data */ }
  floatModel = model && typeof model === 'object' && size < 64 * 1024 ? model : null;
  if (!settings.float.on) return;
  floatTell();
  floatSync();
});
// what the card's own page asks: only from that page
const fromCard = (event) => Boolean(floatWin && !floatWin.isDestroyed() && event.sender === floatWin.webContents);
ipcMain.on('float:size', (event, height) => {
  if (!fromCard(event)) return;
  const tall = Math.round(Number(height));
  if (!Number.isFinite(tall) || tall < 40 || tall > 1400) return;
  const b = floatWin.getBounds();
  if (b.height === tall && b.width === FLOAT_W) return;
  floatWin.setBounds({ x: b.x, y: b.y, width: FLOAT_W, height: tall });
  notesPlace();
});
ipcMain.on('float:go', (event, target) => {
  if (!fromCard(event) || typeof target !== 'string' || !target || target.length > 80) return;
  // a test window stays hidden
  if (!HIDDEN) showWindow();
  send('desk:command', 'goto', target);
});
ipcMain.on('float:set', (event, patch) => {
  if (!fromCard(event) || !patch || typeof patch !== 'object') return;
  floatSet(patch);
  // the page keeps its own copy of the switches (its key, its line in the palette)
  send('desk:command', 'float', { on: settings.float.on, small: settings.float.small, overDesk: settings.float.overDesk });
});

// what the notes' own page asks: only from that page
const fromNotes = (event) => Boolean(notesWin && !notesWin.isDestroyed() && event.sender === notesWin.webContents);
ipcMain.on('notes:size', (event, height) => {
  if (!fromNotes(event)) return;
  const tall = Math.round(Number(height));
  if (!Number.isFinite(tall) || tall < 40 || tall > 1400) return;
  const b = notesWin.getBounds();
  if (b.height !== tall || b.width !== NOTES_W) notesWin.setBounds({ x: b.x, y: b.y, width: NOTES_W, height: tall });
});
ipcMain.on('notes:close', (event, id) => {
  if (fromNotes(event) && typeof id === 'string') noteDrop((n) => n.id === id);
});
ipcMain.on('notes:clear', (event) => {
  if (fromNotes(event)) noteDrop(() => true);
});
ipcMain.on('notes:open', (event, id) => {
  if (!fromNotes(event) || typeof id !== 'string') return;
  const n = notes.find((x) => x.id === id);
  if (!n) return;
  noteDrop((x) => x.id === id);
  // a test window stays hidden
  if (!HIDDEN) showWindow();
  if (n.target) send('desk:command', 'goto', n.target);
});

// ---- the window, the tray, leaving ----
function showWindow() {
  if (!win || win.isDestroyed()) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

/** Where the window was last time, as long as that place is still on a screen that is plugged in. */
function lastBounds() {
  const b = settings.bounds;
  if (!b || ![b.x, b.y, b.width, b.height].every(Number.isFinite)) return {};
  const area = screen.getDisplayMatching(b).workArea;
  const reachable = b.x + b.width > area.x + 120 && b.x < area.x + area.width - 120 && b.y >= area.y - 8 && b.y < area.y + area.height - 80;
  return reachable ? { x: b.x, y: b.y, width: b.width, height: b.height } : { width: b.width, height: b.height };
}

// ---- what the window is drawn on: screens coming, going or changing, the window going to another screen, the
// ---- computer sleeping and waking, the graphics process ending. Each is a line in the app's log, and once they settle
// ---- the window is drawn again from scratch: a page left as it was can show shifted, at the old scaling, or stale. ----
const REDRAW_AFTER_MS = 700;
const WAKE_MS = 2500;
let redrawTimer = null;
let redrawWhy = new Set();
let onScreen = null;           // the screen the window was last on: { id, name }
const screenName = (d) => (d && d.size ? `${d.size.width} x ${d.size.height} at ${Math.round((d.scaleFactor || 1) * 100)}%${d.displayFrequency ? `, ${Math.round(d.displayFrequency)} Hz` : ''}${d.internal ? ', the laptop\'s own' : ''}` : 'size not given');
function redrawSoon(why) {
  redrawWhy.add(why);
  clearTimeout(redrawTimer);
  redrawTimer = setTimeout(redrawWindow, REDRAW_AFTER_MS);
}
function redrawWindow() {
  redrawTimer = null;
  const why = [...redrawWhy].join(', ');
  redrawWhy = new Set();
  if (!win || win.isDestroyed()) return;
  repaint();
  send('desk:command', 'redraw');
  log(`screen: the window drawn again (${why})`);
}
/** Chromium draws the whole page again, and Windows the strip behind the window's own three buttons. */
function repaint() {
  try { win.webContents.invalidate(); } catch { /* the page is between two loads */ }
  frameColors();
}
function windowScreen() {
  if (!win || win.isDestroyed() || win.isMinimized()) return;
  const d = screen.getDisplayMatching(win.getBounds());
  const was = onScreen;
  onScreen = { id: d.id, name: screenName(d) };
  if (!was || was.id === d.id) return;
  log(`screen: the window went to the ${onScreen.name} screen (it was on the ${was.name} one)`);
  redrawSoon('it changed screen');
}
function watchScreens() {
  screen.on('display-added', (_e, d) => { log(`screen: a screen came (${screenName(d)})`); redrawSoon('a screen came'); windowScreen(); });
  screen.on('display-removed', (_e, d) => { log(`screen: a screen went (${screenName(d)})`); redrawSoon('a screen went'); windowScreen(); });
  screen.on('display-metrics-changed', (_e, d, changed) => {
    // the taskbar moving or hiding changes only the work area: nothing is drawn differently for that
    const real = (Array.isArray(changed) ? changed : []).filter((c) => c !== 'workArea');
    if (!real.length) return;
    log(`screen: a screen changed its ${real.join(' and ')} (${screenName(d)})`);
    redrawSoon('a screen changed');
    windowScreen();
  });
  powerMonitor.on('suspend', () => log('screen: the computer went to sleep'));
  // the screens take a few seconds to come back on after a wake: drawn once they have
  powerMonitor.on('resume', () => { log('screen: the computer woke up'); setTimeout(() => redrawSoon('the computer woke up'), WAKE_MS); });
  powerMonitor.on('unlock-screen', () => redrawSoon('Windows was unlocked'));
  app.on('child-process-gone', (_e, details) => {
    if (!details || details.type !== 'GPU') return;
    log(`screen: the graphics process ended (${details.reason}, code ${details.exitCode}); Chromium starts it again`);
    redrawSoon('the graphics process started again');
  });
}

/** The ground of the window and of the strip behind its own three buttons, in the look picked: none when see-through. */
const ground = () => (glassOn ? '#00000000' : settings.look === 'grey' ? BASE : '#000000');
const overlay = () => ({ color: ground(), symbolColor: settings.look === 'grey' ? '#a4a9b6' : '#a8a8a8', height: 46 });
function frameColors() {
  if (!win || win.isDestroyed()) return;
  try {
    if (!glassOn) win.setBackgroundColor(ground());
    win.setTitleBarOverlay(overlay());
  } catch (err) { log(`frame colours: ${err.message}`); }
}

function createWindow() {
  // See-through: Windows blurs the desktop behind the window (11, 22H2 and later), and the page leaves its sidebar
  // and title bar half out. Decided when the window is made: it cannot be changed on one that is already open.
  // A window that is never shown has no desktop behind it.
  glassOn = !settings.solid && !HIDDEN && windowsBuild >= 22621;
  // The page is dark whatever Windows is set to: the blur behind it and the window's own three buttons follow.
  nativeTheme.themeSource = 'dark';
  win = new BrowserWindow({
    width: 1360,
    height: 860,
    ...(HIDDEN ? {} : lastBounds()),
    minWidth: 760,
    minHeight: 460,
    show: false,
    backgroundColor: ground(),
    ...(glassOn ? { backgroundMaterial: 'acrylic' } : {}),
    title: 'Lowlit',
    icon: ICON,
    titleBarStyle: 'hidden',
    titleBarOverlay: overlay(),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      // A minimised window still owns live consoles: their output must keep being read at full speed.
      backgroundThrottling: false,
    },
  });
  // The taskbar goes by what a window says it is. Unsaid, its button is "Electron", and pinning it pins the
  // bare runtime, which opens an empty window: the window gives its own name and the command that starts it.
  win.setAppDetails({
    appId: APP_ID,
    appIconPath: ICON,
    appIconIndex: 0,
    relaunchCommand: `"${WSCRIPT}" "${LAUNCHER}"`,
    relaunchDisplayName: 'Lowlit',
  });
  // The page is this app's own file and nothing else: no new windows, no going anywhere.
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event) => event.preventDefault());
  win.webContents.on('render-process-gone', pageGone);
  loadPage(true);
  // --inactive: appear without taking the keyboard from whatever is being typed into. --tray: stay by the clock.
  if (!HIDDEN && !process.argv.includes('--tray')) {
    win.once('ready-to-show', () => (process.argv.includes('--inactive') ? win.showInactive() : win.show()));
  }
  if (settings.maximized && !HIDDEN && !process.argv.includes('--tray')) win.maximize();
  for (const change of ['show', 'hide', 'minimize', 'restore', 'focus', 'blur']) win.on(change, presence);
  // the window moved off the floating card, or onto it
  for (const change of ['move', 'resize']) win.on(change, () => { if (settings.float.on) floatSync(); });
  for (const change of ['resize', 'move', 'maximize', 'unmaximize']) {
    win.on(change, () => {
      if (HIDDEN || win.isMinimized() || !win.isVisible()) return;
      settings.bounds = win.getNormalBounds();
      settings.maximized = win.isMaximized();
      saveSettings();
    });
  }
  // on a screen of another scaling or graphics chip now: noted, and drawn again (watchScreens)
  for (const change of ['moved', 'resized', 'maximize', 'unmaximize', 'restore']) win.on(change, windowScreen);
  win.on('close', (event) => {
    // with no chat open there is nothing to decide; Windows going down decides for itself
    if (quitting || HIDDEN || ending || !chats.list().some((c) => !c.closing && !c.pendingClose)) return;
    event.preventDefault();
    leave();
  });
  // Windows is shutting down or signing out: what is open is written down now, and brought back at the next start
  for (const end of ['query-session-end', 'session-end']) {
    win.on(end, () => {
      ending = true;
      saveOpen();
      // said on disk, so the next start knows this run ended with Windows and not in a crash
      settings.running = 'windows';
      writeSettings();
      // still here a minute later: Windows did not go down after all
      clearTimeout(endTimer);
      endTimer = setTimeout(() => { ending = false; settings.running = true; writeSettings(); }, 60000);
    });
  }
  // the person went to another program: the Nest's key no longer puts the window back to how it was before
  win.on('blur', () => { summoned = null; });
  win.on('closed', () => { win = null; });
}

/** The window keeps running by the clock: its chats go on, and the icon brings it back. */
function toTray() {
  if (!win || win.isDestroyed() || !tray) return;
  win.hide();
  if (!settings.trayNoted) {
    tray.displayBalloon({ iconType: 'info', title: 'Lowlit is still running', content: 'Your chats keep going. Click the Lowlit icon near the clock to come back, right-click it to quit.' });
    settings.trayNoted = true;
    saveSettings();
  }
}

/** Leaving with chats open: what becomes of them is the person's to say, once, or every time. */
function leave() {
  if (quitting) return;
  const choice = settings.keepChats;
  // gaming mode every time: the servers end too, with or without a chat open
  if (choice === 'gaming') { gaming(); return; }
  if (!chats.list().some((c) => !c.closing && !c.pendingClose)) { quit(true); return; }
  if (choice === 'tray' && tray) toTray();
  else if (choice === 'always') quit(true);
  else if (choice === 'never') quit(false);
  else {
    showWindow();
    send('desk:command', 'ask-leave');
  }
}

function createTray() {
  tray = new Tray(ICON);
  tray.setToolTip('Lowlit');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open Lowlit', click: showWindow },
    { label: 'Open the Nest', click: () => { showWindow(); openNest('open'); } },
    { label: 'New chat', click: () => { showWindow(); send('desk:command', 'new'); } },
    { label: 'Dashboard', click: () => { showWindow(); send('desk:command', 'goto', 'stats'); } },
    // the page reloads itself when it is there (it keeps its place first); one that is gone is loaded from here
    { label: 'Reload the window (chats keep running)', click: () => { if (pageUp) send('desk:command', 'reload'); else reloadWindow(); } },
    { label: 'Restart Lowlit (chats keep running)', click: () => restartKeeping().then((done) => {
      if (!done && !quitting) { showWindow(); send('desk:command', 'say', 'Your chats cannot be kept through a restart right now: close the app and open it again, and they come back by themselves.'); }
    }) },
    { type: 'separator' },
    { label: 'Gaming mode: close everything, bring it back next time', click: () => gaming() },
    { label: 'Quit', click: () => leave() },
  ]));
  tray.on('click', showWindow);
  // the one note Windows still shows by the clock: that the window went there
  tray.on('balloon-click', showWindow);
}

/**
 * The Lowlit icon near the clock goes. A tray that was destroyed throws at every call, and the watcher still sends its
 * pictures for the seconds a close takes: from here on there is no tray to reach for.
 */
function dropTray() {
  if (!tray) return;
  tray.destroy();
  tray = null;
}

/**
 * Gaming mode (his ask, 5 Oct): nothing Lowlit runs is left to hold the computer while he plays. Every dev server
 * ends (the ones it started, the pinned ones started elsewhere, the others found running), then every chat, as at a
 * close that keeps them, and the keeper with them. At the next start the chats open again as they were and the servers
 * start again: the pinned ones as pinned, the others (his word, 6 Oct: "it's not relaunching the servers") by the
 * command that most likely started each, at its port; one known only as node or python cannot be, and is named.
 * Returns what it stopped. For the self-test: stop false leaves the app running, and only(folder) keeps it to the
 * test's own servers.
 */
let gamingAsked = false;
async function gaming({ stop = true, only = null } = {}) {
  if (quitting || gamingAsked) return null;
  gamingAsked = true;
  const n = chats.list().filter((c) => !c.closing && !c.pendingClose).length;
  // the window goes at once: what follows takes a few seconds
  if (stop && win && !win.isDestroyed() && !HIDDEN) win.hide();
  let got = { pinned: [], again: [], lost: [] };
  try {
    const r = servers ? await Promise.race([servers.stopAll(only), new Promise((done) => setTimeout(() => done(null), 30000))]) : got;
    if (r === null) log('gaming mode: the servers took more than 30 s to stop; the rest closes all the same');
    else got = r;
  } catch (err) { log(`gaming mode: servers: ${err && err.message}`); }
  settings.gaming = { at: Date.now(), servers: got.pinned, again: got.again, lost: got.lost };
  log(`gaming mode: ${n} chat(s) close, ${got.pinned.length + got.again.length + got.lost.length} server(s) stopped; the chats and ${got.pinned.length + got.again.length} server(s) come back at the next start`);
  const done = { chats: n, servers: got.pinned, again: got.again, lost: got.lost };
  if (!stop) { gamingAsked = false; saveSettings(); return done; }
  await quit(true);
  return done;
}

/**
 * Closes every chat (each agent ends its own session) and then the app. keep: the chats open now come back at
 * the next start; otherwise the next start is a fresh one.
 */
async function quit(keep = true) {
  if (quitting) return;
  saveOpen();
  if (!keep) { settings.open = []; previous = []; }
  // a close with no chat open asks nothing: the standing choice decides for the servers
  settings.serversBack = keep && settings.keepChats !== 'never';
  // it reached its end: the next start is not one after a crash
  clearTimeout(endTimer);
  settings.running = false;
  quitting = true;
  writeSettings();
  floatClose();
  notesClose();
  if (jev) jev.flush();
  // the servers it started go on running: only the watch over them ends
  clearTimeout(serversTimer);
  if (servers) servers.close();
  // the browser's pages close; Claude Code's list keeps its door, for the next start
  clearInterval(browserTimer);
  if (door) door.close();
  if (browser) browser.closeAll();
  // a copy the Viewer is making stops with the app
  if (viewer) viewer.stop();
  // the day so far is kept, and a shift running goes on from the same moment next time
  if (work) work.stop();
  if (win && !win.isDestroyed()) win.hide();
  dropTray();
  try { globalShortcut.unregisterAll(); } catch { /* already let go */ }
  await chats.closeAll();
  // with its consoles closed and no app, the keeper ends by itself
  if (keeper) await keeper.leave();
  await stopFinder();
  if (worker) {
    const gone = new Promise((done) => worker.once('exit', done));
    worker.postMessage({ type: 'stop' });
    await Promise.race([gone, new Promise((done) => setTimeout(done, 1500))]);
  }
  app.exit(0);
}

let restartAsked = false;
/**
 * Closes the app and opens it again (for newer code under it) with every chat running on: their consoles stay with
 * the keeper, and the next start takes them up again, and where the person was in the window. false: no keeper holds
 * them, so they cannot be kept (the page then says to close and reopen).
 */
async function restartKeeping() {
  if (restartAsked) return true;
  if (quitting || !keeper || !keeper.connected()) return false;
  restartAsked = true;
  let place = '';
  if (pageUp && win && !win.isDestroyed()) {
    place = await Promise.race([win.webContents.executeJavaScript('sessionStorage.getItem("desk-place")').catch(() => ''),
      new Promise((done) => setTimeout(() => done(''), 1500))]);
  }
  // a chat closed a moment ago, still in its Undo time, is not one to bring back
  const closing = chats.list().filter((c) => c.pendingClose && !c.closing).map((c) => chats.close(c.id));
  await Promise.race([Promise.all(closing), new Promise((done) => setTimeout(done, 16000))]);
  if (quitting) return true;
  if (!keeper.connected()) { restartAsked = false; return false; }
  // Written down whole, even while last time's chats are still being opened again: the ones open now (the next start
  // takes their consoles up from the keeper) and those of last time not opened yet.
  restoring = false;
  const open = chats.list().filter((c) => !c.closing && !c.pendingClose).map((c) => keptOf(c, sessionIn(c.id), c.id === front));
  settings.open = [...open, ...previous.map(({ order, ...p }) => p)];
  if (typeof place === 'string' && place && place.length < 64 * 1024) settings.place = place;
  clearTimeout(endTimer);
  settings.running = 'restart';
  quitting = true;
  writeSettings();
  floatClose();
  notesClose();
  log(`restarting; ${chats.list().length} chat(s) run on in the keeper`);
  if (jev) jev.flush();
  clearTimeout(serversTimer);
  if (servers) servers.close();
  clearInterval(browserTimer);
  if (door) door.close();
  if (browser) browser.closeAll();
  // a copy the Viewer is making stops with the app
  if (viewer) viewer.stop();
  // the day so far is kept, and a shift running goes on from the same moment next time
  if (work) work.stop();
  if (win && !win.isDestroyed()) win.hide();
  dropTray();
  try { globalShortcut.unregisterAll(); } catch { /* already let go */ }
  chats.flush();
  keeper.keep();
  await keeper.leave();
  await stopFinder();
  if (worker) {
    const gone = new Promise((done) => worker.once('exit', done));
    worker.postMessage({ type: 'stop' });
    await Promise.race([gone, new Promise((done) => setTimeout(done, 1500))]);
  }
  // a test run ends here: its next run is the next start
  if (!SELFTEST_DIR) app.relaunch({ args: process.argv.slice(1).filter((a) => a !== '--tray' && a !== '--inactive' && a !== NEST_FLAG) });
  app.exit(0);
  return true;
}

/**
 * The keeper (keeper.cjs) holds the consoles, so that the app can restart without ending what runs in them. One
 * found running for this profile hands back the consoles it held for the last run: they are this run's chats again,
 * under the same ids, and are not opened a second time from the list kept on disk. One that cannot be reached leaves
 * the consoles to live in the app, as before it existed.
 */
async function startKeeper(last) {
  keeper.onGone(() => { if (chats.keeper === keeper) chats.keeper = null; });
  // chats asked for while it is reached wait for it
  chats.keeper = keeper;
  // one just started holds nothing: the page need not wait for it
  if (keeper.fresh) { keeper.open().then(tellWatcher, () => { /* said in the log: the consoles live in the app */ }); return; }
  const held = await keeper.open();
  tellWatcher();
  const back = [];
  for (const h of held) {
    const got = await keeper.attach(h);
    if (!got) continue;
    const tail = new Tail();
    if (got.data) tail.append(got.data);
    tails.set(h.id, tail);
    back.push({ id: h.id, pid: h.pid, meta: h.meta, term: got.term });
  }
  if (!back.length) return;
  chats.adopt(back);
  const ids = new Set(back.map((c) => c.id));
  previous = previous.filter((p) => !ids.has(p.id));
  restore = restoreMode(previous.length, last, settings.keepChats);
  restoring = restore === 'auto' || restore === 'crash';
  adoption = { n: back.length, how: last };
  saveOpen();
  log(`${back.length} chat(s) ran on through ${last === 'restart' ? 'the restart' : 'the end of the last run'}: taken up again`);
}

/**
 * How the last run ended, from what it left in the settings file. `running` is written true at every start and
 * false at every proper end; 'windows' when Windows shut down or signed out under it; 'restart' when it closed to
 * open again with its chats running on. Still true: it never reached an end (closed by force, a crash, the power going).
 */
const lastEnd = (running) => (running === true ? 'crash' : running === 'windows' ? 'windows' : running === 'restart' ? 'restart' : 'clean');
/**
 * What becomes, at a start, of the chats that were open when the app last ran. open: how many there are. last:
 * how that run ended. After a proper close they are there because the person kept them: they open. After a crash
 * or a Windows shutdown they open too, unless the person chose to start fresh after every close: then they are
 * asked. 'crash' says so in the window; a Windows shutdown is nothing to remark on.
 */
const restoreMode = (open, last, keepChats) => (!open ? '' : last === 'clean' || last === 'restart' ? 'auto' : keepChats === 'never' ? 'ask' : last === 'crash' ? 'crash' : 'auto');
/**
 * Whether the servers started here that ran when the app last ran, and are gone now (Windows restarted meanwhile),
 * start again at this start. After a close: as the person chose for their chats then (back). After a crash, a
 * Windows shutdown or a restart: unless the choice is to start fresh after every close.
 */
const serversComeBack = (last, back, keepChats) => (last === 'clean' ? back !== false : keepChats !== 'never');

function start() {
  // The default menu owns Ctrl+W, Ctrl+R and friends; inside a terminal those keys belong to the CLI.
  Menu.setApplicationMenu(null);
  loadSettings();
  jev = Jev.create({ file: path.join(app.getPath('userData'), 'jev.json'), safe: safeStorage, post: jevPost, hide: hideSecrets, mine: isMine, log });
  jev.onChange(() => send('desk:jev', jev.view()));
  // what the first version kept its token counts in; the day-by-day counts live in another file
  try { fs.rmSync(path.join(app.getPath('userData'), 'counts.json'), { force: true }); } catch { /* still there, and harmless */ }
  starters = findStarters();
  editorExe = findEditor();
  previous = settings.open.filter((c) => c && typeof c.cwd === 'string' && isDir(c.cwd)).map((c, order) => ({ ...c, order }));
  const last = lastEnd(settings.running);
  restore = restoreMode(previous.length, last, settings.keepChats);
  restoring = restore === 'auto' || restore === 'crash';
  // the page opens them one after the other once it has loaded, up to 3.5 s apart, and says when it is done
  restoreUntil = Date.now() + 30000 + previous.length * 5000;
  if (last !== 'clean') log(`the last run ended ${last === 'crash' ? 'without closing properly' : last === 'restart' ? 'in a restart' : 'with Windows'}; ${previous.length} chat(s) to bring back`);
  settings.running = true;
  writeSettings();
  code.loaded('app');
  createWindow();
  watchScreens();
  windowScreen();
  // switched on last time: made now, and shown once the page says what it shows
  if (settings.float.on) floatSync();
  if (!HIDDEN) createTray();
  // the Nest: its key from any program, its line in the taskbar button's menu, and a start that asked for it
  if (process.argv.includes(NEST_FLAG)) nestAsked = true;
  nestKey();
  if (!HIDDEN) nestTask();
  // Before the watcher thread exists: the programs it starts could otherwise take a copy of the output pipe of the
  // ones read here, and the main process would wait on that pipe for as long as they run.
  chats.prepare();
  // the keeper of the consoles, for the same reason: started (when there is none to reach) before the watcher thread
  keeper = new Keeper({ dir: app.getPath('userData'), test: Boolean(SELFTEST_DIR), log });
  keeper.prepare();
  keeperReady = startKeeper(last).catch((err) => log(`keeper: ${err && err.message}; the consoles live in the app`));
  startWatcher();
  servers = new Servers({ dir: app.getPath('userData'), ask: (roots) => askWatcher('servers', { roots }, 12000), env: serverEnv,
    confirm: confirmStop, changed: (view) => send('desk:servers', view), log });
  // a test run's own made-up servers are never started again by a later run (the servers check does this on its own).
  // After gaming mode the servers it stopped start again as well.
  const g = settings.gaming && typeof settings.gaming === 'object' ? settings.gaming : {};
  const gamed = Array.isArray(g.servers) ? g.servers.filter((id) => typeof id === 'string') : [];
  const again = Array.isArray(g.again) ? g.again : [];
  const back = serversComeBack(last, settings.serversBack, settings.keepChats);
  if (!SELFTEST_DIR && (back || gamed.length || again.length)) servers.bringBack(gamed, back, again);
  if (settings.gaming && !SELFTEST_DIR) {
    const names = [...gamed.map((id) => (servers.list.servers.find((s) => s.id === id) || {}).name || ''), ...servers.again.map((r) => r.name)].filter(Boolean);
    const lost = (Array.isArray(g.lost) ? g.lost : []).filter((s) => typeof s === 'string').map((s) => s.slice(0, 80)).slice(0, 20);
    gamedNote = { chats: previous.length, servers: names, lost };
    log(`gaming mode ended: ${previous.length} chat(s) and ${names.length} server(s) to bring back${lost.length ? `; not ${lost.join(', ')}` : ''}`);
    delete settings.gaming;
    writeSettings();
  }
  servers.watch();
  serversTimer = setTimeout(serversTick, 3000);
  startViewer();
  startWork();
  startBrowser().catch((err) => log(`browser: not started: ${err && err.stack}`));
  if (!SELFTEST_DIR) {
    finderConfig = { home: os.homedir(), store: path.join(app.getPath('userData'), 'find') };
    // the chats come back first: reading every past conversation can wait half a minute
    finderRestart = setTimeout(() => { finderRestart = null; startFinder(); }, 30000);
  }
  code.loaded('watcher');
  setInterval(() => code.look(), 5000);
  if (SELFTEST_DIR) {
    const editorBeforeTest = editorExe;
    require('./selftest.cjs')({
      app, win, dir: SELFTEST_DIR, engine: ENGINE, chats, writeLink, keptOf, restoreMode, lastEnd, jobLives, serversComeBack,
      // how a chat would be started, as plain words: nothing is started
      planChat: (ask) => { const p = planChat(ask); if (p.error) return p; return { via: p.via.id, plain: p.via.id === 'claude', passes: Boolean(p.via.passes), command: p.command, job: p.job, holds: p.holds, mode: p.mode }; },
      // the model and the thinking a Claude Code chat started in a folder gets, as the words added to its line
      claudeFlags: (cwd) => claudeFlags(cwd),
      settingsNow: () => JSON.parse(JSON.stringify(settings)),
      pathTest: HIDDEN ? {
        setEditor: (exe) => { editorExe = typeof exe === 'string' ? exe : ''; editorOverride = true; editorNoted = false; fileStarts.length = 0; },
        records: () => fileStarts.map((s) => ({ ...s, ...(s.args ? { args: s.args.slice() } : {}) })),
        clear: () => { fileStarts.length = 0; },
        restore: () => { editorExe = editorBeforeTest; editorOverride = false; editorNoted = false; fileStarts.length = 0; },
      } : null,
      // Made-up pictures use the same note path with a kept record of their own, and never write the profile.
      resetNotes: ({ picture, now, kept = [], notify = true, first = false, names = {}, after = 0, waiting = [] }) => {
        const notes = [];
        const isolated = { notify: { resets: notify }, accountNames: takeNames({}, names), resetNoted: takeResetNotes(kept) };
        const testing = { now, first, settings: isolated, notes, after, waiting };
        trackResets(picture, now, first, testing);
        return { notes, kept: isolated.resetNoted.slice(), after: testing.after, waiting: testing.waiting };
      },
      // what a close does to the Lowlit icon near the clock, then one more picture from the watcher, as still arrives
      // while the chats close; what that picture threw, in words. (A hidden window has no icon there: one is made for this.)
      trayEnd: () => {
        if (!tray) createTray();
        dropTray();
        try { track(latest); return ''; } catch (err) { return String(err && err.message); } finally { tray = null; }
      },
      watch: { latest: () => latest, took: () => took.slice(), errors: () => watcherErrors.slice(), post: (m) => worker.postMessage(m), ask: askWatcher, kill: () => worker && worker.terminate(),
        thread: () => (worker ? worker.threadId : 0) },
      find: { start: startTestFinder, stop: async () => { await stopFinder(); finderConfig = null; }, ask: askFinder,
        progress: () => ({ ...findProgress }), thread: () => (finder ? finder.threadId : 0) },
      record: { start: startTestRecord, stop: () => { settings.record = { folder: '' }; return shownSettings(); },
        answers: () => recordAnswers.slice(), log: () => { try { return fs.readFileSync(logFile(), 'utf8'); } catch { return ''; } } },
      // Jev with a made-up OpenRouter: stub(url, body) answers in its place, and is never handed the key
      jev: { stub: (fn) => { jevStub = typeof fn === 'function' ? fn : null; }, view: () => jev.view(), judge: (t) => jev.judgeTurn(t),
        on: (v) => jev.setOn(v), key: (k) => jev.setKey(k), file: () => path.join(app.getPath('userData'), 'jev.json'), flush: () => jev.flush(),
        mine: (folder) => isMine(folder), sorted: (q) => findSorted(q) },
      // the servers: what the page is shown, a look asked for now, and the question asked before ending a program
      servers: { view: () => servers.view, fresh: () => servers.fresh(), asked: () => serversAsked, file: () => servers.file,
        out: (id) => servers.outFile(id), started: () => JSON.parse(JSON.stringify(servers.run)), watched: () => serversWatched },
      // what Windows says of the screens, made up and said the way it says it (no screen changes), and the screen the
      // window is on as main sees it
      screens: { emit: (name, ...args) => screen.emit(name, { preventDefault() {} }, ...args), on: () => onScreen, power: (name) => powerMonitor.emit(name), gpuUnblocked: () => gpuUnblocked },
      // the page loaded again from here (as the tray does when the page is gone), and the look for newer code, now
      reload: () => reloadWindow(),
      code: { look: (at) => code.look(at), now: () => code.now() },
      // the Nest as main asks for it (its key from another program, the tray, the taskbar: the key itself is never
      // pressed here, a press shows the window), the folders the page is told of, and whether the key is held
      nest: { open: (how) => openNest(how), folders: () => nestFolders(), keyState: () => nestKeyState,
        // made-up rows added to the last reading of the chats, taken as the watcher's would be (the next real one replaces it)
        track: (rows) => track({ ...latest, at: Date.now(), chats: [...latest.chats.filter((c) => !rows.some((r) => r.key === c.key)), ...rows] }) },
      // the Browser and its door; who(fn) names the chats in place of the list of sessions (a test has none of its own)
      browser: { get: () => browser, door: () => door, who: (fn) => { if (door) door.who = typeof fn === 'function' ? fn : chatOfPid; },
        token: () => settings.browser.token },
      // the Viewer: what it holds, and the folder where its copies and small pictures are kept
      viewer: { get: () => viewer, dir: () => (viewer ? viewer.dir : '') },
      // the shift clock: the one running, and a fresh one on the same file (as after a restart)
      work: { get: () => work, fresh: (opts) => new Work(opts), file: () => path.join(app.getPath('userData'), 'work.json') },
      // gaming mode up to the close itself (the app stays), what it left for the next start, and that start's servers part
      gaming: { run: (only) => gaming({ stop: false, only: typeof only === 'function' ? only : () => false }), kept: () => (settings.gaming ? JSON.parse(JSON.stringify(settings.gaming)) : null),
        clear: () => { delete settings.gaming; saveSettings(); }, comeBack: (ids, again) => servers.bringBack(ids, false, again) },
      // the keeper of the consoles, once this start has found or started it, and the restart that leaves them with it
      keeper: { ready: () => keeperReady, get: () => keeper, restart: () => restartKeeping() },
      // the floating card: its window (never shown in a hidden test), what it was last told, where it goes, and its switches
      float: { win: () => floatWin, model: () => floatModel, spot: () => floatSpot(), wanted: () => floatWanted(), set: (patch) => floatSet(patch),
        place: (spot) => { settings.float.x = spot ? spot.x : null; settings.float.y = spot ? spot.y : null; }, width: FLOAT_W, edge: FLOAT_EDGE },
      // the notes over the other programs: their window, the cards, how long one stays, and a made-up picture from the
      // watcher taken as a real one is (a hidden window makes the chats' cards only while inTest is on)
      notes: { win: () => notesWin, list: () => notes.map((n) => ({ ...n })), up: (n) => noteUp(n), clear: () => noteDrop(() => true),
        inTest: (on) => { notesInTest = Boolean(on); }, ms: (v) => { noteMs = Number(v) > 0 ? Number(v) : NOTE_MS; notesTell(); },
        track: (data) => track(data), presence: () => presence(), spot: () => notesSpot(), place: () => notesPlace(), width: NOTES_W, edge: NOTES_EDGE },
    });
  }
}

// A second launch brings the first one's window forward instead of opening another.
if (app.requestSingleInstanceLock()) {
  app.on('second-instance', (_event, argv) => {
    if (quitting) return;
    showWindow();
    // "Open the Nest" in the taskbar button's menu starts a second launch with --nest
    if (Array.isArray(argv) && argv.includes(NEST_FLAG)) openNest('open');
  });
  app.on('before-quit', (event) => {
    if (quitting) return;
    event.preventDefault();
    quit();
  });
  app.on('window-all-closed', () => quit());
  app.whenReady().then(start);
} else {
  app.exit(0);
}
