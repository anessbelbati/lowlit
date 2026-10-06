'use strict';
// The working day (his asks, 4 Oct: "a bar that goes down, the time we have left"; then "the timer should time me
// even when I don't launch it... if I don't use it for 15 minutes straight it should end that session, take the 15
// minutes off, and start another when I come back... it only shows a timer to an end when I specify it").
//
// A work session runs from the first touch of a key or the mouse after a break to the last touch before the next
// break. A break is as long as the person's setting (a quarter of an hour unless changed): shorter ones are part of
// the session; a break that long ends it at the last touch before it, so the break itself is never counted. It needs
// nothing started: the clock in the title bar counts the session up by itself.
//
// A countdown is a stretch the person means to work, and shows only when they ask for one: so many hours from now, or
// their usual shift (Settings) from when this session began. It can be changed at any time: another length, more or
// less time, ended now. Past its end the clock counts how far over; it closes when the session ends, at the last
// touch. Usual shifts can also start their countdown by themselves, when the person switches that on.
//
// And what the day held, kept in Lowlit's own folder (work.json) and never sent anywhere: the stretches at the
// computer (a key or the mouse within three minutes, as ActivityWatch counts it), each countdown, and the time each
// chat was in front while the window had the keyboard and the person was there. Sessions are those stretches joined
// across breaks shorter than the setting. When ActivityWatch runs on this computer (its own address,
// 127.0.0.1:5600) its record gives the stretches, from before Lowlit was open too, and how long each program was
// in front: the questions merge its records by program, so what comes back is program names and times only, never a
// window's title or a web address. A working day runs from 5 in the morning to 5 the next, so a night that ends after
// midnight stays in its evening.

const fs = require('node:fs');
const path = require('node:path');

const TURN_H = 5;                     // the hour a working day begins
const TICK_MS = 15e3;
const AWAY_S = 180;                   // three minutes without a key or the mouse is away, as ActivityWatch counts it
const THERE_S = 60;                   // a usual shift starts once a key or the mouse was touched within the last minute
const GAP_MIN = 15;                   // a break this many minutes long ends a work session, unless the person set another
const GAP_LO = 5;
const GAP_HI = 120;
const EARLY_MS = 60 * 60e3;           // a usual shift starts by itself from an hour before its time
const SLEPT_MS = 4 * TICK_MS;         // a tick this late: the computer slept, or the app was held up or closed
const NOTE_LATE_MS = 10 * 60e3;       // a shift's end is said only this soon after it
const SLIP_MS = 60e3;                 // a shift ended this soon after its start was started by mistake: it is not kept
const SAVE_MS = 60e3;
const DAYS_KEPT = 120;
const CHATS_KEPT = 200;               // chats a day keeps times for
const RAN_KEPT = 40;
const HOURS_MIN = 0.25;
const HOURS_MAX = 14;
const SHIFTS_MAX = 4;
const DEFAULT_SHIFTS = [{ name: 'Morning', at: '06:00', hours: 7 }, { name: 'Night', at: '20:00', hours: 5.5 }];
const AW_URL = 'http://127.0.0.1:5600/api/0/query/';
const AW_TIMEOUT_MS = 5000;
const AW_TODAY_MS = 60e3;             // today's figures from ActivityWatch are asked for again after this long
const AW_PAST_MS = 30 * 60e3;
const APPS_KEPT = 40;
// how a program is called when its file name is not what a person calls it
const APP_NAMES = new Map(Object.entries({
  'chrome.exe': 'Chrome', 'msedge.exe': 'Edge', 'firefox.exe': 'Firefox', 'brave.exe': 'Brave', 'opera.exe': 'Opera', 'code.exe': 'VS Code',
  'cursor.exe': 'Cursor', 'windowsterminal.exe': 'Windows Terminal', 'explorer.exe': 'File Explorer', 'claude.exe': 'Claude', 'spotify.exe': 'Spotify',
  'discord.exe': 'Discord', 'slack.exe': 'Slack', 'whatsapp.exe': 'WhatsApp', 'telegram.exe': 'Telegram', 'obs64.exe': 'OBS', 'figma.exe': 'Figma',
  'notion.exe': 'Notion', 'powershell.exe': 'PowerShell', 'pwsh.exe': 'PowerShell', 'cmd.exe': 'Command Prompt', 'winword.exe': 'Word',
  'excel.exe': 'Excel', 'powerpnt.exe': 'PowerPoint', 'outlook.exe': 'Outlook', 'olk.exe': 'Outlook', 'vlc.exe': 'VLC',
}));
// ActivityWatch's questions. The program times are merged by program before they leave it: after
// merge_events_by_keys an event holds the program's name alone.
const HERE_QUERY = [
  'afk = flood(query_bucket(find_bucket("aw-watcher-afk_")));',
  'RETURN = filter_keyvals(afk, "status", ["not-afk"]);',
];
const DAY_QUERY = [
  'afk = flood(query_bucket(find_bucket("aw-watcher-afk_")));',
  'here = filter_keyvals(afk, "status", ["not-afk"]);',
  'win = filter_period_intersect(flood(query_bucket(find_bucket("aw-watcher-window_"))), here);',
  'RETURN = {"here": here, "apps": sort_by_duration(merge_events_by_keys(win, ["app"]))};',
];

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const pad = (n) => String(n).padStart(2, '0');
const isTime = (v) => typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v);

