'use strict';
/* global desk, Terms, Side, Peek, History, Stats, Record, Servers, ChatView, Glance, Picker, Palette, Settings, Cards, Parts, Detail, Reader, Jev, Morning, Noir, h, fill, icon, glyph, kept, held, labelOf, phrase, markOf, folderOf, toast, initTips, acctName, DiskNotes, popMenu, Nest, Browser, Sizes, Shift */
// The window's shell: the title bar, which view is in front (the chats on
// screen, a session looked at from the sidebar, History, the Dashboard or the Servers),
// which chats share the screen and which of them has the keyboard, and the
// wiring between the main process, the terminals and the views.

const state = {
  info: null,
  chats: [],                      // this window's chats, as the main process lists them
  // the watcher's newest picture: every session on the machine, and the accounts it logs in to
  snap: { at: 0, chats: [], ended: [], leaving: [], plan: null, accounts: null },
  // what the programs under every session and every chat take on this computer, as last measured: { sessions, chats, app, all, servers }
  res: null,
  view: 'peek',                   // a full-page view, or the id of the chat that has the keyboard
  shown: [],                      // this window's chats by place: the first ones are on screen, the rest wait in line
  recent: [],                     // this window's chats, the one used last first
  unread: new Set(),              // sessions that finished while nobody was looking at them
  seenWaits: new Map(),           // session -> the wait the person had in front of them ("state|since"): it calls no more
  sel: null,                     // the session looked at in the Peek view: { kind: 'live' | 'ended', key }
  selLeaving: '',                 // that session, while its program is on its way out: looked at again once it shows as ended
  before: new Map(),              // session -> its state in the picture before this one
  usage: null,                    // the watcher's newest sums: 30 days, 48 hours, and the totals of `range`
  range: 'today',                 // what the Dashboard adds up
  armed: new Set(),               // sessions in other terminals that open here once they end over there
  armedAs: new Map(),             // -> what each was called when that was asked, for the line said when it cannot come
  resumed: new Map(),             // conversations being opened here -> when that was asked
  // tiles: how many chats share the screen (1, 2 or 4). split: how many when it was last more than one
  // spaces: workspace folders and session memberships. space: the one in front; also: the others shown
  settings: { notify: {}, fontSize: 16, inspector: false, tiles: 2, split: 2, links: {}, solid: false, accountNames: {}, spaces: [], space: '', also: [], pins: { top: [], space: [] } },
  loose: false,                   // only the chats that are in no workspace are shown (what is still to be sorted)
  seen: true,                     // the window can be seen (in front or not)
  stale: false,                   // the watcher stopped and was not started again: what is shown no longer moves
  frozen: false,                  // the numbers and the measurements are left as they are (the self-test shows made-up ones)
  version: '',                    // newer code on disk: 'reload' (the window can load it) or 'restart' (the app must be reopened)
  nest: false,                    // the Nest is open: the chat that works in the person's record, big, with his day beside it
  nestFrom: '',                   // where the window was when the Nest opened: closing it goes back there
  nestDay: true,                  // his day stands beside the Nest's chat (the panel button there hides it)
};
const $ = (id) => document.getElementById(id);
const RANK = { attention: 0, error: 1, working: 2, compacting: 2, idle: 3 };
const OLD_MS = 3 * 86400e3;
const PLACES = ['peek', 'history', 'stats', 'overview', 'record', 'servers', 'nest', 'settings'];
const isChat = (view) => !PLACES.includes(view);
const isOld = (c) => c.kind === 'bg' && !c.pid && Date.now() - c.at > OLD_MS;
/** Jev switched on: a finished turn it judged as asking the person something, or as stuck. */
const judgedWants = (c) => { const v = Jev.verdict(c); return Jev.waits(v) || Boolean(v && v.level === 'stuck'); };
/** One wait of a session: what it is in, since when. Claude Code writes the time, so it holds over a restart. */
const waitOf = (c) => `${c.state}|${c.since || 0}`;
/** The person had this session in front of them during the wait it is in now. */
const seenWait = (c) => Boolean(c) && state.seenWaits.get(c.key) === waitOf(c);
/** Claude Code itself waits for the person, or stopped on an error (a usage limit has a place of its own). */
const blocked = (c) => (c.state === 'attention' || c.state === 'error') && !(c.limited && c.limit);
/** Waits for the person: Claude Code's own waits until they end, what Jev judged until the person has seen it. */
const wants = (c) => blocked(c) || (judgedWants(c) && !seenWait(c));
/** Calls for the person: a wait nobody has looked at. It glows, it counts, it is said on a note over the other programs. */
const calls = (c) => wants(c) && !seenWait(c);
const SEEN_MAX = 200;
/** The person has this session in front of them: what it waits for now is seen, until it waits for something new. */
function see(c) {
  const w = waitOf(c);
  if (state.seenWaits.get(c.key) === w) return;
  state.seenWaits.delete(c.key);
  state.seenWaits.set(c.key, w);
  if (state.seenWaits.size > SEEN_MAX) state.seenWaits.delete(state.seenWaits.keys().next().value);
}
/** The same for a session known by its key, as long as it is still on the machine. */
function seeKey(key) {
  const c = state.snap.chats.find((x) => x.key === key);
  if (c) see(c);
}

// ---- workspaces: a name, and the folders that belong to it. A chat is in the workspace that lists the folder it
// ---- works in, or the nearest folder above that one. A session can also join other workspaces. ----
const SPACES_MAX = 12;
const pathKey = (p) => String(p || '').replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase();
let folderIndex = { of: null, list: [] };
/** Every folder that is in a workspace, the deepest first: a folder inside another is found before the one around it. */
function foldersByDepth() {
  const spaces = state.settings.spaces || [];
  if (folderIndex.of !== spaces) {
    const list = [];
    for (const s of spaces) for (const f of s.folders) list.push([pathKey(f), s.id, f]);
    list.sort((a, b) => b[0].length - a[0].length);
    folderIndex = { of: spaces, list };
  }
  return folderIndex.list;
}
/** Where a folder is sorted: { id, through } with the workspace and the listed folder that put it there, or null. */
function sortedBy(cwd) {
  const p = pathKey(cwd);
  if (!p) return null;
  for (const [f, id, through] of foldersByDepth()) if (p === f || p.startsWith(`${f}\\`)) return { id, through };
  return null;
}
/** The workspace a folder is in; '' when it is in none. */
const spaceOf = (cwd) => { const s = sortedBy(cwd); return s ? s.id : ''; };
const spaceNow = () => (state.settings.spaces || []).find((s) => s.id === state.settings.space) || null;
/** The folder membership and explicit session memberships, in tab order. */
function spacesOf(cwd, key) {
  const folder = spaceOf(cwd);
  return (state.settings.spaces || []).filter((s) => s.id === folder || (key && (s.sessions || []).includes(key))).map((s) => s.id);
}
function inView(cwd, key) {
  const ids = spacesOf(cwd, key);
  if (state.loose) return !ids.length;
  return !state.settings.space || ids.some((id) => id === state.settings.space || (state.settings.also || []).includes(id));
}
/** Whether one of this window's chats shows in the workspace in front. */
const chatKey = (id) => {
  const chat = state.chats.find((c) => c.id === id);
  const s = state.snap.chats.find((c) => c.chat === id && inView(chat ? chat.cwd : c.cwd, c.key)) || sessionOf(id);
  return s ? s.key : '';
};
const visible = (id) => { const c = state.chats.find((x) => x.id === id); return Boolean(c) && inView(c.cwd, chatKey(id)); };
/** What the workspace in front is called, for the pages that speak of it: null while every chat is shown. */
function spaceWords() {
  if (state.loose) return { name: '', loose: true, empty: false };
  const s = spaceNow();
  return s ? { name: s.name, loose: false, empty: s.folders.length === 0 && !(s.sessions || []).length } : null;
}

/** The session running in one of this window's chats; the one that most needs a look when there are several. */
function sessionOf(chatId) {
  return state.snap.chats.filter((c) => c.chat === chatId).sort((a, b) => RANK[a.state] - RANK[b.state] || b.at - a.at)[0] || null;
}
/** The mark a session is drawn with: what it is doing, and whether it finished unseen (or what Jev made of its end). */
function markFor(s) {
  const seen = seenWait(s);
  const v = seen ? null : Jev.verdict(s);
  if (Jev.waits(v)) return 'needs';
  if (v && v.level === 'stuck') return 'error';
  return markOf(s, Boolean(s && state.unread.has(s.key)), seen);
}
/** What a session is called: its chat's name when it is the one running in a chat of this window. */
function nameOf(c) {
  const chat = c.chat ? state.chats.find((x) => x.id === c.chat) : null;
  return chat && sessionOf(chat.id) === c ? chatLabel(chat) : labelOf(c);
}

function chatLabel(chat) {
  const s = sessionOf(chat.id);
  return chat.title || (s ? labelOf(s) : folderOf(chat.cwd) || 'Chat');
}

// The screen decides, not the session file, which can be a few seconds old: a question with numbered choices would
// take a typed Enter as its answer (one of them can switch on paid usage credits), a chat at work would keep the
// words as its next message, and words the person left in the prompt box would run on into what is typed. Claude
// Code draws its prompt as ❯ under a rule of ─. A fullscreen chat not drawn again since this page started may still
// show an old frame.
const PROMPT = /^\s*[❯>](?:\s|$)/;
const CHOICE = /^\s*[❯>]\s*\d+\.\s/;
const RULE = /^\s*─{8,}/;
/**
 * What the prompt box on a chat's screen holds: 'empty', 'typed' (words in it), or '' when there is no prompt to type
 * at (none drawn, a question with numbered choices, something at work).
 */
function promptBox(chatId) {
  const entry = Terms.get(chatId);
  if (!entry || entry.held || entry.muted || entry.redraw || entry.nudged > Date.now()) return '';
  const b = entry.term.buffer.active;
  const end = b.baseY + entry.term.rows;
  let above = '';
  let at = -1;
  for (let y = b.baseY; y < end; y++) {
    const line = b.getLine(y);
    const text = line ? line.translateToString(true) : '';
    if (CHOICE.test(text) || /esc to interrupt/i.test(text)) return '';
    if (!text.trim()) continue;
    if (PROMPT.test(text) && RULE.test(above)) at = y;
    above = text;
  }
  if (at < 0) return '';
  return typedIn(b, at, end) ? 'typed' : 'empty';
}
const atPrompt = (chatId) => promptBox(chatId) === 'empty';

/** A cell the person did not type: a suggestion drawn faint or grey, or the block of the cursor. */
function untyped(cell) {
  if (cell.isDim() || cell.isInverse()) return true;
  const fg = cell.getFgColor();
  if (cell.isFgPalette()) return fg === 8 || fg >= 232;
  if (!cell.isFgRGB()) return false;
  const rgb = [(fg >> 16) & 255, (fg >> 8) & 255, fg & 255];
  return Math.max(...rgb) - Math.min(...rgb) <= 24 && Math.max(...rgb) <= 180;
}

/**
 * Whether the prompt box that starts on row `at` holds words: on its first line past the marker, and on the lines
 * under it down to the rule that closes the box.
 */
function typedIn(b, at, end) {
  for (let y = at; y < Math.min(end, at + 20); y++) {
    const line = b.getLine(y);
    if (!line) break;
    if (y > at && RULE.test(line.translateToString(true))) break;
    let x = 0;
    if (y === at) {
      while (x < line.length && !(line.getCell(x) || { getChars: () => '' }).getChars().trim()) x++;
      x += 2;
    }
    for (; x < line.length; x++) {
      const cell = line.getCell(x);
      if (cell && cell.getChars().trim() && !untyped(cell)) return true;
    }
  }
  return false;
}

/** A Claude Code chat of this window that waits, idle, at an empty prompt: what is typed into it goes in as the person's next message. */
function canAsk(chatId) {
  const chat = state.chats.find((c) => c.id === chatId);
  const s = sessionOf(chatId);
  return Boolean(chat && !chat.closing && s && s.provider === 'claude' && s.state === 'idle' && atPrompt(chatId));
}
function canCompact(chatId) { return canAsk(chatId); }

/** Types a request into a chat, for the person: the words, then Enter a moment later, so the two never arrive as one paste. */
function askChat(chatId, words) {
  const chat = state.chats.find((c) => c.id === chatId);
  if (!chat || !canAsk(chatId)) { toast('A chat can be asked once its screen shows its prompt, empty, with nothing at work and no question open.', 7000); return false; }
  desk.input(chatId, words);
  setTimeout(() => desk.input(chatId, '\r'), 150);
  toast(`Asked ${chatLabel(chat)}: "${words}"`, 6000);
  return true;
}

/** How a copy of a project stands, in a few words: what is not committed, then what is not pushed. */
function standing(st, remote) {
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
  const changes = st.empty ? 'No commits yet'
    : st.changed || st.fresh ? [st.changed && plural(st.changed, 'file changed', 'files changed'), st.fresh && `${st.fresh} new`].filter(Boolean).join(', ')
      : 'Nothing to commit';
  const away = st.detached ? 'not on a branch'
    : st.gone ? 'its branch on the remote is gone'
      : st.upstream ? [st.ahead && `${plural(st.ahead, 'commit', 'commits')} not pushed`, st.behind && `${st.behind} to pull`].filter(Boolean).join(', ') || 'pushed, up to date'
        : remote ? 'this branch was never pushed' : 'no remote to push to';
  return `${changes} · ${away}`;
}

/**
 * The menu of a chat's project button: the project, how its copy stands, its newest branches (a click puts the copy
 * on one; main refuses under a chat at work or over changes not committed) and what the chat can be asked to do.
 */
async function repoMenu(chatId, target) {
  const chat = state.chats.find((c) => c.id === chatId);
  if (!chat || target.classList.contains('open')) return;
  target.classList.add('open');
  const info = await desk.git(chatId).catch(() => null);
  target.classList.remove('open');
  if (!target.isConnected) return;
  if (!info) { toast('This folder is not in a git project.'); return; }
  const st = info.status;
  const s = sessionOf(chatId);
  const items = [{ heading: `${info.repo}${info.copy ? ` · its own copy, ${info.copy}` : ''}` }, { note: st ? standing(st, info.remote) : 'git could not say how this folder stands.' }, null];
  if (info.self) items.push({ note: 'Lowlit runs from this folder, so its branch is switched with Lowlit closed.' });
  else {
    if (info.busy.length) items.push({ note: `${info.busy[0]} is at work here: the branch can be switched once it has finished.` });
    for (const b of info.branches) {
      const here = Boolean(st && !st.detached && st.branch === b.name);
      items.push({ label: b.elsewhere ? `${b.name} · open in another copy` : b.name, on: here,
        run: () => { if (b.elsewhere) toast(`${b.name} is open in another copy of the project (${b.elsewhere}).`, 7000); else if (!here) switchBranch(chatId, b.name, info.repo); } });
    }
    if (info.more > 0) items.push({ heading: `and ${info.more} older branch${info.more === 1 ? '' : 'es'}` });
  }
  const files = st ? st.changed + st.fresh : 0;
  const asks = [];
  if (files) asks.push({ label: 'Ask it to commit', icon: 'diff', run: () => askChat(chatId, 'Commit the changes with a clear message.') });
  if (files && info.remote) asks.push({ label: 'Ask it to commit and push', icon: 'arrow-up', run: () => askChat(chatId, 'Commit the changes with a clear message, then push.') });
  if (st && !files && info.remote && !st.detached && !st.empty && (st.ahead > 0 || !st.upstream)) {
    asks.push({ label: 'Ask it to push', icon: 'arrow-up', run: () => askChat(chatId, 'Push this branch.') });
  }
  if (asks.length) {
    items.push(null, ...asks);
    if (!s || s.provider !== 'claude') items.push({ note: 'Start Claude Code in this chat to ask it.' });
    else if (!canAsk(chatId)) items.push({ note: 'It can be asked once it waits at an empty prompt.' });
  }
  const r = target.getBoundingClientRect();
  popMenu(r.left, r.bottom + 6, items);
}

