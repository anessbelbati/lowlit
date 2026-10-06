'use strict';
/* global desk, h, fill, icon, glyph, kept, sync, foldGroups, count, bytes, whole, folderOf, modelName, markOf, seenWait, whenShort, dateTime, Detail, Parts, Jev */
// The History view: every conversation Claude Code still keeps on this machine, newest first, by date or by
// project. Pick one and it can be read as it was, with the files it changed, and picked up again in a chat of
// this window.

const PastFind = (() => {
  /** Matching words stay text, including angle brackets and quotes from a conversation. */
  function highlight(text, terms) {
    const value = String(text || '');
    const lower = value.toLowerCase();
    const spans = [];
    for (const word of terms || []) {
      const term = String(word).toLowerCase();
      if (!term) continue;
      for (let at = lower.indexOf(term); at !== -1; at = lower.indexOf(term, at + term.length)) spans.push([at, at + term.length]);
    }
    spans.sort((a, b) => a[0] - b[0] || b[1] - a[1]);
    const merged = [];
    for (const span of spans) {
      const prev = merged[merged.length - 1];
      if (prev && span[0] <= prev[1]) prev[1] = Math.max(prev[1], span[1]); else merged.push(span.slice());
    }
    const out = [];
    let at = 0;
    for (const [from, to] of merged) {
      if (from > at) out.push(value.slice(at, from));
      out.push(h('strong', { text: value.slice(from, to) }));
      at = to;
    }
    if (at < value.length) out.push(value.slice(at));
    return out;
  }

  function moment(m) {
    const verb = m.verb || ({ file: 'touched', asked: 'asked', ran: 'ran', looked: 'looked for', said: 'said' })[m.kind] || '';
    const text = `${verb ? verb[0].toUpperCase() + verb.slice(1) + ' ' : ''}${String(m.text || '').replace(/\s+/g, ' ')}`;
    const when = m.at ? new Date(m.at).toLocaleString('en-GB', { weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false }) : '';
    return `${text}${when ? ` · ${when}` : ''}`;
  }

  return { highlight, moment };
})();

