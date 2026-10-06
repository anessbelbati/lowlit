'use strict';
// Loaded only when DESK_SELFTEST=<folder> is set. Drives the real window,
// hidden, through the list of chats, the chats side by side in plain consoles
// and a live agent session, and keeps pictures of the window's own pixels
// (never of the screen). The record phase never writes to the clipboard; no phase sends
// anything to a model: the one Enter they press on the agent's prompt is for /exit.
//   DESK_SELFTEST_TYPE=1       also type into the agent's prompt box, paste two
//                              lines, clear the box, leave with /exit, then
//                              measure what ten full scrollbacks cost.
//   DESK_SELFTEST_CLOSE=1      close the chat while the agent is running, and
//                              check the agent ended its session itself.
//   DESK_SELFTEST_CLOSE=quit   close the whole window instead; what became of
//                              the agent is then checked from outside, with
//                              the facts left in report.json.
//   DESK_SELFTEST_ONLY=widths  stop before the agent is started.
//   DESK_SELFTEST_ONLY=states  only the list and the pages: the real sessions, then the made-up ones. No terminal is opened.
//   DESK_SELFTEST_ONLY=spaces  the workspaces with real consoles, after the first console: plain consoles in folders
//                              the run makes for itself. No agent is started. (Run it with DESK_SELFTEST_SKIP=states.)
//   DESK_SELFTEST_ONLY=picture four plain consoles dressed as made-up chats, for pictures of the window that hold
//                              nothing of the person's: invented names, invented numbers, invented terminal text.
//   DESK_SELFTEST_ONLY=shots   the pictures meant for a README or a website: eight plain consoles dressed as made-up chats in
//                              four workspaces, the panel, the cards, the Dashboard and what its day cost, a chat with its
//                              Browser on a made-up page and its Viewer on two made-up pictures, made-up servers, History,
//                              the search box, the question a close asks and the floating card. One account. Run it with -Dom.
//   DESK_SELFTEST_ONLY=leave   two plain consoles are opened and one is named; the app is then closed the way the
//                              person closes it, answering "keep them". No agent is started.
//   DESK_SELFTEST_ONLY=jev     Jev with a made-up OpenRouter (nothing leaves the machine), over made-up sessions:
//                              the verdicts, the marks, the list, the bars, the card after time away, the header, the
//                              look, search put in order, the key never in the page, the ops record never sent.
//   DESK_SELFTEST_ONLY=nest    the Nest over a made-up record, plain consoles standing in for its chats: its page, its
//                              column, the logo, its key in the window and as main sends it, Settings, the search box,
//                              a record reached through a junction. No agent is started; the key itself is never
//                              pressed (a press from another program shows the window).
//   DESK_SELFTEST_ONLY=work    the shift clock and the record of the day over a made-up day on a made-up clock: the
//                              clock in the title bar, its panel, the Dashboard's day, Settings, a night past midnight,
//                              a sleep, a restart. What ActivityWatch would answer is made up too.
//   DESK_SELFTEST_ONLY=back    the start after that, on the same profile: the two consoles come back by themselves.
//                              DESK_SELFTEST_EXPECT=auto (after a proper close) or crash (after a run that never
//                              reached its end, which is how a 'back' run itself ends).
//   DESK_SELFTEST_ONLY=gaming  Gaming mode over two plain consoles and three servers the run starts itself: what it
//                              ends, what it keeps for the next start, what comes back, its words and its setting.
//   DESK_SELFTEST_SKIP=states  leave out the made-up sessions, the reader, History, the Dashboard, the search box and Settings
//                              (the short run covers them), so a run with the agent stays under a minute.
//   DESK_SELFTEST_AGENT_ARGS   extra words for the agent's command line (its own debug switches, when a start or an end needs explaining)
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { Watch } = require('./watch.cjs');

// Text the sessions on this machine really print: emoji that are wide on their
// own, emoji that only become wide through a trailing selector or a joiner,
// kaomoji, and the status glyphs of the agent's own screen. Kept as code
// points: the script written from them has to be plain ASCII, or Windows
// PowerShell misreads it.
const SAMPLES = {
  'folder': [0x1F5C2, 0xFE0F],
  'folder-bare': [0x1F5C2],
  'warning': [0x26A0, 0xFE0F],
  'warning-bare': [0x26A0],
  'heart': [0x2764, 0xFE0F],
  'tick': [0x2705],
  'bird': [0x1F426],
  'brain': [0x1F9E0],
  // one emoji per year it was added, newest last: width tables go stale at the new end
  'emoji-2018': [0x1F9FF],
  'emoji-2019': [0x1FA70],
  'emoji-2019b': [0x1F7E0],
  'emoji-2020': [0x1F90C],
  'emoji-2020b': [0x1FAC0],
  'emoji-2020c': [0x1F6D7],
  'emoji-2021': [0x1FAE1],
  'emoji-2021b': [0x1F979],
  'emoji-2021c': [0x1F7F0],
  'emoji-2021d': [0x1F6DD],
  'emoji-2022': [0x1FAE8],
  'emoji-2022b': [0x1FA77],
  'emoji-2022c': [0x1F6DC],
  'emoji-2024': [0x1FAE9],
  'emoji-2024b': [0x1FA89],
  'coder': [0x1F468, 0x200D, 0x1F4BB],
  'flag': [0x1F1E9, 0x1F1FF],
  'thumb': [0x1F44D, 0x1F3FD],
  'kaomoji-1': [0x0669, 0x28, 0x25D5, 0x203F, 0x25D5, 0x29, 0x06F6],
  'kaomoji-2': [0x28, 0xFF61, 0x2022, 0x0300, 0x1D17, 0x2D, 0x29, 0x2727],
  'kaomoji-3': [0x28, 0x20, 0x02F6, 0x02C6, 0xA4B3, 0x02C6, 0x02F5, 0x20, 0x29, 0x2661],
  'kaomoji-4': [0x28, 0x0E51, 0x02C3, 0x1D17, 0x02C2, 0x29, 0xFEED],
  'kaomoji-5': [0x1566, 0x28, 0xF2, 0x5F, 0xF3, 0x02C7, 0x29, 0x1564],
  'status': [0x23F5, 0x23F5, 0x20, 0x2733, 0x20, 0x25CF, 0x20, 0x25D0, 0x20, 0x23BF, 0x20, 0x273B],
};
const BOX = String.fromCodePoint(0x2502);

// ---- these run inside the page; `term` there is the terminal of the chat in front ----
/* global term, Terminal, Terms, Desk, desk, Reader, History, popMenu, toast */
function pageScreen() {
  const b = term.buffer.active;
  const out = [];
  for (let y = b.baseY; y < b.baseY + term.rows; y++) {
    const line = b.getLine(y);
    out.push(line ? line.translateToString(true) : '');
  }
  return out;
}
/**
 * The agent's prompt line ("❯" in the first cell, what is typed from the third), read cell by cell: where the first
 * "Z" and the first "Y" after the start stand, and the cells in between as text. null when no prompt line shows.
 */
function pagePromptCells() {
  const b = term.buffer.active;
  for (let y = b.baseY + term.rows - 1; y >= b.baseY; y--) {
    const line = b.getLine(y);
    if (!line || line.getCell(0).getChars() !== '❯') continue;
    let z = -1;
    let yAt = -1;
    let text = '';
    for (let x = 2; x < line.length; x++) {
      const ch = line.getCell(x).getChars();
      if (ch === 'Z' && z < 0) z = x;
      if (ch === 'Y' && yAt < 0) yAt = x;
      text += ch;
    }
    return { z, y: yAt, empty: !text.trim() };
  }
  return null;
}
/** Every line a chat's terminal holds, whether that chat is in front or not. */
function pageLinesOf(id) {
  const b = Terms.get(id).term.buffer.active;
  const out = [];
  for (let y = 0; y < b.length; y++) {
    const line = b.getLine(y);
    out.push(line ? line.translateToString(true) : '');
  }
  return out;
}
function pageColourOf(text) {
  const b = term.buffer.active;
  for (let y = 0; y < b.length; y++) {
    const line = b.getLine(y);
    if (line && line.translateToString(true) === text) {
      const cell = line.getCell(0);
      return { palette: cell.isFgPalette(), colour: cell.getFgColor() };
    }
  }
  return null;
}
/** For every answer line "<tag>-<name>=<console column>": the column where the widget put the end mark of the line above it. */
function pageWidths(tag) {
  const b = term.buffer.active;
  const answer = new RegExp('^' + tag + '-([a-z0-9-]+)=(\\d+)$');
  const out = {};
  for (let y = 1; y < b.length; y++) {
    const line = b.getLine(y);
    const m = line && answer.exec(line.translateToString(true).trim());
    if (!m) continue;
    const above = b.getLine(y - 1);
    let end = -1;
    for (let x = 0; x < term.cols; x++) {
      const cell = above.getCell(x);
      if (cell && cell.getChars() === '|') end = x;
    }
    out[m[1]] = { console: Number(m[2]), widget: end + 1 };
  }
  return out;
}
function pageDrawing() {
  return {
    canvases: document.querySelectorAll('.term:not([hidden]) .xterm-screen canvas').length,
    buffer: term.buffer.active.type,
    widths: term.unicode.activeVersion,
  };
}
/** Counts the "hold this frame until it is complete" marks (mode 2026) that reach the widget. */
function pageWatchFrames() {
  window.deskFrames = 0;
  term.parser.registerCsiHandler({ prefix: '?', final: 'h' }, (params) => {
    if (Array.from(params).includes(2026)) window.deskFrames++;
    return false;
  });
  return true;
}
function pageShiftEnter() {
  term.textarea.dispatchEvent(new KeyboardEvent('keydown', {
    key: 'Enter', code: 'Enter', keyCode: 13, which: 13, shiftKey: true, bubbles: true, cancelable: true,
  }));
  return true;
}
async function pageFill(count, lines, cols) {
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:-20000px;top:0;width:1600px;height:700px';
  document.body.appendChild(host);
  const row = '\x1b[38;2;200;160;90m' + 'x'.repeat(30) + '\x1b[0m ' + 'word '.repeat(Math.floor((cols - 32) / 5)) + '\r\n';
  const block = row.repeat(500);
  const made = [];
  for (let i = 0; i < count; i++) {
    const el = document.createElement('div');
    el.style.cssText = 'position:absolute;inset:0';
    host.appendChild(el);
    const t = new Terminal({ cols, rows: 34, scrollback: lines, fontFamily: '"Cascadia Mono", Consolas, monospace', fontSize: 16 });
    t.open(el);
    for (let k = 0; k < lines / 500; k++) await new Promise((done) => t.write(block, done));
    made.push(t);
  }
  window.deskExtra = { host, made };
  if (window.gc) window.gc();
  return made.map((t) => t.buffer.active.length);
}
function pageDrop() {
  for (const t of window.deskExtra.made) t.dispose();
  window.deskExtra.host.remove();
  delete window.deskExtra;
  if (window.gc) window.gc();
  return true;
}
function pageGc() {
  if (window.gc) window.gc();
  return Boolean(window.gc);
}
/** Starts a chat the way the New chat panel does, and waits until it has the keyboard. */
async function pageNew(ask) {
  const chat = await desk.create(ask);
  if (!chat || chat.error) return chat;
  Desk.setView(chat.id);
  // the list of chats that holds it can arrive a moment after the answer does
  for (let i = 0; i < 80 && Terms.active() !== chat.id; i++) await new Promise((r) => setTimeout(r, 25));
  return chat;
}
/** The chats of this window, as the list on the left shows them and in its order. */
function pageSide() {
  return [...document.querySelectorAll('#chat-list .nav-item.chat[data-row^="chat:"]')].map((el) => ({
    id: el.dataset.id,
    active: el.classList.contains('on'),
    shown: el.classList.contains('shown'),
    label: el.querySelector('.label').textContent,
    sub: el.dataset.sub,
    mark: el.dataset.mark,
  }));
}
/** True when something in a view is wider than the room it has: a pane that would scroll sideways. */
function pageSpill(view) {
  const wide = (el) => Boolean(el) && el.scrollWidth > el.clientWidth + 1;
  const root = document.getElementById(view);
  return wide(document.documentElement) || wide(root) || [...root.querySelectorAll('.split, .list-scroll, .d-body, .d-wrap')].some(wide);
}
/** The whole list on the left: every chat on the machine, by group. Rows of a folded group count too. */
function pageList() {
  const list = document.getElementById('chat-list');
  const wide = (el) => Boolean(el) && el.scrollWidth > el.clientWidth + 1;
  const groups = {};
  const order = [];
  for (const g of list.querySelectorAll('section.group')) {
    groups[g.dataset.group] = g.querySelectorAll('.nav-item.chat').length;
    order.push(g.dataset.group);
  }
  const sel = Desk.state.sel;
  return {
    view: Desk.state.view,
    rows: list.querySelectorAll('.nav-item.chat:not(.k-ended)').length,
    here: list.querySelectorAll('.nav-item.chat.k-here').length,
    away: list.querySelectorAll('.nav-item.chat.k-away').length,
    ended: list.querySelectorAll('.nav-item.chat.k-ended').length,
    groups,
    order,
    picked: list.querySelectorAll('.nav-item.chat.on').length,
    sel: sel ? sel.key : '',
    total: document.getElementById('side-n').textContent,
    overflow: wide(document.documentElement) || wide(list) || wide(document.getElementById('side')),
  };
}
/** The page a session that runs elsewhere is looked at on; with none picked and no chat open here, the page the window starts on. */
function pagePeek() {
  const root = document.getElementById('peek');
  const blank = root.querySelector('.blank');
  const pane = root.querySelector('.detail');
  return {
    view: Desk.state.view,
    hidden: root.hidden,
    start: blank.hidden ? '' : (blank.querySelector('h2') || {}).textContent || '',
    buttons: blank.hidden ? [] : [...blank.querySelectorAll('.blank-acts .btn')].map((b) => b.textContent),
    pane: Boolean(pane) && !pane.hidden,
    // a figure on the main screen: there must be none, they all live on the Dashboard
    figures: document.querySelectorAll('#peek .kpi, #peek .bar-slot, #peek .feed-row, #peek .run-row, #chat .kpi, #chat .bar-slot, #side .count').length,
  };
}
/** The chats on screen, by place: the room each has, the size of its terminal, and which one holds the keyboard. */
function pageTiles() {
  const grid = document.getElementById('tiles');
  return {
    n: Number(grid.dataset.n),
    tiles: [...grid.querySelectorAll('.tile')].map((t) => {
      const r = t.getBoundingClientRect();
      const entry = Terms.get(t.dataset.id);
      const b = entry ? entry.term.buffer.active : null;
      return { id: t.dataset.id, on: t.classList.contains('on'), x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height),
        cols: entry ? entry.term.cols : 0, rows: entry ? entry.term.rows : 0, drawn: Boolean(t.querySelector('.tile-body > .term:not([hidden]) .xterm')),
        // the terminal stands at the end of what it holds
        atEnd: Boolean(b) && b.viewportY === b.baseY, kept: t.dataset.kept || '' };
    }),
    keyboard: Terms.active(),
    parked: document.querySelectorAll('#park > .term').length,
    split: [...document.querySelectorAll('#split button[data-n]')].map((b) => b.dataset.n + (b.classList.contains('on') ? '*' : '')),
    saved: [Desk.state.settings.tiles, Desk.state.settings.split],
    order: Desk.state.shown.slice(),
  };
}
/** The strip above one chat: its name, what it is doing, the one figure it keeps, its two buttons, and where they stand. */
function pageStrip(chat) {
  const head = document.querySelector(`#tiles .tile[data-id="${chat}"] .tile-head`);
  if (!head) return null;
  const box = (sel) => head.querySelector(sel).getBoundingClientRect();
  const edge = head.getBoundingClientRect().right - parseFloat(getComputedStyle(head).paddingRight);
  const name = head.querySelector('.th-name');
  const words = head.querySelector('.th-doing .words');
  const folder = head.querySelector('.th-folder');
  const facts = [...head.querySelectorAll('.th-facts .fact')].filter((x) => x.getClientRects().length);
  return {
    head: Math.round(head.getBoundingClientRect().width), short: Math.round(edge - box('.th-tools').right),
    name: name ? name.textContent : '', nameWide: name ? Math.round(name.getBoundingClientRect().width) : 0, nameCut: Boolean(name) && name.scrollWidth > name.clientWidth,
    folder: folder && folder.getClientRects().length ? folder.textContent : '',
    doing: words ? words.textContent : '', doingCut: Boolean(words) && words.scrollWidth > words.clientWidth,
    timer: (head.querySelector('.th-doing .timer') || {}).textContent || '',
    facts: facts.map((x) => x.textContent), figures: head.querySelectorAll('.fact').length,
    // its own buttons: the globe of its browser is counted apart (the Browser's test)
    buttons: head.querySelectorAll('.th-tools .icon-btn:not(.th-web)').length, pressed: head.querySelector('.th-tools .icon-btn:not(.th-web)').classList.contains('on'),
    globe: Boolean(head.querySelector('.th-tools .th-web')),
    tip: (head.querySelector('.th-facts') || { dataset: {} }).dataset.tip || '',
    marked: getComputedStyle(head).boxShadow !== 'none',
    spill: head.scrollWidth > head.clientWidth + 1,
  };
}
/** A press of the mouse on something, as the page sees one: down, up, click. */
function pagePress(selector) {
  const el = document.querySelector(selector);
  if (!el) return false;
  el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
  el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true }));
  el.click();
  return true;
}
/** A key pressed with Ctrl held (and Shift, when asked): the window's own keys. up: Ctrl is let go after it. */
function pageCtrl(code, shift, up) {
  document.body.dispatchEvent(new KeyboardEvent('keydown', { key: code, code, ctrlKey: true, shiftKey: Boolean(shift), bubbles: true, cancelable: true }));
  if (up) document.body.dispatchEvent(new KeyboardEvent('keyup', { key: 'Control', code: 'ControlLeft', bubbles: true }));
  return true;
}
/** The pane that shows one conversation, inside a view ('peek', 'history') or the panel beside a chat ('inspector'). */
function pageDetail(where) {
  const root = document.getElementById(where);
  const pane = root.querySelector('.detail');
  const text = (sel) => { const el = pane && pane.querySelector(sel); return el ? el.textContent : ''; };
  const all = (sel) => (pane ? [...pane.querySelectorAll(sel)] : []);
  return {
    shown: Boolean(pane) && !pane.hidden && pane.getClientRects().length > 0,
    title: text('.d-title'),
    words: text('.d-state .words'),
    mark: ((pane && pane.querySelector('.d-state')) || { className: '' }).className.replace('d-state s-', ''),
    button: text('.d-acts .btn'),
    tabs: all('.seg.tabs button').map((b) => b.textContent + (b.classList.contains('on') ? '*' : '')),
    heads: all('.d-body .sec-head h4').map((x) => x.textContent),
    calls: all('.d-body .tl-row').length,
    agents: all('.d-body .ag-row').length,
    facts: all('.d-facts .fact').filter((x) => !x.hidden).map((x) => x.textContent),
    chips: all('.d-sub .chip').map((x) => x.textContent),
    notice: text('.d-body .callout .callout-title'),
  };
}
/** What the reader holds on screen, by kind. Counts only: never a word of the conversation. */
function pageReader(where) {
  const root = document.getElementById(where);
  const n = (sel) => root.querySelectorAll(sel).length;
  const jump = root.querySelector('.rd-jump');
  return {
    asks: n('.rd-list .rd-ask'), says: n('.rd-list .rd-say'), tools: n('.rd-list .rd-tool'), failed: n('.rd-list .rd-tool.err'), running: n('.rd-list .rd-tool.run'),
    thoughts: n('.rd-list .rd-think'), turns: n('.rd-list .rd-turn'), marks: n('.rd-list .rd-mark'), notes: n('.rd-list .rd-note'), runs: n('.rd-list .rd-run'),
    days: n('.rd-list .rd-day'), open: n('.rd-list .rd-tool.open'), diffLines: n('.rd-list .diff .dl'), added: n('.rd-list .diff .dl.add'), removed: n('.rd-list .diff .dl.del'),
    tables: n('.rd-list .md-table'), code: n('.rd-list .md-pre'), lists: n('.rd-list .md-lists li'), headings: n('.rd-list .md-h'),
    new: n('.rd-list .rise'), empty: (root.querySelector('.reader .empty') || {}).textContent || '',
    top: (root.querySelector('.rd-top') || {}).textContent || '', asked: (root.querySelector('.rd-bar .btn') || {}).textContent || '',
    jump: jump && !jump.hidden ? jump.textContent : '',
  };
}
/** Moves the page's clock by `shift` ms (0: back to the real one), so the made-up day looks the same at any hour the test runs. */
function pageClock(shift) {
  if (!window.RealDate) window.RealDate = Date;
  const Real = window.RealDate;
  if (!shift) { window.Date = Real; return Date.now(); }
  window.Date = class extends Real {
    constructor(...args) { if (args.length) super(...args); else super(Real.now() + shift); }
    static now() { return Real.now() + shift; }
  };
  return Date.now();
}
/** Hands the reader and the History view made-up conversations instead of real ones. pages: JSON texts, parsed afresh for every reader that asks. */
function pageFakes(pages, history) {
  window.deskFake = { pages, grown: false, older: false };
  Reader.fake = (source, more) => {
    const F = window.deskFake;
    const copy = (name) => JSON.parse(F.pages[name]);
    // a subagent's own conversation; the session that started them; one that is not running, from its first line
    // to its last; and the one being written, which is read a page at a time and grows
    const name = source.agent ? 'agent' : source.key === 's-agents' ? 'pricing' : source.live ? 'main' : 'whole';
    const first = copy(name);
    if (more.after != null) {
      if (name === 'main' && F.grown && more.after < copy('grown').to) return copy('grown');
      return { ...first, from: more.after, to: more.after, items: [], orphans: {}, replies: [] };
    }
    if (more.before) return name === 'main' && F.older ? copy('older') : null;
    return first;
  };
  History.fake = () => JSON.parse(history);
  return true;
}
function pageKey(key, on) {
  const target = on ? document.querySelector(on) : document.body;
  target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  return true;
}
/**
 * Small letters pressed in a chat's terminal as a keyboard presses them (through the terminal's own key handling, as
 * the person's keys go), gapMs apart; what the typing meter timed meanwhile, in ms.
 */
async function pageTypeKeys(chat, letters, gapMs) {
  const t = Terms.get(chat);
  if (!t || !t.term.textarea) return null;
  const before = Terms.echoes(false).length;
  for (const ch of letters) {
    const ev = new KeyboardEvent('keydown', { key: ch, code: `Key${ch.toUpperCase()}`, bubbles: true, cancelable: true });
    const code = ch.toUpperCase().charCodeAt(0);
    Object.defineProperty(ev, 'keyCode', { get: () => code });
    Object.defineProperty(ev, 'which', { get: () => code });
    t.term.textarea.dispatchEvent(ev);
    await new Promise((r) => setTimeout(r, gapMs));
  }
  await new Promise((r) => setTimeout(r, 400));
  return Terms.echoes(false).slice(before).map((ms) => Math.round(ms * 10) / 10);
}
/**
 * A key's echo while another chat prints: once `other` has printed 20 kB, n keys are sent to `chat` the way part 1 of
 * the speed checks sends them, each timed from leaving the page to its echo arriving back (-1: none within 3 s).
 */
async function pageEchoBeside(chat, other, n) {
  const was = Terms.write;
  let waiting = null;
  let bytes = 0;
  Terms.write = function write(i, data, seq) {
    if (i === other) bytes += data.length;
    if (waiting && i === chat && data.includes(waiting.ch)) { const w = waiting; waiting = null; w.done(performance.now() - w.at); }
    return was.call(this, i, data, seq);
  };
  const one = (ch) => new Promise((done) => {
    waiting = { ch, at: performance.now(), done };
    desk.input(chat, ch);
    setTimeout(() => { if (waiting && waiting.ch === ch) { waiting = null; done(-1); } }, 3000);
  });
  const out = [];
  let flowing = false;
  let during = 0;
  const t0 = performance.now();
  try {
    while (bytes < 20000 && performance.now() - t0 < 10000) await new Promise((r) => setTimeout(r, 50));
    flowing = bytes >= 20000;
    const from = bytes;
    const m0 = performance.now();
    if (flowing) {
      for (let i = 0; i < n; i++) {
        out.push(await one(String.fromCharCode(97 + (i % 26))));
        await new Promise((r) => setTimeout(r, 40));
      }
    }
    during = { bytes: bytes - from, ms: Math.round(performance.now() - m0) };
  } finally {
    Terms.write = was;
    desk.input(chat, '\x1b');
  }
  return { echoes: out, flowing, during };
}
async function pagePicker() {
  Desk.openPicker();
  // the lists fill in once the watcher has walked the project folders
  for (let i = 0; i < 100 && document.querySelector('#picker .recent .quiet'); i++) await new Promise((r) => setTimeout(r, 100));
  // what a past conversation is called can be the first thing typed into it: a picture never shows those words
  let n = 0;
  for (const el of document.querySelectorAll('#picker .recent .pick .name')) el.textContent = `A past conversation (${++n})`;
  return {
    open: !document.getElementById('picker').hidden,
    starters: [...document.querySelectorAll('#picker .seg button')].map((b) => b.textContent + (b.classList.contains('on') ? '*' : '')),
    folders: document.querySelectorAll('#picker .folders .pick').length,
    recent: document.querySelectorAll('#picker .recent .pick').length,
  };
}
/** The workspaces above the list: the tabs, which one is in front, what each says in yellow, and the rows the list holds under them. */
function pageSpaces() {
  const root = document.getElementById('spaces');
  const label = document.getElementById('side-label');
  const count = document.getElementById('side-n');
  const s = Desk.state.settings;
  const empty = document.getElementById('side-empty');
  return {
    on: !root.hidden,
    label: label.hidden ? '' : label.textContent,
    count: count.hidden ? '' : count.textContent,
    tabs: [...root.querySelectorAll('.space-tab')].map((t) => ({ id: t.dataset.space, name: t.querySelector('.space-name').textContent, on: t.classList.contains('on'),
      n: (t.querySelector('.space-n') || { textContent: '' }).textContent, tip: t.dataset.tip || '' })),
    input: Boolean(root.querySelector('.space-input')),
    typing: Boolean(document.activeElement) && document.activeElement.classList.contains('space-input'),
    space: s.space,
    loose: Desk.state.loose,
    spaces: s.spaces.map((x) => ({ id: x.id, name: x.name, folders: x.folders.slice() })),
    keys: [...document.querySelectorAll('#chat-list .nav-item.chat:not(.k-ended)')].map((el) => el.dataset.key),
    empty: empty.hidden ? '' : empty.textContent,
    // a tab that sticks out of the sidebar, or a row of tabs wider than it
    spill: root.scrollWidth > root.clientWidth + 1 || [...root.children].some((el) => el.getBoundingClientRect().right > root.getBoundingClientRect().right + 1),
    lines: new Set([...root.children].map((el) => Math.round(el.getBoundingClientRect().top))).size,
  };
}
/** The menu that is open: its headings, and what it offers, each with whether it is ticked. null when none is. */
function pageMenu() {
  const el = document.getElementById('menu');
  if (el.hidden) return null;
  return {
    heads: [...el.querySelectorAll('.menu-head')].map((x) => x.textContent),
    notes: [...el.querySelectorAll('.menu-note')].map((x) => x.textContent),
    items: [...el.querySelectorAll('.menu-item')].map((b) => ({ label: b.querySelector('span:not(.icon-gap)').textContent, ticked: b.getAttribute('aria-checked') === 'true' })),
  };
}
/** A right click on something, the way the mouse does it. */
function pageRightClick(selector) {
  const el = document.querySelector(selector);
  if (!el) return false;
  const r = el.getBoundingClientRect();
  el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: Math.round(r.left + 20), clientY: Math.round(r.top + r.height / 2) }));
  return true;
}
/** Runs one entry of the menu that is open, by its words. */
function pageMenuRun(label) {
  const item = [...document.querySelectorAll('#menu .menu-item')].find((b) => b.querySelector('span:not(.icon-gap)').textContent === label);
  if (item) item.click();
  return Boolean(item);
}
/**
 * Draws a made-up agent screen into one chat's terminal, for a picture that may be shown to people: invented words in
 * the shapes an agent CLI prints (what was asked, replies, tool calls, a prompt box). Nothing is sent to the console
 * behind it. A terminal with fewer rows than the screen has lines keeps the newest ones. Returns the rows it drew.
 */
function pageDress(id, kind) {
  const entry = Terms.get(id);
  if (!entry) return 0;
  const term = entry.term;
  const cols = term.cols;
  const rows = term.rows;
  const room = Math.max(24, cols - 1);
  const C = { dim: '38;5;245', ok: '38;5;114', bad: '38;5;210', warm: '38;5;216', hi: '1' };
  const wrap = (text, width) => {
    const lines = [];
    let line = '';
    for (const word of text.split(' ')) {
      if (line && line.length + 1 + word.length > width) { lines.push(line); line = word; } else line = line ? `${line} ${word}` : word;
    }
    lines.push(line);
    return lines;
  };
  // What stands above the prompt. Each of these gives a list of lines, and a line is a list of [style, words];
  // what is asked and what is said run on to the width of the terminal they are drawn in.
  const gap = [[]];
  const asked = (text) => wrap(text, room - 2).map((part, i) => [[C.dim, `${i ? ' ' : '>'} ${part}`]]);
  const said = (text) => wrap(text, room - 2).map((part, i) => [[C.hi, i ? '  ' : '● '], ['', part]]);
  const plain = (text) => [[['', `  ${text}`]]];
  const tool = (name, what, going) => [[[going ? C.dim : C.ok, '● '], [C.hi, name], ['', `(${what})`]]];
  const out = (...texts) => texts.map((text, i) => [[C.dim, `${i ? '     ' : '  ⎿  '}${text}`]]);
  const diff = (n, sign, text) => [[[C.dim, `     ${String(n).padStart(4)} `], [sign === '+' ? C.ok : sign === '-' ? C.bad : '', `${sign} ${text}`]]];
  const busy = (text, note) => [[[C.warm, `✻ ${text}`], [C.dim, ` ${note}`]]];
  const cut = (parts, width) => {
    const kept = [];
    let left = width;
    for (const [style, text] of parts) {
      if (left <= 0) break;
      const t = text.slice(0, left);
      kept.push([style, t]);
      left -= t.length;
    }
    return { parts: kept, left };
  };
  // What stands at the foot: single lines.
  const rule = (a, b) => [[C.dim, `${a}${'─'.repeat(room - 2)}${b}`]];
  const boxed = (...parts) => { const c = cut(parts, room - 4); return [[C.dim, '│ '], ...c.parts, ['', ' '.repeat(c.left)], [C.dim, ' │']]; };
  const promptBox = [rule('╭', '╮'), boxed(['', '> ']), rule('╰', '╯')];
  const mode = (extra) => [[C.dim, `  ⏵⏵ bypass permissions on (shift+tab to cycle)${extra ? `  ·  ${extra}` : ''}`]];
  // prompt: which line of the foot the cursor stands in (-1: a question is open, and there is no cursor)
  const screens = {
    checkout: {
      top: [
        asked('The tax field is lost when the basket is edited twice. Fix it, then deploy.'), gap,
        said("I'll look at how the basket keeps its fields between edits."), gap,
        tool('Read', 'src/checkout/basket.ts'), out('Read 212 lines'), gap,
        tool('Search', 'pattern: "taxField", path: "src/checkout"'), out('Found 7 lines'), gap,
        said('The second edit rebuilds the basket from the form, and the form never held the tax field. I will carry it over from the basket itself.'), gap,
        tool('Update', 'src/checkout/basket.ts'), out('Updated src/checkout/basket.ts with 2 additions and 1 removal'),
        diff(88, ' ', 'const next = fromForm(form);'),
        diff(89, '-', 'return next;'),
        diff(89, '+', '// the form does not hold the tax field: it is carried over'),
        diff(90, '+', 'return { ...next, taxField: basket.taxField };'), gap,
        tool('Bash', 'npm test -- checkout'), out('Tests: 41 passed, 41 total', 'Time:  4.2 s'), gap,
        said('The basket keeps its tax field now, and all 41 tests pass. Ready to deploy.'),
      ],
      foot: [
        rule('╭', '╮'),
        boxed([C.hi, 'Bash command']),
        boxed(),
        boxed(['', '  npm run deploy -- --production']),
        boxed([C.dim, '  Deploy the site to production']),
        boxed(),
        boxed(['', 'Do you want to proceed?']),
        boxed([C.ok, '❯ 1. Yes']),
        boxed(['', "  2. Yes, and don't ask again for npm run deploy commands"]),
        boxed(['', '  3. No, and tell Claude what to do differently '], [C.dim, '(esc)']),
        rule('╰', '╯'),
      ],
      prompt: -1,
    },
    pricing: {
      top: [
        asked('Compare our prices against the five closest competitors and tell me where we are out of line.'), gap,
        said('Five competitors, each with its own pricing page. First our own plans, so there is something to compare against.'), gap,
        tool('Web Search', '"competitor pricing pages 2026"'), out('Found the public pricing pages of competitors A to E'), gap,
        tool('Read', 'plans.md'), out('Read 48 lines'), gap,
        said('Our three tiers are 35, 79 and 149 a month. I am sending one subagent to each competitor, and I will build the table once they are back.'), gap,
        tool('Task', 'Compare competitor A'), out('Done (31 tool uses · 44.1k tokens · 2m 50s)'), gap,
        tool('Task', 'Compare competitor B'), out('Done (24 tool uses · 38.7k tokens · 2m 12s)'), gap,
        tool('Task', 'Compare competitor C'), out('Done (27 tool uses · 41.0k tokens · 2m 31s)'), gap,
        tool('Task', 'Compare competitor D', true), out('Web Fetch(competitor-d.example/pricing)', '+11 more tool uses'), gap,
        tool('Task', 'Compare competitor E', true), out('Found the monthly plans; looking for the yearly ones.', '+9 more tool uses'), gap,
        said('Three of the five are in. Waiting on the last two before I build the table.'), gap,
        busy('Comparing…', '(11m 02s · ↓ 121k tokens · esc to interrupt)'),
      ],
      foot: [...promptBox, mode('3 subagents')],
      prompt: 1,
    },
    refactor: {
      top: [
        asked('The rate limiter is one file of 640 lines. What is in it?'), gap,
        tool('Search', 'pattern: "^export ", path: "src/api/limiter.ts"'), out('Found 11 lines'), gap,
        tool('Bash', 'npm test -- limiter'), out('Tests: 118 passed, 118 total', 'Time:  9.6 s'), gap,
        said('Eleven exports, and the tests cover every one of them: 118 pass before anything is touched.'), gap,
        asked('Split the rate limiter into modules. Keep every test green on the way.'), gap,
        tool('Read', 'src/api/limiter.ts'), out('Read 640 lines'), gap,
        said('The file does three jobs: counting, storing and answering. One module each.'), gap,
        tool('Write', 'src/api/limiter/count.ts'), out('Wrote 118 lines to src/api/limiter/count.ts'), gap,
        tool('Write', 'src/api/limiter/store.ts'), out('Wrote 164 lines to src/api/limiter/store.ts'), gap,
        tool('Update', 'src/api/limiter.ts'), out('Updated src/api/limiter.ts with 48 additions and 331 removals'), gap,
        tool('Bash', 'npm test -- limiter'), out('Tests: 118 passed, 118 total', 'Time:  9.8 s'), gap,
        said('The limiter is three modules now, and all 118 tests pass. Next: the callers in routes/.'), gap,
        busy('Compacting conversation…', '(50s · esc to interrupt)'),
      ],
      foot: [...promptBox, mode('')],
      prompt: 1,
    },
    landing: {
      top: [
        asked('What does the landing page say today?'), gap,
        tool('Search', 'pattern: "export default", path: "src/landing"'), out('Found 3 files'), gap,
        tool('Read', 'src/landing/features.tsx'), out('Read 121 lines'), gap,
        tool('Read', 'src/landing/pricing.tsx'), out('Read 88 lines'), gap,
        said('Three sections: hero, features and pricing. The hero talks about the company, the features are a list of adjectives, and the third tier of the pricing is behind a link.'), gap,
        asked('Rewrite the three sections of the landing page so each says what the product does.'), gap,
        tool('Read', 'src/landing/hero.tsx'), out('Read 74 lines'), gap,
        tool('Update', 'src/landing/hero.tsx'), out('Updated src/landing/hero.tsx with 14 additions and 9 removals'), gap,
        tool('Update', 'src/landing/features.tsx'), out('Updated src/landing/features.tsx with 22 additions and 17 removals'), gap,
        tool('Update', 'src/landing/pricing.tsx'), out('Updated src/landing/pricing.tsx with 9 additions and 9 removals'), gap,
        tool('Bash', 'npm run build'), out('Built in 41s', '0 errors, 0 warnings'), gap,
        said('All three sections are rewritten and the page builds without errors.'), gap,
        plain('Hero       says what it does in one line'),
        plain('Features   three things it does, each with an example'),
        plain('Pricing    the three tiers, no small print'),
      ],
      foot: [...promptBox, mode('')],
      prompt: 1,
    },
    lighting: {
      top: [
        asked('Open the kitchen scene and tell me how it is lit.'), gap,
        tool('Bash', 'blender -b kitchen.blend -P scripts/list_lights.py'), out('Key 1200 W · Fill 300 W · Window 4.0'), gap,
        tool('Read', 'scenes/lights.md'), out('Read 22 lines'), gap,
        said('Three lights: a key over the counter, a fill by the door and the window. The key carries the picture, and the last render clips on the counter top.'), gap,
        asked('The key light is too hot on the counter. Lower it and render a test frame.'), gap,
        tool('Read', 'scenes/kitchen.py'), out('Read 318 lines'), gap,
        said('The key light is at 1200 W, two metres from the counter. I will bring it down to 800 and warm it a little.'), gap,
        tool('Update', 'scenes/kitchen.py'), out('Updated scenes/kitchen.py with 2 additions and 1 removal'),
        diff(41, '-', 'key.energy = 1200'),
        diff(41, '+', 'key.energy = 800'),
        diff(42, '+', 'key.color = (1.0, 0.94, 0.86)'), gap,
        tool('Bash', 'blender -b kitchen.blend -P scenes/kitchen.py -f 12', true), out('Fra:12 | Sample 96/256 | Remaining 01:42', '+38 lines'), gap,
        said('Frame 12 is rendering at half size. The counter reads two stops lower already.'), gap,
        busy('Rendering…', '(4m 10s · ↓ 18k tokens · esc to interrupt)'),
      ],
      foot: [...promptBox, mode('')],
      prompt: 1,
    },
    turntable: {
      top: [
        asked('How long does one frame of the kitchen take to render?'), gap,
        tool('Bash', 'blender -b kitchen.blend -f 1 -- --samples 64'), out('Fra:1 | Time: 00:38.41 | Saved: out/0001.png'), gap,
        said('About 38 seconds a frame at 64 samples. A full turn of 72 frames comes to about 46 minutes.'), gap,
        asked('Fine, keep 64 samples. Where is the camera?'), gap,
        tool('Read', 'scenes/kitchen.py'), out('Read 318 lines'), gap,
        said('It stands still, facing the counter. For a turntable it has to go round it: a circle at eye height, five degrees a frame.'), gap,
        asked('Write a script that exports a turntable of the kitchen: 72 frames, one every five degrees.'), gap,
        tool('Read', 'scripts/export.py'), out('Read 96 lines'), gap,
        tool('Write', 'scripts/turntable.py'), out('Wrote 64 lines to scripts/turntable.py'), gap,
        tool('Bash', 'blender -b kitchen.blend -P scripts/turntable.py -- --dry-run'), out('72 frames planned, 0 rendered', 'out/turntable/0001.png to 0072.png'), gap,
        said('The script exports 72 frames, one every five degrees. Run it without --dry-run to render them.'), gap,
        plain('Frames     72, five degrees apart'),
        plain('Camera     orbits the counter at eye height'),
        plain('Output     out/turntable/, one PNG a frame'),
      ],
      foot: [...promptBox, mode('')],
      prompt: 1,
    },
    onboarding: {
      top: [
        asked('How many people finish the onboarding?'), gap,
        tool('Read', 'docs/funnel.md'), out('Read 37 lines'), gap,
        said('Of 100 who start, 41 reach the last screen. Most of the others leave on screens two and four.'), gap,
        tool('Search', 'pattern: "onSkip", path: "src/onboarding"'), out('Found 5 lines'), gap,
        said('Every screen has the skip button, and it jumps straight to the end. That part works.'), gap,
        asked('The onboarding has five screens. Cut it to three and keep the skip button.'), gap,
        tool('Read', 'src/onboarding/Flow.tsx'), out('Read 186 lines'), gap,
        said('Screens two and four repeat what the first one says. I will fold them into the welcome screen.'), gap,
        tool('Update', 'src/onboarding/Flow.tsx'), out('Updated src/onboarding/Flow.tsx with 21 additions and 64 removals'), gap,
        tool('Update', 'src/onboarding/Welcome.tsx'), out('Updated src/onboarding/Welcome.tsx with 12 additions and 3 removals'), gap,
        tool('Bash', 'npx expo start --ios'), out('Metro waiting on exp://127.0.0.1:8081', 'iOS Bundled 1482ms'), gap,
        said('Three screens now: welcome, name, done. Checking the skip button on each.'), gap,
        busy('Checking…', '(7m 12s · ↓ 64k tokens · esc to interrupt)'),
      ],
      foot: [...promptBox, mode('')],
      prompt: 1,
    },
    push: {
      top: [
        asked('The settings screen crashes when the name is empty.'), gap,
        tool('Read', 'src/settings/Profile.tsx'), out('Read 142 lines'), gap,
        said('The name is trimmed and its first letter is read. An empty name has none.'), gap,
        tool('Update', 'src/settings/Profile.tsx'), out('Updated src/settings/Profile.tsx with 2 additions and 1 removal'),
        diff(58, '-', 'const initial = name.trim()[0].toUpperCase();'),
        diff(58, '+', 'const shown = name.trim();'),
        diff(59, '+', "const initial = shown ? shown[0].toUpperCase() : '?';"), gap,
        tool('Bash', 'npm test -- settings'), out('Tests: 23 passed, 23 total', 'Time:  2.7 s'), gap,
        said('Fixed. An empty name shows a question mark where the initial goes, and all 23 tests pass.'), gap,
        asked('Add push notifications for new messages.'), gap,
        tool('Read', 'app.json'), out('Read 41 lines'), gap,
        tool('Search', 'pattern: "notification", path: "src"'), out('Found 3 lines'), gap,
        said('Nothing sends them yet. There are two ways to do it, and they differ in what you have to look after.'),
      ],
      foot: [
        rule('╭', '╮'),
        boxed([C.hi, 'Which push service?']),
        boxed(),
        boxed([C.ok, '❯ 1. Expo push'], [C.dim, '  no server keys to look after']),
        boxed(['', '  2. Firebase Cloud Messaging'], [C.dim, '  your own keys, more control']),
        boxed(['', '  3. Type something else']),
        boxed(),
        boxed([C.dim, 'Enter to select · ↑/↓ to navigate · Esc to cancel']),
        rule('╰', '╯'),
      ],
      prompt: -1,
    },
  };
  const screen = screens[kind] || screens.landing;
  let lines = [...screen.top.flat(), [], ...screen.foot];
  if (lines.length > rows) lines = lines.slice(lines.length - rows);
  const at = screen.prompt < 0 ? 0 : lines.length - screen.foot.length + screen.prompt + 1;
  const draw = (parts) => cut(parts, cols - 1).parts.map(([style, text]) => (style ? `\x1b[${style}m${text}\x1b[0m` : text)).join('');
  // a terminal that does not hold the keyboard draws its cursor as an outline; the one that does keeps its bar
  term.options.cursorInactiveStyle = id === Terms.active() ? 'bar' : 'outline';
  term.reset();
  term.write(lines.map(draw).join('\r\n') + (at > 0 ? `\x1b[${at};5H` : '\x1b[?25l'));
  return lines.length;
}

module.exports = async function selfTest({ app, win, dir, engine, chats, watch, writeLink, keptOf, restoreMode, lastEnd, jobLives, serversComeBack, planChat, claudeFlags, settingsNow, trayEnd, reload, code, pathTest, resetNotes, find, record, jev, servers, nest, browser, keeper, float, screens, viewer, work, gaming, notes: noteCards }) {
  fs.mkdirSync(dir, { recursive: true });
  const lines = [];
  const notes = { engine };
  let failed = 0;
  // an error thrown inside the page (in a click handler, in a timer) is reported nowhere else
  const pageErrors = [];
  win.webContents.on('console-message', (event, level, message, line, source) => {
    const d = event && typeof event.message === 'string' ? event : { level, message, lineNumber: line, sourceId: source };
    if (d.level === 'error' || d.level === 3) pageErrors.push(`${d.message} (${path.basename(String(d.sourceId || ''))}:${d.lineNumber})`);
  });
  const flush = () => fs.writeFileSync(path.join(dir, 'report.txt'), lines.join('\n') + '\n');
  const say = (text) => { lines.push(text); flush(); };
  const check = (name, ok, detail = '') => {
    if (!ok) failed++;
    say(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '   ' + detail : ''}`);
    return ok;
  };
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const exec = (code) => win.webContents.executeJavaScript(code, true);
  const inPage = (fn, ...args) => exec(`(${fn})(${args.map((a) => JSON.stringify(a)).join(',')})`);
  const until = async (probe, ms, step = 150) => {
    const end = Date.now() + ms;
    for (;;) {
      const value = await probe();
      if (value) return value;
      if (Date.now() > end) return null;
      await wait(step);
    }
  };
  const screen = () => inPage(pageScreen);
  const linesOf = (id) => inPage(pageLinesOf, id);
  const type = (text) => exec(`term.input(${JSON.stringify(text)}, true)`);
  const view = (id) => exec(`Desk.setView(${JSON.stringify(id)})`);
  // going into a chat (a switch of workspace puts one in front) or leaving one in the reader counts as seeing what it
  // waits for, which then counts no more: the checks about how workspaces count waits make them unseen again first
  const unsee = () => exec('Desk.state.seenWaits.clear(); Desk.paint(); true');
  // a picture is taken only once the page has drawn what was just changed (two frames, or a quarter of a second if none come)
  const drawn = () => exec('Promise.race([new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r("frames")))), new Promise((r) => setTimeout(() => r("timer"), 250))])');
  const shoot = async (name, keepToast) => {
    // the window's cards come and go on a timer: a picture is of what is under them
    if (!keepToast) await exec('Cards.clear(); document.getElementById("toast").hidden = true');
    await drawn();
    // A hidden window hands back the frame it last drew, which can be the one from before the change. Asking once
    // makes it draw; the second answer is the picture.
    await win.webContents.capturePage();
    await wait(150);
    fs.writeFileSync(path.join(dir, `${name}.png`), (await win.webContents.capturePage()).toPNG());
  };
  const keep = async (name) => fs.writeFileSync(path.join(dir, `${name}.txt`), (await screen()).join('\n') + '\n');
  const settle = async (quietMs, maxMs) => {
    const end = Date.now() + maxMs;
    let last = '';
    let since = Date.now();
    while (Date.now() < end) {
      const now = (await screen()).join('\n');
      if (now !== last) { last = now; since = Date.now(); }
      else if (Date.now() - since >= quietMs) return true;
      await wait(200);
    }
    return false;
  };
  const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
  // as in chats.cjs: a program the watcher starts meanwhile can hold the output pipe open, so the wait is cut short
  const childrenNamed = (parentPid, name) => {
    const r = spawnSync('powershell.exe', ['-NoProfile', '-Command',
      `(Get-CimInstance Win32_Process -Filter "ParentProcessId=${Number(parentPid)}" | Where-Object { $_.Name -eq '${name}' }).ProcessId`],
      { encoding: 'utf8', windowsHide: true, timeout: 20000 });
    return r.status === 0 && typeof r.stdout === 'string' ? r.stdout.split(/\s+/).filter(Boolean).map(Number) : [];
  };
  const memory = () => {
    const byKind = {};
    let working = 0;
    let priv = 0;
    for (const m of app.getAppMetrics()) {
      const mb = Math.round(m.memory.workingSetSize / 1024);
      byKind[m.type] = (byKind[m.type] || 0) + mb;
      working += m.memory.workingSetSize;
      priv += m.memory.privateBytes || 0;
    }
    return { processes: app.getAppMetrics().length, workingMb: Math.round(working / 1024), privateMb: Math.round(priv / 1024), byKind };
  };
  const pageMemory = () => {
    const pid = win.webContents.getOSProcessId();
    const m = app.getAppMetrics().find((x) => x.pid === pid);
    return m ? { workingMb: m.memory.workingSetSize / 1024, privateMb: (m.memory.privateBytes || 0) / 1024 } : null;
  };
  const promptBack = async () => {
    const rows = (await screen()).filter((l) => l.trim());
    return rows.length > 0 && /^PS .*>\s*$/.test(rows[rows.length - 1]);
  };

  const report = async (when) => {
    const m = memory();
    const w = await watch.ask('stats');
    say(`      memory ${when}: ${m.workingMb} MB in use (${m.privateMb} MB private) over ${m.processes} processes ${JSON.stringify(m.byKind)}`
      + (w ? `; the watcher thread holds ${w.heapUsedMb} MB (${w.heapTotalMb} MB set aside, ${w.outsideHeapMb} MB of buffers) for ${w.sessions} sessions and ${w.agents} subagent files` : ''));
    return { ...m, watcher: w };
  };
  const typing = process.env.DESK_SELFTEST_TYPE === '1';
  const closing = process.env.DESK_SELFTEST_CLOSE || '';
  const agent = { pid: 0, sessionId: '', firstFrameAt: 0, chat: '' };
  const agentUp = () => agent.pid > 0 && alive(agent.pid);
  const folder = path.resolve(__dirname, '..');
  const plain = { cwd: folder, starter: 'shell' };

  // What the Perch hook, when installed, recorded for this session.
  const hookDir = path.join(process.env.LOCALAPPDATA || '', 'AgentFocus');
  const hookLog = path.join(hookDir, 'hook-timing.log');
  const hookRecord = () => {
    const statusDir = path.join(hookDir, 'status');
    for (const name of fs.existsSync(statusDir) ? fs.readdirSync(statusDir) : []) {
      if (!name.endsWith('.json')) continue;
      try {
        // a status file may start with a byte-order mark, which JSON.parse refuses
        const text = fs.readFileSync(path.join(statusDir, name), 'utf8');
        const r = JSON.parse(text.charCodeAt(0) === 0xFEFF ? text.slice(1) : text);
        if (Number(r.agent_pid) === agent.pid) {
          return {
            status: r.status,
            headless: Boolean(r.headless),
            window: r.window ? { tab_name: r.window.tab_name, captured_event: r.window.captured_event } : null,
          };
        }
      } catch { /* a file mid-write: the next poll reads it whole */ }
    }
    return null;
  };
  const hookLogged = (event) => {
    if (!agent.sessionId) return false;
    try {
      return fs.readFileSync(hookLog, 'utf8').includes(` ${event} ${agent.sessionId.slice(0, 8)} `);
    } catch { return false; }
  };

  // What Claude Code itself keeps: one file per running session, and three
  // machine-wide notes about fullscreen starts (still pending, failed, turned off).
  const sessionsDir = path.join(os.homedir(), '.claude', 'sessions');
  const liveFile = () => path.join(sessionsDir, `${agent.pid}.json`);
  // A computer Claude Code never ran on keeps neither a login nor a conversation. There the app has nothing to
  // find, and the checks about what it finds on the machine expect that instead of failing. Presence only is read.
  const loginOnDisk = () => {
    try { return Boolean(JSON.parse(fs.readFileSync(path.join(os.homedir(), '.claude.json'), 'utf8')).oauthAccount); } catch { return false; }
  };
  const keptOnDisk = () => {
    const root = path.join(os.homedir(), '.claude', 'projects');
    const holds = (d) => { try { return fs.readdirSync(path.join(root, d)).some((f) => f.endsWith('.jsonl')); } catch { return false; } };
    try { return fs.readdirSync(root).some(holds); } catch { return false; }
  };
  const fullscreenNotes = () => {
    try {
      const d = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.claude.json'), 'utf8'));
      return {
        pending: Object.keys(d.fullscreenBootPending || {}),
        failedStarts: d.fullscreenBootStrikes ? d.fullscreenBootStrikes.count : 0,
        turnedOff: Boolean(d.fullscreenAutoDisabled),
      };
    } catch { return null; }
  };
  // The sign that the agent ended its session itself instead of being cut off:
  // it removed its own live-session file. Whether it then ran its end-of-session
  // scripts is the CLI's own decision (an orderly /exit has been seen to skip
  // them), so that is checked under its own name and never read as a cut-off.
  const endedItself = async () => {
    const fileGone = Boolean(await until(async () => !fs.existsSync(liveFile()), 8000, 200));
    const hookRan = agent.sessionId && fs.existsSync(hookLog)
      ? Boolean(await until(async () => hookLogged('SessionEnd'), 8000, 300))
      : null;
    return { fileGone, hookRan };
  };
  const endScripts = (end) => {
    if (end.hookRan === null) say('      no end-of-session hook is installed, so nothing to see there');
    else check('the CLI ran its end-of-session scripts', end.hookRan, end.hookRan ? '' : 'the Perch hook left no "session ended" line for this session');
  };
  /** The interactive sessions alive right now, counted straight from the CLI's own files: a second way to the dashboard's number. */
  const liveSessions = () => {
    const recs = [];
    for (const name of fs.existsSync(sessionsDir) ? fs.readdirSync(sessionsDir) : []) {
      if (!/^\d+\.json$/.test(name)) continue;
      try {
        const rec = JSON.parse(fs.readFileSync(path.join(sessionsDir, name), 'utf8'));
        if (alive(Number(name.slice(0, -5)))) recs.push(rec);
      } catch { /* mid-write */ }
    }
    // A terminal that handed its conversation to a background session counts as that session while its job is on disk
    // and still runs or has not finished (done or stopped, unless it waits for the person). Only state and tempo are read.
    const runs = new Set(recs.map((r) => r.jobId).filter(Boolean));
    const handed = (id) => {
      if (!id) return false;
      let job = null;
      try { job = JSON.parse(fs.readFileSync(path.join(path.dirname(sessionsDir), 'jobs', id, 'state.json'), 'utf8')); } catch { return false; }
      const ended = (job.state === 'done' || job.state === 'stopped') && job.tempo !== 'blocked';
      return runs.has(id) || !ended;
    };
    return recs.filter((r) => r.kind !== 'bg' && !handed(r.parkedJobId)).length;
  };
  const shownSessions = () => watch.latest().chats.filter((c) => c.provider === 'claude' && c.kind === 'interactive' && c.pid).length;

  // ---- the start: every chat on the machine in the list, before this window has a chat of its own ----
  const KINDS = ['ask', 'say', 'think', 'tool', 'cmd', 'stop', 'turn', 'compact', 'summary', 'recap', 'note', 'fail'];
  // the groups of the list on the left, in the order they stand
  const GROUP_ORDER = ['needs', 'done', 'working', 'idle', 'old', 'ended'];
  const inOrder = (order) => order.every((g, i) => GROUP_ORDER.includes(g) && (i === 0 || GROUP_ORDER.indexOf(g) > GROUP_ORDER.indexOf(order[i - 1])));
  /** What the start page offers, going by the watcher's own picture: the chats that run in other terminals can be moved here. */
  const startButtons = () => {
    const n = watch.latest().chats.filter((c) => c.provider === 'claude' && c.pid && c.session && c.kind !== 'bg').length;
    return n > 1 ? ['New chat', `Bring all ${n} here`, 'History'] : n === 1 ? ['New chat', 'Bring it here', 'History'] : ['New chat', 'History'];
  };
  const START = 'No chat is open in this window';
  const startPhase = async () => {
    const started = Date.now();
    check('the window loads', Boolean(await until(() => exec('typeof Desk === "object" && Desk !== null'), 15000)));
    const first = await until(async () => watch.latest().at > 0 && watch.latest(), 20000);
    check('the watcher delivers its first picture of the machine', Boolean(first), `${Date.now() - started} ms after launch`);
    const sameCount = await until(async () => liveSessions() === shownSessions(), 8000, 500);
    check('every live Claude Code session is in that picture', Boolean(sameCount),
      `${shownSessions()} in the picture, ${liveSessions()} counted from the CLI's own session files`);
    // the list on the left: every chat on the machine once, by what it wants from the person
    const seen = await until(async () => { const n = watch.latest().chats.length; const l = await inPage(pageList); return l.rows === n ? { l, n } : null; }, 6000, 300);
    const list = seen ? seen.l : await inPage(pageList);
    const pictured = seen ? seen.n : watch.latest().chats.length;
    notes.list = list;
    check('the list on the left holds every chat on this machine once, in groups, with none of them picked',
      list.view === 'peek' && list.rows === pictured && list.here === 0 && list.away === pictured && list.picked === 0 && inOrder(list.order)
      && Number(list.total || 0) === pictured - (list.groups.old || 0),
      `${list.rows} rows for ${pictured} sessions ${JSON.stringify(list.groups)}; the count above the list says ${list.total || 0}`);
    check('nothing in the list runs off its side', !list.overflow);
    // with no chat open here and none picked, the panel is the start page: no figure stands on it, they all live on the Dashboard
    const start = await until(async () => { const p = await inPage(pagePeek); return same(p.buttons, startButtons()) ? p : null; }, 6000, 300) || await inPage(pagePeek);
    check('with no chat open here the window starts on a page that says so and offers the ways to begin, without a single figure on it',
      start.view === 'peek' && !start.hidden && start.start === START && !start.pane && same(start.buttons, startButtons()) && start.figures === 0,
      `"${start.start}"; it offers: ${start.buttons.join(' / ')}; figures on the main screen: ${start.figures}`);
    const accounts = watch.latest().accounts;
    const cardNow = () => inPage(() => ({ said: (document.querySelector('#acct .acct-name') || {}).textContent || '', limits: document.querySelectorAll('#acct .slim').length }));
    // where Claude Code is not logged in there is no account to find: then none is listed, and the card under the list says so
    const nobodyOnDisk = !loginOnDisk() && Boolean(accounts) && accounts.list.length === 0 && !accounts.current;
    const card = (nobodyOnDisk && await until(async () => { const c = await cardNow(); return c.said === 'Not logged in' ? c : null; }, 4000, 200)) || await cardNow();
    const nobody = nobodyOnDisk && card.said === 'Not logged in' && card.limits === 0;
    check('the accounts Claude Code logs in to on this machine are found by the app itself, and the one in use is named under the list with its two limits',
      nobody || (Boolean(accounts) && accounts.list.length > 0 && (accounts.current ? Boolean(card.said) && accounts.list[0].here && card.limits === 2 : true)),
      nobody ? 'Claude Code is not logged in on this computer: no account is listed, and the card under the list says "Not logged in"'
        : accounts ? `${accounts.list.length} known, ${accounts.list.filter((a) => a.email).length} with a name on disk, ${accounts.marks.length} changes of account on record, ${accounts.current ? 'one is logged in' : 'none is logged in'}; limits known for ${accounts.list.filter((a) => a.five || a.week).length}` : 'the picture holds no accounts');

    // What the real sessions hold on this computer, as the watcher's helper measures it. Numbers only: no name of a session or of a program is written down.
    const running = () => watch.latest().chats.filter((c) => c.pid);
    const measured = await until(async () => {
      const r = await exec('Desk.state.res');
      return r && r.all && running().every((c) => r.sessions[c.key]) ? r : null;
    }, 20000, 300);
    await wait(300);
    const resSeen = await inPage(() => {
      const figure = /^(<1 MB|\d+ MB|\d+(\.\d)? GB)$/;
      const told = /\n\nThis session holds (<1 MB|\d+ MB|\d+(\.\d)? GB) of RAM in \d+ programs?/;
      const res = Desk.state.res;
      const rows = [...document.querySelectorAll('#chat-list .nav-item.chat:not(.k-ended)')].filter((el) => res && res.sessions[el.dataset.key]);
      // a row shows its RAM on its second line only once that is 1 GB or more; every row's note says it
      const ending = rows.filter((el) => { const x = el.querySelector('.m-ram'); return x && !x.hidden; });
      return { measured: rows.length, told: rows.filter((el) => told.test(el.dataset.tip || '')).length,
        figures: ending.length, wellFormed: ending.filter((el) => figure.test(el.querySelector('.m-ram').textContent) && / GB$/.test(el.querySelector('.m-ram').textContent)).length };
    });
    const sessionsMeasured = measured ? Object.keys(measured.sessions).length : 0;
    const partsAddUp = measured ? Object.values(measured.sessions).filter((s) => Math.abs(s.own.mem + s.items.reduce((a, x) => a + x.mem, 0) + (s.more ? s.more.mem : 0) - s.mem) > 1024).length : -1;
    check('what every running session holds on this computer is measured, and its row says so: in its hover note, and on its second line once it is 1 GB or more',
      Boolean(measured) && sessionsMeasured >= running().length && resSeen.measured >= running().length && resSeen.told === resSeen.measured && resSeen.wellFormed === resSeen.figures && partsAddUp === 0,
      measured ? `${sessionsMeasured} sessions measured for ${running().length} running; ${resSeen.told} rows tell it in their note, ${resSeen.figures} of them hold 1 GB or more and show it; parts that do not add up to their session: ${partsAddUp}` : await (async () => {
        const r = await exec('Desk.state.res');
        const missing = running().filter((c) => !(r && r.sessions && r.sessions[c.key]));
        return `no measurement arrived in 20 s: ${missing.length} of ${running().length} running sessions never measured`
          + ` (${missing.map((c) => `${c.provider} ${c.kind} ${c.state}, program ${alive(c.pid) ? 'alive' : 'gone'}`).join('; ')}); ${r ? `the last measurement covers ${Object.keys(r.sessions || {}).length}` : 'no measurement at all'}`;
      })());

    // the Dashboard is where every figure lives: it opens with what is running now
    await view('stats');
    await wait(400);
    const dash = await inPage(() => {
      const sec = document.querySelector('#stats .run-sec');
      const text = (sel) => (sec.querySelector(sel) || {}).textContent || '';
      const res = Desk.state.res;
      return {
        shown: !sec.hidden, title: text('.sec-head h3'), note: text('.sec-head .note'), app: text('.run-app'),
        listed: sec.querySelectorAll('.run-row[role="button"]').length, rest: sec.querySelectorAll('.run-row.rest').length,
        known: res ? Desk.state.snap.chats.filter((c) => res.sessions[c.key]).length : 0,
        feedTitle: (document.querySelector('#stats .feed-sec .sec-head h3') || {}).textContent || '',
        feed: document.querySelectorAll('#stats .feed-sec .feed-row').length, quiet: Boolean(document.querySelector('#stats .feed-sec > p.quiet:not(.cost-line)')),
        first: [...document.querySelectorAll('#stats .sec.block:not([hidden])')].slice(0, 2).map((x) => x.className),
        // the bars come before every part: one per session of the list (the old background ones left out)
        bars: document.querySelectorAll('#stats .bars-sec .cbar').length,
        top: [...document.querySelectorAll('#stats .d-wrap > .sec:not([hidden])')].map((x) => x.className)[0] || '',
        sessions: Desk.state.snap.chats.filter((c) => !(c.kind === 'bg' && !c.pid && Date.now() - c.at > 3 * 86400e3)
          && !(c.chat && Desk.state.chats.some((x) => x.id === c.chat && x.closing))).length,
      };
    });
    // with no chat on the computer the two parts about the chats have nothing to show, and stay away
    check('the Dashboard opens with one bar per chat, above every other part',
      dash.sessions ? /bars-sec/.test(dash.top) && dash.bars === dash.sessions : dash.bars === 0 && !/bars-sec/.test(dash.top),
      dash.sessions ? `${dash.bars} bars for ${dash.sessions} sessions` : 'no chat on this computer: no bar, and their part is not shown');
    const feedThere = dash.feedTitle === 'Happening now' && (dash.feed > 0 || dash.quiet) && !(await inPage(pageSpill, 'stats'));
    const noneRuns = running().length === 0;
    check('the Dashboard opens with what the sessions hold on this computer, the heaviest first, and with what each is doing right now',
      noneRuns
        ? !dash.shown && feedThere && /feed-sec/.test(dash.first[0] || '')
        : dash.shown && dash.title === 'On this computer' && dash.listed === Math.min(12, dash.known) && dash.rest === (dash.known > 12 ? 1 : 0)
          && /^(\d+ MB|\d+(\.\d)? GB) of \d+ GB RAM/.test(dash.note) && /^Lowlit itself holds (\d+ MB|\d+(\.\d)? GB) of RAM/.test(dash.app)
          && feedThere && /run-sec/.test(dash.first[0] || '') && /feed-sec/.test(dash.first[1] || ''),
      noneRuns ? `no session runs on this computer: that part is not shown, and "Happening now" says ${dash.quiet ? 'that no tool was run' : `${dash.feed} tool calls`}`
        : `${dash.listed} of ${dash.known} measured sessions listed; "${dash.note}"; "${dash.app}"; ${dash.feed} tool calls in the feed`);
    const meterReal = await inPage(() => { const m = document.getElementById('side-meter'); return m && !m.hidden ? m.querySelector('.mt-top').textContent : ''; });
    const keeperHeld = await exec('Desk.state.res && Desk.state.res.app ? Desk.state.res.app.keeper : -1');
    check('the foot of the list says what all of Lowlit takes on this computer, as measured, the keeper of its consoles counted in',
      /^Lowlit(\d+ MB|\d+(\.\d)? GB)/.test(meterReal) && keeperHeld > 0, `${meterReal}; the keeper holds ${Math.round(keeperHeld / MB)} MB`);
    // the refresh button: everything is read again at once, and the processor share is known from the second look on
    const lookedAt = watch.latest().at;
    const resAt = measured ? measured.at : 0;
    await exec('document.getElementById("refresh").click()');
    const spun = await exec('document.getElementById("refresh").classList.contains("spin")');
    // (with no session to take a share of the processor, the app's own share is the figure that must be known by then)
    const again = await until(async () => {
      const r = await exec('Desk.state.res');
      return r && r.at > resAt && (r.all.sessions ? r.all.cpu !== null : Boolean(r.app) && r.app.cpu !== null) ? r : null;
    }, 8000, 150);
    const lookedAgain = await until(async () => /^Looked again just now\./.test(await exec('document.getElementById("toast").textContent')), 6000, 150);
    check('the refresh button reads everything again at once, and says so',
      spun && Boolean(again) && Boolean(lookedAgain) && watch.latest().at >= lookedAt && !(await exec('document.getElementById("refresh").classList.contains("spin")')),
      !again ? 'no new measurement' : `a new measurement ${again.at - resAt} ms after the first; ${again.all.sessions
        ? `all sessions together: ${Math.round(again.all.mem / 1048576)} MB in ${again.all.n} programs, ${again.all.cpu}% of the processor`
        : `no session runs on this computer; the app itself: ${again.app.cpu}% of the processor`}`);
    await view('peek');
    await wait(200);
    await shoot('1-start');

    // One real conversation, read the way the app reads it. Only counts and kinds are kept: never a word of it, and no picture.
    // (one that has said or been asked something: a session nobody has typed in yet has no file to read)
    const one = watch.latest().chats.filter((c) => c.provider === 'claude' && c.session && c.pid && c.kind !== 'bg' && (c.words || c.prompt)).sort((a, b) => b.at - a.at)[0];
    if (!one) {
      say('      no Claude Code session with a conversation is running: reading a real one was not checked');
    } else {
      const t0 = Date.now();
      const page = await watch.ask('read', { key: one.key, agent: '', before: 0 });
      const kinds = {};
      for (const it of page ? page.items : []) kinds[it.k] = (kinds[it.k] || 0) + 1;
      check('a page of a real conversation is read from the end of its file', Boolean(page) && page.to <= page.size && page.from < page.to && Array.isArray(page.replies)
        && page.items.length > 0 && Object.keys(kinds).every((k) => KINDS.includes(k)),
        page ? `${Date.now() - t0} ms for the last ${Math.round((page.to - page.from) / 1024)} KB of ${Math.round(page.size / 1048576)} MB: ${page.items.length} things in it ${JSON.stringify(kinds)}, ${page.replies.length} replies, ${Object.keys(page.orphans).length} results whose call is further back` : 'no answer');
      // picked with a click in the list, it takes the panel; the conversation and the files it changed are laid out
      await pick(one.key);
      await wait(250);
      const picked = await inPage(pageList);
      const pane = await inPage(pageDetail, 'peek');
      check('a click on a chat that runs elsewhere shows it across the panel', picked.picked === 1 && picked.sel === one.key && pane.shown && pane.tabs.length >= 3 && pane.tabs[0] === 'Overview*' && !(await inPage(pageSpill, 'peek')),
        `tabs: ${pane.tabs.join(', ')}; ${pane.heads.length} parts in its overview; button "${pane.button}"`);
      await exec('Desk.Peek.detail().setTab("conv")');
      const ready = await until(() => exec('Desk.Peek.detail().reader.state() === "ready"'), 12000);
      await wait(200);
      const read = await inPage(pageReader, 'peek');
      await exec('Desk.Peek.detail().setTab("changes")');
      await wait(200);
      const changed = await exec(`({ files: document.querySelectorAll('#peek .chg-file').length, sum: Boolean((document.querySelector('#peek .chg-sum') || {}).textContent) })`);
      check('its conversation is laid out to be read, and the files it changed are listed', Boolean(ready) && read.asks + read.says + read.tools > 0 && changed.sum && !(await inPage(pageSpill, 'peek')),
        `on screen: ${read.asks} asked, ${read.says} said, ${read.tools} tool calls (${read.failed} failed, ${read.running} running), ${read.thoughts} thoughts, ${read.turns} turn ends, ${read.marks + read.notes} marks, ${read.tables} tables, ${read.code} code blocks; ${changed.files} files changed in the part read`);
      await exec('Desk.Peek.detail().setTab("overview")');
      await inPage(pageKey, 'Escape');
      await wait(150);
      const after = await inPage(pagePeek);
      check('Esc leaves it, and the start page is back', !after.pane && after.start === START && (await inPage(pageList)).picked === 0);
    }

    // every conversation kept on this machine, as the History view will list them (shapes only)
    const t1 = Date.now();
    const kept = await watch.ask('history');
    const fields = ['id', 'project', 'cwd', 'title', 'name', 'prompt', 'mode', 'at', 'first', 'size', 'model', 'out', 'replies', 'tools', 'compacts', 'agents', 'usd', 'added', 'removed', 'counted', 'live'];
    // (where Claude Code keeps no conversation there is none to list, and no folder of one to offer)
    const noneKept = !keptOnDisk();
    check('the watcher lists every conversation kept on this machine, newest first', Boolean(kept) && Array.isArray(kept.list) && kept.total >= kept.list.length
      && (kept.list.length > 0 ? fields.every((k) => k in kept.list[0]) && kept.list.every((r, i) => i === 0 || r.at <= kept.list[i - 1].at) : noneKept),
      kept ? `${kept.total} conversations, ${(kept.bytes / 1073741824).toFixed(1)} GB with their subagents, ${kept.list.length} listed, ${kept.list.filter((r) => r.live).length} of them running; ${Date.now() - t1} ms${
        kept.list.length ? '' : noneKept ? ' (Claude Code keeps none on this computer)' : ' (Claude Code keeps some on this computer)'}` : 'no answer');

    const picker = await inPage(pagePicker);
    notes.picker = picker;
    check('the New chat panel lists ways to start and folders', picker.open && picker.starters.length >= 2 && picker.starters.some((s) => s.endsWith('*')) && (picker.folders > 0 || noneKept),
      `start with: ${picker.starters.join(', ')}; ${picker.folders} folders; ${picker.recent} past conversations`);
    await shoot('1-new-chat');
    await exec('Picker.close()');
    const looks = watch.took();
    say(`      watcher: first look ${looks[0]} ms, later looks ${looks.slice(1).join(', ') || '(none yet)'} ms`);
    // the watcher thread dies: it is started again and the list carries on
    const stoppedAt = Date.now();
    const chatsBefore = watch.latest().chats.length;
    watch.kill();
    const back = await until(async () => watch.latest().at > stoppedAt && (watch.latest().chats.length > 0 || chatsBefore === 0), 12000, 200);
    check('a watcher that dies is started again by itself', Boolean(back), `a new picture of the machine ${Date.now() - stoppedAt} ms after it was stopped`);
    watch.post({ type: 'pace', ms: 2000 });
    const limits = watch.latest().plan;
    say(`      usage limits as Claude Code last reported them: ${limits ? ['five', 'week'].filter((k) => limits[k]).map((k) => `${k} ${limits[k].used}% (reported ${Math.round((Date.now() - limits[k].at) / 1000)} s ago)`).join(', ') : 'none found'}`);
  };

  // ---- made-up sessions and made-up numbers: the real ones rarely show every state at once, and a test run counts nothing ----
  let madeAt = Date.now();
  const beats = (seed, busy) => Array.from({ length: 30 }, (_, i) => (busy && (i * 7 + seed) % 5 !== 0 ? 1 + ((i * 13 + seed) % 6) : (i + seed) % 11 === 0 ? 1 : 0));
  const row = (over) => ({
    session: over.key, provider: 'claude', pid: 1, name: '', named: false, title: '', cwd: 'D:\\work\\shop', kind: 'interactive',
    state: 'idle', waiting: '', background: false, since: madeAt - 90e3, at: madeAt - 20e3, started: madeAt - 6 * 3600e3, words: '', prompt: '', doing: null, turn: null,
    agents: { total: 0, running: 0, list: [] }, tokens: { in: 41200, out: 388000, cacheWrite: 2140000, cacheRead: 61300000, tools: 214, share: 1 },
    today: { in: 9100, out: 121000, cacheWrite: 610000, cacheRead: 18400000, replies: 96, work: 47 * 60e3, asked: 7, tools: 141, agents: 0 },
    pulse: beats(over.key.length, over.state === 'working' || over.state === 'compacting'),
    context: 184000, ceiling: 467000, ceilingOwn: true, compacts: 2, limit: null, recap: '', recapAt: 0, queued: 0, cost: null, live: null,
    model: 'claude-opus-5-5', effort: 'max', mode: 'bypassPermissions', job: '', chat: '', ...over,
  });
  const agentRow = (over) => ({
    id: over.name, what: '', type: 'general-purpose', team: '', model: 'claude-opus-5-5', depth: 0, parent: '', state: 'working',
    doing: null, said: '', tools: 12, out: 18400, started: madeAt - 400e3, at: madeAt - 4e3, ...over,
  });
  const tool = (name, what, secondsAgo, lasted) => ({ name, what, at: madeAt - secondsAgo * 1000, done: lasted ? madeAt - secondsAgo * 1000 + lasted * 1000 : 0 });
  /** A session in the middle of a long turn, with subagents: the busiest a row gets. */
  const busyRow = (over) => row({ key: 's-agents', title: 'Pricing research', cwd: 'D:\\work\\pricing', state: 'working', since: madeAt - 11 * 60e3,
    prompt: 'Compare our prices against the five closest competitors and tell me where we are out of line.',
    words: 'Three of the five are in. Waiting on the last two before I build the table.',
    doing: tool('Agent', 'Compare competitor D', 75, 0),
    turn: { start: madeAt - 11 * 60e3, end: 0, ms: 0, count: 23, tools: [tool('WebSearch', 'competitor pricing pages 2026', 300, 4), tool('Read', 'plans.md', 280, 1),
      tool('Agent', 'Compare competitor A', 260, 170), tool('Agent', 'Compare competitor D', 75, 0), tool('Agent', 'Compare competitor E', 74, 0)] },
    agents: { total: 7, running: 3, list: [
      agentRow({ name: 'competitor-d', what: 'Compare competitor D', doing: tool('WebFetch', 'competitor-d.example', 6, 0) }),
      agentRow({ name: 'price-table', what: 'Read their plans page', depth: 1, parent: 'competitor-d', doing: tool('Read', 'plans.html', 3, 0), tools: 4, out: 2100 }),
      agentRow({ name: 'competitor-e', what: 'Compare competitor E', doing: null, said: 'Found the monthly plans; looking for the yearly ones.' }),
      agentRow({ name: 'competitor-a', what: 'Compare competitor A', state: 'done', said: 'Competitor A charges 29 a month for the same tier, 17% under us.', at: madeAt - 90e3, tools: 31, out: 44100 }),
    ] },
    tokens: { in: 9000, out: 120000, cacheWrite: 800000, cacheRead: 9400000, tools: 88, share: 0.42 },
    today: { in: 9100, out: 121000, cacheWrite: 610000, cacheRead: 18400000, replies: 96, work: 47 * 60e3, asked: 7, tools: 141, agents: 7 },
    context: 402000, queued: 2, recap: 'You asked for a price comparison. Competitors A, B and C are done: A is 17% under us, B and C are level.', recapAt: madeAt - 20 * 60e3,
    cost: { usd: 12.4, added: 1204, removed: 310, apiMs: 0, toolMs: 0, at: madeAt - 3600e3 },
    live: { usd: 41.8, added: 1204, removed: 310, warm: true, cacheUntil: madeAt + 52 * 60e3, cacheCold: 402000, cacheHit: 0.97 }, ...over });
  const madeUpRows = (flip) => [
    row({ key: 's-permission', title: 'Checkout page rebuild', state: 'attention', waiting: 'permission prompt', since: madeAt - 40e3, context: 448000,
      words: 'Ready to deploy. I need your go-ahead to run the release command.', doing: tool('Bash', 'Deploy the site to production', 40, 0),
      // waiting on the person while its cache runs out: answered late, the next message reads the whole conversation afresh
      live: { usd: 18.2, added: 412, removed: 96, warm: true, cacheUntil: madeAt + 4 * 60e3, cacheCold: 448000, cacheHit: 0.96 } }),
    busyRow({}),
    // says it is working, and wrote nothing for six minutes
    row({ key: 's-words', title: 'Invoice export bug', state: 'working', since: madeAt - 9 * 60e3, at: madeAt - 6 * 60e3 - 20e3, words: 'The export skips rows with an empty tax field. Writing the fix now.', context: 96000,
      live: { usd: 6.4, added: 58, removed: 12, warm: true, cacheUntil: madeAt + 31 * 60e3, cacheCold: 96000, cacheHit: 0.93 } }),
    // today's part of its conversation has not been read to the end yet
    row({ key: 's-compact', title: 'Long refactor', state: 'compacting', since: madeAt - 50e3, context: 466000, compacts: 9,
      today: { in: 0, out: 0, cacheWrite: 0, cacheRead: 0, replies: 0, work: 0, asked: 0, tools: 0, agents: 0, whole: false } }),
    row({ key: 's-error', title: 'Nightly report', state: 'error', since: madeAt - 8 * 60e3, words: "You've hit your limit. It resets at the top of the hour.",
      limit: { type: 'five_hour', until: madeAt + 42 * 60e3 } }),
    row({ key: 's-finish', title: 'Landing page copy', state: flip ? 'idle' : 'working', since: madeAt - 30e3,
      words: 'All three sections are rewritten and the page builds without errors.',
      turn: { start: madeAt - 9 * 60e3, end: flip ? madeAt - 30e3 : 0, ms: flip ? 510000 : 0, count: 2, tools: [tool('Edit', 'hero.tsx', 400, 2), tool('Bash', 'Build the site', 300, 41)] } }),
    row({ key: 's-idle', title: 'Old notes', state: 'idle', since: madeAt - 5 * 3600e3, at: madeAt - 5 * 3600e3, words: 'Done. The notes are in the docs folder.', ceiling: 0, ceilingOwn: false, compacts: 0,
      live: { usd: 3.1, added: 0, removed: 0, warm: false, cacheUntil: madeAt - 4 * 3600e3, cacheCold: 184000, cacheHit: 0.9 } }),
    row({ key: 'job:abc12345', pid: 0, name: 'Weekly numbers', named: true, kind: 'bg', state: 'attention', waiting: 'blocked', job: 'abc12345',
      since: madeAt - 3600e3, at: madeAt - 3600e3, words: 'Which week should the report start from?', tokens: null, today: null, pulse: null, model: '', mode: '', context: 0 }),
    row({ key: 'codex:x', provider: 'codex', title: '', cwd: 'D:\\work\\api', state: 'working', tokens: null, today: null, pulse: null, model: 'gpt-6', mode: '', effort: '', context: 0 }),
  ];
  /** What the watcher would answer when asked for the sums, with numbers that look like a busy month. */
  const madeUpUsage = (range) => {
    const pad = (n) => String(n).padStart(2, '0');
    const dayOf = (i) => { const d = new Date(madeAt - (29 - i) * 86400e3); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
    const wave = (i, n) => 0.35 + 0.65 * Math.abs(Math.sin(i * 1.7 + n));
    const hourNow = new Date(madeAt).getHours();
    const hours = Array.from({ length: 48 }, (_, i) => {
      const hr = i % 24;
      const k = i >= 24 && hr > hourNow ? 0 : Math.max(0, Math.sin(((hr - 6) / 18) * Math.PI)) * wave(i, 2) * (i < 24 ? 0.84 : 1);
      return { in: Math.round(k * 3000), out: Math.round(k * 780000), cacheWrite: Math.round(k * 2.4e6), cacheRead: Math.round(k * 150e6), replies: Math.round(k * 410), work: Math.round(k * 3.6 * 3600e3),
        usd: Math.round(k * 7400) / 100 };
    });
    const sumOf = (list, key) => list.reduce((n, x) => n + x[key], 0);
    const days = Array.from({ length: 30 }, (_, i) => {
      const k = wave(i, 1) * (i % 7 === 5 ? 0.3 : 1);
      return { day: dayOf(i), in: Math.round(k * 42000), out: Math.round(k * 9.8e6), cacheWrite: Math.round(k * 31e6), cacheRead: Math.round(k * 1.9e9), replies: Math.round(k * 5200),
        work: Math.round(k * 46 * 3600e3), asked: Math.round(k * 190), tools: Math.round(k * 7400), agents: Math.round(k * 120), think: Math.round(k * 6.1e6), web: Math.round(k * 40),
        comp: Math.round(k * 22), compMs: Math.round(k * 22 * 150e3), err: Math.round(k * 6), lim: i % 9 === 0 ? 1 : 0, usd: Math.round(k * 92000) / 100, unpriced: Math.round(k * 210000) };
    });
    // today is what its hours add up to, so the strip and the chart agree
    const today = hours.slice(24);
    Object.assign(days[29], { in: sumOf(today, 'in'), out: sumOf(today, 'out'), cacheWrite: sumOf(today, 'cacheWrite'), cacheRead: sumOf(today, 'cacheRead'), replies: sumOf(today, 'replies'), work: sumOf(today, 'work'),
      usd: sumOf(today, 'usd') });
    const span = range === '30d' ? 30 : range === '7d' ? 7 : 1;
    const total = {};
    for (const key of Object.keys(days[0])) if (key !== 'day') total[key] = sumOf(days.slice(-span), key);
    // which account wrote each day's tokens: the one in use now for the last two days, two others before that, and a stretch nobody can speak for
    const holders = ['aaaa1111', 'bbbb2222', 'cccc3333', '?'];
    const weights = (i) => (i >= 28 ? [0.8, 0.2, 0, 0] : i >= 25 ? [0, 0.7, 0.3, 0] : i >= 20 ? [0, 0.15, 0.85, 0] : i >= 12 ? [0, 0.4, 0.2, 0.4] : [0, 0, 0, 1]);
    days.forEach((d, i) => {
      d.who = {};
      d.whoUsd = {};
      weights(i).forEach((w, j) => { if (w > 0) { d.who[holders[j]] = Math.round(d.out * w); d.whoUsd[holders[j]] = d.usd * w; } });
    });
    const who = holders.map((key, j) => {
      const g = { key, in: 0, out: 0, cacheWrite: 0, cacheRead: 0, replies: 0, work: 0, asked: 0, usd: 0 };
      days.slice(-span).forEach((d, n) => { const w = weights(30 - span + n)[j]; for (const k of Object.keys(g)) if (k !== 'key') g[k] += Math.round(d[k] * w); });
      return g;
    }).filter((g) => g.out > 0).sort((a, b) => b.out - a.out);
    const lanes = [['s-agents', 'Pricing research', 'pricing', 7, 0.95], ['s-permission', 'Checkout page rebuild', 'shop', 9, 0.8], ['s-words', 'Invoice export bug', 'shop', 13, 0.6],
      ['past-1', 'Move the blog to the new layout', 'landing', 8, 0.45], ['past-2', 'Quarterly numbers', 'reports', 10, 0.3], ['past-3', 'Fix the flaky login test', 'api', 11, 0.2]].map(([key, title, name, from, k], n) => {
      const work = Array.from({ length: 24 }, (_, hr) => (hr >= from && hr <= hourNow && (hr + n) % 5 !== 0 ? Math.round(k * wave(hr, n) * 3600e3) : 0));
      const out = work.map((ms) => Math.round((ms / 3600e3) * 210000));
      const usd = work.map((ms) => (ms / 3600e3) * 21.5);
      return { key, title, name, work, out, usd, sum: work.reduce((a, b) => a + b, 0), tokens: out.reduce((a, b) => a + b, 0), spent: usd.reduce((a, b) => a + b, 0) };
    });
    const share = (names, weights, more) => names.map((name, i) => ({ key: name, name, in: Math.round(total.in * weights[i]), out: Math.round(total.out * weights[i]), cacheWrite: Math.round(total.cacheWrite * weights[i]),
      cacheRead: Math.round(total.cacheRead * weights[i]), replies: Math.round(total.replies * weights[i]), work: Math.round(total.work * weights[i]), asked: Math.round(total.asked * weights[i]),
      usd: total.usd * weights[i], ...(more ? more(name, i) : {}) }));
    const calls = [0.31, 0.22, 0.14, 0.09, 0.07, 0.05, 0.04, 0.03, 0.03, 0.02];
    return {
      at: madeAt + span, range: span === 30 ? '30d' : span === 7 ? '7d' : 'today', total, days, hours,
      // the third is not on the price list: its tokens are left out of every cost
      models: share(['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-1'], [0.74, 0.21, 0.05], (name) => (name === 'claude-haiku-5-1' ? { usd: 0 } : {})),
      unpriced: ['claude-haiku-5-1'],
      projects: share(['shop', 'pricing', 'api', 'landing', 'reports', 'notes'], [0.34, 0.24, 0.17, 0.12, 0.08, 0.05]),
      chats: share(['s-agents', 's-permission', 's-words', 'past-1', 'past-2', 'past-3'], [0.3, 0.22, 0.16, 0.13, 0.11, 0.08], (name, i) => ({
        title: ['Pricing research', 'Checkout page rebuild', 'Invoice export bug', 'Move the blog to the new layout', 'Quarterly numbers', 'Fix the flaky login test'][i],
        name: ['pricing', 'shop', 'shop', 'landing', 'reports', 'api'][i], project: 'p', cwd: i > 2 ? 'Z:\\nowhere\\past' : 'D:\\work\\shop' })),
      tools: ['Bash', 'Read', 'Edit', 'Grep', 'Agent', 'Write', 'WebFetch', 'WebSearch', 'ops: capture', 'Glob'].map((name, i) => ({ name, calls: Math.round(total.tools * calls[i]) })),
      toolKinds: 37,
      limits: [{ type: 'five_hour', until: madeAt + 42 * 60e3, at: madeAt - 18 * 60e3, chats: 3 }, { type: 'seven_day', until: madeAt - 2 * 86400e3, at: madeAt - 3 * 86400e3, chats: 5 }],
      active: { chats: 6 * span, projects: 6 },
      who, lanes,
      recorded: { usd: 1840.5, added: 48210, removed: 19044, conversations: 61 },
      reading: { files: 1756, done: 1756, bytes: 15.9e9, read: 15.9e9, counting: true, today: true },
    };
  };
  const madeUpPlan = () => ({ five: { used: 86, until: madeAt + 2.4 * 3600e3, at: madeAt - 20e3 }, week: { used: 41, until: madeAt + 3.2 * 86400e3, at: madeAt - 20e3 } });
  const DAY_MS = 86400e3;
  const account = (n, key, email, over) => ({ key, n, email, name: '', org: '', plan: email ? 'default_claude_max_20x' : '', type: 'claude_max', here: false, from: 0, to: 0,
    five: null, week: null, pace: { five: 0, week: 0 }, ...over });
  const madeUpAccounts = () => ({
    current: 'aaaa1111',
    list: [
      account(0, 'aaaa1111', 'studio@example.com', { here: true, from: madeAt - 5.2 * 3600e3, five: madeUpPlan().five, week: madeUpPlan().week, pace: { five: 9.5, week: 0.62 } }),
      account(1, 'bbbb2222', 'personal@example.com', { from: madeAt - 2 * DAY_MS, to: madeAt - 5.2 * 3600e3,
        five: { used: 97, until: madeAt + 1.1 * 3600e3, at: madeAt - 5.2 * 3600e3 }, week: { used: 64, until: madeAt + 4.5 * DAY_MS, at: madeAt - 5.2 * 3600e3 } }),
      account(2, 'cccc3333', 'client-work@example.com', { from: madeAt - 2.6 * DAY_MS, to: madeAt - 2 * DAY_MS,
        five: { used: 100, until: madeAt - 1.8 * DAY_MS, at: madeAt - 2 * DAY_MS }, week: { used: 22, until: madeAt + 2.1 * DAY_MS, at: madeAt - 2 * DAY_MS } }),
      account(3, 'dddd4444', '', { from: madeAt - 11 * DAY_MS, to: madeAt - 9 * DAY_MS }),
    ],
    marks: [
      { at: madeAt - 16 * DAY_MS, key: '', seen: false },
      { at: madeAt - 11 * DAY_MS, key: 'dddd4444', seen: false },
      { at: madeAt - 9 * DAY_MS, key: '', seen: false },
      { at: madeAt - 7.5 * DAY_MS, key: 'cccc3333', seen: false },
      { at: madeAt - 4 * DAY_MS, key: 'bbbb2222', seen: false },
      { at: madeAt - 2.6 * DAY_MS, key: 'cccc3333', seen: true },
      { at: madeAt - 2 * DAY_MS, key: 'bbbb2222', seen: true },
      { at: madeAt - 5.2 * 3600e3, key: 'aaaa1111', seen: true },
    ],
  });
  const fake = (at, list, ended = []) => JSON.stringify({ at, chats: list, ended, plan: madeUpPlan(), accounts: madeUpAccounts() });
  const showUsage = (range) => exec(`Desk.state.frozen = true; Desk.state.usage = ${JSON.stringify(madeUpUsage(range))}; paint()`);
  /**
   * What the watcher's helper would report for the made-up sessions: one with a dev server up, a command still
   * running and MCP servers, the others with less. The background record (no program) is not measured.
   * chat: a chat of this window that the busiest session runs in, and so has a total of its own.
   * more: further made-up sessions, built with the same two helpers (the pictures for a website show more of them).
   */
  const MB = 1048576;
  const madeUpRes = (chat, more) => {
    const prog = (kind, label, mb, cpu, n = 1, ports = []) => ({ kind, label, mem: mb * MB, cpu, n, ports, started: madeAt - 3600e3 });
    const sess = (ownMb, ownCpu, items = []) => ({
      mem: ownMb * MB + items.reduce((a, x) => a + x.mem, 0), ws: 0, cpu: Math.round((ownCpu + items.reduce((a, x) => a + x.cpu, 0)) * 10) / 10,
      n: 1 + items.reduce((a, x) => a + x.n, 0), ports: [...new Set(items.flatMap((x) => x.ports))], started: madeAt - 6 * 3600e3,
      own: { mem: ownMb * MB, cpu: ownCpu }, items, more: null,
    });
    const sessions = {
      's-agents': sess(612, 9.4, [prog('server', 'vite', 233, 4.1, 3, [5173]), prog('command', 'python', 199, 0.6, 2), prog('mcp', '@playwright/mcp', 88, 0, 3), prog('mcp', 'mcp_server', 47, 0, 3), prog('start', 'python', 31, 0, 2)]),
      's-permission': sess(455, 0.2, [prog('mcp', 'mcp_server', 47, 0, 3), prog('tool', 'npm run dev', 12, 0, 3)]),
      's-words': sess(398, 6.2, [prog('mcp', 'mcp_server', 46, 0, 3)]),
      's-compact': sess(812, 3.1, [prog('mcp', 'mcp_server', 48, 0, 3)]),
      's-error': sess(301, 0, [prog('mcp', '', 22, 0, 2)]),
      's-finish': sess(276, 0.4),
      's-idle': sess(153, 0, [prog('mcp', 'mcp_server', 0, 0, 3)]),
      'codex:x': sess(188, 1.2),
      ...(more ? more(sess, prog) : {}),
    };
    const all = Object.values(sessions);
    return {
      at: madeAt, cores: 16, memory: 64 * 1024 * MB, sessions,
      chats: chat ? { [chat]: { mem: sessions['s-agents'].mem + 71 * MB, cpu: 14.4, n: sessions['s-agents'].n + 2, ports: [5173] } } : {},
      app: { mem: 540 * MB, cpu: 1.3, n: 9 },
      all: { mem: all.reduce((a, s) => a + s.mem, 0), cpu: Math.round(all.reduce((a, s) => a + s.cpu, 0) * 10) / 10, n: all.reduce((a, s) => a + s.n, 0), sessions: all.length },
      servers: [{ port: 5173, key: 's-agents', label: 'vite', kind: 'server' }],
    };
  };

  // ---- made-up conversations for the reader and for the History view: the real ones are his, and never go into a picture ----
  const SRC = 'D:\\work\\shop\\src\\billing\\';
  const OPUS = 'claude-opus-5-5';
  const back = (minutes, seconds = 0) => Math.round(madeAt - minutes * 60e3 - seconds * 1000);
  const called = (id, at, label, what, input, over) => ({ k: 'tool', at, id, name: label, label, what, input, done: at + 1500, error: false, out: '', note: '', diff: null, applied: false, ...over });
  const change = (file, kind, hunks) => {
    const lines = hunks.flatMap((hk) => hk.lines);
    return { file: SRC + file, kind, hunks, added: lines.filter((l) => l[0] === '+').length, removed: lines.filter((l) => l[0] === '-').length, more: 0 };
  };
  /** The pages the reader is handed, as JSON: every reader that asks gets its own copy. */
  const madeUpPages = () => {
    const fixExport = change('export.ts', 'edit', [{ a: 21, b: 21, lines: [
      ' export function exportInvoices(rows) {',
      '   return rows',
      "-    .filter((row) => row.tax !== '')",
      '-    .map((row) => line(row, Number(row.tax)));',
      '+    .map((row) => {',
      '+      // an invoice without a tax field is a real invoice: it counts as no tax',
      "+      const tax = row.tax === '' ? 0 : Number(row.tax);",
      '+      return line(row, tax);',
      '+    });',
      ' }',
    ] }]);
    const fixFormat = change('export.ts', 'edit', [{ a: 44, b: 47, lines: [' function money(n) {', '-  return String(n);', '+  return n.toFixed(2);', ' }'] }]);
    const newTest = change('export.test.ts', 'new', [{ a: 0, b: 0, lines: [
      "+import { exportInvoices } from './export';",
      '+',
      "+test('exports a row with an empty tax field', () => {",
      "+  const csv = exportInvoices([{ id: 'INV-204', total: 120, tax: '' }]);",
      "+  expect(csv).toContain('INV-204,120.00,0.00');",
      '+});',
      '+',
      "+test('keeps a tax that is given', () => {",
      "+  const csv = exportInvoices([{ id: 'INV-205', total: 120, tax: '24' }]);",
      "+  expect(csv).toContain('INV-205,120.00,24.00');",
      '+});',
    ] }]);
    const askedPdf = change('pdf.ts', 'edit', [{ a: 0, b: 0, lines: ["-    .filter((row) => row.tax !== '')", '+    .map(withTax)'] }]);
    const madePdf = change('pdf.ts', 'edit', [{ a: 30, b: 30, lines: ['   return rows', "-    .filter((row) => row.tax !== '')", '+    .map(withTax)', '     .map(drawRow);'] }]);
    const about = { skipped: false, title: 'Invoice export bug', name: '', cwd: 'D:\\work\\shop' };
    const older = { ...about, size: 9000, from: 0, to: 4000, start: true, orphans: {},
      items: [
        { k: 'ask', at: back(62), text: 'The CSV export on the invoices page is missing rows. Customers noticed on Monday.\nFind out why before you change anything.', pictures: 1, queued: false },
        { k: 'think', at: back(61, 54), text: 'The export goes through exportInvoices. Before anything else I should see how rows are filtered on their way into the file.', ms: 4200 },
        called('t1', back(61, 50), 'Grep', 'exportInvoices', 'exportInvoices\nin src', { out: 'src/billing/export.ts:21:export function exportInvoices(rows) {\nsrc/pages/invoices.tsx:88:  const csv = exportInvoices(rows);' }),
        called('t2', back(61, 40), 'Read', 'export.ts', `${SRC}export.ts`, { note: '64 lines from line 1 of 64' }),
        { k: 'say', at: back(61, 10), model: OPUS, text: 'Found it. `exportInvoices` drops every row whose **tax** field is empty: the check on line 23 takes an empty field for a broken row.\n\n14 of the 212 invoices from September have no tax field, and those are the ones that are missing.' },
        { k: 'turn', at: back(60, 25), ms: 95000 },
      ],
      replies: [{ at: back(61, 54), ctx: 431000, out: 900 }, { at: back(61, 40), ctx: 440000, out: 300 }, { at: back(61, 10), ctx: 452000, out: 1400 }] };
    const main = { ...about, size: 9000, from: 4000, to: 9000, start: false, orphans: {},
      items: [
        { k: 'compact', at: back(41), pre: 452000, ms: 148000, auto: true },
        { k: 'summary', at: back(41), text: '## Where things stand\n\n- The CSV export drops invoices whose tax field is empty (`src/billing/export.ts`, line 23).\n- Nothing has been changed yet: the cause was to be found first.' },
        { k: 'ask', at: back(40), text: 'Fix it. A row with an empty tax field must be exported with a tax of 0.00.\nAdd a test so this cannot come back.', pictures: 0, queued: false },
        { k: 'think', at: back(39, 56), text: 'Two changes: stop filtering those rows out, and treat the empty field as no tax. Then a test for exactly that row.', ms: 6100 },
        called('t3', back(39, 50), 'Edit', 'export.ts', `${SRC}export.ts`, { diff: fixExport, applied: true }),
        called('t4', back(39, 30), 'Write', 'export.test.ts', `${SRC}export.test.ts`, { diff: newTest, applied: true }),
        called('t5', back(39, 10), 'Bash', 'Run the billing tests', 'npm test -- billing', { done: back(38, 56), error: true,
          out: 'FAIL  src/billing/export.test.ts\n  x exports a row with an empty tax field (4 ms)\n\n    Expected: "INV-204,120.00,0.00"\n    Received: "INV-204,120.00,0"\n\nTests: 1 failed, 11 passed, 12 total' }),
        { k: 'say', at: back(38, 50), model: OPUS, text: 'One test fails: the tax is written as `0`, and the file wants two decimals. Fixing how amounts are written.' },
        called('t6', back(38, 40), 'Edit', 'export.ts', `${SRC}export.ts`, { diff: fixFormat, applied: true }),
        called('t7', back(38, 20), 'Bash', 'Run the billing tests', 'npm test -- billing', { done: back(38, 11), out: 'PASS  src/billing/export.test.ts\n\nTests: 12 passed, 12 total\nTime:  3.1 s' }),
        { k: 'say', at: back(33, 20), model: OPUS, text: [
          '## Fixed',
          '',
          'The export dropped every invoice whose **tax** field was empty. It now writes them with a tax of `0.00`.',
          '',
          '- `src/billing/export.ts`: an empty tax field counts as no tax',
          '- `src/billing/export.test.ts`: new, two cases',
          '',
          '| Case | Before | After |',
          '| --- | --- | --- |',
          '| tax field empty | row dropped | exported, tax 0.00 |',
          '| tax field given | exported | exported, two decimals |',
          '',
          'The one line that decides it:',
          '',
          '```ts',
          "const tax = row.tax === '' ? 0 : Number(row.tax);",
          '```',
          '',
          'All 12 tests pass. The 14 invoices from September are in the file again.',
        ].join('\n') },
        { k: 'turn', at: back(33, 8), ms: 412000 },
        { k: 'ask', at: back(9), text: 'Good. The PDF export has the same check. Fix it there too, and show me the diff before you commit.', pictures: 0, queued: false },
        { k: 'think', at: back(8, 55), text: '', ms: 2400 },
        called('t8', back(8, 50), 'Grep', "row.tax !== ''", "row.tax !== ''\nin src/billing", { out: "src/billing/pdf.ts:31:    .filter((row) => row.tax !== '')" }),
        { k: 'say', at: back(6, 30), model: OPUS, text: 'The export skips rows with an empty tax field. Writing the fix now.' },
        called('t9', back(6, 20), 'Edit', 'pdf.ts', `${SRC}pdf.ts`, { diff: askedPdf, done: 0 }),
      ],
      replies: [{ at: back(39, 56), ctx: 38000, out: 1800 }, { at: back(39, 30), ctx: 52000, out: 2600 }, { at: back(39, 10), ctx: 61000, out: 400 }, { at: back(38, 50), ctx: 66000, out: 700 },
        { at: back(38, 20), ctx: 74000, out: 300 }, { at: back(33, 20), ctx: 85000, out: 4200 }, { at: back(8, 55), ctx: 91000, out: 500 }, { at: back(6, 30), ctx: 96000, out: 800 }] };
    // what arrives while the conversation is being watched: the edit that was running comes back, and a few words follow
    const lastWords = { k: 'say', at: madeAt, model: OPUS, text: 'Done. `pdf.ts` now treats an empty tax field the same way. Here is the diff, before I commit anything.' };
    const grown = { ...about, size: 9600, from: 9000, to: 9600, start: false,
      orphans: { t9: { done: madeAt, error: false, out: '', note: '', diff: madePdf } }, items: [lastWords], replies: [{ at: madeAt, ctx: 99000, out: 700 }] };
    // the same conversation once it is over, as a past one reads
    const whole = { ...about, size: 9600, from: 0, to: 9600, start: true, orphans: {},
      items: [...older.items, ...main.items.map((it) => (it.id === 't9' ? { ...it, done: madeAt, diff: madePdf, applied: true } : it)), lastWords, { k: 'turn', at: madeAt, ms: 540000 }],
      replies: [...older.replies, ...main.replies, ...grown.replies] };
    const pricing = { skipped: false, title: 'Pricing research', name: '', cwd: 'D:\\work\\pricing', size: 5000, from: 0, to: 5000, start: true, orphans: {},
      items: [
        { k: 'ask', at: back(11), text: 'Compare our prices against the five closest competitors and tell me where we are out of line.', pictures: 0, queued: false },
        { k: 'think', at: back(10, 55), text: 'Five competitors, each with its own pricing page: that is work for five subagents at once. First our own plans, so each of them has something to compare against.', ms: 3800 },
        called('p1', back(5), 'WebSearch', 'competitor pricing pages 2026', 'competitor pricing pages 2026', { done: back(4, 56), out: 'Found the public pricing pages of competitors A to E.' }),
        called('p2', back(4, 40), 'Read', 'plans.md', 'D:\\work\\pricing\\plans.md', { note: '48 lines from line 1 of 48' }),
        { k: 'say', at: back(4, 30), model: OPUS, text: 'Our three tiers are 35, 79 and 149 a month. I am sending one subagent to each competitor, and I will build the table once they are back.' },
        called('p3', back(4, 20), 'Agent', 'Compare competitor A', 'Compare competitor A\n\nkind: general-purpose\n\nCompare competitor A\'s public prices with ours, plan by plan.', { done: back(1, 30), out: 'Competitor A charges 29 a month for the same tier, 17% under us.' }),
        called('p4', back(1, 15), 'Agent', 'Compare competitor D', 'Compare competitor D\n\nkind: general-purpose\n\nCompare competitor D\'s public prices with ours, plan by plan.', { done: 0 }),
        called('p5', back(1, 14), 'Agent', 'Compare competitor E', 'Compare competitor E\n\nkind: general-purpose\n\nCompare competitor E\'s public prices with ours, plan by plan.', { done: 0 }),
        { k: 'say', at: back(1, 10), model: OPUS, text: 'Three of the five are in. Waiting on the last two before I build the table.' },
      ],
      replies: [{ at: back(10, 55), ctx: 361000, out: 1200 }, { at: back(4, 40), ctx: 372000, out: 400 }, { at: back(4, 30), ctx: 380000, out: 900 }, { at: back(1, 15), ctx: 396000, out: 2100 }, { at: back(1, 10), ctx: 402000, out: 600 }] };
    const agent = { skipped: false, title: '', name: '', cwd: 'D:\\work\\pricing', size: 2000, from: 0, to: 2000, start: true, orphans: {},
      items: [
        { k: 'ask', at: back(1, 15), text: "Compare competitor D's public prices with ours, plan by plan. Use their pricing page only.\nReport the monthly and the yearly price of every tier.", pictures: 0, queued: false },
        called('a1', back(1, 5), 'WebFetch', 'competitor-d.example', 'https://competitor-d.example/pricing\nList every plan with its monthly and yearly price.', { done: back(0, 40), out: 'Starter 19 a month · Team 49 a month · Business 129 a month. The yearly prices load when the toggle is clicked.' }),
        { k: 'say', at: back(0, 30), model: OPUS, text: 'Their monthly prices are on the page. The yearly ones load from a second request: fetching that next.' },
        called('a2', back(0, 6), 'WebFetch', 'competitor-d.example', 'https://competitor-d.example/api/prices?billing=yearly\nRead the yearly price of every plan.', { done: 0 }),
      ],
      replies: [{ at: back(1, 5), ctx: 14000, out: 300 }, { at: back(0, 30), ctx: 21000, out: 500 }] };
    return { main: JSON.stringify(main), older: JSON.stringify(older), grown: JSON.stringify(grown), whole: JSON.stringify(whole), pricing: JSON.stringify(pricing), agent: JSON.stringify(agent) };
  };
  /** What the watcher would answer when asked for every conversation kept on the machine. */
  const madeUpHistory = () => {
    const past = (id, title, folder, minutesAgo, over) => ({ id, project: `D--work-${folder}`, cwd: `D:\\work\\${folder}`, title, name: '', prompt: '', mode: 'default', at: back(minutesAgo), first: back(minutesAgo + 190),
      size: 4.2e6, model: OPUS, out: 212000, replies: 310, tools: 420, compacts: 1, agents: 0, usd: 0, added: 0, removed: 0, counted: true, live: false, ...over });
    const list = [
      past('past-0', 'Empty tax field breaks the export', 'shop', 0.25, { cwd: 'Z:\\nowhere\\shop', size: 6.8e6, out: 388000, replies: 512, tools: 730, usd: 31.4, added: 412, removed: 96,
        prompt: 'Good. The PDF export has the same check. Fix it there too, and show me the diff before you commit.' }),
      past('s-agents', 'Pricing research', 'pricing', 0.4, { live: true, size: 48.2e6, out: 1.2e6, replies: 1840, tools: 2600, agents: 7, counted: false }),
      past('s-words', 'Invoice export bug', 'shop', 6.3, { live: true, size: 12.1e6 }),
      past('past-1', 'Move the blog to the new layout', 'landing', 26 * 60, { size: 88.4e6, out: 2.4e6, replies: 2210, tools: 3900, compacts: 6, agents: 14 }),
      past('past-2', 'Quarterly numbers', 'reports', 3 * 1440, { model: 'claude-sonnet-5-5', size: 1.3e6, out: 41000, replies: 64, tools: 51, compacts: 0 }),
      past('past-3', '', 'api', 4 * 1440, { prompt: 'Why does the login test fail one run in five? Look at the retries first.', size: 9.9e6 }),
      past('past-4', 'Rate limiter for the public API', 'api', 12 * 1440, { size: 2.28e9, out: 18.4e6, replies: 14200, tools: 22100, compacts: 31, agents: 120 }),
      past('past-5', 'First look at the codebase', 'shop', 45 * 1440, { size: 740e3, out: 9400, replies: 22, tools: 31, compacts: 0, model: '' }),
    ];
    return { at: madeAt, list, total: list.length, bytes: list.reduce((n, r) => n + r.size, 0), counting: false };
  };
  const installFakes = () => inPage(pageFakes, madeUpPages(), JSON.stringify(madeUpHistory()));
  const tabOf = (where, id) => exec(`document.querySelector('#${where} .seg.tabs button[data-tab="${id}"]').click()`);
  /** A click on a chat in the list on the left, found by its session. */
  const pick = (key) => inPage((k) => {
    const el = [...document.querySelectorAll('#chat-list .nav-item.chat')].find((x) => x.dataset.key === k);
    if (el) el.click();
    return Boolean(el);
  }, key);
  const typeInto = (selector, text) => inPage((sel, value) => { const f = document.querySelector(sel); f.value = value; f.dispatchEvent(new Event('input')); return true; }, selector, text);
  // two values hold the same; for a plain object the order of its keys does not count
  const norm = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : 1))) : v);
  const same = (a, b) => JSON.stringify(norm(a)) === JSON.stringify(norm(b));

  // ---- workspaces, over the made-up list: a name and the folders that belong to it. The list holds the chats of the
  // ---- workspace in front, and a tab says how many of its chats wait while another one is in front.
  const spacesNow = () => inPage(pageSpaces);
  const tabsOf = (sp) => sp.tabs.map((t) => `${t.name}${t.on ? '*' : ''}${t.n ? ` ${t.n}` : ''}`);
  const tabOfSpace = (id) => `#spaces .space-tab[data-space="${id}"]`;
  const keptSpaces = () => settingsNow().spaces.map((s) => [s.name, s.folders]);
  const toastNow = () => exec('document.getElementById("toast").hidden ? "" : document.getElementById("toast").textContent');
  const call = (name, ...args) => exec(`Desk.${name}(${args.map((x) => JSON.stringify(x)).join(', ')})`);
  const sortingPart = async () => {
    const SHOP = 'D:\\work\\shop';
    const PRICING = 'D:\\work\\pricing';
    const rowOf = (key) => `#chat-list .nav-item.chat[data-key="${key}"]`;
    const onDisk = () => { try { return JSON.parse(fs.readFileSync(path.join(app.getPath('userData'), 'desk.json'), 'utf8')).spaces.map((s) => [s.name, s.folders]); } catch { return null; } };
    const ticks = (menu) => menu.items.map((i) => i.label + (i.ticked ? '*' : ''));
    await exec('document.getElementById("toast").hidden = true; Desk.look(null); Desk.setView("peek")');
    await exec(`takeSnapshot(${fake(madeAt + 40, madeUpRows(true))})`);
    // the parts before looked at some of these made-up chats: here waits are counted by workspace, from unseen
    await unsee();
    await wait(200);
    let sp = await spacesNow();
    check('with no workspace the list stands under the word "Chats" and its count, and holds no tab',
      !sp.on && sp.label === 'Chats' && sp.count === '9' && sp.tabs.length === 0 && sp.keys.length === 9, `"${sp.label} ${sp.count}", ${sp.keys.length} rows, ${sp.tabs.length} tabs`);

    // made from the menu above the list: its name is typed where its tab will stand
    await exec('document.getElementById("side-more").click()');
    await wait(100);
    await inPage(pageMenuRun, 'New workspace…');
    await wait(150);
    const asking = await spacesNow();
    await typeInto('#spaces .space-input', '  Clients  ');
    await inPage(pageKey, 'Enter', '#spaces .space-input');
    await wait(250);
    sp = await spacesNow();
    let page = await inPage(pagePeek);
    const clients = sp.spaces.length === 1 ? sp.spaces[0].id : '';
    const written = await until(async () => same(keptSpaces(), [['Clients', []]]) && settingsNow().space === clients, 3000, 100);
    check('a workspace is made from the menu above the list: its name is typed where its tab will stand, it comes in front, and it starts empty',
      asking.on && asking.input && asking.typing && same(tabsOf(asking), ['All*'])
      && /^w[0-9a-z]{1,12}$/.test(clients) && sp.spaces[0].name === 'Clients' && sp.space === clients && same(tabsOf(sp), ['All', 'Clients*', 'Unsorted 3'])
      && !sp.input && sp.label === '' && sp.keys.length === 0 && sp.empty.startsWith('No chat of this workspace is running.')
      && page.start === 'No chat of Clients is open in this window' && same(page.buttons, ['New chat', 'History']) && page.figures === 0 && Boolean(written),
      `tabs: ${tabsOf(sp).join(', ')}; the list: "${sp.empty}"; the page: "${page.start}"`);

    // sorted from the list: a right click on a chat puts its folder in a workspace, and every chat in that folder goes along
    await press(tabOfSpace(''));
    await wait(200);
    const inAll = await spacesNow();
    await inPage(pageRightClick, rowOf('s-words'));
    await wait(100);
    const rowMenu = await inPage(pageMenu);
    await inPage(pageMenuRun, 'Clients');
    await wait(250);
    sp = await spacesNow();
    const sortedSaid = await toastNow();
    const toldMain = await until(async () => same(keptSpaces(), [['Clients', [SHOP]]]), 3000, 100);
    const disk = await until(async () => same(onDisk(), [['Clients', [SHOP]]]), 4000, 150);
    check('a right click on a chat offers the workspaces, and the one picked takes its folder: said in the window, written down at once, and kept on disk',
      inAll.space === '' && inAll.keys.length === 9 && Boolean(rowMenu) && same(rowMenu.heads, ['"shop" and the folders in it are in'])
      && same(ticks(rowMenu), ['Bring here', 'Look at it', 'Open its folder', 'Clients', 'No workspace*']) && sortedSaid === '"shop" is now part of Clients.'
      && same(sp.spaces.map((s) => [s.name, s.folders]), [['Clients', [SHOP]]]) && sp.space === '' && sp.keys.length === 9 && Boolean(toldMain) && Boolean(disk),
      rowMenu ? `its menu: ${rowMenu.items.map((i) => i.label + (i.ticked ? ' (ticked)' : '')).join(' / ')}; Clients now holds ${sp.spaces[0] ? sp.spaces[0].folders.join(', ') : 'nothing'}` : 'no menu opened');

    await press(tabOfSpace(clients));
    await wait(200);
    sp = await spacesNow();
    const tip = (sp.tabs.find((t) => t.id === clients) || { tip: '' }).tip.split('\n');
    check('with a workspace in front the list holds its chats only, the ones that wait still on top; what is left to sort has a tab of its own, and the tabs fit the sidebar',
      sp.space === clients && same(sp.keys.slice().sort(), ['job:abc12345', 's-compact', 's-error', 's-finish', 's-idle', 's-permission', 's-words']) && same(sp.keys.slice(0, 3), ['job:abc12345', 's-error', 's-permission'])
      && same(tabsOf(sp), ['All', 'Clients*', 'Unsorted']) && same(tip.slice(0, 3), ['Clients', '7 chats · 3 need you', 'Ctrl Shift 2']) && !sp.spill
      && (await exec('document.getElementById("triage").textContent')) === '3 need you',
      `${sp.keys.length} of 9 rows: ${sp.keys.join(', ')}; its tab says "${tip.slice(0, 3).join(' | ')}"; the tabs take ${sp.lines} line${sp.lines === 1 ? '' : 's'}`);

    // a second workspace: a tab that is not in front counts the chats of its own that wait
    const studio = await call('addSpace', 'Studio');
    await call('putFolder', PRICING, studio);
    await wait(250);
    sp = await spacesNow();
    check('while another workspace is in front, a tab says in yellow how many of its chats wait for you',
      sp.space === studio && same(sp.keys, ['s-agents']) && same(tabsOf(sp), ['All', 'Clients 3', 'Studio*', 'Unsorted']), `tabs: ${tabsOf(sp).join(', ')}; the list: ${sp.keys.join(', ')}`);

    // a click on a tab never moves a name, nor does a count that comes or goes (his word, 4 Oct: "there is a layout
    // shift on the names of workspaces when we click on one of them, make sure it never happens")
    const namesAt = () => inPage(() => [...document.querySelectorAll('#spaces .space-tab')].map((t) => {
      const r = t.querySelector('.space-name').getBoundingClientRect();
      return `${t.dataset.space || 'all'}@${Math.round(r.left * 4) / 4},${Math.round(r.top * 4) / 4},${Math.round(r.width * 4) / 4}`;
    }));
    const still = await namesAt();
    const shifts = [];
    for (const id of ['', clients, '?', studio]) {
      await press(tabOfSpace(id));
      await wait(150);
      const at = await namesAt();
      if (!same(at, still)) shifts.push(`after ${id || 'all'}: ${at.join(' ')}`);
    }
    const snapBefore = await inPage(() => Desk.state.snap);
    await inPage((snap) => { takeSnapshot({ ...snap, at: snap.at + 1, chats: snap.chats.map((c) => (c.key === 'codex:x' ? { ...c, state: 'attention', since: Date.now() } : c)) }); Desk.paint(); return true; }, snapBefore);
    await wait(150);
    const counted = await inPage(() => {
      const t = document.querySelector('#spaces .space-tab[data-space="?"]');
      const n = t && t.querySelector('.space-n');
      if (!n) return null;
      const a = t.getBoundingClientRect();
      const b = n.getBoundingClientRect();
      return { n: n.textContent, corner: b.right >= a.right - 2 && b.top <= a.top + 1 };
    });
    const withCount = await namesAt();
    if (!same(withCount, still)) shifts.push(`with a new count: ${withCount.join(' ')}`);
    await shoot('spaces-counts');
    await inPage((snap) => { takeSnapshot({ ...snap, at: snap.at + 2 }); Desk.paint(); return true; }, snapBefore);
    await wait(150);
    check('a click on a workspace tab never moves a name, nor does a count that comes or goes: the count sits on the tab\'s corner',
      shifts.length === 0 && Boolean(counted) && counted.n === '1' && counted.corner && (await spacesNow()).space === studio,
      shifts.length ? shifts.join(' | ') : `names held still; the new count: ${JSON.stringify(counted)}`);
    const rules = await inPage((c) => ({
      inside: Desk.spaceOf('D:\\work\\shop\\src\\api') === c, written: Desk.spaceOf('d:/WORK/Shop/') === c,
      beside: Desk.spaceOf('D:\\work\\shopping'), none: Desk.spaceOf(''), other: Desk.spaceOf('D:\\work\\api'),
    }), clients);
    check('a chat in a folder inside a sorted folder is in its workspace, however the path is written; a folder that only begins the same is not',
      rules.inside && rules.written && rules.beside === '' && rules.none === '' && rules.other === '', JSON.stringify(rules));
    await call('putFolder', SHOP, studio);
    await wait(150);
    const moved = (await spacesNow()).spaces.map((s) => [s.name, s.folders]);
    await call('putFolder', SHOP, clients);
    await exec('document.getElementById("toast").hidden = true');
    await call('putFolder', 'D:\\work\\shop\\src', '');
    await wait(150);
    const refusal = await toastNow();
    sp = await spacesNow();
    check('a folder is in one workspace only, and a folder that is in one through the folder above it is not taken out behind your back',
      same(moved, [['Clients', []], ['Studio', [PRICING, SHOP]]]) && same(sp.spaces.map((s) => [s.name, s.folders]), [['Clients', [SHOP]], ['Studio', [PRICING]]])
      && refusal === `"src" is in Clients because ${SHOP} is. Put it in another workspace, or take that folder out in Settings.`, `moved over: ${JSON.stringify(moved)}; then: "${refusal}"`);
    // taken out of its own workspace, a folder can still be in another one through the folder above it
    await call('putFolder', 'D:\\work', studio);
    await call('putFolder', SHOP, '');
    await wait(150);
    const fellTo = await toastNow();
    const nested = (await spacesNow()).spaces.map((s) => [s.name, s.folders]);
    await call('putFolder', 'D:\\work', '');
    await call('putFolder', SHOP, clients);
    await wait(150);
    check('a folder taken out of its workspace that is still inside a sorted folder is said to be where it is now',
      fellTo === '"shop" is now part of Studio, because D:\\work is.' && same(nested, [['Clients', []], ['Studio', [PRICING, 'D:\\work']]])
      && same((await spacesNow()).spaces.map((s) => [s.name, s.folders]), [['Clients', [SHOP]], ['Studio', [PRICING]]]) && (await exec('folderAs("D:/")')) === 'D:\\', `"${fellTo}"; a whole drive is kept as ${await exec('folderAs("D:/")')}`);
    await exec('document.getElementById("toast").hidden = true');

    // what is asked for is followed across workspaces: the chat that has waited longest is in the other one
    await exec('document.getElementById("triage").click()');
    await wait(250);
    sp = await spacesNow();
    const led = await inPage(pageList);
    check('"need you" in the title bar leads to the chat that has waited longest, and its workspace comes in front with it',
      sp.space === clients && led.view === 'peek' && led.sel === 'job:abc12345' && led.picked === 1 && sp.keys.includes('job:abc12345'),
      `in front: ${(sp.tabs.find((t) => t.on) || {}).name}; looking at ${led.sel}`);
    await exec('Desk.look(null)');

    // the keys: Ctrl Shift 1 is every chat, 2 and 3 the workspaces by their tabs
    const walked = [];
    for (const code of ['Digit1', 'Digit3', 'Digit2', 'Digit9']) { await ctrl(code, { shift: true }); await wait(120); walked.push(await exec('Desk.state.settings.space')); }
    const nameOf = (id) => (id === '' ? 'All' : id === studio ? 'Studio' : id === clients ? 'Clients' : id);
    check('Ctrl Shift 1 to 9 goes to a workspace by its tab, 1 is every chat, and a number with no tab does nothing', same(walked, ['', studio, clients, clients]), walked.map(nameOf).join(', '));

    // Held a moment, Ctrl Shift shows each tab's number under it and Ctrl alone each chat's number on its mark (his ask,
    // 4 Oct); a quick Ctrl with another key shows nothing, and the list holds still while the numbers show.
    const keyDown = (key, shift = false) => inPage((k, s) => {
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: k, code: k === 'Shift' ? 'ShiftLeft' : k === 'Control' ? 'ControlLeft' : `Key${k.toUpperCase()}`, ctrlKey: true, shiftKey: s, bubbles: true, cancelable: true }));
      return true;
    }, key, shift);
    const keyUp = (key, ctrlStill) => inPage((k, c) => {
      document.body.dispatchEvent(new KeyboardEvent('keyup', { key: k, code: k === 'Shift' ? 'ShiftLeft' : 'ControlLeft', ctrlKey: c, bubbles: true }));
      return true;
    }, key, ctrlStill);
    // each number shown, and what lies under its middle: a tab (the number hangs under its name) or a chat's row
    const hintsNow = () => inPage(() => {
      const layer = document.querySelector('.key-hints');
      if (!layer || layer.hidden) return [];
      return [...layer.querySelectorAll('.key-hint')].map((b) => {
        const r = b.getBoundingClientRect();
        const x = r.left + r.width / 2;
        const y = r.top + r.height / 2;
        const tab = [...document.querySelectorAll('#spaces .space-tab')].find((t) => { const q = t.getBoundingClientRect(); return x >= q.left && x <= q.right && Math.abs(y - q.bottom) <= 10; });
        const row = [...document.querySelectorAll('#chat-list .nav-item.chat')].find((t) => { const q = t.getBoundingClientRect(); return x >= q.left && x <= q.right && y >= q.top && y <= q.bottom; });
        return [b.textContent, row ? `row:${row.dataset.key}` : tab ? `tab:${tab.dataset.space}` : 'nothing'];
      });
    });
    // the chats as the eye meets them: rows on screen in the list, from the top, outside a folded group, not ended
    const rowsSeen = () => inPage(() => {
      const box = document.getElementById('chat-list').getBoundingClientRect();
      return [...document.querySelectorAll('#chat-list .nav-item.chat')]
        .filter((el) => !el.closest('.group.folded') && !el.classList.contains('k-ended') && !el.classList.contains('closing'))
        .map((el) => [el.dataset.key, el.getBoundingClientRect()]).filter(([, q]) => q.height > 0 && q.bottom > box.top && q.top < box.bottom)
        .sort((a, b) => a[1].top - b[1].top).slice(0, 9).map(([key]) => key);
    });
    await keyDown('Control');
    await keyDown('c');
    await wait(700);
    const quick = await hintsNow();
    await keyUp('Control', false);
    await keyDown('Control');
    await keyDown('Shift', true);
    await wait(700);
    const tabHints = await hintsNow();
    const tabsThere = await inPage(() => [...document.querySelectorAll('#spaces .space-tab')].map((t) => t.dataset.space));
    await keyUp('Shift', true);
    await wait(150);
    const chatHints = await hintsNow();
    const seenRows = await rowsSeen();
    // while they show, a chat whose state changes keeps its row as it was: the numbers stay on what they were on
    const second = chatHints.length > 1 ? chatHints[1][1].slice(4) : '';
    const snapWas = await inPage(() => Desk.state.snap);
    const markOfRow = (key) => inPage((k) => { const r = document.querySelector(`#chat-list .nav-item.chat[data-key="${k}"]`); return r ? r.dataset.mark : ''; }, key);
    const markBefore = second ? await markOfRow(second) : '';
    const changeTo = markBefore === 'error' ? 'attention' : 'error';
    const changedMark = changeTo === 'error' ? 'error' : 'needs';
    if (second) await inPage((snap, k, to) => { takeSnapshot({ ...snap, at: snap.at + 1, chats: snap.chats.map((c) => (c.key === k ? { ...c, state: to } : c)) }); return true; }, snapWas, second, changeTo);
    const markHeld = second ? await markOfRow(second) : '';
    await ctrl('Digit2', { held: true });
    await wait(200);
    const went = second ? await inPage((k) => { const r = document.querySelector(`#chat-list .nav-item.chat[data-key="${k}"]`); return Boolean(r && r.classList.contains('on')); }, second) : false;
    const markAfter = second ? await markOfRow(second) : '';
    const afterPress = await hintsNow();
    await keyUp('Control', false);
    await inPage((snap) => { takeSnapshot({ ...snap, at: snap.at + 2 }); return true; }, snapWas);
    await exec('Desk.look(null)');
    await wait(150);
    check('held a moment, Ctrl Shift numbers the workspace tabs under their names, from 1 for every chat; a quick Ctrl C shows nothing',
      quick.length === 0 && same(tabHints, tabsThere.slice(0, 9).map((id, i) => [String(i + 1), `tab:${id}`])) && tabsThere.length >= 3,
      JSON.stringify({ quick, tabHints }));
    check('letting go of Shift with Ctrl held numbers the chats of the list from the top, on their marks; Ctrl 2 goes to the second, the list held still meanwhile, and the numbers go',
      chatHints.length >= 2 && same(chatHints, seenRows.map((key, i) => [String(i + 1), `row:${key}`])) && markHeld === markBefore && markAfter === changedMark && went && afterPress.length === 0,
      JSON.stringify({ chatHints: chatHints.map(([n, w]) => `${n} ${w}`), seen: seenRows.length, markBefore, markHeld, markAfter, went }));

    // what is in no workspace yet: a tab of its own, which goes once it is empty (the looks above saw two of the waits)
    await press(tabOfSpace('?'));
    await wait(200);
    await unsee();
    const loose = await spacesNow();
    page = await inPage(pagePeek);
    await inPage(pageRightClick, rowOf('codex:x'));
    await wait(100);
    const looseMenu = await inPage(pageMenu);
    await inPage(pageMenuRun, 'Studio');
    await wait(250);
    sp = await spacesNow();
    check('"Unsorted" holds the chats that are in no workspace; once the last one is sorted its tab goes, and every chat is shown',
      loose.loose && loose.space === '' && same(loose.keys, ['codex:x']) && same(tabsOf(loose), ['All', 'Clients 3', 'Studio', 'Unsorted*'])
      && page.start === 'No unsorted chat is open in this window' && Boolean(looseMenu) && same(looseMenu.heads, ['"api" and the folders in it are in'])
      && same(ticks(looseMenu), ['Look at it', 'Open its folder', 'Clients', 'Studio', 'No workspace*'])
      && !sp.loose && sp.space === '' && sp.keys.length === 9 && same(tabsOf(sp), ['All*', 'Clients 3', 'Studio']),
      `unsorted: ${loose.keys.join(', ')}; after sorting it, tabs: ${tabsOf(sp).join(', ')}`);

    // renamed from its tab; a name that is begun and given up makes nothing
    await inPage(pageRightClick, tabOfSpace(clients));
    await wait(100);
    const tabMenu = await inPage(pageMenu);
    await inPage(pageMenuRun, 'Rename');
    await wait(150);
    const renaming = await inPage(() => { const f = document.querySelector('#spaces .space-input'); return f ? { value: f.value, focus: document.activeElement === f } : null; });
    await typeInto('#spaces .space-input', 'Upwork');
    await inPage(pageKey, 'Enter', '#spaces .space-input');
    await wait(200);
    sp = await spacesNow();
    await exec('document.getElementById("side-more").click()');
    await wait(100);
    const offers = (await inPage(pageMenu)).items.map((i) => i.label);
    await inPage(pageMenuRun, 'New workspace…');
    await wait(150);
    const begun = await spacesNow();
    await typeInto('#spaces .space-input', 'Given up');
    await inPage(pageKey, 'Escape', '#spaces .space-input');
    await wait(150);
    const after = await spacesNow();
    check('a right click on a tab renames the workspace or takes it away; a name that is given up with Esc makes nothing',
      Boolean(tabMenu) && same(tabMenu.items.map((i) => i.label), ['Show it next to the others', 'Rename', 'Its folders…', 'Take this workspace away']) && Boolean(renaming) && renaming.value === 'Clients' && renaming.focus
      && same(sp.tabs.map((t) => t.name), ['All', 'Upwork', 'Studio']) && sp.spaces[0].id === clients && same(sp.spaces[0].folders, [SHOP])
      && same(offers, ['New chat', 'Bring the 7 in other terminals here', 'New workspace…', 'Workspaces and their folders…'])
      && begun.input && begun.typing && same(after.tabs.map((t) => t.name), ['All', 'Upwork', 'Studio']) && !after.input && after.spaces.length === 2,
      `its menu: ${tabMenu ? tabMenu.items.map((i) => i.label).join(' / ') : 'none'}; the tab now says "${(sp.tabs[1] || {}).name}"`);

    // its colour is picked in the same menu: a dot applies at once and the menu stays open for another
    const colourWas = (settingsNow().spaces.find((s) => s.id === clients) || {}).color || '';
    await inPage(pageRightClick, tabOfSpace(clients));
    await wait(100);
    const dots = await inPage(() => {
      const row = document.querySelector('#menu .menu-swatches');
      return row && { heads: [...document.querySelectorAll('#menu .menu-head')].map((x) => x.textContent),
        dots: [...row.children].map((b) => `${b.getAttribute('aria-label')}${b.getAttribute('aria-checked') === 'true' ? '*' : ''}`) };
    });
    // by the keyboard: Down three times passes the three entries above the dots and lands on the picked one, Right moves along
    for (let i = 0; i < 3; i++) await inPage(pageKey, 'ArrowDown');
    const landed = await exec('document.activeElement.getAttribute("aria-label")');
    await inPage(pageKey, 'ArrowRight');
    const next = await exec('document.activeElement.getAttribute("aria-label")');
    await inPage(() => { document.querySelector('#menu .menu-swatch[data-color="sky"]').click(); return true; });
    const sky = await until(() => (settingsNow().spaces.find((s) => s.id === clients) || {}).color === 'sky', 3000);
    const picked = await inPage((sel) => ({ open: !document.getElementById('menu').hidden, tab: document.querySelector(sel).className,
      on: [...document.querySelectorAll('#menu .menu-swatch.on')].map((b) => b.getAttribute('aria-label')) }), tabOfSpace(clients));
    await inPage(() => { document.querySelector('#menu .menu-swatch[data-color=""]').click(); return true; });
    const auto = await until(() => ((settingsNow().spaces.find((s) => s.id === clients) || {}).color || '') === '', 3000);
    await inPage(pageKey, 'Escape');
    const shut = await exec('document.getElementById("menu").hidden');
    if (colourWas) await call('colorSpace', clients, colourWas);
    const order = ['rose', 'olive', 'mint', 'teal', 'sky', 'indigo', 'purple', 'Auto'];
    const was = colourWas || 'Auto';
    check('a right click on a tab picks its colour: a dot applies at once, the menu stays for another, the keyboard reaches the dots, and Auto gives back the colour of its place',
      Boolean(dots) && same(dots.heads, ['Colour']) && same(dots.dots, order.map((c) => (c === was ? `${c}*` : c)))
      && landed === was && next === order[(order.indexOf(was) + 1) % order.length]
      && Boolean(sky) && picked.open && picked.tab.includes('ws-sky') && same(picked.on, ['sky']) && Boolean(auto) && shut === true,
      JSON.stringify({ dots, landed, next, picked }));

    // the search box knows them, and the New chat panel puts the folders of the workspace in front first
    await exec('Palette.open()');
    await wait(300);
    await typeInto('#palette input', 'workspace');
    await wait(150);
    // what is found can also be a past conversation of his, or something he typed: only the commands are looked at
    const found = await inPage(() => [...document.querySelectorAll('#palette .pal-item')].filter((el) => (el.querySelector('.from') || {}).textContent === 'Do').map((el) => el.querySelector('.label').textContent));
    await inPage(() => { const hit = [...document.querySelectorAll('#palette .pal-item')].find((el) => el.querySelector('.label').textContent === 'Workspace: Studio'); if (hit) hit.click(); return Boolean(hit); });
    await wait(250);
    sp = await spacesNow();
    const boxShut = (await exec('document.getElementById("palette").hidden')) === true;
    await exec('Desk.openPicker()');
    await wait(200);
    // the folders further down the panel can be his: only the first one, which is made up, is looked at
    const panel = await inPage(() => {
      const first = document.querySelector('#picker .folders .pick');
      const note = document.querySelector('#picker .pick-note');
      return { tag: first ? (first.querySelector('.tag') || { textContent: '' }).textContent : '', madeUp: Boolean(first) && /\\(pricing|api)$/.test(first.querySelector('.path').textContent),
        note: note && !note.hidden ? note.textContent : '' };
    });
    await exec('Picker.close()');
    check('the search box goes to a workspace, and the New chat panel lists the folders of the one in front first, each with the workspace it is in',
      same(found.slice().sort(), ['New workspace', 'Workspace: Studio', 'Workspace: Upwork']) && sp.space === studio && boxShut
      && panel.tag === 'Studio' && panel.madeUp && panel.note === 'A folder that is in no workspace yet joins Studio. One that is in another workspace opens there.',
      `"workspace" finds the commands: ${found.join(' / ')}; the first folder offered is tagged "${panel.tag}"`);

    // Settings lists them with their folders; a folder is taken out, a workspace taken away, and with the last one gone the tabs go too
    await exec('Settings.open("spaces")');
    await wait(200);
    const setNow = () => inPage(() => {
      const part = document.querySelector('#settings section[data-section="spaces"]');
      return { rows: [...part.querySelectorAll('.space-row[data-space] .name-input')].map((f) => f.value), folders: [...part.querySelectorAll('.space-folder .what b')].map((b) => b.textContent),
        fresh: Boolean(part.querySelector('.space-new')), focus: Boolean(document.activeElement) && part.contains(document.activeElement), keys: document.querySelectorAll('#settings .keys kbd').length };
    });
    const shownIn = await setNow();
    await exec(`document.querySelector('#settings section[data-section="spaces"] .space-folder .mini').click()`);
    await wait(200);
    const fewer = await setNow();
    await exec(`[...document.querySelectorAll('#settings section[data-section="spaces"] .space-row[data-space] .btn')].pop().click()`);
    await wait(200);
    const one = await setNow();
    await exec('Settings.close()');
    await unsee();
    sp = await spacesNow();
    const kept = await until(async () => same(keptSpaces(), [['Upwork', []]]) && settingsNow().space === '', 3000, 100);
    await call('removeSpace', clients);
    await wait(200);
    const none = await spacesNow();
    const cleared = await until(async () => settingsNow().spaces.length === 0 && same(onDisk(), []), 4000, 150);
    check('Settings lists the workspaces with their folders: a folder can be taken out, a workspace taken away, and with the last one gone the tabs go too',
      same(shownIn.rows, ['Upwork', 'Studio']) && same(shownIn.folders, ['shop', 'pricing', 'api']) && shownIn.fresh && shownIn.focus && shownIn.keys === 27
      && same(fewer.rows, ['Upwork', 'Studio']) && same(fewer.folders, ['pricing', 'api']) && fewer.focus && same(one.rows, ['Upwork']) && same(one.folders, []) && one.focus
      && same(tabsOf(sp), ['All*', 'Upwork', 'Unsorted 3']) && Boolean(kept)
      && !none.on && none.tabs.length === 0 && none.label === 'Chats' && none.count === '9' && none.keys.length === 9 && none.spaces.length === 0 && !none.loose && Boolean(cleared),
      `listed: ${shownIn.rows.join(', ')} with ${shownIn.folders.join(', ')}; after taking Studio away: ${tabsOf(sp).join(', ')}; with none left: "${none.label} ${none.count}"`);
    await exec('document.getElementById("toast").hidden = true');
  };

  // ---- every state a row of the list can be in, a chat looked at and read, History, the Dashboard, the search box, Settings ----
  const statesPhase = async () => {
    const real = watch.latest();
    // the real watcher holds its tongue for ten minutes, so nothing replaces the made-up rows mid-picture
    watch.post({ type: 'pace', ms: 600000 });
    await wait(700);
    // the made-up day is always twenty to four in the afternoon, whenever the test runs: the charts have a day to show
    const afternoon = new Date();
    afternoon.setHours(15, 40, 0, 0);
    madeAt = await inPage(pageClock, afternoon.getTime() - Date.now());
    const now = madeAt;
    await installFakes();
    await showUsage('today');
    await exec(`Desk.state.res = ${JSON.stringify(madeUpRes())}`);
    await exec(`takeSnapshot(${fake(now, madeUpRows(false))})`);
    await exec(`takeSnapshot(${fake(now + 1, madeUpRows(true))})`);
    await wait(250);
    let list = await inPage(pageList);
    check('every state draws in the list, grouped by what it wants from you: who waits, who finished unseen, who works, who is idle',
      same(list.groups, { needs: 3, done: 1, working: 4, idle: 1 }) && same(list.order, ['needs', 'done', 'working', 'idle']) && list.total === '9' && list.away === 9 && list.here === 0 && !list.overflow,
      `${JSON.stringify(list.groups)}, ${list.total} in all`);
    // another account logging in is said in the window (here: the made-up one taking over from the real one)
    const said = await exec('document.getElementById("toast").textContent');
    check('a change of account is said in the window', /^Now on studio@example\.com\. When last seen: /.test(said), /^Now on studio@example\.com/.test(said) ? `"${said}"` : 'the line at the bottom said something else');

    const rows = await inPage(() => {
      const all = [...document.querySelectorAll('#chat-list .nav-item.chat')];
      const by = (key) => all.find((el) => el.dataset.key === key);
      const when = (key) => { const el = by(key).querySelector('.when'); return el ? (el.classList.contains('needs') ? '!' : '') + el.textContent : null; };
      // what a row says it used: its cost, its folder, how full its memory is, its RAM, the tokens it wrote ('-' where it says nothing)
      const used = (key) => ['.m-cost', '.m-folder', '.m-mem', '.m-ram', '.m-tok'].map((sel) => { const x = by(key).querySelector(sel); return x && !x.hidden ? x.textContent : '-'; }).join(' | ');
      const triage = document.getElementById('triage');
      return {
        order: all.map((el) => el.dataset.key),
        marks: Object.fromEntries(all.map((el) => [el.dataset.key, el.dataset.mark])),
        glyphs: all.filter((el) => el.querySelector('.glyph')).length,
        waits: Object.fromEntries(['job:abc12345', 's-error', 's-permission', 's-finish'].map((k) => [k, when(k)])),
        subs: ['s-permission', 's-agents', 's-idle', 's-error', 'job:abc12345'].map((k) => by(k).dataset.sub),
        out: all.filter((el) => el.querySelector('.out')).length,
        // the fourth line of a row's note: where it runs
        where: ['s-agents', 'job:abc12345'].map((k) => by(k).dataset.tip.split('\n\n')[0].split('\n')[3] || ''),
        used: Object.fromEntries(['s-agents', 's-words', 's-compact', 's-idle', 'codex:x', 's-permission'].map((k) => [k, used(k)])),
        memTone: ['s-agents', 's-compact'].map((k) => by(k).querySelector('.m-mem').className),
        tips: ['s-agents', 's-permission'].map((k) => by(k).dataset.tip.split('\n\n')[1] || ''),
        need: triage.hidden ? '' : triage.textContent,
      };
    });
    check('the list stands in the order of who needs you most: the one that has waited longest on top, then who finished unseen, who works, who is idle',
      same(rows.order, ['job:abc12345', 's-error', 's-permission', 's-finish', 'codex:x', 's-agents', 's-compact', 's-words', 's-idle']) && rows.need === '3 need you',
      `${rows.order.join(', ')}; the title bar says "${rows.need}"`);
    check('each row carries its mark, and a row that waits says for how long',
      same(rows.marks, { 's-permission': 'needs', 's-error': 'error', 'job:abc12345': 'needs', 's-agents': 'working', 's-words': 'working', 's-compact': 'compacting', 'codex:x': 'working', 's-finish': 'done', 's-idle': 'idle' })
      && rows.glyphs === 9 && rows.waits['job:abc12345'] === '!1h' && rows.waits['s-error'] === '!8m' && /^!\d\ds$/.test(rows.waits['s-permission'] || '') && /^\d\ds$/.test(rows.waits['s-finish'] || ''),
      `marks ${JSON.stringify(rows.marks)}; waiting ${JSON.stringify(rows.waits)}`);
    check('what a chat is doing is in its hover note, and a chat outside this window says where it runs without an arrow',
      same(rows.subs, ['Waiting for your permission', 'Agent · Compare competitor D', 'Idle', 'Stopped at a usage limit', 'Blocked until you answer']) && rows.out === 0
      && rows.where[0] === 'It runs in another terminal. Click to look at it, and to move it here.' && rows.where[1] === 'A background session: it runs outside every terminal. Click to look at it.',
      `${rows.subs.join(' | ')}; ${rows.out} arrows on the 9 rows running elsewhere`);
    check('a row says what it cost at the end of its first line, its folder and the tokens it wrote on its second, how full its memory is only once it fills up, and its RAM only from 1 GB; its note lists all of it and what it runs',
      same(rows.used, {
        's-agents': '$42 | pricing | memory 86% | 1.2 GB | 120k out', 's-words': '$6.40 | shop | - | - | 388k out', 's-compact': '- | shop | memory 100% | - | 388k out',
        's-idle': '$3.10 | shop | - | - | 388k out', 'codex:x': '- | api | - | - | -', 's-permission': '$18 | shop | memory 96% | - | 388k out' })
      && same(rows.memTone, ['m-mem warm', 'm-mem hot'])
      && rows.tips[0] === 'This session holds 1.2 GB of RAM in 14 programs and uses 14% of the processor.\nThe agent itself: 612 MB\nvite: 233 MB\npython (2): 230 MB\nMCP servers (2): 135 MB\nA server is up on :5173\nRAM as Task Manager counts it.\nIt runs: vite · python · 3 subagents · 2 MCP servers'
      && rows.tips[1].startsWith('This session holds 514 MB of RAM in 7 programs and uses <1% of the processor.'),
      `${JSON.stringify(rows.used)}; memory: ${rows.memTone.join(', ')}`);

    // under the list: a limit that was reached, the account in use, and the other places of the window
    const foot = await inPage(() => {
      const acct = document.getElementById('acct');
      const lim = document.getElementById('side-limit');
      const places = document.querySelector('#side .places');
      return {
        limit: lim.hidden ? '' : lim.textContent, name: (acct.querySelector('.acct-name') || {}).textContent || '', plan: (acct.querySelector('.acct-plan') || {}).textContent || '',
        slims: [...acct.querySelectorAll('.slim')].map((x) => `${x.className.replace('slim', '').trim()}:${x.textContent}`), ticks: acct.querySelectorAll('.track u').length,
        tip: (acct.querySelector('.slim') || { dataset: {} }).dataset.tip || '', room: (acct.querySelector('.acct-room') || {}).textContent || '',
        places: [...places.querySelectorAll('.nav-item .label')].map((x) => x.textContent),
        cut: places.scrollWidth > places.clientWidth + 1 || [...places.querySelectorAll('.nav-item')].some((x) => x.scrollWidth > x.clientWidth + 1),
        counts: document.querySelectorAll('#side .count').length,
      };
    });
    check('a usage limit that was reached stands under the list until it lifts', /^5-hour limit reachedlifts in 4[12]m$/.test(foot.limit), `"${foot.limit}"`);
    check('under the list, the account in use with its two limits, where they are heading, and the other account with the most room',
      foot.name === 'studio' && foot.plan === 'Max 20x' && foot.slims.length === 2 && /^warm:5h86%2h \d\dm$/.test(foot.slims[0]) && /^:Week41%3d \dh$/.test(foot.slims[1]) && foot.ticks === 2
      && /At that pace it is used up at \d\d:\d\d: \d+m before it resets\./.test(foot.tip) && foot.room === 'most room: client-work',
      `${foot.name} · ${foot.plan} · ${foot.slims.join(' | ')} · "${foot.room}"`);
    check('then History and the Dashboard, each named in full, and not one figure of the day', same(foot.places, ['History', 'Dashboard']) && !foot.cut && foot.counts === 0, foot.places.join(', '));
    const blank = await inPage(pagePeek);
    check('with no chat open here and none picked, the panel is the start page: it offers to bring the chats of other terminals here, and holds no figure',
      blank.start === START && same(blank.buttons, ['New chat', 'Bring all 7 here', 'History']) && blank.figures === 0 && !blank.pane,
      `"${blank.start}"; it offers: ${blank.buttons.join(' / ')}; figures on the main screen: ${blank.figures}`);
    say(`      a picture waits for the page to draw: ${await drawn()}`);
    await shoot('0-list');

    // ---- one chat that runs elsewhere, looked at: what it is doing, its subagents, its numbers ----
    await pick('s-agents');
    await wait(300);
    list = await inPage(pageList);
    let pane = await inPage(pageDetail, 'peek');
    check('a chat that runs elsewhere, picked in the list, takes the panel: what it is doing, what was asked, its tool calls, its subagents, and the button that moves it here',
      list.view === 'peek' && list.picked === 1 && list.sel === 's-agents' && pane.shown && pane.title === 'Pricing research' && pane.words === 'Agent · Compare competitor D' && pane.mark === 'working' && pane.button === 'Bring here'
      && same(pane.tabs, ['Overview*', 'Conversation', 'Changes', 'Subagents3', 'Numbers']) && same(pane.heads, ['You last asked', 'Its latest words', 'While you were away', 'This turn', 'Subagents', 'On this computer', 'About'])
      // the facts under its title: how full the model's memory is, then what its programs hold on this computer, then the rest
      && pane.calls === 5 && pane.agents === 4 && pane.facts.length === 8 && pane.facts[1] === '1.2 GBRAM · CPU 14%:5173' && !(await inPage(pageSpill, 'peek')) && !list.overflow,
      `"${pane.title}" · ${pane.words} · tabs: ${pane.tabs.join(', ')} · ${pane.heads.join(', ')} · ${pane.calls} tool calls, ${pane.agents} subagents · ${pane.facts.join(' · ')}`);
    const own = await inPage(() => {
      const box = document.querySelector('#peek .d-body .res-box');
      return { note: box.querySelector('.sec-head .note').textContent, head: box.querySelector('.res-row.head').textContent,
        rows: [...box.querySelectorAll('.res-row:not(.head)')].map((r) => ['.res-what', '.res-mem', '.res-cpu'].map((sel) => r.querySelector(sel).textContent).join(' | ')),
        ports: [...box.querySelectorAll('.port')].map((p) => p.textContent), wide: box.scrollWidth > box.clientWidth + 1 };
    });
    check('its page lists what it runs on this computer: the agent itself, then each program it started, with its RAM, its processor share and its port',
      own.note === '1.2 GB RAM · 14% CPU · 14 programs' && own.head === 'RAMCPU' && same(own.rows, [
        'Claude Codethe agent itself · 3 subagents working inside it | 612 MB | 9%', 'vitea server · 3 programs:5173 | 233 MB | 4%', 'pythona command it runs · 2 programs | 199 MB | <1%',
        '@playwright/mcpMCP server · 3 programs | 88 MB | 0%', 'mcp_serverMCP server · 3 programs | 47 MB | 0%', 'pythonstarted with the session · 2 programs | 31 MB | 0%'])
      && same(own.ports, [':5173']) && !own.wide, `"${own.note}"; ${own.rows.length} lines: ${own.rows.join(' ; ')}`);
    // a newer measurement changes those figures alone: the rest of the page and the chat's row in the list are the same nodes as before
    const mark = await inPage(() => {
      document.querySelector('#peek .d-body .tl-row').dataset.kept = '1';
      [...document.querySelectorAll('#chat-list .nav-item.chat')].find((el) => el.dataset.key === 's-agents').dataset.kept = '1';
      return true;
    });
    const newer = madeUpRes();
    newer.sessions['s-agents'].own.mem = 700 * MB;
    newer.sessions['s-agents'].mem += 88 * MB;
    await exec(`Desk.state.res = ${JSON.stringify(newer)}; paint()`);
    await wait(150);
    const redrawn = await inPage(() => {
      const row = [...document.querySelectorAll('#chat-list .nav-item.chat')].find((el) => el.dataset.key === 's-agents');
      return { first: document.querySelector('#peek .d-body .res-row:not(.head) .res-mem').textContent, note: document.querySelector('#peek .d-body .res-box .sec-head .note').textContent,
        kept: Boolean(document.querySelector('#peek .d-body .tl-row[data-kept="1"]')), row: row.querySelector('.m-ram').textContent, sameRow: row.dataset.kept === '1' };
    });
    check('a newer measurement changes those figures in place, on its page and on its row in the list, without redrawing either', Boolean(mark) && redrawn.first === '700 MB' && redrawn.note === '1.3 GB RAM · 14% CPU · 14 programs' && redrawn.kept
      && redrawn.row === '1.3 GB' && redrawn.sameRow, `Claude Code itself now "${redrawn.first}", the session "${redrawn.note}", its row "${redrawn.row}"; the tool calls above were left as they were: ${redrawn.kept}`);
    await exec(`Desk.state.res = ${JSON.stringify(madeUpRes())}; paint()`);
    await shoot('0-session');
    await tabOf('peek', 'agents');
    await wait(150);
    const tree = await inPage(() => ({ rows: document.querySelectorAll('#peek .d-body .ag-row').length, depth: document.querySelector('#peek .ag-row[data-agent="price-table"]').style.getPropertyValue('--depth'),
      read: document.querySelectorAll('#peek .ag-row .ag-end .btn').length, doing: document.querySelector('#peek .ag-row[data-agent="competitor-d"] .ag-line').textContent,
      note: document.querySelector('#peek .d-body .sec-head .note').textContent }));
    check('its subagents are drawn as a tree, each under the one that started it', tree.rows === 4 && tree.depth === '1' && tree.read === 4 && tree.doing === 'WebFetch · competitor-d.example'
      && tree.note === '3 working · 1 finished in the last half hour · 7 in all', `${tree.rows} subagents, "${tree.note}"`);
    await shoot('0-subagents');
    // a subagent's own conversation can be read, and the way back is one click
    await exec(`document.querySelector('#peek .ag-row[data-agent="competitor-d"] .ag-end .btn').click()`);
    await wait(250);
    const sub = await inPage(pageReader, 'peek');
    const crumb = await inPage(() => {
      const el = document.querySelector('#peek .crumb');
      const r = el.getBoundingClientRect();
      const body = document.querySelector('#peek .d-body').getBoundingClientRect();
      return { words: (el.querySelector('.quiet') || {}).textContent || '', who: (document.querySelector('#peek .rd-ask .who') || {}).textContent || '',
        tab: (document.querySelector('#peek .seg.tabs button.on') || {}).textContent || '', seen: !el.hidden && r.height > 0 && r.bottom <= body.top + 1 };
    });
    await shoot('0-subagent-reading');
    await exec(`document.querySelector('#peek .crumb .btn').click()`);
    await wait(250);
    const mainAgain = await inPage(pageReader, 'peek');
    check("a subagent's own conversation can be read, and one click leads back to the main one",
      crumb.words === 'Subagent: competitor-d' && crumb.seen && crumb.who === 'The brief it was given' && crumb.tab === 'Conversation' && sub.asks === 1 && sub.tools === 2 && sub.running === 1 && sub.says === 1
      && mainAgain.asks === 1 && mainAgain.tools === 5 && mainAgain.running === 2 && (await exec('document.querySelector("#peek .crumb").hidden')),
      `the subagent: ${sub.asks} brief, ${sub.tools} tool calls (${sub.running} running), ${sub.says} said; back on the main one: ${mainAgain.tools} tool calls`);
    await tabOf('peek', 'numbers');
    await wait(150);
    const nums = await inPage(() => ({ heads: [...document.querySelectorAll('#peek .d-body .sec-head h4')].map((x) => x.textContent), cells: document.querySelectorAll('#peek .nums > *').length,
      now: [...document.querySelectorAll('#peek .d-body .plist dt')].map((x) => x.textContent), area: document.querySelectorAll('#peek .area path').length, pulse: document.querySelectorAll('#peek .pulse-box .spark').length,
      foot: (document.querySelector('#peek .area-foot') || {}).textContent || '' }));
    check('its numbers: today against all time, what it last told its status line, its memory reply after reply, and its last half hour',
      same(nums.heads, ['Numbers', 'Right now', 'Memory, reply after reply', 'The last 30 minutes']) && nums.cells === 27 && same(nums.now, ['Used so far', 'Lines changed', 'Cache']) && nums.area === 3 && nums.pulse === 1
      && /now 402k of about 467k/.test(nums.foot), `${nums.heads.join(', ')}; ${nums.cells} cells; "${nums.foot}"`);
    await shoot('0-numbers');
    await tabOf('peek', 'overview');

    // ---- moving on: a chat that finished unseen counts as seen once another is looked at; Esc leaves ----
    await pick('s-finish');
    await wait(200);
    const unseen = { list: await inPage(pageList), pane: await inPage(pageDetail, 'peek') };
    await pick('s-permission');
    await wait(200);
    list = await inPage(pageList);
    pane = await inPage(pageDetail, 'peek');
    check('a chat that finished unseen says so while it is looked at, and counts as seen once you move on to another',
      unseen.list.sel === 's-finish' && unseen.pane.mark === 'done' && unseen.pane.words === 'Finished' && unseen.list.groups.done === 1
      && list.sel === 's-permission' && list.picked === 1 && same(list.groups, { needs: 3, working: 4, idle: 2 }) && pane.mark === 'needs' && pane.notice === 'Waiting for your permission' && pane.tabs[0] === 'Overview*',
      `looked at, it says "${unseen.pane.words}"; after moving on the groups are ${JSON.stringify(list.groups)}; the next one says "${pane.notice}"`);
    await shoot('0-needs-you');
    await inPage(pageKey, 'Escape');
    await wait(150);
    const closed = { list: await inPage(pageList), peek: await inPage(pagePeek) };
    check('Esc leaves the chat that was looked at', closed.list.picked === 0 && closed.list.sel === '' && !closed.peek.pane && closed.peek.start === START);

    // ---- a conversation, read: what was asked, what was said, every tool call, edits as changed lines ----
    await pick('s-words');
    await wait(300);
    pane = await inPage(pageDetail, 'peek');
    const still = await exec(`(document.querySelector('#peek .d-state .timer.still:not([hidden])') || {}).textContent || ''`);
    await tabOf('peek', 'conv');
    await wait(250);
    let read = await inPage(pageReader, 'peek');
    check('a conversation is laid out to be read: what was asked, what was said, each tool call, and the marks between turns',
      pane.title === 'Invoice export bug' && /^quiet \dm$/.test(still) && same(pane.tabs.slice(0, 3), ['Overview*', 'Conversation', 'Changes2'])
      && read.asks === 2 && read.says === 3 && read.tools === 7 && read.failed === 1 && read.running === 1 && read.thoughts === 2 && read.turns === 1 && read.marks === 1 && read.notes === 1 && read.days === 1
      && read.tables === 1 && read.code === 1 && read.lists === 2 && read.headings === 1 && /^Read from \d\d:\d\d on\.Read further back$/.test(read.top) && read.asked === '2 asked',
      `${read.asks} asked, ${read.says} said, ${read.tools} tool calls (${read.failed} failed, ${read.running} running), ${read.thoughts} thoughts, ${read.turns} turn end, ${read.marks} compaction, ${read.notes} summary; a table, a code block, a list; "${read.top}"`);
    await shoot('0-conversation');
    await exec(`document.querySelector('#peek .rd-list .md-table').scrollIntoView({ block: 'center' })`);
    await shoot('0-conversation-reply');
    const paneAt = () => exec(`document.querySelector('#peek .d-body').scrollTop`);
    const leftAt = await paneAt();
    await tabOf('peek', 'changes');
    await wait(150);
    const changesAt = await paneAt();
    await tabOf('peek', 'conv');
    await wait(150);
    const backAt = await paneAt();
    check('the list of changed files opens at its top, and the conversation is back where it was being read', leftAt > 0 && changesAt === 0 && backAt === leftAt,
      `left ${leftAt} px down; the changes open at ${changesAt}; back at ${backAt}`);
    // a tool call unfolds into what it was given and what came back; an edit shows the lines it changed
    await inPage(() => {
      const tools = [...document.querySelectorAll('#peek .rd-list .rd-tool')];
      tools.find((t) => t.querySelector('.t-name').textContent === 'Edit').querySelector('.rd-tool-head').click();
      [...document.querySelectorAll('#peek .rd-list .rd-tool')].find((t) => t.classList.contains('err')).querySelector('.rd-tool-head').click();
      return true;
    });
    await wait(150);
    read = await inPage(pageReader, 'peek');
    const unfolded = await inPage(() => ({ numbers: [...document.querySelectorAll('#peek .rd-tool.open .diff .dl')].slice(0, 3).map((l) => [...l.querySelectorAll('.ln')].map((n) => n.textContent).join('/')),
      delta: (document.querySelector('#peek .rd-tool.open .diff-head .delta') || {}).textContent || '', bad: document.querySelectorAll('#peek .rd-tool.open .t-pre.t-out.bad').length,
      failed: (document.querySelector('#peek .rd-tool.err .t-err') || {}).textContent || '', turn: (document.querySelector('#peek .rd-turn') || {}).textContent || '' }));
    check('a tool call unfolds into what it was given and what came back, and an edit shows its changed lines with their line numbers',
      read.open === 2 && read.diffLines === 10 && read.added === 5 && read.removed === 2 && same(unfolded.numbers, ['21/21', '22/22', '23/']) && unfolded.delta === '+5−2' && unfolded.bad === 1 && unfolded.failed === 'failed'
      && /^Turn over after 6m 52s · \d\d:\d\d · 5 tool calls · 2 files changed · 10k tokens out$/.test(unfolded.turn),
      `${read.diffLines} lines in the change (${unfolded.delta}), numbered ${unfolded.numbers.join(' ')}; the failed call shows its output; "${unfolded.turn}"`);
    await exec(`document.querySelector('#peek .rd-tool.open').scrollIntoView({ block: 'start' })`);
    await shoot('0-conversation-diff');
    // further back, a page at a time
    await exec('window.deskFake.older = true');
    await exec(`document.querySelector('#peek .rd-top .btn').click()`);
    await wait(250);
    read = await inPage(pageReader, 'peek');
    const whole = read;
    await exec(`document.querySelector('#peek .rd-bar .seg button[data-mode="words"]').click()`);
    await wait(100);
    const words = await inPage(pageReader, 'peek');
    await exec(`document.querySelector('#peek .rd-bar .seg button[data-mode="asks"]').click()`);
    await wait(100);
    const asks = await inPage(pageReader, 'peek');
    await exec(`document.querySelector('#peek .rd-bar .seg button[data-mode="all"]').click()`);
    await typeInto('#peek .rd-find input', 'decimals');
    await wait(100);
    const found = await inPage(pageReader, 'peek');
    await typeInto('#peek .rd-find input', '');
    check('it reads further back a page at a time, folds the tool calls away, shows only the prompts, and finds a word',
      whole.asks === 3 && whole.says === 4 && whole.tools === 9 && whole.turns === 2 && whole.top === 'This is where the conversation begins.' && whole.asked === '3 asked'
      && words.tools === 0 && words.thoughts === 0 && words.runs === 5 && words.says === 4 && asks.asks === 3 && asks.says === 0 && asks.tools === 0 && asks.turns === 2
      && found.says === 2 && found.asks === 0 && found.tools === 0,
      `whole: ${whole.asks} asked, ${whole.tools} tool calls, "${whole.top}"; words only: ${words.runs} folded runs; prompts only: ${asks.asks}; "decimals" is in ${found.says} replies`);
    // a conversation that is still being written is kept up with; read further up, the new lines are announced instead of moving the page
    await exec(`document.querySelector('#peek .d-body').scrollTop = 0; window.deskFake.grown = true`);
    for (let i = 0; i < 3; i++) await exec('Desk.Peek.detail().reader.tick()');
    const jumped = await until(async () => { const r = await inPage(pageReader, 'peek'); return r.jump ? r : null; }, 5000);
    await exec(`document.querySelector('#peek .rd-jump').click()`);
    await wait(100);
    const after = await inPage(pageReader, 'peek');
    await tabOf('peek', 'changes');
    await wait(150);
    const files = () => inPage(() => ({ sum: (document.querySelector('#peek .chg-sum') || {}).textContent || '', where: (document.querySelector('#peek .chg-top .quiet') || {}).textContent || '',
      files: [...document.querySelectorAll('#peek .chg-file')].map((f) => `${f.querySelector('.f-name').textContent} ${f.querySelector('.delta').textContent} ${f.querySelector('.f-n').textContent}${f.querySelector('.chip') ? ' new' : ''}`),
      edits: document.querySelectorAll('#peek .chg-file.open .chg-edit').length, lines: document.querySelectorAll('#peek .chg-file.open .dl').length,
      tab: (document.querySelector('#peek .seg.tabs button.on') || {}).textContent || '' }));
    let changes = await files();
    await exec(`[...document.querySelectorAll('#peek .chg-file')].find((f) => f.querySelector('.f-name').textContent === 'export.ts').querySelector('.chg-head').click()`);
    await wait(100);
    const opened = await files();
    check('new lines of a running conversation arrive by themselves: the call that was running comes back, and the page stays where it is being read',
      Boolean(jumped) && jumped.jump === '1 new below' && jumped.running === 0 && jumped.says === 5 && jumped.new === 1 && after.jump === '',
      jumped ? `"${jumped.jump}", ${jumped.running} still running, ${jumped.says} replies` : 'nothing arrived');
    check('the files a conversation changed are listed, each with every edit made to it',
      changes.sum === '3 files changed +18−4' && changes.where === 'In the whole conversation.' && changes.tab === 'Changes3'
      && same(changes.files, ['pdf.ts +1−1 1 edit', 'export.ts +6−3 2 edits', 'export.test.ts +11 1 edit new']) && opened.edits === 2 && opened.lines === 14,
      `${changes.sum}: ${changes.files.join(' ; ')}; export.ts unfolds into ${opened.edits} edits, ${opened.lines} lines`);
    await shoot('0-changes');
    await tabOf('peek', 'overview');
    await inPage(pageKey, 'Escape');
    await wait(150);

    // what floats over the page: a menu, a hover note and the line at the bottom
    await inPage(() => {
      window.deskMenu = popMenu(820, 250, [{ heading: 'This chat' }, { label: 'Rename', icon: 'pencil', run() {} }, { label: 'Open its folder', icon: 'folder', run() {} },
        { label: 'Copy the session id', icon: 'copy', run() {} }, null, { label: 'Close this chat', icon: 'x', key: 'Ctrl Shift W', danger: true, run() {} }]);
      const tip = document.getElementById('tip');
      tip.textContent = '86% of the 5-hour limit is used, as Claude Code last reported it (15:39).\nIt resets 18:04.\nLately it grows by about 9.5% an hour.\nClaude Code is told this with each reply. Nothing here asks Anthropic.';
      tip.hidden = false;
      tip.style.transform = 'translate(470px, 330px)';
      toast('Now on studio@example.com. When last seen: 5-hour at least 86%, week at least 41%.', 9000);
      return true;
    });
    await shoot('0-floating', true);
    await inPage(() => { window.deskMenu(); document.getElementById('tip').hidden = true; return true; });

    // ---- a narrower and a wider window; the sidebar folded away ----
    const [wide0, tall0] = win.getContentSize();
    const sideWide = await exec('Math.round(document.getElementById("side").getBoundingClientRect().width)');
    win.setContentSize(980, 700);
    await wait(350);
    const slim = await inPage(pageList);
    const slimStart = await inPage(pagePeek);
    await pick('s-agents');
    await wait(250);
    const slimPane = await inPage(() => { const b = document.querySelector('#peek .d-body');
      return { side: Math.round(document.getElementById('side').getBoundingClientRect().width), pane: document.querySelector('#peek .detail').clientWidth, stage: document.getElementById('main').clientWidth,
        spill: document.documentElement.scrollWidth > document.documentElement.clientWidth || b.scrollWidth > b.clientWidth + 1, at: b.scrollTop, more: b.scrollHeight - b.clientHeight }; });
    await shoot('0-narrow-session');
    await inPage(pageKey, 'Escape');
    win.setContentSize(1760, 1000);
    await wait(350);
    const broad = await inPage(pageList);
    const broadSpill = await inPage(pageSpill, 'peek');
    const broadSize = win.getContentSize();
    // In a wide window the page of a chat is wider than the column its text stands in. Its bar, its title, its
    // tabs and what is under them must then start on the same line, whichever tab is open, and end on one too.
    win.setContentSize(1920, 1040);
    await wait(350);
    await pick('s-agents');
    await wait(300);
    const edges = () => inPage(() => {
      const pane = document.querySelector('#peek .detail');
      const box = (sel) => { const el = pane.querySelector(sel); return el ? el.getBoundingClientRect() : null; };
      const left = (sel) => { const b = box(sel); return b ? Math.round(b.left) : null; };
      const body = pane.querySelector('.d-body');
      // the column that holds what is open: the overview, the conversation, or the list of changed files. Its text starts after its padding.
      const inside = body.querySelector('.d-wrap, .rd-list, .changes');
      const col = inside.getBoundingClientRect();
      const pad = getComputedStyle(inside);
      const bar = body.querySelector('.rd-bar > *');
      const edge = pane.getBoundingClientRect();
      return { pane: Math.round(edge.width), from: Math.round(edge.left), state: left('.d-state'), title: left('.d-title'), facts: left('.d-facts'), tabs: left('.d-tabs .seg'),
        body: Math.round(col.left + parseFloat(pad.paddingLeft)), right: Math.round(col.right - parseFloat(pad.paddingRight)), reader: bar ? Math.round(bar.getBoundingClientRect().left) : null,
        acts: Math.round(box('.d-acts').right), spill: body.scrollWidth > body.clientWidth + 1 };
    });
    const lined = { overview: await edges() };
    await shoot('0-wide-session');
    await tabOf('peek', 'conv');
    await until(() => exec('Desk.Peek.detail().reader.state() === "ready"'), 5000);
    await wait(250);
    lined.conv = await edges();
    await tabOf('peek', 'changes');
    await wait(250);
    lined.changes = await edges();
    await tabOf('peek', 'overview');
    await inPage(pageKey, 'Escape');
    const inLine = (e) => e.state === e.title && e.title === e.facts && e.facts === e.tabs && e.tabs === e.body && (e.reader === null || e.reader === e.body) && !e.spill;
    const wideSize = win.getContentSize();
    check('in a wide window the bar, the title and the tabs of a chat that is looked at stand in line with what is under them, on every tab',
      // only a page wider than its column (880 px) puts this to the test: on a small screen the window cannot be made that wide
      lined.overview.pane > 1000 && lined.overview.body - lined.overview.from > 60
      && inLine(lined.overview) && inLine(lined.conv) && inLine(lined.changes) && lined.overview.body === lined.conv.body && lined.conv.body === lined.changes.body
      // the buttons at the right end of the bar reach past the column by the room an icon button keeps around its drawing
      && lined.overview.acts - lined.overview.right === 14,
      `window ${wideSize.join(' x ')}, a page of ${lined.overview.pane} px: the bar, the title, the facts, the tabs and the text start ${lined.overview.body - lined.overview.from} px in on the overview `
      + `(${[lined.overview.state, lined.overview.title, lined.overview.facts, lined.overview.tabs, lined.overview.body].join(', ')}), ${lined.conv.body - lined.conv.from} px in on the conversation `
      + `(${[lined.conv.state, lined.conv.tabs, lined.conv.reader, lined.conv.body].join(', ')}), ${lined.changes.body - lined.changes.from} px in on the changes; the bar's buttons end ${lined.overview.acts - lined.overview.right} px past the column`);
    win.setContentSize(wide0, tall0);
    await wait(350);
    check('in a narrow window the list on the left keeps its width, and a chat that is looked at takes the whole panel',
      !slim.overflow && slimStart.start === START && slimPane.side === sideWide && slimPane.pane > 600 && Math.abs(slimPane.pane - slimPane.stage) <= 2 && !slimPane.spill && !broad.overflow && !broadSpill,
      `980 x 700: the list keeps its ${slimPane.side} px, the chat looked at takes ${slimPane.pane} px of a ${slimPane.stage} px panel; nothing spills at ${broadSize.join(' x ')} either`);
    check('a chat that is looked at opens at the top of its overview, however long its conversation is', slimPane.at === 0 && slimPane.more > 0,
      `${slimPane.more} px of it are below the fold, and it stands at ${slimPane.at}`);
    await exec('document.getElementById("side-toggle").click()');
    await wait(200);
    const folded = await inPage(() => ({ off: document.body.classList.contains('no-side'), side: document.getElementById('side').getClientRects().length, stage: document.getElementById('main').clientWidth, window: window.innerWidth }));
    await exec('document.getElementById("side-toggle").click()');
    await wait(200);
    check('the sidebar folds away and comes back', folded.off && folded.side === 0 && folded.stage > folded.window - 24 && !(await exec('document.body.classList.contains("no-side")')),
      `folded: the panel is ${folded.stage} px of a ${folded.window} px window`);

    // ---- the list: a group folded, its menu, the pill in the title bar ----
    const groupAt = (name) => `#chat-list section.group[data-group="${name}"]`;
    await exec(`document.querySelector('${groupAt('working')} .group-head').click()`);
    await wait(150);
    const shut = await inPage((sel) => { const g = document.querySelector(sel);
      return { folded: g.classList.contains('folded'), tall: g.querySelector('.group-rows').clientHeight, count: g.querySelector('.g-n').textContent, total: document.getElementById('side-n').textContent }; }, groupAt('working'));
    await exec(`document.querySelector('${groupAt('working')} .group-head').click()`);
    await wait(150);
    check('a group of the list folds away and keeps its count', shut.folded && shut.tall === 0 && shut.count === '4' && shut.total === '9'
      && !(await exec(`document.querySelector('${groupAt('working')}').classList.contains('folded')`)), `folded: ${shut.tall} px tall, still says ${shut.count}; the list still counts ${shut.total}`);
    await exec('document.getElementById("side-more").click()');
    await wait(100);
    const listMenu = await exec(`[...document.querySelectorAll('#menu .menu-item')].map((b) => b.querySelector('span:not(.icon-gap)').textContent)`);
    await inPage(pageKey, 'Escape', '#menu');
    await wait(100);
    check('the menu above the list starts a chat, brings the chats of other terminals here, or makes a workspace', same(listMenu, ['New chat', 'Bring the 7 in other terminals here', 'New workspace…'])
      && (await exec('document.getElementById("menu").hidden')) === true, listMenu.join(' / '));

    // "N need you" in the title bar leads to the chat that has waited longest
    await exec('document.getElementById("triage").click()');
    await wait(250);
    list = await inPage(pageList);
    pane = await inPage(pageDetail, 'peek');
    check('"need you" in the title bar leads to the chat that has waited longest', list.view === 'peek' && list.sel === 'job:abc12345' && list.picked === 1 && pane.button === 'Open here'
      && pane.notice === 'Blocked until you answer' && same(pane.chips, ['background']), `${list.sel}: "${pane.notice}", button "${pane.button}"`);
    await exec('Desk.look(null)');

    // a chat that runs in another terminal: asked to come here, it is picked up the moment it ends over there
    const ghost = row({ key: 'ghost-1', session: '11111111-2222-4333-8444-555555555555', title: 'Chat in another terminal', cwd: 'Z:\\nowhere\\ghost', pid: 4242 });
    await exec(`takeSnapshot(${fake(now + 2, [ghost])})`);
    await pick('ghost-1');
    await wait(250);
    const offer = (await inPage(pageDetail, 'peek')).button;
    await exec(`document.querySelector('#peek .d-acts .btn').click()`);
    await wait(200);
    const armed = await inPage(() => {
      const item = [...document.querySelectorAll('#chat-list .nav-item.chat')].find((el) => el.dataset.key === 'ghost-1');
      const btn = document.querySelector('#peek .d-acts .btn');
      return { armed: Desk.state.armed.size, button: btn.textContent, cls: btn.className,
        notice: (document.querySelector('#notes > .callout:nth-child(2):not([hidden]) .callout-title') || {}).textContent || '',
        coming: Boolean(item && item.querySelector('.out.coming')), where: item ? item.dataset.tip.split('\n\n')[0].split('\n')[3] || '' : '' };
    });
    await shoot('0-bring-here');
    const gone = { id: ghost.session, name: '', named: false, title: ghost.title, cwd: ghost.cwd, mode: '', at: now, words: 'Last words before it was closed.', prompt: '', chat: '', cut: false };
    await exec(`takeSnapshot(${fake(now + 3, [], [gone])})`);
    // its folder does not exist, so the app refuses before any program is started: the whole chain ran, and nothing was launched
    const refused = await until(async () => { const t = await exec('document.getElementById("toast").textContent'); return /could not be opened here/.test(t) ? t : ''; }, 4000);
    check('a chat asked to come here is marked as on its way, the window says so above every view, and it is picked up when it ends in its own terminal',
      offer === 'Bring here' && armed.armed === 1 && armed.button === 'Waiting…' && /armed/.test(armed.cls)
      && armed.notice === '1 chat will open here as soon as you close it over there' && armed.coming && armed.where === 'It opens here as soon as you close it where it runs now.'
      && Boolean(refused) && chats.all.size === 0 && (await exec('Desk.state.armed.size')) === 0,
      `button "${offer}" then "${armed.button}", notice "${armed.notice}"; when it ended: "${refused}" (made-up folder, so nothing was started)`);
    await wait(200);
    list = await inPage(pageList);
    // the conversations that ended wait in a group of their own, folded until it is asked for
    const endedShut = await exec(`document.querySelector('${groupAt('ended')}').classList.contains('folded')`);
    await exec(`document.querySelector('#chat-list .nav-item.chat.k-ended').click()`);
    await wait(250);
    pane = await inPage(pageDetail, 'peek');
    await exec(`document.querySelector('#peek .d-acts .icon-btn[title="More"]').click()`);
    await wait(100);
    const menu = await exec(`[...document.querySelectorAll('#menu .menu-item')].map((b) => b.textContent)`);
    await exec(`[...document.querySelectorAll('#menu .menu-item')].find((b) => b.textContent === 'Take it off this list').click()`);
    await wait(200);
    const off = { list: await inPage(pageList), peek: await inPage(pagePeek) };
    check('a conversation that ended is listed with a way to pick it up again, and can be taken off the list',
      list.ended === 1 && list.groups.ended === 1 && endedShut && pane.words === 'Ended' && pane.button === 'Resume here' && same(pane.heads, ['Its last words', 'About']) && menu.length === 6
      && off.list.ended === 0 && !off.peek.pane && off.peek.start === START, `${list.ended} listed, its group folded at first: ${endedShut}; its page: "${pane.words}", "${pane.button}"; its menu: ${menu.join(' / ')}`);

    // ---- History: every conversation kept on this machine ----
    await exec('document.getElementById("toast").hidden = true');
    await exec(`takeSnapshot(${fake(now + 4, madeUpRows(true))})`);
    await exec('document.getElementById("go-history").click()');
    await until(() => exec('Desk.History.counts() === 8'), 4000);
    await wait(250);
    const history = () => inPage(() => {
      const root = document.getElementById('history');
      const groups = {};
      for (const g of root.querySelectorAll('section.group')) groups[g.dataset.group] = g.querySelectorAll('.row').length;
      return { view: Desk.state.view, rows: root.querySelectorAll('.row').length, groups, total: root.querySelector('.list-n').textContent,
        sel: Desk.History.selected(), picked: root.querySelectorAll('.row.sel').length, live: root.querySelectorAll('.row.live').length, marks: root.querySelectorAll('.row .glyph').length,
        blank: root.querySelector('.blank').hidden ? '' : root.querySelector('.blank h2').textContent, first: (root.querySelector('.row .row-say') || {}).textContent || '',
        names: [...root.querySelectorAll('.row .row-name, .row .find-title')].map((x) => x.textContent),
        by: [...root.querySelectorAll('.list-top .seg button')].map((b) => b.textContent + (b.classList.contains('on') ? '*' : '')),
        spill: document.documentElement.scrollWidth > document.documentElement.clientWidth || [...root.querySelectorAll('.split, .list-scroll, .d-body, .d-wrap')].some((el) => el.scrollWidth > el.clientWidth + 1) };
    });
    let hist = await history();
    pane = await inPage(pageDetail, 'history');
    check('History lists every conversation kept on this machine, newest first, and opens on the latest one',
      hist.view === 'history' && hist.rows === 8 && hist.total === '8' && Object.values(hist.groups).reduce((a, b) => a + b, 0) === 8 && Object.keys(hist.groups).length >= 4 && same(hist.by, ['By date*', 'By project'])
      && hist.sel === 'past-0' && hist.picked === 1 && hist.live === 2 && hist.marks === 2 && hist.first === 'shop · Opus 5.5 · 388k out · 6.5 MB'
      && hist.names[5] === 'Why does the login test fail one run in five? Look at the retries first.' && !hist.spill,
      `${hist.rows} conversations in ${JSON.stringify(hist.groups)}; ${hist.live} of them running; the first: ${hist.first}`);
    check('a past conversation shows what it came to, and offers to be picked up again',
      pane.shown && pane.title === 'Empty tax field breaks the export' && pane.words === 'Not running' && pane.mark === 'ended' && pane.button === 'Resume here' && same(pane.tabs, ['Overview*', 'Conversation', 'Changes3'])
      && same(pane.heads, ['You last asked', 'About']) && same(pane.facts, ['388k out', '512 replies', '730 tool calls', '6.5 MB on disk']),
      `"${pane.title}" · ${pane.words} · ${pane.tabs.join(', ')} · ${pane.facts.join(' · ')}`);
    await shoot('0-history');
    await tabOf('history', 'conv');
    await wait(250);
    const old = await inPage(pageReader, 'history');
    check('a past conversation can be read from its first line to its last', old.asks === 3 && old.says === 5 && old.tools === 9 && old.running === 0 && old.turns === 3 && old.top === 'This is where the conversation begins.',
      `${old.asks} asked, ${old.says} said, ${old.tools} tool calls, ${old.turns} turn ends; "${old.top}"`);
    await shoot('0-history-reading');
    await tabOf('history', 'overview');
    await exec(`document.querySelector('#history .list-top .seg button[data-by="project"]').click()`);
    await wait(150);
    const grouped = await history();
    await exec(`document.querySelector('#history .list-top .seg button[data-by="date"]').click()`);
    await typeInto('#history .filter-box input', 'quarterly');
    await wait(100);
    const one = await history();
    await typeInto('#history .filter-box input', '');
    await exec(`document.querySelector('#history .row[data-id="s-agents"]').click()`);
    await wait(250);
    const running = await inPage(pageDetail, 'history');
    await inPage(pageKey, 'Escape');
    await wait(150);
    hist = await history();
    check('History groups by project, finds a conversation by a word, shows a running one as it is now, and Esc goes back to the list',
      same(grouped.groups, { 'p:shop': 3, 'p:pricing': 1, 'p:landing': 1, 'p:reports': 1, 'p:api': 2 }) && one.rows === 1 && one.names[0] === 'Quarterly numbers'
      && running.title === 'Pricing research' && running.mark === 'working' && running.button === 'Bring here' && running.tabs.includes('Subagents3')
      && hist.sel === '' && hist.blank === '8 conversations on this machine' && hist.rows === 8,
      `by project: ${JSON.stringify(grouped.groups)}; "quarterly" finds ${one.rows}; the running one: ${running.words}; nothing picked: "${hist.blank}"`);
    // picking a past conversation up again: its folder does not exist, so the app refuses before any program is started
    await exec(`document.querySelector('#history .row[data-id="past-0"]').click()`);
    await wait(200);
    await exec(`document.querySelector('#history .d-acts .btn').click()`);
    const refused2 = await until(async () => { const t = await exec('document.getElementById("toast").textContent'); return /^Empty tax field breaks the export could not be opened here/.test(t) ? t : ''; }, 4000);
    check('"Resume here" on a past conversation asks for it to be opened in this window', Boolean(refused2) && chats.all.size === 0, `"${refused2}" (made-up folder, so nothing was started)`);
    await exec('document.getElementById("toast").hidden = true');

    // ---- the Dashboard: every number of the app lives here ----
    await exec('document.getElementById("go-stats").click()');
    await wait(300);
    const usageView = () => inPage(() => {
      const root = document.getElementById('stats');
      const all = (sel) => [...root.querySelectorAll(sel)];
      const text = (sel) => (root.querySelector(sel) || {}).textContent || '';
      return {
        figs: all('.kpis.ten .kpi > b').map((b) => b.textContent), bars: all('.bar-slot').length, panels: all('.sec.block:not([hidden])').length,
        money: {
          heads: all('.table:not(.accts) .tr.th').map((r) => [...r.children].map((c) => c.textContent).filter(Boolean).join('|')),
          costs: all('.table:not(.accts) .tr:not(.th) > b').filter((b) => /^\$[\d,.]+$/.test(b.textContent)).length,
          noPrice: all('.table .tr > span.quiet').filter((s) => s.textContent === 'no price').length,
          lanes: all('.lanes .lane:not(.axis) .lane-usd').map((b) => b.textContent),
          accts: all('.acct-tr .acct-use > b').map((b) => b.textContent),
          dayTip: (root.querySelector('.bar-slot') || { getAttribute: () => '' }).getAttribute('data-tip') || '',
          kpiTip: (root.querySelector('.kpis.ten .kpi') || { getAttribute: () => '' }).getAttribute('data-tip') || '',
          metric: (root.querySelector('.sec-head .seg button.on') || {}).textContent || '',
        },
        lines: all('.table:not(.accts) .tr:not(.th)').length, limits: all('.list-lines .line').length,
        accts: all('.acct-tr').map((r) => (r.classList.contains('here') ? '*' : '') + r.querySelector('.acct-name b').textContent),
        shares: all('.acct-tr .acct-share > span:not(.share)').map((x) => x.textContent),
        cells: all('.acct-tr .lim-cell').map((x) => `${x.className.replace('lim-cell', '').trim()}:${x.querySelector('.r').textContent}`),
        // where the limits of the account in use are heading, and which other account has the most room
        going: all('.acct-tr .lim-cell .go').map((x) => x.textContent), ticks: all('.acct-tr .track u').length,
        room: all('.acct-tr').filter((r) => [...r.querySelectorAll('.chip')].some((c) => c.textContent === 'most room')).map((r) => r.querySelector('.acct-name b').textContent),
        ribbon: all('.ribbon i').length, lanes: all('.lanes .lane:not(.axis)').length, lit: all('.lanes .cells i.on').length,
        stacks: all('.bar-slot i.stack').length, legend: all('.legend > span').length, buttons: all('.table .tr .btn').map((b) => b.textContent),
        note: (all('.sec.block:not(.run-sec):not(.feed-sec) > p.quiet')[0] || {}).textContent || '', foot: text('.foot-note'),
        range: all('.page-head .seg button').map((b) => b.textContent + (b.classList.contains('on') ? '*' : '')),
        title: text('.page-head .d-title'), first: all('.sec.block:not([hidden])').slice(0, 2).map((x) => x.className),
        run: { title: text('.run-sec .sec-head h3'), note: text('.run-sec .sec-head .note'),
          rows: all('.run-sec .run-row[role="button"]').map((r) => `${r.querySelector('.name').textContent} ${r.querySelector('.res-mem').textContent}`), rest: all('.run-sec .run-row.rest').length,
          servers: text('.run-sec .run-servers'), app: text('.run-sec .run-app') },
        feed: { title: text('.feed-sec .sec-head h3'), rows: all('.feed-sec .feed-row').length, running: all('.feed-sec .feed-row.running').length, cost: text('.feed-sec .cost-line') },
        overflow: root.scrollWidth > root.clientWidth + 1 || document.documentElement.scrollWidth > document.documentElement.clientWidth || root.querySelector('.d-wrap').scrollWidth > root.querySelector('.d-wrap').clientWidth + 1,
      };
    });
    let usage = await usageView();
    check('the Dashboard draws days, hours, projects, models, chats, tools, limits and when they reset', usage.title === 'Dashboard' && usage.figs.length === 10 && usage.bars === 78 && usage.panels === 16 && usage.lines === 25
      && usage.limits === 2 && same(usage.range, ['Today*', '7 days', '30 days']) && !usage.overflow && /^Counted from the 1,756 conversation files \(14\.8 GB\)/.test(usage.foot),
      JSON.stringify({ title: usage.title, figs: usage.figs.join(' | '), bars: usage.bars, panels: usage.panels, lines: usage.lines, limits: usage.limits, overflow: usage.overflow }));
    const money = usage.money;
    check('money everywhere: what was spent and an hour of work cost lead the figures, the charts open on Cost, and every project, model, chat, account and chat lane has its dollars',
      /^\$[\d,.]+$/.test(usage.figs[0]) && /^\$[\d,.]+$/.test(usage.figs[1]) && money.metric === 'Cost'
      && same(money.heads, ['Project|Cost|Out|Work|Typed', 'Model|Cost|Out|In|Cached', 'Chat|Cost|Out|Work', 'Tool|Calls'])
      && money.costs === 14 && money.noPrice === 1 && money.lanes.length === 6 && money.lanes.every((x) => /^\$[\d,.]+$/.test(x))
      && money.accts.length === 2 && money.accts.every((x) => /^\$[\d,.]+$/.test(x)) && /at list prices/.test(money.dayTip)
      && /would cost at Anthropic's API list prices: \$[\d,.]+\.\nA Max plan does not charge this/.test(money.kpiTip) && /tokens from Haiku 5\.1 are left out/.test(money.kpiTip),
      `${usage.figs[0]} spent, ${usage.figs[1]} an hour; tables: ${money.heads.join(' / ')}; ${money.costs} dollar cells, ${money.noPrice} "no price"; lanes ${money.lanes.join(' ')}; accounts ${money.accts.join(' ')}`);
    check('the Dashboard opens with what is running now: every session by the RAM it holds, the servers that are up, and this app itself',
      /run-sec/.test(usage.first[0] || '') && usage.run.title === 'On this computer' && usage.run.note === '3.9 GB of 64 GB RAM · 25% CPU · 38 programs in 8 sessions'
      && same(usage.run.rows, ['Pricing research 1.2 GB', 'Long refactor 860 MB', 'Checkout page rebuild 514 MB', 'Invoice export bug 444 MB', 'Nightly report 323 MB', 'Landing page copy 276 MB', 'api 188 MB', 'Old notes 153 MB'])
      && usage.run.rest === 0 && usage.run.servers === 'Server up:5173vite · Pricing research' && usage.run.app === 'Lowlit itself holds 540 MB of RAM and uses 1% of the processor.',
      `"${usage.run.note}"; ${usage.run.rows.join(', ')}; "${usage.run.servers}"`);
    check('then what every session and subagent is doing right now, call by call, and what the open chats have used so far',
      /feed-sec/.test(usage.first[1] || '') && usage.feed.title === 'Happening now' && usage.feed.rows === 9 && usage.feed.running === 4
      && /^The chats open now have used \$\d+ at list prices so far\.$/.test(usage.feed.cost), `${usage.feed.rows} calls, ${usage.feed.running} still running; "${usage.feed.cost}"`);
    check('the Dashboard goes on with every account: its limits and where they are heading, what was done under it, who was logged in when, and today chat by chat',
      same(usage.accts, ['*studio@example.com', 'personal@example.com', 'client-work@example.com', 'Account dddd4444']) && same(usage.shares, ['80%', '20%', '', ''])
      && usage.cells.length === 8 && /^warm:86% · resets in 2h \d\dm$/.test(usage.cells[0]) && /^:41% · resets in 3d \dh$/.test(usage.cells[1]) && /^hot:≥ 97% · resets \d\d:\d\d$/.test(usage.cells[2])
      && /^:≥ 64% · resets \w+ \d\d:\d\d$/.test(usage.cells[3]) && /^fresh:fresh since \w+ \d\d:\d\d$/.test(usage.cells[4]) && /^:≥ 22% · resets \w+ \d\d:\d\d$/.test(usage.cells[5])
      && usage.cells[6] === 'none:no reading yet' && usage.cells[7] === 'none:no reading yet'
      && usage.going.length === 2 && /^at this pace full at \d\d:\d\d, \d+m early$/.test(usage.going[0]) && /^at this pace \d+% by the reset$/.test(usage.going[1]) && usage.ticks === 2
      && same(usage.room, ['client-work@example.com'])
      && usage.ribbon >= 6 && usage.lanes === 6 && usage.lit > 20 && usage.stacks === 30 && usage.legend === 5 && same(usage.buttons, ['Show', 'Show', 'Show', 'Read', 'Read', 'Read']),
      `${usage.accts.join(', ')}; shares ${usage.shares.filter(Boolean).join(', ')}; limits: ${usage.cells.join(' | ')}; heading: ${usage.going.join(' | ')}; most room: ${usage.room.join(', ')}; ${usage.ribbon} stretches in the band; ${usage.lanes} chats with ${usage.lit} lit hours; ${usage.stacks} day bars in the accounts' shades, ${usage.legend} in the key`);
    // a click on one of the sessions that are running shows it, and Esc leads back to the Dashboard
    await exec(`document.querySelector('#stats .run-row[data-key="s-compact"]').click()`);
    await wait(200);
    const viaRun = await inPage(pageList);
    await inPage(pageKey, 'Escape');
    await wait(150);
    const backOn = await exec('Desk.state.view');
    check('a click on a session there shows it, and Esc leads back to the Dashboard', viaRun.view === 'peek' && viaRun.sel === 's-compact' && viaRun.picked === 1 && backOn === 'stats' && (await exec('Desk.state.sel')) === null,
      `looked at ${viaRun.sel}; Esc led back to "${backOn}"`);
    await shoot('0-dashboard');
    await exec('document.querySelector("#stats .kpis").scrollIntoView({ block: "start" })');
    await shoot('0-dashboard-money');
    await exec('document.querySelector("#stats .lanes").scrollIntoView({ block: "center" })');
    await shoot('0-dashboard-mid');
    await exec('document.getElementById("stats").scrollTop = 100000');
    await shoot('0-dashboard-2');
    await exec('document.getElementById("stats").scrollTop = 0');
    const dayOut = usage.figs[0];
    await exec('[...document.querySelectorAll("#stats .page-head .seg button")].find((b) => b.textContent === "30 days").click()');
    await showUsage('30d');
    await wait(150);
    usage = await usageView();
    check('switching the Dashboard to 30 days adds up the month, and says what part of it cannot be tied to an account', usage.figs.length === 10 && usage.figs[0] !== dayOut && (await exec('Desk.state.range')) === '30d'
      && /^\d+% of the tokens written in the last 30 days cannot be tied to an account/.test(usage.note), `spent: ${dayOut} today, ${usage.figs[0]} in 30 days; "${usage.note}"`);
    await shoot('0-dashboard-30d');
    await exec('[...document.querySelectorAll("#stats .page-head .seg button")].find((b) => b.textContent === "Today").click()');
    await showUsage('today');
    await wait(150);
    // from the busiest chats: a past one opens in History to be read, a running one is shown in the panel
    await exec(`[...document.querySelectorAll('#stats .table .tr .btn')].find((b) => b.textContent === 'Read').click()`);
    await wait(300);
    const led = await inPage(() => ({ view: Desk.state.view, sel: Desk.History.selected(), title: (document.querySelector('#history .d-title') || {}).textContent || '' }));
    await exec('Desk.setView("stats")');
    await wait(150);
    await exec(`[...document.querySelectorAll('#stats .table .tr .btn')].find((b) => b.textContent === 'Show').click()`);
    await wait(300);
    list = await inPage(pageList);
    pane = await inPage(pageDetail, 'peek');
    check('from the busiest chats, a past one opens in History to be read and a running one is shown in the panel',
      led.view === 'history' && led.sel === 'past-1' && led.title === 'Move the blog to the new layout' && list.view === 'peek' && list.sel === 's-agents' && pane.shown && pane.title === 'Pricing research',
      `History on "${led.title}"; then looking at ${list.sel}`);
    // away from the Dashboard, so that the search box below is the one that leads back to it
    await exec('Desk.look(null); Desk.setView("peek")');

    // ---- the search box: a few letters find a command, Enter runs it ----
    await exec('Palette.open()');
    await wait(400);
    const pal = await inPage(() => ({ open: !document.getElementById('palette').hidden, items: document.querySelectorAll('#palette .pal-item').length, groups: [...document.querySelectorAll('#palette .pal-group')].map((g) => g.textContent),
      marks: document.querySelectorAll('#palette .pal-item .glyph').length }));
    await shoot('0-search');
    // the page that was called Usage is still found by that word
    await typeInto('#palette input', 'usage');
    const oldWord = await exec(`[...document.querySelectorAll('#palette .pal-item .label')].map((l) => l.textContent)`);
    await typeInto('#palette input', 'dash');
    const hits = await exec(`[...document.querySelectorAll('#palette .pal-item .label')].map((l) => l.textContent)`);
    await inPage(pageKey, 'Enter', '#palette');
    await wait(150);
    const ran = await exec('Desk.state.view');
    await exec('Palette.open()');
    await typeInto('#palette input', 'hist');
    const hits2 = await exec(`[...document.querySelectorAll('#palette .pal-item .label')].map((l) => l.textContent)`);
    await inPage(pageKey, 'Enter', '#palette');
    await wait(150);
    check('the search box lists chats and commands, finds one by a few letters and runs it', pal.open && pal.items >= 15 && pal.marks === 9 && pal.groups.includes('In other terminals') && pal.groups.includes('Do')
      && new Set(pal.groups).size === pal.groups.length && hits.length >= 1 && /^Dashboard/.test(hits[0]) && oldWord.some((l) => /^Dashboard/.test(l)) && ran === 'stats' && /^History/.test(hits2[0]) && (await exec('Desk.state.view')) === 'history'
      && (await exec('document.getElementById("palette").hidden')) === true,
      // what is found can be a past conversation of his: only the command it should find is written down
      `${pal.items} entries in ${pal.groups.join(', ')}; "dash" finds ${hits.length}, first ${/^Dashboard/.test(hits[0] || '') ? `"${hits[0]}"` : 'something else'}; "usage" still finds it: ${oldWord.some((l) => /^Dashboard/.test(l))}; "hist" finds ${hits2.length}, first ${/^History/.test(hits2[0] || '') ? `"${hits2[0]}"` : 'something else'}`);
    await exec('Desk.setView("peek")');

    // everything ever typed into a prompt box can be searched. Only how many were found is kept: never the words, and no picture
    const typed = await exec(`desk.typed('the').then((list) => (!Array.isArray(list) ? { n: -1 } : { n: list.length, shape: list.length === 0 || ['text', 'at', 'cwd', 'session', 'live', 'there'].every((k) => k in list[0]) }))`);
    const tooShort = await exec(`desk.typed('th').then((list) => (Array.isArray(list) ? list.length : -1))`);
    await exec('Palette.open()');
    await typeInto('#palette input', 'the');
    const listed = await until(() => exec(`[...document.querySelectorAll('#palette .pal-item .from')].filter((x) => x.textContent === 'Things you typed').length`), 3000, 150);
    await exec('Palette.close()');
    check('the search box finds things typed into a prompt box, from three letters on', typed.n >= 0 && typed.shape && tooShort === 0 && (typed.n === 0 || listed === typed.n),
      `${typed.n} things typed hold "the"; ${listed || 0} of them listed in the box; two letters ask nothing (${tooShort})`);

    // ---- Settings: a page of the window; a switch flipped there is written down ----
    const viewBefore = await exec('Desk.state.view');
    await exec('Settings.open("chats")');
    await wait(150);
    const settingsFile = path.join(app.getPath('userData'), 'desk.json');
    const saved = () => { try { return JSON.parse(fs.readFileSync(settingsFile, 'utf8')); } catch { return {}; } };
    const flip = (label) => inPage((text) => { const r = [...document.querySelectorAll('#settings .set-row')].find((x) => (x.querySelector('.what > div') || {}).textContent === text);
      r.click(); return true; }, label);
    const switchOf = (label) => inPage((text) => { const r = [...document.querySelectorAll('#settings .set-row')].find((x) => (x.querySelector('.what > div') || {}).textContent === text);
      return r.querySelector('.switch').classList.contains('on'); }, label);
    const pageNow = await inPage(() => {
      const s = document.getElementById('settings');
      const r = s.getBoundingClientRect();
      const views = document.querySelector('.views').getBoundingClientRect();
      return { view: Desk.state.view, page: !s.hidden && s.classList.contains('view') && Math.round(r.width) === Math.round(views.width) && Math.round(r.height) === Math.round(views.height),
        crumb: document.getElementById('crumb').textContent, gear: document.getElementById('open-settings').classList.contains('on'),
        topics: [...s.querySelectorAll('.set-topic')].filter((b) => !b.hidden).map((b) => b.textContent), on: (s.querySelector('.set-topic.on') || {}).textContent || '',
        shown: [...s.querySelectorAll('.set-pane')].filter((p) => !p.hidden).map((p) => p.dataset.topic), search: document.activeElement === s.querySelector('.set-find-input') };
    });
    check('Settings is a page of the window, as the Dashboard is: its topics down the left under a search, the one picked alone at the right, the search ready for typing',
      pageNow.view === 'settings' && pageNow.page && pageNow.crumb === 'Settings' && pageNow.gear && pageNow.topics.length >= 10 && pageNow.topics[0] === 'Chats' && pageNow.on === 'Chats'
      && same(pageNow.shown, ['chats']) && pageNow.search, JSON.stringify(pageNow));
    const panel = await inPage(() => ({ open: !document.getElementById('settings').hidden, switches: document.querySelectorAll('#settings .switch').length, keys: document.querySelectorAll('#settings .keys kbd').length,
      accounts: document.querySelectorAll('#settings .acct-row').length, on: document.querySelectorAll('#settings .switch.on').length }));
    await flip('When a chat in this window finishes its turn');
    const written = await until(async () => saved().notify && saved().notify.finished === true, 4000, 200);
    // the see-through window is on unless switched off, and the choice is kept for the next start
    const glassWas = await switchOf('See-through window');
    await flip('See-through window');
    const solid = await until(async () => saved().solid === true, 4000, 200);
    const glassOff = await switchOf('See-through window');
    await flip('See-through window');
    const glassBack = await until(async () => saved().solid !== true, 4000, 200);
    check('the see-through window is on unless it is switched off in Settings, and the choice is kept for the next start', glassWas && Boolean(solid) && !glassOff && Boolean(glassBack));
    // a name typed for an account is kept, and used wherever the account shows
    await inPage(() => { const i = document.querySelector('#settings .acct-row .name-input'); i.value = 'Main account'; i.dispatchEvent(new Event('blur')); return true; });
    const named = await until(async () => saved().accountNames && saved().accountNames.aaaa1111 === 'Main account', 4000, 200);
    const calledAs = await exec(`(document.querySelector('#acct .acct-name') || {}).textContent || ''`);
    check('an account can be given a name, which is kept and shown in its place', panel.accounts === 4 && Boolean(named) && calledAs === 'Main account', `${panel.accounts} accounts listed; the sidebar now says "${calledAs}"`);
    await exec('Settings.open("chats")');
    await shoot('0-settings');
    check('Settings opens, and a switch flipped there is written down', panel.open && panel.switches === 22 && panel.keys >= 12 && panel.on >= 3 && Boolean(written), JSON.stringify(panel));
    await flip('When a chat in this window finishes its turn');
    await wait(300);
    // the search: the rows of every topic that hold the words, under their topic's name, the words marked; Enter goes to the first
    const findFor = (words) => inPage((w) => { const i = document.querySelector('#settings .set-find-input'); i.value = w; i.dispatchEvent(new Event('input')); return true; }, words);
    await findFor('limit');
    const finding = await inPage(() => {
      const s = document.getElementById('settings');
      const seen = (el) => Boolean(el.offsetParent);
      const hl = typeof CSS !== 'undefined' && CSS.highlights ? CSS.highlights.get('set-find') : null;
      return { panes: [...s.querySelectorAll('.set-pane')].filter((p) => !p.hidden).map((p) => p.dataset.topic),
        rows: [...s.querySelectorAll('.set-row')].filter(seen).map((r) => (r.querySelector('.what > div') || {}).textContent || ''),
        found: s.querySelector('.set-found').textContent, counts: [...s.querySelectorAll('.set-topic')].filter((b) => b.querySelector('.n').textContent).map((b) => `${b.querySelector('.name').textContent} ${b.querySelector('.n').textContent}`),
        marked: hl ? hl.size : -1, picked: Boolean(s.querySelector('.set-topic.on')) };
    });
    await shoot('0-settings-2');
    await inPage(() => { document.querySelector('#settings .set-find-input').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); return true; });
    const went = await inPage(() => {
      const s = document.getElementById('settings');
      const row = document.activeElement && document.activeElement.closest('.set-row');
      return { shown: [...s.querySelectorAll('.set-pane')].filter((p) => !p.hidden).map((p) => p.dataset.topic), search: s.querySelector('.set-find-input').value,
        row: row ? (row.querySelector('.what > div') || {}).textContent : '', on: (s.querySelector('.set-topic.on') || {}).textContent || '', finding: s.querySelector('.set-page').classList.contains('finding') };
    });
    await findFor('zzqx');
    const none = await inPage(() => ({ panes: [...document.querySelectorAll('#settings .set-pane')].filter((p) => !p.hidden).length, found: document.querySelector('#settings .set-found').textContent }));
    check('the search in Settings keeps the rows of every topic that hold the words, under their topic, marks the words and counts them by topic; Enter goes to the first in its topic; nothing found says so',
      finding.panes.includes('notes') && finding.rows.includes('When a usage limit is nearly used up') && !finding.rows.includes('Show notes') && !finding.panes.includes('chats')
      && /^\d+ match(es)? for "limit"/.test(finding.found) && finding.counts.some((c) => c.startsWith('Notes ')) && finding.marked > 0 && !finding.picked
      && same(went.shown, ['notes']) && went.search === '' && went.row === 'When a usage limit is nearly used up' && went.on === 'Notes' && !went.finding
      && none.panes === 0 && none.found.startsWith('Nothing matches "zzqx"'), JSON.stringify({ finding, went, none }));
    await findFor('');
    // Esc goes back to where the window was; Ctrl+, opens it again, and closes it again
    await inPage(() => { (document.activeElement || document.body).dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); return true; });
    const backTo = await exec('Desk.state.view');
    const ctrlComma = () => inPage(() => { document.body.dispatchEvent(new KeyboardEvent('keydown', { key: ',', code: 'Comma', ctrlKey: true, bubbles: true })); return Desk.state.view; });
    const again = await ctrlComma();
    const shutAgain = await ctrlComma();
    check('Esc leaves Settings for where the window was before it, and Ctrl+, opens it and closes it again',
      backTo === viewBefore && again === 'settings' && shutAgain === viewBefore, JSON.stringify({ before: viewBefore, backTo, again, shutAgain }));
    await exec('Settings.close()');
    // the window's own cards at the top left of the chats, over made-up chats only: a picture
    await inPage(() => {
      Cards.clear();
      toast('Made-up checkout needs you on one of its pages. Its browser opens when you go to that chat.', 9000,
        { kind: 'page', title: 'Made-up checkout', what: 'needs you on one of its pages', body: 'Log in to the made-up shop, then tell me.', target: 'stats' });
      toast('Looked again just now. Limits move when one of your chats next talks to Claude.', 6000);
      return true;
    });
    await shoot('0-cards', true);
    await exec('Cards.clear()');

    // the part that reads the files stopped for good: the window says so above every view, and offers to start it again
    win.webContents.send('desk:command', 'stale');
    const stopped = await until(() => exec('!document.querySelector("#notes > .callout:nth-child(1)").hidden'), 3000);
    const staleTitle = await exec('document.querySelector("#notes > .callout:nth-child(1) .callout-title").textContent');
    await exec('document.querySelector("#notes > .callout:nth-child(1) .btn").click()');
    check('when the list of chats stops updating, the window says so and offers to start it again', Boolean(stopped) && staleTitle === 'The list of chats stopped updating'
      && (await exec('document.querySelector("#notes > .callout:nth-child(1)").hidden')) === true, `"${staleTitle}"`);

    // a shortcut to the app, written into the test's own folder instead of the Start menu
    let link = null;
    try {
      const file = path.join(dir, 'Lowlit test.lnk');
      writeLink(file, '--tray');
      link = require('electron').shell.readShortcutLink(file);
    } catch (err) {
      link = { error: String(err) };
    }
    check('a shortcut to the app is written the way the taskbar starts it', Boolean(link) && /wscript\.exe$/i.test(link.target || '') && /Lowlit\.vbs/.test(link.args || '')
      && /--tray/.test(link.args || '') && link.appUserModelId === 'Lowlit.App', JSON.stringify(link));

    // what the watcher really answers when asked for the sums (nothing was counted in a test run: the shape is what is checked)
    const sums = await watch.ask('usage', { range: '7d' });
    check('the watcher answers with 30 days and 48 hours of sums', Boolean(sums) && sums.range === '7d' && sums.days.length === 30 && sums.hours.length === 48
      && typeof sums.total.out === 'number' && Array.isArray(sums.projects) && Array.isArray(sums.limits) && Array.isArray(sums.who) && Array.isArray(sums.lanes)
      && sums.days.every((d) => d.who && typeof d.who === 'object' && d.whoUsd && typeof d.usd === 'number') && sums.hours.every((x) => typeof x.usd === 'number')
      && typeof sums.total.usd === 'number' && Array.isArray(sums.unpriced), sums ? `${sums.reading.files} files known, counting ${sums.reading.counting}` : 'no answer');

    // What a made-up day costs at the list prices of 3 Oct: Opus 5.5 at $4 in, $20 out, $8 for an hour's cache write
    // ($5 for a subagent's 5 minutes), $0.20 re-read; Fable 5.1 at $50 out; a model with no price adds nothing.
    {
      const { dayCost } = require('./watch.cjs');
      const { rates } = require('./prices.cjs');
      const day = {
        m: { 'claude-opus-5-5': [1000, 2e6, 3e6, 100e6, 10], 'claude-fable-5-1': [0, 1e6, 0, 0, 2], 'claude-haiku-5-1': [0, 5000, 0, 0, 1], unknown: [0, 0, 0, 0, 1] },
        h: { 9: [1000, 2.5e6, 2e6, 60e6, 8, 0], 10: [0, 505000, 1e6, 40e6, 6, 0] },
      };
      const chat = dayCost(day, false);
      const sub = dayCost(day, true);
      const hoursAdd = Object.values(day.h).reduce((n, v) => n + v[0] * chat.per[0] + v[1] * chat.per[1] + v[2] * chat.per[2] + v[3] * chat.per[3], 0);
      const r = (id, s) => JSON.stringify((rates(id, s) || []).map((x) => Math.round(x * 1e8) / 100));
      check('a day is priced by its models at the list prices, a subagent\'s cache writes at the 5-minute price, and its hours add up to it',
        Math.abs(chat.usd - 134.004) < 1e-9 && Math.abs(sub.usd - 125.004) < 1e-9 && Math.abs(hoursAdd - chat.usd) < 1e-9 && chat.unpriced === 5000 && same(chat.missing, ['claude-haiku-5-1'])
        && r('claude-opus-5-5') === '[4,20,8,0.2]' && r('claude-opus-5-5', true) === '[4,20,5,0.2]' && r('claude-opus-4-8') === '[5,25,10,0.5]' && r('claude-opus-4') === '[15,75,30,1.5]'
        && r('claude-haiku-4-5-20251001') === '[1,5,2,0.1]' && r('claude-opus-5-5[1m]') === '[4,20,8,0.2]' && rates('claude-haiku-5-1') === null && rates('claude-opus-4-9') === null,
        `a chat's day $${chat.usd.toFixed(3)}, as a subagent $${sub.usd.toFixed(3)}, its hours $${hoursAdd.toFixed(3)}; ${chat.unpriced} tokens without a price`);
    }

    // A transcript's short count of today's lines is dropped once the full count reaches it. Asked again within
    // the minute, the plan must hand it to the full count: it once answered "the short count", which was gone,
    // and counting stood still for up to a minute. (Made-up records: no transcript is read here.)
    const plans = [{ early: null, today: 'early' }, { early: { dirty: true }, today: 'early' }, { early: null, today: 'none' }, { early: null, today: 'whole' }]
      .map((c) => Watch.prototype.todayPlan.call({}, { ...c, todayAt: Date.now() - 5000 }, Date.now(), 0));
    check("a conversation whose count of today's lines is over is handed on to the full count", same(plans, ['whole', 'early', 'none', 'whole']), plans.join(', '));

    // ---- chats that come back: what is written down about an open chat, what a start does with it, and how it is started again.
    // ---- The three deciders are asked with made-up chats: nothing is started, and no file is written.
    const SID = '11111111-2222-4333-8444-555555555555';
    const NEWER = 'aaaaaaaa-2222-4333-8444-555555555555';
    const chatOf = (over) => ({ id: 'c1', cwd: 'D:\\work\\shop', command: 'claude', starter: 'claude', title: '', named: false, job: '', holds: '', mode: '', left: false, ...over });
    const seenAs = (over) => ({ session: SID, title: 'Checkout page rebuild', name: '', turn: { start: 1, end: 2 }, mode: 'bypassPermissions', ...over });
    const base = { cwd: 'D:\\work\\shop', starter: 'claude', title: '', named: false, resume: '', mode: '', front: false, id: 'c1' };
    const keptAs = [
      // named by the person, its session seen, the chat in front
      [keptOf(chatOf({ title: 'My shop chat', named: true }), seenAs({}), true), { ...base, title: 'My shop chat', named: true, resume: SID, mode: 'bypassPermissions', front: true }],
      // nothing was asked in it yet: there is no conversation to pick up
      [keptOf(chatOf({}), seenAs({ turn: null }), false), { ...base, title: 'Checkout page rebuild' }],
      // opened a moment ago to pick a conversation up, its session not seen yet: it still holds that conversation and its mode
      [keptOf(chatOf({ holds: SID, mode: 'plan' }), undefined, false), { ...base, resume: SID, mode: 'plan' }],
      // its agent was left with /exit: a plain console is what is open
      [keptOf(chatOf({ left: true }), undefined, false), { ...base, starter: 'shell' }],
      // it has moved on to a newer conversation, in another mode: that one counts
      [keptOf(chatOf({ holds: SID, mode: 'plan' }), seenAs({ session: NEWER, mode: 'acceptEdits' }), false), { ...base, title: 'Checkout page rebuild', resume: NEWER, mode: 'acceptEdits' }],
    ];
    check('what is written down about an open chat: the name it was given, the conversation in it, the permission mode it was in, and whether it is in front',
      keptAs.every(([got, want]) => same(got, want)), keptAs.map(([got, want], i) => `${i + 1}: ${same(got, want) ? 'as expected' : JSON.stringify(got)}`).join('; '));
    const decided = [[0, true, 'ask'], [2, false, 'ask'], [2, false, 'never'], [2, true, 'ask'], [2, true, 'always'], [2, true, 'tray'], [2, true, 'never'], [2, 'windows', 'always'], [2, 'windows', 'never'], [2, undefined, 'ask'],
      [2, 'restart', 'never'], [0, 'restart', 'ask']]
      .map(([open, running, keep]) => restoreMode(open, lastEnd(running), keep));
    check('what a start does with the chats of last time: they open after a proper close, after a crash and after a Windows shutdown, and are asked about only when the choice was to start fresh; after a restart, any the keeper could not keep open by themselves',
      same(decided, ['', 'auto', 'auto', 'crash', 'crash', 'crash', 'ask', 'auto', 'ask', 'auto', 'auto', '']), decided.map((d) => d || '(nothing)').join(', '));
    // what Settings asks every Claude Code chat to start with, which the planner puts after the rest of the line
    const tuneOf = (c) => `${c.model ? ` --model ${c.model}` : ''}${c.effort ? ` --effort ${c.effort}` : ''}`;
    const tune = tuneOf(settingsNow().claude);
    const plans2 = {
      bypass: planChat({ starter: 'claude', resume: SID, mode: 'bypassPermissions' }),
      plan: planChat({ starter: 'claude', resume: SID, mode: 'plan' }),
      usual: planChat({ starter: 'claude', resume: SID, mode: 'default' }),
      odd: planChat({ starter: 'claude', resume: SID, mode: 'plan; calc' }),
      notOne: planChat({ starter: 'claude', resume: `${SID}; calc`, mode: 'plan' }),
      own: planChat({ resume: SID, mode: 'bypassPermissions' }),
      view: planChat({ attach: 'abc12345' }),
    };
    check('a conversation is picked up again in the permission mode it was in, and only fixed words ever reach the command line',
      plans2.bypass.command === `claude --resume ${SID} --dangerously-skip-permissions${tune}` && plans2.bypass.holds === SID && plans2.bypass.mode === 'bypassPermissions'
      && plans2.plan.command === `claude --resume ${SID} --permission-mode plan${tune}` && plans2.usual.command === `claude --resume ${SID}${tune}` && plans2.usual.mode === ''
      && plans2.odd.command === `claude --resume ${SID}${tune}` && plans2.odd.mode === '' && plans2.notOne.command === `claude${tune}` && plans2.notOne.holds === ''
      // the person's own starter sets the mode itself: no mode is added to it
      && (plans2.own.plain ? plans2.own.command === `claude --resume ${SID} --dangerously-skip-permissions${tune}`
        : plans2.own.command.endsWith(` --resume ${SID}${plans2.own.passes ? tune : ''}`) && !/--dangerously|--permission-mode/.test(plans2.own.command))
      && plans2.own.mode === 'bypassPermissions' && plans2.view.command === 'claude attach abc12345' && plans2.view.job === 'abc12345' && plans2.view.holds === '',
      `bypass: "${plans2.bypass.command.replace(SID, '<id>')}"; plan: "${plans2.plan.command.replace(SID, '<id>')}"; a mode not on the list: "${plans2.odd.command.replace(SID, '<id>')}"; `
      + `through ${plans2.own.plain ? 'the plain command' : 'his own starter, which sets the mode itself'}: "${plans2.own.command.replace(SID, '<id>')}"`);

    // The model and the thinking a Claude Code chat starts with (his ask, 6 Oct: Claude Code never keeps max for the
    // next chat): Settings' choice for every chat, a workspace's own for the chats in its folders, put after the rest of
    // the line and never twice. Changed through Settings' own door and asked of the planner: nothing is started. The
    // made-up workspace is main's only; the page's own list of workspaces is left as it was.
    const claudeWas = settingsNow().claude;
    const spacesWas = settingsNow().spaces;
    const tunedRoot = path.join(dir, 'Tuned-Made-Up');
    const tuneSet = (patch) => inPage(async (p) => { const next = await desk.settings(p); Desk.state.settings.claude = next.claude; return next.claude; }, patch);
    const spacesSet = (list) => inPage(async (p) => { await desk.settings({ spaces: p }); return true; }, list);
    const cmd = (ask) => { const p = planChat(ask); return p.error ? `error: ${p.error}` : p.command; };
    const cleared = Object.fromEntries(spacesWas.map((s) => [s.id, { model: '', effort: '' }]));
    const claudeBack = { model: claudeWas.model, effort: claudeWas.effort, spaces: Object.fromEntries(spacesWas.map((s) => [s.id, claudeWas.spaces[s.id] || { model: '', effort: '' }])) };
    await tuneSet({ claude: { model: '', effort: 'max', spaces: cleared } });
    await spacesSet([...spacesWas, { id: 'wtunecheck', name: 'Tune check', folders: [tunedRoot], color: '', sessions: [] }]);
    const ownSet = await tuneSet({ claude: { spaces: { wtunecheck: { model: 'sonnet', effort: 'high' } } } });
    const tuneRefused = await tuneSet({ claude: { model: 'opus; calc', effort: 'ultra', spaces: { wtunecheck: { effort: 'max --dangerously-skip-permissions' }, wnotthere: { model: 'opus' } } } });
    const tunedPlans = {
      outside: cmd({ starter: 'claude', cwd: dir }),
      inside: cmd({ starter: 'claude', cwd: path.join(tunedRoot.toLowerCase(), 'deeper') }),
      picked: cmd({ starter: 'claude', cwd: tunedRoot, resume: SID, mode: 'plan' }),
      shell: cmd({ starter: 'shell', cwd: tunedRoot }),
      view: cmd({ attach: 'abc12345', cwd: tunedRoot }),
    };
    await tuneSet({ claude: { model: 'opus', spaces: { wtunecheck: { model: '' } } } });
    const opusEverywhere = [cmd({ starter: 'claude', cwd: dir }), cmd({ starter: 'claude', cwd: tunedRoot })];
    // the same words, asked for by themselves
    const wordsAlone = [claudeFlags(dir), claudeFlags(tunedRoot)];
    await tuneSet({ claude: { effort: '' } });
    const noEffort = cmd({ starter: 'claude', cwd: dir });
    // the workspace taken away takes its own choice with it
    await spacesSet(spacesWas);
    const afterGone = settingsNow().claude;
    await tuneSet({ claude: claudeBack });
    check("a Claude Code chat starts on the model and the thinking picked in Settings, a workspace's own for the chats in its folders, after the rest of its line and never twice; only words from the lists are kept",
      same(ownSet.spaces.wtunecheck, { model: 'sonnet', effort: 'high' }) && JSON.stringify(tuneRefused) === JSON.stringify(ownSet)
      && tunedPlans.outside === 'claude --effort max' && tunedPlans.inside === 'claude --model sonnet --effort high'
      && tunedPlans.picked === `claude --resume ${SID} --permission-mode plan --model sonnet --effort high`
      && tunedPlans.shell === '' && tunedPlans.view === 'claude attach abc12345'
      && same(opusEverywhere, ['claude --model opus --effort max', 'claude --model opus --effort high']) && same(wordsAlone, [' --model opus --effort max', ' --model opus --effort high'])
      && noEffort === 'claude --model opus' && !Object.hasOwn(afterGone.spaces, 'wtunecheck') && JSON.stringify(settingsNow().claude) === JSON.stringify(claudeWas),
      JSON.stringify({ ...tunedPlans, picked: tunedPlans.picked.replace(SID, '<id>'), opusEverywhere, wordsAlone, noEffort,
        refused: JSON.stringify(tuneRefused) === JSON.stringify(ownSet) ? 'nothing taken' : tuneRefused, kept: Object.keys(afterGone.spaces) }));

    // Settings shows the two choices first, a row of buttons each, and a row for each workspace; a click is kept
    const tuneRows = () => inPage(() => {
      const s = document.querySelector('#settings section[data-section="claude"]');
      if (!s) return null;
      const segs = (row) => [...row.querySelectorAll('.seg')].map((g) => [...g.querySelectorAll('button')].map((b) => b.textContent + (b.classList.contains('on') ? '*' : '')).join('|'));
      return { first: document.querySelector('#settings section[data-section]') === s && !s.closest('.set-pane').hidden,
        main: [...s.querySelectorAll('.tune-main')].map((r) => [r.querySelector('.what > div').textContent, ...segs(r)]),
        spaces: [...s.querySelectorAll('.tune-row')].map((r) => [r.dataset.tune, ...segs(r)]), listed: (Desk.state.settings.spaces || []).length };
    });
    const pickTune = (which, name, k = 0) => inPage((w, n, i) => {
      const s = document.querySelector('#settings section[data-section="claude"]');
      const row = s && [...s.querySelectorAll('.set-row')].find((r) => r.dataset.tune === w || (r.querySelector('.what > div') || {}).textContent === w);
      const g = row && row.querySelectorAll('.seg')[i];
      const b = g && [...g.querySelectorAll('button')].find((x) => x.textContent === n);
      if (b) b.click();
      return Boolean(b);
    }, which, name, k);
    const frontWas = settingsNow().space;
    const tuneSpace = await call('addSpace', 'Tune made-up');
    await call('putFolder', tunedRoot, tuneSpace);
    await wait(250);
    await inPage(() => { Settings.open('claude'); return true; });
    const ui1 = await until(tuneRows, 3000);
    await pickTune('Model', 'Opus');
    const tookOpus = await until(async () => settingsNow().claude.model === 'opus', 3000, 100);
    await pickTune('Thinking', 'High');
    const tookHigh = await until(async () => settingsNow().claude.effort === 'high', 3000, 100);
    const ui2 = await until(async () => { const v = await tuneRows(); return v && v.main[1] && v.main[1][1].includes('High*') ? v : null; }, 3000) || await tuneRows();
    await pickTune(tuneSpace, 'Fable', 0);
    const tookFable = await until(async () => (settingsNow().claude.spaces[tuneSpace] || {}).model === 'fable', 3000, 100);
    const inTuned = cmd({ starter: 'claude', cwd: path.join(tunedRoot, 'src') });
    await pickTune(tuneSpace, 'Same', 0);
    const sameAgain = await until(async () => !Object.hasOwn(settingsNow().claude.spaces, tuneSpace), 3000, 100);
    await inPage(() => { Settings.close(); return true; });
    await call('removeSpace', tuneSpace);
    await wait(250);
    await tuneSet({ claude: claudeBack });
    const models = "Claude Code's|Opus|Sonnet|Fable";
    check('Settings has the model and the thinking first, a row of buttons each, a row for each workspace, and a click there is kept and used',
      Boolean(ui1) && ui1.first && ui1.main.length === 2 && ui1.main[0][0] === 'Model' && ui1.main[1][0] === 'Thinking'
      && ui1.main[0][1].replace('*', '') === models && ui1.main[1][1].replace('*', '') === "Claude Code's|Low|Medium|High|Extra high|Max"
      && ui1.spaces.length === ui1.listed && ui1.spaces.some((r) => r[0] === tuneSpace) && ui1.spaces.every((r) => r.length === 3 && r[1].replace('*', '') === 'Same|Opus|Sonnet|Fable')
      && Boolean(tookOpus) && Boolean(tookHigh) && Boolean(ui2) && ui2.main[0][1].includes('Opus*') && ui2.main[1][1].includes('High*')
      && Boolean(tookFable) && inTuned === 'claude --model fable --effort high' && Boolean(sameAgain)
      && JSON.stringify(settingsNow().claude) === JSON.stringify(claudeWas) && JSON.stringify(settingsNow().spaces) === JSON.stringify(spacesWas) && settingsNow().space === frontWas,
      JSON.stringify({ first: ui1 && ui1.main, workspaces: ui1 && ui1.spaces.map((r) => r.slice(1)), after: ui2 && ui2.main, inTuned, fable: Boolean(tookFable), sameAgain: Boolean(sameAgain) }));

    // The view of a background session comes back too (his ask, 4 Oct), while that session is still there. Its job is
    // read from made-up folders here; nothing is started (a view of a made-up session would start a real claude).
    const keptView = keptOf(chatOf({ job: 'abc12345', title: 'Made-up background job', command: 'claude attach abc12345' }), undefined, true);
    const madeJobs = path.join(dir, 'made-up-jobs');
    const madeSessions = path.join(dir, 'made-up-sessions');
    const jobAs = (id, state, tempo) => { fs.mkdirSync(path.join(madeJobs, id), { recursive: true }); fs.writeFileSync(path.join(madeJobs, id, 'state.json'), JSON.stringify({ state, tempo })); };
    fs.mkdirSync(madeSessions, { recursive: true });
    jobAs('a1a1a1a1', 'working', 'active');
    jobAs('b2b2b2b2', 'done', 'idle');
    jobAs('c3c3c3c3', 'done', 'blocked');
    jobAs('d4d4d4d4', 'stopped', 'idle');
    jobAs('e5e5e5e5', 'done', 'idle');
    // a program of e5 still runs: this test's own process stands in for it
    fs.writeFileSync(path.join(madeSessions, `${process.pid}.json`), JSON.stringify({ jobId: 'e5e5e5e5', kind: 'bg' }));
    const lives = ['a1a1a1a1', 'b2b2b2b2', 'c3c3c3c3', 'd4d4d4d4', 'e5e5e5e5', 'f6f6f6f6'].map((id) => jobLives(id, madeJobs, madeSessions));
    fs.rmSync(madeJobs, { recursive: true, force: true });
    fs.rmSync(madeSessions, { recursive: true, force: true });
    // a made-up id no job on this machine has: last time's view of it is not opened again, and nothing is started
    const goneView = planChat({ attach: '0000deadbeef00', cwd: dir, restore: true });
    const askedView = planChat({ attach: '0000deadbeef00', cwd: dir });
    check('the view of a background session is kept as such, and comes back only while its session is still there (at work, waiting for you, or its program still running); one that ended is left in the list',
      same(keptView, { cwd: 'D:\\work\\shop', job: 'abc12345', title: 'Made-up background job', named: false, front: true, id: 'c1' })
      && same(lives, [true, false, true, false, true, false]) && goneView.gone === true && Boolean(goneView.error) && askedView.command === 'claude attach 0000deadbeef00',
      JSON.stringify({ keptView, lives, gone: goneView.gone, asked: askedView.command }));
    // the servers that ran last time and are gone now: they start again after a close that kept things, after a
    // crash or a Windows shutdown, and not when the person chose to start fresh
    const serverChoices = [['clean', true, 'ask'], ['clean', false, 'ask'], ['clean', true, 'never'], ['crash', true, 'ask'], ['windows', false, 'always'], ['windows', true, 'never'], ['restart', true, 'ask']]
      .map(([last, back, keep]) => serversComeBack(last, back, keep));
    check('servers that ran when Lowlit last ran and are gone at its start come back after a close that kept things, a crash, a Windows shutdown or a restart, not after "Start fresh"',
      same(serverChoices, [true, false, true, true, true, false, true]), serverChoices.join(', '));
    // The window's own reopening, handed last time's view of a made-up background session no job on this machine
    // has: it asks for it the way a start does, is told the session ended, opens nothing and says so. Only run while
    // that id is surely nobody's, since a living one would start a real "claude attach".
    if (!jobLives('0000deadbeef00')) {
      const chatsBefore = chats.all.size;
      await exec('document.getElementById("toast").hidden = true');
      await exec(`Desk.state.info.previous = [{ cwd: ${JSON.stringify(dir)}, job: '0000deadbeef00', title: 'Made-up background job', named: false, front: true, id: 'made-up-view', order: 0 }]; reopen('auto')`);
      const said = await until(async () => { const t = await toastNow(); return /background session/.test(t) ? t : ''; }, 5000, 100);
      check('handed last time\'s view of a background session that has ended since, the window opens nothing and says the session ended',
        said === '1 background session ended meanwhile: it stays in the list.' && chats.all.size === chatsBefore && (await exec('Desk.state.info.previous.length')) === 0,
        `said: "${said}"; chats before ${chatsBefore}, after ${chats.all.size}`);
      await exec('document.getElementById("toast").hidden = true');
    } else check('a made-up background session id is nobody\'s on this machine', false, 'a job folder named 0000deadbeef00 exists: the reopening check did not run');

    await sortingPart();
    await screenEventsPart();

    // back to the real clock and the real picture of the machine, with nothing looked at and nothing held as it was
    await exec('Desk.state.unread.clear(); Desk.look(null); Desk.setView("peek"); Reader.fake = null; History.fake = null; Desk.state.frozen = false; Desk.state.usage = null; Desk.state.res = null');
    await inPage(pageClock, 0);
    await exec(`takeSnapshot(${JSON.stringify(real)})`);
    watch.post({ type: 'pace', ms: 2000 });
    await wait(300);
  };

  // ---- what the window is drawn on: Windows saying a screen changed, the computer sleeping and waking (said here the
  // ---- way Windows says them; no screen changes), and F5 ----
  const screenEventsPart = async () => {
    const logNow = () => { try { return fs.readFileSync(path.join(app.getPath('userData'), 'desk.log'), 'utf8'); } catch { return ''; } };
    // the page counts the times it draws everything again
    await exec(`(() => { if (!Terms.redrawAll.was) { const was = Terms.redrawAll; const w = function redrawAll() { w.n++; return was.apply(this, arguments); };
      w.n = 0; w.was = was; Terms.redrawAll = w; } return true; })()`);
    const redraws = () => exec('Terms.redrawAll.n');
    const made = { id: 7777, size: { width: 1920, height: 1080 }, scaleFactor: 1.25, displayFrequency: 60, internal: false };

    const n0 = await redraws();
    let at = logNow().length;
    screens.emit('display-metrics-changed', made, ['workArea']);
    await wait(1200);
    const n1 = await redraws();
    const quiet = logNow().slice(at);
    check('a screen whose taskbar moved or hid (only its work area changed) is not noted, and nothing is drawn again', !/ screen: /.test(quiet) && n1 === n0,
      `${n1 - n0} redraw(s); log: ${JSON.stringify(quiet.trim().slice(-200))}`);

    at = logNow().length;
    screens.emit('display-metrics-changed', made, ['scaleFactor', 'workArea']);
    await wait(200);
    screens.emit('display-added', { ...made, id: 7778, scaleFactor: 1 });
    await until(async () => (await redraws()) > n1, 4000, 100);
    await wait(900);
    const n2 = await redraws();
    const said = logNow().slice(at);
    check('Windows saying a screen changed its scaling, then that a screen came: both go into the log, and once they settle everything is drawn again, once',
      / screen: a screen changed its scaleFactor \(1920 x 1080 at 125%, 60 Hz\)/.test(said) && / screen: a screen came \(1920 x 1080 at 100%, 60 Hz\)/.test(said)
        && / screen: the window drawn again \(a screen changed, a screen came\)/.test(said) && n2 === n1 + 1,
      `${n2 - n1} redraw(s); log: ${JSON.stringify(said.trim().replace(/^\S+ /gm, '').slice(-400))}`);

    at = logNow().length;
    screens.power('suspend');
    screens.power('resume');
    const early = await until(async () => (await redraws()) > n2, 1500, 100);
    const woke = await until(async () => (await redraws()) > n2, 5000, 100);
    const n3 = await redraws();
    const wokeSaid = logNow().slice(at);
    check('the computer going to sleep and waking goes into the log, and everything is drawn again once the screens are back on (about 3 s after waking, not before)',
      !early && Boolean(woke) && n3 === n2 + 1 && / screen: the computer went to sleep/.test(wokeSaid) && / screen: the computer woke up/.test(wokeSaid)
        && / screen: the window drawn again \(the computer woke up\)/.test(wokeSaid),
      `${n3 - n2} redraw(s)${early ? ', the first within 1.5 s' : ''}; log: ${JSON.stringify(wokeSaid.trim().replace(/^\S+ /gm, '').slice(-300))}`);

    at = logNow().length;
    await inPage(pageKey, 'F5');
    const byHand = await until(() => logNow().slice(at).includes(' screen: drawn again by hand (F5 or the palette)'), 3000, 100);
    const n4 = await redraws();
    check('F5 draws everything again, and the log says when (the moment the person found the window drawn wrong)', Boolean(byHand) && n4 === n3 + 1,
      `${n4 - n3} redraw(s); log: ${JSON.stringify(logNow().slice(at).trim().replace(/^\S+ /gm, '').slice(-200))}`);
    await exec('(() => { if (Terms.redrawAll.was) Terms.redrawAll = Terms.redrawAll.was; return true; })()');
  };

  // ---- the chats on screen: what stands in each place, and the keys and presses that move between them ----
  const tilesNow = () => inPage(pageTiles);
  const stripOf = (id) => inPage(pageStrip, id);
  const press = (selector) => inPage(pagePress, selector);
  /** A key of the window, pressed with Ctrl (and Shift). held: Ctrl stays down after it. */
  const ctrl = (code, { shift = false, held = false } = {}) => inPage(pageCtrl, code, shift, !held);
  const tileOf = (id) => `#tiles .tile[data-id="${id}"]`;
  /** A press in a chat's place, which gives it the keyboard. */
  const giveKeyboard = async (id) => {
    await press(`${tileOf(id)} .tile-body`);
    return Boolean(await until(() => exec(`Terms.active() === ${JSON.stringify(id)}`), 3000, 50));
  };
  /** Asks the console that has the keyboard how wide it is; its answer is the line "<tag>=<columns>". */
  const askWidth = (tag) => type(`Write-Host ('${tag}=' + $Host.UI.RawUI.WindowSize.Width)\r`);
  const widthSeen = (id, tag, cols) => until(async () => (await linesOf(id)).some((l) => l.trim() === `${tag}=${cols}`), 6000);
  const colsOf = (id) => exec(`Terms.get(${JSON.stringify(id)}).term.cols`);
  /** Closes a chat the way the window does, and waits until its console is gone (a close holds back while a session on the machine is young). */
  const closeAndWait = async (id) => {
    const pid = chats.all.has(id) ? chats.all.get(id).pid : 0;
    await exec(`Desk.closeChat(${JSON.stringify(id)})`);
    return Boolean(await until(async () => !chats.all.has(id) && !(pid && alive(pid)), 20000, 100));
  };

  // ---- one console: the round trip ----
  const consolePhase = async () => {
    const started = Date.now();
    const a = await inPage(pageNew, plain);
    notes.chatA = a && a.id;
    if (!check('a chat opens in this window', Boolean(a && a.id), a && a.id ? a.id : `no chat: ${a && a.error ? a.error : 'no answer'}`)) throw new Error('no chat');
    agent.chat = a.id;
    const cols0 = await exec('term.cols');
    const rows0 = await exec('term.rows');
    say(`      widget size ${cols0} x ${rows0} cells; console engine: ${engine === 'bundled' ? "Windows Terminal's, shipped with the app" : 'the one built into Windows'}`);
    const alone = await tilesNow();
    const strip0 = await stripOf(a.id);
    check('the first chat takes the whole panel and holds the keyboard',
      alone.n === 1 && alone.tiles.length === 1 && alone.tiles[0].id === a.id && alone.tiles[0].on && alone.tiles[0].drawn && alone.keyboard === a.id && alone.parked === 0
      && (await exec('Desk.state.view')) === a.id && Boolean(strip0) && !strip0.marked,
      alone.tiles[0] ? `1 chat on screen, ${alone.tiles[0].w} x ${alone.tiles[0].h} px, ${alone.tiles[0].cols} x ${alone.tiles[0].rows} cells` : 'no chat on screen');

    check('PowerShell starts inside it', Boolean(await until(promptBack, 30000)), `${Date.now() - started} ms after the chat was asked for`);

    const mark = `desk-${BOX}-ok`;
    await type(`Write-Host ('desk-' + [char]0x2502 + '-ok') -ForegroundColor Green; $Host.UI.RawUI.WindowSize.Width\r`);
    const echoed = await until(async () => (await linesOf(a.id)).includes(mark), 8000);
    check('typed text reaches PowerShell and its answer comes back, box character intact', Boolean(echoed));
    // the width is the answer's second line and can arrive a moment after the first
    const sameWidth = await until(async () => (await linesOf(a.id)).some((l) => l.trim() === String(cols0)), 4000);
    check('PowerShell sees the same width as the widget', Boolean(sameWidth), `${cols0} columns`);
    const colour = await inPage(pageColourOf, mark);
    check('colour survives the trip', Boolean(colour && colour.palette && [2, 10].includes(colour.colour)), JSON.stringify(colour));

    // the strip above the terminal: which chat it is, and its two buttons. The chat can be renamed, also by hand:
    // a click on the name of the chat that has the keyboard turns the name into a field.
    const head = await stripOf(a.id);
    await exec(`desk.rename(${JSON.stringify(a.id)}, 'Renamed by the test')`);
    const renamed = await until(async () => (await inPage(pageSide))[0].label === 'Renamed by the test' && (await stripOf(a.id)).name === 'Renamed by the test', 4000);
    await press(`${tileOf(a.id)} .th-name`);
    const field = `${tileOf(a.id)} .th-rename`;
    const asField = await exec(`Boolean(document.querySelector(${JSON.stringify(field)}))`);
    await inPage((sel) => {
      const input = document.querySelector(sel);
      if (!input) return false;
      input.value = 'Typed by hand';
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
      return true;
    }, field);
    const byHand = await until(async () => (await stripOf(a.id)).name === 'Typed by hand' && (await inPage(pageSide))[0].label === 'Typed by hand', 4000);
    await exec(`desk.rename(${JSON.stringify(a.id)}, '')`);
    await until(async () => (await stripOf(a.id)).name !== 'Typed by hand', 4000);
    check('the strip above the terminal names the chat, and the chat can be renamed, also with a click on its name', Boolean(head.name) && head.buttons === 3 && Boolean(renamed) && asField && Boolean(byHand),
      `"${head.name}", then "Renamed by the test", then typed into the strip: ${Boolean(byHand)}`);
    // A plain console has nothing else to say: its strip holds no figure, and its two buttons stand at the right
    // end, at this size and in a window as wide as a maximised one.
    const bare = await stripOf(a.id);
    const [bw, bh] = win.getContentSize();
    win.setContentSize(1920, 1040);
    await wait(500);
    const bareWide = await stripOf(a.id);
    win.setContentSize(bw, bh);
    await until(async () => (await exec('term.cols')) === cols0, 5000);
    await wait(300);
    check('above a plain console the strip holds its name and its two buttons, at its right end at any width, and not one figure',
      bare.figures === 0 && bare.doing === '' && bare.short === 0 && !bare.spill && bareWide.figures === 0 && bareWide.short === 0 && !bareWide.spill && bareWide.head > 1200,
      `a strip of ${bare.head} px: the buttons end ${bare.short} px from its edge; a strip of ${bareWide.head} px, as in a maximised window: ${bareWide.short} px; figures on it: ${bare.figures}`);

    // The same strip above a chat at work: a made-up session is tied to this chat, so there is something to say.
    // The panel beside the chat then shows its tool calls, its subagents and its conversation.
    const real = watch.latest();
    watch.post({ type: 'pace', ms: 600000 });
    await wait(700);
    madeAt = Date.now();
    await installFakes();
    await exec(`takeSnapshot(${fake(Date.now(), [busyRow({ chat: a.id, tokens: { in: 9000, out: 120000, cacheWrite: 800000, cacheRead: 9400000, tools: 88, share: 1 } })])})`);
    await exec('Desk.setInspector(true)');
    const narrower = await until(async () => { const c = await exec('term.cols'); return c < cols0 ? c : 0; }, 5000);
    await wait(300);
    const beside = await inPage(pageDetail, 'inspector');
    const strip = await stripOf(a.id);
    const inList = (await inPage(pageSide))[0];
    const tabsRoom = await inPage(() => { const t = document.querySelector('#inspector .d-tabs'); return [t.scrollWidth, t.clientWidth]; });
    const tabsFit = tabsRoom[0] <= tabsRoom[1];
    check('the strip above a chat at work says which chat it is, what it is doing and how full its memory is, and nothing else',
      strip.name === 'Pricing research' && strip.doing === 'Agent · Compare competitor D' && /^\d+m \d\ds$/.test(strip.timer) && same(strip.facts, ['86% memory']) && strip.figures === 1
      && strip.buttons === 3 && strip.pressed && !strip.nameCut && strip.short === 0 && !strip.spill && inList.mark === 'working' && inList.sub === strip.doing,
      `"${strip.name}" · ${strip.doing} · ${strip.timer} · ${strip.facts.join(' · ')}; in a strip of ${strip.head} px what it is doing is ${strip.doingCut ? 'cut short' : 'said in full'}`);
    check('the panel beside a chat shows its tool calls, subagents and numbers, every tab of it in sight, and the terminal makes room',
      beside.shown && beside.tabs.length === 5 && beside.tabs[0] === 'Overview*' && beside.calls === 5 && beside.agents === 4 && Boolean(narrower) && tabsFit,
      `tabs: ${beside.tabs.join(', ')} in ${tabsRoom[0]} of ${tabsRoom[1]} px; ${beside.calls} tool calls, ${beside.agents} subagents; ${cols0} -> ${narrower} columns`);

    // what the chat holds on this computer (made-up figures): the RAM at the end of its row in the list, the rest in the hover notes, and line by line in the panel
    const frozenWas = await exec('Desk.state.frozen');
    await exec(`Desk.state.frozen = true; Desk.state.res = ${JSON.stringify(madeUpRes(a.id))}; paint()`);
    await wait(200);
    const heldHere = await inPage((id) => {
      const item = document.querySelector('#chat-list .nav-item.chat[data-row^="chat:"]');
      const head = document.querySelector(`#tiles .tile[data-id="${id}"] .tile-head`);
      const tips = item.dataset.tip.split('\n\n');
      // what the strip leaves out is on its card: opened with its button, read, and closed again
      Desk.Glance.toggle(id);
      const card = document.querySelector(`#tiles .tile[data-id="${id}"] .glance-card`);
      const rows = card ? Object.fromEntries([...card.querySelectorAll('.glance-grid dt')].map((dt) => [dt.textContent, dt.nextElementSibling.textContent])) : {};
      Desk.Glance.hide();
      return { side: item.querySelector('.m-ram').textContent, place: tips[0].split('\n').find((l) => /^Ctrl \d$/.test(l)) || '', num: item.dataset.num, subs: tips[0].split('\n').includes('3 subagents working'), sideTip: tips[1] || '',
        rows, gone: !document.querySelector('.glance-card'),
        figures: head.querySelectorAll('.fact').length,
        pane: [...document.querySelectorAll('#inspector .d-body .sec-head h4')].map((x) => x.textContent), lines: document.querySelectorAll('#inspector .res-row:not(.head)').length,
        spill: document.querySelector('#inspector .d-body').scrollWidth > document.querySelector('#inspector .d-body').clientWidth + 1 };
    }, a.id);
    check('a chat holding 1 GB or more says so on its row in the list, and the note on that row lists what it runs',
      heldHere.side === '1.3 GB' && heldHere.place === (heldHere.num ? `Ctrl ${heldHere.num}` : '') && heldHere.subs
      && heldHere.sideTip === 'This chat holds 1.3 GB of RAM in 16 programs and uses 14% of the processor.\nA server is up on :5173\nRAM as Task Manager counts it.\nIt runs: vite · python · 3 subagents · 2 MCP servers'
      && heldHere.pane.includes('On this computer') && heldHere.lines === 6 && !heldHere.spill,
      `list "${heldHere.side}", its note ends in "${heldHere.place}"; the panel lists ${heldHere.lines} programs`);
    const meterNow = await inPage(() => { const m = document.getElementById('side-meter'); return m && !m.hidden ? { text: m.textContent, tip: m.dataset.tip || '' } : null; });
    check('the foot of the list says what all of Lowlit takes (the app, the keeper of its consoles and what its chats run), then each share',
      Boolean(meterNow) && meterNow.text === 'Lowlit1.8 GB16%app 540 MB · 1 chat 1.3 GB' && meterNow.tip.startsWith('All of Lowlit: 1.8 GB of RAM, 16% of the processor.')
      && meterNow.tip.includes("the keeper that holds your chats' consoles") && meterNow.tip.includes('1 chat here') && meterNow.tip.includes('This computer has 64 GB of RAM.'),
      meterNow ? meterNow.text : 'not shown');
    const rest = heldHere.rows;
    check('everything the strip leaves out is on its card at a glance: what it does, where, the model, the memory in tokens, the subagents, the messages waiting, today, the cost, the cache, the RAM and what it runs',
      rest.Doing === 'Agent · Compare competitor D' && rest.Where === `In this window${heldHere.num ? ` · Ctrl ${heldHere.num}` : ''}` && rest.Model === 'Opus 5.5 · effort max · never asks permission'
      && /86% memory/.test(rest.Context || '') && /402k of about 467k tokens · compacted 2×$/.test(rest.Context || '') && /^3 working/.test(rest.Agents || '')
      && rest.Waiting === '2 messages waiting their turn' && rest.Today === '121k tokens out · 47m of work' && rest.Cost === '$42 at list prices since its program started'
      && /^warm until \d\d:\d\d$/.test(rest.Cache || '') && /^1\.3 GB · CPU 14%.* · :5173$/.test(rest['On this PC'] || '') && rest['It runs'] === 'vite · python · 3 subagents · 2 MCP servers'
      && heldHere.gone && heldHere.figures === 1,
      `${Object.keys(rest).length} rows on the card: ${Object.entries(rest).map(([k, v]) => `${k}: ${v}`).join(' | ').slice(0, 420)}; figures on the strip itself: ${heldHere.figures}`);

    // A wide window: the strip reaches the edge of the window, what the chat is doing is said in full, and a name
    // too long for the strip is cut later.
    const [w1, h1] = win.getContentSize();
    const colsNow = await exec('term.cols');
    const LONG = 'Rebuild the checkout page so the tax field is kept when the basket is edited twice';
    const named = async (title) => {
      await exec(`desk.rename(${JSON.stringify(a.id)}, ${JSON.stringify(title)})`);
      return until(async () => { const n = (await stripOf(a.id)).name; return title ? n === title : n !== LONG; }, 4000);
    };
    await named(LONG);
    const nameSmall = await stripOf(a.id);
    await named('');
    win.setContentSize(1920, 1040);
    await wait(500);
    const wideStrip = await stripOf(a.id);
    await shoot('1-chat-wide');
    await named(LONG);
    const nameWide = await stripOf(a.id);
    await named('');
    const wideNow = win.getContentSize();
    win.setContentSize(w1, h1);
    await until(async () => (await exec('term.cols')) === colsNow, 5000);
    check('in a wide window the strip above a chat reaches the edge, says what the chat is doing in full, and a long name is cut later',
      wideStrip.head > 1100 && wideStrip.short === 0 && !wideStrip.doingCut && !wideStrip.nameCut && !wideStrip.spill && nameSmall.nameCut && !nameSmall.spill && nameWide.nameWide >= nameSmall.nameWide + 100,
      `window ${wideNow.join(' x ')}, a strip of ${wideStrip.head} px: the buttons end ${wideStrip.short} px from its edge; `
      + `a name of ${LONG.length} letters gets ${nameSmall.nameWide} px in the window as it was and ${nameWide.nameWide} px in the wide one`);
    await wait(300);
    await shoot('1-chat-panel');
    // its conversation, read beside its terminal
    await tabOf('inspector', 'conv');
    await wait(300);
    const reading = await inPage(pageReader, 'inspector');
    const fits = await inPage(() => { const b = document.querySelector('#inspector .d-body'); return b.scrollWidth <= b.clientWidth + 1 && document.documentElement.scrollWidth <= document.documentElement.clientWidth; });
    check('its conversation can be read in the panel beside its terminal', reading.asks === 1 && reading.says === 2 && reading.tools === 5 && reading.running === 2 && reading.thoughts === 1 && fits,
      `${reading.asks} asked, ${reading.says} said, ${reading.tools} tool calls (${reading.running} running); nothing spills sideways: ${fits}`);
    await shoot('1-chat-reading');
    await tabOf('inspector', 'overview');
    await exec('Desk.setInspector(false)');
    await until(async () => (await exec('term.cols')) === cols0, 5000);
    await exec(`Desk.state.res = null; Desk.state.frozen = ${JSON.stringify(Boolean(frozenWas))}; takeSnapshot(${JSON.stringify(real)}); Reader.fake = null; History.fake = null`);
    watch.post({ type: 'pace', ms: 2000 });

    // text size, from the Settings page: a page of its own, so the chat takes the new size once it is in front again
    const rows16 = await exec('term.rows');
    await exec('Settings.open("terminal")');
    // two steps: at this screen's scaling one step can leave a letter the same whole number of pixels wide
    await exec('document.querySelectorAll("#settings .stepper .btn")[1].click()');
    await until(async () => (await exec('Terms.fontSize()')) === 17, 3000);
    await exec('document.querySelectorAll("#settings .stepper .btn")[1].click()');
    await until(async () => (await exec('Terms.fontSize()')) === 18, 3000);
    await exec('Settings.close()');
    const larger = await until(async () => ((await exec('Terms.fontSize()')) === 18 && (await exec('term.cols')) < cols0 ? { cols: await exec('term.cols'), rows: await exec('term.rows') } : null), 5000);
    // the console itself must have been told
    await type('$Host.UI.RawUI.WindowSize.Width\r');
    const told = larger && await until(async () => (await linesOf(a.id)).some((l) => l.trim() === String(larger.cols)), 5000);
    await exec('Settings.open("terminal")');
    await exec('document.querySelectorAll("#settings .stepper .btn")[0].click()');
    await until(async () => (await exec('Terms.fontSize()')) === 17, 3000);
    await exec('document.querySelectorAll("#settings .stepper .btn")[0].click()');
    await until(async () => (await exec('Terms.fontSize()')) === 16, 3000);
    await exec('Settings.close()');
    const back = await until(async () => (await exec('Terms.fontSize()')) === 16 && (await exec('term.cols')) === cols0 && (await exec('term.rows')) === rows16, 5000);
    check('a larger text size, picked in Settings, gives the console fewer columns and rows once the chat is in front again, and stepping back restores them',
      Boolean(larger) && larger.rows < rows16 && Boolean(told) && Boolean(back),
      `${cols0} x ${rows16} cells at 16 px, ${larger ? `${larger.cols} x ${larger.rows}` : '?'} at 18 px; the console said its new width: ${Boolean(told)}; back to ${await exec('term.cols')} x ${await exec('term.rows')}`);
    await wait(300);
    return { cols0 };
  };

  // The console decides where the next character goes by counting cells, and
  // so does the widget. Where the two count an emoji or a kaomoji differently,
  // everything after it on that line is drawn off by the difference.
  const widthsPhase = async () => {
    const script = path.join(dir, 'widths.ps1');
    fs.writeFileSync(script, [
      '$samples = [ordered]@{',
      ...Object.entries(SAMPLES).map(([name, points]) => `  '${name}' = @(${points.map((p) => '0x' + p.toString(16)).join(', ')})`),
      '}',
      'foreach ($name in $samples.Keys) {',
      '  $s = -join ($samples[$name] | ForEach-Object { [char]::ConvertFromUtf32($_) })',
      "  Write-Host -NoNewline ($s + '|')",
      '  $x = $Host.UI.RawUI.CursorPosition.X',
      "  Write-Host ''",
      '  "$t-$name=$x"',
      '}',
      '"$t-done"',
      '',
    ].join('\r\n'));

    await type('cls\r');
    await wait(400);
    await type(`$t = 'w'; Invoke-Expression (Get-Content -Raw -LiteralPath '${script}')\r`);
    const done = await until(async () => (await linesOf(agent.chat)).some((l) => l.trim() === 'w-done'), 20000);
    notes.widths = done ? await inPage(pageWidths, 'w') : {};
    await type('cls\r');
    await wait(400);

    const names = Object.keys(SAMPLES);
    const differ = names.filter((name) => !notes.widths[name] || notes.widths[name].widget !== notes.widths[name].console);
    // both counts include the one cell of the end mark
    for (const name of differ) {
      const got = notes.widths[name];
      say(`      ${name}: the console counts ${got ? got.console - 1 : '?'} cells, the widget draws ${got ? got.widget - 1 : '?'}`);
    }
    check('emoji and kaomoji take the same number of cells in the console and in the widget',
      differ.length === 0, differ.length ? `differs for: ${differ.join(', ')}` : `${names.length} samples`);
  };

  // ---- chats side by side: each in a place of its own, each console the size of its place ----
  const twoPhase = async ({ cols0 }) => {
    const a = agent.chat;
    const idsOf = (x) => x.tiles.map((t) => t.id);
    const level = (x, y) => Math.abs(x - y) <= 1;
    const marks = async (list) => Promise.all(list.map(async (id) => (await stripOf(id)).marked));
    const listNow = async () => (await inPage(pageSide)).map((s) => [s.id, s.shown, s.active]);

    // ---- two: a second chat opens beside the first, and takes the keyboard ----
    const made = await inPage(pageNew, plain);
    const b = made && made.id;
    if (!check('a second chat opens in this window', Boolean(b) && b !== a)) throw new Error('no second chat');
    check('PowerShell starts in the second chat', Boolean(await until(promptBack, 30000)));
    let t = await tilesNow();
    check('the two stand side by side, each in half of the panel, and the new one holds the keyboard',
      t.n === 2 && same(idsOf(t), [a, b]) && level(t.tiles[0].y, t.tiles[1].y) && level(t.tiles[0].w, t.tiles[1].w) && t.tiles[1].x > t.tiles[0].x && t.tiles.every((x) => x.drawn)
      && t.tiles[1].on && !t.tiles[0].on && t.keyboard === b && same(t.split, ['1', '2*', '4']) && same(t.order, [a, b]) && t.parked === 0,
      t.tiles.map((x) => `${x.w} x ${x.h} px at ${x.x}`).join(' and '));
    check('the chat that holds the keyboard is marked on its strip and in the list, where both show as on screen',
      same(await marks([a, b]), [false, true]) && same(await listNow(), [[a, true, false], [b, true, true]]));

    // each console is told the width of its own place
    const colsA = t.tiles[0].cols;
    const colsB = t.tiles[1].cols;
    const rowsB = t.tiles[1].rows;
    await askWidth('wb');
    const toldB = await widthSeen(b, 'wb', colsB);
    // a press in the other place gives it the keyboard; the places themselves stay as they are
    await inPage(() => { document.querySelectorAll('#tiles .tile').forEach((el, i) => { el.dataset.kept = `k${i}`; }); return true; });
    const moved = await giveKeyboard(a);
    await wait(150);
    t = await tilesNow();
    check('a press in the other chat gives it the keyboard, and neither chat moves', moved && t.keyboard === a && (await exec('Desk.state.view')) === a && same(idsOf(t), [a, b])
      && same(t.tiles.map((x) => x.kept), ['k0', 'k1']) && same(await marks([a, b]), [true, false]) && same(await listNow(), [[a, true, true], [b, true, false]]));
    await askWidth('wa');
    const toldA = await widthSeen(a, 'wa', colsA);
    check('each console has the width of its own place, about half of what one chat alone has',
      Boolean(toldA) && Boolean(toldB) && colsA < cols0 && colsA <= Math.ceil(cols0 / 2) && colsA >= Math.floor(cols0 / 2) - 4 && level(colsA, colsB),
      `${cols0} columns alone; side by side ${colsA} and ${colsB}`);

    await type(`Write-Host 'only-in-first'\r`);
    const inA = await until(async () => (await linesOf(a)).includes('only-in-first'), 8000);
    const inB = (await linesOf(b)).some((l) => l.includes('only-in-first'));
    check('what is typed goes to the chat that holds the keyboard, and to no other', Boolean(inA) && !inB);
    // the chat beside it keeps taking its console's output
    await exec(`desk.input(${JSON.stringify(b)}, ${JSON.stringify("Start-Sleep -Milliseconds 1200; Write-Host 'late-in-second'\r")})`);
    const late = await until(async () => (await linesOf(b)).includes('late-in-second'), 8000);
    check('a chat that does not hold the keyboard keeps receiving its output', Boolean(late) && (await exec('Terms.active()')) === a);
    // more lines than its place is tall, so there is something above the end to be scrolled back to
    await exec(`desk.input(${JSON.stringify(b)}, ${JSON.stringify('1..80 | ForEach-Object { "row $_" }\r')})`);
    await until(async () => (await linesOf(b)).includes('row 80'), 8000);

    // ---- one chat big, and back: Ctrl Shift Enter ----
    await ctrl('Enter', { shift: true });
    const whole1 = await until(async () => (await exec('term.cols')) === cols0, 5000);
    await askWidth('w1');
    const told1 = await widthSeen(a, 'w1', cols0);
    const mainSays = await until(async () => { const s = settingsNow(); return s.tiles === 1 && s.split === 2; }, 3000, 100);
    t = await tilesNow();
    check('Ctrl Shift Enter makes the chat that holds the keyboard big: it has the whole panel, its console is told, and the choice is kept',
      Boolean(whole1) && Boolean(told1) && t.n === 1 && same(idsOf(t), [a]) && t.keyboard === a && same(t.saved, [1, 2]) && Boolean(mainSays) && same(t.split, ['1*', '2', '4']) && t.parked === 1
      && same(t.order, [a, b]) && same(await marks([a]), [false]) && same(await listNow(), [[a, true, true], [b, false, false]]),
      `${t.tiles[0] ? t.tiles[0].cols : '?'} columns; the other chat waits off screen`);
    // off screen it still takes its output, and keeps the size it had: a resize of the window reaches only what is on screen
    await exec(`desk.input(${JSON.stringify(b)}, ${JSON.stringify("Write-Host 'while-away'\r")})`);
    const away = await until(async () => (await linesOf(b)).includes('while-away'), 8000);
    const [w0, h0] = win.getContentSize();
    win.setContentSize(1180, 720);
    const cols1 = await until(async () => { const c = await exec('term.cols'); return c !== cols0 ? c : 0; }, 5000);
    await wait(400);
    const keptB = await colsOf(b);
    await ctrl('Enter', { shift: true });
    const refit = await until(async () => { const c = await colsOf(b); return c !== colsB ? c : 0; }, 5000);
    await wait(300);
    t = await tilesNow();
    const backB = t.tiles[1] || {};
    check('a chat that is off screen keeps receiving its output and keeps the size it had', Boolean(away) && Boolean(cols1) && keptB === colsB, `${keptB} columns while the window went from ${w0} to 1180 px`);
    check('Ctrl Shift Enter again puts the chats side by side as they were, and the one that comes back is fitted to its place',
      t.n === 2 && same(idsOf(t), [a, b]) && t.keyboard === a && same(t.saved, [2, 2]) && Boolean(refit) && refit < colsB && backB.drawn && t.parked === 0,
      `back with ${refit} columns in a narrower window (it had ${colsB})`);
    check('and it stands at the end of what it holds', Boolean(backB.atEnd));
    const kbB = await giveKeyboard(b);
    await askWidth('w2');
    const told2 = refit && await widthSeen(b, 'w2', refit);
    check('its console was told its new width', kbB && Boolean(told2), `${refit} columns`);
    // It came back into a lower place than it left, and its console has printed since. A terminal that is still
    // laid out against its old height is thrown up by the difference at the first line printed, and stays there.
    const following = (await tilesNow()).tiles[1] || {};
    check('and it goes on following what its console prints', Boolean(following.atEnd) && following.rows < rowsB,
      `${following.rows} rows now, it left with ${rowsB}; at the end: ${Boolean(following.atEnd)}`);
    win.setContentSize(w0, h0);
    await until(async () => (await colsOf(a)) === colsA && (await colsOf(b)) === colsB, 5000);
    await wait(300);

    notes.memoryTwo = await report('with two plain chats open');
    // what would be brought back after a restart, and how many share the screen
    const kept = await until(async () => {
      try { const d = JSON.parse(fs.readFileSync(path.join(app.getPath('userData'), 'desk.json'), 'utf8')); return Array.isArray(d.open) && d.open.length === 2 && d.tiles === 2 ? d : null; } catch { return null; }
    }, 3000, 200);
    check('the open chats, and how many share the screen, are written down for next time', Boolean(kept) && kept.open.every((c) => c.cwd === folder) && kept.split === 2,
      kept ? `${kept.open.length} chats, ${kept.tiles} on screen` : 'not on disk');

    // ---- a third chat: it takes the place of the chat used longest ago, which waits in line ----
    await giveKeyboard(a);
    const third = await inPage(pageNew, plain);
    const c = third && third.id;
    if (!check('a third chat opens', Boolean(c))) throw new Error('no third chat');
    await until(promptBack, 30000);
    t = await tilesNow();
    check('with two places and three chats, the new one takes the place of the chat used longest ago, and the one used last stays where it is',
      t.n === 2 && same(idsOf(t), [a, c]) && t.keyboard === c && same(t.order, [a, c, b]) && t.parked === 1 && same(await listNow(), [[a, true, false], [b, false, false], [c, true, true]]),
      `on screen: ${idsOf(t).join(', ')}; in line: ${t.order.slice(2).join(', ')}`);

    // ---- four at once ----
    await press('#split button[data-n="4"]');
    await wait(400);
    t = await tilesNow();
    const three = t.tiles;
    check('asked for four, three chats share the screen: two above, the third across the foot',
      t.n === 3 && same(idsOf(t), [a, c, b]) && level(three[0].y, three[1].y) && three[2].y > three[0].y && level(three[2].x, three[0].x) && Math.abs(three[2].w - (three[0].w + three[1].w + 1)) <= 2
      && t.tiles.every((x) => x.drawn) && same(t.saved, [4, 4]) && same(t.split, ['1', '2', '4*']) && t.keyboard === c && t.parked === 0,
      three.map((x) => `${x.w} x ${x.h} px`).join(', '));
    const fourth = await inPage(pageNew, plain);
    const d = fourth && fourth.id;
    if (!check('a fourth chat opens', Boolean(d))) throw new Error('no fourth chat');
    await until(promptBack, 30000);
    await wait(300);
    t = await tilesNow();
    const four = t.tiles;
    check('four chats stand two above two, each drawn, each with room to work in',
      t.n === 4 && same(idsOf(t), [a, c, b, d]) && level(four[0].y, four[1].y) && level(four[2].y, four[3].y) && four[2].y > four[0].y && level(four[0].x, four[2].x) && level(four[1].x, four[3].x)
      && level(four[0].w, four[3].w) && level(four[0].h, four[3].h) && t.tiles.every((x) => x.drawn && x.rows >= 6 && x.cols >= 20) && t.keyboard === d && same(await marks([a, c, b, d]), [false, false, false, true]),
      four.map((x) => `${x.cols} x ${x.rows} cells`).join(', '));
    await askWidth('w4');
    check('the console of the fourth is told the width of its quarter', Boolean(await widthSeen(d, 'w4', four[3] ? four[3].cols : 0)), `${four[3] ? four[3].cols : '?'} columns`);
    notes.memoryFour = await report('with four plain chats on screen');
    await shoot('1-four');

    // ---- the keys: a chat by its number in the list, back to the chat used before this one, and further back. In a
    // ---- workspace of this run's folder alone, so the person's own chats elsewhere take none of the numbers. ----
    const spacesBefore = await exec('JSON.stringify([Desk.state.settings.spaces.length, Desk.state.settings.space])');
    const keysSpace = await call('addSpace', 'Made-up keys');
    await call('putFolder', folder, keysSpace);
    await call('switchSpace', keysSpace);
    await wait(250);
    const numbers = await inPage((ids) => ids.map((id) => chatNumber(id)), [a, b, c, d]);
    // what each numbered row is, by kind only (a row of the person's own is never named here)
    const numberedKinds = await inPage(() => [...document.querySelectorAll('#chat-list .nav-item.chat')].filter((el) => el.dataset.num)
      .map((el) => `${el.dataset.num}:${el.dataset.row.split(':')[0]}${el.closest('.group') ? `/${el.closest('.group').dataset.group}` : ''}`));
    const tipNumbers = await inPage((ids) => ids.map((id) => {
      const row = document.querySelector(`#chat-list .nav-item.chat[data-id="${id}"]`);
      return row ? (row.dataset.tip.split('\n\n')[0].split('\n').find((l) => /^Ctrl \d$/.test(l)) || '') : '';
    }), [a, b, c, d]);
    const walked = [];
    const step = async (code, how) => { await ctrl(code, how); await wait(120); walked.push(await exec('Terms.active()')); };
    await step(`Digit${numbers[0]}`);
    await step(`Digit${numbers[1]}`);
    await step('Tab');
    await step('Tab');
    // Ctrl kept down: a second Tab goes one chat further back
    await ctrl('Tab', { held: true });
    await step('Tab');
    await step('Tab', { shift: true });
    await call('switchSpace', JSON.parse(spacesBefore)[1]);
    await call('removeSpace', keysSpace);
    await wait(250);
    check('Ctrl 1 to 9 goes to a chat by its number in the list (each number once, the same in its row\'s note); Ctrl Tab goes back to the chat used before this one, and with Ctrl kept down a step further each time',
      numbers.every((n) => n >= 1) && new Set(numbers).size === 4 && same(tipNumbers, numbers.map((n) => `Ctrl ${n}`)) && same(walked, [a, b, a, b, d, c])
      && (await exec('JSON.stringify([Desk.state.settings.spaces.length, Desk.state.settings.space])')) === spacesBefore,
      `numbers ${numbers.join(', ')} (the numbered rows: ${numberedKinds.join(' ')}); asked for: ${numbers[0]}, ${numbers[1]}, back, back, back twice, the other way; the keyboard went to ${walked.join(', ')}`);

    // ---- another page of the window and back: the chats come back as they were ----
    await view('stats');
    await wait(200);
    const gone = await tilesNow();
    await ctrl('Tab');
    await wait(300);
    t = await tilesNow();
    const linesB = await linesOf(b);
    check('on another page of the window no terminal is drawn; "back" leads to the chat used last, and all four are on screen again as they were',
      gone.n === 0 && gone.parked === 4 && t.n === 4 && same(idsOf(t), [a, c, b, d]) && t.keyboard === c && t.tiles.every((x) => x.drawn) && t.parked === 0
      && ['late-in-second', 'while-away', 'row 80'].every((l) => linesB.includes(l)),
      `away: ${gone.parked} terminals waiting off screen; back: ${t.n} on screen, the keyboard in ${t.keyboard}`);
    check('each of them stands at the end of what it holds', t.tiles.every((x) => x.atEnd), t.tiles.map((x) => `${x.id}: ${x.atEnd ? 'at the end' : 'scrolled up'}`).join(', '));

    // ---- the search box knows the same commands ----
    await exec('Palette.open()');
    await wait(300);
    await typeInto('#palette input', 'show two');
    await wait(150);
    const found = await inPage(() => {
      const items = [...document.querySelectorAll('#palette .pal-item')];
      const hit = items.find((el) => el.querySelector('.label').textContent === 'Show two chats side by side');
      if (hit) hit.click();
      return { n: items.length, hit: Boolean(hit) };
    });
    await wait(300);
    t = await tilesNow();
    check('the search box finds "Show two chats side by side", and running it puts two on screen',
      found.hit && t.n === 2 && same(idsOf(t), [a, c]) && t.keyboard === c && same(t.saved, [2, 2]) && same(t.order, [a, c, b, d]) && (await exec('document.getElementById("palette").hidden')) === true,
      `${found.n} entries for "show two"; on screen: ${idsOf(t).join(', ')}`);

    // ---- closing one: the others stay, and its place goes to the chat that waits first in line ----
    await giveKeyboard(a);
    const goneC = await closeAndWait(c);
    await wait(200);
    t = await tilesNow();
    check('closing one chat leaves the others running, and its place goes to the chat that waits first in line',
      goneC && [a, b, d].every((id) => chats.all.has(id) && alive(chats.all.get(id).pid)) && t.n === 2 && same(idsOf(t), [a, b]) && t.keyboard === a && same(t.order, [a, b, d])
      && same((await inPage(pageSide)).map((s) => s.id), [a, b, d]), `still open: ${t.order.join(', ')}; on screen: ${idsOf(t).join(', ')}`);

    // the offer shown after a restart, with one chat on it
    await exec(`Desk.state.info.previous = ${JSON.stringify([{ cwd: folder, starter: 'shell', title: '', resume: '', mode: '' }])}; banner(Desk.state.info.previous)`);
    const offered = await exec('!document.querySelector("#notes > .callout:nth-child(3)").hidden');
    await exec('document.querySelector("#notes > .callout:nth-child(3) .btn.primary").click()');
    const again = await until(async () => {
      const front = await exec('Terms.active()');
      return chats.all.size === 4 && front && ![a, b, d].includes(front) ? front : '';
    }, 8000);
    check('the offer to bring back the chats of last time opens them, and the one that comes back takes the keyboard',
      offered && Boolean(again) && (await exec('document.querySelector("#notes > .callout:nth-child(3)").hidden')) === true, `reopened as ${again}`);
    if (again) {
      await until(promptBack, 20000);
      await closeAndWait(again);
    }

    // a chat that is the view of a background session: such a session runs outside every console here,
    // so the watcher has to be told which chat shows it
    const bg = watch.latest().chats.find((x) => x.job);
    if (!bg) {
      say('      no background session on this machine: tying one to the chat that shows it was not checked');
    } else {
      // a plain shell stands in for the view: nothing is attached to the real session
      const v = chats.create({ cwd: folder, command: '', starter: 'shell', title: 'View check', job: bg.job }).id;
      const rowOf = () => watch.latest().chats.find((x) => x.job === bg.job);
      const tied = await until(async () => rowOf() && rowOf().chat === v, 8000);
      await wait(400);
      // its session is in the list once: as the chat of this window that shows it (what it is called and says is the person's: only its shape is kept)
      const asListed = await inPage((key) => [...document.querySelectorAll('#chat-list .nav-item.chat')].filter((el) => el.dataset.key === key)
        .map((el) => ({ here: el.classList.contains('k-here'), id: el.dataset.id, label: el.querySelector('.label').textContent === 'View check', mark: el.dataset.mark })), bg.key);
      await exec(`Desk.showSession(${JSON.stringify(bg.key)})`);
      await wait(200);
      const led = await exec('Desk.state.view');
      check('a background session shown in a chat here is tied to that chat: it is in the list once, as that chat, and asking for it leads to its terminal',
        Boolean(tied) && asListed.length === 1 && asListed[0].here && asListed[0].id === v && asListed[0].label && asListed[0].mark !== 'none' && led === v,
        `rows for it in the list: ${asListed.length}; mark "${asListed[0] ? asListed[0].mark : ''}"`);
      await exec(`Desk.closeChat(${JSON.stringify(v)})`);
      const untied = await until(async () => !chats.all.has(v) && rowOf() && rowOf().chat === '', 20000, 100);
      check('closing that chat leaves the session where it was, offered again', Boolean(untied));
    }

    // back to one chat, with the whole panel
    const goneB = await closeAndWait(b);
    const goneD = await closeAndWait(d);
    await view(a);
    const alone = await until(async () => (await exec('term.cols')) === cols0, 5000);
    t = await tilesNow();
    check('with the others closed the first chat has the whole panel again', goneB && goneD && Boolean(alone) && t.n === 1 && same(idsOf(t), [a]) && t.keyboard === a && chats.all.size === 1,
      `${t.tiles[0] ? t.tiles[0].cols : '?'} columns`);
  };

  // ---- workspaces with real consoles: each has its own chats on screen, and a chat goes on running while another
  // ---- workspace is in front. Plain consoles in folders the run makes for itself.
  const spacesPhase = async ({ cols0 }) => {
    const a = agent.chat;
    const idsOf = (x) => x.tiles.map((t) => t.id);
    const spaceIn = () => exec('Desk.state.settings.space');
    const listed = async () => (await inPage(pageSide)).map((s) => s.id);
    const [one, two, three] = ['one', 'two', 'three'].map((name) => path.join(dir, 'work', name));
    for (const f of [one, two, three]) fs.mkdirSync(f, { recursive: true });
    // these folders have long paths: in half of the panel the prompt runs over two rows, and only its end says it is there
    const ready = () => until(async () => { const rows = (await screen()).filter((l) => l.trim()); return rows.length > 0 && />\s*$/.test(rows[rows.length - 1]); }, 30000);

    // ---- a new workspace: the chat that was open steps aside ----
    const first = await call('addSpace', 'First');
    await wait(300);
    let t = await tilesNow();
    const page = await inPage(pagePeek);
    check('a new workspace starts empty: the chat that was open steps aside, still running, and the start page says whose it is',
      /^w[0-9a-z]{1,12}$/.test(first || '') && t.n === 0 && t.parked === 1 && page.start === 'No chat of First is open in this window' && (await listed()).length === 0
      && chats.all.has(a) && alive(chats.all.get(a).pid), `on screen: ${t.n}; waiting off screen: ${t.parked}; the page: "${page.start}"`);

    // ---- started from the New chat panel in a folder that is in no workspace: the folder joins the one in front ----
    await exec('document.getElementById("toast").hidden = true; Desk.openPicker()');
    await wait(250);
    const offered = await inPage(() => {
      const shell = [...document.querySelectorAll('#picker .seg button')].find((b) => b.textContent === 'PowerShell');
      if (shell) shell.click();
      const note = document.querySelector('#picker .pick-note');
      return { shell: Boolean(shell), note: note && !note.hidden ? note.textContent : '' };
    });
    await typeInto('#picker .pathrow .input', one);
    await inPage(pageKey, 'Enter', '#picker .pathrow .input');
    const x1 = await until(async () => { const id = await exec('Terms.active()'); return id && id !== a ? id : ''; }, 10000, 100);
    const joined = await toastNow();
    if (!check('a chat opens from the New chat panel', Boolean(x1), x1 || 'no chat')) throw new Error('no chat in the workspace');
    await ready();
    t = await tilesNow();
    check('a chat started from the New chat panel in a folder that is in no workspace puts that folder in the workspace in front, and says so',
      offered.shell && offered.note === 'A folder that is in no workspace yet joins First. One that is in another workspace opens there.'
      && joined === '"one" is now part of First.' && Boolean(await until(async () => same(keptSpaces(), [['First', [one]]]), 3000, 100)) && (await spaceIn()) === first
      && t.n === 1 && same(idsOf(t), [x1]) && t.keyboard === x1 && t.parked === 1 && same(await listed(), [x1]), `"${joined}"; on screen: ${t.n}; waiting off screen: ${t.parked}`);

    // ---- a second chat beside it, then a second workspace with one chat ----
    await call('putFolder', two, first);
    const made2 = await inPage(pageNew, { cwd: two, starter: 'shell' });
    const x2 = made2 && made2.id;
    if (!check('a second chat opens in the same workspace', Boolean(x2), x2 || 'no chat')) throw new Error('no second chat in the workspace');
    await ready();
    const second = await call('addSpace', 'Second');
    await call('putFolder', three, second);
    const made3 = await inPage(pageNew, { cwd: three, starter: 'shell' });
    const x3 = made3 && made3.id;
    if (!check('a chat opens in a second workspace', Boolean(x3), x3 || 'no chat')) throw new Error('no chat in the second workspace');
    await ready();
    t = await tilesNow();
    const inSecond = { ids: idsOf(t), keyboard: t.keyboard, parked: t.parked, list: await listed(), tabs: tabsOf(await spacesNow()) };
    await press(tabOfSpace(first));
    await wait(400);
    t = await tilesNow();
    const inFirst = { ids: idsOf(t), keyboard: t.keyboard, parked: t.parked, list: await listed(), drawn: t.tiles.every((x) => x.drawn), tabs: tabsOf(await spacesNow()) };
    check('each workspace has its own chats on screen: its tab brings them back side by side, and the list holds only them',
      same(inSecond.ids, [x3]) && inSecond.keyboard === x3 && inSecond.parked === 3 && same(inSecond.list, [x3]) && same(inSecond.tabs.slice(0, 3), ['All', 'First', 'Second*'])
      && same(inFirst.ids, [x1, x2]) && inFirst.keyboard === x2 && inFirst.parked === 2 && same(inFirst.list, [x1, x2]) && inFirst.drawn && same(inFirst.tabs.slice(0, 3), ['All', 'First*', 'Second'])
      && (await spaceIn()) === first,
      `Second: ${inSecond.ids.length} on screen, ${inSecond.parked} waiting off screen; First: ${inFirst.ids.length} on screen, ${inFirst.parked} waiting off screen`);

    // ---- the keys stay inside the workspace in front ----
    const walked = [];
    const step = async (code, how) => { await ctrl(code, how); await wait(150); walked.push(await exec('Terms.active()')); };
    await step('Tab');
    await step('Digit2');
    await step('Digit1');
    await step('Digit3');
    await step('Tab');
    check('Ctrl Tab and Ctrl 1 to 9 stay inside the workspace in front: its chats only, and no third place to go to',
      same(walked, [x1, x2, x1, x1, x2]) && (await spaceIn()) === first, `asked for: back, place 2, place 1, place 3, back; the keyboard went to ${walked.join(', ')}`);

    // ---- a chat goes on running while another workspace is in front ----
    await exec(`desk.input(${JSON.stringify(x3)}, ${JSON.stringify("1..60 | ForEach-Object { \"row $_\" }; Write-Host 'while-elsewhere'\r")})`);
    const away = await until(async () => (await linesOf(x3)).includes('while-elsewhere'), 8000);
    await giveKeyboard(x1);
    await ctrl('Digit3', { shift: true });
    await wait(400);
    t = await tilesNow();
    const held = await linesOf(x3);
    check('a chat goes on running while another workspace is in front: it took everything its console printed, and stands at the end of it',
      Boolean(away) && same(idsOf(t), [x3]) && t.keyboard === x3 && t.tiles.every((x) => x.drawn && x.atEnd) && held.includes('row 60') && held.includes('while-elsewhere') && (await spaceIn()) === second,
      `${held.filter((l) => /^row \d+$/.test(l)).length} of 60 rows printed while First was in front`);
    await ctrl('Digit2', { shift: true });
    await wait(400);
    t = await tilesNow();
    const cols1 = t.tiles[0] ? t.tiles[0].cols : 0;
    await askWidth('ws');
    const told = await widthSeen(x1, 'ws', cols1);
    check('coming back to a workspace puts its chats where they stood, the keyboard in the one used last, each at the end of what it holds and as wide as its place',
      same(idsOf(t), [x1, x2]) && t.keyboard === x1 && t.tiles.every((x) => x.drawn && x.atEnd) && t.parked === 2 && Boolean(told) && cols1 > 0 && cols1 < cols0,
      `on screen: ${t.n}; ${cols1} columns each side by side (${cols0} alone)`);

    // ---- every chat, and what is asked for is followed into its workspace ----
    await ctrl('Digit1', { shift: true });
    await wait(400);
    t = await tilesNow();
    const inAll = { space: await spaceIn(), list: await listed(), ids: idsOf(t), keyboard: t.keyboard };
    await press(tabOfSpace(first));
    await wait(300);
    await view(x3);
    await wait(400);
    t = await tilesNow();
    const followed = { space: await spaceIn(), ids: idsOf(t), keyboard: t.keyboard };
    await view(a);
    await wait(400);
    t = await tilesNow();
    check('"All" holds the chats of every workspace and the ones in none; asking for a chat brings the workspace it is in in front with it',
      inAll.space === '' && same(inAll.list.slice().sort(), [a, x1, x2, x3].sort()) && same(inAll.ids, [x1, x2]) && inAll.keyboard === x1
      && followed.space === second && same(followed.ids, [x3]) && followed.keyboard === x3
      && (await spaceIn()) === '' && t.keyboard === a && t.n === 2 && idsOf(t).includes(a),
      `"All" lists ${inAll.list.length} chats; asking for the chat of Second led to ${followed.space === second ? 'Second' : 'somewhere else'}; asking for the one in no workspace led to ${(await spaceIn()) === '' ? '"All"' : 'somewhere else'}`);

    // ---- taken away again: the first chat is alone, under the word "Chats" ----
    const closed = (await closeAndWait(x1)) && (await closeAndWait(x2)) && (await closeAndWait(x3));
    await exec(`Desk.removeSpace(${JSON.stringify(first)}); Desk.removeSpace(${JSON.stringify(second)})`);
    await view(a);
    const alone = await until(async () => (await exec('term.cols')) === cols0, 5000);
    t = await tilesNow();
    const sp = await spacesNow();
    check('with the workspaces taken away and their chats closed, the first chat is alone again under the word "Chats"',
      closed && Boolean(alone) && t.n === 1 && same(idsOf(t), [a]) && t.keyboard === a && chats.all.size === 1 && !sp.on && sp.tabs.length === 0 && sp.label === 'Chats'
      && Boolean(await until(async () => settingsNow().spaces.length === 0 && settingsNow().space === '', 3000, 100)), `${t.tiles[0] ? t.tiles[0].cols : '?'} columns; tabs: ${sp.tabs.length}`);
  };

  const typingPart = async () => {
    // read the way Compact now and Continue all read a chat before they type into it
    const atPromptNow = () => inPage((id) => Desk.atPrompt(id), agent.chat);
    const ready = process.env.DESK_SELFTEST_READY ? (await screen()).some((l) => new RegExp(process.env.DESK_SELFTEST_READY).test(l))
      : await until(atPromptNow, 5000, 200);
    if (!check('the prompt box is idle and ready, as the app reads the screen', Boolean(ready))) throw new Error('prompt box not recognised; nothing was typed');

    await type('desk typing check');
    check('typing shows up in the prompt box', Boolean(await until(async () => (await screen()).some((l) => l.includes('desk typing check')), 5000)));
    await inPage(pageShiftEnter);
    await wait(300);
    await type('second line');
    await wait(900);
    let rows = await screen();
    const a = rows.findIndex((l) => l.includes('desk typing check'));
    const b = rows.findIndex((l) => l.includes('second line'));
    check('Shift+Enter starts a new line instead of sending', a >= 0 && b > a, `rows ${a} and ${b}`);

    if (notes.modes.bracketedPasteMode) {
      await exec(`term.paste(${JSON.stringify('pasted one\npasted two')})`);
      await wait(1200);
      rows = await screen();
      const p1 = rows.findIndex((l) => l.includes('pasted one'));
      const p2 = rows.findIndex((l) => l.includes('pasted two'));
      check('a two-line paste lands as two lines, not as a sent message', p1 >= 0 && p2 > p1, `rows ${p1} and ${p2}`);
    } else {
      say('      paste check skipped: the CLI did not switch on paste protection');
    }
    await wait(600);
    rows = await screen();
    check('nothing was sent to the model', !rows.some((l) => /esc to interrupt/i.test(l)) && rows.some((l) => l.includes('desk typing check')));
    await keep('3-typed');
    await shoot('3-typed');
    if (notes.hook) {
      // by now the hook's slower second pass (the ancestry walk) has rewritten the record
      notes.hookLater = hookRecord();
      say(`      Perch hook record a few seconds in: ${JSON.stringify(notes.hookLater)}`);
      check('still no tab stored after the hook\'s second pass', Boolean(notes.hookLater) && !notes.hookLater.window);
    }

    await type('\x03');
    const cleared = await until(async () => !(await screen()).some((l) => l.includes('second line')), 4000);
    check('Ctrl+C clears the prompt box', Boolean(cleared));
    // a menu of numbered choices is a question on the screen; Escape closes it and changes nothing
    let back = false;
    if (cleared) {
      await type('/model\r');
      const asking = await until(async () => !(await atPromptNow()), 8000, 200);
      const numbered = (await screen()).some((l) => /^\s*[\u276F>]\s*\d+\.\s/.test(l));
      await type('\x1b');
      back = await until(atPromptNow, 8000, 200);
      if (!back) { await type('\x1b'); back = await until(atPromptNow, 4000, 200); }
      check('with a menu of choices open the app does not take the chat for one at its prompt, and does again once it is closed',
        Boolean(asking) && Boolean(back), `numbered choices on screen: ${numbered}`);
    }
    // only from its prompt: typed into a menu, the Enter would pick one of its choices
    if (back) {
      // one burst, the way Compact now and Continue all type: Claude Code takes it as typed keys, not as a paste
      const asked = Date.now();
      await type('/exit\r');
      check('/exit and Enter typed in one go leave the CLI, and PowerShell is back', Boolean(await until(promptBack, 20000, 300)), `${Date.now() - asked} ms`);
      await wait(500);
      if (agent.pid) check('the agent process is gone after /exit', !alive(agent.pid));
      const end = await endedItself();
      check('/exit ends the session properly', end.fileGone, `own session file removed: ${end.fileGone}`);
      endScripts(end);
      const off = await until(async () => !watch.latest().chats.some((c) => c.pid === agent.pid), 12000, 400);
      check('the session leaves the dashboard once it has ended', Boolean(off));
      await keep('4-after-exit');
    }

    // How much a full scrollback costs per extra terminal, measured in the page that would hold them.
    const hasGc = await inPage(pageGc);
    await wait(800);
    const before = pageMemory();
    const filled = await inPage(pageFill, 10, 10000, 130);
    await wait(1500);
    const after = pageMemory();
    await inPage(pageDrop);
    if (before && after) {
      notes.scale = {
        terminals: filled.length,
        linesEach: Math.min(...filled),
        privateMbEach: Number(((after.privateMb - before.privateMb) / filled.length).toFixed(1)),
        workingMbEach: Number(((after.workingMb - before.workingMb) / filled.length).toFixed(1)),
        forcedCleanup: hasGc,
      };
      say(`      10 more terminals, each holding ${notes.scale.linesEach} lines of 130 columns: +${notes.scale.privateMbEach} MB private (+${notes.scale.workingMbEach} MB in use) per terminal`);
    }
  };

  /**
   * After each change of size the app makes, what the agent shows must be what it draws from nothing at that size:
   * the screen is read once settled, then the agent is made to draw all of itself (one column less, then the size
   * again) and read again. A row that differs is a screen left shifted or half drawn. Rows that differ between two
   * whole drawings in a row (a clock, a tip that changes) are left out of the count.
   */
  const redrawPart = async () => {
    const id = JSON.stringify(agent.chat);
    const sizeNow = () => exec('({ cols: term.cols, rows: term.rows, alt: term.buffer.active.type === "alternate", scrolled: term.buffer.active.viewportY !== term.buffer.active.baseY })');
    const rowsNow = async () => (await screen()).map((l) => l.replace(/\s+$/, ''));
    // Claude Code's own frame: the two lines around its prompt box run the whole width, its status line is the last row.
    // A screen left shifted, or drawn for another size than the terminal's, breaks that.
    const shapeOf = (lines, cols, rows) => {
      const rules = [];
      lines.forEach((l, i) => { if (/^─{10,}$/.test(l)) rules.push([i, [...l].length]); });
      let last = -1;
      lines.forEach((l, i) => { if (l.trim()) last = i; });
      return { whole: lines.length === rows && rules.length === 2 && rules.every(([, n]) => n === cols) && last === rows - 1,
        text: `${rules.length} full line(s)${rules.length ? ` ${rules.map(([i, n]) => `on row ${i}, ${n} wide`).join(' and ')}` : ''}; last text on row ${last} of ${rows}` };
    };
    const whole = async () => {
      const { cols, rows } = await sizeNow();
      await exec(`desk.resize(${id}, ${cols - 1}, ${rows})`);
      await wait(250);
      await exec(`desk.resize(${id}, ${cols}, ${rows})`);
      await settle(900, 8000);
      return rowsNow();
    };
    const differing = (a, b, skip) => {
      const out = [];
      for (let i = 0; i < Math.max(a.length, b.length); i++) if (!skip.has(i) && (a[i] || '') !== (b[i] || '')) out.push(i);
      return out;
    };
    const hideMail = (s) => s.replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, '<mail>').slice(0, 110);
    const fitted = async () => { await exec('Terms.fit()'); await settle(900, 8000); return rowsNow(); };
    const body = (css) => exec(`(() => { const b = document.querySelector('#tiles .tile.on .tile-body') || document.querySelector('#tiles .tile .tile-body'); b.style.paddingBottom = ${JSON.stringify(css)}; return true; })()`);
    const first = await whole();
    const second = await whole();
    const noise = new Set(differing(first, second, new Set()));
    const size0 = await sizeNow();
    const shape0 = shapeOf(second, size0.cols, size0.rows);
    say(`      redraw check: ${size0.cols}x${size0.rows}, ${size0.alt ? 'its fullscreen screen' : 'its classic screen'}; drawn whole: ${shape0.text}; ${noise.size} row(s) that change by themselves left out`);
    const word = 'resizecheck';
    const steps = [
      ['two rows lower', () => body('44px')],
      ['back to its height', () => body('')],
      ['narrower: the panel beside it opens', () => exec('Desk.setInspector(true)')],
      ['wider again: the panel closes', () => exec('Desk.setInspector(false)')],
      ['six changes of height in a row, 40 ms apart', async () => { for (let i = 0; i < 6; i++) { await body(i % 2 ? '' : '30px'); await exec('Terms.fit()'); await wait(40); } await body(''); }],
      ['one row lower, then a column fewer, at once', async () => { await body('22px'); await exec("document.getElementById('tiles').style.paddingRight = '12px'"); }],
      ['back', async () => { await body(''); await exec("document.getElementById('tiles').style.paddingRight = ''"); }],
      ['two rows lower while it draws what is typed', async () => {
        for (let i = 0; i < word.length; i++) {
          await type(word[i]);
          if (i === 4) { await body('44px'); await exec('Terms.fit()'); }
          await wait(25);
        }
      }],
      ['back to its height, then what was typed taken away', async () => { await body(''); await exec('Terms.fit()'); await type('\x7f'.repeat(word.length)); }],
      ['a larger text size', () => exec('Terms.setFontSize(Terms.fontSize() + 2)')],
      ['the text size back', () => exec('Terms.setFontSize(Terms.fontSize() - 2)')],
      ['two rows lower and back, a moment apart', async () => { await body('44px'); await exec('Terms.fit()'); await body(''); }],
      ['two rows lower and back in the same instant', () => exec(`(() => { const b = document.querySelector('#tiles .tile.on .tile-body') || document.querySelector('#tiles .tile .tile-body');
        b.style.paddingBottom = '44px'; Terms.fit(); b.style.paddingBottom = ''; Terms.fit(); return true; })()`)],
      ['three rows lower and two back in the same instant', () => exec(`(() => { const b = document.querySelector('#tiles .tile.on .tile-body') || document.querySelector('#tiles .tile .tile-body');
        b.style.paddingBottom = '66px'; Terms.fit(); b.style.paddingBottom = '22px'; Terms.fit(); return true; })()`)],
      ['back', () => body('')],
      // the terminal shrinks and grows back, and its console is told of both sizes before the agent can look: to the
      // agent nothing changed, so it draws nothing, while the terminal dropped its bottom rows (a busy agent, a
      // window coming back from minimised, the laptop waking)
      ['two rows lower and back, its console told of both at once', () => exec(`(async () => { const b = document.querySelector('#tiles .tile.on .tile-body') || document.querySelector('#tiles .tile .tile-body');
        b.style.paddingBottom = '44px'; Terms.fit(); await new Promise((r) => queueMicrotask(r));
        b.style.paddingBottom = ''; Terms.fit(); return true; })()`)],
      // the page's scaling changes as when the window goes to a screen at 125% (what it lays out shrinks by a fifth), and back
      ['the page drawn a quarter larger, as on a screen at 125%', async () => { win.webContents.setZoomFactor(1.25); await wait(700); }],
      ['the page back to its scaling', async () => { win.webContents.setZoomFactor(1); await wait(700); }],
      ['everything drawn again from scratch, as F5 does', () => exec('redrawNow(false)')],
    ];
    const logNow = () => { try { return fs.readFileSync(path.join(app.getPath('userData'), 'desk.log'), 'utf8'); } catch { return ''; } };
    const logAt = logNow().length;
    const shifted = [];
    for (const [what, change] of steps) {
      await change();
      const after = await fitted();
      const size = await sizeNow();
      const shape = shapeOf(after, size.cols, size.rows);
      const drawn = await whole();
      const rows = differing(after, drawn, noise);
      // a line found on another row of the other reading has moved; a row that only says something new (a hint the
      // agent changes as time goes by) has not
      const elsewhere = (text, lines, r) => Boolean(text.trim()) && !/^─+$/.test(text.trim()) && lines.some((l, i) => i !== r && l.trim() === text.trim());
      const moved = rows.filter((r) => elsewhere(after[r] || '', drawn, r) || elsewhere(drawn[r] || '', after, r));
      const wrong = [(moved.length || rows.length > 2) && `${rows.length} row(s) differ from a whole drawing (rows ${rows.slice(0, 8).join(', ')}), ${moved.length} of them moved`,
        shape0.whole && !shape.whole && `its frame is broken: ${shape.text}`, size.scrolled && 'the terminal is scrolled up'].filter(Boolean);
      const changed = !wrong.length && rows.length ? `; ${rows.length} row(s) said something new by the time it was drawn whole (rows ${rows.join(', ')}), none moved` : '';
      say(`      after "${what}" (${size.cols}x${size.rows}): ${wrong.length ? wrong.join('; ') : `whole, and the same as a whole drawing${changed}`}`);
      for (const r of rows.slice(0, 3)) say(`        row ${r} shown: ${JSON.stringify(hideMail((after[r] || '').trim()))}\n        row ${r} drawn: ${JSON.stringify(hideMail((drawn[r] || '').trim()))}`);
      if (wrong.length) shifted.push(what);
    }
    check('the agent\'s frame is whole at the start (two full-width lines round its prompt, its status line on the last row)', shape0.whole, shape0.text);
    check('after every change of size the app makes, the agent\'s screen is whole and what it draws from nothing at that size', shifted.length === 0,
      shifted.length ? `left shifted or half drawn after: ${shifted.join('; ')}` : `${steps.length} changes of size`);
    const scaled = logNow().slice(logAt).split('\n').filter((l) => / screen: the window's scaling is now \d+%: every chat on screen drawn again/.test(l));
    check('each change of the page\'s scaling is noticed by the page itself: everything drawn again, and a line in the log', scaled.length === 2,
      JSON.stringify(scaled.map((l) => l.replace(/^\S+ /, ''))));
    await settle(1200, 12000);
  };

  /** The typing meter over a real Claude Code: keys pressed into its prompt box as a keyboard presses them, then taken away again. */
  const meterPart = async () => {
    const word = 'metercheck';
    const got = await inPage(pageTypeKeys, agent.chat, word, 300);
    const shown = (await screen()).some((l) => l.includes(word));
    await type('\x7f'.repeat(word.length));
    await settle(900, 8000);
    const gone = !(await screen()).some((l) => l.includes(word));
    const list = (got || []).slice().sort((a, b) => a - b);
    const at = (q) => (list.length ? list[Math.min(list.length - 1, Math.floor(q * list.length))] : -1);
    say(`      the typing meter over Claude Code, ${word.length} keys pressed as a keyboard does, 300 ms apart: ${list.length} timed, median ${at(0.5)} ms, 9 in 10 within ${at(0.9)} ms, slowest ${list.length ? list[list.length - 1] : -1} ms`);
    check('keys pressed into Claude Code\'s prompt box show there, and the typing meter times them: at least 7 of 10, half within 100 ms',
      shown && list.length >= 7 && at(0.5) <= 100, JSON.stringify({ shown, timed: list }));
    check('what was typed is taken away again', gone);
    notes.meter = { timed: list.length, median: at(0.5), p90: at(0.9) };
  };

  /**
   * Whether the agent counts the cells of each sample as the console draws them. Each is typed into its prompt box
   * with a "Z" after it, then a "Y" on its own: the agent then writes only the "Y", at the cell its own count gives.
   * Counted one cell short of what the console drew, the "Y" lands on the "Z"; one cell long, a gap opens before it.
   * Either leaves every line holding that character shifted on screen.
   */
  const agentWidthsPart = async () => {
    const prompt = () => inPage(pagePromptCells);
    const off = [];
    for (const [name, points] of Object.entries(SAMPLES)) {
      await type(`${String.fromCodePoint(...points)}Z`);
      await until(async () => { const p = await prompt(); return p && p.z >= 0; }, 3000, 100);
      await settle(400, 3000);
      await type('Y');
      await until(async () => { const p = await prompt(); return p && p.y >= 0; }, 3000, 100);
      await settle(300, 3000);
      const p = await prompt();
      if (!p || p.y < 0) off.push(`${name}: no Y on the prompt line`);
      else if (p.z < 0) off.push(`${name}: the agent counts ${p.y - 3} cell(s), one short of what the console drew (the Y landed on the Z)`);
      else if (p.y !== p.z + 1) off.push(`${name}: the console drew ${p.z - 2} cell(s), the agent counts ${p.y - 3}`);
      await type('\x7f'.repeat(points.length + 4));
      await until(async () => { const q = await prompt(); return q && q.empty; }, 3000, 100);
    }
    for (const line of off) say(`      ${line}`);
    check('the agent counts the cells of every emoji and kaomoji sample as the console draws them', off.length === 0,
      off.length ? `differs for ${off.length} of ${Object.keys(SAMPLES).length}` : `${Object.keys(SAMPLES).length} samples`);
  };

  /** Starts the agent CLI in the first chat and waits for its first screen. extra: words for its command line. */
  const startAgent = async (extra = '') => {
    const chat = chats.all.get(agent.chat);
    await inPage(pageWatchFrames);
    await type('cls\r');
    await wait(400);
    notes.fullscreenBefore = fullscreenNotes();
    const launch = Date.now();
    const words = [extra, process.env.DESK_SELFTEST_AGENT_ARGS || ''].filter(Boolean).join(' ');
    await type(`claude${words ? ` ${words}` : ''}\r`);
    const drew = await until(async () => (await screen()).some((l) => /Claude Code/i.test(l)), 90000, 250);
    agent.firstFrameAt = Date.now();
    agent.pid = childrenNamed(chat.pid, 'claude.exe')[0] || 0;
    check('the agent CLI starts and draws its screen', Boolean(drew), `${((agent.firstFrameAt - launch) / 1000).toFixed(1)} s`);
    return { chat, drew };
  };

  /** One chat with a live agent, put through the changes of size the app makes (-Only redraw); nothing else runs. */
  const redrawPhase = async () => {
    check('the window loads', Boolean(await until(() => exec('typeof Desk === "object" && Desk !== null'), 15000)));
    const a = await inPage(pageNew, plain);
    if (!check('a chat opens in this window', Boolean(a && a.id))) throw new Error('no chat');
    agent.chat = a.id;
    if (!check('PowerShell starts inside it', Boolean(await until(promptBack, 30000)))) throw new Error('no PowerShell');
    const { chat, drew } = await startAgent();
    notes.agent = { pid: agent.pid, shellPid: chat.pid };
    if (!drew) throw new Error('the agent CLI drew nothing');
    await settle(1500, 25000);
    await redrawPart();
    await meterPart();
    await agentWidthsPart();
  };

  // ---- a live agent session in the first chat ----
  const agentPhase = async () => {
    const { chat } = await startAgent();
    // a session this young must not have its console closed under it: two such closes turn fullscreen off for the machine
    const held = await until(async () => { const ms = chats.tooYoung(chat); return ms > 0 ? ms : 0; }, 4000, 200);
    check('a chat whose session only just started is not closed straight away', Boolean(held), `a close asked for now would wait ${((held || 0) / 1000).toFixed(1)} s`);
    await settle(1500, 25000);
    await keep('2-agent');
    notes.modes = await exec('JSON.parse(JSON.stringify(term.modes))');
    notes.drawing = await inPage(pageDrawing);
    say(`      terminal modes the CLI switched on: ${Object.entries(notes.modes).filter(([, v]) => v && v !== 'none').map(([k, v]) => (v === true ? k : `${k}=${v}`)).join(', ') || '(none)'}`);
    say(`      drawing: ${notes.drawing.canvases ? 'graphics card' : 'plain page text'}; the CLI uses ${notes.drawing.buffer === 'alternate' ? 'its fullscreen screen' : 'its classic screen'}; width table ${notes.drawing.widths}`);
    say(`      console shell pid ${chat.pid}, agent pid ${agent.pid || '(not found)'}`);

    const own = agent.pid && await until(async () => {
      try { return JSON.parse(fs.readFileSync(liveFile(), 'utf8')); } catch { return null; }
    }, 6000, 300);
    agent.sessionId = (own && own.sessionId) || '';
    notes.agent = { pid: agent.pid, shellPid: chat.pid, sessionId: agent.sessionId };

    // The dashboard has to find the new session on disk and trace it back to this chat.
    const traced = agent.pid && await until(async () => watch.latest().chats.find((c) => c.pid === agent.pid && c.chat === agent.chat), 25000, 300);
    check('the dashboard finds the session and knows which chat it runs in', Boolean(traced),
      traced ? `${Date.now() - agent.firstFrameAt} ms after its first frame; state "${traced.state}"` : `rows for this pid: ${JSON.stringify(watch.latest().chats.filter((c) => c.pid === agent.pid).map((c) => c.chat))}`);
    // one of last time's chats whose conversation runs right now is not opened a second time; asked of the planner,
    // so nothing is started
    if (agent.sessionId) {
      const other = '00000000-0000-4000-8000-0000000000aa';
      const twice = planChat({ starter: 'claude', resume: agent.sessionId, restore: true });
      const asked = planChat({ starter: 'claude', resume: agent.sessionId });
      const notRunning = planChat({ starter: 'claude', resume: other, restore: true });
      check('one of last time\'s chats whose conversation already runs is not opened twice; one that does not run is picked up',
        twice.elsewhere === true && Boolean(twice.error) && !asked.error && asked.holds === agent.sessionId && !notRunning.error && notRunning.holds === other,
        `running: ${twice.error || 'planned to start'}; not running: ${notRunning.error || 'planned to start'}`);
    }
    const side = await inPage(pageSide);
    check('the list shows the chat with its session', side.length === 1 && side[0].mark !== 'none', `${side.length} chat in the list, its mark: "${side[0] ? side[0].mark : ''}"`);
    await shoot('2-agent');
    if (traced) {
      // its session is in the list once: as the chat of this window that it runs in
      const mine = await inPage((key) => [...document.querySelectorAll('#chat-list .nav-item.chat')].filter((el) => el.dataset.key === key).map((el) => el.className), traced.key);
      check('its session is in the list once, as the chat of this window that holds the keyboard',
        mine.length === 1 && /\bk-here\b/.test(mine[0]) && /\bshown\b/.test(mine[0]) && /\bon\b/.test(mine[0]), `${mine.length} row for it`);
      // the panel beside it: nothing was said in the session yet, and its conversation says so
      const colsWas = await exec('term.cols');
      await exec('Desk.setInspector(true)');
      const narrower = await until(async () => { const n = await exec('term.cols'); return n < colsWas ? n : 0; }, 5000);
      await wait(300);
      const beside = await inPage(pageDetail, 'inspector');
      await tabOf('inspector', 'conv');
      const state = await until(() => exec(`(() => { const s = Desk.ChatView.detail().reader.state(); return s === 'none' || s === 'ready' ? s : ''; })()`), 8000);
      await wait(150);
      const read = await inPage(pageReader, 'inspector');
      await tabOf('inspector', 'overview');
      check('the panel beside it shows the session, and its conversation says there is nothing to read yet',
        Boolean(narrower) && beside.shown && beside.tabs.length >= 3 && beside.tabs[0] === 'Overview*' && Boolean(state) && (state === 'none' ? /^Nothing to read yet/.test(read.empty) : read.asks === 0),
        `tabs: ${beside.tabs.join(', ')}; the reader: ${state === 'none' ? 'no file on disk yet' : `${read.says} said, ${read.tools} tool calls`}; ${colsWas} -> ${narrower} columns`);
      await shoot('2-agent-panel');
      await exec('Desk.setInspector(false)');
      await until(async () => (await exec('term.cols')) === colsWas, 5000);
      // from another page of the window, a click on its row in the list leads back to its terminal
      await view('stats');
      await wait(200);
      await exec(`document.querySelector('#chat-list .nav-item.chat[data-row="chat:${agent.chat}"]').click()`);
      await wait(200);
      check('from the Dashboard, a click on its row in the list leads back to its terminal', (await exec('Desk.state.view')) === agent.chat && (await exec('Terms.active()')) === agent.chat);
    }
    await view(agent.chat);
    // the agent draws its screen again for each change of size: it is left to settle before anything more is read from it
    await settle(1200, 12000);

    notes.memory = await report('with the CLI on screen, before any token counting');

    // Token counts: off for a test run by default (the transcripts are gigabytes); on for a moment to see them arrive.
    watch.post({ type: 'counting', on: true });
    const counted = await until(async () => watch.latest().chats.find((c) => c.tokens && c.tokens.share > 0 && c.tokens.out > 0), 15000, 300);
    // the count of today's lines (the part read first) must have got going without an error: a few rounds of it are let run
    await wait(4000);
    const sofar = await watch.ask('usage', { range: 'today' });
    watch.post({ type: 'counting', on: false });
    say(`      after a few rounds of counting: ${sofar ? `${Math.round(sofar.reading.read / 1048576)} MB of ${Math.round(sofar.reading.bytes / 1048576)} MB read, today's part ${sofar.reading.today ? 'done' : 'still going'}, ${sofar.days[29].out} tokens out counted for today, ${watch.errors().length} errors reported` : 'no answer'}`);
    check('token counts arrive on the dashboard, with today set apart', Boolean(counted) && Boolean(counted.today) && Array.isArray(counted.pulse) && counted.pulse.length === 30,
      counted ? `first one: in ${counted.tokens.in + counted.tokens.cacheWrite}, out ${counted.tokens.out}, cached ${counted.tokens.cacheRead}, ${Math.round(counted.tokens.share * 100)}% read; today: out ${counted.today && counted.today.out}, ${counted.today && counted.today.replies} replies` : '');
    notes.memoryCounting = await report('right after a burst of token counting');

    // A session here has no Windows Terminal tab for the hook to find.
    if (agent.pid && fs.existsSync(path.join(hookDir, 'status'))) {
      notes.hook = await until(async () => hookRecord(), 8000, 400);
      say(`      Perch hook record at start: ${JSON.stringify(notes.hook)}`);
      check('the Perch hook tracks the session and stores no tab for it', Boolean(notes.hook) && !notes.hook.window);
    }

    const looks = watch.took();
    notes.looks = looks;
    say(`      watcher looks so far: ${looks.length}, slowest ${Math.max(...looks)} ms, typical ${looks.slice().sort((x, y) => x - y)[Math.floor(looks.length / 2)]} ms`);

    if (typing) await typingPart();
    notes.frames = await exec('window.deskFrames');
    check('the CLI marks its screen updates as whole frames and the marks reach the widget', notes.frames > 0, `${notes.frames} frames`);
  };

  /** Ends whatever is still running. Returns true when the window itself was closed, which also ends this program. */
  const leave = async () => {
    const chat = chats.all.get(agent.chat);
    if (!chat) return false;
    const shellPid = chat.pid;
    await view(agent.chat);
    if (agentUp() && !closing) {
      // ask it to leave by itself, once it is old enough; Ctrl+C first drops anything a failed check left in the prompt box
      const young = chats.tooYoung(chat);
      if (young > 0) await wait(young);
      await type('\x03');
      await wait(600);
      await type('/exit');
      await wait(700);
      await type('\r');
      await until(async () => !agentUp(), 20000, 300);
    }
    const wasUp = agentUp();
    if (wasUp && closing === 'quit') {
      notes.closedAt = Date.now();
      say('      closing the window with the CLI still running; what became of it is checked from outside');
      return true;
    }
    // the app's own way of closing a chat: it holds back while a session in it is too young
    const asked = Date.now();
    await chats.close(agent.chat);
    const t0 = Date.now();
    const agentGone = wasUp ? await until(async () => !agentUp(), 10000, 100) : true;
    const agentMs = Date.now() - t0;
    const gone = agentGone && await until(async () => !alive(shellPid) && !chats.all.has(agent.chat), 10000, 100);
    check('closing the last chat leaves nothing running', Boolean(gone) && chats.all.size === 0, `shell ${shellPid}${agent.pid ? `, agent ${agent.pid}` : ''}`);
    if (wasUp) {
      const end = await endedItself();
      check('a chat closed while it is running ends its session properly', end.fileGone,
        `held back ${t0 - asked} ms, then the CLI was gone after ${agentMs} ms; own session file removed: ${end.fileGone}`);
      endScripts(end);
    }
    const back = await until(async () => (await exec('Desk.state.view')) === 'peek' && (await inPage(pageSide)).length === 0 && (await inPage(pagePeek)).start === START, 4000);
    check('with no chat left the window is back on its start page', Boolean(back));
    return false;
  };

  /** The checks every run ends with, its result line and its notes. */
  const finish = () => {
    // an error inside the watcher thread is caught there and written to a log: without this a run could pass over one
    const errors = watch.errors();
    check('the part that reads the files reported nothing going wrong', errors.length === 0,
      errors.length ? `${errors.length} report(s); the first: ${String(errors[0]).split('\n').slice(0, 2).join(' | ').slice(0, 300)}` : '');
    check('the page itself reported nothing going wrong', pageErrors.length === 0,
      pageErrors.length ? `${pageErrors.length} error(s); the first: ${pageErrors[0].slice(0, 300)}` : '');
    say('');
    say(`RESULT: ${lines.filter((l) => l.startsWith('PASS')).length} passed, ${failed} failed   (${os.release()}, Electron ${process.versions.electron})`);
    fs.writeFileSync(path.join(dir, 'report.json'), JSON.stringify(notes, null, 2));
  };

  // ---- leaving with chats open, and the start after it. Plain consoles only: no agent is started, nothing of the person's is opened. ----
  const KEPT_NAME = 'Kept by the test';
  const KEPT_SPACE = 'Kept space';
  const sideNow = () => inPage(pageSide);
  const leavePhase = async () => {
    check('the window loads', Boolean(await until(() => exec('typeof Desk === "object" && Desk !== null'), 15000)));
    // opened the way a chat that comes back is opened, so the profile keeps no word on how new chats start: the
    // next start can then show that bringing consoles back does not make consoles the way new chats start
    const a = await inPage(pageNew, { ...plain, restore: true });
    const first = Boolean(a && a.id) && Boolean(await until(promptBack, 30000));
    const b = await inPage(pageNew, { ...plain, restore: true });
    const second = Boolean(b && b.id) && Boolean(await until(promptBack, 30000));
    if (!check('two plain consoles open in this window', first && second)) throw new Error('no consoles');
    await exec(`desk.rename(${JSON.stringify(b.id)}, ${JSON.stringify(KEPT_NAME)})`);
    // the first one is brought to the front: the record says which chat is in front, not which was opened last
    await view(a.id);
    const want = [{ cwd: folder, starter: 'shell', title: '', named: false, resume: '', mode: '', front: true, id: a.id }, { cwd: folder, starter: 'shell', title: KEPT_NAME, named: true, resume: '', mode: '', front: false, id: b.id }];
    const written = await until(async () => same(settingsNow().open, want), 5000, 150);
    check('every open chat is written down as it changes: its folder, how it was started, the name it was given, and which one is in front',
      Boolean(written) && settingsNow().running === true, `kept: ${JSON.stringify(settingsNow().open.map((c) => [c.starter, c.title, c.named, c.front]))}; the run is marked as going: ${settingsNow().running}`);
    // on disk within the second, so that a crash loses nothing
    const file = path.join(app.getPath('userData'), 'desk.json');
    const onDisk = await until(async () => { try { return same(JSON.parse(fs.readFileSync(file, 'utf8')).open, want); } catch { return false; } }, 4000, 150);
    // the second one is brought to the front: the record follows, and it is the one to come back in front
    await view(b.id);
    const follows = await until(async () => { try { return same(JSON.parse(fs.readFileSync(file, 'utf8')).open.map((c) => c.front), [false, true]); } catch { return false; } }, 4000, 150);
    check('and it is in the settings file within moments, not only when the app closes: also which chat is in front, as that changes', Boolean(onDisk) && Boolean(follows));

    // a workspace made before the close, with the folder of both chats in it: the next start has to find it, in front
    const space = await call('addSpace', KEPT_SPACE);
    await call('putFolder', folder, space);
    const sorted = await until(async () => {
      try { const d = JSON.parse(fs.readFileSync(file, 'utf8')); return same(d.spaces, [{ id: space, name: KEPT_SPACE, folders: [folder], color: '', sessions: [] }]) && d.space === space && same(d.open.map((c) => c.front), [false, true]); } catch { return false; }
    }, 5000, 150);
    check('a workspace, the folders in it and which workspace is in front are in the settings file within moments too, and the chat in front stays in front',
      Boolean(sorted) && (await exec('Desk.state.view')) === b.id && (await sideNow()).length === 2, `tabs: ${tabsOf(await spacesNow()).slice(0, 2).join(', ')}`);

    // A close takes the Lowlit icon near the clock away first and closes the chats after: for those seconds the watcher
    // still sends its pictures, and each one used to reach for the icon that was gone.
    const threw = trayEnd();
    check('once a close has taken the Lowlit icon near the clock away, the pictures the watcher still sends are taken without an error', threw === '', threw);

    // the question a close asks (the main process sends the same word when the window's own close button is pressed)
    win.webContents.send('desk:command', 'ask-leave');
    const asked = await until(async () => !(await exec('document.getElementById("leave").hidden')), 3000);
    const box = await inPage(() => {
      const root = document.getElementById('leave');
      return { title: root.querySelector('h2').textContent, names: root.querySelector('.leave-top .quiet').textContent,
        choices: [...root.querySelectorAll('.leave-choice')].map((x) => `${x.dataset.how}: ${x.querySelector('.leave-title').textContent}`),
        gaming: (root.querySelector('.leave-choice[data-how="gaming"] .leave-note') || {}).textContent || '',
        remember: Boolean(root.querySelector('#leave-remember')) && !root.querySelector('#leave-remember').checked, cancel: root.querySelector('.foot .btn').textContent,
        focus: document.activeElement && document.activeElement.dataset.how, logo: Boolean(root.querySelector('.leave-logo')) };
    });
    await shoot('2-leave');
    check('closing the window with chats open asks what should become of them, Gaming mode among the choices',
      Boolean(asked) && box.title === 'You have 2 chats open' && box.names.endsWith(` · ${KEPT_NAME}`)
      && same(box.choices, ['keep: Keep them for next time', 'fresh: Start fresh next time', 'tray: Keep running by the clock', 'gaming: Gaming mode'])
      && box.gaming.startsWith('Closes your 2 chats') && box.remember && box.cancel === 'Cancel' && box.focus === 'keep',
      `"${box.title}": ${box.choices.join(' / ')}; Gaming mode says "${box.gaming}"; the first choice holds the keyboard: ${box.focus === 'keep'}`);
    await inPage(pageKey, 'Escape', '#leave');
    await wait(150);
    check('Esc takes the question away and nothing closes', (await exec('document.getElementById("leave").hidden')) === true && chats.all.size === 2 && (await sideNow()).length === 2);

    // "Keep them for next time": the app ends itself from here on, so this run's result is written first.
    // What it left behind is read from outside, and by the next start.
    win.webContents.send('desk:command', 'ask-leave');
    await until(async () => !(await exec('document.getElementById("leave").hidden')), 3000);
    say('      answering "Keep them for next time": the app now closes its chats and ends by itself');
    notes.shells = chats.list().map((c) => c.pid);
    finish();
    await exec(`document.querySelector('#leave .leave-choice[data-how="keep"]').click()`);
    // Two plain consoles close at once, and the app with them. (A close waits while a Claude Code that may be this
    // chat's is under 15 s old, and one just started anywhere on the machine counts as "may be": that can stretch
    // it.) Still here after 25 s, it did not work.
    await wait(25000);
    fs.appendFileSync(path.join(dir, 'report.txt'), 'FAIL  the app was still running 25 s after "Keep them for next time"\n');
    app.exit(1);
  };

  const backPhase = async () => {
    const expect = process.env.DESK_SELFTEST_EXPECT === 'crash' ? 'crash' : 'auto';
    const starterWas = settingsNow().starter;
    check('the window loads', Boolean(await until(() => exec('typeof Desk === "object" && Desk !== null'), 15000)));
    const how = await exec('Desk.state.info.restore');
    // While they are opened one after the other, the list on disk is left whole: an end in the middle loses none.
    const midway = await until(async () => {
      const s = await sideNow();
      return s.length === 1 ? { open: settingsNow().open.length, names: settingsNow().open.map((c) => c.title), shown: (await exec('Desk.state.view')) === s[0].id } : null;
    }, 15000, 60);
    const back = await until(async () => { const s = await sideNow(); return s.length === 2 ? s : null; }, 15000, 150);
    if (!check(`the chats that were open come back by themselves at the next start${expect === 'crash' ? ', also after a run that never reached its end' : ''}`,
      how === expect && Boolean(back) && back[1].label === KEPT_NAME && back[0].label !== KEPT_NAME,
      `this start decided "${how}"; ${back ? `${back.length} chats: "${back[0].label}" and "${back[1].label}"` : 'they did not come back'}`)) throw new Error('nothing came back');
    check('while they are opened one after the other, the list kept on disk stays whole, and a chat is on screen from the first one on', Boolean(midway) && midway.open === 2 && midway.names[1] === KEPT_NAME && midway.shown,
      midway ? `with 1 of 2 open, the list still held ${midway.open}; that first chat was on screen: ${midway.shown}` : 'the moment with one chat open was not caught');
    const said = await until(async () => { const t = await exec('document.getElementById("toast").textContent');
      return (expect === 'crash' ? /^Lowlit did not close properly last time\. Your 2 chats are back\.$/ : /^Your 2 chats are back, as you left them\.$/).test(t) ? t : ''; }, 8000, 150);
    // the second one was in front when the app closed: the window moves on to it once it is there
    const front = await until(async () => (await exec('Desk.state.view')) === back[1].id, 6000, 150);
    const kept = chats.list();
    check('they come back as they were: the name that was given, the one that was in front in front again, and the window says so',
      Boolean(said) && Boolean(front) && kept.length === 2 && kept[0].starter === 'shell' && kept[1].named === true && kept[1].title === KEPT_NAME && kept[0].named === false,
      `"${said}"; in front: ${front ? `"${back[1].label}"` : 'not the one that was'}`);
    check('PowerShell runs in the one in front', Boolean(await until(promptBack, 30000)));
    // what they were started with is not made the way new chats start from now on
    const after = await until(async () => { const s = settingsNow(); return s.open.length === 2 && s.open[1].front === true && s.open[1].title === KEPT_NAME ? s : null; }, 6000, 150);
    check('bringing consoles back does not make consoles the way new chats start, and they are written down again for the next time',
      Boolean(after) && after.starter === starterWas && after.starter !== 'shell' && after.running === true,
      after ? `the starter for new chats is still ${after.starter ? `"${after.starter}"` : 'the default one'}; ${after.open.length} chats on record` : 'the record was not written again');
    // both were on screen when the app closed: they stand side by side again, the keyboard in the one that had it
    const t = await inPage(pageTiles);
    check('and they stand side by side again, the keyboard in the one that had it',
      t.n === 2 && same(t.tiles.map((x) => x.id), back.map((s) => s.id)) && t.keyboard === back[1].id && t.tiles.every((x) => x.drawn) && same(t.saved, [2, 2]),
      `${t.n} on screen; the keyboard is in ${t.keyboard === back[1].id ? 'the one that was in front' : 'another one'}`);
    // the workspace made before the close: there again with its folder, and in front, so both chats are in the list
    const sp = await spacesNow();
    const main = settingsNow();
    check('the workspaces come back too: the one that was in front is in front again, with the folders in it',
      sp.on && sp.spaces.length === 1 && same(sp.spaces.map((s) => [s.name, s.folders]), [[KEPT_SPACE, [folder]]]) && sp.space === sp.spaces[0].id && (sp.tabs.find((x) => x.on) || {}).name === KEPT_SPACE
      && same(main.spaces.map((s) => [s.name, s.folders]), [[KEPT_SPACE, [folder]]]) && main.space === sp.space,
      `tabs: ${tabsOf(sp).slice(0, 2).join(', ')}; the folder in it: ${sp.spaces[0] ? sp.spaces[0].folders.length : 0}`);
    await shoot('2-back', true);
  };

  // ---- pictures of the window that hold nothing of the person's: four plain consoles, each tied to a made-up session
  // ---- and drawn over with a made-up agent screen. Meant to be shown to people; run it with DESK_RENDERER=dom.
  const picturePhase = async () => {
    check('the window loads', Boolean(await until(() => exec('typeof Desk === "object" && Desk !== null'), 15000)));
    check('the watcher delivers its first picture of the machine', Boolean(await until(async () => watch.latest().at > 0 && watch.latest(), 20000)));
    win.setContentSize(1920, 1040);
    await wait(400);
    // four places before the first chat opens, so that each chat takes the next place as it opens
    await exec('Desk.setTiles(4)');
    const ids = [];
    for (const name of ['shop', 'pricing', 'api', 'landing']) {
      const cwd = path.join(dir, 'work', name);
      fs.mkdirSync(cwd, { recursive: true });
      const chat = await inPage(pageNew, { cwd, starter: 'shell', restore: true });
      if (!chat || !chat.id) throw new Error('a console did not open');
      ids.push(chat.id);
      await until(promptBack, 30000);
      // an empty prompt and a cleared screen: nothing of the console itself is left to see
      await type("function prompt { ' ' }; cls\r");
      await wait(600);
    }
    const [checkout, pricing, refactor, landing] = ids;
    const kindOf = { [checkout]: 'checkout', [pricing]: 'pricing', [refactor]: 'refactor', [landing]: 'landing' };
    // from here on what the consoles print stays out of the terminals: a console repaints itself whenever its size
    // changes, and would wipe what is drawn over it
    await exec('Terms.write = () => {}; true');

    // the real sessions step aside for the made-up ones, at twenty to four in the afternoon of a busy day
    watch.post({ type: 'pace', ms: 600000 });
    await wait(900);
    const afternoon = new Date();
    afternoon.setHours(15, 40, 0, 0);
    madeAt = await inPage(pageClock, afternoon.getTime() - Date.now());
    await installFakes();
    await showUsage('today');
    const res = madeUpRes(pricing);
    const chatRes = (key, extra, cpu) => ({ mem: res.sessions[key].mem + extra * MB, cpu, n: res.sessions[key].n + 2, ports: [] });
    Object.assign(res.chats, { [checkout]: chatRes('s-permission', 64, 0.4), [refactor]: chatRes('s-compact', 66, 3.3), [landing]: chatRes('s-finish', 61, 0.5) });
    await exec(`Desk.state.res = ${JSON.stringify(res)}`);
    // the keyboard in the chat that is at work: the one that finishes in the next picture of the machine then counts as unseen
    await view(pricing);
    const tie = { 's-permission': checkout, 's-agents': pricing, 's-compact': refactor, 's-finish': landing };
    const rowsFor = (flip) => madeUpRows(flip).map((r) => (tie[r.key] ? { ...r, chat: tie[r.key] } : r));
    await exec(`takeSnapshot(${fake(madeAt, rowsFor(false))})`);
    await exec(`takeSnapshot(${fake(madeAt + 1, rowsFor(true))})`);
    await wait(300);

    /** Draws the made-up agent screens into the terminals on screen, once their places have their size. True when each holds one. */
    const dress = async () => {
      await wait(700);
      const shown = await exec('Terms.shown()');
      for (const id of shown) await inPage(pageDress, id, kindOf[id]);
      await wait(350);
      await exec('paint()');
      return exec(`Terms.shown().every((id) => { const b = Terms.get(id).term.buffer.active; for (let y = 0; y < b.length; y++) { const l = b.getLine(y); if (l && l.translateToString(true).includes('\\u2570')) return true; } return false; })`);
    };
    /** A picture, after the hidden window was made to draw a few frames: a terminal only draws when a frame comes. */
    const picture = async (name) => {
      await exec('document.getElementById("toast").hidden = true');
      for (let i = 0; i < 3; i++) { await win.webContents.capturePage(); await wait(120); }
      await shoot(name);
    };
    const dressed = [];
    const counts = [];
    const seen = async () => { dressed.push(await dress()); counts.push((await inPage(pageTiles)).n); };

    await seen();
    await picture('picture-1-four');
    await exec('Desk.setTiles(2)');
    await seen();
    await picture('picture-2-two');
    await exec('Desk.setTiles(1)');
    await seen();
    await picture('picture-3-one');
    await exec('Desk.setInspector(true)');
    await seen();
    await picture('picture-4-panel');
    await exec('Desk.setInspector(false); Desk.setTiles(2)');
    await wait(300);
    // a chat that runs in another terminal, looked at from here
    await exec('Desk.look({ kind: "live", key: "s-words" })');
    await wait(400);
    await picture('picture-5-elsewhere');
    await exec('Desk.look(null)');
    await view('stats');
    await wait(500);
    await picture('picture-6-dashboard');
    // every chat at a glance: the card of the chat at work pinned over its terminal, then the page of every chat
    await view(pricing);
    await dress();
    await exec(`Desk.Glance.toggle(${JSON.stringify(pricing)})`);
    await wait(300);
    await picture('picture-6b-glance');
    const glanced = await exec('document.querySelectorAll(".glance-card .glance-grid dt").length');
    await exec('Desk.Glance.hide()');
    await view('overview');
    await wait(500);
    await picture('picture-6c-overview');
    const cards = await exec('document.querySelectorAll("#overview .glance-short").length');
    check('a picture of a chat at a glance, and one of every chat at a glance', glanced >= 8 && cards >= 9, `${glanced} rows on the card; ${cards} cards on the page`);
    const list = await inPage(pageList);
    check('the pictures were taken with made-up chats only: four consoles drawn over, four, two and one on screen, and nine made-up sessions in the list',
      dressed.every(Boolean) && same(counts, [4, 2, 1, 1]) && list.rows === 9 && list.here === 4 && list.away === 5 && list.ended === 0,
      `terminals drawn over each time: ${dressed.join(', ')}; on screen: ${counts.join(', ')}; ${list.rows} sessions in the list, ${list.here} of them chats of this window`);

    // ---- the same window with workspaces: three of them over made-up folders, and two more made-up sessions for the third ----
    const at = (name) => path.join(dir, 'work', name);
    const RENDERS = 'D:\\work\\renders';
    const renders = [
      row({ key: 's-light', title: 'Kitchen scene lighting', cwd: RENDERS, state: 'working', since: madeAt - 4 * 60e3, context: 152000,
        words: 'The key light is too hot on the counter. Lowering it and rendering a test frame.', doing: tool('Bash', 'Render frame 12 at half size', 35, 0) }),
      row({ key: 's-turn', title: 'Turntable export script', cwd: RENDERS, state: 'idle', since: madeAt - 50 * 60e3, at: madeAt - 50 * 60e3, context: 61000,
        words: 'The script exports 72 frames, one every five degrees.' }),
    ];
    Object.assign(res.sessions, { 's-light': { ...res.sessions['s-words'], mem: 1946 * MB }, 's-turn': { ...res.sessions['s-finish'], mem: 212 * MB } });
    await exec(`Desk.state.res = ${JSON.stringify(res)}`);
    await exec(`takeSnapshot(${fake(madeAt + 2, [...rowsFor(true), ...renders])})`);
    const mine = await call('addSpace', 'Mine');
    const upwork = await call('addSpace', 'Upwork');
    const third = await call('addSpace', '3D');
    for (const f of [at('pricing'), at('api'), 'D:\\work\\pricing', 'D:\\work\\api']) await call('putFolder', f, mine);
    for (const f of [at('shop'), at('landing'), 'D:\\work\\shop']) await call('putFolder', f, upwork);
    await call('putFolder', RENDERS, third);
    const seenAs = [];
    const inFront = async (name, id, tiles, drawOver) => {
      await exec(`Desk.setTiles(${tiles})`);
      await call('switchSpace', id);
      await wait(300);
      const ok = drawOver ? await dress() : true;
      const sp = await spacesNow();
      seenAs.push({ tabs: tabsOf(sp), rows: sp.keys.length, on: (await inPage(pageTiles)).n, ok, spill: sp.spill, lines: sp.lines });
      await picture(name);
    };
    await inFront('picture-7-spaces-all', '', 4, true);
    await inFront('picture-8-spaces-mine', mine, 2, true);
    await inFront('picture-9-spaces-upwork', upwork, 2, true);
    await inFront('picture-10-spaces-other-terminals', third, 2, false);
    check('and with workspaces: each has its own chats on screen and in the list, and a tab that is not in front counts the chats of its own that wait',
      same(seenAs.map((s) => s.tabs), [['All*', 'Mine', 'Upwork 3', '3D'], ['All', 'Mine*', 'Upwork 3', '3D'], ['All', 'Mine', 'Upwork*', '3D'], ['All', 'Mine', 'Upwork 3', '3D*']])
      && same(seenAs.map((s) => s.rows), [11, 3, 6, 2]) && same(seenAs.map((s) => s.on), [4, 2, 2, 0]) && seenAs.every((s) => s.ok && !s.spill),
      seenAs.map((s) => `${s.tabs.join(' ')}: ${s.rows} in the list, ${s.on} on screen, tabs on ${s.lines} line${s.lines === 1 ? '' : 's'}`).join('; '));
    // two workspaces at once, a block each in its own colour, and one chat pinned on top of everything
    await call('switchSpace', mine);
    await call('toggleSpace', upwork);
    await call('pin', 's-agents', 'top');
    await wait(300);
    await dress();
    await picture('picture-11-spaces-two');
    const blocks = await exec('[...document.querySelectorAll("#chat-list .ws-block")].length');
    await call('pin', 's-agents', 'top');
    await call('switchSpace', '');
    check('a picture of two workspaces shown at once, each a block of its own', blocks === 2, `${blocks} blocks`);
  };

  // ---- pictures for a README and a website, as people will see the window: a made-up afternoon in four workspaces,
  // ---- each with a colour of its own and two chats of this window (eight plain consoles, drawn over), then the panel
  // ---- beside a chat, every chat as a card, the Dashboard and what its day cost, a chat with its Browser on a made-up
  // ---- landing page and with the Viewer on two made-up pictures, History, the search box, the floating card, the
  // ---- Servers page and the question a close asks. Nothing of the person's: invented names, numbers, pages, pictures,
  // ---- branches and servers, a made-up day that adds up, and one account. Run it with -Dom.
  const shotsPhase = async () => {
    check('the window loads for the pictures', Boolean(await until(() => exec('typeof Desk === "object" && Desk !== null && typeof Viewer === "object" && typeof Browser === "object"'), 15000)));
    check('the watcher delivers its first picture of the machine', Boolean(await until(async () => watch.latest().at > 0 && watch.latest(), 20000)));
    const http = require('node:http');
    const zlib = require('node:zlib');
    win.setContentSize(1600, 1000);
    await wait(400);
    await exec('Desk.setTiles(4)');
    // a console each: what is drawn over it, and the made-up folder it works in
    const CONSOLES = [['checkout', 'shop'], ['pricing', 'pricing'], ['refactor', 'api'], ['landing', 'landing'],
      ['lighting', 'renders'], ['turntable', 'renders'], ['onboarding', 'mobile'], ['push', 'mobile']];
    const at = (name) => path.join(dir, 'work', name);
    const kindOf = {};
    const chatOf = {};
    for (const [kind, name] of CONSOLES) {
      fs.mkdirSync(at(name), { recursive: true });
      const chat = await inPage(pageNew, { cwd: at(name), starter: 'shell', restore: true });
      if (!chat || !chat.id) throw new Error('a console did not open');
      kindOf[chat.id] = kind;
      chatOf[kind] = chat.id;
      await until(promptBack, 30000);
      await type("function prompt { ' ' }; cls\r");
      await wait(600);
    }
    const { checkout, pricing, refactor, landing, lighting, turntable, onboarding, push: notify } = chatOf;
    await exec('Terms.write = () => {}; true');
    watch.post({ type: 'pace', ms: 600000 });
    await wait(900);
    const afternoon = new Date();
    afternoon.setHours(15, 40, 0, 0);
    const ahead = afternoon.getTime() - Date.now();
    madeAt = await inPage(pageClock, ahead);
    // the conversation History opens first is filed under a folder that does not exist, so that no test resumes it:
    // in a picture it is filed under the shop's
    const kept = madeUpHistory();
    for (const past of kept.list) past.cwd = past.cwd.replace('Z:\\nowhere', 'D:\\work');
    await inPage(pageFakes, madeUpPages(), JSON.stringify(kept));
    // The day these pictures show adds up: lighter than the made-up one the tests share, so that what was spent today
    // is what the chats in the list say they cost and a little more; each of the busiest chats costs on the Dashboard
    // what its row says, hour by hour and in the table; the folders are these pictures' own. All of it under the one
    // account, with models and tools anyone has, counted from a made-up number of files.
    const SPENT = 112;
    const BUSIEST = [['s-agents', 'Pricing research', 'pricing', 41.8], ['s-permission', 'Checkout page rebuild', 'shop', 18.2], ['s-onboard', 'Onboarding flow', 'mobile', 14.9],
      ['s-light', 'Kitchen scene lighting', 'renders', 9.6], ['s-words', 'Invoice export bug', 'shop', 6.4], ['s-idle', 'Old notes', 'shop', 3.1]];
    const FOLDERS = [['pricing', 41.8], ['shop', 31.9], ['mobile', 16.7], ['renders', 11.8], ['api', 6.1], ['landing', 3.7]];
    const whole = madeUpUsage('today');
    const less = SPENT / whole.total.usd;
    const SAME = ['at', 'limits', 'active', 'toolKinds', 'reading', 'recorded', 'lim'];
    const lighter = (v, money) => (typeof v === 'number' ? (money ? Math.round(v * less * 100) / 100 : Math.round(v * less))
      : Array.isArray(v) ? v.map((x) => lighter(x, money))
        : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, SAME.includes(k) ? x : lighter(x, money || /usd|spent/i.test(k))])) : v);
    const used = lighter(whole, false);
    const sum = used.total;
    const shareOf = (usd) => Object.fromEntries(['in', 'out', 'cacheWrite', 'cacheRead', 'replies', 'work', 'asked'].map((k) => [k, Math.round((sum[k] * usd) / sum.usd)]));
    used.who = [{ key: 'aaaa1111', usd: sum.usd, ...shareOf(sum.usd) }];
    for (const d of used.days) { d.who = { aaaa1111: d.out }; d.whoUsd = { aaaa1111: d.usd }; }
    used.chats = BUSIEST.map(([key, title, name, usd]) => ({ key, title, name, project: 'p', cwd: `D:\\work\\${name}`, usd, ...shareOf(usd) }));
    const spread = (list, total) => { const had = list.reduce((a, b) => a + b, 0) || 1; return list.map((x) => (x * total) / had); };
    // five of them hour by hour: with the hours' own line under them they end where the picture of the day ends
    used.lanes = used.lanes.slice(0, 5).map((lane, i) => {
      const c = used.chats[i];
      return { key: c.key, title: c.title, name: c.name, work: spread(lane.work, c.work).map(Math.round), out: spread(lane.out, c.out).map(Math.round), usd: spread(lane.usd, c.usd), sum: c.work, tokens: c.out, spent: c.usd };
    });
    used.projects = FOLDERS.map(([name, usd]) => ({ key: name, name, usd, ...shareOf(usd) }));
    used.models = [['claude-opus-5-5', 0.86], ['claude-sonnet-5-5', 0.14]].map(([key, part]) => ({ key, name: key, usd: Math.round(sum.usd * part * 100) / 100, ...shareOf(sum.usd * part) }));
    used.unpriced = [];
    sum.unpriced = 0;
    used.tools = used.tools.map((x) => (x.name === 'ops: capture' ? { ...x, name: 'playwright: navigate' } : x));
    used.active = { chats: 13, projects: FOLDERS.length };
    used.reading = { files: 412, done: 412, bytes: 2.6e9, read: 2.6e9, counting: true, today: true };
    await exec(`Desk.state.frozen = true; Desk.state.usage = ${JSON.stringify(used)}; paint()`);
    const res = madeUpRes(pricing, (sess, prog) => ({
      's-light': sess(498, 3.2, [prog('command', 'blender', 1100, 6, 2)]),
      's-turn': sess(212, 0),
      's-onboard': sess(471, 5.1, [prog('server', 'expo', 302, 2.4, 3, [8081]), prog('mcp', 'mcp_server', 46, 0, 3)]),
      's-push': sess(344, 0.1, [prog('mcp', 'mcp_server', 46, 0, 3)]),
    }));
    res.servers.push({ port: 8081, key: 's-onboard', label: 'expo', kind: 'server' });
    const chatRes = (key, extra, cpu) => ({ mem: res.sessions[key].mem + extra * MB, cpu, n: res.sessions[key].n + 2, ports: res.sessions[key].ports });
    Object.assign(res.chats, { [checkout]: chatRes('s-permission', 64, 0.4), [refactor]: chatRes('s-compact', 66, 3.3), [landing]: chatRes('s-finish', 61, 0.5),
      [lighting]: chatRes('s-light', 58, 9.6), [turntable]: chatRes('s-turn', 55, 0), [onboarding]: chatRes('s-onboard', 63, 7.9), [notify]: chatRes('s-push', 57, 0.2) });
    await exec(`Desk.state.res = ${JSON.stringify(res)}`);
    await view(pricing);
    const tie = { 's-permission': checkout, 's-agents': pricing, 's-compact': refactor, 's-finish': landing, 's-light': lighting, 's-turn': turntable, 's-onboard': onboarding, 's-push': notify };
    const RENDERS = 'D:\\work\\renders';
    const MOBILE = 'D:\\work\\mobile';
    // four more made-up sessions: the two of a 3D folder and the two of a phone app
    const further = () => [
      row({ key: 's-light', title: 'Kitchen scene lighting', cwd: RENDERS, state: 'working', since: madeAt - 4 * 60e3, context: 152000,
        words: 'Frame 12 is rendering at half size. The counter reads two stops lower already.', doing: tool('Bash', 'Render frame 12 at half size', 35, 0),
        live: { usd: 9.6, added: 31, removed: 12, warm: true, cacheUntil: madeAt + 44 * 60e3, cacheCold: 152000, cacheHit: 0.95 } }),
      row({ key: 's-turn', title: 'Turntable export script', cwd: RENDERS, state: 'idle', since: madeAt - 50 * 60e3, at: madeAt - 50 * 60e3, context: 61000, compacts: 0,
        words: 'The script exports 72 frames, one every five degrees.',
        live: { usd: 2.2, added: 64, removed: 0, warm: false, cacheUntil: madeAt - 20 * 60e3, cacheCold: 61000, cacheHit: 0.9 } }),
      row({ key: 's-onboard', title: 'Onboarding flow', cwd: MOBILE, state: 'working', since: madeAt - 7 * 60e3, context: 233000,
        words: 'Three screens now: welcome, name, done. Checking the skip button on each.', doing: tool('Bash', 'Start the app in the simulator', 50, 0),
        live: { usd: 14.9, added: 33, removed: 67, warm: true, cacheUntil: madeAt + 49 * 60e3, cacheCold: 233000, cacheHit: 0.96 } }),
      row({ key: 's-push', title: 'Push notifications', cwd: MOBILE, state: 'attention', waiting: 'dialog open', since: madeAt - 3 * 60e3, context: 74000, compacts: 0,
        words: 'There are two ways to send them. Which push service do you want?',
        live: { usd: 1.8, added: 0, removed: 0, warm: true, cacheUntil: madeAt + 2 * 60e3, cacheCold: 74000, cacheHit: 0.92 } }),
    ];
    // What the made-up rows shared by the tests leave unsaid, said for a picture: the folder of a session whose console
    // is in another one, a name and words for the session of the other agent, each folder's branch (every session of
    // one folder is on the same one), and the plan, the files and the commands of the turns going on. A session at
    // work that changed files is named on the cards of the others in its folder: one per folder at most.
    const repo = (folder, branch) => ({ cwd: `D:\\work\\${folder}`, git: { top: `D:\\work\\${folder}`, branch, copy: '', main: `D:\\work\\${folder}`, repo: '' } });
    const todo = (done, ...texts) => ({ done, total: texts.length, current: texts[done] || '', items: texts.map((text, i) => ({ text, state: i < done ? 'done' : i === done ? 'doing' : 'todo' })) });
    const changed = (...names) => ({ count: names.length, names });
    const ran = (count, last) => ({ count, last });
    const SHOP = repo('shop', 'main');
    const said = {
      's-permission': { ...SHOP, steps: todo(3, 'Find where the tax field is lost', 'Carry it over from the basket', 'Run the checkout tests', 'Deploy to production'),
        files: changed('basket.ts'), commands: ran(1, 'Bash · npm test -- checkout') },
      's-words': SHOP, 's-error': SHOP, 's-idle': SHOP, 'job:abc12345': SHOP,
      's-agents': { ...repo('pricing', 'main'), steps: todo(3, 'Read our own plans', 'Find the five pricing pages', 'Compare competitors A, B and C', 'Compare competitors D and E', 'Build the table',
        'Say where we are out of line') },
      's-compact': { ...repo('api', 'limiter'), steps: todo(3, 'Split counting into its own module', 'Split storing into its own module', 'Slim the limiter down to answering',
        'Move the callers in routes/', 'Run every test'), files: changed('count.ts', 'store.ts', 'limiter.ts'), commands: ran(1, 'Bash · npm test -- limiter') },
      'codex:x': { ...repo('api', 'limiter'), title: 'Flaky login test', words: 'The retry hides a race in the session cookie. Writing a test that fails every time.' },
      's-finish': { ...repo('landing', 'new-copy'), steps: todo(3, 'Rewrite the hero', 'Rewrite the features', 'Rewrite the pricing'),
        files: changed('hero.tsx', 'features.tsx', 'pricing.tsx'), commands: ran(1, 'Bash · Build the site') },
      's-light': { ...repo('renders', 'lights'), steps: todo(2, 'Read the scene', 'Lower and warm the key light', 'Render a test frame', 'Compare it with the last render'),
        files: changed('kitchen.py'), commands: ran(1, 'Bash · Render frame 12 at half size') },
      's-turn': { ...repo('renders', 'lights'), files: changed('turntable.py'), commands: ran(1, 'Bash · Plan the turntable without rendering') },
      's-onboard': { ...repo('mobile', 'onboarding'), steps: todo(2, 'Read the flow', 'Fold screens two and four into the first', 'Check the skip button on each screen', 'Run the app tests'),
        files: changed('Flow.tsx', 'Welcome.tsx'), commands: ran(1, 'Bash · Start the app in the simulator') },
      's-push': repo('mobile', 'onboarding'),
    };
    const rowsFor = (flip) => [...madeUpRows(flip), ...further()].map((r) => ({ ...r, ...said[r.key], ...(tie[r.key] ? { chat: tie[r.key] } : {}) }));
    // one account in these pictures, as most people have: the rows of other accounts stay out of them
    const alone = (json) => {
      const s = JSON.parse(json);
      s.accounts = { ...s.accounts, list: s.accounts.list.filter((a) => a.key === s.accounts.current), marks: s.accounts.marks.filter((m) => m.key === s.accounts.current) };
      return JSON.stringify(s);
    };
    await exec(`takeSnapshot(${alone(fake(madeAt, rowsFor(false)))})`);
    await exec(`takeSnapshot(${alone(fake(madeAt + 1, rowsFor(true)))})`);
    await wait(300);

    // What the Servers page knows shows in these pictures: on its own page, in the marks of its row in the list and in
    // the question a close asks. From here on it knows made-up servers only: they are sent the way the main process
    // sends what it sees, and what it really sees (the dev servers running on this machine) is held back until the
    // last picture is taken.
    const minutes = (n) => madeAt - n * 60e3;
    const srv = (id, name, folder, command, over) => ({ id, name, folder: `D:\\work\\${folder}`, command, url: '', seen: '', ports: [], state: 'stopped', label: '', holder: null, exit: null,
      by: 'app', mem: 0, since: 0, programs: 0, ...over });
    const madeUpServers = {
      madeUp: true, at: madeAt, ready: true, hidden: 0,
      servers: [
        srv('made-1', 'Shop storefront', 'shop', 'npm run dev', { state: 'running', label: 'vite', seen: 'http://localhost:5173/', ports: [5173], since: minutes(134), mem: 233 * MB, programs: 3, by: 'claude' }),
        srv('made-2', 'API', 'api', 'npm run dev -- --port 8787', { state: 'running', label: 'node', seen: 'http://localhost:8787/', ports: [8787], since: minutes(131), mem: 148 * MB, programs: 2 }),
        srv('made-3', 'Phone app bundler', 'mobile', 'npx expo start', { state: 'running', label: 'expo', seen: 'http://localhost:8081/', ports: [8081], since: minutes(52), mem: 302 * MB, programs: 3 }),
        srv('made-4', 'Docs', 'docs', 'pnpm dev', { url: 'http://localhost:4321/' }),
        srv('made-5', 'Render queue', 'renders', 'python queue.py', { state: 'failed', url: 'http://localhost:9090/', exit: { at: minutes(48), code: 1 } }),
      ],
      loose: [{ key: 'made-loose', folder: 'D:\\work\\pricing', label: 'next-server', name: 'node', via: '', ports: [3000], pid: 0, started: 0, since: minutes(22), mem: 412 * MB }],
    };
    const sendWas = win.webContents.send;
    win.webContents.send = function send(channel, ...args) {
      if (channel === 'desk:servers' && !(args[0] && args[0].madeUp)) return undefined;
      return sendWas.call(this, channel, ...args);
    };
    // The page also asks the main process what runs, each time its Servers view comes into sight or leaves it, and
    // takes the answer: the made-up servers are sent again once that answer is in.
    const madeUpOnly = async () => {
      await wait(700);
      win.webContents.send('desk:servers', madeUpServers);
      return until(() => exec('Servers.view().madeUp === true'), 3000, 50);
    };
    await madeUpOnly();
    const realSeen = [];

    // four workspaces over the made-up folders, each with a colour of its own: short names, so their tabs keep to one line
    const spaces = {};
    for (const [name, color, folders] of [['Shop', 'rose', ['shop', 'landing']], ['Work', 'sky', ['pricing', 'api']], ['3D', 'mint', ['renders']], ['App', 'olive', ['mobile']]]) {
      const id = await call('addSpace', name);
      await call('colorSpace', id, color);
      for (const f of folders) { await call('putFolder', at(f), id); await call('putFolder', `D:\\work\\${f}`, id); }
      spaces[name] = id;
    }
    await call('switchSpace', '');

    const dress = async () => {
      await wait(700);
      for (const id of await exec('Terms.shown()')) if (kindOf[id]) await inPage(pageDress, id, kindOf[id]);
      await wait(350);
      await exec('paint()');
    };
    // The work clock counts a session from the person's keys and mouse, and a hidden window gets neither: it is told
    // of a made-up session before every picture, since the main process says "away" again whenever it speaks.
    const atWork = () => exec('Shift.take({ on: true, now: Date.now(), auto: false, gap: 15, session: { start: Date.now() - 134 * 60e3, last: Date.now() - 4e3 }, shift: null, offer: null, next: null }); true');
    const picture = async (name) => {
      await exec('document.getElementById("toast").hidden = true');
      await atWork();
      if (!(await exec('Servers.view().madeUp === true'))) realSeen.push(name);
      for (let i = 0; i < 3; i++) { await win.webContents.capturePage(); await wait(120); }
      await shoot(name);
    };
    const taken = [];
    const take = async (name) => { await picture(name); taken.push(name); };
    /** Which chats stand on screen, in which places, and which of them was used last. */
    const seat = (ids, top) => inPage((list, first) => {
      const s = Desk.state;
      s.shown = [...list, ...s.shown.filter((x) => !list.includes(x))];
      s.recent = [first, ...list.filter((x) => x !== first), ...s.recent.filter((x) => !list.includes(x))];
      return true;
    }, ids, top);
    // going into a chat counts as having seen what it waits for: for a picture every wait counts again, and the chat
    // that finished while another one had the keyboard is unseen again
    const unseen = () => exec(`Desk.state.seenWaits.clear(); Desk.state.unread.add('s-finish'); Desk.paint(); true`);
    const seenAs = [];
    /** One picture of the chats: a workspace in front ('' for all, also: a second one beside it), so many on screen. */
    const scene = async (name, space, tiles, ids, top, also = '') => {
      await exec(`Desk.setTiles(${tiles})`);
      await seat(ids, top);
      await call('switchSpace', space);
      if (also) await call('toggleSpace', also);
      await view(top);
      await wait(300);
      await dress();
      await unseen();
      const sp = await spacesNow();
      seenAs.push({ tabs: sp.tabs.map((t) => t.name), rows: sp.keys.length, on: (await inPage(pageTiles)).n, spill: sp.spill, lines: sp.lines });
      await take(name);
    };

    await scene('shots-01-all', '', 4, [checkout, pricing, lighting, onboarding], pricing);
    await scene('shots-02-shop', spaces.Shop, 2, [checkout, landing], checkout);
    await scene('shots-03-work', spaces.Work, 2, [pricing, refactor], pricing);
    await scene('shots-04-3d', spaces['3D'], 2, [lighting, turntable], lighting);
    await scene('shots-05-app', spaces.App, 2, [onboarding, notify], notify);
    await scene('shots-06-two', spaces.Shop, 4, [checkout, landing, pricing, refactor], pricing, spaces.Work);
    const blocks = await exec('[...document.querySelectorAll("#chat-list .ws-block")].length');
    check('the pictures of the workspaces: every chat, then each workspace with its own chats on screen and in the list, then two of them at once',
      seenAs.every((s) => same(s.tabs, ['All', 'Shop', 'Work', '3D', 'App']) && !s.spill && s.lines === 1) && same(seenAs.map((s) => s.rows), [13, 6, 3, 2, 2, 9])
      && same(seenAs.map((s) => s.on), [4, 2, 2, 2, 2, 4]) && blocks === 2,
      `${seenAs.map((s) => `${s.rows} in the list, ${s.on} on screen, tabs on ${s.lines} line${s.lines === 1 ? '' : 's'}`).join('; ')}; ${blocks} blocks when two are shown`);

    // one chat big, with the panel beside it
    await exec('Desk.setTiles(1)');
    await call('switchSpace', spaces.Work);
    await view(pricing);
    await exec('Desk.setInspector(true)');
    await wait(400);
    await dress();
    await unseen();
    await take('shots-07-panel');
    await exec('Desk.setInspector(false)');
    // every chat of every workspace as a card; then the Dashboard: what runs now and, further down, what today cost
    await call('switchSpace', '');
    await view('overview');
    await wait(500);
    await unseen();
    await take('shots-08-cards');
    await view('stats');
    await wait(500);
    await unseen();
    await take('shots-09-dashboard');
    const inSight = await inPage(() => {
      const heads = [...document.querySelectorAll('#stats .sec-head h3')];
      const head = heads.find((x) => x.textContent === 'Today');
      const box = head && head.closest('.sec');
      let el = box;
      while (el && !(el.scrollHeight > el.clientHeight + 10 && /auto|scroll/.test(getComputedStyle(el).overflowY))) el = el.parentElement;
      if (!el) return [];
      // the line that parts it from what stands above goes just out of sight
      el.scrollTop += box.getBoundingClientRect().top - el.getBoundingClientRect().top + 6;
      const frame = el.getBoundingClientRect();
      return heads.filter((x) => { const r = x.getBoundingClientRect(); return r.bottom > frame.top && r.top < frame.bottom; }).map((x) => x.textContent);
    });
    await wait(400);
    // the accounts stand higher up on that page: this picture is of the day's numbers and of nothing else
    const dayOnly = inSight.includes('Today') && inSight.includes('Day by day') && !inSight.some((x) => /account|limits reset/i.test(x));
    if (dayOnly) await take('shots-10-usage');
    check("the Dashboard's picture of the day shows what the day cost and no account", dayOnly && taken.includes('shots-10-usage'), inSight.join(' / '));

    // the chat that rewrote a landing page, with its pages beside it: Claude Code's side talks to the door as it would
    const LANDING = '<!doctype html><html><head><meta charset="utf-8"><title>Fieldnote · notes that find you</title><style>'
      + 'body{margin:0;font:16px/1.55 system-ui,"Segoe UI",sans-serif;color:#141414;background:#f6f4ef}nav{display:flex;align-items:center;justify-content:space-between;padding:20px 40px}'
      + 'nav b{font-size:18px;letter-spacing:-.01em}nav span{color:#6b6a66;margin-left:24px;font-size:14px}.hero{padding:64px 40px 40px;max-width:820px}'
      + 'h1{font-size:54px;line-height:1.04;letter-spacing:-.035em;margin:0 0 18px}.hero p{font-size:19px;color:#55534e;margin:0 0 28px;max-width:560px}'
      + '.cta{display:inline-block;padding:13px 22px;border-radius:10px;background:#141414;color:#fff;text-decoration:none;font-weight:600;margin-right:10px}'
      + '.ghost{background:transparent;color:#141414;border:1px solid #cfccc4}.art{margin:6px 40px 0;height:300px;border-radius:18px;'
      + 'background:radial-gradient(120% 95% at 72% 112%,#f4c27f 0%,#de7f52 34%,#4a3027 70%,#1c1615 100%)}'
      + '.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:18px;padding:36px 40px 60px}.grid div{background:#fff;border:1px solid #e6e2d8;border-radius:12px;padding:18px}'
      + '.grid b{display:block;margin-bottom:4px}.grid p{margin:0;color:#6b6a66;font-size:14px}</style></head><body>'
      + '<nav><b>Fieldnote</b><div><span>Features</span><span>Pricing</span><span>Sign in</span></div></nav>'
      + '<section class="hero"><h1>Notes that find their way back to you.</h1><p>Write it down once. Fieldnote brings it back on the day you need it, in the place you need it.</p>'
      + '<a class="cta" href="#">Start free</a><a class="cta ghost" href="#">See how it works</a></section><div class="art"></div>'
      + '<section class="grid"><div><b>Write once</b><p>Plain text, kept on your machine.</p></div><div><b>Found again</b><p>Every note comes back when it matters.</p></div>'
      + '<div><b>No small print</b><p>Three plans, one price each.</p></div></section></body></html>';
    const site = http.createServer((q, r) => { r.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); r.end(LANDING); });
    await new Promise((done) => site.listen(0, '127.0.0.1', done));
    const door = await until(() => { const d = browser.door(); return d && d.port ? d : null; }, 10000, 100);
    const token = browser.token();
    const post = (body, sid = '') => new Promise((done, fail) => {
      const text = JSON.stringify(body);
      const req = http.request({ host: '127.0.0.1', port: door.port, path: '/mcp', method: 'POST', headers: {
        'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', 'Content-Length': Buffer.byteLength(text), Authorization: `Bearer ${token}`,
        ...(sid ? { 'Mcp-Session-Id': sid } : {}) } }, (r) => {
        const parts = [];
        r.on('data', (c) => parts.push(c));
        r.on('end', () => { let json = null; try { json = JSON.parse(Buffer.concat(parts).toString('utf8')); } catch { json = null; } done({ sid: String(r.headers['mcp-session-id'] || ''), json }); });
      });
      req.on('error', fail);
      req.end(text);
    });
    let rpc = 0;
    const use = async (sid, name, args) => {
      const r = await post({ jsonrpc: '2.0', id: ++rpc, method: 'tools/call', params: { name, arguments: args } }, sid);
      const out = r.json && r.json.result;
      return { error: !out || Boolean(out.isError), text: out ? out.content.filter((c) => c.type === 'text').map((c) => c.text).join('\n') : '' };
    };
    const folder = path.join(dir, 'work', 'landing');
    const opened = await post({ jsonrpc: '2.0', id: ++rpc, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'made-up-claude-code', version: '0' } } });
    const sid = opened.sid;
    await post({ jsonrpc: '2.0', method: 'notifications/initialized' }, sid);
    browser.who((_pid, drv) => (drv && drv.sid === sid ? { name: 'Landing page copy', key: 's-finish', chat: landing, cwd: folder } : null));
    try {
      await exec('Desk.setTiles(1)');
      await view(landing);
      const went = await use(sid, 'navigate', { url: `http://127.0.0.1:${site.address().port}/` });
      const tab = (/in a new page, (t\d+)/.exec(went.text) || /\b(t\d+)\b/.exec(went.text) || [])[1] || '';
      await exec(`Browser.toggleFor(${JSON.stringify(landing)}, true)`);
      // the chat's terminal is laid out again while a panel slides in: its screen is dressed once its width holds still
      const tileWide = () => inPage((id) => { const t = document.querySelector(`.tile[data-id="${id}"]`); return t ? Math.round(t.getBoundingClientRect().width) : 0; }, landing);
      const settled = () => until(async () => { const a = await tileWide(); await wait(300); return a > 0 && a === await tileWide() ? a : null; }, 6000, 50);
      await settled();
      await dress();
      // the window's own picture leaves out the pages laid over it: the page is put in as the panel's own picture
      const still = tab ? await browser.get().still(tab) : '';
      await inPage((src) => { const s = document.querySelector('#web .web-still'); s.src = src; s.hidden = !src; document.querySelector('#web .web-empty').hidden = true; }, still);
      await unseen();
      await take('shots-11-browser');
      await inPage(() => { const s = document.querySelector('#web .web-still'); s.hidden = true; s.removeAttribute('src'); });
      await exec(`Browser.toggleFor(${JSON.stringify(landing)}, false)`);
      check('the Browser picture: the chat opened the made-up landing page in its own page, shown beside it', !went.error && Boolean(tab) && still.length > 1000,
        JSON.stringify({ error: went.error, tab, still: still.length, said: went.text.slice(0, 120) }));

      // two takes of the landing page's picture, drawn here, side by side in the Viewer
      const art = (file, cx, cy, stops) => {
        const w = 1280;
        const h = 800;
        const raw = Buffer.alloc((w * 3 + 1) * h);
        for (let y = 0; y < h; y++) {
          for (let x = 0; x < w; x++) {
            const d = Math.hypot((x / w - cx) / 1.2, (y / h - cy) / 0.95);
            let i = 0;
            while (i < stops.length - 2 && d > stops[i + 1][0]) i++;
            const [d0, c0] = stops[i];
            const [d1, c1] = stops[i + 1];
            const t = Math.min(1, Math.max(0, (d - d0) / (d1 - d0)));
            const o = y * (w * 3 + 1) + 1 + x * 3;
            for (let k = 0; k < 3; k++) raw[o + k] = Math.max(0, Math.min(255, Math.round(c0[k] + (c1[k] - c0[k]) * t + ((x * 7 + y * 13) % 5) - 2)));
          }
        }
        const crcs = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
        const crc = (b) => { let c = 0xffffffff; for (const v of b) c = crcs[(c ^ v) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
        const chunk = (kind, data) => { const n = Buffer.alloc(4); n.writeUInt32BE(data.length); const body = Buffer.concat([Buffer.from(kind), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(body)); return Buffer.concat([n, body, c]); };
        const head = Buffer.alloc(13);
        head.writeUInt32BE(w, 0); head.writeUInt32BE(h, 4); head[8] = 8; head[9] = 2;
        fs.writeFileSync(path.join(folder, file), Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', head), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
      };
      art('hero-take-2.png', 0.5, 1.0, [[0, [236, 200, 160]], [0.3, [176, 110, 92]], [0.7, [52, 40, 48]], [1.3, [18, 16, 20]]]);
      art('hero-take-3.png', 0.72, 1.12, [[0, [244, 194, 127]], [0.34, [222, 127, 82]], [0.7, [74, 48, 39]], [1.3, [28, 22, 21]]]);
      await view(landing);
      const shown = await use(sid, 'show_media', { files: ['hero-take-2.png', 'hero-take-3.png'], title: 'The hero picture, takes 2 and 3', note: 'Take 3: the light warmer and lower, as asked.' });
      await until(async () => { const s = await inPage(() => Viewer.state()); return s.open && s.media.length === 2 && s.media.every((m) => m.w === 1280) ? s : null; }, 8000, 100);
      await settled();
      await dress();
      await unseen();
      await take('shots-12-viewer');
      check('the Viewer picture: the chat showed its two takes side by side', !shown.error, JSON.stringify({ error: shown.error, said: shown.text.slice(0, 160) }));
      await use(sid, 'media_control', { action: 'close' });
    } finally {
      browser.who(null);
      await new Promise((done) => { site.close(() => done()); setTimeout(done, 2000); });
    }

    // a past conversation being read, from the list of every conversation kept on the machine (made-up ones here)
    await call('switchSpace', '');
    await view('history');
    const past = await until(async () => { const n = await exec('document.querySelectorAll("#history .row").length'); return n >= 8 ? n : null; }, 5000, 100);
    await tabOf('history', 'conv');
    await wait(400);
    await unseen();
    await take('shots-14-history');

    // the search box, over the chats of every workspace
    await exec('Desk.setTiles(4)');
    await seat([checkout, pricing, lighting, onboarding], pricing);
    await view(pricing);
    await wait(300);
    await dress();
    await unseen();
    await exec('Palette.open()');
    await wait(400);
    const offered = await exec('document.querySelectorAll("#palette .pal-item").length');
    await take('shots-15-search');
    await exec('Palette.close()');

    // the card that floats over other programs, for the chat in front: its plan, its subagents, its memory, what it
    // used. A window of its own, which a hidden run never shows: its picture is taken from it.
    let card = null;
    if (float) {
      float.place(null);
      try {
        await ctrl('KeyF', { shift: true });
        const cardWin = await until(() => { const w = float.win(); return w && !w.isDestroyed() && !w.webContents.isLoading() && float.model() !== null ? w : null; }, 8000);
        const readCard = () => cardWin.webContents.executeJavaScript(`(() => {
          const root = document.getElementById('card');
          if (!root || root.hidden) return null;
          const t = (sel) => { const el = root.querySelector(sel); return el ? el.textContent : ''; };
          return { name: t('.fc-name'), plan: t('.fc-plan .fc-count'), agents: root.querySelectorAll('.fc-agent').length, needs: t('.fc-needs'), working: t('.fc-working'),
            height: Math.ceil(root.getBoundingClientRect().height) };
        })()`, true);
        // its page tells the time by itself: it is put on the made-up afternoon too, and counts from there at its next second
        if (cardWin) await cardWin.webContents.executeJavaScript(`(${pageClock})(${ahead})`, true);
        await wait(1300);
        // its fonts arrive after its first draw, and its window follows the card's height
        card = cardWin ? await until(async () => { const c = await readCard(); return c && c.name === 'Pricing research' && cardWin.getBounds().height === c.height + 16 ? c : null; }, 8000) : null;
        if (card) {
          await cardWin.webContents.capturePage();
          await wait(150);
          fs.writeFileSync(path.join(dir, 'shots-17-card.png'), (await cardWin.webContents.capturePage()).toPNG());
          taken.push('shots-17-card');
        }
        // switched off the way it was switched on, so the window knows
        await ctrl('KeyF', { shift: true });
        await until(async () => !float.win() && (await exec('Desk.state.settings.float.on')) === false, 4000);
      } finally {
        float.set({ on: false, small: false, overDesk: false });
        float.place(null);
      }
    }
    check('the floating card picture: the chat in front with its plan and its subagents at work, and the chats that need the person by name',
      Boolean(card) && card.plan === '3 of 6 done · 1 under way' && card.agents === 3 && /^\d need you:.*Checkout page rebuild/.test(card.needs) && taken.includes('shots-17-card')
      && settingsNow().float.on === false && !float.win(), JSON.stringify(card));

    // the Servers page: the picture is taken only if it names the made-up servers and nothing else
    const wanted = [...madeUpServers.servers.map((s) => s.name), 'pricing'];
    await view('servers');
    await madeUpOnly();
    const named = await until(async () => { const n = await exec('[...document.querySelectorAll("#servers .srv-name")].map((x) => x.textContent)'); return same(n, wanted) ? n : null; }, 4000, 100) || [];
    await wait(300);
    if (same(await exec('[...document.querySelectorAll("#servers .srv-name")].map((x) => x.textContent)'), wanted)) await take('shots-13-servers');
    check('the Servers picture shows the made-up servers and no server of this machine', same(named, wanted) && taken.includes('shots-13-servers'), `${named.length} named on the page`);

    // the question a close asks, Gaming mode among its choices: its sentence counts what the Servers page knows
    await view(pricing);
    await madeUpOnly();
    await dress();
    await unseen();
    let asked = null;
    let closes = '';
    if (await exec('Servers.view().madeUp === true')) {
      win.webContents.send('desk:command', 'ask-leave');
      asked = await until(async () => !(await exec('document.getElementById("leave").hidden')), 3000);
      closes = await exec('(document.querySelector("#leave .leave-choice[data-how=gaming] .leave-note") || {}).textContent || ""');
      if (asked && closes.startsWith('Closes your 8 chats, 3 pinned servers and 1 other dev server,')) await take('shots-16-leave');
      await inPage(pageKey, 'Escape', '#leave');
      await wait(150);
    }
    check('the picture of the question a close asks counts the made-up servers and no server of this machine', Boolean(asked) && taken.includes('shots-16-leave'), closes.slice(0, 90));
    win.webContents.send = sendWas;
    check('no picture was taken while the window knew of a server of this machine', realSeen.length === 0, realSeen.join(' '));

    const list = await inPage(pageList);
    check('History, the search box and the question a close asks were in front of their pictures, and the close was not answered',
      past === 8 && offered > 8 && Boolean(asked) && (await exec('document.getElementById("leave").hidden')) === true && chats.all.size === 8,
      `${past} conversations in History; ${offered} things offered by the search box; chats still open: ${chats.all.size}`);
    check('the pictures were taken with made-up chats only: eight consoles drawn over and thirteen made-up sessions in the list',
      list.rows === 13 && list.here === 8 && list.away === 5 && list.ended === 0, `${list.rows} sessions in the list, ${list.here} of them chats of this window`);
    check('seventeen pictures, each taken once', taken.length === 17 && new Set(taken).size === 17, taken.map((name) => name.replace('shots-', '')).join(' '));
  };

  const stripPhase = async () => {
    check('the window loads for the made-up strip checks', Boolean(await until(() => exec('typeof Desk === "object" && Desk !== null'), 15000)));
    watch.post({ type: 'pace', ms: 600000 });
    await wait(700);
    const root = fs.mkdtempSync(path.join(dir, 'strip-'));
    const home = path.join(root, 'home');
    const cwd = path.join(root, 'work', 'strip-shop');
    const project = path.join(home, '.claude', 'projects', cwd.replace(/[^A-Za-z0-9]/g, '-'));
    const sessions = path.join(home, '.claude', 'sessions');
    const session = '11111111-2222-4333-8444-555555555551';
    const emptySession = '11111111-2222-4333-8444-555555555552';
    const file = path.join(project, `${session}.jsonl`);
    const record = path.join(sessions, `${process.pid}.json`);
    const chat = 'strip-made-up-chat';
    let installed = false;
    let local = null;
    let tick = Date.now() - 10000;
    const stamp = () => new Date(++tick).toISOString();
    const asked = (text) => ({ type: 'user', timestamp: stamp(), cwd, message: { role: 'user', content: text } });
    const called = (id, name, input) => ({ type: 'assistant', timestamp: stamp(), cwd,
      message: { role: 'assistant', model: 'claude-opus-5-5', usage: { input_tokens: 12000 }, content: [{ type: 'tool_use', id, name, input }] } });
    const answered = (id, content) => ({ type: 'user', timestamp: stamp(), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content }] } });
    const append = (rows, target = file) => fs.appendFileSync(target, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
    const own = (id) => fs.writeFileSync(record, JSON.stringify({ sessionId: id, cwd, status: 'busy', statusUpdatedAt: ++tick, startedAt: tick - 60000 }));
    const picture = () => { local.poll(); local.sent = ''; return local.snapshot(); };
    const show = async (snap) => {
      await inPage((s, id) => {
        const st = Desk.state;
        st.snap = s;
        st.snap.chats[0].chat = id;
        st.view = id;
        st.sel = null;
        document.getElementById('chat').hidden = false;
        document.getElementById('peek').hidden = true;
        Desk.ChatView.place(st, [id]);
        Desk.ChatView.render(st);
      }, snap, chat);
      await drawn();
    };
    const factsAt = (selector = '.tile-head') => inPage((sel) => {
      const host = document.querySelector(sel);
      const take = (name) => {
        const el = host && host.querySelector(`.f-${name}`);
        if (!el) return null;
        const rect = el.getBoundingClientRect();
        const head = host.getBoundingClientRect();
        return { text: el.textContent, tip: el.dataset.tip || '', visible: getComputedStyle(el).display !== 'none' && rect.width > 0
          && (sel !== '.tile-head' || (rect.left >= head.left && rect.right <= head.right)) };
      };
      return { files: take('files'), commands: take('commands'), steps: take('steps'), memory: take('mem'),
        order: host ? [...host.querySelectorAll('.f-files, .f-commands, .f-steps')].map((el) => el.className.match(/f-(files|commands|steps)/)[1]) : [],
        memoryFirst: Boolean(host && host.querySelector('.f-mem + .f-files')),
        empty: host ? [...host.querySelectorAll('.fact')].filter((el) => !el.textContent.trim()).length : -1 };
    }, selector);
    // the line under the strip with the plan, and the list it opens
    const planAt = () => inPage(() => {
      const row = document.querySelector('#tiles .tile .tile-plan');
      const pop = document.querySelector('#tiles .tile .plan-pop');
      const body = document.querySelector('#tiles .tile .tile-body');
      const shown = Boolean(row) && !row.hidden;
      return { shown, n: shown ? row.querySelector('.pl-n').textContent : '', now: shown ? row.querySelector('.pl-now').textContent : '',
        marks: shown ? [...row.querySelectorAll('.pl-m')].map((m) => m.classList[1]) : [], tip: shown ? row.dataset.tip || '' : '',
        open: Boolean(pop) && !pop.hidden, steps: pop && !pop.hidden ? [...pop.querySelectorAll('.pl-step')].map((s) => [s.classList[1], s.textContent]) : [],
        body: body ? Math.round(body.getBoundingClientRect().height) : 0, row: shown ? Math.round(row.getBoundingClientRect().height) : 0 };
    });
    try {
      for (const folder of [cwd, project, sessions]) fs.mkdirSync(folder, { recursive: true });
      const names = ['cart.js', 'totals.js'];
      const files = names.map((name) => path.join(cwd, 'src', name));
      const shell = [
        ['Bash', { description: 'Check the made-up cart', command: 'printf STRIP_PRIVATE_ARGUMENT' }],
        ['PowerShell', { description: 'Check the made-up totals', command: 'Write-Output STRIP_PRIVATE_ARGUMENT' }],
        ['Bash', { command: 'printf strip-check\nprintf STRIP_PRIVATE_ARGUMENT' }],
        ['PowerShell', { description: 'Check the made-up receipt ' + 'with bounded detail '.repeat(8), command: 'Write-Output STRIP_PRIVATE_ARGUMENT' }],
      ];
      const todos = ['Check the cart', 'Check the totals', 'Write the receipt', 'Check the tax', 'Read the result']
        .map((content, i) => ({ content, activeForm: content, status: i < 2 ? 'completed' : i === 2 ? 'in_progress' : 'pending' }));
      append([asked('Prepare a made-up receipt'),
        called('edit-1', 'Edit', { file_path: files[0], old_string: 'a', new_string: 'b' }),
        called('edit-2', 'MultiEdit', { file_path: files[1], edits: [{ old_string: 'a', new_string: 'b' }] }),
        called('edit-3', 'Edit', { file_path: files[0], old_string: 'b', new_string: 'c' }),
        ...shell.map(([name, input], i) => called(`shell-${i}`, name, input)), called('todos-1', 'TodoWrite', { todos })]);
      own(session);
      local = new Watch({ home, localAppData: path.join(root, 'local'), counting: false, measure: false });
      let snap = picture();
      let c = snap.chats[0];
      check('the made-up watcher puts the turn figures on the session picture', snap.chats.length === 1 && c.key === session
        && c.files.count === 2 && c.commands.count === 4 && c.steps.done === 2 && c.steps.total === 5,
      'two files, four commands, two of five steps done');
      installed = true;
      await inPage((id, folder) => {
        const st = Desk.state;
        window.deskStripSaved = { state: { ...st }, reader: Reader.fake, style: document.getElementById('tiles').style.cssText,
          hidden: Object.fromEntries(['chat', 'peek', 'history', 'stats', 'inspector'].map((key) => [key, document.getElementById(key).hidden])) };
        Reader.fake = () => ({ items: [], replies: [], orphans: {}, from: 0, to: 0, start: true });
        Object.assign(st, { chats: [{ id, cwd: folder, title: 'Made-up receipt', starter: 'shell' }], view: id, shown: [id], recent: [id],
          snap: { at: 1, chats: [], ended: [], leaving: [], plan: null, accounts: null }, res: null, usage: null, frozen: true, loose: false,
          unread: new Set(), before: new Map(), sel: null, selLeaving: '', armed: new Set(), armedAs: new Map(), resumed: new Map(),
          settings: { ...st.settings, tiles: 1, inspector: true, spaces: [], space: '' } });
        for (const key of ['peek', 'history', 'stats']) document.getElementById(key).hidden = true;
        document.getElementById('chat').hidden = false;
        document.getElementById('inspector').hidden = false;
        document.getElementById('tiles').style.cssText = 'flex: none; width: 1100px;';
      }, chat, cwd);
      await show(snap);
      let facts = await factsAt();
      check('three edits to two files show two files with just their names in the hover note', c.files.count === 2 && same(c.files.names.slice().sort(), names.slice().sort())
        && facts.files && facts.files.text === '2 files' && names.every((name) => facts.files.tip.includes(name)) && !/[\\/]/.test(facts.files.tip)
        && facts.files.tip.includes('since your last message'), '2 files: cart.js, totals.js');
      const lastTool = c.turn.tools.filter((t) => t.name === 'Bash' || t.name === 'PowerShell').pop();
      check('four commands show only the clipped label already shown for the last tool call', facts.commands && facts.commands.text === '4 commands'
        && facts.commands.tip.includes('since your last message') && facts.commands.tip.includes(c.commands.last)
        && c.commands.last.includes(lastTool.name) && c.commands.last.includes(lastTool.what) && lastTool.what.length <= 90
        && c.commands.last.length <= lastTool.name.length + lastTool.what.length + 3 && !facts.commands.tip.includes('STRIP_PRIVATE_ARGUMENT'),
      '4 commands; the existing tool label is the whole command detail');
      let plan = await planAt();
      check('TodoWrite shows, under the strip, a mark for each of five steps, that it is on the third, and that step in its own words', plan.shown
        && plan.n === '3/5' && plan.now === 'Write the receipt' && same(plan.marks, ['done', 'done', 'doing', 'todo', 'todo'])
        && plan.tip.includes('2 of 5 done · 1 under way') && plan.tip.includes('Now: Write the receipt') && c.steps.current === 'Write the receipt' && !facts.steps,
      `${plan.n}: ${plan.now}`);
      const bodyWith = plan.body;
      const rowTall = plan.row;
      await inPage(() => document.querySelector('#tiles .tile .tile-plan').click());
      plan = await planAt();
      check('a click on the plan lists every step in its own words: two done, the one at work, two to come', plan.open && same(plan.steps, [
        ['done', 'Check the cart'], ['done', 'Check the totals'], ['doing', 'Write the receipt'], ['todo', 'Check the tax'], ['todo', 'Read the result']]),
      JSON.stringify(plan.steps));
      // only the made-up chat and its steps: the list of chats beside it shows the real chats of this machine
      const chatArea = await inPage(() => {
        const tile = document.querySelector('#tiles .tile').getBoundingClientRect();
        const pop = document.querySelector('#tiles .tile .plan-pop').getBoundingClientRect();
        return { x: Math.floor(tile.left), y: Math.floor(tile.top), width: Math.min(Math.ceil(tile.width), 900), height: Math.ceil(pop.bottom - tile.top + 18) };
      });
      await drawn();
      await win.webContents.capturePage(chatArea);
      await wait(150);
      fs.writeFileSync(path.join(dir, 'strip-plan.png'), (await win.webContents.capturePage(chatArea)).toPNG());
      await inPage(() => document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true })));
      const afterEscape = await planAt();
      await inPage(() => document.querySelector('#tiles .tile .tile-plan').click());
      // pressed and let go: the window draws nothing while a button is down
      await inPage(() => { const at = document.getElementById('tiles'); at.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); at.dispatchEvent(new PointerEvent('pointerup', { bubbles: true })); });
      const afterPress = await planAt();
      check('Escape puts the list away, and so does a press anywhere else', !afterEscape.open && afterEscape.shown && !afterPress.open && afterPress.shown);
      check('the strip puts files and commands after memory in that order; the plan has its own line', same(facts.order, ['files', 'commands'])
        && facts.memory && facts.memory.visible && facts.memoryFirst && facts.empty === 0);
      const sideFacts = await factsAt('#inspector .d-head');
      await inPage(() => {
        const st = Desk.state;
        st.snap = { ...st.snap, chats: st.snap.chats.map((c) => ({ ...c, chat: '' })) };
        st.sel = { kind: 'live', key: st.snap.chats[0].key };
        Desk.Peek.render(st);
      });
      const awayFacts = await factsAt('#peek .d-head');
      check('the panel beside a chat and the panel for another terminal carry the same facts as the strip, and the step it is on',
        [sideFacts, awayFacts].every((f) => same(f.order, ['files', 'commands', 'steps']) && ['files', 'commands'].every((key) => f[key]
          && f[key].text === facts[key].text && f[key].tip === facts[key].tip) && f.steps.text === 'step 3 of 5' && f.steps.tip.includes('Write the receipt')),
      'the same numbers and hover notes in both panels');
      await show(snap);
      const widths = [];
      for (const width of [1100, 850, 700, 550, 380]) {
        await inPage((w) => { document.getElementById('tiles').style.width = `${w}px`; }, width);
        await drawn();
        const f = await factsAt();
        const p = await planAt();
        widths.push([f.files && f.files.visible, f.commands && f.commands.visible, f.memory && f.memory.visible, p.shown && p.now === 'Write the receipt']);
      }
      check('as a strip narrows, commands then files give way while memory stays; the plan keeps its line at every width', same(widths,
        [[true, true, true, true], [true, true, true, true], [true, false, true, true], [false, false, true, true], [false, false, true, true]]),
      JSON.stringify(widths));
      await inPage(() => { document.getElementById('tiles').style.width = '1100px'; });
      append([asked('Start another made-up turn')]);
      snap = picture();
      c = snap.chats[0];
      await show(snap);
      facts = await factsAt();
      plan = await planAt();
      check('the next own message starts files and commands again from nothing, and a to-do list that is not finished stays', c.files.count === 0 && c.files.names.length === 0
        && c.commands.count === 0 && c.commands.last === '' && c.steps.total === 5 && c.steps.done === 2 && c.steps.current === 'Write the receipt'
        && !facts.files && !facts.commands && plan.shown && plan.n === '3/5' && plan.now === 'Write the receipt' && facts.empty === 0);
      append([called('create-1', 'TaskCreate', { subject: 'Read the fixture', activeForm: 'Read the fixture' }),
        called('create-2', 'TaskCreate', { subject: 'Check the receipt', activeForm: 'Check the receipt' }),
        called('create-3', 'TaskCreate', { subject: 'Discard this item', activeForm: 'Discard this item' })]);
      picture();
      append([answered('create-1', 'Task #1 created successfully: Read the fixture'),
        answered('create-2', 'Task #2 created successfully: Check the receipt'), answered('create-3', 'Task #3 created successfully: Discard this item'),
        called('update-1', 'TaskUpdate', { taskId: '1', status: 'completed' }), called('update-2', 'TaskUpdate', { taskId: '2', status: 'in_progress' }),
        called('update-3', 'TaskUpdate', { taskId: '3', status: 'deleted' })]);
      snap = picture();
      c = snap.chats[0];
      await show(snap);
      plan = await planAt();
      check('TaskCreate results and TaskUpdate show the second of two steps after one item is deleted', c.steps.done === 1 && c.steps.total === 2
        && c.steps.current === 'Check the receipt' && plan.shown && plan.n === '2/2' && plan.now === 'Check the receipt' && same(plan.marks, ['done', 'doing']),
      `${plan.n}: ${plan.now}`);
      append([called('update-done', 'TaskUpdate', { taskId: '2', status: 'completed' })]);
      snap = picture();
      c = snap.chats[0];
      await show(snap);
      plan = await planAt();
      check('a completed list says every step is done while its turn lasts, and gives its line back once the chat is no longer at work',
        c.state === 'working' ? plan.shown && plan.n === '2/2' && plan.now === 'All 2 steps done' : !plan.shown, `${c.state}: ${plan.shown ? plan.now : 'no line'}`);
      await show({ ...snap, chats: snap.chats.map((x) => ({ ...x, state: 'idle' })) });
      const idleDone = await planAt();
      check('the line of a finished plan goes once its chat rests, and the terminal gets that room back', !idleDone.shown && rowTall === 26 && idleDone.body === bodyWith + rowTall,
        `${idleDone.body} px against ${bodyWith} + ${rowTall}`);
      append([asked('Leave the completed list behind')]);
      await show(picture());
      plan = await planAt();
      check('a completed list is silent after the next own message', !plan.shown);
      append([asked('Only say hello'), { type: 'assistant', timestamp: stamp(), cwd,
        message: { role: 'assistant', content: [{ type: 'text', text: 'Hello from the made-up conversation.' }] } }], path.join(project, `${emptySession}.jsonl`));
      own(emptySession);
      snap = picture();
      c = snap.chats[0];
      await show(snap);
      facts = await factsAt();
      check('a conversation with none of this has no three facts, no plan line and no empty place', c.key === emptySession && c.files.count === 0
        && c.commands.count === 0 && c.steps.total === 0 && !facts.files && !facts.commands && !facts.steps && facts.empty === 0 && !(await planAt()).shown
        && (await exec('document.querySelector(".tile-head .th-facts").children.length')) === 0);

      // A background session that asked something and was answered: Claude Code leaves its state at blocked while it
      // works again, and only its tempo says active (seen on his machine, 3 Oct). The title bar must stop counting it.
      const jobId = 'made-up-strip-job';
      const jobFile = path.join(home, '.claude', 'jobs', jobId, 'state.json');
      fs.mkdirSync(path.dirname(jobFile), { recursive: true });
      const job = (state, tempo, needs) => fs.writeFileSync(jobFile, JSON.stringify({ state, tempo, needs, detail: 'Made-up answer', name: 'Made-up job', cwd,
        sessionId: emptySession, updatedAt: new Date(++tick).toISOString(), inFlight: { tasks: 0 } }));
      const bg = (status) => fs.writeFileSync(record, JSON.stringify({ sessionId: emptySession, cwd, kind: 'bg', jobId, status, statusUpdatedAt: ++tick, startedAt: tick - 60000 }));
      const bar = (s) => inPage((snapNow) => {
        Desk.state.snap = snapNow;
        Desk.paint();
        const tri = document.getElementById('triage');
        return tri.hidden ? '' : tri.textContent;
      }, s);
      job('blocked', 'blocked', 'Made-up question: which colour?');
      bg('idle');
      const askingSnap = picture();
      const asking = askingSnap.chats[0];
      const askingBar = await bar(askingSnap);
      job('blocked', 'active', '');
      bg('busy');
      const answeredSnap = picture();
      const answeredNow = answeredSnap.chats[0];
      const answeredBar = await bar(answeredSnap);
      job('failed', 'active', '');
      const failedThenAnswered = picture().chats[0];
      job('done', 'idle', '');
      bg('idle');
      const finished = picture().chats[0];
      check('a background session that asks something counts as needing you; answered, it is working at the next look though its record still says blocked, and the title bar stops counting it; failed then answered, it is working too',
        asking.state === 'attention' && asking.waiting === 'blocked' && askingBar === '1 needs you' && answeredNow.state === 'working' && answeredNow.waiting === '' && answeredBar === ''
        && failedThenAnswered.state === 'working' && finished.state === 'idle',
        JSON.stringify({ asking: [asking.state, askingBar], answered: [answeredNow.state, answeredBar], failedThenAnswered: failedThenAnswered.state, finished: finished.state }));

      // A terminal that handed its conversation to a background session stands aside while that one is shown in its
      // place; once Claude Code has let go of it, the terminal's own session is shown again (seen 4 Oct: the Nest's
      // chat, handed to a background session whose record had gone, showed nothing at all).
      const parkedJob = 'made-up-parked-job';
      const parkedFile = path.join(home, '.claude', 'jobs', parkedJob, 'state.json');
      const parkedJobAs = (state, tempo) => fs.writeFileSync(parkedFile, JSON.stringify({ state, tempo, name: 'Made-up parked job', cwd,
        sessionId: '11111111-2222-4333-8444-555555555553', updatedAt: new Date(++tick).toISOString() }));
      fs.writeFileSync(record, JSON.stringify({ sessionId: emptySession, cwd, kind: 'interactive', parkedJobId: parkedJob, status: 'idle', statusUpdatedAt: ++tick, startedAt: tick - 60000 }));
      fs.mkdirSync(path.dirname(parkedFile), { recursive: true });
      parkedJobAs('working', 'active');
      const handedOver = picture().chats.map((x) => x.key);
      parkedJobAs('done', 'idle');
      const handedDone = picture().chats.map((x) => x.key);
      fs.rmSync(path.dirname(parkedFile), { recursive: true, force: true });
      const handedGone = picture().chats.map((x) => x.key);
      check('a terminal that handed its conversation to a background session stands aside while that session is at work; once it is done, or its record is gone, the terminal\'s own session is shown again',
        same(handedOver, [`job:${parkedJob}`]) && same(handedDone, [emptySession]) && same(handedGone, [emptySession]), JSON.stringify({ handedOver, handedDone, handedGone }));
    } finally {
      try {
        if (installed) await inPage(() => {
          const saved = window.deskStripSaved;
          if (!saved) return;
          try {
            for (const detail of [Desk.ChatView.detail(), Desk.Peek.detail()]) {
              detail.show(null, Desk.state);
              for (const el of detail.el.querySelectorAll(':scope > .d-bar, :scope > .d-head, :scope > .d-tabs, :scope > .crumb, :scope > .d-body')) el.replaceChildren();
            }
            Object.assign(Desk.state, saved.state);
            Reader.fake = saved.reader;
            document.getElementById('tiles').style.cssText = saved.style;
            for (const [key, hidden] of Object.entries(saved.hidden)) document.getElementById(key).hidden = hidden;
            Desk.ChatView.place(Desk.state, Desk.onScreen());
            Desk.ChatView.render(Desk.state);
            Desk.Peek.render(Desk.state);
            Desk.paint();
          } finally {
            Object.assign(Desk.state, saved.state);
            Reader.fake = saved.reader;
            delete window.deskStripSaved;
          }
        });
      } finally {
        local = null;
        // The folder is made by this phase under its output directory; no CLI-owned file is removed.
        const target = path.resolve(root);
        const parent = path.resolve(dir) + path.sep;
        if (!target.startsWith(parent)) throw new Error('The made-up strip folder left its output directory.');
        fs.rmSync(target, { recursive: true, force: true });
        watch.post({ type: 'pace', ms: 2000 });
      }
      const clear = await inPage((id, keys) => !window.deskStripSaved && !Desk.state.chats.some((c) => c.id === id)
        && !Desk.state.snap.chats.some((c) => keys.includes(c.key)) && !document.querySelector(`.tile[data-id="${id}"]`)
        && ![...document.querySelectorAll('#inspector .d-head, #peek .d-head')].some((el) => el.textContent.includes('strip-shop')), chat, [session, emptySession]);
      check('the strip phase leaves no made-up file, session, chat or page override behind', !fs.existsSync(root) && clear);
    }
  };

  // ---- the window loaded again under running chats: for newer code, and after its own program died. Two plain
  // ---- consoles keep printing through it all; no agent is started. ----
  const reloadPhase = async () => {
    const appDir = __dirname;
    check('the window loads', Boolean(await until(() => exec('typeof Desk === "object" && Desk !== null'), 15000)));
    const a = await inPage(pageNew, plain);
    const okA = Boolean(a && a.id) && Boolean(await until(promptBack, 30000));
    const b = await inPage(pageNew, plain);
    const okB = Boolean(b && b.id) && Boolean(await until(promptBack, 30000));
    if (!check('two plain consoles open in this window', okA && okB)) throw new Error('no consoles');
    const typeIn = (id, text) => exec(`desk.input(${JSON.stringify(id)}, ${JSON.stringify(text)})`);
    // B: switches pasting in one piece on, prints a marker, then more than is kept (so that switch is long gone from
    // what is kept), asks the terminal what it is, and waits. A: counts, 40 times a second, through everything below.
    await typeIn(b.id, '$e=[char]27; Write-Host -NoNewline "$e[?2004h"; 1..12000 | % { "x" * 100 }; Write-Host "marker-b-end"; Write-Host -NoNewline "$e[c"; Start-Sleep 300\r');
    await typeIn(a.id, '$i=0; while ($true) { $i++; "tick $i"; Start-Sleep -Milliseconds 25 }\r');
    const ticks = async () => (await linesOf(a.id)).map((l) => /^tick (\d+)$/.exec(l.trim())).filter(Boolean).map((m) => Number(m[1]));
    const markers = async () => (await linesOf(b.id)).filter((l) => l.trim() === 'marker-b-end').length;
    const ready = await until(async () => (await markers()) === 1 && (await ticks()).length > 40, 60000, 300);
    if (!check('both consoles print: one counts, the other printed more than is kept for it', Boolean(ready))) throw new Error('the consoles did not print');
    // every tick from the first to the last, once each and in order
    const whole = (list) => list.length > 0 && list.every((n, i) => n === list[0] + i);
    const modes = (id) => exec(`(() => { const m = Terms.get(${JSON.stringify(id)}).term.modes; return { paste: m.bracketedPasteMode, mouse: m.mouseTrackingMode }; })()`);
    const consoles = () => chats.list().map((c) => `${c.id}:${c.pid}`).join(' ');
    const placeNow = () => exec('JSON.stringify([Desk.state.view, Desk.state.shown, Desk.state.recent])');
    // typed into a console by anyone while the window starts over: nothing should be (a report of the keyboard
    // coming or going is how a console asked to be told that, and is not counted)
    const typed = new Map();
    const input = chats.input;
    chats.input = function counted(id, data) {
      if (data !== '\x1b[I' && data !== '\x1b[O') typed.set(id, (typed.get(id) || 0) + data.length);
      return input.call(this, id, data);
    };
    // a page that is gone may never answer: every question to it gives up after 2 s. The page before is marked
    // (deskOld) so that only a new one counts as back, with every chat drawn.
    const ask = (js) => Promise.race([exec(js), wait(2000).then(() => { throw new Error('no answer'); })]);
    const back = async () => until(async () => {
      try { return await ask('typeof Desk === "object" && Desk !== null && !window.deskOld && Desk.drawn ? Desk.drawn.then(() => true) : false'); } catch { return false; }
    }, 20000, 150);
    try {
      const before = { consoles: consoles(), place: await placeNow(), thread: watch.thread(), modes: await modes(b.id), ticks: (await ticks()).length };
      await exec('window.deskOld = true; Desk.reloadPage()').catch(() => {});
      const fresh = await back();
      await wait(1500);
      const after = { consoles: consoles(), place: await placeNow(), thread: watch.thread(), modes: await modes(b.id), old: await exec('window.deskOld === true') };
      const t = await ticks();
      check('Reload the window: a new page, and the same consoles still run: none started again, none ended', Boolean(fresh) && !after.old && after.consoles === before.consoles,
        `consoles before: ${before.consoles}; after: ${after.consoles}`);
      check('every chat is where it was: the one with the keyboard, the places on screen, the order of the chats used last', after.place === before.place, `${before.place} -> ${after.place}`);
      check('the counting console shows every number once, in order, through the reload, and kept counting',
        whole(t) && t[0] === 1 && t.length > before.ticks, `${t.length} numbers, from ${t[0]} to ${t[t.length - 1]}; ${before.ticks} before the reload`);
      check('the other console shows what it printed last once, and a terminal switch it set long before what is kept is set again',
        (await markers()) === 1 && after.modes.paste === before.modes.paste, `marker ${await markers()} time(s); pasting in one piece: ${before.modes.paste} before, ${after.modes.paste} after`);
      check('nothing was typed into either console while the window started over (a terminal answers questions in old output)',
        (typed.get(a.id) || 0) === 0 && (typed.get(b.id) || 0) === 0, `typed: ${JSON.stringify([...typed])}`);
      check('the part that reads the files is not started again when its code did not change', after.thread === before.thread && after.thread > 0);

      // newer code for the watcher on disk: offered in the title bar; loading it starts the watcher again under the same consoles
      const touch = (name) => { const f = path.join(appDir, name); const st = fs.statSync(f); fs.utimesSync(f, new Date(), new Date(Date.now() - 10000)); return () => fs.utimesSync(f, st.atime, st.mtime); };
      const pill = () => exec('(() => { const el = document.getElementById("version"); return el.hidden ? "" : el.textContent; })()');
      const putBack = touch('watch.cjs');
      code.look(); code.look();
      const offered = await until(async () => (await pill()) === 'Load new version', 3000);
      check('newer code on disk for the window or the part that reads the files is offered in the title bar', code.now() === 'reload' && Boolean(offered), `${code.now()}; the title bar says "${await pill()}"`);
      const latestBefore = watch.latest().at;
      await exec('window.deskOld = true; document.getElementById("version").click()').catch(() => {});
      const loaded = await back();
      const newThread = watch.thread();
      const pictures = await until(async () => watch.latest().at > latestBefore + 1000 && watch.latest().at, 20000, 300);
      check('Load new version: the page and the part that reads the files are loaded again, the consoles stay, the pictures keep coming',
        Boolean(loaded) && !(await exec('window.deskOld === true')) && newThread !== before.thread && newThread > 0 && consoles() === before.consoles && Boolean(pictures) && (await pill()) === '' && code.now() === '',
        `the reader thread ${before.thread} -> ${newThread}; the title bar says "${await pill()}"`);
      putBack();
      code.look(); code.look();

      // newer code under the running chats: said, and the page does not load it
      const putBackApp = touch('replay.cjs');
      code.look(); code.look();
      const asked = await until(async () => (await pill()) === 'New version: restart', 3000);
      await exec('window.deskStay = true; Desk.reloadPage()');
      await wait(800);
      const stayed = await exec('window.deskStay === true').catch(() => false);
      const said = await toastNow();
      // (the button itself restarts the app, with the chats running on: that is the keep and kept runs)
      check('newer code under the running chats: the title bar offers a restart that keeps the chats running, and the page does not load it',
        code.now() === 'restart' && Boolean(asked) && stayed === true && /^A new version needs the app to restart: press "New version: restart" at the top\. Your chats keep running\.$/.test(said), `"${await pill()}"; "${said}"`);
      putBackApp();
      code.look(); code.look();
      check('once the files are as they were, the title bar says nothing', Boolean(await until(async () => (await pill()) === '', 3000)) && code.now() === '');

      // the page's own program dies: it comes back by itself, three times in a minute; the fourth time it is left
      const crash = async () => { await ask('window.deskOld = true').catch(() => {}); win.webContents.forcefullyCrashRenderer(); };
      let comebacks = 0;
      for (let i = 0; i < 3; i++) {
        await crash();
        if (await back()) comebacks++;
        await wait(400);
      }
      const t2 = await ticks();
      check('when the page\'s program dies it is loaded again by itself, each of three times, with the consoles untouched and where the person was',
        comebacks === 3 && consoles() === before.consoles && (await placeNow()) === before.place && whole(t2) && t2[0] === 1,
        `${comebacks} of 3 came back; ${t2.length} numbers in order: ${whole(t2)}`);
      await crash();
      await wait(2500);
      const left = win.webContents.isCrashed();
      check('a fourth death within the minute is left alone, the consoles still run', left && consoles() === before.consoles);
      await reload();
      const manual = await back();
      check('and "Reload the window" from the Lowlit icon near the clock brings it back', Boolean(manual) && !(await exec('window.deskOld === true')));
    } finally {
      chats.input = input;
      await typeIn(a.id, '\x03').catch(() => {});
      await typeIn(b.id, '\x03').catch(() => {});
    }
  };

  const winsPhase = async () => {
    check('the window loads for the made-up folder, close and disk checks', Boolean(await until(() => exec('typeof Desk === "object" && Desk !== null'), 15000)));
    if (chats.all.size) throw new Error('The wins phase needs a self-test profile with no restored chats.');
    const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'lowlit-wins-'));
    const made = [];
    const closedAt = new Map();
    const closeWas = chats.close;
    const settingsWas = settingsNow();
    let diskWatch = null;
    let junction = '';
    let pageSaved = false;
    chats.close = function (id) {
      if (made.some((c) => c.id === id) && !closedAt.has(id)) closedAt.set(id, Date.now());
      return closeWas.call(this, id);
    };
    const close = (id) => exec(`Desk.closeChat(${JSON.stringify(id)})`);
    // a chat being closed: gone from the screen and the list, and the title bar's offer to take the newest close back
    const pending = (id) => inPage((chatId) => {
      const pill = document.getElementById('undo');
      const what = pill && !pill.hidden ? pill.querySelector('.what') : null;
      return { hidden: !Desk.state.chats.some((c) => c.id === chatId) && !Terms.shown().includes(chatId)
        && !document.querySelector(`#chat-list .nav-item.chat[data-id="${chatId}"]`),
      offer: what ? what.textContent : '', keyboard: Boolean(pill && pill.contains(document.activeElement)) };
    }, id);
    // the folders here have long names: in half the window the prompt runs onto a second line
    const promptIn = async (id) => {
      const rows = (await linesOf(id)).map((l) => l.trimEnd()).filter(Boolean);
      return /PS [^>]*>$/.test(rows.slice(-3).join(''));
    };
    const shell = async (name) => {
      const cwd = path.join(fixture, name);
      fs.mkdirSync(cwd, { recursive: true });
      const chat = await inPage(pageNew, { cwd, starter: 'shell', title: name, named: true, restore: true });
      if (!chat || !chat.id) throw new Error('A made-up console did not open.');
      made.push(chat);
      if (!await until(() => promptIn(chat.id), 30000)) {
        const rows = (await linesOf(chat.id)).map((l) => l.trimEnd()).filter(Boolean);
        throw new Error(`A made-up console did not reach its prompt: ${rows.length} lines, the last ${rows.length ? rows[rows.length - 1].length : 0} letters long${chats.all.has(chat.id) ? '' : ', its console gone'}.`);
      }
      return chat;
    };
    try {
      watch.post({ type: 'pace', ms: 600000 });
      await watch.ask('stats');
      await wait(250);
      await inPage(() => {
        window.winsSaved = { snap: Desk.state.snap, settings: Desk.state.settings, res: Desk.state.res, frozen: Desk.state.frozen,
          before: new Map(Desk.state.before), unread: new Set(Desk.state.unread), local: Object.fromEntries(Object.entries(localStorage)) };
        Desk.state.frozen = true;
        Desk.state.settings = { ...Desk.state.settings, tiles: 2, split: 2, inspector: false, space: '', spaces: [], notify: {} };
        Desk.state.res = null;
        takeSnapshot({ at: Date.now(), chats: [], ended: [], leaving: [], accounts: null, plan: null, drives: [] });
        return true;
      });
      pageSaved = true;

      // A made-up git project: its main copy on one branch, a second copy on another, and a copy git still lists
      // whose folder was deleted.
      const git = path.join(fixture, 'repository');
      const child = path.join(git, 'inside');
      const copy = path.join(fixture, 'copy-one');
      const ordinary = path.join(fixture, 'ordinary');
      const own = path.join(git, '.git', 'worktrees', 'copy-one');
      const gone = path.join(git, '.git', 'worktrees', 'gone');
      for (const p of [child, copy, ordinary, own, gone]) fs.mkdirSync(p, { recursive: true });
      fs.writeFileSync(path.join(git, '.git', 'HEAD'), 'ref: refs/heads/main-line\n');
      fs.writeFileSync(path.join(own, 'HEAD'), 'ref: refs/heads/side-line\n');
      fs.writeFileSync(path.join(own, 'commondir'), '../..\n');
      fs.writeFileSync(path.join(own, 'gitdir'), `${path.join(copy, '.git').replace(/\\/g, '/')}\n`);
      fs.writeFileSync(path.join(copy, '.git'), `gitdir: ${own.replace(/\\/g, '/')}\n`);
      fs.writeFileSync(path.join(gone, 'HEAD'), 'ref: refs/heads/gone-line\n');
      fs.writeFileSync(path.join(gone, 'gitdir'), `${path.join(fixture, 'deleted-copy', '.git').replace(/\\/g, '/')}\n`);
      // A separate panel runs the panel's own code against main's own reading of the folder. Its Start button records
      // what would be asked for: no agent is started.
      const pickerSource = fs.readFileSync(path.join(__dirname, 'picker.js'), 'utf8');
      await exec(`((bridge) => {
        const host = h('div', { id: 'wins-picker', hidden: true }); document.body.append(host);
        const asks = [];
        const desk = { repository: (cwd) => bridge.repository(cwd), create: async (ask) => { asks.push(ask); return { id: 'wins-never-started' }; },
          recent: async () => ({ folders: [], chats: [] }), pickFolder: async () => '' };
        ${pickerSource}
        const info = { home: '', starter: 'claude', starters: [{ id: 'claude', name: 'Claude Code', agent: 'claude', passes: true },
          { id: 'own', name: 'own-claude', agent: 'claude', passes: false }, { id: 'codex', name: 'Codex', agent: 'codex', passes: false },
          { id: 'shell', name: 'PowerShell', agent: '', passes: false }] };
        Picker.init(host, info, () => {});
        window.winsPicker = { picker: Picker, info, host, asks };
      })(desk)`);
      const whereOf = async (cwd, starter, expected) => {
        await inPage(async (folder, chosen) => {
          const p = window.winsPicker;
          p.picker.close(); p.info.starter = chosen;
          await p.picker.open([folder]);
          return true;
        }, cwd, starter);
        const read = () => inPage(() => {
          const field = window.winsPicker.host.querySelector('.pick-where');
          return { shown: Boolean(field && !field.hidden),
            buttons: field ? [...field.querySelectorAll('.seg button')].map((b) => ({ text: b.textContent, on: b.classList.contains('on') })) : [],
            note: field ? field.querySelector('.pick-where-note').textContent : '' };
        });
        // the folder is read once the panel is open: a choice that stays away is given the time to come all the same
        if (!expected) { await wait(300); return read(); }
        return await until(async () => { const v = await read(); return v.shown ? v : null; }, 3000, 25) || read();
      };
      const texts = (v) => v.buttons.map((x) => x.text);
      const main = await whereOf(git, 'claude', true);
      const inner = await whereOf(child, 'claude', true);
      const inCopy = await whereOf(copy, 'claude', true);
      const plain = await whereOf(ordinary, 'claude', false);
      const codex = await whereOf(git, 'codex', false);
      const consoleWay = await whereOf(git, 'shell', false);
      const ownStarter = await whereOf(git, 'own', true);
      check('A1: "Where it runs" shows for a Claude Code chat in a folder in git (also below its top, and in a second copy), never outside git or for Codex or a console',
        main.shown && inner.shown && inCopy.shown && !plain.shown && !codex.shown && !consoleWay.shown
        && same(texts(main), ['This folder', 'A new copy of its own', 'Another copy (1)']) && main.buttons[0].on && main.note === 'On branch main-line'
        && same(texts(inner), texts(main)) && same(texts(inCopy), ['This copy (copy-one)', 'A new copy of its own', 'Another copy (1)'])
        && inCopy.note.startsWith('On branch side-line'),
        `${texts(main).join(' | ')} · ${main.note} · in the copy: ${texts(inCopy).join(' | ')} · ${inCopy.note}`);
      check('A1: a start command that does not hand extra words on to claude is not offered a new copy',
        same(texts(ownStarter), ['This folder', 'Another copy (1)']), texts(ownStarter).join(' | '));

      await whereOf(git, 'claude', true);
      const menu = await inPage(() => {
        const root = window.winsPicker.host;
        [...root.querySelectorAll('.pick-where .seg button')].find((b) => b.textContent.startsWith('Another copy')).click();
        const items = [...document.querySelectorAll('#menu .menu-item')];
        const listed = items.map((el) => el.textContent);
        const item = items.find((el) => el.textContent.startsWith('copy-one'));
        if (item) item.click();
        const field = root.querySelector('.pick-where');
        const on = [...field.querySelectorAll('.seg button')].find((b) => b.classList.contains('on'));
        return { listed, chosen: on ? on.textContent : '', note: field.querySelector('.pick-where-note').textContent };
      });
      await inPage(() => { window.winsPicker.host.querySelector('.btn.primary').click(); return true; });
      const copyAsk = await until(() => exec('window.winsPicker.asks[0] || null'), 3000, 25);
      check('A1: another copy is picked from a menu of the copies git lists whose folders exist, each with its branch, and the chat starts in that copy',
        same(menu.listed, ['copy-one · side-line']) && menu.chosen === 'copy-one' && menu.note.startsWith('On branch side-line · ')
        && Boolean(copyAsk && copyAsk.cwd === copy && copyAsk.worktree === undefined),
        `menu: ${menu.listed.join(' / ')}; chosen "${menu.chosen}"; started in the copy: ${Boolean(copyAsk && copyAsk.cwd === copy)}`);

      await whereOf(git, 'claude', true);
      await inPage(() => {
        const root = window.winsPicker.host;
        [...root.querySelectorAll('.pick-where .seg button')].find((b) => b.textContent === 'A new copy of its own').click();
        root.querySelector('.btn.primary').click();
        return true;
      });
      const newAsk = await until(() => exec('window.winsPicker.asks[1] || null'), 3000, 25);
      const planned = newAsk && planChat(newAsk);
      const reopened = await whereOf(git, 'claude', true);
      check('A1: a new copy reaches main as one fixed switch, taken only for a new Claude Code chat in git; the panel opens on "This folder" again',
        Boolean(newAsk && newAsk.worktree === true && newAsk.cwd === git && planned && !planned.error)
        && (planned.command.match(/(?:^|\s)--worktree(?=\s|$)/g) || []).length === 1
        && Boolean(planChat({ starter: 'claude', cwd: git, worktree: '--worktree; anything' }).error)
        && Boolean(planChat({ starter: 'shell', cwd: git, worktree: true }).error)
        && Boolean(planChat({ starter: 'claude', cwd: ordinary, worktree: true }).error)
        && Boolean(reopened.buttons[0] && reopened.buttons[0].on),
        planned ? `command: ${planned.command || planned.error}` : 'nothing asked');
      await exec('window.winsPicker.picker.close(); window.winsPicker.host.remove(); delete window.winsPicker; true');

      const a = await shell('Wins first');
      const b = await shell('Wins second');
      const c = await shell('Wins third');
      await view(a.id);
      const order = await inPage(pageSide);
      const before = await inPage((id) => {
        window.winsTerm = Terms.get(id).term;
        return { shown: Desk.state.shown.slice(), recent: Desk.state.recent.slice(), view: Desk.state.view, top: document.getElementById('tiles').getBoundingClientRect().top };
      }, a.id);
      chats.input(a.id, "Start-Sleep -Milliseconds 700; Write-Output ('WINS-' + 'HELD-LINE')\r");
      await close(a.id);
      const hidden = await pending(a.id);
      const programHeld = alive(a.pid);
      const printed = await until(async () => (await linesOf(a.id)).filter((l) => l.trim() === 'WINS-HELD-LINE').length === 1, 3000, 50);
      const offerPlace = await inPage(() => {
        const pill = document.getElementById('undo').getBoundingClientRect();
        const bar = document.getElementById('bar').getBoundingClientRect();
        return { inBar: pill.width > 0 && pill.top >= bar.top && pill.bottom <= bar.bottom, top: document.getElementById('tiles').getBoundingClientRect().top };
      });
      await exec("window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Z', code: 'KeyZ', ctrlKey: true, shiftKey: true, bubbles: true })), true");
      await until(async () => (await inPage(pageSide)).some((x) => x.id === a.id), 3000, 25);
      await wait(120);
      const after = await inPage((id) => ({ shown: Desk.state.shown.slice(), recent: Desk.state.recent.slice(), view: Desk.state.view,
        sameTerminal: Terms.get(id).term === window.winsTerm, offer: !document.getElementById('undo').hidden }), a.id);
      const afterOrder = await inPage(pageSide);
      const restored = chats.all.get(a.id);
      check('B1: a close hides the chat and its row at once and keeps its console; the title bar offers Undo, nothing below it moves, the keyboard stays put',
        hidden.hidden && hidden.offer === 'Wins first' && !hidden.keyboard && programHeld && offerPlace.inBar && offerPlace.top === before.top,
        `offer "${hidden.offer}", in the title bar: ${offerPlace.inBar}, chats moved by ${offerPlace.top - before.top} px`);
      check('B1: Ctrl+Shift+Z brings it back in its place, with the same console and terminal, and the line printed meanwhile shows once',
        Boolean(printed) && same(order.map((x) => x.id), afterOrder.map((x) => x.id)) && same(before.shown, after.shown)
        && same(before.recent, after.recent) && before.view === after.view && after.sameTerminal && !after.offer
        && Boolean(restored && restored.pid === a.pid && alive(a.pid)) && (await linesOf(a.id)).filter((l) => l.trim() === 'WINS-HELD-LINE').length === 1);

      const inactiveBefore = await inPage((first, second, third) => {
        Desk.state.shown = [first, second, third]; Desk.setView(second);
        return { shown: Desk.state.shown.slice(), view: Desk.state.view };
      }, a.id, b.id, c.id);
      await close(a.id);
      const replacement = await exec('Desk.state.shown.slice(0, 2)');
      await exec("document.getElementById('undo').click(), true");
      await until(async () => (await exec('Desk.state.shown.slice()')).includes(a.id), 3000, 25);
      await wait(120);
      const inactiveAfter = await exec('({ shown: Desk.state.shown.slice(), view: Desk.state.view })');
      check('B1: the Undo button puts a chat that was not in front back in its own tile, after another chat filled the gap',
        same(replacement, [c.id, b.id]) && same(inactiveBefore.shown, inactiveAfter.shown) && inactiveAfter.view === inactiveBefore.view
        && (await exec(`Terms.get(${JSON.stringify(a.id)}).term === window.winsTerm`)));

      const singleAt = Date.now();
      await close(c.id);
      await wait(Math.max(0, singleAt + 4500 - Date.now()));
      const beforeEnd = alive(c.pid) && (await pending(c.id)).offer === 'Wins third' && !closedAt.has(c.id);
      const ended = await until(async () => !alive(c.pid) && !(await pending(c.id)).offer, 4000, 50);
      check('B2: the console and the offer last five seconds, then the usual close ends the console',
        beforeEnd && Boolean(ended) && closedAt.has(c.id) && closedAt.get(c.id) - singleAt >= 4900 && closedAt.get(c.id) - singleAt < 6500,
        closedAt.has(c.id) ? `close requested after ${closedAt.get(c.id) - singleAt} ms` : 'the close was not requested');

      const firstAt = Date.now();
      await close(a.id);
      await wait(1000);
      const secondAt = Date.now();
      await close(b.id);
      const newest = (await pending(b.id)).offer === 'Wins second';
      await wait(Math.max(0, firstAt + 4500 - Date.now()));
      const bothHeld = alive(a.pid) && alive(b.pid) && !closedAt.has(a.id) && !closedAt.has(b.id);
      await until(async () => closedAt.has(a.id), 2500, 20);
      const secondHeld = alive(b.pid) && !closedAt.has(b.id) && (await pending(b.id)).offer === 'Wins second';
      const bothEnded = await until(async () => !alive(a.pid) && !alive(b.pid) && !(await pending(b.id)).offer, 4000, 50);
      check('B3: closes a second apart each get their own five seconds, the offer names the newest, and the last chat closes too',
        newest && bothHeld && secondHeld && Boolean(bothEnded) && closedAt.get(a.id) - firstAt >= 4900 && closedAt.get(a.id) - firstAt < 6500
        && closedAt.get(b.id) - secondAt >= 4900 && closedAt.get(b.id) - secondAt < 6500 && closedAt.get(b.id) - closedAt.get(a.id) >= 800
        && (await exec('Desk.state.view')) === 'peek');

      const temp = path.join(fixture, 'temp');
      const older = path.join(fixture, 'older-temp');
      const home = path.join(fixture, 'home');
      const local = path.join(fixture, 'local');
      const target = path.join(fixture, 'behind-junction');
      for (const p of [temp, older, home, local, target]) fs.mkdirSync(p, { recursive: true });
      fs.writeFileSync(path.join(target, 'excluded.bin'), Buffer.alloc(4 * 1048576));
      let spaceCalls = 0;
      diskWatch = new Watch({ home, localAppData: local, counting: false, measure: false,
        disk: { tempRoots: [temp, older], statfs: async () => { spaceCalls++; return { bavail: Math.round(2.1 * 1073741824), bsize: 1 }; } } });
      const { Follower } = require('./transcript.cjs');
      // the fourth session has no working folder at all
      const expected = [3, 2, 1, 0].map((n) => n * 1048576);
      const fakeNames = ['Wins Birch', 'Wins Cedar', 'Wins Ash', 'Wins Elm'];
      const sessionIds = ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', '33333333-3333-4333-8333-333333333333',
        '44444444-4444-4444-8444-444444444444'];
      const working = [];
      for (let i = 0; i < sessionIds.length; i++) {
        const id = sessionIds[i];
        const cwd = path.join(fixture, `disk-project-${i + 1}`);
        const slug = cwd.replace(/[^A-Za-z0-9]/g, '-');
        const folder = path.join(i === 1 ? older : temp, 'claude', slug, id);
        const transcript = path.join(home, '.claude', 'projects', slug, `${id}.jsonl`);
        fs.mkdirSync(path.dirname(transcript), { recursive: true });
        if (expected[i]) {
          fs.mkdirSync(folder, { recursive: true });
          fs.writeFileSync(path.join(folder, 'working.bin'), Buffer.alloc(expected[i]));
        }
        fs.writeFileSync(transcript, ' '.repeat(310 * 1024));
        working.push(folder);
        const count = diskWatch.countFor(transcript);
        count.size = fs.statSync(transcript).size;
        diskWatch.sessions.set(id, { id, pid: 91000 + i, rec: { cwd, name: fakeNames[i], nameSource: 'user', status: 'idle', statusUpdatedAt: Date.now() },
          file: transcript, count, follow: new Follower(transcript), agents: { all: new Map(), pulse() {}, view: () => ({ total: 0, running: 0, list: [] }) }, note: null });
      }
      junction = path.join(working[0], 'junction');
      fs.symlinkSync(target, junction, 'junction');
      const measuredAt = Date.now();
      diskWatch.diskLook(measuredAt);
      for (let i = 0; i < 2000 && diskWatch.disk.advance(); i++) await wait(1);
      await diskWatch.disk.space(measuredAt);
      const picture = diskWatch.snapshot();
      const diskRows = sessionIds.map((id) => picture.chats.find((s) => s.key === id));
      check('C1: working files are measured in both temp folders, a junction inside is not followed, a chat with no working folder holds 0, and the conversation size is the one already counted',
        diskRows.every((s, i) => s && s.disk && s.disk.working === expected[i] && !s.disk.measuring && s.disk.conversation === 310 * 1024)
        && fs.statSync(path.join(target, 'excluded.bin')).size === 4 * 1048576,
        diskRows.map((s) => (s && s.disk ? String(s.disk.working) : 'none')).join(', '));
      const sizeBefore = diskRows[0].disk.working;
      fs.writeFileSync(path.join(working[0], 'later.bin'), Buffer.alloc(512));
      const first = () => diskWatch.disk.view(diskWatch.sessions.get(sessionIds[0]));
      diskWatch.diskLook(measuredAt + 299999);
      const notAgain = first().working === sizeBefore && !diskWatch.disk.queue.length;
      diskWatch.diskLook(measuredAt + 300001);
      const during = first();
      for (let i = 0; i < 2000 && diskWatch.disk.advance(); i++) await wait(1);
      const later = first();
      check('C1: a session is measured again only after five minutes, and its last figure stands while it is',
        notAgain && during.working === sizeBefore && !during.measuring && later.working === sizeBefore + 512,
        `while measuring again: ${during.working}; after: ${later.working}`);
      await inPage((snap, id) => { takeSnapshot({ ...snap, drives: [] }); Desk.look({ kind: 'live', key: id }); Desk.Peek.detail().setTab('numbers'); return true; }, picture, sessionIds[0]);
      const diskText = await inPage((folder) => {
        const held = [...document.querySelectorAll('#peek .d-body .disk-amount')][0];
        return { text: held ? held.textContent : '', folder: Boolean(held && (held.dataset.tip || '').includes(folder)) };
      }, working[0]);
      check('C1: the session\'s numbers say what it holds on disk, with its working folder in the hover note',
        diskText.text === 'On disk: 3.0 MB of working files and a 310 KB conversation.' && diskText.folder, diskText.text);
      const drive = picture.drives.find((d) => d.low);
      const firstSpaceCalls = spaceCalls;
      await diskWatch.disk.space(measuredAt + 59999);
      const rounded = Math.round(Math.round(2.1 * 1073741824) / (100 * 1048576)) * 100 * 1048576;
      check('C2: free space is read at most once a minute for each drive that holds chats\' files, and handed on to the nearest 100 MB',
        Boolean(drive) && drive.free === rounded && firstSpaceCalls === picture.drives.length && spaceCalls === firstSpaceCalls);
      // this copy of the shared note code keeps its own memory of what was dismissed; the saved value is put back after
      const uiSource = fs.readFileSync(path.join(__dirname, 'ui.js'), 'utf8');
      await exec(`(() => { ${uiSource}
        const host = h('div', { id: 'wins-disk-notes' }); document.getElementById('notes').append(host);
        window.winsDiskNotes = { update: DiskNotes.update, host };
      })()`);
      const warning = await inPage((snap, volume, ids) => {
        localStorage.removeItem(`desk.disk-dismiss:${volume}`);
        const root = window.winsDiskNotes.host;
        window.winsDiskNotes.update(root, { ...Desk.state, snap });
        const note = [...root.querySelectorAll('.disk-note')].find((el) => el.dataset.drive === volume);
        const names = ids.slice(0, 2).map((id) => (document.querySelector(`#chat-list .nav-item.chat[data-key="${id}"] .label`) || {}).textContent || '');
        const text = note ? note.textContent : '';
        const focused = Boolean(note && note.contains(document.activeElement));
        const button = note && note.querySelector('button');
        if (button) button.click();
        window.winsDiskNotes.update(root, { ...Desk.state, snap });
        return { text, names, focused, gone: ![...root.querySelectorAll('.disk-note')].some((el) => el.dataset.drive === volume) };
      }, picture, drive ? drive.drive : '', sessionIds);
      check('C2: a drive nearly full is said at the top with the two chats holding the most there, as named in the list, and can be dismissed for the day without taking the keyboard',
        warning.names[0] === fakeNames[0] && warning.names[1] === fakeNames[1]
        && warning.text.includes(`Drive ${drive && drive.drive} has 2.1 GB left. Working files of chats, the most: Wins Birch 3.0 MB, Wins Cedar 2.0 MB. Claude Code keeps them after a chat ends.`)
        && !warning.text.includes(fakeNames[2]) && !warning.focused && warning.gone, warning.text);
    } finally {
      if (diskWatch) diskWatch.disk.close();
      for (const chat of made) if (chats.all.has(chat.id)) await closeWas.call(chats, chat.id);
      await until(async () => made.every((c) => !alive(c.pid) && !chats.all.has(c.id)), 12000, 100);
      chats.close = closeWas;
      if (pageSaved) {
        await inPage(() => {
          if (window.winsPicker) { window.winsPicker.picker.close(); window.winsPicker.host.remove(); delete window.winsPicker; }
          if (window.winsDiskNotes) { window.winsDiskNotes.host.remove(); delete window.winsDiskNotes; }
          const was = window.winsSaved;
          Desk.look(null); Desk.setView('peek');
          Desk.state.settings = was.settings; Desk.state.res = was.res; Desk.state.frozen = was.frozen;
          takeSnapshot(was.snap);
          Desk.state.before = was.before; Desk.state.unread = was.unread;
          for (const key of Object.keys(localStorage)) if (!Object.hasOwn(was.local, key)) localStorage.removeItem(key);
          for (const [key, value] of Object.entries(was.local)) localStorage.setItem(key, value);
          delete window.winsTerm; delete window.winsSaved;
          paint();
          return true;
        });
        await exec(`desk.settings(${JSON.stringify({ tiles: settingsWas.tiles, split: settingsWas.split, inspector: settingsWas.inspector, notify: settingsWas.notify })})`);
      }
      watch.post({ type: 'pace', ms: 2000 });
      const base = path.resolve(os.tmpdir()) + path.sep;
      if (!path.resolve(fixture).startsWith(base) || !path.basename(fixture).startsWith('lowlit-wins-')) throw new Error('The made-up folder was outside its cleanup boundary.');
      // Electron's own remove-everything stops without a word at a junction, and leaves what comes after it: the
      // junction goes first
      if (junction) try { fs.unlinkSync(junction); } catch { /* never made */ }
      // a console that just ended can hold its folder for a moment longer
      for (let i = 0; i < 4 && fs.existsSync(fixture); i++) {
        if (i) await wait(400);
        try { fs.rmSync(fixture, { recursive: true, force: true }); } catch { /* tried again */ }
      }
      const leftOnPage = !pageSaved ? [] : await inPage(() => Object.entries({
        saved: Boolean(window.winsSaved), picker: Boolean(window.winsPicker || document.getElementById('wins-picker')),
        notes: Boolean(window.winsDiskNotes || document.getElementById('wins-disk-notes')), terminal: Boolean(window.winsTerm),
        undo: !document.getElementById('undo').hidden,
      }).filter(([, left]) => left).map(([name]) => name));
      const consolesLeft = made.filter((c) => alive(c.pid) || chats.all.has(c.id)).length;
      const walksLeft = diskWatch ? diskWatch.disk.queue.length + diskWatch.disk.all.size : 0;
      check('D: the phase leaves no made-up consoles, held closes, folder walks, panels or folders behind',
        !consolesLeft && !leftOnPage.length && !fs.existsSync(fixture) && !chats.closes.size && !walksLeft,
        `consoles ${consolesLeft}, on the page: ${leftOnPage.join(' ') || 'nothing'}, folder left ${fs.existsSync(fixture)}, held closes ${chats.closes.size}, walks ${walksLeft}`);
    }
  };

  const pathPhase = async () => {
    const root = fs.mkdtempSync(path.join(dir, 'path-shop-'));
    const cart = path.join(root, 'src', 'cart.js');
    const editor = path.join(root, 'editor', 'Cursor.exe');
    let chat = null;
    let installed = false;
    const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    const probe = (text, ctrl) => inPage(async (wanted, held) => {
      const t = term;
      const buf = t.buffer.active;
      for (let first = 0; first < buf.length; first++) {
        if (buf.getLine(first).isWrapped) continue;
        let last = first;
        let text = buf.getLine(first).translateToString(false);
        while (buf.getLine(last + 1) && buf.getLine(last + 1).isWrapped) text += buf.getLine(++last).translateToString(false);
        if (text.trim() !== wanted) continue;
        const provider = window.deskPathTest.providers.find((p) => p.term === t && p.number === 1).provider;
        const found = new Map();
        for (let row = first; row <= last; row++) {
          const links = await new Promise((done) => provider.provideLinks(row + 1, done));
          for (const link of links || []) found.set(JSON.stringify(link.range), link);
        }
        const links = [...found.values()];
        if (held !== undefined && links.length === 1) await links[0].activate({ ctrlKey: held }, links[0].text);
        return links.map((link) => {
          const { start, end } = link.range;
          let span = '';
          for (let row = start.y; row <= end.y; row++) {
            span += buf.getLine(row - 1).translateToString(false, row === start.y ? start.x - 1 : 0, row === end.y ? end.x : t.cols);
          }
          return { text: link.text, span };
        });
      }
      return null;
    }, text, ctrl);
    const printed = async (text) => {
      const data = Buffer.from(text, 'utf8').toString('base64');
      await inPage((id, command) => desk.input(id, command), chat.id,
        `Write-Output ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${data}')))\r`);
      const found = await until(() => probe(text), 10000);
      if (found === null) throw new Error('The made-up console did not print its path sample.');
      return found;
    };
    const started = (file, line, column) => {
      const records = pathTest.records();
      return same(records, [{ exe: editor, args: ['--goto', line ? `${file}:${line}:${column || 1}` : file] }]);
    };
    try {
      if (!pathTest) throw new Error('The path phase needs a hidden run.');
      fs.mkdirSync(path.dirname(cart), { recursive: true });
      fs.mkdirSync(path.dirname(editor), { recursive: true });
      for (const file of [cart, editor, path.join(root, 'src', 'cart item.js'), path.join(root, 'name.js')]) fs.writeFileSync(file, '');
      pathTest.setEditor(editor);
      check('the window loads', Boolean(await until(() => exec('typeof Desk === "object" && Desk !== null'), 15000)));
      await inPage(() => {
        window.deskPathTest = { register: Terminal.prototype.registerLinkProvider, providers: [] };
        Terminal.prototype.registerLinkProvider = function (provider) {
          const saved = window.deskPathTest;
          const number = saved.providers.filter((p) => p.term === this).length;
          saved.providers.push({ term: this, provider, number });
          return saved.register.call(this, provider);
        };
      });
      installed = true;
      chat = await inPage(pageNew, { cwd: root, starter: 'shell', restore: true });
      if (!check('a plain console opens in the made-up shop', Boolean(chat && chat.id) && Boolean(await until(promptBack, 30000)))) throw new Error('No made-up console.');
      let found = await printed('src/cart.js:42:7');
      check('the path link covers exactly src/cart.js:42:7', same(found, [{ text: 'src/cart.js:42:7', span: 'src/cart.js:42:7' }]));
      pathTest.clear();
      await probe('src/cart.js:42:7', false);
      check('a plain click says to hold Ctrl and starts nothing', pathTest.records().length === 0 && (await toastNow()) === 'Hold Ctrl and click to open the file.');
      await probe('src/cart.js:42:7', true);
      check('Ctrl click records one direct editor start at line 42 column 7', started(cart, 42, 7));
      found = await printed('src/missing.js ./src');
      check('a missing file and a folder offer no link', found.length === 0);
      const samples = [
        [`"${cart}"`, cart, undefined, undefined, cart],
        [`"${cart.replace(/\\/g, '/')}"`, cart, undefined, undefined, cart.replace(/\\/g, '/')],
        ['"src/cart item.js"', path.join(root, 'src', 'cart item.js'), undefined, undefined, 'src/cart item.js'],
        ['src/cart.js.', cart, undefined, undefined, 'src/cart.js'],
        ['name.js(12,3)', path.join(root, 'name.js'), 12, 3, 'name.js(12,3)'],
        ['`src/cart.js:9`', cart, 9, 1, 'src/cart.js:9'],
      ];
      for (const [text, file, line, column, label] of samples) {
        found = await printed(text);
        pathTest.clear();
        await probe(text, true);
        check('a path spelling has one exact link and the right editor argument', same(found, [{ text: label, span: label }]) && started(file, line, column),
          line ? `made-up file, line ${line}, column ${column}` : 'made-up file, no line');
      }
      for (const mark of ['&', '%', '^', ';']) {
        const name = `part${mark}piece.js`;
        const file = path.join(root, name);
        fs.writeFileSync(file, '');
        found = await printed(`"${name}"`);
        pathTest.clear();
        await probe(`"${name}"`, true);
        check('a punctuation-bearing name stays one unchanged argument', found.length === 1 && started(file), name);
      }
      for (const name of ['[page].js', '{page}.js', '(page).js', 'src/[page]', 'src/(page)']) {
        const file = path.join(root, name);
        fs.writeFileSync(file, '');
        found = await printed(name);
        pathTest.clear();
        await probe(name, true);
        check('balanced brackets in a file name are kept', same(found, [{ text: name, span: name }]) && started(file), name);
      }
      const quoteName = 'part"piece.js';
      let refused = false;
      try { fs.writeFileSync(path.join(root, quoteName), ''); } catch { refused = true; }
      pathTest.clear();
      const quote = await inPage((id, name) => desk.openFile(id, name), chat.id, quoteName);
      check('Windows refuses a quote in a file name and opening it starts nothing', refused && !quote.opened && pathTest.records().length === 0);
      const invalid = await inPage(async (id) => ({
        values: await desk.pathsExist(id, ['a'.repeat(521), 3, null, {}, 'src/cart.js', './src']),
        many: await desk.pathsExist(id, Array(21).fill('src/cart.js')),
      }), chat.id);
      check('file checks reject long names, non-strings, folders and an oversized batch', same(invalid.values, [false, false, false, false, true, false])
        && invalid.many.length === 21 && invalid.many.every((value) => value === false));
      pathTest.setEditor('');
      pathTest.clear();
      await probe('src/cart.js:42:7', true);
      const fallback = 'No code editor was found (Cursor, VS Code, Windsurf): the file is shown in its folder instead.';
      check('without an editor the file is shown in its folder and the page explains why', same(pathTest.records(), [{ folder: cart }]) && (await toastNow()) === fallback);
      await exec('document.getElementById("toast").hidden = true');
      await probe('src/cart.js:42:7', true);
      check('the missing-editor toast is said only once', (await toastNow()) === '' && pathTest.records().length === 2);
    } finally {
      try {
        if (installed) await inPage(() => {
          Terminal.prototype.registerLinkProvider = window.deskPathTest.register;
          delete window.deskPathTest;
          document.getElementById('toast').hidden = true;
        });
      } finally {
        if (pathTest) pathTest.restore();
        try {
          if (chat && chat.id) {
            await chats.close(chat.id);
            if (!(await until(() => !chats.all.has(chat.id), 10000))) throw new Error('The made-up console did not close.');
          }
        } finally {
          const target = path.resolve(root);
          if (!target.startsWith(path.resolve(dir) + path.sep)) throw new Error('The made-up path folder left its output directory.');
          fs.rmSync(target, { recursive: true, force: true });
        }
      }
      const clear = await until(() => inPage((id) => !window.deskPathTest && (!id || (!Terms.get(id) && !Desk.state.chats.some((c) => c.id === id))), chat && chat.id), 3000);
      check('the path phase leaves no made-up files, chat or page override behind', !fs.existsSync(root) && clear);
    }
  };

  const resetsPhase = async () => {
    const profile = process.env.DESK_PROFILE_DIR;
    if (!check('the reset checks use an explicit, separate profile', Boolean(profile)
      && path.resolve(profile).toLowerCase() === path.resolve(app.getPath('userData')).toLowerCase())) throw new Error('a test profile is required');
    if (!check('the reset checks start with no open console', chats.all.size === 0 && settingsNow().open.length === 0)) throw new Error('the test profile must have no open chats');
    if (!check('the window loads for the made-up account checks', Boolean(await until(() => exec('typeof Desk === "object" && Desk !== null && Boolean(Desk.drawn)'), 15000)))) throw new Error('no window');
    await exec('Desk.drawn');
    const HOUR = 3600e3;
    const now = new Date(2030, 0, 7, 10, 0, 0).getTime();
    const names = { 'eaaa0001': 'A', 'eaaa0002': 'B', 'eaaa0003': 'C', 'eaaa0004': 'D' };
    const reading = (used, until) => ({ used, until, at: now - 3 * HOUR });
    const list = [
      account(0, 'eaaa0001', 'alpha@example.com', { here: true, five: reading(40, now + 2 * HOUR), week: reading(70, now + 72 * HOUR) }),
      account(1, 'eaaa0002', 'beta@example.com', { five: reading(100, now + HOUR), week: { used: 50, until: now - 25 * HOUR, at: now - 26 * HOUR } }),
      account(2, 'eaaa0003', 'gamma@example.com', { week: reading(95, now - 2 * HOUR) }),
      account(3, 'eaaa0004', 'delta@example.com', {}),
    ];
    const picture = { at: now, chats: [], ended: [], leaving: [], plan: { five: list[0].five, week: list[0].week }, accounts: { current: 'eaaa0001', list, marks: [] } };
    const settingsFile = path.join(app.getPath('userData'), 'desk.json');
    const saved = () => { try { return JSON.parse(fs.readFileSync(settingsFile, 'utf8')); } catch { return {}; } };
    const notifyWas = settingsNow().notify;
    const resetKeptWas = settingsNow().resetNoted;
    const dateNowWas = Date.now;
    const sendWas = win.webContents.send;
    const readSide = () => inPage(() => {
      const head = document.querySelector('.acct-others-toggle');
      return { head: head && head.textContent.trim(), expanded: head && head.getAttribute('aria-expanded'),
        rows: [...document.querySelectorAll('.acct-other-row')].map((el) => ({ key: el.dataset.acct, text: el.textContent.trim(), tip: el.dataset.tip || '',
          height: el.getBoundingClientRect().height, buttons: el.querySelectorAll('button,a').length })),
        kept: kept.get('side-account-fold', '{}') };
    });
    let installed = false;
    let notifyChanged = false;
    try {
      // Keep watcher pictures out of this page while made-up accounts are on screen.
      win.webContents.send = function send(channel, ...args) { if (channel !== 'desk:snapshot') return sendWas.call(this, channel, ...args); };
      await wait(200);
      installed = true;
      await inPage((at, aliases, usage) => {
        const st = Desk.state;
        window.deskResetCheck = { now: at, dateNow: Date.now, take: takeSnapshot, storage: localStorage.getItem('desk.side-account-fold'),
          expanded: (document.querySelector('.acct-others-toggle') || {}).getAttribute?.('aria-expanded') === 'true',
          state: { snap: st.snap, usage: st.usage, range: st.range, frozen: st.frozen, settings: st.settings, res: st.res, view: st.view, sel: st.sel,
            selLeaving: st.selLeaving, before: st.before, unread: new Set(st.unread), armed: new Set(st.armed), armedAs: new Map(st.armedAs), resumed: new Map(st.resumed), stale: st.stale } };
        Date.now = () => window.deskResetCheck.now;
        Object.assign(st, { frozen: true, usage, range: usage.range, res: null, sel: null, selLeaving: '', armed: new Set(), armedAs: new Map(), resumed: new Map(),
          settings: { ...st.settings, accountNames: aliases } });
      }, now, names, madeUpUsage('today'));
      if (!await until(() => exec('!usageBusy'), 5000, 100)) throw new Error('the earlier usage request did not finish');
      await inPage((snap, usage) => { Desk.state.usage = usage; takeSnapshot(snap); Desk.setView('peek'); paint(); }, picture, madeUpUsage('today'));
      const folded = await readSide();
      check('the other accounts start folded and name the next account reset', folded.expanded === 'false' && folded.head === '3 other accounts · next back in 1h', folded.head || 'no fold line');
      await exec('document.querySelector(".acct-others-toggle").click()');
      await wait(260);
      const side = await readSide();
      check('other accounts show room first, the blocked account next, and an unseen account last', side.expanded === 'true'
        && same(side.rows.map((r) => r.key), ['eaaa0003', 'eaaa0002', 'eaaa0004'])
        && side.rows[0].text.includes('C') && side.rows[0].text.includes('room now')
        && side.rows[1].text.includes('B') && side.rows[1].text.includes('5h 100% · back in 1h')
        && side.rows[2].text.includes('D') && side.rows[2].text.includes('not seen yet'), side.rows.map((r) => r.text).join(' / '));
      check('the account whose week ended says when it reset in its hover note', side.rows[0] && /Its weekly limit has reset since:/.test(side.rows[0].tip));
      check('the unfolded account lines are 20 pixels and contain no account action', side.rows.length === 3 && side.rows.every((r) => Math.abs(r.height - 20) < 0.1 && r.buttons === 0));
      await inPage((snap) => { takeSnapshot({ ...snap, at: snap.at + 1 }); }, picture);
      const remembered = await exec('!foldGroups("side-account-fold", () => {}, ["others"]).folded("others")');
      check('unfolding is kept across a redraw and read back by the list fold helper', JSON.parse(side.kept).others === false
        && (await readSide()).expanded === 'true' && remembered === true);
      await view('stats');
      await drawn();
      const resets = await inPage(() => ({ heading: [...document.querySelectorAll('#stats h3')].some((el) => el.textContent === 'When your limits reset'),
        rows: [...document.querySelectorAll('#stats .acct-reset-row')].map((el) => ({ key: el.dataset.acct, kind: el.dataset.limit,
          past: el.classList.contains('acct-reset-past'), text: el.textContent, countdown: Boolean(el.querySelector('[data-left]')) })) }));
      const future = resets.rows.filter((r) => !r.past);
      const past = resets.rows.filter((r) => r.past);
      check('the Dashboard lists future resets in time order and the account in use is marked', resets.heading
        && same(future.map((r) => [r.key, r.kind]), [['eaaa0002', 'five'], ['eaaa0001', 'five'], ['eaaa0001', 'week']])
        && future.every((r) => r.countdown) && future[0].text.includes('100%') && future[1].text.includes('40%') && future[2].text.includes('70%')
        && future.filter((r) => r.key === 'eaaa0001').every((r) => /in use/.test(r.text)), future.map((r) => r.text).join(' / '));
      check('the Dashboard puts a week reset in the last day below future resets and leaves out older ones', past.length === 1
        && past[0].key === 'eaaa0003' && past[0].kind === 'week' && /Reset at \d{2}:\d{2}/.test(past[0].text)
        && past[0].text.includes('95%') && resets.rows[resets.rows.length - 1] === past[0], past.map((r) => r.text).join(' / '));
      await inPage((at, snap) => { window.deskResetCheck.now = at; takeSnapshot({ ...snap, at }); }, now + HOUR + 1, picture);
      const back = await readSide();
      check('the fold line and account line change when the reset passes', back.head === '3 other accounts · all have room'
        && back.rows.some((r) => r.key === 'eaaa0002' && r.text.includes('room now')), back.head || 'no fold line');

      const initial = resetNotes({ picture, now, first: true, names });
      check('starting the reset check does not announce a window already over', initial.notes.length === 0);
      const returned = resetNotes({ picture, now: now + HOUR + 1, kept: initial.kept, names });
      const time = new Date(now + HOUR).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
      check('the first picture past the full five-hour reset asks for exactly one named note', returned.notes.length === 1
        && returned.notes[0].title === 'B has room again' && returned.notes[0].body === 'Its 5-hour limit reset at ' + time + '.'
        && returned.notes[0].target === 'stats', JSON.stringify(returned.notes));
      const again = resetNotes({ picture, now: now + HOUR + 2, kept: returned.kept, names });
      const restarted = JSON.parse(JSON.stringify({ resetNoted: returned.kept }));
      const afterLoad = resetNotes({ picture, now: now + HOUR + 3, kept: restarted.resetNoted, names });
      const afterStart = resetNotes({ picture, now: now + HOUR + 3, kept: restarted.resetNoted, first: true, names });
      const afterNext = resetNotes({ picture, now: now + HOUR + 4, kept: afterStart.kept, names });
      check('a repeated picture and a restarted check with its kept record ask for no second note', again.notes.length === 0
        && afterLoad.notes.length === 0 && afterStart.notes.length === 0 && afterNext.notes.length === 0 && returned.kept.includes('eaaa0002|five|' + (now + HOUR)));
      const low = resetNotes({ picture, now: now + 2 * HOUR + 1, kept: returned.kept, names });
      check('the five-hour limit last seen at 40 percent makes no note when it resets', low.notes.length === 0);
      const busyPicture = { ...picture, chats: [{ key: 'reset-working', state: 'working', provider: 'claude' }],
        accounts: { ...picture.accounts, list: list.map((a) => a.here ? { ...a, five: reading(95, now + 2 * HOUR) } : a) } };
      const busy = resetNotes({ picture: busyPicture, now: now + 2 * HOUR + 1, kept: returned.kept, names });
      const idle = resetNotes({ picture: { ...busyPicture, chats: [] }, now: now + 2 * HOUR + 2, kept: busy.kept, names });
      check('the account in use stays quiet while a Claude chat works and does not repeat the skipped note later', busy.notes.length === 0 && idle.notes.length === 0);
      const previous = Array.from({ length: 55 }, (_, i) => 'ebbb' + i.toString(16).padStart(4, '0') + '|five|' + (now - (60 - i) * HOUR));
      const capped = resetNotes({ picture: { ...picture, accounts: { current: '', list: [], marks: [] } }, now, kept: previous, names });
      check('the kept reset record holds the newest fifty windows', capped.kept.length === 50 && same(capped.kept, previous.slice(-50)));
      const together = { ...picture, accounts: { ...picture.accounts, list: list.map((a) => a.key === 'eaaa0003'
        ? { ...a, week: reading(95, now + HOUR) } : a) } };
      const one = resetNotes({ picture: together, now: now + HOUR, names });
      const newer = { ...together, accounts: { ...together.accounts, list: together.accounts.list.map((a) => a.key === 'eaaa0003'
        ? { ...a, week: reading(5, now + 7 * 24 * HOUR) } : a) } };
      const held = resetNotes({ picture: newer, now: now + HOUR + 1, names, kept: one.kept, after: one.after, waiting: one.waiting });
      const two = resetNotes({ picture: newer, now: one.after, names, kept: held.kept, after: one.after, waiting: held.waiting });
      const finished = resetNotes({ picture: together, now: two.after, names, kept: two.kept, after: two.after });
      check('simultaneous resets take turns even after a newer reading and are each remembered once', one.notes.length === 1
        && one.notes[0].title === 'B has room again' && one.kept.length === 1 && held.notes.length === 0 && same(held.kept, one.kept)
        && two.notes.length === 1 && two.notes[0].title === 'C has room again' && /weekly limit reset/.test(two.notes[0].body)
        && two.kept.length === 2 && finished.notes.length === 0);
      check('checking invented notes leaves the main clock and kept settings unchanged', Date.now === dateNowWas && same(settingsNow().resetNoted, resetKeptWas));

      await exec('Settings.open()');
      const label = 'When one of your accounts has room again';
      const switchState = await inPage((text) => {
        const row = [...document.querySelectorAll('#settings .set-row')].find((el) => el.querySelector('.what > div')?.textContent === text);
        return { found: Boolean(row), on: Boolean(row && row.querySelector('.switch.on')) };
      }, label);
      check('Settings has the account reset switch and it starts on', switchState.found && switchState.on && settingsNow().notify.resets === true);
      if (switchState.found && switchState.on) {
        notifyChanged = true;
        await inPage((text) => { [...document.querySelectorAll('#settings .set-row')].find((el) => el.querySelector('.what > div')?.textContent === text).click(); }, label);
        const written = await until(async () => saved().notify && saved().notify.resets === false && settingsNow().notify.resets === false, 4000, 100);
        const off = resetNotes({ picture, now: now + HOUR + 1, kept: initial.kept, notify: settingsNow().notify.resets, names });
        check('turning off account reset notes is kept in the test profile and asks for no note', Boolean(written) && off.notes.length === 0);
      }
    } finally {
      try {
        if (notifyChanged) {
          await inPage(async (notify) => { await desk.settings({ notify }); }, notifyWas);
          check('the note settings are restored in the test profile', Boolean(await until(async () => same(saved().notify, notifyWas), 4000, 100)));
        }
      } finally {
        try {
          if (installed) {
            await inPage(() => {
              const saved = window.deskResetCheck;
              if (!saved) return;
              try {
                Settings.close();
                const head = document.querySelector('.acct-others-toggle');
                if (head && (head.getAttribute('aria-expanded') === 'true') !== saved.expanded) head.click();
                if (saved.storage === null) localStorage.removeItem('desk.side-account-fold');
                else localStorage.setItem('desk.side-account-fold', saved.storage);
              } finally {
                Date.now = saved.dateNow;
                takeSnapshot = saved.take;
                Object.assign(Desk.state, saved.state);
                delete window.deskResetCheck;
                Stats.reset();
                Desk.setView(saved.state.view);
                paint();
              }
            });
            check('the invented accounts and clock hooks are removed', await inPage((keys) => !window.deskResetCheck
              && !(Desk.state.snap.accounts?.list || []).some((a) => keys.includes(a.key)), list.map((a) => a.key)));
          }
        } finally {
          win.webContents.send = sendWas;
        }
      }
    }
  };

  const glancePhase = async () => {
    check('the window loads for the made-up glance checks', Boolean(await until(() => exec('typeof Desk === "object" && Desk !== null && Boolean(Desk.Glance)'), 15000)));
    watch.post({ type: 'pace', ms: 600000 });
    await wait(700);
    const root = fs.mkdtempSync(path.join(dir, 'glance-'));
    const home = path.join(root, 'home');
    const main = path.join(root, 'demo-main');
    const copy = path.join(root, 'demo-copy');
    const outside = path.join(root, 'demo-outside');
    const gitdir = path.join(main, '.git', 'worktrees', 'copy-a');
    const sessions = path.join(home, '.claude', 'sessions');
    const keys = ['11111111-2222-4333-8444-666666666661', '11111111-2222-4333-8444-666666666662',
      '11111111-2222-4333-8444-666666666663', '11111111-2222-4333-8444-666666666664'];
    const chat = 'glance-made-up-chat';
    let local = null;
    let installed = false;
    let tick = Date.now() - 10000;
    const stamp = () => new Date(++tick).toISOString();
    const called = (cwd, id, name, input) => ({ type: 'assistant', timestamp: stamp(), cwd,
      message: { role: 'assistant', model: 'claude-opus-5-5', usage: { input_tokens: 12000 }, content: [{ type: 'tool_use', id, name, input }] } });
    const asked = (cwd, text) => ({ type: 'user', timestamp: stamp(), cwd, message: { role: 'user', content: text } });
    const writeRows = (file, rows) => fs.writeFileSync(file, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
    const pointer = (key, type, intoCard = false) => inPage((id, event, card) => {
      const row = document.querySelector(`#chat-list [data-key="${id}"]`);
      if (!row) return false;
      const target = card ? document.querySelector('.glance-row') : document.body;
      row.dispatchEvent(new PointerEvent(event, { bubbles: true, relatedTarget: target }));
      if (card && target) target.dispatchEvent(new PointerEvent('pointerenter', { relatedTarget: row }));
      return true;
    }, key, type, intoCard);
    const shortcut = (key, code) => inPage((letter, physical) => {
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: letter, code: physical, ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true }));
    }, key, code);
    const cardNow = () => inPage(() => {
      const el = document.querySelector('.glance-card.glance-row');
      if (!el || el.hidden) return null;
      const r = el.getBoundingClientRect();
      const side = document.getElementById('chat-list').getBoundingClientRect();
      return { text: el.textContent, plan: el.querySelector('.glance-plan')?.textContent || '', agents: el.querySelector('.glance-agents')?.textContent || '',
        warning: el.querySelector('.glance-copy-warning')?.textContent || '', fits: r.width > 0 && r.left >= side.right - 1 && r.right <= innerWidth + 1 && r.top >= 0 && r.bottom <= innerHeight + 1 };
    });
    try {
      for (const folder of [main, copy, outside, gitdir, sessions]) fs.mkdirSync(folder, { recursive: true });
      // A run directory inside a real repository must not lend that repository to these fixtures.
      fs.writeFileSync(path.join(root, '.git'), 'not a repository\n');
      fs.writeFileSync(path.join(main, '.git', 'HEAD'), 'ref: refs/heads/demo-branch\n');
      fs.writeFileSync(path.join(copy, '.git'), `gitdir: ${gitdir.replace(/\\/g, '/')}\n`);
      fs.writeFileSync(path.join(gitdir, 'HEAD'), 'ref: refs/heads/copy-branch\n');
      const folders = [main, copy, outside];
      const pids = [process.pid, win.webContents.getOSProcessId(), process.ppid];
      const names = ['glance-main', 'glance-api', 'glance-outside'];
      const todos = Array.from({ length: 35 }, (_, i) => ({ content: `Made-up step ${i + 1}${i === 29 ? ' with a long bounded label'.repeat(8) : ''}`,
        activeForm: `Working on made-up step ${i + 1}`, status: i < 2 ? 'completed' : i === 2 ? 'in_progress' : 'pending' }));
      const message = 'Made-up api is ready for its tests. ' + 'Only fixture words. '.repeat(6);
      for (let i = 0; i < folders.length; i++) {
        const cwd = folders[i];
        const project = path.join(home, '.claude', 'projects', cwd.replace(/[^A-Za-z0-9]/g, '-'));
        fs.mkdirSync(project, { recursive: true });
        const rows = [asked(cwd, `Check the made-up ${names[i]} folder`)];
        if (i === 1) rows.push(called(cwd, 'glance-edit', 'Edit', { file_path: path.join(cwd, 'demo.js'), old_string: 'one', new_string: 'two' }),
          called(cwd, 'glance-plan', 'TodoWrite', { todos }), called(cwd, 'glance-message', 'SendMessage', { to: 'glance-tests', message }),
          called(cwd, 'glance-agent', 'Agent', { description: 'Check the made-up API', prompt: 'Read the made-up API', subagent_type: 'explorer' }));
        writeRows(path.join(project, `${keys[i]}.jsonl`), rows);
        fs.writeFileSync(path.join(sessions, `${pids[i]}.json`), JSON.stringify({ sessionId: keys[i], cwd, name: names[i], nameSource: i === 1 ? 'derived' : 'user',
          status: i === 1 ? 'busy' : 'idle', statusUpdatedAt: ++tick, startedAt: tick - 60000,
          messagingSocketPath: 'GLANCE_FAKE_SOCKET_VALUE', bridgeSessionId: 'GLANCE_FAKE_BRIDGE_VALUE' }));
        if (i === 1) {
          const agents = path.join(project, keys[i], 'subagents');
          fs.mkdirSync(agents, { recursive: true });
          fs.writeFileSync(path.join(agents, 'agent-demoapi.meta.json'), JSON.stringify({ name: 'glance-helper', description: 'Read the made-up API', agentType: 'explorer', toolUseId: 'glance-agent' }));
          writeRows(path.join(agents, 'agent-demoapi.jsonl'), [asked(cwd, 'Read the made-up API'), called(cwd, 'glance-read', 'Read', { file_path: path.join(cwd, 'demo.js') })]);
        }
      }
      local = new Watch({ home, localAppData: path.join(root, 'local'), counting: false, measure: false });
      local.setShells([], [], [[chat, main], ['glance-empty-copy', copy], ['glance-empty-outside', outside]]);
      local.poll();
      const snap = local.snapshot();
      const mainRow = snap.chats.find((c) => c.key === keys[0]);
      const copyRow = snap.chats.find((c) => c.key === keys[1]);
      const outsideRow = snap.chats.find((c) => c.key === keys[2]);
      const atPath = (a, b) => String(a || '').replace(/\//g, '\\').toLowerCase() === String(b || '').replace(/\//g, '\\').toLowerCase();
      const gitIs = (g, top, branch, name) => g && atPath(g.top, top) && g.branch === branch && g.copy === name && atPath(g.main, main);
      check('the picture names the main copy, its worktree, and a folder outside git, including chats without sessions',
        gitIs(mainRow?.git, main, 'demo-branch', '') && gitIs(copyRow?.git, copy, 'copy-branch', 'copy-a') && outsideRow?.git === null
        && gitIs(snap.chatGit?.[chat], main, 'demo-branch', '') && gitIs(snap.chatGit?.['glance-empty-copy'], copy, 'copy-branch', 'copy-a')
        && snap.chatGit?.['glance-empty-outside'] === null, 'demo-branch; copy-branch in copy-a; outside git');
      check('plan items keep their own order and states, stop at thirty, and keep each text bounded', Boolean(copyRow) && copyRow.steps.done === 2
        && copyRow.steps.total === 35 && copyRow.steps.current === 'Made-up step 3' && copyRow.steps.items.length === 30
        && copyRow.steps.items.every((item, i) => item.text.startsWith(`Made-up step ${i + 1}`) && item.text.length <= 100
          && item.state === (i < 2 ? 'done' : i === 2 ? 'doing' : 'todo')), 'two done, one doing, twenty-seven more retained');
      const wire = JSON.stringify(snap);
      check('the reachable name and its choice come from the session file, without messaging transport details', mainRow?.peer?.name === 'glance-main' && mainRow.peer.chosen === true
        && copyRow?.peer?.name === 'glance-api' && copyRow.peer.chosen === false
        && ['messagingSocketPath', 'bridgeSessionId', 'GLANCE_FAKE_SOCKET_VALUE', 'GLANCE_FAKE_BRIDGE_VALUE'].every((word) => !wire.includes(word)));
      check('the follower reports the sent message once, with its recipient, time and first eighty characters', copyRow?.talked?.length === 1
        && copyRow.talked[0].to === 'glance-tests' && copyRow.talked[0].n === 1 && copyRow.talked[0].at > 0 && copyRow.talked[0].last === message.slice(0, 80), 'glance-tests (1)');
      if (!mainRow || !copyRow || !outsideRow) throw new Error('The made-up glance sessions did not reach the picture.');
      mainRow.chat = chat;
      // The fourth page row has the same copy as the API fixture and no work of its own.
      snap.chats.push({ ...copyRow, key: keys[3], session: keys[3], name: 'glance-tests', title: 'Made-up tests', peer: { name: 'glance-tests', chosen: true },
        state: 'idle', doing: null, files: { count: 0, names: [] }, commands: { count: 0, last: '' }, steps: { done: 0, total: 0, current: '', items: [] },
        agents: { total: 0, running: 0, list: [] }, talked: [], turn: null, chat: '' });
      installed = true;
      await inPage((s, id, folders) => {
        const st = Desk.state;
        window.deskGlanceSaved = { state: { ...st }, reader: Reader.fake, storage: sessionStorage.getItem('desk-place'),
          hidden: Object.fromEntries(['chat', 'peek', 'history', 'stats', 'overview', 'inspector'].map((key) => [key, document.getElementById(key).hidden])) };
        Reader.fake = () => ({ items: [], replies: [], orphans: {}, from: 0, to: 0, start: true });
        Object.assign(st, { chats: [{ id, cwd: folders[0], title: 'glance-main', starter: 'shell', startedAt: Date.now() - 60000 }], view: id, shown: [id], recent: [id],
          snap: s, res: null, usage: null, frozen: true, loose: false, unread: new Set(), before: new Map(), sel: null, selLeaving: '',
          armed: new Set(), armedAs: new Map(), resumed: new Map(), settings: { ...st.settings, tiles: 1, inspector: false, space: '',
            spaces: [{ id: 'glance-space-main', name: 'Made-up main', folders: [folders[0]] }, { id: 'glance-space-copy', name: 'Made-up copy', folders: [folders[1]] }] } });
        for (const key of ['peek', 'history', 'stats', 'overview', 'inspector']) document.getElementById(key).hidden = true;
        document.getElementById('chat').hidden = false;
        Terms.create(id);
        Desk.ChatView.place(st, [id]);
        Desk.paint();
      }, snap, chat, folders);
      await drawn();
      await wait(300);
      const focusBefore = await exec('document.activeElement === Terms.get("glance-made-up-chat").term.textarea');
      await pointer(keys[1], 'pointerover');
      await wait(450);
      const card = await cardNow();
      check('hovering a running row shows its glance beside the list, with its folder, branch, plan, agents and name', Boolean(card) && card.fits
        && card.text.includes(copy) && card.text.includes('copy-branch') && card.plan.includes('2 of 35') && card.agents.includes('1 working')
        && card.text.includes('glance-api') && (await exec('document.activeElement === Terms.get("glance-made-up-chat").term.textarea')) === focusBefore);
      await pointer(keys[1], 'pointerout', true);
      await wait(250);
      check('moving from the row onto its card keeps the glance open', Boolean(await cardNow()));
      await inPage(() => {
        const el = document.querySelector('.glance-row');
        if (el) el.dispatchEvent(new PointerEvent('pointerleave', { relatedTarget: document.body }));
      });
      await wait(300);
      check('leaving the row and the card hides the glance after the grace period', !(await cardNow()));
      const size = () => exec('(() => { const t = Terms.get("glance-made-up-chat").term; return [t.cols, t.rows]; })()');
      const before = await size();
      await shortcut('G', 'KeyG');
      await drawn();
      const over = await inPage((id) => {
        const tile = document.querySelector(`.tile[data-id="${id}"]`);
        const el = tile && tile.querySelector('.glance-card.glance-over');
        if (!el || el.hidden) return false;
        const card = el.getBoundingClientRect();
        const place = tile.getBoundingClientRect();
        return getComputedStyle(el).position === 'absolute' && card.width > 0 && card.width <= 381 && card.width <= place.width + 1 && card.height <= place.height * 0.7 + 1;
      }, chat);
      check('Ctrl Shift G opens the glance over the chat with no change to the terminal size', over && same(before, await size()), 'the made-up terminal keeps its columns and rows');
      await inPage(pageKey, 'Escape');
      check('Esc hides the open glance', await exec('![...document.querySelectorAll(".glance-over")].some((el) => !el.hidden)'));
      await pointer(keys[3], 'pointerover');
      await wait(450);
      const warning = await cardNow();
      check('a second session working and changing files in the same copy is named in the other chat\'s card, in words', Boolean(warning)
        && warning.warning.includes('glance-api') && warning.warning.includes('is changing files in this same copy right now'));
      await pointer(keys[3], 'pointerout');
      await wait(250);
      await shortcut('A', 'KeyA');
      await drawn();
      const overview = await inPage(() => {
        const el = document.getElementById('overview');
        const cards = [...el.querySelectorAll('.glance-short[data-key]')];
        return { on: Desk.state.view === 'overview' && !el.hidden, keys: cards.map((c) => c.dataset.key), heights: cards.map((c) => c.getBoundingClientRect().height),
          groups: [...el.querySelectorAll('.glance-group')].map((g) => ({ name: g.querySelector('h3')?.textContent, n: g.querySelectorAll('.glance-short').length })) };
      });
      check('Ctrl Shift A shows every running made-up session, grouped in workspace order with Unsorted last', overview.on && same(overview.keys.slice().sort(), keys.slice().sort())
        && same(overview.groups, [{ name: 'Made-up main', n: 1 }, { name: 'Made-up copy', n: 2 }, { name: 'Unsorted', n: 1 }]) && overview.heights.every((h) => h > 0 && h <= 190),
        overview.heights.map(Math.round).join(', ') + ' pixels high');
      const retained = await inPage(() => {
        const before = [...document.querySelectorAll('#overview .glance-short')];
        const contents = before.map((el) => el.firstElementChild);
        Desk.state.snap = { ...Desk.state.snap, at: Desk.state.snap.at + 1 };
        Desk.paint();
        const after = [...document.querySelectorAll('#overview .glance-short')];
        return before.length === after.length && before.every((el, i) => el === after[i] && el.firstElementChild === contents[i]);
      });
      check('an unchanged picture keeps the same overview cards', retained);
      await inPage((key) => document.querySelector(`#overview .glance-short[data-key="${key}"]`).click(), keys[0]);
      check('clicking this window\'s short card brings its chat to the front', (await exec('Desk.state.view')) === chat && await exec('Terms.active() === "glance-made-up-chat"'));
      check('the strip shows the made-up folder\'s branch on its project button', await inPage((id) => {
        const b = document.querySelector(`#tiles .tile[data-id="${id}"] .th-repo .rp-branch`);
        return Boolean(b) && b.textContent === 'demo-branch';
      }, chat));
    } finally {
      try {
        if (installed) await inPage((id) => {
          const saved = window.deskGlanceSaved;
          if (!saved) return;
          try {
            Desk.Glance.hide();
            Terms.remove(id);
            Object.assign(Desk.state, saved.state);
            Reader.fake = saved.reader;
            // Render once with the restored picture so the overview lets go of its fixture nodes and stamps.
            const view = Desk.state.view;
            Desk.state.view = 'overview';
            Desk.paint();
            Desk.state.view = view;
            for (const [key, hidden] of Object.entries(saved.hidden)) document.getElementById(key).hidden = hidden;
            Desk.setView(view);
          } finally {
            Object.assign(Desk.state, saved.state);
            Reader.fake = saved.reader;
            if (saved.storage === null) sessionStorage.removeItem('desk-place'); else sessionStorage.setItem('desk-place', saved.storage);
            delete window.deskGlanceSaved;
          }
        }, chat);
      } finally {
        local = null;
        const target = path.resolve(root);
        if (!target.startsWith(path.resolve(dir) + path.sep)) throw new Error('The made-up glance folder left its output directory.');
        fs.rmSync(target, { recursive: true, force: true });
        watch.post({ type: 'pace', ms: 2000 });
      }
      const clear = await inPage((id, keys) => !window.deskGlanceSaved && !Terms.get(id) && !Desk.state.chats.some((c) => c.id === id)
        && !Desk.state.snap.chats.some((c) => keys.includes(c.key)) && !Desk.state.settings.spaces.some((s) => s.id.startsWith('glance-space-'))
        && !document.querySelector(`.tile[data-id="${id}"]`) && ![...document.querySelectorAll('.glance-short[data-key], #chat-list [data-key]')].some((el) => keys.includes(el.dataset.key)), chat, keys);
      check('the glance phase leaves no made-up folder, session, terminal, workspace or page override behind', !fs.existsSync(root) && clear);
    }
  };

  const listPhase = async () => {
    check('the window loads for the made-up list checks', Boolean(await until(() => exec('typeof Desk === "object" && Desk !== null'), 15000)));
    watch.post({ type: 'pace', ms: 600000 });
    await wait(700);
    const root = fs.mkdtempSync(path.join(dir, 'list-'));
    const folders = ['alpha', 'beta', 'gamma', 'unsorted'].map((name) => path.join(root, name));
    for (const cwd of folders) fs.mkdirSync(cwd, { recursive: true });
    const [A, B, C] = ['wlistalpha', 'wlistbeta', 'wlistgamma'];
    const keys = Array.from({ length: 7 }, (_, i) => `51515151-2222-4333-8444-${String(i + 1).padStart(12, '0')}`);
    const saved = settingsNow();
    const savedSettings = { spaces: saved.spaces, space: saved.space, also: saved.also || [], pins: saved.pins || { top: [], space: [] }, tiles: saved.tiles, split: saved.split };
    const created = [];
    let installed = false;
    let inputWas = null;
    const patchSettings = (patch) => inPage(async (p) => {
      const next = await desk.settings(p);
      Object.assign(Desk.state.settings, next);
      Desk.paint();
      return { spaces: next.spaces, space: next.space, also: next.also, pins: next.pins };
    }, patch);
    const show = (sessions, ended = []) => inPage((list, over) => {
      takeSnapshot({ at: Date.now(), chats: list, ended: over, leaving: [], plan: null, accounts: null });
      Desk.paint();
    }, sessions, ended);
    const tab = (id, ctrlKey = false) => inPage((key, ctrl) => {
      const el = document.querySelector(`#spaces .space-tab[data-space="${key}"]`);
      if (!el) return false;
      el.dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: ctrl }));
      return true;
    }, id, ctrlKey);
    const rowAt = (key, scope = '#chat-list') => `${scope} .nav-item.chat[data-key="${key}"]`;
    const blockAt = (id) => `#chat-list .ws-block[data-group="ws:${id}"]`;
    const choose = async (key, label, membership = false, scope = '#chat-list') => {
      if (!(await inPage(pageRightClick, rowAt(key, scope)))) return false;
      return inPage((words, part) => {
        const root = document.getElementById('menu');
        let candidates = [...root.querySelectorAll('.menu-item')];
        if (part) {
          const head = [...root.querySelectorAll('.menu-head')].find((x) => x.textContent === 'Workspaces');
          candidates = [];
          for (let el = head && head.nextElementSibling; el && !el.classList.contains('menu-head'); el = el.nextElementSibling) if (el.classList.contains('menu-item')) candidates.push(el);
        }
        const el = candidates.find((x) => x.querySelector('span:not(.icon-gap)').textContent === words);
        if (el) el.click();
        return Boolean(el);
      }, label, membership);
    };
    const inspect = () => inPage(() => {
      const rows = (el) => [...el.querySelectorAll('.nav-item.chat')].map((r) => ({ id: r.dataset.row, key: r.dataset.key, chat: r.dataset.id, tip: r.dataset.tip, cls: r.className,
        group: r.closest('.group').dataset.group, subs: (r.querySelector('.subs') || {}).textContent || '', pin: Boolean(r.querySelector('.row-pin')) }));
      const list = document.getElementById('chat-list');
      const triage = document.getElementById('triage');
      return { space: Desk.state.settings.space, also: Desk.state.settings.also, rows: rows(list), cls: list.className,
        need: triage.hidden ? '' : triage.textContent,
        tabs: [...document.querySelectorAll('#spaces .space-tab')].map((t) => ({ id: t.dataset.space, on: t.classList.contains('on'), n: (t.querySelector('.space-n') || {}).textContent || '',
          letter: (t.querySelector('.ws-tile') || {}).textContent || '', cls: t.className, tip: t.dataset.tip || '' })),
        blocks: [...list.querySelectorAll('.ws-block')].map((b) => ({ id: b.dataset.group, title: (b.querySelector('.group-head') || {}).textContent || '',
          letter: (b.querySelector('.ws-tile') || {}).textContent || '', count: (b.querySelector('.g-n') || {}).textContent || '', cls: b.className,
          groups: [...b.querySelectorAll('.group')].map((g) => g.dataset.group), rows: rows(b) })),
        groups: [...list.children].filter((el) => el.classList.contains('group')).map((el) => el.dataset.group) };
    });
    try {
      await inPage(() => {
        const st = Desk.state;
        window.deskListSaved = { state: { ...st }, reader: Reader.fake, fold: kept.get('side-fold', '{}') };
        Reader.fake = () => ({ items: [], replies: [], orphans: {}, from: 0, to: 0, start: true });
        Object.assign(st, { snap: { at: 1, chats: [], ended: [], leaving: [], plan: null, accounts: null }, res: null, usage: null, frozen: true,
          view: 'peek', sel: null, loose: false, unread: new Set(), seenWaits: new Map(), before: new Map(), armed: new Set(), armedAs: new Map(), resumed: new Map(),
          settings: { ...st.settings, spaces: [], space: '', also: [], pins: { top: [], space: [] } } });
        Desk.paint();
      });
      installed = true;
      let returned = await patchSettings({ spaces: [
        { id: A, name: 'Alpha', folders: [folders[0]] },
        { id: B, name: 'Beta', folders: [folders[1]], color: 'teal' },
        { id: C, name: 'Gamma', folders: [folders[2]], color: 'made-up-colour' },
      ], space: '', also: [B, B, 'wmissing'], pins: { top: [], space: [] }, tiles: 2 });
      let list = await inspect();
      check('1. automatic colours follow tab position, chosen colours return from main, and an invented colour is dropped',
        returned.spaces[0].color === '' && returned.spaces[1].color === 'teal' && returned.spaces[2].color === ''
        && list.tabs.find((t) => t.id === A).cls.includes('ws-rose') && list.tabs.find((t) => t.id === B).cls.includes('ws-teal') && list.tabs.find((t) => t.id === C).cls.includes('ws-mint')
        && returned.also.length === 0);
      const swatches = await inPage((id) => {
        Settings.open('spaces');
        const choices = [...document.querySelectorAll(`#settings .space-row[data-space="${id}"] .ws-choice`)];
        const result = choices.map((b) => ({ label: b.getAttribute('aria-label'), keyboard: b.tabIndex === 0, on: b.getAttribute('aria-pressed') === 'true' }));
        const sky = choices.find((b) => b.dataset.color === 'sky');
        if (sky) sky.click();
        Settings.close();
        return result;
      }, B);
      const choseColor = await until(() => settingsNow().spaces.find((s) => s.id === B).color === 'sky', 3000);
      check('the colour choices are named buttons reached by the keyboard, and choosing one reaches main',
        same(swatches.map((b) => b.label), ['rose', 'olive', 'mint', 'teal', 'sky', 'indigo', 'purple', 'Auto']) && swatches.every((b) => b.keyboard)
        && swatches.find((b) => b.label === 'teal').on && Boolean(choseColor));
      await call('colorSpace', B, 'teal');
      await until(() => settingsNow().spaces.find((s) => s.id === B).color === 'teal', 3000);
      for (const cwd of folders.slice(0, 2)) {
        const chat = await inPage(pageNew, { cwd, starter: 'shell', restore: true });
        if (!chat || !chat.id) throw new Error('A made-up list console did not open.');
        created.push(chat.id);
        if (!(await until(async () => (await linesOf(chat.id)).some((line) => />\s*$/.test(line)), 30000))) throw new Error('A made-up list console did not reach its prompt.');
      }
      const [one, two] = created;
      await inPage(pageRightClick, `#chat-list .nav-item.chat[data-id="${one}"]`);
      const bareMenu = await inPage(pageMenu);
      check('a console without a session has no pin or session membership items', bareMenu && !bareMenu.heads.includes('Workspaces')
        && !bareMenu.items.some((item) => /^(Unpin|Pin )/.test(item.label)));
      await inPage(pageKey, 'Escape');
      madeAt = Date.now();
      const sessions = [
        row({ key: keys[0], title: 'Alpha waiting', cwd: folders[0], chat: one, state: 'attention', waiting: 'permission', since: madeAt - 120000 }),
        row({ key: keys[1], title: 'Beta working', cwd: folders[1], chat: two, state: 'working' }),
        row({ key: keys[2], title: 'Alpha helpers', cwd: folders[0], state: 'working', agents: { total: 3, running: 3, list: [] } }),
        row({ key: keys[3], title: 'Beta stopped', cwd: folders[1], state: 'error', limited: true, limit: { type: 'five_hour', until: madeAt + 80 * 60000 } }),
        row({ key: keys[4], title: 'Gamma idle', cwd: folders[2], state: 'idle' }),
        row({ key: keys[5], title: 'Loose notes', cwd: folders[3], state: 'working' }),
      ];
      await show(sessions);
      await tab(A, true);
      check('Ctrl-click from All shows that workspace alone', (await exec('Desk.state.settings.space')) === A
        && (await exec('Desk.state.settings.also.length')) === 0);
      await tab(B, true);
      await unsee();
      list = await inspect();
      const inside = await inPage((f) => f.map((cwd) => Desk.inView(cwd)), folders.slice(0, 3));
      check('2. Ctrl-click shows two blocks in tab order, with their letters, counts and own chats',
        same(list.blocks.map((b) => b.id), [`ws:${A}`, `ws:${B}`]) && same(list.blocks.map((b) => b.letter), ['A', 'B'])
        && same(list.blocks.map((b) => b.count), ['2', '2']) && list.blocks[0].rows.some((r) => r.chat === one) && list.blocks[1].rows.some((r) => r.chat === two)
        && same(inside, [true, true, false]) && list.tabs.filter((t) => t.on).length === 2 && list.tabs.find((t) => t.id === B).tip.includes('Ctrl+click to show it next to the others.'));
      check('5. each block has its own state groups, with no Needs you heading for Beta',
        same(list.blocks[0].groups, [`ws:${A}:needs`, `ws:${A}:working`]) && same(list.blocks[1].groups, [`ws:${B}:working`, `ws:${B}:limited`])
        && list.tabs.find((t) => t.id === A).n === '1' && list.tabs.find((t) => t.id === B).n === '');
      // a wait the person went into and then left: drawn dull, still among what waits, no longer counted; a new wait calls again
      const waitRow = (key) => inPage((k) => {
        const r = document.querySelector(`#chat-list .nav-item.chat[data-key="${k}"]`);
        const g = r && r.querySelector('.glyph');
        let place = [];
        try { keepPlace(); place = JSON.parse(sessionStorage.getItem('desk-place') || '{}').seenWaits || []; } catch { place = []; }
        return { mark: r ? r.dataset.mark : '', glyph: g ? g.getAttribute('class') : '', glow: g ? getComputedStyle(g).filter : '',
          when: r ? (r.querySelector('.when') || {}).className || '' : '', group: r ? r.closest('.group').dataset.group : '', badge: badgeShown,
          kept: place.some((p) => Array.isArray(p) && p[0] === k) };
      }, key);
      const viewWas = await exec('Desk.state.view');
      await view(one);
      await view(two);
      const dull = await waitRow(keys[0]);
      list = await inspect();
      check('a wait the person went into and then left is drawn dull with no glow, stays with what waits, and counts no more on its tab, in the title bar or on the taskbar',
        dull.mark === 'needs-seen' && /\bg-needs-seen\b/.test(dull.glyph) && ['none', ''].includes(dull.glow) && !/\bneeds\b/.test(dull.when) && /:needs$/.test(dull.group)
        && list.tabs.find((t) => t.id === A).n === '' && list.need === '' && dull.badge === 0 && dull.kept,
        JSON.stringify({ dull, tabs: list.tabs.map((t) => [t.id, t.n]), need: list.need }));
      // a full quit and a new start: the window's store for this run is empty, and main hands over no place
      const fresh = await inPage((k) => {
        keepPlace();
        const saved = sessionStorage.getItem('desk-place');
        const was = JSON.stringify([...Desk.state.seenWaits]);
        sessionStorage.removeItem('desk-place');
        Desk.state.seenWaits = new Map();
        takePlace();
        if (saved) sessionStorage.setItem('desk-place', saved);
        return { back: JSON.stringify([...Desk.state.seenWaits]) === was, has: Desk.state.seenWaits.has(k), n: Desk.state.seenWaits.size };
      }, keys[0]);
      check('a wait seen stays seen through a full quit and a new start: it comes back from the store that outlasts the run', fresh.back && fresh.has, JSON.stringify(fresh));
      await show(sessions.map((s) => (s.key === keys[0] ? { ...s, since: Date.now() - 3000 } : s)));
      const lit = await waitRow(keys[0]);
      list = await inspect();
      check('the same chat waiting for something new calls again: bright, counted on its tab, in the title bar and on the taskbar',
        lit.mark === 'needs' && list.tabs.find((t) => t.id === A).n === '1' && /^1 needs you$/.test(list.need) && lit.badge === 1, JSON.stringify({ lit, need: list.need }));
      await view(viewWas);
      await inPage(() => { Desk.state.seenWaits.clear(); });
      await show(sessions);
      const compact = await inPage((id) => {
        const block = document.querySelector(`#chat-list .ws-block[data-group="ws:${id}"]`);
        const row = block.querySelector('.nav-item.chat');
        const group = block.querySelector('.group');
        return { header: getComputedStyle(block.querySelector('.group-head')).height, row: getComputedStyle(row).height,
          group: getComputedStyle(group.querySelector('.group-head')).height, lazy: getComputedStyle(group).contentVisibility };
      }, A);
      check('headers keep their compact heights, a row has its two lines, and groups skip layout while off screen',
        compact.header === '26px' && compact.row === '47px' && compact.group === '22px' && compact.lazy === 'auto', JSON.stringify(compact));
      await ctrl('Tab');
      await ctrl('Tab');
      check('Ctrl Tab and the places on screen keep both shown workspaces available',
        same((await tilesNow()).tiles.map((t) => t.id).sort(), created.slice().sort()) && (await exec('Desk.state.settings.also.length')) === 1);
      const old = row({ key: 'job:abc12345', title: 'Old made-up notes', cwd: folders[0], kind: 'bg', pid: 0, at: madeAt - 4 * 86400e3 });
      await show([...sessions, old], [{ id: keys[6], title: 'Ended made-up notes', cwd: folders[1], at: madeAt - 10000 }]);
      list = await inspect();
      check('old background sessions and ended chats remain single shelves outside the workspace blocks',
        same(list.groups, [`ws:${A}`, `ws:${B}`, 'old', 'ended']) && list.blocks.every((b) => !b.rows.some((r) => r.key === old.key || r.key === keys[6])));
      await show(sessions);
      await tab(B);
      list = await inspect();
      check('3. a plain tab click shows only that workspace and empties also in main', list.space === B && list.also.length === 0 && list.blocks.length === 0
        && list.rows.every((r) => [keys[1], keys[3]].includes(r.key)) && Boolean(await until(() => settingsNow().space === B && settingsNow().also.length === 0, 3000))
        && Boolean(await exec('document.querySelector("#chat-list > .ws-list.ws-tint.ws-teal")')));
      await tab(A, true);
      await inPage(pageRightClick, tabOfSpace(B));
      const took = await inPage(pageMenuRun, 'Take it out of what is shown');
      list = await inspect();
      check('4. taking the workspace in front out through its menu promotes the other one', took && list.space === A && list.also.length === 0);
      await tab(B, true);
      const pinned = await choose(keys[0], 'Pin in Alpha');
      list = await inspect();
      check('6. a workspace pin is first in its block and is absent from the state group', pinned && list.blocks[0].groups[0] === `ws:${A}:pinned`
        && list.blocks[0].rows.filter((r) => r.key === keys[0]).length === 1 && list.blocks[0].rows.find((r) => r.key === keys[0]).group === `ws:${A}:pinned`
        && list.blocks[0].rows.find((r) => r.key === keys[0]).pin);
      const onTop = await choose(keys[0], 'Pin on top of everything');
      const copies = await inPage((key, id) => {
        const all = [...document.querySelectorAll(`#chat-list .nav-item.chat[data-key="${key}"]`)];
        const section = document.querySelector('#chat-list .group[data-group="top"]');
        const different = all.length === 2 && all[0] !== all[1];
        const led = all.map((el) => { el.click(); return Desk.state.view === id; });
        return { different, led, ids: all.map((el) => el.dataset.row), plain: Boolean(section) && ![...section.classList].some((c) => /^ws-/.test(c)) };
      }, keys[0], one);
      check('7. a top pin has a separate untinted copy and both copies lead to the same console', onTop && copies.different && copies.led.every(Boolean)
        && copies.ids.includes(`top:chat:${one}`) && copies.ids.includes(`chat:${one}`) && copies.plain);
      await tab(C);
      list = await inspect();
      const topOutside = list.rows.find((r) => r.key === keys[0]);
      await inPage(pageRightClick, rowAt(keys[0], '#chat-list .group[data-group="top"]'));
      const topMenu = await inPage(pageMenu);
      await inPage(pageKey, 'Escape');
      check('a top pin is still offered from another workspace, with its note and unpin menu', topOutside && topOutside.group === 'top'
        && topOutside.tip.includes('Alpha waiting') && topMenu && topMenu.items.some((i) => i.label === 'Unpin from the top'));
      await tab(A);
      list = await inspect();
      check('a workspace pin also precedes the state groups when its workspace is shown alone',
        list.rows.filter((r) => r.key === keys[0]).length === 2 && list.rows.some((r) => r.key === keys[0] && r.group === 'pinned'));
      await tab(B, true);
      returned = await patchSettings({ pins: { top: [keys[0], keys[0], 'ill-shaped-key', keys[6]], space: [keys[0], 'bad/key'] } });
      const again = await patchSettings({});
      list = await inspect();
      check('8. pins and colours survive main, ill-shaped pins are dropped, and an absent pinned session draws nothing',
        same(returned.pins, { top: [keys[0], keys[6]], space: [keys[0]] }) && same(again.pins, returned.pins) && again.spaces[1].color === 'teal'
        && !list.rows.some((r) => r.key === keys[6]));
      await tab('');
      list = await inspect();
      const allA = list.rows.filter((r) => r.key === keys[0]);
      check('All keeps state grouping and workspace pins in their state group, with the folder colour on the row', allA.some((r) => r.group === 'needs' && r.cls.includes('ws-rose'))
        && list.blocks.length === 0 && !list.groups.includes('pinned'));
      // chats in one folder stand together in their group, strung on a thread; under each name: its folder and what it used
      const second = row({ key: '51515151-2222-4333-8444-000000000009', title: 'Alpha second', cwd: folders[0], state: 'working', started: madeAt - 60e3,
        live: { usd: 41.8, added: 0, removed: 0, warm: true, cacheUntil: madeAt + 60e3, cacheCold: 0, cacheHit: 0.9 } });
      await show([...sessions, second]);
      const strung = await inPage(() => [...document.querySelectorAll('#chat-list .group[data-group="working"] .nav-item.chat')].map((r) => ({
        key: r.dataset.key, thread: (r.querySelector('.thread') || { className: '' }).className.replace('thread', '').trim(),
        meta: [...r.querySelectorAll('.meta > span:not([hidden])')].map((s) => s.textContent),
        cost: (() => { const c = r.querySelector('.m-cost'); return c && !c.hidden ? c.textContent : ''; })(),
        tip: /% memory|In its memory now/.test(r.dataset.tip || '') && /at list prices/.test(r.dataset.tip || '') })));
      check('chats in one folder stand together in their group, on a thread through their marks; its cost ends a row\'s first line, its folder and tokens out are under its name, its memory in its note until it fills up',
        same(strung.map((r) => r.key), [keys[1], keys[2], second.key, keys[5]]) && same(strung.map((r) => r.thread), ['', 't-first', 't-last', ''])
        && same(strung[2].meta, ['alpha', '388k out']) && strung[2].cost === '$42' && strung[0].meta[0] === 'beta' && strung[2].tip,
        JSON.stringify(strung.map((r) => [r.key.slice(-2), r.thread, r.cost, r.meta.join(' | ')])));
      await show(sessions);
      const awayBefore = await inPage((key) => !document.querySelector(`#chat-list .nav-item.chat[data-key="${key}"] .out`), keys[2]);
      await inPage((key) => { Desk.state.armed.add(key); Desk.paint(); }, keys[2]);
      const arriving = await inPage((key) => Boolean(document.querySelector(`#chat-list .nav-item.chat[data-key="${key}"] .out.coming`)), keys[2]);
      check('9. an outside row has no arrow and a row on its way here keeps the bring icon', awayBefore && arriving);
      await inPage((key) => { Desk.state.armed.delete(key); Desk.paint(); }, keys[2]);
      list = await inspect();
      const helpers = list.rows.find((r) => r.key === keys[2]);
      check('10. three working subagents have their own figure and a hover-note line', /\b3\b/.test(helpers.subs) && helpers.tip.includes('3 subagents working'));
      await show(sessions.map((s) => s.key === keys[2] ? { ...s, agents: { ...s.agents, running: 2 } } : s));
      const fewerHelpers = (await inspect()).rows.find((r) => r.key === keys[2]);
      check('the row stamp follows a change in its number of working subagents', /\b2\b/.test(fewerHelpers.subs)
        && fewerHelpers.tip.includes('2 subagents working') && !fewerHelpers.tip.includes('3 subagents working'));
      await show(sessions);
      await patchSettings({ pins: { top: [], space: [] } });
      await tab(B);
      await unsee();
      const stopped = await inPage(() => {
        const g = document.querySelector('#chat-list .group[data-group="limited"]');
        return { title: g && g.querySelector('.group-head').textContent, ticking: Boolean(g && g.querySelector('[data-left]')) };
      });
      list = await inspect();
      const beforeNeed = list.need;
      sessions[3] = { ...sessions[3], limit: null };
      await show(sessions);
      const lifted = await inspect();
      const liftedWords = await exec('document.querySelector(\'#chat-list .group[data-group="limited"]\').textContent');
      check('11. usage-limited rows step aside, tick until lifted, and count as needing the owner only after lifting',
        list.rows.find((r) => r.key === keys[3]).group === 'limited' && beforeNeed === '1 needs you' && stopped.title.includes('Stopped by a usage limit') && stopped.ticking
        && lifted.need === '2 need you' && liftedWords.includes('limit lifted'));
      await tab(A);
      const joined = await choose(keys[0], 'Beta', true);
      await tab(B);
      const inB = (await inspect()).rows.some((r) => r.key === keys[0]);
      const bySession = await inPage((cwd, key, id) => Desk.inView(cwd, key) && !Desk.inView(cwd) && Desk.onScreen().includes(id), folders[0], keys[0], one);
      await tab(A);
      const inA = (await inspect()).rows.some((r) => r.key === keys[0]);
      await tab(B, true);
      await unsee();
      list = await inspect();
      const membershipCopies = await inPage((key, id) => {
        const all = [...document.querySelectorAll(`#chat-list .nav-item.chat[data-key="${key}"]`)];
        return { ids: all.map((el) => el.dataset.row), different: all.length === 2 && all[0] !== all[1], led: all.map((el) => { el.click(); return Desk.state.view === id; }) };
      }, keys[0], one);
      check('15. a session put in Beta through its menu appears in both workspaces, with separate copies and both yellow counts',
        joined && inA && inB && bySession && membershipCopies.different && membershipCopies.led.every(Boolean) && membershipCopies.ids.includes(`also:${B}:chat:${one}`)
        && list.tabs.find((t) => t.id === A).n === '1' && list.tabs.find((t) => t.id === B).n === '2');
      await inPage(pageRightClick, rowAt(keys[0], blockAt(B)));
      const membershipMenu = await inPage(pageMenu);
      const byFolder = membershipMenu.items.find((i) => i.label === 'Alpha, by its folder');
      const betaTicked = membershipMenu.items.some((i) => i.label === 'Beta' && i.ticked);
      await inPage(pageMenuRun, 'Alpha, by its folder');
      const stayed = await inPage((cwd, key, id) => Desk.spacesOf(cwd, key).includes(id), folders[0], keys[0], A);
      const left = await choose(keys[0], 'Beta', true, blockAt(B));
      list = await inspect();
      check('16. its folder membership stays ticked and cannot be removed; removing Beta updates its row and count',
        byFolder && byFolder.ticked && betaTicked && stayed && left && !list.blocks[1].rows.some((r) => r.key === keys[0]) && list.tabs.find((t) => t.id === B).n === '1');
      await tab('');
      const sorted = await choose(keys[5], 'Beta', true);
      const looseShown = await tab('?');
      const afterSort = await inspect();
      const absentLoose = looseShown ? !afterSort.rows.some((r) => r.key === keys[5]) : !afterSort.tabs.some((t) => t.id === '?');
      await tab(B);
      const inBeta = (await inspect()).rows.some((r) => r.key === keys[5]);
      check('18. a folder in no workspace leaves Unsorted when its session is put into Beta', sorted && absentLoose && inBeta
        && !(await inPage((cwd, key) => { Desk.state.loose = true; const yes = Desk.inView(cwd, key); Desk.state.loose = false; return yes; }, folders[3], keys[5])));
      const memberships = await exec('Desk.state.settings.spaces');
      memberships[1].sessions.push(keys[5], 'bad/key', keys[6]);
      returned = await patchSettings({ spaces: memberships });
      const keptMembers = returned.spaces[1].sessions;
      const roundTripMembers = (await patchSettings({})).spaces[1].sessions;
      await call('removeSpace', B);
      const dropped = await until(() => !settingsNow().spaces.some((s) => s.id === B), 3000);
      check('17. memberships survive main, bad keys and duplicates are dropped, and deleting Beta drops its memberships',
        same(keptMembers, [keys[5], keys[6]]) && same(roundTripMembers, keptMembers) && Boolean(dropped)
        && !(await exec('Desk.state.settings.spaces.some((s) => s.id === "wlistbeta")')));
      await patchSettings({ spaces: [], space: '', also: [], pins: { top: [], space: [] } });
      const baseline = sessions.map((s) => ({ ...s, limited: false, limit: null, state: s.key === keys[3] ? 'idle' : s.state }));
      await show(baseline);
      list = await inspect();
      check('13. with the settings empty the list keeps its flat state groups and one row per running session',
        same(list.groups, ['needs', 'working', 'idle']) && list.blocks.length === 0 && list.tabs.length === 0 && list.rows.length === baseline.length
        && new Set(list.rows.map((r) => r.key)).size === baseline.length);
      const limit = { type: 'five_hour', until: Date.now() + 80 * 60000 };
      await show([0, 1, 3].map((i) => ({ ...sessions[i], state: 'error', limited: true, limit })));
      // each console draws its prompt the way Claude Code does (\u276F under a rule of \u2500) and waits for the word,
      // spelled by its letter codes so that the typed command line never holds it
      const waiting = "while ($true) { Write-Host ([string][char]0x2500 * 24); Write-Host -NoNewline ([string][char]0x276F + ' '); $reply = Read-Host; if ($reply -eq ([string]::Concat([char[]](99,111,110,116,105,110,117,101)))) { break } }\r";
      const atPrompt = (ids) => inPage((list) => list.map((id) => Desk.atPrompt(id)), ids);
      for (const id of created) await inPage((chat, text) => desk.input(chat, text), id, waiting);
      const ready = await until(async () => (await atPrompt(created)).every(Boolean), 10000);
      const inputs = [];
      inputWas = chats.input;
      chats.input = function (id, text, ...rest) { if (text === 'continue\r') inputs.push(id); return inputWas.call(this, id, text, ...rest); };
      const continueTip = await exec('document.querySelector(".limit-continue").dataset.tip');
      await exec('document.querySelector(".limit-continue").click()');
      const continued = await until(async () => (await Promise.all(created.map(linesOf))).every((out) => out.filter((line) => /^\u276F continue$/.test(line.trim())).length === 1), 10000);
      const said = await toastNow();
      chats.input = inputWas;
      inputWas = null;
      check('12. Continue all types once into each plain console and reports the other terminal without typing into it',
        Boolean(ready) && Boolean(continued) && same(inputs.slice().sort(), created.slice().sort()) && said.includes('Typed "continue" in 2 chats.')
        && said.includes('1 more run in other terminals: continue those there.') && continueTip === 'Claude Code continues these by itself when the limit lifts, unless that is turned off in its /config. This types "continue" and Enter in each of them that shows its prompt.');
      // the word ended their loops: they wait at a fresh prompt again for the checks below, the old one cleared away
      for (const id of created) await inPage((chat, text) => desk.input(chat, text), id, `cls; ${waiting}`);
      const refreshed = await until(async () => (await Promise.all(created.map(linesOf))).every((out) => !out.some((line) => /^\u276F continue$/.test(line.trim())))
        && (await atPrompt(created)).every(Boolean), 10000);
      if (!check('both consoles wait at their prompt again', Boolean(refreshed))) throw new Error('the consoles did not come back to their prompt');
      const skipped = [];
      inputWas = chats.input;
      chats.input = function (id, text, ...rest) { if (text === 'continue\r') { skipped.push(id); return; } return inputWas.call(this, id, text, ...rest); };
      await inPage((id) => { Desk.state.chats = Desk.state.chats.map((c) => c.id === id ? { ...c, closing: true } : c); Desk.paint(); }, two);
      await exec('document.querySelector(".limit-continue").click()');
      await wait(150);
      chats.input = inputWas;
      inputWas = null;
      await inPage((id) => { Desk.state.chats = Desk.state.chats.map((c) => c.id === id ? { ...c, closing: false } : c); Desk.paint(); }, two);
      check('Continue all leaves a console that is closing alone', same(skipped, [one]));
      // Compact now: only for a chat of this window that waits at its prompt, never typed into one that works
      await show([{ ...sessions[0], state: 'idle', waiting: '', context: 300000, ceiling: 467000 }, { ...sessions[1], state: 'working', context: 300000, ceiling: 467000 }]);
      await inPage(pageRightClick, `#chat-list .nav-item.chat[data-id="${one}"]`);
      const idleMenu = await inPage(pageMenu);
      await inPage(pageKey, 'Escape');
      await inPage(pageRightClick, `#chat-list .nav-item.chat[data-id="${two}"]`);
      const busyMenu = await inPage(pageMenu);
      await inPage(pageKey, 'Escape');
      await inPage((id) => Desk.setView(id), one);
      await wait(250);
      const cardButton = await inPage((ids) => ids.map((id) => {
        Desk.Glance.toggle(id);
        const found = Boolean(document.querySelector('.glance-compact'));
        Desk.Glance.toggle(id);
        return found;
      }), [one, two]);
      const compacted = [];
      inputWas = chats.input;
      chats.input = function (id, text, ...rest) { if (text === '/compact\r') { compacted.push(id); return; } return inputWas.call(this, id, text, ...rest); };
      await choose(keys[0], 'Compact now');
      await wait(150);
      const saidCompact = await toastNow();
      chats.input = inputWas;
      inputWas = null;
      await show([{ ...sessions[0], state: 'idle', waiting: '', context: 60000, ceiling: 467000 }]);
      const smallCard = await inPage((id) => { Desk.Glance.toggle(id); const found = Boolean(document.querySelector('.glance-compact')); Desk.Glance.toggle(id); return found; }, one);
      check('Compact now is offered for an idle chat of this window, typed into it alone, and offered neither while a chat works nor on a small one',
        idleMenu && idleMenu.items.some((i) => i.label === 'Compact now') && busyMenu && !busyMenu.items.some((i) => i.label === 'Compact now')
        && same(cardButton, [true, false]) && !smallCard && same(compacted, [one]) && saidCompact.startsWith('Typed /compact in '),
        `menus ${JSON.stringify([idleMenu && idleMenu.items.map((i) => i.label), busyMenu && busyMenu.items.map((i) => i.label)])}; cards ${JSON.stringify(cardButton)}, small ${smallCard}; typed into ${compacted.length}; "${saidCompact}"`);
      // a question on a chat's own screen, drawn the way Claude Code draws one: an Enter typed there would answer it
      await inPage((id) => new Promise((done) => Desk.Terms.get(id).term.write('\r\n  Turn on usage credits?\r\n\u276F 1. Yes\r\n  2. No\r\n', done)), one);
      const seesQuestion = await atPrompt([one, two]);
      await show([{ ...sessions[0], state: 'idle', waiting: '', context: 300000, ceiling: 467000 }]);
      await inPage(pageRightClick, `#chat-list .nav-item.chat[data-id="${one}"]`);
      const questionMenu = await inPage(pageMenu);
      await inPage(pageKey, 'Escape');
      await show([0, 1, 3].map((i) => ({ ...sessions[i], state: 'error', limited: true, limit })));
      const typedInto = [];
      inputWas = chats.input;
      chats.input = function (id, text, ...rest) { if (text === 'continue\r') { typedInto.push(id); return; } return inputWas.call(this, id, text, ...rest); };
      await exec('document.querySelector(".limit-continue").click()');
      await wait(150);
      const saidLeft = await toastNow();
      chats.input = inputWas;
      inputWas = null;
      check('a chat whose screen shows a question with numbered choices gets neither Compact now nor "continue"',
        same(seesQuestion, [false, true]) && Boolean(questionMenu) && !questionMenu.items.some((i) => i.label === 'Compact now') && same(typedInto, [two])
        && saidLeft.includes('Typed "continue" in 1 chat. 1 left alone: its screen did not show an empty prompt. Open it and continue by hand.'),
        `at their prompt: ${JSON.stringify(seesQuestion)}; typed into ${typedInto.length}; "${saidLeft}"`);
    } finally {
      if (inputWas) chats.input = inputWas;
      let closed = true;
      try {
        for (const id of created) {
          await inPage((chat) => desk.input(chat, '\x03'), id).catch(() => {});
          if (!(await closeAndWait(id))) closed = false;
        }
        await patchSettings(savedSettings);
        if (installed) await inPage(() => {
          const saved = window.deskListSaved;
          if (!saved) return;
          document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
          document.getElementById('menu').replaceChildren();
          document.getElementById('toast').hidden = true;
          kept.set('side-fold', saved.fold);
          Reader.fake = saved.reader;
          Object.assign(Desk.state, saved.state);
          Desk.ChatView.place(Desk.state, Desk.onScreen());
          Desk.paint();
          Settings.open('spaces');
          Settings.close();
          delete window.deskListSaved;
        });
      } finally {
        const target = path.resolve(root);
        if (!target.startsWith(path.resolve(dir) + path.sep)) throw new Error('The made-up list folder left its output directory.');
        fs.rmSync(target, { recursive: true, force: true });
        watch.post({ type: 'pace', ms: 2000 });
      }
      const clear = await inPage((sessions, ids) => !window.deskListSaved && !Desk.state.snap.chats.some((c) => sessions.includes(c.key))
        && !Desk.state.snap.ended.some((c) => sessions.includes(c.id)) && !Desk.state.chats.some((c) => ids.includes(c.id))
        && ![...document.querySelectorAll('#chat-list .nav-item.chat')].some((r) => sessions.includes(r.dataset.key)), keys, created);
      check('14. the list phase leaves no made-up consoles, sessions, folders, settings or page overrides behind', closed && clear && !fs.existsSync(root)
        && created.every((id) => !chats.all.has(id)) && same(settingsNow().spaces, savedSettings.spaces) && same(settingsNow().pins, savedSettings.pins)
        && settingsNow().space === savedSettings.space && same(settingsNow().also, savedSettings.also)
        && settingsNow().tiles === savedSettings.tiles && settingsNow().split === savedSettings.split && settingsNow().starter === saved.starter);
    }
  };

  const findPhase = async () => {
    const { Finder, parseQuestion, momentsOf, rankMoments } = require('./find.cjs');
    check('the window loads for the made-up finder checks', Boolean(await until(() => exec('typeof Desk === "object" && Desk !== null'), 15000)));
    if (!check('the finder is stopped until this phase supplies a made-up home', Boolean(find) && find.thread() === 0)) throw new Error('The finder was not isolated for this phase.');
    const root = fs.mkdtempSync(path.join(dir, 'find-'));
    const home = path.join(root, 'home');
    const store = path.join(root, 'data', 'find');
    const cwd = path.join(root, 'work', 'pricing');
    const project = path.join(home, '.claude', 'projects', cwd.replace(/[^A-Za-z0-9]/g, '-'));
    const now = new Date(2026, 9, 5, 12).getTime();
    const day = (offset, hour = 12) => new Date(2026, 9, 5 + offset, hour).getTime();
    const ids = ['11111111-2222-4333-8444-555555555581', '11111111-2222-4333-8444-555555555582',
      '11111111-2222-4333-8444-555555555583', '11111111-2222-4333-8444-555555555584'];
    const titles = ['Made-up Stripe receipt', 'Made-up older receipt', 'Made-up typed question', 'Made-up command'];
    const files = ids.map((id) => path.join(project, `${id}.jsonl`));
    const sub = path.join(project, ids[0], 'subagents', 'agent-finder-fixture.jsonl');
    const asked = (text, at) => ({ type: 'user', timestamp: new Date(at).toISOString(), cwd, message: { role: 'user', content: text } });
    const replied = (content, at) => ({ type: 'assistant', timestamp: new Date(at).toISOString(), cwd, message: { role: 'assistant', content } });
    const called = (name, input, at) => replied([{ type: 'tool_use', id: `made-up-${at}`, name, input }], at);
    const append = (file, rows) => fs.appendFileSync(file, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
    const search = (q) => find.ask('search', { q, now });
    const matches = (answer) => answer && answer.ready && Array.isArray(answer.results) ? answer.results : [];
    const complete = async () => until(async () => {
      const s = await find.ask('status');
      return s && s.progress && s.progress.files === 5 && !s.progress.building ? s : null;
    }, 15000, 200);
    let installed = false;
    try {
      for (const folder of [cwd, project, path.dirname(sub)]) fs.mkdirSync(folder, { recursive: true });
      files.forEach((file, i) => append(file, [{ type: 'ai-title', aiTitle: titles[i] }]));
      append(files[0], [asked('Confirm the stripe webhook route', day(-3)),
        called('Edit', { file_path: 'src/webhooks/stripe.ts', old_string: 'before', new_string: 'after' }, day(-3) + 1000),
        replied([{ type: 'text', text: 'Stripe webhook checks passed.' }], day(-3) + 2000),
        { type: 'user', timestamp: new Date(day(-3) + 3000).toISOString(), cwd,
          message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'made-up-result', content: 'finder-hidden-result' }] } }]);
      append(files[1], [asked('Review an older receipt', day(-20)),
        called('Edit', { file_path: 'src/webhooks/stripe.ts', old_string: 'older', new_string: 'before' }, day(-20) + 1000)]);
      append(files[2], [asked('Compare npm lantern options', day(-1))]);
      append(files[3], [asked('Check the test command', day(-20)), called('Bash', { command: 'npm test -- --finder-rocket' }, day(-20) + 2000)]);
      append(sub, [called('Glob', { pattern: '**/orbital-compass.*' }, day(-3) + 4000)]);
      const sourceStats = [...files, sub].map((file) => ({ file, size: fs.statSync(file).size, mtime: fs.statSync(file).mtimeMs }));
      const sourceBytes = sourceStats.reduce((sum, entry) => sum + entry.size, 0);
      await find.start(home, store, now);
      const first = await complete();
      const p = first && first.progress;
      if (!check('the first finder pass finishes with every made-up file and byte counted', Boolean(p) && p.files === 5 && p.filesDone === 5
        && p.bytes === sourceBytes && p.bytesDone === sourceBytes && !p.building && p.conversations === 4 && p.conversationsDone === 4,
      `5 made-up files; ${sourceBytes} source bytes`)) throw new Error('The made-up finder pass did not finish.');
      check('the finder reports only the made-up home and read positions inside it', path.resolve(first.home) === path.resolve(home)
        && Object.keys(first.positions).length === 5 && Object.keys(first.positions).every((file) => path.resolve(file).startsWith(path.resolve(home) + path.sep)));
      check('indexing leaves the made-up source sizes and write times unchanged', sourceStats.every((entry) => {
        const stat = fs.statSync(entry.file);
        return stat.size === entry.size && stat.mtimeMs === entry.mtime;
      }));
      const question = 'which session touched the stripe webhook last week';
      const lastWeek = matches(await search(question));
      check('last week finds the stripe webhook edit three days ago and excludes the edit twenty days ago', lastWeek.length === 1
        && lastWeek[0].id === ids[0] && lastWeek[0].moments[0].kind === 'file' && lastWeek[0].moments[0].text === 'src/webhooks/stripe.ts');
      // asked on the Saturday, the day after the edit: the edit is in this week, and "last week" still finds it
      const saturday = await find.ask('search', { q: question, now: day(-2) });
      const onSaturday = matches(saturday);
      check('asked on a Saturday, last week also finds the edit of the day before, and says from when it searched', onSaturday.length === 1
        && onSaturday[0].id === ids[0] && same(saturday.understood, ['since Mon 21 Sep', 'files']),
        `${onSaturday.length} found; understood: ${JSON.stringify(saturday && saturday.understood)}`);
      const stripe = matches(await search('stripe'));
      check('stripe without a date finds both made-up conversations, newest first', stripe.length === 2 && stripe[0].id === ids[0] && stripe[1].id === ids[1]);
      const typed = matches(await search('asked lantern'));
      const ran = matches(await search('finder-rocket'));
      const npm = matches(await search('ran npm'));
      check('words find a typed question and a command, and ran prefers the older command to the newer question', typed.length === 1
        && typed[0].id === ids[2] && typed[0].moments[0].kind === 'asked' && ran.length === 1 && ran[0].id === ids[3]
        && ran[0].moments[0].kind === 'ran' && npm.length === 2 && npm[0].id === ids[3] && npm[1].id === ids[2]);
      const ranges = [
        ['today', day(0, 0), day(1, 0)], ['yesterday', day(-1, 0), day(0, 0)],
        ['this week', day(0, 0), day(7, 0)], ['last week', day(-7, 0), day(1, 0)],
        ['past 3 days', day(-2, 0), day(1, 0)], ['since monday', day(0, 0), day(1, 0)],
        ['last 3 days', day(-2, 0), day(1, 0)], ['since friday', day(-3, 0), day(1, 0)],
        ['this month', new Date(2026, 9, 1).getTime(), new Date(2026, 10, 1).getTime()],
        ['last month', new Date(2026, 8, 1).getTime(), day(1, 0)],
        ['in september', new Date(2026, 8, 1).getTime(), new Date(2026, 9, 1).getTime()],
        ['in december', new Date(2025, 11, 1).getTime(), new Date(2026, 0, 1).getTime()],
      ];
      check('date words use the fixed local Monday and weeks start on Monday', ranges.every(([q, from, to]) => {
        const got = parseQuestion(q, [cwd], now);
        return got.from === from && got.to === to && got.terms.length === 0;
      }), 'today, yesterday, this week, last week, past 3 days, since monday, in september');
      const midweek = parseQuestion('since monday', [], day(2));
      check('since monday reaches the same week from a Wednesday', midweek.from === day(0, 0) && midweek.to === day(3, 0));
      const parsed = parseQuestion('which conversation edited "the stripe" in pricing last week', [cwd], now);
      const quoted = parseQuestion('"last week" "ran"', [cwd], now);
      check('question reading keeps phrases, removes little words, prefers a kind and narrows the folder', parsed.kind === 'file'
        && parsed.folders.length === 1 && parsed.folders[0] === cwd && parsed.terms.length === 1 && parsed.terms[0] === 'the stripe'
        && parsed.understood.includes('since Mon 28 Sep') && parsed.understood.includes('files') && parsed.understood.includes('in pricing')
        && quoted.terms.join('|') === 'last week|ran' && !quoted.kind && quoted.from === -Infinity && quoted.to === Infinity);
      check('all kind words prefer their stated kind', [
        ['touched changed edited wrote file', 'file'], ['ran run command', 'ran'], ['asked said told typed', 'asked'],
      ].every(([words, kind]) => words.split(' ').every((word) => {
        const q = parseQuestion(word, [], now);
        return q.kind === kind && q.terms.length === 0;
      })));
      const projected = [asked('a'.repeat(450), day(-3)), replied([
        ...['Edit', 'MultiEdit', 'Write', 'NotebookEdit', 'Read'].map((name) => ({ type: 'tool_use', name,
          input: { file_path: name === 'NotebookEdit' ? undefined : `src/${name}.js`, notebook_path: 'notes/demo.ipynb',
            content: 'finder-hidden-body', old_string: 'finder-hidden-before', new_string: 'finder-hidden-after' } })),
        ...['Bash', 'PowerShell'].map((name) => ({ type: 'tool_use', name, input: { command: 'n'.repeat(240) } })),
        ...['Grep', 'Glob'].map((name) => ({ type: 'tool_use', name, input: { pattern: 'made-up-pattern' } })),
        { type: 'text', text: 's'.repeat(250) },
      ], day(-3))].flatMap((record) => momentsOf(record, ids[0]));
      check('made-up lines keep every requested kind and verb while clipping words and discarding file bodies', projected.length === 11
        && projected.filter((m) => m.kind === 'file').length === 5 && projected.filter((m) => m.verb === 'edited').length === 3
        && projected.some((m) => m.verb === 'wrote') && projected.some((m) => m.verb === 'read')
        && projected.filter((m) => m.kind === 'looked').length === 2
        && projected.filter((m) => m.kind === 'ran').length === 2 && projected.filter((m) => m.kind === 'ran').every((m) => m.text.length === 200)
        && projected.some((m) => m.kind === 'asked' && m.text.length === 400) && projected.some((m) => m.kind === 'said' && m.text.length === 200)
        && !projected.some((m) => m.text.includes('finder-hidden-')));
      const conversations = ids.map((id) => ({ id, cwd }));
      const moment = (id, text, at, kind = 'said') => ({ id, text, at, kind });
      const ordered = rankMoments([
        moment(ids[0], 'Stripe webhooks', day(-3), 'file'),
        moment(ids[1], 'STRIPE', day(-2)), moment(ids[1], 'webhook', day(-2) + 1),
        moment(ids[2], 'stripe webhook', day(-20)),
        moment(ids[3], 'stripe', day(-2)), moment(ids[3], 'webhook', day(-20)),
      ], conversations, parseQuestion('stripe webhook last week', [cwd], now));
      check('matching joins words within one dated conversation and ranks a shared moment before newer scattered words', ordered.length === 2
        && ordered[0].id === ids[0] && ordered[1].id === ids[1]);
      const repeated = rankMoments([moment(ids[0], 'src/stripe.ts', day(-3), 'file'),
        moment(ids[0], 'src/stripe.ts', day(-3) + 1000, 'file')], conversations, parseQuestion('stripe', [cwd], now));
      check('the same file touched twice in an hour is one result moment', repeated.length === 1 && repeated[0].moments.length === 1);
      const provenance = Object.assign(Object.create(Finder.prototype), {
        conversations: { [ids[0]]: { id: ids[0], cwd, first: 0, last: 0 } },
        sources: new Map([['made-up-parent', 1], ['made-up-subagent', 1]]), recent: new Set(), marked: () => false,
      });
      const retained = {};
      const touch = called('Edit', { file_path: 'src/stripe.ts' }, day(-3));
      for (const source of ['made-up-parent', 'made-up-subagent', 'made-up-parent']) {
        await provenance.take(touch, { id: ids[0], source, generation: 1, sub: source === 'made-up-subagent' }, retained);
      }
      const evidence = Object.values(retained).flat().map((row) => JSON.parse(row));
      const together = rankMoments(evidence, conversations, parseQuestion('stripe', [cwd], now));
      provenance.sources.delete('made-up-subagent');
      const surviving = rankMoments(evidence.filter((m) => provenance.valid(m)), conversations, parseQuestion('stripe', [cwd], now));
      check('separate sources and generations keep their evidence while one displayed file touch survives a removed subagent', evidence.length === 2
        && provenance.fileKey(evidence[0]) !== provenance.fileKey(evidence[1])
        && provenance.fileKey(evidence[0]) !== provenance.fileKey({ ...evidence[0], generation: 2 })
        && together.length === 1 && together[0].moments.length === 1 && surviving.length === 1 && surviving[0].moments.length === 1
        && surviving[0].moments[0].source === 'made-up-parent');
      const delegated = matches(await search('orbital-compass'));
      check('a made-up subagent moment belongs to its parent conversation', delegated.length === 1 && delegated[0].id === ids[0]
        && delegated[0].moments[0].kind === 'looked' && delegated[0].title === titles[0]);
      check('tool results are absent from the finder', matches(await search('finder-hidden-result')).length === 0);
      const appendedAt = Date.now();
      append(files[0], [asked('finder-appended-signal', now - 1000)]);
      const grown = await until(async () => matches(await search('finder-appended-signal')).some((r) => r.id === ids[0]), 39000, 300);
      const appendMs = Date.now() - appendedAt;
      check('an appended line is found within forty seconds without asking for a scan', Boolean(grown) && appendMs <= 40000, `${appendMs} ms`);
      const before = await find.ask('status');
      await find.start(home, store, now);
      const restarted = await complete();
      check('a restarted finder keeps its positions and reads no source bytes again', Boolean(restarted) && restarted.readBytes === 0
        && Object.keys(before.positions).every((file) => restarted.positions[file] === before.positions[file])
        && matches(await search('finder-appended-signal')).some((r) => r.id === ids[0]));
      notes.find = { sourceBytes: [...files, sub].reduce((sum, file) => sum + fs.statSync(file).size, 0), indexBytes: restarted ? restarted.indexBytes : 0 };
      check('the made-up index stays under the size limit', notes.find.indexBytes > 0 && notes.find.indexBytes < 300000000,
        `${notes.find.indexBytes} index bytes for ${notes.find.sourceBytes} made-up source bytes`);
      const rows = ids.map((id, i) => ({ id, title: titles[i], prompt: 'Made-up finder fixture', cwd, project: 'pricing',
        first: i === 0 ? day(-3) : i === 2 ? day(-1) : day(-20), at: i === 0 ? now - 1000 : i === 2 ? day(-1) : day(-20), size: fs.statSync(files[i]).size }));
      installed = true;
      await inPage((list, fixedNow) => {
        const st = Desk.state;
        window.deskFindSaved = { state: { ...st }, reader: Reader.fake, history: History.fake };
        Reader.fake = () => ({ items: [], replies: [], orphans: {}, from: 0, to: 0, start: true });
        History.fake = () => ({ at: fixedNow, list, total: list.length, bytes: list.reduce((n, r) => n + r.size, 0), counting: false });
        Object.assign(st, { chats: [], view: 'peek', shown: [], recent: [], frozen: true, sel: null,
          snap: { at: fixedNow, chats: [], ended: [], leaving: [], plan: null, accounts: null },
          unread: new Set(), resumed: new Map(), res: null, usage: null });
        Desk.paint();
        return History.refresh(true);
      }, rows, now);
      await exec('Palette.open()');
      await typeInto('#palette input', question);
      const paletteReady = await until(() => exec('document.querySelectorAll("#palette .pal-find-result").length > 0'), 5000);
      const palette = await inPage(() => ({ group: [...document.querySelectorAll('#palette .pal-group')].some((el) => el.textContent === 'In past conversations'),
        rows: [...document.querySelectorAll('#palette .pal-find-result')].map((el) => ({ title: el.querySelector('.find-title')?.textContent || '',
          moment: el.querySelector('.find-moment')?.textContent || '', bold: [...el.querySelectorAll('strong')].map((part) => part.textContent.toLowerCase()) })) }));
      check('the search box shows the made-up title, edit moment and bold matches under In past conversations', Boolean(paletteReady) && palette.group
        && palette.rows.length === 1 && palette.rows[0].title === titles[0] && /edited/i.test(palette.rows[0].moment)
        && palette.rows[0].moment.includes('src/webhooks/stripe.ts') && palette.rows[0].bold.some((word) => word.includes('stripe')));
      await inPage(() => document.querySelector('#palette .pal-find-result')?.dispatchEvent(new MouseEvent('mousemove', { bubbles: true })));
      await inPage(pageKey, 'Enter', '#palette');
      check('Enter on the finder result opens that conversation for reading', Boolean(await until(() => inPage((id) => Desk.state.view === 'history'
        && Desk.History.selected() === id && document.getElementById('palette').hidden, ids[0]), 4000)));
      await typeInto('#history .filter-box input', question);
      const historyReady = await until(() => exec('document.querySelectorAll("#history .hist-find-result").length > 0'), 5000);
      const history = await inPage(() => ({ field: Boolean(document.querySelector('#history .filter-box input')),
        status: document.querySelector('#history .find-status')?.textContent || '', rows: [...document.querySelectorAll('#history .hist-find-result')].map((el) => ({
          id: el.dataset.id, title: el.querySelector('.find-title')?.textContent || '', moments: [...el.querySelectorAll('.find-moment')].map((part) => part.textContent) })) }));
      check('History shows its search field, three moments and the interpreted question with completed conversation progress', Boolean(historyReady)
        && history.field && history.rows.length === 1 && history.rows[0].id === ids[0] && history.rows[0].title === titles[0]
        && history.rows[0].moments.length === 3 && history.status.includes('since Mon 28 Sep') && history.status.includes('files')
        && history.status.includes('Read 4 of 4 conversations'));
      // the folder of conversations moved to another drive with a link left where it was: reached through a junction
      const linkedProjects = path.join(root, 'linked-home', '.claude', 'projects');
      fs.mkdirSync(path.dirname(linkedProjects), { recursive: true });
      fs.symlinkSync(path.join(home, '.claude', 'projects'), linkedProjects, 'junction');
      let throughLink = null;
      let linkedFound = [];
      try {
        await find.stop();
        await find.start(path.join(root, 'linked-home'), path.join(root, 'data', 'find-linked'), now);
        throughLink = await complete();
        linkedFound = matches(await search(question));
      } finally {
        fs.unlinkSync(linkedProjects);
      }
      check('conversations reached through a link, as after moving them to another drive, are read and found',
        Boolean(throughLink) && linkedFound.length === 1 && linkedFound[0].id === ids[0],
        `${throughLink ? throughLink.progress.files : 0} of 5 files read through the link; ${linkedFound.length} found`);
    } finally {
      try {
        if (installed) await inPage(async () => {
          const saved = window.deskFindSaved;
          if (!saved) return;
          try {
            const palette = document.querySelector('#palette input');
            palette.value = '';
            palette.dispatchEvent(new Event('input'));
            Palette.close(true);
            const field = document.querySelector('#history .filter-box input');
            field.value = '';
            field.dispatchEvent(new Event('input'));
            History.fake = () => ({ at: 1, list: [], total: 0, bytes: 0, counting: false });
            await History.refresh(true);
            History.show('');
            const detail = History.detail();
            detail.show(null, Desk.state);
            for (const el of detail.el.querySelectorAll(':scope > .d-bar, :scope > .d-head, :scope > .d-tabs, :scope > .crumb, :scope > .d-body')) el.replaceChildren();
          } finally {
            History.fake = saved.history;
            Reader.fake = saved.reader;
            Object.assign(Desk.state, saved.state);
            delete window.deskFindSaved;
            Desk.paint();
          }
        });
      } finally {
        try { await find.stop(); } finally {
          const target = path.resolve(root);
          if (!target.startsWith(path.resolve(dir) + path.sep)) throw new Error('The made-up finder folder left its output directory.');
          fs.rmSync(target, { recursive: true, force: true });
        }
      }
      const clear = await inPage((made) => !window.deskFindSaved && !made.includes(Desk.History.selected())
        && !document.querySelector('#palette .pal-find-result')
        && ![...document.querySelectorAll('#history .row')].some((el) => made.includes(el.dataset.id)), ids);
      check('the finder phase removes its made-up home, index, page overrides and worker', !fs.existsSync(root) && find.thread() === 0 && clear);
    }
  };

  const recordPhase = async () => {
    check('the window loads for the made-up record checks', Boolean(await until(() => exec('typeof Desk === "object" && Boolean(Desk.Record)'), 15000)));
    if (!check('the record starts unset in a test run', Boolean(record) && settingsNow().record.folder === '')) throw new Error('The record was not isolated for this phase.');
    const { clipboard } = require('electron');
    // what the app copies is caught on its way to the clipboard: the real clipboard and its history stay untouched
    const writeTextWas = clipboard.writeText;
    const homeDir = require('os').homedir();
    const shownAs = (p) => (p.toLowerCase().startsWith(homeDir.toLowerCase()) ? '~' + p.slice(homeDir.length) : p);
    const copied = [];
    const savedSettings = settingsNow();
    const createWas = chats.create;
    const chatIds = [...chats.all.keys()];
    const root = fs.mkdtempSync(path.join(dir, 'record-'));
    const home = path.join(root, 'record');
    const folders = ['cedar', 'birch', 'ash'].map((name) => path.join(root, 'work', name));
    const child = path.join(folders[0], 'src');
    const now = Date.now();
    const DAY = 86400e3;
    const day = (offset) => {
      const d = new Date(now); d.setDate(d.getDate() + offset);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    };
    const secret = `MADE-UP-SECRET-${Math.random().toString(36).slice(2)}`;
    const dossier = `MADE-UP-DOSSIER-${Math.random().toString(36).slice(2)}`;
    const banned = 'MADE-UP-BANNED-COPY';
    const backup = 'MADE-UP-BACKUP-COPY';
    const query = 'lantern compass';
    const longTask = 'Made-up upcoming task for Cedar. ' + 'Made-up instructions kept on the clipboard. '.repeat(32);
    const key = '72727272-2222-4333-8444-777777777771';
    const kinds = ['step', 'decision', 'fact', 'task', 'note', 'fail'];
    const rows = Array.from({ length: 120 }, (_, i) => ({ id: `record-made-${String(i).padStart(3, '0')}`,
      ts: new Date(now - 10 * DAY + i * 100 * 60000).toISOString(), type: kinds[i % kinds.length], client: ['alpha', 'beta', 'gamma'][i % 3],
      text: `Made-up record entry ${i}`, ...(i % kinds.length === 3 ? { status: 'done' } : {}) }));
    const row = (id, hours, type, client, text, more = {}) => rows.push({ id, ts: new Date(now - hours * 3600e3).toISOString(), type, client, text, ...more });
    row('record-closed-a', 30, 'task', 'alpha', 'Made-up closed alpha task', { status: 'open', due: day(-2) });
    row('record-closed-b', 29, 'task', 'beta', 'Made-up closed beta task', { status: 'doing', due: day(-1) });
    row('record-replaced', 28, 'note', 'alpha', 'Made-up replaced note');
    row('record-review', 27, 'decision', 'alpha', 'Made-up decision needing review', { review_on: day(-1) });
    row('record-replacement', 26, 'note', 'alpha', 'Made-up replacement note', { supersedes: ['record-replaced'] });
    row('record-close-a', 25, 'step', 'alpha', 'Made-up completion alpha', { re: 'record-closed-a', status: 'done' });
    row('record-close-b', 24, 'step', 'beta', 'Made-up completion beta', { re: 'record-closed-b', status: 'done' });
    row('record-task-late', 12, 'task', 'alpha', 'Made-up late task for Cedar', { status: 'blocked', due: day(-1) });
    row('record-task-soon', 11, 'task', 'alpha', longTask, { status: 'doing', due: day(2) });
    row('record-task-none', 10, 'task', 'beta', 'Made-up task without a date', { status: 'open' });
    row('record-decided', 2, 'decision', 'alpha', 'Made-up recent decision. ' + 'Made-up detail. '.repeat(32));
    row('record-failed', 1, 'fail', 'beta', 'Made-up recent failure');
    row('record-search', 0.1, 'fact', 'alpha', 'Made-up lantern compass search evidence', { tags: ['made-up', 'check'] });
    rows.sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));
    const pages = ['cedar', 'birch', 'ash'];
    const titles = ['Made-up Cedar', 'Made-up Birch', 'Made-up Ash'];
    const sourceFiles = [];
    const write = (name, text) => { const file = path.join(home, name); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); sourceFiles.push(file); };
    const pageText = [];
    const remember = async () => { pageText.push(await exec('document.body.textContent')); };
    const open = async (tab, slug = '', find = '') => {
      await inPage((tab, slug, query) => Desk.openRecord(tab, slug, query), tab, slug, find);
      await exec('Desk.Record.refresh(true)');
      if (!await until(() => exec('document.querySelector("#record .record-loading")?.textContent === ""'), 5000)) throw new Error('The made-up record page did not finish reading.');
      await drawn();
      await remember();
    };
    const syncSetting = (settings) => inPage((next) => {
      Desk.state.settings.record = next.record;
      Desk.Record.reset();
      Desk.paint();
      return Desk.refreshRecordSummary(true);
    }, settings);
    const click = (selector) => inPage((s) => { const el = document.querySelector(s); if (!el) return false; el.click(); return true; }, selector);
    let installed = false;
    let createCalls = 0;
    watch.post({ type: 'pace', ms: 600000 });
    await wait(700);
    try {
      for (const folder of [...folders, child]) fs.mkdirSync(folder, { recursive: true });
      fs.writeFileSync(path.join(root, '.git'), 'not a repository\n');
      write('log.jsonl', rows.map((r) => JSON.stringify(r)).join('\n') + '\n{"half-written":');
      write('board.json', JSON.stringify({ updated: new Date(now).toISOString(), meta: { countdowns: [{ label: 'Made-up launch', date: day(4) }], theme: 'Made-up board' },
        rock: [{ text: 'Made-up rock item' }], human: Array.from({ length: 12 }, (_, i) => ({ text: `Made-up owner item ${i + 1}`,
          urgent: [2, 5, 9].includes(i), note: `Made-up note ${i + 1}` })), delegated: [{ owner: 'Made-up helper', what: 'Made-up delegated item', status: 'doing' }],
        drip: [{ text: 'Made-up drip item' }], parked: [{ text: 'Made-up parked item' }], custom: [{ title: 'Made-up custom section', items: [{ text: 'Made-up custom item' }] }] }));
      for (let i = 0; i < pages.length; i++) write(`state/${pages[i]}.md`, `# ${titles[i]}\n\n## HARD RULES\n- Keep \`made-up-code\` and **made-up-bold**.\n- <b>not bold</b>\n\n## Where we are (${day(0)} evening)\n- Made-up ${pages[i]} status\n\n## Where we're heading\n- Made-up ${pages[i]} direction\n\n## Open loops\n- Made-up open loop\n`);
      write('state/cedar.md.bak-made-up', backup);
      write('state/cedar.banned.txt', banned);
      const dates = [
        { id: 'record-date-late', due: day(-2), label: 'Made-up late date', client: 'alpha', status: 'open' },
        { id: 'record-date-done', due: day(-1), label: 'Made-up done date', client: 'alpha', status: 'open' },
        { id: 'record-date-soon', due: day(3), label: 'Made-up soon date', client: 'beta', status: 'open' },
        { id: 'record-date-future', due: day(30), label: 'Made-up future date', client: 'alpha', status: 'open' },
        { id: 'record-date-yearly', due: day(5), label: 'Made-up yearly date', client: 'gamma', status: 'open', recur: 'yearly' },
        { id: 'record-date-close', re: 'record-date-done', status: 'done', label: 'Made-up date completion' },
      ].map((d, i) => ({ ts: new Date(now - (6 - i) * 60000).toISOString(), v: 1, kind: 'admin', recur: 'none', ...d }));
      write('streams/dates.jsonl', dates.map((d) => JSON.stringify(d)).join('\n') + '\n');
      write('opshub.toml', ['# Made-up project map', '[hub]', 'title = "MADE-UP-IGNORED-HUB"',
        ...pages.flatMap((slug, i) => [`[projects.${slug}]`, `title = "${titles[i]}" # a comment`, `folders = ${JSON.stringify([folders[i].replace(/\\/g, '/')])}`,
          `client = "${i === 1 ? 'beta' : 'alpha'}"`, `compass = "${slug}"`, `aliases = ["made-up-${slug}"]`, 'match = ["made-up"]', `quiet = ${i === 2}`]),
        '[secrets]', `api_key = "${secret}"`, '[profiles.made-up]', 'token = "MADE-UP-IGNORED-PROFILE"'].join('\n') + '\n');
      write('streams/money.jsonl', JSON.stringify({ amount: 424242.42 }) + '\n');
      write('dossier/identity.md', dossier + '\n');
      const sourceStats = sourceFiles.map((file) => ({ file, size: fs.statSync(file).size, mtime: fs.statSync(file).mtimeMs }));
      installed = true;
      await inPage((cwd, key, fixedNow) => {
        const st = Desk.state;
        window.deskRecordSaved = { state: { ...st }, reader: Reader.fake, storage: sessionStorage.getItem('desk-place') };
        Reader.fake = () => ({ items: [], replies: [], orphans: {}, from: 0, to: 0, start: true });
        Object.assign(st, { chats: [], view: 'peek', shown: [], recent: [], frozen: true, sel: null, selLeaving: '', loose: false,
          snap: { at: fixedNow, chats: [{ key, session: key, provider: 'claude', kind: 'interactive', pid: 919191, cwd,
            title: 'Made-up record chat', name: 'Made-up record chat', prompt: 'Made-up record prompt', state: 'idle', at: fixedNow,
            since: fixedNow - 60000, started: fixedNow - 60000, agents: { total: 0, running: 0, list: [] }, tokens: {}, files: { count: 0, names: [] } }],
            ended: [], leaving: [], plan: null, accounts: null }, unread: new Set(), resumed: new Map(), res: null, usage: null,
          settings: { ...st.settings, spaces: [], space: '', also: [], pins: { top: [], space: [] } } });
        Desk.paint();
      }, child, key, now);
      await syncSetting(await record.start(home));
      await open('today');
      await until(() => exec('document.querySelectorAll("#record .record-human").length === 8'), 4000);
      const footer = await inPage(() => {
        const row = document.getElementById('go-record');
        const n = document.getElementById('record-urgent');
        const places = document.querySelector('#side .places');
        const buttons = [...places.children];
        const swatch = document.createElement('span');
        swatch.style.color = 'var(--yellow)'; document.body.append(swatch);
        const expected = getComputedStyle(swatch).color; swatch.remove();
        return { shown: Boolean(row) && !row.hidden, count: n?.textContent || '', yellow: n ? getComputedStyle(n).color : '',
          expected,
          // buttons of different heights share a line when their middles do
          lines: (() => { const mid = buttons.map((el) => { const r = el.getBoundingClientRect(); return (r.top + r.bottom) / 2; }); return Math.max(...mid) - Math.min(...mid) < 6 ? 1 : 2; })(),
          fit: places.scrollWidth <= places.clientWidth + 1,
          names: [...places.querySelectorAll('.nav-item .label')].map((el) => el.textContent), tip: row?.dataset.tip || '' };
      });
      check('1. Record says three urgent items and leaves the places on one line', footer.shown && footer.count === '3' && footer.yellow === footer.expected
        && footer.lines === 1 && footer.fit && same(footer.names, ['History', 'Dashboard']) && /3/.test(footer.tip) && /12/.test(footer.tip), JSON.stringify(footer));
      await click('#record .record-human-more');
      const today = await inPage(() => ({ people: [...document.querySelectorAll('#record .record-human')].map((el) => ({ text: el.textContent, urgent: el.dataset.urgent })),
        text: document.getElementById('record').textContent, late: document.querySelector('#record .record-date[data-id="record-date-late"] .record-date-day')?.textContent,
        review: document.querySelector('#record .record-review-toggle')?.textContent || '' }));
      check('2. Today unfolds twelve owner items, puts three urgent ones first, and shows only the open dates and due review', today.people.length === 12
        && today.people.slice(0, 3).every((r) => r.urgent === 'true') && today.people.slice(3).every((r) => r.urgent !== 'true')
        && today.text.includes('Made-up late date') && today.late === 'late' && !today.text.includes('Made-up done date')
        && today.text.includes('Made-up recent decision') && /^1\b/.test(today.review));
      await shoot('record-1-today');
      await click('#record .record-review-toggle');
      await remember();
      check('the review list names the made-up overdue decision', await exec('document.querySelector("#record .record-review")?.textContent.includes("Made-up decision needing review")'));
      await open('projects');
      const projectRows = await inPage(() => [...document.querySelectorAll('#record .record-project-row')].map((el) => ({ slug: el.dataset.slug,
        cells: [...el.querySelectorAll('td')].map((td) => td.textContent), text: el.textContent })));
      check('3. Projects sort by activity, leave the quiet project last, share client tasks and count the nested chat', same(projectRows.map((r) => r.slug), pages)
        && projectRows[0].cells[2] === '2' && projectRows[1].cells[2] === '1' && projectRows[2].cells[2] === '2' && projectRows[0].cells[3] === '1');
      await shoot('record-2-projects');
      await open('projects', 'cedar');
      const document = await inPage(() => {
        const el = window.document.querySelector('#record .record-document');
        return { text: el?.textContent || '', headings: el?.querySelectorAll('h1,h2,h3,h4').length || 0,
          bullets: el?.querySelectorAll('li').length || 0, code: el?.querySelector('code')?.textContent || '',
          bold: el?.querySelector('strong')?.textContent || '', injected: Boolean(el?.querySelector('b')) };
      });
      check('4. The project status is a document of headings and bullets with literal markup and inline code', document.headings >= 3 && document.bullets >= 4
        && document.code === 'made-up-code' && document.bold === 'made-up-bold' && document.text.includes('<b>not bold</b>') && !document.injected);
      await shoot('record-3-project');
      for (const slug of pages) {
        await open('projects', slug);
        for (const tab of ['todos', 'timeline', 'dates', 'chats']) {
          await click(`#record .record-project-tab[data-tab="${tab}"]`);
          await drawn(); await remember();
        }
      }
      await open('todos');
      const todos = await inPage(() => ({ ids: [...document.querySelectorAll('#record .record-todo')].map((el) => el.dataset.id),
        board: [...document.querySelectorAll('#record .record-board-section')].map((el) => el.textContent) }));
      check('5. Only open tasks remain, due dates sort first, and every board section is shown', same(todos.ids, ['record-task-late', 'record-task-soon', 'record-task-none'])
        && todos.board.length === 6 && ['In your hands now', 'Only you can do', 'Handed to others', 'A little at a time', 'Parked', 'Made-up custom section'].every((label) => todos.board.some((s) => s.includes(label))));
      await shoot('record-4-todos');
      await open('feed');
      await shoot('record-5-feed');
      const firstFeed = await exec('[...document.querySelectorAll("#record .record-feed-row")].map((el) => el.dataset.id)');
      await click('#record .record-older');
      const older = await until(() => exec('document.querySelectorAll("#record .record-feed-row").length > 100'), 4000);
      const allFeed = await inPage(() => ({ ids: [...document.querySelectorAll('#record .record-feed-row')].map((el) => el.dataset.id),
        replaced: document.querySelector('#record .record-feed-row[data-id="record-replaced"]')?.textContent || '' }));
      for (const kind of kinds.filter((kind) => kind !== 'fail')) await click(`#record .record-kind[data-kind="${kind}"]`);
      await until(() => inPage((n) => document.querySelectorAll('#record .record-feed-row').length === n
        && [...document.querySelectorAll('#record .record-feed-row')].every((el) => el.dataset.type === 'fail'), rows.filter((r) => r.type === 'fail').length), 4000);
      const failures = await exec('[...document.querySelectorAll("#record .record-feed-row")].map((el) => el.dataset.id)');
      check('6. Feed is newest first, marks replacements, loads older records and filters kinds', firstFeed.length === 100 && firstFeed[0] === 'record-search'
        && Boolean(older) && same(allFeed.ids, rows.slice().reverse().map((r) => r.id)) && allFeed.replaced.includes('replaced')
        && failures.length > 0 && failures.every((id) => rows.find((r) => r.id === id)?.type === 'fail'));
      await remember();
      await view('peek');
      await inPage((key) => {
        const row = document.querySelector(`#chat-list [data-key="${key}"]`);
        row?.dispatchEvent(new PointerEvent('pointerover', { bubbles: true, relatedTarget: window.document.body }));
      }, key);
      const glance = await until(() => exec('[...document.querySelectorAll(".glance-card.glance-row button")].some((el) => el.textContent === "Open")'), 5000);
      const glanceText = await exec('document.querySelector(".glance-card.glance-row")?.textContent || ""');
      await inPage(() => [...document.querySelectorAll('.glance-card.glance-row button')].find((el) => el.textContent === 'Open')?.click());
      check('7. The full glance names its project and Open shows the project page', Boolean(glance) && glanceText.includes('Project') && glanceText.includes(titles[0])
        && Boolean(await until(() => exec('Desk.state.view === "record" && Boolean(document.querySelector("#record .record-document"))'), 4000)));
      await view('peek');
      await ctrl('KeyO', { shift: true });
      const keyOpened = await exec('Desk.state.view === "record"');
      await exec('Palette.open()');
      await typeInto('#palette input', 'Record:');
      const commands = await exec('[...document.querySelectorAll("#palette .pal-item .label")].map((el) => el.textContent)');
      check('8. Ctrl Shift O opens the Record and all four commands are in the palette', keyOpened && ['Record: today', 'Record: projects', 'Record: to-dos', 'Record: feed'].every((label) => commands.includes(label)));
      await exec('Palette.close(true)');
      await open('todos');
      chats.create = () => { createCalls++; throw new Error('The made-up record click tried to start a console.'); };
      await inPage(() => document.querySelector('#record .record-todo[data-id="record-task-late"] .record-start')?.focus());
      const focused = await exec('document.activeElement?.classList.contains("record-start")');
      clipboard.writeText = (text) => { copied.push(String(text)); };
      await click('#record .record-todo[data-id="record-task-late"] .record-start');
      const picker = await until(() => inPage(() => {
        const el = document.getElementById('picker');
        return !el.hidden ? { path: el.querySelector('.folders .pick .path')?.textContent || '', note: el.querySelector('.pick-note')?.textContent || '' } : null;
      }), 4000);
      check('13. Starting from a task copies it and opens the picker with its folder first, without starting a chat', focused && copied[copied.length - 1] === 'Made-up late task for Cedar'
        && picker && picker.path === shownAs(folders[0]) && picker.note === 'The to-do is on the clipboard: Ctrl+V pastes it into the new chat.' && createCalls === 0 && same([...chats.all.keys()], chatIds),
        JSON.stringify({ focused, copied: copied.map((t) => t.slice(0, 40)), picker, expected: folders[0], createCalls }));
      await exec('Picker.close()');
      await open('projects', 'cedar');
      await click('#record .record-project-tab[data-tab="todos"]');
      const taskPreview = await exec('document.querySelector("#record .record-todo[data-id=record-task-soon] .record-text")?.textContent || ""');
      await click('#record .record-todo[data-id="record-task-soon"] .record-start');
      check('the project task copies its full text beyond the shortened row and opens the picker without starting a chat', Boolean(await until(() => exec('Picker.isOpen()'), 4000))
        && taskPreview.length > 0 && taskPreview.length <= 600 && taskPreview.length < longTask.length && copied[copied.length - 1] === longTask && createCalls === 0 && same([...chats.all.keys()], chatIds));
      await exec('Picker.close()');
      chats.create = createWas;
      await exec('Palette.open()');
      await typeInto('#palette input', query);
      const matched = await until(() => exec('document.querySelectorAll("#palette [data-record-id]").length > 0'), 4000);
      const search = await inPage(() => ({ group: [...document.querySelectorAll('#palette .pal-group')].some((el) => el.textContent === 'In your record'),
        rows: [...document.querySelectorAll('#palette [data-record-id]')].map((el) => ({ text: el.textContent, bold: [...el.querySelectorAll('strong')].map((s) => s.textContent.toLowerCase()) })) }));
      await click('#palette [data-record-id]');
      const feedSearch = await until(() => inPage((query) => Desk.state.view === 'record' && document.querySelector('#record .record-query')?.value === query
        && [...document.querySelectorAll('#record .record-feed-row')].some((el) => el.dataset.id === 'record-search'), query), 4000);
      const emptySearch = [];
      for (const q of [secret, '424242.42', dossier]) emptySearch.push(await inPage((query) => desk.record({ part: 'search', query }), q));
      check('14. Two words find a highlighted record and open a filtered Feed while forbidden files stay unsearchable', Boolean(matched) && search.group && search.rows.length === 1
        && search.rows[0].text.includes('Made-up lantern compass') && ['lantern', 'compass'].every((word) => search.rows[0].bold.includes(word)) && Boolean(feedSearch)
        && emptySearch.every((answer) => answer && answer.ready !== false && Array.isArray(answer.records) && answer.records.length === 0));
      await remember();
      const forbidden = [secret, '424242.42', dossier, backup, banned, 'MADE-UP-IGNORED-HUB', 'MADE-UP-IGNORED-PROFILE'];
      const logText = record.log();
      const answers = JSON.stringify(record.answers());
      check('9. Page text, every record answer and the desk log contain none of the forbidden fixture words', record.answers().length > 0
        && forbidden.every((word) => pageText.every((text) => !text.includes(word)) && !answers.includes(word) && !logText.includes(word)));
      check('10. Every made-up record file keeps its size and write time', sourceStats.every((before) => { const after = fs.statSync(before.file); return after.size === before.size && after.mtimeMs === before.mtime; }));
      // a record folder in the home folder is often a junction to another drive
      const linked = path.join(root, 'linked');
      let throughLink = null;
      try {
        fs.symlinkSync(home, linked, 'junction');
        await syncSetting(await record.start(linked));
        throughLink = await inPage(() => desk.record({ part: 'summary' }));
      } finally {
        try { fs.unlinkSync(linked); } catch { /* never made */ }
        await syncSetting(await record.start(home));
      }
      check('the record is read through a folder that is a junction to it', Boolean(throughLink) && throughLink.set === true && throughLink.urgent === 3,
        JSON.stringify(throughLink));
      let refused = false;
      try { await record.start(path.dirname(path.resolve(dir))); } catch { refused = true; }
      await syncSetting(await record.stop());
      await open('today');
      const unset = await inPage(() => ({ text: document.getElementById('record').textContent, hidden: document.getElementById('go-record').hidden }));
      check('11. Main refuses folders outside this run and an unset Record points to Settings with no sidebar row', refused && unset.hidden && /settings/i.test(unset.text));
    } finally {
      chats.create = createWas;
      clipboard.writeText = writeTextWas;
      try {
        const restored = savedSettings.record.folder ? await record.start(savedSettings.record.folder) : await record.stop();
        if (installed) await inPage((settings) => {
          const saved = window.deskRecordSaved;
          if (!saved) return;
          try {
            Palette.close(true); Picker.close(); Desk.Glance.hide(); Desk.Record.reset();
            Reader.fake = saved.reader;
            Object.assign(Desk.state, saved.state);
            Desk.state.settings.record = settings.record;
            const search = document.querySelector('#palette input');
            search.value = ''; search.dispatchEvent(new Event('input'));
            for (const el of document.querySelectorAll('#picker .folders, #picker .recent')) el.replaceChildren();
            document.querySelector('#picker .pick-note').textContent = '';
            Desk.Record.reset();
            Desk.setView(saved.state.view);
            Desk.paint();
          } finally {
            if (saved.storage === null) sessionStorage.removeItem('desk-place'); else sessionStorage.setItem('desk-place', saved.storage);
            delete window.deskRecordSaved;
          }
        }, restored);
      } finally {
        const target = path.resolve(root);
        if (!target.startsWith(path.resolve(dir) + path.sep)) throw new Error('The made-up record folder left its output directory.');
        fs.rmSync(target, { recursive: true, force: true });
        watch.post({ type: 'pace', ms: 2000 });
      }
      const clear = await inPage((key) => !window.deskRecordSaved && !Desk.state.snap.chats.some((c) => c.key === key)
        && !document.querySelector(`#chat-list [data-key="${key}"]`) && !document.querySelector('#record .record-feed-row')
        && !document.querySelector('#palette [data-record-id]') && !document.body.textContent.includes('Made-up lantern compass'), key);
      check('12. The phase removes its fixtures and overrides, restores settings and never wrote to the real clipboard', !fs.existsSync(root) && clear
        && same(settingsNow().record, savedSettings.record) && chats.create === createWas && same([...chats.all.keys()], chatIds)
        && clipboard.writeText === writeTextWas);
    }
  };

  // ---- the Nest: the chat of the record, big, with the day beside it. A made-up record in this run's folder, plain
  // ---- consoles standing in for chats, made-up sessions for the column, the logo, the Nest asked for the way main
  // ---- asks for it (its key in another program, the tray, the taskbar), its key in the window, Settings and the search
  // ---- box. No agent is started, and the key itself is never pressed: a hidden window holds none, and a press from
  // ---- another program brings the window up on the person's screen. ----
  const nestPhase = async () => {
    check('the window loads for the Nest checks', Boolean(await until(() => exec('typeof Desk === "object" && Desk !== null && Boolean(Desk.Nest)'), 15000)));
    if (!nest || !record) throw new Error('This run has no Nest or record hooks.');
    if (!check('the record starts unset in a test run', settingsNow().record.folder === '')) throw new Error('The record was not isolated for this phase.');
    check("1. A hidden window never takes the Nest's key from the person's own: the switch stays on, the key is not held",
      nest.keyState() === 'off' && settingsNow().nestKey === true, nest.keyState());
    const savedSettings = settingsNow();
    const createWas = chats.create;
    const chatIds = [...chats.all.keys()];
    const root = fs.mkdtempSync(path.join(dir, 'nest-'));
    const home = path.join(root, 'record');
    const linked = path.join(root, 'linked');
    const work = path.join(root, 'work');
    const now = Date.now();
    const day = (offset) => {
      const d = new Date(now); d.setDate(d.getDate() + offset);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    };
    const write = (name, text) => { const file = path.join(home, name); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); };
    // a made-up conversation of the record that runs in another terminal, and one elsewhere that waits for the person
    const away = '72727272-2222-4333-8444-777777777791';
    const asks = '72727272-2222-4333-8444-777777777792';
    const sync = (settings) => inPage((next) => { Desk.state.settings.record = next.record; Desk.paint(); return true; }, settings);
    const click = (selector) => inPage((s) => { const el = document.querySelector(s); if (!el) return false; el.click(); return true; }, selector);
    const offer = (words) => inPage((w) => {
      const el = [...document.querySelectorAll('#nest .nest-offer button')].find((b) => b.textContent === w);
      if (el) el.click();
      return Boolean(el);
    }, words);
    // Ctrl Shift Space as the window hears it while no program holds the key
    const press = () => inPage(() => document.body.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', code: 'Space', ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true })));
    const look = () => inPage(() => {
      const shown = (id) => { const el = document.getElementById(id); return Boolean(el) && !el.hidden; };
      const parts = (sel) => Object.fromEntries([...document.querySelectorAll(`${sel} .nest-part`)].map((p) => [
        (p.querySelector('.nest-label') || {}).textContent || '?',
        { items: [...p.querySelectorAll('.nest-text, .nest-chat-name')].map((el) => el.textContent), on: [...p.querySelectorAll('.nest-on')].map((el) => el.textContent),
          more: (p.querySelector('.nest-more') || {}).textContent || '', urgent: p.querySelectorAll('.nest-item[data-urgent="true"] .g-needs').length }]));
      const brand = document.getElementById('brand');
      return { nest: Desk.state.nest, view: Desk.state.view, from: Desk.state.nestFrom, page: shown('nest'), rail: shown('nest-rail'), inspector: shown('inspector'),
        lit: brand.classList.contains('on'), pressed: brand.getAttribute('aria-pressed'), crumb: document.getElementById('crumb').textContent,
        screen: Desk.onScreen(), own: (Desk.nestChat() || {}).id || '', pageParts: parts('#nest'), railParts: parts('#nest-rail'),
        pageText: document.getElementById('nest').textContent, offers: [...document.querySelectorAll('#nest .nest-offer button')].map((el) => el.textContent),
        armed: [...Desk.state.armed] };
    });
    const part = (parts, name) => parts[name] || { items: [], on: [], more: '', urgent: 0 };
    let installed = false;
    const asked = [];
    watch.post({ type: 'pace', ms: 600000 });
    await wait(700);
    try {
      fs.mkdirSync(work, { recursive: true });
      write('log.jsonl', [
        { id: 'nest-task-due', ts: new Date(now - 3600e3).toISOString(), type: 'task', client: 'alpha', text: 'Made-up Nest task due soon', status: 'open', due: day(1) },
        { id: 'nest-note', ts: new Date(now - 1800e3).toISOString(), type: 'note', client: 'alpha', text: 'Made-up Nest note' },
      ].map((r) => JSON.stringify(r)).join('\n') + '\n');
      write('board.json', JSON.stringify({ updated: new Date(now).toISOString(), meta: { countdowns: [{ label: 'Made-up Nest countdown', date: day(4) }] },
        rock: [], human: Array.from({ length: 7 }, (_, i) => ({ text: `Made-up Nest owner item ${i + 1}`, urgent: i === 3, note: `Made-up Nest note ${i + 1}` })),
        delegated: [], drip: [], parked: [], custom: [] }));
      write('streams/dates.jsonl', [
        { id: 'nest-date-late', due: day(-1), label: 'Made-up late Nest date', client: 'alpha', status: 'open' },
        { id: 'nest-date-soon', due: day(2), label: 'Made-up soon Nest date', client: 'alpha', status: 'open' },
      ].map((d, i) => JSON.stringify({ ts: new Date(now - (3 - i) * 60000).toISOString(), v: 1, kind: 'admin', recur: 'none', ...d })).join('\n') + '\n');
      installed = true;
      await inPage((fixedNow, homeDir, workDir, awayKey, asksKey) => {
        const st = Desk.state;
        window.deskNestSaved = { state: { ...st }, storage: sessionStorage.getItem('desk-place') };
        const made = (key, cwd, title, state, more) => ({ key, session: key, provider: 'claude', kind: 'interactive', pid: 919191, cwd, title, name: title,
          prompt: 'Made-up prompt', state, at: fixedNow, since: fixedNow - 60000, started: fixedNow - 60000, agents: { total: 0, running: 0, list: [] }, tokens: {},
          files: { count: 0, names: [] }, ...more });
        Object.assign(st, { view: 'peek', shown: [], recent: [], frozen: true, sel: null, loose: false, nest: false, nestFrom: '',
          snap: { at: fixedNow, chats: [made(awayKey, homeDir, 'Made-up Nest chat elsewhere', 'idle', {}),
            made(asksKey, workDir, 'Made-up waiting chat', 'attention', { waiting: 'permission prompt', pid: 929292 })], ended: [], leaving: [], plan: null, accounts: null },
          unread: new Set(), armed: new Set(), armedAs: new Map(),
          settings: { ...st.settings, inspector: true, spaces: [], space: '', also: [], pins: { top: [], space: [] } } });
        Desk.paint();
        return true;
      }, now, home, work, away, asks);
      await sync(await record.start(home));

      await inPage(() => { Desk.openNest(); return true; });
      const first = await until(async () => { const v = await look(); return v.pageParts['Only you'] && v.pageParts['Waiting for you'] ? v : null; }, 6000) || await look();
      check('2. With no chat of this window in the record, the Nest opens on its own page: the logo lit, the head saying Nest, nothing else on screen',
        first.nest && first.view === 'nest' && first.page && !first.rail && first.lit && first.pressed === 'true' && /^Nest/.test(first.crumb) && first.screen.length === 0,
        JSON.stringify({ view: first.view, page: first.page, rail: first.rail, lit: first.lit, crumb: first.crumb }));
      await shoot('nest-1-page');
      const only = part(first.pageParts, 'Only you');
      const coming = part(first.pageParts, 'Coming up');
      check('3. Beside it the day: what only he can do (urgent first, five shown, the rest counted), the dates (late ones first), the to-dos due, the chats that wait',
        only.items.length === 5 && only.items[0] === 'Made-up Nest owner item 4' && only.urgent === 1 && only.more === '2 more in the Record'
        && coming.items.join('|') === 'Made-up late Nest date|Made-up soon Nest date|Made-up Nest countdown' && coming.on[0] === 'late'
        && part(first.pageParts, 'To-dos due').items.join('|') === 'Made-up Nest task due soon'
        && part(first.pageParts, 'Waiting for you').items.join('|') === 'Made-up waiting chat',
        JSON.stringify(first.pageParts));
      check("4. The record's chat running in another terminal is offered to come here, or a new one started instead",
        first.pageText.includes('Made-up Nest chat elsewhere') && first.offers.join('|') === 'Bring it here|Start a new one here instead', JSON.stringify(first.offers));
      await offer('Bring it here');
      const brought = await until(async () => { const v = await look(); return v.armed.includes(away) && v.pageText.includes('/exit') ? v : null; }, 3000) || await look();
      check('5. "Bring it here" marks it to open here once it ends over there, and the page says how to end it',
        brought.armed.includes(away) && brought.pageText.includes('/exit') && !brought.offers.includes('Bring it here'),
        JSON.stringify({ armed: brought.armed.length, offers: brought.offers }));
      await inPage((key) => { Desk.disarm(key); return true; }, away);

      // what starting the Nest's chat asks main for, caught before anything starts
      chats.create = (opts) => { asked.push({ cwd: opts.cwd, starter: opts.starter, title: opts.title, named: opts.named }); return { id: 'made-up-never-started' }; };
      try {
        await offer('Start a new one here instead');
        await until(() => asked.length > 0, 3000);
      } finally {
        chats.create = createWas;
      }
      const via = asked.length ? await inPage((id) => ((Desk.state.info.starters || []).find((s) => s.id === id) || {}).agent || '', asked[0].starter) : '';
      check("6. Starting the Nest's chat asks for Claude Code in the record's folder, named Nest (caught here before anything starts)",
        asked.length === 1 && path.resolve(asked[0].cwd) === path.resolve(home) && via === 'claude' && asked[0].title === 'Nest' && asked[0].named === true,
        JSON.stringify(asked.map((a) => ({ claude: via === 'claude', title: a.title, named: a.named }))));

      const own = await inPage((cwd) => desk.create({ cwd, starter: 'shell', title: 'Nest', named: true }), home);
      const ownId = own && own.id ? own.id : '';
      const inside = await until(async () => {
        const v = await look();
        return ownId && v.view === ownId && v.rail && part(v.railParts, 'Only you').items.length ? v : null;
      }, 8000) || await look();
      check('7. A chat that starts in the record while the Nest waits becomes the Nest: alone on screen, the day beside it where the side panel would be',
        Boolean(ownId) && inside.nest && inside.view === ownId && inside.own === ownId && !inside.page && inside.rail && !inside.inspector
        && inside.screen.length === 1 && inside.screen[0] === ownId && part(inside.railParts, 'Only you').items.length === 5
        && part(inside.railParts, 'Waiting for you').items.join('|') === 'Made-up waiting chat' && /^Nest/.test(inside.crumb),
        JSON.stringify({ view: inside.view === ownId, page: inside.page, rail: inside.rail, inspector: inside.inspector, screen: inside.screen.length, crumb: inside.crumb }));
      // the Nest's mood (his ask, 5 Oct: "a cute space to retreat mentally in"): the window's colours, its chat's terminal,
      // a word for the hour with its face, the slow lights, and the nest icon by its name
      const mood = () => inPage((id) => {
        const t = Terms.get(id);
        const rail = document.getElementById('nest-rail');
        return { nest: document.documentElement.dataset.nest || '', ground: t ? t.term.options.theme.background : '', panel: getComputedStyle(document.body).getPropertyValue('--panel').trim(),
          root: getComputedStyle(document.documentElement).getPropertyValue('--panel').trim(), lights: rail.querySelectorAll('.nest-air i').length,
          hello: (rail.querySelector('.nest-hello') || {}).textContent || '', icons: [Boolean(document.querySelector('#go-nest svg.i')), Boolean(rail.querySelector('.nest-brand svg.i'))] };
      }, ownId);
      const warm = await until(async () => { const m = await mood(); return m.nest === 'lamp' && m.lights ? m : null; }, 3000) || await mood();
      check('7e. In the Nest the window takes its warm mood (Lamp, until Settings says otherwise): its colours, its chat\'s terminal on the same ground, a word for the time of day with its face, nine slow lights in the column, the nest icon by its name in the list and in the column',
        warm.nest === 'lamp' && warm.ground === '#15100c' && warm.panel === '#15100c' && warm.root !== '#15100c' && warm.lights === 9
        && ['Good morning', 'Good afternoon', 'Good evening', 'Late night, go easy'].some((w) => warm.hello.startsWith(w) && warm.hello.length > w.length + 3)
        && warm.icons.every(Boolean), JSON.stringify(warm));
      await wait(1500);
      await shoot('nest-2-chat');
      await inPage(() => { Desk.state.settings.nestLook = 'night'; Desk.paint(); return true; });
      const night = await until(async () => { const m = await mood(); return m.nest === 'night' ? m : null; }, 3000) || await mood();
      await wait(900);
      await shoot('nest-2-night');
      await inPage(() => { Desk.state.settings.nestLook = 'plain'; Desk.paint(); return true; });
      const plain = await until(async () => { const m = await mood(); return m.nest === '' ? m : null; }, 3000) || await mood();
      await inPage(() => { Desk.state.settings.nestLook = 'lamp'; Desk.paint(); return true; });
      check('7f. Night: the calm blue-green mood on the window and its chat\'s terminal, with its lights; Like the rest: the window\'s own look, the terminal on the common ground, no lights, no greeting',
        night.nest === 'night' && night.ground === '#0a1215' && night.panel === '#0a1215' && night.lights === 9
        && plain.nest === '' && plain.ground === plain.root && plain.panel === plain.root && plain.lights === 0 && plain.hello === '', JSON.stringify({ night, plain }));
      await inPage(() => Browser.toggle(true).then(() => true));
      await wait(900);
      await shoot('nest-3-browser');

      // the widths: the chat keeps 420 px whatever opens beside it, and each edge can be dragged
      const sized = () => inPage((id) => {
        const w = (el) => (el && !el.hidden && getComputedStyle(el).display !== 'none' ? Math.round(el.getBoundingClientRect().width) : 0);
        return { tile: w(document.querySelector(`#tiles .tile[data-id="${id}"]`)), rail: w(document.getElementById('nest-rail')), web: Browser.width(), side: Sizes.sideWidth(),
          kept: { side: kept.get('side-w', ''), rail: kept.get('rail-w', ''), web: kept.get('web-w', ''), day: kept.get('nest-day', '') } };
      }, ownId);
      // a press on a grip, moved dx pixels and let go
      const dragGrip = (selector, dx) => inPage(async (sel, d) => {
        const el = document.querySelector(sel);
        if (!el) return false;
        const r = el.getBoundingClientRect();
        const x = r.left + r.width / 2;
        const y = r.top + r.height / 2;
        const ev = (type, cx) => el.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, button: 0, buttons: type === 'pointerup' ? 0 : 1, clientX: cx, clientY: y, pointerId: 1, isPrimary: true }));
        const pause = () => new Promise((done) => setTimeout(done, 60));
        ev('pointerdown', x);
        await pause();
        ev('pointermove', x + d / 2);
        ev('pointermove', x + d);
        await pause();
        ev('pointerup', x + d);
        await pause();
        return true;
      }, selector, dx);
      const twice = (selector) => inPage((sel) => { const el = document.querySelector(sel); if (el) el.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true })); return Boolean(el); }, selector);
      const withWeb = await sized();
      check('7a. With the browser open beside the Nest, its chat keeps at least 420 px, and its day keeps 260 px or more, or steps aside',
        withWeb.tile >= 420 && (withWeb.rail >= 260 || withWeb.rail === 0) && withWeb.web >= 380, JSON.stringify(withWeb));
      await inPage(() => Browser.toggle(false).then(() => true));
      await wait(700);
      const sizeWas = win.getContentSize();
      win.setContentSize(1700, 900);
      await wait(400);
      try {
        await inPage(() => Browser.toggle(true).then(() => true));
        await wait(900);
        const webOpen = await sized();
        await dragGrip('.web-grip', 100);
        const webDragged = await sized();
        await twice('.web-grip');
        await wait(150);
        const webReset = await sized();
        check('7b. The Browser\'s edge, dragged, moves where it is let go, the chat takes the room, and that is kept; double-clicked, it goes back to its usual width',
          Math.abs(webDragged.web - (webOpen.web - 100)) <= 2 && webDragged.tile > webOpen.tile && webDragged.kept.web === String(webDragged.web) && webReset.web === webOpen.web && webReset.kept.web === '0',
          JSON.stringify({ web: [webOpen.web, webDragged.web, webReset.web], tile: [webOpen.tile, webDragged.tile], kept: [webDragged.kept.web, webReset.kept.web] }));
        await inPage(() => Browser.toggle(false).then(() => true));
        await wait(700);
        const before = await sized();
        await dragGrip('#side-grip', 60);
        const sideDragged = await sized();
        await twice('#side-grip');
        const sideReset = await sized();
        await dragGrip('#panel-grip', -80);
        const railDragged = await sized();
        await twice('#panel-grip');
        const railReset = await sized();
        check('7c. The list\'s edge and the day\'s edge move where they are dragged and are kept, and go back to their usual width with a double-click; the chat keeps at least 420 px throughout',
          sideDragged.side === before.side + 60 && sideDragged.kept.side === String(before.side + 60) && sideReset.side === 280 && sideReset.kept.side === '0'
          && Math.abs(railDragged.rail - (before.rail + 80)) <= 2 && railDragged.kept.rail === String(railDragged.rail) && Math.abs(railReset.rail - before.rail) <= 2 && railReset.kept.rail === '0'
          && [before, sideDragged, sideReset, railDragged, railReset].every((s) => s.tile >= 420),
          JSON.stringify({ side: [before.side, sideDragged.side, sideReset.side], rail: [before.rail, railDragged.rail, railReset.rail], tiles: [before.tile, sideDragged.tile, railDragged.tile], kept: [sideDragged.kept, railReset.kept] }));
        // in the Nest the panel button shows and hides the day
        const dayButton = `#tiles .tile[data-id="${ownId}"] .th-tools button[title^="Show or hide your day"]`;
        const pressed = () => inPage((sel) => { const b = document.querySelector(sel); return b ? b.getAttribute('aria-pressed') : ''; }, dayButton);
        await click(dayButton);
        const dayOff = await sized();
        const offPressed = await pressed();
        await click(dayButton);
        const dayOn = await sized();
        const onPressed = await pressed();
        check('7d. In the Nest the panel button on the chat\'s strip shows and hides the day beside it, and that is kept',
          dayOff.rail === 0 && offPressed === 'false' && dayOff.kept.day === '0' && dayOn.rail >= 260 && onPressed === 'true' && dayOn.kept.day === '1',
          JSON.stringify({ off: [dayOff.rail, offPressed, dayOff.kept.day], on: [dayOn.rail, onPressed, dayOn.kept.day] }));
      } finally {
        win.setContentSize(sizeWas[0], sizeWas[1]);
        await inPage(() => { for (const k of ['side-w', 'rail-w', 'web-w']) kept.set(k, '0'); kept.set('nest-day', '1'); return true; });
        await wait(300);
      }

      const other = await inPage((cwd) => desk.create({ cwd, starter: 'shell' }), work);
      const otherId = other && other.id ? other.id : '';
      await until(() => inPage((id) => Desk.state.chats.some((c) => c.id === id), otherId), 4000);
      const stays = await look();
      await inPage((id) => { Desk.setView(id); return true; }, otherId);
      const left = await look();
      check('8. A chat opening elsewhere leaves the Nest as it is; going to it closes the Nest, the logo goes dark and the side panel comes back',
        Boolean(otherId) && stays.nest && stays.view === ownId && !left.nest && left.view === otherId && !left.rail && !left.lit && left.pressed === 'false'
        && left.inspector && !/^Nest/.test(left.crumb),
        JSON.stringify({ stays: stays.view === ownId, left: left.view === otherId, rail: left.rail, lit: left.lit, inspector: left.inspector }));
      const out8 = await mood();
      const otherGround = await inPage((id) => { const t = Terms.get(id); return t ? t.term.options.theme.background : ''; }, otherId);
      check('8a. Out of the Nest the window has its own colours back, and another chat\'s terminal never took the Nest\'s',
        out8.nest === '' && out8.panel === out8.root && otherGround === out8.root, JSON.stringify({ nest: out8.nest, panel: out8.panel, root: out8.root, other: otherGround }));

      nest.open('open');
      const called = await until(async () => { const v = await look(); return v.nest ? v : null; }, 3000) || await look();
      nest.open('toggle');
      const back = await until(async () => { const v = await look(); return !v.nest ? v : null; }, 3000) || await look();
      check('9. Asked for by main (its key from another program, the tray, the taskbar), the Nest opens on its chat; the key again goes back to where the window was, and a hidden window stays hidden',
        called.nest && called.view === ownId && called.from === otherId && !back.nest && back.view === otherId && !win.isVisible(),
        JSON.stringify({ called: called.view === ownId, from: called.from === otherId, back: back.view === otherId, visible: win.isVisible() }));

      await click('#brand');
      const bird = await look();
      await press();
      const key = await look();
      await press();
      const keyAgain = await look();
      await click('#brand');
      const birdOff = await look();
      check('10. The logo opens and closes the Nest, and so does Ctrl Shift Space in the window',
        bird.nest && bird.view === ownId && !key.nest && key.view === otherId && keyAgain.nest && keyAgain.view === ownId && !birdOff.nest && birdOff.view === otherId,
        JSON.stringify([bird.nest, key.nest, keyAgain.nest, birdOff.nest]));
      const rowWas = await exec('Boolean(document.getElementById("go-nest")) && !document.getElementById("go-nest").hidden && !document.getElementById("go-nest").classList.contains("on")');
      await click('#go-nest');
      const byRow = await look();
      const rowLit = await exec('document.getElementById("go-nest").classList.contains("on")');
      await click('#brand');
      const rowOff = await look();
      check('10a. "Nest" in the sidebar, a door that can be seen, opens it too and is lit while it is open',
        rowWas && byRow.nest && byRow.view === ownId && rowLit && !rowOff.nest && rowOff.view === otherId,
        JSON.stringify({ rowWas, opened: byRow.nest, onItsChat: byRow.view === ownId, lit: rowLit, closed: !rowOff.nest }));

      await inPage((id) => { Desk.setView(id); return true; }, ownId);
      const picked = await look();
      await inPage(() => { Desk.leaveNest(); return true; });
      const apart = await look();
      check("10b. The record's chat picked from anywhere opens in the Nest, and outside it never takes a place among the chats side by side",
        picked.nest && picked.view === ownId && picked.from === otherId && !apart.nest && apart.view === otherId && !apart.screen.includes(ownId),
        JSON.stringify({ picked: picked.nest, from: picked.from === otherId, back: apart.view === otherId, screen: apart.screen.length }));

      // 10c. The Nest's answer is said when it finishes while another page is in front (his ask, 4 Oct); with the Nest in
      // front, nothing is said. Main is handed a made-up row of the Nest's chat that works, then rests.
      const nestTurn = (key, state) => [{ key, session: key, provider: 'claude', pid: 1, kind: 'interactive', chat: ownId, state,
        words: 'Made-up Nest answer: three things for today.', at: Date.now(), since: Date.now() }];
      const toastNow = () => inPage(() => { const t = document.getElementById('toast'); return t && !t.hidden ? t.textContent : ''; });
      const hideToast = () => inPage(() => { document.getElementById('toast').hidden = true; return true; });
      await hideToast();
      nest.track(nestTurn('made-up-nest-turn-1', 'working'));
      nest.track(nestTurn('made-up-nest-turn-1', 'idle'));
      const saidAway = await until(toastNow, 3000) || '';
      await inPage((id) => { Desk.setView(id); return true; }, ownId);
      await hideToast();
      nest.track(nestTurn('made-up-nest-turn-2', 'working'));
      nest.track(nestTurn('made-up-nest-turn-2', 'idle'));
      await wait(700);
      const saidInNest = await toastNow();
      await inPage(() => { Desk.leaveNest(); return true; });
      await hideToast();
      check('10c. When the Nest finishes an answer while another page is in front, the window says so with the start of the answer and the key that opens it; with the Nest in front, nothing is said',
        saidAway === 'The Nest answered: Made-up Nest answer: three things for today. Ctrl Shift Space opens it.' && saidInNest === '' && settingsNow().notify.nest === true,
        JSON.stringify({ saidAway, saidInNest }));

      const setting = () => inPage(() => {
        const el = document.querySelector('#settings section[data-section="nest"]');
        const sw = el && el.querySelector('.switch');
        return el && sw ? { on: sw.getAttribute('aria-checked'), text: el.textContent } : null;
      });
      const flip = () => inPage(() => { const row = document.querySelector('#settings section[data-section="nest"] .set-row'); if (row) row.click(); return Boolean(row); });
      await inPage(() => { Settings.open('nest'); return true; });
      const s1 = await until(setting, 3000);
      await flip();
      const s2 = await until(async () => { const v = await setting(); return v && v.on === 'false' ? v : null; }, 3000) || await setting();
      const offKept = settingsNow().nestKey;
      await flip();
      const s3 = await until(async () => { const v = await setting(); return v && v.on === 'true' ? v : null; }, 3000) || await setting();
      await inPage(() => { Settings.close(); return true; });
      check("11. Settings has the Nest's switch: off, the key works only in the window, and that is kept; on again, kept too",
        Boolean(s1) && s1.on === 'true' && s1.text.includes('Ctrl Shift Space') && Boolean(s2) && s2.on === 'false' && s2.text.includes('only while this window is in front')
        && offKept === false && Boolean(s3) && s3.on === 'true' && settingsNow().nestKey === true && nest.keyState() === 'off',
        JSON.stringify({ s1: s1 && s1.on, s2: s2 && s2.on, offKept, s3: s3 && s3.on, key: nest.keyState() }));
      const lookRow = () => inPage(() => {
        const row = [...document.querySelectorAll('#settings section[data-section="nest"] .set-row')].find((r) => (r.querySelector('.what > div') || {}).textContent === 'Its look');
        return row ? [...row.querySelectorAll('.seg button')].map((b) => b.textContent + (b.classList.contains('on') ? '*' : '')) : null;
      });
      const pickLook = (name) => inPage((n) => { const b = [...document.querySelectorAll('#settings section[data-section="nest"] .seg button')].find((x) => x.textContent === n); if (b) b.click(); return Boolean(b); }, name);
      await inPage(() => { Settings.open('nest'); return true; });
      const look1 = await until(lookRow, 3000);
      await pickLook('Night');
      const look2 = await until(async () => { const v = await lookRow(); return v && v.includes('Night*') ? v : null; }, 3000) || await lookRow();
      const nightKept = settingsNow().nestLook;
      await pickLook('Lamp');
      const look3 = await until(async () => { const v = await lookRow(); return v && v.includes('Lamp*') ? v : null; }, 3000) || await lookRow();
      await inPage(() => { Settings.close(); return true; });
      check('11a. Settings has the Nest\'s look: Lamp, Night or Like the rest, Lamp until another is picked, and a pick is kept',
        same(look1, ['Lamp*', 'Night', 'Like the rest']) && same(look2, ['Lamp', 'Night*', 'Like the rest']) && nightKept === 'night'
        && same(look3, ['Lamp*', 'Night', 'Like the rest']) && settingsNow().nestLook === 'lamp', JSON.stringify({ look1, look2, nightKept, look3 }));

      const findNest = () => inPage(() => {
        const hit = [...document.querySelectorAll('#palette .pal-item')].find((el) => ((el.querySelector('.label') || {}).textContent || '').startsWith('The Nest'));
        return hit ? hit.textContent : null;
      });
      await exec('Palette.open()');
      await typeInto('#palette input', 'nest');
      const pal = await until(findNest, 3000);
      await inPage(() => {
        const hit = [...document.querySelectorAll('#palette .pal-item')].find((el) => ((el.querySelector('.label') || {}).textContent || '').startsWith('The Nest'));
        if (hit) hit.click();
        return Boolean(hit);
      });
      const byPal = await look();
      await exec('Palette.open()');
      await typeInto('#palette input', 'nest');
      const leaveRow = await until(() => inPage(() => [...document.querySelectorAll('#palette .pal-item .label')].some((el) => el.textContent === 'Leave the Nest')), 3000);
      await inPage(() => { Palette.close(true); Desk.leaveNest(); return true; });
      check('12. The search box finds the Nest with its key and opens it, and from inside offers to leave it',
        Boolean(pal) && pal.includes('Ctrl Shift Space') && byPal.nest && byPal.view === ownId && Boolean(leaveRow),
        JSON.stringify({ found: Boolean(pal), nest: byPal.nest, leave: Boolean(leaveRow) }));

      // the person's own record is a junction to another drive: main names both ends, and a chat in either is the Nest's
      let throughLink = null;
      try {
        fs.symlinkSync(home, linked, 'junction');
        await sync(await record.start(linked));
        const folders = nest.folders();
        const ends = [path.resolve(linked), fs.realpathSync.native(home)].map((f) => f.toLowerCase()).sort().join('|');
        throughLink = await inPage((list, id) => {
          const was = Desk.state.info.nest;
          Desk.state.info.nest = { folders: [], asked: false };
          const without = (Desk.nestChat() || {}).id || '';
          Desk.state.info.nest = { folders: list, asked: false };
          const found = (Desk.nestChat() || {}).id === id;
          Desk.state.info.nest = was;
          return { without, found };
        }, folders, ownId);
        throughLink.both = folders.map((f) => path.resolve(f).toLowerCase()).sort().join('|') === ends;
      } finally {
        try { fs.unlinkSync(linked); } catch { /* never made */ }
        await sync(await record.start(home));
      }
      check("13. With the record set through a junction, main names both of its folders, and a chat in the real one is the Nest's",
        Boolean(throughLink) && throughLink.both && throughLink.without === '' && throughLink.found, JSON.stringify(throughLink));

      await inPage((id) => Desk.closeChat(id), otherId);
      const gone = await until(async () => { const v = await look(); return v.view !== otherId ? v : null; }, 6000) || await look();
      check("13b. A chat closed outside the Nest never hands the window to the Nest's chat", !gone.nest && gone.view !== ownId && gone.view !== otherId,
        JSON.stringify({ nest: gone.nest, toNestChat: gone.view === ownId }));

      await inPage(() => { Desk.openNest(); return true; });
      const before = await look();
      await inPage((id) => Desk.closeChat(id), ownId);
      const closed = await until(async () => { const v = await look(); return v.view === 'nest' ? v : null; }, 6000) || await look();
      check("14. Closing the Nest's chat leaves the Nest open on its own page, ready to start another",
        before.nest && before.view === ownId && closed.nest && closed.view === 'nest' && closed.page && closed.lit,
        JSON.stringify({ before: before.view === ownId, nest: closed.nest, view: closed.view === 'nest', page: closed.page }));
    } finally {
      chats.create = createWas;
      try {
        const restored = savedSettings.record.folder ? await record.start(savedSettings.record.folder) : await record.stop();
        if (installed) await inPage((settings) => {
          const saved = window.deskNestSaved;
          if (!saved) return true;
          try {
            Palette.close(true); Settings.close(); Desk.Glance.hide();
            Object.assign(Desk.state, saved.state);
            Desk.state.settings.record = settings.record;
            Desk.setView(saved.state.view);
            Desk.paint();
          } finally {
            if (saved.storage === null) sessionStorage.removeItem('desk-place'); else sessionStorage.setItem('desk-place', saved.storage);
            delete window.deskNestSaved;
          }
          return true;
        }, restored);
      } finally {
        for (const id of [...chats.all.keys()]) if (!chatIds.includes(id)) await chats.close(id);
        await until(() => [...chats.all.keys()].every((id) => chatIds.includes(id)), 10000);
        const target = path.resolve(root);
        if (!target.startsWith(path.resolve(dir) + path.sep)) throw new Error('The made-up Nest folder left its output directory.');
        try { fs.unlinkSync(linked); } catch { /* never made, or taken away above */ }
        fs.rmSync(target, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
        watch.post({ type: 'pace', ms: 2000 });
      }
      const clear = await inPage(() => !window.deskNestSaved && !Desk.state.nest && document.getElementById('nest').hidden && document.getElementById('nest-rail').hidden
        && !document.getElementById('brand').classList.contains('on'));
      check('15. The phase takes away its made-up record, consoles and page overrides, and puts the settings back', !fs.existsSync(root) && clear
        && same(settingsNow().record, savedSettings.record) && settingsNow().nestKey === savedSettings.nestKey && chats.create === createWas
        && same([...chats.all.keys()], chatIds));
    }
  };

  // ---- Jev, with a made-up OpenRouter: nothing leaves the machine. The watcher hands over a finished turn, one
  // ---- question is put for it, and the window draws the verdict: marks, the list, the count, the card, the header,
  // ---- the bars, what happened while away; then the look, search put in order, the key never in the page, the ops
  // ---- record never sent. Every word a session says here is made up. ----
  // ---- the floating card: a window of its own over every other program. Made and told here, read from its page,
  // ---- and never shown: a hidden test keeps it hidden. Made-up chats only. ----
  // ---- the notes over the other programs (his ask, 5 Oct night: "show them top right of the screen with a x buttons a
  // ---- possibility to jump to that window and a possibility to disable them in settings"; 6 Oct: "top left always",
  // ---- flat black, the same as the window's own cards): made-up cards, and a made-up chat that needs him, taken from
  // ---- the watcher as a real one is. A hidden test never shows them.
  const notesPhase = async () => {
    check('the window loads for the notes checks', Boolean(await until(() => exec('typeof Desk === "object" && Desk !== null && typeof Settings === "object"'), 15000)));
    if (!noteCards) throw new Error('This run has no notes hooks.');
    watch.post({ type: 'pace', ms: 600000 });
    await wait(700);
    const { screen } = require('electron');
    const inNotes = (fn) => { const w = noteCards.win(); return w && !w.isDestroyed() ? w.webContents.executeJavaScript(`(${fn})()`, true) : Promise.resolve(null); };
    const readNotes = () => inNotes(() => {
      const root = document.getElementById('stack');
      const t = (el, sel) => { const x = el.querySelector(sel); return x ? x.textContent : ''; };
      return { look: document.documentElement.dataset.look, all: Boolean(root.querySelector('.nc-all')), height: Math.ceil(root.getBoundingClientRect().height), right: root.classList.contains('right'),
        cards: [...root.querySelectorAll('.nc')].map((c) => ({ id: c.dataset.id, cls: c.className, title: t(c, '.nc-title'), what: t(c, '.nc-what'), place: t(c, '.nc-place'),
          body: t(c, '.nc-body'), time: t(c, '.nc-time'), open: Boolean(c.querySelector('.nc-open')), go: t(c, '.nc-open'), x: (c.querySelector('.nc-x') || { getAttribute: () => '' }).getAttribute('aria-label'),
          flat: getComputedStyle(c).backgroundImage === 'none', bg: getComputedStyle(c).backgroundColor })) };
    });
    const press = (selector) => inNotes(new Function(`const b = document.querySelector(${JSON.stringify(selector)}); if (b) b.click(); return Boolean(b);`));
    const shown = (want, ms = 4000) => until(async () => { const r = await readNotes(); return r && want(r) ? r : null; }, ms, 100);
    const titles = () => noteCards.list().map((n) => n.title);
    const notesShot = async (name) => {
      const nw = noteCards.win();
      if (!nw || nw.isDestroyed()) return;
      await nw.webContents.capturePage();
      await wait(150);
      fs.writeFileSync(path.join(dir, `${name}.png`), (await nw.webContents.capturePage()).toPNG());
    };
    const cardsWas = settingsNow().notify.cards !== false;
    const hereWas = settingsNow().notify.here;
    const said = [];
    const listen = () => { const w = noteCards.win(); if (w && !w.__heard) { w.__heard = true; w.webContents.on('console-message', (event) => { const e = event || {}; if (e.level === 'error' || e.level === 'warning') said.push(`${e.level}: ${e.message}`); }); } };
    const setNotify = (patch) => inPage(async (p) => { const next = await desk.settings({ notify: p }); Object.assign(Desk.state.settings, next); return true; }, patch);
    try {
      noteCards.clear();
      await setNotify({ cards: true, here: true });
      check('with no note there is no window of their own', !noteCards.win() && noteCards.list().length === 0);

      // 1. a note in a window of its own, at the top right of the screen unless Settings says the top left
      const first = noteCards.up({ kind: 'limit', title: '92% of your weekly limit is used', body: 'Account Made-up. It resets at Thu 09:00. As Claude Code last reported it.', target: 'stats' });
      await until(() => noteCards.win() && !noteCards.win().webContents.isLoading(), 6000);
      listen();
      const r1 = await shown((r) => r.cards.length === 1);
      const w = noteCards.win();
      const area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
      const b1 = w ? w.getBounds() : null;
      const noteIs = { made: Boolean(first), drawn: Boolean(r1), onTop: Boolean(w) && w.isAlwaysOnTop(), noKeyboard: Boolean(w) && !w.isFocusable(), unseen: Boolean(w) && !w.isVisible(),
        right: Boolean(b1) && b1.x + b1.width === area.x + area.width - noteCards.edge, top: Boolean(b1) && b1.y === area.y + noteCards.edge, width: Boolean(b1) && b1.width === noteCards.width,
        corner: settingsNow().notify.corner === 'top-right', pageRight: Boolean(r1) && r1.right };
      check('a note goes up in a window of its own, over every other window, never taking the keyboard, at the top right of the screen the pointer is on; a hidden test never shows it',
        Object.values(noteIs).every(Boolean),
        `${b1 ? `${b1.x},${b1.y} ${b1.width}x${b1.height} on a screen of ${area.x},${area.y} ${area.width}x${area.height}; corner ${settingsNow().notify.corner}` : 'no window'}; not so: ${Object.keys(noteIs).filter((k) => !noteIs[k]).join(', ') || 'nothing'}`);
      check('its card: what happened, its words, Go there and a × to close it, flat black: no light, no glow',
        Boolean(r1) && r1.cards[0].title === '92% of your weekly limit is used' && r1.cards[0].body.startsWith('Account Made-up.') && r1.cards[0].open && r1.cards[0].go === 'Go there'
        && r1.cards[0].x.startsWith('Close: ') && r1.cards[0].cls.includes('k-limit') && r1.look === 'noir' && r1.cards[0].time === 'now' && r1.cards[0].flat && r1.cards[0].bg === 'rgb(11, 11, 13)',
        JSON.stringify(r1 && r1.cards[0]));
      const fit1 = await until(async () => { const r = await readNotes(); return r && w.getBounds().height === r.height + 16 ? r : null; }, 4000, 100);
      check('their window is as tall as the cards and the margin their shadow falls in', Boolean(fit1), `window ${w.getBounds().height}, cards ${fit1 ? fit1.height : '?'}`);

      // 2. the newest on top, one card per chat, five at most
      noteCards.up({ kind: 'needs', title: 'Made-up checkout', what: 'needs you', body: 'Shall I charge the made-up card?', place: 'made-up-shop', target: 'row:made-up-a', key: 'made-up-a', stays: true });
      noteCards.up({ kind: 'done', title: 'Made-up invoices', what: 'finished', body: 'The made-up invoices are ready.', target: 'row:made-up-b', key: 'made-up-b' });
      noteCards.up({ kind: 'error', title: 'Made-up checkout', what: 'stopped on an error', body: 'The made-up server did not answer.', place: 'made-up-shop', target: 'row:made-up-a', key: 'made-up-a', stays: true });
      const r2 = await shown((r) => r.cards.length === 3);
      check('the newest on top, a newer note about the same chat in place of its older one, and Close all once there are two',
        Boolean(r2) && same(r2.cards.map((c) => c.title), ['Made-up checkout', 'Made-up invoices', '92% of your weekly limit is used']) && r2.cards[0].what === 'stopped on an error'
        && r2.cards[0].place === 'made-up-shop' && r2.cards[0].cls.includes('k-error') && r2.cards[1].cls.includes('k-done') && r2.all, JSON.stringify(r2 && r2.cards.map((c) => [c.title, c.what])));
      await notesShot('notes-1-cards');
      for (let i = 1; i <= 4; i++) noteCards.up({ kind: 'done', title: `Made-up chat ${i}`, what: 'finished', body: 'Its turn is over.', target: `row:made-up-${i}`, key: `made-up-${i}` });
      check('five at once at most: the oldest that waits for nobody goes first, the one that needs you stays',
        noteCards.list().length === 5 && noteCards.list().some((n) => n.key === 'made-up-a') && !noteCards.list().some((n) => n.id === first) && !noteCards.list().some((n) => n.key === 'made-up-b'), JSON.stringify(titles()));

      // 3. one waiting for nobody goes by itself; × closes one; with none left their window goes
      noteCards.ms(600);
      const gone = await until(() => (noteCards.list().length === 1 ? noteCards.list() : null), 5000, 100);
      check('a note that waits for nobody goes by itself (after 12 seconds; here 0.6), and the one about a chat that needs you stays',
        Boolean(gone) && gone[0].key === 'made-up-a' && gone[0].stays, JSON.stringify(titles()));
      noteCards.ms(0);
      await shown((r) => r.cards.length === 1);
      await press('.nc-x');
      const closed = await until(() => noteCards.list().length === 0 && !noteCards.win(), 4000, 100);
      check('× closes a note, and with none left their window goes', Boolean(closed), JSON.stringify(titles()));

      // 4. Open: the window goes where the note points, and the note goes
      win.webContents.send('desk:command', 'goto', 'history');
      await until(() => exec('Desk.state.view === "history"'), 3000, 100);
      noteCards.up({ kind: 'reset', title: 'Made-up account has room again', body: 'Its weekly limit reset at 09:00.', target: 'stats' });
      await until(() => noteCards.win() && !noteCards.win().webContents.isLoading(), 6000);
      listen();
      await shown((r) => r.cards.length === 1 && r.cards[0].open);
      await press('.nc-open');
      const went = await until(() => exec('Desk.state.view === "stats"'), 4000, 100);
      check('Go there takes the window where the note points (here the Dashboard), and the note goes', Boolean(went) && noteCards.list().length === 0, `view ${await exec('Desk.state.view')}`);

      // 5. switched off in Settings: none at all; the kinds of notes show only while they are on
      await exec('Settings.open("notes")');
      const notesRows = () => inPage(() => { const s = document.querySelector('#settings section[data-section="notes"]');
        return s ? [...s.querySelectorAll('.set-row .what > div:first-child')].map((d) => d.textContent) : null; });
      const flipShow = () => inPage(() => { document.querySelector('#settings section[data-section="notes"] .set-row').click(); return true; });
      const rowsOn = await notesRows();
      await flipShow();
      const off = await until(() => settingsNow().notify.cards === false, 3000, 100);
      const rowsOff = await until(async () => { const r = await notesRows(); return r && r.length === 1 ? r : null; }, 3000, 100) || await notesRows();
      const none = noteCards.up({ kind: 'limit', title: 'Made-up limit', body: 'Made-up.', target: 'stats' });
      check('"Show notes" switched off in Settings: no note at all, and the kinds of notes are put away until it is on again',
        Boolean(rowsOn) && rowsOn[0] === 'Show notes' && rowsOn.length >= 8 && Boolean(off) && same(rowsOff, ['Show notes']) && none === '' && !noteCards.win(), JSON.stringify({ rowsOn, rowsOff, none }));
      await flipShow();
      await until(() => settingsNow().notify.cards === true, 3000, 100);
      await exec('Settings.close()');

      // 5b. the window's own cards (his asks, 6 Oct: "go there and also close", then "top right not top left"): the same
      // flat card at the top right of the chats, newest on top; Go there goes where it points, × closes it; Settings
      // moves both kinds of cards to the top left and back
      await exec('Cards.clear(); Desk.setView("peek")');
      await inPage(() => {
        toast('Made-up shop has something to show you: its Viewer opens when you go to it.', 9000,
          { kind: 'show', title: 'Made-up shop', what: 'has something to show you', body: 'Its Viewer opens when you go to it.', target: 'history' });
        toast('Looked again just now.', 6000);
        return true;
      });
      const inWin = await inPage(() => {
        const box = document.getElementById('cards');
        const cards = [...box.querySelectorAll('.nc')];
        const stage = document.getElementById('main').getBoundingClientRect();
        const r = box.getBoundingClientRect();
        const cs = cards[0] ? getComputedStyle(cards[0]) : null;
        return { shown: !box.hidden, n: cards.length, words: cards.map((c) => (c.querySelector('.nc-title') || c.querySelector('.nc-body') || {}).textContent || ''),
          go: cards.map((c) => (c.querySelector('.nc-open') || {}).textContent || ''), x: cards.every((c) => Boolean(c.querySelector('.nc-x'))), all: Boolean(box.querySelector('.nc-all')),
          right: box.classList.contains('right'), gap: Math.round(stage.right - r.right), top: Math.round(r.top - stage.top), flat: cs ? cs.backgroundImage === 'none' : false, bg: cs ? cs.backgroundColor : '',
          said: document.getElementById('toast').textContent };
      });
      await inPage(() => { const b = [...document.querySelectorAll('#cards .nc')].find((c) => c.querySelector('.nc-open')); b.querySelector('.nc-open').click(); return true; });
      const wentIn = await until(() => exec('Desk.state.view === "history" && Cards.count() === 1'), 3000, 100);
      await inPage(() => { document.querySelector('#cards .nc .nc-x').click(); return true; });
      const shutIn = await until(() => exec('Cards.count() === 0 && document.getElementById("cards").hidden'), 3000, 100);
      check('in the window, the cards stand at the top right of the chats, newest on top, flat black: Go there goes where one points, × closes one, the newest words are what a screen reader reads',
        inWin.shown && inWin.n === 2 && same(inWin.words, ['Looked again just now.', 'Made-up shop']) && inWin.go[0] === '' && inWin.go[1] === 'Go there' && inWin.x && inWin.all
        && inWin.right && inWin.gap === 20 && inWin.top === 12 && inWin.flat && inWin.bg === 'rgb(11, 11, 13)' && inWin.said === 'Looked again just now.' && Boolean(wentIn) && Boolean(shutIn), JSON.stringify(inWin));
      await exec('Settings.open("cards")');
      const pickCorner = (name) => inPage((n) => { const b = [...document.querySelectorAll('#settings section[data-section="cards"] .seg button')].find((x) => x.textContent === n); if (b) b.click(); return Boolean(b); }, name);
      await pickCorner('Top left');
      const toLeft = await until(() => settingsNow().notify.corner === 'top-left', 3000, 100);
      await exec('Settings.close(); toast("Made-up words on the left.", 6000)');
      const leftNow = await inPage(() => {
        const box = document.getElementById('cards');
        const stage = document.getElementById('main').getBoundingClientRect();
        return { right: box.classList.contains('right'), gap: Math.round(box.getBoundingClientRect().left - stage.left) };
      });
      noteCards.up({ kind: 'limit', title: 'Made-up limit on the left', body: 'Made-up.', target: 'stats' });
      await until(() => noteCards.win() && !noteCards.win().webContents.isLoading(), 6000);
      const r5 = await shown((r) => r.cards.length >= 1 && !r.right);
      noteCards.place();
      const b5 = noteCards.win() ? noteCards.win().getBounds() : null;
      await exec('Settings.open("cards")');
      await pickCorner('Top right');
      const toRight = await until(() => settingsNow().notify.corner === 'top-right', 3000, 100);
      await exec('Settings.close(); Cards.clear()');
      noteCards.clear();
      const rightAgain = await exec('document.getElementById("cards").classList.contains("right")');
      check('Settings puts the cards at the top left instead, in the window and over the other programs, and back at the top right',
        Boolean(toLeft) && !leftNow.right && leftNow.gap === 20 && Boolean(r5) && Boolean(b5) && b5.x === area.x + noteCards.edge && Boolean(toRight) && rightAgain,
        JSON.stringify({ leftNow, notes: b5, area: [area.x, area.y, area.width, area.height] }));

      // 6. a chat of this window that needs him, from the watcher as a real one: a card that stays until it stops waiting
      noteCards.inTest(true);
      const row = (state) => ({ key: 'made-up-watch', chat: 'made-up-chat-id', state, cwd: 'D:\\work\\made-up-refunds', title: 'Made-up refunds', name: 'Made-up refunds', named: true,
        words: state === 'attention' ? 'Shall I send the made-up refund of $12?' : '', at: Date.now(), kind: 'cli', pid: 0 });
      const picture = (state) => ({ at: Date.now(), chats: [row(state)], ended: [], leaving: [], plan: {}, accounts: { list: [] }, drives: [] });
      noteCards.track(picture('working'));
      noteCards.track(picture('attention'));
      const asked = noteCards.list();
      check('a chat of this window that needs you, as the watcher sees it: a card with its name, "needs you", its question and its folder, that stays',
        asked.length === 1 && asked[0].kind === 'needs' && asked[0].title === 'Made-up refunds' && asked[0].what === 'needs you' && asked[0].body === 'Shall I send the made-up refund of $12?'
        && asked[0].place === 'made-up-refunds' && asked[0].stays && asked[0].target === 'made-up-chat-id', JSON.stringify(asked));
      noteCards.track(picture('working'));
      check('once the chat no longer waits (answered in it), its card goes by itself', noteCards.list().length === 0, JSON.stringify(titles()));
      check('their page reported nothing going wrong', said.length === 0, said.join(' | '));
    } finally {
      noteCards.inTest(false);
      noteCards.ms(0);
      noteCards.clear();
      await setNotify({ cards: cardsWas, here: hereWas });
      watch.post({ type: 'pace', ms: 2000 });
      await wait(2500);
    }
  };

  // Whose usage limits a chat's status line holds, around a /login: a watcher of its own over a made-up home, two
  // made-up accounts whose 5-hour windows reset at the same moment (as on 6 Oct), and the file it keeps them in.
  const accountsPhase = async () => {
    const { Ledger } = require('./accounts.cjs');
    const root = fs.mkdtempSync(path.join(dir, 'accounts-'));
    const home = path.join(root, 'home');
    const file = path.join(root, 'accounts.json');
    const history = path.join(home, '.claude', 'history.jsonl');
    const lineFile = path.join(root, 'local', 'AgentFocus', 'statusline.json');
    const A = 'aaaa0001-0000-4000-8000-000000000001';
    const B = 'bbbb0002-0000-4000-8000-000000000002';
    const [a, b] = [A.slice(0, 8), B.slice(0, 8)];
    const H = 3600e3;
    const ten = Math.floor(Date.now() / 600e3) * 600e3;
    const five = ten + 3 * H;
    const weekA = ten + 50 * H;
    const weekB = ten + 90 * H;
    const login = (id, email) => {
      fs.appendFileSync(history, `${JSON.stringify({ display: '/login', timestamp: Date.now(), project: root })}\n`);
      fs.writeFileSync(path.join(home, '.claude.json'), JSON.stringify({ numStartups: 3, oauthAccount: { accountUuid: id, emailAddress: email, displayName: 'Made-up',
        organizationName: 'Made-up org', organizationRateLimitTier: 'default_claude_max_20x', organizationType: 'claude_max' } }));
    };
    let clock = Date.now();
    // one chat's status line as Claude Code writes it: its id, its time spent calling the service so far, the limits it heard last
    const said = (w, id, api, fiveUsed, weekUsed, week) => {
      fs.writeFileSync(lineFile, JSON.stringify({ session_id: id, cost: { total_api_duration_ms: api },
        rate_limits: { five_hour: { used_percentage: fiveUsed, resets_at: five / 1000 }, seven_day: { used_percentage: weekUsed, resets_at: week / 1000 } } }));
      clock += 1000;
      fs.utimesSync(lineFile, clock / 1000, clock / 1000);
      w.sample();
    };
    const fig = (l, key) => { const r = l.readings.get(key); return r ? [r.five && r.five.used, r.week && r.week.used, r.week && r.week.until] : null; };
    try {
      fs.mkdirSync(path.dirname(history), { recursive: true });
      fs.mkdirSync(path.dirname(lineFile), { recursive: true });
      login(A, 'made-up-a@example.com');
      const w = new Watch({ home, localAppData: path.join(root, 'local'), accountsFile: file, counting: false, measure: false });
      w.seed();
      const [s1, s2, s3, s4] = [1, 2, 3, 4].map((n) => `made-up-chat-${n}`);
      said(w, s1, 1000, 40, 70, weekA);
      const unnamed = fig(w.ledger, a);
      said(w, s1, 2000, 40, 70, weekA);
      said(w, s2, 500, 40, 70, weekA);
      said(w, s2, 900, 41, 70, weekA);
      check('a chat\'s limits go to the account logged in once it is seen calling Claude; one first seen repeating what it heard, to the account whose window that is',
        w.ledger.current === a && unnamed === null && same(fig(w.ledger, a), [41, 70, weekA]) && fig(w.ledger, b) === null, JSON.stringify({ unnamed, A: fig(w.ledger, a) }));

      // B logs in: a chat that has not called since repeats A's figures; another's first call after the login may have
      // gone out before it; then its calls are B's, in a 5-hour window that resets when A's does
      await wait(20);
      login(B, 'made-up-b-other@example.com');
      said(w, s2, 900, 41, 70, weekA);
      said(w, s1, 3000, 42, 71, weekA);
      const first = fig(w.ledger, b);
      said(w, s1, 4000, 6, 25, weekB);
      said(w, s3, 100, 7, 25, weekB);
      said(w, s4, 100, 3, 10, weekB);
      said(w, s2, 900, 41, 70, weekA);
      check('after a /login the old account keeps its own figures and the new one gets its own, even when both 5-hour windows reset at the same moment (6 Oct, 00:16)',
        w.ledger.current === b && first === null && same(fig(w.ledger, a), [41, 70, weekA]) && same(fig(w.ledger, b), [7, 25, weekB]),
        JSON.stringify({ first, A: fig(w.ledger, a), B: fig(w.ledger, b) }));

      // what is not sure moves no window still open, earlier or later; what is sure puts right a figure filed wrongly before
      w.ledger.reading(b, 'week', 80, weekA, clock, false);
      w.ledger.reading(b, 'week', 80, weekB + 24 * H, clock, false);
      const held = fig(w.ledger, b);
      Object.assign(w.ledger.readings.get(b), { five: { used: 50, until: five, at: clock }, week: { used: 90, until: weekA, at: clock } });
      said(w, s1, 5000, 8, 26, weekB);
      check('a figure not surely an account\'s never puts another week in place of its open one; a sure one puts right a wrong figure, lower or of another week',
        same(held, [7, 25, weekB]) && same(fig(w.ledger, b), [8, 26, weekB]), JSON.stringify({ held, B: fig(w.ledger, b) }));

      // back to A: B's figures repeated, and the first call after the login, stay off A
      await wait(20);
      login(A, 'made-up-a@example.com');
      said(w, s3, 100, 7, 25, weekB);
      said(w, s1, 6000, 9, 26, weekB);
      said(w, s1, 7000, 45, 72, weekA);
      said(w, s2, 900, 41, 70, weekA);
      check('logged back in to the first account: its figures go on from its own, the other account\'s stay with it, and a chat shows the account it is on',
        w.ledger.current === a && same(fig(w.ledger, a), [45, 72, weekA]) && same(fig(w.ledger, b), [8, 26, weekB])
        && w.lineOf(s1).account === a && w.lineOf(s3).account === b,
        JSON.stringify({ A: fig(w.ledger, a), B: fig(w.ledger, b), s1: w.lineOf(s1).account, s3: w.lineOf(s3).account }));

      w.ledger.save();
      const again = new Ledger({ home, file });
      check('kept through a restart: both accounts, their figures and when each was in use',
        same(fig(again, a), [45, 72, weekA]) && same(fig(again, b), [8, 26, weekB]) && same(again.marks.map((m) => m.key).slice(-3), [a, b, a])
        && same([...again.accounts.keys()].sort(), [a, b]), JSON.stringify({ A: fig(again, a), B: fig(again, b), marks: again.marks.map((m) => m.key) }));
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  };

  const floatPhase = async () => {
    check('the window loads for the floating card checks', Boolean(await until(() => exec('typeof Desk === "object" && Desk !== null && typeof Desk.floatModel === "function"'), 15000)));
    if (!float) throw new Error('This run has no floating card hooks.');
    watch.post({ type: 'pace', ms: 600000 });
    await wait(700);
    float.place(null);
    madeAt = Date.now();
    const chat = 'float-made-up-chat';
    const steps = { done: 3, total: 7, current: 'Run every test area', items: [
      { text: 'Read the handler code', state: 'done' }, { text: 'Add the size checks', state: 'done' }, { text: 'Run the Nest test', state: 'done' },
      { text: 'Run every test area', state: 'doing' }, { text: 'Update the records', state: 'todo' }, { text: 'Write the report', state: 'todo' }, { text: 'Ask about the commit', state: 'todo' }] };
    const snap = JSON.parse(fake(madeAt, [busyRow({ chat, title: 'Made-up research', steps }),
      row({ key: 's-permission', title: 'Made-up checkout', state: 'attention', waiting: 'permission prompt', since: madeAt - 40e3 }),
      row({ key: 's-words', title: 'Made-up invoices', state: 'working', since: madeAt - 9 * 60e3 })]));
    const inCard = (fn) => { const w = float.win(); return w && !w.isDestroyed() ? w.webContents.executeJavaScript(`(${fn})()`, true) : Promise.resolve(null); };
    const readCard = () => inCard(() => {
      const root = document.getElementById('card');
      if (!root || root.hidden) return { shown: false };
      const t = (sel) => { const el = root.querySelector(sel); return el ? el.textContent : ''; };
      const all = (sel) => [...root.querySelectorAll(sel)];
      return { shown: true, cls: root.className, name: t('.fc-name'), folder: t('.fc-folder'), words: t('.fc-words'), timer: t('.fc-now .fc-timer'),
        planCount: t('.fc-plan .fc-count'), marks: all('.fc-plan .pl-m').map((m) => m.classList[1]), steps: all('.fc-plan .pl-step').map((s) => [s.classList[1], s.textContent]),
        planLine: t('.fc-plan-line'), agents: all('.fc-agent .fc-agent-what').map((a) => a.textContent), agentsCount: t('.fc-agents .fc-count'),
        memory: t('.fc-mem .fc-count'), memorySub: t('.fc-mem .fc-sub'), needs: t('.fc-needs'), working: t('.fc-working'),
        numbers: all('.fc-num').map((n) => `${n.querySelector('b').textContent} ${n.querySelector('span').textContent}`),
        buttons: all('.fc-btn').map((b) => b.getAttribute('aria-label')), look: document.documentElement.dataset.look,
        drag: getComputedStyle(root.querySelector('.fc-head')).getPropertyValue('-webkit-app-region').trim(),
        height: Math.ceil(root.getBoundingClientRect().height), width: Math.round(root.getBoundingClientRect().width) };
    });
    const press = (selector) => inCard(new Function(`const b = document.querySelector(${JSON.stringify(selector)}); if (b) b.click(); return Boolean(b);`));
    const cardShot = async (name) => {
      const w = float.win();
      if (!w || w.isDestroyed()) return;
      await w.webContents.capturePage();
      await wait(150);
      fs.writeFileSync(path.join(dir, `${name}.png`), (await w.webContents.capturePage()).toPNG());
    };
    let installed = false;
    try {
      check('switched off, as it starts: no window of its own, and the page tells it nothing', settingsNow().float.on === false && !float.win() && float.model() === null);
      installed = true;
      await inPage((s, id) => {
        const st = Desk.state;
        window.deskFloatSaved = { state: { ...st }, hidden: Object.fromEntries(['chat', 'peek', 'history', 'stats', 'overview', 'inspector'].map((key) => [key, document.getElementById(key).hidden])) };
        Object.assign(st, { chats: [{ id, cwd: 'D:\\work\\pricing', title: 'Made-up research', starter: 'shell', startedAt: Date.now() - 60000 }], view: id, shown: [id], recent: [id],
          snap: s, res: null, usage: null, frozen: true, loose: false, unread: new Set(), before: new Map(s.chats.map((c) => [c.key, c.state])), sel: null, selLeaving: '',
          armed: new Set(), armedAs: new Map(), resumed: new Map(), settings: { ...st.settings, tiles: 1, inspector: false, space: '', also: [], spaces: [] } });
        for (const key of ['peek', 'history', 'stats', 'overview', 'inspector']) document.getElementById(key).hidden = true;
        document.getElementById('chat').hidden = false;
        Desk.ChatView.place(st, [id]);
        Desk.paint();
      }, snap, chat);
      await wait(200);
      check('switched off, nothing is sent while the window draws', float.model() === null && !float.win());

      // switched on with its key: its own window, over everything, never taking the keyboard, at the top left
      await ctrl('KeyF', { shift: true });
      const cardSaid = [];
      await until(() => float.win(), 4000);
      if (float.win()) float.win().webContents.on('console-message', (event) => { const e = event || {}; if (e.level === 'error' || e.level === 'warning') cardSaid.push(`${e.level}: ${e.message}`); });
      const made = await until(() => float.win() && !float.win().webContents.isLoading() && float.model() !== null, 8000);
      const w = float.win();
      const spot = float.spot();
      const area = require('electron').screen.getDisplayMatching(win.getBounds()).workArea;
      const bounds = w ? w.getBounds() : null;
      const cardIs = { made: Boolean(made), on: settingsNow().float.on === true, onTop: Boolean(w) && w.isAlwaysOnTop(), noKeyboard: Boolean(w) && !w.isFocusable(), unseen: Boolean(w) && !w.isVisible(),
        left: Boolean(bounds) && bounds.x === area.x + float.edge, top: Boolean(bounds) && bounds.y === area.y + float.edge, width: Boolean(bounds) && bounds.width === float.width,
        spot: Boolean(bounds) && spot.x === bounds.x, page: (await exec('Desk.state.settings.float.on')) === true };
      check('Ctrl Shift F switches it on: a window of its own, over every other one, that never takes the keyboard, at the top left of the screen, and a hidden test never shows it',
        Object.values(cardIs).every(Boolean),
        `${bounds ? `${bounds.x},${bounds.y} ${bounds.width}x${bounds.height} on a screen from ${area.x},${area.y}` : 'no window'}; not so: ${Object.keys(cardIs).filter((k) => !cardIs[k]).join(', ') || 'nothing'}`);
      let card = await until(async () => { const c = await readCard(); return c && c.shown && c.name === 'Made-up research' ? c : null; }, 8000);
      if (!card) say(`      the card's page: ${JSON.stringify(await readCard())}; it said: ${cardSaid.join(' | ') || 'nothing'}`);
      check('it shows the chat in front: its name and folder, what it does now and for how long',
        Boolean(card) && card.name === 'Made-up research' && card.folder === 'pricing' && card.words === 'Agent · Compare competitor D' && /^\d+m \d\ds$/.test(card.timer)
        && card.cls.includes('s-working') && card.look === 'noir' && card.drag === 'drag', card ? `${card.name} · ${card.folder} · ${card.words} · ${card.timer}` : 'not drawn');
      check('its plan: a mark per step, then every step in its own words, the one at work lit',
        card && card.planCount === '3 of 7 done · 1 under way' && same(card.marks, ['done', 'done', 'done', 'doing', 'todo', 'todo', 'todo'])
        && same(card.steps.map((x) => x[0]), ['done', 'done', 'done', 'doing', 'todo', 'todo', 'todo']) && card.steps[3][1] === 'Run every test area' && card.steps[6][1] === 'Ask about the commit',
        card ? `${card.planCount}: ${card.steps.map((x) => x[1]).join(' / ')}` : '');
      check('its subagents at work, what each was sent to do; its memory; what it used',
        card && same(card.agents, ['Compare competitor D', 'Read their plans page', 'Compare competitor E']) && card.agentsCount === '3 at work'
        && card.memory === '86%' && card.memorySub === '402k of about 467k tokens · compacted 2×'
        && same(card.numbers, ['$42 at list prices', '121k out today', 'Opus 5.5 effort max']),
        card ? `${card.agents.join(', ')} · memory ${card.memory} · ${card.numbers.join(' / ')}` : '');
      check('under it, the other chats: the one that needs you by name, and how many are at work',
        card && card.needs === 'Needs you:Made-up checkout' && card.working === '1 other chat at work', card ? `${card.needs} · ${card.working}` : '');
      // its fonts arrive after the first draw: the window follows once they have
      const fitted = (want) => until(async () => { const c = await readCard(); return c && c.shown && want(c) && w.getBounds().height === c.height + 16 ? c : null; }, 4000);
      const full = await fitted(() => true);
      check('its window is as tall as the card and the margin its shadow falls in', Boolean(full) && full.width === 320,
        full ? `card ${full.width}x${full.height}, window ${w.getBounds().width}x${w.getBounds().height}` : `window ${w.getBounds().width}x${w.getBounds().height}`);
      await cardShot('float-1-card');

      // small, from its own button: what it does, the step it is on, its memory
      await press('.fc-size');
      const small = await fitted((c) => c.cls.includes('small'));
      check('its own button makes it small: what it does, the step it is on, its memory, and it is kept; its window follows',
        Boolean(small) && settingsNow().float.small === true && small.planLine === '4/7Run every test area' && !small.agents.length && !small.numbers.length && small.memory === '86%'
        && Boolean(full) && small.height < full.height, small ? `${small.planLine} · ${small.height} px against ${full ? full.height : '?'}` : 'not small');
      await cardShot('float-2-small');
      await press('.fc-size');
      await until(async () => { const c = await readCard(); return c && c.shown && !c.cls.includes('small'); }, 4000);

      // a press on the chat brings the window up on it; a press on a name, on that chat
      await inPage(() => { Desk.setView('stats'); return true; });
      await press('.fc-btn[aria-label="Open this chat in Lowlit"]');
      const went = await until(() => exec(`Desk.state.view === ${JSON.stringify(chat)}`), 4000);
      await press('.fc-link');
      const shown = await until(() => exec('Desk.state.view === "peek" && Boolean(Desk.state.sel) && Desk.state.sel.key === "s-permission"'), 4000);
      check('a press on its open button brings the window up on that chat, and a press on a name opens that chat', Boolean(went) && Boolean(shown) && !win.isVisible());
      await inPage((id) => { Desk.setView(id); return true; }, chat);

      // it follows what changes: the chat now waits for the person
      await inPage((key) => {
        const s = Desk.state.snap;
        takeSnapshot({ ...s, at: s.at + 1, chats: s.chats.map((c) => (c.key === key ? { ...c, state: 'attention', waiting: 'input needed', doing: null, since: Date.now() - 5000 } : c)) });
        return true;
      }, 's-agents');
      const asks = await until(async () => { const c = await readCard(); return c && c.shown && c.cls.includes('s-needs') ? c : null; }, 4000);
      check('it follows the chat: once that waits for you, it says so in yellow', Boolean(asks) && asks.words === 'Waiting for your answer', asks ? asks.words : 'not changed');

      // where it was put is kept, and it goes there again
      const moved = { x: bounds.x + 40, y: bounds.y + 30 };
      w.setPosition(moved.x, moved.y);
      await wait(200);
      check('where it is put is kept: it goes there again', settingsNow().float.x === moved.x && settingsNow().float.y === moved.y && float.spot().x === moved.x && float.spot().y === moved.y,
        JSON.stringify(float.spot()));

      // the pin: kept over this window too
      await press('.fc-tools .fc-btn:nth-child(3)');
      await wait(150);
      const pinned = settingsNow().float.overDesk;
      await press('.fc-tools .fc-btn:nth-child(3)');
      await wait(150);
      check('its pin keeps it over this window too, and lets it step aside again', pinned === true && settingsNow().float.overDesk === false);

      // hidden from its own x: switched off, its window gone, the window told
      await press('.fc-tools .fc-btn:last-child');
      const gone = await until(async () => !float.win() && (await exec('Desk.state.settings.float.on')) === false, 4000);
      await inPage(() => { Desk.paint(); return true; });
      check('its x switches it off: its window is gone, the window knows, and nothing more is sent', Boolean(gone) && settingsNow().float.on === false && float.model() === null);

      // Settings has its switch, and its two others once it is on; the search box has its line
      await exec('Settings.open()');
      await wait(150);
      // rows without a switch (a list to choose from, a button) are passed over
      const rows = () => inPage(() => [...document.querySelectorAll('#settings .set-row')].map((r) => [(r.querySelector('.what > div') || {}).textContent || '', r.querySelector('.switch')])
        .filter(([label, sw]) => sw && /^(Floating card|Small card|Keep it over this window too)/.test(label)).map(([label, sw]) => [label, sw.classList.contains('on')]));
      const flipRow = (label) => inPage((text) => { const r = [...document.querySelectorAll('#settings .set-row')].find((x) => (x.querySelector('.what > div') || {}).textContent === text); if (r) r.click(); return Boolean(r); }, label);
      const before = await rows();
      await flipRow('Floating card (Ctrl Shift F)');
      const onAgain = await until(async () => float.win() && settingsNow().float.on === true && (await rows()).length === 3, 4000);
      const after = await rows();
      await flipRow('Floating card (Ctrl Shift F)');
      const offAgain = await until(() => !float.win() && settingsNow().float.on === false, 4000);
      check('Settings switches it on and off, and shows its two other switches while it is on',
        same(before, [['Floating card (Ctrl Shift F)', false]]) && Boolean(onAgain) && same(after, [['Floating card (Ctrl Shift F)', true], ['Small card', false], ['Keep it over this window too', false]]) && Boolean(offAgain),
        `${JSON.stringify(before)} then ${JSON.stringify(after)}`);
      await exec('Settings.close()');
      await exec('Palette.open()');
      await wait(300);
      await typeInto('#palette input', 'floating');
      await wait(150);
      const listed = await inPage(() => [...document.querySelectorAll('#palette .pal-item')].filter((el) => (el.querySelector('.from') || {}).textContent === 'Do').map((el) => el.querySelector('.label').textContent));
      await exec('Palette.close()');
      check('the search box finds it as something to do', listed.includes('Floating card: the chat in front, over your other programs'), listed.join(' / '));
    } finally {
      float.set({ on: false, small: false, overDesk: false });
      float.place(null);
      if (installed) await inPage(() => {
        const saved = window.deskFloatSaved;
        if (!saved) return;
        Object.assign(Desk.state, saved.state);
        for (const [key, hidden] of Object.entries(saved.hidden)) document.getElementById(key).hidden = hidden;
        delete window.deskFloatSaved;
        Desk.ChatView.place(Desk.state, Desk.onScreen());
        Desk.paint();
      });
      watch.post({ type: 'pace', ms: 2000 });
    }
  };

  // the ops record of the Jev checks: a made-up folder in this run's own, set as the record's folder for this run
  const madeUpRecord = (root) => { const f = path.join(root, 'made-up-record'); fs.mkdirSync(path.join(f, 'state'), { recursive: true }); record.start(f); return f; };
  const jevPhase = async () => {
    const { RUBRIC, ENDPOINT, MODEL } = require('./jev.cjs');
    check('the window loads for the made-up Jev checks', Boolean(await until(() => exec('typeof Desk === "object" && Desk !== null && Boolean(Desk.Jev)'), 15000)));
    if (!jev || !find) throw new Error('This run has no Jev or finder hooks.');
    if (!check('the finder is stopped until this phase supplies a made-up home', find.thread() === 0)) throw new Error('The finder was not isolated for this phase.');
    watch.post({ type: 'pace', ms: 600000 });
    await wait(700);
    const root = fs.mkdtempSync(path.join(dir, 'jev-'));
    const home = path.join(root, 'home');
    const work = path.join(root, 'made-up-web');
    const record = madeUpRecord(root);
    const sessions = path.join(home, '.claude', 'sessions');
    const project = path.join(home, '.claude', 'projects', work.replace(/[^A-Za-z0-9]/g, '-'));
    const KEY = 'sk-or-v1-made-up-key-00000000000000000000000000000000000000';
    const k = (n) => `11111111-2222-4333-8444-7777777777${String(n).padStart(2, '0')}`;
    const [A, H, B, C, D, E, W] = [1, 2, 3, 4, 5, 6, 7].map(k);
    const keys = [A, H, B, C, D, E, W];
    const chat = 'jev-made-up-chat';
    const now = Date.now();
    const at = (min) => now - min * 60e3;
    let tick = now - 30e3;
    const stamp = () => new Date(++tick).toISOString();
    const asked = (cwd, text) => ({ type: 'user', timestamp: stamp(), cwd, message: { role: 'user', content: text } });
    const said = (cwd, text) => ({ type: 'assistant', timestamp: stamp(), cwd, message: { role: 'assistant', model: 'claude-opus-5-5', content: [{ type: 'text', text }] } });
    const called = (cwd, id, name, input) => ({ type: 'assistant', timestamp: stamp(), cwd, message: { role: 'assistant', model: 'claude-opus-5-5', content: [{ type: 'tool_use', id, name, input }] } });
    const writeRows = (file, rows) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, rows.map((r) => JSON.stringify(r)).join('\n') + '\n'); };
    const calls = [];
    // the made-up OpenRouter's answers: the turn question by the made-up words of the answer, the search by its passages
    const levelOf = (text) => (/made-up stuck/.test(text) ? 'stuck' : /made-up done/.test(text) ? 'done' : /Shall I push/.test(text) ? 'yesno' : 'fyi');
    let slowOnce = false;
    jev.stub((url, body) => {
      const words = JSON.stringify(body);
      // a turn of one of the person's own chats could end meanwhile: it gets no answer and is not kept
      if (!/made-up/i.test(words)) return { status: 503, json: null };
      // one call that gets no answer in time, as on his machine on 4 Oct
      if (slowOnce && /made-up slow/.test(words)) { slowOnce = false; const late = new Error('The operation was aborted due to timeout'); late.name = 'TimeoutError'; throw late; }
      calls.push({ url, body: JSON.parse(words) });
      if (body.questions.turn) {
        const level = levelOf(body.state.answer);
        return { status: 200, json: { answers: { turn: { choice: level, probabilities: { fyi: 0.02, [level]: 0.9 }, confidence: 0.9 } }, usage: { cost: 0.0001 } } };
      }
      const answers = {};
      for (const [id, text] of Object.entries(body.state.passages)) answers[id] = { legend: { a: RUBRIC[0], b: RUBRIC[3] }, probabilities: /build/.test(text) ? { b: 1 } : { a: 1 } };
      return { status: 200, json: { answers, usage: { input_tokens: 1200 } } };
    });
    const hadFile = fs.existsSync(jev.file());
    const lookBefore = settingsNow().look;
    let local = null;
    let installed = false;
    let finding = false;
    try {
      // A finished, asking a yes or no; H's reply is over while the helper it sent still works
      fs.writeFileSync(path.join(root, '.git'), 'not a repository\n');
      fs.mkdirSync(work, { recursive: true });
      fs.mkdirSync(sessions, { recursive: true });
      writeRows(path.join(project, `${A}.jsonl`), [asked(work, 'Make the made-up login page'), said(work, 'Built the made-up login page. Shall I push it to the made-up branch?')]);
      writeRows(path.join(project, `${H}.jsonl`), [asked(work, 'Run the made-up review'),
        called(work, 'jev-agent', 'Agent', { description: 'Review the made-up page', prompt: 'Review it', subagent_type: 'explorer' }),
        said(work, 'A made-up helper is reviewing it in the background.')]);
      fs.mkdirSync(path.join(project, H, 'subagents'), { recursive: true });
      fs.writeFileSync(path.join(project, H, 'subagents', 'agent-jevhelp.meta.json'), JSON.stringify({ name: 'jev-helper', description: 'Review the made-up page', agentType: 'explorer', toolUseId: 'jev-agent' }));
      writeRows(path.join(project, H, 'subagents', 'agent-jevhelp.jsonl'), [asked(work, 'Review the made-up page'), called(work, 'jev-read', 'Read', { file_path: path.join(work, 'page.js') })]);
      const pids = [process.pid, win.webContents.getOSProcessId()];
      [A, H].forEach((key, i) => fs.writeFileSync(path.join(sessions, `${pids[i]}.json`), JSON.stringify({ sessionId: key, cwd: work,
        name: i ? 'made-up-review' : 'made-up-login', nameSource: 'user', status: 'idle', statusUpdatedAt: i ? at(1) : at(4), startedAt: at(60) })));
      local = new Watch({ home, localAppData: path.join(root, 'local'), counting: false, measure: false });
      local.setShells([], [], []);
      local.poll();
      const snap = local.snapshot();
      const rowA = snap.chats.find((c) => c.key === A);
      const rowH = snap.chats.find((c) => c.key === H);
      if (!rowA || !rowH) throw new Error('The made-up Jev sessions did not reach the picture.');
      check('a chat whose reply is over while a helper it sent still works counts as working, and says so', rowH.state === 'working' && rowH.background === true
        && rowH.helpers === 1 && (await inPage((c) => phrase(c), rowH)) === '1 agent still working', `${rowH.state}, ${rowH.helpers} helper(s)`);
      const finalA = local.finalOf(A);
      check('the watcher hands over a finished turn: the last request, the last answer, when, where', Boolean(finalA) && finalA.asked === 'Make the made-up login page'
        && finalA.answer.startsWith('Built the made-up login page') && finalA.end > 0 && same(Object.keys(finalA).sort(), ['answer', 'asked', 'cwd', 'end', 'title']),
        finalA ? JSON.stringify(Object.keys(finalA).sort()) : 'nothing handed over');

      // Jev itself, in this run's own profile
      check('Jev starts switched off, without a key', !hadFile && !jev.view().on && !jev.view().hasKey);
      jev.key(KEY);
      jev.flush();
      check('a pasted key is locked away: never in what the window is told, never in plain text on disk', jev.view().hasKey
        && !JSON.stringify(jev.view()).includes(KEY) && !fs.readFileSync(jev.file(), 'utf8').includes(KEY));
      check('switched off, nothing is asked', await jev.judge({ ...finalA, key: A, since: rowA.since }) === null && calls.length === 0);
      jev.on(true);
      const vA = await jev.judge({ ...finalA, key: A, since: rowA.since });
      const first = calls[0];
      check('a finished turn is one question to Jev, holding the request and the answer only', Boolean(vA) && vA.level === 'yesno' && calls.length === 1
        && first.url === ENDPOINT && first.body.model === MODEL && same(Object.keys(first.body.state).sort(), ['answer', 'request'])
        && first.body.state.request === 'Make the made-up login page' && first.body.state.answer.includes('Shall I push')
        && !JSON.stringify(calls).includes(KEY), `verdict ${vA && vA.level}`);
      check('the same turn is never asked about twice', await jev.judge({ ...finalA, key: A, since: rowA.since }) === null && calls.length === 1);
      check('a chat working in the ops record folder is never sent', jev.mine(path.join(record, 'state')) && !jev.mine(work)
        && await jev.judge({ asked: 'made-up', answer: 'made-up record words', end: now, title: '', cwd: record, key: E, since: now }) === null && calls.length === 1);
      const vB = await jev.judge({ asked: 'Finish the made-up tests', answer: 'All made-up done. Set API_KEY=sk-or-v1-made-up-leak-000000000000000000 in the made-up env.',
        end: at(3), title: '', cwd: work, key: B, since: at(3) });
      const vD = await jev.judge({ asked: 'Deploy the made-up site', answer: 'I am made-up stuck: the made-up deploy keeps failing.', end: at(6), title: '', cwd: work, key: D, since: at(6) });
      const vE = await jev.judge({ asked: 'Rename the made-up file', answer: 'Shall I push the made-up rename?', end: at(50), title: '', cwd: work, key: E, since: at(50) });
      check('keys and passwords are taken out of what is sent', !JSON.stringify(calls).includes('sk-or-v1-made-up-leak') && JSON.stringify(calls).includes('[hidden]'));
      check('each turn comes back as judged: done, stuck, a yes or no', vB?.level === 'done' && vD?.level === 'stuck' && vE?.level === 'yesno' && calls.length === 4);
      slowOnce = true;
      const deskLog = path.join(app.getPath('userData'), 'desk.log');
      const logSize = fs.existsSync(deskLog) ? fs.statSync(deskLog).size : 0;
      const vSlow = await jev.judge({ asked: 'Check the made-up queue', answer: 'All made-up done with the made-up slow queue.', end: at(2), title: '', cwd: work,
        key: '0e0e0e0e-0000-4000-8000-00000000005a', since: at(2) });
      // the log starts afresh past 1 MB: then all of it is new
      const logNow = fs.existsSync(deskLog) ? fs.readFileSync(deskLog) : Buffer.alloc(0);
      const slowLog = (logNow.length >= logSize ? logNow.subarray(logSize) : logNow).toString('utf8');
      check('a call that gets no answer in time is made once more, and the turn is judged all the same; the log says so, without the words',
        vSlow?.level === 'done' && calls.length === 5 && slowLog.includes('jev: a finished turn: Jev did not answer within 8 seconds. Asked once more.')
        && /jev: a finished turn: answered in \d+ ms/.test(slowLog) && !slowLog.includes('made-up slow'), slowLog.trim().split('\n').slice(-3).join(' | '));

      // the window, over a made-up picture: A runs in a chat of this window; E has moved on since its verdict
      const rows = [{ ...rowA, chat }, rowH,
        { ...rowA, key: B, session: B, name: 'made-up-tests', title: 'Made-up tests', state: 'idle', since: at(3), chat: '' },
        { ...rowA, key: C, session: C, name: 'made-up-question', title: 'Made-up question', state: 'attention', since: at(2), chat: '' },
        { ...rowA, key: D, session: D, name: 'made-up-deploy', title: 'Made-up deploy', state: 'idle', since: at(6), chat: '' },
        { ...rowA, key: E, session: E, name: 'made-up-rename', title: 'Made-up rename', state: 'idle', since: at(9), chat: '' },
        { ...rowA, key: W, session: W, name: 'made-up-build', title: 'Made-up build', state: 'working', since: at(1), chat: '' }];
      installed = true;
      await inPage((s, id, folder, unread) => {
        const st = Desk.state;
        window.deskJevSaved = { state: { ...st }, storage: sessionStorage.getItem('desk-place'), away: localStorage.getItem('desk.away'),
          hidden: Object.fromEntries(['chat', 'peek', 'history', 'stats', 'overview', 'inspector'].map((key) => [key, document.getElementById(key).hidden])) };
        Object.assign(st, { chats: [{ id, cwd: folder, title: 'Made-up login', starter: 'shell', startedAt: Date.now() - 60000 }], view: id, shown: [id], recent: [id],
          snap: s, res: null, usage: null, frozen: true, loose: false, unread: new Set(unread), before: new Map(s.chats.map((c) => [c.key, c.state])), sel: null, selLeaving: '',
          armed: new Set(), armedAs: new Map(), resumed: new Map(), settings: { ...st.settings, tiles: 1, inspector: false, space: '',
            spaces: [{ id: 'jev-space-web', name: 'Made-up web', folders: [folder], color: 'mint', sessions: [] }] } });
        for (const key of ['peek', 'history', 'stats', 'overview', 'inspector']) document.getElementById(key).hidden = true;
        document.getElementById('chat').hidden = false;
        Terms.create(id);
        Desk.ChatView.place(st, [id]);
        Desk.paint();
      }, { ...snap, chats: rows, drives: [] }, chat, work, [B]);
      await drawn();
      const heard = await until(() => exec('Desk.Jev.on() && Desk.Jev.view().verdicts.length >= 4'), 5000);
      check('the window hears of the verdicts, and never of the key', Boolean(heard) && !(await inPage((key) => JSON.stringify(Desk.Jev.view()).includes(key), KEY)));
      const marks = await inPage((list) => list.map((key) => { const c = Desk.state.snap.chats.find((x) => x.key === key); return [Desk.markFor(c), Desk.wants(c)]; }), keys);
      check('marks follow the verdicts: a yes or no and stuck want you, done stays green, an old verdict counts for nothing', same(marks, [
        ['needs', true], ['working', false], ['done', false], ['needs', true], ['error', true], ['idle', false], ['working', false]]), JSON.stringify(marks));
      const needs = await inPage(() => [...document.querySelectorAll('#chat-list section.group[data-group$="needs"] .chat[data-key]')].map((el) => el.dataset.key));
      check('in the list, what holds everything up comes first: the question on screen, the yes or no, then what is stuck', same(needs, [C, A, D]), needs.map((x) => x.slice(-2)).join(' '));
      check('the count at the top says three need you', /3 need you/.test(await exec('document.getElementById("triage").textContent')));
      const crumb = await exec('document.getElementById("crumb").textContent');
      check('the top bar names the workspace and the chat in front', crumb.includes('Made-up web') && crumb.includes('Made-up login'), crumb);
      await inPage(() => document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'G', code: 'KeyG', ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true })));
      await drawn();
      const card = await exec('(() => { const el = document.querySelector(".glance-over"); return el && !el.hidden ? el.textContent : ""; })()');
      check('the card over the chat says what Jev made of its end', card.includes('Jev: wants a yes or no'), card.slice(0, 60));
      await inPage(pageKey, 'Escape');

      // the Dashboard's bars
      await inPage(() => Desk.setView('stats'));
      await drawn();
      const barsNow = () => inPage(() => [...document.querySelectorAll('#stats .bars-sec .cbar')].map((el) => ({ key: el.dataset.key,
        tone: [...el.classList].find((c) => c.startsWith('t-')), h: parseFloat(el.style.getPropertyValue('--h')), top: el.querySelector('.cbar-top').textContent, fresh: el.classList.contains('fresh') })));
      const bars = Object.fromEntries((await barsNow()).map((b) => [b.key, b]));
      check('the Dashboard stands one bar per chat, coloured by what it wants', Object.keys(bars).length === 7 && bars[A]?.tone === 't-needs' && bars[C]?.tone === 't-needs'
        && bars[B]?.tone === 't-done' && bars[D]?.tone === 't-error' && bars[E]?.tone === 't-idle' && bars[H]?.tone === 't-working' && bars[W]?.tone === 't-working',
      keys.map((key) => bars[key] && bars[key].tone).join(' '));
      check('a waiting bar says for how long, and the question that holds everything up stands above the yes or no', /^\d+[smhd]$/.test(bars[A]?.top || '')
        && bars[C].h > bars[A].h && !bars[B].top, `${bars[A] && bars[A].top}; ${bars[C] && bars[C].h}% over ${bars[A] && bars[A].h}%`);
      const group = await exec('(() => { const g = document.querySelector("#stats .bgroup"); return g ? [g.className, g.querySelector(".bgroup-name").textContent] : null; })()');
      check('the bars stand on a line in their workspace\'s colour, under its name', Boolean(group) && group[0].includes('ws-mint') && group[1] === 'Made-up web · 7', JSON.stringify(group));
      await inPage((key) => {
        const s = Desk.state.snap;
        takeSnapshot({ ...s, at: s.at + 1, chats: s.chats.map((c) => (c.key === key ? { ...c, state: 'idle', since: Date.now() } : c)) });
        Desk.paint();
      }, W);
      await drawn();
      const after = Object.fromEntries((await barsNow()).map((b) => [b.key, b]));
      check('a bar that finishes turns green with one flash', after[W]?.tone === 't-done' && after[W].fresh && !after[A].fresh);

      // what happened while away: half an hour without anyone looking (a hidden window is not looked at from its start)
      await inPage(() => { Desk.Morning.load(); Desk.Morning.leave(Date.now() - 30 * 60e3); Desk.Morning.back(Date.now()); Desk.paint(); });
      await drawn();
      const morning = await inPage(() => {
        const notes = document.getElementById('notes');
        const box = document.querySelector('#stats .morning-sec');
        return { top: notes.querySelectorAll('.mr-row').length + (notes.textContent.includes('While you were away') ? 1 : 0),
          groups: box && !box.hidden ? [...box.querySelectorAll('.mr-group')].map((g) => [g.classList[1], [...g.querySelectorAll('.mr-row')].map((r) => r.dataset.key)]) : [] };
      });
      check('back after half an hour: nothing about it is put at the top of the page, over the chats', morning.top === 0, `${morning.top} thing(s) at the top`);
      check('the Dashboard lists what needs you, what failed and what finished, in that order, in its groups',
        same(morning.groups, [['mr-needs', [C, A]], ['mr-failed', [D]], ['mr-done', [E, B, W]]]), JSON.stringify(morning.groups.map(([g, l]) => [g, l.length])));

      // A press whose release the window never sees (let go over another window) must not hold every chat's state as it
      // was until the next click (seen 4 Oct: "we need to click on the chats for them to update"). A row of the list
      // without a verdict of Jev's is set to failed, then to waiting, while a press is held.
      const pressRow = await inPage(() => {
        const row = [...document.querySelectorAll('#chat-list .nav-item[data-key]')].find((r) => {
          const c = Desk.state.snap.chats.find((x) => x.key === r.dataset.key);
          return c && !Desk.Jev.verdict(c) && r.dataset.mark !== 'error' && r.dataset.mark !== 'needs';
        });
        return row ? row.dataset.key : '';
      });
      const markNow = () => inPage((key) => { const r = document.querySelector(`#chat-list .nav-item[data-key="${key}"]`); return r ? r.dataset.mark : ''; }, pressRow);
      // the row is put back exactly as it was afterwards, and whether it was unread too
      const rowBefore = pressRow ? await inPage((key) => Desk.state.snap.chats.find((x) => x.key === key), pressRow) : null;
      const unreadBefore = pressRow ? await inPage((key) => Desk.state.unread.has(key), pressRow) : false;
      const putRow = (row) => inPage((r) => {
        const snap = Desk.state.snap;
        takeSnapshot({ ...snap, at: snap.at + 1, chats: snap.chats.map((c) => (c.key === r.key ? r : c)) });
        return true;
      }, row);
      const pointer = (type, buttons) => inPage((t, b) => { window.dispatchEvent(new PointerEvent(t, { bubbles: true, buttons: b, pointerType: 'mouse' })); return true; }, type, buttons);
      const markBefore = pressRow ? await markNow() : '';
      await pointer('pointerdown', 1);
      if (rowBefore) await putRow({ ...rowBefore, state: 'error' });
      const whileHeld = await markNow();
      await pointer('pointermove', 0);
      const afterMove = await until(async () => { const m = await markNow(); return m === 'error' ? m : null; }, 2000) || await markNow();
      await pointer('pointerdown', 1);
      if (rowBefore) await putRow({ ...rowBefore, state: 'attention' });
      const heldAgain = await markNow();
      await wait(4300);
      await inPage(() => { Desk.paint(); return true; });
      const afterTime = await until(async () => { const m = await markNow(); return m === 'needs' ? m : null; }, 2000) || await markNow();
      await pointer('pointerup', 0);
      if (rowBefore) {
        await putRow(rowBefore);
        await inPage((key, was) => { if (was) Desk.state.unread.add(key); else Desk.state.unread.delete(key); Desk.paint(); return true; }, pressRow, unreadBefore);
      }
      check('a press whose release the window never sees holds the drawing only until the mouse moves without a button, or 4 seconds at most; then the chats show how they stand',
        Boolean(pressRow) && whileHeld === markBefore && afterMove === 'error' && heldAgain === 'error' && afterTime === 'needs',
        JSON.stringify({ row: Boolean(pressRow), markBefore, whileHeld, afterMove, heldAgain, afterTime }));

      // a yes or no Jev found in an answer the person then had in front of them calls no more (his word, 4 Oct: "it
      // tells me something needs me even though it doesn't"): the chat is drawn as it stands and leaves what needs you
      await inPage((id) => { Desk.setView(id); Desk.setView('stats'); }, chat);
      await drawn();
      const seenA = await inPage((key) => {
        const c = Desk.state.snap.chats.find((x) => x.key === key);
        const bar = document.querySelector(`#stats .bars-sec .cbar[data-key="${key}"]`);
        return { mark: Desk.markFor(c), wants: Desk.wants(c), tone: bar ? [...bar.classList].find((k) => k.startsWith('t-')) : '',
          need: document.getElementById('triage').textContent, inNeeds: Boolean(document.querySelector(`#chat-list section.group[data-group$="needs"] .chat[data-key="${key}"]`)) };
      }, A);
      check('a yes or no Jev found in an answer the person then had in front of them calls no more: drawn as it stands, out of what needs you, one fewer at the top',
        seenA.mark === 'idle' && !seenA.wants && seenA.tone === 't-idle' && !seenA.inNeeds && /^2 need you$/.test(seenA.need), JSON.stringify(seenA));

      // switched off, the window is as Claude Code says
      jev.on(false);
      await until(() => exec('!Desk.Jev.on()'), 3000);
      const off = await inPage((list) => list.map((key) => Desk.markFor(Desk.state.snap.chats.find((x) => x.key === key))), [A, D]);
      check('switched off, Jev changes nothing: the chats are drawn as Claude Code says', same(off, ['idle', 'idle'])
        && /1 needs you/.test(await exec('document.getElementById("triage").textContent')), JSON.stringify(off));

      // Settings: the switch, the spending, what leaves; the look
      await inPage(() => Desk.Settings.open('jev'));
      await drawn();
      const panel = await inPage((key) => {
        const s = document.querySelector('#settings section[data-section="jev"]');
        return s ? { text: s.textContent, on: s.querySelector('.switch').classList.contains('on'), leak: document.documentElement.outerHTML.includes(key) } : null;
      }, KEY);
      check('Settings shows Jev off, the month\'s spending, what leaves, and never the key', Boolean(panel) && !panel.on && !panel.leak
        && panel.text.includes('This month: $0.0005, 5 questions') && panel.text.includes('ops record folder are never sent'), panel ? panel.text.slice(0, 70) : 'no section');
      const looks = await inPage(async (id) => {
        const pick = (name) => [...document.querySelectorAll('#settings .seg button')].find((b) => b.textContent === name).click();
        const read = () => [document.documentElement.dataset.look, getComputedStyle(document.documentElement).backgroundColor, Terms.get(id).term.options.theme.background];
        pick('Grey');
        await new Promise((r) => setTimeout(r, 300));
        const grey = read();
        pick('Noir');
        await new Promise((r) => setTimeout(r, 300));
        return [grey, read()];
      }, chat);
      check('the look switches between Noir and grey, the terminals with it', looks[0][0] === 'grey' && looks[1][0] === 'noir' && looks[0][1] !== looks[1][1]
        && looks[0][2] === '#111113' && looks[1][2] === '#060607', JSON.stringify(looks));
      await inPage(() => Desk.Settings.close());

      // search put in order by Jev; a conversation in the ops record keeps its place and is never shown to it
      const fhome = path.join(root, 'fhome');
      const notes = path.join(root, 'made-up-notes');
      const X = ['11111111-2222-4333-8444-888888888801', '11111111-2222-4333-8444-888888888802', '11111111-2222-4333-8444-888888888803'];
      const conv = (cwd, id) => path.join(fhome, '.claude', 'projects', cwd.replace(/[^A-Za-z0-9]/g, '-'), `${id}.jsonl`);
      const day = (n) => new Date(now - n * 86400e3).toISOString();
      writeRows(conv(notes, X[0]), [{ type: 'ai-title', aiTitle: 'Made-up lantern colours' }, { type: 'user', timestamp: day(3), cwd: notes, message: { role: 'user', content: 'made-up lantern colours' } }]);
      writeRows(conv(notes, X[1]), [{ type: 'ai-title', aiTitle: 'Made-up lantern build' }, { type: 'user', timestamp: day(5), cwd: notes, message: { role: 'user', content: 'made-up lantern build steps' } }]);
      writeRows(conv(record, X[2]), [{ type: 'ai-title', aiTitle: 'Made-up lantern record' }, { type: 'user', timestamp: day(1), cwd: record, message: { role: 'user', content: 'made-up lantern record' } }]);
      await find.start(fhome, path.join(root, 'data', 'find'), now);
      finding = true;
      await until(async () => { const s = await find.ask('status'); return s && s.progress && s.progress.files === 3 && !s.progress.building ? s : null; }, 15000, 200);
      const plain = await find.ask('search', { q: 'lantern' });
      jev.on(true);
      const sent = calls.length;
      const sorted = await jev.sorted('lantern');
      const shown = calls.slice(sent).map((x) => JSON.stringify(x.body));
      check('search: first as found, newest first', same((plain.results || []).map((r) => r.id), [X[2], X[0], X[1]]));
      check('Jev puts the results in order; the one from the ops record keeps its place and is never shown to it', Boolean(sorted) && sorted.sorted === true
        && same(sorted.results.map((r) => r.id), [X[2], X[1], X[0]]) && shown.length === 1 && !shown[0].includes('lantern record') && shown[0].includes('lantern build'),
      sorted ? sorted.results.map((r) => r.id.slice(-2)).join(' ') : 'not sorted');
      const again = await jev.sorted('lantern');
      check('the same search again costs nothing', Boolean(again) && calls.length === sent + 1 && same(again.results.map((r) => r.id), [X[2], X[1], X[0]]));
    } finally {
      try {
        jev.stub(null);
        jev.key('');
        jev.on(false);
        jev.flush();
        if (!hadFile) fs.rmSync(jev.file(), { force: true });
        if (finding) await find.stop();
        if (installed) await inPage((id) => {
          const saved = window.deskJevSaved;
          if (!saved) return;
          try {
            Desk.Settings.close();
            Desk.Glance.hide();
            Terms.remove(id);
          } finally {
            Object.assign(Desk.state, saved.state);
            if (saved.storage === null) sessionStorage.removeItem('desk-place'); else sessionStorage.setItem('desk-place', saved.storage);
            if (saved.away === null) localStorage.removeItem('desk.away'); else localStorage.setItem('desk.away', saved.away);
            Desk.Morning.load();
            // the Dashboard drawn once with the restored picture lets go of the made-up bars
            Desk.state.view = 'stats';
            Desk.paint();
            Desk.state.view = saved.state.view;
            for (const [key, hidden] of Object.entries(saved.hidden)) document.getElementById(key).hidden = hidden;
            Desk.setView(saved.state.view);
            delete window.deskJevSaved;
          }
        }, chat);
      } finally {
        local = null;
        const target = path.resolve(root);
        if (!target.startsWith(path.resolve(dir) + path.sep)) throw new Error('The made-up Jev folder left its output directory.');
        fs.rmSync(target, { recursive: true, force: true });
        watch.post({ type: 'pace', ms: 2000 });
      }
      const clear = await inPage((id, list) => !window.deskJevSaved && !Terms.get(id) && !Desk.state.chats.some((c) => c.id === id) && !Desk.Jev.on()
        && !Desk.state.snap.chats.some((c) => list.includes(c.key)) && !Desk.Morning.away()
        && ![...document.querySelectorAll('#chat-list [data-key], #stats .cbar[data-key], #stats .mr-row')].some((el) => list.includes(el.dataset.key)), chat, keys);
      check('the Jev phase leaves no made-up folder, session, key, verdict file, terminal or page override behind', !fs.existsSync(root) && clear
        && !jev.view().hasKey && !jev.view().on && fs.existsSync(jev.file()) === hadFile && settingsNow().look === lookBefore);
    }
  };

  // ---- the Noir look: the light behind the window, what one picture of it costs, and when it stands still. A hidden
  // ---- window is never in front and draws no frames by itself: each picture of the light here is drawn on purpose.
  const lookPhase = async () => {
    check('the window loads for the look checks', Boolean(await until(() => exec('typeof Desk === "object" && Desk !== null && typeof Noir === "object"'), 15000)));
    watch.post({ type: 'pace', ms: 600000 });
    win.setContentSize(1600, 960);
    await wait(700);
    const afternoon = new Date();
    afternoon.setHours(15, 40, 0, 0);
    madeAt = await inPage(pageClock, afternoon.getTime() - Date.now());
    await installFakes();
    await showUsage('today');
    await exec(`takeSnapshot(${fake(madeAt, madeUpRows(false))})`);
    await exec(`takeSnapshot(${fake(madeAt + 1, madeUpRows(true))})`);
    await wait(400);

    // this window draws no frames of its own: one picture drawn now takes the size it was given
    await exec('Noir.drawNow()');
    const st = await exec('Noir.state()');
    const dpr = await exec('window.devicePixelRatio');
    const box = await exec('[document.querySelector(".backdrop").clientWidth, document.querySelector(".backdrop").clientHeight]');
    say(`      the light is drawn by ${(await exec('Noir.renderer()')) || 'a graphics chip that gives no name'}: ${st.size.join(' x ')} pixels, the scene at ${st.scene.join(' x ')}`);
    check('Noir is the look a new window opens in: its light compiles and fills the window in the screen\'s own pixels, the scene at a quarter of each side',
      st.on && !st.failed && (await exec('document.documentElement.dataset.look')) === 'noir' && Boolean(await exec('Boolean(document.querySelector(".backdrop > canvas.noir"))'))
      && st.size[0] === Math.round(box[0] * dpr) && st.size[1] === Math.round(box[1] * dpr) && st.scene[0] === Math.ceil(st.size[0] / 4) && st.scene[1] === Math.ceil(st.size[1] / 4),
      JSON.stringify({ ...st, dpr, box }));

    const times = await inPage(() => Array.from({ length: 16 }, (_, i) => Noir.drawNow(12 + i / 24)));
    const order = times.slice().sort((a, b) => a - b);
    const median = order[Math.floor(order.length / 2)];
    check('one picture of the light takes the graphics chip a few milliseconds at most: at 24 a second there are 42 ms between two',
      times.every((t) => t >= 0) && median < 6, `median ${median.toFixed(2)} ms, slowest ${order[order.length - 1].toFixed(2)} ms, over ${times.length} pictures`);

    const tones = await inPage(() => {
      const at = (o) => { Noir.drawNow(12, o); return Noir.sample(); };
      return { silver: at({ warm: 0, lift: 0 }), warm: at({ warm: 1, lift: 0 }), green: at({ warm: 0, lift: 1 }) };
    });
    const r2 = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, Math.round(v * 1000) / 1000]));
    check('the light is dim fine dots, silver; warm while a chat waits for you, green for a moment when one finishes',
      tones.silver.lit > 0.01 && tones.silver.lit < 0.5 && tones.silver.mean < 0.05 && Math.abs(tones.silver.warmth) < 0.03
      && tones.warm.warmth > tones.silver.warmth + 0.03 && tones.green.greenness > tones.silver.greenness + 0.03 && tones.green.mean > tones.silver.mean,
      JSON.stringify({ silver: r2(tones.silver), warm: r2(tones.warm), green: r2(tones.green) }));

    const runs = await inPage(() => {
      const html = document.documentElement;
      const wasStill = html.classList.contains('still');
      const out = {};
      Noir.setAwake(false);
      out.away = Noir.state().running;
      html.classList.remove('still');
      Noir.setAwake(true);
      out.front = Noir.state().running;
      out.hidden = document.hidden;
      Noir.setMoving(false);
      out.still = Noir.state().running;
      Noir.setMoving(true);
      out.again = Noir.state().running;
      Noir.setAwake(false);
      out.left = Noir.state().running;
      if (wasStill) html.classList.add('still');
      return out;
    });
    check('the light moves only while the window is in front: not in front, or with Moving light off, it draws nothing more',
      runs.away === false && runs.front === !runs.hidden && runs.still === false && runs.again === !runs.hidden && runs.left === false,
      `${JSON.stringify(runs)}${runs.hidden ? '; this hidden window counts as not shown, so the moving itself was not seen here' : ''}`);
    const typed = await inPage(() => {
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', code: 'KeyA', bubbles: true, cancelable: true }));
      return Noir.state().typing;
    });
    await wait(1800);
    const rested = await exec('Noir.state().typing');
    check('while the person types the light holds still, and it moves again a moment after the last key', typed === true && rested === false, JSON.stringify({ typed, rested }));

    // What moving costs: five seconds standing still, then five seconds of 24 pictures a second, in processor seconds
    // used by every process of the app over each. A hidden window gets one frame a second, so the pictures are drawn
    // on a timer here; each also waits to read one pixel back, which the moving light never does. Not measured:
    // putting the picture on the screen, which only a shown window does.
    const seconds = () => {
      const list = app.getAppMetrics();
      const of = (l) => l.reduce((s, m) => s + (m.cpu.cumulativeCPUUsage || 0), 0);
      return { all: of(list), gpu: of(list.filter((m) => m.type === 'GPU')), at: Date.now() };
    };
    const share = (a, b) => ({ all: ((b.all - a.all) / ((b.at - a.at) / 1000)) * 100, gpu: ((b.gpu - a.gpu) / ((b.at - a.at) / 1000)) * 100 });
    const s0 = seconds();
    await wait(5000);
    const s1 = seconds();
    const framesBefore = await exec('Noir.state().frames');
    await exec('window.noirSpin = setInterval(() => Noir.drawNow(12 + performance.now() / 1000), 1000 / 24); true');
    const s2 = seconds();
    await wait(5000);
    const s3 = seconds();
    await exec('clearInterval(window.noirSpin); delete window.noirSpin; true');
    const drawnMoving = (await exec('Noir.state().frames')) - framesBefore;
    const standing = share(s0, s1);
    const moving = share(s2, s3);
    const fmt = (x) => `${x.toFixed(1)}%`;
    check('24 pictures a second of the light cost the app a few percent of one processor core',
      drawnMoving >= 100 && s1.all > 0 && moving.all - standing.all < 10,
      `${drawnMoving} pictures in 5 s; every process of the app together used ${fmt(standing.all)} of one core standing still and ${fmt(moving.all)} drawing `
      + `(the graphics process ${fmt(standing.gpu)} and ${fmt(moving.gpu)})`);

    // the pictures: a chat waits in the made-up list, so the light is warm; then none waits, and it is silver
    await view('stats');
    await wait(400);
    await exec('Noir.drawNow()');
    await shoot('look-1-dashboard-warm');
    const calm = madeUpRows(true).filter((r) => r.state !== 'attention' && r.state !== 'error');
    await exec(`takeSnapshot(${fake(madeAt + 2, calm)})`);
    await wait(300);
    await exec('Noir.drawNow()');
    await shoot('look-2-dashboard-silver');
    await exec('Desk.look({ kind: "live", key: "s-agents" })');
    await wait(500);
    await exec('Noir.drawNow()');
    await shoot('look-3-chat-looked-at');
    const warmNow = await exec('Noir.state().warm');
    check('nothing waits in the list: the light is silver again', warmNow === 0, `warm: ${warmNow}`);

    // See-through, as a window opens on Windows 11: the desktop shows under the title bar and the sidebar, through the
    // tint and between the dots. A hidden window has no desktop behind it, so a bright picture stands in for one: a
    // white window, the harshest case, before the darkening Windows' own blur adds. The sidebar's words must still
    // stand out of it. The first picture has the tint, greys and halo this look had until 3 Oct.
    const seeThrough = (on, old) => inPage((on, old) => {
      const html = document.documentElement;
      html.classList.toggle('glass', on);
      document.body.classList.toggle('live', on);
      html.style.background = on ? 'linear-gradient(115deg, #fff 0 34%, #f3efe6 34% 58%, #a9cdf0 58%)' : '';
      document.querySelector('.backdrop').style.background = old ? 'rgba(0, 0, 0, .62)' : '';
      for (const el of document.querySelectorAll('.sidebar, .titlebar')) {
        for (const [k, v] of [['--text-2', '#a5a5ac'], ['--text-3', '#6e6e76'], ['--text-4', '#4a4a51']]) {
          if (old) el.style.setProperty(k, v); else el.style.removeProperty(k);
        }
        el.style.textShadow = old ? '0 0 3px #000, 0 0 9px rgba(0, 0, 0, .95)' : '';
      }
      Noir.drawNow(undefined, { glass: on });
      return true;
    }, on, old);
    // how far each kind of word in the sidebar stands out of the tint over a white window; small text needs 4.5 to 1
    const readable = () => inPage(() => {
      const lum = (rgb) => rgb.reduce((s, v, i) => {
        const c = v / 255;
        return s + [0.2126, 0.7152, 0.0722][i] * (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
      }, 0);
      const nums = (css) => (css.match(/[\d.]+/g) || []).map(Number);
      const box = document.createElement('div');
      box.innerHTML = '<div class="group"><div class="group-head">Working</div><div class="group-inner"><div class="nav-item chat">'
        + '<span class="label">A chat</span><span class="meta"><span class="m-folder">shop</span></span></div></div></div>'
        + '<div class="spaces"><button class="space-tab"><span class="space-name">Mine</span></button></div>';
      document.querySelector('.sidebar').append(box);
      const tint = nums(getComputedStyle(document.querySelector('.backdrop')).backgroundColor);
      const a = tint[3] ?? 1;
      const ground = lum([0, 1, 2].map((i) => tint[i] * a + 255 * (1 - a)));
      const ratio = (sel) => Math.round(((lum(nums(getComputedStyle(box.querySelector(sel)).color).slice(0, 3)) + 0.05) / (ground + 0.05)) * 100) / 100;
      const out = { tint: a, chat: ratio('.label'), under: ratio('.meta'), group: ratio('.group-head'), space: ratio('.space-name') };
      box.remove();
      return out;
    });
    await seeThrough(true, true);
    const readBefore = await readable();
    await shoot('look-3b-see-through-until-3-oct');
    await seeThrough(true, false);
    const readNow = await readable();
    await shoot('look-3c-see-through-now');
    await seeThrough(false, false);
    check('see-through over a white window, the sidebar\'s words stand out at least 4.5 to 1: chat names, the line under them, the groups, the workspaces',
      readNow.chat >= 4.5 && readNow.under >= 4.5 && readNow.group >= 4.5 && readNow.space >= 4.5,
      `now ${JSON.stringify(readNow)}; until 3 Oct ${JSON.stringify(readBefore)}`);

    // Settings: the look, and the switch that stops the light
    await inPage(() => Desk.Settings.open('look'));
    await drawn();
    await shoot('look-4-settings');
    const rowOn = (label) => inPage((text) => {
      const r = [...document.querySelectorAll('#settings .set-row')].find((x) => (x.querySelector('.what > div') || {}).textContent === text);
      return r ? r.querySelector('.switch').classList.contains('on') : null;
    }, label);
    const clickRow = (label) => inPage((text) => {
      const r = [...document.querySelectorAll('#settings .set-row')].find((x) => (x.querySelector('.what > div') || {}).textContent === text);
      if (r) r.click();
      return Boolean(r);
    }, label);
    const wasOn = await rowOn('Moving light');
    await clickRow('Moving light');
    const stopped = await until(async () => settingsNow().motion === false && (await exec('!Noir.state().moving')), 3000, 100);
    const offShown = await rowOn('Moving light');
    await clickRow('Moving light');
    const started = await until(async () => settingsNow().motion === true && (await exec('Noir.state().moving')), 3000, 100);
    check('Settings has a Moving light switch: off, the light stands still, and that is kept',
      wasOn === true && Boolean(stopped) && offShown === false && Boolean(started), JSON.stringify({ wasOn, stopped: Boolean(stopped), offShown, started: Boolean(started) }));
    const grey = await inPage(async () => {
      const pickLook = (name) => [...document.querySelectorAll('#settings .seg button')].find((b) => b.textContent === name).click();
      const canvas = document.querySelector('canvas.noir');
      const now = () => ({ look: document.documentElement.dataset.look, shown: getComputedStyle(canvas).display !== 'none', on: Noir.state().on, running: Noir.state().running,
        moving: [...document.querySelectorAll('#settings .set-row .what > div')].some((d) => d.textContent === 'Moving light') });
      pickLook('Grey');
      await new Promise((r) => setTimeout(r, 300));
      const was = now();
      pickLook('Noir');
      await new Promise((r) => setTimeout(r, 300));
      return [was, now()];
    });
    check('the grey look has no light at all, and no Moving light switch; back in Noir both return',
      grey[0].look === 'grey' && !grey[0].shown && !grey[0].on && !grey[0].running && !grey[0].moving
      && grey[1].look === 'noir' && grey[1].shown && grey[1].on && grey[1].moving, JSON.stringify(grey));
    await inPage(() => Desk.Settings.close());
    await exec('Desk.look(null)');
    await inPage(pageClock, 0);
  };

  // ---- the servers page, with made-up servers only: each a few lines of node that ends by itself within 90 s. What
  // ---- runs on this machine is hidden in the test's own list first: none of it is shown in a picture or printed. ----
  const serversPhase = async () => {
    check('the window loads for the servers checks', Boolean(await until(() => exec('typeof Desk === "object" && Desk !== null && typeof Servers === "object"'), 15000)));
    watch.post({ type: 'pace', ms: 600000 });
    win.setContentSize(1440, 900);
    // the list of chats beside the page in its pictures: the made-up one, as in every picture that may be shown
    madeAt = Date.now();
    await installFakes();
    await showUsage('today');
    await exec(`takeSnapshot(${fake(madeAt, madeUpRows(false))})`);
    await exec(`takeSnapshot(${fake(madeAt + 1, madeUpRows(true))})`);
    const net = require('node:net');
    const { spawn, spawnSync } = require('node:child_process');
    const freePort = () => new Promise((resolve) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); });
    const listening = (port) => new Promise((resolve) => {
      const c = net.connect({ port, host: '127.0.0.1' });
      const done = (v) => { c.destroy(); resolve(v); };
      c.once('connect', () => done(true));
      c.once('error', () => done(false));
      setTimeout(() => done(false), 1500);
    });
    const root = fs.mkdtempSync(path.join(dir, 'srv-'));
    const proj = path.join(root, 'made-up-dashboard');
    const other = path.join(root, 'made-up-other');
    const serverJs = [
      "const http = require('node:http');",
      'const port = Number(process.argv[2]) || 0;',
      "const s = http.createServer((q, r) => r.end('made-up'));",
      "s.listen(port, '127.0.0.1', () => console.log('Made-up server ready at http://localhost:' + s.address().port + '/'));",
      '// never outlives the test that started it by much',
      'setTimeout(() => process.exit(0), 90000);',
    ].join('\n');
    for (const f of [proj, other]) { fs.mkdirSync(f, { recursive: true }); fs.writeFileSync(path.join(f, 'server.js'), serverJs); }
    fs.writeFileSync(path.join(proj, 'fail.js'), "console.log('made-up failure: the database is not there');\nprocess.exit(3);\n");
    const mine = (folder) => [proj, other].some((f) => f.toLowerCase() === String(folder || '').toLowerCase());
    const outside = [];
    // a made-up server started by this test itself, as one started in another terminal would be
    const runOutside = (folder, port) => { const c = spawn('node', ['server.js', String(port)], { cwd: folder, windowsHide: true, stdio: 'ignore' }); outside.push(c); return c; };
    const ended = (c) => c.exitCode !== null || c.signalCode !== null;
    const press = (sel, label) => inPage((s, l) => { const b = [...document.querySelectorAll(s)].find((x) => x.textContent.trim() === l); if (b) b.click(); return Boolean(b); }, sel, label);
    const acts = (id) => `#servers .srv-row[data-id="${id}"] .srv-acts button`;
    const rowNow = (id) => inPage((i) => {
      const r = document.querySelector(`#servers .srv-row[data-id="${i}"]`);
      return r && { state: r.dataset.state, name: r.querySelector('.srv-name').textContent, addr: (r.querySelector('.srv-addr') || {}).textContent || '', words: r.querySelector('.srv-state').textContent,
        figs: r.querySelector('.srv-figs').textContent, text: r.textContent, acts: [...r.querySelectorAll('.srv-acts button')].map((b) => b.textContent.trim()) };
    }, id);
    const looseNow = (port) => inPage((p) => {
      const r = [...document.querySelectorAll('#servers .srv-row.loose')].find((x) => (x.querySelector('.srv-addr') || {}).textContent === `localhost:${p}`);
      return r && { name: r.querySelector('.srv-name').textContent, text: r.textContent };
    }, port);
    const loosePress = (port, label) => inPage((p, l) => {
      const r = [...document.querySelectorAll('#servers .srv-row.loose')].find((x) => (x.querySelector('.srv-addr') || {}).textContent === `localhost:${p}`);
      const b = r && [...r.querySelectorAll('.srv-acts button')].find((x) => x.textContent.trim() === l);
      if (b) b.click();
      return Boolean(b);
    }, port, label);
    const serverOf = async (id, ok) => { await servers.fresh(); const v = servers.view().servers.find((s) => s.id === id); return v && ok(v) ? v : null; };
    const more = (id, label) => inPage((i, l) => {
      document.querySelector(`#servers .srv-row[data-id="${i}"] .srv-acts .icon-btn`).click();
      const item = [...document.querySelectorAll('#menu .menu-item')].find((b) => b.querySelector('span:not(.icon-gap)').textContent === l);
      if (item) item.click();
      return Boolean(item);
    }, id, label);
    const form = () => inPage(() => {
      const f = document.querySelector('#servers .srv-form-inner');
      return f && { title: f.querySelector('h2').textContent, name: f.querySelector('#srv-f-name').value, folder: f.querySelector('#srv-f-folder').value,
        command: f.querySelector('#srv-f-command').value, url: f.querySelector('#srv-f-url').value, note: (f.querySelector('.srv-form-note') || {}).textContent || '',
        chips: [...f.querySelectorAll('.srv-chip')].map((c) => c.textContent), focused: document.activeElement ? document.activeElement.id : '' };
    });
    const hideReal = async () => {
      await servers.fresh();
      const keys = servers.view().loose.filter((l) => !mine(l.folder)).map((l) => l.key);
      for (const key of keys) await inPage((k) => desk.servers('hide', k, true), key);
      return keys.length;
    };
    let dash = '';
    try {
      // the helper that finds them starts with the watcher: until it answers, nothing of this machine is known yet
      const ready = await until(async () => { await servers.fresh(); return servers.view().ready; }, 20000, 400);
      check('the helper answers which dev servers run on this machine', Boolean(ready));
      const real = await hideReal();
      say(`      ${real} dev server(s) of this machine hidden in the test's own list: what follows shows made-up ones only`);
      await view('servers');
      check('the servers page opens empty: nothing pinned, and it says how to pin one', (await exec('Servers.view().servers.length')) === 0
        && (await exec('!document.querySelector("#servers .srv-empty").hidden && document.querySelector("#servers .srv-empty").textContent.startsWith("Nothing pinned yet")')));
      const headSays = await exec('document.getElementById("crumb").textContent');
      check('the head of the window says where the person is: Servers', headSays === 'Servers', headSays);

      // 1. Claude Code pins a server through the command line; the open window takes it in by itself
      const cli = (...args) => spawnSync(process.execPath, [path.join(__dirname, 'servers-cli.cjs'), ...args, '--profile', app.getPath('userData')],
        { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, encoding: 'utf8', windowsHide: true, timeout: 20000 });
      const port = await freePort();
      const added = cli('add', '--name', 'Made-up dashboard', '--folder', proj, '--command', `node server.js ${port}`);
      const twice = cli('add', '--name', 'Made-up again', '--folder', proj, '--command', `node server.js ${port}`);
      const refused = cli('add', '--name', 'Nowhere', '--folder', 'made-up\\relative', '--command', 'node server.js');
      const first = await until(() => inPage(() => { const r = document.querySelector('#servers .srv-row:not(.loose)'); return r ? r.dataset.id : null; }), 8000, 200);
      dash = first || '';
      const pinned = first ? await rowNow(dash) : null;
      check('Claude Code pins a server from the command line: the open page shows it within seconds, stopped, with its folder and command, and says Claude Code pinned it',
        added.status === 0 && /^Pinned Made-up dashboard/.test(added.stdout) && twice.status === 0 && /^Already pinned/.test(twice.stdout) && refused.status === 1
        && Boolean(pinned) && pinned.state === 'stopped' && pinned.acts.includes('Start') && pinned.text.includes('pinned by Claude Code') && pinned.text.includes(proj),
        JSON.stringify({ added: added.status, twice: twice.status, refused: refused.status, row: pinned && { state: pinned.state, acts: pinned.acts } }));

      // 2. Start: it runs in its folder, its address is read from what it printed, and the sidebar counts it
      await press(acts(dash), 'Start');
      const up = await until(() => serverOf(dash, (v) => v.state === 'running' && v.ports.includes(port)), 15000, 300);
      const upRow = await until(async () => { const r = await rowNow(dash); return r && r.state === 'running' && /^up \d/.test(r.figs) ? r : null; }, 6000, 200);
      const side = await exec('document.getElementById("go-servers").textContent');
      check('Start runs it hidden in its folder: the row says it runs, at the address it printed, for how long and with how much memory; the sidebar counts one running',
        Boolean(up) && up.seen === `http://localhost:${port}/` && up.programs >= 2 && up.mem > 0 && (await listening(port)) && Boolean(upRow)
        && upRow.addr === `localhost:${port}` && upRow.acts.includes('Stop') && upRow.acts.includes('Restart') && side === 'Servers1',
        JSON.stringify({ state: up && up.state, programs: up && up.programs, figs: upRow && upRow.figs, side }));
      await more(dash, 'What it printed');
      const printed = await until(() => inPage((i) => { const p = document.querySelector(`#servers .srv-row[data-id="${i}"] .srv-pre`); return p && p.textContent.includes('Made-up server ready') ? p.textContent : null; }, dash), 8000, 200);
      check('What it printed shows its output under its row, from the start line on', Boolean(printed) && printed.includes(`node server.js ${port}`));
      await shoot('servers-1-running');

      // 3. Restart: a new program, on the same port
      const before = servers.started()[dash].pid;
      await press(acts(dash), 'Restart');
      const again = await until(async () => { const r = servers.started()[dash]; return r && r.pid !== before ? serverOf(dash, (v) => v.state === 'running' && v.ports.includes(port)) : null; }, 15000, 300);
      check('Restart ends it and starts it again here, on the same port', Boolean(again) && (await listening(port)));

      // 4. Stop: every program under it ends, without a question (it was started here)
      const tree = servers.started()[dash].tree.map(([pid]) => pid);
      await press(acts(dash), 'Stop');
      const down = await until(async () => ((await listening(port)) ? null : serverOf(dash, (v) => v.state === 'stopped')), 10000, 300);
      const left = tree.filter((pid) => { try { process.kill(pid, 0); return true; } catch { return false; } });
      check('Stop ends it and every program under it: its port is free, none of its programs is left, and nothing was asked first',
        Boolean(down) && tree.length >= 2 && left.length === 0 && servers.asked() === '' && !servers.started()[dash], JSON.stringify({ programs: tree.length, left: left.length }));

      // 5. The same server started outside Lowlit: found by its folder, ended only after the question that names it
      const outsider = runOutside(proj, port);
      const elsewhere = await until(() => serverOf(dash, (v) => v.state === 'elsewhere'), 10000, 300);
      const elsewhereRow = await until(async () => { const r = await rowNow(dash); return r && r.state === 'elsewhere' ? r : null; }, 5000, 200);
      check('started outside Lowlit in its folder, it shows on its own row as running, started outside Lowlit, with Stop… in place of Start',
        Boolean(elsewhere) && Boolean(elsewhereRow) && elsewhereRow.words === 'Running, started outside Lowlit by node' && elsewhereRow.acts.includes('Stop…') && !elsewhereRow.acts.includes('Start'),
        JSON.stringify(elsewhereRow && { words: elsewhereRow.words, acts: elsewhereRow.acts }));
      await press(acts(dash), 'Stop…');
      const outsiderGone = await until(() => ended(outsider), 10000, 200);
      check('Stop… asks first, naming the program, its port and its folder, and then ends it', Boolean(outsiderGone)
        && servers.asked().startsWith(`Stop node on port ${port}, in ${proj}?`) && servers.asked().includes('Lowlit did not start it.'), servers.asked());

      // 6. Its port held by a server of another folder: in the way, not this server
      await inPage((i, p) => desk.servers('update', i, { url: `localhost:${p}` }), dash, port);
      const blocker = runOutside(other, port);
      const blocked = await until(() => serverOf(dash, (v) => v.state === 'blocked'), 10000, 300);
      const blockedRow = await until(async () => { const r = await rowNow(dash); return r && r.state === 'blocked' ? r : null; }, 5000, 200);
      const startBlocked = await inPage((i) => desk.servers('start', i), dash);
      check('when a server of another folder holds its port, the row says the port is taken and by what, and Start says so instead of starting a second one',
        Boolean(blocked) && Boolean(blockedRow) && blockedRow.words === `Port ${port} is taken by node in made-up-other` && Boolean(startBlocked && startBlocked.error)
        && startBlocked.error === `Port ${port} is taken by node in made-up-other.`, JSON.stringify({ words: blockedRow && blockedRow.words, start: startBlocked }));
      blocker.kill();
      await until(() => ended(blocker), 5000, 100);
      await inPage((i) => desk.servers('update', i, { url: '' }), dash);

      // 7. One that runs and is no pinned server: shown below; Pin fills the form in from what runs
      const port2 = await freePort();
      const loner = runOutside(other, port2);
      const loose = await until(async () => { await servers.fresh(); return looseNow(port2); }, 10000, 300);
      check('a dev server that is no pinned one shows under Running now, not pinned, by its folder and its address', Boolean(loose) && loose.name === 'made-up-other' && loose.text.includes(other));
      await loosePress(port2, 'Pin');
      const filled = await until(form, 5000, 150);
      check('Pin opens the form filled in from what runs: the folder\'s name, the folder, its address; the command, which Lowlit cannot tell for a plain node, is asked for',
        Boolean(filled) && filled.title === 'Pin this server' && filled.name === 'made-up-other' && filled.folder === other && filled.url === `http://localhost:${port2}/`
        && filled.command === '' && filled.note.startsWith('Lowlit could not tell') && !filled.note.includes('scripts') && filled.focused === 'srv-f-command', JSON.stringify(filled && { ...filled, folder: filled.folder === other }));
      await shoot('servers-2-pin-form');
      await inPage((cmd) => { const f = document.querySelector('#servers .srv-form-inner'); f.querySelector('#srv-f-command').value = cmd; f.requestSubmit(); }, `node server.js ${port2}`);
      const nowPinned = await until(async () => { await servers.fresh(); const v = servers.view(); const s = v.servers.find((x) => x.folder === other); return s && s.state === 'elsewhere' && !v.loose.some((l) => l.folder === other) ? s : null; }, 8000, 300);
      check('pinned, it moves up to the pinned list as running outside Lowlit, and the form closes', Boolean(nowPinned) && nowPinned.by === 'app' && (await exec('!document.querySelector("#servers .srv-form-inner")')));

      // 8. Unpinned it goes back below; Hide takes it off the page, and the button under the heading brings it back
      await more(nowPinned.id, 'Unpin');
      const back = await until(async () => { await servers.fresh(); return looseNow(port2); }, 8000, 300);
      await loosePress(port2, 'Hide');
      const hidden = await until(async () => ((await looseNow(port2)) ? null : exec('(() => { const b = document.querySelector("#servers .srv-unhide"); return b.hidden ? null : b.textContent; })()')), 5000, 150);
      const hiddenCount = servers.view().hidden;
      await inPage(() => document.querySelector('#servers .srv-unhide').click());
      const shownAgain = await until(() => looseNow(port2), 5000, 150);
      check('Unpin leaves it running and puts it back below; Hide takes it off the page, and the button by the heading brings it back',
        Boolean(back) && hiddenCount >= 1 && hidden === (hiddenCount === 1 ? 'Show the one you hid' : `Show the ${hiddenCount} you hid`) && Boolean(shownAgain),
        JSON.stringify({ back: Boolean(back), shownAgain: Boolean(shownAgain) }));
      await hideReal();

      // 9. Stop… on one that is not pinned: asked first, by name, and ended
      await loosePress(port2, 'Stop…');
      const lonerGone = await until(() => ended(loner), 10000, 200);
      check('Stop… on a server that is not pinned asks first, naming its port and folder, and ends it', Boolean(lonerGone) && servers.asked().includes(`port ${port2}, in ${other}?`), servers.asked());

      // 10. One that stops on its own with an error says so, and shows why
      const failing = await inPage((f) => desk.servers('add', { name: 'Made-up failing', folder: f, command: 'node fail.js' }), proj);
      await until(() => rowNow(failing.id), 5000, 100);
      await press(acts(failing.id), 'Start');
      const failed = await until(() => serverOf(failing.id, (v) => v.state === 'failed'), 10000, 300);
      const failRow = await until(async () => { const r = await rowNow(failing.id); return r && r.state === 'failed' ? r : null; }, 5000, 200);
      await press(acts(failing.id), 'What it printed');
      const why = await until(() => inPage((i) => { const p = document.querySelector(`#servers .srv-row[data-id="${i}"] .srv-pre`); return Boolean(p && p.textContent.includes('the database is not there')); }, failing.id), 6000, 200);
      const sideBad = await exec('!document.querySelector("#go-servers .srv-side-bad").hidden && document.getElementById("go-servers").dataset.tip.includes("Made-up failing")');
      check('a server that stops on its own with an error says so on its row, offers Start again, shows what it printed, and the sidebar marks it',
        Boolean(failed) && failed.exit.code === 3 && Boolean(failRow) && /^Stopped on its own at \d\d:\d\d, with an error$/.test(failRow.words) && failRow.acts.includes('Start') && why && sideBad,
        JSON.stringify({ code: failed && failed.exit.code, words: failRow && failRow.words, why, sideBad }));

      // 11. Edit: the form holds what is kept, and a change is saved
      await more(failing.id, 'Edit…');
      const editing = await until(form, 3000, 100);
      await inPage(() => { const f = document.querySelector('#servers .srv-form-inner'); f.querySelector('#srv-f-name').value = 'Made-up renamed'; f.requestSubmit(); });
      const renamed = await until(async () => { const r = await rowNow(failing.id); return r && r.name === 'Made-up renamed'; }, 5000, 150);
      check('Edit… opens the form with what is kept, and the new name is saved', Boolean(editing) && editing.title === 'Edit Made-up failing' && editing.name === 'Made-up failing'
        && editing.command === 'node fail.js' && Boolean(renamed));

      // 12. Add a server: the folder's own scripts are offered as commands
      fs.writeFileSync(path.join(other, 'package.json'), JSON.stringify({ scripts: { dev: 'node server.js 0', build: 'node build.js' } }));
      fs.writeFileSync(path.join(other, 'pnpm-lock.yaml'), '');
      await inPage(() => [...document.querySelectorAll('#servers .page-head button')].find((b) => b.textContent === 'Add a server').click());
      await inPage((f) => { const el = document.querySelector('#srv-f-folder'); el.value = f; el.dispatchEvent(new Event('change')); }, other);
      const offered = await until(async () => { const f = await form(); return f && f.chips.length ? f : null; }, 4000, 100);
      check('Add a server offers the folder\'s own scripts, run the way its package manager runs them', Boolean(offered) && offered.title === 'Add a server' && same(offered.chips, ['pnpm dev', 'pnpm build']),
        JSON.stringify(offered && offered.chips));
      await inPage(pageKey, 'Escape', '#servers .srv-form-inner');
      check('Escape closes the form without saving', Boolean(await until(() => exec('!document.querySelector("#servers .srv-form-inner")'), 2000, 100)) && servers.view().servers.length === 2);

      // 13. Ctrl+Shift+S comes back here from anywhere; the picture has one running, one stopped with an error
      await press(acts(dash), 'Start');
      await until(() => serverOf(dash, (v) => v.state === 'running'), 15000, 300);
      await view('stats');
      await inPage(pageCtrl, 'KeyS', true, true);
      check('Ctrl+Shift+S opens the servers page', (await exec('Desk.state.view')) === 'servers');
      await until(async () => { const r = await rowNow(dash); return r && r.state === 'running' && /^up \d/.test(r.figs); }, 5000, 200);
      await shoot('servers-3-page');

      // 14. After a close that kept things (his ask, 4 Oct), a server that ran then and is gone now (Windows restarted
      // meanwhile) starts again by itself once a look has seen it gone; one the person stopped, or one that ended by
      // itself, does not; after "Start fresh" none does. Over a list and a record of what was started of its own, with
      // a made-up helper that sees none of their programs.
      const { Servers: ServersAt, writeList } = require('./servers.cjs');
      const backDir = fs.mkdtempSync(path.join(dir, 'srv-back-'));
      const backPort = await freePort();
      const deadPid = spawnSync('node', ['-e', '0'], { windowsHide: true }).pid;
      const ago = Date.now() - 3600e3;
      const lastRun = () => {
        writeList(path.join(backDir, 'servers.json'), { hidden: [], servers: [
          { id: 'sbackaaa1', name: 'Made-up kept server', folder: proj, command: `node server.js ${backPort}`, url: `http://localhost:${backPort}/`, by: 'app', added: ago },
          { id: 'sbackbbb2', name: 'Made-up stopped server', folder: proj, command: 'node fail.js', url: '', by: 'app', added: ago },
          { id: 'sbackccc3', name: 'Made-up ended server', folder: proj, command: 'node fail.js', url: '', by: 'app', added: ago },
        ] });
        fs.mkdirSync(path.join(backDir, 'servers'), { recursive: true });
        fs.writeFileSync(path.join(backDir, 'servers', 'started.json'), JSON.stringify({
          sbackaaa1: { pid: deadPid, at: ago, started: ago, tree: [], exit: null },
          sbackbbb2: { pid: deadPid, at: ago, started: 0, tree: [], exit: null, stopping: true },
          sbackccc3: { pid: deadPid, at: ago, started: 0, tree: [], exit: { code: 3, at: ago + 60e3 } },
        }));
      };
      const backLog = [];
      const serversAt = () => new ServersAt({ dir: backDir, ask: async () => ({ p: [], l: [], s: [] }), env: () => process.env, confirm: async () => false, changed: () => {}, log: (t) => backLog.push(t) });
      lastRun();
      const kept = serversAt();
      kept.bringBack();
      await kept.fresh();
      const cameBack = Boolean(await until(() => listening(backPort), 15000, 300));
      const keptStates = Object.fromEntries(kept.view.servers.map((s) => [s.id, s.state]));
      const restarted = Boolean(kept.run.sbackaaa1) && kept.run.sbackaaa1.pid !== deadPid;
      // the made-up helper sees none of its programs: the made-up server is ended here, all of it
      const backChild = kept.children.get('sbackaaa1');
      if (backChild && backChild.pid) spawnSync('taskkill', ['/PID', String(backChild.pid), '/T', '/F'], { windowsHide: true });
      const ended14 = Boolean(await until(async () => !(await listening(backPort)), 8000, 300));
      kept.close();
      lastRun();
      const fresh14 = serversAt();
      await fresh14.fresh();
      await wait(1500);
      const startedFresh = await listening(backPort) || fresh14.children.size > 0;
      fresh14.close();
      fs.rmSync(backDir, { recursive: true, force: true });
      check('14. after a close that kept things, a server that ran then and is gone now starts again by itself; one stopped by hand or ended by itself does not, and after "Start fresh" none does',
        cameBack && restarted && keptStates.sbackaaa1 === 'starting' && keptStates.sbackbbb2 === 'stopped' && keptStates.sbackccc3 === 'failed' && ended14 && !startedFresh
        && backLog.includes('servers: 1 that ran when Lowlit last ran started again'),
        JSON.stringify({ cameBack, restarted, keptStates, ended: ended14, startedFresh, log: backLog }));
    } finally {
      // nothing made up is left running: the servers started here are stopped, the test's own are ended
      for (const s of servers.view().servers) if (servers.started()[s.id]) await inPage((i) => desk.servers('stop', i), s.id);
      for (const c of outside) if (!ended(c)) try { c.kill(); } catch { /* gone */ }
      await until(() => outside.every(ended), 5000, 100);
      await servers.fresh();
      const still = servers.view().loose.filter((l) => mine(l.folder)).length + servers.view().servers.filter((s) => s.state !== 'stopped' && s.state !== 'failed').length;
      check('afterwards no made-up server is left running', still === 0 && Object.keys(servers.started()).every((id) => !servers.view().servers.some((s) => s.id === id && s.state === 'running')), `still running: ${still}`);
      await view('peek');
    }
  };

  // ---- the Browser: web pages the chats drive through Claude Code's own door for tools, beside the chats. Two made-up
  // ---- chats browse a made-up shop served by this test on this computer only, with the window hidden throughout. ----
  const browserPhase = async () => {
    check('the window loads for the browser checks', Boolean(await until(() => exec('typeof Desk === "object" && Desk !== null && typeof Browser === "object" && Browser.can()'), 15000)));
    watch.post({ type: 'pace', ms: 600000 });
    win.setContentSize(1440, 900);
    madeAt = Date.now();
    await installFakes();
    await showUsage('today');
    await exec(`takeSnapshot(${fake(madeAt, madeUpRows(false))})`);
    await exec(`takeSnapshot(${fake(madeAt + 1, madeUpRows(true))})`);
    const http = require('node:http');
    const { nativeImage } = require('electron');
    const b = browser.get();
    const door = await until(() => { const d = browser.door(); return d && d.port ? d : null; }, 10000, 100);
    check('the browser starts with the window; its door answers on this computer only, and a test run never puts it in Claude Code\'s list',
      Boolean(b) && Boolean(door) && door.server.address().address === '127.0.0.1' && Boolean(b.door) && b.door.listed === false && b.door.port === door.port,
      JSON.stringify({ port: door && door.port, door: b && b.door }));
    if (!b || !door) return;
    const { BrowserWindow } = require('electron');
    const windowsBefore = BrowserWindow.getAllWindows().length;
    // no page window ever shows on the screen in a test: checked at every step that could show one
    const unseen = () => [...b.tabs.values()].every((t) => !t.page.isVisible());

    // the made-up shop: its boxes are opened only when the browser's hook is there, so a failure never puts a box on the screen
    const SHOP = `<!doctype html><html><head><meta charset="utf-8"><title>Made-up shop</title><style>
body{font:15px/1.5 system-ui,sans-serif;margin:0;color:#1b1b1f;background:#fafaf8}header{display:flex;align-items:center;justify-content:space-between;padding:16px 28px;border-bottom:1px solid #e6e4df;background:#fff}
header b{font-size:16px;letter-spacing:-.01em}header a{color:#55555c}main{max-width:640px;padding:26px 28px}h1{font-size:26px;letter-spacing:-.02em;margin:0 0 4px}p{margin:6px 0 14px;color:#55555c}
.card{display:grid;grid-template-columns:120px 1fr;gap:18px;padding:16px;border:1px solid #e6e4df;border-radius:12px;background:#fff;margin:14px 0 18px}.pic{height:120px;border-radius:9px;background:linear-gradient(135deg,#f2c58a,#e2846b)}
label{display:block;margin:12px 0 4px;font-size:13px;color:#55555c}input,select{font:inherit;padding:8px 10px;border:1px solid #d5d3cd;border-radius:8px;width:280px;background:#fff}
button{font:inherit;padding:8px 14px;border-radius:8px;border:1px solid #1b1b1f;background:#1b1b1f;color:#fff;margin:12px 8px 0 0;cursor:pointer}button.ghost{background:#fff;color:#1b1b1f}.tall{height:2400px}
</style></head><body><header><b>Made-up shop</b><a href="/second">Help</a></header><main>
<h1>Made-up linen shirt</h1><p id="count">In your cart: 0</p>
<div class="card"><div class="pic"></div><div><b>$42.00</b><p>A shirt that does not exist, sold to nobody, for the self-test.</p><button id="add">Add to cart</button></div></div>
<label for="name">Name on the order</label><input id="name" placeholder="Your name">
<label for="size">Size</label><select id="size"><option>Small</option><option>Medium</option><option>Large</option></select>
<p id="sent"></p>
<div><button class="ghost" id="save">Save for later</button><button class="ghost" id="del">Empty the cart</button><a href="/second" target="_blank">Delivery times</a></div>
<p id="asked"></p>
<label for="pick">A photo of you wearing it</label><input type="file" id="pick"><p id="picked"></p>
<div class="tall"></div><p>The end of the page.</p></main>
<script>
console.log('made-up shop loaded');
var n = 0;
var $ = function (id) { return document.getElementById(id); };
var box = function (kind, words) { if (!window.__lowlitHooked) { $('asked').textContent = 'no hook for ' + kind; return null; } return window[kind](words); };
$('add').onclick = function () { n++; $('count').textContent = 'In your cart: ' + n; };
$('name').addEventListener('keydown', function (e) { if (e.key === 'Enter') $('sent').textContent = 'Order sent for ' + e.target.value; });
$('save').onclick = function () { box('alert', 'Saved for later'); };
$('del').onclick = function () { var yes = box('confirm', 'Empty the cart?'); $('asked').textContent = yes ? 'The cart is empty' : 'The cart was kept'; };
$('pick').onchange = function (e) { $('picked').textContent = 'Picked ' + e.target.files[0].name; };
var frames = 0; (function f() { frames++; requestAnimationFrame(f); })();
window.framesSeen = function () { return frames; };
</script></body></html>`;
    const SECOND = '<!doctype html><html><head><meta charset="utf-8"><title>Delivery times</title><style>body{font:15px/1.5 system-ui,sans-serif;margin:0;padding:28px;color:#1b1b1f;background:#f6f8fb}h1{font-size:24px;margin:0 0 6px}button{font:inherit;padding:8px 14px;border-radius:8px;border:1px solid #1b1b1f;background:#fff;margin-top:10px}</style></head>'
      + '<body><h1>Delivery times</h1><p>Two to four made-up days.</p><button id="slot" onclick="this.textContent=\'Thursday picked\'">Pick Thursday</button></body></html>';
    // the made-up stock page: an orange bar on top, a picture that is not there, and a click that asks the shop twice
    const STOCK = '<!doctype html><html><head><meta charset="utf-8"><title>Made-up stock</title><style>body{font:15px/1.5 system-ui,sans-serif;margin:0;color:#1b1b1f;background:#fff}'
      + '.bar{height:120px;background:#e2846b}main{padding:20px 28px}h1{font-size:24px;margin:0 0 6px}button{font:inherit;padding:8px 14px;border-radius:8px;border:1px solid #1b1b1f;background:#fff;margin:8px 8px 0 0}</style></head>'
      + '<body><div class="bar"></div><main><h1>Made-up stock</h1><img src="/missing.png" alt="A made-up photo" width="40" height="40"><p id="said">Not checked yet</p>'
      + '<button id="check">Check stock</button><button id="more">Add one</button><p id="n">0 added</p></main><script>var n = 0;'
      + 'document.getElementById("check").onclick = function () { fetch("/api/stock").then(function (r) { return r.json(); }).then(function (j) { document.getElementById("said").textContent = "Stock: " + j.stock; }); fetch("/api/broken").catch(function () {}); };'
      + 'document.getElementById("more").onclick = function () { n++; document.getElementById("n").textContent = n + " added"; };</script></body></html>';
    // a long made-up page: 40 chapters, each a heading, a paragraph and a link (about 13,000 characters of outline)
    const LONG = '<!doctype html><html><head><meta charset="utf-8"><title>Made-up handbook</title></head><body><h1>Made-up handbook</h1>'
      + Array.from({ length: 40 }, (_, i) => `<h2>Chapter ${i + 1}</h2><p>${'Made-up words about nothing in particular, written for the self-test. '.repeat(3)}Chapter ${i + 1} ends here.</p><a href="/long#c${i + 1}">More on chapter ${i + 1}</a>`).join('')
      + '<p>The last made-up line.</p></body></html>';
    // a made-up editor, as a site's admin page for a long post: a text area taller than the window holding the post, a
    // title, a password, a nonce, a text area with no size; Save sends the post to its own site as JSON with a token,
    // and a beacon to another site (localhost is not 127.0.0.1 to a browser)
    const POST_TEXT = Array.from({ length: 400 }, (_, i) => `Line ${i + 1}: a made-up paragraph with "quotes", <tags> & ampersands, café, 日本語 and a bird 🐦.`).join('\n');
    const PW = 'made-up-typed-password';
    const EDITOR = (beacon) => '<!doctype html><html><head><meta charset="utf-8"><title>Made-up editor</title><style>body{font:15px/1.5 system-ui,sans-serif;margin:0;padding:20px 28px;color:#1b1b1f;background:#fff}'
      + 'label{display:block;margin:12px 0 4px;font-size:13px}input{font:inherit;padding:6px 8px;width:400px}#content{display:block;width:683px;height:6000px;font:13px/1.4 monospace}'
      + '#notes{display:block;width:0;height:0;padding:0;border:0;margin:0}</style></head><body><h1>Made-up editor</h1>'
      + '<form id="post" method="post" action="/made-up-save"><label for="title">Title</label><input id="title" name="post_title" value="A made-up post">'
      + '<label for="content">Content</label><textarea id="content" name="content"></textarea><textarea id="notes" name="notes" aria-label="Hidden notes"></textarea>'
      + '<label for="pw">Made-up password</label><input id="pw" name="made_up_password" type="password"><input type="hidden" name="_wpnonce" value="made-up-nonce-1234">'
      + '<button type="button" id="save">Save</button></form><p id="inputs">0 inputs</p><p id="saved">Not saved</p>'
      + `<script>var n = 0; var c = document.getElementById("content"); c.value = ${JSON.stringify(POST_TEXT)};`
      + 'c.addEventListener("input", function () { n++; document.getElementById("inputs").textContent = n + " inputs"; });'
      + 'document.getElementById("save").onclick = function () {'
      + ' var body = { api_token: "made-up-api-token-9f8e7d6c5b4a39281706f5e4d3c2b1a0", meta: { password: "made-up-nested-password", views: 3 }, title: document.getElementById("title").value, content: c.value };'
      + ' fetch("/api/save", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then(function (r) { return r.json(); })'
      + '.then(function (j) { document.getElementById("saved").textContent = "Saved " + j.length + " characters"; });'
      + ` navigator.sendBeacon(${JSON.stringify(beacon)}, JSON.stringify({ made_up: "beacon" })); };</script></body></html>`;
    const LINKS = '<!doctype html><html><head><meta charset="utf-8"><title>Made-up links</title></head><body><h1>Made-up links</h1><p><a href="/made-up-account">My made-up account</a></p>'
      + '<p><a href="/made-up-account" target="_blank">My made-up account in a new page</a></p></body></html>';
    const ACCOUNT_PAGE = '<!doctype html><html><head><meta charset="utf-8"><title>Made-up account</title></head><body><h1>Made-up inbox</h1><p>Three made-up letters wait here.</p></body></html>';
    // a made-up page with what an eye catches, each on purpose, for look: a bar wider than a phone, a 100×100 picture
    // shown at 300×300, a 200×100 one drawn square, one that is not there, a line cut by its box, two labels on the same
    // spot, small print, a link-button whose text sits at its top, an emoji in a button, a font that is not there, and
    // the content kept to the left of a laptop's screen
    const FAULTS = '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Made-up faults</title><style>'
      + '@font-face{font-family:MadeUpGone;src:url(/gone-font.woff2) format("woff2")}body{font:15px/1.5 system-ui,sans-serif;margin:0;color:#1b1b1f;background:#fff}'
      + 'main{max-width:600px;margin:0 0 0 100px;padding:20px}.wide{width:500px;height:20px;background:#e2846b}img{display:block;margin:8px 0}'
      + '.cut{width:120px;white-space:nowrap;overflow:hidden}.pair{position:relative;height:40px}.pair span{position:absolute;left:0;top:0}.tiny{font-size:10px}'
      + '.go{font:inherit;line-height:20px;display:block;width:160px;height:44px;padding:0 16px;text-align:center;border:1px solid #1b1b1f;border-radius:8px;color:#1b1b1f;text-decoration:none}'
      + '.gone{font-family:MadeUpGone,serif}.end{height:1200px}</style></head><body><main><h1>Made-up faults</h1><div class="wide"></div>'
      + '<img src="/small.png" alt="A made-up small picture" style="width:300px;height:300px"><img src="/wide.png" alt="A made-up wide picture" style="width:200px;height:200px">'
      + '<img src="/missing-look.png" alt="A made-up missing picture" style="width:120px;height:80px"><p class="cut">A made-up line far too long for its narrow box</p>'
      + '<div class="pair"><span>Made-up revenue 1200</span><span>Made-up label</span></div><p class="tiny">Made-up small print</p>'
      + '<a class="go" href="/faults#go">Made-up go</a><button>🚀 Made-up launch</button><p class="gone">Made-up words in a font that is not there</p><div class="end"></div></main></body></html>';
    const pngOf = (w, h) => {
      const px = Buffer.alloc(w * h * 4, 0x99);
      for (let i = 3; i < px.length; i += 4) px[i] = 0xff;
      return nativeImage.createFromBitmap(px, { width: w, height: h }).toPNG();
    };
    const PICTURES = { '/small.png': pngOf(100, 100), '/wide.png': pngOf(200, 100) };
    // the requests the made-up site has not answered yet, and what each connection still open carried: said at the
    // end, when the site is closed
    const answering = new Set();
    const linked = new Set();
    const site = http.createServer((q, r) => {
      const asked = { what: `${q.method} ${q.url}` };
      answering.add(asked);
      r.on('close', () => answering.delete(asked));
      if (q.socket.carried) q.socket.carried.push(`${q.method} ${q.headers.host || ''}${q.url}`);
      const p = String(q.url || '').split('?')[0];
      if (p === '/api/save' && q.method === 'POST') {
        const parts = [];
        q.on('data', (c) => parts.push(c));
        q.on('end', () => {
          let length = -1;
          try { length = String(JSON.parse(Buffer.concat(parts).toString('utf8')).content || '').length; } catch { length = -1; }
          r.writeHead(200, { 'Content-Type': 'application/json' });
          r.end(JSON.stringify({ length }));
        });
        return;
      }
      if (p === '/api/beacon') { q.resume(); r.writeHead(204); r.end(); return; }
      if (p === '/editor') {
        r.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        r.end(EDITOR(`http://localhost:${site.address().port}/api/beacon`));
        return;
      }
      if (p === '/api/stock') {
        r.writeHead(200, { 'Content-Type': 'application/json', 'X-Made-Up': 'visible-header', 'X-Auth-Token': 'made-up-token-value', 'Set-Cookie': 'made-up-session=made-up-secret-cookie; Path=/' });
        r.end('{"stock":3,"made_up":true}');
        return;
      }
      if (p === '/api/broken') { r.writeHead(500, { 'Content-Type': 'application/json' }); r.end('{"error":"made-up failure"}'); return; }
      if (PICTURES[p]) { r.writeHead(200, { 'Content-Type': 'image/png' }); r.end(PICTURES[p]); return; }
      const body = p === '/' ? SHOP : p === '/second' ? SECOND : p === '/stock' ? STOCK : p === '/long' ? LONG : p === '/links' ? LINKS : p === '/made-up-account' ? ACCOUNT_PAGE : p === '/faults' ? FAULTS : '';
      r.writeHead(body ? 200 : 404, { 'Content-Type': 'text/html; charset=utf-8' });
      r.end(body || '<!doctype html><title>Not here</title><p>Not here.</p>');
    });
    site.on('connection', (s) => { s.carried = []; linked.add(s); s.on('close', () => linked.delete(s)); });
    await new Promise((done) => site.listen(0, '127.0.0.1', done));
    const base = `http://127.0.0.1:${site.address().port}`;

    // Claude Code's side, as it talks to the door: JSON-RPC over POST, the session in Mcp-Session-Id, the key in Authorization
    const token = browser.token();
    const post = (body, { sid = '', auth = `Bearer ${token}`, method = 'POST', headers = {}, path: where = '/mcp' } = {}) => new Promise((done, fail) => {
      const text = typeof body === 'string' ? body : JSON.stringify(body);
      const req = http.request({ host: '127.0.0.1', port: door.port, path: where, method, headers: {
        'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', 'Content-Length': Buffer.byteLength(text),
        ...(auth ? { Authorization: auth } : {}), ...(sid ? { 'Mcp-Session-Id': sid } : {}), ...headers,
      } }, (res) => {
        const parts = [];
        res.on('data', (c) => parts.push(c));
        res.on('end', () => {
          const raw = Buffer.concat(parts).toString('utf8');
          let json = null;
          try { json = JSON.parse(raw); } catch { json = null; }
          done({ status: res.statusCode, sid: String(res.headers['mcp-session-id'] || ''), json, raw });
        });
      });
      req.on('error', fail);
      req.end(text);
    });
    let rpc = 0;
    const connect = async () => {
      const r = await post({ jsonrpc: '2.0', id: ++rpc, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'made-up-claude-code', version: '0' } } });
      await post({ jsonrpc: '2.0', method: 'notifications/initialized' }, { sid: r.sid });
      return r;
    };
    const call = async (sid, name, args = {}) => {
      const r = await post({ jsonrpc: '2.0', id: ++rpc, method: 'tools/call', params: { name, arguments: args } }, { sid });
      const res = r.json && r.json.result;
      return { status: r.status, error: Boolean(res && res.isError), text: res ? res.content.filter((c) => c.type === 'text').map((c) => c.text).join('\n') : r.raw,
        image: res ? res.content.find((c) => c.type === 'image') || null : null, images: res ? res.content.filter((c) => c.type === 'image') : [] };
    };
    const refOf = (text, line) => { const at = String(text).split('\n').find((l) => l.includes(line) && /\[ref=e\d+\]/.test(l)); return at ? /\[ref=(e\d+)\]/.exec(at)[1] : ''; };
    const tabIdOf = (text) => { const m = /in a new page, (t\d+)/.exec(text); return m ? m[1] : ''; };
    const short = (r) => JSON.stringify({ error: r.error, text: String(r.text).slice(0, 220) });
    const panelNow = () => inPage(() => {
      const card = document.querySelector('#web .web-card');
      const page = document.querySelector('#web .web-page');
      const r = page.getBoundingClientRect();
      const still = document.querySelector('#web .web-still');
      return { open: document.body.classList.contains('web-open'), state: Browser.state(), rect: { x: r.left, y: r.top, width: r.width, height: r.height },
        tabs: [...document.querySelectorAll('#web .web-tab')].map((t) => ({ id: t.dataset.id, title: t.querySelector('.web-tab-title').textContent, who: t.querySelector('.web-tab-who').textContent,
          on: t.classList.contains('on'), busy: t.classList.contains('busy'), needs: t.classList.contains('needs') })),
        now: document.querySelector('#web .web-now').textContent, nowNeeds: document.querySelector('#web .web-now').classList.contains('needs'), pageNeeds: page.classList.contains('needs'),
        hold: (() => { const x = document.querySelector('#web .web-hold'); return x.hidden ? '' : x.textContent; })(), url: document.querySelector('#web .web-url').value,
        still: still.hidden ? '' : still.src.slice(0, 22), cardWidth: card.getBoundingClientRect().width,
        whose: document.querySelector('#web .web-whose-name').textContent,
        // each chat's globe on its strip, and the rows of the list that show a chat calling on one of its pages
        globes: Object.fromEntries([...document.querySelectorAll('.tile[data-id] .th-web')].map((g) => [g.closest('.tile').dataset.id,
          { on: g.classList.contains('on'), needs: g.classList.contains('needs'), n: (g.querySelector('.th-web-n') || { textContent: '' }).textContent }])),
        rowCalls: [...document.querySelectorAll('#chat-list .nav-item.chat .row-web')].map((x) => x.closest('.nav-item').dataset.id),
        browserRow: Boolean(document.getElementById('go-browser')),
        toast: (() => { const t = document.getElementById('toast'); return t.hidden ? '' : t.textContent; })() };
    });
    // the window's own picture leaves out the pages laid over it: the page in front is put in as the panel's own picture, as when it moves
    const withPage = async (id) => {
      const pic = await b.still(id);
      await inPage((src) => { const s = document.querySelector('#web .web-still'); s.src = src; s.hidden = !src; document.querySelector('#web .web-empty').hidden = true; }, pic);
      return pic.length;
    };
    const shootWithPage = async (id, name) => {
      await withPage(id);
      await shoot(name);
      await inPage(() => { const s = document.querySelector('#web .web-still'); s.hidden = true; s.removeAttribute('src'); });
    };
    const names = new Map();
    browser.who((_pid, drv) => (drv && names.has(drv.sid) ? names.get(drv.sid) : null));
    // two made-up chats of this window (no console behind them) for the browsers of one chat each, from step 10
    let tilesWas = 2;
    let madeChats = false;
    // a browser left open by a run before is closed: the panel starts closed
    await exec('Browser.toggleFor("", false)');
    try {
      // 1. the door turns away what is not Claude Code with its key
      const noKey = await post({ jsonrpc: '2.0', id: 1, method: 'ping' }, { auth: '' });
      const badKey = await post({ jsonrpc: '2.0', id: 1, method: 'ping' }, { auth: `Bearer ${'0'.repeat(48)}` });
      const fromPage = await post({ jsonrpc: '2.0', id: 1, method: 'ping' }, { headers: { Origin: 'https://made-up.example' } });
      const otherHost = await post({ jsonrpc: '2.0', id: 1, method: 'ping' }, { headers: { Host: `made-up.example:${door.port}` } });
      const asGet = await post('', { method: 'GET' });
      const asText = await post('ping', { headers: { 'Content-Type': 'text/plain' } });
      const elsewhere = await post({ jsonrpc: '2.0', id: 1, method: 'ping' }, { path: '/other' });
      check('the door turns away a call without the key or with a wrong one, one from a web page, one for another host name, a GET, a body that is not JSON and another path',
        noKey.status === 401 && badKey.status === 401 && fromPage.status === 403 && otherHost.status === 403 && asGet.status === 405 && asText.status === 415 && elsewhere.status === 404,
        JSON.stringify([noKey.status, badKey.status, fromPage.status, otherHost.status, asGet.status, asText.status, elsewhere.status]));

      // 2. Claude Code connects: a session of its own, the protocol it asked for, the 26 tools (the Viewer's three among them)
      const a = await connect();
      names.set(a.sid, { name: 'Made-up research', key: '', chat: 'made-up-a' });
      const init = a.json && a.json.result;
      const listed = await post({ jsonrpc: '2.0', id: ++rpc, method: 'tools/list' }, { sid: a.sid });
      const tools = listed.json && listed.json.result ? listed.json.result.tools.map((t) => t.name) : [];
      const want = ['navigate', 'snapshot', 'click', 'type', 'press_key', 'select_option', 'hover', 'scroll', 'screenshot', 'tabs', 'wait_for', 'evaluate', 'console', 'dialog', 'upload_file',
        'save_field', 'fill_field', 'form_preview', 'show', 'resize', 'look', 'network', 'record', 'show_media', 'media_control', 'media_look'];
      const unknown = await post({ jsonrpc: '2.0', id: ++rpc, method: 'made/up' }, { sid: a.sid });
      const noTool = await call(a.sid, 'made_up');
      check('Claude Code connects: it gets a session, the protocol version it asked for, the browser\'s name and how to use it (the clipboard left alone, the ask-first list), and the 26 tools; anything else is refused in words',
        a.status === 200 && /^[0-9a-f-]{36}$/.test(a.sid) && Boolean(init) && init.protocolVersion === '2025-06-18' && init.serverInfo.name === 'lowlit-browser' && /Prefer it to Claude in Chrome/.test(init.instructions)
        && /save_field and fill_field, never through the clipboard/.test(init.instructions) && /ask-first list/.test(init.instructions)
        && same(tools, want) && listed.json.result.tools.every((t) => t.inputSchema && t.inputSchema.type === 'object' && t.description && !/\b(he|him|his)\b/.test(t.description))
        && unknown.json && unknown.json.error && unknown.json.error.code === -32601 && noTool.error && /There is no tool made_up/.test(noTool.text),
        JSON.stringify({ status: a.status, version: init && init.protocolVersion, tools: tools.length }));

      // 3. a chat opens a page while the panel is closed and the window hidden, and reads it
      const nav = await call(a.sid, 'navigate', { url: `${base}/` });
      const shop = tabIdOf(nav.text);
      const t1 = b.tabs.get(shop);
      say(`      the outline the chat got (made-up page): ${nav.text.split('\n').slice(0, 14).join(' | ').slice(0, 900)}`);
      // laid out at a laptop's screen at least, 1280×800 (the panel's page area when that is larger), so a site shows a
      // chat its desktop layout (seen 5 Oct: WordPress hides its toolbar below 783 pixels, and the chats' pages were 722
      // to 733 wide); the window may still be settling from the phase's start, and the page follows the area
      const areaSize = () => (b.rect ? [b.rect.width, b.rect.height] : [1280, 800]);
      const chatSize = (w, h) => [Math.max(w, 1280), Math.max(h, 800)];
      await until(() => Boolean(t1) && same(t1.page.getContentSize(), chatSize(...areaSize())), 2000, 100);
      const laidOut = t1 ? t1.page.getContentSize() : [0, 0];
      const panelSize = areaSize();
      say(`      the chat's page is laid out at ${laidOut.join('×')}; the panel's page area is ${panelSize.join('×')}`);
      check('a chat opens a page with the panel closed and the window hidden: a page of its own, named after the chat, laid out at a laptop\'s size at least (1280×800, or the panel\'s page area when larger), with no empty page to go back to, and an outline with a ref on everything it can use',
        !nav.error && Boolean(t1) && t1.owner && t1.owner.name === 'Made-up research' && !win.isVisible() && !b.visible && (await panelNow()).open === false && !t1.wc.navigationHistory.canGoBack()
        && same(laidOut, chatSize(...panelSize)) && unseen()
        && nav.text.includes(`Page ${shop}: "Made-up shop"`) && nav.text.includes('- heading "Made-up linen shirt" [level=1]') && Boolean(refOf(nav.text, 'button "Add to cart"'))
        && Boolean(refOf(nav.text, 'textbox "Name on the order"')) && /combobox "Size" \[ref=e\d+\]: "Small" \(3 options: Small, Medium, Large\)/.test(nav.text) && /link "Delivery times" \[ref=e\d+\] → \/second/.test(nav.text),
        short(nav));

      // 3a. the panel's page area changes size (the window resized, a side panel opened): a page of the person's off the
      // screen follows it, so it shows as it was laid out; a chat's keeps a laptop's size at least
      const areaWas = b.rect ? { ...b.rect } : null;
      const z = win.webContents.getZoomFactor() || 1;
      const tellArea = (w, h) => b.place({ x: areaWas.x / z, y: areaWas.y / z, width: w / z, height: h / z, show: false, tab: '' });
      const own3a = b.ask('open', `${base}/second`);
      const ownTab = own3a && own3a.id ? b.tabs.get(own3a.id) : null;
      let pageFollowed = false;
      let cameBack = false;
      let chatKept = false;
      // What tells the browser where its area is meanwhile is written down. The window's page tells it again now and then
      // (seen 5 Oct: once within the 300 ms a page waits before it follows), which undoes a change only told from here:
      // the change is told once more then, up to three times in all.
      const told3a = [];
      const placeWas = b.place;
      b.place = function (p) { told3a.push(p ? [Math.round(p.width * z), Math.round(p.height * z), Boolean(p.show)] : null); return placeWas.call(this, p); };
      let tries = 0;
      try {
        if (areaWas && t1 && ownTab) {
          while (!pageFollowed && tries < 3) {
            tries++;
            tellArea(areaWas.width - 40, areaWas.height - 30);
            pageFollowed = Boolean(await until(() => same(ownTab.page.getContentSize(), [areaWas.width - 40, areaWas.height - 30]), 2000, 100));
          }
          chatKept = Boolean(await until(() => same(t1.page.getContentSize(), chatSize(areaWas.width - 40, areaWas.height - 30)), 1000, 100));
          tellArea(areaWas.width, areaWas.height);
          cameBack = Boolean(await until(() => same(ownTab.page.getContentSize(), [areaWas.width, areaWas.height]), 2000, 100));
        }
      } finally {
        b.place = placeWas;
        if (own3a && own3a.id) b.close(own3a.id);
      }
      check('3a. a page of the person\'s off the screen follows the panel\'s page area when it changes size, and back; a chat\'s page keeps a laptop\'s size at least',
        pageFollowed && cameBack && chatKept && unseen(),
        JSON.stringify({ area: areaWas && [areaWas.width, areaWas.height], followed: pageFollowed, tries, cameBack, chatKept, chat: t1 ? t1.page.getContentSize() : null, told: told3a }));

      // 4. it acts: a click, typing with Enter, a choice in a list, a key, a scroll; each step says what changed
      const add = refOf(nav.text, 'button "Add to cart"');
      const clicked = await call(a.sid, 'click', { ref: add });
      const typed = await call(a.sid, 'type', { ref: refOf(nav.text, 'textbox "Name on the order"'), text: 'Made-up Ana', submit: true });
      const pressed = await call(a.sid, 'press_key', { key: 'Backspace' });
      const picked = await call(a.sid, 'select_option', { ref: refOf(nav.text, 'combobox "Size"'), values: ['Large'] });
      const scrolled = await call(a.sid, 'scroll', { direction: 'down' });
      const facts = await call(a.sid, 'evaluate', { script: '() => ({ count: document.getElementById("count").textContent, name: document.getElementById("name").value, size: document.getElementById("size").value, y: Math.round(scrollY), seen: document.visibilityState })' });
      say(`      what the page held after the steps: ${facts.text.split('\n\n')[0].replace(/\s+/g, ' ').slice(0, 300)}`);
      check('a click lands and the step says what changed', !clicked.error && clicked.text.startsWith('Clicked button "Add to cart".') && clicked.text.includes('In your cart: 1'), short(clicked));
      check('typing replaces what the field held, says what it holds now, and Enter sends it', !typed.error && typed.text.includes('Typed 11 characters into textbox "Name on the order". It now holds "Made-up Ana". Then pressed Enter.')
        && typed.text.includes('Order sent for Made-up Ana'), short(typed));
      check('a choice is picked in a list, a key is pressed where the keyboard is, and the page scrolls', !picked.error && picked.text.startsWith('Picked "Large".') && !pressed.error && !scrolled.error
        && /Scrolled the page down by \d+ pixels/.test(scrolled.text) && /"count": "In your cart: 1"/.test(facts.text) && /"name": "Made-up An"/.test(facts.text) && /"size": "Large"/.test(facts.text) && /"y": [1-9]\d*/.test(facts.text),
        JSON.stringify({ picked: short(picked), pressed: short(pressed), scrolled: short(scrolled) }));

      // 5. the page goes on drawing, and gives a picture, while nobody can see it
      const f0 = await call(a.sid, 'evaluate', { script: 'framesSeen()' });
      await wait(700);
      const f1 = await call(a.sid, 'evaluate', { script: 'framesSeen()' });
      const frames = Number((/^It gave back:\n(\d+)/.exec(f1.text) || [])[1]) - Number((/^It gave back:\n(\d+)/.exec(f0.text) || [])[1]);
      const visibility = (/"seen": "(\w+)"/.exec(facts.text) || [])[1] || '';
      const shot = await call(a.sid, 'screenshot', {});
      const shotImg = shot.image ? nativeImage.createFromBuffer(Buffer.from(shot.image.data, 'base64')) : null;
      const shotSize = shotImg && !shotImg.isEmpty() ? shotImg.getSize() : null;
      if (shotImg && !shotImg.isEmpty()) fs.writeFileSync(path.join(dir, 'browser-0-what-the-chat-saw.jpg'), shotImg.toJPEG(80));
      say(`      a hidden page: visibility "${visibility}", ${frames} frames drawn in 0.7 s, a picture of ${shotSize ? `${shotSize.width}x${shotSize.height}` : 'nothing'} (${shot.error ? shot.text.slice(0, 120) : 'ok'})`);
      check('with the panel closed and the window hidden, the page goes on drawing (its animations run) and screenshot hands back a picture of it', frames >= 10 && !shot.error && Boolean(shot.image)
        && shot.image.mimeType === 'image/jpeg' && Boolean(shotSize) && shotSize.width >= laidOut[0] * 0.9 && shotSize.width <= 1280 && shotSize.height >= 100,
        JSON.stringify({ frames, visibility, size: shotSize, laidOut, shot: short(shot) }));

      // 6. boxes: one that only says something is closed and reported; a question is answered no, then yes when told
      const save = await call(a.sid, 'click', { ref: refOf(nav.text, 'button "Save for later"') });
      const del = refOf(nav.text, 'button "Empty the cart"');
      const no = await call(a.sid, 'click', { ref: del });
      const told = await call(a.sid, 'dialog', { accept: true });
      const yes = await call(a.sid, 'click', { ref: del });
      check('a page\'s boxes never reach the screen: a message is closed and reported, a question is answered no and says how to answer yes, and yes once told',
        !save.error && save.text.includes('The page said, in a box: "Saved for later" (closed).') && !no.error && no.text.includes('The page asked "Empty the cart?" (confirm) and was answered no')
        && no.text.includes('The cart was kept') && !told.error && told.text.startsWith(`The questions ${shop} asks from now on are answered yes.`) && !yes.error && yes.text.includes('The cart is empty'),
        JSON.stringify({ save: short(save), no: short(no), yes: short(yes) }));

      // 7. a link to a new page: the new page is the same chat's, said in the step, and readable; the chat goes on
      // working in the page it was in until it turns to the new one (seen 5 Oct: a chat found its steps going to a page
      // a link had opened)
      const popped = await call(a.sid, 'click', { ref: refOf(nav.text, 'link "Delivery times"') });
      const popId = (/It opened a new page, (t\d+)/.exec(popped.text) || [])[1] || '';
      const stillIn = t1 && t1.owner ? t1.owner.current : '';
      const waited = popId ? await call(a.sid, 'wait_for', { text: 'Two to four made-up days', tab: popId }) : { error: true, text: 'no new page' };
      const logs = await call(a.sid, 'console', { tab: shop });
      const photo = path.join(dir, 'made-up-photo.txt');
      fs.writeFileSync(photo, 'a made-up photo');
      const handed = await call(a.sid, 'upload_file', { ref: refOf(nav.text, 'button "A photo of you wearing it"'), paths: [photo], tab: shop });
      check('a link that opens a new page gives the chat that page, said in the step, and the chat goes on working in its own page until it turns to the new one; it waits for words there, reads the console and hands a file to a picker',
        !popped.error && Boolean(popId) && Boolean(b.tabs.get(popId)) && b.tabs.get(popId).owner === t1.owner && stillIn === shop
        && popped.text.includes(`This chat still works in ${shop}: tabs with action "select" and tab "${popId}" turns to the new one.`)
        && !waited.error && waited.text.startsWith('"Two to four made-up days" is on the page.')
        && !logs.error && logs.text.includes('made-up shop loaded') && !handed.error && handed.text.includes('Handed made-up-photo.txt to button "A photo of you wearing it"') && handed.text.includes('Picked made-up-photo.txt'),
        JSON.stringify({ popped: short(popped), waited: short(waited), handed: short(handed) }));

      // 7b. a page left alone rests (frozen: no scripts, no drawing), and wakes when a chat uses it again
      const resting = b.tabs.get(popId);
      if (resting) resting.used = Date.now() - 3 * 60e3;
      b.sweep(() => false);
      const frozeOk = Boolean(resting && resting.frozen);
      const woke = popId ? await call(a.sid, 'click', { ref: refOf(waited.text, 'button "Pick Thursday"'), tab: popId }) : { error: true, text: 'no page' };
      check('a page nobody used for two minutes rests, and wakes when a chat acts on it again', frozeOk && !resting.frozen && !woke.error && woke.text.includes('Thursday picked'),
        JSON.stringify({ froze: frozeOk, woke: short(woke) }));

      // 7c. the browser never opens what holds keys: a file in a folder whose name starts with a dot, sent as an address or linked to
      const { pathToFileURL } = require('node:url');
      const vault = path.join(dir, '.made-up-vault');
      fs.mkdirSync(vault, { recursive: true });
      const keyFile = path.join(vault, 'made-up-key.html');
      fs.writeFileSync(keyFile, '<!doctype html><title>made-up key</title><p>made-up secret words</p>');
      const local = path.join(dir, 'made-up-local.html');
      const shotFile = path.join(vault, 'made-up-shot.png');
      fs.writeFileSync(shotFile, 'made-up picture bytes');
      fs.writeFileSync(local, `<!doctype html><title>Made-up local page</title><h1>A local page</h1><a href="${pathToFileURL(keyFile).href}">The key</a><img alt="shot" src="${pathToFileURL(shotFile).href}">`);
      const refused = await call(a.sid, 'navigate', { url: keyFile, new_tab: true });
      const opened = await call(a.sid, 'navigate', { url: local, new_tab: true });
      const localId = tabIdOf(opened.text);
      const linked = localId ? await call(a.sid, 'click', { ref: refOf(opened.text, 'link "The key"'), tab: localId }) : { error: true, text: 'no local page' };
      const stayed = localId && b.tabs.get(localId) ? b.tabs.get(localId).wc.getURL() : '';
      check('a file in a folder whose name starts with a dot is never opened, whether a chat sends its address or clicks a link to it (the page stays, and the chat is told why); a plain local page opens in a new page, and the chat is told it works there now',
        refused.error && refused.text.startsWith('That file is not opened here') && !opened.error && opened.text.includes('"Made-up local page"')
        && opened.text.includes(`This chat now works in ${localId}: steps without a tab go there (${popId} stays open).`)
        && !linked.error && linked.text.includes('a file the browser never opens') && !linked.text.includes('made-up secret words') && stayed === pathToFileURL(local).href,
        JSON.stringify({ refused: short(refused), linked: short(linked), stayed }));
      // what a page shows from such a file stays empty, and the chat is told which file and why (seen 4 Oct: a page of
      // videos kept in a ".render-samples" folder came up with empty players, and the chat was told nothing)
      check('a file a page asks for from a folder whose name starts with a dot is not given, and the chat is told which file and why, once',
        opened.text.includes('The page asked for 1 file on this computer that it was not given') && opened.text.includes('made-up-shot.png')
        && !linked.text.includes('it was not given'), short(opened));
      if (localId) await call(a.sid, 'tabs', { action: 'close', tab: localId });

      // 7d. nor is such a file handed to a page, nor one from the person's record (a made-up record folder here)
      const vaultFile = path.join(vault, 'made-up-key.txt');
      fs.writeFileSync(vaultFile, 'made-up secret words');
      const recordDir = path.join(dir, 'made-up-record');
      fs.mkdirSync(recordDir, { recursive: true });
      const recordFile = path.join(recordDir, 'made-up-note.txt');
      fs.writeFileSync(recordFile, 'a made-up note');
      const keptRecord = b.record;
      b.record = () => [recordDir];
      const picker = refOf(nav.text, 'button "A photo of you wearing it"');
      const upVault = await call(a.sid, 'upload_file', { ref: picker, paths: [vaultFile], tab: shop });
      const upRecord = await call(a.sid, 'upload_file', { ref: picker, paths: [recordFile], tab: shop });
      b.record = keptRecord;
      check('a file from a folder whose name starts with a dot, or from the person\'s record, is never handed to a page',
        upVault.error && upVault.text.includes('is not handed to a page') && upRecord.error && upRecord.text.includes('is in the user\'s record'),
        JSON.stringify({ vault: short(upVault), record: short(upRecord) }));

      // 7e. what a page sent and got: every request with its outcome, the failures alone, one in full with its login headers hidden
      const stockNav = await call(a.sid, 'navigate', { url: `${base}/stock`, new_tab: true });
      const stockId = tabIdOf(stockNav.text);
      const stockTab = stockId ? b.tabs.get(stockId) : null;
      const checked = stockId ? await call(a.sid, 'click', { ref: refOf(stockNav.text, 'button "Check stock"'), tab: stockId }) : { error: true, text: 'no stock page' };
      const stocked = stockId ? await call(a.sid, 'wait_for', { text: 'Stock: 3', tab: stockId }) : { error: true, text: 'no stock page' };
      await until(() => Boolean(stockTab) && stockTab.net.some((r) => r.url.endsWith('/api/broken') && r.done), 4000, 50);
      const traffic = await call(a.sid, 'network', { tab: stockId });
      const failures = await call(a.sid, 'network', { tab: stockId, only_failures: true });
      const apis = await call(a.sid, 'network', { tab: stockId, find: '/api/' });
      const numberOf = (text, bit) => { const l = String(text).split('\n').find((x) => x.endsWith(bit)); return l ? (/^(n\d+) /.exec(l) || [])[1] || '' : ''; };
      const okOne = await call(a.sid, 'network', { tab: stockId, request: numberOf(traffic.text, '/api/stock') });
      const badOne = await call(a.sid, 'network', { tab: stockId, request: numberOf(traffic.text, '/api/broken') });
      const emptied = await call(a.sid, 'network', { tab: stockId, clear: true });
      const afterClear = await call(a.sid, 'network', { tab: stockId });
      say(`      the made-up page's traffic as the chat got it: ${traffic.text.split('\n').slice(0, 7).join(' | ').slice(0, 800)}`);
      const hasLine = (text, re) => String(text).split('\n').some((l) => re.test(l));
      check('network lists what the page sent and got: the page itself, a picture that is not there (404) and the two calls a click made (200 and 500), each with its kind, size and time',
        !checked.error && !stocked.error && !traffic.error && hasLine(traffic.text, /^n\d+ GET 200 document [\d.]+ (B|KB) \d+ ms http:\/\/127\.0\.0\.1:\d+\/stock$/)
        && hasLine(traffic.text, /^n\d+ GET 404 image .*\/missing\.png$/) && hasLine(traffic.text, /^n\d+ GET 200 fetch [\d.]+ (B|KB) \d+ ms .*\/api\/stock$/)
        && hasLine(traffic.text, /^n\d+ GET 500 fetch .*\/api\/broken$/), short(traffic));
      check('only_failures keeps the missing picture and the 500; find keeps the addresses that hold its words',
        !failures.error && hasLine(failures.text, /\/missing\.png$/) && hasLine(failures.text, /\/api\/broken$/) && !hasLine(failures.text, /\/api\/stock$/) && !hasLine(failures.text, / document /)
        && !apis.error && hasLine(apis.text, /\/api\/stock$/) && hasLine(apis.text, /\/api\/broken$/) && !hasLine(apis.text, /\/missing\.png$/), JSON.stringify({ failures: short(failures), apis: short(apis) }));
      check('one request in full: its headers both ways and what came back, a header that can carry a login hidden and the cookie never shown; emptied, the list is empty',
        !okOne.error && /x-made-up: visible-header/i.test(okOne.text) && /x-auth-token: \(hidden\)/i.test(okOne.text) && !okOne.text.includes('made-up-token-value') && !okOne.text.includes('made-up-secret-cookie')
        && okOne.text.includes('{"stock":3,"made_up":true}') && !badOne.error && badOne.text.includes('Answered 500') && badOne.text.includes('{"error":"made-up failure"}')
        && !emptied.error && emptied.text.includes('The list is empty now.') && !afterClear.error && afterClear.text.startsWith(`No request on ${stockId}`),
        JSON.stringify({ ok: short(okOne), bad: short(badOne), after: short(afterClear) }));

      // 7f. a GIF of what the chat does on its page: frames after its steps, made in a thread of its own; Chromium's own decoder reads it back
      const { monitorEventLoopDelay } = require('node:perf_hooks');
      const lag = monitorEventLoopDelay({ resolution: 10 });
      const gifFile = path.join(dir, 'made-up-recording.gif');
      const recStart = await call(a.sid, 'record', { action: 'start', tab: stockId });
      const recTwice = await call(a.sid, 'record', { action: 'start', tab: stockId });
      const recShown = b.view().tabs.find((t) => t.id === stockId);
      lag.enable();
      const addOne = refOf(stockNav.text, 'button "Add one"');
      const adds = [];
      for (let i = 0; i < 3; i++) adds.push(await call(a.sid, 'click', { ref: addOne, tab: stockId }));
      await wait(1300);
      lag.disable();
      const badPath = await call(a.sid, 'record', { action: 'stop', path: 'made-up.gif', tab: stockId });
      const recStop = await call(a.sid, 'record', { action: 'stop', path: gifFile, tab: stockId });
      const recNone = await call(a.sid, 'record', { action: 'stop', tab: stockId });
      const recAfter = b.view().tabs.find((t) => t.id === stockId);
      const gifBytes = fs.existsSync(gifFile) ? fs.readFileSync(gifFile) : null;
      // the orange bar is the top 120 pixels of the page: its middle row, at the GIF's scale
      const pageWidth = stockId ? Number((/^It gave back:\n(\d+)/.exec((await call(a.sid, 'evaluate', { script: 'innerWidth', tab: stockId })).text) || [])[1]) : 0;
      const decoded = gifBytes ? await inPage(async (b64, pageW) => {
        if (typeof ImageDecoder !== 'function') return { none: 'no ImageDecoder in this window' };
        const data = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
        const dec = new ImageDecoder({ data, type: 'image/gif' });
        await dec.tracks.ready;
        const count = dec.tracks.selectedTrack.frameCount;
        const pick = async (i) => {
          const { image } = await dec.decode({ frameIndex: i });
          const c = new OffscreenCanvas(image.displayWidth, image.displayHeight);
          const g = c.getContext('2d');
          g.drawImage(image, 0, 0);
          image.close();
          return { w: c.width, h: c.height, all: g.getImageData(0, 0, c.width, c.height).data };
        };
        const first = await pick(0);
        const last = await pick(count - 1);
        const y = Math.max(0, Math.min(first.h - 1, Math.round(60 * (first.w / (pageW || first.w)))));
        const at = (y * first.w + Math.floor(first.w / 2)) * 4;
        let differ = 0;
        for (let i = 0; i < first.all.length; i += 4) if (first.all[i] !== last.all[i] || first.all[i + 1] !== last.all[i + 1] || first.all[i + 2] !== last.all[i + 2]) differ++;
        return { count, w: first.w, h: first.h, bar: [first.all[at], first.all[at + 1], first.all[at + 2]], differ };
      }, gifBytes.toString('base64'), pageWidth) : null;
      say(`      the recording: ${recStop.text.slice(0, 220)}; decoded: ${JSON.stringify(decoded)}; the window's own thread was held up at most ${Math.round(lag.max / 1e6)} ms while it recorded (mean ${Math.round(lag.mean / 1e6)} ms)`);
      check('record starts on a page and says so, the page\'s tab shows it is being recorded, and a second start is refused',
        !recStart.error && recStart.text.startsWith(`Recording ${stockId} as a GIF`) && recTwice.error && recTwice.text.includes('is being recorded already') && Boolean(recShown && recShown.rec)
        && adds.every((x) => !x.error), JSON.stringify({ start: short(recStart), twice: short(recTwice), shown: Boolean(recShown && recShown.rec) }));
      check('stop saves the GIF where asked and says where and how many frames (a path that is not a whole .gif path is refused and the recording goes on); a second stop is told nothing is being recorded',
        badPath.error && badPath.text.startsWith('path is a whole path ending in .gif') && !recStop.error && recStop.text.startsWith(`Saved the GIF of ${stockId}: ${gifFile} (`)
        && recNone.error && recNone.text.startsWith(`Nothing is being recorded on ${stockId}`) && Boolean(recAfter) && !recAfter.rec && Boolean(gifBytes) && gifBytes.toString('ascii', 0, 6) === 'GIF89a',
        JSON.stringify({ bad: short(badPath), stop: short(recStop), none: short(recNone) }));
      check('Chromium\'s own decoder reads the GIF: several frames at the page\'s shape, the orange bar orange (its colours in the right order), and the clicks changed the last frame',
        Boolean(decoded) && !decoded.none && decoded.count >= 3 && decoded.w > 100 && decoded.h > 60 && decoded.bar[0] > 190 && decoded.bar[2] < 150 && decoded.bar[0] - decoded.bar[2] > 60 && decoded.differ > 0,
        JSON.stringify(decoded));
      const recStart2 = await call(a.sid, 'record', { action: 'start', tab: stockId });
      const recStop2 = await call(a.sid, 'record', { action: 'stop', tab: stockId });
      const savedTo = (/^Saved the GIF of t\d+: (.+\.gif) \(/.exec(recStop2.text) || [])[1] || '';
      check('with no path it goes to the downloads folder (this run\'s own here), under a name of its own',
        !recStart2.error && !recStop2.error && path.dirname(savedTo) === path.join(dir, 'downloads') && /^Lowlit recording \d{4}-\d\d-\d\d \d\d\.\d\d\.\d\d\.gif$/.test(path.basename(savedTo)) && fs.existsSync(savedTo),
        short(recStop2));
      if (stockId) await call(a.sid, 'tabs', { action: 'close', tab: stockId });

      // 7g. a long new page comes back from navigate as a summary (how long it is, its headings, what is on it); asked,
      // the whole outline or none of it; snapshot reads it whole (asked for 5 Oct by a chat that drove a site's admin)
      const longNav = await call(a.sid, 'navigate', { url: `${base}/long`, new_tab: true });
      const longId = tabIdOf(longNav.text);
      const noLong = { error: true, text: 'no long page' };
      const longWhole = longId ? await call(a.sid, 'navigate', { url: `${base}/long`, outline: 'full' }) : noLong;
      const longNone = longId ? await call(a.sid, 'navigate', { url: `${base}/long`, outline: 'none' }) : noLong;
      const longSnap = longId ? await call(a.sid, 'snapshot', { tab: longId }) : noLong;
      say(`      a long page as navigate hands it back (${longNav.text.length} characters; whole, ${longWhole.text.length}): ${longNav.text.split('\n').slice(0, 4).join(' | ').slice(0, 420)}`);
      check('7g. a long new page comes back as a summary (its length, its first 25 headings, how many links) and not its whole outline; outline "full" hands it all back, "none" nothing of it, and snapshot reads it whole',
        !longNav.error && longNav.text.includes('only its summary is here') && longNav.text.includes('Its headings, the first 25:') && longNav.text.includes('- heading "Chapter 24" [level=2]')
        && !longNav.text.includes('"Chapter 25"') && longNav.text.includes('On it: 40 links.') && !longNav.text.includes('Made-up words about nothing') && longNav.text.length < 3000
        && !longWhole.error && longWhole.text.includes('The last made-up line.') && longWhole.text.includes('- heading "Chapter 40" [level=2]') && !longWhole.text.includes('only its summary is here')
        && !longNone.error && /\(Its outline is not handed back: \d+ lines\. snapshot reads it\.\)/.test(longNone.text) && !longNone.text.includes('Chapter')
        && !longSnap.error && longSnap.text.includes('The last made-up line.') && longSnap.text.includes('Made-up words about nothing'),
        JSON.stringify({ nav: short(longNav), whole: longWhole.text.length, none: short(longNone), snap: longSnap.text.length }));
      if (longId) await call(a.sid, 'tabs', { action: 'close', tab: longId });

      // 7h. a field taller than the window (a long post's text area, 683×6000 here) is clicked in the part that shows,
      // and the keyboard goes there; one with no size on screen is clicked from inside the page, and the keyboard goes
      // there too (seen 5 Oct: a 683×8581 text area was said to have no size, and the keyboard stayed where it was)
      const edNav = await call(a.sid, 'navigate', { url: `${base}/editor`, new_tab: true });
      const edId = tabIdOf(edNav.text);
      const noEditor = { error: true, text: 'no editor page' };
      const contentRef = refOf(edNav.text, 'textbox "Content"');
      const titleRef = refOf(edNav.text, 'textbox "Title"');
      const pwRef = refOf(edNav.text, 'textbox "Made-up password"');
      const tallClick = edId ? await call(a.sid, 'click', { ref: contentRef, tab: edId }) : noEditor;
      const zeroClick = edId ? await call(a.sid, 'click', { ref: refOf(edNav.text, 'textbox "Hidden notes"'), tab: edId }) : noEditor;
      check('7h. a click on a field taller than the window lands in the part that shows and moves the keyboard there; a click on a field with no size on screen is done from inside the page and moves the keyboard too',
        !edNav.error && Boolean(contentRef) && !tallClick.error && tallClick.text.startsWith('Clicked textbox "Content".') && !tallClick.text.includes('from inside the page')
        && tallClick.text.includes('The keyboard is in: textbox "Content".') && !zeroClick.error && zeroClick.text.includes('(it has no size on screen, so it was clicked from inside the page)')
        && zeroClick.text.includes('The keyboard is in: textbox "Hidden notes".'), JSON.stringify({ tall: short(tallClick), zero: short(zeroClick) }));

      // 7i. long texts between a field and a file, past the chat and the clipboard (save_field, fill_field); what the
      // form would send against what it held when the page was first read (form_preview); what the page sent its own
      // site, its keys hidden (network with body)
      const shaOf = (s) => require('node:crypto').createHash('sha256').update(s, 'utf8').digest('hex');
      const stamp = Date.now().toString(36);
      const postFile = path.join(dir, `made-up-post-${stamp}.txt`);
      const pwFile = path.join(dir, `made-up-pw-${stamp}.txt`);
      const saved = edId ? await call(a.sid, 'save_field', { ref: contentRef, path: postFile, tab: edId }) : noEditor;
      const savedTwice = edId ? await call(a.sid, 'save_field', { ref: contentRef, path: postFile, tab: edId }) : noEditor;
      const savedOver = edId ? await call(a.sid, 'save_field', { ref: contentRef, path: postFile, overwrite: true, tab: edId }) : noEditor;
      const savedVault = edId ? await call(a.sid, 'save_field', { ref: contentRef, path: path.join(vault, `made-up-post-${stamp}.txt`), tab: edId }) : noEditor;
      const savedPw = edId ? await call(a.sid, 'save_field', { ref: pwRef, path: pwFile, tab: edId }) : noEditor;
      const onDisk = fs.existsSync(postFile) ? fs.readFileSync(postFile, 'utf8') : '';
      check('7i. save_field writes a field\'s whole text to a file, byte for byte, and says its length and SHA-256; a file already there is kept unless overwrite says so; nothing goes into a folder whose name starts with a dot, and a password field is never saved',
        !saved.error && saved.text === `Saved what textbox "Content" holds to ${postFile}: ${POST_TEXT.length} characters (${Buffer.byteLength(POST_TEXT)} bytes), SHA-256 ${shaOf(POST_TEXT)}.`
        && onDisk === POST_TEXT && savedTwice.error && savedTwice.text.includes('is there already: overwrite true replaces it') && !savedOver.error && savedOver.text.startsWith('Saved what textbox "Content" holds')
        && savedVault.error && savedVault.text.includes('The browser never writes') && savedPw.error && savedPw.text.includes('is a password field') && !fs.existsSync(pwFile),
        JSON.stringify({ saved: short(saved), twice: short(savedTwice), vault: short(savedVault), pw: short(savedPw), onDisk: onDisk.length }));

      const newCrlf = `${Array.from({ length: 120 }, (_, i) => `New line ${i + 1}: made-up words put in from a file, with "quotes" and accents: éèà.`).join('\r\n')}\r\n`;
      const newLf = newCrlf.replace(/\r\n/g, '\n');
      const newFile = path.join(dir, `made-up-new-post-${stamp}.txt`);
      fs.writeFileSync(newFile, newCrlf);
      const TITLE = 'A made-up title from a file';
      const titleFile = path.join(dir, `made-up-title-${stamp}.txt`);
      fs.writeFileSync(titleFile, `${TITLE}\r\n`);
      const twoFile = path.join(dir, `made-up-two-lines-${stamp}.txt`);
      fs.writeFileSync(twoFile, 'One made-up line\nand another\n');
      const filled = edId ? await call(a.sid, 'fill_field', { ref: contentRef, path: newFile, tab: edId }) : noEditor;
      const pageHolds = edId ? await call(a.sid, 'evaluate', { tab: edId, script: 'async () => { const v = document.getElementById("content").value; const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(v));'
        + ' return { sha: Array.from(new Uint8Array(d), (x) => x.toString(16).padStart(2, "0")).join(""), cr: v.indexOf(String.fromCharCode(13)) >= 0, inputs: document.getElementById("inputs").textContent }; }' }) : noEditor;
      const titled = edId ? await call(a.sid, 'fill_field', { ref: titleRef, path: titleFile, tab: edId }) : noEditor;
      const twoRefused = edId ? await call(a.sid, 'fill_field', { ref: titleRef, path: twoFile, tab: edId }) : noEditor;
      const pwFill = edId ? await call(a.sid, 'fill_field', { ref: pwRef, path: titleFile, tab: edId }) : noEditor;
      check('fill_field puts a file\'s text in a field as typing would (the page hears it), and says its length and SHA-256 against the file\'s (line ends kept as LF, as fields keep them); a one-line box takes a one-line file (its last line break left out) and refuses one of several lines; a password field is never filled',
        !filled.error && filled.text.includes(`Filled textbox "Content" from ${newFile}: it now holds ${newLf.length} characters, SHA-256 ${shaOf(newLf)}, the same as the file (its line ends kept as LF, as fields keep them).`)
        && (/"sha": "([0-9a-f]{64})"/.exec(pageHolds.text) || [])[1] === shaOf(newLf) && /"cr": false/.test(pageHolds.text) && /"inputs": "[1-9]\d* inputs"/.test(pageHolds.text)
        && !titled.error && titled.text.includes(`Filled textbox "Title" from ${titleFile}: it now holds ${TITLE.length} characters, SHA-256 ${shaOf(TITLE)}, the same as the file.`)
        && twoRefused.error && twoRefused.text.includes('textbox "Title" holds one line, and the file has several') && pwFill.error && pwFill.text.includes('is a password field'),
        JSON.stringify({ filled: short(filled), page: pageHolds.text.slice(0, 220), titled: short(titled), two: short(twoRefused), pw: short(pwFill) }));

      // a form sends a text area's lines as they are or with CRLF line ends, as the browser keeps it: either reads right
      const formsAs = (v) => [v, v.replace(/\n/g, '\r\n')].map((x) => `${x.length} characters, SHA-256 ${shaOf(x)}`);
      const typedPw = edId ? await call(a.sid, 'type', { ref: pwRef, text: PW, tab: edId }) : noEditor;
      const preview = edId ? await call(a.sid, 'form_preview', { tab: edId }) : noEditor;
      if (edId) await call(a.sid, 'evaluate', { tab: edId, script: 'document.querySelector("[name=_wpnonce]").value = "made-up-nonce-5678"' });
      const nonceSeen = edId ? await call(a.sid, 'form_preview', { ref: titleRef, tab: edId }) : noEditor;
      const marked = edId ? await call(a.sid, 'form_preview', { mark: true, tab: edId }) : noEditor;
      const afterMark = edId ? await call(a.sid, 'form_preview', { tab: edId }) : noEditor;
      say(`      what the made-up form would send, as the chat got it: ${preview.text.split('\n').map((l) => l.slice(0, 160)).join(' | ').slice(0, 700)}`);
      check('form_preview says what the form would send that differs from when the page was first read: a short value as it is, a long one by its length and SHA-256, a password or a nonce only by its length; marked, nothing differs',
        !typedPw.error && typedPw.text.includes(`It now holds "(${PW.length} characters, hidden)"`) && !typedPw.text.includes(PW)
        && !preview.error && preview.text.includes('(POST /made-up-save) would send 5 fields; 3 differ from what it held when the page was first read, at ')
        && preview.text.includes(`- post_title: "A made-up post" → "${TITLE}"`) && formsAs(POST_TEXT).some((x) => preview.text.includes(`- content: ${x}`)) && formsAs(newLf).some((x) => preview.text.includes(`→ ${x}`))
        && preview.text.includes(`- made_up_password: changed (hidden: it can open an account; 0 → ${PW.length} characters)`) && !preview.text.includes(PW) && !preview.text.includes('_wpnonce')
        && !nonceSeen.error && nonceSeen.text.includes('- _wpnonce: changed (hidden: it can open an account; 18 → 18 characters)') && !nonceSeen.text.includes('made-up-nonce')
        && !marked.error && marked.text.startsWith(`Marked 1 form of ${edId}`) && !afterMark.error && afterMark.text.includes('none differs from what it held when it was marked, at '),
        JSON.stringify({ typed: short(typedPw), preview: short(preview), nonce: short(nonceSeen), marked: short(marked), after: short(afterMark) }));

      const edTab = edId ? b.tabs.get(edId) : null;
      const clickedSave = edId ? await call(a.sid, 'click', { ref: refOf(edNav.text, 'button "Save"'), tab: edId }) : noEditor;
      await until(() => Boolean(edTab) && edTab.net.some((r) => r.url.endsWith('/api/save') && r.done) && edTab.net.some((r) => r.url.endsWith('/api/beacon') && (r.done || r.failed)), 5000, 50);
      const edTraffic = edId ? await call(a.sid, 'network', { tab: edId, find: '/api/' }) : noEditor;
      const saveN = numberOf(edTraffic.text, '/api/save');
      const beaconN = numberOf(edTraffic.text, '/api/beacon');
      const bodyKept = saveN ? await call(a.sid, 'network', { tab: edId, request: saveN }) : { error: true, text: 'no save request' };
      const bodyShown = saveN ? await call(a.sid, 'network', { tab: edId, request: saveN, body: true }) : { error: true, text: 'no save request' };
      const beaconBody = beaconN ? await call(a.sid, 'network', { tab: edId, request: beaconN, body: true }) : { error: true, text: 'no beacon' };
      say(`      the made-up save as the chat got it with body true: ${bodyShown.text.split('\n').slice(0, 12).join(' | ').slice(0, 600)}`);
      check('network shows what a page sent its own site when asked (body true): the JSON with its token and password hidden and the rest as sent; without body, only that a body went; what went to another site is never shown',
        !clickedSave.error && hasLine(edTraffic.text, /^n\d+ POST 200 fetch .*\/api\/save$/) && !bodyKept.error && bodyKept.text.includes('(not shown: it can hold what was typed into the page; body true shows it')
        && !bodyShown.error && bodyShown.text.includes('and a body (JSON, ') && bodyShown.text.includes('"api_token": "(hidden)"') && bodyShown.text.includes('"password": "(hidden)"')
        && bodyShown.text.includes('"views": 3') && bodyShown.text.includes(`"title": "${TITLE}"`) && bodyShown.text.includes('New line 1: made-up words')
        && !bodyShown.text.includes('made-up-api-token-') && !bodyShown.text.includes('made-up-nested-password')
        && !beaconBody.error && beaconBody.text.includes('not shown: only what a page sends to its own site is shown, and this went to localhost.'),
        JSON.stringify({ traffic: short(edTraffic), kept: short(bodyKept), shown: short(bodyShown), beacon: short(beaconBody) }));
      if (edId) await call(a.sid, 'tabs', { action: 'close', tab: edId });

      // 7j. the ask-first list (the person's mail, files, accounts, payments and private messages; a made-up account page
      // of the made-up site here): a chat is stopped before it, the Browser panel asks the person with a button that lets
      // that chat in, and it goes once let in; a link, or a page of the person's, hands nothing of it to a chat not let in
      const ACCOUNT = '127.0.0.1/made-up-account';
      const askWas = b.askFirst;
      const ownerA = t1.owner;
      const extra = [];
      let d = null;
      b.askFirst = () => [ACCOUNT];
      try {
        const stopped = await call(a.sid, 'navigate', { url: `${base}/made-up-account`, new_tab: true });
        const onIt = [...b.tabs.values()].filter((t) => t.wc.getURL().endsWith('/made-up-account')).length;
        const asking = await until(async () => { const p = await panelNow(); return p.open && p.now.includes('wants to open') ? p : null; }, 4000, 100);
        if (asking && asking.state.front) await shootWithPage(asking.state.front, 'browser-3-ask-first');
        const allowed = await inPage(() => { const x = document.querySelector('#web .web-allow'); if (x) x.click(); return Boolean(x); });
        const letIn = await until(() => b.lets(ownerA, ACCOUNT), 3000, 50);
        const toldIn = await until(async () => { const p = await panelNow(); return p.toast.includes('may open') ? p.toast : null; }, 3000, 100) || '';
        const went = await call(a.sid, 'navigate', { url: `${base}/made-up-account`, new_tab: true });
        const wentId = tabIdOf(went.text);
        if (wentId) extra.push(wentId);
        check('7j. a chat is stopped before a site of the ask-first list, opens no page there, and is told to ask the user; the Browser panel asks the user with "Allow for this chat", and once it is clicked that chat goes there',
          stopped.error && stopped.text.startsWith(`${ACCOUNT} is on the user's ask-first list`) && !stopped.text.includes('Made-up inbox') && onIt === 0
          && Boolean(asking) && asking.now.includes('Made-up research') && asking.now.includes(`wants to open ${ACCOUNT}, on your ask-first list`) && asking.nowNeeds && allowed && Boolean(letIn)
          && toldIn.startsWith(`Made-up research may open ${ACCOUNT} now`) && !went.error && went.text.includes('"Made-up account"') && went.text.includes('Made-up inbox'),
          JSON.stringify({ stopped: short(stopped), onIt, now: asking && asking.now, allowed, letIn: Boolean(letIn), toast: toldIn, went: short(went) }));

        d = await connect();
        names.set(d.sid, { name: 'Made-up mail check', key: '', chat: 'made-up-d' });
        const dNav = await call(d.sid, 'navigate', { url: `${base}/links` });
        const dLinks = tabIdOf(dNav.text);
        const dClick = dLinks ? await call(d.sid, 'click', { ref: refOf(dNav.text, 'link "My made-up account"'), tab: dLinks }) : { error: true, text: 'no links page' };
        const dStayed = dLinks && b.tabs.get(dLinks) ? b.tabs.get(dLinks).wc.getURL() : '';
        const pagesBefore = b.tabs.size;
        const dPop = dLinks ? await call(d.sid, 'click', { ref: refOf(dNav.text, 'link "My made-up account in a new page"'), tab: dLinks }) : { error: true, text: 'no links page' };
        const dPopNone = b.tabs.size === pagesBefore;
        const pAcc = b.ask('open', `${base}/made-up-account`);
        const pLinks = b.ask('open', `${base}/links`);
        for (const p of [pAcc, pLinks]) if (p && p.id) extra.push(p.id);
        const loadedAt = (p, end) => until(() => { const t = p && p.id ? b.tabs.get(p.id) : null; return Boolean(t) && !t.wc.isLoading() && t.wc.getURL().endsWith(end); }, 5000, 100);
        await loadedAt(pAcc, '/made-up-account');
        await loadedAt(pLinks, '/links');
        const dList = await call(d.sid, 'tabs', { action: 'list' });
        const dSnapAcc = await call(d.sid, 'snapshot', { tab: pAcc.id });
        const aSnapAcc = await call(a.sid, 'snapshot', { tab: pAcc.id });
        const dSnapLinks = await call(d.sid, 'snapshot', { tab: pLinks.id });
        const dPopP = await call(d.sid, 'click', { ref: refOf(dSnapLinks.text, 'link "My made-up account in a new page"'), tab: pLinks.id });
        const popP = (/It opened a new page, (t\d+)/.exec(dPopP.text) || [])[1] || '';
        if (popP) extra.push(popP);
        const dRec = await call(d.sid, 'record', { action: 'start', tab: pLinks.id });
        const dOnto = await call(d.sid, 'click', { ref: refOf(dSnapLinks.text, 'link "My made-up account"'), tab: pLinks.id });
        const recTab = b.tabs.get(pLinks.id);
        const framesThere = recTab && recTab.rec ? recTab.rec.frames : -1;
        await wait(1600);
        const framesLater = recTab && recTab.rec ? recTab.rec.frames : -1;
        check('a chat not let in that clicks a link there, or one that opens a new page there, stays where it was and is told; the user\'s own page there is listed to it without its title and refused to it, while the chat let in reads it',
          !dNav.error && !dClick.error && dClick.text.includes(`It tried to go to ${ACCOUNT}, which is on the user's ask-first list`) && dStayed.endsWith('/links') && !dClick.text.includes('Made-up inbox')
          && !dPop.error && dPop.text.includes(`It tried to go to ${ACCOUNT}`) && dPopNone
          && !dList.error && dList.text.includes(`${pAcc.id} (the user's own): a page on ${ACCOUNT}, on the user's ask-first list (not shown)`) && !dList.text.includes('Made-up account')
          && dSnapAcc.error && dSnapAcc.text.startsWith(`${ACCOUNT} is on the user's ask-first list`) && !dSnapAcc.text.includes('Made-up inbox') && !aSnapAcc.error && aSnapAcc.text.includes('Made-up inbox'),
          JSON.stringify({ click: short(dClick), stayed: dStayed, pop: short(dPop), popNone: dPopNone, list: dList.text, snap: short(dSnapAcc), a: short(aSnapAcc) }));
        check('a page of the user\'s that a chat not let in leads there hands nothing of it back: a new page it opens is named by its site only, a step that lands there says only where it is, and a GIF the chat records takes no picture while it is there',
          !dPopP.error && Boolean(popP) && dPopP.text.includes(`It opened a new page, ${popP}: a page on ${ACCOUNT}, on the user's ask-first list.`) && !dPopP.text.includes(`${base}/made-up-account`)
          && !dRec.error && !dOnto.error && dOnto.text.startsWith(`Done; page ${pLinks.id} is now on ${ACCOUNT}`) && !dOnto.text.includes('Made-up inbox')
          && framesThere >= 1 && framesLater === framesThere,
          JSON.stringify({ pop: short(dPopP), rec: short(dRec), onto: short(dOnto), framesThere, framesLater }));
      } finally {
        b.askFirst = askWas;
        b.allowed.delete(ownerA.sid);
        for (const id of extra) b.close(id);
        if (d) {
          for (const t of [...b.tabs.values()]) if (t.owner && t.owner.sid === d.sid) b.close(t.id);
          await post('', { method: 'DELETE', sid: d.sid }).catch(() => {});
        }
        // the browsers the asks opened are closed again: the checks below start from a closed panel
        await exec('Promise.all(["", "made-up-a", "made-up-d"].map((k) => Browser.toggleFor(k, false)))').catch(() => {});
        await until(() => !b.visible, 4000, 100);
      }

      // 8. a second chat: pages of its own, and none of the first chat's
      const c = await connect();
      names.set(c.sid, { name: 'Made-up checkout', key: '', chat: 'made-up-b' });
      const navB = await call(c.sid, 'navigate', { url: `${base}/second` });
      const second = tabIdOf(navB.text);
      const listB = await call(c.sid, 'tabs', { action: 'list' });
      const intrude = await call(c.sid, 'click', { ref: add, tab: shop });
      check('a second chat gets pages of its own: it does not see the first chat\'s, and cannot act in them',
        !navB.error && Boolean(second) && second !== shop && b.tabs.get(second).owner.name === 'Made-up checkout' && listB.text.includes(`${second} (this chat's, the one this chat works in)`)
        && !new RegExp(`\\b${shop}\\b`).test(listB.text) && intrude.error && intrude.text.startsWith(`${shop} belongs to another chat (Made-up research)`), JSON.stringify({ list: listB.text, intrude: short(intrude) }));

      // 8b. a page shown by anything but the panel, as Windows shows one again when the app's window comes back from
      // minimized: hidden again at once while the panel does not show it (6 Oct: a chat's page left floating over the
      // Nest). A page of the test's own, shown far off every screen so nothing appears on the person's, and closed after:
      // a page window once shown and hidden again gives empty pictures, which later checks take of the chats' pages.
      const stray = b.make(null, '', null, '');
      stray.page.setBounds({ x: -30000, y: -30000, width: 640, height: 480 });
      stray.page.showInactive();
      const strayShown = stray.page.isVisible();
      const strayGone = await until(() => !stray.page.isVisible(), 3000, 20);
      check('a page shown by anything but the panel (as Windows does when the app\'s window comes back from minimized) is hidden again at once: none floats where the panel does not show it',
        strayShown && Boolean(strayGone) && !b.visible && unseen(), JSON.stringify({ shown: strayShown, gone: Boolean(strayGone), visible: b.visible, unseen: unseen() }));
      b.close(stray.id, 'the self-test is done with it');
      await until(() => !b.tabs.has(stray.id), 3000, 50);

      // 9. no chat in front: Ctrl+Shift+B slides open the browser of every page and lays the page over its page area;
      // the sidebar has no Browser row (each chat has a globe on its strip)
      const before = await panelNow();
      await inPage(pageCtrl, 'KeyB', true, true);
      await until(() => b.visible, 6000, 100);
      const open = await panelNow();
      const zoom = win.webContents.getZoomFactor();
      const near = (x, y) => Math.abs(x - y) <= 1.5;
      const content = win.getContentBounds();
      const frontPage = b.tabs.get(b.shown);
      const pageAt = frontPage ? frontPage.page.getBounds() : null;
      check('with no chat in front, Ctrl+Shift+B opens the browser of every page, and the page in front takes exactly the place and size of its page area (and, the window being hidden, never shows on the screen); the sidebar has no Browser row',
        !before.browserRow && !before.open && open.open && open.whose === 'Every page' && open.state.scope === '' && b.visible && b.shown === open.state.front && Boolean(b.rect)
        && near(b.rect.x, open.rect.x * zoom) && near(b.rect.y, open.rect.y * zoom) && near(b.rect.width, open.rect.width * zoom) && near(b.rect.height, open.rect.height * zoom) && open.cardWidth > 370
        && Boolean(pageAt) && near(pageAt.x, content.x + b.rect.x) && near(pageAt.y, content.y + b.rect.y) && near(pageAt.width, b.rect.width) && near(pageAt.height, b.rect.height) && unseen(),
        JSON.stringify({ browserRow: before.browserRow, whose: open.whose, rect: b.rect, area: open.rect, page: pageAt, content, front: open.state.front, shown: b.shown, unseen: unseen() }));
      await inPage((id) => document.querySelector(`#web .web-tab[data-id="${id}"]`).click(), shop);
      await until(() => b.shown === shop && b.visible, 3000, 100);
      const tabsNow = await panelNow();
      const shopTab = tabsNow.tabs.find((t) => t.id === shop);
      check('the tabs show every page with its title and the chat that drives it; a click on one puts it in front, with its address and what its chat did',
        tabsNow.tabs.length === 3 && Boolean(shopTab) && shopTab.on && shopTab.title === 'Made-up shop' && shopTab.who === 'Made-up research'
        && tabsNow.tabs.some((t) => t.id === second && t.who === 'Made-up checkout') && tabsNow.url === base && tabsNow.now.startsWith('Made-up research') && b.shown === shop,
        JSON.stringify({ tabs: tabsNow.tabs, url: tabsNow.url, now: tabsNow.now }));
      await shootWithPage(shop, 'browser-1-open');

      // 9b. a chat lays its page out at a phone's size and leaves it so (his report, 6 Oct: "when you resize it it
      // doesn't resize properly"; a chat had put its page back after 1 of its 36 resizes): the panel says so with a way
      // back, the person's drag of the panel's edge puts the page back at the panel's size, and the chat's next step says so
      const phone = await call(a.sid, 'resize', { width: 390, height: 844, mobile: true, tab: shop });
      // a page with no viewport tag is laid out 980 wide on a phone, as Chrome does: the phone's own width is its screen's
      const narrow = await until(async () => (Number(await b.now(b.tabs.get(shop), 'screen.width')) === 390 ? 390 : null), 4000, 100);
      const said9b = await until(async () => { const p = await panelNow(); return /390 × 844/.test(p.now) && /Fit to the panel/.test(p.now) ? p : null; }, 4000, 100) || await panelNow();
      const gripDrag = (dx) => inPage(async (d) => {
        const g = document.querySelector('.web-grip');
        const r = g.getBoundingClientRect();
        const at = (type, x) => g.dispatchEvent(new PointerEvent(type, { bubbles: true, button: 0, pointerId: 1, clientX: x, clientY: r.top + r.height / 2 }));
        at('pointerdown', r.left + 2);
        await new Promise((done) => setTimeout(done, 500));
        at('pointermove', r.left + 2 + d);
        at('pointerup', r.left + 2 + d);
        return true;
      }, dx);
      await gripDrag(-32);
      const back9b = await until(async () => { const t = b.tabs.get(shop); const w = Number(await b.now(t, 'innerWidth')); return !t.emulated && b.rect && Math.abs(w - b.rect.width) <= 2 ? w : null; }, 5000, 100);
      const next9b = await call(a.sid, 'snapshot', { tab: shop });
      check('9b. a chat lays its page out at a phone\'s size: the panel says so with "Fit to the panel"; the person\'s drag of the panel\'s edge puts the page back at the panel\'s size, and the chat\'s next step says so',
        !phone.error && /until it goes back/.test(phone.text) && Boolean(narrow) && /390 × 844/.test(said9b.now) && /Fit to the panel/.test(said9b.now)
        && Boolean(back9b) && next9b.text.includes('The user resized the Browser panel: this page is laid out at the Browser panel\'s size again (it was 390×844 as on a phone)'),
        JSON.stringify({ phone: short(phone), narrow, now: said9b.now, back: back9b, area: b.rect && b.rect.width, next: String(next9b.text).slice(0, 220) }));
      await call(a.sid, 'resize', { width: 1440, height: 900, tab: shop });
      await until(async () => /Fit to the panel/.test((await panelNow()).now), 4000, 100);
      const fitPressed = await inPage(() => { const x = [...document.querySelectorAll('#web .web-now .web-ok')].find((e) => e.textContent === 'Fit to the panel'); if (x) x.click(); return Boolean(x); });
      const byButton = await until(() => (!b.tabs.get(shop).emulated ? true : null), 4000, 100);
      const next9c = await call(a.sid, 'snapshot', { tab: shop });
      const line9c = await until(async () => { const p = await panelNow(); return /Fit to the panel/.test(p.now) ? null : p; }, 4000, 100);
      check('9c. "Fit to the panel" on the panel\'s line puts the page back at the panel\'s size too, the line goes, and the chat is told; the next step says it once',
        fitPressed && Boolean(byButton) && Boolean(line9c) && next9c.text.includes('The user pressed "Fit to the panel"') && !(await call(a.sid, 'snapshot', { tab: shop })).text.includes('Fit to the panel'),
        JSON.stringify({ fitPressed, byButton, next: String(next9c.text).slice(0, 200) }));
      // the panel back at its usual width for what follows
      await inPage(() => { document.querySelector('.web-grip').dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); return true; });
      await wait(300);

      // 10. each chat has a browser of its own: going to one, the panel shows its browser, closed until its globe opens
      // it, with only its pages in it; a dialog over the window covers the page with its picture
      tilesWas = await exec('Desk.state.settings.tiles');
      await inPage((folder) => {
        const st = Desk.state;
        st.settings.tiles = 1;
        st.chats.push({ id: 'made-up-a', cwd: folder, title: 'Made-up research', named: true, starter: 'shell', startedAt: Date.now() - 60000 },
          { id: 'made-up-b', cwd: folder, title: 'Made-up checkout', named: true, starter: 'shell', startedAt: Date.now() - 30000 });
        Desk.setView('made-up-b');
        return true;
      }, dir);
      madeChats = true;
      const atB = await until(async () => { const p = await panelNow(); return !p.open && !b.visible && p.globes['made-up-b'] ? p : null; }, 4000, 100) || await panelNow();
      await inPage(() => document.querySelector('.tile[data-id="made-up-b"] .th-web').click());
      const followed = await until(async () => { const p = await panelNow(); return b.visible && b.shown === second ? p : null; }, 4000, 100);
      check('going to a chat, the panel shows that chat\'s browser: closed at first, its globe on the chat\'s strip counts its pages, and a click on the globe opens it with only that chat\'s pages',
        !atB.open && atB.globes['made-up-b'].n === '1' && !atB.globes['made-up-b'].on && Boolean(followed) && followed.whose === 'Made-up checkout' && followed.state.scope === 'made-up-b'
        && same(followed.tabs.map((t) => t.id), [second]) && followed.tabs[0].who === '' && followed.globes['made-up-b'].on,
        JSON.stringify({ closedFirst: !atB.open, globe: atB.globes['made-up-b'], whose: followed && followed.whose, tabs: followed && followed.tabs.map((t) => t.id), on: followed && followed.globes['made-up-b'] }));
      await exec('Palette.toggle()');
      const coveredNow = await until(async () => (!b.visible ? panelNow() : null), 4000, 100);
      await exec('Palette.close()');
      const uncovered = await until(() => b.visible, 4000, 100);
      check('a box over the window (here the search) puts the page\'s picture in its place, and the page comes back when it closes',
        Boolean(coveredNow) && coveredNow.still === 'data:image/jpeg;base64' && coveredNow.state.covered && Boolean(uncovered), JSON.stringify({ covered: coveredNow && coveredNow.state, still: coveredNow && coveredNow.still }));

      // 11. Take over: the chat's clicks stop on that page until it is handed back. The other chat's browser, by its key.
      await inPage(() => { Desk.setView('made-up-a'); return true; });
      const atA = await until(async () => { const p = await panelNow(); return !p.open && p.state.scope === 'made-up-a' ? p : null; }, 4000, 100);
      await inPage(pageCtrl, 'KeyB', true, true);
      const openA = await until(async () => { const p = await panelNow(); return b.visible && p.open ? p : null; }, 4000, 100);
      check('going to the other chat, its browser shows in place of the first one\'s (closed until asked for); Ctrl+Shift+B opens it with its own pages: the one it opened and the one that page opened',
        Boolean(atA) && Boolean(openA) && openA.whose === 'Made-up research' && same(openA.tabs.map((t) => t.id).sort(), [shop, popId].sort()),
        JSON.stringify({ atA: Boolean(atA), whose: openA && openA.whose, tabs: openA && openA.tabs.map((t) => t.id) }));
      await inPage((id) => document.querySelector(`#web .web-tab[data-id="${id}"]`).click(), shop);
      await until(() => b.shown === shop, 3000, 100);
      await inPage(() => document.querySelector('#web .web-hold').click());
      const held = await until(async () => { const p = await panelNow(); return b.tabs.get(shop).paused && p.hold === 'Hand back' ? p : null; }, 3000, 100);
      const blocked = await call(a.sid, 'click', { ref: add, tab: shop });
      await inPage(() => document.querySelector('#web .web-hold').click());
      await until(async () => !b.tabs.get(shop).paused && (await panelNow()).hold === 'Take over', 3000, 100);
      const again = await call(a.sid, 'click', { ref: add, tab: shop });
      check('Take over stops the chat\'s clicks and keys on that page, and says so to both; Hand back lets it carry on',
        Boolean(held) && held.hold === 'Hand back' && held.now.startsWith('You have this page') && blocked.error && blocked.text.startsWith(`The user took ${shop} over in the Browser panel`)
        && !again.error && again.text.includes('In your cart: 2'), JSON.stringify({ hold: held && held.hold, now: held && held.now, blocked: short(blocked), again: short(again) }));

      // 12. a chat that is not in front asks for the person on its page: the screen stays as it is, a line says so, its
      // row in the list shows a yellow globe; going to it, its browser is open on that page with the chat's words in
      // yellow. The window is never shown, nor focused.
      const shown = await call(c.sid, 'show', { message: 'Pick a delivery day, please' });
      const callSeen = await until(async () => { const p = await panelNow(); return p.rowCalls.includes('made-up-b') ? p : null; }, 4000, 100);
      check('a chat not in front that asks for the person leaves the screen as it is, says so in a line, and its row in the list shows a yellow globe',
        !shown.error && Boolean(callSeen) && callSeen.whose === 'Made-up research' && b.shown === shop && callSeen.toast.startsWith('Made-up checkout needs you on one of its pages')
        && !win.isVisible() && !win.isFocused() && unseen(), JSON.stringify(callSeen && { whose: callSeen.whose, toast: callSeen.toast, rows: callSeen.rowCalls }));
      await inPage(() => { Desk.setView('made-up-b'); return true; });
      const asking = await until(async () => { const p = await panelNow(); return p.nowNeeds && b.shown === second && b.visible ? p : null; }, 4000, 100);
      check('going to that chat, its browser is open on the page, with a yellow line naming the chat and its words; its tab and its globe are marked; the window is never shown nor focused',
        Boolean(asking) && asking.now.includes('Made-up checkout') && asking.now.includes('needs you here: Pick a delivery day, please') && asking.pageNeeds
        && asking.tabs.some((t) => t.id === second && t.needs) && asking.globes['made-up-b'].needs && !win.isVisible() && !win.isFocused() && unseen(),
        JSON.stringify(asking && { now: asking.now, globe: asking.globes['made-up-b'] }));
      await shootWithPage(second, 'browser-2-needs-you');
      await inPage(() => document.querySelector('#web .web-ok').click());
      const answered = await until(async () => { const p = await panelNow(); return !p.rowCalls.length && !p.globes['made-up-b'].needs ? p : null; }, 3000, 100);
      check('"Got it" takes the call away: the yellow line, the globe\'s mark and the row\'s globe', Boolean(answered) && !answered.nowNeeds);

      // 13. the person's own page: a chat sees it, and is told it is not its to close
      const mine = await inPage((u) => desk.browser.ask('open', u), `${base}/second`);
      const listA = await call(a.sid, 'tabs', { action: 'list' });
      const closeMine = await call(a.sid, 'tabs', { action: 'close', tab: mine && mine.id });
      check('a page the person opens is theirs: a chat lists it as the user\'s own, and may not close it',
        Boolean(mine && mine.id) && b.tabs.get(mine.id).owner === null && listA.text.includes(`${mine.id} (the user's own)`) && closeMine.error && closeMine.text.includes('only the user closes it'),
        JSON.stringify({ mine, list: listA.text, close: short(closeMine) }));

      // 13b. a page the person opened in the browser shown is in front, and that browser's chat works on its own page:
      // its page comes to the front, so what shows is what the chat does. Not while the person types an address.
      const own = await inPage((u) => desk.browser.ask('open', u, 'made-up-b'), `${base}/second`);
      const ownId = own && own.id ? own.id : '';
      const tabClick = (id) => inPage((x) => { const el = document.querySelector(`#web .web-tab[data-id="${x}"]`); if (el) el.click(); return Boolean(el); }, id);
      await until(() => inPage((x) => Boolean(document.querySelector(`#web .web-tab[data-id="${x}"]`)), ownId), 3000, 100);
      await tabClick(ownId);
      const ownFirst = await until(() => (ownId && b.shown === ownId ? ownId : ''), 3000, 100);
      const looked = await call(c.sid, 'snapshot', { tab: second });
      const turned = await until(async () => { const p = await panelNow(); return b.shown === second && p.state.front === second ? p : null; }, 3000, 100);
      await tabClick(ownId);
      await until(() => b.shown === ownId, 3000, 100);
      await inPage(() => { document.querySelector('#web .web-url').focus(); return true; });
      const typing = await call(c.sid, 'snapshot', { tab: second });
      await wait(400);
      const kept = (await panelNow()).state.front === ownId && b.shown === ownId;
      await inPage(() => { document.querySelector('#web .web-url').blur(); return true; });
      check('when the chat of the browser shown works on one of its pages, that page comes to the front, so the person sees what the chat does; not while the person types an address',
        Boolean(ownFirst) && !looked.error && Boolean(turned) && !typing.error && kept,
        JSON.stringify({ ownFirst, turned: Boolean(turned), kept, looked: short(looked), typing: short(typing) }));

      // 14. closed again by its globe, the pages step aside, and the chats go on working in them
      await inPage(pagePress, '.tile[data-id="made-up-b"] .th-web');
      await until(() => !b.visible, 4000, 100);
      const shut = await panelNow();
      const whileShut = await call(a.sid, 'click', { ref: add, tab: shop });
      check('the globe of the chat in front closes its browser: the pages step aside, and a chat goes on clicking in its page', !shut.open && !b.visible && !shut.state.open
        && !shut.globes['made-up-b'].on && !whileShut.error && whileShut.text.includes('In your cart: 3'),
        JSON.stringify({ open: shut.open, globe: shut.globes['made-up-b'], click: short(whileShut) }));

      // 15. Settings has its part: two switches, the logins, what the chats are offered, and the ask-first list
      await exec('Settings.open("browser")');
      const part = await until(() => inPage(() => {
        const s = document.querySelector('#settings [data-section="browser"]');
        const box = s && s.querySelector('textarea.ask-list');
        return s && { switches: s.querySelectorAll('.switch').length, on: s.querySelectorAll('.switch.on').length, forget: [...s.querySelectorAll('button.btn')].some((x) => x.textContent === 'Forget them'),
          ask: box ? box.value : null, text: s.textContent };
      }), 3000, 100);
      // a list typed in is kept in small letters, without https://, www. or a last slash; a line that is no site, or a
      // site said twice, is left out and the person is told; then the list goes back as it was
      const typeAsk = (lines) => inPage(async (text) => {
        const box = document.querySelector('#settings [data-section="browser"] textarea.ask-list');
        if (!box) return null;
        const t = document.getElementById('toast');
        const toastNow = () => (t && !t.hidden ? t.textContent : '');
        const toastWas = toastNow();
        box.value = text;
        box.dispatchEvent(new Event('change'));
        // the box is written again and the person told at the same moment, once the list is kept
        for (let i = 0; i < 60 && toastNow() === toastWas; i++) await new Promise((done) => setTimeout(done, 50));
        return { value: box.value, toast: toastNow() };
      }, lines.join('\n'));
      const { ASK_FIRST } = require('./browser.cjs');
      const typedAsk = part && part.ask !== null ? await typeAsk(['https://www.Made-up-Mail.example/', 'not a site', 'made-up-mail.example', 'files.made-up.example/inbox/']) : null;
      const keptAsk = b.askFirst().slice();
      const backAsk = part && part.ask !== null ? await typeAsk(ASK_FIRST) : null;
      await exec('Settings.open("browser")');
      await shoot('browser-4-settings');
      await exec('Settings.close()');
      check('Settings has a Browser part: whether the chats are offered it (on), whether the panel opens by itself (off), Forget them for its logins, and the sites a chat opens only on the person\'s yes (the mail, files, accounts, payments and messages of the default list)',
        Boolean(part) && part.switches === 2 && part.on === 0 && part.forget && part.text.includes('Let your chats use the browser') && part.text.includes('Open the panel when a chat opens a page')
        && part.text.includes('Sites a chat opens only on your yes') && part.ask === ASK_FIRST.join('\n') && ASK_FIRST.includes('mail.google.com') && ASK_FIRST.includes('upwork.com'),
        JSON.stringify(part && { ...part, ask: part.ask === null ? null : part.ask.split('\n').length, text: part.text.slice(0, 160) }));
      check('a list typed in the box is kept clean (small letters, no https://, www. or last slash; a line that is no site, or a site twice, left out, and the person told), the chats\' browser goes by it at once, and the list goes back as it was',
        Boolean(typedAsk) && typedAsk.value === 'made-up-mail.example\nfiles.made-up.example/inbox' && typedAsk.toast.startsWith('Kept 2 sites; 2 lines were not a site, or twice.')
        && same(keptAsk, ['made-up-mail.example', 'files.made-up.example/inbox']) && Boolean(backAsk) && backAsk.value === ASK_FIRST.join('\n') && same(b.askFirst(), ASK_FIRST),
        JSON.stringify({ typed: typedAsk, kept: keptAsk, back: backAsk && backAsk.value.split('\n').length, now: b.askFirst().length }));

      // 15c. look: the page on a phone, a tablet and a laptop, a picture of each first screen and what is off measured;
      // the page put back at its size and where it was scrolled
      const nums = (r) => (((/It gave back:\n([\s\S]*?)\n\n/.exec(r.text) || [])[1] || '').match(/-?\d+/g) || []).map(Number);
      const opened15 = await call(a.sid, 'navigate', { url: `${base}/faults`, new_tab: true });
      const faultsTab = tabIdOf(opened15.text);
      await call(a.sid, 'scroll', { direction: 'down', amount: 200, tab: faultsTab });
      const was15 = nums(await call(a.sid, 'evaluate', { script: '() => [innerWidth, Math.round(scrollY)]', tab: faultsTab }));
      const seen15 = await call(a.sid, 'look', { tab: faultsTab });
      const now15 = nums(await call(a.sid, 'evaluate', { script: '() => [innerWidth, Math.round(scrollY)]', tab: faultsTab }));
      const sizes15 = seen15.images.map((im) => nativeImage.createFromBuffer(Buffer.from(im.data, 'base64')).getSize());
      seen15.images.forEach((im, i) => fs.writeFileSync(path.join(dir, `browser-5-look-${['phone', 'tablet', 'laptop'][i] || i}.jpg`), Buffer.from(im.data, 'base64')));
      const part15 = (name) => seen15.text.split('\n\n').find((x) => x.startsWith(name)) || '';
      const phone15 = part15('Phone');
      const laptop15 = part15('Laptop');
      say(`      what look said on the phone: ${phone15.replace(/\n/g, ' | ').slice(0, 1400)}`);
      say(`      and on the laptop: ${laptop15.replace(/\n/g, ' | ').slice(0, 1400)}`);
      say(`      and on the tablet: ${part15('Tablet').replace(/\n/g, ' | ').slice(0, 600)}`);
      check('15c. look shows the page on a phone, a tablet and a laptop: a picture of each first screen, and what is off measured (a page wider than the phone and what sticks out, a soft, a stretched and a missing picture, a cut line, text over text, small print, text off the middle of its box, an emoji for an icon, a font that is not there, the content kept to one side of the laptop); the page goes back to its size and place',
        !seen15.error && seen15.images.length === 3 && same(sizes15.map((s) => s.width), [390, 768, 1280]) && sizes15.every((s) => s.height > 300)
        && seen15.text.startsWith(`Page ${faultsTab} "Made-up faults"`) && /(\d+ px wide for a 390 px screen, so the phone shows the page zoomed out to \d+% of its size|scrolls sideways by \d+ px); sticking out: div\.wide/.test(phone15)
        && phone15.includes('small.png: a 100×100 file shown at 300×300 on a 2× screen') && phone15.includes('Stretched pictures: wide.png: a 200×100 file drawn 200×200')
        && phone15.includes('Pictures that did not load: missing-look.png') && phone15.includes('Text cut off: p.cut') && phone15.includes('Text over other text: "Made-up revenue 1200" and "Made-up label"')
        && /Text under 12 px in \d+ place/.test(phone15) && /a\.go "Made-up go": its text sits \d+ px high of the middle/.test(phone15) && phone15.includes('Emojis standing in for icons: 🚀 in button')
        && /Fonts that did not load: MadeUpGone/.test(seen15.text) && /\d+ px more room on the right than on the left/.test(laptop15) && !/sideways/.test(laptop15)
        && part15('Tablet').startsWith('Tablet (768×1024') && !/zoomed|sideways/.test(part15('Tablet')) && !/opens zoomed/.test(phone15)
        && was15.length === 2 && same(now15, was15) && was15[1] >= 150 && !b.tabs.get(faultsTab).emulated && unseen(),
        JSON.stringify({ error: seen15.error, images: sizes15, was: was15, now: now15, text: seen15.text.slice(0, 300) }));
      await call(a.sid, 'tabs', { action: 'close', tab: faultsTab });

      // 16. a session Claude Code ends is forgotten; the pages close with the app
      const ended = await post('', { method: 'DELETE', sid: c.sid });
      check('a session Claude Code ends is forgotten', ended.status === 200 && !door.sessions.has(c.sid), String(ended.status));
    } finally {
      browser.who(null);
      b.closeAll();
      const unanswered = [...answering].map((x) => x.what);
      const open = await new Promise((done) => site.getConnections((err, n) => done(err ? -1 : n)));
      const carried = [...linked].map((s) => (s.carried.length ? s.carried.slice(-3).join(' + ') : 'no request'));
      // the site waits for every connection to end; one the browser keeps open is closed after 2 s, and said
      let shut = false;
      let forced = false;
      await new Promise((done) => {
        site.close(() => { shut = true; done(); });
        setTimeout(() => { if (!shut) { forced = true; site.closeAllConnections(); } }, 2000);
      });
      say(`      the made-up site when its pages had closed: ${open} connection${open === 1 ? '' : 's'} open${carried.length ? ` (their last requests: ${carried.join(' | ')})` : ''}, unanswered ${unanswered.length ? unanswered.join(', ') : 'none'}; ${forced ? 'closed by force after 2 s' : 'closed by itself'}`);
      if (madeChats) {
        await inPage((tiles) => {
          const st = Desk.state;
          const made = (id) => id.startsWith('made-up-');
          st.chats = st.chats.filter((x) => !made(x.id));
          st.shown = st.shown.filter((id) => !made(id));
          st.recent = st.recent.filter((id) => !made(id));
          st.settings.tiles = tiles;
          Desk.setView('peek');
          return true;
        }, tilesWas).catch(() => {});
      }
      // every browser closed again: what is open is kept for the next start of this profile
      await exec('Promise.all(["", "made-up-a", "made-up-b"].map((k) => Browser.toggleFor(k, false)))').catch(() => {});
      check('afterwards every page and its window is closed, and no page window ever showed on the screen', b.tabs.size === 0 && BrowserWindow.getAllWindows().length === windowsBefore,
        JSON.stringify({ tabs: b.tabs.size, windows: BrowserWindow.getAllWindows().length, before: windowsBefore }));
      await view('peek');
    }
  };

  // ---- the Viewer (his ask, 4 Oct: an image and video player Claude Code can drive, that reads every kind of file,
  // ---- light and quick): made-up pictures, videos and a sound made here by ffmpeg, shown by a made-up chat through
  // ---- Claude Code's door, driven and looked at. The window is hidden throughout, and nothing makes a sound. ----
  const viewerPhase = async () => {
    check('the window loads for the Viewer checks', Boolean(await until(() => exec('typeof Desk === "object" && Desk !== null && typeof Viewer === "object" && typeof Browser === "object"'), 15000)));
    watch.post({ type: 'pace', ms: 600000 });
    win.setContentSize(1440, 900);
    madeAt = Date.now();
    await installFakes();
    await showUsage('today');
    await exec(`takeSnapshot(${fake(madeAt, madeUpRows(false))})`);
    await exec(`takeSnapshot(${fake(madeAt + 1, madeUpRows(true))})`);
    const http = require('node:http');
    const { execFile } = require('node:child_process');
    const { nativeImage } = require('electron');
    const v = viewer.get();
    const door = await until(() => { const d = browser.door(); return d && d.port ? d : null; }, 10000, 100);
    check('the Viewer starts with the window, and shares the Browser\'s door to Claude Code', Boolean(v) && Boolean(door) && door.viewer === v, JSON.stringify({ viewer: Boolean(v), port: door && door.port }));
    if (!v || !door) return;

    const token = browser.token();
    const post = (body, { sid = '', method = 'POST' } = {}) => new Promise((done, fail) => {
      const text = typeof body === 'string' ? body : JSON.stringify(body);
      const req = http.request({ host: '127.0.0.1', port: door.port, path: '/mcp', method, headers: {
        'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', 'Content-Length': Buffer.byteLength(text), Authorization: `Bearer ${token}`,
        ...(sid ? { 'Mcp-Session-Id': sid } : {}),
      } }, (res) => {
        const parts = [];
        res.on('data', (c) => parts.push(c));
        res.on('end', () => {
          const raw = Buffer.concat(parts).toString('utf8');
          let json = null;
          try { json = JSON.parse(raw); } catch { json = null; }
          done({ status: res.statusCode, sid: String(res.headers['mcp-session-id'] || ''), json, raw });
        });
      });
      req.on('error', fail);
      req.end(text);
    });
    let rpc = 0;
    const call = async (sid, name, args = {}) => {
      const r = await post({ jsonrpc: '2.0', id: ++rpc, method: 'tools/call', params: { name, arguments: args } }, { sid });
      const res = r.json && r.json.result;
      return { error: Boolean(res && res.isError), text: res ? res.content.filter((c) => c.type === 'text').map((c) => c.text).join('\n') : r.raw,
        image: res ? res.content.find((c) => c.type === 'image') || null : null };
    };
    const short = (r) => JSON.stringify({ error: r.error, text: String(r.text).slice(0, 260) });
    const st = () => inPage(() => Viewer.state());
    // where the stage, its first file's box and what that box draws stand: [left, top, width, height]
    const boxes = () => inPage(() => {
      const r = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return [Math.round(b.left), Math.round(b.top), Math.round(b.width), Math.round(b.height)]; };
      const stage = document.querySelector('#viewer .vw-stage');
      const el = stage.querySelector('.vw-media');
      const box = r(el);
      const s = r(stage);
      let drawn = box;
      // a video fills its box and draws its frames in the middle of it, as large as fits
      if (el && el.tagName === 'VIDEO' && el.videoWidth) {
        const k = Math.min(box[2] / el.videoWidth, box[3] / el.videoHeight);
        const w = Math.round(el.videoWidth * k);
        const h = Math.round(el.videoHeight * k);
        drawn = [box[0] + Math.round((box[2] - w) / 2), box[1] + Math.round((box[3] - h) / 2), w, h];
      }
      const mid = (b) => [b[0] + b[2] / 2, b[1] + b[3] / 2];
      const centred = Boolean(drawn && s) && Math.abs(mid(drawn)[0] - mid(s)[0]) <= 1.5 && Math.abs(mid(drawn)[1] - mid(s)[1]) <= 1.5;
      return { column: r(document.getElementById('viewer')), card: r(document.querySelector('#viewer .vw-card')), stage: s, pane: r(stage.querySelector('.vw-pane')),
        zoom: r(stage.querySelector('.vw-zoom')), box, media: drawn, centred, kids: [...stage.children].map((k) => `${k.className}:${getComputedStyle(k).display}:${getComputedStyle(k).position}`) };
    });
    const key = (k) => inPage((name) => {
      const card = document.querySelector('#viewer .vw-card');
      card.focus();
      card.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true }));
      return true;
    }, k);
    const names = new Map();
    browser.who((_pid, drv) => (drv && names.has(drv.sid) ? names.get(drv.sid) : null));
    const media = path.join(dir, 'media');
    let madeChats = false;
    let tilesWas = 2;
    let sid = '';
    try {
      // 1. the made-up files, made by the same ffmpeg the Viewer finds
      const tools = await v.find();
      fs.mkdirSync(path.join(media, '.hidden'), { recursive: true });
      const make = (args) => new Promise((done) => {
        if (!tools.ffmpeg) { done(false); return; }
        execFile(tools.ffmpeg, ['-hide_banner', '-nostdin', '-v', 'error', '-y', ...args], { windowsHide: true, timeout: 30000 }, (err) => done(!err));
      });
      const at = (name) => path.join(media, name);
      const made = {
        jpg: await make(['-f', 'lavfi', '-i', 'testsrc=size=320x240:rate=1', '-frames:v', '1', '-update', '1', at('grad.jpg')]),
        png: await make(['-f', 'lavfi', '-i', 'color=c=0xd04a3a:s=64x48', '-frames:v', '1', '-update', '1', at('red.png')]),
        tiff: await make(['-f', 'lavfi', '-i', 'testsrc=size=64x48:rate=1', '-frames:v', '1', '-update', '1', at('photo.tiff')]),
        mp4: await make(['-f', 'lavfi', '-i', 'testsrc=size=320x240:rate=25:duration=2', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', '-c:v', 'libx264', '-preset', 'ultrafast',
          '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', '-movflags', '+faststart', at('clip.mp4')]),
        avi: await make(['-f', 'lavfi', '-i', 'testsrc=size=320x240:rate=25:duration=2', '-c:v', 'mpeg4', '-q:v', '5', at('clip.avi')]),
        webm: await make(['-f', 'lavfi', '-i', 'testsrc=size=160x120:rate=25:duration=1', '-c:v', 'libvpx', '-b:v', '200k', at('clip.webm')]),
        wav: await make(['-f', 'lavfi', '-i', 'sine=frequency=330:duration=1', at('tone.wav')]),
      };
      fs.writeFileSync(at('logo.svg'), '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><circle cx="32" cy="32" r="24" fill="#ececee"/></svg>');
      if (made.png) {
        fs.copyFileSync(at('red.png'), path.join(media, '.hidden', 'x.png'));
        fs.copyFileSync(at('red.png'), at('secret.key'));
        fs.copyFileSync(at('red.png'), at('picture-without-name'));
        fs.copyFileSync(at('red.png'), at('made-up.exe'));
        // the folder's files no chat shows, for the arrows (14h): two to go through, two that are never listed
        fs.copyFileSync(at('red.png'), at('unshown-1.png'));
        fs.copyFileSync(at('red.png'), at('.dot.png'));
        fs.copyFileSync(at('red.png'), at('my-credentials.png'));
      }
      if (made.tiff) fs.copyFileSync(at('photo.tiff'), at('unshown-2.tif'));
      check('ffmpeg is found on this computer and makes the made-up files: two pictures, a TIFF, an MP4 with sound, an AVI, a WebM and a WAV',
        Boolean(tools.ffmpeg) && Boolean(tools.ffprobe) && Object.values(made).every(Boolean), JSON.stringify({ ffmpeg: Boolean(tools.ffmpeg), ffprobe: Boolean(tools.ffprobe), made }));
      if (!Object.values(made).every(Boolean)) return;

      // 2. Claude Code is offered the Viewer's three tools and told what they are for
      const init = await post({ jsonrpc: '2.0', id: ++rpc, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'made-up-claude-code', version: '0' } } });
      sid = init.sid;
      await post({ jsonrpc: '2.0', method: 'notifications/initialized' }, { sid });
      names.set(sid, { name: 'Made-up artist', key: '', chat: 'made-up-v', cwd: media });
      const listed = await post({ jsonrpc: '2.0', id: ++rpc, method: 'tools/list' }, { sid });
      const offered = listed.json && listed.json.result ? listed.json.result.tools.map((t) => t.name) : [];
      const said = init.json && init.json.result ? init.json.result.instructions : '';
      check('Claude Code is offered show_media, media_control and media_look beside the Browser\'s tools, and told when to use them',
        ['show_media', 'media_control', 'media_look'].every((n) => offered.includes(n)) && /show_media to put it\s+in front of the user/.test(said) && /media_look/.test(said),
        JSON.stringify({ tools: offered.length, viewer: offered.filter((n) => /media/.test(n)) }));

      // 3. a made-up chat in front, working in the folder of the made-up files
      tilesWas = await exec('Desk.state.settings.tiles');
      await inPage((folder) => {
        const s = Desk.state;
        s.settings.tiles = 1;
        s.chats.push({ id: 'made-up-v', cwd: folder, title: 'Made-up artist', named: true, starter: 'shell', startedAt: Date.now() - 60000 },
          { id: 'made-up-w', cwd: folder, title: 'Made-up writer', named: true, starter: 'shell', startedAt: Date.now() - 30000 });
        Desk.setView('made-up-v');
        return true;
      }, media);
      madeChats = true;
      await until(() => inPage(() => document.querySelector('.tile[data-id="made-up-v"]') !== null), 4000, 100);
      const closedFirst = await st();
      // opened by hand before anything was shown: it says how files get there, and stays open as the window is drawn again
      await inPage(pageCtrl, 'KeyM', true, true);
      await exec('paint()');
      await wait(150);
      const empty = await inPage(() => {
        const e = document.querySelector('#viewer .vw-empty');
        return { open: Viewer.isOpen(), words: e && !e.hidden ? e.textContent : '', button: Boolean(e && e.querySelector('.vw-open-btn')) };
      });
      await inPage(pageCtrl, 'KeyM', true, true);
      const emptyShut = await until(async () => !(await inPage(() => Viewer.isOpen())), 3000, 100);
      check('Ctrl+Shift+M opens the Viewer of a chat that showed nothing yet: it says how files get there, stays open as the window is drawn again, and closes again with the same keys',
        empty.open && /Nothing to show here yet/.test(empty.words) && /drop files here/.test(empty.words) && empty.button && emptyShut === true, JSON.stringify({ empty, emptyShut }));

      // 4. a picture, by a path from the chat's folder
      const one = await call(sid, 'show_media', { files: ['grad.jpg'], note: 'The made-up test card.' });
      const s1 = await until(async () => { const s = await st(); return s.open && s.media.length === 1 && s.media[0].w === 320 ? s : null; }, 6000, 100) || await st();
      check('show_media with a picture: the Viewer, closed until then, slides in beside the chat that asked and shows it whole; Claude Code is told what it is and that the user sees it',
        !closedFirst.open && !one.error && /^Showing 1 file\. The user sees it now in the Viewer beside this chat\./.test(one.text) && /grad\.jpg: image, 320 × 240/.test(one.text)
        && s1.open && s1.scope === 'made-up-v' && s1.media.length === 1 && s1.media[0].tag === 'IMG' && s1.media[0].h === 240, JSON.stringify({ text: one.text.slice(0, 300), state: s1 }));
      const head = await inPage(() => {
        const b = document.querySelector('.tile[data-id="made-up-v"] .th-view');
        const n = document.querySelector('#viewer .vw-note');
        const grid = getComputedStyle(document.body).gridTemplateColumns.split(' ');
        return { button: b ? b.textContent : null, on: b ? b.classList.contains('on') : null, note: n && !n.hidden ? n.textContent : '', columns: grid.length, last: parseFloat(grid[grid.length - 1]) };
      });
      check('the chat\'s strip gets the Viewer\'s button with how many files it showed, the note shows under the picture, and the Viewer stands in its own column at the right',
        head.button === '1' && head.on === true && head.note.includes('The made-up test card.') && head.columns === 4 && head.last >= 360, JSON.stringify(head));
      const middle = await boxes();
      check('the picture stands in the middle of the stage, at its own size where it fits', middle.centred && middle.media[2] === 320 && middle.media[3] === 240, JSON.stringify(middle));
      await shoot('viewer-1-picture');

      // 5. a video by its whole path, paused as asked: driven, then looked at
      const two = await call(sid, 'show_media', { files: [at('clip.mp4')], play: false, title: 'Made-up clip' });
      const s2 = await until(async () => { const s = await st(); return s.media.length === 1 && s.media[0].tag === 'VIDEO' && s.media[0].duration > 1 ? s : null; }, 8000, 100) || await st();
      check('show_media with a video: it loads paused as asked, silent, and Claude Code is told its size, length, frame rate and what it is coded in',
        !two.error && /clip\.mp4: video, 320 × 240, 0:02\.\d, 25 fps, h264, sound aac/.test(two.text) && s2.media.length === 1 && s2.media[0].paused === true && s2.media[0].w === 320 && s2.media[0].muted === true,
        JSON.stringify({ text: two.text.slice(0, 300), media: s2.media }));
      const filled = await boxes();
      check('the video fills the stage\'s width, in its middle', filled.centred && Boolean(filled.box) && Boolean(filled.stage) && filled.box[2] === filled.stage[2], JSON.stringify(filled));
      const sought = await call(sid, 'media_control', { action: 'seek', value: 1 });
      const fast = await call(sid, 'media_control', { action: 'speed', value: '2' });
      const looped = await call(sid, 'media_control', { action: 'loop', value: true });
      const stepped = await call(sid, 'media_control', { action: 'step', value: 1 });
      const wrong = await call(sid, 'media_control', { action: 'speed', value: 'fast' });
      check('media_control seeks, changes the speed, loops and steps a frame, saying how the video stands after each; a wrong value is refused in words',
        /paused at 0:01\.0 of 0:02\.\d/.test(sought.text) && /speed 2×/.test(fast.text) && /, looping/.test(looped.text) && /paused at 0:01\.0/.test(stepped.text) && wrong.error && /speed takes a number/.test(wrong.text),
        JSON.stringify({ sought: sought.text, fast: fast.text, looped: looped.text, stepped: stepped.text, wrong: wrong.text }));
      const lookNow = await call(sid, 'media_look', {});
      const lookAt = await call(sid, 'media_look', { at: 1.5 });
      const pic = lookNow.image ? nativeImage.createFromBuffer(Buffer.from(lookNow.image.data, 'base64')) : null;
      const size = pic ? pic.getSize() : null;
      let light = 0;
      if (pic) {
        const bmp = pic.toBitmap();
        for (let i = 0; i < bmp.length; i += 4) light += bmp[i] + bmp[i + 1] + bmp[i + 2];
        light /= (bmp.length / 4) * 3;
      }
      check('media_look hands Claude Code a picture of the frame where the video stands (not a black one), or at a second asked for',
        !lookNow.error && Boolean(lookNow.image) && lookNow.image.mimeType === 'image/jpeg' && /clip\.mp4 at 0:01\.0 \(320 × 240\)/.test(lookNow.text) && Boolean(size) && size.width === 320 && size.height === 240
        && light > 30 && !lookAt.error && /clip\.mp4 at 0:01\.5/.test(lookAt.text) && Boolean(lookAt.image), JSON.stringify({ now: lookNow.text, at: lookAt.text, size, light: Math.round(light) }));
      await shoot('viewer-2-video');

      // 6. what the window cannot play as it is: a progress line, then the copy made once
      const avi = await call(sid, 'show_media', { files: ['clip.avi'] });
      const waitWords = await until(() => inPage(() => { const w = document.querySelector('#viewer .vw-wait'); return w ? w.textContent : null; }), 2000, 40);
      const s3 = await until(async () => { const s = await st(); return s.media.length === 1 && s.media[0].tag === 'VIDEO' && s.media[0].w === 320 && s.media[0].src.startsWith('lowlit-media://c/') ? s : null; }, 30000, 200) || await st();
      const tiff = await call(sid, 'show_media', { files: ['photo.tiff'] });
      const s4 = await until(async () => { const s = await st(); return s.media.length === 1 && s.media[0].tag === 'IMG' && s.media[0].w === 64 && s.media[0].src.startsWith('lowlit-media://c/') ? s : null; }, 15000, 150) || await st();
      check('a video the window cannot play (MPEG-4 in an AVI) and a TIFF picture are each copied once into what it plays, and shown from the copy; Claude Code is told a copy is being made',
        !avi.error && /a copy that plays here is being made|shown from a copy made to play here/.test(avi.text) && s3.media.length === 1 && s3.media[0].src.startsWith('lowlit-media://c/') && !tiff.error && s4.media.length === 1 && s4.media[0].w === 64,
        JSON.stringify({ avi: avi.text.slice(0, 200), waited: waitWords, video: s3.media, tiff: tiff.text.slice(0, 160), picture: s4.media }));
      const plain = await call(sid, 'show_media', { files: ['picture-without-name'] });
      check('a file whose name says nothing is known by what it starts with', !plain.error && /picture-without-name: image, 64 × 48/.test(plain.text), short(plain));

      // 7. two side by side, then one over the other with a line to wipe, and looked at together
      const cmp = await call(sid, 'show_media', { files: ['grad.jpg', 'red.png'], title: 'Before and after' });
      const s5 = await until(async () => { const s = await st(); return s.mode === 'compare' && s.media.length === 2 && s.media.every((m) => m.w > 0) ? s : null; }, 6000, 100) || await st();
      const lookBoth = await call(sid, 'media_look', {});
      const sides = await inPage(() => ({ mode: document.querySelector('#viewer .vw-stage').dataset.mode, title: document.querySelector('#viewer .vw-title').textContent,
        labels: [...document.querySelectorAll('#viewer .vw-label')].map((l) => l.textContent) }));
      check('two files stand side by side, each named at its foot; media_look hands back the two together',
        !cmp.error && /side by side/.test(cmp.text) && s5.mode === 'compare' && sides.mode === 'compare-side' && sides.title === 'Before and after' && same(sides.labels, ['grad.jpg', 'red.png'])
        && !lookBoth.error && /grad\.jpg \(320 × 240\) beside red\.png \(64 × 48\)/.test(lookBoth.text), JSON.stringify({ sides, look: lookBoth.text }));
      await key('w');
      const wiped = await inPage(() => {
        const stage = document.querySelector('#viewer .vw-stage');
        const top = stage.querySelector('.vw-top-pane');
        return { mode: stage.dataset.mode, clip: top ? top.style.clipPath : '', handle: Boolean(stage.querySelector('.vw-wipe-handle')) };
      });
      check('W lays the two one over the other, with a line to drag between them at the middle', wiped.mode === 'compare-wipe' && /50%/.test(wiped.clip) && wiped.handle, JSON.stringify(wiped));
      await shoot('viewer-3-wipe');

      // 8. six files as a grid: small pictures made two at a time, a sound's mark
      const many = await call(sid, 'show_media', { files: ['grad.jpg', 'red.png', 'clip.mp4', 'tone.wav', 'logo.svg', 'clip.webm'] });
      const cells = await until(async () => {
        const list = await inPage(() => [...document.querySelectorAll('#viewer .vw-grid .vw-cell')].map((c) => {
          const img = c.querySelector('img');
          return { name: c.querySelector('.vw-cell-name').textContent, img: Boolean(img), loaded: img ? img.complete && img.naturalWidth > 0 : null };
        }));
        return list.length === 6 && list.filter((c) => c.img).every((c) => c.loaded) ? list : null;
      }, 15000, 200) || [];
      check('six files make a grid: each picture and video gets its small picture, the sound a mark of its own',
        !many.error && cells.length === 6 && cells.filter((c) => c.img).length === 5 && (cells.find((c) => c.name === 'tone.wav') || {}).img === false, JSON.stringify(cells));
      await shoot('viewer-4-grid');
      await inPage(() => { [...document.querySelectorAll('#viewer .vw-cell')].find((c) => c.textContent.includes('clip.webm')).click(); return true; });
      const picked = await until(async () => { const s = await st(); return s.mode === 'one' && s.media.length === 1 && s.media[0].tag === 'VIDEO' && s.media[0].w === 160 ? s : null; }, 6000, 100);
      check('a press on a file of the grid shows it alone (a WebM, played as it is)', Boolean(picked) && picked.media[0].src.startsWith('lowlit-media://o/'), JSON.stringify(picked && picked.media));

      // 9. a sound: its bar, and no picture to look at
      const sound = await call(sid, 'show_media', { files: ['tone.wav'] });
      const s6 = await until(async () => { const s = await st(); return s.media.length === 1 && s.media[0].tag === 'AUDIO' && s.media[0].duration > 0.5 ? s : null; }, 6000, 100) || await st();
      const bar = await inPage(() => { const b = document.querySelector('#viewer .vw-bar'); return { shown: !b.hidden, time: b.querySelector('.vw-time') ? b.querySelector('.vw-time').textContent : '' }; });
      const soundLook = await call(sid, 'media_look', {});
      check('a sound shows with its bar (not playing until asked), and media_look says it has no picture',
        !sound.error && s6.media.length === 1 && s6.media[0].paused === true && bar.shown && /0:00\.0 \/ 0:01\.0/.test(bar.time) && soundLook.error && /is a sound/.test(soundLook.text),
        JSON.stringify({ media: s6.media, bar, look: soundLook.text }));
      await shoot('viewer-5-sound');

      // 10. what is never opened, and what is never handed to Windows to open
      const refused = await call(sid, 'show_media', { files: ['.hidden/x.png', 'secret.key', 'https://example.com/a.png', 'not-there.png'] });
      check('a file in a folder whose name starts with a dot, a file named as keys, a web address and a missing file are each refused in words',
        refused.error && /x\.png is not opened/.test(refused.text) && /secret\.key is not opened/.test(refused.text) && /open web addresses with navigate/.test(refused.text) && /There is no file/.test(refused.text),
        refused.text);
      const prog = await call(sid, 'show_media', { files: ['made-up.exe'] });
      const progItem = [...v.byToken.values()].find((it) => it.name === 'made-up.exe');
      const progPath = progItem ? await v.request('path', progItem.id) : null;
      const goodPath = await v.request('path', [...v.byToken.values()].find((it) => it.name === 'red.png').id);
      check('a picture under a program\'s name is shown, but only a file named as a picture, a video or a sound would be handed to Windows to open',
        !prog.error && Boolean(progPath) && progPath.known === false && goodPath.known === true, JSON.stringify({ prog: prog.text.slice(0, 120), progPath, goodPath }));

      // 11. its files reach the page by name only, in parts as a video asks
      const item = [...v.byToken.values()].find((it) => it.name === 'clip.mp4');
      const whole = fs.statSync(at('clip.mp4')).size;
      const part = await v.serve({ url: `lowlit-media://o/${item.token}`, headers: new Headers({ range: 'bytes=0-99' }) });
      const partBody = Buffer.from(await part.arrayBuffer());
      const nobody = await v.serve({ url: 'lowlit-media://o/made-up-name', headers: new Headers() });
      check('a file is served by the name the Viewer gave it, in the part asked for; a name it never gave is not found',
        part.status === 206 && part.headers.get('content-range') === `bytes 0-99/${whole}` && partBody.length === 100 && nobody.status === 404, JSON.stringify({ status: part.status, range: part.headers.get('content-range'), got: partBody.length, nobody: nobody.status }));
      const copied = [...v.byToken.values()].find((it) => it.name === 'clip.avi');
      const copyRead = copied ? await v.serve({ url: `lowlit-media://c/${copied.token}`, headers: new Headers({ range: 'bytes=0-9' }) }) : null;
      if (copyRead && copyRead.body) await copyRead.body.cancel().catch(() => {});
      check('11b. The page keeps a file it read, and its small picture (they never change under their name); a copy is read again each time (it can be made anew)',
        /immutable/.test(part.headers.get('cache-control') || '') && Boolean(copyRead) && copyRead.status === 206 && /no-cache/.test(copyRead.headers.get('cache-control') || ''),
        JSON.stringify({ file: part.headers.get('cache-control'), copy: copyRead && copyRead.headers.get('cache-control') }));

      // 12. the Viewer and the Browser take turns on the right of the window
      await call(sid, 'show_media', { files: ['grad.jpg'] });
      await until(async () => (await st()).open, 4000, 100);
      await exec('Browser.toggleFor("made-up-v", true)');
      const turn1 = await until(async () => { const r = await inPage(() => ({ viewer: Viewer.isOpen(), browser: Browser.isOpen() })); return !r.viewer && r.browser ? r : null; }, 4000, 100);
      await inPage(pageCtrl, 'KeyM', true, true);
      const turn2 = await until(async () => {
        const r = await inPage(() => ({ viewer: Viewer.isOpen(), browser: Browser.isOpen(), keys: document.querySelector('#viewer .vw-card').contains(document.activeElement) }));
        return r.viewer && !r.browser ? r : null;
      }, 4000, 100);
      check('opening the Browser closes the Viewer; Ctrl+Shift+M brings the Viewer back, with the keyboard, and closes the Browser', Boolean(turn1) && Boolean(turn2) && turn2.keys,
        JSON.stringify({ turn1, turn2 }));

      // 13. its keys: F fills the window, Escape steps back, then closes it; Space plays a video (silent)
      await call(sid, 'show_media', { files: ['clip.mp4'], play: false });
      await until(async () => { const s = await st(); return s.media.length === 1 && s.media[0].tag === 'VIDEO' && s.media[0].duration > 1; }, 6000, 100);
      await key(' ');
      const playing = await until(async () => { const s = await st(); return s.media[0] && s.media[0].paused === false ? s : null; }, 3000, 100);
      await key(' ');
      await key('f');
      const bigNow = await inPage(() => ({ big: document.body.classList.contains('vw-big'), wide: Math.round(document.querySelector('#viewer .vw-card').getBoundingClientRect().width) }));
      await key('Escape');
      const smallAgain = await inPage(() => ({ big: document.body.classList.contains('vw-big'), open: Viewer.isOpen() }));
      await key('Escape');
      const shut = await until(async () => !(await inPage(() => Viewer.isOpen())), 3000, 100);
      check('in the Viewer, Space plays and pauses a video (without a sound), F fills the window, Escape steps back beside the chat and then closes it',
        Boolean(playing) && playing.media[0].muted && bigNow.big && bigNow.wide > 1200 && !smallAgain.big && smallAgain.open && shut === true, JSON.stringify({ playing: Boolean(playing), bigNow, smallAgain, shut }));

      // 14. a chat that is not in front: its Viewer waits, a line says so, and it opens on going to that chat
      await inPage(() => { Desk.setView('made-up-w'); return true; });
      await until(async () => (await st()).scope === 'made-up-w', 3000, 100);
      const away = await call(sid, 'show_media', { files: ['red.png'] });
      const told = await inPage(() => { const t = document.getElementById('toast'); return { text: t && !t.hidden ? t.textContent : '', open: Viewer.isOpen() }; });
      await inPage(() => { Desk.setView('made-up-v'); return true; });
      const back = await until(async () => { const s = await st(); return s.open && s.scope === 'made-up-v' && s.media.length === 1 && s.media[0].w === 64 ? s : null; }, 4000, 100);
      check('a chat that is not in front: Claude Code is told so, a line says it has something to show, and its Viewer opens when the person goes to it',
        /This chat is not the one in front/.test(away.text) && /Made-up artist has something to show you/.test(told.text) && !told.open && Boolean(back), JSON.stringify({ away: away.text.slice(0, 160), told, back: Boolean(back) }));

      // 14b. two chats side by side: a show from the one the person is not in never opens beside the other, and the
      // Viewer follows the chat in front
      await inPage(() => { Desk.setTiles(2); Desk.setView('made-up-v'); Desk.setView('made-up-w'); return true; });
      const both = await until(() => inPage(() => { const on = [...document.querySelectorAll('.tile')].map((t) => t.dataset.id); return on.includes('made-up-v') && on.includes('made-up-w') ? on : null; }), 4000, 100);
      await until(async () => { const s = await st(); return !s.open && s.scope === 'made-up-w' ? s : null; }, 3000, 100);
      await exec('document.getElementById("toast").hidden = true');
      const aside = await call(sid, 'show_media', { files: ['grad.jpg'] });
      const toldAside = await inPage(() => { const t = document.getElementById('toast'); return { text: t && !t.hidden ? t.textContent : '', open: Viewer.isOpen(), scope: Viewer.state().scope }; });
      await inPage(() => { Desk.setView('made-up-v'); return true; });
      const inV = await until(async () => { const s = await st(); return s.open && s.scope === 'made-up-v' && s.media.length === 1 && s.media[0].w === 320 ? s : null; }, 4000, 100);
      await inPage(() => { Desk.setView('made-up-w'); return true; });
      const leftV = await until(async () => { const s = await st(); return !s.open && s.scope === 'made-up-w' ? s : null; }, 4000, 100);
      check('14b. Two chats side by side: a show from the one the person is not in stays out of the other\'s way (Claude Code is told, a line says so), opens when they go to its chat, and closes when they go back to the other',
        Boolean(both) && /This chat is not the one in front/.test(aside.text) && /Made-up artist has something to show you/.test(toldAside.text) && !toldAside.open && toldAside.scope === 'made-up-w'
        && Boolean(inV) && Boolean(leftV), JSON.stringify({ both, aside: aside.text.slice(0, 120), toldAside, inV: Boolean(inV), leftV: Boolean(leftV) }));
      await inPage(() => { Desk.setTiles(1); Desk.setView('made-up-v'); return true; });

      // 14c. a caller Lowlit cannot tell is refused: nothing is shown anywhere, rather than beside another chat
      const strangerInit = await post({ jsonrpc: '2.0', id: ++rpc, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'made-up-stranger', version: '0' } } });
      const stranger = strangerInit.sid;
      const homesBefore = await inPage(() => Viewer.state().opened.length);
      const refusedShow = await call(stranger, 'show_media', { files: [path.join(media, 'red.png')] });
      const homesAfter = await inPage(() => Viewer.state().opened.length);
      await post('', { method: 'DELETE', sid: stranger }).catch(() => {});
      check('14c. A chat Lowlit cannot tell is refused, with the reason, and nothing is shown for it anywhere',
        refusedShow.error && /could not tell which chat is asking/.test(refusedShow.text) && homesAfter === homesBefore, JSON.stringify({ refused: short(refusedShow), homesBefore, homesAfter }));

      // 14d. a picture the window shows as it is no longer waits for ffprobe (his word 6 Oct, "not optimized enough":
      // ffprobe took 64 to 208 ms a file on his laptop): ffprobe slowed by 2 s, a PNG is ready at once, an MP4 still waits
      const probeWas = v.probe;
      const timed = [];
      v.probe = (f) => wait(2000).then(() => probeWas.call(v, f));
      try {
        for (const f of ['unshown-1.png', 'clip.mp4']) {
          const t0 = Date.now();
          const it = await v.add(at(f), { cwd: '', home: 'made-up-probe', by: 'Made-up probe' }).catch(() => null);
          timed.push({ f, ms: Date.now() - t0, made: Boolean(it) });
          if (it) v.byToken.delete(it.token);
        }
      } finally {
        v.probe = probeWas;
        v.homes.delete('made-up-probe');
      }
      check('14d. A picture the window shows as it is no longer waits for ffprobe (slowed by 2 s: the PNG is ready at once, an MP4 still waits to be read)',
        timed.length === 2 && timed.every((t) => t.made) && timed[0].ms < 1000 && timed[1].ms >= 1900, JSON.stringify(timed));

      // 14e. the words a chat says with a file: a plain line of text under its name, without the card and its stripe (his
      // word 6 Oct: "I don't want to see that style anywhere")
      await call(sid, 'show_media', { files: ['red.png'], note: 'Flat words, no card.' });
      const inRed = await until(async () => { const s = await st(); return s.open && s.media.length === 1 && s.media[0].name === 'red.png' && s.media[0].w === 64 ? s : null; }, 4000, 100);
      const plainNote = await inPage(() => {
        const n = document.querySelector('#viewer .vw-note');
        const cs = getComputedStyle(n);
        const prev = document.querySelector('#viewer .vw-hint.prev');
        return { note: n.hidden ? '' : n.textContent, shadow: cs.boxShadow, back: cs.backgroundColor, line: cs.borderLeftWidth,
          buttons: !prev.hidden && !document.querySelector('#viewer .vw-hint.next').hidden && Number(getComputedStyle(prev).opacity) >= 0.5 };
      });
      check('14e. The words a chat says with what it shows are a plain line of text under the file\'s name: no card, no stripe',
        Boolean(inRed) && plainNote.note === 'Flat words, no card.' && plainNote.shadow === 'none' && plainNote.back === 'rgba(0, 0, 0, 0)' && plainNote.line === '0px', JSON.stringify(plainNote));

      // 14f. the pictures on either side of the one in front are loaded ahead: an arrow puts one on the stage at once, whole
      const ahead = await until(async () => { const s = await st(); return s.warm.length >= 1 && s.warm.every((w) => w.state === 'ok') ? s : null; }, 4000, 100) || await st();
      const atOnce = await inPage(() => {
        const card = document.querySelector('#viewer .vw-card');
        card.focus();
        card.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true }));
        const img = document.querySelector('#viewer .vw-stage img.vw-media');
        const s = Viewer.state();
        return { name: s.media.length ? s.media[0].name : '', whole: Boolean(img) && img.complete && img.naturalWidth === 320, count: s.count };
      });
      check('14f. The picture before the one in front was loaded ahead: the arrow puts it on the stage at once, already whole, and the count says where it stands',
        ahead.flip.which === 'shown' && ahead.count === '10 / 10' && atOnce.name === 'grad.jpg' && atOnce.whole && atOnce.count === '9 / 10',
        JSON.stringify({ flip: ahead.flip, count: ahead.count, warm: ahead.warm.map((w) => w.state), atOnce }));

      // 14g. the arrows go through every file this chat showed, a video on the way too; Shift and an arrow move inside it
      await key('ArrowLeft');
      const onVideo = await until(async () => { const s = await st(); return s.media.length === 1 && s.media[0].name === 'clip.mp4' && s.media[0].duration > 1 ? s : null; }, 4000, 100) || await st();
      await inPage(() => {
        const card = document.querySelector('#viewer .vw-card');
        card.focus();
        card.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', shiftKey: true, bubbles: true, cancelable: true }));
        return true;
      });
      const inside = await until(async () => { const s = await st(); return s.media.length === 1 && s.media[0].name === 'clip.mp4' && s.media[0].time > 1.5 ? s : null; }, 3000, 100) || await st();
      await key('ArrowLeft');
      const past = await until(async () => { const s = await st(); return s.media.length === 1 && s.media[0].name === 'made-up.exe' && s.media[0].w === 64 ? s : null; }, 4000, 100) || await st();
      const insideNow = inside.media[0] || {};
      check('14g. The arrows go through every file this chat showed, past a video too, Shift and an arrow moving inside the video; the buttons are there without the pointer over the stage',
        plainNote.buttons && onVideo.count === '8 / 10' && insideNow.name === 'clip.mp4' && insideNow.time > 1.5 && past.count === '7 / 10' && (past.media[0] || {}).name === 'made-up.exe',
        JSON.stringify({ buttons: plainNote.buttons, onVideo: onVideo.count, inside: { name: insideNow.name, time: insideNow.time }, past: { count: past.count, name: (past.media[0] || {}).name } }));

      // 14h. the folder of the file in front: a switch beside the strip; there the arrows go by name, through files no chat
      // showed (a TIFF copied first to be shown), and the list never holds a dot file, a file named as keys, one in a
      // folder below or one whose name says nothing
      for (let i = 0; i < 3; i++) await key('ArrowRight');
      const backRed = await until(async () => { const s = await st(); return s.media.length === 1 && s.media[0].name === 'red.png' ? s : null; }, 4000, 100);
      const hasSwitch = await until(() => inPage(() => document.querySelectorAll('#viewer .vw-list-btn').length === 2 || null), 4000, 100);
      if (hasSwitch) await inPage(() => { [...document.querySelectorAll('#viewer .vw-list-btn')].find((b) => b.textContent.startsWith('Folder')).click(); return true; });
      const inFolder = await until(async () => { const s = await st(); return s.flip.which === 'folder' && s.count === '7 / 10' ? s : null; }, 4000, 100) || await st();
      const switched = await inPage(() => [...document.querySelectorAll('#viewer .vw-list-btn')].map((b) => `${b.textContent}${b.classList.contains('on') ? ' (on)' : ''}`));
      const strip = await inPage(() => [...document.querySelectorAll('#viewer .vw-strip .vw-thumb')].map((b) => b.getAttribute('aria-label')));
      const walk = [];
      for (const want of ['tone.wav', 'unshown-1.png', 'unshown-2.tif']) {
        await key('ArrowRight');
        const s = await until(async () => { const x = await st(); return x.media.length === 1 && x.media[0].name === want && (x.media[0].tag === 'AUDIO' || x.media[0].w > 0) ? x : null; }, 15000, 100) || await st();
        // where its file comes from: the scheme and the one letter after it (o: the file itself, c: a copy made to be shown)
        walk.push({ name: (s.media[0] || {}).name || '', count: s.count, from: (((s.media[0] || {}).src || '').match(/^[a-z-]+:\/\/[a-z]\//) || [''])[0] });
      }
      const folderNames = ['clip.avi', 'clip.mp4', 'clip.webm', 'grad.jpg', 'logo.svg', 'photo.tiff', 'red.png', 'tone.wav', 'unshown-1.png', 'unshown-2.tif'];
      check('14h. Beside the strip, a switch between what this chat showed and the folder of the file in front; in the folder the arrows go by name, through files no chat showed (a TIFF copied first to be shown), never listing a dot file, a file named as keys, one in a folder below or one whose name says nothing',
        Boolean(backRed) && same(switched, ['Shown10', 'Folder10 (on)']) && inFolder.flip.which === 'folder' && inFolder.count === '7 / 10'
        && same(inFolder.flip.names, folderNames) && same(strip, folderNames) && walk[0].name === 'tone.wav' && walk[0].count === '8 / 10'
        && walk[1].name === 'unshown-1.png' && walk[1].from === 'lowlit-media://o/' && walk[2].name === 'unshown-2.tif' && walk[2].from === 'lowlit-media://c/' && walk[2].count === '10 / 10',
        JSON.stringify({ backRed: Boolean(backRed), switched, which: inFolder.flip.which, count: inFolder.count, names: inFolder.flip.names, strip, walk }));
      await shoot('viewer-6-folder');

      // 14i. the sound level (his ask 6 Oct: change the sound level of the videos, "saved across all the different
      // viewers"): a slider beside the speaker, the arrows and the wheel set one level for every chat's Viewer, kept; the
      // person raising it turns a silent video's sound on, a chat's level never does
      await call(sid, 'show_media', { files: ['clip.mp4'], play: false });
      await until(async () => { const s = await st(); return s.media.length === 1 && s.media[0].tag === 'VIDEO' && s.media[0].duration > 1 ? s : null; }, 6000, 100);
      const silentFirst = (await st()).media[0] || {};
      const slider = await inPage((k) => {
        const vol = document.querySelector('#viewer .vw-vol');
        const r = vol.getBoundingClientRect();
        const ev = (type) => vol.dispatchEvent(new PointerEvent(type, { bubbles: true, button: 0, pointerId: 7, clientX: r.left + r.width * k, clientY: r.top + r.height / 2 }));
        ev('pointerdown');
        ev('pointerup');
        return { shown: getComputedStyle(vol).display !== 'none', width: Math.round(r.width) };
      }, 0.3);
      const pressed = await st();
      const keptAt = await exec('localStorage.getItem("desk.view-volume")');
      await key('ArrowDown');
      const down = (await st()).volume;
      await key('ArrowUp');
      await key('ArrowUp');
      const up = (await st()).volume;
      await inPage(() => { document.querySelector('#viewer .vw-vol').dispatchEvent(new WheelEvent('wheel', { deltaY: -100, bubbles: true, cancelable: true })); return true; });
      const wheeled = await st();
      const drawnVol = await inPage(() => { const vol = document.querySelector('#viewer .vw-vol'); return { now: vol.getAttribute('aria-valuenow'), done: vol.querySelector('.vw-vol-done').style.transform }; });
      // another chat's Viewer: a video the person opens there plays at the same level
      await inPage(() => { Desk.setView('made-up-w'); return true; });
      await until(async () => (await st()).scope === 'made-up-w', 3000, 100);
      await inPage((f) => { Viewer.openPaths([f]); return true; }, at('clip.mp4'));
      const inW = await until(async () => { const s = await st(); return s.open && s.scope === 'made-up-w' && s.media.length === 1 && s.media[0].tag === 'VIDEO' && s.media[0].duration > 1 ? s : null; }, 6000, 100) || await st();
      // a chat's level is the same one level; it never turns on a sound the person left off
      const byChat = await call(sid, 'media_control', { action: 'volume', value: 0.8 });
      const chatSet = await st();
      await key('m');
      const off = await st();
      await call(sid, 'media_control', { action: 'volume', value: 0.6 });
      const stillOff = await st();
      const keptLast = await exec('localStorage.getItem("desk.view-volume")');
      const wMedia = (s) => s.media[0] || {};
      check('14i. A slider beside the speaker sets the sound level, as do the arrows up and down and the wheel; the level is one for every chat\'s Viewer and kept; the person raising it turns a silent video\'s sound on, a chat\'s level never does',
        silentFirst.muted === true && slider.shown && slider.width >= 40 && pressed.volume === 0.3 && Math.abs((pressed.media[0] || {}).volume - 0.3) < 0.001 && (pressed.media[0] || {}).muted === false
        && keptAt === '0.3' && down === 0.2 && up === 0.4 && wheeled.volume === 0.45 && drawnVol.now === '45' && drawnVol.done === 'scaleX(0.45)'
        && inW.scope === 'made-up-w' && Math.abs(wMedia(inW).volume - 0.45) < 0.001 && wMedia(inW).muted === false
        && !byChat.error && /sound level 80%/.test(byChat.text) && Math.abs(wMedia(chatSet).volume - 0.8) < 0.001
        && wMedia(off).muted === true && stillOff.volume === 0.6 && wMedia(stillOff).muted === true && keptLast === '0.6' && pressed.ui.volume === undefined,
        JSON.stringify({ silentFirst: silentFirst.muted, slider, pressed: { volume: pressed.volume, el: (pressed.media[0] || {}).volume, muted: (pressed.media[0] || {}).muted }, keptAt, down, up,
          wheeled: wheeled.volume, drawnVol, inW: { scope: inW.scope, volume: wMedia(inW).volume, muted: wMedia(inW).muted }, byChat: short(byChat),
          chatSet: wMedia(chatSet).volume, off: wMedia(off).muted, stillOff: { volume: stillOff.volume, muted: wMedia(stillOff).muted }, keptLast }));
      await key('Escape');
      await inPage(() => { Desk.setView('made-up-v'); return true; });

      // 15. the copies and small pictures are kept in the profile's own folder
      const kept = fs.readdirSync(v.dir);
      check('the copies and the small pictures are kept in the Viewer\'s own folder of the profile',
        kept.some((f) => f.endsWith('.video.mp4')) && kept.some((f) => f.endsWith('.image.png')) && kept.some((f) => f.endsWith('.thumb.jpg')) && !kept.some((f) => f.includes('.part.')), JSON.stringify(kept));
    } finally {
      browser.who(null);
      if (sid) await post('', { method: 'DELETE', sid }).catch(() => {});
      await exec('["made-up-v", "made-up-w", ""].forEach((k) => Viewer.toggleFor(k, false)); Promise.all(["made-up-v", ""].map((k) => Browser.toggleFor(k, false)))').catch(() => {});
      if (madeChats) {
        await inPage((tiles) => {
          const s = Desk.state;
          const made = (id) => id.startsWith('made-up-');
          s.chats = s.chats.filter((x) => !made(x.id));
          s.shown = s.shown.filter((id) => !made(id));
          s.recent = s.recent.filter((id) => !made(id));
          s.settings.tiles = tiles;
          Desk.setView('peek');
          return true;
        }, tilesWas).catch(() => {});
      }
      await view('peek');
    }
  };

  // ---- how fast the terminal is (his ask, 3 Oct: "make it so the TUI is never slow ever"): a key's echo through the
  // ---- keeper and the app, a burst of output, and the window redrawn for a new picture of 40 sessions. Made-up
  // ---- sessions only; the console is a plain PowerShell in the run's own folder. The window is hidden: frames are not
  // ---- drawn, so what is measured is the way there and the work on the page, not the drawing.
  const speedPhase = async () => {
    check('the window loads for the speed checks', Boolean(await until(() => exec('typeof Desk === "object" && Desk !== null && typeof Terms === "object"'), 15000)));
    watch.post({ type: 'pace', ms: 600000 });
    madeAt = Date.now();
    await installFakes();
    await exec(`takeSnapshot(${fake(madeAt, madeUpRows(false))})`);
    const made = await inPage((cwd) => desk.create({ cwd, starter: 'shell', title: 'Made-up speed', named: true }), dir);
    const id = made && made.id ? made.id : '';
    if (!check('a PowerShell chat starts for the measuring', Boolean(id), JSON.stringify(made && { id: made.id, error: made.error }))) return;
    await view(id);
    const ready = await until(async () => (await linesOf(id)).some((l) => /^PS .*>/.test(l.trim())), 15000, 150);
    check('its prompt shows', Boolean(ready));
    await wait(800);
    const stats = (list) => {
      const s = list.filter((x) => x >= 0).sort((a, b) => a - b);
      const at = (q) => (s.length ? s[Math.min(s.length - 1, Math.floor(q * s.length))] : -1);
      return { n: s.length, lost: list.length - s.length, median: Math.round(at(0.5) * 10) / 10, p90: Math.round(at(0.9) * 10) / 10, max: Math.round((s[s.length - 1] || -1) * 10) / 10 };
    };

    // 1. a key's echo: from the key leaving the page to its echo arriving back in the page
    const echoes = await inPage(async (chat) => {
      const was = Terms.write;
      let waiting = null;
      Terms.write = function write(i, data, seq) {
        if (waiting && i === chat && data.includes(waiting.ch)) { const w = waiting; waiting = null; w.done(performance.now() - w.at); }
        return was.call(this, i, data, seq);
      };
      const one = (ch) => new Promise((done) => {
        waiting = { ch, at: performance.now(), done };
        desk.input(chat, ch);
        setTimeout(() => { if (waiting && waiting.ch === ch) { waiting = null; done(-1); } }, 3000);
      });
      const out = [];
      try {
        for (let i = 0; i < 40; i++) {
          out.push(await one(String.fromCharCode(97 + (i % 26))));
          await new Promise((r) => setTimeout(r, 40));
        }
      } finally {
        Terms.write = was;
        desk.input(chat, '\x1b');
      }
      return out;
    }, id);
    const echo = stats(echoes.slice(1));
    const slowest = echoes.indexOf(Math.max(...echoes));
    say(`      the first key after the prompt, left out below: ${Math.round(echoes[0])} ms`);
    say(`      a key's echo, through the keeper and the app, ${echo.n} keys: median ${echo.median} ms, 9 in 10 within ${echo.p90} ms, slowest ${echo.max} ms (key ${slowest + 1} of ${echoes.length})${echo.lost ? `, ${echo.lost} never came back` : ''}`);
    check('a key typed in a chat comes back on its screen in a few milliseconds: half within 8 ms, every one after the first within 60 ms', echo.n >= 36 && echo.median <= 8 && echo.max <= 60, JSON.stringify(echo));
    notes.speed = { echo };

    // 1b. keys pressed as a keyboard presses them: the typing meter times each, from the key to its echo in the
    // terminal (a hidden window draws no frames: in the person's window it is to the frame that shows it)
    await wait(400);
    const metered = await inPage(pageTypeKeys, id, 'abcdefghij', 150);
    const typedLine = (await linesOf(id)).some((l) => /^PS .*>\s*abcdefghij/.test(l.trim()));
    await exec(`desk.input(${JSON.stringify(id)}, '\\x1b')`);
    const meter = stats(metered || []);
    say(`      the typing meter, 10 keys pressed as a keyboard does, 150 ms apart: ${meter.n} timed, median ${meter.median} ms, slowest ${meter.max} ms`);
    check('keys pressed as a keyboard presses them reach the console, and the typing meter times them: at least 8 of 10, half within 15 ms',
      typedLine && meter.n >= 8 && meter.median >= 0 && meter.median <= 15, JSON.stringify({ typedLine, ...meter }));
    notes.speed.meter = meter;

    // 1c. the same echo while another chat prints without pause (20 lines every 15 ms or so, for about six seconds):
    // what the chat typed into prints is sent on at once, never held in line behind the other's output
    await wait(400);
    const nb = await inPage((cwd) => desk.create({ cwd, starter: 'shell', title: 'Made-up neighbour', named: true }), dir);
    const nbId = nb && nb.id ? nb.id : '';
    if (check('a second PowerShell chat starts beside it', Boolean(nbId), JSON.stringify(nb && { error: nb.error }))) {
      await until(async () => (await linesOf(nbId)).some((l) => /^PS .*>/.test(l.trim())), 15000, 150);
      await exec(`desk.input(${JSON.stringify(nbId)}, ${JSON.stringify("1..400 | % { 1..20 | % { 'made-up noise ' + ('y' * 80) }; Start-Sleep -Milliseconds 2 }\r")})`);
      const beside = await inPage(pageEchoBeside, id, nbId, 30);
      await exec(`desk.input(${JSON.stringify(nbId)}, '\\x03')`);
      const noisy = stats(beside.echoes.slice(1));
      say(`      a key's echo while the other chat printed ${Math.round(beside.during.bytes / 1024)} kB in ${beside.during.ms} ms, ${noisy.n} keys: median ${noisy.median} ms, 9 in 10 within ${noisy.p90} ms, slowest ${noisy.max} ms${noisy.lost ? `, ${noisy.lost} lost` : ''}`);
      check('while another chat prints without pause, a key typed in a chat still comes back in a few milliseconds: half within 10 ms, 9 in 10 within 30 ms',
        beside.flowing && beside.during.bytes > 20000 && noisy.n >= 27 && noisy.median <= 10 && noisy.p90 <= 30, JSON.stringify({ flowing: beside.flowing, during: beside.during, ...noisy }));
      notes.speed.beside = { ...noisy, kB: Math.round(beside.during.bytes / 1024) };
      // the measurements after this one are made with one chat open, as before
      await until(async () => (await linesOf(nbId)).some((l) => /^PS .*>/.test(l.trim())), 10000, 200);
      check('the other chat closes', await closeAndWait(nbId));
      await view(id);
    }

    // 1d. while keys come in, a redraw of the window asked for by new data waits until a quarter of a second after the
    // last key; one the person asks for (a click, a key of the window) is drawn at once
    await wait(400);
    const hold = await inPage(async (chat) => {
      const t = Terms.get(chat);
      let renders = 0;
      const was = Side.render;
      Side.render = function render(...a) { renders++; return was.apply(this, a); };
      const press = (ch) => {
        const ev = new KeyboardEvent('keydown', { key: ch, code: `Key${ch.toUpperCase()}`, bubbles: true, cancelable: true });
        const code = ch.toUpperCase().charCodeAt(0);
        Object.defineProperty(ev, 'keyCode', { get: () => code });
        t.term.textarea.dispatchEvent(ev);
      };
      try {
        press('q');
        paintData();
        const held = renders === 0 && dirty === true;
        await new Promise((r) => setTimeout(r, 450));
        const later = renders;
        press('w');
        renders = 0;
        paint();
        return { held, later, direct: renders };
      } finally {
        Side.render = was;
        desk.input(chat, '\x1b');
      }
    }, id);
    check('while keys come in, a redraw asked for by new data waits until a quarter of a second after the last key, and one asked for by the person is drawn at once',
      hold.held && hold.later >= 1 && hold.direct === 1, JSON.stringify(hold));

    // 2. a burst of output: about 1.6 MB printed at once; how long it takes to arrive, and how long the page is held up
    await wait(400);
    const burst = await inPage(async (chat) => {
      const blocks = [];
      let obs = null;
      try { obs = new PerformanceObserver((list) => { for (const e of list.getEntries()) blocks.push(e.duration); }); obs.observe({ entryTypes: ['longtask'] }); } catch { obs = null; }
      const was = Terms.write;
      let bytes = 0;
      let pieces = 0;
      let done = null;
      const t0 = performance.now();
      Terms.write = function write(i, data, seq) {
        if (i === chat) { bytes += data.length; pieces++; if (done && data.includes('made-up end mark')) { const d = done; done = null; d(performance.now() - t0); } }
        return was.call(this, i, data, seq);
      };
      const took = await new Promise((resolve) => {
        done = resolve;
        desk.input(chat, "1..20000 | % { 'made-up line ' + $_ + ' ' + ('x' * 60) }; 'made-up end' + ' mark'\r");
        setTimeout(() => { if (done) { done = null; resolve(-1); } }, 60000);
      });
      Terms.write = was;
      await new Promise((r) => setTimeout(r, 300));
      if (obs) obs.disconnect();
      return { took: Math.round(took), bytes, pieces, blocks: blocks.length, longest: Math.round(Math.max(0, ...blocks)), held: Math.round(blocks.reduce((a, b) => a + b, 0)) };
    }, id);
    say(`      a burst of output: ${Math.round(burst.bytes / 1024)} KB in ${burst.pieces} pieces arrived in ${burst.took} ms; the page was held up ${burst.blocks} times over 50 ms, ${burst.held} ms in all, the longest ${burst.longest} ms`);
    check('a burst of 1.6 MB of output arrives within 15 s and never holds the page up for more than 250 ms at a time', burst.took > 0 && burst.took <= 15000 && burst.longest <= 250, JSON.stringify(burst));
    notes.speed.burst = burst;

    // 3. the window redrawn for a new picture of the machine: 40 sessions, 40 times; first with every figure moving
    // (the worst), then with five of them at work (as a day goes); a profile of the page says where the time goes
    const redraws = (moving) => inPage((n) => {
      const base = Desk.state.snap;
      const live = base.chats.filter((c) => c.pid && c.kind !== 'bg' && !c.chat);
      const extra = Array.from({ length: Math.max(0, 40 - base.chats.length) }, (_, i) => ({ ...live[i % live.length], key: `made-up-extra-${i}`, session: `made-up-extra-${i}`,
        title: `Made-up extra ${i}`, name: `Made-up extra ${i}`, pid: 960000 + i }));
      const many = { ...base, chats: [...base.chats, ...extra] };
      const parts = {};
      const undo = [];
      const timed = (name, obj, fn) => {
        const was = obj[fn];
        obj[fn] = function timedPart(...a) { const t = performance.now(); try { return was.apply(this, a); } finally { parts[name] = (parts[name] || 0) + performance.now() - t; } };
        undo.push(() => { obj[fn] = was; });
      };
      for (const [name, obj, fn] of [['list', Side, 'render'], ['strips', ChatView, 'render'], ['glance', Glance, 'update'], ['nest', Nest, 'render'], ['morning', Morning, 'render'],
        ['browser', Browser, 'follow'], ['bar', window, 'drawBar'], ['crumb', window, 'drawCrumb'], ['notes', window, 'drawNotes'], ['paint', window, 'paint']]) timed(name, obj, fn);
      const times = [];
      try {
        for (let i = 0; i < 40; i++) {
          const snap = { ...many, at: many.at + i + 1, chats: many.chats.map((c, j) => (j < n ? { ...c, live: { ...(c.live || {}), usd: ((c.live && c.live.usd) || 1) + i * 0.01 },
            tokens: { ...(c.tokens || {}), out: ((c.tokens && c.tokens.out) || 1000) + i * 37 } } : c)) };
          const t0 = performance.now();
          takeSnapshot(snap);
          times.push(performance.now() - t0);
        }
      } finally {
        for (const u of undo) u();
      }
      const rows = document.querySelectorAll('#chat-list .nav-item.chat').length;
      takeSnapshot(base);
      return { rows, times, parts: Object.fromEntries(Object.entries(parts).map(([k, v]) => [k, Math.round((v / 40) * 10) / 10])) };
    }, moving);
    const dbg = win.webContents.debugger;
    let profile = null;
    let paints = null;
    let few = null;
    try {
      dbg.attach('1.3');
      await dbg.sendCommand('Profiler.enable');
      await dbg.sendCommand('Profiler.setSamplingInterval', { interval: 100 });
      await dbg.sendCommand('Profiler.start');
      paints = await redraws(1000);
      profile = (await dbg.sendCommand('Profiler.stop')).profile;
      few = await redraws(5);
    } finally {
      try { dbg.detach(); } catch { /* not attached */ }
    }
    const paint = stats(paints.times);
    const paintFew = stats(few.times);
    say(`      the window redrawn for a new picture of ${paints.rows} sessions, every figure moving: median ${paint.median} ms, slowest ${paint.max} ms; each part, on average: ${JSON.stringify(paints.parts)}`);
    say(`      the same with five sessions at work: median ${paintFew.median} ms, slowest ${paintFew.max} ms; each part, on average: ${JSON.stringify(few.parts)}`);
    if (profile) {
      const nodes = new Map(profile.nodes.map((nd) => [nd.id, nd]));
      const self = new Map();
      profile.samples.forEach((id, i) => {
        const f = nodes.get(id).callFrame;
        const name = `${f.functionName || '(anonymous)'} ${String(f.url || '').split('/').pop()}:${f.lineNumber + 1}`;
        self.set(name, (self.get(name) || 0) + (profile.timeDeltas[i] || 0) / 1000);
      });
      const top = [...self].filter(([name]) => !/^\((idle|program)\)/.test(name)).sort((a, b) => b[1] - a[1]).slice(0, 14);
      say(`      where the 40 redraws spent their time, by function (ms in all): ${top.map(([name, ms]) => `${name} ${Math.round(ms)}`).join('; ')}`);
    }
    check('a new picture of 40 sessions is drawn in a fraction of a frame: half within 8 ms, every one within 40 ms, with every figure moving', paints.rows >= 40 && paint.median <= 8 && paint.max <= 40, JSON.stringify({ rows: paints.rows, ...paint }));
    check('with five of them at work, half within 4 ms', paintFew.median <= 4, JSON.stringify(paintFew));
    notes.speed.paint = { all: paint, five: paintFew };

    // 4. the terminal on screen draws with the graphics chip. Let go of, its context is freed at once (the page holds
    // 16 and takes the oldest away past that); lost, the terminal draws again with a new one a moment later
    const gl = await inPage((chat) => { const t = Terms.get(chat); return t ? { gl: Boolean(t.gl), renderer: Desk.state.info.renderer } : null; }, id);
    say(`      the terminal on screen draws with ${gl && gl.gl ? 'the graphics chip (WebGL)' : `the page's own text (${gl && gl.renderer})`}`);
    const logText = () => { try { return fs.readFileSync(path.join(app.getPath('userData'), 'desk.log'), 'utf8'); } catch { return ''; } };
    if (gl && gl.gl) {
      const freed = await inPage((chat) => {
        const entry = Terms.get(chat);
        const ctx = entry.gl._renderer && entry.gl._renderer._gl;
        const was = Boolean(ctx) && !ctx.isContextLost();
        Terms.show([], '');
        return { had: was, lost: Boolean(ctx) && ctx.isContextLost(), dropped: !entry.gl };
      }, id);
      await view('peek');
      await view(id);
      const back = await until(() => inPage((chat) => Boolean(Terms.get(chat).gl), id), 3000, 100);
      check('a terminal taken off the screen frees its graphics context at once, and gets a new one back on it', freed.had && freed.lost && freed.dropped && Boolean(back),
        JSON.stringify({ ...freed, back }));
      const logBefore = logText().length;
      await inPage((chat) => {
        const gl = Terms.get(chat).gl;
        const ctx = gl && gl._renderer && gl._renderer._gl;
        const lose = ctx && ctx.getExtension('WEBGL_lose_context');
        if (lose) lose.loseContext();
        return Boolean(lose);
      }, id);
      const fell = await until(() => inPage((chat) => !Terms.get(chat).gl, id), 6000, 100);
      const again = await until(() => inPage((chat) => (Terms.get(chat).gl ? Terms.get(chat).glLost : 0), id), 6000, 100);
      const noted = logText().slice(logBefore);
      check('a terminal whose graphics context is lost carries on in the page\'s own text, gets a new context a second later, and the app\'s log says so',
        Boolean(fell) && again === 1 && /slow: a terminal lost its graphics context \(1 time\)/.test(noted), JSON.stringify({ fell, again, noted: noted.trim().slice(-200) }));
    }
    const slowBefore = logText().length;
    await inPage(() => { desk.slow('made-up slow moment for the test'); return true; });
    const slowNoted = await until(() => logText().slice(slowBefore).includes('slow: made-up slow moment for the test'), 3000, 100);
    check('a slow moment the window notices goes into the app\'s log', Boolean(slowNoted));
    await view('peek');
  };

  // ---- the keeper (keeper.cjs): a chat runs on through a restart of the app. Two runs on one profile: 'keep' opens a
  // ---- console, marks it and restarts the app the way its button does; 'kept' is the next start, and finds it running.
  const KEEP_MARK = 'made-up keeper mark';
  const KEEP_NAME = 'Made-up kept chat';
  const keepNote = () => path.join(app.getPath('userData'), 'keeper-test.json');
  const marked = async (id, word) => (await linesOf(id)).some((l) => l.trim() === `${KEEP_MARK} ${word}`);
  // the words are joined by PowerShell, so the line typed is not itself the line looked for
  const mark = (id, word) => exec(`desk.input(${JSON.stringify(id)}, ${JSON.stringify(`Write-Output ('${KEEP_MARK}' + ' ${word}')\r`)})`);

  const keepPhase = async () => {
    const net = require('node:net');
    const { pipeOf } = require('./keeper.cjs');
    check('the window loads', Boolean(await until(() => exec('typeof Desk === "object" && Desk !== null'), 15000)));
    const k = keeper.get();
    const on = await until(() => Boolean(k && k.connected()), 10000, 100);
    check('the consoles are held by a keeper: a program apart from the app, reached on a pipe named after this profile only',
      Boolean(on) && k.pid > 0 && k.pid !== process.pid && alive(k.pid) && k.pipe === pipeOf(app.getPath('userData')), on ? '' : 'no keeper answered');
    // a program without the key: turned away, told nothing, and the app's own link to the keeper is untouched
    const told = await new Promise((done) => {
      const s = net.connect(k.pipe);
      let got = '';
      s.setEncoding('utf8');
      s.on('connect', () => s.write(`${JSON.stringify({ t: 'hello', v: 1, key: 'f'.repeat(64) })}\n`));
      s.on('data', (d) => { got += d; });
      s.on('error', () => { /* its close follows */ });
      s.on('close', () => done(got));
      setTimeout(() => { s.destroy(); done('still open after 4 s'); }, 4000);
    });
    check('a program without the key is turned away by the keeper and told nothing', told === '' && k.connected(), told ? `it was told ${told.length} characters` : '');

    const a = await inPage(pageNew, { ...plain, restore: true });
    const ready = Boolean(a && a.id) && Boolean(await until(promptBack, 30000));
    const held = ready ? chats.all.get(a.id) : null;
    if (!check('a console opens in it, and PowerShell runs there', ready && Boolean(held) && typeof held.term.remember === 'function' && held.pid > 0 && alive(held.pid))) throw new Error('no console');
    await mark(a.id, 'one');
    const one = await until(() => marked(a.id, 'one'), 10000);
    await exec(`desk.rename(${JSON.stringify(a.id)}, ${JSON.stringify(KEEP_NAME)})`);
    const written = await until(() => { const o = settingsNow().open; return o.length === 1 && o[0].id === a.id && o[0].title === KEEP_NAME; }, 5000, 150);
    check('what it prints shows, and the list on disk names its console, to be taken up again rather than opened a second time', Boolean(one) && Boolean(written));
    fs.writeFileSync(keepNote(), JSON.stringify({ id: a.id, pid: held.pid, keeper: k.pid }));
    say('      restarting the app as its "New version: restart" button does (a test run is not opened again: the next run is its next start)');
    finish();
    await keeper.restart();
    await wait(20000);
    fs.appendFileSync(path.join(dir, 'report.txt'), 'FAIL  the app was still running 20 s after the restart\n');
    app.exit(1);
  };

  const keptPhase = async () => {
    check('the window loads', Boolean(await until(() => exec('typeof Desk === "object" && Desk !== null'), 15000)));
    let was = null;
    try { was = JSON.parse(fs.readFileSync(keepNote(), 'utf8')); } catch { /* the run before did not get that far */ }
    if (!check('the run before left a chat running in the keeper', Boolean(was && was.id && was.pid))) throw new Error('nothing was kept');
    await keeper.ready();
    const k = keeper.get();
    const list = chats.list();
    const chat = list.find((c) => c.id === was.id);
    const side = await until(async () => { const s = await sideNow(); return s.length === 1 ? s : null; }, 8000, 150);
    check('the chat is back after the restart and still running: the same console (the same program, not a new one) in the same keeper, under its name, and not opened a second time',
      Boolean(chat) && chat.pid === was.pid && alive(was.pid) && k.pid === was.keeper && chat.title === KEEP_NAME && chat.named && list.length === 1 && Boolean(side),
      chat ? `${list.length} chat(s); the same program: ${chat.pid === was.pid}; the same keeper: ${k.pid === was.keeper}; named "${chat.title}"` : 'it is not there');
    const shown = await until(() => marked(was.id, 'one'), 10000);
    check('its terminal shows what it printed before the restart', Boolean(shown));
    const said = await until(async () => { const t = await exec('document.getElementById("toast").textContent'); return t === 'Lowlit restarted. Your chat kept running.' ? t : ''; }, 8000, 150);
    const front = await until(async () => (await exec('Desk.state.view')) === was.id, 5000, 150);
    check('the window says so, and the chat is in front again, where it was', Boolean(said) && Boolean(front), `"${await exec('document.getElementById("toast").textContent')}"`);
    // no picture: this run's list of chats is the person's own, not a made-up one
    await mark(was.id, 'two');
    check('it goes on taking what is typed', Boolean(await until(() => marked(was.id, 'two'), 10000)));
    await chats.close(was.id);
    const closed = await until(() => !chats.all.has(was.id) && !alive(was.pid), 10000, 100);
    check('closed, its console ends', Boolean(closed));
    // the app going, with no chat open: the keeper ends by itself
    const pid = k.pid;
    await k.leave();
    check('with no chat left and no app, the keeper ends by itself', Boolean(await until(() => !alive(pid), 5000, 100)));
  };

  // ---- a chat's project and branch: the button on its strip, its menu, a switch to another branch, and the asks ----
  const gitPhase = async () => {
    check('the window loads', Boolean(await until(() => exec('typeof Desk === "object" && Desk !== null'), 15000)));
    const repo = path.join(dir, 'made-up-repo');
    const copyDir = path.join(dir, 'made-up-copy');
    const LOGIN = 'made-up-token-4f2a';
    const git = (...args) => {
      const r = spawnSync('git', args, { cwd: repo, encoding: 'utf8', windowsHide: true, timeout: 20000, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } });
      return r.status === 0 ? r.stdout.trim() : null;
    };
    fs.mkdirSync(repo, { recursive: true });
    const made = [git('init', '-q', '-b', 'main'), git('config', 'user.name', 'Made-up Tester'), git('config', 'user.email', 'tester@example.com'),
      git('config', 'commit.gpgsign', 'false'), git('config', 'core.hooksPath', 'no-hooks')];
    fs.writeFileSync(path.join(repo, 'notes.txt'), 'made-up notes\n');
    made.push(git('add', '-A'), git('commit', '-q', '-m', 'first'), git('switch', '-q', '-c', 'made-up-feature'));
    fs.writeFileSync(path.join(repo, 'feature.txt'), 'made-up feature\n');
    made.push(git('add', '-A'), git('commit', '-q', '-m', 'feature'), git('switch', '-q', 'main'),
      git('remote', 'add', 'origin', `https://made-up-user:${LOGIN}@github.com/made-up-owner/made-up-repo.git`), git('worktree', 'add', '-q', '-b', 'made-up-elsewhere', copyDir));
    if (!check('a made-up git project is made: two branches, a remote whose address holds a login, and a second copy on a third branch', made.every((x) => x !== null))) throw new Error('no project');

    const a = await inPage(pageNew, { cwd: repo, starter: 'shell' });
    if (!check('a chat opens in the made-up project', Boolean(a && a.id) && Boolean(await until(promptBack, 30000)))) throw new Error('no chat');
    await exec(`desk.rename(${JSON.stringify(a.id)}, 'Made-up git chat')`);
    const chipOf = (id) => inPage((chat) => {
      const b = document.querySelector(`#tiles .tile[data-id="${chat}"] .th-repo`);
      const text = (sel) => (b.querySelector(sel) || {}).textContent || '';
      return b ? { name: text('.rp-name'), branch: text('.rp-branch'), copy: Boolean(b.querySelector('.rp-copy')), label: b.getAttribute('aria-label') || '',
        crumb: Boolean(document.querySelector('#crumb .cb-branch')) } : null;
    }, id);
    const chip = await until(async () => { const c = await chipOf(a.id); return c && c.branch === 'main' && c.name ? c : null; }, 20000, 300);
    const leak = (await exec(`document.documentElement.outerHTML.includes(${JSON.stringify(LOGIN)})`)) || JSON.stringify(watch.latest()).includes(LOGIN);
    check('its strip shows the project, by the name its host knows it by, and the branch, in one button; the title bar no longer repeats the branch; the login in the address is nowhere',
      Boolean(chip) && chip.name === 'made-up-repo' && chip.branch === 'main' && !chip.copy && chip.label === 'made-up-owner/made-up-repo, branch main' && !chip.crumb && !leak,
      chip ? `"${chip.name}" on "${chip.branch}"; in the title bar too: ${chip.crumb}; login seen: ${leak}` : 'no button');

    const openMenu = async (id) => {
      await inPage(pageKey, 'Escape');
      await press(`${tileOf(id)} .th-repo`);
      // a copy with nothing to commit or push (a fresh clone) offers nothing to click: its menu holds words only
      return until(async () => { const m = await inPage(pageMenu); return m && (m.items.length || m.notes.length) ? m : null; }, 10000, 100);
    };
    const m1 = await openMenu(a.id);
    const labels = (m) => (m ? m.items.map((i) => `${i.label}${i.ticked ? '*' : ''}`) : []);
    check('a click on it opens how the copy stands and its branches, the one it is on ticked, one open in another copy marked so',
      Boolean(m1) && m1.heads[0] === 'made-up-owner/made-up-repo' && m1.notes[0] === 'Nothing to commit · this branch was never pushed'
      && same(labels(m1).filter((l) => !l.startsWith('Ask')).sort(), ['made-up-elsewhere · open in another copy', 'made-up-feature', 'main*'])
      && labels(m1).includes('Ask it to push') && m1.notes.includes('Start Claude Code in this chat to ask it.'),
      JSON.stringify(m1 && { heads: m1.heads, notes: m1.notes, items: labels(m1) }));
    // a picture of the made-up project only: its chat's strip and the menu under it, never the list of chats beside it
    const area = await inPage((chat) => {
      const tile = document.querySelector(`#tiles .tile[data-id="${chat}"]`).getBoundingClientRect();
      const menu = document.getElementById('menu').getBoundingClientRect();
      return { x: Math.floor(tile.left), y: Math.floor(tile.top), width: Math.ceil(Math.min(Math.max(tile.right, menu.right + 12) - tile.left, 900)), height: Math.ceil(menu.bottom - tile.top + 14) };
    }, a.id);
    await drawn();
    await win.webContents.capturePage(area);
    await wait(150);
    fs.writeFileSync(path.join(dir, 'git-menu.png'), (await win.webContents.capturePage(area)).toPNG());

    await inPage(pageMenuRun, 'made-up-feature');
    const switched = await until(async () => git('branch', '--show-current') === 'made-up-feature' && (await toastNow()).includes('made-up-repo is on made-up-feature now.'), 10000, 150);
    const followed = await until(async () => { const c = await chipOf(a.id); return c && c.branch === 'made-up-feature' ? c : null; }, 15000, 300);
    check('a click on another branch puts the copy on it and says so, and the button follows', Boolean(switched) && Boolean(followed),
      `git: ${git('branch', '--show-current')}; the button: ${followed ? followed.branch : 'not changed'}`);

    fs.appendFileSync(path.join(repo, 'notes.txt'), 'a change not committed\n');
    const m2 = await openMenu(a.id);
    await inPage(pageMenuRun, 'main');
    const refused = await until(async () => (await toastNow()).includes('1 file has changes not committed. Commit them first, then switch.'), 8000, 150);
    check('with a file changed and not committed, a switch is refused and says why, and the menu offers to ask for a commit',
      Boolean(refused) && git('branch', '--show-current') === 'made-up-feature' && Boolean(m2) && m2.notes[0] === '1 file changed · this branch was never pushed'
      && labels(m2).includes('Ask it to commit') && labels(m2).includes('Ask it to commit and push') && !labels(m2).includes('Ask it to push'),
      `"${await toastNow()}"; ${JSON.stringify(m2 && m2.notes)}`);
    git('checkout', '--', 'notes.txt');

    await openMenu(a.id);
    await inPage(pageMenuRun, 'made-up-elsewhere · open in another copy');
    const elsewhere = await until(async () => (await toastNow()).startsWith('made-up-elsewhere is open in another copy of the project ('), 6000, 150);
    check('a branch open in another copy is not switched to: the window says where it is open', Boolean(elsewhere) && git('branch', '--show-current') === 'made-up-feature');

    // a session at work in the folder, as the watcher would report one: its files must not change under it
    watch.latest().chats.push(row({ key: '00000000-0000-4000-8000-0000000000c2', cwd: repo, state: 'working', title: 'Made-up busy chat' }));
    const busy = await exec(`desk.gitSwitch(${JSON.stringify(a.id)}, 'main')`);
    const latestNow = watch.latest();
    latestNow.chats = latestNow.chats.filter((c) => c.key !== '00000000-0000-4000-8000-0000000000c2');
    check('while a chat is at work in that folder, a switch is refused, by its name', Boolean(busy) && busy.error === 'Made-up busy chat is at work in this folder. Switch once it has finished.'
      && git('branch', '--show-current') === 'made-up-feature', JSON.stringify(busy));

    // the folder Lowlit runs from: asked with a branch that does not exist, so nothing could be switched even if the guard failed
    const own = await inPage(pageNew, plain);
    await until(promptBack, 30000);
    await until(async () => Boolean(await chipOf(own.id)), 20000, 300);
    const ownAnswer = await exec(`desk.gitSwitch(${JSON.stringify(own.id)}, 'made-up-no-such-branch')`);
    const ownMenu = await openMenu(own.id);
    await inPage(pageKey, 'Escape');
    check("in the folder Lowlit runs from, the branch is never switched from the window: refused, and its menu says so and offers no branch",
      Boolean(ownAnswer) && String(ownAnswer.error).startsWith('Lowlit runs from this folder') && Boolean(ownMenu)
      && ownMenu.notes.includes('Lowlit runs from this folder, so its branch is switched with Lowlit closed.') && !ownMenu.items.some((i) => !i.label.startsWith('Ask')),
      JSON.stringify(ownAnswer));
    await closeAndWait(own.id);

    // the asks: the chat is given a made-up Claude Code session, idle, and its console prints a prompt the way Claude Code draws one
    await view(a.id);
    fs.appendFileSync(path.join(repo, 'notes.txt'), 'a change to commit\n');
    const session = row({ key: '00000000-0000-4000-8000-0000000000c1', chat: a.id, cwd: repo, title: 'Made-up git chat', state: 'idle' });
    await exec(`Desk.state.frozen = true; Desk.state.snap = { ...Desk.state.snap, chats: [...Desk.state.snap.chats, ${JSON.stringify(session)}] }; Desk.paint()`);
    const prompt = (extra) => `cls; Write-Host ([string][char]0x2500 * 24); Write-Host -NoNewline ([string][char]0x276F + ' ')${extra}; $null = Read-Host\r`;
    await type(prompt(''));
    const ready = await until(() => exec(`Desk.canAsk(${JSON.stringify(a.id)})`), 8000, 150);
    const typed = [];
    const inputWas = chats.input;
    try {
      chats.input = function (id, text, ...rest) { if (id === a.id) { typed.push(text); return undefined; } return inputWas.call(this, id, text, ...rest); };
      const m3 = await openMenu(a.id);
      await inPage(pageMenuRun, 'Ask it to commit');
      await until(async () => typed.length >= 2, 3000, 50);
      const asked = await toastNow();
      check('at its empty prompt the chat is asked to commit: the words, then Enter apart, and the window says what it asked',
        Boolean(ready) && Boolean(m3) && !m3.notes.some((n) => n.startsWith('It can be asked')) && same(typed, ['Commit the changes with a clear message.', '\r'])
        && asked === 'Asked Made-up git chat: "Commit the changes with a clear message."', `${JSON.stringify(typed)}; "${asked}"`);
    } finally { chats.input = inputWas; }

    // words left in the box: nothing is typed over them, Compact now included
    await type('half a message');
    const draft = await until(async () => !(await exec(`Desk.canAsk(${JSON.stringify(a.id)})`)), 6000, 150);
    typed.length = 0;
    try {
      chats.input = function (id, text, ...rest) { if (id === a.id) { typed.push(text); return undefined; } return inputWas.call(this, id, text, ...rest); };
      const m4 = await openMenu(a.id);
      await inPage(pageMenuRun, 'Ask it to commit and push');
      await wait(400);
      const refusedAsk = await toastNow();
      await inPage(pageKey, 'Escape');
      await inPage(pageRightClick, `#chat-list .nav-item.chat[data-id="${a.id}"]`);
      const rowMenu = await inPage(pageMenu);
      await inPage(pageKey, 'Escape');
      check('with words left in its prompt box the chat is not typed into: the menu says when it can be asked, the ask is refused, and Compact now is not offered either',
        Boolean(draft) && Boolean(m4) && m4.notes.includes('It can be asked once it waits at an empty prompt.') && typed.length === 0
        && refusedAsk.startsWith('A chat can be asked once its screen shows its prompt, empty') && Boolean(rowMenu) && !rowMenu.items.some((i) => i.label === 'Compact now'),
        `typed ${typed.length}; "${refusedAsk}"; its row's menu: ${JSON.stringify(rowMenu && rowMenu.items.map((i) => i.label))}`);
    } finally { chats.input = inputWas; }
    await type('\r');
    await until(promptBack, 8000);

    // a suggestion drawn faint or grey in an empty box is not the person's words
    await type(prompt(" ; Write-Host -NoNewline \"$([char]27)[2mfaint suggestion$([char]27)[0m $([char]27)[90mgrey suggestion$([char]27)[0m\""));
    const suggested = await until(async () => (await screen()).some((l) => l.includes('grey suggestion')), 8000, 150);
    const fine = suggested && await until(() => exec(`Desk.canAsk(${JSON.stringify(a.id)})`), 4000, 150);
    check('a suggestion drawn faint or grey in the empty box does not count as words typed', Boolean(fine), suggested ? '' : 'the suggestion did not show');
    await type('\r');
    await until(promptBack, 8000);
    await exec('Desk.state.frozen = false');
    await closeAndWait(a.id);
    git('worktree', 'remove', '--force', copyDir);
  };

  // ---- Gaming mode (his ask, 5 Oct): one close that ends every chat and every dev server, and a next start that brings
  // ---- them back. Two plain consoles stand for the chats. The three servers are the run's own (one pinned and started
  // ---- here, one started with its folder's script, one with a plain node command), and it ends only those.
  const gamingPhase = async () => {
    check('the window loads for the Gaming mode checks', Boolean(await until(() => exec('typeof Desk === "object" && Desk !== null && typeof Servers === "object"'), 15000)));
    watch.post({ type: 'pace', ms: 600000 });
    win.setContentSize(1440, 900);
    madeAt = Date.now();
    await installFakes();
    await showUsage('today');
    const root = dir;
    const made = [];
    const pressOn = (selector, label) => inPage((s, l) => { const b = [...document.querySelectorAll(s)].find((x) => x.textContent === l); if (b) b.click(); return Boolean(b); }, selector, label);
    const net = require('node:net');
    const { spawn } = require('node:child_process');
    const freePort = () => new Promise((resolve) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); });
    const listening = (port) => new Promise((resolve) => {
      const c = net.connect({ port, host: '127.0.0.1' });
      const done = (v) => { c.destroy(); resolve(v); };
      c.once('connect', () => done(true));
      c.once('error', () => done(false));
      setTimeout(() => done(false), 1500);
    });
    const ended = (c) => c.exitCode !== null || c.signalCode !== null;
    const srvPinned = path.join(root, 'game-server');
    const srvLoose = path.join(root, 'loose-server');
    const srvOdd = path.join(root, 'odd-server');
    const mine = (folder) => [srvPinned, srvLoose, srvOdd].some((f) => f.toLowerCase() === String(folder || '').toLowerCase());
    let pinnedId = '';
    let loose = null;
    let odd = null;
    try {
      for (const name of ['shop', 'other']) {
        const folder = path.join(root, name);
        fs.mkdirSync(folder, { recursive: true });
        const c = await inPage(pageNew, { cwd: folder, starter: 'shell' });
        if (c && c.id && await until(promptBack, 30000)) made.push(c.id);
      }
      if (!check('two plain consoles open: the chats a close would end', made.length === 2)) throw new Error('no consoles');

      const serverJs = [
        "const http = require('node:http');",
        'const port = Number(process.argv[2]) || 0;',
        "const s = http.createServer((q, r) => r.end('made-up'));",
        "s.listen(port, '127.0.0.1', () => console.log('Made-up server ready at http://localhost:' + s.address().port + '/'));",
        '// never outlives the test that started it by much',
        'setTimeout(() => process.exit(0), 120000);',
      ].join('\n');
      for (const f of [srvPinned, srvLoose, srvOdd]) { fs.mkdirSync(f, { recursive: true }); fs.writeFileSync(path.join(f, 'server.js'), serverJs); }
      const port1 = await freePort();
      const port2 = await freePort();
      const port3 = await freePort();
      // the one never pinned is started as most are, with its folder's own script; the odd one with a plain node command
      fs.writeFileSync(path.join(srvLoose, 'package.json'), JSON.stringify({ name: 'made-up-loose', private: true, scripts: { dev: `node server.js ${port2}` } }));
      const pinned = await inPage((f, c) => desk.servers('add', { name: 'Made-up game-night server', folder: f, command: c }), srvPinned, `node server.js ${port1}`);
      pinnedId = pinned && pinned.id ? pinned.id : '';
      if (pinnedId) await inPage((i) => desk.servers('start', i), pinnedId);
      loose = spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', '"npm run dev"'], { cwd: srvLoose, windowsHide: true, stdio: 'ignore', windowsVerbatimArguments: true });
      odd = spawn('node', ['server.js', String(port3)], { cwd: srvOdd, windowsHide: true, stdio: 'ignore' });
      const pinnedState = () => (servers.view().servers.find((s) => s.id === pinnedId) || {}).state;
      const ready = await until(async () => { await servers.fresh(); return servers.view().ready && pinnedState() === 'running' && servers.view().loose.filter((l) => mine(l.folder)).length === 2 && (await listening(port1)) && (await listening(port2)) && (await listening(port3)); }, 25000, 400);
      check('1. Three made-up servers run: one pinned and started here, one started outside Lowlit with its folder\'s script, one with a plain node command', Boolean(ready),
        JSON.stringify({ pinned: pinnedState(), loose: servers.view().loose.filter((l) => mine(l.folder)).map((l) => `${l.label}|${l.via}`) }));

      const open = chats.list().filter((c) => !c.closing && !c.pendingClose).length;
      const ran = await gaming.run((f) => mine(f));
      const down = await until(async () => !(await listening(port1)) && !(await listening(port2)) && !(await listening(port3)) && ended(odd), 12000, 300);
      const kept = gaming.kept();
      const again = ran && Array.isArray(ran.again) ? ran.again : [];
      check('2. Gaming mode ends every dev server without asking one by one, and keeps for the next start the pinned one, the start of the one never pinned (its script), and the name of the one whose start cannot be told',
        Boolean(ran) && ran.chats === open && same(ran.servers, [pinnedId]) && Boolean(down) && servers.asked() === ''
        && again.length === 1 && again[0].command === 'npm run dev' && again[0].folder.toLowerCase() === srvLoose.toLowerCase() && again[0].name === 'loose-server' && again[0].url === `http://localhost:${port2}/`
        && same(ran.lost, [`odd-server (port ${port3})`]) && Boolean(kept) && same(kept.servers, [pinnedId]) && JSON.stringify(kept.again) === JSON.stringify(again) && same(kept.lost, ran.lost),
        JSON.stringify({ ran, kept, asked: servers.asked() }));

      gaming.comeBack(kept ? kept.servers : [], kept ? kept.again : []);
      const back = await until(async () => { await servers.fresh(); return pinnedState() === 'running' && (await listening(port1)) && (await listening(port2)); }, 25000, 400);
      const oddBack = await listening(port3);
      check('3. At the next start the servers it stopped start again by themselves, the pinned one and the one never pinned; the one whose start cannot be told does not',
        Boolean(back) && !oddBack, JSON.stringify({ back: Boolean(back), pinned: pinnedState(), loose: servers.view().loose.filter((l) => mine(l.folder)).map((l) => l.ports), odd: oddBack }));

      // how a server never pinned starts again, over made-up folders: its dev tool at the port it had, unless its script
      // names one or runs more than the tool; nothing for a program known only as node; nothing but those commands
      const { Servers: ServersAt } = require('./servers.cjs');
      const recipes = new ServersAt({ dir: path.join(root, 'servers-recipes'), ask: async () => null, env: () => ({}), confirm: async () => false });
      const madeUp = (name, scripts, lock) => {
        const f = path.join(root, name);
        fs.mkdirSync(f, { recursive: true });
        fs.writeFileSync(path.join(f, 'package.json'), JSON.stringify({ name, private: true, scripts }));
        if (lock) fs.writeFileSync(path.join(f, lock), '');
        return f;
      };
      const viteDir = madeUp('made-up-vite', { build: 'vite build', dev: 'vite' });
      const portDir = madeUp('made-up-astro', { dev: 'astro dev --port 4400' });
      const chainDir = madeUp('made-up-chain', { dev: 'npm run css && vite', css: 'tailwindcss -o out.css' });
      const pnpmDir = madeUp('made-up-pnpm', { dev: 'next dev' }, 'pnpm-lock.yaml');
      const group = (folder, label, via, port) => ({ folder, label, via, ports: [port], list: [{ kind: label === 'node' ? '' : 'tool', label: label === 'node' ? '' : label }] });
      const cmd = (g) => { const r = recipes.recipe(g); return r ? r.command : null; };
      const starts = {
        vite: cmd(group(viteDir, 'vite', '', 5199)),
        named: cmd(group(portDir, 'astro', '', 4400)),
        chain: cmd(group(chainDir, 'vite', '', 5200)),
        pnpm: cmd(group(pnpmDir, 'next', '', 3001)),
        via: cmd(group(viteDir, 'vite', 'pnpm run dev', 5201)),
        node: cmd(group(viteDir, 'node', '', 5202)),
      };
      recipes.bringBack([], false, [{ name: 'a', folder: viteDir, command: 'npm run dev -- --port 5199' }, { name: 'b', folder: viteDir, command: 'npm run dev && calc' }, { name: 'c', folder: viteDir, command: 'calc.exe' }]);
      check('4. A server never pinned starts again by its script at the port it had, and by nothing else: its tool told the port unless its script names one or runs more; none for a program known only as node',
        starts.vite === 'npm run dev -- --port 5199' && starts.named === 'npm run dev' && starts.chain === 'npm run dev' && starts.pnpm === 'pnpm dev --port 3001'
        && starts.via === 'pnpm dev --port 5201' && starts.node === null && recipes.again.length === 1 && recipes.again[0].name === 'a', JSON.stringify({ starts, again: recipes.again.map((r) => r.command) }));

      const card = await exec(`[Desk.gamedWords({ chats: 21, servers: ['a', 'b'], lost: [] }), Desk.gamedWords({ chats: 1, servers: [], lost: ['odd-server (port 1234)'] }), Desk.gamedWords({ chats: 0, servers: ['a'], lost: [] })]`);
      check('5. Back from Gaming mode, a card says what comes back, and names a server whose start cannot be told, with what to do',
        Array.isArray(card) && card[0] === 'Your 21 chats and 2 servers are coming back.'
        && card[1] === 'Your chat is coming back. Not odd-server (port 1234): Lowlit cannot tell how it was started. Pin it on the Servers page and it comes back next time.'
        && card[2] === '1 server is coming back.', JSON.stringify(card));

      await until(() => exec(`Servers.view().servers.some((s) => s.id === ${JSON.stringify(pinnedId)} && s.state === 'running')`), 6000, 200);
      const words = await exec(`Desk.gamingWords(${open})`);
      win.webContents.send('desk:command', 'ask-leave');
      const box = await until(() => inPage(() => {
        const r = document.getElementById('leave');
        const g = r && !r.hidden ? r.querySelector('.leave-choice[data-how="gaming"]') : null;
        return g ? { title: g.querySelector('.leave-title').textContent, note: g.querySelector('.leave-note').textContent, n: r.querySelectorAll('.leave-choice').length } : null;
      }), 3000, 100);
      await inPage(pageKey, 'Escape', '#leave');
      const shut = await until(() => exec('document.getElementById("leave").hidden'), 2000, 100);
      check('6. The close question offers Gaming mode, saying what it closes and what comes back next time',
        Boolean(box) && box.n === 4 && box.title === 'Gaming mode' && box.note === words && new RegExp(`^Closes your ${open} chats(,| and) 1 pinned server`).test(words)
        && /, so nothing holds your computer while you play\. Next time Lowlit opens, your chats and servers come back as they were\.$/.test(words) && Boolean(shut),
        JSON.stringify({ box: box && { n: box.n, title: box.title }, words }));

      await exec('Settings.open("closing")');
      const choices = () => inPage(() => [...document.querySelectorAll('#settings section[data-section="closing"] .set-choice')]
        .map((b) => [b.querySelector('.set-choice-name').textContent, b.getAttribute('aria-checked'), b.querySelector('.quiet').textContent]));
      const offered = await until(choices, 3000, 100);
      await pressOn('#settings .set-choice-name', 'Gaming mode');
      const set = await until(() => settingsNow().keepChats === 'gaming', 3000, 100);
      const ticked = await until(async () => { const c = await choices(); return c && c.find((x) => x[0] === 'Gaming mode')[1] === 'true' ? c : null; }, 3000, 100);
      await pressOn('#settings .set-choice-name', 'Ask me');
      const reset = await until(() => settingsNow().keepChats === 'ask', 3000, 100);
      await exec('Settings.close()');
      check('7. Settings can make Gaming mode what every close does: five answers, each saying what it means, the one picked ticked',
        Boolean(offered) && same(offered.map((c) => c[0]), ['Ask me', 'Keep them', 'Start fresh', 'Keep running', 'Gaming mode']) && offered.every((c) => c[2].length > 10)
        && Boolean(set) && Boolean(ticked) && ticked.filter((c) => c[1] === 'true').length === 1 && Boolean(reset), JSON.stringify(offered && offered.map((c) => c.slice(0, 2))));
    } finally {
      gaming.clear();
      if (pinnedId && servers.started()[pinnedId]) await inPage((i) => desk.servers('stop', i), pinnedId);
      // the one never pinned that came back runs on its own: gaming mode's own stop ends it, and anything else of the test's
      await gaming.run((f) => mine(f));
      gaming.clear();
      for (const c of [loose, odd]) if (c && !ended(c)) try { c.kill(); } catch { /* gone */ }
      const closed = [];
      for (const id of [...made].reverse()) if (chats.all.has(id)) closed.push(await closeAndWait(id));
      await servers.fresh();
      const still = servers.view().loose.filter((l) => mine(l.folder)).length + servers.view().servers.filter((s) => mine(s.folder) && s.state !== 'stopped' && s.state !== 'failed').length;
      check('afterwards both consoles are closed, no made-up server runs, and nothing is left for a next start', closed.every(Boolean) && !made.some((id) => chats.all.has(id)) && still === 0 && !gaming.kept(),
        JSON.stringify({ closed: closed.length, still }));
    }
  };


  // ---- the graphics process ending under the window (his window, 4 Oct 15:17: "the graphics process ended (crashed,
  // ---- code 34)", and Noir showed white until he switched to Grey). Only this run's own graphics process is ended.
  const gpuPhase = async () => {
    check('the window loads for the graphics checks', Boolean(await until(() => exec('typeof Desk === "object" && Desk !== null && typeof Noir === "object"'), 15000)));
    watch.post({ type: 'pace', ms: 600000 });
    win.setContentSize(1440, 900);
    await wait(700);
    madeAt = Date.now();
    await installFakes();
    await showUsage('today');
    await exec(`takeSnapshot(${fake(madeAt, madeUpRows(false))})`);
    await exec(`takeSnapshot(${fake(madeAt + 1, madeUpRows(true))})`);
    await wait(400);
    // how much of the window is near white, and how bright it is on average (0 to 1); asked twice, as a hidden window
    // hands back the frame it last drew
    const light = async (name) => {
      await exec('document.getElementById("toast").hidden = true');
      await drawn();
      await win.webContents.capturePage();
      await wait(150);
      const img = await win.webContents.capturePage();
      fs.writeFileSync(path.join(dir, `${name}.png`), img.toPNG());
      const px = img.toBitmap();
      let white = 0;
      let sum = 0;
      const n = px.length / 4;
      for (let i = 0; i < px.length; i += 4) {
        sum += px[i] + px[i + 1] + px[i + 2];
        if (px[i] > 225 && px[i + 1] > 225 && px[i + 2] > 225) white++;
      }
      return { white: Math.round((white / n) * 1000) / 10, mean: Math.round((sum / n / 765) * 1000) / 1000 };
    };
    const noir = () => exec(`(() => {
      const c = document.querySelector('canvas.noir');
      const gl = c && c.getContext('webgl');
      const style = c && getComputedStyle(c);
      return { canvases: document.querySelectorAll('canvas.noir').length, lost: gl ? gl.isContextLost() : null, shown: Boolean(style) && style.display !== 'none' && style.visibility !== 'hidden', failed: Noir.state().failed, frames: Noir.state().frames };
    })()`);
    const drawing = () => exec(`(() => {
      const c = document.querySelector('canvas.noir');
      const gl = c && c.getContext('webgl');
      return Boolean(gl) && !gl.isContextLost() && !Noir.state().failed && !Noir.state().lost && getComputedStyle(c).display !== 'none';
    })()`);
    // a canvas is painted again when anything moves it, and after its graphics process ended the app draws the whole
    // window again: both, as in his window
    const repaint = async () => {
      win.setContentSize(1441, 900);
      await wait(250);
      win.setContentSize(1440, 900);
      win.webContents.invalidate();
      await wait(350);
    };
    const lose = () => exec(`(() => {
      const gl = document.querySelector('canvas.noir').getContext('webgl');
      const x = gl && gl.getExtension('WEBGL_lose_context');
      if (!x) return false;
      window.__loseNoir = x;
      x.loseContext();
      return true;
    })()`);
    await exec('Noir.drawNow()');
    const before = await light('gpu-before');
    say(`      before: ${JSON.stringify(before)} ${JSON.stringify(await noir())}`);

    // 1. the light's graphics context is taken away and not given back yet, as when Chromium blocks a page from the
    //    graphics chip after a crash: Chromium paints such a canvas white all over
    check('the light\'s graphics context can be taken away, as a crash does', await lose());
    await wait(300);
    await repaint();
    const lost = await light('gpu-lost');
    const lostState = await noir();
    say(`      lost: ${JSON.stringify(lost)} ${JSON.stringify(lostState)}`);
    check('with its graphics context gone, Noir\'s ground stays black when the window is drawn again: no more of it white or lit than before',
      lost.white <= before.white + 1 && lost.mean <= before.mean + 0.02, JSON.stringify({ before, lost, noir: lostState }));
    await exec('window.__loseNoir.restoreContext(); true');
    const back = await until(drawing, 5000);
    await exec('Noir.drawNow()');
    const restored = await light('gpu-restored');
    check('given back, the light is drawn again as before', Boolean(back) && Math.abs(restored.mean - before.mean) < 0.03 && restored.white <= before.white + 1, JSON.stringify({ before, restored, noir: await noir() }));

    // 2. taken away and never given back: the light starts again on a new canvas once the graphics chip can be had
    check('the light\'s graphics context taken away a second time', await lose());
    await wait(300);
    await repaint();
    const still = await light('gpu-lost-2');
    const renewed = await until(drawing, 12000, 300);
    await exec('Noir.drawNow()');
    const fresh = await light('gpu-renewed');
    const renewedState = await noir();
    say(`      renewed: ${JSON.stringify(fresh)} ${JSON.stringify(renewedState)}`);
    check('not given back, the light starts again on a new canvas of its own within seconds, the old one gone, black meanwhile, and is drawn as before',
      Boolean(renewed) && renewedState.canvases === 1 && still.white <= before.white + 1 && Math.abs(fresh.mean - before.mean) < 0.03 && fresh.white <= before.white + 1,
      JSON.stringify({ still, fresh, noir: renewedState }));

    // 2b. a terminal's canvas: off the screen from the moment its context goes, back when it is given back (made up in
    //     the page: a canvas inside a terminal's frame, as the add-on makes it)
    const termCanvas = await inPage(async () => {
      const box = document.createElement('div');
      box.className = 'xterm made-up-gpu-check';
      const c = document.createElement('canvas');
      box.append(c);
      document.body.append(box);
      const gl = c.getContext('webgl2') || c.getContext('webgl');
      const x = gl && gl.getExtension('WEBGL_lose_context');
      if (!x) { box.remove(); return null; }
      c.addEventListener('webglcontextlost', (e) => e.preventDefault());
      const settle = () => new Promise((r) => setTimeout(r, 200));
      x.loseContext();
      await settle();
      const lostHidden = c.style.visibility === 'hidden';
      x.restoreContext();
      await settle();
      const backShown = c.style.visibility === '' && !gl.isContextLost();
      box.remove();
      return { lostHidden, backShown };
    });
    check('a terminal\'s canvas is off the screen while its graphics context is gone, and back once it is given back',
      Boolean(termCanvas) && termCanvas.lostHidden && termCanvas.backShown, JSON.stringify(termCanvas));

    // 3. Chromium's own rule: after a crash it blocks a page from the graphics chip until the app starts again
    check('Chromium may not block the page from the graphics chip after a crash: switched off before the app was ready',
      Boolean(screens.gpuUnblocked && screens.gpuUnblocked()));

    // 4. this run's own graphics process ends, as his did at 15:17
    const gone = new Promise((done) => {
      const seen = (_e, d) => { if (d && d.type === 'GPU') { app.removeListener('child-process-gone', seen); done(d); } };
      app.on('child-process-gone', seen);
      setTimeout(() => { app.removeListener('child-process-gone', seen); done(null); }, 8000);
    });
    const proc = app.getAppMetrics().find((m) => m.type === 'GPU');
    check('this run has a graphics process of its own to end', Boolean(proc), JSON.stringify(app.getAppMetrics().map((m) => m.type)));
    if (!proc) return;
    process.kill(proc.pid);
    const ended = await gone;
    check('the graphics process ended', Boolean(ended), JSON.stringify(ended && { reason: ended.reason, exitCode: ended.exitCode }));
    const again = await until(() => { const m = app.getAppMetrics().find((x) => x.type === 'GPU'); return m && m.pid !== proc.pid ? m : null; }, 10000, 200);
    check('Chromium starts a new graphics process', Boolean(again));
    await repaint();
    const during = await light('gpu-during');
    const lit = await until(drawing, 20000, 300);
    await exec('Noir.drawNow()');
    const after = await light('gpu-after');
    const blocked = await exec('document.createElement("canvas").getContext("webgl") === null');
    say(`      during: ${JSON.stringify(during)} after: ${JSON.stringify(after)} ${JSON.stringify(await noir())} webgl blocked: ${blocked}, ${JSON.stringify(app.getGPUFeatureStatus().webgl)}`);
    check('while the graphics process starts again, no more of the window white than before', during.white <= before.white + 1, JSON.stringify({ before, during }));
    check('after it came back, the page may still draw with the graphics chip and Noir\'s light is drawn again',
      !blocked && Boolean(lit), JSON.stringify({ blocked, lit }));
    check('and Noir looks as before: no more of the window white than before',
      after.white <= before.white + 1 && Math.abs(after.mean - before.mean) < 0.05, JSON.stringify({ before, after }));
  };

  // ---- the work clock and the record of the day (his asks, 4 Oct: "a bar that goes down, the time we have left", then
  // ---- "time me even when I don't launch it ... 15 minutes without using it ends that session, minus the 15 minutes ...
  // ---- a timer to an end only when I specify it"), over a made-up day on a made-up clock: the clock's time, the time
  // ---- since the last key, the chat in front and what ActivityWatch answers are the test's own. Nothing of the
  // ---- person's is read.
  const workPhase = async () => {
    check('the window loads for the work clock checks', Boolean(await until(() => exec('typeof Desk === "object" && Desk !== null && typeof Shift === "object"'), 15000)));
    watch.post({ type: 'pace', ms: 600000 });
    win.setContentSize(1440, 900);
    madeAt = Date.now();
    await installFakes();
    await showUsage('today');
    await exec(`takeSnapshot(${fake(madeAt, madeUpRows(true))})`);
    const w = work.get();
    const cfgNow = () => settingsNow().work || {};
    check('the work clock starts with the window: it counts by itself, a break of 15 minutes ends a session, and no countdown starts unless asked for',
      Boolean(w) && cfgNow().auto === false && cfgNow().gap === 15, JSON.stringify({ auto: cfgNow().auto, gap: cfgNow().gap }));
    if (!w) return;
    const at = (d, hh, mm, ss = 0) => new Date(2026, 9, d, hh, mm, ss).getTime();
    const hm = (ms) => (ms ? new Date(ms).toTimeString().slice(0, 8) : '-');
    let T = at(5, 4, 0);
    let touched = T - 3600e3;
    let focused = true;
    const chatA = { key: 'made-up-chat-a', title: 'Made-up login page', cwd: 'D:\\work\\shop' };
    const chatB = { key: 'made-up-chat-b', title: 'Made-up checkout', cwd: 'D:\\work\\shop' };
    let front = chatA;
    const notes = [];
    const own = path.basename(process.execPath);
    Object.assign(w, { now: () => T, idle: () => (T - touched) / 1000, focused: () => focused, front: () => front, over: (s) => notes.push(s.name) });
    // what ActivityWatch saw: a stretch from a first touch to a last, as long as three minutes never pass without one.
    // Last Saturday both usual shifts, last Sunday two hours; the made-up Monday is added as it is lived.
    const seenBy = [[at(3, 6, 30), at(3, 12, 30)], [at(3, 20, 15), at(4, 0, 45)], [at(4, 9, 0), at(4, 11, 0)]];
    // and the programs it saw, day by day: its rows carry a window title, which must never be kept or shown
    const appsOn = {
      '2026-10-03': [[own, 8.5 * 3600], ['chrome.exe', 1.5 * 3600], ['made-up-game-Win64-Shipping.exe', 1800]],
      '2026-10-04': [['chrome.exe', 2 * 3600]],
      '2026-10-05': [[own, 22320], ['chrome.exe', 1440], ['made-up-game-Win64-Shipping.exe', 300]],
    };
    const events = () => seenBy.map(([a, b]) => ({ timestamp: new Date(a).toISOString(), duration: Math.max(1, (b - a) / 1000), data: { status: 'not-afk' } }));
    const keyAt = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
    w.ask = async (body) => {
      if (body.query.some((q) => q.includes('merge_events_by_keys'))) {
        const apps = appsOn[keyAt(Date.parse(body.timeperiods[0].split('/')[0]))] || [];
        return [{ here: events(), apps: apps.map(([app, s]) => ({ duration: s, data: { app, title: 'a made-up window title' } })) }];
      }
      return body.timeperiods.map(() => events());
    };
    // a fresh record on a file of its own, with last Saturday in it: both usual shifts counted down, two chats
    w.state = { v: 1, shift: null, session: null, ran: ['2026-10-03|06:00', '2026-10-03|20:00'], at: 0, seen: 0, days: {
      '2026-10-03': { here: [[at(3, 6, 30), at(3, 12, 30)], [at(3, 20, 15), at(4, 0, 45)]],
        chats: { 'made-up-chat-a': [5.5 * 3600, 'Made-up login page', 'D:\\work\\shop'], 'made-up-chat-c': [3 * 3600, 'Made-up invoices', 'D:\\work\\books'] },
        shifts: [{ name: 'Morning', start: at(3, 6, 30), end: at(3, 13, 30), closed: at(3, 12, 30), auto: true },
          { name: 'Night', start: at(3, 20, 15), end: at(4, 1, 45), closed: at(4, 0, 45), auto: true }] } } };
    Object.assign(w, { prev: 0, there: false, seen: 0, waitUntil: 0, lately: [], pending: null, asking: null });
    w.cache.clear();
    w.changed();
    const run = async (until, how) => {
      if (how === 'asleep') { T = until; return; }
      while (T < until) {
        T = Math.min(until, T + 15e3);
        if (how === 'working') {
          touched = T - 5e3;
          const last = seenBy[seenBy.length - 1];
          if (touched - last[1] <= 180e3) last[1] = touched;
          else seenBy.push([touched, touched]);
        }
        await w.tick();
      }
    };
    // the page is told what main has now, and the clock in the title bar read
    const gauge = async () => {
      w.changed();
      await until(() => exec(`(() => { const v = Desk.state && document.getElementById('shift'); return Boolean(v); })()`), 2000);
      await wait(120);
      return inPage(() => {
        const b = document.getElementById('shift');
        const r = b.getBoundingClientRect();
        const dot = getComputedStyle(b.querySelector('.ts-dot')).display !== 'none';
        const line = getComputedStyle(b.querySelector('.ts-track')).display !== 'none';
        return { hidden: b.hidden, tone: b.className.replace('tb-shift', '').replace('open', '').trim(), text: b.querySelector('.ts-time').textContent, dot, line,
          fill: parseFloat(b.querySelector('.ts-track i').style.width) || 0, tip: b.dataset.tip || '', left: Math.round(r.left), width: Math.round(r.width) };
      });
    };
    const shift = () => w.state.shift;
    const session = () => w.state.session;
    const panel = () => inPage(() => {
      const p = document.getElementById('shift-pop');
      return p.hidden ? null : { text: p.textContent, head: (p.querySelector('.sp-name') || {}).textContent || '', offer: (p.querySelector('.sp-offer') || {}).textContent || '',
        chips: [...p.querySelectorAll('.sp-chip')].map((b) => b.textContent + (b.classList.contains('on') ? '*' : '')) };
    });
    const tap = (label) => inPage((t) => { const b = [...document.querySelectorAll('#shift-pop button')].find((x) => x.textContent === t); if (b) b.click(); return Boolean(b); }, label);
    const escape = async () => {
      await inPage(() => { const p = document.getElementById('shift-pop'); p.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); return true; });
      return exec('document.getElementById("shift-pop").hidden');
    };
    // sessions added up here from what ActivityWatch was told the made-up person did: a second way to the same figures
    const clip = (list, a0, b0) => list.map(([a, b]) => [Math.max(a, a0), Math.min(b, b0)]).filter(([a, b]) => b > a);
    const total = (list) => list.reduce((n, [a, b]) => n + b - a, 0);
    const merged = (list, gapMs) => list.reduce((out, [a, b]) => {
      const last = out[out.length - 1];
      if (last && a - last[1] < gapMs) last[1] = Math.max(last[1], b);
      else out.push([a, b]);
      return out;
    }, []);
    const hmList = (list) => list.map(([a, b]) => [hm(a), hm(b)]);

    // 1. before the day: away, nothing running
    let g = await gauge();
    check('away before the day begins: the clock at the end of the title bar says so, dim, and nothing counts down',
      !g.hidden && g.tone === 'idle' && g.text === 'Away' && g.dot && !g.line && !shift() && !session()
      && g.tip.startsWith('Away: no key or mouse for 15 minutes or more. A new session starts the moment you are back.'), JSON.stringify(g));
    const place = g;

    // 2. the computer slept until 06:15; he sits down: a session starts then, counted up; no countdown starts by itself
    await run(at(5, 6, 15), 'asleep');
    touched = T;
    // ActivityWatch saw his first touch half a minute before Lowlit's first look
    seenBy.push([at(5, 6, 14, 30), T]);
    await run(at(5, 6, 16), 'working');
    g = await gauge();
    const first = g;
    check('sitting down at 06:15 starts a work session then (as ActivityWatch has it), counted up beside a dot; no countdown starts by itself',
      Boolean(session()) && hm(session().start) === '06:14:30' && !shift() && g.tone === 'up' && g.text === '1m' && g.dot && !g.line
      && g.tip.startsWith('Working since 06:14: 1m this session. A break of 15 minutes ends it, and is not counted.'), JSON.stringify({ session: session() && hm(session().start), g }));

    // 3. a chat in front for an hour, another for half an hour, then another program; then a 10-minute break
    await run(at(5, 7, 16), 'working');
    front = chatB;
    await run(at(5, 7, 46), 'working');
    focused = false;
    await run(at(5, 8, 16), 'working');
    focused = true;
    front = chatA;
    await run(at(5, 8, 26), 'away');
    const held = session() && { ...session() };
    const paused = await gauge();
    await run(at(5, 8, 56), 'working');
    g = await gauge();
    check('a break shorter than 15 minutes keeps the session: dim while it lasts, its time held at the last touch; back, the break counts as part of it',
      Boolean(held) && hm(held.start) === '06:14:30' && hm(held.last) === '08:15:55' && paused.tone === 'paused' && paused.text === '2h 01m' && paused.dot
      && paused.tip.startsWith('On a break since 08:15: 2h 01m this session, since 06:14.') && Boolean(session()) && session().start === held.start && g.tone === 'up' && g.text === '2h 41m',
      JSON.stringify({ held: held && [hm(held.start), hm(held.last)], paused: [paused.tone, paused.text], back: [g.tone, g.text] }));

    // 4. the clock's panel offers the morning shift, counted down from when the session began
    await inPage(() => { document.getElementById('shift').click(); return true; });
    await drawn();
    const offered = await panel();
    await shoot('work-panel-session');
    const tappedOffer = await inPage(() => { const b = document.querySelector('#shift-pop .sp-offer'); if (b) b.click(); return Boolean(b); });
    await until(() => Boolean(shift()), 2000);
    const usual = shift() && { ...shift() };
    g = await gauge();
    const shut1 = await escape();
    check('the panel offers the usual shift whose hours these are, counted down from when the session began; one click starts it',
      Boolean(offered) && offered.head === 'Work session' && offered.offer === 'Morning shift · until 13:14' && same(offered.chips, ['1h', '2h', '3h', '4h', '5h', '6h', '7h', '8h'])
      && tappedOffer && Boolean(usual) && usual.name === 'Morning' && !usual.auto && hm(usual.start) === '06:14:30' && hm(usual.end) === '13:14:30'
      && g.tone === 'run' && g.text === '4h 19m' && !g.dot && g.line && g.fill > 61 && g.fill < 62.5 && g.tip.includes('This session: 2h 41m, since 06:14.') && shut1 === true,
      JSON.stringify({ offered, usual: usual && [usual.name, hm(usual.start), hm(usual.end)], g: [g.tone, g.text, g.fill] }));

    // 5. time in each chat: only while this window has the keyboard and he is there, up to his last touch
    await run(at(5, 9, 56), 'working');
    const minutes = (key) => ((w.state.days['2026-10-05'].chats[key] || [0])[0]) / 60;
    // in front while he was there: a from his first touch to 07:16 and from his first touch after the break to his last
    const wantA = ((at(5, 7, 16) - at(5, 6, 15, 10)) + (at(5, 9, 55, 55) - at(5, 8, 26, 10))) / 60e3;
    check('time in each chat counts only while this window has the keyboard and he is there, up to his last touch',
      Math.abs(minutes('made-up-chat-a') - wantA) <= 0.75 && Math.abs(minutes('made-up-chat-b') - 30) <= 0.5,
      `a ${minutes('made-up-chat-a').toFixed(2)} min (his own ${wantA.toFixed(2)}), b ${minutes('made-up-chat-b').toFixed(2)} min`);

    // 6. a 40-minute break ends the session at the last touch before it; the countdown runs on; back, a new session
    await run(at(5, 10, 36), 'away');
    const ended = !session();
    const during = await gauge();
    await run(at(5, 12, 50), 'working');
    const second = session() && { ...session() };
    check('a break of 15 minutes or more ends the session, and the countdown runs on; back, a new session starts when he sat down',
      ended && during.tone === 'run' && during.text === '2h 39m' && !during.tip.includes('This session') && Boolean(second) && hm(second.start) === '10:36:10',
      JSON.stringify({ ended, during: [during.tone, during.text], second: second && hm(second.start) }));

    // 7. the last half hour in yellow; past the end in red, said once; it goes on while he works
    g = await gauge();
    const late = g;
    await run(at(5, 13, 20), 'working');
    g = await gauge();
    const over = g;
    check('the last half hour is yellow; past its end the clock says how far over, in red, and the end is said once while he works on',
      late.tone === 'late' && late.text === '25m' && over.tone === 'over' && over.text === '+6m' && over.fill === 0 && Boolean(shift()) && notes.length === 1 && notes[0] === 'Morning'
      && over.tip.startsWith('Morning shift: 6m past its end (13:14). It closes once you have been away 15 minutes.'),
      JSON.stringify({ late: [late.tone, late.text], over: [over.tone, over.text, over.fill], notes }));

    // 8. the clock never moves, whatever it says and whatever comes and goes beside it (the "needs you" pill)
    const snapNow = await inPage(() => Desk.state.snap);
    await inPage((snap) => { takeSnapshot({ ...snap, at: snap.at + 1, chats: snap.chats.map((c) => ({ ...c, state: 'idle' })) }); Desk.paint(); return true; }, snapNow);
    await drawn();
    const calm = await gauge();
    const triageGone = await exec('document.getElementById("triage").hidden');
    await inPage((snap) => { takeSnapshot({ ...snap, at: snap.at + 2 }); Desk.paint(); return true; }, snapNow);
    await drawn();
    const busy = await gauge();
    const triageBack = !(await exec('document.getElementById("triage").hidden'));
    const spots = [place, first, paused, late, over, calm, busy].map((x) => `${x.left}+${x.width}`);
    check('the clock keeps its place and its width, whatever it says, and when the "needs you" pill comes or goes beside it',
      triageGone && triageBack && new Set(spots).size === 1, spots.join(' '));

    // 9. away 20 minutes past its end: the countdown closes when he left, and the session ends there too
    const left = touched;
    await run(at(5, 13, 40), 'away');
    g = await gauge();
    const closed = (w.state.days['2026-10-05'] || { shifts: [] }).shifts;
    check('away 15 minutes past its end, the countdown closes at the moment he left, the session ends there too, and the clock says Away',
      !shift() && !session() && closed.length === 1 && closed[0].closed === left && hm(left) === '13:19:55' && g.tone === 'idle' && g.text === 'Away',
      JSON.stringify({ closed: closed.map((s) => [s.name, hm(s.start), hm(s.closed)]), g: [g.tone, g.text] }));

    // 10. countdowns by hand: away, the panel offers no usual shift (the morning's ran, the night's hours are later);
    // back at 13:40, at 13:45 one for 2 hours, made 4 hours, half an hour more, ended 12 minutes in; one started by a
    // slip and ended at once
    await inPage(() => { document.getElementById('shift').click(); return true; });
    await drawn();
    const awayPanel = await panel();
    await run(at(5, 13, 45), 'working');
    const tapped = [await tap('2h')];
    await until(() => Boolean(shift()), 2000);
    const started = shift() && { ...shift() };
    const two = await gauge();
    await shoot('work-panel');
    tapped.push(await tap('4h'));
    await wait(150);
    const four = await gauge();
    const onPanel = await panel();
    tapped.push(await tap('+ 30m'));
    await wait(150);
    const more = await gauge();
    await run(at(5, 13, 57), 'working');
    tapped.push(await tap('End it now'));
    await wait(150);
    const endedNow = !shift();
    tapped.push(await tap('1h'));
    const slipped = Boolean(await until(() => Boolean(shift()), 2000));
    tapped.push(await tap('End it now'));
    await wait(150);
    const dayShifts = w.state.days['2026-10-05'].shifts.map((s) => [s.name, hm(s.start), hm(s.closed)]);
    const shut = await escape();
    check('the panel away: no usual shift to offer, a countdown from now; one for 2 hours, 4 hours, half an hour more, ended now; Esc closes it',
      Boolean(awayPanel) && awayPanel.head === 'Away' && awayPanel.offer === '' && awayPanel.text.includes('No key or mouse for 15 minutes or more.')
      && same(awayPanel.chips, ['1h', '2h', '3h', '4h', '5h', '6h', '7h', '8h']) && tapped.every(Boolean)
      && Boolean(started) && started.name === 'Countdown' && !started.auto && hm(started.start) === '13:45:00' && two.text === '2h 00m' && four.text === '4h 00m'
      && Boolean(onPanel) && onPanel.head === 'Countdown' && same(onPanel.chips, ['2h', '3h', '4h*', '5h', '6h', '7h', '8h']) && onPanel.text.includes('Session4m since 13:40')
      && more.text === '4h 30m' && endedNow && shut === true,
      JSON.stringify({ awayPanel: awayPanel && [awayPanel.head, awayPanel.offer, awayPanel.chips.join(' ')], tapped, two: two.text, four: four.text, more: more.text, onPanel: onPanel && [onPanel.head, onPanel.chips.join(' ')] }));
    check('a countdown started by a slip and ended within the minute leaves nothing on the day',
      slipped && !shift() && same(dayShifts, [['Morning', '06:14:30', '13:19:55'], ['Countdown', '13:45:00', '13:57:00']]), JSON.stringify(dayShifts));

    // 11. the Dashboard: the day as ActivityWatch saw it, its work sessions, the chats, the programs by name only, the last seven days
    await inPage(() => Desk.setView('stats'));
    await until(() => exec('(() => { const b = document.querySelector("#stats .work-sec"); return Boolean(b && !b.hidden && b.querySelector(".wd-line")); })()'), 5000);
    await wait(300);
    await inPage(() => { Desk.paint(); return true; });
    await until(() => exec('document.querySelectorAll("#stats .work-sec .bar-slot").length === 7'), 5000);
    const readBox = () => inPage(() => {
      const b = document.querySelector('#stats .work-sec');
      const rows = (i) => [...b.querySelectorAll('.cols2 > .sec')[i].querySelectorAll('.tr')].map((r) => r.textContent);
      const bars = [...b.querySelectorAll('.bar-slot')];
      return { kpis: [...b.querySelectorAll('.kpi')].map((k) => k.textContent), chats: rows(0), apps: rows(1), sessions: b.querySelectorAll('.wd-session').length,
        here: b.querySelectorAll('.wd-here').length, counts: b.querySelectorAll('.wd-count').length, now: Boolean(b.querySelector('.wd-now')), week: bars.length,
        picked: bars.findIndex((x) => x.classList.contains('picked')), back: Boolean(b.querySelector('.wd-back')), note: b.querySelector('.sec-head .note').textContent,
        leak: document.body.innerText.includes('made-up window title') || document.body.innerText.includes('made-up page title') };
    });
    const noteSays = (start) => until(() => exec(`document.querySelector("#stats .work-sec .sec-head .note").textContent.startsWith(${JSON.stringify(start)})`), 3000);
    const showBox = async (name) => {
      await exec('document.querySelector("#stats .work-sec").scrollIntoView({ block: "start" }); true');
      await drawn();
      await shoot(name);
    };
    const dash = await readBox();
    await showBox('work-dashboard');
    const today = clip(seenBy, at(5, 5, 0), T);
    const sessionsToday = merged(today, 15 * 60e3);
    const longest = sessionsToday.reduce((n, [a, b]) => Math.max(n, b - a), 0);
    const chatMs = (key) => w.state.days['2026-10-05'].chats[key][0] * 1000;
    const chatsMs = chatMs('made-up-chat-a') + chatMs('made-up-chat-b');
    const said = await inPage((xs) => xs.map((x) => hours(x)), [total(sessionsToday), longest, chatsMs, chatMs('made-up-chat-a'), chatMs('made-up-chat-b')]);
    check('the Dashboard shows the day: the time worked (each session from its first touch to its last), the sessions, the longest, the time with a chat in front, the chats, the programs by name',
      same(hmList(sessionsToday), [['06:14:30', '09:55:55'], ['10:36:10', '13:19:55'], ['13:40:10', '13:56:55']]) && total(sessionsToday) === ((6 * 60 + 41) * 60 + 55) * 1000
      && dash.kpis[0] === `${said[0]}worked` && dash.kpis[1] === '3sessions' && dash.kpis[2] === `${said[1]}longest session` && dash.kpis[3] === `${said[2]}with a chat in front`
      && total(today) >= chatsMs && Object.keys(w.state.days['2026-10-05'].chats).length === 2
      && same(dash.chats, [`Made-up login pageshop${said[3]}`, `Made-up checkoutshop${said[4]}`]) && same(dash.apps, ['Lowlit6h 12m', 'Chrome24m', 'made up game5m'])
      && dash.sessions === 3 && dash.here === 4 && dash.counts === 2 && dash.now && dash.week === 7 && dash.picked === -1 && !dash.back
      && dash.note.startsWith('Monday 5 October, from 05:00') && dash.note.includes('as ActivityWatch saw it') && !dash.leak, JSON.stringify({ ...dash, want: said, sessions: hmList(sessionsToday) }));
    const week = await w.weekView();
    const sec = (ms) => Math.round(ms / 1000);
    check('the last seven days add up each day the same way: Saturday 10h 30m in two sessions, Sunday two hours in one, today as above',
      same(week.map((x) => [sec(x.worked), x.sessions, sec(x.chats)]), [[0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0], [37800, 2, 30600], [7200, 1, 0], [sec(total(sessionsToday)), 3, sec(chatsMs)]]),
      JSON.stringify(week.map((x) => [x.key, sec(x.worked), x.sessions, sec(x.chats)])));

    // a past day picked on the chart: the box shows it until "Back to today", and the Dashboard opened again shows today
    await inPage(() => { document.querySelectorAll('#stats .work-sec .bar-slot')[4].click(); return true; });
    await noteSays('Saturday');
    const sat = await readBox();
    await showBox('work-dashboard-day');
    await inPage(() => { document.querySelector('#stats .work-sec .wd-back').click(); return true; });
    const backToday = await noteSays('Monday');
    await inPage(() => { document.querySelectorAll('#stats .work-sec .bar-slot')[4].click(); return true; });
    const pickedAgain = await noteSays('Saturday');
    await inPage(() => { document.getElementById('stats').hidden = true; return true; });
    await wait(50);
    await inPage(() => { Desk.setView('stats'); Desk.paint(); return true; });
    const reopened = await noteSays('Monday');
    check('a past day clicked on the chart shows its sessions, countdowns, chats and programs, until "Back to today"; the Dashboard opened again shows today',
      sat.note.startsWith('Saturday 3 October') && sat.kpis[0] === '10h 30mworked' && sat.kpis[1] === '2sessions' && sat.kpis[2] === '6h 00mlongest session'
      && sat.kpis[3] === '8h 30mwith a chat in front' && same(sat.chats, ['Made-up login pageshop5h 30m', 'Made-up invoicesbooks3h 00m'])
      && same(sat.apps, ['Lowlit8h 30m', 'Chrome1h 30m', 'made up game30m']) && sat.sessions === 2 && sat.here === 2 && sat.counts === 2 && !sat.now && sat.picked === 4 && sat.back
      && Boolean(backToday) && Boolean(pickedAgain) && Boolean(reopened), JSON.stringify({ sat, backToday: Boolean(backToday), pickedAgain: Boolean(pickedAgain), reopened: Boolean(reopened) }));
    const kept = fs.readFileSync(work.file(), 'utf8');
    check('what is kept on disk holds the chats\' times and never a window\'s title', kept.includes('Made-up login page') && !kept.includes('made-up window title') && !kept.includes('made-up page title'));

    // 12. Settings: the work clock's section, the break that ends a session, the usual shifts, the switch that starts
    // their countdowns by themselves, and the note when a countdown's time is up
    await exec('Settings.open("work")');
    await drawn();
    await shoot('work-settings');
    const readSet = () => inPage(() => {
      const s = document.querySelector('#settings section[data-section="work"]');
      return s ? { title: s.querySelector('h3').firstChild.textContent, gap: (s.querySelector('.work-gap') || {}).value,
        rows: [...s.querySelectorAll('.work-row')].map((r) => [r.querySelector('.name-input').value, r.querySelector('.work-at').value, r.querySelector('.work-hours').value]),
        switches: [...s.querySelectorAll('.set-row')].filter((r) => r.querySelector('.switch')).map((r) => [r.querySelector('.what > div').textContent, r.querySelector('.switch').classList.contains('on')]),
        note: document.querySelector('#settings').textContent.includes('When a countdown\'s time is up') } : null;
    });
    const set = await readSet();
    const setField = (sel, i, value) => inPage((args) => { const f = document.querySelectorAll(`#settings ${args.sel}`)[args.i]; f.value = args.value; f.dispatchEvent(new Event('change')); return true; }, { sel, i, value });
    await setField('.work-gap', 0, '30');
    const wider = await until(() => cfgNow().gap === 30, 3000, 100);
    const day30 = await w.dayView('2026-10-05');
    const want30 = merged(today, 30 * 60e3);
    await setField('.work-gap', 0, '15');
    const narrow = await until(() => cfgNow().gap === 15, 3000, 100);
    await setField('.work-row .work-hours', 1, '4');
    const changed = await until(() => { const s = cfgNow().shifts; return s[1] && s[1].hours === 4 ? s : null; }, 3000, 100);
    await setField('.work-row .work-hours', 1, '5.5');
    await until(() => cfgNow().shifts[1].hours === 5.5, 3000, 100);
    check('Settings has the work clock: a 30-minute break joins the sessions less than 30 minutes apart, and 15 again parts them; the usual shifts, a length changed and kept; their countdowns start by themselves only when switched on; the note when a countdown\'s time is up',
      Boolean(set) && set.title === 'Work clock' && set.gap === '15' && same(set.rows, [['Morning', '06:00', '7'], ['Night', '20:00', '5.5']])
      && same(set.switches, [['Show the work clock, and keep a record of your day', true], ['Start my usual shift\'s countdown by itself', false], ['Read ActivityWatch on this computer', true]])
      && set.note && Boolean(wider) && same(hmList(day30.sessions), hmList(want30)) && same(hmList(want30), [['06:14:30', '09:55:55'], ['10:36:10', '13:56:55']])
      && Boolean(narrow) && Boolean(changed), JSON.stringify({ set, sessions30: hmList(day30.sessions) }));

    // 13. switched on, the usual shift's countdown starts by itself: at work since the afternoon, the night's starts at
    // its usual 20:00, not before; past midnight it is still the evening's
    const flipped = await inPage(() => {
      const r = [...document.querySelectorAll('#settings section[data-section="work"] .set-row')].find((x) => { const d = x.querySelector('.what > div'); return d && d.textContent === 'Start my usual shift\'s countdown by itself'; });
      if (r) r.click();
      return Boolean(r);
    });
    const autoOn = await until(() => cfgNow().auto === true, 3000, 100);
    await exec('Settings.close()');
    touched = T;
    await run(at(5, 19, 59, 45), 'working');
    const before = Boolean(shift());
    await run(at(5, 20, 1), 'working');
    const night = shift() && { ...shift() };
    await run(at(6, 1, 10), 'working');
    const evening = w.view();
    check('switched on in Settings, the usual shift\'s countdown starts by itself: at work since before its hours, the night\'s starts at its usual 20:00 with 5h 30m; past midnight it is still the evening\'s',
      flipped && Boolean(autoOn) && !before && Boolean(night) && night.name === 'Night' && night.auto && hm(night.start) === '20:00:00' && hm(night.end) === '01:30:00'
      && evening.shift && evening.shift.name === 'Night' && Boolean(w.state.days['2026-10-05']) && !w.state.days['2026-10-06'],
      JSON.stringify({ flipped, autoOn: Boolean(autoOn), before, night: night && [hm(night.start), hm(night.end)] }));

    // 14. the laptop closed at 01:10 and opened at 08:00: the night's countdown closed at its end, without a late note;
    // the session ended before the sleep; a new one starts when he sits down, and with it the morning's countdown
    await run(at(6, 8, 0), 'asleep');
    touched = T;
    seenBy.push([T, T]);
    await w.tick();
    const closedNight = w.state.days['2026-10-05'].shifts.find((s) => s.name === 'Night');
    check('a sleep through its end closes the countdown at its end, with no late note; the morning brings a new session, and its usual countdown by itself',
      Boolean(closedNight) && hm(closedNight.closed) === '01:30:00' && notes.length === 1 && Boolean(session()) && hm(session().start) === '08:00:00'
      && Boolean(shift()) && shift().name === 'Morning' && shift().auto && hm(shift().start) === '08:00:00',
      JSON.stringify({ night: closedNight && hm(closedNight.closed), notes, session: session() && hm(session().start), now: shift() && [shift().name, hm(shift().start)] }));

    // 15. kept through a restart: a fresh clock on the same file goes on with the same session and countdown
    w.save(true);
    const again = work.fresh({ file: work.file(), cfg: () => settingsNow().work, idle: () => 0, focused: () => false, front: () => null });
    again.load();
    check('kept through a restart: the session going on, the countdown running and the days', Boolean(again.state.shift) && again.state.shift.start === shift().start
      && Boolean(again.state.session) && again.state.session.start === session().start
      && same(Object.keys(again.state.days).sort(), ['2026-10-03', '2026-10-05', '2026-10-06']) && again.state.days['2026-10-03'].shifts.length === 2,
      JSON.stringify(Object.keys(again.state.days)));

    // the clock goes back to the real time, on a record of its own for this run, with its settings as they were
    w.act('end');
    Object.assign(w, { now: Date.now, idle: () => 0, focused: () => false, front: () => null, over: () => {} });
    w.state = { v: 1, shift: null, session: null, ran: [], days: {}, at: 0, seen: 0 };
    w.save(true);
    await inPage(async () => { const next = await desk.settings({ work: { auto: false, gap: 15 } }); Object.assign(Desk.state.settings, next); Desk.paint(); return true; });
    w.changed();
  };

  // The checks were written for the window as the app makes it, 1360 by 860. On a screen smaller than that (a build
  // machine's is 1024 by 768) Windows hands a smaller one over: it gets its size back before anything is looked at.
  const made = win.getContentSize();
  if (made[0] < 1360 || made[1] < 860) {
    win.setContentSize(1360, 860);
    await wait(300);
    say(`      the window came ${made[0]} by ${made[1]} on this screen: made ${win.getContentSize().join(' by ')} for the checks`);
  }

  const only = process.env.DESK_SELFTEST_ONLY || '';
  try {
    if (only === 'look') await lookPhase();
    else if (only === 'keep') await keepPhase();
    else if (only === 'kept') await keptPhase();
    else if (only === 'browser') await browserPhase();
    else if (only === 'viewer') await viewerPhase();
    else if (only === 'work') await workPhase();
    else if (only === 'gpu') await gpuPhase();
    else if (only === 'speed') await speedPhase();
    else if (only === 'float') await floatPhase();
    else if (only === 'notes') await notesPhase();
    else if (only === 'accounts') await accountsPhase();
    else if (only === 'servers') await serversPhase();
    else if (only === 'path') await pathPhase();
    else if (only === 'resets') await resetsPhase();
    else if (only === 'glance') await glancePhase();
    else if (only === 'list') await listPhase();
    else if (only === 'find') await findPhase();
    else if (only === 'record') await recordPhase();
    else if (only === 'nest') await nestPhase();
    else if (only === 'jev') await jevPhase();
    else if (only === 'strip') await stripPhase();
    else if (only === 'reload') await reloadPhase();
    else if (only === 'wins') await winsPhase();
    else if (only === 'leave') await leavePhase();
    else if (only === 'back') await backPhase();
    else if (only === 'picture') await picturePhase();
    else if (only === 'shots') await shotsPhase();
    else if (only === 'redraw') await redrawPhase();
    else if (only === 'git') await gitPhase();
    else if (only === 'gaming') await gamingPhase();
    else {
      await startPhase();
      if (process.env.DESK_SELFTEST_SKIP !== 'states') await statesPhase();
      if (only !== 'states') {
        const sizes = await consolePhase();
        // the workspaces with real consoles are a run of their own: together with the rest, one run would last too long
        if (only === 'spaces') await spacesPhase(sizes);
        else {
          await widthsPhase();
          await twoPhase(sizes);
          if (only !== 'widths') await agentPhase();
        }
      }
    }
  } catch (err) {
    failed++;
    say(`FAIL  self-test stopped: ${err && err.stack ? err.stack : err}`);
  }
  // A 'back' run ends here with its chats open and without the app's own goodbye: for the start after it, that is
  // a run that never reached its end.
  if (only === 'back') {
    notes.shells = chats.list().map((c) => c.pid);
    finish();
    app.exit(failed ? 1 : 0);
    return;
  }
  // A 'picture', 'shots' or 'reload' run closes its consoles the way the app closes any chat, and ends.
  if (only === 'picture' || only === 'shots' || only === 'reload') {
    notes.shells = chats.list().map((c) => c.pid);
    await chats.closeAll();
    finish();
    app.exit(failed ? 1 : 0);
    return;
  }
  let windowClosing = false;
  try {
    windowClosing = await leave();
  } catch (err) {
    failed++;
    say(`FAIL  closing the chat stopped: ${err && err.stack ? err.stack : err}`);
  }
  if (agent.firstFrameAt && !windowClosing) {
    await wait(500);
    const before = notes.fullscreenBefore;
    const after = await until(async () => fullscreenNotes(), 3000, 200);
    notes.fullscreenAfter = after;
    say(`      Claude Code's notes on fullscreen starts for this machine: before ${JSON.stringify(before)}, after ${JSON.stringify(after)}`);
    check('the run left no failed-start mark with Claude Code',
      Boolean(after) && !after.pending.includes(String(agent.pid)) && !after.turnedOff && after.failedStarts <= (before ? before.failedStarts : 0));
  }

  finish();
  if (windowClosing) win.close();
  else app.exit(failed ? 1 : 0);
};
