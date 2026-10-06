'use strict';
// The chats of this window: each one a real PowerShell console, usually with
// an agent CLI started inside it. This file starts the consoles (in the
// keeper, keeper.cjs, when there is one) and passes keystrokes and screen
// output through; it never looks at what they say.
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const pty = require('node-pty');

const FLUSH_MS = 5;
// For this long after a key, the first ECHO_BYTES the chat typed into prints go to the window at once, piece by piece:
// the echo of the key. Past that, a flood (a command's output, an answer) joins the batches: the window pays for each
// message about the same whatever its size, so a flood sent piece by piece takes several times as long.
const TYPED_MS = 1000;
const ECHO_BYTES = 16384;
// Claude Code counts a fullscreen start that dies within ten seconds of its
// first frame as a failed start, and after two of those it turns fullscreen
// off for the whole machine. A console is never closed over a session younger
// than this.
const YOUNG_MS = 15000;
// A program started by an Enter just pressed has not written its session file yet.
const ENTER_MS = 3000;
const UNDO_MS = 5000;

/**
 * What Windows itself stores for the user and the machine (the environment a program gets from Explorer):
 * name in capitals -> the name as stored and its value. A name stored for both is the user's.
 */
function savedEnv() {
  const saved = new Map();
  for (const key of ['HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment', 'HKCU\\Environment']) {
    // A program started elsewhere in this app at the same moment can take a copy of reg's output pipe and hold it open
    // for as long as it runs: reg having ended well is enough, and the wait for that pipe to close is cut short.
    // An unreadable key only means none of its names are kept.
    const r = spawnSync('reg', ['query', key], { encoding: 'utf8', windowsHide: true, timeout: 5000 });
    if (r.status !== 0 || typeof r.stdout !== 'string') continue;
    for (const m of r.stdout.matchAll(/^ {4}(\S+) {4}REG_\w+(?: {4}(.*))?$/gm)) saved.set(m[1].toUpperCase(), { name: m[1], value: m[2] || '' });
  }
  return saved;
}

// reg.exe prints in the console's code page and leaves %NAME% parts as they are: only such a value can be taken as printed.
const PLAIN = /^[\x20-\x24\x26-\x7e]+$/;
// The app never fetches a login: one stored in Windows reaches a chat only through the window's own environment.
const LOGIN = /TOKEN|KEY|SECRET|PASSWORD|CREDENTIAL/i;

/**
 * The environment a chat starts with. A window opened from inside an agent's
 * own terminal inherits that agent's session markers (CLAUDECODE,
 * CLAUDE_CODE_SESSION_ID, WT_SESSION ...), and a session started with them
 * believes it is that agent's child, in a Windows Terminal tab. It also
 * inherits what the agent sets for its own tool shells (GIT_EDITOR=true makes
 * every plain `git commit` fail). Those are dropped; names Windows stores for
 * the user are kept. Opened from Explorer, none of them exist.
 *
 * A window started from a console holds what Windows stored when that console
 * was opened: one of these names stored since then (where the agent keeps its
 * files, say) never reached it, and is taken from Windows here.
 */
function sessionEnv() {
  const env = { ...process.env };
  const nested = Boolean(env.CLAUDECODE || env.WT_SESSION);
  const saved = savedEnv();
  const inherited = /^(CLAUDE|CODEX_|WT_|AI_AGENT$|GIT_EDITOR$|COREPACK_ENABLE_AUTO_PIN$)/i;
  const held = new Set();
  for (const name of Object.keys(env)) {
    if (/^DESK_/i.test(name)) delete env[name];
    else if (nested && inherited.test(name) && !saved.has(name.toUpperCase())) delete env[name];
    else held.add(name.toUpperCase());
  }
  for (const [upper, { name, value }] of saved) {
    if (inherited.test(name) && !held.has(upper) && !LOGIN.test(name) && PLAIN.test(value)) env[name] = value;
  }
  env.COLORTERM = 'truecolor';
  // Read by the Perch hook: this console is not a Windows Terminal tab, so there is no tab to look for.
  env.AGENTFOCUS_HOST = 'desk';
  // Claude Code wraps each screen update in "paint this whole" marks only for
  // terminals it knows by name, and the console engine answers its question
  // about them without asking the widget. The widget does honour the marks and
  // the engine passes them through, so half-drawn frames never reach the screen.
  env.CLAUDE_CODE_FORCE_SYNC_OUTPUT = '1';
  return env;
}

/** A console cannot be zero or fractional cells wide; a window mid-minimise can ask for both. */
function cells(n, fallback) {
  const v = Math.floor(Number(n));
  return Number.isFinite(v) && v >= 2 ? v : fallback;
}

