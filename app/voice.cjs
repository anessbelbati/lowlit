'use strict';
// The voice: Lowlit reads out loud the whole briefing of a chat the person picked (its right-click menu, "Read it out
// when it finishes") each time it finishes a turn, and the chats' briefings when asked (the talk key, then "mise au
// point", a project's name, "stop", "again", "go to" and a project). The chats write those briefings themselves, through
// the door (browser-mcp.cjs, voice_brief): no model is asked here. ElevenLabs makes the speech and hears the person's
// words. Off until switched on in Settings with an ElevenLabs key of the person's own, locked with Windows' own
// encryption for this user (Electron safeStorage): never written to a log, never handed to the page and never shown
// again. What goes out: the words to be said and what the microphone heard after a press of the talk key. A short line
// said again and again ("I did not catch that.") is made once and kept on this computer.

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const API = 'https://api.elevenlabs.io';
const MODEL = 'eleven_v4_turbo';          // ElevenLabs' fastest speech, about 100 ms to the first sound (its models page, 9 Oct 2026)
const HEARING = 'scribe_v2';
const VOICE = 'JBFqnCBsd6RMkjVDRZzb';      // the voice of ElevenLabs' own examples, in every account, until one is picked
const FORMAT = 'mp3_44100_128';
const TIMEOUT_MS = 20000;
const FIRST = 200;                          // letters of the first piece of a briefing: its first sound comes after it
const PIECE = 320;                          // letters of each piece after it
const CAP = 15;                             // dollars a month at ElevenLabs' list price; past it only lines kept are said
const PER_LETTER = 0.04 / 1000;             // v4 Turbo (elevenlabs.io/pricing/api, 9 Oct 2026)
const PER_SECOND = 0.22 / 3600;             // Scribe v2, the same page
const KEPT = 80;                            // briefings kept, the newest first
const FOLLOW_MAX = 100;                     // chats the person picked to hear when they finish, the newest first
const DONE_MAX = 8;                         // finished chats said by their line in a mise au point of everything
const CLIPS_MAX = 400;                      // lines kept on disk; the oldest go first
const LINE_MAX = 240;
const BRIEF_MAX = 2000;
const ASKS_MAX = 500;
const NAME_MAX = 40;
const OLD_MS = 30 * 60e3;                   // a briefing older than this is said with its age