async function switchBranch(chatId, name, repo) {
  const r = await desk.gitSwitch(chatId, name).catch(() => null);
  if (r && r.ok) toast(`${repo.split('/').pop()} is on ${name} now.`);
  else toast((r && r.error) || 'The branch was not switched.', 8000);
}

function compactNow(chatId) {
  const chat = state.chats.find((c) => c.id === chatId);
  if (!chat || !canCompact(chatId)) { toast('A chat can be compacted once its screen shows its prompt, empty, with no question open.'); return; }
  desk.input(chatId, '/compact\r');
  toast(`Typed /compact in ${chatLabel(chat)}. It writes a short summary of the chat and goes on from it, which takes a few minutes.`, 7000);
}

function chatSub(chat) {
  if (chat.closing) return 'Closing…';
  const s = sessionOf(chat.id);
  if (s) return phrase(s) || (state.unread.has(s.key) ? 'Finished' : folderOf(chat.cwd));
  const starter = state.info.starters.find((x) => x.id === chat.starter);
  if (!starter || !starter.agent) return 'PowerShell';
  return Date.now() - chat.startedAt < 30000 ? `Starting ${starter.name}…` : starter.name;
}

/** The chats of the workspace in front that run in other terminals and could be moved into this window. */
function movable() {
  const here = new Set(state.chats.map((c) => c.id));
  return state.snap.chats.filter((c) => c.provider === 'claude' && c.pid && c.session && c.kind !== 'bg' && !(c.chat && here.has(c.chat)) && inView(c.cwd, c.key));
}
/** How many of them there are, the ones already on their way here left out. */
const elsewhere = () => movable().filter((c) => !state.armed.has(c.session)).length;

// ---- drawing. Nothing is redrawn while a mouse button is down: a click on a row that is swapped under the
// ---- pointer is lost. A press whose release the window never sees (let go over another window, the window left
// ---- mid-press) would hold every chat's state as it was until the next click: it ends with the next move without a
// ---- button down, when the window is left, and after HOLD_MS whatever happens. A pane that holds selected text
// ---- leaves itself alone (see selectionIn). ----
const HOLD_MS = 4000;
let dirty = false;
let holding = false;
let heldAt = 0;
/** A mouse button is down in the window, as far as the window can tell. */
const buttonDown = () => holding && Date.now() - heldAt < HOLD_MS;

function paint() {
  if (buttonDown() || hintsUp()) { dirty = true; return; }
  holding = false;
  dirty = false;
  drawBar();
  drawCrumb();
  Side.render(state);
  drawNotes();
  Morning.render();
  const chat = state.chats.find((c) => c.id === state.view);
  document.title = chat ? `${chatLabel(chat)} · Lowlit` : 'Lowlit';
  if (state.view === 'peek') Peek.render(state);
  else if (state.view === 'history') History.render(state);
  else if (state.view === 'stats') Stats.render(state);
  else if (state.view === 'record') Record.render(state);
  else if (state.view === 'servers') Servers.render(state);
  else if (state.view === 'overview') Glance.render(state);
  else if (state.view === 'settings') Settings.render();
  else ChatView.render(state);
  Glance.update(state);
  Nest.render(state);
  // the Nest's mood: the window's colours while it is open (nest.css), its chat's terminal whenever that one shows
  const mood = Nest.mood(state);
  document.documentElement.dataset.nest = state.nest ? mood : '';
  for (const c of state.chats) Terms.setTheme(c.id, mood && inNest(c) ? Nest.term(mood) : null);
  // the Browser turns to the newest page of the chat now in front, if it has one; then the Viewer, which gives it way
  Browser.follow(state);
  Viewer.follow();
  $('brand').classList.toggle('on', state.nest);
  $('brand').setAttribute('aria-pressed', String(state.nest));
  $('go-overview').classList.toggle('on', state.view === 'overview');
  $('go-overview').setAttribute('aria-pressed', String(state.view === 'overview'));
  floatCard();
}