class Chats {
  /**
   * engine: 'bundled' (Windows Terminal's console engine, shipped with node-pty) or 'inbox' (the one built into Windows).
   * newestStart(chatId): when the newest agent session that may be running in that chat started.
   * keeper: the program that holds the consoles so they outlive a restart of the app (keeper.cjs); without one, or
   * while it cannot be reached, the consoles live in this process.
   */
  constructor({ engine, newestStart, onOutput, onExit, onChange, keeper = null }) {
    this.engine = engine;
    this.newestStart = newestStart;
    this.onOutput = onOutput;
    this.onExit = onExit;
    this.onChange = onChange;
    this.keeper = keeper;
    this.all = new Map();
    this.seq = 0;
    this.cols = 120;
    this.rows = 30;
    this.pending = new Map();    // chat id -> screen output not yet sent to the window
    this.timer = null;
    this.env = null;
    this.closes = new Map();    // chat id -> the short hold before its console is closed
  }

  /** The environment every chat starts with, read once (sessionEnv). */
  prepare() {
    if (!this.env) this.env = sessionEnv();
  }

  /**
   * Starts a console in `cwd` and runs `command` in it; an empty command leaves a plain shell.
   * job: the background session this chat is the view of, when it is one.
   * named: the title is a name the person gave it (kept for next time), not one the chat was opened with.
   */
  /** holds, mode: the conversation the chat was opened to pick up again, and the permission mode it was in. */
  create({ cwd, command, starter, title, named, job, holds, mode }) {
    const id = `c${++this.seq}`;
    const shell = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    const args = command ? ['-NoLogo', '-NoExit', '-Command', command] : ['-NoLogo'];
    this.prepare();
    const chat = { id, cwd, command, starter: starter || '', title: title || '', named: Boolean(named && title), job: job || '', holds: holds || '', mode: mode || '', left: false,
      startedAt: Date.now(), enterAt: 0, pid: 0, term: null, closing: false };
    // The bundled engine counts the cells of emoji and kaomoji the way the
    // widget does, and on close it lets the programs in the console end
    // themselves; the one built into Windows miscounts and cuts them off.
    const conptyDll = this.engine === 'bundled';
    chat.term = this.keeper && this.keeper.usable()
      ? this.keeper.spawn({ id, file: shell, args, cwd, env: this.env, cols: this.cols, rows: this.rows, conptyDll, meta: this.metaOf(chat) })
      : pty.spawn(shell, args, { cols: this.cols, rows: this.rows, cwd, env: this.env, useConptyDll: conptyDll });
    chat.pid = chat.term.pid;
    this.all.set(id, chat);
    this.wire(chat);
    this.onChange();
    return chat;
  }

  /**
   * The consoles the keeper held for this window when it last ran (it restarted, or it went down): the chats they
   * were, under the same ids, as they were. held: [{ id, pid, meta, term }].
   */
  adopt(held) {
    let added = 0;
    for (const { id, pid, meta, term } of held) {
      if (this.all.has(id)) continue;
      const m = meta && typeof meta === 'object' ? meta : {};
      const text = (v) => (typeof v === 'string' ? v : '');
      const chat = { id, cwd: text(m.cwd), command: text(m.command), starter: text(m.starter), title: text(m.title), named: Boolean(m.named && m.title), job: text(m.job),
        holds: text(m.holds), mode: text(m.mode), left: m.left === true, startedAt: Number(m.startedAt) || Date.now(), enterAt: 0, pid: pid || term.pid, term, closing: false };
      const n = Number((/^c(\d+)$/.exec(id) || [])[1]) || 0;
      if (n > this.seq) this.seq = n;
      this.all.set(id, chat);
      this.wire(chat);
      added++;
    }
    if (added) this.onChange();
  }

  wire(chat) {
    const { id, term } = chat;
    // a console the keeper starts says which program it is a moment later
    if (!chat.pid && term.whenPid) term.whenPid((pid) => { chat.pid = pid; if (this.all.get(id) === chat) this.onChange(); });
    term.onData((data) => this.queue(id, data));
    term.onExit(({ exitCode }) => {
      this.flush();
      clearTimeout(this.closes.get(id));
      this.closes.delete(id);
      this.all.delete(id);
      this.onExit(id, exitCode);
      this.onChange();
    });
  }

  /** Resolves once the chat's console has said which program it is: at once for one started in this process. */
  started(id) {
    const chat = this.all.get(id);
    if (!chat || chat.pid || !chat.term.whenPid) return Promise.resolve();
    return new Promise((done) => {
      chat.term.whenPid(() => done());
      chat.term.onExit(() => done());
      setTimeout(done, 8000);
    });
  }

  /** What the keeper keeps of a chat for the app's next start: all a chat is, but its console. */
  metaOf(chat) {
    const { cwd, command, starter, title, named, job, holds, mode, left, startedAt } = chat;
    return { cwd, command, starter, title, named, job, holds, mode, left, startedAt };
  }

  remember(chat) {
    if (chat.term && chat.term.remember) chat.term.remember(this.metaOf(chat));
  }

  input(id, data) {
    const chat = this.all.get(id);
    if (!chat || chat.closing) return;
    chat.typedAt = Date.now();
    chat.echoed = 0;
    if (data.includes('\r')) chat.enterAt = chat.typedAt;
    chat.term.write(data);
  }

