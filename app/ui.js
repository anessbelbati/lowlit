'use strict';
/* global icon, glyph */
// Small helpers shared by the page's scripts. Text only ever reaches the page
// through textContent: nothing read from a transcript is parsed as markup.

/** Builds an element. props: class, text, title, tip (shown on hover; an empty one is left out), data (object), on<event> handlers, any other attribute. */
function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props || {})) {
    if (value == null || value === false) continue;
    if (key === 'class') el.className = value;
    else if (key === 'text') el.textContent = value;
    else if (key === 'tip') { if (value) el.dataset.tip = value; }
    else if (key === 'data') Object.assign(el.dataset, value);
    else if (key.startsWith('on')) el.addEventListener(key.slice(2), value);
    else el.setAttribute(key, value === true ? '' : value);
  }
  for (const kid of kids.flat(Infinity)) if (kid != null && kid !== false) el.append(kid);
  return el;
}

/** Replaces what an element holds. A child that is not there (null, false) is left out instead of being written as a word. */
function fill(el, ...kids) {
  el.replaceChildren(...kids.flat(Infinity).filter((kid) => kid != null && kid !== false));
}

const SVG = 'http://www.w3.org/2000/svg';
function svgEl(tag, attrs) {
  const el = document.createElementNS(SVG, tag);
  for (const [key, value] of Object.entries(attrs || {})) el.setAttribute(key, value);
  return el;
}

/** "12s", "3m", "2h", "4d": how long since a moment. */
function ago(at, now = Date.now()) {
  if (!at) return '';
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 5) return 'now';
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 48 * 3600) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

/** "8s", "2m 05s", "1h 12m": how long something took. */
function took(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`;
  return `${Math.floor(s / 3600)}h ${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}m`;
}

/** How long is left until something: "42m 05s", "4h 05m", and "6d 19h" once it is days away. */
function left(ms) {
  if (ms < 48 * 3600e3) return took(ms);
  const hrs = Math.floor(ms / 3600e3);
  return `${Math.floor(hrs / 24)}d ${hrs % 24}h`;
}

/** The same in a tight place: "42s", "17m", "1h 05m", "6d 19h". */
function leftShort(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  return left(ms);
}

/** "0m", "38m", "41h 12m", "1,204h": time added up over many sessions. */
function hours(ms) {
  const m = Math.round((Number(ms) || 0) / 60000);
  if (m < 1) return ms > 0 ? '<1m' : '0m';
  if (m < 60) return `${m}m`;
  const hrs = Math.floor(m / 60);
  return hrs < 100 ? `${hrs}h ${String(m % 60).padStart(2, '0')}m` : `${hrs.toLocaleString('en-US')}h`;
}

/** A token count in three or four characters: 950, 9.4k, 412k, 2.34M, 322M, 1.20B. */
function count(n) {
  n = Number(n) || 0;
  if (n < 1000) return String(Math.round(n));
  if (n < 1e4) return `${(n / 1e3).toFixed(1)}k`;
  if (n < 1e6) return `${Math.round(n / 1e3)}k`;
  if (n < 1e7) return `${(n / 1e6).toFixed(2)}M`;
  if (n < 1e8) return `${(n / 1e6).toFixed(1)}M`;
  if (n < 1e9) return `${Math.round(n / 1e6)}M`;
  if (n < 1e11) return `${(n / 1e9).toFixed(2)}B`;
  return `${(n / 1e9).toFixed(1)}B`;
}
// made once: a number formatter takes a tenth of a millisecond to make, and the list writes dozens on every redraw
const WHOLE = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const CENTS = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const whole = (n) => WHOLE.format(Math.round(Number(n) || 0));
const dollars = (n) => `$${CENTS.format(Number(n) || 0)}`;
/** Dollars without the cents once they stop mattering: "$4.20", "$83", "$1,539". */
const dollarsShort = (n) => (Number(n) < 10 ? dollars(n) : `$${whole(n)}`);
/** How much a file holds: "18 KB", "4.2 MB", "2.28 GB". */
function bytes(n) {
  n = Number(n) || 0;
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1048576).toFixed(n < 10 * 1048576 ? 1 : 0)} MB`;
  return `${(n / 1073741824).toFixed(2)} GB`;
}

