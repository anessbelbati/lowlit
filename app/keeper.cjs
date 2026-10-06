'use strict';
// The keeper: a small program of its own that holds the chats' consoles, so that the app can close and open again (for
// a new version, or after a crash) while what runs in them carries on. The app starts it once and talks to it over a
// pipe, with a key only the app has. It keeps what each console printed lately (replay.cjs) and the name, folder and
// start of each chat, for the app that comes next. With no consoles left and no app, it ends by itself.
//
// One file, both ends: run as a program, this is the keeper; required, it is the app's way to it (Keeper).
const net = require('node:net');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');

const V = 1;                            // what both ends speak: a keeper of another version is never used
const FLUSH_MS = 5;
const TYPED_MS = 1000;                  // for this long after a key, the first ECHO_BYTES of the console typed into
const ECHO_BYTES = 16384;               // are sent piece by piece (the echo); a flood past that is joined like the rest
const IDLE_MS = 15000;                  // no consoles and no app for this long: the keeper ends
const START_MS = 8000;                  // a keeper just started waits this long for its app, and the app for it
const HELLO_MS = 3000;
const TEST_IDLE_MS = 300;
const TEST_WAIT_MS = 90000;             // a test run's consoles kept for the next run wait this long for it
// Claude Code counts a start that dies within 10 s of its first frame as failed (chats.cjs): the keeper itself
// closes a console only once it is this old
const YOUNG_MS = 16000;
const BACKLOG_MAX = 64 * 1024 * 1024;   // what an app that stopped reading may be owed before it is let go
const LINE_MAX = 32 * 1024 * 1024;
const LOG_MAX = 256 * 1024;

const wait = (ms) => new Promise((done) => setTimeout(done, ms));
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };

/** The pipe of the keeper of one profile (the folder the app keeps its settings in). */
function pipeOf(dir) {
  const hash = crypto.createHash('sha256').update(path.resolve(dir).toLowerCase()).digest('hex').slice(0, 16);
  return `\\\\.\\pipe\\lowlit-keeper-v${V}-${hash}`;
}

/** A console cannot be zero or fractional cells wide. */
function cells(n, fallback) {
  const v = Math.floor(Number(n));
  return Number.isFinite(v) && v >= 2 && v <= 2000 ? v : fallback;
}

/** One message per line, as JSON. take(message) returning false stops the reading. */
function lines(socket, take) {
  let buf = '';
  socket.on('data', (chunk) => {
    buf += chunk;
    if (buf.length > LINE_MAX) { socket.destroy(); return; }
    const parts = buf.split('\n');
    buf = parts.pop();
    for (const line of parts) {
      if (!line) continue;
      let m;
      try { m = JSON.parse(line); } catch { socket.destroy(); return; }
      if (take(m) === false) return;
    }
  });
}

