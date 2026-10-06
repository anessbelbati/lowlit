'use strict';
// Jev, TypeSafe's decision model, asked through OpenRouter's System One endpoint. Two questions and nothing else:
// what a chat's finished turn wants from the person (one call per turn end), and which of the top results of a search
// answer it best (one call per search). It is off until the person switches it on in Settings and gives an
// OpenRouter key. The key is locked with Windows' own encryption for this user (Electron safeStorage); it is never
// written to a log, never handed to the page and never shown again. Every call's cost is added to the month's tally,
// and once the month's cap is reached no call goes out until the month turns. What goes out: the person's last
// message and the chat's last answer, or the search words and the results' snippets, with keys and passwords taken
// out first. Never the ops record.

const fs = require('node:fs');

const ENDPOINT = 'https://openrouter.ai/api/v1/systemone';
const MODEL = 'typesafe/jev-1.13-20260917';
// dollars per token read, writing is free (OpenRouter's list; a real bill on 2 Oct 2026 matched it)
const PER_TOKEN = 0.042 / 1e6;
// what a request weighs before its own words, and per letter of them (measured on real bills): for a reply that
// does not say what it cost
const BASE_TOKENS = 987;
const PER_LETTER = 0.742;
const TIMEOUT_MS = 8000;
const AGAIN_MS = 1500;         // a call that got no answer is made once more, this long after
const CAP = 5;
const KEPT = 400;              // verdicts kept, newest first
const AT_ONCE = 2;             // calls in flight at a time; the rest wait their turn

// What a finished turn can want from the person, as one choice. Its order is the order of urgency.
const LEVELS = {
  blocks: 'It cannot go on without the person: it asks a question, asks for a decision, or needs something only the person can do or give.',
  yesno: 'It only asks for a quick yes or no, or a go-ahead, on a plan it has already laid out.',
  stuck: 'It failed or is stuck: it hit an error it could not get past, or it gave up on the task.',
  loose: 'It finished, but says some part is left half-done, unchecked or still failing.',
  done: 'It finished what was asked: nothing is half-done, nothing is asked, nothing is left to check.',
  fyi: 'It only tells the person something, an answer, an explanation or a report, with no task left open.',
};
const TURN_QUESTION = 'The assistant has stopped and handed the conversation back to the person. Which describes its last answer best?';

// The reranker's rubric, word for word the one Jev was measured with (the jev reranker of the osgrep fork, and
// github.com/anessbelbati/jev-rerank-bench): its scores only compare with that benchmark while it stays so.
const RUBRIC = [
  'The passage is off-topic for the query.',
  'The passage is on a related topic but does not supply what the query asks for.',
  'The passage partly supplies the information needed to answer or verify the query.',
  'The passage fully supplies the information needed to answer or verify the query.',
];
const TOP = 20;

// Beyond what the search index already hides (find.cjs): what else must never leave this machine.
const MORE_SECRETS = [
  [/\b(?:sk|pk|rk|whsec)_(?:live_|test_)?[A-Za-z0-9]{16,}/g, '[hidden]'],
  [/(\b[a-z][a-z0-9+.-]*:\/\/[^\s:@/]+:)[^\s@/]{3,}@/gi, '$1[hidden]@'],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g, '[hidden private key]'],
];