/** A shift's length in hours, to the quarter hour; 0 for what is not one. */
function hoursOf(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.round(clamp(n, HOURS_MIN, HOURS_MAX) * 4) / 4 : 0;
}
function takeShift(s) {
  if (!s || typeof s !== 'object' || !isTime(s.at)) return null;
  const hours = hoursOf(s.hours);
  if (!hours) return null;
  const name = typeof s.name === 'string' ? s.name.replace(/\s+/g, ' ').trim().slice(0, 20) : '';
  return { name: name || 'Shift', at: s.at, hours };
}
/**
 * The work settings as kept: the clock on or off, ActivityWatch read or not, the minutes of a break that ends a
 * session, whether usual shifts start their countdown by themselves, and up to four usual shifts.
 */
function takeWork(w, was) {
  const base = was || { on: true, aw: true, auto: false, gap: GAP_MIN, shifts: DEFAULT_SHIFTS.map((s) => ({ ...s })) };
  const o = w && typeof w === 'object' ? w : {};
  const gap = Number(o.gap);
  return {
    on: typeof o.on === 'boolean' ? o.on : base.on,
    aw: typeof o.aw === 'boolean' ? o.aw : base.aw,
    auto: typeof o.auto === 'boolean' ? o.auto : Boolean(base.auto),
    gap: Number.isFinite(gap) && gap > 0 ? Math.round(clamp(gap, GAP_LO, GAP_HI)) : Number(base.gap) || GAP_MIN,
    shifts: Array.isArray(o.shifts) ? o.shifts.map(takeShift).filter(Boolean).slice(0, SHIFTS_MAX) : base.shifts.map((s) => ({ ...s })),
  };
}

