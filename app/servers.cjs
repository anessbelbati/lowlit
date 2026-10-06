'use strict';
// The servers the person pins: their projects' dev servers and dashboards, each a command run in a folder. The list
// is a file of its own (servers.json, next to the settings) that this app and servers-cli.cjs both write: Claude Code
// adds to it through the second, once the person has said yes. A server started here runs on its own: what it
// prints goes to a file, and it keeps running when the app closes. Stop ends it and every program under it. One
// that runs without having been started here is known by the port it listens on or the folder it works in, found
// by the helper that measures the programs (procs.ps1), and it is ended only once the person has seen which
// program that is. Nothing here ever ends a program whose number and start time were not just checked.
const fs = require('node:fs');
const path = require('node:path');
const { spawn, execFile } = require('node:child_process');

const ID = /^s[0-9a-z]{6,12}$/;
const MAX = 40;
const HIDDEN_MAX = 100;
const LOG_MAX = 8 * 1024 * 1024;   // what a running server printed is cut back to nothing past this
const TAIL = 64 * 1024;            // how much of the end of it the page is shown
const STARTING_MS = 60000;         // a server that has not opened a port yet counts as starting this long
const ANSI = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[@-Z\\-_]/g;
// the first address a server prints for itself: "Local: http://localhost:5173/"
const LOCAL = /https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1?\])(?::\d{2,5})?(?:\/[^\s'"<>]*)?/i;
const RUNNERS = /^(npm|pnpm|yarn|bun)(?: run)? ([a-z0-9:_-]{1,40})$/;
// dev tools whose own command takes --port N: one of these that gaming mode stops comes back at the port it had
const PORT_FLAG = new Set(['vite', 'astro', 'next', 'nuxt', 'storybook', 'gatsby', 'wrangler', 'webpack', 'webpack-dev-server', 'parcel', 'expo', 'json-server', 'http-server']);
// the only commands a server gaming mode stopped, never pinned, is started again with: the ones recipe() makes
const AGAIN = /^(?:(?:npm|bun) run [a-z0-9:_-]{1,40}(?: (?:-- )?--port \d{2,5})?|(?:pnpm|yarn) [a-z0-9:_-]{1,40}(?: --port \d{2,5})?|python -m http\.server \d{2,5})$/i;

const folderKey = (dir) => String(dir || '').replace(/[\\/]+$/, '').toLowerCase();
const isDir = (p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };
const leaf = (p) => String(p || '').split(/[\\/]/).filter(Boolean).pop() || '';
const wait = (ms) => new Promise((done) => setTimeout(done, ms));
const bare = (name) => String(name || '').replace(/\.exe$/i, '');
/** Start times from the helper are whole milliseconds: the same program has the same one. */
const near = (a, b, ms) => Boolean(a) && Boolean(b) && Math.abs(a - b) <= ms;
const newId = () => `s${Date.now().toString(36).slice(-6)}${Math.random().toString(36).slice(2, 5)}`;

/** A web address to open the server at, http or https only. "3000" and "localhost:3000" mean http://localhost:3000/. */
function addressOf(text) {
  let t = String(text || '').trim();
  if (!t || t.length > 400) return '';
  if (/^\d{2,5}$/.test(t)) t = `localhost:${t}`;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(t)) t = `http://${t}`;
  try {
    const u = new URL(t);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
    // the address a server says it listens on everywhere is opened on this machine
    if (u.hostname === '0.0.0.0' || u.hostname === '[::]') u.hostname = 'localhost';
    return u.href;
  } catch {
    return '';
  }
}
const portOf = (url) => { try { const u = new URL(url); return Number(u.port) || (u.protocol === 'https:' ? 443 : 80); } catch { return 0; } };

/** A folder as a whole path on this machine, without a slash at its end; '' when it is none. */
function folderOf(text) {
  const f = String(text || '').trim();
  if (!f || f.length > 260 || !path.win32.isAbsolute(f)) return '';
  const whole = path.win32.normalize(f);
  const root = path.win32.parse(whole).root;
  // a drive or a share by name: "\folder" alone says nothing about where it is
  if (root.length < 3) return '';
  return whole.length > root.length ? whole.replace(/\\+$/, '') : root;
}

/** One server as handed over (by the page, the command line, the file), made fit to keep; null when it is not one. */
function takeServer(s) {
  if (!s || typeof s !== 'object') return null;
  const name = typeof s.name === 'string' ? s.name.replace(/\s+/g, ' ').trim().slice(0, 40) : '';
  const folder = folderOf(s.folder);
  // one line: what cmd runs, as the person would type it in that folder
  const command = typeof s.command === 'string' ? s.command.replace(/[\r\n]+/g, ' ').trim().slice(0, 1000) : '';
  if (!name || !folder || !command) return null;
  return {
    id: typeof s.id === 'string' && ID.test(s.id) ? s.id : newId(),
    name,
    folder,
    command,
    url: addressOf(s.url),
    by: s.by === 'claude' ? 'claude' : 'app',
    added: Number.isFinite(s.added) ? s.added : Date.now(),
  };
}

/**
 * The list as kept on disk: { servers, hidden }. null when the file is there but cannot be read as one: nothing is
 * written over it then. hidden: the running servers the person said are not theirs to see, by program and folder.
 */
function readList(file) {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch (err) { return err.code === 'ENOENT' ? { servers: [], hidden: [] } : null; }
  let kept;
  try { kept = JSON.parse(text.replace(/^\uFEFF/, '')); } catch { return null; }
  if (!kept || typeof kept !== 'object') return null;
  const servers = [];
  const ids = new Set();
  for (const s of Array.isArray(kept.servers) ? kept.servers : []) {
    const t = takeServer(s);
    if (!t || ids.has(t.id) || servers.length >= MAX) continue;
    ids.add(t.id);
    servers.push(t);
  }
  const hidden = [...new Set((Array.isArray(kept.hidden) ? kept.hidden : []).filter((k) => typeof k === 'string' && k.length < 300))].slice(-HIDDEN_MAX);
  return { servers, hidden };
}

/** Written whole and then put in place, so that a reader never finds half of it. */
function writeList(file, list) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ servers: list.servers, hidden: list.hidden }, null, 1));
  for (let i = 0; ; i++) {
    try { fs.renameSync(tmp, file); return; } catch (err) {
      // the other writer, or a reader, has it open this very moment
      if (i >= 8 || (err.code !== 'EPERM' && err.code !== 'EBUSY' && err.code !== 'EACCES')) { try { fs.rmSync(tmp, { force: true }); } catch { /* left */ } throw err; }
      const until = Date.now() + 40;
      while (Date.now() < until) { /* a moment */ }
    }
  }
}