/** The small mark on the taskbar button: how many sessions want the person. */
let badgeShown = -1;
function badge(n) {
  if (n === badgeShown) return;
  badgeShown = n;
  if (!n) { desk.badge('', '', 0); return; }
  const c = document.createElement('canvas');
  c.width = 32;
  c.height = 32;
  const g = c.getContext('2d');
  g.fillStyle = '#f5a524';
  g.beginPath();
  g.arc(16, 16, 15, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#1a1205';
  g.font = '700 20px "Segoe UI", sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(n > 9 ? '9+' : String(n), 16, 17);
  desk.badge(c.toDataURL('image/png'), `${n} waiting for you`, n);
}

/** The title bar: how many sessions wait for the person, and how many chats share the screen. */
function drawBar() {
  const needs = state.snap.chats.filter((c) => calls(c) && !isOld(c)).length;
  badge(needs);
  Noir.setWarm(needs > 0);
  const tri = $('triage');
  tri.hidden = needs === 0;
  if (needs && tri.dataset.n !== String(needs)) {
    tri.dataset.n = String(needs);
    fill(tri, glyph('needs', 13), h('span', { text: `${needs} need${needs === 1 ? 's' : ''} you` }));
  }
  for (const b of $('split').children) {
    if (!b.dataset.n) continue;
    const on = state.view !== 'overview' && Number(b.dataset.n) === state.settings.tiles;
    b.classList.toggle('on', on);
    b.setAttribute('aria-pressed', String(on));
  }
}

// ---- the head of the window, as T3 Code has it: where the person is first (the workspace, else the folder), then
// ---- the chat with what it is doing, then the branch it works on ----
const VIEW_NAMES = { stats: 'Dashboard', history: 'History', record: 'Record', overview: 'Every chat at a glance', settings: 'Settings', servers: 'Servers' };
function chatMenu(chat, x, y) {
  popMenu(x, y, [
    { label: 'Rename', icon: 'pencil', run: () => { setView(chat.id); ChatView.rename(); } },
    { label: 'Open its folder', icon: 'folder', run: () => desk.openFolder(chat.cwd) },
    { label: 'New chat, this folder first', icon: 'plus', key: 'Ctrl Shift T', run: openPicker },
    canCompact(chat.id) && { label: Jev.ready(sessionOf(chat.id)) ? 'Compact now: its job is done' : 'Compact now', icon: 'compact', run: () => compactNow(chat.id) },
    { label: state.settings.inspector ? 'Hide the panel beside it' : 'Show the panel beside it', icon: 'panel', key: 'Ctrl Shift I', run: () => setInspector(!state.settings.inspector) },
    null,
    { label: 'Close this chat', icon: 'x', key: 'Ctrl Shift W', danger: true, run: () => closeChat(chat.id) },
  ].filter((it) => it !== false));
}
/** The head of the window in the Nest: its name, then what its chat is doing. */
function drawNestCrumb(el) {
  const chat = isChat(state.view) ? state.chats.find((c) => c.id === state.view) || null : null;
  const s = chat ? sessionOf(chat.id) : null;
  const doing = s ? phrase(s) : '';
  const stamp = JSON.stringify(['nest', chat && chat.id, s && markFor(s), doing]);
  if (el.dataset.stamp === stamp) return;
  el.dataset.stamp = stamp;
  fill(el, h('span', { class: 'cb-view cb-nest', text: 'Nest' }),
    chat && h('span', { class: 'cb-sep', text: '/', 'aria-hidden': 'true' }),
    chat && h('span', { class: 'cb-chat still', tip: chat.cwd }, glyph(markFor(s), 12), h('span', { class: 'cb-title', text: doing || chatLabel(chat) })));
}
function drawCrumb() {
  const el = $('crumb');
  if (state.nest) { drawNestCrumb(el); return; }
  const chat = isChat(state.view) ? state.chats.find((c) => c.id === state.view) || null : null;
  const sel = state.view === 'peek' && state.sel ? state.sel : null;
  const s = chat ? sessionOf(chat.id) : sel && sel.kind === 'live' ? state.snap.chats.find((c) => c.key === sel.key) || null : null;
  const e = sel && sel.kind === 'ended' ? (state.snap.ended || []).find((x) => x.id === sel.key) || null : null;
  const cwd = chat ? chat.cwd : s ? s.cwd : e ? e.cwd : '';
  const spaces = state.settings.spaces || [];
  const home = cwd ? spaces.find((x) => x.id === (spaceOf(cwd) || spacesOf(cwd, s ? s.key : '')[0])) || null : null;
  const now = spaceNow();
  const title = chat ? chatLabel(chat) : s ? labelOf(s) : e ? labelOf(e) : VIEW_NAMES[state.view] || (state.loose ? 'Unsorted' : now ? now.name : 'Every chat');
  const mark = chat || s ? markFor(s) : e ? 'ended' : '';
  const g = s && s.git;
  const stamp = JSON.stringify([state.view, chat && chat.id, title, mark, cwd, home && [home.id, home.name, home.color], g && [g.branch, g.copy], s && phrase(s)]);
  if (el.dataset.stamp === stamp) return;
  el.dataset.stamp = stamp;
  if (!cwd) { fill(el, h('span', { class: 'cb-view', text: title })); return; }
  const place = h('button', { class: 'cb-place', tip: `New chat, with this folder first\n${cwd}`, onclick: openPicker },
    home ? [h('span', { class: `ws-tile ws-${Side.colorOf(home, spaces)}`, text: Array.from(home.name)[0] || '', 'aria-hidden': 'true' }), h('span', { class: 'cb-name', text: home.name })]
      : h('span', { class: 'cb-name', text: folderOf(cwd) }));
  const doing = s ? phrase(s) : e ? 'Ended' : '';
  const name = chat
    ? h('button', { class: 'cb-chat', 'aria-haspopup': 'menu', tip: `${title}${doing ? `\n${doing}` : ''}\nClick for what you can do with it, double-click to rename it.`,
      onclick: (ev) => { const r = ev.currentTarget.getBoundingClientRect(); chatMenu(chat, r.left, r.bottom + 6); },
      ondblclick: () => ChatView.rename(),
      oncontextmenu: (ev) => { ev.preventDefault(); chatMenu(chat, ev.clientX, ev.clientY); } },
    glyph(mark, 12), h('span', { class: 'cb-title', text: title }), icon('chevron-down', 12, 'cb-more'))
    : h('span', { class: 'cb-chat still', tip: `${title}${doing ? `\n${doing}` : ''}` }, glyph(mark, 12), h('span', { class: 'cb-title', text: title }));
  // a chat open here has its project and branch on its own strip; a session only looked at has them here
  fill(el, place, h('span', { class: 'cb-sep', text: '/', 'aria-hidden': 'true' }), name,
    !chat && g && g.branch && h('span', { class: 'cb-branch', tip: `Branch ${g.branch} · ${g.copy ? `its own copy, ${g.copy}` : 'the main copy of the repository'}` },
      h('span', { class: 'cb-k', text: 'Branch' }), h('span', { class: 'cb-v', text: g.branch }), g.copy && h('span', { class: 'cb-k', text: 'own copy' })));
}

/** The look picked in Settings: Noir (black, with its light) or grey (the one before). The terminals take its ground. */
function applyLook(s) {
  const noir = s.look !== 'grey';
  document.documentElement.dataset.look = noir ? 'noir' : 'grey';
  // what moves on its own (the Nest's lights) stands still with the light
  document.documentElement.dataset.motion = s.motion === false ? 'off' : 'on';
  Terms.setGround(getComputedStyle(document.documentElement).getPropertyValue('--panel').trim());
  Noir.setMoving(s.motion !== false);
  Noir.setOn(noir);
}

/** Said when another account logs in (the person typed /login in some chat). */
function sayLogin() {
  const v = Parts.acctView(state);
  if (!v.me) { toast('Claude Code is logged out on this machine.', 8000); return; }
  const words = Parts.restingWords(v.me);
  toast(`Now on ${acctName(v.me, v.names)}. ${words.length ? `When last seen: ${words.join(', ')}.` : 'Its limits show with the next reply.'}`, 9000);
}

// ---- what stands above every view while it matters: the part that reads the files has stopped, chats are on
// ---- their way here from other terminals, last time's chats are on offer ----
const notes = { stale: null, armed: null, reopen: null };
function initNotes(root) {
  notes.stale = h('div', { class: 'callout warn', hidden: true }, icon('alert', 16),
    h('div', null,
      h('div', { class: 'callout-title', text: 'The list of chats stopped updating' }),
      h('div', { class: 'callout-text', text: "The part of the app that reads Claude Code's files stopped several times in a row. The chats in this window are not affected." })),
    h('div', { class: 'callout-acts' }, h('button', { class: 'btn', text: 'Start it again', onclick: () => { state.stale = false; desk.watchAgain(); paint(); toast('Starting it again…'); } })));
  notes.armed = h('div', { class: 'callout', hidden: true });
  notes.reopen = h('div', { class: 'callout', hidden: true });
  root.append(notes.stale, notes.armed, notes.reopen);
}
function drawNotes() {
  notes.stale.hidden = !state.stale;
  const n = state.armed.size;
  notes.armed.hidden = n === 0;
  if (n && notes.armed.dataset.stamp !== String(n)) {
    notes.armed.dataset.stamp = String(n);
    fill(notes.armed, icon('bring', 16),
      h('div', null,
        h('div', { class: 'callout-title', text: `${n} chat${n === 1 ? '' : 's'} will open here as soon as you close ${n === 1 ? 'it' : 'them'} over there` }),
        h('div', { class: 'callout-text', text: 'In its own window: type /exit and press Enter, or close the tab. A chat that is still working loses the answer in progress, so let it finish first.' })),
      h('div', { class: 'callout-acts' }, h('button', { class: 'btn', text: 'Cancel', onclick: () => disarm() })));
  }
  DiskNotes.update($('notes'), state);
  Parts.tick($('notes'));
}
/** The offer to bring back the chats that were open when the app was last closed; null takes it away. */
function banner(previous) {
  notes.reopen.hidden = !previous || !previous.length;
  if (notes.reopen.hidden) return;
  const names = previous.map((p) => p.title || folderOf(p.cwd)).filter(Boolean);
  fill(notes.reopen, icon('history', 16),
    h('div', null,
      h('div', { class: 'callout-title', text: `Reopen the ${previous.length} chat${previous.length === 1 ? '' : 's'} from last time?` }),
      h('div', { class: 'callout-text', text: names.join(' · ') })),
    h('div', { class: 'callout-acts' },
      h('button', { class: 'btn primary', text: 'Reopen', onclick: () => reopen('') }),
      h('button', { class: 'btn ghost', text: 'Not now', onclick: () => { state.info.previous = []; banner(null); desk.previousDone(); } })));
}

// ---- which chats are on screen. One, two or four share it; each keeps its place, so the eye finds it again.
// ---- A chat without a place takes the one of the chat used longest ago. ----
/** The chats on screen right now, by place: one when a chat is big, else as many as share the screen. */
function onScreen() {
  if (!isChat(state.view)) return [];
  // the Nest shows its own chat, big; outside it, the record's chats keep out of the chats side by side
  if (state.nest) return [state.view];
  return state.settings.tiles === 1 ? [state.view] : state.shown.filter((id) => visible(id) && !nestId(id)).slice(0, state.settings.tiles);
}
/**
 * Where the window rests when nothing in particular is asked for: the chat of the workspace in front that was
 * used last, or the start page when none of its chats is open here.
 */
function rest() {
  // the record's chats live in the Nest: a chat that goes away never hands the window over to one of them
  const last = state.recent.find((id) => visible(id) && !nestId(id));
  if (last) return last;
  const any = state.chats.find((c) => inView(c.cwd, chatKey(c.id)) && !inNest(c));
  return any ? any.id : 'peek';
}
const touch = (id) => { state.recent = [id, ...state.recent.filter((x) => x !== id)]; };

/**
 * Gives a chat a place on screen. One that has none takes the place of the chat used longest ago, so the others
 * stay where they are. A place that fell empty (its chat was closed) goes to the chat that waits first in line.
 * While one chat is big the places are kept as they were, for when the chats stand side by side again.
 * The places are those of the workspace in front: the chats of the others keep the order they stand in.
 */
function seat(id) {
  // the record's chats are shown in the Nest only: they take no place among the chats side by side
  const alive = new Set(state.chats.filter((c) => inView(c.cwd, chatKey(c.id)) && !inNest(c)).map((c) => c.id));
  const others = state.chats.map((c) => c.id).filter((x) => !alive.has(x));
  const order = state.shown.filter((x) => !others.includes(x));
  const places = state.settings.tiles === 1 ? state.settings.split : state.settings.tiles;
  const on = order.slice(0, places).map((x) => (alive.has(x) ? x : ''));
  let line = order.slice(places).filter((x) => alive.has(x));
  if (id && alive.has(id) && !on.includes(id)) {
    line = line.filter((x) => x !== id);
    const hole = on.indexOf('');
    if (hole >= 0) on[hole] = id;
    else if (on.length < places) on.push(id);
    else {
      const age = (x) => { const i = state.recent.indexOf(x); return i < 0 ? Infinity : i; };
      let worst = 0;
      for (let i = 1; i < on.length; i++) if (age(on[i]) > age(on[worst])) worst = i;
      line.unshift(on[worst]);
      on[worst] = id;
    }
  }
  const spare = [...line, ...state.recent, ...state.chats.map((c) => c.id)].filter((x, i, all) => alive.has(x) && !on.includes(x) && all.indexOf(x) === i);
  for (let i = 0; i < on.length; i++) if (!on[i]) on[i] = spare.shift() || '';
  const placed = on.filter(Boolean);
  while (placed.length < places && spare.length) placed.push(spare.shift());
  const elsewhereOrder = [...state.shown.filter((x) => others.includes(x)), ...others.filter((x) => !state.shown.includes(x))];
  state.shown = [...placed, ...spare, ...elsewhereOrder];
}

// ---- which workspace is in front ----
/** What is asked for works in this folder: when the workspace in front does not hold it, the one that does comes in front. */
function follow(cwd, key) {
  if (inView(cwd, key)) return;
  state.loose = false;
  state.settings.space = spaceOf(cwd) || spacesOf(cwd, key)[0] || '';
  state.settings.also = [];
  desk.settings({ space: state.settings.space, also: [] });
}

/**
 * Brings a workspace in front ('' for every chat; loose: only what is in no workspace yet). Its chats take the
 * screen in the places they had; with none of them open here, its start page shows.
 */
function switchSpace(id, loose = false) {
  const s = state.settings;
  const next = !loose && s.spaces.some((x) => x.id === id) ? id : '';
  if (next === s.space && loose === state.loose && !(s.also || []).length) {
    // already in front: a click on its tab still leads from History or the Dashboard back to its chats
    if (!isChat(state.view) && !(state.view === 'peek' && !state.sel)) setView(rest());
    return;
  }
  state.loose = loose;
  if (next !== s.space || (s.also || []).length) {
    s.space = next;
    s.also = [];
    desk.settings({ space: next, also: [] });
  }
  // a session that was being looked at stays with the workspace that is left, and counts as seen
  if (state.sel && state.sel.kind === 'live') { state.unread.delete(state.sel.key); seeKey(state.sel.key); }
  state.sel = null;
  lookFrom = '';
  setView(rest());
}

function toggleSpace(id) {
  const s = state.settings;
  if (!s.spaces.some((x) => x.id === id)) return;
  if (!s.space || state.loose) { switchSpace(id); return; }
  const shown = [s.space, ...(s.also || [])];
  const next = shown.includes(id) ? shown.filter((x) => x !== id) : [...shown, id];
  s.space = next.shift() || '';
  s.also = next;
  desk.settings({ space: s.space, also: s.also });
  resettle();
}

/** After the workspaces changed: what is on screen is what the workspace in front holds. */
function resettle() {
  // nothing is left to sort: the list of unsorted chats gives way to every chat
  if (state.loose && !state.snap.chats.some((c) => !spacesOf(c.cwd, c.key).length) && !state.chats.some((c) => !spacesOf(c.cwd, chatKey(c.id)).length)) state.loose = false;
  if (isChat(state.view)) { setView(visible(state.view) ? state.view : rest()); return; }
  if (state.view === 'peek') {
    const sel = state.sel;
    const at = sel && (sel.kind === 'live' ? state.snap.chats.find((c) => c.key === sel.key) : (state.snap.ended || []).find((e) => e.id === sel.key));
    if (!sel || (at && !inView(at.cwd, at.key || at.id))) { state.sel = null; setView(rest()); return; }
  }
  paint();
}

function saveSpaces(next) {
  const s = state.settings;
  s.spaces = next;
  if (s.space && !next.some((x) => x.id === s.space)) s.space = '';
  s.also = s.space ? (s.also || []).filter((id) => id !== s.space && next.some((x) => x.id === id)) : [];
  // with no workspace left there is nothing to be sorted into
  if (!next.length) state.loose = false;
  desk.settings({ spaces: next, space: s.space, also: s.also });
}
function colorSpace(id, color) {
  saveSpaces(state.settings.spaces.map((s) => s.id === id ? { ...s, color } : s));
  paint();
}
function putSession(key, id, cwd) {
  if (!key || spaceOf(cwd) === id) return;
  saveSpaces(state.settings.spaces.map((s) => {
    if (s.id !== id) return s;
    const keys = s.sessions || [];
    return { ...s, sessions: keys.includes(key) ? keys.filter((k) => k !== key) : [...keys, key].slice(-200) };
  }));
  resettle();
}
function pin(key, kind) {
  if (!key || !['top', 'space'].includes(kind)) return;
  const pins = { top: [], space: [], ...state.settings.pins };
  pins[kind] = pins[kind].includes(key) ? pins[kind].filter((k) => k !== key) : [...pins[kind], key].slice(-40);
  state.settings.pins = pins;
  desk.settings({ pins });
  paint();
}
const spaceName = (name) => String(name || '').replace(/\s+/g, ' ').trim().slice(0, 24);

/** A new workspace, brought in front. Returns its id; '' when it has no name, or there are as many as fit. */
function addSpace(name) {
  const tidy = spaceName(name);
  const s = state.settings;
  if (!tidy) return '';
  if (s.spaces.length >= SPACES_MAX) { toast(`${SPACES_MAX} workspaces is as many as fit. Take one away first.`); return ''; }
  let id = '';
  do { id = `w${Date.now().toString(36)}${Math.floor(Math.random() * 36).toString(36)}`; } while (s.spaces.some((x) => x.id === id));
  saveSpaces([...s.spaces, { id, name: tidy, folders: [] }]);
  switchSpace(id);
  return id;
}
function renameSpace(id, name) {
  const tidy = spaceName(name);
  if (!tidy) return;
  saveSpaces(state.settings.spaces.map((x) => (x.id === id ? { ...x, name: tidy } : x)));
  paint();
}
/** Takes a workspace away. Its chats are not touched: they show under every chat again, unsorted. */
function removeSpace(id) {
  saveSpaces(state.settings.spaces.filter((x) => x.id !== id));
  resettle();
}

/**
 * Puts a folder in a workspace; '' takes it out of the one that lists it. Every chat that works in it, or in a
 * folder inside it, goes along, now and later.
 */
function putFolder(cwd, id) {
  const key = pathKey(cwd);
  if (!key) return;
  const s = state.settings;
  const by = sortedBy(cwd);
  if (!id) {
    if (!by) return;
    // it is in a workspace through a folder above it: that one is not taken out behind the person's back
    if (pathKey(by.through) !== key) {
      const name = (s.spaces.find((x) => x.id === by.id) || {}).name || 'a workspace';
      toast(`"${folderOf(cwd)}" is in ${name} because ${by.through} is. Put it in another workspace, or take that folder out in Settings.`, 9000);
      return;
    }
  } else if ((by && by.id === id) || !s.spaces.some((x) => x.id === id)) {
    // already there, itself or through a folder above it; or a workspace that is gone
    return;
  }
  const next = s.spaces.map((x) => ({ ...x, folders: x.folders.filter((f) => pathKey(f) !== key) }));
  const to = next.find((x) => x.id === id);
  if (to) to.folders.push(folderAs(cwd));
  saveSpaces(next);
  // Said, because under "All" nothing else shows that it happened. Taken out of one workspace, a folder can
  // still be in another through a folder above it: what is said is where it is now.
  const now = sortedBy(cwd);
  const home = now && s.spaces.find((x) => x.id === now.id);
  toast(!home ? `"${folderOf(cwd)}" is in no workspace now.`
    : pathKey(now.through) === key ? `"${folderOf(cwd)}" is now part of ${home.name}.`
      : `"${folderOf(cwd)}" is now part of ${home.name}, because ${now.through} is.`, 5000);
  resettle();
}
/** A folder as it is kept: backslashes, none at the end; a whole drive keeps its one. */
function folderAs(cwd) {
  const f = String(cwd).replace(/\//g, '\\').replace(/\\+$/, '');
  return /^[a-z]:$/i.test(f) ? `${f}\\` : f;
}

/** A chat was started in a folder that is in no workspace, while one is in front: the folder joins that workspace. */
function adopt(cwd) {
  const now = spaceNow();
  if (!now || state.loose || !cwd || spaceOf(cwd)) return;
  const next = state.settings.spaces.map((x) => (x.id === now.id ? { ...x, folders: [...x.folders, folderAs(cwd)] } : x));
  saveSpaces(next);
  toast(`"${folderOf(cwd)}" is now part of ${now.name}.`, 5000);
}

// ---- the Nest: the chat that works in the person's record (where his days are talked over), big, with what only he
// ---- can do, the dates coming up and the chats that wait for him beside it. Its key works from any program (main.cjs).
let nestWanted = '';
/** The folders a chat must work in to be the Nest's, as path keys: the record's folder, and where it really is. */
const nestKeys = () => [...new Set([...((state.info && state.info.nest && state.info.nest.folders) || []),
  state.settings.record && state.settings.record.folder].filter(Boolean).map(pathKey))];
/** A chat that works in the record's folder itself. */
const inNest = (chat) => Boolean(chat) && nestKeys().includes(pathKey(chat.cwd));
const nestId = (id) => inNest(state.chats.find((c) => c.id === id));
/** The Nest's chat: the one of this window that works in the record (the one used last, if several); null when none does. */
function nestChat() {
  const used = (c) => { const i = state.recent.indexOf(c.id); return i < 0 ? Infinity : i; };
  return state.chats.filter((c) => !c.closing && inNest(c)).sort((a, b) => used(a) - used(b))[0] || null;
}
function openNest() {
  if (!state.nest) state.nestFrom = state.view;
  state.nest = true;
  const chat = nestChat();
  setView(chat ? chat.id : 'nest');
}
/** byKey: closed with its key, so a window the key brought up goes back to how it was (main.cjs, desk:nest-left). */
function leaveNest(byKey = false) {
  if (!state.nest) return;
  const from = state.nestFrom;
  state.nest = false;
  state.nestFrom = '';
  setView(from && from !== 'nest' && (PLACES.includes(from) || (state.chats.some((c) => c.id === from) && !nestId(from))) ? from : rest());
  // main is told either way (a page older than the app's bridge has no such call)
  if (desk.nestLeft) desk.nestLeft(byKey);
}
const toggleNest = (byKey = false) => (state.nest ? leaveNest(byKey) : openNest());
/**
 * A new chat in the record's folder, named Nest so the list says which one it is. Always Claude Code: the person's
 * usual way of starting it when that is one, else his own function for it, else the plain command (main's claudeStarter).
 */
async function startNest(folder) {
  const list = state.info.starters || [];
  const via = list.find((s) => s.id === state.info.starter && s.agent === 'claude')
    || list.find((s) => s.agent === 'claude' && s.id !== 'claude') || list.find((s) => s.agent === 'claude');
  const chat = await desk.create({ cwd: folder, starter: via ? via.id : undefined, title: 'Nest', named: true });
  if (!chat || chat.error) { toast(chat && chat.error ? chat.error : "The Nest's chat could not be started.", 8000); return; }
  nestWanted = chat.id;
  if (state.nest) setView(chat.id);
}

// ---- views ----
/** walking: the person is stepping through the chats used last (Ctrl with Tab): which one was used last is settled when they stop. */
function setView(view, { walking = false } = {}) {
  if (view !== state.view) didThis(isChat(view) ? 'switching chats' : `opening the ${view} page`);
  // asked for a moment before the main process has listed it (a chat just made): it is shown as soon as it is
  wanted = isChat(view) && !state.chats.some((c) => c.id === view) ? view : '';
  // the Nest's chat, just started, is waited for in the Nest
  if (wanted) view = state.nest && wanted === nestWanted ? 'nest' : rest();
  // a chat that works in the record is shown in the Nest, wherever it was picked: the list, Ctrl Tab, a note by the clock
  if (!state.nest && isChat(view) && nestId(view)) { state.nestFrom = nestId(state.view) ? '' : state.view; state.nest = true; }
  // anything but the Nest's own page or a chat that works in the record closes the Nest
  if (state.nest && view !== 'nest' && !(isChat(view) && inNest(state.chats.find((c) => c.id === view)))) {
    state.nest = false;
    state.nestFrom = '';
    if (desk.nestLeft) desk.nestLeft(false);
  }
  // the Nest's page is the Nest open, however it was asked for
  if (view === 'nest') state.nest = true;
  if (view !== state.view) Glance.hide();
  // a chat of another workspace was asked for: that workspace comes in front with it. The Nest stands apart from them.
  if (isChat(view) && !state.nest) follow(state.chats.find((c) => c.id === view).cwd, chatKey(view));
  // a session is looked at only while its page is in front
  if (view !== 'peek') state.sel = null;
  state.view = view;
  if (isChat(view)) {
    if (!walking) touch(view);
    seat(view);
  }
  $('peek').hidden = view !== 'peek';
  $('history').hidden = view !== 'history';
  $('stats').hidden = view !== 'stats';
  $('record').hidden = view !== 'record';
  $('nest').hidden = view !== 'nest';
  $('servers').hidden = view !== 'servers';
  Servers.show(view === 'servers');
  $('settings').hidden = view !== 'settings';
  Settings.show(view === 'settings');
  $('overview').hidden = view !== 'overview';
  // the places must have their size before a terminal is fitted to them
  $('chat').hidden = !isChat(view);
  // in the Nest its column stands where the panel beside a chat would
  $('inspector').hidden = !state.settings.inspector || state.nest;
  ChatView.place(state, onScreen());
  for (const c of state.snap.chats) if (c.chat === view) { state.unread.delete(c.key); see(c); }
  if (!isChat(view)) refreshUsage(view === 'stats');
  // the chat that has the keyboard has it again next time
  const front = isChat(view) ? view : '';
  if (front !== frontSaid) { frontSaid = front; desk.front(front); }
  paint();
  // a panel beside the chats came or went, or a browser: the window is shared out again
  Sizes.fit();
}
let frontSaid = '';
let wanted = '';

/** How many chats share the screen: 1, 2 or 4. */
function setTiles(n) {
  if (![1, 2, 4].includes(n) || n === state.settings.tiles) return;
  state.settings.tiles = n;
  if (n > 1) state.settings.split = n;
  desk.settings({ tiles: state.settings.tiles, split: state.settings.split });
  if (isChat(state.view)) setView(state.view); else paint();
}
/** Every chat at a glance, or back to the chat used last. */
const toggleOverview = () => setView(state.view === 'overview' ? rest() : 'overview');
/** One chat big, or back to the chats side by side. */
const toggleBig = () => setTiles(state.settings.tiles === 1 ? state.settings.split : 1);

// Back to the chat used before this one. Held down, Ctrl with Tab walks further back, the way Alt with Tab walks
// through windows; which chat counts as used last is settled when Ctrl is let go. The walk stays inside the
// workspace in front.
let walk = null;
function back(step) {
  if (!walk) {
    const list = state.recent.filter(visible);
    for (const c of state.chats) if (inView(c.cwd, chatKey(c.id)) && !list.includes(c.id)) list.push(c.id);
    if (!list.length) return;
    walk = { list, at: isChat(state.view) ? list.indexOf(state.view) : -1 };
  }
  const n = walk.list.length;
  walk.at = walk.at < 0 ? (step > 0 ? 0 : n - 1) : (walk.at + step + n) % n;
  setView(walk.list[walk.at], { walking: true });
}
function endWalk() {
  if (!walk) return;
  walk = null;
  if (isChat(state.view)) touch(state.view);
}

// ---- numbers to go by (his ask, 4 Oct). Ctrl held alone shows a number on each chat of the list, Ctrl with Shift on
// ---- each workspace tab; that number pressed with them goes there. They show after a moment, so a quick Ctrl C never
// ---- flashes them, and nothing in the list moves while they show: the number seen is the number pressed. ----
const HINT_MS = 450;
const HINT_MAX_MS = 20000;
const hints = { shown: '', timer: 0, until: 0, layer: null };

/** What Ctrl (chats) or Ctrl Shift (spaces) with 1 to 9 goes to, in order: [{ n, el, go }]. */
function numbered(kind) {
  if (kind === 'spaces') {
    const spaces = state.settings.spaces || [];
    if (!spaces.length) return [];
    const ids = ['', ...spaces.map((s) => s.id)];
    if ($('spaces').querySelector('.space-tab[data-space="?"]')) ids.push('?');
    return ids.slice(0, 9).map((id, i) => ({ n: i + 1, el: $('spaces').querySelector(`.space-tab[data-space="${CSS.escape(id)}"]`), go: () => switchSpace(id === '?' ? '' : id, id === '?') }));
  }
  // the rows by the numbers the list gave them (side.js), going where a click on them goes
  return [...$('chat-list').querySelectorAll('.nav-item.chat')].filter((el) => el.dataset.num).sort((a, b) => a.dataset.num - b.dataset.num)
    .map((el) => ({ n: Number(el.dataset.num), el, go: () => el.click() }));
}
/** The number Ctrl goes to a chat of this window with; 0 when it has none. */
function chatNumber(id) {
  const t = numbered('chats').find((x) => x.el.dataset.id === id);
  return t ? t.n : 0;
}

/** Ctrl alone ('chats') or Ctrl with Shift ('spaces') is held: its numbers show in a moment, at once if others show. */
function armHints(kind) {
  clearTimeout(hints.timer);
  hints.timer = 0;
  // Ctrl is held for a walk back through the chats (Ctrl Tab): that is what it is for
  if (walk) { hideHints(); return; }
  if (hints.shown) { showHints(kind); return; }
  hints.timer = setTimeout(() => { hints.timer = 0; showHints(kind); }, HINT_MS);
}
function showHints(kind) {
  if (Picker.isOpen() || Palette.isOpen() || leaveOpen() || !$('menu').hidden) { hideHints(); return; }
  const box = kind === 'chats' ? $('chat-list').getBoundingClientRect() : null;
  const marks = numbered(kind).map((t) => {
    const r = t.el ? t.el.getBoundingClientRect() : null;
    if (!r || !r.width || !r.height || (box && (r.bottom < box.top + 6 || r.top > box.bottom - 6))) return null;
    // on a chat its number stands over its mark; on a tab, under the middle of its name
    const at = kind === 'chats' && t.el.firstElementChild ? t.el.firstElementChild.getBoundingClientRect() : null;
    const x = at ? at.left + at.width / 2 : r.left + r.width / 2;
    const y = at ? at.top + at.height / 2 : r.bottom;
    return h('span', { class: 'key-hint', text: String(t.n), style: `left:${Math.round(x - 9)}px;top:${Math.round(y - 9)}px` });
  }).filter(Boolean);
  // nothing to number where it can be seen (the list put away, no workspaces): the keys still go by the same numbers
  if (!marks.length) { hideHints(); return; }
  if (!hints.layer) { hints.layer = h('div', { class: 'key-hints', 'aria-hidden': 'true' }); document.body.append(hints.layer); }
  fill(hints.layer, ...marks);
  hints.shown = kind;
  hints.until = Date.now() + HINT_MAX_MS;
  hints.layer.hidden = false;
}
function hideHints() {
  clearTimeout(hints.timer);
  hints.timer = 0;
  if (!hints.shown) return;
  hints.shown = '';
  hints.layer.hidden = true;
  if (dirty) setTimeout(paint, 0);
}
/** The list stands still while the numbers show, for HINT_MAX_MS at most (a Ctrl let go where the window never heard it). */
const hintsUp = () => Boolean(hints.shown) && Date.now() < hints.until;

/**
 * Looks at a session that does not live in this window, or at a conversation that ended: its page takes the
 * panel. null: back to where the look began (History or the Dashboard), else to the chats. A session that
 * finished unseen counts as seen once the person moves on from it.
 */
let lookFrom = '';
function look(sel) {
  const was = state.sel;
  if (was && was.kind === 'live' && !(sel && sel.kind === 'live' && sel.key === was.key)) { state.unread.delete(was.key); seeKey(was.key); }
  if (!sel) {
    const to = lookFrom || rest();
    lookFrom = '';
    state.sel = null;
    setView(to);
    return;
  }
  if (state.view !== 'peek') lookFrom = state.view === 'history' || state.view === 'stats' ? state.view : '';
  // one of another workspace: that workspace comes in front with it, so the list on the left holds it
  const at = sel.kind === 'live' ? state.snap.chats.find((c) => c.key === sel.key) : (state.snap.ended || []).find((e) => e.id === sel.key);
  if (at) follow(at.cwd, at.key || at.id);
  state.sel = sel;
  setView('peek');
}

/** Shows one session wherever it is: its terminal when it runs in a chat here, its page when it runs elsewhere. */
function showSession(key) {
  const c = state.snap.chats.find((x) => x.key === key);
  const chat = c && c.chat ? state.chats.find((x) => x.id === c.chat) : null;
  // the record's chat opens in the Nest, which stands apart from the workspaces
  if (chat) { if (!inNest(chat)) follow(chat.cwd, key); setView(chat.id); } else look({ kind: 'live', key });
  // a redraw held back by a click in progress would leave the row as it was
  setTimeout(() => { paint(); Side.reveal(key); }, 0);
}

/** The History view, opened on one conversation. */
function readPast(id) {
  setView('history');
  History.show(id);
}

/** The next chat here that wants the person, the one that has waited longest first; failing that, the session anywhere that has waited longest. */
function nextNeeding() {
  // what nobody has looked at yet comes first; while Jev sorts them, what holds everything up before a quick yes or no
  const first = (a, b) => calls(b) - calls(a) || Jev.rank(a) - Jev.rank(b) || a.since - b.since;
  const mine = state.chats.map((c) => ({ id: c.id, s: state.snap.chats.filter((x) => x.chat === c.id && wants(x)).sort(first)[0] }))
    .filter((x) => x.s).sort((a, b) => first(a.s, b.s));
  if (mine.length) {
    showSession(mine[(mine.findIndex((x) => x.id === state.view) + 1) % mine.length].s.key);
    return;
  }
  const other = state.snap.chats.filter((c) => wants(c) && !isOld(c)).sort(first)[0];
  if (other) showSession(other.key);
  else toast('Nothing needs you right now.');
}

/** Where Go there on a card, or a tray command, leads: 'stats', 'history', 'nest', a chat, or 'row:<session>'. */
function goTo(target) {
  if (typeof target !== 'string') return;
  if (target.startsWith('row:')) showSession(target.slice(4));
  else if (target === 'nest') openNest();
  else setView(target);
}

// ---- Settings: a page of the window. Leaving it goes back to where the person was when it opened. ----
let settingsFrom = '';
function openSettings() {
  if (state.view === 'settings') return;
  settingsFrom = state.view;
  setView('settings');
}
function closeSettings() {
  if (state.view !== 'settings') return;
  const from = settingsFrom;
  settingsFrom = '';
  setView(from && (PLACES.includes(from) || state.chats.some((c) => c.id === from)) ? from : rest());
  if (isChat(state.view)) Terms.focus();
}
/** The gear at the foot of the list, and Ctrl+,: Settings, and back again. part: the part to open on. */
function toggleSettings(part) {
  if (typeof part === 'string' && part) Settings.open(part);
  else if (state.view === 'settings') closeSettings();
  else Settings.open();
}

// ---- closing, with five seconds to take it back. Main holds the console that long (chats.cjs holdClose). A chat it
// ---- holds is left out of the page, its terminal kept as it was, until the console ends or the close is undone. ----
const closed = new Map();        // chat id -> { label, until, shown, recent, view }: as things stood when it was closed
let heldByMain = new Set();      // the chats main holds before closing them, as its last list said
let lastSnap = null;             // the watcher's last picture as it came, before the chats main holds were taken out

/** The newest close that can still be taken back: [id, how things stood], or null. */
function lastClosed(now = Date.now()) {
  let last = null;
  for (const entry of closed) if (entry[1].until > now && (!last || entry[1].until > last[1].until)) last = entry;
  return last;
}

/** The title bar's offer to take the newest close back, for as long as there is one. */
function drawUndo() {
  const el = $('undo');
  const now = Date.now();
  const last = lastClosed(now);
  el.hidden = !last;
  if (!last) { el.dataset.stamp = ''; return; }
  const left = Math.ceil((last[1].until - now) / 1000);
  const stamp = `${last[0]}|${left}`;
  if (el.dataset.stamp === stamp) return;
  el.dataset.stamp = stamp;
  el.dataset.tip = `Closed ${last[1].label}. Click within ${left} s to bring it back as it was (Ctrl+Shift+Z).`;
  fill(el, icon('arrow-left', 14), h('span', { text: 'Undo close' }), h('span', { class: 'what', text: last[1].label }), h('span', { class: 'left', text: `${left}s` }));
}

/** A chat whose console ended, or one put back: its close is nothing to offer any more. */
function forgetClose(id) {
  if (closed.delete(id)) drawUndo();
}

/** A close taken back: the chat stands where it stood among the others, and takes the keyboard again if it had it. */
function putBack(id) {
  const p = closed.get(id);
  forgetClose(id);
  if (!p) return false;
  const alive = new Set(state.chats.map((c) => c.id));
  state.shown = [...p.shown.filter((x) => alive.has(x)), ...state.shown.filter((x) => alive.has(x) && !p.shown.includes(x))];
  const at = p.recent.indexOf(id);
  state.recent = state.recent.filter((x) => x !== id);
  if (at >= 0) state.recent.splice(Math.min(at, state.recent.length), 0, id);
  return p.view === id;
}

/** Takes the newest close back (or the one asked for). Main's next list brings the chat back to the page. */
async function undoClose(id) {
  const last = id ? [id, closed.get(id)] : lastClosed();
  if (!last || !last[1] || last[1].until <= Date.now()) return false;
  const ok = await desk.unclose(last[0]).catch(() => false);
  if (!ok) toast('Too late: that chat is closed.');
  return Boolean(ok);
}

async function closeChat(id) {
  const chat = state.chats.find((c) => c.id === id);
  if (!chat || chat.closing || closed.has(id)) return;
  const before = { label: chatLabel(chat), shown: [...state.shown], recent: [...state.recent], view: state.view };
  endWalk();
  // main asks first when the chat is still working; false: it is kept
  const until = await desk.close(id).catch(() => false);
  if (!until) return;
  closed.set(id, { ...before, until });
  // main's next list leaves it out too; it goes at once all the same
  if (state.chats.some((c) => c.id === id)) takeChats(state.chats.filter((c) => c.id !== id), true);
  drawUndo();
}

// ---- leaving with chats open: keep them for next time, start fresh, or keep running by the clock ----
const LEAVE_CHOICES = [
  ['keep', 'Keep them for next time', 'Next time Lowlit opens, they open again by themselves: the same conversations, the names you gave them, the same permission mode. Servers you started here that stop meanwhile start again.'],
  ['fresh', 'Start fresh next time', 'Their conversations stay saved. History has every one of them, with "Resume here". Servers that stop meanwhile stay stopped.'],
  ['tray', 'Keep running by the clock', 'Nothing closes. Your chats go on; the Lowlit icon near the clock brings the window back.'],
  ['gaming', 'Gaming mode', ''],
];
/** What gaming mode stops, in words, as the Servers page last saw it. */
function gamingWords(nChats) {
  const v = Servers.view();
  const pinned = (v.servers || []).filter((s) => s.state === 'running' || s.state === 'starting' || s.state === 'elsewhere').length;
  // the ones hidden on the Servers page end too, and so does whatever holds a pinned one's port
  const other = (v.loose || []).length + (v.hidden || 0) + (v.servers || []).filter((s) => s.state === 'blocked').length;
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
  const stops = [nChats ? `your ${plural(nChats, 'chat', 'chats')}` : '', pinned ? plural(pinned, 'pinned server', 'pinned servers') : '', other ? plural(other, 'other dev server', 'other dev servers') : ''].filter(Boolean);
  return `${stops.length ? `Closes ${stops.length > 1 ? `${stops.slice(0, -1).join(', ')} and ${stops[stops.length - 1]}` : stops[0]}` : 'Closes everything Lowlit runs'}, so nothing holds your computer while you play. `
    + `Next time Lowlit opens, your chats${pinned || other ? ' and servers' : ''} come back as they were.`;
}
/**
 * Back from gaming mode, in words: what comes back, and the servers that cannot (known only as node or python, how
 * they were started cannot be told). g: { chats, servers: their names, lost: their names }.
 */
function gamedWords(g) {
  const servers = Array.isArray(g.servers) ? g.servers.length : 0;
  const lost = Array.isArray(g.lost) ? g.lost : [];
  const chats = Number(g.chats) || 0;
  const back = [chats ? (chats === 1 ? 'Your chat' : `Your ${chats} chats`) : '', servers ? `${servers} ${servers === 1 ? 'server' : 'servers'}` : ''].filter(Boolean);
  const coming = back.length ? `${back.join(' and ')} ${back.length > 1 || chats > 1 || servers > 1 ? 'are' : 'is'} coming back.` : '';
  const one = lost.length === 1;
  const not = lost.length ? `${coming ? ' ' : ''}Not ${lost.join(', ')}: Lowlit cannot tell how ${one ? 'it was' : 'they were'} started. Pin ${one ? 'it' : 'them'} on the Servers page and ${one ? 'it comes' : 'they come'} back next time.` : '';
  return `${coming}${not}`;
}
const leaveOpen = () => !$('leave').hidden;
function closeLeave() {
  $('leave').hidden = true;
  if (isChat(state.view)) Terms.focus();
}
function askLeave() {
  const root = $('leave');
  if (leaveOpen()) return;
  const open = state.chats.filter((c) => !c.closing);
  const remember = h('input', { type: 'checkbox', id: 'leave-remember' });
  const answer = (how) => {
    closeLeave();
    const fade = how !== 'tray' && !document.documentElement.classList.contains('still');
    // the window fades out before it goes: closing is calm, not a cut
    if (fade) {
      document.body.classList.add('leaving');
      // a window that is still there a while later (its chats take time to end) is hidden by then; should it not be, it shows again
      setTimeout(() => document.body.classList.remove('leaving'), 5000);
    }
    setTimeout(() => desk.leave(how, remember.checked), fade ? 220 : 0);
  };
  const names = open.map(chatLabel);
  fill(root, h('div', { class: 'dialog leave', role: 'dialog', 'aria-label': 'Closing Lowlit' },
    h('div', { class: 'leave-top' },
      state.info.logo && h('img', { class: 'leave-logo', src: state.info.logo, alt: '' }),
      h('div', null,
        h('h2', { text: `You have ${open.length} chat${open.length === 1 ? '' : 's'} open` }),
        h('p', { class: 'quiet', text: names.length > 4 ? `${names.slice(0, 4).join(' · ')} and ${names.length - 4} more` : names.join(' · ') }))),
    h('div', { class: 'leave-choices' }, LEAVE_CHOICES.map(([how, title, note], i) => h('button', {
      class: `leave-choice${i === 0 ? ' first' : ''}`, data: { how }, onclick: () => answer(how),
    }, h('span', { class: 'leave-title', text: title }), h('span', { class: 'leave-note', text: how === 'gaming' ? gamingWords(open.length) : note })))),
    h('div', { class: 'foot' },
      h('label', { class: 'leave-remember' }, remember, h('span', { text: 'Do this every time (Settings can change it)' })),
      h('button', { class: 'btn ghost', text: 'Cancel', onclick: closeLeave }))));
  root.hidden = false;
  root.onmousedown = (e) => { if (e.target === root) closeLeave(); };
  root.onkeydown = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeLeave(); }
  };
  root.querySelector('.leave-choice.first').focus();
}