const History = (() => {
  const FRESH_MS = 60e3;         // how old the list may be before it is asked for again while the view is open
  const rows = new Map();        // conversation id -> { el, stamp }
  let root = null;
  let els = null;
  let act = null;
  let detail = null;
  let last = null;
  let data = null;               // { at, list, total, bytes, counting }, as the watcher last listed them
  let asked = 0;
  let busy = false;
  let query = '';
  let finding = null;
  let findTimer = 0;
  let findSeq = 0;
  let findBusy = false;
  let findAt = 0;
  let findAgain = false;
  let sortTimer = 0;
  let progress = null;
  let foundRow = null;
  let readFromStart = '';
  let sel = '';
  let picked = false;            // the person chose a conversation, or chose to look at none
  let order = [];
  let groupBy = kept.get('hist-group', 'date') === 'project' ? 'project' : 'date';
  const folds = foldGroups('hist-fold', () => draw());

  const titleOf = (r) => r.name || r.title || String(r.prompt || '').replace(/\s+/g, ' ').trim().slice(0, 90) || 'Untitled conversation';

  function init(el, actions) {
    root = el;
    act = actions;
    els = {
      total: h('span', { class: 'list-n' }),
      seg: h('div', { class: 'seg' }),
      filter: h('input', { type: 'text', class: 'input', placeholder: 'Find a conversation', spellcheck: 'false', 'aria-label': 'Find a conversation' }),
      search: h('p', { class: 'find-status', hidden: true, role: 'status' }),
      groups: h('div', { class: 'groups', role: 'listbox', 'aria-label': 'Conversations' }),
      empty: h('p', { class: 'empty', hidden: true }),
      foot: h('p', { class: 'list-foot quiet', hidden: true }),
      none: h('div', { class: 'blank' }),
      detail: h('div', { hidden: true }),
    };
    for (const [id, name] of [['date', 'By date'], ['project', 'By project']]) {
      els.seg.append(h('button', { text: name, data: { by: id }, onclick: () => { groupBy = id; kept.set('hist-group', id); draw(); } }));
    }
    els.filter.addEventListener('input', () => { query = els.filter.value.trim(); askFind(); draw(); });
    els.filter.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); els.filter.value = ''; query = ''; askFind(); draw(); els.filter.blur(); }
      else if (e.key === 'ArrowDown' || e.key === 'Enter') { e.preventDefault(); els.filter.blur(); move(1); }
    });
    root.append(h('div', { class: 'split' },
      h('div', { class: 'list-pane' },
        h('div', { class: 'list-top' },
          h('div', { class: 'list-title' }, h('h1', { text: 'History' }), els.total,
            h('button', { class: 'icon-btn', title: 'Look again', onclick: () => { if (query) { askFind(); draw(); } else refresh(true); } }, icon('refresh'))),
          h('label', { class: 'filter-box' }, icon('search', 14), els.filter, h('kbd', { text: '/' })),
          els.search,
          els.seg),
        h('div', { class: 'list-scroll' }, els.groups, els.empty, els.foot)),
      h('div', { class: 'detail-pane' }, els.none, els.detail)));
    detail = Detail.create(els.detail, {
      open: act.open, attach: act.attach, arm: act.arm, disarm: act.disarm, resume: act.resume, rename: act.rename, close: act.close,
      dismiss: () => select(''),
    });
    desk.onFindProgress((p) => {
      const finished = !p.building && (!progress || progress.building);
      progress = p;
      if (!query || !last || last.view !== 'history') return;
      drawFindStatus();
      if (findBusy) { if (finished) findAgain = true; return; }
      if (finished || Date.now() - findAt >= 2000) askFind();
    });
  }

  function askFind() {
    clearTimeout(findTimer);
    const seq = ++findSeq;
    const askedQuery = query;
    findBusy = Boolean(query);
    if (!query) { finding = null; findAgain = false; return; }
    findTimer = setTimeout(async () => {
      findAt = Date.now();
      let answer;
      try { answer = await desk.find(askedQuery); } catch { answer = null; }
      if (seq !== findSeq || query !== askedQuery) return;
      findBusy = false;
      finding = { query: askedQuery, answer };
      if (!progress && answer && answer.progress) progress = answer.progress;
      draw();
      if (findAgain) { findAgain = false; askFind(); return; }
      if (!answer || answer.ready === false) findTimer = setTimeout(() => {
        if (seq === findSeq && query === askedQuery && last && last.view === 'history') askFind();
      }, 1000);
      else sortLater(seq, askedQuery, answer);
    }, 180);
  }

  /** Once the words have stayed the same a moment and the index is not still growing: Jev puts the results in order. */
  function sortLater(seq, askedQuery, answer) {
    clearTimeout(sortTimer);
    if (!Jev.on() || answer.sorted || (answer.progress && answer.progress.building) || !Array.isArray(answer.results) || answer.results.length < 2) return;
    sortTimer = setTimeout(async () => {
      if (seq !== findSeq || query !== askedQuery) return;
      let sorted = null;
      try { sorted = await desk.findSorted(askedQuery); } catch { sorted = null; }
      if (!sorted || seq !== findSeq || query !== askedQuery) return;
      finding = { query: askedQuery, answer: sorted };
      draw();
    }, 700);
  }

  function drawFindStatus() {
    els.search.hidden = !query;
    if (!query) return;
    const answer = finding && finding.query === query && finding.answer;
    const words = answer && Array.isArray(answer.understood) ? answer.understood : [];
    const p = progress;
    const read = p && Number.isFinite(p.conversations) ? `Read ${whole(p.conversationsDone || 0)} of ${whole(p.conversations)} conversations`
      : p ? `Read ${whole(p.filesDone || 0)} of ${whole(p.files || 0)} files` : 'Reading past conversations';
    els.search.textContent = [...words, read, p && p.limited ? 'Older moments omitted' : '', p && p.full ? 'Paused: its drive has less than 1 GB free' : '', findBusy ? 'Searching…' : !answer || answer.ready === false ? 'Search is not ready yet' : '',
      answer && answer.sorted ? 'Sorted by Jev' : ''].filter(Boolean).join(' · ');
  }

  function readFound(r) {
    foundRow = r;
    readFromStart = r.id;
    select(r.id, true);
  }

  function showDetail(subject, state) {
    if (subject && subject.kind === 'past') {
      const r = subject.r;
      const known = data && data.list.find((x) => x.id === r.id);
      subject = { kind: 'past', r: { ...r, ...known, at: r.at || r.last || (known && known.at) || 0 } };
    }
    detail.show(subject, state);
    if (subject && subject.kind === 'past' && readFromStart === subject.r.id) {
      readFromStart = '';
      detail.setTab('conv');
      detail.reader.beginning();
    }
  }

  function drawFound() {
    delete els.none.dataset.stamp;
    const answer = finding && finding.query === query && finding.answer;
    const list = answer && Array.isArray(answer.results) ? answer.results.slice() : [];
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    const terms = answer && answer.terms || words;
    // a conversation whose name holds every word shows at once, also while the index is still being built
    if (data) {
      for (const r of data.list) {
        const hay = `${titleOf(r)} ${r.prompt || ''} ${folderOf(r.cwd) || ''}`.toLowerCase();
        if (words.every((w) => hay.includes(w)) && !list.some((x) => x.id === r.id)) list.push({ ...r, moments: [] });
      }
    }
    const kids = [];
    const seen = new Set();
    order = [];
    for (const r of list) {
      seen.add(r.id);
      const stamp = JSON.stringify(['found', r, sel === r.id, terms]);
      let row = rows.get(r.id);
      if (!row || row.stamp !== stamp) row = { stamp, el: h('div', { class: `row hist-find-result${sel === r.id ? ' sel' : ''}`, role: 'option', 'aria-selected': String(sel === r.id), data: { id: r.id } },
        h('button', { class: 'find-summary', onclick: () => readFound(r) },
          h('span', { class: 'find-title' }, PastFind.highlight(titleOf(r), terms)),
          h('span', { class: 'find-meta', text: `${folderOf(r.cwd) || 'No folder'} · ${whenShort(r.at || r.last)}` })),
        (r.moments || []).slice(0, 3).map((m) => h('button', { class: 'find-moment', title: dateTime(m.at), onclick: () => readFound(r) }, PastFind.highlight(PastFind.moment(m), terms)))) };
      rows.set(r.id, row);
      order.push({ key: r.id, el: row.el, result: r });
      kids.push(row.el);
    }
    sync(els.groups, kids);
    for (const id of rows.keys()) if (!seen.has(id)) rows.delete(id);
    els.total.textContent = whole(list.length);
    els.empty.hidden = list.length > 0;
    els.empty.textContent = findBusy ? 'Searching past conversations…' : answer && answer.ready !== false ? 'No conversation matches that.' : 'Search is not ready yet. Try again in a moment.';
    els.foot.hidden = true;
    const r = list.find((x) => x.id === sel) || (foundRow && foundRow.id === sel ? foundRow : null) || (data && data.list.find((x) => x.id === sel));
    const subject = r ? { kind: 'past', r } : null;
    root.classList.toggle('has-sel', Boolean(subject));
    els.none.hidden = Boolean(subject);
    els.detail.hidden = !subject;
    showDetail(subject, last);
    if (!subject) fill(els.none, icon('search', 28), h('h2', { text: 'Search your past conversations' }), h('p', { text: 'Find what you asked, files a tool touched, commands it ran, or what it said.' }));
    Parts.tick(root);
  }

  async function refresh(force) {
    if (busy || (!force && Date.now() - asked < FRESH_MS)) return;
    busy = true;
    asked = Date.now();
    const found = await (History.fake ? History.fake() : desk.history());
    busy = false;
    if (!found || !Array.isArray(found.list)) return;
    data = found;
    draw();
  }

  function select(id, fromFind) {
    if (!fromFind) foundRow = null;
    if (id !== readFromStart) readFromStart = '';
    sel = id;
    picked = true;
    draw();
  }

  /** Which heading a conversation last active at `at` goes under, by date: [id, title]. */
  function bucket(at, start) {
    if (at >= start) return ['d0', 'Today'];
    if (at >= start - 86400e3) return ['d1', 'Yesterday'];
    if (at >= start - 6 * 86400e3) return ['d7', 'The last 7 days'];
    if (at >= start - 29 * 86400e3) return ['d30', 'The last 30 days'];
    const d = new Date(at);
    return [`m${d.getFullYear()}-${String(d.getMonth()).padStart(2, '0')}`, d.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })];
  }

  function buildRow(r, x) {
    const facts = [x.folder, r.model && modelName(r.model), r.out > 0 && `${count(r.out)} out`, bytes(r.size)].filter(Boolean).join(' · ');
    return h('div', { class: `row${x.sel ? ' sel' : ''}${r.live ? ' live' : ''}`, role: 'option', 'aria-selected': String(x.sel), data: { id: r.id }, onclick: () => select(r.id) },
      h('div', { class: 'row-main' },
        x.mark ? glyph(x.mark) : h('span', { class: 'glyph-gap' }),
        h('div', { class: 'row-body' },
          h('div', { class: 'row-top' }, h('span', { class: 'row-name', text: titleOf(r) }),
            r.live && h('span', { class: 'tag', text: 'running' }),
            h('span', { class: 'row-when', text: whenShort(r.at), tip: `Last active ${dateTime(r.at)}` })),
          h('div', { class: 'row-sub' }, h('span', { class: 'row-say idle', text: facts })))));
  }

  function draw() {
    if (!root || !last) return;
    const state = last;
    for (const b of els.seg.children) b.classList.toggle('on', b.dataset.by === groupBy);
    els.seg.hidden = Boolean(query);
    drawFindStatus();
    if (query) { drawFound(); return; }
    if (!data) {
      els.total.textContent = '';
      els.groups.replaceChildren();
      els.empty.hidden = false;
      els.empty.textContent = 'Listing your conversations…';
      els.foot.hidden = true;
      fill(els.none);
      return;
    }
    const running = new Map(state.snap.chats.map((c) => [c.session, c]));
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const byProject = groupBy === 'project';
    const groups = new Map();    // id -> { id, title, list, at }
    for (const r of data.list) {
      const folder = folderOf(r.cwd) || r.project || 'No folder';
      const [id, title] = byProject ? [`p:${folder.toLowerCase()}`, folder] : bucket(r.at, start.getTime());
      let g = groups.get(id);
      if (!g) groups.set(id, g = { id, title, list: [], at: 0 });
      g.list.push(r);
      g.at = Math.max(g.at, r.at);
    }
    // by date the list arrives in order already; by project the one worked in last comes first
    const shown = [...groups.values()];
    if (byProject) shown.sort((a, b) => b.at - a.at);

    // the first time the view is looked at, the newest conversation is opened: something to read at once.
    // Not when the list and what is read share the same space: the list would be gone behind it.
    if (!picked && !sel && data.list.length && root.clientWidth >= 880) sel = data.list[0].id;

    const seen = new Set();
    order = [];
    const kids = [];
    let total = 0;
    for (const g of shown) {
      const sec = folds.draw(g.id, g.title, g.list.length);
      const folded = folds.folded(g.id);
      const list = [];
      for (const r of g.list) {
        total++;
        seen.add(r.id);
        const c = running.get(r.id);
        const x = { sel: sel === r.id, mark: c ? markOf(c, state.unread.has(c.key), seenWait(c)) : '', folder: byProject ? '' : folderOf(r.cwd) || r.project };
        const stamp = JSON.stringify([r, x]);
        let row = rows.get(r.id);
        if (!row || row.stamp !== stamp) rows.set(r.id, row = { el: buildRow(r, x), stamp });
        list.push(row.el);
        if (!folded) order.push({ key: r.id, el: row.el });
      }
      sync(sec.inner, list);
      kids.push(sec.el);
    }
    sync(els.groups, kids);
    for (const id of rows.keys()) if (!seen.has(id)) rows.delete(id);
    folds.keep(kids);
    els.total.textContent = whole(data.total);
    els.empty.hidden = total > 0;
    els.empty.textContent = query ? 'No conversation matches that.' : 'No conversation is kept on this machine yet.';
    els.foot.hidden = !(data.total > data.list.length) || Boolean(query);
    els.foot.textContent = `The ${whole(data.list.length)} newest of ${whole(data.total)} are listed.`;

    // ---- what the right side shows ----
    const r = sel ? data.list.find((x) => x.id === sel) || (foundRow && foundRow.id === sel ? foundRow : null) : null;
    const c = r && (!foundRow || foundRow.id !== r.id) ? running.get(r.id) : null;
    const subject = c ? { kind: 'live', c } : r ? { kind: 'past', r } : null;
    root.classList.toggle('has-sel', Boolean(subject));
    els.none.hidden = Boolean(subject);
    els.detail.hidden = !subject;
    showDetail(subject, state);
    if (!subject) {
      const oldest = data.list.length ? data.list[data.list.length - 1] : null;
      const stamp = `${data.total}|${data.bytes}|${data.counting}`;
      if (els.none.dataset.stamp !== stamp) {
        els.none.dataset.stamp = stamp;
        fill(els.none, icon('history', 28),
          h('h2', { text: `${whole(data.total)} conversation${data.total === 1 ? '' : 's'} on this machine` }),
          h('p', { text: `${bytes(data.bytes)} on disk, subagents included${oldest && data.total <= data.list.length ? `, going back to ${dateTime(oldest.first || oldest.at)}` : ''}.` }),
          h('p', { text: 'Pick one to read it as it was, see which files it changed, or pick it up again in a chat here.' }),
          data.counting && h('p', { class: 'quiet', text: 'Their numbers are still being counted: a figure marked "so far" grows until that is done.' }));
      }
    }
    Parts.tick(root);
  }

  /** Called with the picture of the machine whenever it changes while this view is in front. */
  function render(state) {
    last = state;
    refresh(false);
    if (query && !findBusy && Date.now() - findAt >= FRESH_MS) askFind();
    draw();
  }

  function move(step) {
    if (!order.length) return;
    const at = order.findIndex((o) => o.key === sel);
    const next = order[at < 0 ? (step > 0 ? 0 : order.length - 1) : Math.min(order.length - 1, Math.max(0, at + step))];
    if (query && next.result) readFound(next.result); else select(next.key);
    const row = rows.get(next.key);
    if (row) row.el.scrollIntoView({ block: 'nearest' });
  }

  /** Keys that belong to the list while this view is in front and nothing else has the keyboard. True: the key was used. */
  function key(e) {
    if (!last || e.ctrlKey || e.altKey || e.metaKey) return false;
    const on = document.activeElement;
    if (on && (on.tagName === 'INPUT' || on.tagName === 'TEXTAREA')) return false;
    if (e.key === '/') { els.filter.focus(); els.filter.select(); return true; }
    if (e.key === 'Escape') {
      if (!sel) return false;
      select('');
      return true;
    }
    // inside the pane on the right the arrows scroll what is being read
    if (on && on !== document.body && els.detail.contains(on)) return false;
    if (e.key === 'j' || e.key === 'ArrowDown') { move(1); return true; }
    if (e.key === 'k' || e.key === 'ArrowUp') { move(-1); return true; }
    return false;
  }

  /** Opens the view on one conversation: from the search box, or from something that was typed in it. */
  function show(id) {
    if (!foundRow || foundRow.id !== id) foundRow = null;
    readFromStart = '';
    sel = id;
    picked = true;
    els.filter.value = '';
    query = '';
    askFind();
    draw();
    // it may not be on the list yet (it began after the list was made): look again
    if (data && !data.list.some((r) => r.id === id)) refresh(true);
    setTimeout(() => { const row = rows.get(id); if (row) row.el.scrollIntoView({ block: 'nearest' }); }, 0);
  }

  return {
    init, render, key, show, refresh, found: readFound,
    tick: () => { if (root && last) { Parts.tick(root); detail.tick(); } },
    counts: () => (data ? root.querySelectorAll('.row').length : 0),
    detail: () => detail,
    selected: () => sel,
    // set by the self-test to list made-up conversations instead of the real ones
    fake: null,
  };
})();
