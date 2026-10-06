'use strict';
// Reads the person's working record on request. Only the named files and project pages are opened;
// no source file is written, and values outside project tables are never retained from the TOML file.
const fs = require('node:fs/promises');
const path = require('node:path');

const DAY = 86400e3;
const MB = 1024 * 1024;
const KINDS = new Set(['step', 'decision', 'fact', 'task', 'note', 'fail']);
const SLUG = /^[a-z0-9-]+$/i;
const OPEN = new Set(['open', 'doing', 'blocked']);
const STATUS = new Set([...OPEN, 'done']);
const rest = () => new Promise((resolve) => setImmediate(resolve));
const string = (s, n = 1200) => typeof s === 'string' ? s.slice(0, n) : '';
const textOf = (r) => Buffer.isBuffer(r.text) ? r.text.toString('utf8') : String(r.text || '');
const clipped = (s, n) => { const t = String(s || '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1) + '\u2026' : t; };
const date = (s) => {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return '';
  const ms = Date.parse(s + 'T00:00:00Z');
  return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === s ? s : '';
};
const day = (now, days = 0) => {
  const d = new Date(now); d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const at = (r) => r._at || Date.parse(r.ts) || 0;
const order = (a, b) => at(a) - at(b) || (a._offset || 0) - (b._offset || 0);
const normalized = (folder) => path.win32.normalize(String(folder || '').replace(/\//g, '\\')).replace(/\\+$/, '').toLowerCase();

function tomlValue(value) {
  let quote = '', escaped = false, end = value.length;
  for (let i = 0; i < value.length; i++) {
    const c = value[i];
    if (escaped) { escaped = false; continue; }
    if (quote === '"' && c === '\\') { escaped = true; continue; }
    if (quote) { if (c === quote) quote = ''; }
    else if (c === '"' || c === "'") quote = c;
    else if (c === '#') { end = i; break; }
  }
  const source = value.slice(0, end).trim();
  const one = (s) => {
    if (s.startsWith('"') && s.endsWith('"')) { try { const v = JSON.parse(s); return typeof v === 'string' ? v : null; } catch { return null; } }
    if (s.startsWith("'") && s.endsWith("'") && !s.slice(1, -1).includes("'")) return s.slice(1, -1);
    return null;
  };
  if (source === 'true' || source === 'false') return source === 'true';
  if (!source.startsWith('[') || !source.endsWith(']')) return one(source);
  const out = []; let start = 1; quote = ''; escaped = false;
  for (let i = 1; i < source.length; i++) {
    const c = source[i];
    if (escaped) { escaped = false; continue; }
    if (quote === '"' && c === '\\') { escaped = true; continue; }
    if (quote) { if (c === quote) quote = ''; continue; }
    if (c === '"' || c === "'") { quote = c; continue; }
    if (c !== ',' && i !== source.length - 1) continue;
    const part = source.slice(start, i).trim();
    if (part) { const v = one(part); if (v === null) return null; out.push(v); }
    else if (c === ',' && !out.length) return null;
    start = i + 1;
  }
  return quote ? null : out;
}

function projectParser() {
  const projects = new Map(); let current = null;
  return {
    line(raw) {
      // Outside a project table only a table header is decoded; even a large secret stays disposable bytes.
      if (Buffer.isBuffer(raw) && !current) {
        let i = 0; while (i < raw.length && (raw[i] === 32 || raw[i] === 9 || raw[i] === 13)) i++;
        if (raw[i] !== 91) return;
      }
      const line = String(raw).trim();
      if (line.startsWith('[')) {
        const m = /^\[projects\.([a-z0-9-]+)\]\s*(?:#.*)?$/i.exec(line);
        current = m ? { slug: m[1] } : null;
        if (current) projects.set(current.slug, current);
        return;
      }
      if (!current) return;
      const m = /^(title|folders|client|compass|aliases|match|quiet)\s*=\s*(.*)$/.exec(line);
      if (!m) return;
      const value = tomlValue(m[2]);
      if (['folders', 'aliases', 'match'].includes(m[1]) && Array.isArray(value)) current[m[1]] = value.map((v) => string(v, 400));
      else if (m[1] === 'quiet' && typeof value === 'boolean') current.quiet = value;
      else if (['title', 'client', 'compass'].includes(m[1]) && typeof value === 'string') current[m[1]] = string(value, 300);
    },
    value() {
      return [...projects.values()].map((p) => ({
        slug: p.slug, title: p.title || p.slug, client: SLUG.test(p.client || '') ? p.client : p.slug,
        compass: SLUG.test(p.compass || '') ? p.compass : SLUG.test(p.client || '') ? p.client : p.slug,
        // written with / in the file, a folder is the same one the chats name with \ on Windows
        folders: (p.folders || []).filter((f) => path.win32.isAbsolute(f) || path.posix.isAbsolute(f))
          .map((f) => (process.platform === 'win32' ? path.win32.normalize(f) : f)),
        aliases: p.aliases || [], match: p.match || [], quiet: Boolean(p.quiet),
      }));
    },
  };
}

function parseProjects(source) {
  const parser = projectParser();
  for (const line of String(source || '').split(/\r?\n/)) parser.line(line);
  return parser.value();
}

function openTasks(records) {
  const tasks = new Map(); const statuses = new Map();
  for (const r of [...records].sort(order)) {
    if (r.type === 'task' && r.id) tasks.set(r.id, r);
    if (STATUS.has(r.status)) {
      if (r.id) statuses.set(r.id, r.status);
      if (r.re) statuses.set(r.re, r.status);
    }
  }
  return [...tasks.values()].map((r) => ({ ...r, status: statuses.get(r.id) || '' })).filter((r) => OPEN.has(r.status));
}

function replacedRecords(records) {
  const seen = new Set(); const replaced = new Set();
  for (const r of [...records].sort(order)) {
    for (const id of Array.isArray(r.supersedes) ? r.supersedes : []) if (seen.has(id)) replaced.add(id);
    if (r.id) seen.add(r.id);
  }
  return replaced;
}

function decisionsDue(records, now = Date.now()) {
  const decisions = new Map();
  for (const r of [...records].sort(order)) {
    if (r.re) decisions.delete(r.re);
    if (r.type === 'decision' && r.id && date(r.review_on) && r.review_on <= day(now)) decisions.set(r.id, r);
  }
  return [...decisions.values()].sort((a, b) => a.review_on.localeCompare(b.review_on) || order(a, b));
}

function datesInRange(records, through = '', now = Date.now()) {
  const dates = new Map();
  for (const r of [...records].sort(order)) {
    if (r.re && r.status === 'done') dates.delete(r.re);
    if (r.id && !r.re && date(r.due)) {
      if (r.status === 'done') dates.delete(r.id); else dates.set(r.id, r);
    }
    for (const id of Array.isArray(r.supersedes) ? r.supersedes : []) dates.delete(id);
  }
  return [...dates.values()].filter((r) => !through || r.due <= through).map((r) => ({ ...r, late: r.due < day(now) }))
    .sort((a, b) => a.due.localeCompare(b.due) || order(a, b));
}

function statusSections(source) {
  const sections = []; let section = null;
  for (const line of String(source || '').split(/\r?\n/)) {
    if (/^#\s/.test(line)) continue;
    const heading = /^##\s+(.+)$/.exec(line);
    if (heading) { section = { heading: heading[1].trim(), lines: [] }; sections.push(section); }
    else {
      if (!section && !line.trim()) continue;
      if (!section) { section = { heading: '', lines: [] }; sections.push(section); }
      section.lines.push(line);
    }
  }
  for (const section of sections) while (section.lines.length && !section.lines[section.lines.length - 1].trim()) section.lines.pop();
  return sections;
}

function projectOf(folder, projects) {
  const target = normalized(folder); let best = null; let length = -1;
  if (!target || target === '.') return null;
  for (const project of projects) for (const root of project.folders || []) {
    const base = normalized(root);
    if (base && base !== '.' && (target === base || target.startsWith(base + '\\')) && base.length > length) { best = project; length = base.length; }
  }
  return best;
}

function logRow(value, offset) {
  if (!value || typeof value !== 'object' || !KINDS.has(value.type)) return null;
  const r = { id: string(value.id, 200), ts: string(value.ts, 40), type: value.type, client: string(value.client, 100),
    text: Buffer.from(typeof value.text === 'string' ? value.text : '', 'utf8'), _offset: offset, _at: Date.parse(value.ts) || 0,
    tags: Array.isArray(value.tags) ? value.tags.slice(0, 40).filter((v) => typeof v === 'string').map((v) => string(v, 100)) : [],
    status: STATUS.has(value.status) ? value.status : '', re: string(value.re, 200), due: date(value.due), review_on: date(value.review_on),
    supersedes: Array.isArray(value.supersedes) ? value.supersedes.filter((v) => typeof v === 'string').map((v) => string(v, 200)) : [],
  };
  return r.id && at(r) ? r : null;
}

function dateRow(r) {
  if (!r || typeof r !== 'object' || !r.id) return null;
  return { id: string(r.id, 200), ts: string(r.ts, 40), due: date(r.due), label: string(r.label, 600), recur: r.recur === 'yearly' ? 'yearly' : 'none',
    kind: string(r.kind, 40), note: string(r.note, 1200), client: string(r.client, 100), status: string(r.status, 40), re: string(r.re, 200),
    supersedes: Array.isArray(r.supersedes) ? r.supersedes.filter((v) => typeof v === 'string').map((v) => string(v, 200)) : [] };
}

function boardValue(r) {
  const item = (v) => typeof v === 'string' ? { text: string(v, 1200) } : ({ text: string(v && v.text, 1200), note: string(v && v.note, 1200),
    urgent: Boolean(v && v.urgent), owner: string(v && v.owner, 200), what: string(v && v.what, 1200), status: string(v && v.status, 100) });
  const items = (v) => Array.isArray(v) ? v.map(item) : [];
  return { rock: items(r.rock), human: items(r.human), delegated: items(r.delegated), drip: items(r.drip), parked: items(r.parked),
    custom: Array.isArray(r.custom) ? r.custom.map((s) => ({ title: string(s && s.title, 200), items: items(s && s.items) })) : [],
    countdowns: r.meta && Array.isArray(r.meta.countdowns) ? r.meta.countdowns.map((c) => ({ label: string(c && c.label, 200), date: date(c && c.date) })).filter((c) => c.date) : [] };
}

// Bounded chunks leave the watcher's regular look room to run. An oversized line is discarded as one line.
async function lines(file, size, limit, tail, receive, maxLine = MB) {
  const handle = await fs.open(file, 'r');
  const block = Buffer.allocUnsafe(64 * 1024);
  const start = tail ? Math.max(0, size - limit) : 0;
  let pos = start, from = start, carry = Buffer.alloc(0), discard = start > 0;
  try {
    if (start > 0) { const previous = Buffer.allocUnsafe(1); await handle.read(previous, 0, 1, start - 1); discard = previous[0] !== 10; }
    while (pos < Math.min(size, start + limit)) {
      const { bytesRead } = await handle.read(block, 0, Math.min(block.length, size - pos, start + limit - pos), pos);
      if (!bytesRead) break;
      pos += bytesRead;
      const data = carry.length ? Buffer.concat([carry, block.subarray(0, bytesRead)]) : block.subarray(0, bytesRead);
      let begin = 0, end;
      while ((end = data.indexOf(10, begin)) !== -1) {
        if (!discard && end - begin <= maxLine) receive(data.subarray(begin, end), from + begin);
        discard = false; begin = end + 1;
      }
      from += begin;
      if (data.length - begin > maxLine) { discard = true; from += data.length - begin; carry = Buffer.alloc(0); }
      else carry = Buffer.from(data.subarray(begin));
      await rest();
    }
    if (carry.length && !discard) receive(carry, from);
  } finally { await handle.close(); }
}

async function sorted(records) {
  let runs = [];
  for (let i = 0; i < records.length; i += 1024) { runs.push(records.slice(i, i + 1024).sort(order)); await rest(); }
  while (runs.length > 1) {
    const next = [];
    for (let n = 0; n < runs.length; n += 2) {
      if (!runs[n + 1]) { next.push(runs[n]); continue; }
      const a = runs[n], b = runs[n + 1], out = []; let i = 0, j = 0;
      while (i < a.length || j < b.length) {
        if (j >= b.length || (i < a.length && order(a[i], b[j]) <= 0)) out.push(a[i++]); else out.push(b[j++]);
        if (out.length % 2048 === 0) await rest();
      }
      next.push(out);
    }
    runs = next;
  }
  return runs[0] || [];
}

class Record {
  constructor(folder) {
    // A missing folder means unset. There is deliberately no home-folder fallback in the reader.
    this.folder = typeof folder === 'string' && folder ? path.resolve(folder) : '';
    this.files = new Map(); this.pending = null; this.derived = null; this.log = null;
  }

  async stat(name) {
    if (!this.folder) return null;
    try {
      // the chosen folder itself may be a link or junction to another drive; what is read inside it may not be
      const root = await fs.realpath(this.folder);
      if (!(await fs.stat(root)).isDirectory()) return null;
      if (name.includes('/')) { const dir = await fs.lstat(path.join(root, path.dirname(name))); if (!dir.isDirectory() || dir.isSymbolicLink()) return null; }
      const stat = await fs.lstat(path.join(root, name));
      return stat.isFile() && !stat.isSymbolicLink() ? stat : null;
    } catch { return null; }
  }

  async load(name, limit, kind) {
    const st = await this.stat(name);
    if (!st || (kind !== 'log' && st.size > limit)) { this.files.delete(name); return null; }
    const stamp = `${st.size}:${st.mtimeMs}`;
    let old = this.files.get(name);
    if (old && old.stamp === stamp) return old.value;
    // A changed log can be 64 MB. Its previous index must be collectible while the replacement is read.
    if (kind === 'log') { this.files.delete(name); this.log = null; this.derived = null; old = null; }
    const file = path.join(this.folder, name);
    let value;
    try {
      if (kind === 'log' || kind === 'dates') {
        const records = [];
        await lines(file, st.size, limit, kind === 'log', (line, offset) => {
          try { const row = kind === 'log' ? logRow(JSON.parse(line.toString('utf8')), offset) : dateRow(JSON.parse(line.toString('utf8'))); if (row) records.push(row); }
          catch { /* an incomplete or damaged line has no record */ }
        });
        value = await sorted(records);
      } else if (kind === 'projects') {
        const parser = projectParser();
        await lines(file, st.size, limit, false, (line) => parser.line(line), limit);
        value = parser.value();
      } else {
        const chunks = [];
        await lines(file, st.size, limit, false, (line) => chunks.push(line.toString('utf8')), limit);
        const source = chunks.join('\n');
        value = kind === 'board' ? boardValue(JSON.parse(source)) : statusSections(source);
      }
    } catch { return old ? old.value : null; }
    this.files.set(name, { stamp, value });
    return value;
  }

  async rules(records) {
    if (this.log === records && this.derived) return this.derived;
    const tasks = new Map(), statuses = new Map(), decisions = new Map(), seen = new Set(), replaced = new Set(), latest = new Map();
    for (let i = 0; i < records.length; i++) {
      const r = records[i];
      if (r.type === 'task') tasks.set(r.id, r);
      if (r.status) { statuses.set(r.id, r.status); if (r.re) statuses.set(r.re, r.status); }
      if (r.re) decisions.delete(r.re);
      if (r.type === 'decision' && r.review_on) decisions.set(r.id, r);
      for (const id of r.supersedes) if (seen.has(id)) replaced.add(id);
      seen.add(r.id); latest.set(r.client, r.ts);
      if (i % 512 === 511) await rest();
    }
    const open = [], counts = new Map();
    let n = 0;
    for (const r of tasks.values()) {
      const status = statuses.get(r.id) || '';
      if (OPEN.has(status)) { open.push({ ...r, status }); counts.set(r.client, (counts.get(r.client) || 0) + 1); }
      if (++n % 512 === 0) await rest();
    }
    open.sort((a, b) => (a.due || '9999').localeCompare(b.due || '9999') || order(b, a));
    this.log = records; this.derived = { open, counts, decisions: [...decisions.values()], replaced, latest };
    return this.derived;
  }

  request(request = {}) {
    // Concurrent page, sidebar and palette questions share a read without competing file copies.
    const run = (this.pending || Promise.resolve()).then(() => this.answer(request));
    this.pending = run.catch(() => null);
    return run;
  }

  async answer(request) {
    const part = request.part || 'summary', now = Date.now(), through = day(now, 7);
    if (!this.folder || !(await this.stat('log.jsonl'))) return { set: false };
    if (part === 'summary') {
      const board = await this.load('board.json', 4 * MB, 'board') || boardValue({});
      const dates = datesInRange(await this.load('streams/dates.jsonl', 4 * MB, 'dates') || [], through, now);
      return { set: true, urgent: board.human.filter((r) => r.urgent).length, mine: board.human.length, dates: dates.length };
    }
    const projects = await this.load('opshub.toml', 4 * MB, 'projects') || [];
    if (part === 'projectOf') return { set: true, projects: (request.folders || []).map((folder) => {
      const p = projectOf(folder, projects); return { folder, slug: p ? p.slug : '', title: p ? p.title : '' };
    }) };
    const records = await this.load('log.jsonl', 64 * MB, 'log') || [];
    const rules = await this.rules(records);
    const clientProject = new Map();
    for (const p of projects) if (!clientProject.has(p.client) || clientProject.get(p.client).quiet) clientProject.set(p.client, p);
    const record = (r, words = []) => {
      const p = clientProject.get(r.client); let text = textOf(r);
      if (Array.isArray(words) && words.length) {
        const lower = text.toLowerCase(), first = Math.min(...words.map((w) => lower.indexOf(w)).filter((n) => n >= 0));
        const from = Number.isFinite(first) ? Math.max(0, first - 100) : 0;
        if (from) text = '\u2026' + text.slice(from);
      }
      return { id: r.id, ts: r.ts, type: r.type, client: r.client,
        text: clipped(text, 1200), tags: r.tags, replaced: rules.replaced.has(r.id), project: p ? p.slug : '', projectTitle: p ? p.title : r.client };
    };
    const task = (r) => { const p = clientProject.get(r.client); return { id: r.id, text: clipped(textOf(r), 600), client: r.client, status: r.status, due: r.due, ts: r.ts,
      project: p ? p.slug : '', projectTitle: p ? p.title : r.client, folders: p ? p.folders : [] }; };
    if (part === 'feed' || part === 'search') {
      const words = string(request.query, 200).toLowerCase().trim().split(/\s+/).filter(Boolean), out = [];
      const kinds = Array.isArray(request.kinds) ? new Set(request.kinds) : null;
      const limit = part === 'search' ? 5 : 100;
      let begin = records.length - 1, before = 0, more = false;
      if (part === 'search' && !words.length) return { set: true, records: [] };
      if (Number.isFinite(request.before) && request.before > 0) {
        const found = records.findIndex((r) => r._offset + 1 === request.before);
        if (found >= 0) begin = found - 1;
        else while (begin >= 0 && records[begin]._offset + 1 >= request.before) begin--;
      }
      for (let i = begin; i >= 0; i--) {
        const r = records[i];
        const matches = (!kinds || kinds.has(r.type)) && (!request.client || r.client === request.client);
        const lower = matches && words.length ? textOf(r).toLowerCase() : '';
        if (matches && (!words.length || words.every((w) => lower.includes(w)))) {
          if (out.length === limit) { more = true; break; }
          out.push(record(r, words)); before = r._offset + 1;
        }
        if ((begin - i) % 512 === 511) await rest();
      }
      return part === 'search' ? { set: true, records: out } : { set: true, records: out, before, more };
    }
    if (part === 'today') {
      const board = await this.load('board.json', 4 * MB, 'board') || boardValue({});
      const review = rules.decisions.filter((r) => r.review_on <= day(now)).sort((a, b) => a.review_on.localeCompare(b.review_on) || order(a, b));
      return { set: true, human: [...board.human].sort((a, b) => Number(b.urgent) - Number(a.urgent)),
        dates: datesInRange(await this.load('streams/dates.jsonl', 4 * MB, 'dates') || [], through, now), countdowns: board.countdowns,
        tasks: rules.open.filter((r) => r.due && r.due <= through).map(task),
        decisions: records.filter((r) => r.type === 'decision' && at(r) >= now - DAY && at(r) <= now).reverse().map(record),
        failures: records.filter((r) => r.type === 'fail' && at(r) >= now - DAY && at(r) <= now).reverse().map(record),
        review: { count: review.length, items: review.slice(0, 5).map((r) => ({ ...record(r), review_on: r.review_on })) } };
    }
    if (part === 'todos') {
      const board = await this.load('board.json', 4 * MB, 'board') || boardValue({});
      const sections = [['rock', 'In your hands now'], ['human', 'Only you can do'], ['delegated', 'Handed to others'], ['drip', 'A little at a time'], ['parked', 'Parked']]
        .map(([id, title]) => ({ id, title, items: board[id] }));
      sections.push(...board.custom.map((s, i) => ({ id: `custom-${i}`, title: s.title, items: s.items })));
      return { set: true, tasks: rules.open.map(task), board: sections, projects };
    }
    const row = async (p) => {
      const sections = await this.load(`state/${p.compass}.md`, 512 * 1024, 'page') || [];
      const bullet = (prefix) => { const section = sections.find((s) => s.heading.toLowerCase().startsWith(prefix)); const first = section && section.lines.find((s) => /^\s*-\s+/.test(s)); return clipped(first ? first.replace(/^\s*-\s+/, '') : '', 200); };
      return { slug: p.slug, title: p.title, client: p.client, folders: p.folders, where: bullet('where we are'), heading: bullet("where we're heading"), tasks: rules.counts.get(p.client) || 0,
        last: rules.latest.get(p.client) || '', quiet: p.quiet };
    };
    if (part === 'projects') {
      const rows = [];
      for (const p of projects) rows.push(await row(p));
      rows.sort((a, b) => Number(a.quiet) - Number(b.quiet) || (Date.parse(b.last) || 0) - (Date.parse(a.last) || 0));
      return { set: true, projects: rows };
    }
    if (part === 'project') {
      const p = projects.find((p) => p.slug === request.slug);
      if (!p) return { set: true, project: null, sections: [], tasks: [], records: [], dates: [], ...(request.task !== undefined ? { taskText: null } : {}) };
      const selected = request.task !== undefined && rules.open.find((r) => r.id === request.task && r.client === p.client);
      return { set: true, project: await row(p), sections: await this.load(`state/${p.compass}.md`, 512 * 1024, 'page') || [],
        tasks: rules.open.filter((r) => r.client === p.client).map(task), records: records.filter((r) => r.client === p.client).slice(-200).reverse().map(record),
        dates: datesInRange(await this.load('streams/dates.jsonl', 4 * MB, 'dates') || [], '', now).filter((r) => r.client === p.client),
        ...(request.task !== undefined ? { taskText: selected ? textOf(selected) : null } : {}) };
    }
    return { set: true };
  }
}

module.exports = { Record, create: (folder) => new Record(folder), parseProjects, openTasks, replacedRecords, decisionsDue, datesInRange, statusSections, projectOf };