/** The scripts of a folder's package.json, as its own package manager runs them: [{ name, script, run }]. */
function scriptsOf(folder) {
  const dir = folderOf(folder);
  if (!dir) return [];
  const has = (f) => { try { return fs.statSync(path.join(dir, f)).isFile(); } catch { return false; } };
  const out = [];
  let pkg = null;
  try { pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8').replace(/^\uFEFF/, '')); } catch { /* none, or not readable */ }
  if (pkg && pkg.scripts && typeof pkg.scripts === 'object') {
    const runner = has('pnpm-lock.yaml') ? 'pnpm' : has('yarn.lock') ? 'yarn' : has('bun.lockb') || has('bun.lock') ? 'bun' : 'npm';
    const first = ['dev', 'start', 'serve', 'preview'];
    const rank = (name) => (first.includes(name) ? first.indexOf(name) : first.length);
    for (const [name, script] of Object.entries(pkg.scripts).sort(([a], [b]) => rank(a) - rank(b))) {
      if (out.length >= 12 || !/^[a-z0-9:_-]{1,40}$/i.test(name) || typeof script !== 'string') continue;
      out.push({ name, script: script.slice(0, 200), run: runner === 'npm' || runner === 'bun' ? `${runner} run ${name}` : `${runner} ${name}` });
    }
  }
  if (has('manage.py')) out.push({ name: 'runserver', script: 'Django', run: 'python manage.py runserver' });
  return out;
}

/**
 * How a dev server found running was most likely started, from what is known of it without its command line: the
 * runner and script procs.ps1 saw ("npm run dev"), else the script of its folder that runs the tool it is, else
 * Python's own server. { command, script, runner }: script, the folder's script it runs, when that is known.
 */
function startOf({ via, label, ports }, scripts) {
  const r = RUNNERS.exec(via || '');
  if (r) return { command: r[1] === 'npm' || r[1] === 'bun' ? `${r[1]} run ${r[2]}` : `${r[1]} ${r[2]}`, script: scripts.find((s) => s.name === r[2]) || null, runner: r[1] };
  if (label) {
    // the folder's own script that runs the tool it is: "dev": "astro dev"
    const tool = label.toLowerCase();
    const s = scripts.find((x) => x.script.toLowerCase().split(/[\s&|;]+/).some((word) => word === tool || word.endsWith(`/${tool}`)));
    if (s) return { command: s.run, script: s, runner: s.run.split(' ')[0] };
  }
  if (label === 'http.server' && ports.length) return { command: `python -m http.server ${ports[0]}`, script: null, runner: '' };
  return { command: '', script: null, runner: '' };
}

/** A server to start again as gaming mode left it, made fit to run: null unless its command is one recipe() makes. */
function takeAgain(r) {
  const t = takeServer(r);
  if (!t || !AGAIN.test(t.command)) return null;
  return { name: t.name, folder: t.folder, command: t.command, url: t.url, label: typeof r.label === 'string' ? r.label.slice(0, 40) : '' };
}

/** The last part of a file, as text to read: colours taken out, a line redrawn in place shown as it ended. */
function tailOf(file, size = TAIL) {
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const total = fs.fstatSync(fd).size;
    const n = Math.min(total, size);
    const buf = Buffer.alloc(n);
    fs.readSync(fd, buf, 0, n, total - n);
    let text = buf.toString('utf8').replace(ANSI, '').replace(/\r\n/g, '\n');
    // the first line may have been cut in two
    if (total > n) text = text.slice(text.indexOf('\n') + 1);
    text = text.split('\n').map((line) => line.slice(line.lastIndexOf('\r') + 1)).join('\n');
    return { text, size: total };
  } catch {
    return { text: '', size: 0 };
  } finally {
    if (fd !== undefined) try { fs.closeSync(fd); } catch { /* closed */ }
  }
}

