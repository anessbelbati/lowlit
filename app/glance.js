'use strict';
/* global desk, h, fill, sync, glyph, labelOf, phrase, markOf, seenWait, bar, whenOf, acctName, Parts, toast, modelName, count, hours, clockShort, dollarsShort, Jev, chatNumber */
// A session's picture in one small panel: over its terminal, beside its row, or among all running chats.
// Hover never takes the keyboard. A panel opened by its button stays until the person closes it.

const Glance = (() => {
  let state = null;
  let act = null;
  let root = null;
  let list = null;
  let pop = null;
  let waiting = null;
  let enter = 0;
  let leave = 0;
  const tiles = new Map();
  const cards = new Map();
  const groups = new Map();
  const tips = new WeakMap();
  // a compaction leaves a chat at roughly 20k to 40k tokens: below this it would hardly get smaller
  const COMPACT_FROM = 100000;
  let projects = new Map();
  let projectFolder = '';
  let projectAt = 0;
  let projectBusy = false;
  let projectSeq = 0;
  const path = (p) => String(p || '').replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase();
  const git = (st, chat, c) => c && Object.hasOwn(c, 'git') ? c.git : (chat && st.snap.chatGit && st.snap.chatGit[chat.id]) || null;
  const isPinned = (id) => Boolean(pop && pop.id === id && pop.pinned);
  const live = (c) => !(c.kind === 'bg' && !c.pid && Date.now() - c.at > 3 * 86400e3);

  function subject(c, chat) {
    return { c: c || { state: 'idle', cwd: chat.cwd, key: '', since: chat.startedAt }, chat,
      name: chat && (!c || act.session(chat.id) === c) ? act.label(chat) : labelOf(c),
      git: git(state, chat, c), cwd: (c && c.cwd) || (chat && chat.cwd) || '' };
  }

  function resolve(target) {
    if (target.id) {
      const chat = state.chats.find((x) => x.id === target.id);
      return chat ? subject(act.session(chat.id), chat) : null;
    }
    const c = state.snap.chats.find((x) => x.key === target.key && live(x));
    return c ? subject(c, state.chats.find((x) => x.id === c.chat)) : null;
  }

  function neighbours(s) {
    const top = path(s.git ? s.git.top : s.cwd);
    if (!top) return [];
    return state.snap.chats.filter((c) => c.key !== s.c.key && live(c)
      && path(c.git ? c.git.top : c.cwd) === top).map((c) => {
      const chat = state.chats.find((x) => x.id === c.chat);
      return { name: chat && act.session(chat.id) === c ? act.label(chat) : labelOf(c),
        warning: c.state === 'working' && Boolean(c.files && c.files.count) };
    });
  }

  function sameCopy(others) {
    if (!others.length) return null;
    const busy = others.filter((x) => x.warning);
    return h('div', { class: `glance-copy${busy.length ? ' glance-copy-warning' : ''}`, text: busy.length
      ? `${busy.map((x) => x.name).join(', ')} ${busy.length === 1 ? 'is' : 'are'} changing files in this same copy right now`
      : `Also in this copy: ${others.map((x) => x.name).join(', ')}` });
  }

  /** Where it runs: the key that brings it in front (its number in the list), or the terminal it is in. */
  function where(s) {
    if (s.chat) {
      const n = chatNumber(s.chat.id);
      return `In this window${n ? ` · Ctrl ${n}` : ''}`;
    }
    return s.c.kind === 'bg' ? 'A background session, outside every terminal' : 'In another terminal';
  }

  /** What everything under it holds on this computer: its chat's console here, else the session as measured. */
  function uses(s) {
    if (!state.res) return null;
    return (s.chat && state.res.chats && state.res.chats[s.chat.id]) || (s.c.key ? Parts.resOf(state, s.c) : null);
  }

  function account(c) {
    const v = Parts.acctView(state);
    return v.list.find((a) => a.key === (c.live && c.live.account)) || null;
  }

  function stamp(s, short, pinned) {
    const c = s.c;
    return JSON.stringify([s.name, s.cwd, s.git, c.state, state.unread.has(c.key), c.since, (Jev.verdict(c) || {}).level, c.turn && [c.turn.start, c.turn.end],
      short && c.steps ? [c.steps.done, c.steps.total, c.steps.more] : c.steps, c.agents && (short ? c.agents.running : c.agents), c.context, c.ceiling, c.compacts, neighbours(s),
      short && [c.words, c.recap, c.waiting, c.doing, c.background, c.limit && c.limit.type],
      !short && [c.prompt, c.doing, c.background, c.waiting, c.files, c.commands, s.chat && state.shown.indexOf(s.chat.id), c.peer, c.talked, account(c), state.settings.accountNames,
        c.model, c.effort, c.mode, c.queued, c.live && c.live.usd, c.today && [c.today.whole, c.today.out, c.today.work], Parts.cacheOf(c), Parts.resShort(uses(s)),
        state.res && c.key ? Parts.resStamp(c, Parts.resOf(state, c)) : '', projects.get(path(s.cwd))], pinned]);
  }

  function plan(c, short, pinned) {
    const p = c.steps;
    if (!p || !p.total) return null;
    const el = h('div', { class: 'glance-plan' }, h('div', { class: 'glance-plan-count' },
      h('span', { text: `${p.done} of ${p.total}${p.more ? '+' : ''}` }), bar(p.done / p.total)));
    if (short) {
      if (p.current) el.append(h('div', { class: 'glance-ellipsis', text: p.current, title: p.current }));
      return el;
    }
    const items = [...(p.items || [])];
    if (p.current && !items.some((x) => x.state === 'doing')) items.push({ text: p.current.slice(0, 100), state: 'doing' });
    const at = Math.max(0, items.findIndex((x) => x.state === 'doing'));
    const start = pinned ? 0 : Math.max(0, Math.min(at - 3, items.length - 8));
    const shown = pinned ? items : items.slice(start, start + 8);
    for (const item of shown) el.append(h('div', { class: `glance-step ${item.state}`, title: item.text },
      h('span', { text: item.state === 'done' ? '✓' : item.state === 'doing' ? '›' : '·' }),
      h('span', { class: 'glance-ellipsis', text: item.text })));
    if (!items.length && p.current) el.append(h('div', { text: p.current }));
    const more = Math.max(items.length, p.total) - shown.length;
    if (more > 0) el.append(h('div', { class: 'glance-more', text: `+${more} more` }));
    return el;
  }

  function stateLine(s) {
    const c = s.c;
    // what Jev made of its last turn, said as Jev's: the person can tell why it is drawn so
    const seen = seenWait(c);
    const v = seen ? null : Jev.verdict(c);
    const mark = Jev.waits(v) ? 'needs' : v && v.level === 'stuck' ? 'error' : markOf(c, state.unread.has(c.key), seen);
    const words = v ? `Jev: ${Jev.words(v.level)}`
      : { needs: 'Needs you', 'needs-seen': 'Needs you, already seen', working: 'Working', compacting: 'Compacting', done: 'Finished', error: 'Error',
        'error-seen': 'Error, already seen', idle: 'Idle' }[mark] || 'Idle';
    const since = c.state === 'working' && c.turn && !c.turn.end ? c.turn.start || c.since : c.since;
    return h('div', { class: `glance-state s-${mark}` }, glyph(mark, 13), h('span', { text: words }),
      Boolean(since) && h('span', { class: 'glance-age' }, ' · ', h('span', { data: { time: since } }), mark === 'done' ? ' ago' : ''));
  }

  function head(s) {
    return h('div', { class: 'glance-head' }, stateLine(s), h('div', { class: 'glance-name glance-ellipsis', text: s.name, title: s.name }));
  }

  /**
   * One card of the page of every chat: where it stands in a few lines. What it does or waits on, and its last words,
   * come first: they are what the person reads the page for. Another chat in the same copy is named only while it
   * is changing files there.
   */
  function shortCard(s, body, others) {
    const c = s.c;
    const g = s.git;
    // "Working" or "Compacting its memory" would say again what the line above says
    const now = c.state === 'compacting' || (c.state === 'working' && !c.doing && !c.background) ? '' : phrase(c);
    const said = c.words || c.recap || '';
    const p = c.steps && c.steps.total ? c.steps : null;
    const running = c.agents ? c.agents.running : 0;
    const busy = others.filter((x) => x.warning);
    const step = p && (p.done >= p.total && !p.more ? `${p.total} step${p.total === 1 ? '' : 's'} done`
      : `step ${Math.min(p.done + 1, p.total)} of ${p.total}${p.more ? '+' : ''}`);
    fill(body,
      h('div', { class: 'glance-top' }, stateLine(s), Parts.memoryFact(c)),
      h('div', { class: 'glance-name glance-ellipsis', text: s.name, title: s.name }),
      h('div', { class: 'glance-loc' }, h('span', { class: 'glance-path glance-ellipsis', text: s.cwd, title: s.cwd }),
        g && h('span', { class: 'glance-branch', text: `› ${g.branch}${g.copy ? ' · own copy' : ''}`, title: `Branch ${g.branch}${g.copy ? ` · own copy ${g.copy}` : ''}` })),
      now && h('div', { class: 'glance-now glance-ellipsis', text: now, title: now }),
      said && h('div', { class: 'glance-said', text: said, title: said }),
      (p || running > 0) && h('div', { class: 'glance-summary' },
        p && h('div', { class: 'glance-plan' }, h('div', { class: 'glance-plan-count' }, h('span', { text: step }), bar(p.done / p.total))),
        running > 0 && h('div', { class: 'glance-agents', text: `${running} agent${running === 1 ? '' : 's'} working` })),
      busy.length > 0 && sameCopy(busy));
    return body;
  }

  function content(s, short = false, pinned = false) {
    const c = s.c;
    const body = h('div', { class: 'glance-content' }, head(s));
    const g = s.git;
    const copy = g ? `${g.copy ? `own copy ${g.copy}` : 'main copy'} · branch ${g.branch}` : '';
    const others = neighbours(s);
    if (short) return shortCard(s, body, others);
    const grid = h('dl', { class: 'glance-grid' });
    const row = (name, value, cls = '') => { if (value) grid.append(h('dt', { text: name }), h('dd', { class: cls }, value)); };
    row('Where', where(s));
    row('Folder', s.cwd && h('div', { class: 'glance-path glance-ellipsis', text: s.cwd, title: s.cwd }));
    const project = projects.get(path(s.cwd));
    if (project) row('Project', h('span', { class: 'record-project-link' }, h('span', { text: project.title }),
      h('button', { class: 'btn ghost sm', text: 'Open', onclick: (e) => { e.stopPropagation(); act.record('projects', project.slug); } })));
    row('Copy', copy);
    if (others.length) grid.append(h('div', { class: 'glance-wide' }, sameCopy(others)));
    row('Asked', c.prompt && h('div', null, h('div', { class: 'glance-ellipsis', text: c.prompt, title: c.prompt }),
      c.turn && Boolean(c.turn.start) && h('span', { class: 'glance-more', text: whenOf(c.turn.start) })));
    row('Doing', phrase(c));
    row('Plan', plan(c, false, pinned));
    // the strip's own notes do not show while the card is up: their words are here
    const f = c.files;
    if (f && f.count > 0) {
      const names = f.names.slice(0, 6).join(', ') + (f.names.length > 6 || f.more ? ', and more' : '');
      row('Changed', h('div', { class: 'glance-ellipsis', text: `${f.count}${f.more ? '+' : ''} file${f.count === 1 && !f.more ? '' : 's'}: ${names}`,
        title: `Files changed since your last message:\n${f.names.join('\n')}` }));
    }
    const cmd = c.commands;
    if (cmd && cmd.count > 0) row('Commands', h('div', { class: 'glance-ellipsis', text: `${cmd.count}${cmd.last ? ` · last: ${cmd.last}` : ''}`,
      title: `Commands run since your last message.${cmd.last ? `\nLast: ${cmd.last}` : ''}` }));
    if (c.agents && c.agents.total > 0) {
      const running = (c.agents.list || []).filter((a) => a.state === 'working');
      const tree = Parts.agentTree(running, c.model);
      for (const el of tree.querySelectorAll('.ag-row')) {
        const a = running.find((x) => x.id === el.dataset.agent);
        const meta = el.querySelector('.ag-meta');
        if (meta && a && a.started) fill(meta, h('span', { data: { since: a.started } }));
      }
      row('Agents', h('div', { class: 'glance-agents' }, h('div', { text: `${c.agents.running} working` }), tree));
    }
    const m = Parts.memoryOf(c);
    row('Context', m && h('div', null, Parts.memoryFact(c), m.known && h('div', { class: 'glance-more',
      text: `${count(c.context)} of about ${count(c.ceiling)} tokens${c.compacts ? ` · compacted ${c.compacts}×` : ''}` }),
      s.chat && c.context >= COMPACT_FROM && act.canCompact(s.chat.id) && (Jev.ready(c)
        ? h('button', { class: 'btn glance-compact ready', text: 'Compact now: its job is done',
          tip: 'Jev read its last answer: the job is finished and nothing is left half-done. A good moment to type /compact: the next job starts from a short summary instead of carrying this one.',
          onclick: () => act.compactNow(s.chat.id) })
        : h('button', { class: 'btn glance-compact', text: 'Compact now',
          tip: 'Types /compact in this chat. Best once a job is done: the next job then starts from a short summary instead of carrying this one.',
          onclick: () => act.compactNow(s.chat.id) }))));
    row('Waiting', c.queued ? `${c.queued} message${c.queued === 1 ? '' : 's'} waiting their turn` : '');
    row('Model', [c.model && modelName(c.model), c.effort && `effort ${c.effort}`, c.mode && Parts.MODES[c.mode]].filter(Boolean).join(' · '));
    const d = c.today;
    row('Today', d && d.whole === false ? 'still being read' : d && c.tokens ? `${count(d.out)} tokens out · ${hours(d.work)} of work` : '');
    row('Cost', c.live && c.live.usd > 0 ? `${dollarsShort(c.live.usd)} at list prices since its program started` : '');
    const k = Parts.cacheOf(c);
    row('Cache', k ? (k.warm ? `warm until ${clockShort(k.until)}` : 'cold') : '');
    const r = uses(s);
    row('On this PC', r ? Parts.resShort(r) : '');
    const mine = c.key && state.res ? Parts.resOf(state, c) : null;
    row('It runs', mine ? Parts.itemsShort(mine, c) : '');
    const a = account(c);
    if (a) {
      const limits = [['five', '5-hour'], ['week', 'Weekly']].filter(([key]) => a[key]);
      const words = [acctName(a, Parts.acctView(state).names), ...limits.map(([key, name]) => `${name} ${Math.round(a[key].used)}% · resets ${whenOf(a[key].until)}`)];
      row('Account', h('div', { class: 'glance-ellipsis', text: words.join(' · '), title: limits.map(([key, name]) => Parts.limitTip(`${name} limit`, a[key], 0, null)).join('\n') }));
    }
    if (c.peer && c.peer.name) row('Reached as', h('div', { class: 'glance-peer' },
      h('span', { text: c.peer.name }), ' ', h('button', { class: 'btn ghost sm', text: 'Copy', onclick: (e) => {
        e.stopPropagation(); desk.writeClipboard(c.peer.name); toast('Copied the name.');
      } }), h('div', { class: 'glance-more', text: 'Other chats can message it by this name.' })));
    if (c.talked && c.talked.length) row('Messaged', h('span', { text: c.talked.map((x) => `${x.to} (${x.n})`).join(', '),
      title: c.talked.map((x) => `${x.to}: ${x.last}`).join('\n') }));
    body.append(grid);
    return body;
  }

  function buttons() {
    for (const el of document.querySelectorAll('.glance-toggle')) {
      const on = isPinned(el.dataset.chat);
      el.classList.toggle('on', on);
      el.setAttribute('aria-pressed', String(on));
    }
  }

  function hide() {
    const had = Boolean(pop || waiting);
    clearTimeout(enter); clearTimeout(leave);
    waiting = null;
    if (pop) pop.el.remove();
    pop = null;
    buttons();
    return had;
  }

  function position() {
    if (!pop) return;
    if (!pop.anchor.isConnected || !pop.anchor.getClientRects().length) { hide(); return; }
    if (pop.id) {
      pop.el.style.top = `${pop.anchor.querySelector('.tile-head').offsetHeight}px`;
    } else if (pop.near) {
      // under the thing pointed at (a bar of the Dashboard), above it when there is no room below
      const r = pop.anchor.getBoundingClientRect();
      const w = Math.min(380, window.innerWidth - 16);
      pop.el.style.width = `${w}px`;
      pop.el.style.left = `${Math.max(8, Math.min(r.left + r.width / 2 - w / 2, window.innerWidth - w - 8))}px`;
      const below = r.bottom + 8;
      pop.el.style.top = `${below + pop.el.offsetHeight <= window.innerHeight - 8 ? below : Math.max(8, r.top - pop.el.offsetHeight - 8)}px`;
    } else {
      const r = pop.anchor.getBoundingClientRect();
      const edge = list.getBoundingClientRect();
      pop.el.style.width = `${Math.max(0, Math.min(380, window.innerWidth - edge.right - 8))}px`;
      pop.el.style.left = `${edge.right}px`;
      pop.el.style.top = `${Math.max(8, Math.min(r.top, window.innerHeight - pop.el.offsetHeight - 8))}px`;
    }
  }

  function refresh() {
    if (!pop) return;
    const s = resolve(pop);
    if (!s) { hide(); return; }
    const next = stamp(s, false, pop.pinned);
    if (next !== pop.stamp) {
      const scroll = pop.el.scrollTop;
      fill(pop.el, content(s, false, pop.pinned));
      pop.el.scrollTop = scroll;
      pop.stamp = next;
      Parts.tick(pop.el);
    }
    position();
    buttons();
  }

  function later() {
    clearTimeout(enter); waiting = null;
    clearTimeout(leave);
    if (pop && !pop.pinned) leave = setTimeout(hide, 200);
  }

  function show(target, pinned) {
    if (!resolve(target)) return;
    hide();
    const el = h('aside', { class: `glance-card ${target.id ? 'glance-over' : 'glance-row'}`, 'aria-label': 'Chat at a glance' });
    pop = { ...target, el, pinned, stamp: '' };
    el.addEventListener('pointerenter', () => clearTimeout(leave));
    el.addEventListener('pointerleave', later);
    el.addEventListener('mousedown', (e) => e.preventDefault());
    el.addEventListener('mouseover', (e) => { e.stopPropagation(); document.dispatchEvent(new Event('mouseleave')); });
    (target.id ? target.anchor : document.body).append(el);
    refresh();
  }

  function hover(target) {
    clearTimeout(leave);
    if (pop && (pop.pinned || (pop.anchor === target.anchor))) return;
    clearTimeout(enter);
    waiting = target;
    enter = setTimeout(() => { waiting = null; if (target.anchor.isConnected) show(target, false); }, 350);
  }

  function attach(tile, headEl, id) {
    tiles.set(id, tile);
    headEl.addEventListener('pointerenter', () => hover({ id, anchor: tile }));
    headEl.addEventListener('pointerleave', later);
    headEl.addEventListener('mouseover', (e) => { e.stopPropagation(); document.dispatchEvent(new Event('mouseleave')); });
  }

  function toggle(id) {
    if (isPinned(id)) { hide(); return; }
    const anchor = tiles.get(id);
    if (anchor && anchor.isConnected) show({ id, anchor }, true);
  }

  function rowAt(el) { return el instanceof Element ? el.closest('.chat[data-key]') : null; }

  function init(el, listEl, st, actions) {
    root = el; list = listEl; state = st; act = actions;
    list.addEventListener('pointerover', (e) => {
      const row = rowAt(e.target);
      if (!row || row === rowAt(e.relatedTarget) || !state.snap.chats.some((c) => c.key === row.dataset.key && live(c))) return;
      hover({ key: row.dataset.key, anchor: row });
    });
    list.addEventListener('pointerout', (e) => { if (rowAt(e.target) !== rowAt(e.relatedTarget)) later(); });
    list.addEventListener('mouseover', (e) => {
      const row = rowAt(e.target);
      if (row && state.snap.chats.some((c) => c.key === row.dataset.key && live(c))) {
        e.stopPropagation(); document.dispatchEvent(new Event('mouseleave'));
      }
    });
    list.addEventListener('scroll', () => { if (pop && !pop.id) hide(); }, true);
    // a click means the person is doing something else: a card that came by hovering goes, and does not come back
    // until the pointer leaves and comes again
    document.addEventListener('pointerdown', (e) => {
      if (pop && pop.el.contains(e.target)) return;
      clearTimeout(enter); waiting = null;
      if (pop && !pop.pinned) hide();
    }, true);
    window.addEventListener('resize', position);
    window.addEventListener('blur', () => { if (pop && !pop.pinned) hide(); });
  }

  function update(st) {
    state = st;
    askProjects();
    for (const [id, el] of tiles) if (!el.isConnected) tiles.delete(id);
    for (const row of list.querySelectorAll('.chat[data-key]')) {
      const c = state.snap.chats.find((x) => x.key === row.dataset.key);
      const chat = state.chats.find((x) => x.id === row.dataset.id);
      const g = git(state, chat, c);
      const old = tips.get(row);
      const base = old && row.dataset.tip === old.tip ? old.base : row.dataset.tip || '';
      const tip = base + (g ? `\nBranch ${g.branch} · ${g.copy ? `own copy ${g.copy}` : 'main copy'}` : '');
      row.dataset.tip = tip;
      tips.set(row, { base, tip });
    }
    if (pop && !pop.id && !pop.anchor.isConnected) {
      const row = [...list.querySelectorAll('.chat[data-key]')].find((x) => x.dataset.key === pop.key);
      if (row) pop.anchor = row;
    }
    refresh();
  }

  async function askProjects() {
    const folder = state.settings.record && state.settings.record.folder || '';
    if (folder !== projectFolder) {
      projectFolder = folder;
      projectSeq++;
      projectBusy = false;
      projectAt = 0;
      projects = new Map();
    }
    if (!folder || projectBusy || Date.now() - projectAt < 30000) return;
    const current = pop && resolve(pop);
    const folders = [...new Set([current && current.cwd, ...state.chats.map((c) => c.cwd),
      ...[...list.querySelectorAll('.chat[data-key]')].map((row) => state.snap.chats.find((c) => c.key === row.dataset.key)?.cwd)]
      .filter((f) => typeof f === 'string' && f.length > 0 && f.length <= 400))].slice(0, 40);
    if (!folders.length) return;
    const seq = ++projectSeq;
    projectBusy = true;
    projectAt = Date.now();
    let answer;
    try { answer = await desk.record({ part: 'projectOf', folders }); } catch { answer = null; }
    if (seq !== projectSeq) return;
    projectBusy = false;
    if (answer && answer.ready !== false) {
      projects = new Map((answer.projects || []).filter((p) => p.slug).map((p) => [path(p.folder), p]));
      refresh();
    }
  }

  function render(st) {
    state = st;
    if (state.view !== 'overview') return;
    const subjects = state.snap.chats.filter(live).map((c) => subject(c, state.chats.find((x) => x.id === c.chat)));
    for (const chat of state.chats) if (!subjects.some((s) => s.chat && s.chat.id === chat.id)) subjects.push(subject(null, chat));
    const spaces = state.settings.spaces || [];
    const order = spaces.length ? [...spaces.map((s) => [s.id, s.name]), ['', 'Unsorted']] : [['', 'All chats']];
    // a session in several workspaces stands under the one of its folder, or else the first that lists it
    const home = (s) => act.spaceOf(s.cwd) || act.spacesOf(s.cwd, s.c.key)[0] || '';
    const rank = (s) => s.c.state === 'attention' || s.c.state === 'error' ? 0
      : s.c.state === 'working' || s.c.state === 'compacting' ? 1 : state.unread.has(s.c.key) ? 2 : 3;
    const seen = new Set();
    const sections = [];
    for (const [id, name] of order) {
      const items = subjects.filter((s) => !spaces.length || home(s) === id).sort((a, b) => rank(a) - rank(b));
      if (!items.length) continue;
      let group = groups.get(id);
      if (!group) {
        group = h('section', { class: 'glance-group', data: { space: id } }, h('h3'), h('div', { class: 'glance-cards' }));
        groups.set(id, group);
      }
      if (group.firstChild.textContent !== name) group.firstChild.textContent = name;
      const els = [];
      for (const s of items) {
        const key = s.c.key || `chat:${s.chat.id}`;
        const next = stamp(s, true, false);
        seen.add(key);
        let entry = cards.get(key);
        if (!entry) {
          const el = h('button', { class: 'glance-short', data: { key }, onclick: () => {
            hide(); const current = cards.get(key).subject;
            if (current.chat) act.go(current.chat.id); else act.show(current.c.key);
          } });
          cards.set(key, entry = { el, stamp: '', subject: s });
        }
        entry.subject = s;
        if (entry.stamp !== next) { fill(entry.el, content(s, true)); entry.stamp = next; Parts.tick(entry.el); }
        els.push(entry.el);
      }
      sync(group.lastChild, els);
      sections.push(group);
    }
    for (const key of cards.keys()) if (!seen.has(key)) cards.delete(key);
    for (const [id, group] of groups) if (!sections.includes(group)) groups.delete(id);
    if (!subjects.length) {
      if (!root.querySelector('.glance-empty')) fill(root, h('p', { class: 'glance-empty', text: 'No chats are running.' }));
    } else sync(root, sections);
  }

  function tick() {
    if (pop) Parts.tick(pop.el);
    if (state && state.view === 'overview') Parts.tick(root);
  }

  /** A session's card under any element of a page, while the pointer is on it. */
  const near = (key, anchor) => { if (state.snap.chats.some((c) => c.key === key && live(c))) hover({ key, anchor, near: true }); };

  return { init, attach, toggle, hide, isPinned, git, update, render, tick, near, away: later };
})();
