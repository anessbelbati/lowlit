'use strict';
/* global desk, h, fill, figure, hours, clockShort, dayLabel, folderOf, barChart */
// The work clock (work.cjs keeps it). In the title bar, at its right end, it counts the work session going on by
// itself: a dot and the time since the session began, dim while the person is on a break, "Away" once a break has
// ended the session. A countdown shows only when the person starts one: a line that empties as its time runs out and
// the time left beside it, yellow in the last half hour, and past the end how far over, in red. The clock keeps one
// width whatever it says, so nothing beside it ever moves. A click opens what can be done with it: a countdown from
// now or the usual shift from when the session began, another length, half an hour more or less, end it now. On the
// Dashboard, the person's day: the time worked and its sessions, the time in each chat, and (from ActivityWatch,
// when it runs) in each program, with the last seven days under it.

const Shift = (() => {
  const LATE_MS = 30 * 60e3;
  const BREAK_MS = 180e3;                // no key or mouse this long: on a break, as main counts the time at the computer
  const LENGTHS = [2, 3, 4, 5, 6, 7, 8];
  const STARTS = [1, 2, 3, 4, 5, 6, 7, 8];
  const FRESH_MS = 60e3;                 // the day is asked for again after this long
  const CHATS_SHOWN = 10;
  const APPS_SHOWN = 10;
  let btn = null;
  let fillEl = null;
  let dotEl = null;
  let timeEl = null;
  let pop = null;
  let act = null;
  let view = null;                       // main's: { on, now, auto, gap, session, shift, offer, next }
  let skew = 0;                          // main's clock less this page's (a test runs main's on a made-up one)
  let day = null;                        // the working day so far, as main last gave it
  let week = null;
  let dayAt = 0;
  let weekAt = 0;
  let asking = false;
  let dashStamp = '';
  let picked = null;                     // a past day clicked on the chart: { key, view }, shown until the Dashboard is left
  let watching = false;
  const box = h('section', { class: 'sec block work-sec', hidden: true });

  const now = () => Date.now() + skew;
  const isOpen = () => Boolean(pop) && !pop.hidden;

  /** How long, as the clock says it: "4h 05m", "35m", "<1m". A minute begun counts, so it says 1m until the end. */
  function span(ms) {
    const m = Math.ceil(Math.max(0, ms) / 60e3);
    if (m < 1) return '<1m';
    if (m < 60) return `${m}m`;
    return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
  }
  /** How long a session has run, as the clock counts up: "<1m", "35m", "4h 05m". Only whole minutes gone count. */
  function ran(ms) {
    const m = Math.floor(Math.max(0, ms) / 60e3);
    if (m < 1) return '<1m';
    if (m < 60) return `${m}m`;
    return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
  }
  const lengthWords = (hrs) => {
    const whole = Math.floor(hrs);
    const m = Math.round((hrs - whole) * 60);
    return m ? `${whole}h ${String(m).padStart(2, '0')}m` : `${whole}h`;
  };
  // a countdown started from the hours chips; a usual shift's goes by the shift's name ("Shift": one kept before)
  const named = (s) => (s.name === 'Countdown' || s.name === 'Shift' ? 'Countdown' : `${s.name} shift`);
  const breakWords = () => `${(view && view.gap) || 15} minutes`;

  function init(button, popEl, actions, first) {
    btn = button;
    pop = popEl;
    act = actions;
    fillEl = h('i');
    dotEl = h('span', { class: 'ts-dot' });
    timeEl = h('span', { class: 'ts-time' });
    btn.append(h('span', { class: 'ts-track' }, fillEl), dotEl, timeEl);
    btn.setAttribute('aria-haspopup', 'dialog');
    btn.setAttribute('aria-expanded', 'false');
    btn.addEventListener('click', () => (isOpen() ? close() : open()));
    document.addEventListener('mousedown', (e) => { if (isOpen() && !pop.contains(e.target) && !btn.contains(e.target)) close(); }, true);
    pop.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      close();
    });
    window.addEventListener('resize', () => { if (isOpen()) place(); });
    setInterval(() => { draw(); if (isOpen()) drawPop(); }, 10e3);
    take(first);
  }

  /** What main says now: the shift running, or the next usual one. */
  function take(v) {
    view = v && typeof v === 'object' ? v : null;
    if (view) skew = view.now - Date.now();
    dayAt = 0;
    weekAt = 0;
    draw();
    if (isOpen()) { drawPop(); load(false); }
  }

  /** The session going on: when it began, how long it has run, and whether the person is on a break. null: none. */
  function session(t) {
    const ses = view && view.session;
    if (!ses) return null;
    const away = t - ses.last >= BREAK_MS;
    return { start: ses.start, last: ses.last, away, ms: (away ? ses.last : t) - ses.start };
  }

  /** Where the clock stands: its tone, the share of the countdown left, its words. null: the clock is off. */
  function stand() {
    if (!view || !view.on) return null;
    const t = now();
    const s = view.shift;
    const ses = session(t);
    const sessionLine = ses ? `\nThis session: ${ran(ses.ms)}, since ${clockShort(ses.start)}.` : '';
    if (s) {
      const left = s.end - t;
      if (left <= 0) {
        return { tone: 'over', part: 0, text: `+${span(-left)}`,
          tip: `${named(s)}: ${span(-left)} past its end (${clockShort(s.end)}). It closes once you have been away ${breakWords()}.${sessionLine}\nClick to end it now, or to give it more time.` };
      }
      return { tone: left <= LATE_MS ? 'late' : 'run', part: left / Math.max(1, s.end - s.start), text: span(left),
        tip: `${named(s)}: ${span(left)} left, until ${clockShort(s.end)}.\n${s.auto ? `It started at ${clockShort(s.start)} by itself, when you sat down.` : `It started at ${clockShort(s.start)}.`}${sessionLine}\nClick to change it.` };
    }
    if (ses && ses.away) {
      return { tone: 'paused', part: 0, text: ran(ses.ms),
        tip: `On a break since ${clockShort(ses.last)}: ${ran(ses.ms)} this session, since ${clockShort(ses.start)}. Back within ${breakWords()} and the break counts as part of it; later, it ends at ${clockShort(ses.last)} and the break is not counted.\nClick to count down to an end.` };
    }
    if (ses) {
      return { tone: 'up', part: 0, text: ran(ses.ms),
        tip: `Working since ${clockShort(ses.start)}: ${ran(ses.ms)} this session. A break of ${breakWords()} ends it, and is not counted.\nClick to count down to an end.` };
    }
    return { tone: 'idle', part: 0, text: 'Away',
      tip: `Away: no key or mouse for ${breakWords()} or more. A new session starts the moment you are back.\nClick to count down to an end.` };
  }

  function draw() {
    if (!btn) return;
    const st = stand();
    btn.hidden = !st;
    if (!st) {
      if (isOpen()) close();
      return;
    }
    btn.className = `tb-shift ${st.tone}${isOpen() ? ' open' : ''}`;
    btn.dataset.tip = st.tip;
    btn.setAttribute('aria-label', st.tip.split('\n')[0]);
    fillEl.style.width = `${(st.part * 100).toFixed(2)}%`;
    if (timeEl.textContent !== st.text) timeEl.textContent = st.text;
  }

  // ---- what opens under it ----
  function open() {
    if (!view || !view.on || isOpen()) return;
    pop.hidden = false;
    btn.classList.add('open');
    btn.setAttribute('aria-expanded', 'true');
    drawPop();
    place();
    load(false);
    const first = pop.querySelector('.sp-chip.on') || pop.querySelector('.sp-offer') || pop.querySelector('.sp-chip');
    if (first) first.focus({ preventScroll: true });
  }
  function close() {
    if (!isOpen()) return;
    pop.hidden = true;
    btn.classList.remove('open');
    btn.setAttribute('aria-expanded', 'false');
    act.done();
  }
  function place() {
    const r = btn.getBoundingClientRect();
    pop.style.top = `${Math.round(r.bottom + 6)}px`;
    pop.style.right = `${Math.max(8, Math.round(window.innerWidth - r.right))}px`;
  }
  async function doIt(what, value) {
    const v = await desk.work(what, value);
    if (v) take(v);
  }

  function drawPop() {
    if (!pop) return;
    const t = now();
    const s = view && view.shift;
    const ses = session(t);
    const kids = [];
    if (s) {
      const left = s.end - t;
      const tone = left <= 0 ? ' over' : left <= LATE_MS ? ' late' : '';
      const length = (s.end - s.start) / 3600e3;
      kids.push(
        h('div', { class: 'sp-head' }, h('span', { class: 'sp-name', text: named(s) }), h('span', { class: 'sp-span', text: `${clockShort(s.start)} → ${clockShort(s.end)}` })),
        h('div', { class: `sp-big${tone}` }, h('b', { text: left > 0 ? span(left) : `+${span(-left)}` }), h('span', { text: left > 0 ? 'left' : 'past its end' })),
        h('span', { class: `sp-track${tone}` }, h('i', { style: `width:${(Math.max(0, left / Math.max(1, s.end - s.start)) * 100).toFixed(1)}%` })),
        h('p', { class: 'sp-note', text: left > 0
          ? (s.auto ? `It started at ${clockShort(s.start)} by itself, when you sat down.` : `It started at ${clockShort(s.start)}.`)
          : `It closes by itself once you have been away ${breakWords()}, at the moment you left.` }),
        h('div', { class: 'sp-label', text: 'How long it lasts today' }),
        h('div', { class: 'sp-chips', style: `--n:${LENGTHS.length}`, role: 'group', 'aria-label': 'How long today\'s shift lasts' }, LENGTHS.map((n) => h('button', {
          class: `sp-chip${Math.abs(length - n) < 0.01 ? ' on' : ''}`, text: `${n}h`, tip: `It ends at ${clockShort(s.start + n * 3600e3)}`, onclick: () => doIt('length', n) }))),
        h('div', { class: 'sp-row' },
          h('button', { class: 'btn sm', text: '− 30m', 'aria-label': 'Half an hour less', onclick: () => doIt('add', -30) }),
          h('button', { class: 'btn sm', text: '+ 30m', 'aria-label': 'Half an hour more', onclick: () => doIt('add', 30) }),
          h('span', { class: 'sp-grow' }),
          h('button', { class: 'btn sm', text: 'End it now', onclick: () => doIt('end') })));
      if (ses) kids.push(h('p', { class: 'sp-line' }, h('span', { class: 'sp-k', text: 'Session' }), h('span', { text: `${ran(ses.ms)} since ${clockShort(ses.start)}${ses.away ? ', on a break' : ''}` })));
    } else {
      const o = view && view.offer;
      kids.push(
        h('div', { class: 'sp-head' }, h('span', { class: 'sp-name', text: !ses ? 'Away' : ses.away ? 'On a break' : 'Work session' }),
          ses ? h('span', { class: 'sp-span', text: `since ${clockShort(ses.start)}` }) : null),
        ses ? h('div', { class: `sp-big${ses.away ? ' paused' : ''}` }, h('b', { text: ran(ses.ms) }), h('span', { text: 'this session' })) : null,
        h('p', { class: 'sp-note', text: !ses ? `No key or mouse for ${breakWords()} or more. A new session starts the moment you are back.`
          : ses.away ? `Since ${clockShort(ses.last)}. Back within ${breakWords()} and the break counts as part of this session; later, it ends at ${clockShort(ses.last)}.`
            : `It started by itself. A break of ${breakWords()} or more ends it at your last touch, so the break is not counted.` }),
        h('div', { class: 'sp-label', text: 'Count down to an end' }),
        o ? h('button', { class: 'btn sm sp-offer', text: `${named(o)} · until ${clockShort(o.end)}`,
          tip: `${lengthWords(o.hours)} from ${clockShort(o.start)}${ses && Math.abs(o.start - ses.start) < 60e3 ? ', when this session began' : ''}`, onclick: () => doIt('usual') }) : null,
        h('div', { class: 'sp-chips', style: `--n:${STARTS.length}`, role: 'group', 'aria-label': 'Count down from now' }, STARTS.map((k) => h('button', {
          class: 'sp-chip', text: `${k}h`, tip: `Until ${clockShort(t + k * 3600e3)}`, onclick: () => doIt('start', k) }))));
    }
    kids.push(h('div', { class: 'sp-label', text: 'Today' }), dayLines(),
      h('div', { class: 'sp-foot' },
        h('button', { class: 'btn ghost sm', text: 'Your day on the Dashboard', onclick: () => { close(); act.dashboard(); } }),
        h('button', { class: 'btn ghost sm', text: 'Clock settings', onclick: () => { close(); act.settings(); } })));
    // the keyboard stays on the button it was on
    const was = pop.contains(document.activeElement) ? document.activeElement.textContent : '';
    fill(pop, h('div', { class: 'sp-box', role: 'dialog', 'aria-label': 'Work clock' }, kids));
    const again = was && [...pop.querySelectorAll('button')].find((b) => b.textContent === was);
    if (again) again.focus({ preventScroll: true });
  }

  /** Today in a few lines: the time worked and its sessions, and what took the most of it. */
  function dayLines() {
    if (!day) return h('p', { class: 'sp-note', text: 'Adding up your day…' });
    const line = (k, items) => items.length > 0 && h('p', { class: 'sp-line' }, h('span', { class: 'sp-k', text: k }), h('span', { text: items.join(' · ') }));
    const n = day.sessions.length;
    return h('div', { class: 'sp-day' },
      h('div', { class: 'sp-figs' }, h('span', null, h('b', { text: hours(day.worked) }), ' worked'), h('span', null, h('b', { text: String(n) }), n === 1 ? ' session' : ' sessions')),
      line('Chats', day.chats.slice(0, 3).map((c) => `${c.title || 'Untitled chat'} ${hours(c.ms)}`)),
      line('Programs', (day.apps || []).slice(0, 4).map((a) => `${a.name} ${hours(a.ms)}`)));
  }

  /** The day from main, and the week while the Dashboard shows it; each asked for again once a minute old. */
  async function load(withWeek) {
    const t = Date.now();
    const wantDay = t - dayAt >= FRESH_MS;
    const wantWeek = withWeek && t - weekAt >= FRESH_MS;
    if (asking || (!wantDay && !wantWeek)) return;
    asking = true;
    try {
      const [d, w] = await Promise.all([wantDay ? desk.work('day') : day, wantWeek ? desk.work('week') : week]);
      if (wantDay) { day = d && typeof d === 'object' ? d : null; dayAt = Date.now(); }
      if (wantWeek) { week = Array.isArray(w) ? w : null; weekAt = Date.now(); }
    } catch {
      // a main from before the clock: there is nothing to show
    }
    asking = false;
    if (isOpen()) drawPop();
    drawDash();
  }

  // ---- the Dashboard: the person's day ----
  /** With every drawing of the Dashboard: what is old is asked for again, and the box is drawn when it changed. */
  function dash() {
    box.hidden = !(view && view.on);
    if (box.hidden) return;
    if (!watching) {
      const page = document.getElementById('stats');
      if (page) {
        watching = true;
        // a day picked on the chart holds while the Dashboard stays open: opened again, it shows today
        new MutationObserver(() => { if (page.hidden) picked = null; }).observe(page, { attributes: true, attributeFilter: ['hidden'] });
      }
    }
    load(true);
    drawDash();
  }

  /** A day of the last seven, clicked on the chart (null: today). */
  async function pick(key) {
    let got = null;
    if (key) {
      try { got = await desk.work('day', key); } catch { got = null; }
    }
    picked = got && typeof got === 'object' ? { key, view: got } : null;
    drawDash();
  }

  const kpi = (value, label, tip) => h('div', { class: 'kpi', tip }, figure(value), h('span', { class: 'k-label', text: label }));
  const share = (part) => h('span', { class: 'share' }, h('i', { style: `width:${Math.max(part > 0 ? 2 : 0, Math.round(part * 100))}%` }));
  const part = (title, note, body) => h('div', { class: 'sec' }, h('div', { class: 'sec-head' }, h('h4', { text: title }), note && h('span', { class: 'note', text: note })), body);
  const none = (text) => h('p', { class: 'quiet', text });
  function table(rows) {
    return h('div', { class: 'table', style: '--cols:minmax(0,1fr) 88px 64px' }, rows.map((cells) => h('div', { class: 'tr' }, cells)));
  }

  /**
   * The working day as one line, 5 in the morning to 5 the next: the work sessions as bands, the time at the computer
   * on them, and the countdowns as a thin line under them.
   */
  function dayLine(d) {
    const len = d.to - d.from;
    const at = (x) => (Math.min(Math.max(x, d.from), d.to) - d.from) / len * 100;
    const pos = (a, b) => `left:${at(a).toFixed(2)}%;width:${Math.max(0.15, at(b) - at(a)).toFixed(2)}%`;
    return h('div', { class: 'wd-day' },
      h('div', { class: 'wd-line' },
        d.sessions.map(([a, b]) => h('i', { class: 'wd-session', style: pos(a, b), tip: `Work session, ${clockShort(a)} to ${clockShort(b)} · ${hours(b - a)}` })),
        d.stretches.map(([a, b]) => h('u', { class: 'wd-here', style: pos(a, b), tip: `At the computer ${clockShort(a)} to ${clockShort(b)} · ${hours(b - a)}` })),
        d.shifts.map((s) => h('s', { class: `wd-count${s.open ? ' open' : ''}`, style: pos(s.start, s.open ? Math.max(s.end, d.now) : s.closed),
          tip: `${named(s)}, ${s.auto ? 'started by itself' : 'started by you'}\n${clockShort(s.start)} to ${s.open ? `${clockShort(s.end)}, running` : `${clockShort(s.closed)} (it was to end at ${clockShort(s.end)})`}` })),
        d.now < d.to && h('b', { class: 'wd-now', style: `left:${at(d.now).toFixed(2)}%` })),
      h('div', { class: 'wd-axis' }, Array.from({ length: 9 }, (_, i) => h('span', { style: `left:${(i * 12.5).toFixed(1)}%`, text: clockShort(d.from + i * 3 * 3600e3) }))));
  }

  function drawDash() {
    if (box.hidden) return;
    const minute = Math.floor(now() / 60e3);
    const stamp = JSON.stringify([day, week, view && view.shift, minute, picked && picked.key]);
    if (stamp === dashStamp) return;
    dashStamp = stamp;
    const head = (note) => h('div', { class: 'sec-head' }, h('h3', { text: 'Your day' }), note && h('span', { class: 'note', text: note }),
      picked && h('button', { class: 'btn ghost sm wd-back', text: 'Back to today', onclick: () => pick(null) }));
    const d = picked ? picked.view : day;
    if (!d) {
      fill(box, head('Adding it up…'));
      return;
    }
    const when = picked ? 'that day' : 'yet today';
    const inChats = d.chats.reduce((n, c) => n + c.ms, 0);
    const note = `${dayLabel(d.key, true)}, from ${clockShort(d.from)} · ${d.by === 'aw' ? 'as ActivityWatch saw it' : 'as Lowlit saw it while it was open'}`;
    const longest = d.sessions.reduce((n, [a, b]) => Math.max(n, b - a), 0);
    const n = d.sessions.length;
    const figs = h('div', { class: 'kpis' },
      kpi(hours(d.worked), 'worked', `From the first touch to the last of each work session: ${hours(d.here)} with a key or the mouse in use, ${hours(Math.max(0, d.worked - d.here))} of short breaks. A break of ${d.gap} minutes or more ends a session and is not counted.`),
      kpi(String(n), n === 1 ? 'session' : 'sessions', n ? d.sessions.map(([a, b]) => `${clockShort(a)} to ${clockShort(b)} · ${hours(b - a)}`).join('\n') : `No session ${when}.`),
      kpi(hours(longest), 'longest session', 'The longest stretch of work without a break that ends a session.'),
      kpi(hours(inChats), 'with a chat in front', 'In this window, while it had the keyboard and you were at the computer.'));
    const topChat = Math.max(1, ...d.chats.map((c) => c.ms));
    const chats = part('In each chat', 'in this window, while you were there', d.chats.length
      ? table(d.chats.slice(0, CHATS_SHOWN).map((c) => [
        h('span', { class: 'name two' }, h('span', { text: c.title || 'Untitled chat', title: c.title }), h('em', { text: folderOf(c.cwd) })), share(c.ms / topChat), h('b', { text: hours(c.ms) })]))
      : none(`No time with a chat in front ${when}.`));
    const apps = d.apps || [];
    const topApp = Math.max(1, ...apps.map((a) => a.ms));
    const programs = part('In each program', d.aw === 'on' ? 'from ActivityWatch, on this computer' : '', apps.length
      ? table(apps.slice(0, APPS_SHOWN).map((a) => [h('span', { class: 'name', text: a.name, title: a.app }), share(a.ms / topApp), h('b', { text: hours(a.ms) })]))
      : none(d.aw === 'off' ? 'ActivityWatch is not read. It can be switched on in Settings, under Work clock.'
        : d.aw === 'missing' ? 'ActivityWatch is not running on this computer, so which programs you used is not known.' : `Nothing ${when}.`));
    const last = week ? week.length - 1 : 0;
    const days = week && week.some((w) => w.worked > 0) && barChart(week.map((w, i) => ({
      value: w.worked,
      mark: i === last ? 'now' : '',
      label: dayLabel(w.key).split(' ')[0],
      parts: [{ value: Math.min(w.chats, w.worked), color: 'var(--text-2)' }, { value: Math.max(0, w.worked - w.chats), color: 'var(--text-4)' }],
      tip: `${dayLabel(w.key, true)}\n${hours(w.worked)} worked in ${w.sessions} session${w.sessions === 1 ? '' : 's'}\n${hours(w.chats)} with a chat in front here\nClick to see ${i === last ? 'today' : 'that day'}.`,
    })), { height: 96, format: hours, every: 1 });
    if (days) {
      days.querySelectorAll('.bar-slot').forEach((slot, i) => {
        const go = () => pick(i === last ? null : week[i].key);
        slot.setAttribute('role', 'button');
        slot.tabIndex = 0;
        slot.setAttribute('aria-label', `See ${dayLabel(week[i].key, true)}`);
        if (picked && picked.key === week[i].key) slot.classList.add('picked');
        slot.addEventListener('click', go);
        slot.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
      });
    }
    const lastDays = days && part('The last 7 days', 'bright: with a chat in front in Lowlit · dim: the rest of your work', days);
    if (lastDays) lastDays.classList.add('wd-week');
    // a day picked from the keyboard keeps the keyboard on its bar
    const focused = box.contains(document.activeElement) ? document.activeElement.getAttribute('aria-label') : '';
    fill(box, head(note), figs, dayLine(d), h('div', { class: 'cols2' }, chats, programs), lastDays);
    const again = focused && [...box.querySelectorAll('.bar-slot')].find((x) => x.getAttribute('aria-label') === focused);
    if (again) again.focus({ preventScroll: true });
  }

  return { init, take, dash, box, isOpen, close, open };
})();
