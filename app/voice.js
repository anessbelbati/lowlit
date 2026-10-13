'use strict';
/* global desk, toast, Settings */
// The voice in the window's page (main.cjs and voice.cjs make what it says): it plays each piece main hands it after
// the one before, so one voice says one thing at a time, and it listens to the microphone only after a press of the
// talk key, until the person stops speaking, presses it again, or 15 seconds. What it heard goes to main, nowhere else.
// A chat's right-click menu picks it to be read out each time it finishes (menuItem).

const Voice = (() => {
  const QUIET_MS = 1200;           // this long quiet after speaking ends what the person says
  const NOTHING_MS = 4000;         // nothing said this long after the press: nothing is sent
  const LONGEST_MS = 15000;
  const FLOOR_MS = 300;            // the room's own noise, heard first
  const KINDS = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/webm'];
  let view = null;
  let ctx = null;                  // the page's sound, made at its first use
  let playing = [];                // the pieces given to the sound card, in order
  let ends = 0;                    // when the last of them ends, on ctx's clock
  let chain = Promise.resolve();   // pieces are made ready in the order they came
  let epoch = 0;                   // a stop: a piece still being made ready from before it is dropped
  let listening = null;
  let muted = false;               // a hidden test window: nothing reaches the speakers
  let hush = null;
  const did = [];                  // what it did, the newest last: for the self-test

  const note = (what, words = '') => { did.push({ what, words: String(words).slice(0, 200), at: Date.now() }); if (did.length > 60) did.shift(); };
  function sound() {
    if (!ctx) ctx = new AudioContext();
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    return ctx;
  }
  /** Where sound goes: the speakers, or nowhere while muted. */
  function out(c) {
    if (!muted) return c.destination;
    if (!hush) { hush = c.createGain(); hush.gain.value = 0; hush.connect(c.destination); }
    return hush;
  }
  const usable = () => Boolean(view && view.on);
  const speaking = () => playing.length > 0;

  /** A short rising sound when it starts listening, a falling one when it stops, a low one when something went wrong. */
  function chirp(kind) {
    try {
      const c = sound();
      const t = c.currentTime + 0.01;
      const [from, to] = kind === 'up' ? [660, 990] : kind === 'down' ? [990, 660] : [330, 220];
      const o = c.createOscillator();
      const g = c.createGain();
      o.frequency.setValueAtTime(from, t);
      o.frequency.exponentialRampToValueAtTime(to, t + 0.12);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.07, t + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0001, t + (kind === 'low' ? 0.3 : 0.14));
      o.connect(g).connect(out(c));
      o.start(t);
      o.stop(t + 0.32);
    } catch {
      // no sound card: nothing to hear anyway
    }
  }

  /** A piece of speech from main ({ audio, words }), played once the pieces before it are said. */
  function play(item) {
    if (!item || !(item.audio instanceof Uint8Array) || !item.audio.length) return;
    const mine = epoch;
    // decoding takes the bytes over: a copy of their own
    const bytes = item.audio.slice().buffer;
    chain = chain.then(async () => {
      if (mine !== epoch || listening) return;
      const c = sound();
      let buffer = null;
      try { buffer = await c.decodeAudioData(bytes); } catch { note('unplayable', item.words); return; }
      if (mine !== epoch || listening) return;
      const src = c.createBufferSource();
      src.buffer = buffer;
      src.connect(out(c));
      const at = Math.max(c.currentTime + 0.03, ends);
      src.start(at);
      ends = at + buffer.duration;
      playing.push(src);
      src.onended = () => { playing = playing.filter((s) => s !== src); };
      note('play', item.words);
    });
  }

  /** Everything said or waiting to be said ends. tell: main is told too (a stop that came from main is not). */
  function stop(tell = true) {
    epoch++;
    for (const s of playing) { try { s.stop(); } catch { /* ended already */ } }
    playing = [];
    ends = 0;
    if (tell) desk.voice('stop');
    note('stop');
  }

  /** The microphone, from now until the person is quiet again (or the key, or 15 seconds). */
  async function listen() {
    if (listening) return;
    if (!usable()) return;
    if (!view.hasKey) { trouble('Paste your ElevenLabs key in Settings > Voice first.'); return; }
    // nothing could be said back: nothing is recorded or sent
    if (view.full) { trouble(`This month's $${view.cap} for the voice is used up. It stays quiet until next month.`); return; }
    // the person speaks now: what was being said, or made, ends
    stop(true);
    const l = { stream: null, recorder: null, chunks: [], kind: '', started: performance.now(), spoke: 0, loud: 0, floor: 0, heard: [], timer: 0, done: false, node: null };
    listening = l;
    try {
      l.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    } catch (err) {
      listening = null;
      trouble(`The microphone could not be opened (${err && err.name ? err.name : 'error'}). Windows may keep it from desktop programs: Settings > Privacy & security > Microphone.`);
      return;
    }
    // pressed again while the microphone was opening: nothing was said
    if (listening !== l || l.done) { for (const t of l.stream.getTracks()) t.stop(); return; }
    l.kind = KINDS.find((k) => MediaRecorder.isTypeSupported(k)) || '';
    l.recorder = new MediaRecorder(l.stream, l.kind ? { mimeType: l.kind } : undefined);
    l.kind = (l.recorder.mimeType || l.kind || 'audio/webm').replace(/\s+/g, '');
    l.recorder.ondataavailable = (e) => { if (e.data && e.data.size) l.chunks.push(e.data); };
    const c = sound();
    const meter = c.createAnalyser();
    meter.fftSize = 1024;
    l.node = c.createMediaStreamSource(l.stream);
    l.node.connect(meter);
    l.recorder.start(250);
    l.started = performance.now();
    chirp('up');
    note('listen');
    const data = new Float32Array(meter.fftSize);
    // timers, not frames: a hidden window draws no frames, and the key works from any program
    const step = () => {
      if (listening !== l || l.done) return;
      meter.getFloatTimeDomainData(data);
      let sum = 0;
      for (const x of data) sum += x * x;
      const level = Math.sqrt(sum / data.length);
      const t = performance.now() - l.started;
      if (t < FLOOR_MS) { l.heard.push(level); l.timer = setTimeout(step, 50); return; }
      if (!l.floor) l.floor = l.heard.length ? l.heard.reduce((a, b) => a + b, 0) / l.heard.length : 0.005;
      if (level > Math.max(0.015, l.floor * 3)) { if (!l.spoke) l.spoke = t; l.loud = t; }
      if ((l.spoke && t - l.loud > QUIET_MS) || (!l.spoke && t > NOTHING_MS) || t > LONGEST_MS) { finish(); return; }
      l.timer = setTimeout(step, 50);
    };
    l.timer = setTimeout(step, 50);
  }

  /** It stops listening; what was said, if anything was, goes to main to be heard and answered. */
  function finish() {
    const l = listening;
    if (!l || l.done) return;
    l.done = true;
    if (!l.recorder) { listening = null; chirp('down'); note('nothing said'); return; }
    clearTimeout(l.timer);
    const seconds = (performance.now() - l.started) / 1000;
    const spoke = Boolean(l.spoke);
    l.recorder.onstop = async () => {
      for (const t of l.stream.getTracks()) t.stop();
      try { l.node.disconnect(); } catch { /* gone already */ }
      if (listening === l) listening = null;
      chirp('down');
      if (!spoke) { note('nothing said'); return; }
      const bytes = new Uint8Array(await new Blob(l.chunks, { type: l.kind }).arrayBuffer());
      note('sent', `${bytes.length} bytes`);
      const r = await desk.voice('heard', bytes, l.kind, seconds);
      if (r && r.heard) { note('heard', `${r.what}${r.project ? ` ${r.project}` : ''}`); if (document.hasFocus()) toast(`Heard: ${r.heard}`, 4000); }
    };
    try { l.recorder.stop(); } catch { l.recorder.onstop(); }
  }

  /** The talk key: while it speaks, it stops; while it listens, it is done listening; else it listens. */
  function key() {
    if (listening) finish();
    else if (speaking()) stop(true);
    else listen();
  }

  /** Something went wrong: a low sound, and the words on a card. */
  function trouble(words) {
    chirp('low');
    note('trouble', words);
    if (words) toast(words, 7000);
  }

  /** The sessions the person picked to hear read out each time they finish. */
  const followed = () => (view && Array.isArray(view.follow) ? view.follow : []);
  const follows = (key) => Boolean(key) && followed().includes(key);
  /** A chat picked or let go: what main keeps comes back to the window by desk.onVoice, which redraws the list. */
  async function follow(key, on) {
    const r = await desk.voice('follow', key, on);
    note(on ? 'follow' : 'let go', key);
    const none = on && Boolean(r) && r.briefed === false;
    toast(!on ? 'This chat no longer reads out its summary.'
      : none ? 'This chat reads out its whole summary each time it finishes. It has sent none yet: a chat started before the voice was on does not know to. A new chat does.'
        : 'This chat reads out its whole summary each time it finishes.', none ? 9000 : 4000);
  }
  /** The line of a chat's right-click menu, ticked while that chat is read out; with the voice off it leads to Settings. */
  function menuItem(key) {
    if (!key) return null;
    const on = follows(key);
    return { label: 'Read it out when it finishes', icon: 'volume', on, run: () => {
      if (!view || !view.on || !view.hasKey) {
        Settings.open('voice');
        toast('Switch the voice on and paste your ElevenLabs key first. Then a chat you pick reads out its whole summary each time it finishes.', 8000);
        return;
      }
      follow(key, !on);
    } };
  }

  return {
    take(v) { view = v && typeof v === 'object' ? v : null; },
    mute(on) { muted = Boolean(on); },
    view: () => view,
    usable,
    play,
    stop,
    key,
    listen,
    finish,
    trouble,
    followed,
    follows,
    follow,
    menuItem,
    speaking,
    listening: () => Boolean(listening),
    did: () => did.slice(),
  };
})();
