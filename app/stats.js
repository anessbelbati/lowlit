'use strict';
/* global seenWait, h, fill, sync, glyph, figure, selectionIn, count, whole, hours, left, ago, took, dollars, dollarsShort, modelName, labelOf, dayLabel, dateTime, clock, clockShort, whenOf, whenShort, limitName, bar, barChart, acctColor, acctName, acctShort, planName, windowOf, forecast, ACCT_NONE, Parts, Side, Glance, Jev, Morning, Shift */
// The Dashboard: every number of the app lives here, and nowhere else. What
// the sessions hold on this computer right now and what each is doing call by
// call, the accounts this machine logs in to and what was done under each,
// then what every conversation added up to, by day, by hour, by chat, by
// project, by model and by tool. The sums are counted from the transcripts
// the CLI writes on disk.

const Stats = (() => {
  const RANGES = [['today', 'Today'], ['7d', '7 days'], ['30d', '30 days']];
  const METRICS = [
    { id: 'usd', name: 'Cost', get: (x) => x.usd, format: dollarsShort, unit: 'at list prices' },
    { id: 'out', name: 'Tokens out', get: (x) => x.out, format: count, unit: 'tokens out' },
    { id: 'work', name: 'Agent work', get: (x) => x.work, format: hours, unit: 'of work' },
    { id: 'replies', name: 'Replies', get: (x) => x.replies, format: count, unit: 'replies' },
    { id: 'cacheRead', name: 'Cache re-read', get: (x) => x.cacheRead, format: count, unit: 'tokens re-read' },
  ];
  const UNKNOWN = '?';           // what was done while nothing on disk said which account was logged in
  const RIBBON_DAYS = 14;
  const RUN_SHOWN = 12;          // sessions listed by the RAM they hold; the rest are added up in one line
  const FEED_MS = 30 * 60e3;
  const FEED_SHOWN = 14;
  let root = null;
  let wrap = null;
  let act = null;
  let metric = METRICS[0];
  let drawn = '';

  // what the sessions take on this computer right now: measured every few seconds, so it is drawn by itself
  // while the sums under it are redrawn only when they change
  const runBox = h('section', { class: 'sec block run-sec', hidden: true });

  function init(el, actions) {
    root = el;
    act = actions;
    wrap = h('div', { class: 'd-wrap wide' });
    root.append(wrap);
    // a card that came up under a bar stays where it was drawn: it goes when the page moves under it
    root.addEventListener('scroll', () => Glance.hide(), { passive: true });
  }

  function drawRunning(state) {
    const stamp = Parts.runningStamp(state, RUN_SHOWN);
    runBox.hidden = !stamp;
    if (runBox.dataset.stamp === stamp || (stamp && runBox.dataset.stamp && selectionIn(runBox))) return;
    runBox.dataset.stamp = stamp;
    if (!stamp) return;
    const run = Parts.runningBlock(state, (key) => act.show(key), RUN_SHOWN);
    fill(runBox, h('div', { class: 'sec-head' }, h('h3', { text: 'On this computer' }), h('span', { class: 'note' }, run.note)), run.body);
  }

  // ---- every chat at once, as bars: one per chat, standing on a line in the colour of its workspace. Its colour says
  // ---- what it wants (yellow: you; green: it finished and you have not looked; red: it failed or a usage limit
  // ---- stopped it; white: at work; dark: idle), its height how long it has been so, full at four hours. A bar keeps
  // ---- its place: new chats join at the end of their workspace. ----
  const BAR_FULL = 4 * 3600e3;
  const OLD_MS = 3 * 86400e3;
  const TONE_WORDS = { needs: 'waits for you', done: 'finished, not looked at yet', error: 'failed or stopped by a usage limit', working: 'working', idle: 'idle' };
  const barsBox = h('section', { class: 'sec bars-sec' });
  const bars = new Map();        // session key -> { el, top, tone, born }
  let lastBars = null;

  /** A session's bar, made once: it keeps its element, so it keeps its place, and the time it was first met. */
  function barFor(key, born) {
    let b = bars.get(key);
    if (b) return b;
    const top = h('span', { class: 'cbar-top' });
    const el = h('button', { class: 'cbar', data: { key }, onclick: () => act.show(key),
      onpointerenter: (e) => Glance.near(key, e.currentTarget), onpointerleave: () => Glance.away() }, top, h('i', { class: 'cbar-fill' }));
    b = { el, top, tone: '', born };
    bars.set(key, b);
    return b;
  }

  /** How tall a bar stands after `ms` in the same state: quick to rise at first, full at four hours. */
  const rise = (ms) => Math.max(0.07, Math.min(1, Math.log1p(Math.max(0, ms) / 60e3) / Math.log1p(BAR_FULL / 60e3)));

  /** What a bar shows for one session: its tone, and how tall it stands. */
  function barOf(c, state, now) {
    // a wait the person has had in front of them: its bar stays, dull, and Jev's word on it no longer lifts it
    const seen = seenWait(c);
    const judged = seen ? null : Jev.verdict(c);
    let tone = c.state === 'attention' ? 'needs'
      : c.state === 'error' || c.limited ? 'error'
        : c.state === 'working' || c.state === 'compacting' ? 'working'
          : state.unread.has(c.key) ? 'done' : 'idle';
    if (judged && Jev.waits(judged)) tone = 'needs';
    else if (judged && judged.level === 'stuck') tone = 'error';
    const t = rise(now - c.since);
    // While Jev sorts the waiting chats they stand by what answering them unblocks: a question that holds everything
    // up (and a prompt of Claude Code's own) above a quick yes or no. Without it, by how long they have waited.
    const ranked = tone === 'needs' && Jev.on();
    const height = !ranked ? t : judged && judged.level === 'yesno' ? 0.42 + 0.26 * t : 0.74 + 0.26 * t;
    return { tone, height, judged, quiet: seen && (tone === 'needs' || tone === 'error') };
  }

  function drawBars(state, now) {
    if (!state) return;
    lastBars = state;
    const spaces = state.settings.spaces || [];
    const groups = new Map(spaces.map((s) => [s.id, { id: s.id, name: s.name, color: Side.colorOf(s, spaces), items: [] }]));
    const loose = { id: '?', name: spaces.length ? 'Unsorted' : 'Every chat', color: '', items: [] };
    const here = new Map(state.chats.map((x) => [x.id, x]));
    for (const c of state.snap.chats) {
      if (c.kind === 'bg' && !c.pid && now - c.at > OLD_MS) continue;
      const chat = c.chat ? here.get(c.chat) : null;
      if (chat && chat.closing) continue;
      const ids = act.spacesOf(c.cwd, c.key);
      // a background job says nothing of when it started: it stands where it was first met
      (groups.get(ids[0]) || loose).items.push({ c, b: barFor(c.key, c.started || now), name: chat && act.session(chat.id) === c ? act.label(chat) : labelOf(c) });
    }
    const list = [...groups.values(), loose].filter((g) => g.items.length);
    for (const g of list) g.items.sort((x, y) => x.b.born - y.b.born || (x.c.key < y.c.key ? -1 : 1));
    const counts = { needs: 0, done: 0, error: 0, working: 0, idle: 0, quiet: 0 };
    const seen = new Set();
    const groupEls = [];
    for (const g of list) {
      const barEls = [];
      for (const it of g.items) {
        const { tone, height, judged, quiet } = barOf(it.c, state, now);
        counts[quiet ? 'quiet' : tone]++;
        seen.add(it.c.key);
        const b = it.b;
        // one soft flash when it finishes: from work to done
        if (b.tone === 'working' && tone === 'done') { b.el.classList.remove('fresh'); void b.el.offsetWidth; b.el.classList.add('fresh'); }
        if (b.tone !== tone) { b.el.classList.remove(`t-${b.tone}`); b.el.classList.add(`t-${tone}`); b.tone = tone; }
        b.el.classList.toggle('judged', Boolean(judged));
        b.el.classList.toggle('quiet', quiet);
        const pct = `${(height * 100).toFixed(1)}%`;
        if (b.el.style.getPropertyValue('--h') !== pct) b.el.style.setProperty('--h', pct);
        const wait = tone === 'needs' && !quiet ? ago(it.c.since, now) : '';
        if (b.top.textContent !== wait) b.top.textContent = wait;
        const label = `${it.name}: ${judged && tone === 'needs' ? Jev.words(judged.level) : TONE_WORDS[tone]}${quiet ? ', already seen' : ''}, for ${hours(now - it.c.since)}`;
        if (b.el.getAttribute('aria-label') !== label) b.el.setAttribute('aria-label', label);
        barEls.push(b.el);
      }
      let ge = barsBox.querySelector(`.bgroup[data-group="${CSS.escape(g.id)}"]`);
      if (!ge) {
        ge = h('div', { class: 'bgroup', data: { group: g.id } }, h('div', { class: 'bgroup-bars' }), h('div', { class: 'bgroup-line' }), h('div', { class: 'bgroup-name' }));
      }
      ge.className = `bgroup${g.color ? ` ws-${g.color} has-ws` : ''}`;
      const name = `${g.name} · ${g.items.length}`;
      const nameEl = ge.querySelector('.bgroup-name');
      if (nameEl.textContent !== name) nameEl.textContent = name;
      sync(ge.querySelector('.bgroup-bars'), barEls);
      groupEls.push(ge);
    }
    for (const key of bars.keys()) if (!seen.has(key)) bars.delete(key);
    let row = barsBox.querySelector('.bgroups');
    let head = barsBox.querySelector('.sec-head');
    if (!row) {
      head = h('div', { class: 'sec-head' }, h('h3', { text: 'Right now' }), h('span', { class: 'note' }));
      row = h('div', { class: 'bgroups' });
      barsBox.append(head, row, h('div', { class: 'blegend' },
        ['needs', 'done', 'error', 'working', 'idle'].map((t) => h('span', null, h('i', { class: `bl t-${t}` }), TONE_WORDS[t])),
        h('span', { class: 'bl-tall', text: 'taller: longer like that' })));
    }
    const said = [counts.needs && `${counts.needs} wait${counts.needs === 1 ? 's' : ''} for you`, counts.done && `${counts.done} finished`,
      counts.error && `${counts.error} failed`, counts.quiet && `${counts.quiet} waiting, already seen`, counts.working && `${counts.working} working`,
      counts.idle && `${counts.idle} idle`].filter(Boolean).join(' · ');
    const note = head.querySelector('.note');
    if (note.textContent !== said) note.textContent = said;
    sync(row, groupEls);
    barsBox.hidden = !groupEls.length;
  }

  // what every session is doing right now, call by call: it moves all the time, so it is drawn by itself too
  const feedBox = h('section', { class: 'sec block feed-sec' });

  /** The latest tool calls of every session and subagent, newest first, and what the open chats have used so far. */
  function drawFeed(state, now) {
    const alias = new Map(state.chats.filter((c) => c.title).map((c) => [c.id, c.title]));
    const list = [];
    let usd = 0;
    let spoke = 0;
    for (const c of state.snap.chats) {
      if (c.live && c.live.usd > 0) { usd += c.live.usd; spoke++; }
      const who = alias.get(c.chat) || labelOf(c);
      if (c.turn) for (const t of c.turn.tools) list.push({ at: t.at, done: t.done, name: t.name, what: t.what, who, key: c.key });
      for (const a of c.agents ? c.agents.list : []) if (a.doing) list.push({ at: a.doing.at, done: 0, name: a.doing.name, what: a.doing.what, who, sub: a.name, key: c.key });
    }
    const shown = list.filter((x) => now - x.at < FEED_MS).sort((a, b) => b.at - a.at).slice(0, FEED_SHOWN);
    const stamp = JSON.stringify([shown, usd.toFixed(2), spoke, state.snap.chats.length]);
    if (feedBox.dataset.stamp === stamp || (feedBox.dataset.stamp && selectionIn(feedBox))) return;
    feedBox.dataset.stamp = stamp;
    const running = shown.filter((x) => !x.done).length;
    fill(feedBox,
      h('div', { class: 'sec-head' }, h('h3', { text: 'Happening now' }),
        h('span', { class: 'note', text: shown.length ? `the latest tool calls of every session${running ? ` · ${running} running` : ''}` : '' })),
      shown.length ? h('div', { class: 'feed' }, shown.map((x) => h('div', { class: `feed-row${x.done ? '' : ' running'}`, role: 'button', tabindex: '0',
        tip: `${clock(x.at)} · ${x.who}${x.sub ? ` › ${x.sub}` : ''}\n${x.name}${x.what ? ` · ${x.what}` : ''}`,
        onclick: () => act.show(x.key), onkeydown: (e) => { if (e.key === 'Enter') act.show(x.key); } },
      h('span', { class: 'at', text: clockShort(x.at) }),
      h('span', { class: 'who' }, x.who, x.sub && h('i', { text: ` › ${x.sub}` })),
      h('span', { class: 'tool', text: x.name }),
      h('span', { class: 'what', text: x.what }),
      x.done ? h('span', { class: 'len', text: x.done - x.at >= 1000 ? took(x.done - x.at) : '' }) : h('span', { class: 'len', data: { since: x.at } }))))
        : h('p', { class: 'quiet', text: 'No tool was run in the last half hour.' }),
      usd > 0 && h('p', { class: 'cost-line quiet',
        tip: `${dollars(usd)}, added up from what Claude Code itself reckons each open chat has used at list prices since its program started.\n${spoke} of the ${state.snap.chats.length} sessions have said so far: a chat says it when it next answers.\nA subscription does not pay list prices: it is a measure of how much was used.` },
      'The chats open now have used ', h('b', { text: dollarsShort(usd) }), ' at list prices so far.'));
  }

  const seg = (items, on, pick) => h('div', { class: 'seg' }, items.map(([id, name]) => h('button', { class: id === on ? 'on' : '', text: name, onclick: () => pick(id) })));
  const kpi = (value, label, tip) => h('div', { class: 'kpi', tip }, figure(value), h('span', { class: 'k-label', text: label }));
  const panel = (title, note, ...body) => h('section', { class: 'sec block' },
    h('div', { class: 'sec-head' }, h('h3', { text: title }), note && (typeof note === 'string' ? h('span', { class: 'note', text: note }) : note)), ...body);
  const share = (part, color) => h('span', { class: 'share' }, h('i', { style: `width:${Math.max(part > 0 ? 2 : 0, Math.round(part * 100))}%${color ? `;background:${color}` : ''}` }));
  const none = (text) => h('p', { class: 'quiet', text });

  function table(cols, head, lines) {
    const t = h('div', { class: 'table', style: `--cols:${cols}` });
    t.append(h('div', { class: 'tr th' }, head.map((x) => h('span', { text: x }))));
    for (const cells of lines) t.append(h('div', { class: 'tr' }, cells));
    return t;
  }

  const sameDay = (a, b) => new Date(a).toDateString() === new Date(b).toDateString();

  function rangeWords(range) {
    return range === 'today' ? 'today' : range === '7d' ? 'in the last 7 days' : 'in the last 30 days';
  }

  // ---- the accounts: where each one's limits stand, and what was done under each in the range ----
  function accounts(u, v, now, words) {
    const by = new Map((u.who || []).map((w) => [w.key, w]));
    const all = (u.who || []).reduce((n, w) => n + w.out, 0);
    // where the limits of the account in use are heading at the pace of late; once it runs out, the other account
    // with the most room is pointed at (the person does the switching)
    const me = v.me;
    const heads = { five: me && me.five && me.five.until > now ? forecast(me.five, me.pace.five, now) : null, week: me && me.week && me.week.until > now ? forecast(me.week, me.pace.week, now) : null };
    const tight = Boolean(me && ((me.five && me.five.until > now && me.five.used >= 90) || (heads.five && heads.five.full) || (me.week && me.week.until > now && me.week.used >= 90)));
    const best = tight ? Parts.roomiest(v.list, now) : null;
    /** One limit of one account. Of an account at rest only what was last seen is known: a floor ("≥"). */
    const limit = (a, x, kind, pace) => {
      if (!x) return h('div', { class: 'lim-cell none', tip: 'No reading yet. Claude Code hands the usage limits (Pro and Max plans) only to a status line command.\nTurn on Lowlit\'s once: one line in ~/.claude/settings.json, "Usage limits" in the README.\nThey show here after the next message under this account.' }, bar(0), h('span', { class: 'r', text: 'no reading yet' }));
      if (!x.open) {
        return h('div', { class: 'lim-cell fresh', tip: `The last ${kind === 'five' ? '5-hour window' : 'week'} seen for this account ended ${whenOf(x.until)}.\nA new one starts with the first message under it.` },
          bar(0), h('span', { class: 'r' }, h('b', { text: 'fresh' }), ` since ${whenShort(x.until, now)}`));
      }
      const name = `${kind === 'five' ? '5-hour' : 'weekly'} limit`;
      const f = a.here ? heads[kind] : null;
      return h('div', { class: `lim-cell ${x.tone}` },
        h('div', { class: 'lim-now', tip: a.here ? Parts.limitTip(name, x, pace, f) : Parts.restingTip(a, v.names, now) },
          bar(x.used / 100, x.tone, f ? f.at / 100 : 0),
          h('span', { class: 'r' }, h('b', { text: `${a.here ? '' : '≥ '}${Math.round(x.used)}%` }),
            a.here ? [' · resets in ', h('span', { data: { left: x.until } })] : ` · resets ${whenShort(x.until, now)}`)),
        Parts.heading(f, x, name));
    };
    const lines = v.list.map((a) => {
      const w = by.get(a.key);
      const part = w && all ? w.out / all : 0;
      const plan = planName(a.plan);
      return h('div', { class: `tr acct-tr${a.here ? ' here' : ''}`, data: { acct: a.key } },
        h('div', { class: 'acct-who' },
          h('div', { class: 'acct-name', title: a.email || a.key }, h('i', { class: 'swatch', style: `background:${acctColor(a)}` }), h('b', { text: acctName(a, v.names) }),
            plan && h('span', { class: 'chip', text: plan }), a.here && h('span', { class: 'chip here', text: 'in use' }),
            a === best && h('span', { class: 'chip here', text: 'most room', tip: 'The most room of your other accounts, as last seen on this machine.' })),
          h('div', { class: 'acct-when', text: a.here ? (a.from ? `since ${whenOf(a.from)}` : 'in use now') : a.to ? `last used ${dateTime(a.to)}` : 'not seen in use' })),
        limit(a, windowOf(a.five, now), 'five', a.pace.five),
        limit(a, windowOf(a.week, now), 'week', a.pace.week),
        h('div', { class: 'acct-use', tip: w ? `Under this account ${words}:\n${dollars(w.usd)} at list prices\n${whole(w.out)} tokens out · ${whole(w.in + w.cacheWrite)} in · ${whole(w.cacheRead)} re-read from the cache\n${whole(w.replies)} replies · ${hours(w.work)} of agent work` : '' },
          w ? [h('b', { text: dollarsShort(w.usd) }), h('span', { text: ` · ${count(w.out)} out · ${hours(w.work)}` })] : h('span', { class: 'quiet', text: 'nothing' })),
        h('div', { class: 'acct-share' }, share(part, acctColor(a)), h('span', { text: w && all ? `${Math.round(part * 100)}%` : '' })));
    });
    const t = h('div', { class: 'table accts', style: '--cols:minmax(200px,1.5fr) minmax(150px,1fr) minmax(150px,1fr) minmax(180px,1fr) minmax(90px,.6fr)' },
      h('div', { class: 'tr th' }, ['Account', '5-hour limit', 'Weekly limit', u.range === 'today' ? 'Today' : u.range === '7d' ? '7 days' : '30 days', 'Share of tokens out'].map((x) => h('span', { text: x }))),
      lines);
    const lost = by.get(UNKNOWN);
    return panel('Your accounts', 'found on this machine · a figure with "≥" is what was last seen: it may have been used elsewhere since',
      h('div', { class: 'table-box' }, t),
      lost && all > 0 && lost.out > 0 && h('p', { class: 'quiet', tip: 'An account is known from the moment this app first ran, and before that wherever Claude Code left a trace on disk of who was logged in.\nFrom now on every change of account is recorded as it happens.' },
        `${Math.round((lost.out / all) * 100)}% of the tokens written ${words} cannot be tied to an account: nothing on disk says which one was logged in at the time.`));
  }

  function resets(v, now) {
    const next = [];
    const past = [];
    for (const a of v.list) for (const kind of ['five', 'week']) {
      const w = a[kind];
      if (!w || !Number.isFinite(w.used) || !Number.isFinite(w.until) || w.until <= 0) continue;
      if (w.until > now) next.push({ a, kind, w });
      else if (now - w.until <= 86400e3) past.push({ a, kind, w });
    }
    next.sort((a, b) => a.w.until - b.w.until);
    past.sort((a, b) => b.w.until - a.w.until);
    const row = ({ a, kind, w }, ended) => {
      const time = `${sameDay(w.until, now) ? 'today' : new Date(w.until).toLocaleDateString('en-GB', { weekday: 'short' })} ${clockShort(w.until)}`;
      const seen = `${Math.round(w.used)}% when last seen${w.at ? ` (${dateTime(w.at)})` : ''}.`;
      return h('div', { class: `acct-reset-row${ended ? ' acct-reset-past' : ''}`, data: { acct: a.key, limit: kind },
        tip: `${acctName(a, v.names)}\n${seen}\n${ended ? 'Reset' : 'Resets'} ${dateTime(w.until)}.${!a.here ? '\nIt may have been used elsewhere since.' : ''}` },
      h('span', { class: 'acct-reset-name' }, h('span', { text: acctShort(a, v.names) }), a.here && h('span', { class: 'chip here', text: 'in use' })),
      h('span', { text: kind === 'five' ? '5-hour' : 'week' }),
      h('span', { class: 'acct-reset-used', text: `${a.here ? '' : '≥ '}${Math.round(w.used)}%` }),
      h('span', { text: ended ? `Reset at ${clockShort(w.until)}` : time }),
      !ended && h('span', { class: 'acct-reset-left' }, 'in ', h('span', { data: { left: w.until } })));
    };
    return panel('When your limits reset', 'percent used as last seen · other accounts may have been used elsewhere since',
      next.length ? h('div', { class: 'table-box' }, h('div', { class: 'acct-resets' }, next.map((x) => row(x, false)))) : none('No upcoming reset on record.'),
      past.length > 0 && h('h4', { class: 'acct-reset-recent', text: 'In the last 24 hours' }),
      past.length > 0 && h('div', { class: 'table-box' }, h('div', { class: 'acct-resets' }, past.map((x) => row(x, true)))));
  }

  /** Who was logged in when, the last fourteen days, as one band. */
  function ribbon(v, now) {
    const first = new Date(now);
    first.setHours(0, 0, 0, 0);
    first.setDate(first.getDate() - (RIBBON_DAYS - 1));
    const from = first.getTime();
    const by = new Map(v.list.map((a) => [a.key, a]));
    const segs = [];
    for (let i = 0; i < v.marks.length; i++) {
      const s = Math.max(from, v.marks[i].at);
      const e = i + 1 < v.marks.length ? v.marks[i + 1].at : now;
      if (e > s) segs.push({ key: v.marks[i].key, seen: v.marks[i].seen, s, e });
    }
    if (!segs.length) return null;
    if (segs[0].s > from) segs.unshift({ key: '', seen: false, s: from, e: segs[0].s });
    const band = h('div', { class: 'ribbon' }, segs.map((g) => {
      const a = by.get(g.key);
      const who = !g.key ? 'Not known' : a ? acctName(a, v.names) : `Account ${g.key}`;
      const how = !g.key ? 'Nothing on disk says which account was logged in then.'
        : g.seen ? 'Seen by this app as it happened.' : 'Worked out from when /login was typed and from what Claude Code kept on disk.';
      return h('i', { class: `${g.key ? '' : 'unknown'}${g.key && !g.seen ? ' worked-out' : ''}`, style: `flex:${g.e - g.s} 0 0${a ? `;background:${acctColor(a)}` : ''}`,
        tip: `${who}\n${dateTime(g.s)} to ${g.e >= now ? 'now' : dateTime(g.e)} · ${left(g.e - g.s)}\n${how}` });
    }));
    const axis = h('div', { class: 'ribbon-axis' });
    for (let i = 0; i < RIBBON_DAYS; i++) {
      const day = new Date(first.getFullYear(), first.getMonth(), first.getDate() + i);
      axis.append(h('span', { style: `left:${(((day.getTime() - from) / (now - from)) * 100).toFixed(2)}%`,
        text: i % 2 === 0 ? day.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '' }));
    }
    return panel('Which account was logged in', 'the last 14 days · striped: worked out, not seen', band, axis);
  }

  function render(state) {
    const u = state.usage;
    const now = Date.now();
    drawBars(state, now);
    drawRunning(state);
    drawFeed(state, now);
    Shift.dash();
    if (!u || u.range !== state.range) {
      if (drawn !== 'wait') {
        drawn = 'wait';
        fill(wrap, h('div', { class: 'page-head' }, h('div', null, h('h1', { class: 'd-title', text: 'Dashboard' }), h('p', { class: 'd-sum', text: 'Adding it up…' })), seg(RANGES, state.range, act.range)), barsBox, Morning.box, runBox, feedBox, Shift.box);
      }
      Parts.tick(root);
      return;
    }
    const v = Parts.acctView(state);
    const told = (w) => w && [w.used, w.until, Math.floor(w.at / 60e3), w.until > now, w.until >= now - 86400e3];
    // where a limit is heading moves with the clock: a look every five minutes keeps it honest
    const stamp = `${u.at}|${metric.id}|${Math.floor(now / 300e3)}|${JSON.stringify([v.list.map((a) => [a.key, a.here, a.to, told(a.five), told(a.week), a.here && a.pace]), v.names, v.marks.length])}`;
    if (stamp === drawn || selectionIn(root)) { Parts.tick(root); return; }
    drawn = stamp;
    const t = u.total;
    const words = rangeWords(u.range);
    const input = t.in + t.cacheWrite + t.cacheRead;
    const leftOut = u.unpriced && u.unpriced.length ? `\n${count(t.unpriced)} tokens from ${u.unpriced.map(modelName).join(', ')} are left out: the price list has no price for ${u.unpriced.length === 1 ? 'it' : 'them'}.` : '';
    const perHour = t.work > 0 ? t.usd / (t.work / 3600e3) : 0;
    const strip = h('div', { class: 'kpis ten' },
      kpi(dollarsShort(t.usd), 'spent at list prices', `What the replies ${words} would cost at Anthropic's API list prices: ${dollars(t.usd)}.\nA Max plan does not charge this: it measures how much was used.\nClaude Code's own figure for a chat comes out a few percent higher.${leftOut}`),
      kpi(dollarsShort(perHour), 'per hour of agent work', `What one hour of agent work cost ${words}, on average: ${dollars(t.usd)} over ${hours(t.work)} of work.\nSeveral agents at once count several hours.`),
      kpi(count(t.out), 'tokens out', `Written by the models ${words}: ${whole(t.out)} tokens.\n${whole(t.think)} of them (${t.out ? Math.round((t.think / t.out) * 100) : 0}%) spent thinking.`),
      kpi(count(t.in + t.cacheWrite), 'tokens in', `Read by the models as new input ${words}:\n${whole(t.in)} new + ${whole(t.cacheWrite)} written to the cache.`),
      kpi(count(t.cacheRead), 'cache re-read', `Re-read from the cache ${words}: ${whole(t.cacheRead)} tokens.\nThat is ${input ? ((t.cacheRead / input) * 100).toFixed(1) : '0'}% of everything the models were given to read.`),
      kpi(hours(t.work), 'agent work', 'Time your agents spent working, added up over every chat and subagent.\nSeveral at once count several times. Waiting for you does not count.'),
      kpi(whole(t.replies), 'replies', 'Answers the models gave: tool calls and words alike.'),
      kpi(whole(t.asked), 'typed by you', 'Messages you typed into a chat.'),
      kpi(whole(t.tools), 'tool calls', `${whole(u.toolKinds)} different tools.`),
      kpi(whole(t.agents), 'subagents', 'Subagents started by your chats.'));

    // ---- day by day; the tokens written are drawn in the shades of the accounts they were written under ----
    const today = u.days[u.days.length - 1].day;
    const inRange = u.range === 'today' ? 1 : u.range === '7d' ? 7 : 30;
    // tokens out and dollars are split by account; the other measures are not
    const byAcct = metric.id === 'usd' ? 'whoUsd' : 'who';
    const stacked = (metric.id === 'out' || metric.id === 'usd') && v.list.length > 1;
    const days = barChart(u.days.map((d, i) => {
      const who = d[byAcct] || {};
      const say = metric.id === 'usd' ? dollarsShort : count;
      const split = v.list.filter((a) => who[a.key] > 0).map((a) => `${acctName(a, v.names)}: ${say(who[a.key])}`);
      if (who[UNKNOWN] > 0) split.push(`account not known: ${say(who[UNKNOWN])}`);
      return {
        value: metric.get(d),
        mark: d.day === today ? 'now' : i < u.days.length - inRange ? 'dim' : '',
        label: dayLabel(d.day).split(' ').slice(1).join(' '),
        parts: stacked ? [...v.list.map((a) => ({ value: who[a.key] || 0, color: acctColor(a) })), { value: who[UNKNOWN] || 0, color: ACCT_NONE }] : null,
        tip: `${dayLabel(d.day, true)}\n${dollarsShort(d.usd)} at list prices · ${hours(d.work)} of work\n${count(d.out)} tokens out · ${whole(d.replies)} replies · ${whole(d.tools)} tool calls · ${whole(d.asked)} typed\n${count(d.in + d.cacheWrite)} in · ${count(d.cacheRead)} re-read from cache${split.length ? `\n${split.join(' · ')}` : ''}`,
      };
    }), { height: 132, format: metric.format, every: 5 });
    const byDay = panel('Day by day', seg(METRICS.map((m) => [m.id, m.name]), metric.id, (id) => { metric = METRICS.find((m) => m.id === id); render(state); }), days,
      stacked && h('div', { class: 'legend' }, v.list.map((a) => h('span', null, h('i', { class: 'swatch', style: `background:${acctColor(a)}` }), acctName(a, v.names))),
        h('span', null, h('i', { class: 'swatch', style: `background:${ACCT_NONE}` }), 'not known')));

    // ---- hour by hour: yesterday, then today ----
    const nowHour = new Date().getHours();
    const hoursChart = barChart(u.hours.map((x, i) => {
      const hour = i % 24;
      return {
        value: metric.get(x),
        mark: i === 24 + nowHour ? 'now' : i > 24 + nowHour ? 'dim' : '',
        label: hour === 0 ? (i < 24 ? 'yesterday' : 'today') : String(hour).padStart(2, '0'),
        tip: `${i < 24 ? 'Yesterday' : 'Today'}, ${String(hour).padStart(2, '0')}:00 to ${String((hour + 1) % 24).padStart(2, '0')}:00\n${dollarsShort(x.usd)} at list prices · ${hours(x.work)} of work\n${count(x.out)} tokens out · ${whole(x.replies)} replies`,
      };
    }), { height: 96, format: metric.format, every: 6 });
    const byHour = panel('Hour by hour', `yesterday and today · ${metric.name.toLowerCase()}`, hoursChart);

    // ---- today, chat by chat: one cell per hour, the brighter the more its agents worked in it ----
    const lanes = u.lanes || [];
    const where = new Map(state.snap.chats.map((c) => [c.session, c]));
    const byChat = panel('Today, chat by chat', 'one cell per hour · brighter: more agent work', lanes.length
      ? h('div', { class: 'lanes' }, lanes.map((lane) => h('div', { class: `lane${where.has(lane.key) ? ' live' : ''}` },
        h('span', { class: 'name two' }, h('span', { text: lane.title || 'Untitled conversation', title: lane.title }), h('em', { text: lane.name })),
        h('div', { class: 'cells' }, lane.work.map((ms, i) => {
          const on = ms > 0 || lane.out[i] > 0;
          return h('i', { class: `${on ? 'on' : ''}${i > nowHour ? ' ahead' : ''}`, style: on ? `opacity:${(0.22 + 0.78 * Math.min(1, ms / 3600e3)).toFixed(2)}` : null,
            tip: on ? `${String(i).padStart(2, '0')}:00 to ${String((i + 1) % 24).padStart(2, '0')}:00\n${hours(ms)} of agent work · ${dollarsShort((lane.usd || [])[i] || 0)} · ${count(lane.out[i])} tokens out` : null });
        })),
        h('b', { text: hours(lane.sum), tip: `${hours(lane.sum)} of agent work today · ${count(lane.tokens)} tokens out` }),
        h('b', { class: 'lane-usd', text: dollarsShort(lane.spent || 0), tip: `${dollars(lane.spent || 0)} at list prices today` }))),
      h('div', { class: 'lane axis' }, h('span'), h('div', { class: 'cells' }, Array.from({ length: 24 }, (_, i) => h('span', { text: i % 3 === 0 ? String(i).padStart(2, '0') : '' }))), h('span'), h('span')))
      : none('Nothing yet today.'));

    // ---- by project, by model ----
    const topUsd = Math.max(1e-9, ...u.projects.map((p) => p.usd));
    const projects = panel('By project', `${whole(u.active.projects)} active ${words} · the costliest first`, u.projects.length
      ? table('minmax(0,1fr) 84px 72px 64px 72px 60px', ['Project', '', 'Cost', 'Out', 'Work', 'Typed'], u.projects.map((p) => [
        h('span', { class: 'name', text: p.name, title: p.name }), share(p.usd / topUsd),
        h('b', { text: dollarsShort(p.usd), tip: `${dollars(p.usd)} at list prices ${words}` }), h('span', { text: count(p.out) }), h('span', { text: hours(p.work) }), h('span', { text: whole(p.asked) })]))
      : none('Nothing yet.'));
    const allOut = Math.max(1, u.models.reduce((n, m) => n + m.out, 0));
    const models = panel('By model', 'share of the tokens written', u.models.length
      ? table('minmax(72px,1fr) 52px 40px 62px 54px 54px 58px', ['Model', '', '', 'Cost', 'Out', 'In', 'Cached'], u.models.map((m) => [
        h('span', { class: 'name', text: modelName(m.key), title: m.key }), share(m.out / allOut), h('span', { text: `${Math.round((m.out / allOut) * 100)}%` }),
        u.unpriced && u.unpriced.includes(m.key) ? h('span', { class: 'quiet', text: 'no price', tip: 'Not on the price list: its tokens are left out of every cost.' })
          : h('b', { text: dollarsShort(m.usd), tip: `${dollars(m.usd)} at list prices ${words}` }),
        h('span', { text: count(m.out) }), h('span', { text: count(m.in + m.cacheWrite) }), h('span', { text: count(m.cacheRead) })]))
      : none('Nothing yet.'));

    // ---- the costliest conversations, the tools ----
    const busiest = panel('Busiest chats', `${whole(u.active.chats)} active ${words} · the costliest first`, u.chats.length
      ? table('minmax(0,1fr) 72px 64px 72px 84px', ['Chat', 'Cost', 'Out', 'Work', ''], u.chats.map((c) => {
        const live = where.get(c.key);
        const here = live && live.chat && state.chats.some((x) => x.id === live.chat);
        const button = here ? h('button', { class: 'btn sm', text: 'Open', onclick: () => act.open(live.chat) })
          : live ? h('button', { class: 'btn ghost sm', text: 'Show', tip: 'It runs in another terminal: look at it from here', onclick: () => act.show(live.key) })
            : h('button', { class: 'btn ghost sm', text: 'Read', tip: 'Read this conversation in History', onclick: () => act.read(c.key) });
        return [h('span', { class: 'name two' }, h('span', { text: c.title || 'Untitled conversation', title: c.title }), h('em', { text: c.name })),
          h('b', { text: dollarsShort(c.usd), tip: `${dollars(c.usd)} at list prices ${words}` }), h('span', { text: count(c.out) }), h('span', { text: hours(c.work) }), button];
      }))
      : none('Nothing yet.'));
    const topCalls = Math.max(1, ...u.tools.map((x) => x.calls));
    const tools = panel('Tools', `${whole(u.toolKinds)} different ones ${words}`, u.tools.length
      ? table('minmax(0,1fr) 120px 64px', ['Tool', '', 'Calls'], u.tools.map((x) => [
        h('span', { class: 'name mono', text: x.name, title: x.name }), share(x.calls / topCalls), h('b', { text: whole(x.calls) })]))
      : none('No tool was run.'));

    // ---- limits reached, and the rest ----
    const limits = panel('Limits you ran into', 'the last 30 days', u.limits.length
      ? h('div', { class: 'list-lines' }, u.limits.map((l) => h('div', { class: `line${l.until > now ? ' live' : ''}` },
        glyph(l.until > now ? 'needs' : 'idle', 13),
        h('span', { class: 'name', text: limitName(l.type).replace(/^./, (ch) => ch.toUpperCase()) }),
        h('span', { text: `${dateTime(l.at)}${l.until ? ` · ${l.until > now ? 'lifts' : 'lifted'} ${sameDay(l.at, l.until) ? clockShort(l.until) : dateTime(l.until)}` : ''}`,
          tip: `Reached ${dateTime(l.at)}.${l.until ? `\n${l.until > now ? 'Lifts' : 'Lifted'} ${dateTime(l.until)}.` : ''}` }),
        h('span', { class: 'end', text: `${l.chats} chat${l.chats === 1 ? '' : 's'}`, tip: 'How many conversations were turned down by it' }))))
      : none('None. No chat was turned down for a usage limit in the last 30 days.'));
    const r = u.recorded;
    const facts = h('dl', { class: 'plist' });
    const fact = (k, val, tip) => facts.append(h('dt', { text: k }), h('dd', { text: val, tip }));
    fact('Memory compactions', `${whole(t.comp)}${t.comp ? ` · ${hours(t.compMs)} spent compacting` : ''}`, 'Times a chat squeezed its memory to make room, and how long that took in all.');
    fact('Errors from the service', `${whole(t.err)}${t.lim ? ` · ${whole(t.lim)} of them a usage limit` : ''}`, 'Requests the service answered with an error instead of a reply.');
    fact('Thinking', `${count(t.think)} tokens · ${t.out ? Math.round((t.think / t.out) * 100) : 0}% of what was written`, 'Output tokens the models spent reasoning before they answered.');
    fact('One reply, on average', `${dollars(t.replies ? t.usd / t.replies : 0)} at list prices`, `${dollars(t.usd)} over ${whole(t.replies)} replies ${words}.`);
    fact('Web searches and page reads', whole(t.web), 'Searches and page fetches the service ran for your chats.');
    if (r.conversations) {
      fact("Claude Code's own cost notes", `${dollars(r.usd)} at list prices · +${whole(r.added)} / −${whole(r.removed)} lines · ${whole(r.conversations)} chats`,
        'Added up from the cost note Claude Code itself saves into a conversation when its program ends, for the chats of the last 30 days that have one.\nNot every chat has one, and list prices are not what a subscription pays: a floor, not a bill.');
    }
    const rest = panel('Memory, errors and extras', words, facts);

    const rd = u.reading;
    const behind = rd.counting && rd.read < rd.bytes * 0.999;
    const foot = h('p', { class: 'foot-note quiet' },
      behind
        ? `${rd.today === false ? 'Counting today first.' : 'Today is counted.'} Still reading your older history: ${Math.floor((rd.read / Math.max(1, rd.bytes)) * 100)}% of ${(rd.bytes / 1073741824).toFixed(1)} GB (${whole(rd.done)} of ${whole(rd.files)} files). The older days grow until it is done.`
        : `Counted from the ${whole(rd.files)} conversation files (${(rd.bytes / 1073741824).toFixed(1)} GB) Claude Code keeps on this machine. Nothing here asks Anthropic anything.`,
      ' Day-by-day detail goes back 40 days.');

    const at = root.scrollTop;
    fill(wrap,
      h('div', { class: 'page-head' },
        h('div', null, h('h1', { class: 'd-title', text: 'Dashboard' }), h('p', { class: 'd-sum', text: 'What is running now, your accounts, and every Claude Code conversation on this machine, subagents included.' })),
        seg(RANGES, u.range, act.range)),
      barsBox,
      Morning.box,
      runBox,
      feedBox,
      Shift.box,
      v.list.length > 0 && accounts(u, v, now, words),
      v.list.length > 0 && resets(v, now),
      v.list.length > 0 && ribbon(v, now),
      panel(u.range === 'today' ? 'Today' : u.range === '7d' ? 'The last 7 days' : 'The last 30 days', '', strip),
      byDay, byHour, byChat,
      h('div', { class: 'cols2' }, projects, models),
      h('div', { class: 'cols2' }, busiest, tools),
      h('div', { class: 'cols2' }, limits, rest),
      foot);
    root.scrollTop = at;
    Parts.tick(root);
  }

  /** Every second while the Dashboard is in front: the bars grow, the times move on. */
  function tick() {
    drawBars(lastBars, Date.now());
    Parts.tick(root);
  }

  return { init, render, tick, reset: () => { drawn = ''; } };
})();