/** Ends exactly these programs, at once. Resolves when taskkill is done; what it could not end shows at the next look. */
function end(pids) {
  const list = [...new Set(pids)].filter((pid) => Number.isInteger(pid) && pid > 4).slice(0, 300);
  if (!list.length) return Promise.resolve();
  const args = ['/F'];
  for (const pid of list) args.push('/PID', String(pid));
  return new Promise((done) => {
    execFile(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'taskkill.exe'), args, { windowsHide: true, timeout: 15000 }, () => done());
  });
}

class Servers {
  /**
   * dir: the app's own folder. ask(roots): the helper's answer about those programs and the dev servers on the
   * machine (procs.ps1), or null. env(): what a server starts with. confirm(info): asks the person before a program
   * this app did not start is ended; resolves true to go on. changed(view): what the page shows may have changed.
   */
  constructor({ dir, ask, env, confirm, changed, log }) {
    this.file = path.join(dir, 'servers.json');
    this.outDir = path.join(dir, 'servers');
    this.runFile = path.join(this.outDir, 'started.json');
    this.ask = ask;
    this.env = env;
    this.confirm = confirm;
    this.changed = changed || (() => {});
    this.log = log || (() => {});
    this.list = readList(this.file) || { servers: [], hidden: [] };
    // what this app started: id -> { pid, at, started, tree: [[pid, started]], exit, stopping, url }
    this.run = {};
    try { const kept = JSON.parse(fs.readFileSync(this.runFile, 'utf8')); if (kept && typeof kept === 'object') this.run = kept; } catch { /* none yet */ }
    // what ran when this app last ran: started here, neither stopped nor ended by itself. Read before the first look,
    // which forgets the ones that are gone.
    this.before = Object.entries(this.run).filter(([, r]) => r && Number.isInteger(r.pid) && !r.exit && !r.stopping).map(([id]) => id);
    // the servers never pinned that gaming mode stopped at the last close: { name, folder, command, url, label }
    this.again = [];
    this.comeBack = false;
    this.children = new Map();      // id -> the program this app started, while it runs and this app does
    this.rows = new Map();          // the programs of the last answer, by number
    this.groups = [];               // the dev servers found there that are no server started here
    this.view = { at: 0, ready: false, servers: [], loose: [], hidden: 0 };
    this.said = '';
    this.looking = null;
    this.watching = false;
  }

  /** The list file is read again whenever it changes on disk: the command line writes it too. */
  watch() {
    if (this.watching) return;
    this.watching = true;
    fs.watchFile(this.file, { interval: 1500 }, () => {
      const next = readList(this.file);
      if (!next) return;
      this.list = next;
      this.look();
    });
  }

  close() {
    if (this.watching) fs.unwatchFile(this.file);
    this.watching = false;
    this.saveRun();
  }

  get busy() { return this.comeBack || this.list.servers.length > 0 || Object.keys(this.run).length > 0; }

  outFile(id) { return path.join(this.outDir, `${id}.log`); }

  saveRun() {
    try {
      fs.mkdirSync(this.outDir, { recursive: true });
      fs.writeFileSync(`${this.runFile}.tmp`, JSON.stringify(this.run));
      fs.renameSync(`${this.runFile}.tmp`, this.runFile);
    } catch (err) {
      this.log(`servers: what was started not saved: ${err.message}`);
    }
  }

  save() {
    try { writeList(this.file, this.list); return ''; } catch (err) { this.log(`servers: list not saved: ${err.message}`); return 'The list of servers could not be saved.'; }
  }