function openRecord(tab = 'today', slug = '', query = '') {
  Record.open(tab, slug, query);
  setView('record');
}

let recordSummaryAt = 0;
let recordSummaryBusy = false;
let recordSummaryFolder = '';
let recordSummarySeq = 0;
async function refreshRecordSummary(force = false) {
  const folder = state.settings.record && state.settings.record.folder || '';
  if (folder !== recordSummaryFolder) {
    recordSummaryFolder = folder;
    recordSummarySeq++;
    recordSummaryBusy = false;
    recordSummaryAt = 0;
    state.recordSummary = null;
    Record.reset();
  }
  if (!folder) { state.recordSummary = null; Side.render(state); return; }
  if (recordSummaryBusy || (!force && Date.now() - recordSummaryAt < 30000)) return;
  const seq = ++recordSummarySeq;
  recordSummaryBusy = true;
  recordSummaryAt = Date.now();
  let answer;
  try { answer = await desk.record({ part: 'summary' }); } catch { answer = null; }
  if (seq !== recordSummarySeq) return;
  recordSummaryBusy = false;
  if (answer && answer.ready !== false) state.recordSummary = answer;
  if (!buttonDown() && !hintsUp()) Side.render(state);
}

let recordTaskBusy = false;
async function startRecordTask(task, project) {
  if (recordTaskBusy || !project || !project.folders || !project.folders.length) return;
  const folder = state.settings.record && state.settings.record.folder;
  recordTaskBusy = true;
  let answer;
  try { answer = await desk.record({ part: 'project', slug: project.slug, task: task.id }); } catch { answer = null; }
  finally { recordTaskBusy = false; }
  if (folder !== (state.settings.record && state.settings.record.folder)) return;
  if (!answer || answer.ready === false) { toast('The record is not ready yet. Try again shortly.'); return; }
  if (typeof answer.taskText !== 'string' || !answer.project || !answer.project.folders.length) { toast('That to-do or its project folder is no longer available.'); return; }
  desk.writeClipboard(answer.taskText);
  project = answer.project;
  const first = new Set(project.folders.map(pathKey));
  Picker.open([...project.folders, ...state.chats.map((c) => c.cwd), ...state.snap.chats.map((c) => c.cwd)], {
    first: (folder) => first.has(pathKey(folder)),
    tag: (folder) => first.has(pathKey(folder)) ? project.title : '',
    note: 'The to-do is on the clipboard: Ctrl+V pastes it into the new chat.',
  });
}

