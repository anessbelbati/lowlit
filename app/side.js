'use strict';
/* global desk, h, fill, icon, glyph, bar, sync, foldGroups, popMenu, menuUnder, labelOf, phrase, folderOf, limitName, clockShort, acctName, acctShort, planName, windowOf, forecast, Parts, toast, Jev, count, dollarsShort */
// The sidebar: the chats on this machine. The chats open in this window
// and the ones that run in other terminals stand in the same list, sorted by
// what they want from the person: the one that has waited longest on top, then
// the ones that finished unseen, the ones at work and the idle ones. A click on
// a chat of this window gives it the keyboard; a click on one that runs
// elsewhere shows it in the panel, where it can be moved here. Once there are
// workspaces, a row of tabs stands above the list and the list holds the chats
// of the workspaces shown, with pins above them. Under the list: a usage limit that was reached,
// the account in use with its two limits, and the other places of the window.

const Side = (() => {
  const OLD_MS = 3 * 86400e3;
  const ENDED_SHOWN = 6;
  const READ_KEY = /^(job:[0-9a-f]{6,40}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;
  const GROUPS = [['needs', 'Needs you'], ['done', 'Finished'], ['working', 'Working'], ['idle', 'Idle'], ['limited', 'Stopped by a usage limit'], ['old', 'Old background sessions'], ['ended', 'Ended in the last day']];
  const colors = ['rose', 'olive', 'mint', 'teal', 'sky', 'indigo', 'purple'];
  const colorOf = (s, spaces) => colors.includes(s.color) ? s.color : colors[Math.max(0, spaces.findIndex((x) => x.id === s.id)) % colors.length];
  const tile = (s, spaces) => h('span', { class: `ws-tile ws-${colorOf(s, spaces)}`, text: Array.from(s.name)[0] || '', 'aria-hidden': 'true' });
  const shownSpaces = (state) => state.loose || !state.settings.space ? [] : (state.settings.spaces || []).filter((s) => s.id === state.settings.space || (state.settings.also || []).includes(s.id));
  const rows = new Map();        // row id -> { el, stamp, res }
  let root = null;
  let els = null;
  let act = null;
  let last = null;
  let allEnded = false;
  let single = null;
  const folds = foldGroups('side-fold', () => { if (last) render(last); }, ['old', 'ended']);
  const $ = (id) => document.getElementById(id);

  function init(el, actions) {
    root = el;
    act = actions;
    els = { list: $('chat-list'), n: $('side-n'), label: $('side-label'), spaces: $('spaces'), more: $('side-more'), empty: $('side-empty'), limit: $('side-limit'), acct: $('acct') };
    els.more.append(icon('more', 14));
    els.more.addEventListener('click', () => moreMenu());
    els.list.addEventListener('keydown', (e) => {
      if ((e.key === 'Enter' || e.key === ' ') && e.target.classList.contains('nav-item')) { e.preventDefault(); e.target.click(); }
    });
    els.acct.addEventListener('click', () => act.go('stats'));
    els.recordCount = h('span', { id: 'record-urgent', class: 'record-urgent' });
    els.record = h('button', { id: 'go-record', class: 'record-side-row', hidden: true, onclick: () => act.record() },
      h('span', { text: 'Record' }), els.recordCount);
    els.acct.before(els.record);
    // the Nest, where the logo at the top also leads: a door that can be seen
    els.nest = h('button', { id: 'go-nest', class: 'record-side-row', onclick: () => act.nest() }, icon('nest', 14), h('span', { text: 'Nest' }));
    els.nest.dataset.tip = 'The Nest: the chat of your record, with your day beside it.\nFrom any program: Ctrl+Shift+Space.';
    els.record.before(els.nest);
    // the servers the person pinned: how many run, and a red mark while one stopped with an error or cannot start
    els.serversN = h('span', { class: 'srv-side-n' });
    els.serversBad = h('span', { class: 'srv-side-bad', hidden: true });
    els.servers = h('button', { id: 'go-servers', class: 'record-side-row srv-side-row', onclick: () => act.go('servers') },
      icon('terminal', 14), h('span', { text: 'Servers' }), els.serversBad, els.serversN);
    els.record.after(els.servers);
    // what Lowlit takes of this computer, all of it: the app, the keeper of its consoles, and what its chats run
    els.meter = h('button', { id: 'side-meter', class: 'side-meter', hidden: true, onclick: () => act.go('stats') });
    els.servers.after(els.meter);
    $('go-history').addEventListener('click', () => act.go('history'));
    $('go-stats').addEventListener('click', () => act.go('stats'));
    $('open-settings').append(icon('settings'));
    $('open-settings').addEventListener('click', () => act.settings());
  }

  function moreMenu() {
    const n = act.elsewhere();
    const coming = last ? last.armed.size : 0;
    const spaces = last ? last.settings.spaces || [] : [];
    menuUnder(els.more, [
      { label: 'New chat', icon: 'plus', key: 'Ctrl Shift T', run: () => act.newChat() },
      n > 0 && { label: `Bring the ${n} in other terminals here`, icon: 'bring', run: () => act.arm(null) },
      coming > 0 && { label: coming === 1 ? 'Cancel the one that is coming here' : `Cancel the ${coming} that are coming here`, icon: 'x', run: () => act.disarm() },
      null,
      { label: 'New workspace…', icon: 'layers', run: () => newSpace() },
      spaces.length > 0 && { label: 'Workspaces and their folders…', icon: 'settings', run: () => act.settings('spaces') },
    ].filter((it) => it !== false));
  }

  // ---- the workspaces: "All", one tab each, and what is still unsorted. A tab says in yellow how many of its
  // ---- chats wait for the person while another one is in front. ----
  let edit = null;               // a name being typed: { id, name, el }; id '' is a workspace that is being made
  function newSpace() {
    // asked for again while its name is still being typed: the same field, not a second one
    if (edit && edit.el && edit.el.isConnected) { edit.el.focus(); return; }
    edit = { id: '', name: '', el: null };
    if (last) render(last);
    if (edit && edit.el) edit.el.focus();
  }
  function spaceMenu(id, px, py) {
    const s = (last.settings.spaces || []).find((x) => x.id === id);
    if (!s) return;
    popMenu(px, py, [
      { label: !last.loose && (last.settings.space === id || (last.settings.also || []).includes(id)) ? 'Take it out of what is shown' : 'Show it next to the others', run: () => act.toggleSpace(id) },
      { label: 'Rename', icon: 'pencil', run: () => { edit = { id, name: s.name, el: null }; render(last); if (edit && edit.el) { edit.el.focus(); edit.el.select(); } } },
      { label: 'Its folders…', icon: 'folder', run: () => act.settings('spaces') },
      null,
      { heading: 'Colour' },
      { label: `The colour of ${s.name}`, swatches: [...colors, ''].map((color) => ({ color, label: color || 'Auto', tip: color ? '' : 'Auto: the colour of its place in the tabs',
        on: (s.color || '') === color, run: () => act.colorSpace(id, color) })) },
      null,
      { label: 'Take this workspace away', icon: 'x', danger: true, run: () => act.removeSpace(id) },
    ]);
  }
  function nameBox() {
    const input = h('input', { type: 'text', class: 'space-input', maxlength: '24', spellcheck: 'false', placeholder: 'Name it', value: edit.name,
      'aria-label': edit.id ? 'A new name for the workspace' : 'A name for the new workspace' });
    const end = (keep) => {
      if (!edit || edit.el !== input) return;
      const was = edit;
      edit = null;
      if (keep && input.value.trim()) { if (was.id) act.renameSpace(was.id, input.value); else act.addSpace(input.value); }
      // The window's own drawing waits while a mouse button is down. A press on a tab takes the keyboard from this
      // field first: drawn again at once, the tab would be swapped under the pointer and the press lost.
      act.repaint();
    };
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') { e.preventDefault(); end(true); }
      else if (e.key === 'Escape') { e.preventDefault(); end(false); }
    });
    input.addEventListener('blur', () => end(true));
    edit.el = input;
    return input;
  }
  function drawSpaces(state, every) {
    const spaces = state.settings.spaces || [];
    const on = spaces.length > 0 || Boolean(edit);
    els.spaces.hidden = !on;
    els.label.hidden = on;
    els.n.hidden = on;
    if (!on) {
      if (els.spaces.childElementCount) fill(els.spaces);
      els.spaces.dataset.stamp = '';
      return;
    }
    // a name is being typed: the row is left as it is until that is over
    if (edit && edit.el && edit.el.isConnected) return;
    const count = new Map();
    const needs = new Map();
    let total = 0;
    for (const x of every) {
      if (x.group === 'old') continue;
      const ids = act.spacesOf(x.cwd, x.key);
      total++;
      for (const id of ids.length ? ids : ['?']) {
        count.set(id, (count.get(id) || 0) + 1);
        if (x.c && act.calls(x.c) && !(x.chat && x.chat.closing)) needs.set(id, (needs.get(id) || 0) + 1);
      }
    }
    const cur = state.loose ? '?' : state.settings.space;
    const stamp = JSON.stringify([spaces.map((s) => [s.id, s.name, s.color]), cur, state.settings.also, [...count], [...needs], total, edit && [edit.id]]);
    if (els.spaces.dataset.stamp === stamp) return;
    els.spaces.dataset.stamp = stamp;
    const tab = (id, name, n, wait, lines) => {
      const sp = spaces.find((s) => s.id === id);
      const active = cur === id || (sp && !state.loose && state.settings.space && (state.settings.also || []).includes(id));
      const tip = [lines[0], `${n} chat${n === 1 ? '' : 's'}${wait ? ` · ${wait} need${wait === 1 ? 's' : ''} you` : ''}`, ...lines.slice(1)].filter(Boolean).join('\n');
      return h('button', {
        class: `space-tab${sp ? ` ws-tab ws-${colorOf(sp, spaces)}` : ''}${active ? ' on' : ''}`, role: 'tab', 'aria-selected': String(Boolean(active)), data: { space: id }, tip,
        onclick: (e) => e.ctrlKey && sp ? act.toggleSpace(id) : act.switchSpace(id === '?' ? '' : id, id === '?'),
        oncontextmenu: id && id !== '?' ? (e) => { e.preventDefault(); spaceMenu(id, e.clientX, e.clientY); } : null,
      }, h('span', { class: 'space-name', text: name }),
      // the title bar already counts everyone who waits: a tab says it for its own chats only
      id !== '' && (!active || (state.settings.also || []).length > 0) && wait > 0 && h('span', { class: 'space-n', text: String(wait) }));
    };
    const kids = [tab('', 'All', total, every.filter((x) => x.group !== 'old' && x.c && act.calls(x.c) && !(x.chat && x.chat.closing)).length, ['Every chat on this machine', 'Ctrl Shift 1'])];
    spaces.forEach((s, i) => {
      if (edit && edit.id === s.id) { kids.push(nameBox()); return; }
      kids.push(tab(s.id, s.name, count.get(s.id) || 0, needs.get(s.id) || 0, [s.name, i < 8 ? `Ctrl Shift ${i + 2}` : '', 'Right-click to rename it or take it away.', 'Ctrl+click to show it next to the others.']));
    });
    // a new one is named where its tab will stand
    if (edit && !edit.id) kids.push(nameBox());
    // what is in no workspace yet: there while something is, and while it is being looked at
    if (spaces.length && (count.get('?') || cur === '?')) {
      kids.push(tab('?', 'Unsorted', count.get('?') || 0, needs.get('?') || 0, ['The chats that are in no workspace yet', 'Right-click a chat to put its folder in a workspace.']));
    }
    fill(els.spaces, kids);
  }

  /** What a row's menu offers once there are workspaces: which one its folder belongs to. */
  function spaceItems(cwd) {
    const spaces = last.settings.spaces || [];
    if (!spaces.length || !cwd) return [];
    const at = act.spaceOf(cwd);
    return [
      null,
      { heading: `"${folderOf(cwd)}" and the folders in it are in` },
      ...spaces.map((s) => ({ label: s.name, on: at === s.id, run: () => act.putFolder(cwd, s.id) })),
      { label: 'No workspace', on: !at, run: () => act.putFolder(cwd, '') },
    ];
  }

  /** A background session nobody runs any more and nobody answered for days is kept out of the way. */
  const isOld = (c, now) => c.kind === 'bg' && !c.pid && now - c.at > OLD_MS;
  function groupOf(c, state, now) {
    if (isOld(c, now)) return 'old';
    if (c.limited) return 'limited';
    // a question of Claude Code's, an error, or (Jev on) a finished turn Jev judged as asking something or stuck
    if (act.wants(c)) return 'needs';
    if (c.state === 'working' || c.state === 'compacting') return 'working';
    return state.unread.has(c.key) ? 'done' : 'idle';
  }
  /** Among the chats at work and the idle ones nothing moves: the ones of this window first, then by when they started. */
  const steady = (a, b) => (a.kind === 'away') - (b.kind === 'away') || a.born - b.born || (a.id < b.id ? -1 : 1);
  const longest = (a, b) => a.since - b.since || (a.id < b.id ? -1 : 1);
  // what nobody has looked at first; while Jev sorts them, what holds everything up, then a quick yes or no, then what failed
  const ORDER = { needs: (a, b) => a.quiet - b.quiet || a.rank - b.rank || longest(a, b), done: longest, working: steady, idle: steady, limited: longest, old: (a, b) => b.since - a.since };

  /**
   * Chats in one folder stand together in a group: each folder takes the place of its first chat in the group's order,
   * and the chats that follow it in that folder are strung on a thread through their marks ('first', 'mid', 'last').
   */
  const folderKey = (cwd) => String(cwd || '').replace(/[\\/]+$/, '').toLowerCase();
  function byFolder(items) {
    const first = new Map();
    items.forEach((x, i) => { const k = folderKey(x.cwd); if (k && !first.has(k)) first.set(k, i); });
    const at = (x, i) => { const k = folderKey(x.cwd); return k ? first.get(k) : i; };
    const sorted = items.map((x, i) => [x, i]).sort(([a, i], [b, j]) => at(a, i) - at(b, j) || i - j).map(([x]) => x);
    return sorted.map((x, i) => {
      const k = folderKey(x.cwd);
      const up = Boolean(k) && i > 0 && folderKey(sorted[i - 1].cwd) === k;
      const down = Boolean(k) && i < sorted.length - 1 && folderKey(sorted[i + 1].cwd) === k;
      return { ...x, thread: up && down ? 'mid' : up ? 'last' : down ? 'first' : '' };
    });
  }

  /**
   * What a row says it has used, each in its own place: the cost at the end of its first line, the tokens it wrote at the
   * end of its second; how full its memory is only once it is filling up, and the RAM its programs hold only from 1 GB
   * (the hover note says every figure). r: what its programs hold, as last measured.
   */
  const RAM_SHOWN = 1024 ** 3;        // bytes, as measured
  function drawMeta(m, c, r) {
    const put = (el, text) => { if (el.textContent !== text) el.textContent = text; el.hidden = !text; };
    put(m.cost, c && c.live && c.live.usd > 0 ? dollarsShort(c.live.usd) : '');
    put(m.tok, c && c.tokens && !Parts.uncounted(c.tokens) && c.tokens.out > 0 ? `${count(c.tokens.out)} out` : '');
    put(m.ram, r && r.mem >= RAM_SHOWN ? Parts.ramText(r.mem) : '');
    const mem = c ? Parts.memoryOf(c) : null;
    const tone = mem && mem.known && mem.tone ? mem.tone : '';
    put(m.mem, tone ? `memory ${Math.round(mem.part * 100)}%` : '');
    m.mem.className = `m-mem${tone ? ` ${tone}` : ''}`;
  }
  /** The hover note's part for what the second line shows: memory, tokens, cost, each as its page explains it. */
  const usedTip = (c) => (c ? [Parts.memoryOf(c) && Parts.memoryTip(c), c.tokens && Parts.useTip(c), c.live && c.live.usd > 0 && Parts.costTip(c.live.usd)].filter(Boolean).join('\n\n') : '');

  /** Every chat on the machine as a row to be: the chats of this window, then every session that is not in one of them. */
  function listOf(state, now) {
    const here = new Map(state.chats.map((c) => [c.id, c]));
    const onScreen = act.onScreen();
    const peeked = state.view === 'peek' && state.sel && state.sel.kind === 'live' ? state.sel.key : '';
    const used = new Set();
    const out = [];
    const hereRow = (id, chat, c, label, sub) => {
      const group = chat.closing || !c ? 'idle' : groupOf(c, state, now);
      return { id, kind: 'here', chat, c, key: c ? c.key : '', label, sub, mark: chat.closing ? 'ended' : act.mark(c), group: group === 'old' ? 'idle' : group,
        since: c ? c.since : 0, rank: c ? Jev.rank(c) : 3, born: chat.startedAt, on: state.view === chat.id, shown: onScreen.includes(chat.id), cwd: chat.cwd,
        quiet: Boolean(c && act.wants(c) && !act.calls(c)) };
    };
    for (const chat of state.chats) {
      const c = act.session(chat.id);
      if (c) used.add(c.key);
      out.push(hereRow(`chat:${chat.id}`, chat, c, act.label(chat), act.sub(chat)));
    }
    for (const c of state.snap.chats) {
      if (used.has(c.key)) continue;
      const chat = (c.chat && here.get(c.chat)) || null;
      const sub = phrase(c) || (state.unread.has(c.key) ? 'Finished' : 'Idle');
      // a second session in a chat of this window: listed too, and it leads to that chat
      if (chat) { out.push(hereRow(`live:${c.key}`, chat, c, labelOf(c), sub)); continue; }
      out.push({ id: `live:${c.key}`, kind: 'away', chat: null, c, key: c.key, label: labelOf(c), sub, mark: act.mark(c), group: groupOf(c, state, now),
        since: c.since, rank: Jev.rank(c), born: c.started || c.at, on: peeked === c.key, shown: false, cwd: c.cwd, quiet: act.wants(c) && !act.calls(c) });
    }
    return out;
  }

  function pick(x) {
    if (x.kind === 'here') act.focus(x.chat.id, x.key);
    else if (x.kind === 'ended') act.look({ kind: 'ended', key: x.e.id });
    else act.look({ kind: 'live', key: x.key });
  }

  function sessionItems(x) {
    if (!x.c || !READ_KEY.test(x.key) || (x.kind !== 'here' && x.kind !== 'away')) return [];
    const spaces = last.settings.spaces || [];
    const folder = act.spaceOf(x.cwd);
    const home = spaces.find((s) => s.id === folder);
    const ids = act.spacesOf(x.cwd, x.key);
    const pins = last.settings.pins || { top: [], space: [] };
    return [null,
      ...(home ? [{ label: `${(pins.space || []).includes(x.key) ? 'Unpin from' : 'Pin in'} ${home.name}`, icon: 'pin', run: () => act.pin(x.key, 'space') }] : []),
      { label: (pins.top || []).includes(x.key) ? 'Unpin from the top' : 'Pin on top of everything', icon: 'pin', run: () => act.pin(x.key, 'top') },
      ...(spaces.length ? [null, { heading: 'Workspaces' }, ...spaces.map((s) => ({
        label: s.id === folder ? `${s.name}, by its folder` : s.name, on: ids.includes(s.id),
        run: () => { if (s.id !== folder) act.putSession(x.key, s.id, x.cwd); },
      }))] : []),
    ];
  }

  function menu(x, px, py) {
    if (x.kind === 'here') {
      popMenu(px, py, [
        { label: 'Rename', icon: 'pencil', run: () => act.rename(x.chat.id) },
        { label: 'Open its folder', icon: 'folder', run: () => desk.openFolder(x.chat.cwd) },
        ...spaceItems(x.chat.cwd),
        ...sessionItems(x),
        ...(act.canCompact(x.chat.id) ? [{ label: Jev.ready(x.c) ? 'Compact now: its job is done' : 'Compact now', icon: 'compact', run: () => act.compactNow(x.chat.id) }] : []),
        null,
        { label: 'Close this chat', icon: 'x', key: 'Ctrl Shift W', danger: true, run: () => act.close(x.chat.id) },
      ]);
      return;
    }
    if (x.kind === 'ended') {
      popMenu(px, py, [
        { label: 'Resume here', icon: 'play', run: () => act.resume(x.e) },
        { label: 'Look at it', icon: 'arrow-right', run: () => pick(x) },
        ...spaceItems(x.e.cwd),
        null,
        { label: 'Take it off this list', icon: 'x', run: () => act.forget(x.e.id) },
      ]);
      return;
    }
    const c = x.c;
    const items = [];
    if (c.kind === 'bg' && c.job) items.push({ label: 'Open here', icon: 'terminal', run: () => act.attach(c) });
    else if (c.provider === 'claude' && c.pid && c.session) {
      items.push(last.armed.has(c.session) ? { label: 'Leave it where it is', icon: 'x', run: () => act.disarm(c.session) } : { label: 'Bring here', icon: 'bring', run: () => act.arm([c.session]) });
    }
    items.push({ label: 'Look at it', icon: 'arrow-right', run: () => pick(x) });
    if (c.cwd) items.push({ label: 'Open its folder', icon: 'folder', run: () => desk.openFolder(c.cwd) });
    items.push(...spaceItems(c.cwd));
    items.push(...sessionItems(x));
    popMenu(px, py, items);
  }

  /**
   * One row, two lines. The first: its mark, its name, then at its end how long it has waited (a chat that waits) and
   * what it has cost. The second, under the name: its folder, then at its end the tokens it wrote, and what is worth a
   * look (memory filling up, a lot of RAM). calls: a chat of it calls for the person on one of its pages.
   */
  function buildRow(x, armed, calls) {
    const waits = x.kind === 'ended' || x.group === 'needs' || x.group === 'done';
    const meta = { cost: h('span', { class: 'm-cost', hidden: true }), tok: h('span', { class: 'm-tok', hidden: true }),
      ram: h('span', { class: 'm-ram', hidden: true }), mem: h('span', { class: 'm-mem', hidden: true }) };
    const folder = folderOf(x.cwd);
    const el = h('div', {
      class: `nav-item chat k-${x.kind}${x.on ? ' on' : ''}${x.shown ? ' shown' : ''}${x.chat && x.chat.closing ? ' closing' : ''}${x.edge ? ` ws-edge ws-${x.edge}` : ''}`, role: 'button', tabindex: '0', 'aria-current': x.on ? 'true' : 'false',
      data: { row: x.id, id: x.kind === 'here' ? x.chat.id : '', key: x.key, sub: x.sub, mark: x.mark, num: x.num || '' },
      onclick: () => pick(x), oncontextmenu: (e) => { e.preventDefault(); menu(x, e.clientX, e.clientY); },
      ondblclick: x.kind === 'ended' ? () => act.resume(x.e) : null,
    },
    glyph(x.mark, 13),
    h('span', { class: 'label', text: x.label }),
    x.c && x.c.agents && x.c.agents.running > 0 && h('span', { class: 'subs' }, icon('agents', 11), String(x.c.agents.running)),
    calls && icon('globe', 12, 'row-web'),
    waits && h('span', { class: `when${x.group === 'needs' && !x.quiet ? ' needs' : ''}`, data: { time: x.since } }),
    meta.cost,
    x.kind === 'away' && armed && icon('bring', 12, 'out coming'),
    x.pinned && icon('pin', 11, 'row-pin'),
    x.kind === 'here' && h('button', { class: 'x', title: 'Close this chat (Ctrl+Shift+W)', onclick: (e) => { e.stopPropagation(); act.close(x.chat.id); } }, icon('x', 12)),
    x.thread && h('span', { class: `thread t-${x.thread}`, 'aria-hidden': 'true' }),
    h('span', { class: 'meta' }, h('span', { class: 'm-folder', text: folder, hidden: !folder }), meta.mem, meta.ram, meta.tok));
    return { el, meta };
  }

  /** What a row's hover note says before the measurements: its name, what it is doing, where it is. */
  function baseTip(x, armed, calls) {
    const lines = [x.label];
    if (x.sub) lines.push(x.sub);
    if (calls) lines.push('It needs you on one of its pages: its browser shows it.');
    if (x.cwd) lines.push(x.cwd);
    if (x.kind === 'ended') lines.push('Its program has ended. Click to look at it, double-click to pick it up again here.');
    else if (x.kind === 'away') {
      lines.push(x.c.kind === 'bg' ? 'A background session: it runs outside every terminal. Click to look at it.'
        : armed ? 'It opens here as soon as you close it where it runs now.' : 'It runs in another terminal. Click to look at it, and to move it here.');
    }
    if (x.num) lines.push(`Ctrl ${x.num}`);
    if (x.c && x.c.agents && x.c.agents.running > 0) lines.push(`${x.c.agents.running} subagents working`);
    return lines.join('\n');
  }

  function continueStopped(keys) {
    const chats = new Set();
    const left = new Set();
    const away = new Set();
    for (const c of last.snap.chats) {
      if (!keys.includes(c.key) || !c.limited) continue;
      const chat = last.chats.find((x) => x.id === c.chat);
      if (chat) { if (!chat.closing) (act.atPrompt(chat.id) ? chats : left).add(chat.id); }
      else away.add(c.key);
    }
    for (const id of chats) desk.input(id, 'continue\r');
    toast(`Typed "continue" in ${chats.size} chat${chats.size === 1 ? '' : 's'}.`
      + (left.size ? ` ${left.size} left alone: ${left.size === 1 ? 'its' : 'their'} screen did not show an empty prompt. Open ${left.size === 1 ? 'it' : 'them'} and continue by hand.` : '')
      + (away.size ? ` ${away.size} more run in other terminals: continue those there.` : ''), 7000);
  }

  function drawStopped(sec, items, now) {
    let line = sec.el.querySelector('.limit-heading');
    if (!line) {
      line = h('div', { class: 'limit-heading' });
      sec.head.replaceWith(line);
      line.append(sec.head);
    }
    const until = Math.max(0, ...items.map((x) => x.c && x.c.limit ? x.c.limit.until : 0));
    const status = h('span', { class: 'limit-status' }, h('span', { class: 'limit-prefix', text: 'lifts in ', hidden: until <= now }),
      h('span', { data: { left: until, zero: 'limit lifted' } }));
    const keys = items.map((x) => x.key);
    const button = h('button', { class: 'limit-continue', text: 'Continue all',
      tip: 'Claude Code continues these by itself when the limit lifts, unless that is turned off in its /config. This types "continue" and Enter in each of them that shows its prompt.',
      onclick: () => continueStopped(keys) });
    sec.head.title = 'Stopped by a usage limit';
    fill(line, sec.head, status, button);
  }

  function tick(now = Date.now()) {
    if (!root) return;
    Parts.tick(root, now);
    for (const el of root.querySelectorAll('.limit-status')) el.querySelector('.limit-prefix').hidden = Number(el.querySelector('[data-left]').dataset.left) <= now;
  }

  function render(state) {
    last = state;
    const now = Date.now();
    const calling = new Set(act.calling ? act.calling() : []);
    const every = listOf(state, now);
    drawSpaces(state, every);
    const list = every.filter((x) => act.inView(x.cwd, x.key));
    const spaces = state.settings.spaces || [];
    const shown = shownSpaces(state);
    const pins = state.settings.pins || { top: [], space: [] };
    const endedSel = state.view === 'peek' && state.sel && state.sel.kind === 'ended' ? state.sel.key : '';
    const ended = (state.snap.ended || []).filter((e) => !state.resumed.has(e.id) && act.inView(e.cwd, e.id));
    const endedRows = [];
    for (const e of allEnded ? ended : ended.slice(0, ENDED_SHOWN)) {
      endedRows.push({ id: `ended:${e.id}`, kind: 'ended', chat: null, c: null, e, key: e.id, label: labelOf(e), sub: e.cut ? 'Ended while it was still working' : 'Ended', mark: 'ended',
        group: 'ended', since: e.at, born: e.at, on: endedSel === e.id, shown: false, cwd: e.cwd });
    }

    const seen = new Set();
    const kids = [];
    const groups = [];
    // The number Ctrl goes to a row with (desk.js): the first nine rows from the top that can be seen, outside a folded
    // group or workspace, not ended and not closing.
    let num = 0;
    let foldedAbove = false;
    const drawGroup = (gid, title, items, dest, group = gid) => {
      if (!items.length) return;
      const sec = folds.draw(gid, title, group === 'ended' ? ended.length : items.length);
      groups.push(sec.el);
      if (group === 'limited') drawStopped(sec, items, now);
      const unseen = foldedAbove || folds.folded(gid);
      const els_ = [];
      for (const item of byFolder(items)) {
        const home = spaces.find((s) => s.id === (act.spaceOf(item.cwd) || act.spacesOf(item.cwd, item.key)[0]));
        const x = { ...item, edge: !state.settings.space && !state.loose && home ? colorOf(home, spaces) : '',
          pinned: Boolean(item.c && ((pins.top || []).includes(item.key) || (pins.space || []).includes(item.key))) };
        x.num = !unseen && x.kind !== 'ended' && !(x.chat && x.chat.closing) && num < 9 ? ++num : 0;
        seen.add(x.id);
        const armed = Boolean(x.c && state.armed.has(x.c.session));
        const calls = x.kind === 'here' ? calling.has(x.chat.id) : x.kind === 'away' && calling.has(`s:${x.key}`);
        // a row is rebuilt only when something it shows changed
        const stamp = JSON.stringify([x.kind, x.key, x.label, x.sub, x.mark, x.group, x.on, x.shown, x.num, x.cwd, x.chat && x.chat.id, x.chat && x.chat.closing, armed, x.c && x.c.kind, x.pinned, x.edge, x.c && x.c.agents && x.c.agents.running,
          (x.kind === 'ended' || x.group === 'needs' || x.group === 'done') && x.since, x.thread, calls]);
        let row = rows.get(x.id);
        if (!row || row.stamp !== stamp) rows.set(x.id, row = { ...buildRow(x, armed, calls), stamp, base: baseTip(x, armed, calls) });
        // Everything under a chat's console (the console itself, the agent, what the agent started), or what a
        // session elsewhere holds: the note says it all, the row its RAM once that is a lot.
        const r = x.kind === 'here' ? (state.res && state.res.chats[x.chat.id]) || null : x.c ? Parts.resOf(state, x.c) : null;
        // what it has used moves with every reply: written in as it is, without building the row again
        drawMeta(row.meta, x.c, r);
        const mine = x.c ? Parts.resOf(state, x.c) : null;
        const runs = mine ? Parts.itemsShort(mine, x.c) : '';
        row.el.dataset.tip = [row.base, r ? `${Parts.resTip(r, x.kind === 'here' ? 'This chat' : 'This session')}${runs ? `\nIt runs: ${runs}` : ''}` : '', usedTip(x.c)].filter(Boolean).join('\n\n');
        els_.push(row.el);
      }
      if (group === 'ended' && ended.length > ENDED_SHOWN) {
        const moreId = `more:${allEnded}:${ended.length}`;
        seen.add(moreId);
        let row = rows.get(moreId);
        if (!row) rows.set(moreId, row = { el: h('button', { class: 'side-all link', text: allEnded ? 'Show fewer' : `Show all ${ended.length}`, onclick: () => { allEnded = !allEnded; if (last) render(last); } }), stamp: '' });
        els_.push(row.el);
      }
      sync(sec.inner, els_);
      dest.push(sec.el);
    };
    const pinned = (x, kind) => x.c && x.group !== 'old' && (pins[kind] || []).includes(x.key);
    drawGroup('top', 'Pinned', every.filter((x) => pinned(x, 'top')).map((x) => ({ ...x, id: `top:${x.id}` })), kids);
    const drawList = (items, prefix, dest, inSpace) => {
      if (inSpace) drawGroup(`${prefix}pinned`, 'Pinned', items.filter((x) => pinned(x, 'space')).sort(steady), dest);
      for (const [gid, title] of GROUPS.slice(0, -2)) {
        drawGroup(`${prefix}${gid}`, title, items.filter((x) => x.group === gid && !(inSpace && pinned(x, 'space'))).sort(ORDER[gid]), dest, gid);
      }
    };
    if (shown.length > 1) {
      const placed = new Set();
      for (const sp of shown) {
        const items = list.filter((x) => x.group !== 'old' && act.spacesOf(x.cwd, x.key).includes(sp.id)).map((x) => {
          if (placed.has(x.id)) return { ...x, id: `also:${sp.id}:${x.id}` };
          placed.add(x.id);
          return x;
        });
        const sec = folds.draw(`ws:${sp.id}`, sp.name, items.length);
        sec.el.className = `group ws-block ws-tint ws-${colorOf(sp, spaces)}${folds.folded(`ws:${sp.id}`) ? ' folded' : ''}`;
        fill(sec.title, tile(sp, spaces), h('span', { class: 'space-name', text: sp.name }));
        const old = sec.head.querySelector('.ws-wait');
        if (old) old.remove();
        const n = items.filter((x) => x.c && act.calls(x.c) && !(x.chat && x.chat.closing)).length;
        if (n) sec.head.append(h('span', { class: 'ws-wait space-n', text: String(n) }));
        const inside = [];
        foldedAbove = folds.folded(`ws:${sp.id}`);
        drawList(items, `ws:${sp.id}:`, inside, true);
        foldedAbove = false;
        sync(sec.inner, inside);
        groups.push(sec.el);
        kids.push(sec.el);
      }
      drawGroup('old', 'Old background sessions', list.filter((x) => x.group === 'old').sort(ORDER.old), kids);
      drawGroup('ended', 'Ended in the last day', endedRows, kids);
    } else {
      const inside = [];
      drawList(list, '', inside, shown.length === 1);
      drawGroup('old', 'Old background sessions', list.filter((x) => x.group === 'old').sort(ORDER.old), inside);
      drawGroup('ended', 'Ended in the last day', endedRows, inside);
      if (shown.length) {
        if (!single) single = h('div');
        single.className = `ws-list ws-tint ws-${colorOf(shown[0], spaces)}`;
        sync(single, inside);
        kids.push(single);
      } else kids.push(...inside);
    }
    sync(els.list, kids);
    for (const id of rows.keys()) if (!seen.has(id)) rows.delete(id);
    folds.keep(groups);
    const running = list.filter((x) => x.group !== 'old').length;
    els.n.textContent = running ? String(running) : '';
    els.empty.hidden = groups.length > 0;
    if (!els.empty.hidden) {
      const words = state.loose ? 'Nothing is left to sort: every chat is in a workspace.'
        : state.settings.space ? 'No chat of this workspace is running. Start one with New chat: its folder joins this workspace.'
          : 'No chat is running on this machine. Start one with New chat.';
      if (els.empty.textContent !== words) els.empty.textContent = words;
    }

    drawLimit(state, now);
    drawAccount(state, now);
    const record = state.recordSummary;
    els.record.hidden = !(state.settings.record && state.settings.record.folder);
    els.record.classList.toggle('on', state.view === 'record');
    els.record.setAttribute('aria-current', state.view === 'record' ? 'page' : 'false');
    els.recordCount.textContent = record && record.urgent ? String(record.urgent) : '';
    els.nest.classList.toggle('on', Boolean(state.nest));
    els.nest.setAttribute('aria-current', state.nest ? 'page' : 'false');
    els.record.dataset.tip = record && record.set ? `${record.urgent} urgent items of ${record.mine} only you can do. ${record.dates} open dates due within seven days or past.\nOpen the Record (Ctrl+Shift+O).` : 'Open the Record (Ctrl+Shift+O).';
    servers(state);
    meter(state);
    place('go-history', 'history', 'History', state.view === 'history');
    place('go-stats', 'usage', 'Dashboard', state.view === 'stats');
    $('open-settings').classList.toggle('on', state.view === 'settings');
    $('open-settings').setAttribute('aria-current', state.view === 'settings' ? 'page' : 'false');
    // the times just drawn get their text now, not a second from now
    tick(now);
  }

  function servers(state) {
    if (!els) return;
    const s = act.serverSummary();
    const on = state.view === 'servers';
    els.servers.classList.toggle('on', on);
    els.servers.setAttribute('aria-current', on ? 'page' : 'false');
    const n = s.running.length ? String(s.running.length) : '';
    if (els.serversN.textContent !== n) els.serversN.textContent = n;
    els.serversBad.hidden = !s.wrong.length;
    els.servers.dataset.tip = [
      s.running.length ? `Running: ${s.running.join(', ')}.` : s.pinned ? 'None of your pinned servers runs.' : 'Your projects\' dev servers and dashboards: pin them, start and stop them.',
      s.wrong.length ? `Stopped with an error, or its port is taken: ${s.wrong.join(', ')}.` : '',
      'Open Servers (Ctrl+Shift+S).',
    ].filter(Boolean).join('\n');
  }


  /**
   * What Lowlit takes of this computer, as last measured: all of it first (the app, the keeper of its consoles,
   * and everything its chats run), then the app's own share and its chats'. Hidden until something was measured.
   */
  function meter(state) {
    const res = state.res;
    const app = res && res.app;
    els.meter.hidden = !app;
    if (!app) return;
    const parts = state.chats.map((c) => res.chats && res.chats[c.id]).filter(Boolean);
    const chatsMem = parts.reduce((a, x) => a + x.mem, 0);
    const chatsCpu = parts.every((x) => x.cpu !== null) ? parts.reduce((a, x) => a + x.cpu, 0) : null;
    const cpu = app.cpu === null || chatsCpu === null ? null : app.cpu + chatsCpu;
    const mem = app.mem + chatsMem;
    const n = parts.length;
    const stamp = JSON.stringify([Parts.ramText(mem), Parts.cpuText(cpu), Parts.ramText(app.mem), Parts.cpuText(app.cpu), n, Parts.ramText(chatsMem), Parts.cpuText(chatsCpu), Parts.ramText(res.memory || 0), state.view === 'stats']);
    if (els.meter.dataset.stamp === stamp) return;
    els.meter.dataset.stamp = stamp;
    const cpuWords = Parts.cpuText(cpu);
    fill(els.meter,
      h('span', { class: 'mt-top' }, icon('gauge', 14), h('span', { class: 'mt-name', text: 'Lowlit' }),
        h('b', { class: 'mt-ram', text: Parts.ramText(mem) }), cpuWords && h('span', { class: 'mt-cpu', text: cpuWords })),
      h('span', { class: 'mt-split' }, `app ${Parts.ramText(app.mem)}`, n > 0 && ` · ${n} chat${n === 1 ? '' : 's'} ${Parts.ramText(chatsMem)}`));
    const share = (r, c) => [Parts.ramText(r), Parts.cpuText(c)].filter(Boolean).join(' · ');
    els.meter.dataset.tip = [
      `All of Lowlit: ${Parts.ramText(mem)} of RAM${cpuWords ? `, ${cpuWords} of the processor` : ''}.`,
      `The app itself (its window and pages, the keeper that holds your chats' consoles, the helper that measures): ${share(app.mem, app.cpu)}.`,
      n > 0 ? `Your ${n} chat${n === 1 ? '' : 's'} here (Claude Code and everything each one runs): ${share(chatsMem, chatsCpu)}.` : 'No chat runs in this window.',
      res.memory ? `This computer has ${Parts.ramText(res.memory)} of RAM.` : '',
      'Measured every few seconds. Click for the Dashboard.',
    ].filter(Boolean).join('\n');
    els.meter.classList.toggle('on', state.view === 'stats');
  }

  function place(id, name, label, on) {
    const el = $(id);
    el.classList.toggle('on', on);
    el.setAttribute('aria-current', on ? 'page' : 'false');
    if (el.dataset.stamp === label) return;
    el.dataset.stamp = label;
    fill(el, icon(name), h('span', { class: 'label', text: label }));
  }

  /** A usage limit that was reached and has not lifted yet: one line above the account, until it lifts. */
  function drawLimit(state, now) {
    let found = null;
    for (const c of state.snap.chats) if (c.limit && c.limit.until > now && (!found || c.limit.until > found.until)) found = c.limit;
    for (const l of state.usage ? state.usage.limits : []) if (l.until > now && (!found || l.until > found.until)) found = l;
    els.limit.hidden = !found;
    if (!found) return;
    const stamp = `${found.type}|${found.until}`;
    if (els.limit.dataset.stamp === stamp) return;
    els.limit.dataset.stamp = stamp;
    const name = limitName(found.type);
    els.limit.dataset.tip = `You reached the ${name}.\nIt lifts at ${clockShort(found.until)}.\nRead from what Claude Code wrote in the chats that ran into it.`;
    fill(els.limit, icon('gauge', 14), h('span', { class: 'words' }, `${name.replace(/^./, (ch) => ch.toUpperCase())} reached`), h('span', { class: 'r' }, 'lifts in ', h('b', { data: { left: found.until, zero: 'a moment' } })));
  }

  /** One usage limit of the account in use: a line that fills, how much is used, how long until it resets. f: where it is heading. */
  function limitRow(short, label, w, pace, f) {
    const k = h('span', { class: 'k', text: short });
    if (!w) return h('div', { class: 'slim none', tip: 'No reading yet. Claude Code hands the usage limits (Pro and Max plans) only to a status line command.\nTurn on Lowlit\'s once: one line in ~/.claude/settings.json, "Usage limits" in the README.\nThey show here after your next message.' }, k, bar(0), h('span', { class: 'r', text: 'no reading yet' }));
    if (!w.open) return h('div', { class: 'slim fresh', tip: 'The last one ended. A new one starts with your next message.' }, k, bar(0), h('span', { class: 'r', text: 'fresh' }));
    // one that will be used up before it resets is pointed out before it is nearly full
    const tone = w.tone || (f && f.full ? 'warm' : '');
    return h('div', { class: `slim ${tone}`, tip: Parts.limitTip(label, w, pace, f) }, k, bar(w.used / 100, tone, f ? f.at / 100 : 0), h('b', { text: `${Math.round(w.used)}%` }), h('span', { class: 'r', data: { left: w.until } }));
  }

  /** The account in use: who, how much of its two limits is used, and, once it runs out, which other account has the most room. */
  function drawAccount(state, now) {
    const v = Parts.acctView(state);
    drawOtherAccounts(v, now);
    const me = v.me;
    const card = els.acct;
    const five = me ? windowOf(me.five, now) : null;
    const week = me ? windowOf(me.week, now) : null;
    const f5 = five && five.open ? forecast(me.five, me.pace.five, now) : null;
    const fw = week && week.open ? forecast(me.week, me.pace.week, now) : null;
    const tight = Boolean((five && five.open && five.used >= 90) || (f5 && f5.full) || (week && week.open && week.used >= 90));
    // the person does the switching: the app only points at the one with the most room, as last seen on this machine
    const best = tight ? Parts.roomiest(v.list, now) : null;
    const told = (w) => w && [w.used, w.until, Math.floor(w.at / 60e3), w.until > now];
    const stamp = JSON.stringify([v.known, me && [me.key, me.email, me.plan, told(me.five), told(me.week), me.pace, f5 && [Math.round(f5.at), Boolean(f5.full)], fw && [Math.round(fw.at), Boolean(fw.full)]], v.names, best && best.key]);
    if (card.dataset.stamp === stamp) return;
    card.dataset.stamp = stamp;
    const plan = me ? planName(me.plan) : '';
    if (me) card.dataset.tip = `${acctName(me, v.names)}\nThe account Claude Code is logged in to on this machine.\nClick for the Dashboard: every account, and what was done under each.`;
    else delete card.dataset.tip;
    fill(card,
      me && h('div', { class: 'acct-top' }, h('span', { class: 'acct-name', text: acctShort(me, v.names) }), plan && h('span', { class: 'acct-plan', text: plan })),
      me && limitRow('5h', '5-hour limit', five, me.pace.five, f5),
      me && limitRow('Week', 'weekly limit', week, me.pace.week, fw),
      best && h('div', { class: 'acct-room', tip: `The most room of your other accounts, as last seen on this machine.\n\n${Parts.restingTip(best, v.names, now)}` }, 'most room: ', h('b', { text: acctShort(best, v.names) })),
      !me && h('div', { class: 'acct-top' }, h('span', { class: 'acct-name', text: v.known ? 'Not logged in' : 'Looking for your account…' })));
  }

  const accountFolds = foldGroups('side-account-fold', () => { if (last) { drawAccount(last, Date.now()); Parts.tick(root); } }, ['others']);
  function drawOtherAccounts(v, now) {
    const rows = Parts.otherAccounts(v.list, now);
    const g = accountFolds.draw('others', '', rows.length);
    g.el.classList.add('acct-others');
    g.head.classList.add('acct-others-toggle');
    g.el.hidden = !rows.length;
    if (!g.el.isConnected) els.acct.after(g.el);
    const summary = Parts.otherSummary(rows, now);
    g.count.textContent = '';
    if (summary.until) fill(g.title, `${rows.length} other account${rows.length === 1 ? '' : 's'} · next back in `,
      h('span', { text: Parts.resetLeft(summary.until - now), data: { left: summary.until, resetLeft: '1' } }));
    else g.title.textContent = summary.text;
    const stamp = JSON.stringify([v.names, rows.map(({ a, known, hold }) => [a.key, a.email, a.plan, a.to, a.five, a.week, known, hold && hold.kind]),
      rows.map(({ a }) => [a.five && a.five.until <= now, a.week && a.week.until <= now])]);
    if (g.el.dataset.stamp === stamp) return;
    g.el.dataset.stamp = stamp;
    fill(g.inner, rows.map(({ a, known, hold }) => {
      let words = known ? 'room now' : 'not seen yet';
      if (hold) {
        const used = `${Math.round(hold.w.used)}%`;
        words = hold.kind === 'five'
          ? [`5h ${used} · back in `, h('span', { text: Parts.resetLeft(hold.w.until - now), data: { left: hold.w.until, resetLeft: '1' } })]
          : `Week ${used} · back ${new Date(hold.w.until).toLocaleDateString('en-GB', { weekday: 'short' })} ${clockShort(hold.w.until)}`;
      }
      return h('div', { class: `acct-other-row${hold || !known ? ' waiting' : ''}`, data: { acct: a.key }, tip: Parts.otherTip(a, v.names, now) },
        h('span', { class: 'acct-other-name', text: acctShort(a, v.names) }), h('span', { class: 'acct-other-state' }, words));
    }));
  }

  /** Brings one session's row into view; its group is unfolded if need be. */
  function reveal(key) {
    const find = () => els.list.querySelector(`.nav-item[data-key="${CSS.escape(key)}"]`);
    let el = find();
    if (!el) return;
    let changed = false;
    for (let sec = el.closest('.group'); sec; sec = sec.parentElement.closest('.group')) {
      if (!sec.classList.contains('folded')) continue;
      folds.set(sec.dataset.group, false);
      changed = true;
    }
    if (changed) {
      if (last) render(last);
      el = find();
      if (!el) return;
    }
    el.scrollIntoView({ block: 'nearest' });
    el.classList.add('flash');
    setTimeout(() => el.classList.remove('flash'), 1400);
  }

  return { init, render, reveal, newSpace, colors, colorOf, tick, servers };
})();