  /** Asks the helper what runs, and works out what the page shows. Asked again while it is out: the same answer. */
  look() {
    if (this.looking) return this.looking;
    this.looking = (async () => {
      const roots = [];
      for (const r of Object.values(this.run)) {
        if (r && Number.isInteger(r.pid)) roots.push(r.pid);
        for (const [pid] of Array.isArray(r && r.tree) ? r.tree : []) roots.push(pid);
      }
      let got = null;
      try { got = await this.ask([...new Set(roots)]); } catch { /* no answer */ }
      this.make(got, Date.now());
      const said = JSON.stringify({ ...this.view, at: 0 });
      if (said !== this.said) { this.said = said; this.changed(this.view); }
      return this.view;
    })().finally(() => {
      this.looking = null;
      if (this.comeBack && this.view.ready) this.startAgain();
    });
    return this.looking;
  }

  /**
   * The person kept their things when the app last closed (or it never got to close): the servers that ran then
   * start again once a look with the helper's answer shows them gone. One that still runs, or whose port another
   * program holds now, is left as it is.
   */
  bringBack(extra = [], before = true, again = []) {
    // extra: the pinned servers gaming mode stopped at the last close; before: false leaves the ones that simply ran
    // then; again: the ones it stopped that were never pinned, each with the command it starts again with
    this.before = [...new Set([...(before ? this.before : []), ...extra.filter((id) => typeof id === 'string')])];
    this.again = (Array.isArray(again) ? again : []).map(takeAgain).filter(Boolean).slice(0, MAX);
    this.comeBack = this.before.length > 0 || this.again.length > 0;
  }

  /**
   * Gaming mode: every dev server ends, so that nothing holds the computer while the person plays: the pinned ones
   * started here, the pinned ones found running elsewhere, whatever holds a pinned one's port, the others found
   * running, and the ones the person hid on the page. Nothing is asked one by one: the person chose it for all of
   * them. A chain with Claude Code in it is left alone: ended from here, Claude Code would be cut off mid-session.
   * Returns what comes back at the next start (bringBack): pinned, the pinned ones that ran; again, how each other one
   * starts again (recipe); lost, the names of the ones whose start cannot be told.
   * only(folder): just the servers in those folders (a test run, which must never end the person's own).
   */
  async stopAll(only = null) {
    await this.fresh();
    const fits = (folder) => !only || Boolean(only(folder));
    const back = [];
    for (const s of this.view.servers) {
      if (!fits(s.folder) || (s.state !== 'running' && s.state !== 'starting')) continue;
      const r = await this.stop(s.id);
      if (r && r.ok) back.push(s.id);
    }
    const elsewhere = this.view.servers.filter((s) => fits(s.folder) && s.state === 'elsewhere').map((s) => s.id);
    let ended = 0;
    let spared = 0;
    const again = [];
    const lost = [];
    for (let round = 0; round < 3; round++) {
      await this.fresh();
      const left = this.groups.filter((g) => fits(g.folder));
      const go = left.filter((g) => !g.list.some((r) => r.kind === 'claude'));
      if (round === 0) {
        ended = go.length;
        spared = left.length - go.length;
        // read before they end: what each one never pinned starts again with
        for (const g of go) {
          if (g.pinned) continue;
          const r = this.recipe(g);
          if (!r) lost.push(`${leaf(g.folder) || g.label || bare(g.listener.name)}${g.ports.length ? ` (port ${g.ports[0]})` : ''}`);
          else if (!again.some((x) => folderKey(x.folder) === folderKey(r.folder) && x.command === r.command)) again.push(r);
        }
      }
      if (!go.length) break;
      await end(go.flatMap((g) => g.list.map((r) => r.pid)));
      await wait(300);
    }
    await this.fresh();
    const still = new Set(this.view.servers.filter((s) => s.state === 'elsewhere').map((s) => s.id));
    for (const id of elsewhere) if (!still.has(id)) back.push(id);
    this.log(`servers: gaming mode stopped ${back.length} pinned and ${ended} other${spared ? `; ${spared} left alone: Claude Code runs in their chain` : ''}; `
      + `${again.length} of the others start again at the next start${lost.length ? `, not ${lost.join(', ')}: how ${lost.length === 1 ? 'it was' : 'they were'} started cannot be told` : ''}`);
    return { pinned: back, again, lost };
  }

  startAgain() {
    this.comeBack = false;
    const ids = this.before.filter((id) => (this.view.servers.find((s) => s.id === id) || {}).state === 'stopped');
    this.before = [];
    // one running again already (started by hand or by a chat meanwhile) is left as it is
    const again = this.again.filter((r) => {
      const port = portOf(r.url);
      return !this.groups.some((g) => (port && g.ports.includes(port)) || (folderKey(g.folder) === folderKey(r.folder) && (!r.label || g.label === r.label)));
    });
    this.again = [];
    if (ids.length) this.log(`servers: ${ids.length} that ran when Lowlit last ran started again`);
    for (const id of ids) {
      this.start(id).then((r) => { if (r && r.error) this.log(`servers: one did not start again: ${r.error}`); }, () => {});
    }
    if (again.length) this.log(`servers: ${again.length} that gaming mode stopped started again: ${again.map((r) => `${r.name} (${r.command})`).join(', ')}`);
    again.forEach((r, i) => this.startLoose(r, i));
  }