// ---- the keeper itself ----
function keeper() {
  const pty = require('node-pty');
  const { Tail } = require('./replay.cjs');
  const env = process.env;
  const pipe = env.LOWLIT_KEEPER_PIPE || '';
  const key = Buffer.from(env.LOWLIT_KEEPER_KEY || '', 'utf8');
  const test = env.LOWLIT_KEEPER_TEST === '1';
  const logFile = env.LOWLIT_KEEPER_LOG || '';
  for (const n of Object.keys(env)) if (/^LOWLIT_KEEPER_/.test(n) || n === 'ELECTRON_RUN_AS_NODE') delete env[n];
  if (!pipe || key.length < 32) process.exit(2);

  // what it did, never what a console printed or what it was started with
  const log = (s) => {
    if (!logFile) return;
    try {
      if (fs.statSync(logFile).size > LOG_MAX) fs.writeFileSync(logFile, fs.readFileSync(logFile, 'utf8').slice(-LOG_MAX / 2));
    } catch { /* not there yet */ }
    try { fs.appendFileSync(logFile, `${new Date().toISOString()} ${s}\n`); } catch { /* nowhere to say it */ }
  };
  // the keeper holds every chat: an error in one message must not end them all
  process.on('uncaughtException', (err) => log(`trouble: ${err && err.stack ? err.stack.split('\n').slice(0, 3).join(' | ') : err}`));

  const consoles = new Map();   // id -> { id, term, pid, cols, rows, meta, tail, startedAt, attached, killed }: held
  // asked to close, on their way out: never offered to an app again, and their names are free for new consoles
  const closing = new Set();
  let app = null;               // the app connected now: { socket }
  let keep = false;             // the app that left asked for its consoles to be kept (it restarts)
  let idleTimer = null;
  let ending = false;
  const pending = new Map();    // console -> what it printed since the last flush
  let flushTimer = null;

  const send = (m) => {
    if (!app || app.socket.destroyed) return;
    const s = app.socket;
    s.write(`${JSON.stringify(m)}\n`);
    if (s.writableLength > BACKLOG_MAX) { log('the app stopped reading: let go'); s.destroy(); }
  };
  const view = (c) => ({ id: c.id, pid: c.pid, cols: c.cols, rows: c.rows, meta: c.meta, startedAt: c.startedAt });

  function flush() {
    clearTimeout(flushTimer);
    flushTimer = null;
    if (!pending.size) return;
    for (const [c, d] of pending) if (c.attached) send({ t: 'data', id: c.id, d });
    pending.clear();
    flushTimer = setTimeout(flush, FLUSH_MS);
  }
  // Every byte goes into what is kept for the next app. The app connected now gets the first piece after a quiet
  // moment at once, and what keeps coming a few milliseconds later, joined. The echo of a key is never kept waiting.
  function out(c, d) {
    c.tail.append(d);
    if (!app || !c.attached) return;
    if (Date.now() - (c.typedAt || 0) < TYPED_MS && (c.echoed || 0) < ECHO_BYTES) {
      c.echoed = (c.echoed || 0) + d.length;
      const held = pending.get(c);
      if (held !== undefined) pending.delete(c);
      send({ t: 'data', id: c.id, d: held === undefined ? d : held + d });
      return;
    }
    if (!flushTimer) {
      send({ t: 'data', id: c.id, d });
      flushTimer = setTimeout(flush, FLUSH_MS);
      return;
    }
    pending.set(c, (pending.get(c) || '') + d);
  }
  function gone(c, code) {
    flush();
    if (consoles.get(c.id) === c) consoles.delete(c.id);
    closing.delete(c);
    log(`console ${c.id} ended (${code})`);
    // only the app that has it hears of it: a newer one may hold a new console under the same name by now
    if (c.attached) send({ t: 'exit', id: c.id, code });
    idle();
  }
  // the bundled console engine lets the programs in it end themselves (useConptyDll): nothing is cut off here
  function close(c, after = 0) {
    c.killed = true;
    consoles.delete(c.id);
    closing.add(c);
    const kill = () => { try { c.term.kill(); } catch { /* already gone */ } };
    if (after > 0) setTimeout(kill, after); else kill();
  }
  function start(m) {
    const id = typeof m.id === 'string' && /^[\w-]{1,40}$/.test(m.id) ? m.id : '';
    if (!id || consoles.has(id)) { send({ t: 'spawned', id: String(m.id), error: 'a console under that name is held already' }); return; }
    const cols = cells(m.cols, 120);
    const rows = cells(m.rows, 30);
    let term;
    try {
      term = pty.spawn(String(m.file), Array.isArray(m.args) ? m.args.map(String) : [],
        { cols, rows, cwd: String(m.cwd || os.homedir()), env: m.env && typeof m.env === 'object' ? m.env : env, useConptyDll: m.conptyDll === true });
    } catch (err) {
      send({ t: 'spawned', id, error: String((err && err.message) || err) });
      return;
    }
    const c = { id, term, pid: term.pid, cols, rows, meta: m.meta && typeof m.meta === 'object' ? m.meta : {}, tail: new Tail(), startedAt: Date.now(), attached: true, killed: false };
    consoles.set(id, c);
    term.onData((d) => out(c, d));
    term.onExit(({ exitCode }) => gone(c, exitCode));
    send({ t: 'spawned', id, pid: c.pid });
    log(`console ${id} started`);
  }
  function handle(m) {
    const c = typeof m.id === 'string' ? consoles.get(m.id) : null;
    if (m.t === 'spawn') start(m);
    else if (m.t === 'attach') {
      // what it printed while no app was there, and before, then what comes next as it comes
      if (!c) { send({ t: 'tail', id: String(m.id), gone: true }); return; }
      c.attached = true;
      send({ t: 'tail', id: c.id, data: c.tail.snapshot().data, cols: c.cols, rows: c.rows, pid: c.pid });
    } else if (m.t === 'write') { if (c && typeof m.d === 'string') try { c.typedAt = Date.now(); c.echoed = 0; c.term.write(m.d); } catch { /* it ended a moment ago */ } }
    else if (m.t === 'resize') {
      if (!c) return;
      c.cols = cells(m.cols, c.cols);
      c.rows = cells(m.rows, c.rows);
      try { c.term.resize(c.cols, c.rows); } catch { /* it ended a moment ago */ }
    } else if (m.t === 'kill') { if (c) close(c); }
    else if (m.t === 'meta') { if (c && m.meta && typeof m.meta === 'object') c.meta = m.meta; }
    else if (m.t === 'keep') keep = true;
  }

  function closeAll(why) {
    log(`${why}: closing ${consoles.size} console(s)`);
    for (const c of [...consoles.values()]) close(c, c.startedAt + YOUNG_MS - Date.now());
    // one that does not end within this goes with the keeper
    setTimeout(() => { if (!app) { ending = true; process.exit(0); } }, YOUNG_MS + 10000);
  }
  function bye() {
    if (app || consoles.size || closing.size) return;
    ending = true;
    log('ends: nothing left to hold');
    server.close();
    process.exit(0);
  }
  function idle() {
    clearTimeout(idleTimer);
    idleTimer = null;
    if (app || ending) return;
    if (!consoles.size && !closing.size) idleTimer = setTimeout(bye, test ? TEST_IDLE_MS : IDLE_MS);
    else if (test && consoles.size) idleTimer = setTimeout(() => closeAll('no test run came back for its consoles'), TEST_WAIT_MS);
  }
  // A new app takes over from the one before (that one is gone, or going): it is told what is held, and asks for each.
  function take(socket) {
    if (app) { const old = app.socket; app = null; old.destroy(); }
    app = { socket };
    keep = false;
    clearTimeout(idleTimer);
    idleTimer = null;
    pending.clear();
    for (const c of [...consoles.values(), ...closing]) c.attached = false;
    send({ t: 'hello', v: V, pid: process.pid, consoles: [...consoles.values()].map(view) });
    log(`an app came; ${consoles.size} console(s) held${closing.size ? `, ${closing.size} closing` : ''}`);
  }
  // The app went: after a restart or a crash its consoles wait for the next one. A test run's go with it, unless kept.
  function left(why) {
    app = null;
    pending.clear();
    for (const c of [...consoles.values(), ...closing]) c.attached = false;
    log(`the app left (${why}); ${consoles.size} console(s) held${keep ? ', kept for its next start' : ''}`);
    if (test && !keep && consoles.size) closeAll('a test run ended without keeping its consoles');
    idle();
  }
  const keyMatches = (k) => typeof k === 'string' && Buffer.byteLength(k) === key.length && crypto.timingSafeEqual(Buffer.from(k), key);

  const server = net.createServer((socket) => {
    socket.setEncoding('utf8');
    let known = false;
    const timer = setTimeout(() => { if (!known) socket.destroy(); }, HELLO_MS);
    lines(socket, (m) => {
      if (!known) {
        // a program without the key is told nothing
        if (!m || m.t !== 'hello' || !keyMatches(m.key)) { socket.destroy(); return false; }
        clearTimeout(timer);
        known = true;
        take(socket);
        return true;
      }
      if (!app || app.socket !== socket) return false;
      handle(m);
      return true;
    });
    socket.on('error', () => { /* its close follows */ });
    socket.on('close', () => { clearTimeout(timer); if (app && app.socket === socket) left('its connection closed'); });
  });
  server.on('error', (err) => {
    log(`no pipe: ${err.code || err.message}`);
    process.exit(err.code === 'EADDRINUSE' ? 0 : 1);
  });
  server.listen(pipe, () => {
    log(`keeper ${process.pid} is up (version ${V}${test ? ', for a test run' : ''})`);
    idleTimer = setTimeout(bye, START_MS);
  });
}