const monthOf = (at) => { const d = new Date(at); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };
const round = (n, places) => Math.round(n * 10 ** places) / 10 ** places;
/** Words fit to be read out: no markdown signs, one space between words, cut at a word under max letters. */
function spoken(text, max) {
  let t = String(text || '').replace(/```[\s\S]*?```/g, ' ').replace(/[`*_#>|~]+/g, ' ').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/\s+/g, ' ').trim();
  if (t.length > max) { t = t.slice(0, max); const cut = t.lastIndexOf(' '); if (cut > max * 0.6) t = t.slice(0, cut); t = `${t.replace(/[,;:]$/, '')}…`; }
  return t;
}
/** A name as heard and as kept, made comparable: lower case, no accents, letters and digits only. */
const plain = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
/** A folder's name as said: "made-up_shop" is "made up shop". */
const sayFolder = (cwd) => String(cwd || '').split(/[\\/]/).filter(Boolean).pop()?.replace(/[-_.]+/g, ' ').trim() || 'A chat';
function distance(a, b) {
  if (Math.abs(a.length - b.length) > 2) return 3;
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const was = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = was;
    }
  }
  return row[b.length];
}
// words of a request, never taken for a project's name said a little wrong ("point" is no project called "paint")
const COMMON = new Set(('mise au point the a an me tell about what whats where how is are and of on in to go open stop again repeat status update '
  + 'brief briefing project projects everything all done doing need needs you it its this that please give say with chat chats '
  + 'tout le la les de du des sur va ouvre encore quoi ou en est et dis moi avec pour projet fait').split(' '));
/** How well heard words name a project: 3 said as it is, 2 said in one word or in two, 1 each long word nearly, 0 not. */
function named(heard, name) {
  const h = plain(heard);
  const n = plain(name);
  if (!h || !n) return 0;
  if (` ${h} `.includes(` ${n} `)) return 3;
  const words = h.split(' ');
  const whole = n.replace(/ /g, '');
  if (whole.length >= 4) {
    for (let i = 0; i < words.length; i++) {
      for (let len = 1; len <= 3 && i + len <= words.length; len++) if (words.slice(i, i + len).join('') === whole) return 2;
    }
  }
  const long = n.split(' ').filter((w) => w.length >= 4);
  const heardWords = words.filter((x) => !COMMON.has(x));
  if (long.length && long.every((w) => heardWords.some((x) => distance(x, w) <= (w.length >= 7 ? 2 : 1)))) return 1;
  return 0;
}

// What the person may say after the talk key, in English or French. Anything else asks for a mise au point: of the
// project named in it, or of everything.
const SAYS = [
  ['stop', /\b(stop|enough|shut up|quiet|arrete|tais toi|chut|ca suffit|silence)\b/],
  ['again', /\b(again|repeat|say that again|repete|encore|redis)\b/],
  ['go', /\b(go to|open|take me to|va sur|va a|ouvre)\b/],
];

/**
 * What the person asked for, from the words heard: { what: 'stop'|'again'|'go'|'brief', project }
 * where project is the name (as kept) of the project named, or ''. projects: the names there are now.
 */
function understand(text, projects) {
  const h = plain(text);
  let project = '';
  let best = 0;
  for (const p of projects) {
    const s = named(h, p);
    if (s > best || (s === best && s > 0 && p.length > project.length)) { best = s; project = p; }
  }
  for (const [what, re] of SAYS) {
    if (!re.test(h)) continue;
    if (what === 'go' && !project) continue;
    // "stop" said with a project's name in a longer request ("stop and tell me about Atlas") is a request
    if (what === 'stop' && project && h.split(' ').length > 3) continue;
    return { what, project };
  }
  return { what: 'brief', project };
}

/**
 * file: where the switch, the locked key, the month's tally and the briefings are kept. dir: where the lines made
 * once are kept. safe: Electron's safeStorage. net(url, { method, headers, body, ms }) -> { status, buffer, json }: how
 * a request goes out (a made-up one in a test run). hide: the search index's own hiding of secrets, for the words a
 * chat hands over. log: a line for the app's log, never with the key or the words said.
 */
function create({ file, dir, safe, net, hide = (t) => t, log = () => {}, now = Date.now }) {
  let kept = { on: false, key: '', voice: VOICE, voiceName: '', follow: [], cap: CAP, months: {}, briefs: [] };
  try {
    const j = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (j && typeof j === 'object') kept = { ...kept, ...j };
  } catch { /* first run */ }
  kept.on = kept.on === true;
  kept.key = typeof kept.key === 'string' ? kept.key : '';
  kept.voice = typeof kept.voice === 'string' && /^[A-Za-z0-9]{8,40}$/.test(kept.voice) ? kept.voice : VOICE;
  kept.voiceName = typeof kept.voiceName === 'string' ? kept.voiceName.slice(0, 60) : '';
  kept.follow = Array.isArray(kept.follow) ? kept.follow.filter((k) => typeof k === 'string' && k && k.length <= 80).slice(0, FOLLOW_MAX) : [];
  delete kept.tell;
  kept.cap = Number.isFinite(kept.cap) && kept.cap > 0 && kept.cap <= 200 ? kept.cap : CAP;
  kept.months = kept.months && typeof kept.months === 'object' && !Array.isArray(kept.months) ? kept.months : {};
  kept.briefs = Array.isArray(kept.briefs) ? kept.briefs.filter((b) => b && typeof b === 'object' && typeof b.brief === 'string' && Number.isFinite(b.at)).slice(0, KEPT) : [];
  let lastError = '';
  let cached = '';
  let planNow = null;
  let saveTimer = null;
  const listeners = new Set();

  function write() {
    clearTimeout(saveTimer);
    saveTimer = null;
    try {
      fs.writeFileSync(`${file}.tmp`, JSON.stringify(kept));
      fs.renameSync(`${file}.tmp`, file);
    } catch (err) { log(`voice: not saved (${err.code || 'error'})`); }
  }
  const save = () => { if (!saveTimer) saveTimer = setTimeout(write, 300); };
  const told = () => { for (const fn of listeners) fn(); };
  function month() {
    const m = monthOf(now());
    if (!kept.months[m] || typeof kept.months[m] !== 'object') kept.months[m] = { spent: 0, letters: 0, seconds: 0 };
    return kept.months[m];
  }
  function tally(letters, seconds) {
    const m = month();
    m.letters = (m.letters || 0) + letters;
    m.seconds = (m.seconds || 0) + seconds;
    m.spent = (m.spent || 0) + letters * PER_LETTER + seconds * PER_SECOND;
    save();
  }
  const locked = () => { try { return Boolean(safe && safe.isEncryptionAvailable()); } catch { return false; } };
  function keyText() {
    if (cached) return cached;
    if (!kept.key || !locked()) return '';
    try { cached = safe.decryptString(Buffer.from(kept.key, 'base64')); } catch { cached = ''; }
    return cached;
  }
  const ready = () => kept.on && Boolean(kept.key);
  const full = () => month().spent >= kept.cap;
  const notReady = () => new Error(kept.on ? 'Paste your ElevenLabs key in Settings > Voice first.' : 'The voice is off.');

  /** What the window may know: never the key itself, never the words of a briefing. */
  function view() {
    const m = month();
    return { on: kept.on, hasKey: Boolean(kept.key), locked: locked(), voice: kept.voice, voiceName: kept.voiceName, follow: kept.follow.slice(), cap: kept.cap,
      spent: round(m.spent || 0, 4), letters: m.letters || 0, seconds: Math.round(m.seconds || 0), month: monthOf(now()), full: full(),
      lastError, plan: planNow, briefs: kept.briefs.length, newest: kept.briefs.length ? kept.briefs[0].at : 0 };
  }

  /** What went wrong with a request, as the person would want it said. */
  function failed(res, what) {
    const detail = res && res.json && res.json.detail;
    const status = res ? res.status : 0;
    lastError = detail && detail.status === 'quota_exceeded' ? 'Your ElevenLabs plan has no characters left this month.'
      : status === 401 ? 'ElevenLabs turned the key down.' : status === 402 ? 'Your ElevenLabs plan has no characters left this month.'
        : status === 429 ? 'ElevenLabs asked to slow down.' : `ElevenLabs answered ${what} with an error (${status}).`;
    log(`voice: ${what}: answered ${status}`);
    told();
    return new Error(lastError);
  }
  async function send(url, opts, what) {
    try {
      return await net(url, { ms: TIMEOUT_MS, ...opts });
    } catch (err) {
      lastError = err && (err.name === 'TimeoutError' || err.name === 'AbortError') ? 'ElevenLabs did not answer within 20 seconds.' : 'ElevenLabs could not be reached.';
      log(`voice: ${what}: ${lastError}`);
      told();
      throw new Error(lastError);
    }
  }
  function theKey() {
    const key = keyText();
    if (!key) { lastError = 'The key could not be read back. Paste it again in Settings.'; told(); throw new Error(lastError); }
    return key;
  }

  /** Speech for some words: mp3 bytes. prev, next: the words said before and after, so the pieces sound as one. */
  async function speech(text, prev = '', next = '') {
    if (!ready()) throw notReady();
    if (full()) throw new Error(`This month's $${kept.cap} is used up.`);
    const key = theKey();
    const body = { text, model_id: MODEL, ...(prev ? { previous_text: prev } : {}), ...(next ? { next_text: next } : {}) };
    const res = await send(`${API}/v1/text-to-speech/${encodeURIComponent(kept.voice)}?output_format=${FORMAT}`,
      { method: 'POST', headers: { 'xi-api-key': key, 'Content-Type': 'application/json', Accept: 'audio/mpeg' }, body: JSON.stringify(body) }, 'speech');
    if (res.status !== 200 || !res.buffer || !res.buffer.length) throw failed(res, 'speech');
    tally(text.length, 0);
    if (lastError) { lastError = ''; told(); }
    return res.buffer;
  }

  const clipFile = (text) => path.join(dir, `${crypto.createHash('sha1').update(`${kept.voice}|${MODEL}|${text}`).digest('hex').slice(0, 24)}.mp3`);
  function prune() {
    try {
      const files = fs.readdirSync(dir).filter((f) => f.endsWith('.mp3')).map((f) => ({ f, at: fs.statSync(path.join(dir, f)).mtimeMs }));
      if (files.length <= CLIPS_MAX) return;
      files.sort((a, b) => a.at - b.at);
      for (const x of files.slice(0, files.length - CLIPS_MAX)) fs.rmSync(path.join(dir, x.f), { force: true });
    } catch { /* kept as they are */ }
  }
  /** A short line said often: from this computer when it was made before, else made once and kept. null: none. */
  async function clip(text) {
    const f = clipFile(text);
    try { return fs.readFileSync(f); } catch { /* made below */ }
    if (!ready() || full()) return null;
    const audio = await speech(text);
    try {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(f, audio);
      prune();
    } catch (err) { log(`voice: a line was not kept (${err.code || 'error'})`); }
    return audio;
  }

  /** Words cut into pieces of whole sentences: a short first one, so the first sound comes soon. */
  function pieces(text) {
    const words = String(text || '').replace(/\s+/g, ' ').trim();
    if (!words) return [];
    const out = [];
    let cur = '';
    const room = () => (out.length ? PIECE : FIRST);
    // a sentence ends at a stop followed by a space: "1.2" stays whole
    for (let s of words.split(/(?<=[.!?…]["')\]]*) /)) {
      if (cur && cur.length + 1 + s.length > room()) { out.push(cur); cur = ''; }
      while (!cur && s.length > room()) {
        const at = s.lastIndexOf(' ', room());
        const cut = at > room() * 0.4 ? at : room();
        out.push(s.slice(0, cut).trim());
        s = s.slice(cut).trim();
      }
      cur = cur ? `${cur} ${s}` : s;
    }
    if (cur) out.push(cur);
    return out;
  }
  /**
   * Says some words, piece after piece: each piece's speech is handed to onPiece(audio, words) as soon as it is
   * made, while the next is being made. stopped(): the person said stop meanwhile. false: not all of it was said.
   */
  async function say(text, onPiece, stopped = () => false) {
    const list = pieces(text);
    for (let i = 0; i < list.length; i++) {
      if (stopped()) return false;
      const audio = await speech(list[i], list.slice(Math.max(0, i - 2), i).join(' ').slice(-400), (list[i + 1] || '').slice(0, 400));
      if (stopped()) return false;
      onPiece(audio, list[i]);
    }
    return true;
  }

  /** The person's words, from what the microphone heard. seconds: how long it heard, for the tally. */
  async function hear(audio, mime, seconds) {
    if (!ready()) throw notReady();
    const key = theKey();
    const form = new FormData();
    form.append('model_id', HEARING);
    form.append('tag_audio_events', 'false');
    form.append('file', new Blob([audio], { type: mime }), /ogg/.test(mime) ? 'talk.ogg' : 'talk.webm');
    const res = await send(`${API}/v1/speech-to-text`, { method: 'POST', headers: { 'xi-api-key': key }, body: form }, 'hearing');
    if (res.status !== 200 || !res.json || typeof res.json.text !== 'string') throw failed(res, 'hearing');
    tally(0, Math.max(1, Number(seconds) || 0));
    if (lastError) { lastError = ''; told(); }
    return res.json.text.replace(/\s+/g, ' ').trim();
  }

  /** The voices this key may use, its own first: [{ id, name, own }]; [] when they cannot be read. */
  async function voices() {
    if (!kept.key) return [];
    const res = await send(`${API}/v2/voices?page_size=100`, { headers: { 'xi-api-key': theKey(), Accept: 'application/json' } }, 'the voices').catch(() => null);
    if (!res) return [];
    if (res.status !== 200 || !res.json || !Array.isArray(res.json.voices)) { failed(res, 'the voices'); return []; }
    return res.json.voices.filter((v) => v && typeof v.voice_id === 'string' && /^[A-Za-z0-9]{8,40}$/.test(v.voice_id))
      .map((v) => ({ id: v.voice_id, name: String(v.name || v.voice_id).slice(0, 60), own: v.category !== 'premade' }))
      .sort((a, b) => Number(b.own) - Number(a.own) || a.name.localeCompare(b.name));
  }

  /** How much of the person's ElevenLabs plan is used this month, when the key may read it; null when not. */
  async function plan() {
    if (!kept.key) return null;
    const res = await send(`${API}/v1/user/subscription`, { headers: { 'xi-api-key': theKey(), Accept: 'application/json' } }, 'the plan').catch(() => null);
    if (!res || res.status !== 200 || !res.json) { planNow = null; told(); return null; }
    const j = res.json;
    planNow = { tier: String(j.tier || '').slice(0, 40), used: Math.max(0, Number(j.character_count) || 0), limit: Math.max(0, Number(j.character_limit) || 0),
      resets: Number(j.next_character_count_reset_unix) > 0 ? Number(j.next_character_count_reset_unix) * 1000 : 0, at: now() };
    told();
    return planNow;
  }

  /**
   * A chat's briefing, handed over through the door. from: the chat as this app knows it ({ key, cwd, name });
   * args: what the chat wrote ({ project, line, brief, asks }). The newest of each chat is kept.
   */
  function brief(from, args) {
    if (!kept.on) return 'The voice is off in Lowlit, so nothing was kept. Nothing else to do.';
    if (!from.key && !from.cwd) return 'Lowlit could not tell which chat this is, so nothing was kept.';
    const clean = (v, max) => spoken(hide(typeof v === 'string' ? v : ''), max);
    const line = clean(args.line, LINE_MAX);
    const text = clean(args.brief, BRIEF_MAX);
    if (!line && !text) return 'Nothing was kept: line and brief were empty. Say what changed, and where the work stands.';
    const b = { key: String(from.key || ''), cwd: String(from.cwd || '').slice(0, 260), chat: spoken(from.name, 80), project: clean(args.project, NAME_MAX),
      line: line || text.split(/(?<=[.!?…]) /)[0], brief: text || line, asks: clean(args.asks, ASKS_MAX), at: now() };
    const same = (x) => (b.key ? x.key === b.key : !x.key && x.cwd === b.cwd && x.chat === b.chat);
    kept.briefs = [b, ...kept.briefs.filter((x) => !same(x))].slice(0, KEPT);
    save();
    told();
    return 'Kept. Lowlit reads it out loud when the user asks, and as this turn ends if they picked this chat to be read out.';
  }

  /** The newest briefing of a chat ({ key, cwd }), or null. */
  const briefOf = (c) => kept.briefs.find((b) => (c.key && b.key === c.key)) || null;
  /** A chat's project as said: what its chats called it last, else its folder's name. */
  function projectOf(c) {
    const own = briefOf(c);
    if (own && own.project) return own.project;
    const near = c.cwd ? kept.briefs.find((b) => b.project && b.cwd && plain(b.cwd) === plain(c.cwd)) : null;
    return near ? near.project : sayFolder(c.cwd);
  }
  const ageOf = (at) => {
    const min = Math.round((now() - at) / 60e3);
    return min < 60 ? `${min} minutes ago` : min < 120 ? 'an hour ago' : min < 1440 ? `${Math.round(min / 60)} hours ago` : 'more than a day ago';
  };
  const ended = (s) => (/[.!?…]$/.test(s) ? s : `${s}.`);

  /**
   * What to say for a mise au point. chats: the window's chats now ([{ key, cwd, name, state }]); which: a project's
   * name as projectOf gives it, or '' for every chat. What waits for the person first, in full; then what finished,
   * by its line; then what still works, by name.
   */
  function compose(chats, which) {
    const all = chats.map((c) => ({ ...c, b: briefOf(c), project: projectOf(c) }));
    const working = (c) => c.state === 'working' || c.state === 'compacting';
    const waits = (c) => c.state === 'attention' || c.state === 'error' || (c.state === 'idle' && Boolean(c.b && c.b.asks));
    const order = (a, b) => Number(waits(b)) - Number(waits(a)) || (b.b ? b.b.at : 0) - (a.b ? a.b.at : 0);
    if (which) {
      const mine = all.filter((c) => plain(c.project) === plain(which)).sort(order);
      if (!mine.length) return `Nothing is open in ${which}.`;
      const parts = mine.map((c) => {
        const who = mine.length > 1 ? `${c.name}: ` : '';
        if (!c.b) return `${who}${working(c) ? 'It is working, and has not sent a briefing yet.' : 'No briefing yet.'}`;
        const age = now() - c.b.at > OLD_MS ? `From ${ageOf(c.b.at)}: ` : '';
        const again = working(c) ? ' It is working again now.' : '';
        const asks = c.b.asks && !working(c) ? ` It asks: ${ended(c.b.asks)}` : c.state === 'attention' ? ' It is waiting for your answer.' : c.state === 'error' ? ' It stopped on an error.' : '';
        return `${who}${age}${ended(c.b.brief)}${again}${asks}`;
      });
      return `${which}. ${parts.join(' ')}`;
    }
    const waiting = all.filter(waits).sort(order);
    const done = all.filter((c) => !waits(c) && !working(c) && c.b).sort(order);
    const busy = all.filter((c) => working(c) && !waits(c));
    const out = [];
    waiting.forEach((c, i) => {
      const asks = c.b && c.b.asks ? ` It asks: ${ended(c.b.asks)}` : c.state === 'error' ? ' It stopped on an error.' : '';
      // the first three in full, the rest by their line: a mise au point of everything stays a few minutes at most
      const said = c.b ? (i < 3 ? ended(c.b.brief) : ended(c.b.line)) : '';
      out.push(`${c.project} needs you.${said ? ` ${said}` : ''}${asks}`);
    });
    for (const c of done.slice(0, DONE_MAX)) out.push(`${c.project}: ${ended(c.b.line)}`);
    if (done.length > DONE_MAX) out.push(`And ${done.length - DONE_MAX} more finished earlier.`);
    if (busy.length) {
      const names = [...new Set(busy.map((c) => c.project))];
      out.push(busy.length === 1 ? `${names[0]} is still working.` : `${busy.length} chats are still working: ${names.join(', ')}.`);
    }
    return out.length ? out.join(' ') : 'Nothing to say yet: no chat has sent a briefing.';
  }

  /** What a picked chat says when its turn ends: its project, its whole briefing, then its question word for word. */
  function composeChat(c) {
    const b = briefOf(c);
    if (!b) return '';
    return `${projectOf(c)} finished. ${ended(b.brief)}${b.asks ? ` It asks: ${ended(b.asks)}` : ''}`;
  }

  return {
    view,
    ready,
    isOn: () => kept.on,
    full,
    speech,
    clip,
    say,
    pieces,
    hear,
    voices,
    plan,
    brief,
    briefOf,
    projectOf,
    compose,
    composeChat,
    understand,
    /** The switch. */
    setOn(on) { kept.on = on === true; lastError = ''; save(); told(); return view(); },
    /** Whether the person picked this chat (by its session) to be read out each time it finishes. */
    follows: (key) => Boolean(key) && kept.follow.includes(key),
    /** A chat picked, or let go, by its session. */
    setFollow(key, on) {
      const k = String(key || '');
      if (!k || k.length > 80) return view();
      kept.follow = kept.follow.filter((x) => x !== k);
      if (on === true) kept.follow = [k, ...kept.follow].slice(0, FOLLOW_MAX);
      save();
      told();
      return view();
    },
    /** The voice picked in Settings, by its id and its name. */
    setVoice(id, name) {
      if (typeof id === 'string' && /^[A-Za-z0-9]{8,40}$/.test(id)) { kept.voice = id; kept.voiceName = String(name || '').slice(0, 60); save(); told(); }
      return view();
    },
    /** A key pasted in Settings, locked away at once; '' takes it away. */
    setKey(text) {
      const k = String(text || '').trim();
      cached = '';
      planNow = null;
      if (!k) { kept.key = ''; lastError = ''; }
      else if (k.length > 200 || /\s/.test(k)) lastError = 'That does not look like an ElevenLabs key.';
      else if (!locked()) lastError = 'Windows could not lock the key away, so it was not kept.';
      else { kept.key = safe.encryptString(k).toString('base64'); lastError = ''; }
      save();
      told();
      return view();
    },
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    flush: write,
  };
}

module.exports = { create, understand, named, spoken, API, MODEL, HEARING, VOICE, monthOf };