  /**
   * What starts again a dev server gaming mode stops that was never pinned: its folder, and the command it was most
   * likely started with (startOf), at the port it listened on, given to its dev tool when its script names none. null
   * when that cannot be told for sure, for a program known only as node or python: a guess could start something else.
   */
  recipe(g) {
    if (!g.folder || !isDir(g.folder)) return null;
    // the tool it is, as procs.ps1 named it: not the name of the program that listens
    const tool = g.label && g.list.some((r) => r.kind === 'tool' && r.label === g.label) ? g.label.toLowerCase() : '';
    if (!RUNNERS.test(g.via) && !tool) return null;
    const port = g.ports[0] || 0;
    const s = startOf({ via: g.via, label: tool, ports: g.ports }, scriptsOf(g.folder));
    if (!s.command) return null;
    let command = s.command;
    // "astro dev" started with --port 4330: its script alone starts it at 4321, or at whatever is free
    const script = s.script ? s.script.script.trim() : '';
    const words = script.split(/\s+/);
    const plain = PORT_FLAG.has(tool) && port && (words[0] === 'npx' ? words[1] : words[0]) === tool
      && !/[&|;<>]/.test(script) && !/(?:^|\s)(?:--port|-p)(?:[\s=]|$)|\bPORT=/i.test(script);
    if (plain) command += s.runner === 'npm' ? ` -- --port ${port}` : ` --port ${port}`;
    if (!AGAIN.test(command)) return null;
    return { name: leaf(g.folder) || tool, folder: g.folder, command, url: port ? `http://localhost:${port}/` : '', label: g.label || '' };
  }

  /** Starts again, on its own, a server gaming mode stopped that was never pinned: as start() does, unwatched after. */
  startLoose(r, i) {
    if (!isDir(r.folder)) { this.log(`servers: ${r.name} did not start again: its folder is gone`); return; }
    const file = path.join(this.outDir, `again-${i + 1}.log`);
    const got = this.launch(r.command, r.folder, file);
    if (got.error) { this.log(`servers: ${r.name} did not start again: ${got.error}`); return; }
    const at = Date.now();
    got.child.on('error', () => {});
    got.child.on('exit', (code) => {
      if (code && Date.now() - at < STARTING_MS) this.log(`servers: ${r.name} (${r.command}) ended ${Math.round((Date.now() - at) / 1000)} s after it started again, code ${code}; what it printed is in ${file}`);
      this.look();
    });
    this.look();
  }

  /** A look asked for after now: one already out was asked before what just happened. */
  async fresh() {
    if (this.looking) await this.looking.catch(() => {});
    return this.look();
  }

  /** The programs of a server started here that are still there: the first one, and any seen under it since. */
  alive(r) {
    const out = [];
    const first = this.rows.get(r.pid);
    // its start time is known once a look has seen it; before that, it started when it was started from here
    if (first && (r.started ? near(first.started, r.started, 2) : near(first.started, r.at, 3000))) out.push(first);
    for (const [pid, started] of Array.isArray(r.tree) ? r.tree : []) {
      const x = this.rows.get(pid);
      if (x && near(x.started, started, 2) && !out.includes(x)) out.push(x);
    }
    return out;
  }

  /** A program and every program under it. */
  under(tops) {
    const out = [];
    const seen = new Set();
    const walk = [...tops];
    while (walk.length) {
      const r = walk.pop();
      if (seen.has(r.pid)) continue;
      seen.add(r.pid);
      out.push(r);
      walk.push(...r.kids);
    }
    return out;
  }

  /** What a set of programs adds up to: its ports, its memory, how many programs, and what it is (vite, npm run dev). */
  sum(list) {
    const ports = [...new Set(list.flatMap((r) => r.ports))].sort((a, b) => a - b);
    const listener = list.find((r) => r.ports.length);
    const tool = (listener && listener.kind === 'tool' && listener) || list.find((r) => r.kind === 'tool' && !RUNNERS.test(r.label) && r.label !== 'npm');
    const runner = list.find((r) => r.kind === 'tool' && RUNNERS.test(r.label));
    return {
      ports,
      mem: list.reduce((n, r) => n + (r.mem || 0), 0),
      programs: list.length,
      label: tool ? tool.label : listener ? bare(listener.name) : '',
      via: runner ? runner.label : '',
    };
  }

