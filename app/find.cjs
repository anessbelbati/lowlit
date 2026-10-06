'use strict';
// A private, disposable index of moments in Claude transcripts. Source files are only read.
// The worker owns its disk files and its pace; neither the window nor the watcher waits for it.
const fs = require('node:fs');
const path = require('node:path');
const { isMainThread, parentPort, workerData } = require('node:worker_threads');
const { StringDecoder } = require('node:string_decoder');
const { createHash } = require('node:crypto');
const { eachLine, dayKey } = require('./transcript.cjs');

const PAGE = 128 * 1024;
const CAP = 280 * 1024 * 1024; // Room for the checkpoint and its replacement below the 300 MB ceiling.
const FREE_MIN = 1024 * 1024 * 1024; // below this much free on its drive, the index stops growing
// Keys and passwords typed into a command or a message stay in the conversation file: the index never holds them.
const SECRETS = [
  /\b(sk|pk|rk)-[A-Za-z0-9_-]{16,}/g,
  /\bgh[pousr]_[A-Za-z0-9]{20,}/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}/g,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g,
];
const AFTER = [
  /\b((?:Bearer|Basic)\s+)[A-Za-z0-9._~+/=-]{12,}/gi,
  /\b([A-Za-z_]*(?:key|token|secret|password|passwd|pwd)[A-Za-z_]*\s*[=:]\s*["']?)[^\s"']{6,}/gi,
  /(--?(?:password|passwd|pwd|token|api-?key|secret)[=\s]+["']?)[^\s"']{4,}/gi,
];
function hideSecrets(text) {
  let out = text;
  for (const re of SECRETS) out = out.replace(re, '[hidden]');
  for (const re of AFTER) out = out.replace(re, '$1[hidden]');
  return out;
}
const SESSION = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const little = new Set('which what when where who how session sessions chat chats conversation conversations the a an did do does i we my our in on at of to for with about that it is was'.split(' '));
const kinds = { touched: 'file', changed: 'file', edited: 'file', wrote: 'file', file: 'file', ran: 'ran', run: 'ran', command: 'ran', asked: 'asked', said: 'asked', told: 'asked', typed: 'asked' };
const weekdays = 'sunday monday tuesday wednesday thursday friday saturday'.split(' ');
const months = 'january february march april may june july august september october november december'.split(' ');
const cap3 = (s) => s[0].toUpperCase() + s.slice(1, 3);
const shortDay = (t) => { const x = new Date(t); return `${cap3(weekdays[x.getDay()])} ${x.getDate()} ${cap3(months[x.getMonth()])}`; };
const leaf = (s) => String(s || '').split(/[\\/]/).filter(Boolean).pop() || '';
const short = (s, n) => typeof s === 'string' ? s.slice(0, n).replace(/\s+/g, ' ').trim() : '';
const nextTurn = () => new Promise((resolve) => setImmediate(resolve));
const rest = () => new Promise((resolve) => setTimeout(resolve, 300));
const hourKey = (at) => `${dayKey(at)}:${new Date(at).getHours()}`;

function parseQuestion(q, folders = [], now = Date.now()) {
  const tokens = [...String(q || '').slice(0, 1000).matchAll(/"([^"]+)"|'([^']+)'|(\S+)/g)].map((m) => ({ word: (m[1] || m[2] || m[3]).toLowerCase(), quote: m[3] === undefined }));
  const d = new Date(now);
  const date = (delta = 0) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + delta).getTime();
  const monday = -((d.getDay() + 6) % 7);
  let from = -Infinity, to = Infinity, kind = '';
  const terms = [], understood = [], selected = [];
  const folderNames = new Map();
  for (const f of folders) { const name = leaf(f).toLowerCase(); if (name) folderNames.set(name, [...(folderNames.get(name) || []), f]); }
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i], w = t.word;
    if (t.quote) { terms.push(w); continue; }
    const words = (n) => tokens.slice(i, i + n).every((x) => !x.quote) ? tokens.slice(i, i + n).map((x) => x.word).join(' ') : '';
    let n = 0, a, b, said = '';
    if (w === 'today' || w === 'yesterday') { n = 1; a = date(w === 'today' ? 0 : -1); b = date(w === 'today' ? 1 : 0); }
    // "last week" said on a Saturday also means the days just gone: it runs from the Monday before up to now, and
    // says from when ("in september" is the way to ask for one month alone)
    else if (/^(this|last) week$/.test(words(2))) { n = 2; a = date(monday - (w === 'last' ? 7 : 0)); b = w === 'last' ? date(1) : date(monday + 7); }
    else if (/^(this|last) month$/.test(words(2))) { n = 2; a = new Date(d.getFullYear(), d.getMonth() - (w === 'last' ? 1 : 0), 1).getTime(); b = w === 'last' ? date(1) : new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime(); }
    else if (/^(past|last) \d+ days?$/.test(words(3))) { n = 3; a = date(-Math.min(36500, Math.max(1, Number(tokens[i + 1].word))) + 1); b = date(1); }
    else if (w === 'since' && words(2) && weekdays.includes(tokens[i + 1]?.word)) { n = 2; a = date(-((d.getDay() - weekdays.indexOf(tokens[i + 1].word) + 7) % 7)); b = date(1); }
    else if (w === 'in' && words(2) && months.includes(tokens[i + 1]?.word)) {
      n = 2; const month = months.indexOf(tokens[i + 1].word), year = d.getFullYear() - (month > d.getMonth() ? 1 : 0);
      a = new Date(year, month, 1).getTime(); b = new Date(year, month + 1, 1).getTime();
    }
    if (n === 2 && w === 'last' && /^(week|month)$/.test(tokens[i + 1].word)) said = `since ${shortDay(a)}`;
    if (n) { from = Math.max(from, a); to = Math.min(to, b); understood.push(said || words(n)); i += n - 1; }
    else if (kinds[w]) kind = kinds[w];
    else if (folderNames.has(w)) { selected.push(...folderNames.get(w)); understood.push(`in ${w}`); }
    else if (!little.has(w)) terms.push(w);
  }
  if (kind) understood.push({ file: 'files', ran: 'commands', asked: 'things you typed' }[kind]);
  return { from, to, kind, folders: [...new Set(selected)], terms: [...new Set(terms)], understood };
}

function momentsOf(o, id) {
  const at = Date.parse(o.timestamp);
  if (!Number.isFinite(at)) return [];
  const out = [], add = (kind, text, verb = '') => { if (text) out.push({ id, at, kind, text: kind === 'file' ? text : hideSecrets(text), verb }); };
  const blocks = Array.isArray(o.message?.content) ? o.message.content : [{ type: 'text', text: o.message?.content }];
  if (o.type === 'user') {
    if (o.isMeta || o.isCompactSummary || blocks.some((b) => b?.type === 'tool_result')) return out;
    const text = blocks.filter((b) => b?.type === 'text').map((b) => short(b.text, 400)).join(' ').slice(0, 400);
    if (!text.startsWith('<') && !text.startsWith('[Request interrupted') && (!o.origin?.kind || o.origin.kind === 'human')) add('asked', text);
  } else if (o.type === 'assistant') {
    for (const b of blocks) {
      if (b?.type === 'text') add('said', short(b.text, 200));
      else if (b?.type === 'tool_use') {
        const input = b.input || {};
        if (['Edit', 'MultiEdit', 'Write', 'NotebookEdit', 'Read'].includes(b.name)) add('file', short(input.file_path || input.notebook_path, 4096), b.name === 'Read' ? 'read' : b.name === 'Write' ? 'wrote' : 'edited');
        else if (b.name === 'Bash' || b.name === 'PowerShell') add('ran', short(input.command, 200), 'ran');
        else if (b.name === 'Grep' || b.name === 'Glob') add('looked', short(input.pattern, 400), 'looked for');
      }
    }
  }
  return out;
}

function collectMoment(groups, m, parsed, conversations) {
  const c = conversations[m.id];
  if (!c || m.at < parsed.from || m.at >= parsed.to || (parsed.folders.length && !parsed.folders.includes(c.cwd))) return;
  const hay = m.text.toLowerCase(), hits = parsed.terms.map((w, i) => hay.includes(w) ? i : -1).filter((i) => i >= 0);
  let g = groups.get(m.id);
  if (!g) groups.set(m.id, g = { ...c, id: m.id, at: 0, hits: new Set(), score: 0, preferred: 0, moments: [] });
  hits.forEach((i) => g.hits.add(i));
  const score = hits.length, preferred = Number(m.kind === parsed.kind);
  g.preferred = Math.max(g.preferred, preferred);
  if (parsed.terms.length && !hits.length) return;
  g.score = Math.max(g.score, score); g.at = Math.max(g.at, m.at);
  // Resumes can repeat calls; one file touched in one hour remains one result moment.
  const key = m.kind === 'file' ? `${m.kind}|${hourKey(m.at)}|${m.text.toLowerCase().replace(/\\/g, '/')}` : `${m.kind}|${m.at}|${m.text}`;
  const old = g.moments.findIndex((x) => x.key === key);
  if (old >= 0) { if (g.moments[old].at >= m.at) return; g.moments.splice(old, 1); }
  g.moments.push({ ...m, score, preferred, key });
  g.moments.sort((a, b) => b.score - a.score || b.preferred - a.preferred || b.at - a.at);
  g.moments.length = Math.min(3, g.moments.length);
}
function ranked(groups, parsed) {
  return [...groups.values()].filter((g) => g.hits.size === parsed.terms.length).sort((a, b) => b.score - a.score || b.preferred - a.preferred || b.at - a.at).map(({ hits, score, preferred, ...g }) => ({ ...g, moments: g.moments.map(({ score, preferred, key, ...m }) => m) }));
}
function rankMoments(moments, conversations, parsed) {
  if (Array.isArray(conversations)) conversations = Object.fromEntries(conversations.map((c) => [c.id, c]));
  const groups = new Map();
  for (const m of moments) collectMoment(groups, m, parsed, conversations);
  return ranked(groups, parsed);
}

// Long strings such as file contents and tool output are discarded while bytes pass through. A line's
// small projection is all that is parsed, even when one tool result spans hundreds of megabytes.
class Projection {
  constructor() { this.reset(); }
  reset() { this.stack = []; this.root = null; this.token = ''; this.string = false; this.escape = false; this.scalar = ''; this.bad = false; this.count = 0; }
  place() {
    const p = this.stack[this.stack.length - 1];
    if (!p) return { route: '', keep: true };
    return { route: p.route + (p.array ? '.*' : '.' + p.key), keep: p.keep };
  }
  allowed(route) {
    return /^(|\.message|\.origin|\.message\.content|\.message\.content\.\*|\.message\.content\.\*\.input)$/.test(route)
      || /^\.(type|timestamp|cwd|aiTitle|customTitle|isMeta|isCompactSummary)$/.test(route)
      || /^\.origin\.kind$/.test(route) || /^\.message\.role$/.test(route)
      || /^\.message\.content\.\*\.(type|text|name)$/.test(route)
      || /^\.message\.content\.\*\.input\.(file_path|notebook_path|command|pattern)$/.test(route);
  }
  value(v) {
    const p = this.stack[this.stack.length - 1];
    if (!p) { this.root = v; return; }
    if (p.keep && this.allowed(this.place().route)) {
      if (++this.count > 12000) { this.bad = true; return; }
      if (p.array) p.value.push(v); else p.value[p.key] = v;
    }
    p.expect = p.array ? 'value' : 'comma';
  }
  feed(text) {
    for (const ch of text) {
      if (this.bad) break;
      if (ch === '\n') continue;
      if (this.string) {
        if (ch === '"' && !this.escape) {
          this.string = false;
          const p = this.stack[this.stack.length - 1];
          let value = '';
          try { value = JSON.parse('"' + this.token + '"'); } catch { this.bad = true; }
          if (p && p.expect === 'key') { p.key = value; p.expect = 'colon'; }
          else this.value(value);
          this.token = '';
        } else {
          // Stop only between escaped characters, so a clipped string stays valid JSON.
          if (this.capture) this.token += ch;
          if (this.unicode) this.unicode--;
          if (this.escape) { this.escape = false; if (ch === 'u') this.unicode = 4; }
          else if (ch === '\\') this.escape = true;
          if (this.token.length >= this.limit && !this.escape && !this.unicode) this.capture = false;
        }
        continue;
      }
      if (this.scalar && /[\s,}\]]/.test(ch)) {
        let v = null; try { v = JSON.parse(this.scalar); } catch { this.bad = true; }
        this.value(v); this.scalar = '';
      }
      if (ch === '"') {
        const p = this.stack[this.stack.length - 1], place = this.place();
        this.string = true; this.escape = false; this.token = '';
        this.limit = p?.expect === 'key' ? 100 : place.keep && this.allowed(place.route) ? (/path$|\.cwd$/.test(place.route) ? 24576 : 2400) : 0;
        this.capture = this.limit > 0; this.unicode = 0;
      } else if (ch === '{' || ch === '[') {
        const place = this.place(), value = ch === '[' ? [] : Object.create(null);
        this.value(value);
        this.stack.push({ value, route: place.route, keep: place.keep && this.allowed(place.route), array: ch === '[', key: '', expect: ch === '[' ? 'value' : 'key' });
        if (this.stack.length > 100) this.bad = true;
      } else if (ch === '}' || ch === ']') this.stack.pop();
      else if (ch === ',') { const p = this.stack[this.stack.length - 1]; if (p) p.expect = p.array ? 'value' : 'key'; }
      else if (ch !== ':' && !/\s/.test(ch) && this.scalar.length < 50) this.scalar += ch;
    }
  }
  finish() { return !this.bad && !this.string && !this.stack.length && this.root && typeof this.root === 'object' ? this.root : null; }
}