/** Working files and drive space use the same units, with an unknown figure kept distinct from an empty folder. */
function diskSize(n) {
  if (typeof n !== 'number' || !Number.isFinite(n) || n < 0) return 'unknown';
  if (n < 1024) return `${Math.round(n)} B`;
  if (n < 1048576) return `${Math.round(n / 1024)} KB`;
  if (n < 1073741824) return `${(n / 1048576).toFixed(n < 10 * 1048576 ? 1 : 0)} MB`;
  return `${(n / 1073741824).toFixed(1)} GB`;
}

/** A figure whose letters (the units in "17h 08m", "3.71M", "41%") stand apart from its digits, so they can be set smaller. */
function figure(text, tag = 'b') {
  const b = document.createElement(tag);
  for (const part of String(text).split(/([A-Za-z%$]+)/)) {
    if (!part) continue;
    if (/^[A-Za-z%$]/.test(part)) b.append(h('i', { class: 'u', text: part }));
    else b.append(part);
  }
  return b;
}

/** "claude-opus-5-5" reads as "Opus 5.5"; anything else is shown as it is. */
function modelName(id) {
  const m = /^claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?:-|\[|$)/.exec(id || '');
  return m ? `${m[1][0].toUpperCase()}${m[1].slice(1)} ${m[2]}${m[3] ? '.' + m[3] : ''}` : String(id || '');
}

const folderOf = (cwd) => String(cwd || '').split(/[\\/]/).filter(Boolean).pop() || '';
const clock = (at) => new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
const clockShort = (at) => new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
/** '2026-10-01' reads as "Thu 1 Oct". */
function dayLabel(key, long) {
  const [y, m, d] = String(key).split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', long ? { weekday: 'long', day: 'numeric', month: 'long' } : { weekday: 'short', day: 'numeric', month: 'short' });
}
const dateTime = (at) => `${new Date(at).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}, ${clockShort(at)}`;
/** "18:20" for a moment today, "Thu 8 Oct, 09:00" for another day. */
const whenOf = (at) => (new Date(at).toDateString() === new Date().toDateString() ? clockShort(at) : dateTime(at));

