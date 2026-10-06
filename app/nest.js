'use strict';
/* global desk, h, fill, glyph, icon, dayLabel, labelOf, phrase */
// The Nest: the chat that works in the person's record, where his days, his projects and this desk are talked over.
// It stands apart from the workspaces: the logo in the title bar opens it, and its key brings it up from any program
// (main.cjs). The chat is big; beside it a column holds his day, read from the record the way the Record view reads
// it (desk.record, 'today'): what only he can do, the dates coming up, the to-dos due, and the chats that wait for him
// anywhere on this machine. Nothing here writes in the record. While no chat of this window works in the record, the
// Nest's own page offers to start one, or to bring here the one that runs in another terminal. Its mood (Settings >
// The Nest) makes it a place apart while it is open: warm as a lamp, or a calm night, with a word for the time of day
// and a few slow lights in the column (nest.css); its chat's terminal takes the same ground.

const Nest = (() => {
  const FRESH_MS = 60000;
  const RETRY_MS = 3000;
  const SHOWN = 5;                 // the lines of a part shown before "more in the Record"
  const CHATS = 6;
  // the Nest's chat in each mood: its ground is that mood's panel (nest.css), its letters warm or cool
  const TERM = {
    lamp: { background: '#15100c', cursorAccent: '#15100c', foreground: '#ecdfcb', cursor: '#f3b66d', selectionBackground: '#f3b66d40',
      black: '#1d1610', brightBlack: '#86735f', white: '#e2d6c4', brightWhite: '#fbf3e6' },
    night: { background: '#0a1215', cursorAccent: '#0a1215', foreground: '#d9e7e8', cursor: '#9fdcc9', selectionBackground: '#9fdcc940',
      black: '#0f1a1e', brightBlack: '#647f86', white: '#cfdfe1', brightWhite: '#f2f8f8' },
  };
  // the slow lights of a mood: where each one starts (% of the column), its size (px), how long it drifts and how far
  // into its drift it begins (s): already under way, they show in a picture taken before any frame is drawn
  const AIR = [[12, 22, 3, 13, -2], [78, 14, 2, 17, -9], [36, 48, 2.5, 15, -5], [88, 56, 2, 19, -12], [20, 72, 3, 14, -7],
    [64, 84, 2, 18, -3], [52, 30, 2, 16, -11], [8, 90, 2.5, 20, -15], [92, 36, 2, 15, -6]];
  let rail = null;                 // the column beside the Nest's chat
  let page = null;                 // the Nest's page while no chat of this window works in the record
  let act = null;
  let day = null;                  // the record's answer for today; null until one came
  let unset = false;               // the record answered that it has no folder, or no log in it
  let failed = false;              // the last reading failed: the next one comes a few seconds later
  let dayAt = 0;
  let busy = false;
  let last = null;
  let railStamp = '';
  let pageStamp = '';

  function init(railEl, pageEl, actions) {
    rail = railEl;
    page = pageEl;
    act = actions;
    // read again while the Nest is open and the window can be seen
    setInterval(() => { if (last && last.nest && last.seen) load(false); }, FRESH_MS);
  }

  async function load(force) {
    if (busy || (!force && Date.now() - dayAt < FRESH_MS)) return;
    busy = true;
    let answer = null;
    try { answer = await desk.record({ part: 'today' }); } catch { answer = null; }
    busy = false;
    dayAt = Date.now();
    failed = !answer || answer.ready === false;
    // a day read before stays on show while the record cannot be read
    if (failed) dayAt -= FRESH_MS - RETRY_MS;
    else {
      unset = answer.set === false;
      day = unset ? null : answer;
    }
    if (last) render(last);
  }

  const todayKey = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  const label = (text) => h('div', { class: 'nest-label', text });
  const brand = () => h('div', { class: 'nest-label nest-brand' }, icon('nest', 14), h('span', { text: 'Nest' }));
  const part = (title, ...kids) => h('section', { class: 'nest-part' }, label(title), ...kids);
  /** The mood the Nest is in: 'lamp' or 'night', or '' for the look of the rest of the window. */
  const moodOf = (state) => { const m = state.settings.nestLook || 'lamp'; return TERM[m] ? m : ''; };
  /** A word for the time of day, and a face that goes with it. */
  function hello(hour) {
    if (hour >= 5 && hour < 12) return ['Good morning', '(｡•ᴗ•｡)'];
    if (hour >= 12 && hour < 18) return ['Good afternoon', '( ˶ˆᴗˆ˶ )'];
    if (hour >= 18 && hour < 22) return ['Good evening', '( ˘ω˘ )'];
    return ['Late night, go easy', '(－ω－) zzZ'];
  }
  const air = () => h('div', { class: 'nest-air', 'aria-hidden': 'true' }, AIR.map(([x, y, s, d, w]) =>
    h('i', { style: `--x:${x}%;--y:${y}%;--s:${s}px;--d:${d}s;--w:${w}s;--dx:${x > 50 ? -14 : 14}px` })));
  const quiet = (text) => h('p', { class: 'quiet nest-quiet', text });
  const more = (n) => h('button', { class: 'nest-more', text: `${n} more in the Record`, onclick: () => act.record() });
  /** A line with its day in front: "Sun 4 Oct", or "late" in yellow. */
  const dated = (when, late, text, tip) => h('li', { class: 'nest-item nest-dated', tip },
    h('span', { class: `nest-on${late ? ' nest-late' : ''}`, text: when }), h('span', { class: 'nest-text', text }));

  /** The chats that wait for the person, in this window and in other terminals, the Nest's own chat aside: what nobody looked at first. */
  function waiting(state) {
    const own = act.chat();
    return state.snap.chats.filter((c) => act.wants(c) && !act.isOld(c) && !(own && c.chat === own.id)).sort((a, b) => act.calls(b) - act.calls(a));
  }

  /** What the column holds: the day, what the record says of it, and the chats that wait. */
  function column(state) {
    const now = new Date();
    const mood = moodOf(state);
    const [words, face] = hello(now.getHours());
    const out = [mood && air(), h('header', { class: 'nest-head' }, brand(),
      h('div', { class: 'nest-day', text: now.toLocaleDateString('en-GB', { weekday: 'long' }) }),
      h('div', { class: 'nest-date', text: now.toLocaleDateString('en-GB', { day: 'numeric', month: 'long' }) }),
      mood && h('div', { class: 'nest-hello' }, h('span', { text: words }), h('span', { class: 'nest-face', text: face })))].filter(Boolean);
    if (!day) {
      out.push(unset || !(state.settings.record && state.settings.record.folder)
        ? h('section', { class: 'nest-part' }, quiet('No record found, so there is no day to show.'),
          h('button', { class: 'btn sm', text: 'Pick its folder in Settings', onclick: () => act.settings('record') }))
        : quiet(failed ? 'Your record could not be read just now. It is read again in a few seconds.' : 'Reading your record…'));
    } else {
      const human = day.human || [];
      out.push(part('Only you', human.length
        ? h('ul', { class: 'nest-list' }, human.slice(0, SHOWN).map((item) => h('li', {
          class: 'nest-item', data: { urgent: String(Boolean(item.urgent)) }, tip: item.note ? `${item.text} · ${item.note}` : item.text },
        item.urgent ? glyph('needs', 12) : h('span', { class: 'glyph-gap' }), h('span', { class: 'nest-text', text: item.text }))))
        : quiet('Nothing waits on you.'), human.length > SHOWN && more(human.length - SHOWN)));
      const dates = [...(day.dates || []).map((row) => ({ when: row.late ? 'late' : dayLabel(row.due), late: Boolean(row.late), text: row.label, tip: row.note || '' })),
        ...(day.countdowns || []).map((row) => ({ when: dayLabel(row.date), late: false, text: row.label, tip: '' }))];
      out.push(part('Coming up', dates.length
        ? h('ul', { class: 'nest-list' }, dates.slice(0, SHOWN).map((row) => dated(row.when, row.late, row.text, row.tip)))
        : quiet('No dates this week.'), dates.length > SHOWN && more(dates.length - SHOWN)));
      const today = todayKey();
      const tasks = (day.tasks || []).slice().sort((a, b) => String(a.due || '9999').localeCompare(String(b.due || '9999')));
      if (tasks.length) {
        out.push(part('To-dos due', h('ul', { class: 'nest-list' }, tasks.slice(0, 3).map((task) => {
          const late = Boolean(task.due) && task.due < today;
          return dated(late ? 'late' : task.due ? dayLabel(task.due) : '', late, task.text, task.text);
        })), tasks.length > 3 && more(tasks.length - 3)));
      }
    }
    const list = waiting(state);
    out.push(part('Waiting for you', list.length
      ? h('div', { class: 'nest-chats' }, list.slice(0, CHATS).map((c) => h('button', { class: 'nest-chat', tip: c.cwd || '', onclick: () => act.show(c.key) },
        glyph(act.mark(c), 12), h('span', { class: 'nest-chat-name', text: act.name(c) }), h('span', { class: 'nest-chat-doing', text: phrase(c) }))))
      : quiet('No chat is waiting for you.'), list.length > CHATS && quiet(`${list.length - CHATS} more in the list of chats.`)));
    const key = state.settings.nestKeyState;
    out.push(h('footer', { class: 'nest-foot' },
      h('button', { class: 'btn sm', text: 'Open the Record', onclick: () => act.record() }),
      h('button', { class: 'nest-key', tip: 'The Nest in Settings', onclick: () => act.settings('nest'),
        text: key === 'on' ? 'Ctrl Shift Space, from any program' : key === 'taken' ? 'Ctrl Shift Space is held by another program' : 'Ctrl Shift Space, in this window' })));
    return out;
  }

  /** The Nest's own page: no chat of this window works in the record. */
  function drawPage(state, stamp) {
    const folder = (state.info.nest && state.info.nest.folders[0]) || (state.settings.record && state.settings.record.folder) || '';
    const here = new Set(state.chats.map((c) => c.id));
    // a conversation in the record that runs in another terminal, as the app's movable() counts them
    const elsewhere = state.snap.chats.filter((c) => c.provider === 'claude' && c.pid && c.session && c.kind !== 'bg'
      && !(c.chat && here.has(c.chat)) && act.inNest(c));
    const armed = elsewhere.some((c) => state.armed.has(c.session));
    const next = JSON.stringify([stamp, folder, elsewhere.map((c) => [c.session, labelOf(c)]), armed]);
    if (next === pageStamp) return;
    pageStamp = next;
    const offer = !folder
      ? [h('p', { text: 'Lowlit does not know where your record is yet.' }),
        h('button', { class: 'btn primary', text: 'Pick its folder in Settings', onclick: () => act.settings('record') })]
      : elsewhere.length
        ? [h('p', { text: `Its chat runs in another terminal right now: ${labelOf(elsewhere[0])}.` }),
          armed ? h('p', { class: 'quiet', text: 'Close it over there (type /exit): it opens here by itself, with its whole conversation.' })
            : h('button', { class: 'btn primary', text: 'Bring it here', onclick: () => act.arm(elsewhere.map((c) => c.session)) }),
          h('button', { class: 'btn ghost sm', text: 'Start a new one here instead', onclick: () => act.start(folder) })]
        : [h('p', { class: 'nest-folder', text: folder }),
          h('button', { class: 'btn primary', text: "Start the Nest's chat", onclick: () => act.start(folder) })];
    fill(page, h('div', { class: 'nest-page' },
      h('div', { class: 'nest-welcome' },
        brand(),
        h('h1', { class: 'd-title nest-title', text: 'Your days, your work, this desk.' }),
        h('p', { class: 'nest-lead', text: 'The chat of your record lives here: the one where your life, your projects, the board and this app are talked over and run. It stands apart from the workspaces. Ctrl Shift Space brings it up from any program, and the logo at the top left opens it and closes it.' }),
        h('div', { class: 'nest-offer' }, offer)),
      h('aside', { class: 'nest-rail nest-rail-page', 'aria-label': 'Your day' }, column(state))));
  }

  function render(state) {
    last = state;
    if (!rail) return;
    // the panel button on the chat's strip hides the day, and shows it again
    rail.hidden = !(state.nest && state.view !== 'nest' && state.nestDay !== false);
    if (!state.nest) return;
    load(false);
    const stamp = JSON.stringify([dayAt, todayKey(), new Date().getHours(), moodOf(state), state.settings.nestKeyState, state.settings.record && state.settings.record.folder,
      waiting(state).map((c) => [c.key, act.mark(c), phrase(c), act.name(c)])]);
    if (state.view === 'nest') { drawPage(state, stamp); return; }
    if (stamp === railStamp) return;
    railStamp = stamp;
    fill(rail, column(state));
  }

  return { init, render, mood: moodOf, term: (mood) => TERM[mood] || null };
})();
