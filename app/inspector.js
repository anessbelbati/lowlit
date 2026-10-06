'use strict';
/* global desk, h, fill, icon, glyph, sync, folderOf, phrase, markOf, seenWait, menuUnder, toast, Parts, Terms, Detail, Glance */
// The chats on screen. Each has a place of its own: a slim strip (which chat
// it is, what it is doing, how full its memory is; the rest shows on hover)
// and under it the room its terminal is drawn in. One, two or four share the
// screen, and the one that holds the keyboard is marked. Beside them, when
// asked for, the panel of that chat: the same pane a session gets when it is
// looked at from the sidebar, with its tool calls, its conversation as it can
// be read, the files it changed, its subagents and its numbers, live.

const ChatView = (() => {
  let grid = null;               // the places on screen
  let side = null;               // the panel beside them
  let act = null;
  let detail = null;
  let none = null;
  let noneStamp = '';
  let editing = '';              // the chat whose name is being typed
  let last = null;
  const tiles = new Map();       // chat id -> { id, el, head, plan, pop, body, stamp, planStamp, planOpen, doing, rest, wasOn }

  function init(gridEl, sideEl, actions) {
    grid = gridEl;
    side = sideEl;
    act = actions;
    none = h('div', { class: 'insp-empty', hidden: true });
    const host = h('div');
    side.append(none, host);
    detail = Detail.create(host, { attach: act.attach, arm: act.arm, disarm: act.disarm, resume: act.resume }, { compact: true });
    // a press anywhere but on a plan or its list puts an open list away
    document.addEventListener('pointerdown', (e) => {
      for (const t of tiles.values()) {
        if (t.planOpen && !t.plan.contains(e.target) && !t.pop.contains(e.target)) { t.planOpen = false; if (last) drawPlan(t, act.session(t.id)); }
      }
    }, true);
  }

  /** One chat's place on screen, made the first time it is asked for. */
  function tileOf(id) {
    let t = tiles.get(id);
    if (t) return t;
    const head = h('div', { class: 'tile-head' });
    const plan = h('button', { class: 'tile-plan', hidden: true, 'aria-expanded': 'false' });
    const pop = h('div', { class: 'plan-pop', role: 'dialog', 'aria-label': 'Its plan, step by step', hidden: true });
    const body = h('div', { class: 'tile-body' });
    t = { id, el: h('div', { class: 'tile', data: { id } }, head, plan, body, pop), head, plan, pop, body, stamp: '', planStamp: '', planOpen: false, doing: null, rest: null, wasOn: false };
    plan.addEventListener('click', () => { t.planOpen = !t.planOpen; if (t.planOpen) Glance.hide(); if (last) drawPlan(t, act.session(id)); });
    // like the strip: a press on the plan or its list leaves the keyboard with the terminal
    for (const el of [plan, pop]) el.addEventListener('mousedown', (e) => e.preventDefault());
    // a press anywhere in a place gives its chat the keyboard
    t.el.addEventListener('pointerdown', () => {
      t.wasOn = Boolean(last) && last.view === id;
      if (!t.wasOn) act.focus(id);
    }, true);
    // the strip is a toolbar: a press on it does not take the keyboard away from the terminal
    head.addEventListener('mousedown', (e) => { if (!e.target.closest('input')) e.preventDefault(); });
    // as with a window's own title bar: a double click on the strip makes the chat big, and small again
    head.addEventListener('dblclick', (e) => { if (!e.target.closest('button, input')) act.big(); });
    Glance.attach(t.el, head, id);
    tiles.set(id, t);
    return t;
  }

  /**
   * Lays out the chats that share the screen, each in its place, and hands every terminal its room.
   * ids: the chats on screen, by place; none when no chat is in front.
   */
  function place(state, ids) {
    last = state;
    const list = ids.map(tileOf);
    grid.dataset.n = String(list.length);
    sync(grid, list.map((t) => t.el));
    for (const t of list) t.el.classList.toggle('on', t.id === state.view);
    Terms.show(list.map((t) => ({ id: t.id, host: t.body })), state.view);
    for (const id of [...tiles.keys()]) if (!ids.includes(id)) tiles.delete(id);
  }

  function more(chat, s, target) {
    const copy = (text, what) => () => { desk.writeClipboard(text); toast(`Copied ${what}.`); };
    const big = last.settings.tiles === 1;
    const items = [
      { label: 'Rename', icon: 'pencil', run: () => rename() },
      last.chats.length > 1 && { label: big ? 'Back to the chats side by side' : 'Make this chat big', icon: big ? 'tile-2' : 'tile-1', key: 'Ctrl Shift Enter', run: () => act.big() },
      { label: 'Open its folder', icon: 'folder', run: () => desk.openFolder(chat.cwd) },
      { label: 'Copy the folder path', icon: 'copy', run: copy(chat.cwd, 'the path') },
    ].filter(Boolean);
    if (s && s.session && s.provider === 'claude') {
      items.push(null,
        { label: 'Copy the session id', icon: 'copy', run: copy(s.session, 'the session id') },
        { label: 'Copy the command that reopens it', icon: 'terminal', run: copy(`claude --resume ${s.session}`, 'the command') },
        { label: "Show the conversation's file", icon: 'file', run: async () => { if (!(await desk.showFile(s.key, ''))) toast('Its file could not be found.'); } });
    }
    items.push(null, { label: 'Close this chat', icon: 'x', key: 'Ctrl Shift W', danger: true, run: () => act.close(chat.id) });
    menuUnder(target, items);
  }

  /** The globe on a chat's strip: its browser, how many pages it holds, and whether the chat works in one or calls for the person. */
  function globe(t, chat, web) {
    const n = web.n ? `${web.n} page${web.n === 1 ? '' : 's'}` : 'no page yet';
    const tip = [web.needs ? 'It needs you on one of its pages.' : web.busy ? 'It is at work in a page right now.' : '',
      `${web.open ? 'Close' : 'Open'} the browser of this chat: ${n} (Ctrl+Shift+B).`].filter(Boolean).join('\n');
    return h('button', { class: `icon-btn th-web${web.open ? ' on' : ''}${web.needs ? ' needs' : web.busy ? ' busy' : ''}`,
      'aria-pressed': String(web.open), 'aria-label': `Browser of this chat, ${n}`, tip, onclick: () => act.browser(chat.id, t.wasOn) },
    icon('globe'), web.n > 0 && h('span', { class: 'th-web-n', text: String(web.n) }));
  }

  /** The Viewer's button on a chat's strip, once the chat showed something: how many files it holds. */
  function viewerButton(chat, seen) {
    const n = `${seen.n} file${seen.n === 1 ? '' : 's'}`;
    return h('button', { class: `icon-btn th-view${seen.open ? ' on' : ''}`, 'aria-pressed': String(seen.open), 'aria-label': `Viewer of this chat, ${n}`,
      tip: `${seen.open ? 'Close' : 'Open'} the Viewer of this chat: ${n} it showed (Ctrl+Shift+M).`, onclick: () => act.viewer(chat.id) },
    icon('image'), h('span', { class: 'th-view-n', text: String(seen.n) }));
  }

  /** The project a chat works in and its branch: a click shows how its copy stands, its other branches, and git asks. */
  function repoButton(chat, git, label) {
    const repo = git.repo || folderOf(git.main || git.top);
    const short = repo.split('/').pop();
    const tip = `${repo}${git.copy ? `, its own copy ${git.copy}` : ''}\nOn branch ${git.branch}\nClick for how it stands, its other branches, and to ask it to commit or push.`;
    return h('button', { class: 'th-repo', 'aria-haspopup': 'menu', 'aria-label': `${repo}, branch ${git.branch}`, tip, onclick: (e) => act.repo(chat.id, e.currentTarget) },
      short !== label && h('span', { class: 'rp-name', text: short }), icon('branch', 13, 'rp-icon'), h('span', { class: 'rp-branch', text: git.branch }),
      git.copy && h('span', { class: 'rp-copy', text: 'own copy' }));
  }

  /** The strip above one chat: its mark and name, what it is doing, how full its memory is, and its buttons. */
  function drawHead(t, state, chat, s) {
    const on = state.view === chat.id;
    const label = act.label(chat);
    const unread = Boolean(s && state.unread.has(s.key));
    const seenIt = seenWait(s);
    // in the Nest the panel beside the chat is the person's day
    const nest = Boolean(state.nest);
    const panel = on && (nest ? state.nestDay !== false : Boolean(state.settings.inspector));
    const git = Glance.git(state, chat, s);
    const web = act.web(chat.id);
    const seen = act.view(chat.id);
    const stamp = JSON.stringify([chat.id, chat.cwd, label, chat.closing, panel, nest, git, web.can && [web.n, web.busy > 0, web.needs, web.open], [seen.n, seen.open], s && [s.key, s.state, s.waiting, s.background, s.doing, s.since, s.turn && [s.turn.start, s.turn.end],
      s.context, s.ceiling, s.limit, unread, seenIt, s.files, s.commands, s.steps]]);
    if (stamp === t.stamp || editing === chat.id) return;
    t.stamp = stamp;
    const mark = chat.closing ? 'ended' : markOf(s, unread, seenIt);
    const folder = folderOf(chat.cwd);
    const name = h('button', { class: 'th-name', text: label, title: 'Rename this chat', onclick: () => { if (t.wasOn) rename(); } });
    const id = h('div', { class: 'th-id' }, glyph(mark), name,
      git && git.branch ? repoButton(chat, git, label) : folder !== label && h('span', { class: 'th-folder', text: folder, title: chat.cwd }));
    const doing = h('div', { class: `th-doing s-${mark}` });
    if (chat.closing) {
      doing.append(h('span', { class: 'words', text: 'Closing…' }));
    } else if (s) {
      const words = phrase(s) || (unread ? 'Finished' : '');
      if (words) doing.append(h('span', { class: 'words', text: words }));
      const going = s.state === 'working' && !s.background && s.turn && s.turn.start && !s.turn.end;
      if (going) doing.append(h('span', { class: 'timer', data: { since: s.turn.start } }));
      else if (s.state !== 'idle') doing.append(h('span', { class: 'timer', data: { time: s.since } }));
      if (s.limit && s.limit.until) doing.append(h('span', { class: 'timer' }, 'lifts in ', h('b', { data: { until: s.limit.until } })));
    }
    t.doing = doing;
    t.rest = h('div', { class: 'th-facts' }, s && Parts.memoryFact(s), s && Parts.turnFacts(s, true, false));
    const tools = h('div', { class: 'th-tools' },
      seen.n > 0 && viewerButton(chat, seen),
      web.can && globe(t, chat, web),
      h('button', { class: `icon-btn${panel ? ' on' : ''}`, title: nest ? 'Show or hide your day beside the chat (Ctrl+Shift+I)' : 'Show or hide the panel with its tool calls, its conversation and the files it changed (Ctrl+Shift+I)',
        'aria-pressed': String(panel), onclick: () => act.inspector() }, icon('panel')),
      h('button', { class: 'icon-btn', title: 'More', onclick: (e) => more(chat, s, e.currentTarget) }, icon('more')),
      h('button', { class: `icon-btn glance-toggle${Glance.isPinned(chat.id) ? ' on' : ''}`, data: { chat: chat.id }, title: 'Show or hide this chat at a glance (Ctrl+Shift+G)',
        'aria-label': 'Show or hide this chat at a glance', 'aria-pressed': String(Glance.isPinned(chat.id)), onclick: () => Glance.toggle(chat.id) }, icon('info')));
    fill(t.head, id, doing, t.rest, tools);
  }

  /**
   * The line under a chat's strip while it follows a plan (its to-do list): a mark for each step, which step it is on
   * and that step in its own words. A click lists every step. A finished plan stays while the turn that finished it
   * lasts, then gives its room back to the terminal.
   */
  function drawPlan(t, s) {
    const p = s && s.steps && s.steps.total > 0 ? s.steps : null;
    const now = p ? Parts.planNow(p) : null;
    const show = Boolean(now) && (!now.finished || s.state === 'working' || s.state === 'compacting');
    if (!show) t.planOpen = false;
    const stamp = show ? JSON.stringify([p, t.planOpen]) : '';
    if (stamp === t.planStamp) return;
    const was = !t.plan.hidden;
    t.planStamp = stamp;
    t.plan.hidden = !show;
    t.pop.hidden = !t.planOpen;
    t.plan.classList.toggle('open', t.planOpen);
    t.plan.setAttribute('aria-expanded', String(t.planOpen));
    if (show) {
      fill(t.plan, Parts.planMarks(now.items), h('span', { class: 'pl-n', text: now.count }),
        h('span', { class: `pl-now${now.finished ? ' done' : now.words.startsWith('Next: ') ? ' next' : ''}`, text: now.words }), icon('chevron-down', 13, 'pl-open'));
      t.plan.dataset.tip = `Its plan: ${Parts.planDone(p)}.${now.finished ? '' : `\n${now.words.startsWith('Next: ') ? '' : 'Now: '}${now.words}`}\nClick to ${t.planOpen ? 'close the list' : 'see every step'}.`;
      if (t.planOpen) {
        fill(t.pop, h('div', { class: 'pl-head' }, h('b', { text: 'Plan' }), h('span', { text: Parts.planDone(p) }),
          h('button', { class: 'icon-btn pl-close', 'aria-label': 'Close the list', onclick: () => { t.planOpen = false; drawPlan(t, act.session(t.id)); } }, icon('x', 13))),
        Parts.planList(p));
        t.pop.style.top = `${t.head.offsetHeight + t.plan.offsetHeight + 6}px`;
      }
    } else {
      fill(t.plan);
      fill(t.pop);
      delete t.plan.dataset.tip;
    }
    // the line takes its room from the terminal under it: the terminal is fitted again, not left cut off
    if (was !== show) Terms.fit();
  }

  /** Closes a chat's list of steps; true when one was open. */
  function closePlan() {
    let had = false;
    for (const t of tiles.values()) {
      if (!t.planOpen) continue;
      t.planOpen = false;
      had = true;
      if (last) drawPlan(t, act.session(t.id));
    }
    return had;
  }

  function drawSide(state, chat, s) {
    if (!state.settings.inspector) { detail.show(null, state); return; }
    none.hidden = Boolean(s);
    detail.el.hidden = !s;
    detail.show(s ? { kind: 'live', c: s } : null, state);
    if (s) return;
    const starter = state.info.starters.find((x) => x.id === chat.starter);
    const agent = Boolean(starter && starter.agent);
    if (noneStamp === `${chat.id}|${agent}`) return;
    noneStamp = `${chat.id}|${agent}`;
    fill(none,
      h('p', { text: agent ? 'Waiting for the session in this chat to show up…' : 'No agent session in this chat.' }),
      h('p', { class: 'quiet', text: agent ? 'It appears here a few seconds after the program starts.' : 'Type claude in the terminal to start one. Its tool calls, its conversation and its numbers then show here.' }));
  }

  function render(state) {
    last = state;
    for (const t of tiles.values()) {
      const chat = state.chats.find((c) => c.id === t.id);
      if (!chat) continue;
      const s = act.session(chat.id);
      drawHead(t, state, chat, s);
      drawPlan(t, s);
    }
    const front = state.chats.find((c) => c.id === state.view);
    if (front) drawSide(state, front, act.session(front.id));
    tick();
  }

  /** Lets the person type a name for the chat that has the keyboard. An empty name hands the naming back to the session. */
  function rename() {
    if (!last) return;
    const chat = last.chats.find((c) => c.id === last.view);
    const t = chat && tiles.get(chat.id);
    const button = t && t.head.querySelector('.th-name');
    if (!button || editing) return;
    editing = chat.id;
    const input = h('input', { class: 'th-rename', type: 'text', value: act.label(chat), maxlength: '120', spellcheck: 'false', 'aria-label': 'A name for this chat' });
    let over = false;
    const end = (save) => {
      if (over) return;
      over = true;
      editing = '';
      t.stamp = '';
      if (save && input.value.trim() !== act.label(chat)) desk.rename(chat.id, input.value);
      render(last);
      Terms.focus();
    };
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') end(true);
      else if (e.key === 'Escape') end(false);
    });
    input.addEventListener('blur', () => end(true));
    button.replaceWith(input);
    input.focus();
    input.select();
  }

  function tick() {
    for (const t of tiles.values()) Parts.tick(t.head);
    if (!side.hidden) detail.tick();
  }

  return { init, place, render, rename, tick, closePlan, detail: () => detail };
})();