function openPicker() {
  const front = state.chats.find((c) => c.id === state.view);
  const live = state.snap.chats.slice().sort((a, b) => b.at - a.at).map((c) => c.cwd);
  const now = state.loose ? null : spaceNow();
  const names = new Map(state.settings.spaces.map((s) => [s.id, s.name]));
  Picker.open([front && front.cwd, ...state.chats.map((c) => c.cwd), ...(now ? now.folders : []), ...live], {
    // inside a workspace its own folders stand first, and each folder says which workspace it is in
    first: now ? (p) => spaceOf(p) === now.id : null,
    tag: (p) => names.get(spaceOf(p)) || '',
    note: now ? `A folder that is in no workspace yet joins ${now.name}. One that is in another workspace opens there.` : '',
  });
}

async function attach(c) {
  // already shown in a chat here: one view of it is enough
  const shown = state.chats.find((x) => x.job === c.job && !x.closing);
  if (shown) { setView(shown.id); return; }
  const ask = { attach: c.job, title: labelOf(c) };
  let chat = await desk.create({ ...ask, cwd: c.cwd || state.info.home });
  // its folder may be gone; the session itself does not need it
  if (chat && chat.error) chat = await desk.create({ ...ask, cwd: state.info.home });
  if (chat && !chat.error) setView(chat.id);
}

// Between two starts that each pick a conversation up: a Claude Code reads the whole of its conversation's file as
// it starts, and several doing that at once weigh on the machine.
const RESUME_GAP_MS = 3500;

/**
 * Brings back the chats that were open when the app last closed: each with its conversation, the name the person
 * gave it and the permission mode it was in. how: 'auto' after a normal close, 'crash' after one that never
 * reached its end, '' when the person pressed Reopen.
 */
async function reopen(how) {
  const list = state.info.previous;
  state.info.previous = [];
  banner(null);
  const from = state.view;
  let first = '';
  let failed = 0;
  let elsewhere = 0;
  let over = 0;
  for (const [i, p] of list.entries()) {
    const named = p.named === true && Boolean(p.title);
    // opened from the list meanwhile: one view of a background session is enough
    if (p.job && state.chats.some((x) => x.job === p.job && !x.closing)) continue;
    // the view of a background session comes back as a view of it; one whose session has ended since stays in the list only
    const chat = p.job
      ? await desk.create({ attach: p.job, cwd: p.cwd, title: p.title || '', restore: true, order: p.order })
      : await desk.create({ cwd: p.cwd, starter: p.starter, resume: p.resume || undefined, mode: p.mode, title: named ? p.title : '', named, restore: true, order: p.order });
    if (chat && chat.gone) { over++; continue; }
    if (chat && chat.elsewhere) { elsewhere++; continue; }
    if (!chat || chat.error) { failed++; continue; }
    // A chat is on screen at once, and the one that had the keyboard gets it back as soon as it is there: not only
    // once the whole list is open. Unless the person has gone somewhere else meanwhile. A chat of another
    // workspace does not pull that workspace in front: only the one that had the keyboard does.
    if (!first && inView(chat.cwd, chatKey(chat.id))) first = chat.id;
    const waiting = state.view === from || state.view === first;
    if (waiting && (p.front || chat.id === first)) setView(chat.id);
    // one at a time: a start that picks a conversation up loads the whole of it
    if (i < list.length - 1) await new Promise((r) => setTimeout(r, p.resume || p.job ? RESUME_GAP_MS : 1500));
  }
  desk.previousDone();
  const back = list.length - failed - elsewhere - over;
  const lost = failed ? ` ${failed} could not open: ${failed === 1 ? 'its folder is' : 'their folders are'} gone. History still has ${failed === 1 ? 'its conversation' : 'their conversations'}.` : '';
  const twice = elsewhere ? ` ${elsewhere} already ${elsewhere === 1 ? 'runs' : 'run'} in another program: left there, not opened twice.` : '';
  const overNote = over ? ` ${over} background session${over === 1 ? '' : 's'} ended meanwhile: ${over === 1 ? 'it stays' : 'they stay'} in the list.` : '';
  if (how === 'crash') toast(`Lowlit did not close properly last time. Your ${back} chat${back === 1 ? ' is' : 's are'} back.${lost}${twice}${overNote}`, 9000);
  else if (how === 'auto' || failed || elsewhere || over) toast(`${back ? `Your ${back} chat${back === 1 ? ' is' : 's are'} back, as you left ${back === 1 ? 'it' : 'them'}.` : ''}${lost}${twice}${overNote}`.trim(), 7000);
}

// ---- bringing a conversation here: one that ended, or one that runs in another terminal ----
const queue = [];
let pumping = false;
/** Opens an ended conversation in a chat of this window. show: give that chat the keyboard. */
function resume(e, show) {
  if (state.resumed.has(e.id)) return;
  state.resumed.set(e.id, Date.now());
  queue.push({ e, show });
  paint();
  pump();
}
async function pump() {
  if (pumping) return;
  pumping = true;
  while (queue.length) {
    const { e, show } = queue.shift();
    const chat = await desk.create({ resume: e.id, cwd: e.cwd, mode: e.mode });
    if (!chat || chat.error) {
      // back on the list of ended conversations, to be tried again
      state.resumed.delete(e.id);
      paint();
      toast(`${labelOf(e)} could not be opened here. ${(chat && chat.error) || ''}`);
    } else if (show) {
      setView(chat.id);
    } else {
      toast(`${labelOf(e)} is now open here.`);
    }
    // one at a time: each start loads a whole conversation
    if (queue.length) await new Promise((r) => setTimeout(r, RESUME_GAP_MS));
  }
  pumping = false;
}

/** ids: the sessions to bring here once they end where they run; null for every one of the workspace in front that runs in another terminal. */
function arm(ids) {
  const list = ids || movable().map((c) => c.session);
  for (const id of list) {
    state.armed.add(id);
    const c = state.snap.chats.find((x) => x.session === id);
    if (c) state.armedAs.set(id, labelOf(c));
  }
  paint();
}
function disarm(id) {
  if (id) { state.armed.delete(id); state.armedAs.delete(id); } else { state.armed.clear(); state.armedAs.clear(); }
  paint();
}

// ---- looking again, now ----
let refreshing = false;
/**
 * Everything read again at once: the sessions, who is logged in, what the chats last said about the limits, and
 * the numbers. It cannot make a limit move: those figures come with a chat's next reply.
 */
async function refreshNow() {
  if (refreshing) return;
  refreshing = true;
  const btn = $('refresh');
  btn.classList.add('spin');
  const t0 = Date.now();
  const done = await desk.refresh();
  await refreshUsage(true);
  if (state.view === 'history') await History.refresh(true);
  // a turn too quick to see reads as nothing having happened
  const short = 500 - (Date.now() - t0);
  if (short > 0) await new Promise((r) => setTimeout(r, short));
  btn.classList.remove('spin');
  refreshing = false;
  if (!done) { toast('The part that reads the files did not answer. Try again in a moment.'); return; }
  const me = Parts.acctView(state).me;
  toast(`Looked again just now.${me ? ` Logged in: ${acctName(me, state.settings.accountNames)}.` : ''} Limits move when one of your chats next talks to Claude.`, 6000);
}

// ---- the numbers ----
let usageAt = 0;
let usageBusy = false;
async function refreshUsage(force) {
  if (state.frozen || usageBusy || (!force && Date.now() - usageAt < 9000)) return;
  usageBusy = true;
  // away from the Dashboard only today's limits are looked at: every answer carries them
  const u = await desk.usage(state.view === 'stats' ? state.range : 'today');
  usageBusy = false;
  if (!u) return;
  usageAt = Date.now();
  state.usage = u;
  paint();
}