// ---- the app's side ----
/** A console the keeper holds, as the app sees it: what node-pty's own gives (pid, cols, rows, onData, onExit, write, resize, kill). */
class KeptTerm {
  constructor(link, id, cols, rows) {
    this.link = link;
    this.id = id;
    this.cols = cols;
    this.rows = rows;
    this.pid = 0;
    this.datas = [];
    this.exits = [];
    this.pids = [];
    this.early = [];          // what came before anyone listened
    this.exitCode = null;
    this.local = null;        // a console started in the app instead, when the keeper could not be reached
    this.ask = null;          // how it was asked for, until the keeper says it started it
  }
  onData(fn) {
    this.datas.push(fn);
    for (const d of this.early.splice(0)) fn(d);
    return { dispose: () => { this.datas = this.datas.filter((f) => f !== fn); } };
  }
  onExit(fn) {
    this.exits.push(fn);
    if (this.exitCode !== null) fn({ exitCode: this.exitCode });
    return { dispose: () => { this.exits = this.exits.filter((f) => f !== fn); } };
  }
  /** fn(pid) once the keeper has said which program it started. */
  whenPid(fn) { if (this.pid) fn(this.pid); else this.pids.push(fn); }
  write(d) { if (this.local) this.local.write(d); else this.link.send({ t: 'write', id: this.id, d }); }
  resize(cols, rows) {
    this.cols = cols;
    this.rows = rows;
    if (this.local) this.local.resize(cols, rows); else this.link.send({ t: 'resize', id: this.id, cols, rows });
  }
  kill() { if (this.local) this.local.kill(); else this.link.send({ t: 'kill', id: this.id }); }
  /** What the next app needs to know of this chat (its folder, its name, how it was started). */
  remember(meta) { if (!this.local) this.link.send({ t: 'meta', id: this.id, meta }); }

