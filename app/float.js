'use strict';
/* global card, h, fill, icon, glyph, bar, count, dollarsShort, modelName, Parts */
// The floating card: the chat in front of Lowlit, in a small window of its own that stays over every other
// program (main.cjs makes it; the window's page says what it shows). What the chat is doing now, its plan step by
// step, the subagents at work, how full its memory is and what it used; under it, the other chats that want the
// person. It never takes the keyboard. A press on a chat's name brings Lowlit up on that chat.

(() => {
  const root = document.getElementById('card');
  // the steps of a plan shown at once, round the one at work
  const STEPS_SHOWN = 7;
  let model = null;
  let how = { small: false, overDesk: false };
  let told = 0;

  const button = (name, label, run, extra = '') => h('button', { class: `fc-btn${extra ? ' ' + extra : ''}`, 'aria-label': label, title: label, onclick: run }, icon(name, 14));

  /** Its name, and its own buttons: bring the chat up in Lowlit, more or less of it, stay over Lowlit too, hide. */
  function head(c) {
    return h('header', { class: 'fc-head' },
      glyph(c ? c.mark : 'none', 13),
      h('span', { class: 'fc-name', text: c ? c.name : 'Lowlit' }),
      c && c.folder && c.folder !== c.name && h('span', { class: 'fc-folder', text: c.folder }),
      h('span', { class: 'fc-tools' },
        c && button('external', 'Open this chat in Lowlit', () => card.go(c.id)),
        button('chevron-down', how.small ? 'Show more' : 'Show less', () => card.set({ small: !how.small }), 'fc-size'),
        button('pin', how.overDesk ? 'Stay over Lowlit too: on. Click to step aside while Lowlit is in front' : 'Stay over Lowlit too',
          () => card.set({ overDesk: !how.overDesk }), how.overDesk ? 'on' : ''),
        button('x', 'Hide the card. Ctrl Shift F in Lowlit brings it back', () => card.set({ on: false }))));
  }

  /** What it is doing, and since when. */
  function now(c) {
    return h('div', { class: `fc-now s-${c.mark}` },
      h('span', { class: 'fc-words', text: c.words }),
      c.limit ? h('span', { class: 'fc-timer' }, 'lifts in ', h('b', { data: { until: c.limit.until } }))
        : c.timer && h('span', { class: 'fc-timer', data: c.timer.since ? { since: c.timer.since } : { time: c.timer.time } }));
  }

  /** Its plan: a mark per step, then the steps round the one at work; small, the one at work alone. */
  function plan(c) {
    const p = c.plan;
    const at = p && Parts.planNow(p);
    if (!at) return null;
    if (how.small) {
      return h('section', { class: 'fc-plan' }, h('div', { class: 'fc-plan-line' }, Parts.planMarks(at.items), h('span', { class: 'pl-n', text: at.count }),
        h('span', { class: `fc-step${at.finished ? ' done' : ''}`, text: at.words })));
    }
    return h('section', { class: 'fc-plan' },
      h('div', { class: 'fc-label' }, h('span', { text: 'Plan' }), h('span', { class: 'fc-count', text: Parts.planDone(p) })),
      Parts.planMarks(at.items), Parts.planList(p, STEPS_SHOWN));
  }

  /** The subagents at work, each with what it was sent to do and for how long. */
  function agents(c) {
    if (how.small || !c.running) return null;
    const rest = c.running - c.agents.length;
    return h('section', { class: 'fc-agents' },
      h('div', { class: 'fc-label' }, h('span', { text: 'Subagents' }), h('span', { class: 'fc-count', text: `${c.running} at work` })),
      c.agents.map((a) => h('div', { class: 'fc-agent' }, glyph('working', 12),
        h('span', { class: 'fc-agent-what', text: a.what || a.name || 'A subagent' }),
        a.started > 0 && h('span', { class: 'fc-timer', data: { since: a.started } }))),
      rest > 0 && h('p', { class: 'pl-more', text: `${rest} more at work` }));
  }

  /** How full its memory is, against where Claude Code squeezes it on its own. */
  function memory(c) {
    const m = c.memory;
    if (!m) return null;
    return h('section', { class: `fc-mem${m.tone ? ' ' + m.tone : ''}` },
      h('div', { class: 'fc-label' }, h('span', { text: 'Memory' }),
        h('span', { class: 'fc-count', text: m.known ? `${Math.round(m.part * 100)}%` : `${count(m.context)} tokens` })),
      m.known && bar(m.part, m.tone),
      !how.small && m.known && h('div', { class: 'fc-sub', text: `${count(m.context)} of about ${count(m.ceiling)} tokens${m.compacts ? ` · compacted ${m.compacts}×` : ''}` }));
  }

  /** What it used, as three figures: its cost at list prices, the tokens it wrote today, the model and its effort. */
  function numbers(c) {
    if (how.small) return null;
    const cells = [c.usd > 0 && [dollarsShort(c.usd), 'at list prices'], c.out > 0 && [count(c.out), 'out today'],
      c.model && [modelName(c.model), c.effort ? `effort ${c.effort}` : 'model']].filter(Boolean);
    return cells.length ? h('div', { class: 'fc-numbers' }, cells.map(([value, what]) => h('div', { class: 'fc-num' }, h('b', { text: value }), h('span', { text: what })))) : null;
  }

  /** The other chats: the ones that want the person by name, and how many are at work. */
  function others() {
    const needs = model.needs || [];
    const more = Math.max(0, (model.nNeeds || 0) - needs.length);
    if (!needs.length && !model.working) return null;
    const all = needs.length + more;
    return h('footer', { class: 'fc-others' },
      needs.length > 0 && h('div', { class: 'fc-needs' }, glyph('needs', 12),
        h('span', { class: 'fc-needs-k', text: all === 1 ? 'Needs you:' : `${all} need you:` }),
        needs.map((x, i) => [i > 0 && h('span', { class: 'fc-comma', text: ',' }), h('button', { class: 'fc-link', text: x.name, title: `Open ${x.name} in Lowlit`, onclick: () => card.go(x.chat || `row:${x.key}`) })]),
        more > 0 && h('span', { class: 'fc-comma', text: `and ${more} more` })),
      model.working > 0 && h('div', { class: 'fc-working', text: `${model.working} other chat${model.working === 1 ? '' : 's'} at work` }));
  }

  function draw() {
    if (!model) { root.hidden = true; return; }
    document.documentElement.dataset.look = model.look === 'grey' ? 'grey' : 'noir';
    const c = model.chat;
    root.className = `card s-${c ? c.mark : 'none'}${how.small ? ' small' : ''}`;
    root.hidden = false;
    fill(root, head(c), c && now(c), c && plan(c), c && agents(c), c && memory(c), c && numbers(c), others());
    Parts.tick(root);
    measure();
  }

  /** The window is as tall as the card and the margin its shadow falls in. */
  function measure() {
    const tall = root.hidden ? 0 : Math.ceil(root.getBoundingClientRect().height + 16);
    if (!tall || tall === told) return;
    told = tall;
    card.size(tall);
  }

  card.onModel((next, said) => {
    model = next;
    if (said && typeof said === 'object') how = { small: said.small === true, overDesk: said.overDesk === true };
    draw();
  });
  // the marks that age on their own: "3m" since, "2m 05s" going
  setInterval(() => { if (!root.hidden) Parts.tick(root); }, 1000);
  // the app's own fonts arrive after the first draw and change its height a little
  document.fonts.addEventListener('loadingdone', measure);
  new ResizeObserver(measure).observe(root);
})();