/** The same in a tight place: "18:20" today, "Tue 09:00" within a week either way, "8 Oct" beyond that. */
function whenShort(at, now = Date.now()) {
  const d = new Date(at);
  if (d.toDateString() === new Date(now).toDateString()) return clockShort(at);
  if (Math.abs(at - now) < 6 * 86400e3) return `${d.toLocaleDateString('en-GB', { weekday: 'short' })} ${clockShort(at)}`;
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

/** The name a conversation goes by: the one it was given, else the CLI's title for it, else its folder. */
function labelOf(c) {
  return (c.named && c.name) || c.title || c.name || folderOf(c.cwd) || 'Chat';
}

/** What a session is doing, in a few plain words. Empty for one that is simply idle. */
function phrase(c) {
  if (c.state === 'attention') {
    if (c.waiting === 'blocked') return 'Blocked until you answer';
    if (c.waiting === 'permission prompt') return 'Waiting for your permission';
    if (c.waiting === 'input needed') return 'Waiting for your answer';
    if (c.waiting === 'dialog open') return 'Waiting for you to choose';
    return 'Waiting for you';
  }
  if (c.state === 'error') return c.limit ? 'Stopped at a usage limit' : c.pid ? 'Stopped on an error' : 'Failed';
  if (c.state === 'compacting') return 'Compacting its memory';
  if (c.state === 'working') {
    if (c.background) return c.helpers ? `${c.helpers} agent${c.helpers === 1 ? '' : 's'} still working` : 'Background work still running';
    if (c.doing) return c.doing.what ? `${c.doing.name} · ${c.doing.what}` : c.doing.name;
    return 'Working';
  }
  return '';
}

/**
 * The mark a session is drawn with (see Icons.glyph). unread: it finished and nobody has looked yet. seen: the person
 * had it in front of them while it waited (or stood on its error), so it is drawn dull and no longer calls.
 */
function markOf(c, unread, seen = false) {
  if (!c) return 'none';
  if (c.state === 'attention') return seen ? 'needs-seen' : 'needs';
  if (c.state === 'idle') return unread ? 'done' : 'idle';
  if (c.state === 'error' && seen) return 'error-seen';
  return c.state;
}

const LIMITS = { five_hour: '5-hour limit', seven_day: 'weekly limit', seven_day_opus: 'weekly Opus limit', seven_day_sonnet: 'weekly Sonnet limit' };
/** "5-hour limit" for five_hour; a limit not known by name is shown as the service names it. */
const limitName = (type) => LIMITS[type] || (type ? `${String(type).replace(/_/g, ' ')} limit` : 'usage limit');

// ---- accounts ----
// Accounts are told apart by how bright they are drawn, not by a hue: colour is kept for what a session's state means.
const ACCT_SHADES = [0.9, 0.58, 0.38, 0.24, 0.7, 0.46];
const ACCT_NONE = 'rgba(236, 236, 238, 0.11)';
/** The shade an account is drawn in, the same wherever it shows. */
const acctColor = (a) => (a && Number.isInteger(a.n) ? `rgba(236, 236, 238, ${ACCT_SHADES[a.n % ACCT_SHADES.length]})` : ACCT_NONE);
/** "Max 20x" for default_claude_max_20x; '' for a plan not known by name. */
function planName(plan) {
  const p = String(plan || '').toLowerCase();
  const m = /max_(\d+)x/.exec(p);
  if (m) return `Max ${m[1]}x`;
  if (p.includes('max')) return 'Max';
  if (p.includes('team')) return 'Team';
  if (p.includes('enterprise')) return 'Enterprise';
  if (p.includes('pro')) return 'Pro';
  return '';
}
/** The name an account goes by: the one the person gave it, else its email, else its id. */
const acctName = (a, names) => (names && names[a.key]) || a.email || `Account ${a.key}`;
/** For tight places: the name the person gave it, else what stands before the @. */
const acctShort = (a, names) => (names && names[a.key]) || (a.email ? a.email.split('@')[0] : a.key);
const PLAN_OLD_MS = 15 * 60e3;
const toneOfUse = (used) => (used >= 90 ? 'hot' : used >= 70 ? 'warm' : '');
/**
 * Where one usage limit of an account stands: { used, until, at, open, tone, old }, or null when nothing was ever
 * reported for it. open: the window it speaks of has not reset yet. old: nothing has reported for a while.
 */
function windowOf(w, now = Date.now()) {
  if (!w) return null;
  const open = w.until > now;
  return { used: w.used, until: w.until, at: w.at, open, tone: open ? toneOfUse(w.used) : '', old: now - w.at > PLAN_OLD_MS };
}
/**
 * Where a limit is heading at the pace of late (percent an hour): { at: the percentage when it resets,
 * full: the moment it is used up, 0 when the reset comes first }. null when the pace is too slow to tell.
 */
function forecast(w, pace, now = Date.now()) {
  if (!w || w.until <= now || !(pace > 0.2)) return null;
  const at = w.used + pace * ((w.until - now) / 3600e3);
  return { at: Math.min(100, at), full: at >= 100 ? now + ((100 - w.used) / pace) * 3600e3 : 0 };
}

// ---- small drawings ----
/** A row of thin bars, one per value, as one path. */
function spark(values, { width = 90, height = 16, gap = 1, tone = '' } = {}) {
  const svg = svgEl('svg', { viewBox: `0 0 ${width} ${height}`, width, height, 'aria-hidden': 'true', class: `spark${tone ? ' ' + tone : ''}` });
  const n = values.length || 1;
  const w = (width - gap * (n - 1)) / n;
  const top = Math.max(1, ...values);
  let d = '';
  let base = '';
  values.forEach((v, i) => {
    const x = (i * (w + gap)).toFixed(2);
    // every slot keeps a hairline, so an empty stretch reads as quiet time and not as missing data
    base += `M${x} ${height - 1}h${w.toFixed(2)}v1h-${w.toFixed(2)}z`;
    if (v <= 0) return;
    const bar = Math.max(2, Math.round((v / top) * height));
    d += `M${x} ${height - bar}h${w.toFixed(2)}v${bar}h-${w.toFixed(2)}z`;
  });
  svg.append(svgEl('path', { d: base, class: 'floor' }), svgEl('path', { d }));
  return svg;
}

/** A line that fills from the left. tone: '', 'warm' or 'hot'. mark: a tick at that share (where it is heading). */
function bar(part, tone, mark) {
  const el = h('span', { class: `track${tone ? ' ' + tone : ''}` }, h('i', { style: `width:${(Math.min(1, Math.max(0, part)) * 100).toFixed(1)}%` }));
  if (mark > 0) el.append(h('u', { style: `left:${(Math.min(1, mark) * 100).toFixed(1)}%` }));
  return el;
}

/**
 * A chart of upright bars. items: [{ value, tip, label, mark, parts }]; mark sets a bar apart ('now', 'dim');
 * parts: [{ value, color }] draws the bar as a stack in those colours. every: a label under every n-th bar.
 */
function barChart(items, { height = 120, format = count, every = 0 } = {}) {
  const top = Math.max(0, ...items.map((it) => it.value));
  const bars = h('div', { class: 'bars', style: `height:${height}px` });
  for (const it of items) {
    const share = top > 0 ? it.value / top : 0;
    const tall = it.value > 0 ? Math.max(2, Math.round(share * height)) : 0;
    const col = h('i', { style: `height:${tall}px` });
    if (it.parts && it.value > 0) {
      col.classList.add('stack');
      for (const part of it.parts) if (part.value > 0) col.append(h('u', { style: `flex:${part.value} 0 0;background:${part.color}` }));
    }
    bars.append(h('div', { class: `bar-slot${it.mark ? ' ' + it.mark : ''}`, tip: it.tip }, col));
  }
  const axis = h('div', { class: 'axis' });
  items.forEach((it, i) => axis.append(h('span', { text: every && (i % every === 0 || it.mark === 'now') ? it.label || '' : '' })));
  return h('div', { class: 'chart' },
    h('div', { class: 'scale' }, h('span', { text: top > 0 ? format(top) : '' }), h('span', { text: top > 0 ? format(top / 2) : '' }), h('span', { text: '0' })),
    h('div', { class: 'plot' }, bars, axis));
}

/** A line that rises and falls, filled underneath: how full a memory was, reply after reply. points: [{ v }]; top: the value at the ceiling. */
function areaChart(points, { width = 520, height = 90, top = 0 } = {}) {
  const svg = svgEl('svg', { viewBox: `0 0 ${width} ${height}`, preserveAspectRatio: 'none', class: 'area', 'aria-hidden': 'true' });
  if (points.length < 2) return svg;
  const max = Math.max(top, ...points.map((p) => p.v), 1);
  const x = (i) => (i / (points.length - 1)) * width;
  const y = (v) => height - 2 - (v / max) * (height - 6);
  let d = `M0 ${y(points[0].v).toFixed(1)}`;
  for (let i = 1; i < points.length; i++) d += `L${x(i).toFixed(1)} ${y(points[i].v).toFixed(1)}`;
  if (top > 0) svg.append(svgEl('path', { d: `M0 ${y(top).toFixed(1)}H${width}`, class: 'ceiling' }));
  svg.append(svgEl('path', { d: `${d}V${height}H0Z`, class: 'under' }), svgEl('path', { d, class: 'line' }));
  return svg;
}

// ---- things that float above the page ----
/**
 * Shows the text of whatever carries data-tip, under it. The first one waits a moment, so a pointer on its way
 * elsewhere raises nothing; once one is up, the next shows at once.
 */
function initTips(el) {
  const WAIT = 380;
  const WARM = 700;
  let over = null;
  let timer = 0;
  let warmUntil = 0;
  const place = () => {
    const r = over.getBoundingClientRect();
    const w = el.offsetWidth;
    const hh = el.offsetHeight;
    const x = Math.max(8, Math.min(r.left + r.width / 2 - w / 2, window.innerWidth - w - 8));
    let y = r.bottom + 8;
    // above, where the place below belongs to something drawn over the page (the Browser's page)
    if (over.hasAttribute('data-tip-up') && r.top - hh - 8 >= 8) y = r.top - hh - 8;
    else if (y + hh > window.innerHeight - 8) y = Math.max(8, r.top - hh - 8);
    el.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
  };
  const hide = () => {
    clearTimeout(timer);
    if (!el.hidden) warmUntil = Date.now() + WARM;
    over = null;
    el.hidden = true;
  };
  const show = () => {
    if (!over || !over.isConnected || !over.dataset.tip) { hide(); return; }
    el.textContent = over.dataset.tip;
    el.hidden = false;
    place();
  };
  document.addEventListener('mouseover', (e) => {
    const target = e.target instanceof Element ? e.target.closest('[data-tip]') : null;
    if (target === over) return;
    clearTimeout(timer);
    if (!target) { hide(); return; }
    over = target;
    if (!el.hidden || Date.now() < warmUntil) show();
    else timer = setTimeout(show, WAIT);
  });
  document.addEventListener('mouseleave', hide);
  window.addEventListener('blur', hide);
  document.addEventListener('pointerdown', hide, true);
  document.addEventListener('scroll', hide, true);
  document.addEventListener('keydown', hide, true);
}

// ---- the cards: one look for everything said, flat black. The notes over other programs (notes.js) and the window's
// ---- own cards (Cards, below) draw them alike: a mark, the words, Go there when the card points somewhere, and ×. ----
const CARD_MARKS = {
  needs: () => glyph('needs', 14), error: () => glyph('error', 14), done: () => glyph('done', 14), nest: () => icon('nest', 15),
  limit: () => icon('gauge', 15), reset: () => icon('usage', 15), disk: () => icon('alert', 15), shift: () => icon('clock', 15),
  show: () => icon('image', 15), page: () => icon('globe', 15), info: () => icon('info', 15),
};
/** n: { id, kind, title, what, body, place, at, open (it points somewhere), stays }. go: Go there. close: ×. */
function noteCard(n, go, close) {
  const named = `${n.title || ''} ${n.what || ''}`.trim() || n.body || '';
  return h('article', { class: `nc k-${n.kind || 'info'}${n.stays ? ' stays' : ''}${n.title || n.what ? '' : ' plain'}`, data: { id: n.id }, role: 'group', 'aria-label': named },
    h('div', { class: 'nc-mark' }, (CARD_MARKS[n.kind] || CARD_MARKS.info)()),
    h('div', { class: `nc-main${n.open ? ' goes' : ''}`, onclick: n.open ? go : null },
      (n.title || n.what) && h('div', { class: 'nc-head' },
        n.title && h('span', { class: 'nc-title', text: n.title }),
        n.what && h('span', { class: 'nc-what', text: n.what }),
        n.at && h('span', { class: 'nc-time', data: { at: String(n.at) }, text: ago(n.at) })),
      n.place && h('div', { class: 'nc-place', text: n.place }),
      n.body && h('p', { class: 'nc-body', text: n.body }),
      n.open && h('div', { class: 'nc-acts' },
        h('button', { class: 'nc-open', onclick: (e) => { e.stopPropagation(); go(); } }, h('span', { text: 'Go there' }), icon('arrow-right', 13)))),
    h('button', { class: 'nc-x', 'aria-label': `Close: ${named}`, title: 'Close', onclick: (e) => { e.stopPropagation(); close(); } }, icon('x', 14)));
}

/**
 * The window's own cards, in the corner of the chats that Settings names (the top right unless changed), the newest on
 * top. A card goes by itself after its time, all of them held while the pointer is on them; one that points somewhere
 * stays at least 12 seconds. #toast is what a screen reader reads out: the newest card's words, never drawn.
 */
const Cards = (() => {
  const MAX = 4;
  const POINTED_MS = 12000;
  const AFTER_POINTER_MS = 3000;
  let list = [];                 // newest first: { id, kind, title, what, body, text, target, at, until }
  let seq = 0;
  let held = false;
  let go = null;
  let timer = 0;
  let readId = '';               // the card whose words the screen reader's line holds: the newest said, until it goes
  const box = () => document.getElementById('cards');
  const said = () => document.getElementById('toast');

  function draw() {
    const root = box();
    if (!root) return;
    fill(root, list.map((n) => noteCard({ ...n, open: Boolean(n.target) }, () => { close(n.id); if (go) go(n.target); }, () => close(n.id))),
      list.length > 1 && h('button', { class: 'nc-all', text: 'Close all', onclick: clear }));
    root.hidden = !list.length;
    if (!list.length) held = false;
    const line = said();
    if (line && readId && !list.some((n) => n.id === readId)) { readId = ''; line.hidden = true; }
  }

  function tick() {
    clearTimeout(timer);
    if (!list.length) return;
    const now = Date.now();
    if (!held) {
      const before = list.length;
      list = list.filter((n) => n.until > now);
      if (list.length !== before) draw();
    }
    for (const t of box() ? box().querySelectorAll('.nc-time') : []) t.textContent = ago(Number(t.dataset.at), now);
    if (list.length) timer = setTimeout(tick, held ? 1000 : Math.max(200, Math.min(1000, Math.min(...list.map((n) => n.until)) - now)));
  }

  /** text: the whole of what is said. more: { kind, title, what, body, target } for a card with a head and Go there. */
  function up(text, ms = 3600, more = {}) {
    const words = String(text || '').trim();
    if (!words || !box()) return '';
    const target = typeof more.target === 'string' ? more.target : '';
    const n = { id: `c${++seq}`, kind: more.kind || 'info', title: more.title || '', what: more.what || '', body: more.title || more.what ? more.body || '' : words,
      text: words, target, at: more.title ? Date.now() : 0, until: Date.now() + Math.max(Number(ms) || 3600, target ? POINTED_MS : 0) };
    // a newer card about the same place takes the older one's
    list = [n, ...list.filter((x) => !target || x.target !== target || x.kind !== n.kind)].slice(0, MAX);
    const line = said();
    if (line) { readId = n.id; line.textContent = words; line.hidden = false; }
    draw();
    tick();
    return n.id;
  }
  function close(id) {
    const before = list.length;
    list = list.filter((n) => n.id !== id);
    if (list.length !== before) { draw(); tick(); }
  }
  function clear() {
    list = [];
    draw();
    tick();
  }
  /** go(target): how the window goes where a card points. corner: 'top-right' or 'top-left'. */
  function init(goTo) {
    go = goTo;
    const root = box();
    if (!root) return;
    root.addEventListener('mouseenter', () => { held = true; });
    root.addEventListener('mouseleave', () => {
      held = false;
      const soonest = Date.now() + AFTER_POINTER_MS;
      for (const n of list) if (n.until < soonest) n.until = soonest;
      tick();
    });
  }
  function corner(where) {
    const root = box();
    if (root) root.classList.toggle('right', where !== 'top-left');
  }
  return { up, close, clear, init, corner, lastText: () => (list[0] ? list[0].text : ''), count: () => list.length };
})();

/** Says something in a card. more: { kind, title, what, body, target } makes it a card with a head and Go there. */
function toast(text, ms = 3600, more) {
  Cards.up(text, ms, more);
}

/** A quiet action in the notes area, which takes space in the page and never takes the keyboard on arrival. */
function actionNote(root, text, label, run, props = {}) {
  const words = h('span', { class: 'action-note-text', text });
  const button = h('button', { class: 'btn sm ghost', text: label, onmousedown: (e) => e.preventDefault(), onclick: run });
  const note = h('div', { ...props, class: `callout action-note ${props.class || ''}`, role: 'status' }, words, button);
  root.append(note);
  return note;
}

// A drive nearly full, at the top of the page until it is dismissed for the day. (Near the clock, main says it: main.cjs track.)
const DiskNotes = (() => {
  const notes = new Map();
  const dismissed = new Map();
  const dayOf = (now) => new Date(now).toDateString();

  function words(drive, state) {
    const sessions = state.snap.chats || [];
    const rank = { attention: 0, error: 1, working: 2, compacting: 2, idle: 3 };
    const primary = new Map();
    // A console's title names only the session that stands for it in the list.
    for (const c of [...sessions].sort((a, b) => rank[a.state] - rank[b.state] || b.at - a.at)) {
      if (c.chat && !primary.has(c.chat)) primary.set(c.chat, c.key);
    }
    const rows = sessions.map((c) => {
      const folders = c.disk ? c.disk.folders.filter((f) => f.drive.toLowerCase() === drive.drive.toLowerCase() && f.status !== 'missing') : [];
      const known = folders.length && folders.every((f) => typeof f.bytes === 'number' && Number.isFinite(f.bytes));
      const chat = primary.get(c.chat) === c.key ? state.chats.find((x) => x.id === c.chat) : null;
      return { key: c.key, name: (chat && chat.title) || labelOf(c), bytes: known ? folders.reduce((sum, f) => sum + f.bytes, 0) : 0 };
    }).filter((c) => c.bytes > 0).sort((a, b) => b.bytes - a.bytes || String(a.key).localeCompare(String(b.key))).slice(0, 2);
    const held = rows.map((c) => `${c.name} ${diskSize(c.bytes)}`).join(', ');
    return `Drive ${drive.drive} has ${diskSize(drive.free)} left.${held ? ` Working files of chats, the most: ${held}. Claude Code keeps them after a chat ends.` : ''}`;
  }

  function update(root, state, now = Date.now()) {
    const today = dayOf(now);
    const seen = new Set();
    for (const d of state.snap.drives || []) {
      if (!d.low || typeof d.free !== 'number') continue;
      const key = d.drive.toUpperCase();
      if ((dismissed.get(key) || kept.get(`disk-dismiss:${key}`, '')) === today) continue;
      seen.add(key);
      const text = words(d, state);
      let note = notes.get(key);
      if (!note || !note.isConnected) {
        note = actionNote(root, text, 'Dismiss for today', () => {
          dismissed.set(key, today);
          kept.set(`disk-dismiss:${key}`, today);
          note.remove();
          notes.delete(key);
        }, { class: 'disk-note', data: { drive: key } });
        notes.set(key, note);
      } else note.querySelector('.action-note-text').textContent = text;
    }
    for (const [key, note] of notes) if (!seen.has(key)) { note.remove(); notes.delete(key); }
  }

  return { update, words };
})();

/**
 * A short list of things to do, opened at a point. items: { label, icon, key, run, danger, on (ticked) },
 * { heading }, { label, swatches: [{ color, label, tip, on, run }] } for a row of colours, or null for a divider.
 * The arrow keys move through it (left and right along a row of colours), Enter runs, Esc closes.
 * Returns the function that closes it.
 */
function popMenu(x, y, items) {
  const el = document.getElementById('menu');
  const back = document.activeElement;
  const close = (give) => {
    if (el.hidden) return;
    el.hidden = true;
    el.replaceChildren();
    window.removeEventListener('pointerdown', outside, true);
    window.removeEventListener('keydown', key, true);
    window.removeEventListener('blur', blur);
    if (give !== false && back instanceof HTMLElement && back.isConnected) back.focus();
  };
  const blur = () => close(false);
  const outside = (e) => { if (!el.contains(e.target)) close(false); };
  const key = (e) => {
    // a row of colours is one stop for Up and Down, its picked colour first; Left and Right move along it
    const list = [...el.children].flatMap((x) => (x.classList.contains('menu-item') ? [x]
      : x.classList.contains('menu-swatches') ? [x.querySelector('.on') || x.firstElementChild] : []));
    const here = document.activeElement;
    const row = here && here.classList.contains('menu-swatch') ? [...here.parentElement.children] : null;
    const at = row ? list.findIndex((x) => x.parentElement === here.parentElement) : list.indexOf(here);
    if (e.key === 'Escape') close();
    else if (row && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) row[(row.indexOf(here) + (e.key === 'ArrowRight' ? 1 : row.length - 1)) % row.length].focus();
    else if (e.key === 'ArrowDown') list[(at + 1) % list.length].focus();
    else if (e.key === 'ArrowUp') list[(at - 1 + list.length) % list.length].focus();
    else if (e.key === 'Home') list[0].focus();
    else if (e.key === 'End') list[list.length - 1].focus();
    else if (e.key === 'Tab') close();
    else return;
    e.preventDefault();
    e.stopPropagation();
  };
  el.replaceChildren(...items.map((it) => {
    if (!it) return h('div', { class: 'menu-line' });
    if (it.heading) return h('div', { class: 'menu-head', text: it.heading });
    if (it.note) return h('div', { class: 'menu-note', text: it.note });
    // a pick applies at once and the menu stays open, so another colour can be tried
    if (it.swatches) {
      const row = h('div', { class: 'menu-swatches', role: 'group', 'aria-label': it.label || 'Colour' });
      for (const s of it.swatches) {
        const b = h('button', { class: `menu-swatch ${s.color ? `ws-${s.color}` : 'ws-auto'}${s.on ? ' on' : ''}`, role: 'menuitemradio', 'aria-checked': String(Boolean(s.on)),
          'aria-label': s.label, tip: s.tip || s.label, text: s.color ? '' : s.label, data: { color: s.color || '' },
          onclick: () => {
            s.run();
            for (const other of row.children) {
              other.classList.toggle('on', other === b);
              other.setAttribute('aria-checked', String(other === b));
            }
          } });
        row.append(b);
      }
      return row;
    }
    // an entry that can be ticked is one of a set to choose from, and says so to whoever cannot see the tick
    const pick = 'on' in it;
    return h('button', { class: `menu-item${it.danger ? ' danger' : ''}`, role: pick ? 'menuitemradio' : null, 'aria-checked': pick ? String(Boolean(it.on)) : null, onclick: () => { close(); it.run(); } },
      it.on ? icon('check', 14) : it.icon ? icon(it.icon, 14) : h('span', { class: 'icon-gap' }), h('span', { text: it.label }), it.key && h('kbd', { text: it.key }));
  }));
  el.hidden = false;
  const w = el.offsetWidth;
  const hh = el.offsetHeight;
  const left = Math.max(8, Math.min(x, window.innerWidth - w - 8));
  const top = Math.max(8, Math.min(y, window.innerHeight - hh - 8));
  el.style.left = `${left}px`;
  el.style.top = `${top}px`;
  // it grows out of the point it was opened at
  el.style.transformOrigin = `${Math.round(x - left)}px ${Math.round(y - top)}px`;
  const first = el.querySelector('.menu-item');
  if (first) first.focus({ preventScroll: true });
  // after the click that opened it has finished
  setTimeout(() => {
    if (el.hidden) return;
    window.addEventListener('pointerdown', outside, true);
    window.addEventListener('keydown', key, true);
    window.addEventListener('blur', blur);
  }, 0);
  return close;
}

/** A menu hung under the thing that was clicked, its right edges in line. */
function menuUnder(target, items) {
  const r = target.getBoundingClientRect();
  const close = popMenu(r.right, r.bottom + 6, items);
  const el = document.getElementById('menu');
  el.style.left = `${Math.max(8, Math.min(r.right - el.offsetWidth, window.innerWidth - el.offsetWidth - 8))}px`;
  el.style.transformOrigin = '100% 0';
  return close;
}

/** What a page keeps for itself between runs (which groups are folded, how the list is grouped). Off: nothing is kept, and nothing breaks. */
const kept = {
  get(name, fallback) {
    try { const v = localStorage.getItem(`desk.${name}`); return v == null ? fallback : v; } catch { return fallback; }
  },
  set(name, value) {
    try { localStorage.setItem(`desk.${name}`, String(value)); } catch { /* storage switched off */ }
  },
};

// A pane that is rebuilt whole would take away text the person has selected in it, so it leaves itself alone
// meanwhile. skipped: some pane did; the shell redraws once the selection is gone.
const held = { skipped: false };
/** True while text is selected inside `el`. */
function selectionIn(el) {
  const s = window.getSelection();
  const yes = Boolean(s && !s.isCollapsed && s.anchorNode && el.contains(s.anchorNode));
  if (yes) held.skipped = true;
  return yes;
}

/** Makes what `kids` lists the children of `parent`, moving only what is out of place: what stays keeps its scroll, its focus and its selection. */
function sync(parent, kids) {
  kids.forEach((el, i) => { if (parent.children[i] !== el) parent.insertBefore(el, parent.children[i] || null); });
  while (parent.children.length > kids.length) parent.lastChild.remove();
}

/**
 * The foldable groups of a list: a heading with a count, and under it the rows, which fold away. Which ones
 * are folded is remembered under `name`. changed(): called after one was folded or unfolded.
 * foldedAtFirst: the groups that start folded.
 */
function foldGroups(name, changed, foldedAtFirst = []) {
  let fold = {};
  try { fold = JSON.parse(kept.get(name, '{}')) || {}; } catch { fold = {}; }
  const all = new Map();         // group id -> { el, head, title, count, inner }
  const folded = (id) => (Object.hasOwn(fold, id) ? Boolean(fold[id]) : foldedAtFirst.includes(id));
  const set = (id, on) => { fold[id] = on; kept.set(name, JSON.stringify(fold)); };
  /** The group's elements, made the first time it is asked for, with its title and count written in. Its rows go into `inner`. */
  function draw(id, title, n) {
    let g = all.get(id);
    if (!g) {
      const titleEl = h('span', { class: 'g-title' });
      const count = h('span', { class: 'g-n' });
      const inner = h('div', { class: 'group-inner' });
      const head = h('button', { class: 'group-head', onclick: () => { set(id, !folded(id)); changed(); } }, icon('chevron-right', 12, 'caret'), titleEl, count);
      g = { el: h('section', { class: 'group', data: { group: id } }, head, h('div', { class: 'group-rows' }, inner)), head, title: titleEl, count, inner };
      all.set(id, g);
    }
    g.title.textContent = title;
    g.count.textContent = String(n);
    g.el.classList.toggle('folded', folded(id));
    g.head.setAttribute('aria-expanded', String(!folded(id)));
    return g;
  }
  /** Forgets the groups that are no longer among the ones shown. */
  const keep = (shown) => { for (const [id, g] of all) if (!shown.includes(g.el)) all.delete(id); };
  return { draw, folded, set, keep };
}
