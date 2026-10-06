'use strict';
/* global h, fill, icon, glyph, hours, ago, clockShort, kept */
// Jev's verdicts in the window (main asks; jev.cjs). A finished chat Jev judged as asking the person something is
// drawn as waiting (yellow), one it judged stuck as failed (red), and a job judged done with nothing left open
// lights up Compact now. A verdict holds while the chat stays as Jev saw it: its next turn makes it old. Off, Jev
// changes nothing anywhere.

const Jev = (() => {
  const WAITS = new Set(['blocks', 'yesno']);
  // among the chats that want the person, what holds everything up comes first
  const RANK = { blocks: 0, yesno: 1, stuck: 2 };
  const WORDS = {
    blocks: 'asks you something', yesno: 'wants a yes or no', stuck: 'is stuck', loose: 'finished, with loose ends',
    done: 'finished, nothing left open', fyi: 'told you something',
  };
  let view = null;
  let newest = new Map();        // session key -> its newest verdict

  function take(v) {
    view = v && typeof v === 'object' ? v : null;
    newest = new Map();
    for (const x of (view && view.verdicts) || []) if (!newest.has(x.key)) newest.set(x.key, x);
  }
  /** Switched on, with a key: its verdicts count. */
  const on = () => Boolean(view && view.on && view.hasKey);
  /** The verdict on a session's last turn while it still holds; null when there is none, or Jev is off. */
  function verdict(c) {
    if (!on() || !c || c.state !== 'idle' || c.limited) return null;
    const v = newest.get(c.key);
    return v && v.since === c.since ? v : null;
  }
  const waits = (v) => Boolean(v && WAITS.has(v.level));
  /** Where a chat that wants the person stands among the others, 0 first. The same for all while Jev is off. */
  function rank(c) {
    if (!on() || !c || c.state === 'attention') return 0;
    if (c.state === 'error') return 2;
    const v = verdict(c);
    return v && Object.hasOwn(RANK, v.level) ? RANK[v.level] : 3;
  }
  /** The job is done and nothing is left open: a good moment to compact. */
  const ready = (c) => { const v = verdict(c); return Boolean(v && v.level === 'done'); };
  return { take, on, verdict, waits, rank, ready, words: (level) => WORDS[level] || '', view: () => view };
})();

// ---- While you were away: what the chats did while the window was not looked at for 15 minutes or more, kept on
// ---- the Dashboard until the next time away. Never at the top of the page: there it pushed the chats down. A chat
// ---- that has moved on since (answered, set going again) leaves the list by itself. ----
const Morning = (() => {
  const AWAY_MS = 15 * 60e3;
  const KEEP_MS = 12 * 3600e3;
  const OLD_MS = 3 * 86400e3;
  const GROUPS = [['needs', 'Need you'], ['failed', 'Failed'], ['done', 'Finished'], ['fyi', 'Told you something']];
  const box = h('section', { class: 'sec block morning-sec', hidden: true });
  let state = null;
  let act = null;
  let leftAt = 0;                // when the window stopped being looked at; 0 while it is
  let away = null;               // the last time away of 15 minutes or more: { from, to }

  function load() {
    away = null;
    leftAt = 0;
    try {
      const a = JSON.parse(kept.get('away', 'null'));
      if (a && Number.isFinite(a.from) && Number.isFinite(a.to)) away = { from: a.from, to: a.to };
    } catch { away = null; }
  }

  function init(st, actions) {
    state = st;
    act = actions;
    load();
  }

  /** The window is not being looked at any more. */
  function leave(at = Date.now()) { if (!leftAt) leftAt = at; }
  /** It is again: after 15 minutes or more, what happened meanwhile is said. */
  function back(at = Date.now()) {
    if (!leftAt) return;
    const from = leftAt;
    leftAt = 0;
    if (at - from < AWAY_MS) return;
    away = { from, to: at };
    kept.set('away', JSON.stringify(away));
    render();
  }

  /** What happened to each chat while away, in four groups; empty when nothing did. */
  function groups(now) {
    const out = { needs: [], failed: [], done: [], fyi: [] };
    if (!away || now - away.to > KEEP_MS) return out;
    for (const c of state.snap.chats) {
      if (!(c.since >= away.from && c.since <= away.to)) continue;
      if (c.kind === 'bg' && !c.pid && now - c.at > OLD_MS) continue;
      const v = Jev.verdict(c);
      const row = { c, v };
      if (c.state === 'attention' || Jev.waits(v)) out.needs.push(row);
      else if (c.state === 'error' || (v && v.level === 'stuck')) out.failed.push(row);
      else if (c.state !== 'idle') continue;
      else if (v && v.level === 'fyi') out.fyi.push(row);
      else out.done.push(row);
    }
    out.needs.sort((a, b) => Jev.rank(a.c) - Jev.rank(b.c) || a.c.since - b.c.since);
    for (const k of ['failed', 'done', 'fyi']) out[k].sort((a, b) => a.c.since - b.c.since);
    return out;
  }

  /** What a row says the chat did: Jev's words when it judged it, else what its state says. */
  function said(r) {
    if (r.v) return Jev.words(r.v.level).replace(/^./, (x) => x.toUpperCase());
    return r.c.state === 'attention' ? 'Waits for your answer' : r.c.state === 'error' ? (r.c.limited ? 'Stopped by a usage limit' : 'Failed') : 'Finished';
  }

  function rowOf(r, now) {
    return h('button', { class: `mr-row${r.v && r.v.level === 'loose' ? ' loose' : ''}`, data: { key: r.c.key }, onclick: () => act.show(r.c.key) },
      glyph(act.mark(r.c), 13), h('span', { class: 'mr-name', text: act.name(r.c) }), h('span', { class: 'mr-said', text: said(r) }),
      h('span', { class: 'mr-when', data: { time: r.c.since }, text: ago(r.c.since, now) }));
  }

  function render() {
    if (!state) return;
    const now = Date.now();
    const g = groups(now);
    const n = g.needs.length + g.failed.length + g.done.length + g.fyi.length;
    const span = away ? `${clockShort(away.from)} to ${clockShort(away.to)} · ${hours(away.to - away.from)} away` : '';
    box.hidden = n === 0;
    if (!n) { if (box.dataset.stamp) { box.replaceChildren(); delete box.dataset.stamp; } return; }
    const stamp = JSON.stringify([span, g.needs.concat(g.failed, g.done, g.fyi).map((r) => [r.c.key, r.v && r.v.level, act.mark(r.c), act.name(r.c)])]);
    if (box.dataset.stamp === stamp) return;
    box.dataset.stamp = stamp;
    fill(box, h('div', { class: 'sec-head' }, h('h3', { text: 'While you were away' }), h('span', { class: 'note', text: span })),
      h('div', { class: 'mr-groups' }, GROUPS.filter(([k]) => g[k].length).map(([k, title]) =>
        h('div', { class: `mr-group mr-${k}` }, h('div', { class: 'mr-head', text: `${title} · ${g[k].length}` }), h('div', { class: 'mr-list' }, g[k].map((r) => rowOf(r, now)))))));
  }

  return { init, leave, back, render, load, box, groups: () => groups(Date.now()), away: () => away };
})();