  make(got, now) {
    const rows = new Map();
    if (got && Array.isArray(got.p)) {
      for (const [pid, ppid, name, started, ws, mem, , kind, label] of got.p) {
        rows.set(pid, { pid, ppid, name: String(name || ''), started: Number(started) || 0, ws: Number(ws) || 0, mem: Number(mem) || 0, kind: String(kind || ''), label: String(label || ''), kids: [], ports: [] });
      }
      for (const r of rows.values()) {
        const up = rows.get(r.ppid);
        // a parent's number can go to a new program once it ends: a child older than its parent is not its child
        if (up && up !== r && !(r.started && up.started && r.started < up.started)) up.kids.push(r);
      }
      for (const [port, pid] of Array.isArray(got.l) ? got.l : []) { const r = rows.get(pid); if (r && !r.ports.includes(port)) r.ports.push(port); }
    }
    this.rows = rows;
    const known = Boolean(got);
    const mine = new Set();
    let runChanged = false;
    const servers = this.list.servers.map((def) => {
      const base = { id: def.id, name: def.name, folder: def.folder, command: def.command, url: def.url, by: def.by, added: def.added, state: 'stopped', ports: [], mem: 0, programs: 0, label: '', via: '' };
      const r = this.run[def.id];
      if (!r) return base;
      if (!known) {
        // no answer from the helper: what is known without it. One started before this app last started: not known.
        const runs = this.children.has(def.id);
        return { ...base, state: runs ? (now - r.at < STARTING_MS ? 'starting' : 'running') : r.exit ? (r.exit.code ? 'failed' : 'stopped') : 'checking', since: r.at, exit: r.exit || null, seen: r.url || '' };
      }
      const tops = this.alive(r);
      if (tops.length) {
        const list = this.under(tops);
        for (const x of list) mine.add(x.pid);
        const first = this.rows.get(r.pid);
        if (!r.started && first && tops.includes(first)) { r.started = first.started; runChanged = true; }
        const tree = list.slice(0, 200).map((x) => [x.pid, x.started]);
        if (JSON.stringify(tree) !== JSON.stringify(r.tree)) { r.tree = tree; runChanged = true; }
        if (!r.url) {
          const found = LOCAL.exec(tailOf(this.outFile(def.id), 32 * 1024).text);
          if (found) { r.url = addressOf(found[0]); runChanged = true; }
        }
        // a server that has printed for days is cut back: what it prints next is kept
        try { if (fs.statSync(this.outFile(def.id)).size > LOG_MAX) fs.writeFileSync(this.outFile(def.id), `(${new Date().toISOString()} what it printed before was cut: it grew past 8 MB)\n`); } catch { /* none */ }
        const s = this.sum(list);
        const state = s.ports.length || now - r.at >= STARTING_MS ? 'running' : 'starting';
        return { ...base, ...s, state, since: r.at, seen: r.url || '' };
      }
      // nothing of it is left
      if (r.exit && r.exit.code && !r.stopping) return { ...base, state: 'failed', since: r.at, exit: r.exit };
      // gone before this look, its end not reported yet: how it ended comes with that report
      if (this.children.has(def.id)) return { ...base, state: 'starting', since: r.at };
      delete this.run[def.id];
      runChanged = true;
      return base;
    });
    // a server started here and taken off the list since is forgotten: if it still runs, it is shown with the others
    for (const id of Object.keys(this.run)) if (!this.list.servers.some((s) => s.id === id)) { delete this.run[id]; runChanged = true; }
    if (runChanged) this.saveRun();

    // the dev servers this app did not start (or started, and lost hold of since)
    const groups = [];
    for (const [top, listener, folder] of known && Array.isArray(got.s) ? got.s : []) {
      const t = rows.get(top);
      if (!t || mine.has(top)) continue;
      const list = this.under([t]);
      if (list.some((x) => mine.has(x.pid))) continue;
      const l = rows.get(listener) || t;
      const g = { top: t, listener: l, folder: folderOf(folder), list, ...this.sum(list) };
      g.key = g.folder ? `${bare(l.name).toLowerCase()}|${folderKey(g.folder)}` : `${bare(l.name).toLowerCase()}:${g.ports[0] || 0}`;
      groups.push(g);
    }
    this.groups = groups;
    const taken = new Set();
    for (const v of servers) {
      if (v.state !== 'stopped' && v.state !== 'failed') continue;
      const port = v.url ? portOf(v.url) : 0;
      const def = this.list.servers.find((s) => s.id === v.id);
      let g = port ? groups.find((x) => !taken.has(x) && x.ports.includes(port)) : null;
      const byPort = Boolean(g);
      if (!g) g = groups.find((x) => !taken.has(x) && x.folder && folderKey(x.folder) === folderKey(def.folder));
      if (!g) continue;
      taken.add(g);
      // its port is held by a program of another folder: that one is in the way, it is not this server
      const other = byPort && g.folder && folderKey(g.folder) !== folderKey(def.folder);
      Object.assign(v, { state: other ? 'blocked' : 'elsewhere', since: g.top.started, ports: g.ports, mem: g.mem, programs: g.programs, label: g.label, via: g.via,
        holder: { pid: g.top.pid, started: g.top.started, name: bare(g.listener.name), folder: g.folder } });
      if (!other) g.pinned = v.id;
    }
    const hidden = new Set(this.list.hidden);
    const loose = groups.filter((g) => !taken.has(g) && !hidden.has(g.key)).map((g) => ({
      key: g.key, pid: g.top.pid, started: g.top.started, name: bare(g.listener.name), label: g.label, via: g.via,
      ports: g.ports, folder: g.folder, mem: g.mem, programs: g.programs, since: g.top.started,
    })).sort((a, b) => (a.ports[0] || 0) - (b.ports[0] || 0));
    this.view = { at: now, ready: known, servers, loose, hidden: groups.filter((g) => !taken.has(g) && hidden.has(g.key)).length };
    return this.view;
  }