function setInspector(on) {
  state.settings.inspector = on;
  $('inspector').hidden = !on || state.nest;
  desk.settings({ inspector: on });
  paint();
  Sizes.fit();
}
/** In the Nest the panel beside the chat is his day: shown or hidden, and kept so. */
function setNestDay(on) {
  state.nestDay = on;
  kept.set('nest-day', on ? '1' : '0');
  paint();
  Sizes.fit();
}
/** The panel button and Ctrl Shift I: the day beside the Nest's chat, the panel beside any other. */
const togglePanel = () => (state.nest && isChat(state.view) ? setNestDay(!state.nestDay) : setInspector(!state.settings.inspector));

/**
 * Whose browser may show, the first preferred: the chat in front, then the other chats on screen, the one used last
 * first (so the panel stays while the keyboard moves between chats side by side); a session of another terminal that
 * is looked at; else every page.
 */
function browserScopes() {
  const name = (id) => { const chat = state.chats.find((c) => c.id === id); return chat ? chatLabel(chat) : 'This chat'; };
  if (isChat(state.view)) {
    const age = (id) => { const i = state.recent.indexOf(id); return i < 0 ? Infinity : i; };
    const others = onScreen().filter((id) => id !== state.view).sort((a, b) => age(a) - age(b));
    return [state.view, ...others].map((id) => ({ key: id, name: name(id) }));
  }
  if (state.view === 'peek' && state.sel && state.sel.kind === 'live') {
    const c = state.snap.chats.find((x) => x.key === state.sel.key);
    return [{ key: `s:${state.sel.key}`, name: c ? labelOf(c) : 'This session' }];
  }
  return [{ key: '', name: 'Every page' }];
}

// ---- starting over: the page is loaded again under running chats (for newer code, or after its program died). Where
// ---- the person was is kept in the window's own store, which lasts as long as this run of the app: chat ids are only
// ---- good for one run. ----
const PLACE = 'desk-place';
const SEEN_KEPT = 'desk-seen';
const RESTART_WORDS = 'A new version needs the app closed and opened again. Your chats come back by themselves.';
const RESTART_TIP = 'A new version is on disk.\nThe app closes and opens again with it; your chats keep running.';
let placeSaid = '';
function keepPlace() {
  const place = JSON.stringify({ view: state.view, shown: state.shown, recent: state.recent, loose: state.loose, sel: state.sel, lookFrom, nest: state.nest, nestFrom: state.nestFrom,
    unread: [...state.unread], seenWaits: [...state.seenWaits], armed: [...state.armed], armedAs: [...state.armedAs], range: state.range });
  if (place === placeSaid) return;
  placeSaid = place;
  try { sessionStorage.setItem(PLACE, place); } catch { /* without the store, a page that starts over starts where it rests */ }
  try { localStorage.setItem(SEEN_KEPT, JSON.stringify([...state.seenWaits])); } catch { /* seen waits then last for this run only */ }
}
/**
 * Where the person was, as far as it still holds; returns the view to go back to, or ''. After a restart the window's
 * own store is empty, and main hands over what it held (the chats ran on, under the same ids).
 */
function takePlace() {
  // a wait already seen stays seen through any restart, a full quit or Windows' own included: it is the same wait
  // only while the chat is still in the same state since the same moment
  try {
    const kept = JSON.parse(localStorage.getItem(SEEN_KEPT) || '[]');
    if (Array.isArray(kept)) state.seenWaits = new Map(kept.filter((x) => Array.isArray(x) && typeof x[0] === 'string' && typeof x[1] === 'string').slice(-SEEN_MAX));
  } catch { /* none kept */ }
  let p = null;
  try { p = JSON.parse(sessionStorage.getItem(PLACE) || state.info.place || 'null'); } catch { p = null; }
  if (!p || typeof p !== 'object') return '';
  const here = new Set(state.chats.map((c) => c.id));
  const ids = (list) => (Array.isArray(list) ? list.filter((id, i) => here.has(id) && list.indexOf(id) === i) : []);
  const keys = (list) => (Array.isArray(list) ? list.filter((k) => typeof k === 'string') : []);
  state.shown = ids(p.shown);
  state.recent = ids(p.recent);
  state.loose = p.loose === true && (state.settings.spaces || []).length > 0;
  state.unread = new Set(keys(p.unread));
  const pairs = (list) => (Array.isArray(list) ? list.filter((x) => Array.isArray(x) && typeof x[0] === 'string' && typeof x[1] === 'string') : []);
  state.seenWaits = new Map(pairs(p.seenWaits).slice(-SEEN_MAX));
  state.armed = new Set(keys(p.armed));
  state.armedAs = new Map((Array.isArray(p.armedAs) ? p.armedAs : []).filter((x) => Array.isArray(x) && typeof x[0] === 'string' && typeof x[1] === 'string'));
  if (['today', '7d', '30d'].includes(p.range)) state.range = p.range;
  if (p.sel && (p.sel.kind === 'live' || p.sel.kind === 'ended') && typeof p.sel.key === 'string') state.sel = { kind: p.sel.kind, key: p.sel.key };
  lookFrom = PLACES.includes(p.lookFrom) ? p.lookFrom : '';
  state.nest = p.nest === true;
  state.nestFrom = typeof p.nestFrom === 'string' ? p.nestFrom : '';
  return PLACES.includes(p.view) || here.has(p.view) ? p.view : '';
}

/** The window loaded again with its chats running on: for newer code, or when something in it misbehaves. */
async function reloadPage() {
  keepPlace();
  // the page that asked is usually gone before any answer comes
  const answer = await desk.reload().catch(() => true);
  if (answer === 'restart') toast('A new version needs the app to restart: press "New version: restart" at the top. Your chats keep running.', 9000);
  else if (answer === false) toast('The window could not be loaded again. Try again in a moment.', 6000);
}

/** The app closes and opens again for a new version; the chats run on in the keeper, and this place is taken up again. */
async function restartApp() {
  keepPlace();
  const done = await desk.restart().catch(() => false);
  if (!done) toast(RESTART_WORDS, 9000);
}

/** In the title bar while newer code waits on disk: one that can be loaded now, or one that needs the app reopened. */
function drawVersion() {
  const el = $('version');
  el.hidden = !state.version;
  if (el.dataset.version === state.version) return;
  el.dataset.version = state.version;
  if (state.version === 'reload') {
    fill(el, icon('refresh', 13), h('span', { text: 'Load new version' }));
    el.dataset.tip = 'Newer code is on disk.\nThe window loads it again; your chats keep running.';
  } else if (state.version === 'restart') {
    fill(el, icon('refresh', 13), h('span', { text: 'New version: restart' }));
    el.dataset.tip = RESTART_TIP;
  }
}

// ---- what arrives from the main process ----
/** fromPage: the page's own list less a chat it just closed, not main's word: what main holds stays as main said. */
function takeChats(list, fromPage = false) {
  if (!fromPage) {
    const held = new Set(list.filter((c) => c.pendingClose).map((c) => c.id));
    const changed = held.size !== heldByMain.size || [...held].some((id) => !heldByMain.has(id));
    heldByMain = held;
    // the session of a chat held or let go leaves or joins the page with it, not at the watcher's next picture,
    // which only comes when something changed
    if (changed && lastSnap) queueMicrotask(() => takeSnapshot(lastSnap));
  }
  // a chat main holds before closing it stays out of sight, its terminal as it was; one whose close was undone is back
  const back = list.filter((c) => !c.pendingClose && closed.has(c.id)).map((c) => c.id);
  list = list.filter((c) => !c.pendingClose);
  for (const chat of list) Terms.create(chat.id);
  // read before the list changes: a chat that is gone from the list no longer counts as on screen
  const was = onScreen().join();
  state.chats = list;
  let front = '';
  for (const id of back) if (putBack(id)) front = id;
  state.recent = state.recent.filter((id) => list.some((c) => c.id === id));
  if (front) { setView(front, { walking: true }); return; }
  if (wanted && list.some((c) => c.id === wanted)) { setView(wanted); return; }
  // the Nest keeps its place while its chat comes and goes: it shows the chat as soon as there is one again
  if (state.nest) {
    const nest = nestChat();
    const want = nest ? nest.id : 'nest';
    if (state.view !== want && (state.view === 'nest' || !list.some((c) => c.id === state.view))) { setView(want); return; }
  }
  // the chat that had the keyboard is gone: the one used before it takes over. And the start page gives way to
  // the first chat that opens in the workspace in front.
  const gone = isChat(state.view) && !list.some((c) => c.id === state.view);
  if (gone || (state.view === 'peek' && !state.sel && !state.selLeaving && rest() !== 'peek')) {
    setView(rest());
    return;
  }
  if (isChat(state.view)) {
    // a place fell empty, or a new chat can take one that was free (or takes back the place it had)
    seat(state.view);
    if (onScreen().join() !== was || back.length) ChatView.place(state, onScreen());
  }
  paint();
}

function takeSnapshot(snap) {
  lastSnap = snap;
  // the session in a chat main holds before closing it is gone from the page with its chat
  if (heldByMain.size) snap = { ...snap, chats: snap.chats.filter((c) => !(c.chat && heldByMain.has(c.chat))) };
  if (!snap.ended) snap.ended = [];
  if (!snap.leaving) snap.leaving = [];
  if (!snap.accounts) snap.accounts = null;
  // null: no picture so far said who is logged in, so there is nothing to compare with
  const was = state.snap.accounts ? state.snap.accounts.current : null;
  state.stale = false;
  // a chat on screen that does not have the keyboard still counts as unseen when it finishes: its mark says so
  const front = isChat(state.view) && document.hasFocus() ? state.view : '';
  const keys = new Set();
  const live = new Set();
  let finished = false;
  for (const c of snap.chats) {
    keys.add(c.key);
    live.add(c.session);
    const before = state.before.get(c.key);
    if (c.state !== 'idle') state.unread.delete(c.key);
    // finished just now, and not in the chat the person is typing in
    else if ((before === 'working' || before === 'compacting') && !(c.chat && c.chat === front)) { state.unread.add(c.key); finished = true; }
    // what the chat the person is typing in waits for, they see: Jev's word on its answer, come later, calls no more
    if (c.chat && c.chat === front) see(c);
  }
  if (finished) Noir.pulse();
  for (const key of state.unread) if (!keys.has(key)) state.unread.delete(key);
  // the session looked at follows its conversation: from running to ended, and back when it is picked up again
  const sel = state.sel;
  if (sel && sel.kind === 'live' && !keys.has(sel.key)) {
    const over = snap.ended.some((e) => e.id === sel.key);
    // closed, its program still on its way out: for a few seconds it is neither running nor ended
    if (!over && snap.leaving.includes(sel.key)) state.selLeaving = sel.key;
    state.sel = over ? { kind: 'ended', key: sel.key } : null;
  } else if (sel && sel.kind === 'ended' && !snap.ended.some((e) => e.id === sel.key)) {
    const c = snap.chats.find((x) => x.session === sel.key);
    state.sel = c ? { kind: 'live', key: c.key } : null;
  }
  if (state.selLeaving) {
    if (snap.ended.some((e) => e.id === state.selLeaving)) {
      // nothing else was looked at in the meantime: the page goes back to it
      if (!state.sel && state.view === 'peek') state.sel = { kind: 'ended', key: state.selLeaving };
      state.selLeaving = '';
    } else if (!snap.leaving.includes(state.selLeaving)) state.selLeaving = '';
  }
  state.before = new Map(snap.chats.map((c) => [c.key, c.state]));
  state.snap = snap;
  // a session that was to come here and has now ended where it ran: pick it up
  const waiting = state.armed.size;
  for (const id of [...state.armed]) {
    if (live.has(id)) continue;
    const e = snap.ended.find((x) => x.id === id);
    // closed over there, its program still on its way out: it shows up as ended within seconds
    if (!e && snap.leaving.includes(id)) continue;
    const name = state.armedAs.get(id) || 'That chat';
    state.armed.delete(id);
    state.armedAs.delete(id);
    // the one chat that was asked for gets the keyboard; several open one after another without taking it
    if (e) resume(e, waiting === 1);
    // never silently: nothing ended that can be opened (it had no message yet, or it started a new conversation over there)
    else toast(`${name} did not come here: it left no conversation to open. If it had messages, History has it, with "Resume here".`, 15000);
  }
  const now = Date.now();
  for (const [id, at] of state.resumed) if (now - at > 60000 && !snap.ended.some((e) => e.id === id)) state.resumed.delete(id);
  // the session that was looked at is gone for good: back to the chats
  if (state.view === 'peek' && !state.sel && !state.selLeaving && rest() !== 'peek') setView(rest());
  else paintData();
  if (snap.accounts && was !== null && snap.accounts.current !== was) sayLogin();
}

// ---- the floating card: the chat in front, in a small window of its own that stays over every other program
// ---- (main.cjs makes it, float.js draws it). Told what to show only while it is switched on, and only what changed. ----
let floatSent = '';
/** The chat the card follows: the one in front, else the one last in front. */
function floatChat() {
  const open = state.chats.filter((c) => !c.closing);
  const id = isChat(state.view) && open.some((c) => c.id === state.view) ? state.view : state.recent.find((x) => open.some((c) => c.id === x)) || '';
  return open.find((c) => c.id === id) || open[0] || null;
}
/** What the card shows: that chat in plain words and figures, and the other chats that want the person. null: nothing at all. */
function floatModel() {
  const chat = floatChat();
  const s = chat ? sessionOf(chat.id) : null;
  const others = state.snap.chats.filter((c) => !isOld(c) && (!s || c.key !== s.key));
  const waiting = others.filter(calls);
  const needs = waiting.slice(0, 3).map((c) => ({ key: c.key, chat: c.chat && state.chats.some((x) => x.id === c.chat) ? c.chat : '', name: nameOf(c) }));
  const working = others.filter((c) => c.state === 'working' || c.state === 'compacting').length;
  const look = state.settings.look === 'grey' ? 'grey' : 'noir';
  if (!chat) return waiting.length || working ? { look, chat: null, needs, nNeeds: waiting.length, working } : null;
  const mark = s ? markFor(s) : 'none';
  const v = s ? Jev.verdict(s) : null;
  const words = !s ? chatSub(chat) : v && (Jev.waits(v) || v.level === 'stuck') ? `Jev: ${Jev.words(v.level)}`
    : phrase(s) || (state.unread.has(s.key) ? 'Finished' : 'Idle');
  const going = Boolean(s) && s.state === 'working' && !s.background && s.turn && s.turn.start && !s.turn.end;
  const m = s ? Parts.memoryOf(s) : null;
  return {
    look,
    chat: {
      id: chat.id, name: chatLabel(chat), folder: folderOf(chat.cwd), mark, words,
      timer: !s ? null : going ? { since: s.turn.start } : s.state !== 'idle' ? { time: s.since } : null,
      limit: s && s.limit && s.limit.until > Date.now() ? { until: s.limit.until } : null,
      plan: s && s.steps && s.steps.total > 0 ? s.steps : null,
      running: s && s.agents ? s.agents.running || 0 : 0,
      agents: s && s.agents ? (s.agents.list || []).filter((a) => a.state === 'working').slice(0, 5).map((a) => ({ name: a.name || '', what: a.what || '', started: a.started || 0 })) : [],
      memory: m && { part: m.part, tone: m.tone, known: m.known, context: s.context, ceiling: s.ceiling || 0, compacts: s.compacts || 0 },
      usd: s && s.live ? s.live.usd || 0 : 0,
      out: s && s.today && s.today.whole !== false ? s.today.out || 0 : 0,
      model: s ? s.model || '' : '', effort: s ? s.effort || '' : '',
    },
    needs, nNeeds: waiting.length, working,
  };
}
function floatCard() {
  if (!state.settings.float || !state.settings.float.on) { floatSent = ''; return; }
  const model = floatModel();
  const json = JSON.stringify(model);
  if (json === floatSent) return;
  floatSent = json;
  desk.float(model);
}
/** Switches the card on or off (Ctrl Shift F, the palette, Settings). */
async function toggleFloat(on = !(state.settings.float && state.settings.float.on)) {
  const next = await desk.settings({ float: { on } });
  if (!next) return;
  state.settings = { ...state.settings, float: next.float };
  floatSent = '';
  paint();
  toast(on ? 'The floating card is on: top left of your screen, over your other programs. Drag its top line to move it. Ctrl Shift F hides it.'
    : 'The floating card is off. Ctrl Shift F brings it back.', 7000);
}