const monthOf = (at) => { const d = new Date(at); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };
const round = (n, places) => Math.round(n * 10 ** places) / 10 ** places;
const VERDICT_KEY = /^(job:[0-9a-f]{6,40}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;
const validVerdict = (v) => v && typeof v === 'object' && typeof v.key === 'string' && VERDICT_KEY.test(v.key) && Object.hasOwn(LEVELS, v.level)
  && Number.isFinite(v.end) && Number.isFinite(v.at) && Number.isFinite(v.since);

/**
 * file: where the switch, the locked key, the month's tally and the verdicts are kept. safe: Electron's safeStorage.
 * post(url, headers, body, ms) -> { status, json }: how a request goes out (a made-up one in a test run). hide: the
 * search index's own hiding of secrets. mine(folder): true for a folder whose words never leave (his ops record).
 * log: a line for the app's log, never with the key or a chat's words in it.
 */
function create({ file, safe, post, hide, mine = () => false, log = () => {}, now = Date.now }) {
  let kept = { on: false, key: '', cap: CAP, months: {}, verdicts: [] };
  try {
    const j = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (j && typeof j === 'object') kept = { ...kept, ...j };
  } catch { /* first run */ }
  kept.on = kept.on === true;
  kept.key = typeof kept.key === 'string' ? kept.key : '';
  kept.cap = Number.isFinite(kept.cap) && kept.cap > 0 && kept.cap <= 100 ? kept.cap : CAP;
  kept.months = kept.months && typeof kept.months === 'object' && !Array.isArray(kept.months) ? kept.months : {};
  kept.verdicts = Array.isArray(kept.verdicts) ? kept.verdicts.filter(validVerdict).slice(0, KEPT) : [];
  let lastError = '';
  let cached = '';
  let flying = 0;
  const waiting = [];
  let saveTimer = null;
  const listeners = new Set();

  function write() {
    clearTimeout(saveTimer);
    saveTimer = null;
    try {
      fs.writeFileSync(`${file}.tmp`, JSON.stringify(kept));
      fs.renameSync(`${file}.tmp`, file);
    } catch (err) { log(`jev: not saved (${err.code || 'error'})`); }
  }
  const save = () => { if (!saveTimer) saveTimer = setTimeout(write, 300); };
  const told = () => { for (const fn of listeners) fn(); };
  function month() {
    const m = monthOf(now());
    if (!kept.months[m] || typeof kept.months[m] !== 'object') kept.months[m] = { spent: 0, calls: 0 };
    return kept.months[m];
  }
  const locked = () => { try { return Boolean(safe && safe.isEncryptionAvailable()); } catch { return false; } };
  function keyText() {
    if (cached) return cached;
    if (!kept.key || !locked()) return '';
    try { cached = safe.decryptString(Buffer.from(kept.key, 'base64')); } catch { cached = ''; }
    return cached;
  }
  const clean = (text, max) => {
    let out = hide(String(text || ''));
    for (const [re, to] of MORE_SECRETS) out = out.replace(re, to);
    return out.slice(0, max);
  };

  /** What the window may know: never the key itself. */
  function view() {
    const m = month();
    return { on: kept.on, hasKey: Boolean(kept.key), cap: kept.cap, spent: round(m.spent, 5), calls: m.calls, month: monthOf(now()),
      full: m.spent >= kept.cap, lastError, locked: locked(), verdicts: kept.verdicts.slice(0, 200) };
  }
  const ready = () => kept.on && Boolean(kept.key) && month().spent < kept.cap;

  /**
   * One request; the answers, or null (and why, in lastError). Only an answered call is billed and counted. A call that
   * got no answer (one slow answer, a dropped connection) is made once more. what: "a finished turn" or "a search",
   * for the log, which never holds the words.
   */
  async function ask(state, questions, letters, what) {
    if (!ready()) return null;
    const key = keyText();
    if (!key) { lastError = 'The key could not be read back. Paste it again in Settings.'; told(); return null; }
    while (flying >= AT_ONCE) await new Promise((resolve) => waiting.push(resolve));
    // the calls ahead of it may have reached the cap, or it was switched off meanwhile
    if (!ready()) { const next = waiting.shift(); if (next) next(); return null; }
    flying++;
    let res = null;
    const began = Date.now();
    try {
      for (let attempt = 1; !res && attempt <= 2; attempt++) {
        if (attempt === 2) {
          log(`jev: ${what}: ${lastError} Asked once more.`);
          await new Promise((resolve) => setTimeout(resolve, AGAIN_MS));
        }
        try {
          res = await post(ENDPOINT, { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Accept: 'application/json' },
            { state, model: MODEL, questions }, TIMEOUT_MS);
        } catch (err) {
          res = null;
          lastError = err && (err.name === 'TimeoutError' || err.name === 'AbortError') ? 'Jev did not answer within 8 seconds.' : 'Jev could not be reached.';
        }
      }
    } finally {
      flying--;
      const next = waiting.shift();
      if (next) next();
    }
    if (!res) { log(`jev: ${what}: ${lastError}`); told(); return null; }
    if (res.status !== 200 || !res.json || typeof res.json.answers !== 'object' || !res.json.answers) {
      lastError = res.status === 401 ? 'OpenRouter turned the key down.' : res.status === 402 ? 'The OpenRouter account has no credit left.'
        : res.status === 429 ? 'OpenRouter asked to slow down.' : `Jev answered with an error (${res.status}).`;
      log(`jev: ${what}: answered ${res.status}`);
      told();
      return null;
    }
    log(`jev: ${what}: answered in ${Date.now() - began} ms`);
    const usage = res.json.usage || {};
    const tokens = Number(usage.input_tokens || usage.prompt_tokens);
    const cost = Number.isFinite(usage.cost) ? usage.cost : Number.isFinite(tokens) && tokens > 0 ? tokens * PER_TOKEN : (BASE_TOKENS + PER_LETTER * letters) * PER_TOKEN;
    const m = month();
    m.spent += Math.max(0, cost);
    m.calls++;
    lastError = '';
    save();
    return res.json.answers;
  }

  /**
   * What a finished turn wants from the person: t = { key, since, asked, answer, end, title, cwd }, since being
   * when the session last changed state (the verdict holds while that stays so). One call; the verdict is kept and
   * returned, null when there is none (off, at the cap, judged already, a folder that never leaves, or no answer).
   */
  async function judgeTurn(t) {
    if (!ready() || !t || !VERDICT_KEY.test(String(t.key)) || !t.answer || !Number.isFinite(t.end) || !(t.since > 0)) return null;
    if (mine(t.cwd)) return null;
    if (kept.verdicts.some((v) => v.key === t.key && v.end === t.end && v.since === t.since)) return null;
    const state = { request: clean(t.asked, 1600), answer: clean(t.answer, 4200) };
    const answers = await ask(state, { turn: { type: 'choice', instructions: TURN_QUESTION, criteria: LEVELS } }, state.request.length + state.answer.length, 'a finished turn');
    const a = answers && answers.turn;
    const probs = a && a.probabilities;
    if (!probs || typeof probs !== 'object') { if (answers) { lastError = 'Jev\'s answer could not be read.'; told(); } return null; }
    let level = 'fyi';
    for (const k of Object.keys(LEVELS)) if ((Number(probs[k]) || 0) > (Number(probs[level]) || 0)) level = k;
    const v = { key: t.key, since: t.since, end: t.end, at: now(), level, p: round(Number(probs[level]) || 0, 3),
      conf: Number.isFinite(a.confidence) ? round(a.confidence, 3) : null,
      title: String(t.title || '').slice(0, 120), cwd: String(t.cwd || '').slice(0, 260) };
    kept.verdicts = [v, ...kept.verdicts.filter((x) => x.key !== t.key || x.end !== t.end || x.since !== t.since)].slice(0, KEPT);
    save();
    told();
    return v;
  }

  /** The expected rubric level of one scored passage, 0 (off-topic) to 1 (answers it). */
  function expected(a) {
    const legend = a && a.legend;
    const probs = a && a.probabilities;
    if (!legend || !probs) return Number.isFinite(a && a.score) ? a.score : 0;
    let sum = 0;
    for (const [level, criterion] of Object.entries(legend)) sum += (Number(probs[level]) || 0) * Math.max(0, RUBRIC.indexOf(criterion));
    return sum / (RUBRIC.length - 1);
  }

  /** How well each of the first twenty results answers the search, in their order; null when Jev is not asked. */
  async function rerank(query, docs) {
    if (!ready() || !query || !Array.isArray(docs) || docs.length < 2) return null;
    const passages = {};
    const questions = {};
    docs.slice(0, TOP).forEach((text, i) => {
      const id = `p${String(i + 1).padStart(2, '0')}`;
      passages[id] = clean(text, 700);
      questions[id] = { type: 'score', instructions: `How well does passage ${id} supply the information needed to answer or verify the query?`, criteria: RUBRIC };
    });
    const q = clean(query, 300);
    const letters = q.length + Object.values(passages).reduce((n, p) => n + p.length, 0);
    const answers = await ask({ query: q, passages }, questions, letters, 'a search');
    if (!answers) return null;
    return Object.keys(passages).map((id) => expected(answers[id]));
  }

  return {
    view,
    ready,
    judgeTurn,
    rerank,
    /** The switch. */
    setOn(on) { kept.on = on === true; lastError = ''; save(); told(); return view(); },
    /** A key pasted in Settings, locked away at once; '' takes it away. */
    setKey(text) {
      const k = String(text || '').trim();
      cached = '';
      if (!k) { kept.key = ''; lastError = ''; }
      else if (k.length > 400 || /\s/.test(k)) lastError = 'That does not look like an OpenRouter key.';
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

module.exports = { create, LEVELS, RUBRIC, ENDPOINT, MODEL, monthOf };