  /** Starts a pinned server in its folder. Its output goes to a file; it keeps running when this app closes. */
  async start(id) {
    const def = this.list.servers.find((s) => s.id === id);
    if (!def) return { error: 'That server is not on the list any more.' };
    const v = this.view.servers.find((s) => s.id === id);
    if (this.run[id] && this.alive(this.run[id]).length) return { ok: true };
    if (v && v.state === 'elsewhere') return { error: `${def.name} already runs: ${v.holder.name} started it outside Lowlit.` };
    if (v && v.state === 'blocked') return { error: `Port ${portOf(def.url)} is taken by ${v.holder.name}${v.holder.folder ? ` in ${leaf(v.holder.folder)}` : ''}.` };
    if (!isDir(def.folder)) return { error: `The folder ${def.folder} is not there.` };
    const got = this.launch(def.command, def.folder, this.outFile(id));
    if (got.error) return { error: got.error };
    const child = got.child;
    this.children.set(id, child);
    this.run[id] = { pid: child.pid, at: Date.now(), started: 0, tree: [], exit: null };
    this.saveRun();
    const done = (code) => {
      if (this.children.get(id) === child) this.children.delete(id);
      const r = this.run[id];
      if (!r || r.pid !== child.pid) return;
      if (r.stopping) delete this.run[id];
      else r.exit = { code: Number.isInteger(code) ? code : -1, at: Date.now() };
      this.saveRun();
      this.look();
    };
    child.on('exit', done);
    child.on('error', (err) => { try { fs.appendFileSync(this.outFile(id), `\n${err.message}\n`); } catch { /* none */ } done(-1); });
    this.look();
    return { ok: true };
  }