async function boot() {
  // Listened to before anything is asked: what the main process says while the page starts is kept, and taken in its
  // order once the page can. Main says nothing older than its answer to this first question (pageUp in main.cjs).
  const early = [];
  let started = false;
  const when = (fn) => (...args) => { if (started) fn(...args); else early.push(() => fn(...args)); };
  desk.onOutput(when((id, data, seq) => Terms.write(id, data, seq)));
  desk.onExit(when((id) => { forgetClose(id); Terms.remove(id); }));
  desk.onChats(when(takeChats));
  // while figures are frozen (the self-test shows made-up ones), the watcher's own pictures and measurements wait
  desk.onSnapshot(when((snap) => { if (!state.frozen) takeSnapshot(snap); }));
  desk.onRes(when((res) => { if (state.frozen) return; state.res = res; paintData(); }));
  desk.onCommand(when((name, arg) => command(name, arg)));
  desk.onVersion(when((version) => { state.version = version; drawVersion(); }));
  const info = await desk.info();
  state.info = info;
  state.chats = info.chats;
  state.version = info.version || '';
  state.stale = Boolean(info.stale);
  state.snap = { ended: [], leaving: [], accounts: null, ...info.snapshot };
  state.res = info.res || null;
  state.settings = info.settings;
  // the window was opened see-through: the page's own ground steps back so the desktop shows, blurred by Windows
  document.documentElement.classList.toggle('glass', Boolean(info.glass));
  // the hidden window of the self-test draws no frames: anything that fades in would stay invisible there
  document.documentElement.classList.toggle('still', Boolean(info.hidden));
  // the light is laid on the ground first: see-through, it leaves the blur Windows draws between its dots
  Noir.init(document.querySelector('.backdrop'), { glass: Boolean(info.glass) });
  Noir.setAwake(document.hasFocus());
  applyLook(info.settings);
  Jev.take(info.jev);
  state.before = new Map(info.snapshot.chats.map((c) => [c.key, c.state]));
  if (info.logo) $('logo').src = info.logo; else $('logo').hidden = true;
  initTips($('tip'));
  $('side-toggle').append(icon('side'));
  const toggleSide = () => { kept.set('side', document.body.classList.toggle('no-side') ? '0' : '1'); Sizes.fit(); };
  document.body.classList.toggle('no-side', kept.get('side', '1') === '0');
  state.nestDay = kept.get('nest-day', '1') !== '0';
  $('side-toggle').addEventListener('click', toggleSide);
  $('triage').addEventListener('click', nextNeeding);
  $('new-chat').append(icon('plus', 14), h('span', { text: 'New chat' }));
  $('new-chat').addEventListener('click', openPicker);
  $('refresh').append(icon('refresh', 15));
  $('refresh').dataset.tip = 'Look again now and draw the window again (F5)\nYour sessions, the account Claude Code is logged in to, and the limits as your chats last reported them; every chat on screen drawn from scratch.\nA limit only moves when one of your chats next talks to Claude.';
  $('refresh').addEventListener('click', () => { redrawNow(true); refreshNow(); });
  for (const [n, name, words] of [[1, 'tile-1', 'One chat on screen'], [2, 'tile-2', 'Two chats side by side'], [4, 'tile-4', 'Four chats on screen']]) {
    $('split').append(h('button', { data: { n: String(n) }, 'aria-label': words, tip: `${words}\nCtrl Shift Enter switches between one chat and the chats side by side.`, onclick: () => {
      if (state.view === 'overview') setView(rest());
      setTiles(n);
    } }, icon(name, 15)));
  }
  $('split').append(h('button', { id: 'go-overview', 'aria-label': 'Every chat at a glance', 'aria-pressed': 'false', onclick: toggleOverview,
    tip: 'Every chat at a glance (Ctrl+Shift+A)\nWhat each one is doing or waiting on, and its last words.' }, icon('cards', 15)));
  $('jump').append(icon('search', 14), h('span', { text: 'Search chats and history' }), h('kbd', { text: 'Ctrl Shift P' }));
  $('jump').addEventListener('click', () => Palette.open());
  $('inspector').hidden = !state.settings.inspector;
  initNotes($('notes'));

  let fontTimer = 0;
  Terms.init($('park'), $('tiles'), info, () => paintData(), (size) => {
    state.settings.fontSize = size;
    clearTimeout(fontTimer);
    fontTimer = setTimeout(() => desk.settings({ fontSize: size }), 400);
  }, (scale) => { paint(); desk.note('screen', `the window's scaling is now ${Math.round(scale * 100)}%: every chat on screen drawn again`); });
  for (const type of ['dragover', 'drop']) window.addEventListener(type, (e) => e.preventDefault());
  const resumeHere = (e) => resume(e, true);
  const inspector = togglePanel;
  const rename = (chatId) => { setView(chatId); ChatView.rename(); };
  const forget = (id) => { state.resumed.set(id, Date.now()); desk.forget(id); if (state.sel && state.sel.key === id) look(null); else paint(); };
  const spaceActs = { spaceOf, spacesOf, sortedBy, inView, switchSpace, toggleSpace, addSpace, renameSpace, removeSpace, putFolder, colorSpace, putSession, pin };
  Side.init($('side'), {
    session: sessionOf, chatKey, label: chatLabel, sub: chatSub, mark: markFor, onScreen, elsewhere, wants, calls,
    focus: (id, key) => { const chat = state.chats.find((c) => c.id === id); if (chat && !inNest(chat)) follow(chat.cwd, key); setView(id); },
    look, go: setView, close: closeChat, rename, arm, disarm, attach, resume: resumeHere, forget, canCompact, compactNow, atPrompt, record: openRecord,
    newChat: openPicker, settings: toggleSettings, repaint: paint, serverSummary: () => Servers.summary(), ...spaceActs,
    nest: () => toggleNest(), calling: () => Browser.calling(),
  });
  Glance.init($('overview'), $('chat-list'), state, { session: sessionOf, label: chatLabel, spaceOf, spacesOf, go: setView, show: showSession, canCompact, compactNow, record: openRecord });
  Peek.init($('peek'), { open: setView, attach, arm, disarm, resume: resumeHere, forget, rename, close: closeChat, look, elsewhere, newChat: openPicker, go: setView, space: spaceWords });
  // the chats open when the app last closed come back by themselves; asked about only when the person chose to start fresh
  if (info.previous.length && info.restore === 'ask') banner(info.previous);
  History.init($('history'), { open: setView, attach, arm, disarm, resume: resumeHere, rename, close: closeChat });
  Record.init($('record'), { open: setView, show: showSession, startTask: startRecordTask, settings: () => Settings.open('record') });
  Nest.init($('nest-rail'), $('nest'), { show: showSession, record: () => openRecord('today'), settings: (part) => Settings.open(part || 'nest'),
    start: startNest, arm, chat: nestChat, inNest, wants, calls, isOld, name: nameOf, mark: markFor });
  $('brand').title = 'The Nest: the chat of your record, with your day beside it (Ctrl+Shift+Space)';
  $('brand').addEventListener('click', () => toggleNest());
  Servers.init($('servers'), { changed: () => Side.servers(state) });
  Sizes.init({ webWidth: () => Browser.width() + Viewer.width(), webWanted: () => Browser.wanted(), webMin: () => Browser.min(), setWeb: (w) => Browser.fit(w),
    aside: (on) => Browser.aside(on), changed: () => Browser.place() });
  // the strips of the chats on screen show what each one's browser holds; the list, which of them calls for the person
  let calling = '';
  const browserChanged = () => {
    if (buttonDown()) dirty = true; else ChatView.render(state);
    const now = JSON.stringify(Browser.calling());
    if (now !== calling) { calling = now; paint(); }
    // the Browser closed: a Viewer wanted meanwhile comes back
    Viewer.follow();
    Settings.browserChanged();
  };
  Browser.init($('web'), {
    changed: browserChanged,
    scopes: browserScopes,
    palette: () => { if (!Picker.isOpen()) Palette.toggle(); },
    // the person clicked into a page: the window was not left
    inside: () => Morning.back(),
    // the panel closed, or the address was let go: the keyboard goes back to the chat in front (unless the Viewer took its place)
    done: () => { if (isChat(state.view) && !Viewer.isOpen() && !Picker.isOpen() && !Palette.isOpen()) Terms.focus(); },
    // asked to slide in: the Viewer steps aside, the two share the right of the window
    opening: () => Viewer.shut(),
  });
  Viewer.init($('viewer'), {
    changed: () => { if (buttonDown()) dirty = true; else ChatView.render(state); },
    scopes: browserScopes,
    opening: () => { if (Browser.isOpen()) Browser.shut(); },
    otherOpen: () => Browser.isOpen(),
    done: () => { if (isChat(state.view) && !Browser.isOpen() && !Picker.isOpen() && !Palette.isOpen()) Terms.focus(); },
  });
  Stats.init($('stats'), {
    range: (r) => { state.range = r; Stats.reset(); paint(); refreshUsage(true); },
    open: setView,
    show: showSession,
    read: readPast,
    spacesOf,
    session: sessionOf,
    label: chatLabel,
  });
  Morning.init(state, { mark: markFor, name: nameOf, show: showSession });
  Shift.init($('shift'), $('shift-pop'), {
    dashboard: () => setView('stats'),
    settings: () => Settings.open('work'),
    // closed: the keyboard goes back to the chat in front
    done: () => { if (isChat(state.view) && !Browser.isOpen() && !Viewer.isOpen() && !Picker.isOpen() && !Palette.isOpen()) Terms.focus(); },
  }, info.work);
  desk.onWork((v) => Shift.take(v));
  // nobody is looking at a window that starts by the clock: from now, what happens is kept for when someone does
  if (!document.hasFocus()) Morning.leave();
  desk.onJev((v) => { Jev.take(v); Settings.jevChanged(); paint(); });
  ChatView.init($('tiles'), $('inspector'), { session: sessionOf, label: chatLabel, close: closeChat, inspector, attach, arm, disarm, resume: resumeHere, focus: setView, big: toggleBig, repo: repoMenu,
    // its globe: a press on the strip of a chat that did not have the keyboard opens its browser, else turns it
    browser: (id, wasOn) => Browser.toggleFor(id, wasOn ? undefined : true), web: (id) => Browser.of(id),
    // its Viewer: shown on its strip once the chat showed something
    viewer: (id) => Viewer.toggleFor(id, undefined, true), view: (id) => Viewer.of(id) });
  Picker.init($('picker'), info, (id, chat) => {
    if (!id) { Terms.focus(); return; }
    // started inside a workspace, in a folder that is in none: the folder joins it, and the chat stays in sight
    if (chat) adopt(chat.cwd);
    setView(id);
  });
  const actions = { setView, showSession, openPicker, openRecord, closeChat, nextNeeding, attach, arm, toggleSide, resume: resumeHere, read: readPast, session: sessionOf, label: chatLabel, mark: markFor, canCompact, compactNow,
    inspector, settings: () => Settings.open(), rename: () => { if (isChat(state.view)) ChatView.rename(); },
    big: toggleBig, tiles: setTiles, back: () => { back(1); endWalk(); }, reload: reloadPage,
    undoClose: () => undoClose(), closedLabel: () => { const last = lastClosed(); return last ? last[1].label : ''; },
    switchSpace, newSpace: () => { document.body.classList.remove('no-side'); Side.newSpace(); }, nest: () => toggleNest(), browser: () => Browser.toggle(),
    viewer: () => Viewer.toggle(), viewerOpen: () => Viewer.openDialog(), float: () => toggleFloat(), redraw: () => redrawNow(true) };
  Palette.init($('palette'), state, actions);
  Cards.init(goTo);
  Cards.corner(state.settings.notify && state.settings.notify.corner);
  Settings.init($('settings'), state, {
    open: openSettings,
    close: closeSettings,
    changed: (next) => {
      // what is not kept on disk stays as it is: which workspace is in front may have moved meanwhile
      state.settings = { ...next, spaces: state.settings.spaces, space: state.settings.space, also: state.settings.also, pins: state.settings.pins };
      applyLook(next);
      Cards.corner(next.notify && next.notify.corner);
      Terms.setFontSize(next.fontSize);
      $('inspector').hidden = !next.inspector || state.nest;
      refreshRecordSummary();
      paint();
    },
    ...spaceActs,
  });
  // the chats that were running before this page was there (it was loaded again): each is drawn as it was
  const drawn = Promise.all(state.chats.map((chat) => {
    Terms.hold(chat.id);
    return desk.tail(chat.id).then((tail) => Terms.replay(chat.id, tail), () => Terms.replay(chat.id, null));
  }));
  function command(name, arg) {
    if (name === 'new') openPicker();
    else if (name === 'goto') goTo(arg);
    else if (name === 'stale') { state.stale = true; paint(); }
    else if (name === 'say') toast(String(arg || ''), 9000);
    // what main says with a head and a place to go: a limit, an account with room again, a countdown at its end
    else if (name === 'card') {
      if (arg && typeof arg === 'object') toast(String(arg.text || ''), 9000, { kind: arg.kind, title: arg.title, what: arg.what, body: arg.body, target: arg.target });
    }
    // the Nest's chat finished its answer while the window is in front: said unless the Nest is what is shown
    else if (name === 'nest-answered') {
      const words = String(arg || '');
      if (!state.nest) toast(`The Nest answered${words ? `: ${words}${/[.!?…]$/.test(words) ? '' : '.'}` : '.'} Ctrl Shift Space opens it.`, 9000,
        { kind: 'nest', title: 'The Nest', what: 'answered', body: words || 'Its answer is ready.', target: 'nest' });
    }
    else if (name === 'ask-leave') askLeave();
    else if (name === 'reload') reloadPage();
    // the window changed screen or scaling, the computer woke, the graphics process started again: drawn from scratch
    else if (name === 'redraw') redrawNow(false);
    else if (name === 'nest') { if (arg === 'toggle') toggleNest(true); else openNest(); }
    // the floating card's own buttons changed its switches
    else if (name === 'float') { if (arg && typeof arg === 'object') { state.settings = { ...state.settings, float: arg }; floatSent = ''; paint(); } }
    else if (name === 'live' || name === 'seen' || name === 'away') {
      document.body.classList.toggle('live', name === 'live');
      Noir.setAwake(name === 'live');
      state.seen = name !== 'away';
      if (name === 'live') Morning.back(); else Morning.leave();
      if (state.seen) refreshUsage(false);
    }
  }
  $('version').addEventListener('click', () => (state.version === 'reload' ? reloadPage() : restartApp()));
  drawVersion();
  $('undo').addEventListener('click', () => undoClose());
  const placed = takePlace();

  window.addEventListener('pointerdown', () => { holding = true; heldAt = Date.now(); hideHints(); }, true);
  // after the click this release belongs to has been delivered
  const letGo = () => { if (!holding) return; holding = false; if (dirty) setTimeout(paint, 0); };
  for (const end of ['pointerup', 'pointercancel']) window.addEventListener(end, letGo, true);
  // a move with no button down: the release went somewhere else. One with a button down is a drag that goes on.
  window.addEventListener('pointermove', (e) => { if (!holding) return; if (e.buttons === 0) letGo(); else heldAt = Date.now(); }, true);
  window.addEventListener('blur', () => { letGo(); hideHints(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) { letGo(); hideHints(); } });
  // a pane that left itself alone because text was selected in it is brought up to date once the selection is gone
  document.addEventListener('selectionchange', () => {
    if (!held.skipped) return;
    const s = window.getSelection();
    if (s && !s.isCollapsed) return;
    held.skipped = false;
    paint();
  });

  // Before the terminal sees them. Ctrl with Alt is left alone: on many keyboards that is how @ # { [ are typed.
  const overlay = () => Picker.isOpen() || Palette.isOpen() || leaveOpen();
  // which numbers the keys held down call for: Ctrl alone the chats', Ctrl with Shift the workspaces'
  const hintKind = (e) => (e.ctrlKey && !e.altKey && !e.metaKey ? (e.shiftKey ? 'spaces' : 'chats') : '');
  const MODIFIERS = ['Control', 'Shift', 'Alt', 'AltGraph', 'Meta'];
  window.addEventListener('keydown', (e) => {
    if (MODIFIERS.includes(e.key)) {
      // a key held down repeats: only the first press counts
      if (!e.repeat) { const kind = hintKind(e); if (kind && !overlay()) armHints(kind); else hideHints(); }
      return;
    }
    hideHints();
    if (e.key === 'F5' && !e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey) {
      e.preventDefault();
      e.stopPropagation();
      if (!overlay()) { redrawNow(true); refreshNow(); }
      return;
    }
    if (!e.ctrlKey || e.altKey || e.metaKey) {
      // the keys of a page (Esc on a session looked at; J, K, the arrows, / and Esc in History; / and Esc in Settings), while nothing floats over it
      if (overlay() || !$('menu').hidden) return;
      if (e.key === 'Escape' && !e.ctrlKey && !e.altKey && !e.metaKey && (Glance.hide() || ChatView.closePlan())) { e.preventDefault(); e.stopPropagation(); return; }
      const used = state.view === 'peek' ? Peek.key(e) : state.view === 'history' ? History.key(e) : state.view === 'settings' ? Settings.key(e) : false;
      if (used) { e.preventDefault(); e.stopPropagation(); }
      return;
    }
    if (e.shiftKey && e.code === 'KeyP') { if (!Picker.isOpen()) Palette.toggle(); }
    else if (overlay()) return;
    else if (e.shiftKey && e.code === 'KeyT') openPicker();
    else if (e.shiftKey && e.code === 'KeyW' && isChat(state.view)) closeChat(state.view);
    else if (e.shiftKey && e.code === 'KeyZ' && lastClosed()) undoClose();
    else if (e.shiftKey && e.code === 'KeyN') nextNeeding();
    else if (e.shiftKey && e.code === 'KeyU') setView('stats');
    else if (e.shiftKey && e.code === 'KeyH') setView('history');
    else if (e.shiftKey && e.code === 'KeyO') openRecord();
    else if (e.shiftKey && e.code === 'Space') toggleNest(true);
    else if (e.shiftKey && e.code === 'KeyS') setView('servers');
    else if (e.shiftKey && e.code === 'KeyB' && Browser.can()) Browser.toggle();
    else if (e.shiftKey && e.code === 'KeyM') Viewer.toggle();
    else if (e.shiftKey && e.code === 'KeyA') toggleOverview();
    else if (e.shiftKey && e.code === 'KeyG' && isChat(state.view)) Glance.toggle(state.view);
    else if (e.shiftKey && e.code === 'KeyF') toggleFloat();
    else if (e.shiftKey && e.code === 'KeyI') inspector();
    else if (e.shiftKey && e.code === 'Enter') toggleBig();
    else if (!e.shiftKey && e.code === 'Comma') toggleSettings();
    else if (!e.shiftKey && e.code === 'KeyF' && state.view === 'settings') Settings.focusFind();
    else if (e.code === 'Tab') back(e.shiftKey ? -1 : 1);
    else {
      // Ctrl Shift 1 is every chat, 2 the first workspace by its tab, and so on; Ctrl 1 the first chat of the list
      const digit = /^(?:Digit|Numpad)([1-9])$/.exec(e.code);
      if (!digit) return;
      const target = numbered(e.shiftKey ? 'spaces' : 'chats').find((t) => t.n === Number(digit[1]));
      if (!target) return;
      target.go();
    }
    e.preventDefault();
    e.stopPropagation();
  }, true);
  window.addEventListener('keyup', (e) => {
    if (e.key === 'Control') endWalk();
    if (!MODIFIERS.includes(e.key)) return;
    // what is still held decides: Shift let go with Ctrl still down goes back to the chats' numbers
    const kind = hintKind(e);
    if (kind && !overlay()) armHints(kind); else hideHints();
  }, true);

  window.addEventListener('focus', () => {
    if (!overlay() && isChat(state.view)) Terms.focus();
    for (const c of state.snap.chats) if (c.chat === state.view) { state.unread.delete(c.key); see(c); }
    Morning.back();
    refreshUsage(false);
  });
  window.addEventListener('blur', () => { endWalk(); Morning.leave(); });
  document.body.classList.toggle('live', document.hasFocus());

  // the marks that age on their own ("3m", "going for 2m 05s"), what a conversation being read has added, and the numbers
  let beat = 0;
  setInterval(() => {
    beat++;
    keepPlace();
    if (closed.size) drawUndo();
    if (!state.seen) return;
    if (isChat(state.view)) ChatView.tick();
    else if (state.view === 'peek') Peek.tick();
    else if (state.view === 'history') History.tick();
    else if (state.view === 'stats') Stats.tick();
    else if (state.view === 'record') Record.render(state);
    else if (state.view === 'servers') Servers.tick();
    Browser.tick();
    Glance.tick();
    if (hints.shown && !hintsUp()) hideHints();
    if (beat % 10 === 0 && !buttonDown() && !hintsUp() && Terms.sinceKey() >= TYPING_MS) { Side.render(state); Glance.update(state); }
    else Side.tick();
    Parts.tick($('notes'));
    if (beat % 5 === 0) {
      refreshRecordSummary();
      // only the Dashboard shows them, and the limit line of the sidebar: away from it less often is enough
      if (state.view === 'stats' || Date.now() - usageAt > 30000) refreshUsage(false);
    }
  }, 1000);

  // a page that started over goes back to where the person was; the order of the chats used last stays as it was
  setView(placed || rest(), { walking: Boolean(placed) });
  refreshRecordSummary();
  // chats that ran on in the keeper while the app restarted, or went down: here again, as they were
  if (info.adopted && info.adopted.n) {
    const n = info.adopted.n;
    const ran = `Your ${n === 1 ? 'chat' : `${n} chats`} kept running.`;
    toast(info.adopted.how === 'restart' ? `Lowlit restarted. ${ran}` : info.adopted.how === 'crash' ? `Lowlit did not close properly last time. ${ran}` : ran, 7000);
  }
  // back from Gaming mode: what comes back, and a server that cannot, named
  if (info.gamed) {
    const said = gamedWords(info.gamed);
    const lost = Array.isArray(info.gamed.lost) && info.gamed.lost.length > 0;
    const servers = lost || (Array.isArray(info.gamed.servers) && info.gamed.servers.length > 0);
    if (said) toast(`Back from Gaming mode. ${said}`, 12000, { kind: lost ? 'needs' : 'done', title: 'Back from Gaming mode', body: said, target: servers ? 'servers' : '' });
  }
  if (info.previous.length && (info.restore === 'auto' || info.restore === 'crash')) reopen(info.restore);
  // started for the Nest (its line in the taskbar button's menu, or its key while the page was loading)
  if (info.nest && info.nest.asked) openNest();
  // for the self-test, and for poking at from the developer tools
  window.Desk = { state, paint, setView, look, showSession, readPast, openPicker, openRecord, refreshRecordSummary, closeChat, undoClose, nextNeeding, arm, disarm, resume, setInspector, refreshUsage, setTiles, toggleBig, back, endWalk, onScreen,
    spaceOf, spacesOf, inView, switchSpace, toggleSpace, addSpace, renameSpace, removeSpace, putFolder, colorSpace, putSession, pin, reloadPage, drawn, atPrompt, canAsk, promptBox, gamingWords, gamedWords, askLeave,
    openNest, leaveNest, toggleNest, nestChat, Nest, Browser, floatModel, toggleFloat,
    Terms, Side, Peek, History, Stats, Record, ChatView, Glance, Picker, Palette, Settings, Detail, Reader, Jev, Morning, markFor, wants };
  started = true;
  for (const run of early.splice(0)) run();
  watchSlow();
  setInterval(reportTyping, TYPING_REPORT_MS);
}