/** The working day a moment belongs to: the date it began on, at 5 in the morning. */
function dayOf(ms) {
  const d = new Date(ms - TURN_H * 3600e3);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
const dateOf = (key) => key.split('-').map(Number);
/** When a working day begins and when it ends. */
function boundsOf(key) {
  const [y, m, d] = dateOf(key);
  return [new Date(y, m - 1, d, TURN_H).getTime(), new Date(y, m - 1, d + 1, TURN_H).getTime()];
}
/** The working day before or after another. */
function dayFrom(key, n) {
  const [y, m, d] = dateOf(key);
  return dayOf(new Date(y, m - 1, d + n, 12).getTime());
}
/** When a usual shift's time falls on a working day: its hour that day, or after midnight for one before 5. */
function usualOn(key, at) {
  const [y, m, d] = dateOf(key);
  const [hh, mm] = at.split(':').map(Number);
  return new Date(y, m - 1, d + (hh < TURN_H ? 1 : 0), hh, mm).getTime();
}
/** Stretches of time as [from, to], from what ActivityWatch hands back. */
function spansOf(events) {
  return (Array.isArray(events) ? events : []).map((e) => {
    const a = Date.parse(e && e.timestamp);
    return [a, a + (Number(e && e.duration) || 0) * 1000];
  }).filter(([a, b]) => Number.isFinite(a) && b > a).sort((x, y) => x[0] - y[0]);
}
const lengthOf = (spans) => spans.reduce((n, [a, b]) => n + Math.max(0, b - a), 0);
/** Work sessions from stretches at the computer, in order: stretches less than a break apart are one session. */
function sessionsOf(stretches, gap) {
  const out = [];
  for (const [a, b] of stretches) {
    const last = out[out.length - 1];
    if (last && a - last[1] < gap) last[1] = Math.max(last[1], b);
    else out.push([a, b]);
  }
  return out;
}
/** How much of the stretches falls inside the spans. */
function overlap(stretches, spans) {
  let n = 0;
  for (const [a, b] of stretches) for (const [c, d] of spans) n += Math.max(0, Math.min(b, d) - Math.max(a, c));
  return n;
}
function appName(app, own) {
  const low = String(app).toLowerCase();
  if (own && low === own) return 'Lowlit';
  if (APP_NAMES.has(low)) return APP_NAMES.get(low);
  return String(app).replace(/\.exe$/i, '').replace(/-Win64-Shipping$/i, '').replace(/[-_]+/g, ' ').trim() || String(app);
}

/** One question to ActivityWatch on this computer: its answer, or null when it is not running or says no. */
async function askActivityWatch(body) {
  const stop = new AbortController();
  const timer = setTimeout(() => stop.abort(), AW_TIMEOUT_MS);
  try {
    const r = await fetch(AW_URL, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: stop.signal });
    return r.ok ? await r.json() : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

const emptyDay = () => ({ here: [], chats: {}, shifts: [] });

class Work {
  /**
   * cfg: the work settings. idle: seconds since the last key or mouse move anywhere in Windows. focused: this window
   * has the keyboard. front: { key, title, cwd } of the chat in front, or null. own: this program's file name, to
   * call it Lowlit among the programs. changed: the shift changed (the window is told). over: a shift's time is up.
   */
  constructor({ file, cfg, idle, focused, front, own = '', log, changed, over }) {
    this.file = file;
    this.cfg = cfg;
    this.idle = idle;
    this.focused = focused;
    this.front = front;
    this.own = String(own).toLowerCase();
    this.log = log || (() => {});
    this.changed = changed || (() => {});
    this.over = over || (() => {});
    this.now = Date.now;
    this.ask = askActivityWatch;
    this.timer = null;
    this.prev = 0;            // the last tick
    this.there = false;       // the person was there at the last tick
    this.seen = 0;            // when the person was last known to be there
    this.dirty = false;
    this.savedAt = 0;
    this.pending = null;      // a usual shift being started (ActivityWatch is asked when the person sat down)
    this.asking = null;       // ActivityWatch asked when the session that just began really began
    this.waitUntil = 0;       // there since before a usual shift's hours: it is looked at again at its usual time
    this.lately = [];         // the time given to chats in the last few minutes: taken back from the moment the person left
    this.cache = new Map();   // working day -> { at, value }: its figures from ActivityWatch
    this.state = { v: 1, shift: null, session: null, ran: [], days: {}, at: 0, seen: 0 };
  }

  /** How long a break ends a work session, in milliseconds. */
  gapMs() {
    const g = Number((this.cfg() || {}).gap);
    return (Number.isFinite(g) && g > 0 ? g : GAP_MIN) * 60e3;
  }

  load() {
    let kept = null;
    try { kept = JSON.parse(fs.readFileSync(this.file, 'utf8')); } catch { /* the first start */ }
    if (!kept || kept.v !== 1) return;
    const num = (v) => (Number.isFinite(v) ? v : 0);
    const s = kept.shift;
    const shift = s && typeof s === 'object' && num(s.start) > 0 && num(s.end) > num(s.start)
      ? { name: String(s.name || 'Shift').slice(0, 20), at: isTime(s.at) ? s.at : '', start: s.start, end: s.end, auto: Boolean(s.auto), said: Boolean(s.said) } : null;
    const days = {};
    for (const [key, d] of Object.entries(kept.days && typeof kept.days === 'object' ? kept.days : {})) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(key) || !d || typeof d !== 'object') continue;
      const chats = {};
      for (const [k, v] of Object.entries(d.chats && typeof d.chats === 'object' ? d.chats : {})) {
        if (Array.isArray(v) && num(v[0]) > 0) chats[String(k).slice(0, 120)] = [v[0], String(v[1] || '').slice(0, 120), String(v[2] || '').slice(0, 260)];
      }
      days[key] = {
        here: (Array.isArray(d.here) ? d.here : []).filter((x) => Array.isArray(x) && num(x[0]) > 0 && num(x[1]) >= x[0]).map((x) => [x[0], x[1]]),
        chats,
        shifts: (Array.isArray(d.shifts) ? d.shifts : []).filter((x) => x && num(x.start) > 0 && num(x.closed) >= x.start)
          .map((x) => ({ name: String(x.name || 'Shift').slice(0, 20), start: x.start, end: num(x.end) || x.closed, closed: x.closed, auto: Boolean(x.auto) })),
      };
    }
    const ss = kept.session;
    const session = ss && typeof ss === 'object' && num(ss.start) > 0 && num(ss.last) >= ss.start ? { start: ss.start, last: ss.last } : null;
    this.state = { v: 1, shift, session, ran: (Array.isArray(kept.ran) ? kept.ran : []).filter((x) => typeof x === 'string').slice(-RAN_KEPT), days, at: num(kept.at), seen: num(kept.seen) };
    // what came after the last tick kept is not known: the first tick takes it as time away
    this.prev = this.state.at;
    this.seen = this.state.seen;
  }

  save(force) {
    if (!this.dirty && !force) return;
    this.state.at = this.prev;
    this.state.seen = this.seen;
    const keys = Object.keys(this.state.days).sort();
    for (const key of keys.slice(0, Math.max(0, keys.length - DAYS_KEPT))) delete this.state.days[key];
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(`${this.file}.tmp`, JSON.stringify(this.state));
      fs.renameSync(`${this.file}.tmp`, this.file);
      this.dirty = false;
      this.savedAt = this.now();
    } catch (err) {
      this.log(`work: not saved: ${err.message}`);
    }
  }

  start() {
    this.load();
    this.tick();
    this.timer = setInterval(() => this.tick(), TICK_MS);
    if (this.timer.unref) this.timer.unref();
  }

  stop() {
    clearInterval(this.timer);
    this.timer = null;
    this.save(true);
  }

  day(key) {
    if (!this.state.days[key]) this.state.days[key] = emptyDay();
    return this.state.days[key];
  }

  /** One step of the clock. Hands back the start of a usual shift while one is under way (the tests wait for it). */
  tick() {
    const now = this.now();
    const prev = this.prev;
    const wasThere = this.there;
    const wasSeen = this.seen;
    this.prev = now;
    const cfg = this.cfg() || {};
    if (cfg.on === false) { this.there = false; return null; }
    const slept = prev > 0 && now - prev > SLEPT_MS;
    const idle = Math.max(0, Number(this.idle()) || 0);
    const there = idle < AWAY_S;
    const lastInput = now - idle * 1000;
    const day = this.day(dayOf(now));
    const list = day.here;
    const last = list[list.length - 1];
    if (there) {
      // the stretch goes on from the last tick, or a new one starts: when the person came back is not known closer
      // than a tick, or than their last touch after a sleep
      if (last && wasThere && !slept && last[1] >= prev - 1000) last[1] = now;
      else list.push([slept || !prev ? Math.min(now, lastInput) : prev, now]);
      this.seen = now;
      this.dirty = true;
    } else if (wasThere && !slept) {
      // gone: the stretch ended at their last touch, and so did the time given to the chat in front
      if (last && last[1] > lastInput) last[1] = Math.max(last[0], lastInput);
      this.seen = Math.min(this.seen, lastInput);
      for (const x of this.lately) {
        const c = this.state.days[x.key] && this.state.days[x.key].chats[x.chat];
        if (c && x.at > lastInput) c[0] = Math.max(0, c[0] - Math.min(x.s, (x.at - lastInput) / 1000));
      }
      this.lately = [];
      this.dirty = true;
    }
    // the chat in front, while this window has the keyboard and the person is there
    if (there && wasThere && !slept && prev && this.focused()) {
      const f = this.front();
      if (f && f.key) {
        const s = Math.min(now - prev, 2 * TICK_MS) / 1000;
        const kept = day.chats[f.key] || [0, '', ''];
        day.chats[f.key] = [kept[0] + s, String(f.title || kept[1]).slice(0, 120), String(f.cwd || kept[2]).slice(0, 260)];
        this.lately = [...this.lately.filter((x) => x.at > now - (AWAY_S + 2 * TICK_MS / 1000) * 1000), { key: dayOf(now), chat: f.key, at: now, s }];
        const keys = Object.keys(day.chats);
        if (keys.length > CHATS_KEPT) delete day.chats[keys.reduce((a, b) => (day.chats[a][0] <= day.chats[b][0] ? a : b))];
      }
    }
    this.there = there;
    const gap = this.gapMs();
    const waits = [];
    // the work session: touched again only after a break as long as the setting, or away that long now, it ended at
    // the last touch before the break
    let ses = this.state.session;
    if (ses) {
      // Windows counts idle time in whole seconds: the last touch it gives moves by up to one without a touch
      const touched = lastInput > ses.last + 1000;
      if (touched ? lastInput - ses.last >= gap : now - ses.last >= gap) {
        this.state.session = null;
        ses = null;
        this.dirty = true;
        this.changed();
      } else if (touched) {
        ses.last = lastInput;
        this.dirty = true;
      }
    }
    if (!ses && there) {
      // it began after the last tick that did not see the person, or at their last touch after a sleep
      ses = { start: slept || !prev ? Math.min(now, lastInput) : Math.min(prev, lastInput), last: Math.min(now, lastInput) };
      this.state.session = ses;
      this.dirty = true;
      this.changed();
      if (cfg.aw && !this.asking) {
        // ActivityWatch saw the first touch: closer than a tick, or before this window was open
        this.asking = this.awSince(now, gap).then((aw) => {
          if (aw && this.state.session === ses && aw <= ses.last && aw !== ses.start) {
            ses.start = aw;
            this.dirty = true;
            this.changed();
          }
        }).finally(() => { this.asking = null; });
        waits.push(this.asking);
      }
    }
    const s = this.state.shift;
    if (s && now >= s.end) {
      if (!s.said) {
        s.said = true;
        this.dirty = true;
        // said as it happens; an end long past (the computer slept through it) is not said late
        if (now - s.end < NOTE_LATE_MS) this.over({ ...s });
      }
      // past its end it goes on while the person works on: once they have been away as long as a break that ends a
      // session (a sleep counts as away), it closes at the moment they left, and never before its end
      const gone = slept ? wasSeen : there ? 0 : this.seen;
      if (gone && now - gone >= gap) this.close(Math.max(s.end, Math.min(gone, now)));
      else {
        // worked on past its end into the time of the next usual shift: it ends where that one begins
        const u = this.usualNow(now);
        if (u && now >= u.usual && u.usual >= s.start) this.close(Math.max(s.end, u.usual));
      }
    }
    if (cfg.auto && !this.state.shift && there && idle < THERE_S && !this.pending && now >= this.waitUntil) {
      const usual = this.usualNow(now);
      if (usual) {
        this.pending = this.startUsual(usual, now).finally(() => { this.pending = null; });
        waits.push(this.pending);
      }
    }
    if (this.dirty && now - this.savedAt >= SAVE_MS) this.save();
    return waits.length ? Promise.all(waits) : null;
  }

  /** The usual shift whose hours hold this moment and that has not run on its working day yet. */
  usualNow(now) {
    const cfg = this.cfg() || {};
    for (const key of [...new Set([dayOf(now), dayOf(now + EARLY_MS)])]) {
      for (const u of cfg.shifts || []) {
        const usual = usualOn(key, u.at);
        if (now >= usual - EARLY_MS && now < usual + u.hours * 3600e3 && !this.state.ran.includes(`${key}|${u.at}`)) return { ...u, key, usual };
      }
    }
    return null;
  }

  /** The next usual shift that has not run: today's still to come, or tomorrow's first. */
  nextUsual(now) {
    const cfg = this.cfg() || {};
    let best = null;
    for (const key of [dayOf(now), dayFrom(dayOf(now), 1)]) {
      for (const u of cfg.shifts || []) {
        const usual = usualOn(key, u.at);
        if (usual + u.hours * 3600e3 <= now || this.state.ran.includes(`${key}|${u.at}`)) continue;
        if (!best || usual < best.usual) best = { name: u.name, at: u.at, hours: u.hours, usual, from: usual - EARLY_MS };
      }
    }
    return best;
  }

  /**
   * The person is at the computer in the hours of a usual shift. Sat down in its hours (from an hour before its
   * time), it starts when they sat down; there since before (up all night, or at work since the afternoon), it
   * starts at its usual time and not a moment before.
   */
  async startUsual(u, now) {
    let since = this.hereSince(now);
    const aw = (this.cfg() || {}).aw ? await this.awSince(now) : 0;
    if (aw && aw < since) since = aw;
    if (this.state.shift) return;
    const start = since >= u.usual - EARLY_MS ? since : u.usual;
    if (start > now) {
      this.waitUntil = u.usual;
      return;
    }
    this.begin({ name: u.name, at: u.at, key: u.key, start, hours: u.hours, auto: true });
  }

  /** When the stretch at the computer going on now began, across the turn of the working day at 5. */
  hereSince(now) {
    let since = now;
    let key = dayOf(now);
    for (let i = 0; i < 2; i++) {
      const list = (this.state.days[key] || emptyDay()).here;
      for (let j = list.length - 1; j >= 0; j--) {
        const [a, b] = list[j];
        if (b < since - TICK_MS - 1000) return since;
        since = Math.min(since, a);
      }
      key = dayFrom(key, -1);
    }
    return since;
  }

  begin({ name, at = '', key, start, hours, auto }) {
    this.state.shift = { name, at, start, end: start + hours * 3600e3, auto: Boolean(auto), said: false };
    if (at) this.state.ran = [...this.state.ran.filter((x) => x !== `${key}|${at}`), `${key}|${at}`].slice(-RAN_KEPT);
    this.dirty = true;
    this.save(true);
    this.changed();
  }

  close(at) {
    const s = this.state.shift;
    if (!s) return;
    const closed = Math.max(s.start, at);
    if (closed - s.start >= SLIP_MS) this.day(dayOf(s.start)).shifts.push({ name: s.name, start: s.start, end: s.end, closed, auto: s.auto });
    this.state.shift = null;
    this.dirty = true;
    this.save(true);
    this.changed();
  }

  /**
   * What the person does with the clock: ('start', hours) starts a shift now, as the usual one whose hours these are;
   * ('length', hours) gives the shift running that length from its start; ('add', minutes) more or less time;
   * ('end') ends it now. Hands back what the window shows.
   */
  act(what, value) {
    const now = this.now();
    const s = this.state.shift;
    if (what === 'start') {
      const hours = hoursOf(value);
      if (!hours) return this.view();
      if (s) this.close(now);
      const u = this.usualNow(now);
      this.begin({ name: u ? u.name : 'Countdown', at: u ? u.at : '', key: u ? u.key : '', start: now, hours, auto: false });
      return this.view();
    }
    if (what === 'usual') {
      const o = s ? null : this.offerNow(now);
      if (o) this.begin({ name: o.name, at: o.at, key: o.key, start: o.start, hours: o.hours, auto: false });
      return this.view();
    }
    if (!s) return this.view();
    if (what === 'end') {
      this.close(now);
      return this.view();
    }
    if (what === 'length') {
      const hours = hoursOf(value);
      if (!hours) return this.view();
      s.end = s.start + hours * 3600e3;
    } else if (what === 'add') {
      const minutes = Number(value);
      if (!Number.isFinite(minutes) || Math.abs(minutes) > 12 * 60) return this.view();
      s.end = Math.max(s.start + HOURS_MIN * 3600e3, s.end + minutes * 60e3);
    } else {
      return this.view();
    }
    // its end moved past now again: the note comes at the new end
    if (s.end > now) s.said = false;
    this.dirty = true;
    this.save(true);
    this.changed();
    return this.view();
  }

  /**
   * The usual shift whose hours hold this moment, offered as a countdown started with one click: from when this
   * session began (or from its usual time, for a session begun before its hours), with its usual length. null: none,
   * or one that would already be over.
   */
  offerNow(now) {
    const u = this.usualNow(now);
    if (!u) return null;
    const since = this.state.session ? this.state.session.start : now;
    const start = Math.min(now, since >= u.usual - EARLY_MS ? since : u.usual);
    const end = start + u.hours * 3600e3;
    return end > now ? { name: u.name, at: u.at, key: u.key, hours: u.hours, start, end } : null;
  }

  /** What the window shows: the session going on, the countdown running, the usual shift on offer, the next one. */
  view() {
    const now = this.now();
    const cfg = this.cfg() || {};
    const s = this.state.shift;
    const ses = this.state.session;
    const o = s ? null : this.offerNow(now);
    return {
      on: cfg.on !== false, now, auto: Boolean(cfg.auto), gap: this.gapMs() / 60e3,
      session: ses ? { start: ses.start, last: ses.last } : null,
      shift: s ? { name: s.name, start: s.start, end: s.end, auto: s.auto } : null,
      offer: o ? { name: o.name, hours: o.hours, start: o.start, end: o.end } : null,
      next: s ? null : this.nextUsual(now),
    };
  }

  /**
   * When the stretch at the computer that holds this moment began, as ActivityWatch has it, across gaps shorter than
   * `gap` (a minute: the stretch itself; a break that ends a session: the session); 0 when it cannot say.
   */
  async awSince(now, gap = 60e3) {
    const answer = await this.ask({ timeperiods: [`${new Date(now - 16 * 3600e3).toISOString()}/${new Date(now + 60e3).toISOString()}`], query: HERE_QUERY });
    const spans = spansOf(Array.isArray(answer) ? answer[0] : null);
    let since = 0;
    for (let i = spans.length - 1; i >= 0; i--) {
      const [a, b] = spans[i];
      if (!since) {
        if (b < now - 90e3) break;
        since = a;
      } else if (b >= since - gap) since = Math.min(since, a);
      else break;
    }
    return since;
  }

  /** A working day as ActivityWatch has it: the stretches at the computer and each program's time. null: not running. */
  async awDay(key, from, to) {
    const today = key === dayOf(this.now());
    const kept = this.cache.get(key);
    if (kept && this.now() - kept.at < (today ? AW_TODAY_MS : AW_PAST_MS)) return kept.value;
    const answer = await this.ask({ timeperiods: [`${new Date(from).toISOString()}/${new Date(to).toISOString()}`], query: DAY_QUERY });
    const got = Array.isArray(answer) && answer[0] && typeof answer[0] === 'object' ? answer[0] : null;
    const value = got ? {
      here: spansOf(got.here).map(([a, b]) => [Math.max(a, from), Math.min(b, to)]).filter(([a, b]) => b > a),
      // a program's name and its time: whatever else an event might hold is never kept
      apps: (Array.isArray(got.apps) ? got.apps : []).map((e) => ({ app: String(e && e.data && e.data.app || '').slice(0, 80), s: Number(e && e.duration) || 0 }))
        .filter((x) => x.app && x.s >= 1).slice(0, APPS_KEPT).map((x) => ({ ...x, name: appName(x.app, this.own) })),
    } : null;
    this.cache.set(key, { at: this.now(), value });
    if (this.cache.size > 20) this.cache.delete(this.cache.keys().next().value);
    return value;
  }

  /** The shifts of a working day, the one running included (it counts up to now, or to its end once past). */
  shiftsOf(key, now) {
    const d = this.state.days[key] || emptyDay();
    const list = d.shifts.map((x) => ({ ...x, open: false }));
    const s = this.state.shift;
    if (s && dayOf(s.start) === key) list.push({ name: s.name, start: s.start, end: s.end, closed: 0, auto: s.auto, open: true });
    return list.map((x) => ({ ...x, until: x.open ? now : x.closed }));
  }

  /** A working day for the Dashboard: when the person was at the computer, their shifts, their chats, their programs. */
  async dayView(key = dayOf(this.now())) {
    const now = this.now();
    const [from, to] = boundsOf(key);
    const cfg = this.cfg() || {};
    const d = this.state.days[key] || emptyDay();
    const aw = cfg.aw && from < now ? await this.awDay(key, from, Math.min(to, now)) : null;
    const own = d.here.map(([a, b]) => [a, Math.min(b, now)]).filter(([a, b]) => b > a);
    const stretches = aw ? aw.here : own;
    const sessions = sessionsOf(stretches, this.gapMs());
    const shifts = this.shiftsOf(key, now);
    const spans = shifts.map((x) => [x.start, x.until]);
    return {
      key, from, to, now, by: aw ? 'aw' : 'app', aw: !cfg.aw ? 'off' : aw ? 'on' : 'missing', gap: this.gapMs() / 60e3,
      stretches, here: lengthOf(stretches), sessions, worked: lengthOf(sessions), inShift: overlap(stretches, spans), shifts,
      chats: Object.entries(d.chats).map(([k, v]) => ({ key: k, ms: v[0] * 1000, title: v[1], cwd: v[2] })).sort((a, b) => b.ms - a.ms),
      apps: aw ? aw.apps.map((x) => ({ app: x.app, name: x.name, ms: x.s * 1000 })) : null,
    };
  }

  /** The last seven working days, today last: the time worked, at the computer, in countdowns and in chats. */
  async weekView() {
    const now = this.now();
    const today = dayOf(now);
    const keys = Array.from({ length: 7 }, (_, i) => dayFrom(today, i - 6));
    const cfg = this.cfg() || {};
    const bounds = keys.map(boundsOf);
    let aw = null;
    if (cfg.aw) {
      const answer = await this.ask({ timeperiods: bounds.map(([a, b]) => `${new Date(a).toISOString()}/${new Date(Math.min(b, now + 60e3)).toISOString()}`), query: HERE_QUERY });
      if (Array.isArray(answer) && answer.length === keys.length) aw = answer.map(spansOf);
    }
    return keys.map((key, i) => {
      const d = this.state.days[key] || emptyDay();
      const [from, to] = bounds[i];
      const stretches = aw ? aw[i].map(([a, b]) => [Math.max(a, from), Math.min(b, to, now)]).filter(([a, b]) => b > a)
        : d.here.map(([a, b]) => [a, Math.min(b, now)]).filter(([a, b]) => b > a);
      const spans = this.shiftsOf(key, now).map((x) => [x.start, x.until]);
      const sessions = sessionsOf(stretches, this.gapMs());
      return { key, here: lengthOf(stretches), worked: lengthOf(sessions), sessions: sessions.length, inShift: overlap(stretches, spans),
        chats: Object.values(d.chats).reduce((n, v) => n + v[0] * 1000, 0) };
    });
  }
}

module.exports = { Work, takeWork, dayOf, boundsOf, appName, DEFAULT_SHIFTS, TICK_MS };