  /** Runs a command in a folder as a console would, hidden, what it prints going to file: { child } or { error }. */
  launch(command, folder, file) {
    let fd;
    try {
      fs.mkdirSync(this.outDir, { recursive: true });
      fs.writeFileSync(file, `${new Date().toLocaleString('en-GB')}  ${command}\n`);
      // appended to: cut back from here while it runs, it goes on writing at the new end
      fd = fs.openSync(file, 'a');
    } catch (err) {
      return { error: `Its output file could not be made: ${err.message}` };
    }
    let child;
    try {
      // cmd, as a console would run it; hidden, and its own programs share its hidden console
      child = spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `"${command}"`],
        { cwd: folder, env: this.env(), stdio: ['ignore', fd, fd], windowsHide: true, windowsVerbatimArguments: true });
    } catch (err) {
      return { error: `It did not start: ${err.message}` };
    } finally {
      fs.closeSync(fd);
    }
    // its error comes on the next turn: heard, or it would end this app
    if (!child.pid) { child.on('error', () => {}); return { error: 'It did not start.' }; }
    return { child };
  }

  /**
   * Ends a server and everything under it. Started here: at once. Running without having been started here: only
   * the program the page showed (holder: { pid, started }), only while it still is that program and still serves
   * this server's port or folder, and only once the person has said yes.
   */
  async stop(id, holder) {
    const def = this.list.servers.find((s) => s.id === id);
    const r = this.run[id];
    if (r) {
      r.stopping = true;
      this.saveRun();
      // looked at first: what it started since the last look is under it now
      for (let round = 0; round < 3; round++) {
        await this.fresh();
        const list = this.under(this.alive(r));
        if (!list.length) break;
        await end(list.map((x) => x.pid));
        await wait(300);
      }
      const child = this.children.get(id);
      if (child && child.exitCode === null) try { child.kill(); } catch { /* gone */ }
      delete this.run[id];
      this.saveRun();
      await this.fresh();
      return { ok: true };
    }
    if (!def || !holder) return { ok: true };
    const port = portOf(def.url);
    return this.stopOther(holder, (g) => (port && g.ports.includes(port)) || folderKey(g.folder) === folderKey(def.folder));
  }

  /** Ends a dev server that is no pinned one: the program the page showed, once the person has said yes. */
  stopLoose(key, holder) {
    return this.stopOther(holder, (g) => g.key === key);
  }

  /** ask: false only for gaming mode, where the person chose to end every server at once. */
  async stopOther(holder, fits, ask = true) {
    if (!holder || !Number.isInteger(holder.pid) || !Number.isFinite(holder.started)) return { error: 'Which program to stop was not said.' };
    await this.fresh();
    const g = this.groups.find((x) => x.top.pid === holder.pid && near(x.top.started, holder.started, 2));
    // gone already, or its number now belongs to another program: either way there is nothing of it to stop
    if (!g) return { ok: true, gone: true };
    if (!fits(g)) return { error: 'That program no longer serves it.' };
    const yes = !ask || await this.confirm({ name: bare(g.listener.name), label: g.label, via: g.via, ports: g.ports, folder: g.folder, programs: g.programs });
    if (!yes) return { ok: false, kept: true };
    for (let round = 0; round < 3; round++) {
      const again = round ? (await this.fresh(), this.groups.find((x) => x.top.pid === g.top.pid && near(x.top.started, g.top.started, 2))) : g;
      if (!again) break;
      await end(again.list.map((x) => x.pid));
      await wait(300);
    }
    await this.fresh();
    return { ok: true };
  }

  /** Stops it if it runs (from here or elsewhere, asking first for the second), waits for its port, and starts it here. */
  async restart(id, holder) {
    const v = this.view.servers.find((s) => s.id === id);
    if (this.run[id] || (v && v.state === 'elsewhere')) {
      const stopped = await this.stop(id, holder || (v && v.holder));
      if (stopped.error || stopped.kept) return stopped;
    }
    const def = this.list.servers.find((s) => s.id === id);
    const port = def ? portOf(def.url) : 0;
    // the port it held is let go of before it starts again
    for (let i = 0; port && i < 20; i++) {
      await this.fresh();
      if (!this.groups.some((g) => g.ports.includes(port))) break;
      await wait(250);
    }
    return this.start(id);
  }

  add(s, by = 'app') {
    const t = takeServer({ ...s, id: undefined, by });
    if (!t) return { error: 'A server needs a name, a whole folder path and the command that starts it.' };
    if (this.list.servers.length >= MAX) return { error: `The list holds ${MAX} servers at most.` };
    const twin = this.list.servers.find((x) => folderKey(x.folder) === folderKey(t.folder) && x.command === t.command);
    if (twin) return { ok: true, id: twin.id, already: true };
    this.list.servers.push(t);
    const error = this.save();
    if (error) { this.list.servers.pop(); return { error }; }
    this.look();
    return { ok: true, id: t.id };
  }

  update(id, s) {
    const i = this.list.servers.findIndex((x) => x.id === id);
    if (i < 0) return { error: 'That server is not on the list any more.' };
    const old = this.list.servers[i];
    const t = takeServer({ ...old, ...s, id: old.id, added: old.added, by: old.by });
    if (!t) return { error: 'A server needs a name, a whole folder path and the command that starts it.' };
    this.list.servers[i] = t;
    const error = this.save();
    if (error) { this.list.servers[i] = old; return { error }; }
    this.look();
    return { ok: true, id };
  }

  /** Takes a server off the list. One that runs goes on running: it is shown with the servers that are not pinned. */
  remove(id) {
    const before = this.list.servers;
    this.list.servers = before.filter((x) => x.id !== id);
    if (this.list.servers.length === before.length) return { ok: true };
    const error = this.save();
    if (error) { this.list.servers = before; return { error }; }
    delete this.run[id];
    this.children.delete(id);
    this.saveRun();
    this.look();
    return { ok: true };
  }

  hide(key, on = true) {
    if (typeof key !== 'string' || key.length > 300) return { error: 'Not one of the servers shown.' };
    const had = this.list.hidden.slice();
    this.list.hidden = on ? [...new Set([...had, key])].slice(-HIDDEN_MAX) : key === '*' ? [] : had.filter((k) => k !== key);
    const error = this.save();
    if (error) { this.list.hidden = had; return { error }; }
    this.look();
    return { ok: true };
  }

  /** What a server started here printed last. */
  output(id) {
    if (!this.list.servers.some((s) => s.id === id)) return { text: '', size: 0 };
    return tailOf(this.outFile(id));
  }

  /** What to fill the form with, to pin a server that runs without having been started here. */
  guess(key) {
    const g = this.groups.find((x) => x.key === key);
    if (!g) return null;
    const scripts = scriptsOf(g.folder);
    return {
      name: leaf(g.folder) || g.label || 'Server',
      folder: g.folder,
      command: startOf(g, scripts).command,
      url: g.ports.length ? `http://localhost:${g.ports[0]}/` : '',
      scripts: scripts.map((s) => s.run),
    };
  }
}

module.exports = { Servers, takeServer, readList, writeList, scriptsOf, startOf, addressOf, portOf, folderOf };
