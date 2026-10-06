'use strict';
/* global desk, h, icon, glyph, ago, dateTime, labelOf, phrase, folderOf, toast, Terms, History, PastFind, Jev, Browser, Viewer, Settings */
// The search box over the whole window (Ctrl+Shift+P): jump to any chat or
// session, read a past conversation, find something typed into a prompt box
// weeks ago, or run a command, by typing a few letters of it.

const Palette = (() => {
  const PAST_SHOWN = 8;
  const RANK = { attention: 0, error: 1, working: 2, compacting: 2, idle: 3 };
  let root = null;
  let state = null;
  let act = null;
  let input = null;
  let listEl = null;
  let shown = [];
  let chosen = 0;
  let past = [];                 // past conversations, asked for when the box opens
  let pastAt = 0;
  let typed = { query: '', list: [] }; // things typed into a prompt box, ever, that hold what is in the box now
  let typedTimer = 0;
  let found = { query: '', answer: null };
  let findTimer = 0;
  let findSeq = 0;
  let findBusy = false;
  let findAt = 0;
  let findAgain = false;
  let sortTimer = 0;
  let progress = null;
  let recordFound = { query: '', answer: null };
  let recordTimer = 0;
  let recordSeq = 0;
  const TYPED_FROM = 3;          // letters in the box before what was typed is searched

  const isOpen = () => Boolean(root) && !root.hidden;

  function init(el, deskState, actions) {
    root = el;
    state = deskState;
    act = actions;
    input = h('input', { type: 'text', placeholder: 'Jump to a chat, find something you typed, or say what to do', spellcheck: 'false', 'aria-label': 'Search' });
    listEl = h('div', { class: 'pal-list' });
    root.append(h('div', { class: 'palette', role: 'dialog', 'aria-label': 'Search chats and commands' },
      h('div', { class: 'pal-input' }, icon('search', 16), input),
      listEl,
      h('div', { class: 'pal-foot' },
        h('span', null, h('kbd', { text: '↑' }), h('kbd', { text: '↓' }), 'move'),
        h('span', null, h('kbd', { text: 'Enter' }), 'go'),
        h('span', null, h('kbd', { text: 'Esc' }), 'close'))));
    input.addEventListener('input', () => { chosen = 0; askTyped(); askFind(); askRecord(); draw(); });
    root.addEventListener('mousedown', (e) => { if (e.target === root) close(); });
    root.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') close();
      else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') move(e.key === 'ArrowDown' ? 1 : -1);
      else if (e.key === 'PageDown' || e.key === 'PageUp') move(e.key === 'PageDown' ? 8 : -8);
      else if (e.key === 'Enter') run(shown[chosen]);
      else return;
      e.preventDefault();
      e.stopPropagation();
    });
    desk.onFindProgress((p) => {
      const finished = !p.building && (!progress || progress.building);
      progress = p;
      if (!isOpen() || input.value.trim().length < TYPED_FROM) return;
      if (findBusy) { if (finished) findAgain = true; return; }
      if (finished || Date.now() - findAt >= 2000) askFind();
    });
  }

  function askFind() {
    clearTimeout(findTimer);
    const query = input.value.trim();
    const seq = ++findSeq;
    findBusy = query.length >= TYPED_FROM;
    if (!findBusy) { found = { query: '', answer: null }; findAgain = false; return; }
    findTimer = setTimeout(async () => {
      findAt = Date.now();
      let answer;
      try { answer = await desk.find(query); } catch { answer = null; }
      if (seq !== findSeq || !isOpen() || input.value.trim() !== query) return;
      findBusy = false;
      found = { query, answer };
      if (!progress && answer && answer.progress) progress = answer.progress;
      draw();
      if (findAgain) { findAgain = false; askFind(); return; }
      if (!answer || answer.ready === false) findTimer = setTimeout(() => {
        if (seq === findSeq && isOpen() && input.value.trim() === query) askFind();
      }, 1000);
      else sortLater(seq, query, answer);
    }, 180);
  }

  /** Once the words have stayed the same a moment and the index is not still growing: Jev puts the results in order. */
  function sortLater(seq, query, answer) {
    clearTimeout(sortTimer);
    if (!Jev.on() || answer.sorted || (answer.progress && answer.progress.building) || !Array.isArray(answer.results) || answer.results.length < 2) return;
    sortTimer = setTimeout(async () => {
      if (seq !== findSeq || !isOpen() || input.value.trim() !== query) return;
      let sorted = null;
      try { sorted = await desk.findSorted(query); } catch { sorted = null; }
      if (!sorted || seq !== findSeq || !isOpen() || input.value.trim() !== query) return;
      found = { query, answer: sorted };
      draw();
    }, 700);
  }

  function askRecord() {
    clearTimeout(recordTimer);
    const query = input.value.trim().slice(0, 200);
    const folder = state.settings.record && state.settings.record.folder;
    const seq = ++recordSeq;
    recordFound = { query: '', answer: null };
    if (!query || !folder) return;
    recordTimer = setTimeout(async () => {
      let answer;
      try { answer = await desk.record({ part: 'search', query }); } catch { answer = null; }
      if (seq !== recordSeq || !isOpen() || input.value.trim().slice(0, 200) !== query || state.settings.record.folder !== folder) return;
      recordFound = { query, answer };
      draw();
    }, 180);
  }

  /** Asks the watcher for what was typed, a moment after the last letter: it reads the whole prompt history. */
  function askTyped() {
    clearTimeout(typedTimer);
    const query = input.value.trim();
    if (query.length < TYPED_FROM) { typed = { query: '', list: [] }; return; }
    if (query === typed.query) return;
    typedTimer = setTimeout(async () => {
      const list = await desk.typed(query);
      if (!isOpen() || input.value.trim() !== query) return;
      typed = { query, list: Array.isArray(list) ? list : [] };
      draw();
    }, 180);
  }

  function everything() {
    const out = [];
    const here = new Set(state.chats.map((c) => c.id));
    const front = state.chats.find((c) => c.id === state.view);
    for (const chat of state.chats) {
      const s = act.session(chat.id);
      out.push({ group: 'Chats in this window', label: act.label(chat), sub: (s && phrase(s)) || folderOf(chat.cwd), mark: act.mark(s), text: chat.cwd, run: () => act.setView(chat.id) });
    }
    const others = state.snap.chats.filter((c) => !(c.chat && here.has(c.chat))).sort((a, b) => RANK[a.state] - RANK[b.state] || b.at - a.at);
    for (const c of others) {
      out.push({ group: 'In other terminals', label: labelOf(c), sub: phrase(c) || folderOf(c.cwd), mark: act.mark(c), text: `${c.cwd} ${c.kind === 'bg' ? 'background' : ''}`, run: () => act.showSession(c.key) });
    }
    for (const e of state.snap.ended || []) {
      if (state.resumed.has(e.id)) continue;
      out.push({ group: 'Ended in the last day', label: labelOf(e), sub: `${folderOf(e.cwd)} · open it here again`, icon: 'play', text: e.cwd, run: () => act.resume(e) });
    }
    const add = (label, key, name, fn, text = '') => out.push({ group: 'Do', label, key, icon: name, text, run: fn });
    if (act.closedLabel()) add(`Undo closing ${act.closedLabel()}`, 'Ctrl Shift Z', 'arrow-left', act.undoClose, 'undo reopen bring back closed');
    add('New chat', 'Ctrl Shift T', 'plus', act.openPicker, 'start claude codex powershell');
    add('Next chat that needs you', 'Ctrl Shift N', 'bell', act.nextNeeding, 'attention waiting');
    if (state.chats.length > 1) {
      add('Back to the chat I was just in', 'Ctrl Tab', 'arrow-left', act.back, 'previous last switch');
      add(state.settings.tiles === 1 ? 'Back to the chats side by side' : 'Make this chat big', 'Ctrl Shift Enter', state.settings.tiles === 1 ? 'tile-2' : 'tile-1', act.big, 'zoom maximise one full split tiles');
    }
    if (state.settings.tiles !== 1) add('Show one chat at a time', '', 'tile-1', () => act.tiles(1), 'split tiles layout single');
    if (state.settings.tiles !== 2) add('Show two chats side by side', '', 'tile-2', () => act.tiles(2), 'split tiles layout');
    if (state.settings.tiles !== 4) add('Show four chats at once', '', 'tile-4', () => act.tiles(4), 'split tiles layout grid');
    // the workspaces: each one that is not in front, every chat, and a new one
    const spaces = state.settings.spaces || [];
    spaces.forEach((s, i) => {
      if (s.id !== state.settings.space || state.loose) add(`Workspace: ${s.name}`, i < 8 ? `Ctrl Shift ${i + 2}` : '', 'layers', () => act.switchSpace(s.id), 'workspace space switch go');
    });
    if (spaces.length && (state.settings.space || state.loose)) add('Every chat, of all workspaces', 'Ctrl Shift 1', 'layers', () => act.switchSpace(''), 'workspace space all');
    add('New workspace', '', 'plus', act.newSpace, 'workspace space add create group folders');
    add('Every chat at a glance', 'Ctrl Shift A', 'cards', () => act.setView('overview'), 'overview running plan agents context branch copy');
    add('History: every conversation, to read or pick up again', 'Ctrl Shift H', 'history', () => act.setView('history'), 'past old transcripts read resume');
    add('Dashboard: every number, your accounts, what is running', 'Ctrl Shift U', 'usage', () => act.setView('stats'), 'usage stats tokens numbers cost limits account memory processor servers today');
    add('Servers: your projects\' dev servers and dashboards, to start and stop', 'Ctrl Shift S', 'terminal', () => act.setView('servers'), 'server dev localhost port dashboard start stop kill pin running');
    if (Browser.can()) {
      const mine = front ? Browser.of(front.id) : Browser.of('');
      add(front ? (mine.open ? "Close this chat's browser" : "This chat's browser: the pages it opens, beside it") : mine.open ? 'Close the browser' : 'Browser: every page the chats opened',
        'Ctrl Shift B', 'globe', act.browser, 'web browser page pages site internet url address tab chrome open');
    }
    const seen = front ? Viewer.of(front.id) : Viewer.of('');
    add(seen.open ? 'Close the Viewer' : front ? "This chat's Viewer: the pictures, videos and sounds it showed" : 'Viewer: what the chats showed last',
      'Ctrl Shift M', 'image', act.viewer, 'viewer media image picture photo video movie sound audio music player gallery show');
    add('Open pictures, videos or sounds in the Viewer…', '', 'image', act.viewerOpen, 'viewer open file media image picture photo video movie sound audio music player play');
    add(state.nest ? 'Leave the Nest' : 'The Nest: the chat of your record, with your day beside it', 'Ctrl Shift Space', 'home', act.nest,
      'nest home life day today me board ops record dashboard');
    add(state.settings.float && state.settings.float.on ? 'Hide the floating card' : 'Floating card: the chat in front, over your other programs', 'Ctrl Shift F', 'pin', act.float,
      'float floating card overlay hud always on top plan steps subagents agents context memory corner');
    for (const [tab, label] of [['today', 'today'], ['projects', 'projects'], ['todos', 'to-dos'], ['feed', 'feed']]) {
      add(`Record: ${label}`, tab === 'today' ? 'Ctrl Shift O' : '', 'history', () => act.openRecord(tab), 'ops notes decisions tasks');
    }
    add(state.nest ? 'Show or hide your day beside the chat' : 'Show or hide the panel beside the chat', 'Ctrl Shift I', 'panel', act.inspector, 'inspector tools subagents conversation changes day nest');
    add('Show or hide the list of chats', '', 'side', act.toggleSide, 'sidebar');
    if (front) {
      add('Rename this chat', '', 'pencil', act.rename);
      add('Open this chat\'s folder', '', 'folder', () => desk.openFolder(front.cwd), 'explorer');
      if (act.canCompact(front.id)) add('Compact this chat now', '', 'compact', () => act.compactNow(front.id), 'compact summary context memory tokens job done');
      add('Close this chat', 'Ctrl Shift W', 'x', () => act.closeChat(front.id));
    }
    if (others.some((c) => c.provider === 'claude' && c.pid && c.kind !== 'bg')) {
      add('Bring every chat from other terminals here', '', 'bring', () => act.arm(null), 'move powershell windows terminal');
    }
    add('Settings', 'Ctrl ,', 'settings', act.settings, 'preferences options');
    // each topic of Settings, offered once something is typed
    for (const t of Settings.topics()) {
      out.push({ group: 'Settings', label: `Settings: ${t.name}`, icon: t.icon, text: `settings preferences ${t.words}`, run: () => Settings.open(t.id), typedOnly: true });
    }
    add('Redraw the window', 'F5', 'refresh', act.redraw, 'shifted offset garbled broken drawing screen display repaint');
    add('Reload the window (chats keep running)', '', 'refresh', act.reload, 'load new version update code');
    add('Quit Lowlit', '', 'x', () => desk.quit(), 'exit close leave');
    add('Gaming mode: close every chat and server, bring them back next time', '', 'bolt', () => desk.gaming(),
      'gaming game play free memory ram processor pause everything stop all close all servers quit later restore');
    const live = new Set(state.snap.chats.map((c) => c.session));
    for (const r of past) {
      if (live.has(r.id) || state.resumed.has(r.id)) continue;
      out.push({ group: 'Past conversations', label: r.title || r.prompt || 'Untitled conversation', sub: `${folderOf(r.cwd)} · ${ago(r.at)} ago · read it`, icon: 'history', text: r.cwd,
        run: () => act.read(r.id) });
    }
    // what leads back to where it was typed: the chat if it is open, its row if it runs elsewhere, the conversation
    // itself if it is still on disk; failing all that, the words are copied
    const running = new Map(state.snap.chats.map((c) => [c.session, c]));
    for (const t of typed.list) {
      const at = running.get(t.session);
      const mine = Boolean(at && at.chat && state.chats.some((c) => c.id === at.chat));
      const leads = mine ? 'go to its chat' : at ? 'show its chat' : t.there ? 'read that conversation' : 'copy it';
      out.push({ group: 'Things you typed', label: t.text.replace(/\s+/g, ' '), sub: `${folderOf(t.cwd)} · ${ago(t.at)} ago · ${leads}`, icon: 'asked', last: true,
        run: () => {
          if (mine) act.setView(at.chat);
          else if (at) act.showSession(at.key);
          else if (t.there) act.read(t.session);
          else { desk.writeClipboard(t.text); toast('Copied what you typed.'); }
        } });
    }
    return out;
  }

  function draw() {
    const words = input.value.toLowerCase().split(/\s+/).filter(Boolean);
    let pastSeen = 0;
    shown = everything().filter((it) => {
      if (it.typedOnly && !words.length) return false;
      const name = it.label.toLowerCase();
      const hay = `${name} ${it.sub || ''} ${it.text || ''} ${it.group}`.toLowerCase();
      if (!words.every((w) => hay.includes(w))) return false;
      // a name that begins with what was typed, then a name that holds it, then anything else about the entry
      // what was typed long ago comes after everything that can be gone to by name
      it.rank = !words.length ? 0 : it.last ? 3 : name.startsWith(words[0]) ? 0 : words.every((w) => name.includes(w)) ? 1 : 2;
      // without a search, a handful of past conversations is enough
      return words.length || it.group !== 'Past conversations' || ++pastSeen <= PAST_SHOWN;
    });
    // the sort keeps the order of entries that rank the same
    if (words.length) shown.sort((a, b) => a.rank - b.rank);
    const answer = found.query === input.value.trim() && found.answer;
    if (answer && Array.isArray(answer.results)) {
      for (const r of answer.results.slice(0, 6)) shown.push({
        group: answer.sorted ? 'In past conversations · sorted by Jev' : 'In past conversations', find: r, label: r.title || r.prompt || 'Untitled conversation',
        sub: `${folderOf(r.cwd) || 'No folder'} · ${ago(r.at || r.last)} ago`,
        run: () => { act.read(r.id); History.found(r); },
      });
    }
    const record = recordFound.query === input.value.trim().slice(0, 200) && recordFound.answer;
    if (record && record.set && state.settings.record && state.settings.record.folder) {
      for (const r of (record.records || []).slice(0, 5)) shown.push({
        group: 'In your record', record: r, label: r.text,
        sub: `${r.type} · ${r.projectTitle || r.client} · ${String(r.ts).slice(0, 10)}`,
        run: () => act.openRecord('feed', '', recordFound.query),
      });
    }
    if (chosen >= shown.length) chosen = Math.max(0, shown.length - 1);
    const kids = [];
    let group = '';
    shown.forEach((it, i) => {
      // sorted by how well they match, the entries no longer sit in their groups: each then says where it is from
      if ((!words.length || it.find || it.record) && it.group !== group) {
        group = it.group;
        kids.push(h('div', { class: 'pal-group', text: group }));
        if (it.find && answer.understood && answer.understood.length) kids.push(h('p', { class: 'find-status', text: answer.understood.join(' · ') }));
      }
      if (it.record) {
        kids.push(h('div', { class: `pal-item pal-find-result${i === chosen ? ' on' : ''}`, data: { i: String(i), recordId: it.record.id }, onclick: () => run(it), onmousemove: () => { if (chosen !== i) { chosen = i; mark(); } } },
          icon('history', 15), h('div', { class: 'find-copy' },
            h('div', { class: 'find-meta', text: it.sub }), h('div', { class: 'find-moment' }, PastFind.highlight(it.label, words)))));
        return;
      }
      if (it.find) {
        const moment = (it.find.moments || [])[0];
        kids.push(h('div', { class: `pal-item pal-find-result${i === chosen ? ' on' : ''}`, data: { i: String(i), findId: it.find.id }, onclick: () => run(it), onmousemove: () => { if (chosen !== i) { chosen = i; mark(); } } },
          icon('history', 15),
          h('div', { class: 'find-copy' },
            h('div', { class: 'find-summary' }, h('span', { class: 'find-title' }, PastFind.highlight(it.label, answer.terms)), h('span', { class: 'find-meta', text: it.sub })),
            moment && h('div', { class: 'find-moment', title: dateTime(moment.at) }, PastFind.highlight(PastFind.moment(moment), answer.terms)))));
        return;
      }
      kids.push(h('div', { class: `pal-item${i === chosen ? ' on' : ''}`, data: { i: String(i) }, onclick: () => run(it), onmousemove: () => { if (chosen !== i) { chosen = i; mark(); } } },
        it.mark ? glyph(it.mark) : icon(it.icon || 'arrow-right', 15),
        h('span', { class: 'label', text: it.label }),
        it.sub && h('span', { class: 'sub', text: it.sub }),
        words.length > 0 && h('span', { class: 'from', text: it.group }),
        it.key && h('kbd', { text: it.key })));
    });
    if (!shown.length) kids.push(h('p', { class: 'quiet', text: findBusy ? 'Searching past conversations…' : input.value.trim().length >= TYPED_FROM && found.query === input.value.trim() && (!answer || answer.ready === false) ? 'Search is not ready yet.' : 'Nothing matches.' }));
    listEl.replaceChildren(...kids);
  }

  /** Moves the highlight without rebuilding the list. */
  function mark() {
    for (const el of listEl.querySelectorAll('.pal-item')) el.classList.toggle('on', Number(el.dataset.i) === chosen);
  }

  function move(step) {
    if (!shown.length) return;
    chosen = Math.min(shown.length - 1, Math.max(0, chosen + step));
    mark();
    const el = listEl.querySelector('.pal-item.on');
    if (el) el.scrollIntoView({ block: 'nearest' });
  }

  function run(it) {
    if (!it) return;
    close(true);
    it.run();
  }

  async function open() {
    if (isOpen()) return;
    root.hidden = false;
    input.value = '';
    typed = { query: '', list: [] };
    found = { query: '', answer: null };
    recordFound = { query: '', answer: null };
    findBusy = false;
    findAgain = false;
    chosen = 0;
    draw();
    input.focus();
    if (Date.now() - pastAt < 60000) return;
    pastAt = Date.now();
    const recent = await desk.recent();
    past = (recent && recent.chats) || [];
    if (isOpen()) draw();
  }

  /** leaving: something else takes the keyboard next, so it is not handed back to the terminal. */
  function close(leaving) {
    if (!isOpen()) return;
    clearTimeout(typedTimer);
    clearTimeout(findTimer);
    clearTimeout(recordTimer);
    recordSeq++;
    findSeq++;
    findBusy = false;
    findAgain = false;
    root.hidden = true;
    if (!leaving) Terms.focus();
  }

  return { init, open, close, isOpen, toggle: () => (isOpen() ? close() : open()) };
})();