// ---- a slow moment: the page held up for a tenth of a second or more goes into the app's log with what was on
// ---- screen and what was going on, gathered over half a minute and written then (so a line comes half a minute
// ---- after the first hold-up in it); when the person says it felt slow, the log says when and with what ----
const SLOW_MS = 100;
const doing = [];              // [{ what, at }] what was going on lately (performance.now), newest last
/** Marks what is going on, for the note on a slow moment. */
function didThis(what) {
  doing.push({ what, at: performance.now() });
  if (doing.length > 20) doing.shift();
}
function watchSlow() {
  if (typeof PerformanceObserver !== 'function' || !(PerformanceObserver.supportedEntryTypes || []).includes('longtask')) return;
  let n = 0;
  let worst = 0;
  let timer = 0;
  const during = new Map();
  const report = () => {
    timer = 0;
    const d = Terms.drawing();
    const where = isChat(state.view) ? `${d.shown} terminal${d.shown === 1 ? '' : 's'} on screen, ${d.gl} drawn by the graphics chip` : `the ${state.view} page`;
    const what = [...during].map(([w, k]) => (n > 1 ? `${w} ${k}` : w)).join(', ');
    desk.slow(`the window was held up ${n} time${n === 1 ? '' : 's'} for a tenth of a second or more, the longest ${Math.round(worst)} ms; during: ${what}; ${where}`);
    n = 0;
    worst = 0;
    during.clear();
  };
  new PerformanceObserver((list) => {
    for (const e of list.getEntries()) {
      if (e.duration < SLOW_MS) continue;
      n++;
      worst = Math.max(worst, e.duration);
      // what was going on last before it ended, from half a second before it began
      const near = (at) => at <= e.startTime + e.duration && at >= e.startTime - 500;
      const keyed = performance.now() - Terms.sinceKey();
      const by = [...doing].reverse().find((x) => near(x.at));
      const what = by && (!near(keyed) || by.at > keyed) ? by.what : near(keyed) ? 'typing' : 'nothing you did (new data, a timer)';
      during.set(what, (during.get(what) || 0) + 1);
    }
    if (n && !timer) timer = setTimeout(report, 30000);
  }).observe({ entryTypes: ['longtask'] });
}

// ---- how typing feels, from the typing meter (terminals.js): once an hour a line in the app's log with how long keys
// ---- took to show, from the key to the frame that draws its echo. Never which keys. ----
const TYPING_REPORT_MS = 3600000;
function reportTyping() {
  const list = Terms.echoes(true);
  if (list.length < 10) return;
  list.sort((a, b) => a - b);
  const at = (p) => Math.round(list[Math.min(list.length - 1, Math.floor(p * list.length))]);
  desk.note('typing', `${list.length} keys timed in the last hour, from the key to the frame that shows it: median ${at(0.5)} ms, 9 in 10 within ${at(0.9)} ms, slowest ${Math.round(list[list.length - 1])} ms`);
}

// ---- while keys come in, a redraw that new data asks for waits (TYPING_MS after the last key, TYPING_MAX_MS at most):
// ---- one that lands between a key and its echo holds the echo up for its whole length. What the person does is
// ---- drawn at once. ----
const TYPING_MS = 250;
const TYPING_MAX_MS = 1500;
let typingSince = 0;
let typingTimer = 0;
function typingHold() {
  const since = Terms.sinceKey();
  if (since >= TYPING_MS) { typingSince = 0; return false; }
  const now = Date.now();
  if (!typingSince) typingSince = now;
  else if (now - typingSince >= TYPING_MAX_MS) { typingSince = 0; return false; }
  clearTimeout(typingTimer);
  typingTimer = setTimeout(() => { typingTimer = 0; if (dirty) paintData(); }, TYPING_MS - since + 10);
  return true;
}
/** A redraw asked for by new data (a new picture of the sessions, new figures), not by the person. */
function paintData() {
  if (typingHold()) { dirty = true; return; }
  didThis('drawing new figures');
  paint();
}

/**
 * Everything drawn again: each terminal from scratch, then the page; main has the window repainted too. After a change
 * of screen, of scaling or of graphics process, after the computer woke, and by hand (F5, the palette): byHand says so
 * in the app's log, which then shows when the person found the window drawn wrong.
 */
function redrawNow(byHand) {
  didThis('redrawing everything');
  Terms.redrawAll();
  paint();
  if (byHand) desk.redraw();
}

boot();