  started(pid) { this.pid = pid; for (const fn of this.pids.splice(0)) fn(pid); }
  data(d) { if (this.datas.length) for (const fn of this.datas) fn(d); else this.early.push(d); }
  ended(code) {
    if (this.exitCode !== null) return;
    this.exitCode = code;
    for (const fn of this.exits) fn({ exitCode: code });
  }
  /** Started in the app after all: node-pty's own console stands in for the keeper's. */
  useLocal(t) {
    this.local = t;
    t.onData((d) => this.data(d));
    t.onExit(({ exitCode }) => this.ended(exitCode));
    this.started(t.pid);
  }
}

class Keeper {
  /** dir: the profile's folder. test: a self-test run's keeper, whose consoles never outlive the run unless kept. */
  constructor({ dir, test = false, log = () => {} }) {
    this.dir = dir;
    this.test = test;
    this.log = log;
    this.pipe = pipeOf(dir);
    this.file = path.join(dir, 'keeper.json');
    this.state = 'none';        // 'starting', 'on', 'left' (this app let it go), 'gone' (lost, or never reached)
    this.socket = null;
    this.pid = 0;
    this.key = '';
    this.fresh = false;         // started by this app: it holds nothing yet
    this.queue = [];            // what was asked while it starts
    this.terms = new Map();
    this.waits = new Map();     // console id -> what an attach waits for
    this.goneFns = [];
  }
  usable() { return this.state === 'starting' || this.state === 'on'; }
  connected() { return this.state === 'on'; }
  onGone(fn) { this.goneFns.push(fn); }