function *indexLines(file) {
  const fd = fs.openSync(file, 'r');
  try {
    const size = fs.fstatSync(fd).size;
    for (let pos = 0; pos < size;) {
      const rows = [];
      const done = eachLine(fd, pos, Math.min(size, pos + PAGE), (line) => { try { rows.push(JSON.parse(line.toString('utf8'))); } catch { /* interrupted last write */ } });
      if (done === pos) break;
      pos = done; yield rows;
    }
  } finally { fs.closeSync(fd); }
}
const atomic = (file, value) => { fs.writeFileSync(file + '.tmp', JSON.stringify(value)); fs.renameSync(file + '.tmp', file); };

class Finder {
  constructor({ home, store, now }, report = () => {}) {
    if (!home || !store) throw new Error('Finder folders are required');
    this.home = path.resolve(home); this.store = path.resolve(store); this.projects = path.join(this.home, '.claude', 'projects');
    const rel = path.relative(this.projects, this.store);
    if (!rel || (!rel.startsWith('..' + path.sep) && !path.isAbsolute(rel))) throw new Error('The index must be separate from transcripts');
    fs.mkdirSync(this.store, { recursive: true });
    this.report = report; this.now = now; this.files = {}; this.conversations = {}; this.days = {}; this.readBytes = 0; this.tx = 0; this.limited = false;
    this.queue = []; this.current = null; this.recent = new Set(); this.bloom = Buffer.alloc(2 * 1024 * 1024);
    this.scanning = false; this.reading = false; this.scanPending = false; this.searchSeq = 0; this.version = 0;
    this.closed = false; this.warmed = false; this.stopping = false;
    this.load();
    this.sources = new Map(Object.values(this.files).map((f) => [f.source, f.generation]));
  }
  load() {
    try {
      const saved = JSON.parse(fs.readFileSync(path.join(this.store, 'state.json'), 'utf8'));
      if (saved.v === 1 && saved.home === this.home && saved.files && saved.conversations && saved.days
        && typeof saved.files === 'object' && !Array.isArray(saved.files) && typeof saved.conversations === 'object'
        && !Array.isArray(saved.conversations) && typeof saved.days === 'object' && Number.isSafeInteger(saved.tx)
        && Object.values(saved.files).every((f) => f && SESSION.test(f.id) && Number.isSafeInteger(f.offset) && f.offset >= 0
          && typeof f.source === 'string' && Number.isSafeInteger(f.generation))
        && Object.entries(saved.conversations).every(([id, c]) => SESSION.test(id) && c && typeof c.cwd === 'string')) {
        this.files = saved.files; this.conversations = saved.conversations; this.days = saved.days; this.tx = saved.tx; this.limited = Boolean(saved.limited);
      }
    } catch { /* first run */ }
    try {
      const journal = JSON.parse(fs.readFileSync(path.join(this.store, 'pending.json'), 'utf8'));
      if (journal.tx !== this.tx) for (const [name, size] of Object.entries(journal.sizes)) {
        if (/^\d{4}-\d\d-\d\d\.(core|said)\.jsonl$/.test(name)) { const file = path.join(this.store, name); if (fs.existsSync(file)) fs.truncateSync(file, size); }
      }
      fs.unlinkSync(path.join(this.store, 'pending.json'));
    } catch { /* no interrupted round */ }
    this.days = {};
    for (const name of fs.readdirSync(this.store)) if (/^\d{4}-\d\d-\d\d\.(core|said)\.jsonl$/.test(name)) this.days[name] = fs.statSync(path.join(this.store, name)).size;
  }
  checkpoint() { return { v: 1, home: this.home, tx: this.tx, files: this.files, conversations: this.conversations, days: this.days, limited: this.limited }; }
  save() { atomic(path.join(this.store, 'state.json'), this.checkpoint()); }
  progress() {
    const files = Object.values(this.files), parents = new Map();
    let bytes = 0, bytesDone = 0, filesDone = 0;
    for (const f of files) {
      bytes += f.size; bytesDone += Math.min(f.offset, f.size);
      const done = f.offset >= f.size; if (done) filesDone++;
      parents.set(f.id, (parents.get(f.id) ?? true) && done);
    }
    return { files: files.length, filesDone, bytes, bytesDone, building: !this.warmed || this.scanning || filesDone < files.length, conversations: parents.size, conversationsDone: [...parents.values()].filter(Boolean).length, limited: this.limited, full: Boolean(this.full) };
  }
  /** Whether its drive has room to grow the index: looked at once a minute. */
  roomy() {
    const now = Date.now();
    if (now - (this.spaceAt || 0) < 60000) return !this.full;
    this.spaceAt = now;
    const was = Boolean(this.full);
    try { const s = fs.statfsSync(this.store); this.full = Number(s.bavail) * Number(s.bsize) < FREE_MIN; } catch { this.full = false; }
    if (was !== this.full) this.report(this.progress());
    return !this.full;
  }
  status() { return { home: this.home, progress: this.progress(), positions: Object.fromEntries(Object.entries(this.files).map(([f, s]) => [f, s.offset])), readBytes: this.readBytes, indexBytes: Object.values(this.days).reduce((a, b) => a + b, 0) + (fs.existsSync(path.join(this.store, 'state.json')) ? fs.statSync(path.join(this.store, 'state.json')).size : 0) }; }
  async scan() {
    if (this.scanning || this.closed) return;
    if (this.reading) { this.scanPending = true; return; }
    this.scanning = true;
    let complete = true;
    const listing = async (dir) => { try { return await fs.promises.readdir(dir, { withFileTypes: true }); } catch (err) { if (err.code !== 'ENOENT') complete = false; return []; } };
    const found = new Set();
    const take = async (file, id, project, sub) => {
      let st; try { st = await fs.promises.lstat(file); } catch (err) { if (err.code !== 'ENOENT') complete = false; return; }
      if (!st.isFile() || st.isSymbolicLink()) return;
      found.add(file);
      let f = this.files[file];
      if (!f || st.size < f.offset || (st.size === f.size && st.mtimeMs !== f.mtime) || (f.birth && f.birth !== st.birthtimeMs)) {
        if (f && !sub) this.conversations[id] = { id, title: '', prompt: '', cwd: '', first: 0, last: 0, project };
        const generation = f ? f.generation + 1 : Date.now();
        f = this.files[file] = { id, project, sub, offset: 0, size: 0, mtime: 0, birth: st.birthtimeMs,
          source: createHash('sha256').update(file).digest('hex').slice(0, 24), generation };
        this.recent.clear();
      }
      f.size = st.size; f.mtime = st.mtimeMs;
      if (!this.conversations[id]) this.conversations[id] = { id, title: '', prompt: '', cwd: '', first: 0, last: 0, project };
    };
    try {
      for (const dir of await listing(this.projects)) {
        if (!dir.isDirectory() || dir.isSymbolicLink()) continue;
        const folder = path.join(this.projects, dir.name);
        for (const ent of await listing(folder)) {
          if (ent.isFile() && ent.name.endsWith('.jsonl') && SESSION.test(ent.name.slice(0, -6))) await take(path.join(folder, ent.name), ent.name.slice(0, -6), dir.name, false);
          else if (ent.isDirectory() && !ent.isSymbolicLink() && SESSION.test(ent.name)) {
            const subdir = path.join(folder, ent.name, 'subagents');
            try { const st = await fs.promises.lstat(subdir); if (!st.isDirectory() || st.isSymbolicLink()) continue; } catch (err) { if (err.code !== 'ENOENT') complete = false; continue; }
            for (const sub of await listing(subdir)) if (sub.isFile() && /^agent-[a-z0-9-]+\.jsonl$/i.test(sub.name)) await take(path.join(subdir, sub.name), ent.name, dir.name, true);
          }
        }
      }
      if (complete) for (const file of Object.keys(this.files)) if (!found.has(file) && file !== this.current?.file) { delete this.files[file]; this.recent.clear(); }
      this.sources = new Map(Object.values(this.files).map((f) => [f.source, f.generation]));
      const ids = new Set(Object.values(this.files).map((f) => f.id));
      for (const id of Object.keys(this.conversations)) if (!ids.has(id)) delete this.conversations[id];
      this.queue = Object.keys(this.files).filter((file) => this.files[file].offset < this.files[file].size && this.files[file] !== this.current?.f).sort((a, b) => this.files[b].mtime - this.files[a].mtime);
      this.version++;
    } finally { this.scanning = false; this.report(this.progress()); }
  }
  fingerprint(m) { return createHash('sha256').update(this.fileKey(m)).digest(); }
  valid(m) { return this.sources.has(m.source) && this.sources.get(m.source) === m.generation; }
  async pause() { const at = Date.now(); await rest(); this.waited += Date.now() - at; }
  marked(hash, write = false) {
    let had = true;
    for (let i = 0; i < 4; i++) {
      const bit = hash.readUInt32LE(i * 4) % (this.bloom.length * 8), byte = bit >>> 3, mask = 1 << (bit & 7);
      if (!(this.bloom[byte] & mask)) had = false;
      if (write) this.bloom[byte] |= mask;
    }
    return had;
  }
  async warm() {
    if (this.warmed) return;
    let began = Date.now();
    for (const name of Object.keys(this.days)) {
      if (!name.includes('.core.')) continue;
      for (const rows of indexLines(path.join(this.store, name))) {
        for (const m of rows) if (m.kind === 'file' && this.valid(m)) this.marked(this.fingerprint(m), true);
        if (this.closed || this.stopping) return;
        if (Date.now() - began >= 60) { await this.pause(); began = Date.now(); }
      }
    }
    this.warmed = true;
    this.report(this.progress());
  }
  async duplicate(m) {
    const hash = this.fingerprint(m), key = hash.toString('hex');
    if (this.recent.has(key)) return true;
    let found = false;
    // A bloom hit is only a hint: disk supplies the exact answer, in bounded pages.
    if (this.marked(hash)) {
      const file = path.join(this.store, dayKey(m.at) + '.core.jsonl');
      if (fs.existsSync(file)) {
        let began = Date.now();
        for (const rows of indexLines(file)) {
          if (rows.some((r) => r.kind === 'file' && this.valid(r) && this.fileKey(r) === this.fileKey(m))) { found = true; break; }
          if (this.closed) return true;
          if (Date.now() - began >= 60) { await this.pause(); began = Date.now(); }
        }
      }
    }
    this.marked(hash, true); this.recent.add(key);
    if (this.recent.size > 8192) this.recent.delete(this.recent.values().next().value);
    return found;
  }
  // Each source keeps its evidence: removing one transcript must not erase a touch also recorded by another.
  fileKey(m) { return `${m.source}|${m.generation}|${m.id}|${hourKey(m.at)}|${m.text.toLowerCase().replace(/\\/g, '/')}`; }
  async take(o, f, batches) {
    const c = this.conversations[f.id];
    if (!c) return;
    if (!f.sub) {
      if (o.cwd) c.cwd = short(o.cwd, 4096);
      if (o.type === 'ai-title') c.title = short(o.aiTitle, 120);
      if (o.type === 'custom-title') c.title = short(o.customTitle, 120);
    }
    const at = Date.parse(o.timestamp);
    if (Number.isFinite(at)) { c.first = c.first ? Math.min(c.first, at) : at; c.last = Math.max(c.last, at); }
    for (const m of momentsOf(o, f.id)) {
      m.source = f.source; m.generation = f.generation;
      if (!f.sub && m.kind === 'asked' && (!c.prompt || m.at < c.promptAt)) { c.prompt = m.text; c.promptAt = m.at; }
      const day = dayKey(m.at);
      if (m.kind === 'file' && await this.duplicate(m)) continue;
      const name = day + (m.kind === 'said' ? '.said.jsonl' : '.core.jsonl');
      (batches[name] || (batches[name] = [])).push(JSON.stringify(m) + '\n');
    }
  }
  trim(entries) {
    const ceiling = Math.max(0, Math.min(CAP, 300000000 - 2 * Buffer.byteLength(JSON.stringify(this.checkpoint())) - 65536));
    const added = new Map(entries.map(([name, text]) => [name, Buffer.byteLength(text)]));
    let size = Object.values(this.days).reduce((a, b) => a + b, 0) + [...added.values()].reduce((a, b) => a + b, 0);
    const dropped = new Set();
    for (const name of [...new Set([...Object.keys(this.days), ...added.keys()])].sort((a, b) => Number(!a.includes('.said.')) - Number(!b.includes('.said.')) || a.localeCompare(b))) {
      if (size <= ceiling) break;
      if (Object.hasOwn(this.days, name)) fs.unlinkSync(path.join(this.store, name));
      size -= (this.days[name] || 0) + (added.get(name) || 0);
      delete this.days[name]; dropped.add(name); this.recent.clear(); this.limited = true;
    }
    return entries.filter(([name]) => !dropped.has(name));
  }
  async round() {
    if (this.scanning || this.reading || this.closed) return !this.closed;
    const began = Date.now();
    this.waited = 0;
    this.reading = true;
    try { return await this.readRound(); }
    finally {
      this.reading = false;
      if (this.scanPending && !this.closed) { this.scanPending = false; await this.scan(); }
      this.workMs = Math.max(0, Date.now() - began - this.waited);
    }
  }
  async readRound() {
    await this.warm();
    if (this.stopping) return false;
    if (!this.current && !this.queue.length) return false;
    if (!this.roomy()) return false;
    const started = Date.now(), batches = {};
    while (Date.now() - started < 60) {
      if (!this.current) {
        const file = this.queue.shift(); if (!file) break;
        const f = this.files[file]; if (!f) continue;
        try { this.current = { file, f, fd: fs.openSync(file, 'r'), pos: f.offset, projection: new Projection(), decoder: new StringDecoder('utf8') }; } catch { continue; }
      }
      const r = this.current, f = this.files[r.file];
      if (!f || r.f !== f || r.pos >= f.size) { fs.closeSync(r.fd); this.current = null; continue; }
      if (r.pos === f.offset) {
        const rows = [], to = Math.min(f.size, r.pos + PAGE);
        const done = eachLine(r.fd, r.pos, to, (line) => {
          const projection = new Projection(); projection.feed(line.toString('utf8'));
          const o = projection.finish(); if (o) rows.push(o);
        });
        this.readBytes += to - r.pos;
        if (done > r.pos) {
          for (const o of rows) await this.take(o, f, batches);
          r.pos = f.offset = done;
          continue;
        }
        // eachLine leaves a line longer than a page untouched. Project it a page at a time instead
        // of increasing its carry buffer to the size of a tool result or file body.
      }
      const buf = Buffer.allocUnsafe(Math.min(PAGE, f.size - r.pos));
      const n = fs.readSync(r.fd, buf, 0, buf.length, r.pos); this.readBytes += n;
      if (!n) { fs.closeSync(r.fd); this.current = null; break; }
      let start = 0, nl;
      while ((nl = buf.subarray(0, n).indexOf(10, start)) >= 0) {
        r.projection.feed(r.decoder.write(buf.subarray(start, nl)) + r.decoder.end());
        const o = r.projection.finish(); if (o) await this.take(o, f, batches);
        f.offset = r.pos + nl + 1; r.projection.reset(); r.decoder = new StringDecoder('utf8'); start = nl + 1;
      }
      if (start < n) r.projection.feed(r.decoder.write(buf.subarray(start, n)));
      r.pos += n;
      if (r.pos >= f.size) { fs.closeSync(r.fd); this.current = null; }
    }
    const entries = this.trim(Object.entries(batches).map(([name, rows]) => [name, rows.join('')]));
    const sizes = Object.fromEntries(entries.map(([name]) => [name, this.days[name] || 0]));
    atomic(path.join(this.store, 'pending.json'), { tx: this.tx + 1, sizes });
    for (const [name, text] of entries) { fs.appendFileSync(path.join(this.store, name), text); this.days[name] = (this.days[name] || 0) + Buffer.byteLength(text); }
    this.tx++; this.save(); fs.unlinkSync(path.join(this.store, 'pending.json'));
    this.report(this.progress());
    return Boolean(this.current || this.queue.length);
  }
  async search(q, now = this.now || Date.now()) {
    const parsed = parseQuestion(q, Object.values(this.conversations).map((c) => c.cwd), now);
    const key = JSON.stringify([parsed, this.version]);
    let job = this.searchJob;
    if (!job || job.key !== key || (!job.pending && job.tx !== this.tx)) {
      job = { key, tx: this.tx, pending: true };
      job.promise = this.searchDays(parsed, ++this.searchSeq, this.version).finally(() => { job.pending = false; });
      this.searchJob = job;
    }
    let timer;
    try {
      return await Promise.race([job.promise, new Promise((resolve) => {
        timer = setTimeout(() => resolve({ ready: false, results: [], terms: parsed.terms, understood: parsed.understood, progress: this.progress() }), 2600);
      })]);
    } finally { clearTimeout(timer); }
  }
  async searchDays(parsed, seq, version) {
    const groups = new Map();
    const low = Number.isFinite(parsed.from) ? dayKey(parsed.from) : '', high = Number.isFinite(parsed.to) ? dayKey(parsed.to - 1) : '9999';
    for (const name of Object.keys(this.days).sort().reverse()) {
      if (name.slice(0, 10) < low || name.slice(0, 10) > high) continue;
      const file = path.join(this.store, name); if (!fs.existsSync(file)) continue;
      for (const rows of indexLines(file)) {
        for (const m of rows) if (this.valid(m)) collectMoment(groups, m, parsed, this.conversations);
        if (seq !== this.searchSeq || version !== this.version || this.closed || this.stopping) return { ready: false, results: [], terms: parsed.terms, understood: parsed.understood, progress: this.progress() };
        await nextTurn();
      }
    }
    if (seq !== this.searchSeq || version !== this.version || this.closed || this.stopping) return { ready: false, results: [], terms: parsed.terms, understood: parsed.understood, progress: this.progress() };
    return { ready: true, results: ranked(groups, parsed), terms: parsed.terms, understood: parsed.understood, progress: this.progress() };
  }
  close() { this.closed = true; this.searchSeq++; if (this.current) fs.closeSync(this.current.fd); this.current = null; }
}