  /** The name the person gives a chat; an empty one hands the naming back to the session inside it. */
  rename(id, title) {
    const chat = this.all.get(id);
    if (!chat) return;
    chat.title = String(title).replace(/\s+/g, ' ').trim().slice(0, 120);
    chat.named = Boolean(chat.title);
    this.remember(chat);
    this.onChange();
  }

  /** The agent in a chat ended its session (it was left with /exit): the chat holds no conversation any more, only its shell. */
  release(id) {
    const chat = this.all.get(id);
    if (!chat || chat.left) return;
    chat.left = true;
    chat.holds = '';
    chat.mode = '';
    this.remember(chat);
  }

  /**
   * A chat's console takes the size of the place its terminal is drawn in: several chats can share the screen, each
   * in a place of its own. The size given last is the one the next new chat starts at.
   */
  resize(id, cols, rows) {
    this.cols = cells(cols, this.cols);
    this.rows = cells(rows, this.rows);
    const chat = this.all.get(id);
    if (!chat) return;
    try { chat.term.resize(this.cols, this.rows); } catch { /* it ended a moment ago */ }
  }

  // Output arrives in many small pieces. After a quiet moment the first one goes to the window at once; while more keep
  // coming, a few milliseconds of them go as one message. The echo of a key is never kept waiting behind the others.
  queue(id, data) {
    const chat = this.all.get(id);
    if (chat && Date.now() - (chat.typedAt || 0) < TYPED_MS && (chat.echoed || 0) < ECHO_BYTES) {
      chat.echoed = (chat.echoed || 0) + data.length;
      const held = this.pending.get(id);
      if (held !== undefined) this.pending.delete(id);
      this.onOutput(id, held === undefined ? data : held + data);
      return;
    }
    if (!this.timer) {
      this.onOutput(id, data);
      this.timer = setTimeout(() => this.flush(), FLUSH_MS);
      return;
    }
    this.pending.set(id, (this.pending.get(id) || '') + data);
  }

  flush() {
    clearTimeout(this.timer);
    this.timer = null;
    if (!this.pending.size) return;
    for (const [id, data] of this.pending) this.onOutput(id, data);
    this.pending.clear();
    this.timer = setTimeout(() => this.flush(), FLUSH_MS);
  }

  /** How long, in ms, before this chat's console may be closed without cutting a starting session short. */
  tooYoung(chat) {
    // A CLI started with the chat has no session file in its first seconds, and the view of a background
    // session never writes one: until there is one, the chat's own start is all there is to go by.
    const own = chat.command ? chat.startedAt + YOUNG_MS : 0;
    return Math.max(chat.enterAt + ENTER_MS, this.newestStart(chat.id) + YOUNG_MS, own) - Date.now();
  }

  /**
   * Closes a chat's console. The programs in it get the console's close event
   * and end themselves: the agent CLI saves and ends its session.
   */
  async close(id) {
    const chat = this.all.get(id);
    if (!chat || chat.closing) return;
    clearTimeout(this.closes.get(id));
    this.closes.delete(id);
    chat.closing = true;
    this.onChange();
    for (;;) {
      const wait = this.tooYoung(chat);
      if (wait <= 0 || !this.all.has(id)) break;
      await new Promise((r) => setTimeout(r, Math.min(wait, 1000)));
    }
    if (this.all.has(id)) {
      try { chat.term.kill(); } catch { /* already gone */ }
    }
  }

  /** The console and its output stay alive until this chat's own Undo time ends. */
  holdClose(id) {
    const chat = this.all.get(id);
    if (!chat || chat.closing) return false;
    if (chat.pendingClose) return chat.pendingClose;
    chat.pendingClose = Date.now() + UNDO_MS;
    this.closes.set(id, setTimeout(() => this.close(id), UNDO_MS));
    this.onChange();
    return chat.pendingClose;
  }

  undoClose(id) {
    const chat = this.all.get(id);
    if (!chat || chat.closing || !chat.pendingClose || Date.now() >= chat.pendingClose) return false;
    clearTimeout(this.closes.get(id));
    this.closes.delete(id);
    chat.pendingClose = 0;
    this.onChange();
    return true;
  }

  /** Closes every chat and waits, up to `ms` after the last console was told to close, for them to be gone. */
  async closeAll(ms = 6000) {
    await Promise.all([...this.all.keys()].map((id) => this.close(id)));
    const end = Date.now() + ms;
    while (this.all.size && Date.now() < end) await new Promise((r) => setTimeout(r, 100));
  }

  list() {
    return [...this.all.values()].map(({ id, cwd, command, starter, title, named, job, holds, mode, left, startedAt, pid, closing, pendingClose }) => ({ id, cwd, command, starter, title, named, job, holds, mode, left, startedAt, pid, closing, pendingClose }));
  }

  /** [shell pid, chat id] pairs: how a session found on disk is traced back to the chat it runs in. */
  shells() {
    return [...this.all.values()].map((chat) => [chat.pid, chat.id]);
  }

  /** [background session id, chat id] pairs: the chats that are the view of one. Such a session runs outside any console here. */
  jobs() {
    return [...this.all.values()].filter((chat) => chat.job).map((chat) => [chat.job, chat.id]);
  }
}

module.exports = { Chats };