  /**
   * At the app's start, before any thread of the app starts programs of its own: a program started on Windows takes a
   * copy of the pipes the programs starting at that moment talk through, and the keeper would hold them for as long as
   * it runs. A keeper this profile already has is left to be reached (open); otherwise one is started now.
   */
  prepare() {
    let saved = null;
    try { saved = JSON.parse(fs.readFileSync(this.file, 'utf8')); } catch { /* none yet */ }
    if (saved && saved.pipe === this.pipe && /^[0-9a-f]{64}$/.test(saved.key || '') && Number.isInteger(saved.pid) && alive(saved.pid)) {
      this.key = saved.key;
      this.fresh = false;
    } else this.launch();
    this.state = 'starting';
  }

  launch() {
    this.key = crypto.randomBytes(32).toString('hex');
    this.fresh = true;
    try {
      const child = spawn(process.execPath, [__filename], {
        detached: true, stdio: 'ignore', windowsHide: true, cwd: os.homedir(),
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', LOWLIT_KEEPER_PIPE: this.pipe, LOWLIT_KEEPER_KEY: this.key,
          LOWLIT_KEEPER_TEST: this.test ? '1' : '', LOWLIT_KEEPER_LOG: path.join(this.dir, 'keeper.log') },
      });
      child.on('error', () => { /* no answer comes, and open says so */ });
      child.unref();
      fs.mkdirSync(this.dir, { recursive: true });
      fs.writeFileSync(this.file, JSON.stringify({ pipe: this.pipe, key: this.key, pid: child.pid || 0 }), { mode: 0o600 });
    } catch (err) {
      this.log(`keeper: not started: ${err.message}`);
    }
  }

  /**
   * Reaches the keeper prepare() found or started: the consoles it holds ([] for a new one). Chats asked for meanwhile
   * wait for it. Throws when it cannot be reached: the consoles then live in the app, as before there was a keeper.
   */
  async open() {
    try {
      if (!this.fresh) {
        try { return (await this.connect(this.key)).consoles || []; } catch (err) {
          // no pipe at all: that keeper ended long ago, and its number went to another program since
          if (err.code !== 'ENOENT') throw err;
          this.launch();
        }
      }
      const until = Date.now() + START_MS;
      for (;;) {
        const hello = await this.connect(this.key).catch((err) => { if (Date.now() > until) throw new Error(`the keeper did not answer (${err.code || err.message})`); return null; });
        if (hello) return Array.isArray(hello.consoles) ? hello.consoles : [];
        await wait(60);
      }
    } catch (err) {
      this.fail(err.message);
      throw err;
    }
  }

  connect(key) {
    return new Promise((resolve, reject) => {
      const socket = net.connect(this.pipe);
      let done = false;
      const finish = (err, hello) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        if (err) { socket.destroy(); reject(err); } else resolve(hello);
      };
      const timer = setTimeout(() => finish(new Error('no answer')), HELLO_MS);
      socket.setEncoding('utf8');
      socket.on('error', (err) => finish(err));
      socket.on('close', () => { if (!done) finish(new Error('closed')); else if (this.socket === socket) this.lost(); });
      socket.on('connect', () => socket.write(`${JSON.stringify({ t: 'hello', v: V, key })}\n`));
      lines(socket, (m) => {
        if (!done) {
          if (!m || m.t !== 'hello' || m.v !== V) { finish(new Error(`a keeper of version ${m && m.v} answers`)); return false; }
          this.socket = socket;
          this.state = 'on';
          this.pid = Number(m.pid) || 0;
          finish(null, m);
          for (const line of this.queue.splice(0)) socket.write(line);
          return true;
        }
        this.take(m);
        return true;
      });
    });
  }

  send(m) {
    const line = `${JSON.stringify(m)}\n`;
    if (this.state === 'on' && this.socket && !this.socket.destroyed) this.socket.write(line);
    else if (this.state === 'starting') this.queue.push(line);
  }

  take(m) {
    if (!m || typeof m.id !== 'string') return;
    const t = this.terms.get(m.id);
    if (m.t === 'data') { if (t && typeof m.d === 'string') t.data(m.d); }
    else if (m.t === 'exit') { if (t) { this.terms.delete(m.id); t.ended(Number.isInteger(m.code) ? m.code : -1); } }
    else if (m.t === 'spawned') {
      if (!t) return;
      t.ask = null;
      if (m.error) { this.log(`keeper: console ${m.id} not started: ${m.error}`); this.terms.delete(m.id); t.ended(-1); }
      else t.started(Number(m.pid) || 0);
    } else if (m.t === 'tail') {
      const w = this.waits.get(m.id);
      if (w) { this.waits.delete(m.id); w(m); }
    }
  }

  /** A new console, held by the keeper. Its program's number comes a moment later (whenPid). */
  spawn({ id, file, args, cwd, env, cols, rows, conptyDll, meta }) {
    const t = new KeptTerm(this, id, cols, rows);
    t.ask = { file, args, cwd, env, conptyDll };
    this.terms.set(id, t);
    this.send({ t: 'spawn', id, file, args, cwd, env, cols, rows, conptyDll, meta });
    return t;
  }

  /** One of the consoles the keeper held when this app came: what it printed, and the console. null: it ended meanwhile. */
  attach(held) {
    return new Promise((resolve) => {
      this.waits.set(held.id, (m) => {
        if (!m || m.gone) { resolve(null); return; }
        const t = new KeptTerm(this, held.id, cells(m.cols, 120), cells(m.rows, 30));
        this.terms.set(held.id, t);
        t.started(Number(m.pid) || held.pid || 0);
        resolve({ term: t, data: typeof m.data === 'string' ? m.data : '' });
      });
      this.send({ t: 'attach', id: held.id });
    });
  }

  /** The consoles stay when this app goes: the next start takes them up. */
  keep() { this.send({ t: 'keep' }); }

  /** This app lets the keeper go (it ends, or restarts). Resolves once the pipe is closed. */
  leave() {
    const socket = this.socket;
    this.state = 'left';
    this.socket = null;
    if (!socket || socket.destroyed) return Promise.resolve();
    return new Promise((done) => {
      socket.once('close', done);
      socket.end();
      setTimeout(() => { socket.destroy(); done(); }, 1000);
    });
  }

  /** It never answered: what was asked of it meanwhile is started in the app instead. */
  fail(why) {
    this.state = 'gone';
    this.log(`keeper: ${why}; the consoles live in the app`);
    const pty = require('node-pty');
    for (const t of this.terms.values()) {
      if (!t.ask) continue;
      const a = t.ask;
      t.ask = null;
      try { t.useLocal(pty.spawn(a.file, a.args, { cols: t.cols, rows: t.rows, cwd: a.cwd, env: a.env, useConptyDll: a.conptyDll })); } catch { t.ended(-1); }
    }
    this.terms.clear();
    this.queue.length = 0;
    for (const fn of this.goneFns) fn(why);
  }

  /** The pipe closed under a running app: the keeper ended, and the consoles with it. */
  lost() {
    if (this.state !== 'on') return;
    this.state = 'gone';
    this.socket = null;
    this.log('keeper: the pipe to it closed; its consoles ended');
    for (const t of this.terms.values()) t.ended(-1);
    this.terms.clear();
    for (const w of this.waits.values()) w(null);
    this.waits.clear();
    for (const fn of this.goneFns) fn('lost');
  }
}

if (require.main === module) keeper();

module.exports = { Keeper, KeptTerm, pipeOf, V };