module.exports = { Finder, Projection, parseQuestion, momentsOf, rankMoments, hideSecrets };
if (!isMainThread) {
  const finder = new Finder(workerData, (progress) => parentPort.postMessage({ type: 'progress', progress }));
  let timer, active, stopped = false;
  const work = async () => {
    if (stopped) return;
    active = finder.round();
    const more = await active;
    active = null;
    if (!stopped) timer = setTimeout(work, more ? Math.max(300, (finder.workMs || 0) * 5) : 1000);
  };
  const scan = setInterval(() => finder.scan().catch(() => {}), 30000);
  parentPort.on('message', async (m) => {
    if (m.type === 'stop') {
      stopped = true; clearTimeout(timer); clearInterval(scan);
      finder.stopping = true;
      if (active) await active;
      finder.close(); parentPort.postMessage({ id: m.id, result: true }); parentPort.close(); return;
    }
    try {
      let result;
      if (m.type === 'search') result = await finder.search(m.q, m.now);
      else if (m.type === 'status') result = finder.status();
      else if (m.type === 'scan') { await finder.scan(); result = finder.status(); }
      if (m.id) parentPort.postMessage({ id: m.id, result });
    } catch { if (m.id) parentPort.postMessage({ id: m.id, result: { ready: false, results: [], understood: [], progress: finder.progress() } }); }
  });
  finder.scan().then(work);
}
