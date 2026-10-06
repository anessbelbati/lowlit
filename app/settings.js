'use strict';
/* global desk, h, fill, icon, kept, selectionIn, folderOf, dateTime, acctColor, planName, Parts, Side, Jev, Browser, toast */
// The Settings page, a page of the window like the Dashboard: its topics down the left under a search over all of
// them, the topic picked at the right. Every change applies at once. The search keeps a row when every word typed is
// in it, in the title of its part or in the words its topic goes by ("notifications" finds the Notes); the words found
// are marked where they stand (CSS highlights: the page's text is never changed).

const Settings = (() => {
  const KEYS = [
    ['Ctrl Shift P', 'Search chats, commands, things you typed'],
    ['Ctrl Shift T', 'New chat'],
    ['Ctrl Shift W', 'Close the chat that has the keyboard'],
    ['Ctrl Shift N', 'Next chat that needs you'],
    ['Ctrl Tab', 'Back to the chat you were just in. Keep Ctrl down and press Tab again to go further back'],
    ['Ctrl 1 … 9', 'A chat by its number in the list. Hold Ctrl a moment to see the numbers'],
    ['Ctrl Shift 1 … 9', 'A workspace by its tab, 1 is every chat. Hold Ctrl Shift a moment to see the numbers'],
    ['Ctrl Shift Enter', 'One chat big, or back to the chats side by side'],
    ['Ctrl Shift I', 'The panel beside the chat'],
    ['Ctrl Shift H', 'History'],
    ['Ctrl Shift U', 'Dashboard'],
    ['Ctrl Shift O', 'Record'],
    ['Ctrl Shift Space', 'The Nest, and back again. From any program too, while its switch is on'],
    ['Ctrl Shift B', 'The Browser: the pages your chats open, beside them'],
    ['Ctrl Shift M', 'The Viewer: the pictures, videos and sounds your chats show. In it: Space plays, ← → move, F fills the window'],
    ['Ctrl Shift F', 'The floating card: the chat in front, over your other programs'],
    ['F5', 'Look again now (sessions, the account logged in, the limits) and draw the window again from scratch'],
    ['Ctrl ,', 'Settings, and back again'],
    ['/ or Ctrl F', 'In Settings: the search'],
    ['J K or ↑ ↓', 'In History: the next or the previous row'],
    ['/', 'In History: the filter box'],
    ['Esc', 'Back: from Settings, from a chat you are only looking at, or to the list in History'],
    ['Shift Enter', 'A new line in the prompt box'],
    ['Right click', 'Copy the selection, or paste'],
    ['Ctrl Shift C / V', 'Copy and paste'],
    ['Ctrl click', 'Open a web link'],
    ['Ctrl wheel', 'Text size'],
  ];
  // what closing the window with chats open does: its name, and what it means
  const KEEP = [
    ['ask', 'Ask me', 'A box asks you each time.'],
    ['always', 'Keep them', 'Next time Lowlit opens, they open again by themselves: the same conversations, the names you gave them, the same permission mode. Servers you started here that stopped meanwhile start again.'],
    ['never', 'Start fresh', 'They close. Their conversations stay saved: History has every one of them, with "Resume here". Servers that stop meanwhile stay stopped.'],
    ['tray', 'Keep running', 'Nothing closes. Your chats go on; the Lowlit icon near the clock brings the window back.'],
    ['gaming', 'Gaming mode', 'Every chat closes and every dev server stops, so nothing holds your computer while you play. Next time Lowlit opens, your chats and servers come back as they were. A server started with a plain node or python command cannot be told how to start again: it is named, for you to pin on the Servers page.'],
  ];
  const LOOKS = [['noir', 'Noir'], ['grey', 'Grey']];
  const NEST_LOOKS = [['lamp', 'Lamp'], ['night', 'Night'], ['plain', 'Like the rest']];
  const CORNERS = [['top-right', 'Top right'], ['top-left', 'Top left']];
  // what a Claude Code chat starts with; '' leaves it to Claude Code (for a workspace: the same as for every chat)
  const MODELS = [['', 'Claude Code\'s'], ['opus', 'Opus'], ['sonnet', 'Sonnet'], ['fable', 'Fable']];
  const EFFORTS = [['', 'Claude Code\'s'], ['low', 'Low'], ['medium', 'Medium'], ['high', 'High'], ['xhigh', 'Extra high'], ['max', 'Max']];
  // the topics down the left, in order. words: what else a person may call what is in them, for the search
  const TOPICS = [
    { id: 'chats', name: 'Chats', icon: 'terminal', sections: ['claude', 'terminal', 'closing'],
      lede: 'What every Claude Code chat starts with, how big its text is, and what happens to your chats when you close the window.',
      words: 'claude code model opus sonnet fable thinking effort max terminal text size font zoom close closing quit exit keep restore reopen' },
    { id: 'notes', name: 'Notes', icon: 'bell', sections: ['notes', 'cards'],
      lede: 'Cards that tell you when a chat needs you, finishes, or something else happens: in this window, and over your other programs.',
      words: 'notifications notification alerts alert popups popup toasts toast messages cards corner' },
    { id: 'look', name: 'Look', icon: 'layers', sections: ['look', 'float'],
      lede: 'How the window looks, and the floating card over your other programs.',
      words: 'appearance theme dark black colour color light motion animation transparent blur overlay hud' },
    { id: 'spaces', name: 'Workspaces', icon: 'folder', sections: ['spaces'],
      lede: 'A workspace is a name and the folders that belong to it. Each one has a tab above the list of chats.',
      words: 'workspace space spaces folders projects tabs colour color' },
    { id: 'accounts', name: 'Accounts', icon: 'user', sections: ['accounts'],
      lede: 'The Claude accounts this computer has logged in to, found by themselves. A name you give one is only for you.',
      words: 'account login logins email plan names' },
    { id: 'work', name: 'Work clock', icon: 'clock', sections: ['work'],
      lede: 'Your work time at the right of the title bar, and your day on the Dashboard.',
      words: 'work clock time timer shift shifts countdown break breaks activitywatch hours' },
    { id: 'nest', name: 'Nest and record', icon: 'nest', sections: ['record', 'nest'],
      lede: 'The Nest is the chat of your record, with your day beside it. Your record is the folder it works in.',
      words: 'nest record ops folder board log' },
    { id: 'browser', name: 'Browser', icon: 'globe', sections: ['browser'],
      lede: 'Web pages your chats open, beside them. Reachable from this computer only.',
      words: 'browser web pages sites logins cookies mcp allow' },
    { id: 'jev', name: 'Jev', icon: 'bolt', sections: ['jev'],
      lede: 'A small model that judges finished chats and sorts search, through OpenRouter. Off until you switch it on.',
      words: 'jev openrouter api key judge model search sort money cost' },
    { id: 'links', name: 'Opening Lowlit', icon: 'home', sections: ['links'],
      lede: 'Shortcuts to open the app. Nothing is added until you switch it on.',
      words: 'shortcut shortcuts start menu desktop startup windows boot launch' },
    { id: 'keys', name: 'Keys', icon: 'keyboard', sections: ['keys'],
      lede: 'The shortcuts of this window. The terminal keeps every other key.',
      words: 'keys keyboard shortcuts hotkeys' },
    { id: 'reads', name: 'What it reads', icon: 'info', sections: ['reads'],
      lede: 'What Lowlit reads on this computer, and what it never touches.',
      words: 'privacy data reads files security anthropic' },
  ];
  const TOPIC_OF = {};
  for (const t of TOPICS) for (const s of t.sections) TOPIC_OF[s] = t.id;
  const FOCUSABLE = 'button, input, textarea, select';
  const canMark = typeof Highlight === 'function' && typeof CSS !== 'undefined' && Boolean(CSS.highlights);

  let root = null;
  let state = null;
  let act = null;
  let page = null;
  let body = null;
  let main = null;
  let findInput = null;
  let findClear = null;
  let found = null;
  const topicButtons = new Map();  // topic id -> its button down the left
  let topic = '';
  let shown = false;
  let aim = '';                    // the topic or part asked for, gone to once the page is in sight
  let stamp = '';                  // what the page was last drawn from
  let units = [];                  // what the search goes through: { el, pane, sec, text }

  const isOpen = () => shown;

  function init(el, deskState, actions) {
    root = el;
    state = deskState;
    act = actions;
    findInput = h('input', { type: 'text', role: 'searchbox', class: 'set-find-input', placeholder: 'Search settings', spellcheck: 'false', autocomplete: 'off', 'aria-label': 'Search settings' });
    findClear = h('button', { class: 'mini set-find-x', 'aria-label': 'Clear the search', tip: 'Clear the search (Esc)', hidden: true,
      onclick: () => { findInput.value = ''; find(); findInput.focus(); } }, icon('x', 12));
    found = h('p', { class: 'set-found', role: 'status', hidden: true });
    main = h('div', { class: 'set-main' });
    body = h('div', { class: 'set-body' }, h('div', { class: 'set-col' }, found, main));
    const list = h('div', { class: 'set-topics' });
    for (const t of TOPICS) {
      const b = h('button', { class: 'set-topic', data: { topic: t.id }, onclick: () => { findInput.value = ''; pick(t.id, true); } },
        icon(t.icon, 14), h('span', { class: 'name', text: t.name }), h('span', { class: 'n' }));
      topicButtons.set(t.id, b);
      list.append(b);
    }
    // up and down move through the topics, the way they read
    list.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      const all = [...list.children].filter((b) => !b.hidden);
      const at = all.indexOf(document.activeElement);
      const next = all[(at + (e.key === 'ArrowDown' ? 1 : all.length - 1)) % all.length];
      if (!next) return;
      e.preventDefault();
      next.focus();
      next.click();
    });
    page = h('div', { class: 'set-page' },
      h('nav', { class: 'set-nav', 'aria-label': 'Settings' },
        h('h1', { class: 'd-title', text: 'Settings' }),
        h('label', { class: 'set-find' }, icon('search', 14), findInput, findClear),
        list,
        h('p', { class: 'set-foot', text: 'Changes apply at once. Esc goes back.' })),
      body);
    root.append(page);
    topic = TOPICS.some((t) => t.id === kept.get('settings.topic', '')) ? kept.get('settings.topic', '') : TOPICS[0].id;
    findInput.addEventListener('input', () => find());
    findInput.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      jump();
    });
    // a field let go of: what changed meanwhile is drawn now
    main.addEventListener('focusout', () => setTimeout(render, 0));
  }

  /** The change goes to main; the page is drawn again from what comes back (desk paints, which calls render). */
  async function set(patch) {
    const next = await desk.settings(patch);
    if (next) act.changed(next);
  }
  async function link(kind, on) {
    const links = await desk.shortcut(kind, on);
    if (links) state.settings.links = links;
    render();
  }

  function toggle(on, label, note, flip) {
    return h('div', { class: 'set-row', onclick: flip },
      h('div', { class: 'what' }, h('div', { text: label }), note && h('div', { class: 'quiet', text: note })),
      h('button', { class: `switch${on ? ' on' : ''}`, role: 'switch', 'aria-checked': on ? 'true' : 'false', 'aria-label': label }, h('i')));
  }
  /** A row whose answer is one of a few, side by side. */
  function choose(label, note, list, now, pick) {
    return h('div', { class: 'set-row' },
      h('div', { class: 'what' }, h('div', { text: label }), note && h('div', { class: 'quiet', text: note })),
      h('div', { class: 'seg' }, list.map(([id, name]) => h('button', { class: now === id ? 'on' : '', text: name, 'aria-pressed': String(now === id), onclick: () => pick(id) }))));
  }
  /** A part of a topic: a card with its title. id: what Settings.open and the self-test find it by. */
  const part = (id, title, note, ...kids) => h('section', { data: { section: id } }, h('h3', null, title, note && h('span', { text: note })), ...kids);
  const said = (text, cls = '') => h('p', { class: `quiet${cls ? ` ${cls}` : ''}`, text });

  /** One line per account this machine has logged in to: what it is, and a field for what to call it. */
  function accountRows() {
    const v = Parts.acctView(state);
    if (!v.list.length) return [said('No account found yet. It shows here once Claude Code is logged in.')];
    return v.list.map((a) => {
      const was = v.names[a.key] || '';
      const input = h('input', { type: 'text', class: 'input name-input', value: was, placeholder: 'Call it…', maxlength: '40', spellcheck: 'false', 'aria-label': `A name for ${a.email || a.key}` });
      input.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (e.key === 'Enter') input.blur();
        else if (e.key === 'Escape') { input.value = was; input.blur(); }
      });
      input.addEventListener('blur', () => { if (input.value.trim() !== was) set({ accountNames: { [a.key]: input.value.trim() } }); });
      const facts = [planName(a.plan), a.here ? 'in use now' : a.to ? `last in use ${dateTime(a.to)}` : '',
        !a.email && 'its name is not on this disk yet: it fills in the next time you log into it'].filter(Boolean).join(' · ');
      return h('div', { class: 'set-row acct-row' },
        h('i', { class: 'swatch', style: `background:${acctColor(a)}` }),
        h('div', { class: 'what' }, h('div', { text: a.email || `Account ${a.key}` }), facts && h('div', { class: 'quiet', text: facts })),
        input);
    });
  }

  /** A field for a name: Enter keeps it, Esc puts back what was there. keep(name) is told only a name that changed. */
  function nameField(value, label, placeholder, keep) {
    let was = value;
    const input = h('input', { type: 'text', class: 'input name-input', value, placeholder, maxlength: '24', spellcheck: 'false', 'aria-label': label });
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') input.blur();
      else if (e.key === 'Escape') { input.value = was; input.blur(); }
    });
    input.addEventListener('blur', () => {
      const name = input.value.replace(/\s+/g, ' ').trim();
      if (name && name !== was) { was = name; input.value = name; keep(name); } else input.value = was;
    });
    return input;
  }

  /**
   * After a change to the workspaces: the page is drawn again and the keyboard stays on it, in the field for a new
   * one. The chat behind may have changed meanwhile, and that chat's terminal takes the keyboard when it does.
   */
  function redrawSpaces() {
    draw();
    const field = main.querySelector('.space-new');
    if (field) field.focus({ preventScroll: true });
  }

  /** The workspaces: what each is called, its colour, the folders it holds, and a field for a new one. */
  function spaceRows() {
    const rows = [];
    for (const sp of state.settings.spaces || []) {
      const n = sp.folders.length;
      const swatches = h('div', { class: 'ws-swatches', role: 'group', 'aria-label': `Colour for ${sp.name}` });
      for (const color of [...Side.colors, '']) {
        const active = (sp.color || '') === color;
        swatches.append(h('button', {
          class: `ws-choice ${color ? `ws-${color}` : 'ws-auto'}${active ? ' on' : ''}`,
          type: 'button', text: color ? '' : 'Auto', 'aria-label': color || 'Auto', 'aria-pressed': String(active),
          data: { color }, tip: color || 'Use the colour at this workspace\'s place in the tabs',
          onclick: () => {
            act.colorSpace(sp.id, color);
            for (const button of swatches.children) {
              const on = button.dataset.color === color;
              button.classList.toggle('on', on);
              button.setAttribute('aria-pressed', String(on));
            }
          },
        }));
      }
      rows.push(h('div', { class: 'set-row space-row', data: { space: sp.id } },
        // The page is left as it is: the field already says the new name, and it loses the keyboard to whatever was
        // pressed next. Drawn again, that press would land on something that is no longer there.
        nameField(sp.name, `The name of the workspace ${sp.name}`, 'Name', (name) => act.renameSpace(sp.id, name)),
        swatches,
        h('div', { class: 'what' }, h('div', { class: 'quiet', text: n ? `${n} folder${n === 1 ? '' : 's'}` : 'No folder yet' })),
        h('button', { class: 'btn sm', text: 'Take away', tip: 'The workspace goes, its chats stay: they show under "All" again, unsorted.', onclick: () => { act.removeSpace(sp.id); redrawSpaces(); } })));
      for (const f of sp.folders) {
        rows.push(h('div', { class: 'set-row space-folder' }, icon('folder', 14),
          h('div', { class: 'what' }, h('b', { text: folderOf(f) }), h('span', { class: 'quiet', text: f })),
          h('button', { class: 'mini', 'aria-label': `Take ${f} out of ${sp.name}`, tip: 'Take this folder out of the workspace', onclick: () => { act.putFolder(f, ''); redrawSpaces(); } }, icon('x', 12))));
      }
    }
    const fresh = nameField('', 'A name for a new workspace', 'A new workspace: its name', (name) => { act.addSpace(name); redrawSpaces(); });
    fresh.classList.add('space-new');
    rows.push(h('div', { class: 'set-row space-row' }, fresh,
      h('div', { class: 'what' }, h('div', { class: 'quiet', text: 'Type a name and press Enter.' }))));
    return rows;
  }

  /**
   * The model and the thinking each Claude Code chat starts with, and a workspace's own. Under a main from before
   * them: no part.
   */
  function claudeSection() {
    const c = state.settings.claude;
    if (!c) return null;
    const seg = (list, now, pick, first) => h('div', { class: 'seg' }, list.map(([id, name]) => h('button', {
      class: now === id ? 'on' : '', text: !id && first ? first : name, 'aria-pressed': String(now === id),
      tip: !id && first ? 'The same as for every chat, above' : '', onclick: () => pick(id) })));
    const rows = (state.settings.spaces || []).map((sp) => {
      const own = (c.spaces || {})[sp.id] || { model: '', effort: '' };
      const put = (change) => set({ claude: { spaces: { [sp.id]: change } } });
      return h('div', { class: 'set-row tune-row', data: { tune: sp.id } },
        h('div', { class: 'what' }, h('div', { text: sp.name }), h('div', { class: 'quiet', text: 'Its chats' })),
        h('div', { class: 'tune-segs' },
          seg(MODELS, own.model, (model) => put({ model }), 'Same'),
          seg(EFFORTS, own.effort, (effort) => put({ effort }), 'Same')));
    });
    return part('claude', 'Claude Code', 'the model and the thinking every chat starts with',
      h('div', { class: 'set-row tune-main' },
        h('div', { class: 'what' }, h('div', { text: 'Model' }), h('div', { class: 'quiet', text: 'Claude Code\'s: the one Claude Code is set to, which /model changes.' })),
        seg(MODELS, c.model, (model) => set({ claude: { model } }))),
      h('div', { class: 'set-row tune-main' },
        h('div', { class: 'what' }, h('div', { text: 'Thinking' }),
          h('div', { class: 'quiet', text: 'How long it thinks before it answers. On a model without Max, Claude Code uses High.' })),
        seg(EFFORTS, c.effort, (effort) => set({ claude: { effort } }))),
      rows.length > 0 && said('A workspace can have its own: the chats in its folders start with these instead. Same: as for every chat.', 'tune-note'),
      rows,
      c.via && !c.via.passes && said(`${c.via.name}, your way of starting Claude Code, does not hand extra words on to claude, so the chats it starts keep Claude Code's own model and thinking.`),
      said('Asked for each time Lowlit starts a chat or opens one again, the chats it brings back at the start too. Claude Code on its own never keeps Max for the next chat. A chat already running keeps its level, even through "New version: restart", until it is opened again; /effort max in it changes it now.'));
  }

  function terminalSection() {
    const s = state.settings;
    return part('terminal', 'Terminal', '',
      h('div', { class: 'set-row' },
        h('div', { class: 'what' }, h('div', { text: 'Text size in the terminals' }), h('div', { class: 'quiet', text: 'Or hold Ctrl and turn the mouse wheel over a terminal.' })),
        h('div', { class: 'stepper' },
          h('button', { class: 'btn sm', text: '−', 'aria-label': 'Smaller', onclick: () => set({ fontSize: s.fontSize - 1 }) }),
          h('b', { text: `${s.fontSize} px` }),
          h('button', { class: 'btn sm', text: '+', 'aria-label': 'Larger', onclick: () => set({ fontSize: s.fontSize + 1 }) }))));
  }

  /** What closing the window with chats open does: five answers, each saying what it means. */
  function closingSection() {
    const now = state.settings.keepChats;
    return part('closing', 'Closing the window with chats open', '',
      h('div', { class: 'set-choices', role: 'radiogroup', 'aria-label': 'Closing the window with chats open' },
        KEEP.map(([id, name, means]) => h('button', { class: `set-choice${now === id ? ' on' : ''}`, role: 'radio', 'aria-checked': String(now === id), data: { keep: id },
          onclick: () => set({ keepChats: id }) },
        h('i', { class: 'dot', 'aria-hidden': 'true' }), h('b', { class: 'set-choice-name', text: name }), h('span', { class: 'quiet', text: means })))),
      said('After a crash or a forced close your chats come back too; with Start fresh you are asked first.'));
  }

  /** The notes over the other programs: on or off, and for which moments. */
  function notesSection() {
    const n = state.settings.notify || {};
    return part('notes', 'Over your other programs', 'while this window is not in front',
      toggle(n.cards !== false, 'Show notes',
        'A card at the top of your screen for each moment switched on below. Go there opens the chat here; × closes the card. A chat that needs you keeps its card until you answer it; the others go after a few seconds. Coming back to this window clears them.',
        () => set({ notify: { cards: n.cards === false } })),
      n.cards !== false && [
        toggle(n.here, 'When a chat in this window needs you', 'It asks a question, wants your permission, or stops on an error.', () => set({ notify: { here: !n.here } })),
        toggle(n.elsewhere, 'When a session in another terminal needs you', 'The same, for chats in Windows Terminal or anywhere else.', () => set({ notify: { elsewhere: !n.elsewhere } })),
        toggle(n.finished, 'When a chat in this window finishes its turn', '', () => set({ notify: { finished: !n.finished } })),
        toggle(n.nest, 'When the Nest answers', 'With the start of its answer, whatever the switch at the top says. In this window too, unless the Nest is what you are looking at.', () => set({ notify: { nest: !n.nest } })),
        toggle(n.limit, 'When a usage limit is nearly used up', 'At 90%, once per 5-hour window and once a week, for the account in use. In this window instead while you are in it.', () => set({ notify: { limit: !n.limit } })),
        toggle(n.resets, 'When one of your accounts has room again', 'Once, when a limit last seen at 90% or more resets. In this window instead while you are in it.', () => set({ notify: { resets: !n.resets } })),
        toggle(n.disk, 'When a drive is nearly full', 'Under 3 GB free on a drive that holds your chats\' files: once a day, with the chat that holds the most there. This window says it at the top in any case.', () => set({ notify: { disk: !n.disk } })),
        typeof n.shift === 'boolean' && toggle(n.shift, 'When a countdown\'s time is up', 'Once, at its end. In this window instead while you are in it.', () => set({ notify: { shift: !n.shift } }))]);
  }

  /** Which corner the cards show in: this window's own, and the notes over the other programs. */
  function cornerSection() {
    const n = state.settings.notify || {};
    return part('cards', 'Where the cards show', '',
      choose('Corner', 'In this window, at the top of the chats. Over your other programs, at the top of your screen, under the floating card when it is in the same corner.',
        CORNERS, n.corner === 'top-left' ? 'top-left' : 'top-right', (corner) => set({ notify: { corner } })),
      said('Every card has Go there, which takes you where it points, and × to close it. A card goes by itself after a few seconds, and waits while the pointer is on it.'));
  }

  function lookSection() {
    const s = state.settings;
    return part('look', 'Window', '',
      choose('Look', 'Noir is black, with a light from the top left corner that turns gold while a chat waits for you and green for a moment when one finishes. Grey is the look from before.',
        LOOKS, s.look || 'noir', (look) => set({ look })),
      s.look !== 'grey' && toggle(s.motion !== false, 'Moving light', 'The light drifts slowly while this window is in front and stands still when you switch to another one. Off: it always stands still.', () => set({ motion: s.motion === false })),
      toggle(!s.solid, 'See-through window', 'Your desktop shows through the list and the title bar, blurred, while the window is in front. Applies the next time the app starts. Switch it off if the window ever looks wrong.', () => set({ solid: !s.solid })));
  }

  /** The floating card: on or off, small, and whether it stays over this window too. */
  function floatSection() {
    const f = state.settings.float || { on: false, small: false, overDesk: false };
    return part('float', 'Floating card', 'over your other programs',
      toggle(f.on, 'Floating card (Ctrl Shift F)', 'A small card at the top left of your screen, over every other program: the chat in front, what it is doing, its plan step by step, its subagents at work, how full its memory is, and which other chats need you. Drag its top line to move it.', () => set({ float: { on: !f.on } })),
      f.on && toggle(f.small, 'Small card', 'Only what it is doing, the step it is on, and its memory.', () => set({ float: { small: !f.small } })),
      f.on && toggle(f.overDesk, 'Keep it over this window too', 'Off: while this window is in front, the card moves out of the way wherever it would cover it. This window shows the same.', () => set({ float: { overDesk: !f.overDesk } })));
  }

  function spacesSection() {
    return part('spaces', 'Workspaces', 'one tab each above the list of chats',
      ...spaceRows(),
      said('A chat is in the workspace its folder is in, and so is every chat in a folder inside that one, wherever it runs. To sort a chat, right-click it in the list and pick the workspace. A chat you start while a workspace is in front puts its folder there by itself.'));
  }

  function accountsSection() {
    return part('accounts', 'Your accounts', 'found on this computer by themselves', ...accountRows());
  }

  function recordSection() {
    const folder = (state.settings.record && state.settings.record.folder) || '';
    const input = h('input', { class: 'input name-input', type: 'text', value: folder, maxlength: '400', spellcheck: 'false', 'aria-label': 'Record folder' });
    input.addEventListener('change', () => set({ record: { folder: input.value.trim() } }));
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') input.blur();
      else if (e.key === 'Escape') { input.value = (state.settings.record && state.settings.record.folder) || ''; input.blur(); }
    });
    return part('record', 'Your record', 'the folder of your ops record',
      h('div', { class: 'record-folder-field' }, input, h('button', { class: 'btn', text: 'Browse', onclick: async () => {
        const picked = await desk.pickFolder();
        if (picked) { input.value = picked; await set({ record: { folder: picked } }); }
      } })),
      said('Read only. Lowlit never writes in it.'),
      said('Read: log.jsonl, board.json, state, streams/dates.jsonl, opshub.toml. Never read: money, bank, dossier and the secrets of opshub.toml.'));
  }

  /** The Nest: the chat of the record. Its key from any program is held by main.cjs; a main from before the Nest has none. */
  function nestSection() {
    const s = state.settings;
    const on = s.nestKey !== false;
    const held = s.nestKeyState;
    const note = !on ? 'Off: Ctrl Shift Space opens the Nest only while this window is in front.'
      : held === 'on' ? 'On: Ctrl Shift Space brings this window up with the Nest, from any program. Press it again and the window goes back to how it was.'
        : held === 'taken' ? 'Another program holds Ctrl Shift Space, so it works only in this window for now. Once that program is closed, switch this off and on.'
          : 'It takes hold the next time the app starts.';
    return part('nest', 'The Nest', 'the chat of your record, with your day beside it',
      toggle(on, 'Open the Nest from any program with Ctrl Shift Space', note, () => set({ nestKey: !on })),
      choose('Its look', 'While the Nest is open the window becomes a place of its own. Lamp is warm, with fireflies drifting beside the chat; Night is a calm blue-green night with a few stars; Like the rest keeps the look of the window.',
        NEST_LOOKS, s.nestLook || 'lamp', (nestLook) => set({ nestLook })),
      said('The Nest is the chat that works in your record\'s folder, above. The logo at the top left opens it and closes it, and so does "Open the Nest" when you right-click the icon by the clock or the app\'s button on the taskbar.'));
  }

  /**
   * The Browser: whether the chats are offered it (main puts it in Claude Code's own list of tools, or takes it out),
   * whether the panel opens by itself, and the logins it keeps. Under a main from before the browser: no part.
   */
  function browserSection() {
    const b = state.settings.browser;
    if (!b || !Browser.can()) return null;
    const door = Browser.door() || {};
    const note = !b.on ? 'Off: your chats are not offered the browser. A chat already running keeps what it started with.'
      : door.busy ? 'Adding it to Claude Code…'
        : door.listed ? 'On. Claude Code lists it as "lowlit-browser" for every chat on this computer: the chats you start from now on can open pages, read them, click, type and look at them. A chat already running gets it the next time it starts.'
          : door.said ? `Claude Code did not take it: ${door.said} Switch this off and on to try again.`
            : 'On.';
    return part('browser', 'Browser', 'reachable from this computer only',
      toggle(b.on, 'Let your chats use the browser', note, () => set({ browser: { on: !b.on } })),
      toggle(b.popOpen, 'Open the panel when a chat opens a page', 'Off: the panel opens when you open it (Ctrl Shift B), or when a chat needs you on a page.', () => set({ browser: { popOpen: !b.popOpen } })),
      Array.isArray(b.ask) ? askRow(b.ask) : null,
      h('div', { class: 'set-row' },
        h('div', { class: 'what' }, h('div', { text: 'Logins kept by the browser' }),
          h('div', { class: 'quiet', text: 'A site you or a chat logs into stays logged in, in this browser only: never in your own Chrome.' })),
        h('button', { class: 'btn', text: 'Forget them', onclick: async () => {
          await Browser.ask('forget');
          toast('The browser forgot its logins and everything it kept of the sites.', 5000);
        } })),
      said('Each chat works in pages of its own. It can see the pages you opened too, and it is told to touch them only when you ask. "Take over" in the panel stops a chat\'s clicks and keys on a page until you hand it back. The chats reach the browser through Claude Code\'s own way of adding tools (MCP), at an address only this computer can reach, with a key only Claude Code is given.'));
  }
  /**
   * The ask-first list: sites a chat opens only once the person lets that chat in, with the button the Browser panel
   * shows when it asks. One site a line; main keeps what reads as a site and says back what it kept.
   */
  function askRow(list) {
    const box = h('textarea', { class: 'input mono ask-list', rows: '9', spellcheck: 'false', 'aria-label': 'Sites a chat opens only on your yes' });
    box.value = list.join('\n');
    box.addEventListener('keydown', (e) => e.stopPropagation());
    box.addEventListener('change', async () => {
      const lines = box.value.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      const next = await desk.settings({ browser: { ask: lines } });
      if (!next) return;
      act.changed(next);
      const now = next.browser && Array.isArray(next.browser.ask) ? next.browser.ask : null;
      if (!now) return;
      if (document.activeElement !== box) box.value = now.join('\n');
      const dropped = lines.length - now.length;
      toast(dropped > 0 ? `Kept ${now.length} sites; ${dropped} line${dropped === 1 ? ' was' : 's were'} not a site, or twice.` : `Kept ${now.length} site${now.length === 1 ? '' : 's'}.`, 4000);
    });
    return h('div', { class: 'set-row ask-row' },
      h('div', { class: 'what' }, h('div', { text: 'Sites a chat opens only on your yes' }),
        h('div', { class: 'quiet', text: 'Your mail, files, accounts, payments and private messages. When a chat wants one of these, the Browser panel asks you, and "Allow for this chat" lets that chat in until the app closes; until then it reads nothing of them, nor of your own pages there. One site a line: a site covers its subdomains, a site with a path the pages under it (github.com/settings). Your bank is not in the list until you add it.' })),
      box);
  }

  /**
   * Jev: off until switched on, with an OpenRouter key of the person's own. The key goes to main once and is locked
   * away there by Windows; it never comes back to this page, so this field only ever takes a new one.
   */
  function jevSection() {
    const v = Jev.view() || { on: false, hasKey: false, cap: 5, spent: 0, calls: 0, full: false, lastError: '', locked: true };
    const keyInput = h('input', { class: 'input jev-key', type: 'password', maxlength: '400', spellcheck: 'false', autocomplete: 'off',
      placeholder: v.hasKey ? 'A key is kept. Paste another to replace it' : 'Paste your OpenRouter key', 'aria-label': 'OpenRouter key' });
    const ask = async (what, value) => {
      const next = await desk.jev(what, value);
      if (next) Jev.take(next);
      if (shown) draw();
    };
    const save = () => { const text = keyInput.value.trim(); keyInput.value = ''; if (text) ask('key', text); };
    keyInput.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') save();
      else if (e.key === 'Escape') { keyInput.value = ''; keyInput.blur(); }
    });
    const money = (n) => `$${n.toFixed(n < 1 ? 4 : 2)}`;
    const now = new Date();
    const turn = new Date(now.getFullYear(), now.getMonth() + 1, 1).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
    const status = !v.on ? '' : !v.hasKey ? 'Paste a key to start.'
      : v.full ? `This month's ${money(v.cap)} is used up: Jev rests until ${turn}.` : 'On.';
    return part('jev', 'Jev', 'off until you switch it on',
      toggle(v.on, 'Let Jev judge finished chats and sort search',
        'When a chat stops, Jev reads its last answer and your last message and says whether it waits for you, is stuck, or is done: a waiting chat turns yellow, the one that holds everything up first, and a done job lights up Compact now. Search puts its first 20 results in the order Jev gives them.',
        () => ask('on', !v.on)),
      h('div', { class: 'set-row jev-row' }, keyInput,
        h('button', { class: 'btn', text: 'Save', onclick: save }),
        v.hasKey && h('button', { class: 'btn ghost', text: 'Remove the key', onclick: () => ask('key', '') })),
      status && said(status),
      v.lastError && said(v.lastError, 'jev-error'),
      !v.locked && said('Windows cannot lock a key away on this machine right now, so none can be kept.', 'jev-error'),
      said(`Spending stops at ${money(v.cap)} a month. This month: ${money(v.spent || 0)}, ${v.calls || 0} question${v.calls === 1 ? '' : 's'}. One question costs about $0.0001.`),
      said('What leaves this computer, only while it is on: a finished chat\'s last answer and your last message, or the words you searched and the first 20 results. Keys and passwords are taken out first. Chats working in your ops record folder are never sent, nor search results from them. A chat elsewhere that quotes your record in its last answer would send that quote.'),
      said('Your key is locked by Windows for your user on this computer. It is never shown again and never written to a log.'));
  }

  /**
   * The work clock: on or off, the usual shifts (a name, the time it starts, how many hours), and whether ActivityWatch
   * is read for the programs. Under a main from before the clock: no part.
   */
  function workSection() {
    const w = state.settings.work;
    if (!w) return null;
    const keep = (shifts) => set({ work: { shifts } });
    const field = (props, take) => {
      const input = h('input', { class: 'input', ...props });
      input.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') input.blur(); });
      input.addEventListener('change', () => take(input.value));
      return input;
    };
    const rows = w.shifts.map((s, i) => {
      const put = (change) => keep(w.shifts.map((x, j) => (j === i ? { ...x, ...change } : x)));
      return h('div', { class: 'set-row work-row', data: { shift: String(i) } },
        nameField(s.name, `The name of the shift at ${s.at}`, 'Name', (name) => put({ name })),
        h('span', { class: 'quiet', text: 'starts at' }),
        field({ type: 'time', class: 'input work-at', value: s.at, 'aria-label': `When ${s.name} starts` }, (v) => { if (/^\d{2}:\d{2}$/.test(v)) put({ at: v }); }),
        h('span', { class: 'quiet', text: 'for' }),
        field({ type: 'number', class: 'input work-hours', value: String(s.hours), min: '0.25', max: '14', step: '0.25', 'aria-label': `How many hours ${s.name} lasts` }, (v) => { if (Number(v) > 0) put({ hours: Number(v) }); }),
        h('span', { class: 'quiet', text: 'hours' }),
        h('button', { class: 'mini', 'aria-label': `Take ${s.name} away`, tip: 'Take this shift away', onclick: () => keep(w.shifts.filter((_, j) => j !== i)) }, icon('x', 12)));
    });
    return part('work', 'Work clock', 'at the right of the title bar',
      toggle(w.on, 'Show the work clock, and keep a record of your day',
        'It times you by itself: a work session starts when you touch a key or the mouse, and a break as long as the one below ends it at your last touch, so the break is not counted. A countdown shows only when you start one: click the clock.',
        () => set({ work: { on: !w.on } })),
      w.on && h('div', { class: 'set-row work-gap-row' },
        h('div', { class: 'what' }, h('div', { text: 'A break this long ends a session' }), h('div', { class: 'quiet', text: 'Shorter breaks are part of the session.' })),
        field({ type: 'number', class: 'input work-gap', value: String(w.gap || 15), min: '5', max: '120', step: '5', 'aria-label': 'How many minutes of break end a session' },
          (v) => { if (Number(v) > 0) set({ work: { gap: Number(v) } }); }),
        h('span', { class: 'quiet', text: 'minutes' })),
      w.on && h('div', { class: 'set-row' }, h('div', { class: 'what' }, h('div', { class: 'quiet', text: 'Your usual shifts. In their hours, one click on the clock counts one down from when you sat down.' }))),
      w.on && rows,
      w.on && w.shifts.length < 4 && h('div', { class: 'set-row' },
        h('div', { class: 'what' }, h('div', { class: 'quiet', text: w.shifts.length ? 'A shift of your own: a name, when it starts, how long it lasts.' : 'No usual shift: a countdown starts from the hours on the clock.' })),
        h('button', { class: 'btn sm', text: 'Add a shift', onclick: () => keep([...w.shifts, { name: 'Shift', at: '14:00', hours: 4 }]) })),
      w.on && w.shifts.length > 0 && toggle(Boolean(w.auto), 'Start my usual shift\'s countdown by itself',
        'When you sit down in its hours, from an hour before its time, with its hours from that moment; already at work before then, at its time. Off: a countdown shows only when you start one.',
        () => set({ work: { auto: !w.auto } })),
      w.on && toggle(w.aw, 'Read ActivityWatch on this computer',
        'For your sessions from before this window was open, and how long each program was in front: program names and times only, never a window\'s title or a web address. ActivityWatch keeps its own record; Lowlit only asks it, at its address on this computer.',
        () => set({ work: { aw: !w.aw } })),
      said('Kept on this computer, in Lowlit\'s own folder: your countdowns, the stretches at the computer, and the time each chat was in front while this window had the keyboard. Never sent anywhere.'));
  }

  function linksSection() {
    const links = state.settings.links || {};
    return part('links', 'Ways to open Lowlit', 'nothing is added until you switch it on',
      toggle(links.startmenu, 'In the Start menu', '', () => link('startmenu', !links.startmenu)),
      toggle(links.desktop, 'On the desktop', '', () => link('desktop', !links.desktop)),
      toggle(links.startup, 'Start with Windows', 'It waits by the clock instead of opening over your work.', () => link('startup', !links.startup)));
  }

  function keysSection() {
    return part('keys', 'Keys', 'the terminal keeps every other key',
      h('div', { class: 'keys' }, KEYS.map(([key, what]) => h('div', { class: 'key' }, h('kbd', { text: key }), h('span', { text: what })))));
  }

  function readsSection() {
    return part('reads', 'What this app reads', '',
      said('The files Claude Code and Codex write on this machine: which sessions are running, their transcripts and their subagents, and what Claude Code hands your status line (that is where the usage limits, the cost and the cache come from).'),
      said('Claude Code hands the usage limits only to a status line command. Lowlit\'s own (app/statusline.cjs) keeps the last figures in %LOCALAPPDATA%\\AgentFocus\\statusline.json once one line in ~/.claude/settings.json turns it on ("Usage limits" in the README). It runs on this computer and sends nothing.'),
      said("To tell your accounts apart it reads the name on the account that is logged in (its email, its plan, its id) from Claude Code's settings file, and when you typed /login. It never opens the file that holds the key to an account, it cannot log in, log out or switch, and it never talks to Anthropic. The chats are the real programs, running in real terminals. Nothing leaves this computer unless you switch Jev on, or a page is opened in the Browser."),
      said('To show what each session holds on this computer it asks Windows for the programs running under your sessions: their names, the RAM they hold, the processor time they used and the ports they listen on. Every 4 seconds while this window is in front, every 30 seconds otherwise. To tell an MCP server or a dev server from any other program it looks once at how that program was started, and keeps a short name only: never the line itself.'),
      said('The Browser opens the web pages your chats, or you, ask for, as any browser does: those sites see a visit from this computer, and only what the page asks for goes to them.'));
  }

  /** What the page is drawn from: the settings, the accounts, Jev and the Browser's place in Claude Code. */
  function stampNow() {
    const v = Parts.acctView(state);
    return JSON.stringify([state.settings, v.list.map((a) => [a.key, a.email, a.plan, a.here, a.to]), Jev.view(), Browser.can() && Browser.door()]);
  }

  /** Every topic drawn again whole; the keyboard stays where it was (the same field or button of the same part). */
  function draw() {
    const was = document.activeElement;
    const sec = was && main.contains(was) ? was.closest('section[data-section]') : null;
    const spot = sec ? { id: sec.dataset.section, i: [...sec.querySelectorAll(FOCUSABLE)].indexOf(was) } : null;
    const parts = {
      claude: claudeSection(), terminal: terminalSection(), closing: closingSection(), notes: notesSection(), cards: cornerSection(),
      look: lookSection(), float: floatSection(), spaces: spacesSection(), accounts: accountsSection(), work: workSection(),
      record: recordSection(), nest: nestSection(), browser: browserSection(), jev: jevSection(), links: linksSection(), keys: keysSection(), reads: readsSection(),
    };
    fill(main, TOPICS.map((t) => {
      const kids = t.sections.map((id) => parts[id]).filter(Boolean);
      return kids.length ? h('div', { class: 'set-pane', data: { topic: t.id } },
        h('header', { class: 'set-pane-head' }, h('h2', { text: t.name }), h('p', { class: 'quiet', text: t.lede })), kids) : null;
    }));
    for (const [id, b] of topicButtons) b.hidden = !main.querySelector(`.set-pane[data-topic="${id}"]`);
    index();
    stamp = stampNow();
    find();
    if (!spot || spot.i < 0) return;
    const again = main.querySelector(`section[data-section="${spot.id}"]`);
    const list = again ? [...again.querySelectorAll(FOCUSABLE)] : [];
    const el = list[Math.min(spot.i, list.length - 1)];
    if (el) el.focus({ preventScroll: true });
  }

  /** Drawn again when something it shows changed, but never under a field being typed in or text being selected. */
  function render() {
    if (!shown || !main) return;
    if (stampNow() === stamp) return;
    const a = document.activeElement;
    if (a && main.contains(a) && a.matches('input, textarea, select')) return;
    if (selectionIn(main)) return;
    draw();
  }

  // ---- the search ----
  const norm = (s) => String(s || '').toLowerCase().replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, ' ');
  /** A part of the page as the search reads it: its words, and what its fields and buttons are called. */
  function wordsOf(el) {
    let out = el.textContent || '';
    for (const x of el.querySelectorAll('[aria-label], [placeholder], [data-tip]')) out += ` ${x.getAttribute('aria-label') || ''} ${x.getAttribute('placeholder') || ''} ${x.dataset.tip || ''}`;
    return norm(out);
  }
  /** Each row, note and key of every topic, with the words it is found by: its own, its part's title, its topic's. */
  function index() {
    units = [];
    for (const pane of main.querySelectorAll('.set-pane')) {
      const t = TOPICS.find((x) => x.id === pane.dataset.topic);
      const topicWords = norm(`${t.name} ${t.words}`);
      for (const sec of pane.querySelectorAll('section[data-section]')) {
        const head = sec.querySelector(':scope > h3');
        const around = `${topicWords} ${norm(head ? head.textContent : '')}`;
        for (const el of sec.querySelectorAll(':scope > :not(h3):not(.keys), :scope > .keys > .key')) units.push({ el, pane, sec, text: `${around} ${wordsOf(el)}` });
      }
    }
  }
  const wordsAsked = () => norm(findInput.value).trim().split(' ').filter(Boolean);

  /** With words in the search: every topic's rows that hold them all. Without: the topic picked, whole. */
  function find() {
    if (!page) return;
    const words = wordsAsked();
    const finding = words.length > 0;
    page.classList.toggle('finding', finding);
    findClear.hidden = !finding;
    const hits = new Map();
    for (const u of units) {
      const hit = !finding || words.every((w) => u.text.includes(w));
      u.el.classList.toggle('miss', !hit);
      if (hit) hits.set(u.pane, (hits.get(u.pane) || 0) + 1);
    }
    for (const sec of main.querySelectorAll('section[data-section]')) sec.classList.toggle('miss', finding && !units.some((u) => u.sec === sec && !u.el.classList.contains('miss')));
    for (const pane of main.querySelectorAll('.set-pane')) pane.hidden = finding ? !hits.get(pane) : pane.dataset.topic !== topic;
    for (const [id, b] of topicButtons) {
      const pane = main.querySelector(`.set-pane[data-topic="${id}"]`);
      const n = finding && pane ? hits.get(pane) || 0 : 0;
      b.classList.toggle('on', !finding && id === topic);
      b.setAttribute('aria-current', !finding && id === topic ? 'page' : 'false');
      b.classList.toggle('none', finding && !n);
      b.querySelector('.n').textContent = finding && n ? String(n) : '';
    }
    found.hidden = !finding;
    const total = [...hits.values()].reduce((a, n) => a + n, 0);
    const asked = findInput.value.trim();
    if (finding) found.textContent = total ? `${total} ${total === 1 ? 'match' : 'matches'} for "${asked}". Enter goes to the first.` : `Nothing matches "${asked}". Try another word, like model, notes, look, keys or browser.`;
    mark(finding ? words : []);
  }

  /** The words found, marked where they stand in what is shown. */
  function mark(words) {
    if (!canMark) return;
    if (!words.length) { CSS.highlights.delete('set-find'); return; }
    const ranges = [];
    const shownEls = [...main.querySelectorAll('section[data-section]:not(.miss) > h3'), ...units.filter((u) => !u.el.classList.contains('miss')).map((u) => u.el)];
    for (const el of shownEls) {
      const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      for (let n = walk.nextNode(); n && ranges.length < 600; n = walk.nextNode()) {
        const low = n.data.toLowerCase();
        if (low.length !== n.data.length) continue;
        for (const w of words) {
          for (let at = low.indexOf(w); at >= 0 && ranges.length < 600; at = low.indexOf(w, at + w.length)) {
            const r = new Range();
            r.setStart(n, at);
            r.setEnd(n, at + w.length);
            ranges.push(r);
          }
        }
      }
    }
    CSS.highlights.set('set-find', new Highlight(...ranges));
  }

  /** Enter in the search: the first row found, in its topic, with the keyboard on it. */
  function jump() {
    const first = wordsAsked().length ? units.find((u) => !u.el.classList.contains('miss')) : null;
    if (!first) return;
    findInput.value = '';
    pick(first.pane.dataset.topic);
    reveal(first.el);
    const target = first.el.matches(FOCUSABLE) ? first.el : first.el.querySelector(FOCUSABLE);
    if (target) target.focus({ preventScroll: true });
    first.el.classList.remove('set-flash');
    void first.el.offsetWidth;
    first.el.classList.add('set-flash');
  }

  /** Scrolls the page (only the page: nothing around it moves) so that el stands near the top. */
  function reveal(el) {
    const top = el.getBoundingClientRect().top - body.getBoundingClientRect().top;
    body.scrollTop = Math.max(0, body.scrollTop + top - 18);
  }

  /** A topic picked: its page alone, the search let go. byHand: picked down the left, so the page starts at its top. */
  function pick(id, byHand = false) {
    const panes = [...main.querySelectorAll('.set-pane')];
    const ok = panes.some((p) => p.dataset.topic === id) ? id : panes.length ? panes[0].dataset.topic : '';
    if (ok && ok !== topic) kept.set('settings.topic', ok);
    const moved = ok !== topic;
    topic = ok;
    find();
    if (moved || byHand) body.scrollTop = 0;
  }

  // ---- in and out of sight ----
  /** where: a topic ('notes') or a part ('spaces', 'jev'); the topic last looked at otherwise. */
  function open(where) {
    aim = typeof where === 'string' ? where : '';
    if (shown) land(); else act.open();
  }
  /** desk's setView: the page came into sight, or left it. */
  function show(on) {
    if (on === shown || !main) return;
    shown = on;
    if (!on) { mark([]); return; }
    draw();
    land();
  }
  function land() {
    const where = aim;
    aim = '';
    findInput.value = '';
    const id = TOPICS.some((t) => t.id === where) ? where : TOPIC_OF[where] || topic;
    pick(id, true);
    const sec = TOPIC_OF[where] ? main.querySelector(`section[data-section="${where}"]`) : null;
    if (sec && !sec.closest('.set-pane').hidden) {
      reveal(sec);
      const field = sec.querySelector('.name-input');
      if (field) field.focus({ preventScroll: true });
      return;
    }
    findInput.focus({ preventScroll: true });
  }
  function close() {
    if (shown) act.close();
  }
  /** Ctrl F, and / where nothing is being typed: the search. */
  function focusFind() {
    if (!shown) return;
    findInput.focus();
    findInput.select();
  }
  /** The keys of the page, before anything else hears them (desk.js): / to search, Esc to clear it or go back. */
  function key(e) {
    if (!shown || e.ctrlKey || e.altKey || e.metaKey) return false;
    const t = e.target;
    const typing = t instanceof Element && t.matches('input, textarea, select, [contenteditable]');
    if (e.key === 'Escape') {
      if (t !== findInput && typing) return false;
      if (findInput.value) { findInput.value = ''; find(); findInput.focus(); return true; }
      close();
      return true;
    }
    if (e.key === '/' && !typing) { focusFind(); return true; }
    return false;
  }

  return { init, open, close, show, render, key, focusFind, isOpen, jevChanged: render, browserChanged: render,
    topics: () => TOPICS.map((t) => ({ id: t.id, name: t.name, icon: t.icon, words: t.words })) };
})();
