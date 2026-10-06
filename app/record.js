'use strict';
/* global desk, h, fill, glyph, icon, ago, whenOf, dateTime, dayLabel, labelOf, phrase, markOf, seenWait, selectionIn */
// The person's working record, read as documents and lists. Requests keep the last page in place until the
// watcher answers; changing folders invalidates every outstanding answer and every cached page.

const Record = (() => {
  const TABS = [['today', 'Today'], ['projects', 'Projects'], ['todos', 'To-dos'], ['feed', 'Feed']];
  const PROJECT_TABS = [['status', 'Status'], ['todos', 'To-dos'], ['timeline', 'Timeline'], ['dates', 'Dates'], ['chats', 'Chats']];
  const KINDS = ['step', 'decision', 'fact', 'task', 'note', 'fail'];
  const FRESH_MS = 30000;
  const cache = new Map();
  const expanded = new Set();
  let root, els, act, state;
  let tab = 'today';
  let slug = '';
  let projectTab = 'status';
  let query = '';
  let client = '';
  let kinds = new Set(KINDS);
  let projects = [];
  let generation = 0;
  let queryTimer = 0;
  let humanAll = false;
  let reviewOpen = false;
  let drawn = '';

  const moment = (value) => typeof value === 'number' ? value : Date.parse(value) || 0;
  const age = (value) => moment(value) ? ago(moment(value)) === 'now' ? 'now' : `${ago(moment(value))} ago` : 'No activity';
  const path = (value) => String(value || '').replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase();
  const visible = () => root && !root.hidden && state && state.view === 'record';
  const request = () => slug ? { part: 'project', slug } : tab === 'feed'
    ? { part: 'feed', query, ...(client ? { client } : {}), kinds: KINDS.filter((kind) => kinds.has(kind)) } : { part: tab };
  const keyOf = (req) => JSON.stringify(req);
  const current = () => cache.get(keyOf(request()));
  const none = (text) => h('p', { class: 'quiet record-empty', text });
  const section = (title, ...kids) => h('section', { class: 'sec record-section' }, h('div', { class: 'sec-head' }, h('h2', { text: title })), ...kids);

  function init(el, actions) {
    root = el;
    act = actions;
    els = {
      tabs: h('div', { class: 'seg tabs record-tabs', role: 'tablist', 'aria-label': 'Record' }),
      status: h('span', { class: 'quiet record-loading', role: 'status' }),
      controls: h('div', { class: 'record-controls', hidden: true }),
      query: h('input', { class: 'input record-query', type: 'text', maxlength: '200', placeholder: 'Find in the record', 'aria-label': 'Find in the record', spellcheck: 'false' }),
      kinds: h('div', { class: 'record-kinds', role: 'group', 'aria-label': 'Kinds of record' }),
      client: h('select', { class: 'input record-client', 'aria-label': 'Project' }),
      content: h('div', { class: 'record-content' }),
    };
    for (const [id, name] of TABS) els.tabs.append(h('button', { class: 'record-tab', role: 'tab', text: name, data: { tab: id }, onclick: () => open(id) }));
    for (const kind of KINDS) els.kinds.append(h('button', { class: 'btn sm record-kind', text: kind, data: { kind }, onclick: () => {
      if (kinds.has(kind)) kinds.delete(kind); else kinds.add(kind);
      refresh(false); draw();
    } }));
    els.query.addEventListener('input', () => {
      clearTimeout(queryTimer);
      queryTimer = setTimeout(() => { query = els.query.value.trim().slice(0, 200); refresh(false); draw(); }, 180);
    });
    els.query.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); clearTimeout(queryTimer); query = ''; els.query.value = ''; refresh(false); draw(); }
    });
    els.client.addEventListener('change', () => { client = els.client.value; refresh(false); draw(); });
    fill(els.controls, els.query, h('div', { class: 'record-filter-row' }, els.kinds, els.client));
    root.append(h('div', { class: 'd-wrap wide record-wrap' },
      h('div', { class: 'page-head' }, h('h1', { class: 'd-title', text: 'Record' }),
        h('div', { class: 'record-refresh' }, els.status, h('button', { class: 'icon-btn', title: 'Look again', onclick: () => refresh(true) }, icon('refresh')))),
      els.tabs, els.controls, els.content));
    setInterval(() => { if (visible()) { refresh(false); draw(); } }, FRESH_MS);
  }

  async function load(req, force, older) {
    const key = keyOf(req);
    let entry = cache.get(key);
    if (!entry) {
      if (cache.size >= 20) for (const [old, item] of cache) {
        if (!item.busy && old !== keyOf(request()) && old !== keyOf({ part: 'projects' })) { cache.delete(old); break; }
      }
      cache.set(key, entry = { data: null, at: 0, busy: false, error: false });
    }
    if (entry.busy || (!force && !older && Date.now() - entry.at < FRESH_MS)) return;
    const turn = generation;
    entry.busy = true;
    entry.error = false;
    draw();
    const args = older ? { ...req, before: entry.data.before } : req;
    let answer;
    try { answer = await desk.record(args); } catch { answer = null; }
    if (turn !== generation || cache.get(key) !== entry) return;
    entry.busy = false;
    entry.at = Date.now();
    if (!answer || answer.ready === false) {
      entry.error = true;
      entry.at -= FRESH_MS - 3000;
    } else {
      if (older && entry.data && Array.isArray(answer.records)) {
        const seen = new Set(entry.data.records.map((row) => row.id));
        answer = { ...answer, records: [...entry.data.records, ...answer.records.filter((row) => !seen.has(row.id))] };
      }
      entry.data = answer;
      if (Array.isArray(answer.projects)) projects = answer.projects;
    }
    if (visible()) draw();
  }

  function refresh(force = false) {
    if (!root) return;
    const req = request();
    const pending = load(req, force, false);
    if (req.part !== 'projects') load({ part: 'projects' }, force, false);
    return pending;
  }

  function open(next = 'today', project = '', find = '') {
    clearTimeout(queryTimer);
    tab = TABS.some(([id]) => id === next) ? next : 'today';
    if (slug !== project) projectTab = 'status';
    slug = /^[a-z0-9-]+$/i.test(project) ? project : '';
    if (slug) tab = 'projects';
    if (tab === 'feed') { query = String(find || '').slice(0, 200); client = ''; kinds = new Set(KINDS); }
    if (els) els.query.value = query;
    drawn = '';
    refresh(false);
    draw(true);
  }

  function reset() {
    generation++;
    clearTimeout(queryTimer);
    cache.clear();
    expanded.clear();
    projects = [];
    slug = '';
    projectTab = 'status';
    tab = 'today';
    query = '';
    client = '';
    kinds = new Set(KINDS);
    humanAll = false;
    reviewOpen = false;
    drawn = '';
    if (els) { els.query.value = ''; fill(els.content); }
    if (visible()) refresh(true);
  }

  function projectFor(task) {
    if (slug) {
      const page = current() && current().data;
      if (page && page.project && page.project.client === task.client) return page.project;
    }
    return projects.find((p) => p.slug === task.project && p.folders && p.folders.length)
      || projects.find((p) => p.client === task.client && !p.quiet && p.folders && p.folders.length)
      || projects.find((p) => p.client === task.client);
  }

  function projectLink(row) {
    const p = projectFor(row);
    return p ? h('button', { class: 'record-project-name', text: p.title, onclick: () => open('projects', p.slug) })
      : h('span', { class: 'quiet', text: row.projectTitle || row.client || 'No project' });
  }

  function textButton(text, id, lines = 3) {
    const on = expanded.has(id);
    return h('button', { class: `record-text${on ? ' record-expanded' : ''}${lines === 2 ? ' record-two-lines' : ''}`,
      text, 'aria-expanded': String(on), onclick: (e) => {
        if (expanded.has(id)) expanded.delete(id); else expanded.add(id);
        e.currentTarget.classList.toggle('record-expanded', expanded.has(id));
        e.currentTarget.setAttribute('aria-expanded', String(expanded.has(id)));
      } });
  }

  function records(list) {
    if (!list || !list.length) return none('Nothing here.');
    return h('div', { class: 'record-feed' }, list.map((row) => h('article', {
      class: `record-feed-row${row.replaced ? ' record-replaced' : ''}`, data: { id: row.id, type: row.type } },
      h('div', { class: 'record-meta' },
        h('time', { text: moment(row.ts) ? whenOf(moment(row.ts)) : '', datetime: row.ts, title: moment(row.ts) ? dateTime(moment(row.ts)) : '' }),
        row.type === 'fail' && glyph('error', 12),
        h('span', { class: `record-kind-label${row.type === 'fail' ? ' record-fail' : ''}`, text: row.type }),
        projectLink(row), row.replaced && h('span', { class: 'record-replaced-label', text: 'replaced' })),
      textButton(row.text, `record:${row.id}`),
      row.tags && row.tags.length > 0 && h('div', { class: 'record-tags', text: row.tags.join(' / ') }))));
  }

  function dateRows(list, countdowns = [], weekdays = false) {
    const rows = (list || []).map((row) => h('div', { class: 'record-date', data: { id: row.id, due: row.due }, tip: row.note || '' },
      h('span', { class: `record-date-day${row.late ? ' record-late' : ''}`, text: row.late ? 'late'
        : weekdays ? new Date(`${row.due}T12:00:00`).toLocaleDateString('en-GB', { weekday: 'long' }) : dayLabel(row.due), title: row.due }),
      h('span', { class: 'record-date-label', text: row.label }), projectLink(row)));
    for (const item of countdowns) rows.push(h('div', { class: 'record-date record-countdown' },
      h('span', { class: 'record-date-day', text: dayLabel(item.date), title: item.date }), h('span', { class: 'record-date-label', text: item.label })));
    return rows.length ? h('div', { class: 'record-dates' }, rows) : none('No dates due.');
  }

  function tasks(list, start = true) {
    const sorted = (list || []).slice().sort((a, b) => (a.due || '9999').localeCompare(b.due || '9999') || moment(b.ts) - moment(a.ts));
    if (!sorted.length) return none('No open to-dos.');
    return h('div', { class: 'record-table-wrap' }, h('table', { class: 'record-table record-todos' },
      h('thead', null, h('tr', null, ['What', 'Project', 'Status', 'Due', 'Age'].map((label) => h('th', { text: label, scope: 'col' })))),
      h('tbody', null, sorted.map((task) => {
        const project = projectFor(task);
        return h('tr', { class: 'record-todo', data: { id: task.id, due: task.due || '', status: task.status } },
          h('td', { class: 'record-task-what' }, textButton(task.text, `task:${task.id}`, 2),
            start && project && project.folders && project.folders.length > 0 && h('button', {
              class: 'btn ghost sm record-start', text: 'Start a chat on this', onclick: () => act.startTask(task, project) })),
          h('td', null, projectLink(task)), h('td', { class: task.status === 'blocked' ? 'record-waiting' : '', text: task.status }),
          h('td', { class: 'record-task-date', text: task.due ? dayLabel(task.due) : 'None', title: task.due || '' }),
          h('td', { class: 'record-task-age', text: age(task.ts), title: moment(task.ts) ? dateTime(moment(task.ts)) : '' }));
      }))));
  }

  function board(list) {
    return h('div', { class: 'record-board' }, (list || []).map((group) => h('section', {
      class: 'record-board-section', data: { section: group.id } }, h('h3', { text: group.title }),
      group.items && group.items.length ? h('ul', null, group.items.map((item) => h('li', { tip: item.note || '' },
        item.urgent && glyph('needs', 12), h('span', { text: item.what ? [item.owner, item.what, item.status].filter(Boolean).join(' / ') : item.text })))) : none('Nothing here.'))));
  }

  function today(data) {
    const human = (data.human || []).slice().sort((a, b) => Number(Boolean(b.urgent)) - Number(Boolean(a.urgent)));
    const shown = humanAll ? human : human.slice(0, 8);
    const review = data.review || { count: 0, items: [] };
    return [section('Only you can do', shown.length ? h('ul', { class: 'record-human-list' }, shown.map((item) => h('li', {
      class: 'record-human', data: { urgent: String(Boolean(item.urgent)) }, tip: item.note || '' },
      item.urgent ? glyph('needs', 13) : h('span', { class: 'glyph-gap' }), h('span', { text: item.text })))) : none('Nothing waiting for you.'),
    human.length > 8 && h('button', { class: 'record-human-more record-link', text: humanAll ? 'Show fewer' : `${human.length - 8} more`,
      'aria-expanded': String(humanAll), onclick: () => { humanAll = !humanAll; draw(true); } })),
    section('Dates', dateRows(data.dates, data.countdowns, true)),
    data.tasks && data.tasks.length > 0 && section('To-dos due', tasks(data.tasks, false)),
    section('Decided in the last day', records(data.decisions)),
    section('Failed in the last day', records(data.failures)),
    h('section', { class: 'record-review-section' }, h('button', { class: 'record-review-toggle record-link',
      text: `${review.count} decision${review.count === 1 ? ' is' : 's are'} past their review date`, 'aria-expanded': String(reviewOpen),
      onclick: () => { reviewOpen = !reviewOpen; draw(true); } }),
    reviewOpen && h('div', { class: 'record-review' }, records(review.items)))];
  }

  function sessions(project) {
    const folders = (project.folders || []).map(path).filter(Boolean);
    return state && state.snap ? state.snap.chats.filter((chat) => {
      const cwd = path(chat.cwd);
      return folders.some((folder) => cwd === folder || cwd.startsWith(`${folder}\\`));
    }) : [];
  }

  function projectRows(list) {
    const sorted = (list || []).slice().sort((a, b) => Number(Boolean(a.quiet)) - Number(Boolean(b.quiet)) || moment(b.last) - moment(a.last) || a.title.localeCompare(b.title));
    if (!sorted.length) return none('No projects are listed in opshub.toml.');
    return h('div', { class: 'record-table-wrap' }, h('table', { class: 'record-table record-projects' },
      h('thead', null, h('tr', null, ['Project', 'Where it is', 'Open to-dos', 'Chats running', 'Last activity'].map((text) => h('th', { text, scope: 'col' })))),
      h('tbody', null, sorted.map((project) => h('tr', { class: `record-project-row${project.quiet ? ' record-quiet' : ''}`,
        data: { slug: project.slug }, tabindex: '0', role: 'button', onclick: () => open('projects', project.slug),
        onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open('projects', project.slug); } } },
      h('td', { class: 'record-project-title', text: project.title }), h('td', { class: 'record-project-where', text: project.where || 'No status yet', tip: project.heading || '' }),
      h('td', { class: 'record-project-tasks', text: project.tasks }), h('td', { class: 'record-project-chats', text: sessions(project).length }),
      h('td', { class: 'record-project-last', text: age(project.last) }))))));
  }

  function inline(value) {
    return String(value || '').split(/(`[^`]+`|\*\*[^*]+\*\*)/g).filter(Boolean).map((part) =>
      part.startsWith('`') && part.endsWith('`') ? h('code', { text: part.slice(1, -1) })
        : part.startsWith('**') && part.endsWith('**') ? h('strong', null, inline(part.slice(2, -2))) : part);
  }

  function documentPage(sections) {
    if (!sections || !sections.length) return none('No status page is available.');
    return h('article', { class: 'record-document' }, sections.map((part) => {
      const out = [];
      let bullets = null;
      let para = [];
      const flush = () => { if (para.length) { out.push(h('p', null, inline(para.join('\n')))); para = []; } };
      for (const line of part.lines || []) {
        const bullet = /^\s*-\s+(.*)$/.exec(line);
        if (bullet) {
          flush();
          if (!bullets) { bullets = h('ul'); out.push(bullets); }
          bullets.append(h('li', null, inline(bullet[1])));
        } else {
          bullets = null;
          if (!line.trim()) flush(); else para.push(line);
        }
      }
      flush();
      return h('section', null, part.heading && h('h3', { text: part.heading }), out);
    }));
  }

  function projectChats(project) {
    const list = sessions(project);
    if (!list.length) return none('No chats are running in these folders.');
    return h('div', { class: 'record-chats' }, list.map((chat) => {
      const own = (state.chats || []).find((item) => item.id === chat.chat);
      return h('button', { class: 'record-chat', data: { key: chat.key }, onclick: () => own ? act.open(own.id) : act.show(chat.key) },
        glyph(markOf(chat, Boolean(state.unread && state.unread.has(chat.key)), seenWait(chat)), 13),
        h('span', { class: 'record-chat-main' }, h('span', { text: own && own.title || labelOf(chat) }), h('span', { class: 'quiet', text: chat.cwd })),
        h('span', { class: 'quiet', text: phrase(chat) || 'Idle' }));
    }));
  }

  function projectPage(data) {
    if (!data.project) return none('This project is no longer listed.');
    const tabs = h('div', { class: 'seg tabs record-project-tabs', role: 'tablist', 'aria-label': 'Project' }, PROJECT_TABS.map(([id, name]) =>
      h('button', { class: `record-project-tab${projectTab === id ? ' on' : ''}`, role: 'tab', data: { tab: id }, text: name,
        'aria-selected': String(projectTab === id), onclick: () => { projectTab = id; draw(true); } })));
    return [h('div', { class: 'record-project-head' },
      h('button', { class: 'record-link', text: 'All projects', onclick: () => open('projects') }), h('h2', { text: data.project.title })), tabs,
    projectTab === 'status' ? documentPage(data.sections) : projectTab === 'todos' ? tasks(data.tasks)
      : projectTab === 'timeline' ? records(data.records) : projectTab === 'dates' ? dateRows(data.dates) : projectChats(data.project)];
  }

  function draw(force = false) {
    if (!els) return;
    for (const button of els.tabs.children) {
      button.classList.toggle('on', button.dataset.tab === tab);
      button.setAttribute('aria-selected', String(button.dataset.tab === tab));
    }
    els.controls.hidden = tab !== 'feed' || Boolean(slug);
    for (const button of els.kinds.children) {
      button.classList.toggle('on', kinds.has(button.dataset.kind));
      button.setAttribute('aria-pressed', String(kinds.has(button.dataset.kind)));
    }
    const chooser = JSON.stringify(projects.map((p) => [p.client, p.title]));
    if (els.client.dataset.stamp !== chooser) {
      els.client.dataset.stamp = chooser;
      const clients = new Map();
      for (const p of projects) if (!clients.has(p.client)) clients.set(p.client, []);
      for (const p of projects) clients.get(p.client).push(p.title);
      fill(els.client, h('option', { value: '', text: 'All projects' }), [...clients].map(([id, titles]) => h('option', { value: id, text: titles.join(' / ') })));
    }
    els.client.value = client;
    const entry = current();
    const data = entry && entry.data;
    els.status.textContent = entry && entry.busy ? 'Reading...' : entry && entry.error ? 'Not ready. Try again shortly.' : '';
    if (!data) {
      if (!els.content.childNodes.length) fill(els.content, none(entry && entry.error ? 'The record is not ready yet.' : 'Reading your record...'));
      return;
    }
    const live = (tab === 'projects') && state && state.snap ? state.snap.chats.map((c) => [c.key, c.chat, c.cwd, c.state, c.title, c.name, c.waiting, c.doing]) : [];
    const stamp = JSON.stringify([request(), projectTab, data, projects, humanAll, reviewOpen, live,
      tab === 'projects' && state ? state.chats.map((c) => [c.id, c.title]) : [], Math.floor(Date.now() / 60000)]);
    if (!force && (stamp === drawn || (drawn && selectionIn(els.content)))) return;
    drawn = stamp;
    const top = root.scrollTop;
    if (data.set === false) fill(els.content, h('div', { class: 'record-unset' },
      h('p', { text: 'Choose your record folder in Settings, under Your record.' }),
      h('button', { class: 'btn', text: 'Open settings', onclick: () => act.settings() })));
    else if (slug) fill(els.content, projectPage(data));
    else if (tab === 'today') fill(els.content, today(data));
    else if (tab === 'projects') fill(els.content, projectRows(data.projects));
    else if (tab === 'todos') fill(els.content, section('Open to-dos', tasks(data.tasks)), section('The board', board(data.board)));
    else fill(els.content, records(data.records), data.more && h('button', { class: 'btn record-older', text: 'Older',
      disabled: Boolean(entry.busy), onclick: () => load(request(), false, true) }));
    root.scrollTop = top;
  }

  function render(next) {
    state = next;
    refresh(false);
    draw();
  }

  return { init, render, open, reset, refresh };
})();
