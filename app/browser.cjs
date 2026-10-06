'use strict';
// The browser inside the window: real web pages that the chats drive through Claude Code's own door for tools
// (browser-mcp.cjs), and that the person watches beside the chats and can take over. Each page is a window of its own
// that is never on screen by itself: a page inside the app's window stops drawing whenever that window cannot be seen
// (closed to the clock, minimized, a page not in front), while a hidden window's own page goes on drawing, and gives
// pictures. The page in front of the panel is laid over the panel's page area, tied to the app's window (no taskbar
// button, not in Alt+Tab), and follows it. The chats drive a page the way Chrome's developer tools do, through its
// debugger: nothing is opened to the outside. The pages are told they have the focus, their timers are never slowed,
// and one left alone for a while rests (frozen, as Chrome rests a tab in the background) until it is used again. What
// runs inside a page to read it is browser-look.cjs.
//
// A page asks before it is left, or puts a question in a box: a chat's page is answered without a box ever reaching
// the person's screen, as the chat said (no, unless told otherwise), and so is the person's own page for a moment
// after a chat acted on it. Otherwise the person's pages, and a chat's page he took over, show the real boxes.
//
// The sites of the ask-first list (the person's mail, files, accounts, payments and private messages; Settings >
// Browser) are not a chat's to open, read or touch until the person lets that chat in, with a button the panel shows
// him; a chat's page that heads there stays where it is.

const { BrowserWindow, session: sessions, Menu, clipboard, dialog, shell, app, nativeImage } = require('electron');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { fileURLToPath } = require('node:url');
const { Worker } = require('node:worker_threads');
const { LOOK } = require('./browser-look.cjs');

const PARTITION = 'persist:lowlit-browser';
const WORLD = 1207;                  // the world the outline runs in, away from the page's scripts (999 is Electron's own)
const TABS_MAX = 16;                 // pages open at once, every chat together: the one used longest ago goes first
const PER_CHAT = 6;
const LOAD_MS = 25000;
const STEP_MS = 15000;               // what one step inside a page may take
const LOGS_KEPT = 200;
const OUTLINE_MAX = 20000;           // characters of outline a chat is handed at once (about 5,000 tokens)
const CHANGES_MAX = 120;             // lines of "what changed" handed back after a step
const SHOT_WIDTH = 1280;
// the screens look lays a page out on, one after the other, each at the density such a screen has (so the page picks
// the pictures it would there); a picture of each first screen as wide as the screen, a laptop's cut to SHOT_WIDTH
const LOOK_SIZES = [
  { name: 'Phone', width: 390, height: 844, scale: 2, mobile: true },
  { name: 'Tablet', width: 768, height: 1024, scale: 2, mobile: true },
  { name: 'Laptop', width: 1440, height: 900, scale: 1, mobile: false },
];
const AUTO_MS = 4000;
const SYNTH_MS = 600;                // a key or a click a chat sent is still arriving this long after it was sent
const REST_MS = 2 * 60e3;            // a page nobody used for this long, and not on screen, rests until it is used again
const NET_KEPT = 300;                // requests a page remembers, the newest
const NET_SHOWN = 150;
const NET_BUFFER = 8 * 1024 * 1024;  // what a page keeps of the answers it got, for network to show one: 8 MB, 1 MB each
const NET_BODY = 1024 * 1024;
const BODY_SHOWN = 20000;
// a header that can carry a login is never handed to a chat
const HIDDEN_HEADER = /^(cookie|set-cookie|authorization|proxy-authorization)$|token|secret|api[-_]?key|session|auth/i;
const REC_WIDTH = 800;               // a recording is at most this wide
const REC_TICK_MS = 1000;            // while recording, a frame at least this often (one like the frame before costs nothing)
const REC_MAX_MS = 3 * 60e3;
const REC_FRAMES = 600;
const DEFAULT_SIZE = { width: 1280, height: 800 };
// a chat's page off the screen is laid out at least this big, a laptop's screen: a narrow panel folds a site's menus
// away (WordPress hides most of its top bar below 783 pixels)
const CHAT_SIZE = { width: 1280, height: 800 };
const REFIT_MS = 300;                // pages off the screen take the panel's new size once it has stayed the same this long
const AUTO_OUTLINE = 8000;           // characters of a new page's outline handed back whole; a longer one is summed up
const FIELD_MAX = 5 * 1024 * 1024;   // what save_field writes and fill_field reads, at most
const ASK_SHOWN_MS = 60000;          // the same chat asking for the same site is shown to the person once a minute at most
// Sites a chat opens only once the person allows it for that chat in the Browser panel: mail, files, accounts,
// payments, private messages. A site covers its subdomains; a site with a path, the pages under that path.
const ASK_FIRST = [
  'mail.google.com', 'gmail.com', 'accounts.google.com', 'myaccount.google.com', 'drive.google.com', 'docs.google.com', 'photos.google.com',
  'calendar.google.com', 'contacts.google.com', 'pay.google.com', 'admin.google.com', 'business.google.com', 'search.google.com/search-console',
  'analytics.google.com', 'ads.google.com', 'studio.youtube.com', 'outlook.live.com', 'outlook.office.com', 'outlook.office365.com',
  'mail.yahoo.com', 'mail.proton.me', 'upwork.com', 'paypal.com', 'payoneer.com', 'wise.com', 'revolut.com', 'mercury.com', 'paddle.com',
  'dashboard.stripe.com', 'dash.cloudflare.com', 'github.com/settings', 'claude.ai', 'console.anthropic.com', 'chatgpt.com', 'platform.openai.com',
  'web.whatsapp.com', 'web.telegram.org', 'messenger.com', 'facebook.com/messages', 'instagram.com/direct', 'x.com/messages', 'linkedin.com/messaging',
  'discord.com/channels/@me', 'vault.bitwarden.com', 'my.1password.com',
];
// a field or a key whose name says it can open an account: its value is never handed to a chat
const KEYISH = /pass(word|wd|phrase)?(?![a-z])|pwd|secret|token|api[-_]?key|(?<![a-z])auth(?![a-z])|authorization|session|cookie|nonce|csrf|xsrf|(?<![a-z])otp(?![a-z])|signature|private[-_]?key/i;
const SCHEMES = /^(https?:|file:|about:blank$|data:text\/html)/i;
// runs in the page's own world, before its scripts: __lowlitAlways (a chat's page) and __lowlitAuto (a moment after a
// chat acted) are set from here, never by the page
const HOOK = `(() => {
  if (window.__lowlitHooked) return;
  Object.defineProperty(window, '__lowlitHooked', { value: true });
  const real = { alert: window.alert, confirm: window.confirm, prompt: window.prompt };
  const auto = () => window.__lowlitAlways === true || (window.__lowlitAuto || 0) > Date.now();
  const tell = (type, message, answer) => { try { console.debug('\\u2063lowlit-dialog ' + JSON.stringify({ type, message: String(message === undefined ? '' : message).slice(0, 400), answer })); } catch (e) {} };
  window.alert = function alert(m) { if (!auto()) return real.alert.call(window, m); tell('alert', m, null); };
  window.confirm = function confirm(m) { if (!auto()) return real.confirm.call(window, m); const a = window.__lowlitAnswer || {}; const yes = a.accept === true; tell('confirm', m, yes); return yes; };
  window.prompt = function prompt(m, d) { if (!auto()) return real.prompt.call(window, m, d); const a = window.__lowlitAnswer || {}; const v = a.accept === true ? (typeof a.text === 'string' ? a.text : (d === undefined ? '' : String(d))) : null; tell('prompt', m, v); return v; };
})();`;
const DIALOG_MARK = '\u2063lowlit-dialog ';

// keys by name: what Chrome is told for each
const KEYS = {
  Enter: [13, 'Enter', '\r'], Tab: [9, 'Tab', ''], Escape: [27, 'Escape', ''], Backspace: [8, 'Backspace', ''], Delete: [46, 'Delete', ''],
  ArrowUp: [38, 'ArrowUp', ''], ArrowDown: [40, 'ArrowDown', ''], ArrowLeft: [37, 'ArrowLeft', ''], ArrowRight: [39, 'ArrowRight', ''],
  Home: [36, 'Home', ''], End: [35, 'End', ''], PageUp: [33, 'PageUp', ''], PageDown: [34, 'PageDown', ''], Insert: [45, 'Insert', ''],
  Space: [32, 'Space', ' '],
};
for (let i = 1; i <= 12; i++) KEYS[`F${i}`] = [111 + i, `F${i}`, ''];
const KEY_NAMES = { esc: 'Escape', escape: 'Escape', return: 'Enter', enter: 'Enter', tab: 'Tab', up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft',
  right: 'ArrowRight', arrowup: 'ArrowUp', arrowdown: 'ArrowDown', arrowleft: 'ArrowLeft', arrowright: 'ArrowRight', del: 'Delete', delete: 'Delete',
  backspace: 'Backspace', home: 'Home', end: 'End', pageup: 'PageUp', pagedown: 'PageDown', pgup: 'PageUp', pgdn: 'PageDown', insert: 'Insert',
  space: 'Space', spacebar: 'Space', ' ': 'Space' };
const MODS = { alt: 1, option: 1, control: 2, ctrl: 2, meta: 4, cmd: 4, command: 4, win: 4, windows: 4, shift: 8 };

/** A message for the chat: what went wrong in words it can act on. */
class Say extends Error {}

const wait = (ms) => new Promise((done) => setTimeout(done, ms));
const clip = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const within = (p, ms, what) => Promise.race([p, wait(ms).then(() => { throw new Say(`${what} took longer than ${Math.round(ms / 1000)} s and was left.`); })]);
const sizeWords = (n) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`);

/** What look measured on one screen (browser-look.cjs faults), in a few lines: what it caught, then where the content sits. */
function lookSaid(s, f) {
  const screens = Math.max(1, Math.round(f.tall / f.height));
  const lines = [];
  const sticking = f.sticking.length ? `; sticking out: ${f.sticking.join('; ')}` : '';
  const out = f.zoomed && f.zoomed < 100;
  if (f.sideways) lines.push(`- Wider than the screen: ${out ? `its content is ${f.wide} px wide for a ${f.width} px screen, so the phone shows the page zoomed out to ${f.zoomed}% of its size` : `it scrolls sideways by ${f.sideways} px`}${sticking}.`);
  if (f.zoomed && !(f.sideways && out)) lines.push(`- It opens zoomed ${out ? 'out' : 'in'}, at ${f.zoomed}% of its size.`);
  if (f.broken.length) lines.push(`- Pictures that did not load: ${f.broken.join('; ')}.`);
  if (f.soft.length) lines.push(`- Soft pictures, shown larger than their file holds: ${f.soft.join('; ')}.`);
  if (f.stretched.length) lines.push(`- Stretched pictures: ${f.stretched.join('; ')}.`);
  if (f.cut.length) lines.push(`- Text cut off: ${f.cut.join('; ')}.`);
  if (f.over.length) lines.push(`- Text over other text: ${f.over.join('; ')}.`);
  if (f.tinyCount) lines.push(`- Text under 12 px in ${f.tinyCount} place${f.tinyCount === 1 ? '' : 's'}, such as ${f.tiny.join(', ')}.`);
  if (f.offCentre.length) lines.push(`- Off the middle of its box: ${f.offCentre.join('; ')}.`);
  if (f.emoji.length) lines.push(`- Emojis standing in for icons: ${f.emoji.join('; ')}.`);
  if (f.fonts.length) lines.push(`- Fonts that did not load: ${f.fonts.join(', ')}.`);
  if (!lines.length) lines.push('- Nothing measured is off.');
  if (f.span) {
    const more = f.span.right - f.span.left;
    const lopsided = f.width > 900 && Math.abs(more) > 40 ? `: ${Math.abs(more)} px more room on the ${more > 0 ? 'right' : 'left'} than on the ${more > 0 ? 'left' : 'right'}` : '';
    const edge = f.width < 600 && Math.min(f.span.left, f.span.right) < 8 ? ': text within 8 px of the screen\'s edge' : '';
    lines.push(`- The content runs from ${f.span.left} to ${f.width - f.span.right} px across the ${f.width}${lopsided}${edge}.`);
  }
  return [`${s.name} (${s.width}×${s.height}${s.mobile ? ', touch' : ''}, ${f.dense}× density): the page is ${screens} screen${screens === 1 ? '' : 's'} tall.`, ...lines].join('\n');
}

/** One request as network lists it: its number, method, outcome, kind, size, time and address. */
function netLine(r) {
  const where = r.url.startsWith('data:') ? `${r.url.slice(0, 40)}… (inline, ${r.url.length} characters)` : clip(r.url, 220);
  const parts = [`n${r.n}`, r.method, r.failed ? `failed (${r.failed})` : r.status ? String(r.status) : '…', r.type.toLowerCase()];
  if (r.to) parts.push(`→ ${clip(r.to, 160)}`);
  else if (r.done && !r.failed) parts.push(sizeWords(r.size));
  if (r.done) parts.push(`${r.ms} ms`);
  else if (!r.failed) parts.push('(still going)');
  if (r.cache) parts.push('(from the cache)');
  parts.push(where);
  return parts.join(' ');
}

/** Headers one a line, those that can carry a login hidden. */
const headerLines = (h) => Object.entries(h || {}).map(([k, v]) => `  ${k}: ${HIDDEN_HEADER.test(k) ? '(hidden)' : clip(String(v).replace(/\n/g, ', '), 300)}`);

const sha = (text) => crypto.createHash('sha256').update(typeof text === 'string' ? Buffer.from(text, 'utf8') : text).digest('hex');

/** A site's own name without its subdomains (example.com for api.example.com, example.co.uk with a two-part ending); an address by number as it is. */
function siteOf(host) {
  const h = String(host || '').toLowerCase().replace(/\.$/, '');
  if (!h || /^[\d.]+$|^\[|^localhost$/.test(h)) return h;
  const parts = h.split('.');
  const two = parts.length >= 3 && parts[parts.length - 1].length === 2 && /^(co|com|org|net|gov|edu|ac|or|ne)$/.test(parts[parts.length - 2]);
  return parts.slice(two ? -3 : -2).join('.');
}
function sameSite(a, b) {
  try { return siteOf(new URL(a).hostname) === siteOf(new URL(b).hostname); } catch { return false; }
}
const hostOf = (url) => { try { return new URL(url).hostname; } catch { return String(url).slice(0, 60); } };

/** A value that reads as a key: a bearer or basic login, a JSON web token, a long run of letters and digits. */
const tokenLike = (v) => typeof v === 'string' && (/^(bearer|basic)\s+\S{8,}/i.test(v) || /^eyJ[\w-]+\.[\w-]+\.[\w-]*$/.test(v)
  || (/^[A-Za-z0-9_\-+/=]{32,}$/.test(v) && /\d/.test(v) && /[A-Za-z]/.test(v)));
/** JSON with what can open an account hidden: a value under a name like a password, a token or a nonce, and a value that reads as a key. */
function maskJson(v, depth = 0) {
  if (depth > 40) return '(deeper than shown)';
  if (Array.isArray(v)) return v.map((x) => maskJson(x, depth + 1));
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, KEYISH.test(k) ? '(hidden)' : maskJson(x, depth + 1)]));
  return tokenLike(v) ? '(hidden: it reads as a key)' : v;
}

/** The ask-first list as it is kept: sites, or sites with a path, in small letters, without https://, www. or a port; at most 300. null: not a list. */
function askList(list) {
  if (!Array.isArray(list)) return null;
  const out = [];
  for (const x of list) {
    const e = String(x || '').trim().toLowerCase().replace(/^[a-z][a-z0-9+.-]*:\/\//, '').replace(/^www\./, '').replace(/[?#].*$/, '')
      .replace(/:\d+(?=\/|$)/, '').replace(/\/+$/, '');
    if (!e || e.length > 200 || !/^[a-z0-9.-]+\.[a-z0-9-]+(\/\S*)?$|^localhost(\/\S*)?$/.test(e) || out.includes(e)) continue;
    out.push(e);
    if (out.length >= 300) break;
  }
  return out;
}

/** A form's value as a chat is shown it: a short one as it is, a long one by its length, SHA-256 and start. */
const formValue = (v) => (v.length <= 160 ? JSON.stringify(v) : `${v.length} characters, SHA-256 ${sha(v)}, starting ${JSON.stringify(v.slice(0, 60))}`);
const formValues = (list) => (list.length === 1 ? formValue(list[0]) : `[${list.map(formValue).join(', ')}]`);
/** What one form would send against its starting point, one change a line (browser-look.cjs formPreview). */
function formLines(f) {
  const t = new Date(f.since);
  const two = (n) => String(n).padStart(2, '0');
  const at = `${two(t.getHours())}:${two(t.getMinutes())}:${two(t.getSeconds())}`;
  const from = f.late ? 'now: it was not read before (it came after the page was last read), so call form_preview again after a change'
    : f.marked ? `it was marked, at ${at}` : `the page was first read, at ${at}`;
  const n = f.changes.length;
  const head = `${f.what} (${f.method} ${clip(String(f.action), 120)}) would send ${f.fields} field${f.fields === 1 ? '' : 's'}; `
    + (n ? `${n}${n >= 80 ? ' or more' : ''} differ${n === 1 ? 's' : ''} from what it held when ${from}:` : `none differs from what it held when ${from}.`);
  const lines = f.changes.map((c) => {
    if (c.secret) return `- ${c.name}: ${c.how} (hidden: it can open an account; ${c.before.join(', ') || 'nothing'} → ${c.after.join(', ') || 'nothing'} characters)`;
    if (c.how === 'added') return `- ${c.name} (added): ${formValues(c.after)}`;
    if (c.how === 'gone') return `- ${c.name} (gone; it held ${formValues(c.before)})`;
    return `- ${c.name}: ${formValues(c.before)} → ${formValues(c.after)}`;
  });
  return [head, ...lines].join('\n');
}

// The browser never opens, or hands to a page, what holds keys: anything whose name or folder starts with a dot
// (.claude, .codex, .ssh, .env, .npmrc), AppData (where programs keep their logins; its Temp folder aside), or a file
// named as keys are. A link, a junction or a short name is judged by where it really leads. Files on other computers
// are never reached.
const KEY_NAME = /(?:^|[._-])env(?:[._-]|$)|credential|secret|^auth\.json$|^id_(?:rsa|dsa|ecdsa|ed25519)|\.(?:key|pem|pfx|p12|ppk|kdbx)$/i;
function keyPlace(p) {
  const parts = p.split(/[\\/]+/).filter(Boolean);
  return parts.some((s) => s[0] === '.' && s !== '.' && s !== '..')
    || /[\\/]AppData[\\/](?!Local[\\/]Temp(?:[\\/]|$))/i.test(p)
    || KEY_NAME.test(parts[parts.length - 1] || '');
}
/** Where a path really leads (links and short names followed), or the path itself when nothing is there yet. */
function really(p) {
  try { return fs.realpathSync.native(p); } catch { return path.resolve(p); }
}
function secretPath(p) {
  const t = String(p);
  if (/^[\\/]{2}/.test(t)) return true;
  return keyPlace(path.resolve(t)) || keyPlace(really(t));
}
function secretFile(url) {
  if (!/^file:/i.test(String(url))) return false;
  try {
    const u = new URL(url);
    return Boolean(u.host) || secretPath(fileURLToPath(u));
  } catch { return true; }
}
const SECRET_SAID = 'That file is not opened here: the browser never opens a file in a folder whose name starts with a dot, in AppData or on another computer, or a file that holds keys.';

/** An address as typed, made whole: "github.com" is https, "localhost:3000" is http. */
function address(text) {
  const made = whole(text);
  if (secretFile(made)) throw new Say(SECRET_SAID);
  return made;
}
function whole(text) {
  const t = String(text || '').trim();
  if (!t) throw new Say('Say where to go: an address, or "back", "forward" or "reload".');
  if (/^[a-z]:[\\/]/i.test(t)) return `file:///${t.replace(/\\/g, '/')}`;
  if (t.startsWith('\\\\')) return `file:${t.replace(/\\/g, '/')}`;
  // "example.com:8080/x" is a place with its port, not an address of a kind called "example.com"
  const hostAndPort = /^[a-z0-9.-]+:\d+(?:[/?#]|$)/i.test(t);
  if (!hostAndPort && /^[a-z][a-z0-9+.-]*:/i.test(t)) {
    if (!SCHEMES.test(t)) throw new Say(`${clip(t, 60)} cannot be opened here: only http, https and file addresses can.`);
    return t;
  }
  if (/\s/.test(t) || (!/[.:]/.test(t) && !/^localhost(?:[/?#]|$)/i.test(t))) {
    throw new Say(`"${clip(t, 60)}" is not an address. To search, open https://duckduckgo.com/?q=your+words.`);
  }
  return /^(localhost|127\.|\[::1\]|0\.0\.0\.0|192\.168\.|10\.)/i.test(t) ? `http://${t}` : `https://${t}`;
}

/** What a key name stands for: "Control+Shift+K", "Enter", "a". */
function keyOf(text) {
  const t = String(text || '');
  if (!t) throw new Say('Say which key: Enter, Tab, Escape, ArrowDown, a letter, or a combination such as Control+A.');
  const parts = t.length > 1 ? t.split(/\+(?!$)/) : [t];
  let modifiers = 0;
  for (const m of parts.slice(0, -1)) {
    const bit = MODS[m.trim().toLowerCase()];
    if (!bit) throw new Say(`${m} is not a key that is held: Control, Shift, Alt or Meta.`);
    modifiers |= bit;
  }
  const last = parts[parts.length - 1];
  const named = KEYS[last] ? last : /^f([1-9]|1[0-2])$/i.test(last) ? last.toUpperCase() : KEY_NAMES[last.toLowerCase()];
  if (named) {
    const [vk, code, text] = KEYS[named];
    return { key: named === 'Space' ? ' ' : named, code, vk, text: modifiers & 7 ? '' : text, modifiers };
  }
  if ([...last].length !== 1) throw new Say(`${clip(last, 30)} is not a key name. Use Enter, Tab, Escape, Backspace, Delete, the arrows, Home, End, PageUp, PageDown, F1 to F12, Space, or one character.`);
  const ch = last;
  const shifted = (modifiers & 8) !== 0;
  if (/^[a-z]$/i.test(ch)) {
    const key = shifted ? ch.toUpperCase() : ch;
    return { key, code: `Key${ch.toUpperCase()}`, vk: ch.toUpperCase().charCodeAt(0), text: modifiers & 7 ? '' : key, modifiers };
  }
  if (/^\d$/.test(ch)) return { key: ch, code: `Digit${ch}`, vk: ch.charCodeAt(0), text: modifiers & 7 ? '' : ch, modifiers };
  return { key: ch, code: '', vk: 0, text: modifiers & 7 ? '' : ch, modifiers };
}

class Browser {
  /**
   * win: the window the pages are laid over. send(view): tells the window's page what there is. command(name, arg):
   * asks the window's page for something (to show a page to the person). downloads: the folder files are saved to.
   * hidden: a window nobody sees (the self-test): nothing is ever asked of the person in a box. record(): the folders
   * of the person's record, whose files are never handed to a page. ask(): the ask-first list (Settings > Browser).
   */
  constructor({ win, send, command, log, downloads, hidden = false, record, ask }) {
    this.win = win;
    this.sendView = send;
    this.command = command || (() => {});
    this.log = log || (() => {});
    this.downloads = downloads || app.getPath('downloads');
    this.hidden = hidden;
    this.record = record || (() => []);
    this.askFirst = typeof ask === 'function' ? ask : () => ASK_FIRST;
    this.allowed = new Map();      // a chat (its session) -> the sites of the ask-first list the person let it open, until the app ends
    this.asks = new Map();         // 'session|site' -> when the person was last shown that ask
    this.tabs = new Map();
    this.n = 0;
    this.rect = null;              // where the panel's page area is, in the window
    this.shown = '';               // the page in front in the panel
    this.visible = false;          // the panel is open, and nothing floats over it
    this.ses = null;
    this.timer = null;
    this.refitTimer = null;
    this.popOpen = false;          // the panel opens by itself on a page a chat has just opened
    this.door = null;              // whether Claude Code offers the browser to the chats (main.cjs): { on, listed, said, busy, port }
    this.holding = false;          // the app's window is being dragged or resized: its page shows as a picture meanwhile
    this.sizing = false;           // ... resized by the person's hand, from its edge
    this.holdAsk = 0;
    this.holdTimer = null;
    // the page in front follows the app's window wherever it goes, and steps aside when it cannot be seen
    const follow = () => this.layout();
    for (const e of ['move', 'resize', 'minimize', 'restore', 'maximize', 'unmaximize', 'hide', 'show', 'enter-full-screen', 'leave-full-screen']) win.on(e, follow);
    // a window laid over another lags behind it while it is dragged: the panel shows the page's picture until it stops
    win.on('will-move', () => this.hold(true));
    win.on('will-resize', () => { this.sizing = true; this.hold(true); });
    win.on('moved', () => this.hold(false));
    win.on('resized', () => {
      this.hold(false);
      if (this.sizing) this.fitShown('resized the window');
      this.sizing = false;
    });
    win.on('maximize', () => this.fitShown('maximized the window'));
    win.on('unmaximize', () => this.fitShown('restored the window from maximized'));
  }

  // ---- the pages ----

  session() {
    if (this.ses) return this.ses;
    const ses = sessions.fromPartition(PARTITION);
    // the address Chrome would give, without the app's name in it: some sites turn the app away otherwise
    ses.setUserAgent(app.userAgentFallback.replace(/\s(lowlit|Electron)\/\S+/gi, ''));
    // a page may copy to the clipboard; it may not ask for the camera, the microphone, where the person is, or to go full screen
    ses.setPermissionRequestHandler((_wc, permission, done) => done(permission === 'clipboard-sanitized-write'));
    ses.setPermissionCheckHandler((_wc, permission) => permission === 'clipboard-sanitized-write');
    ses.on('will-download', (_event, item, wc) => this.download(item, wc));
    // what a local page links to, frames or fetches goes through the same rule as an address typed or sent
    try {
      ses.webRequest.onBeforeRequest({ urls: ['file:///*'] }, (d, done) => {
        const cancel = secretFile(d.url);
        if (cancel) this.withhold(d.webContentsId, d.url);
        done({ cancel });
      });
    } catch (err) { this.log(`browser: no watch on local files: ${err.message}`); }
    this.ses = ses;
    return ses;
  }

  /**
   * A new page, for a chat (owner) or for the person (owner null). It is not shown until the panel shows it.
   * adopt: the page another one opened (window.open, a link to a new tab), which keeps its tie to its opener.
   * home: whose browser a page of the person's stands in (browser.js: a chat of the window, 's:' and a session
   * elsewhere, or '' for none); a chat's page stands in its chat's. turn: the chat works in it from now on (not for a
   * page that another page, or the person, opened: the chat turns to it when it asks to).
   */
  make(owner, url = '', adopt = null, home = '', turn = true) {
    this.roomFor(owner);
    const id = `t${++this.n}`;
    this.session();
    const size = this.offSize(owner);
    const page = new BrowserWindow({
      ...size, show: false, frame: false, parent: this.win, skipTaskbar: true, resizable: false, movable: false, minimizable: false,
      maximizable: false, fullscreenable: false, hasShadow: false, backgroundColor: '#ffffff', title: 'Lowlit browser',
      ...(adopt ? { webContents: adopt } : {
        webPreferences: { partition: PARTITION, sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false, spellcheck: true },
      }),
    });
    page.removeMenu();
    // A page is a window the app's window owns, and Windows can show one by itself: it hides the page that was on
    // screen when the app's window is minimized, and brings it back with the window, whatever the panel shows by then
    // (6 Oct: a chat's page left floating over the Nest). Whatever shows a page, layout has the last word, at once.
    page.on('show', () => setImmediate(() => { if (!page.isDestroyed() && !this.win.isDestroyed()) this.layout(); }));
    const tab = {
      id, page, wc: page.webContents, owner: owner || null, guest: null, home: String(home || '').slice(0, 160), url: url || 'about:blank', title: '', icon: '', loading: Boolean(url),
      made: Date.now(), used: Date.now(), changedAt: Date.now(), navAt: 0, autoUntil: 0, synthAt: 0, acts: 0, busy: '', last: null, paused: false,
      logs: [], dialogs: [], answer: { accept: false, text: null }, lines: [], seenUrl: '', popups: [], downloads: [], queue: Promise.resolve(),
      attached: false, crashed: false, failed: null, emulated: null, looking: false, hookId: '', frozen: false, blank: !adopt, up: false,
      net: [], netIds: new Map(), netN: 0, rec: null, recDone: '', withheld: { n: 0, told: 0, files: [] },
    };
    this.tabs.set(id, tab);
    this.wire(tab, !adopt);
    // a page another one opened is on its way already
    if (url && !adopt) tab.ready.then(() => { if (!tab.wc.isDestroyed()) tab.wc.loadURL(url).catch(() => { /* said by did-fail-load */ }); });
    if (owner && (turn || !this.tabs.has(owner.current))) owner.current = id;
    this.changed();
    return tab;
  }

  /**
   * The size a page is laid out at while it is off the screen: the panel's page area, so what a chat reads there is
   * what the person will see; a chat's own page at least a laptop's screen (CHAT_SIZE). Shown, a page takes the area.
   */
  offSize(owner) {
    const area = this.rect ? { width: this.rect.width, height: this.rect.height } : DEFAULT_SIZE;
    return owner ? { width: Math.max(area.width, CHAT_SIZE.width), height: Math.max(area.height, CHAT_SIZE.height) } : area;
  }

  /** A page off the screen laid out at its size there (offSize). */
  fitOff(t) {
    if (t.page.isDestroyed() || t.page.isVisible() || t.looking) return;
    const { width, height } = this.offSize(t.owner);
    const [w, h] = t.page.getContentSize();
    if (w !== width || h !== height) t.page.setContentSize(width, height);
  }

  /** Room for one more page: a chat keeps at most PER_CHAT, all together at most TABS_MAX. What goes is what was used longest ago. */
  roomFor(owner) {
    const spare = (t) => t.id !== this.shown && !t.paused && t.owner;
    if (owner) {
      const its = [...this.tabs.values()].filter((t) => t.owner && t.owner.sid === owner.sid).sort((a, b) => a.used - b.used);
      while (its.length >= PER_CHAT) this.close(its.shift().id, 'the chat opened more pages than it keeps');
    }
    const all = [...this.tabs.values()].filter(spare).sort((a, b) => a.used - b.used);
    while (this.tabs.size >= TABS_MAX && all.length) this.close(all.shift().id, 'more pages were open than the browser keeps');
  }

  /** fresh: a page of its own, not one another page opened (that one is on its way to its address already). */
  wire(tab, fresh) {
    const wc = tab.wc;
    const touched = () => { tab.changedAt = Date.now(); this.changed(); };
    wc.setWindowOpenHandler(({ url }) => {
      if (url && url !== 'about:blank' && !SCHEMES.test(url)) return { action: 'deny' };
      if (this.stopsChat(tab, url)) return { action: 'deny' };
      // A page that opens another: it becomes a page of the same chat (or of the person), never a window of its own,
      // and stays tied to its opener, as a "Sign in with..." window that hands its answer back needs.
      return {
        action: 'allow',
        outlivesOpener: true,
        createWindow: (options) => {
          const t = this.make(tab.owner, url, options.webContents || null, tab.home, false);
          tab.popups.push(t.id);
          if (!tab.owner || tab.paused) this.command('browser', { show: t.id, quiet: true });
          return t.wc;
        },
      };
    });
    wc.on('did-start-navigation', (e) => {
      if (!e.isMainFrame || e.isSameDocument) return;
      tab.navAt = Date.now();
      tab.loading = true;
      tab.failed = null;
      touched();
    });
    wc.on('did-navigate', (_e, url) => {
      tab.url = url;
      // the empty page every page starts on is not a page to go back to
      if (tab.blank && url !== 'about:blank') {
        tab.blank = false;
        try { wc.navigationHistory.clear(); } catch { /* an Electron without it: Back leads to the empty page once */ }
      }
      touched();
    });
    wc.on('did-navigate-in-page', (_e, url, isMainFrame) => { if (isMainFrame) { tab.url = url; touched(); } });
    // a link or a script that leads to a file the browser never opens: the page stays where it is, and the chat is told
    wc.on('will-frame-navigate', (e) => {
      if (e.isMainFrame && this.stopsChat(tab, e.url)) { e.preventDefault(); touched(); return; }
      if (!secretFile(e.url)) return;
      e.preventDefault();
      tab.refused = { url: e.url, at: Date.now() };
      touched();
    });
    // a server that sends a chat's page on to a site of the ask-first list (a sign-in page, often)
    wc.on('will-redirect', (e) => { if (e.isMainFrame && this.stopsChat(tab, e.url)) { e.preventDefault(); touched(); } });
    wc.on('did-stop-loading', () => { tab.loading = false; touched(); });
    wc.on('page-title-updated', (_e, title) => { tab.title = title; this.changed(); });
    wc.on('page-favicon-updated', (_e, icons) => this.favicon(tab, icons));
    wc.on('did-fail-load', (_e, code, words, url, isMainFrame) => {
      // -3: the load was stopped for another one; not a failure
      if (!isMainFrame || code === -3) return;
      tab.failed = { code, words, url };
      tab.loading = false;
      touched();
    });
    wc.on('console-message', (e) => this.logged(tab, e));
    wc.on('render-process-gone', (_e, details) => {
      tab.crashed = details.reason !== 'clean-exit';
      tab.attached = false;
      this.log(`browser: page ${tab.id} went down (${details.reason})`);
      touched();
    });
    // A page that asks before it is left: a chat's page is left without a question; the person is asked, in words of
    // this app (the page's own are not shown by browsers any more).
    wc.on('will-prevent-unload', (event) => {
      if (this.answersItself(tab) || this.hidden) { event.preventDefault(); return; }
      const leave = dialog.showMessageBoxSync(this.win, { type: 'question', buttons: ['Leave', 'Stay'], defaultId: 0, cancelId: 1,
        message: 'Leave this page?', detail: 'It asks before it is left: what you changed on it may not be saved.' }) === 0;
      if (leave) event.preventDefault();
    });
    wc.on('context-menu', (_e, p) => { if (!this.synthetic(tab)) this.menu(tab, p); });
    // the person clicked into the page: the window's own page lost the keyboard to it, not to another program
    wc.on('focus', () => this.command('browser', { focus: tab.id }));
    wc.on('before-input-event', (event, input) => { if (!this.synthetic(tab)) this.keyFromPage(tab, event, input); });
    // closed from inside (a "Sign in with..." page closes itself when it is done)
    wc.on('destroyed', () => {
      if (this.tabs.get(tab.id) !== tab) return;
      this.recDrop(tab);
      this.tabs.delete(tab.id);
      try { if (!tab.page.isDestroyed()) tab.page.destroy(); } catch { /* gone already */ }
      if (this.shown === tab.id) this.shown = '';
      this.changed();
    });
    // The first address waits for this: the page's first document gets the hook for its boxes before its own scripts.
    // A page that has loaded nothing has no page process yet and leaves the debugger unanswered: it opens the empty page
    // first, which takes a few milliseconds.
    const blank = fresh ? within(wc.loadURL('about:blank'), LOAD_MS, 'The empty page').catch(() => {}) : Promise.resolve();
    tab.ready = blank.then(() => this.attach(tab)).catch((err) => this.log(`browser: debugger not attached to ${tab.id}: ${err.message}`));
  }

  /** The page answers its own questions: a chat drives it, or a chat has just acted on it. */
  answersItself(tab) {
    return Boolean(tab.owner && !tab.paused) || tab.autoUntil > Date.now();
  }

  /** What reaches the page now was sent by a chat, not typed or clicked by the person. */
  synthetic(tab) {
    return Date.now() - tab.synthAt < SYNTH_MS;
  }

  // ---- the ask-first list: the person's mail, files, accounts, payments and private messages ----

  /** The entry of the ask-first list an address falls under, or '' (none, or not a web address). */
  asked(url) {
    let u;
    try { u = new URL(String(url)); } catch { return ''; }
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return '';
    const host = u.hostname.toLowerCase().replace(/\.$/, '').replace(/^www\./, '');
    const where = u.pathname.toLowerCase();
    for (const e of this.askFirst()) {
      const cut = e.indexOf('/');
      const site = cut < 0 ? e : e.slice(0, cut);
      const under = cut < 0 ? '' : e.slice(cut);
      if (host !== site && !host.endsWith(`.${site}`)) continue;
      if (!under || where === under || where.startsWith(`${under}/`)) return e;
    }
    return '';
  }

  /** Whether the person let this chat open that entry of the list (in the Browser panel, until the app ends). */
  lets(owner, entry) {
    const mine = owner ? this.allowed.get(owner.sid) : null;
    return Boolean(mine && mine.has(entry));
  }

  /** The person's yes, from the button in the Browser panel. */
  allow(sid, entry) {
    if (typeof sid !== 'string' || !sid || typeof entry !== 'string' || !this.askFirst().includes(entry)) return false;
    if (!this.allowed.has(sid)) this.allowed.set(sid, new Set());
    this.allowed.get(sid).add(entry);
    this.log(`browser: the person let a chat open ${entry}`);
    return true;
  }

  /**
   * A chat's page (not one the person took over) about to go to a site of the ask-first list its chat was not let
   * open: it stays where it is, and the chat hears of it with its step.
   */
  stopsChat(tab, url) {
    if (!tab.owner || tab.paused) return false;
    const entry = this.asked(url);
    if (!entry || this.lets(tab.owner, entry)) return false;
    tab.refusedAsk = { url: String(url), entry, at: Date.now() };
    return true;
  }

  /**
   * A chat stopped at a site of the ask-first list: the Browser panel shows the person the ask on one of the chat's
   * pages (a new empty one when it has none), with a button that lets that chat in. What the chat is told.
   */
  askUser(owner, entry, tab = null) {
    const key = `${owner.sid}|${entry}`;
    if (Date.now() - (this.asks.get(key) || 0) > ASK_SHOWN_MS) {
      this.asks.set(key, Date.now());
      const page = tab || this.mine(owner, null, { need: false, look: true }) || this.make(owner);
      this.command('browser', { show: page.id, message: `wants to open ${entry}, on your ask-first list`, from: owner.name, allow: { sid: owner.sid, entry } });
      try { if (this.win.isVisible() && !this.win.isFocused()) this.win.flashFrame(true); } catch { /* no window */ }
    }
    return new Say(`${entry} is on the user's ask-first list (their mail, files, accounts, payments and private messages: Settings > Browser). A chat opens it only once the user allows it for that chat, with the button the Browser panel now shows them. Ask the user in the chat, wait for their yes, then try again.`);
  }

  /** How the page's boxes are answered, from its next document on and in the one it shows now. */
  async hook(tab) {
    if (tab.wc.isDestroyed()) return;
    const always = Boolean(tab.owner && !tab.paused);
    const answer = JSON.stringify({ accept: tab.answer.accept === true, text: typeof tab.answer.text === 'string' ? tab.answer.text : null });
    const source = `${HOOK}\nwindow.__lowlitAlways = ${always}; window.__lowlitAnswer = ${answer};`;
    const d = tab.wc.debugger;
    if (tab.hookId) await within(d.sendCommand('Page.removeScriptToEvaluateOnNewDocument', { identifier: tab.hookId }), STEP_MS, 'The page').catch(() => {});
    const r = await within(d.sendCommand('Page.addScriptToEvaluateOnNewDocument', { source }), STEP_MS, 'The page');
    tab.hookId = r && r.identifier ? r.identifier : '';
    await this.now(tab, `${source}\n0`);
  }

  /**
   * Runs code in the page's own world at once. Electron's webContents.executeJavaScript waits for a load to end first,
   * and for a page that has loaded nothing yet that wait never ends. undefined: nothing loaded yet, or no answer.
   */
  async now(tab, code) {
    if (tab.wc.isDestroyed() || !tab.wc.getURL()) return undefined;
    try { return await within(tab.wc.mainFrame.executeJavaScript(code, false), 4000, 'The page'); } catch { return undefined; }
  }

  /** The page's debugger, through which a chat's clicks and keys reach it whether or not the window has the focus. */
  async attach(tab) {
    if (tab.attached || tab.wc.isDestroyed()) return;
    const d = tab.wc.debugger;
    if (!d.isAttached()) d.attach('1.3');
    if (!tab.debugWired) {
      tab.debugWired = true;
      d.on('detach', () => { tab.attached = false; });
      d.on('message', (_e, method, params) => { if (method.startsWith('Network.')) this.netEvent(tab, method, params); });
    }
    tab.attached = true;
    await within(d.sendCommand('Page.enable'), STEP_MS, 'The page');
    await within(d.sendCommand('Network.enable', { maxTotalBufferSize: NET_BUFFER, maxResourceBufferSize: NET_BODY }), STEP_MS, 'The page');
    // the page believes it has the focus: menus that close on blur, fields that type only when focused, keep working
    await within(d.sendCommand('Emulation.setFocusEmulationEnabled', { enabled: true }), STEP_MS, 'The page');
    tab.hookId = '';
    await this.hook(tab);
  }

  async cdp(tab, method, params) {
    if (tab.wc.isDestroyed()) throw new Say('That page was closed.');
    if (!tab.attached) await this.attach(tab);
    const input = method.startsWith('Input.');
    if (input) tab.synthAt = Date.now();
    try {
      // a page that hangs (an endless script) never answers: the step ends instead of every later one waiting behind it
      return await within(tab.wc.debugger.sendCommand(method, params), STEP_MS, 'The page did not answer: it');
    } finally {
      if (input) tab.synthAt = Date.now();
    }
  }

  logged(tab, e) {
    const text = String(e.message || '');
    if (text.startsWith(DIALOG_MARK)) {
      try {
        const d = JSON.parse(text.slice(DIALOG_MARK.length));
        tab.dialogs.push({ ...d, at: Date.now() });
        if (tab.dialogs.length > 20) tab.dialogs.shift();
      } catch { /* not ours after all */ }
      return;
    }
    tab.logs.push({ at: Date.now(), level: e.level || 'info', text: clip(text, 2000), where: e.sourceId ? `${String(e.sourceId).split(/[?#]/)[0].split('/').pop()}:${e.lineNumber}` : '' });
    if (tab.logs.length > LOGS_KEPT) tab.logs.splice(0, tab.logs.length - LOGS_KEPT);
  }

  /** What a page sends and gets, as its debugger tells it: the newest NET_KEPT requests, for network. */
  netEvent(tab, method, p) {
    if (!p || !p.requestId) return;
    if (method === 'Network.requestWillBeSent') {
      const was = tab.netIds.get(p.requestId);
      // a redirect: the same request goes on to another address, and the hop before it is over
      if (was && p.redirectResponse) {
        Object.assign(was, { status: p.redirectResponse.status, statusText: p.redirectResponse.statusText || '', mime: p.redirectResponse.mimeType || '',
          resHeaders: p.redirectResponse.headers || {}, ms: Math.round((p.timestamp - was.t0) * 1000), done: true, to: p.request.url });
      }
      const r = { n: ++tab.netN, id: p.requestId, t0: p.timestamp, method: p.request.method, url: p.request.url, doc: p.documentURL || '', type: p.type || 'Other', reqHeaders: p.request.headers || {},
        body: p.request.hasPostData ? (p.request.postData ? Buffer.byteLength(p.request.postData) : -1) : 0,
        status: 0, statusText: '', mime: '', resHeaders: null, size: 0, ms: 0, done: false, failed: '', cache: false, to: '' };
      tab.netIds.set(p.requestId, r);
      tab.net.push(r);
      if (tab.net.length > NET_KEPT) {
        const gone = tab.net.shift();
        if (tab.netIds.get(gone.id) === gone) tab.netIds.delete(gone.id);
      }
      return;
    }
    const r = tab.netIds.get(p.requestId);
    if (!r) return;
    if (method === 'Network.responseReceived') {
      Object.assign(r, { status: p.response.status, statusText: p.response.statusText || '', mime: p.response.mimeType || '', resHeaders: p.response.headers || {}, type: p.type || r.type,
        cache: r.cache || Boolean(p.response.fromDiskCache || p.response.fromServiceWorker || p.response.fromPrefetchCache) });
    } else if (method === 'Network.requestServedFromCache') {
      r.cache = true;
    } else if (method === 'Network.loadingFinished') {
      Object.assign(r, { size: p.encodedDataLength || 0, ms: Math.round((p.timestamp - r.t0) * 1000), done: true });
    } else if (method === 'Network.loadingFailed') {
      Object.assign(r, { failed: p.canceled ? 'canceled' : p.blockedReason ? `blocked (${p.blockedReason})` : p.errorText || 'failed', type: p.type || r.type,
        ms: Math.round((p.timestamp - r.t0) * 1000), done: true });
    }
  }

  async favicon(tab, icons) {
    const url = Array.isArray(icons) ? icons.find((u) => /^(https?|data):/i.test(u)) : '';
    if (!url) return;
    try {
      if (url.startsWith('data:')) { if (url.length < 120000) tab.icon = url; this.changed(); return; }
      const res = await this.session().fetch(url);
      const type = (res.headers.get('content-type') || 'image/x-icon').split(';')[0];
      const buf = Buffer.from(await res.arrayBuffer());
      // the window's page shows pictures it was handed, never ones it fetches
      if (res.ok && buf.length && buf.length < 90000 && /^image\//.test(type)) { tab.icon = `data:${type};base64,${buf.toString('base64')}`; this.changed(); }
    } catch { /* no icon: the panel draws the site's first letter */ }
  }

  download(item, wc) {
    const tab = [...this.tabs.values()].find((t) => t.wc === wc);
    const name = String(item.getFilename() || 'download').replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').slice(0, 160) || 'download';
    let file = path.join(this.downloads, name);
    const ext = path.extname(name);
    for (let i = 2; fs.existsSync(file) && i < 500; i++) file = path.join(this.downloads, `${path.basename(name, ext)} (${i})${ext}`);
    item.setSavePath(file);
    const d = { file, url: item.getURL(), state: 'going', at: Date.now(), bytes: item.getTotalBytes() };
    if (tab) tab.downloads.push(d);
    item.once('done', (_e, state) => {
      d.state = state;
      if (tab) this.logged(tab, { level: state === 'completed' ? 'info' : 'warning', message: `download ${state}: ${file}` });
      this.changed();
    });
    this.changed();
  }

  menu(tab, p) {
    const items = [
      { label: 'Back', enabled: tab.wc.navigationHistory.canGoBack(), click: () => tab.wc.navigationHistory.goBack() },
      { label: 'Forward', enabled: tab.wc.navigationHistory.canGoForward(), click: () => tab.wc.navigationHistory.goForward() },
      { label: 'Reload', click: () => tab.wc.reload() },
      { type: 'separator' },
    ];
    if (p.linkURL && SCHEMES.test(p.linkURL)) {
      items.push({ label: 'Open the link in a new tab', click: () => { const t = this.make(tab.owner, p.linkURL, null, tab.home); this.command('browser', { show: t.id, quiet: true }); } });
      items.push({ label: 'Copy the link', click: () => clipboard.writeText(p.linkURL) });
    }
    if (p.selectionText) items.push({ label: 'Copy', role: 'copy' });
    if (p.isEditable) items.push({ label: 'Cut', role: 'cut' }, { label: 'Paste', role: 'paste' }, { label: 'Select all', role: 'selectAll' });
    items.push({ type: 'separator' }, { label: 'Open in your own browser', click: () => this.external(tab.id) },
      { label: 'Inspect', click: () => tab.wc.inspectElement(p.x, p.y) });
    Menu.buildFromTemplate(items).popup({ window: tab.page });
  }

  /** The window's own keys work with a page in front too. */
  keyFromPage(tab, event, input) {
    if (input.type !== 'keyDown') return;
    const ctrl = input.control && !input.alt && !input.meta;
    const k = input.code;
    // Alt+F4 in the page closes the app's window, as anywhere else in it, never the page's own window
    if (input.alt && !input.control && k === 'F4') { event.preventDefault(); if (!this.win.isDestroyed()) this.win.close(); return; }
    let what = '';
    if (ctrl && input.shift && k === 'KeyB') what = 'toggle';
    else if (ctrl && input.shift && k === 'KeyP') what = 'palette';
    else if (ctrl && !input.shift && k === 'KeyL') what = 'address';
    else if (ctrl && !input.shift && k === 'KeyT') what = 'new';
    else if (ctrl && !input.shift && k === 'KeyW') { this.close(tab.id, 'closed by the person'); event.preventDefault(); return; }
    else if ((ctrl && !input.shift && k === 'KeyR') || (k === 'F5' && !input.control)) { tab.wc.reload(); event.preventDefault(); return; }
    else if (input.alt && !input.control && k === 'ArrowLeft') { if (tab.wc.navigationHistory.canGoBack()) tab.wc.navigationHistory.goBack(); event.preventDefault(); return; }
    else if (input.alt && !input.control && k === 'ArrowRight') { if (tab.wc.navigationHistory.canGoForward()) tab.wc.navigationHistory.goForward(); event.preventDefault(); return; }
    if (!what) return;
    event.preventDefault();
    this.command('browser', { key: what, tab: tab.id });
  }

  close(id, why = '') {
    const tab = this.tabs.get(id);
    if (!tab) return false;
    this.recDrop(tab);
    this.tabs.delete(id);
    if (why) this.log(`browser: ${id} closed: ${why}`);
    const had = !tab.page.isDestroyed() && tab.page.isFocused();
    // the debugger lets go before its page goes
    try { if (!tab.wc.isDestroyed() && tab.wc.debugger.isAttached()) tab.wc.debugger.detach(); } catch { /* not attached */ }
    try { if (!tab.page.isDestroyed()) tab.page.destroy(); } catch { /* already closed */ }
    if (had && !this.win.isDestroyed() && this.win.isVisible()) this.win.focus();
    if (this.shown === id) this.shown = '';
    // the chats that were working in it work in none until they pick another
    for (const who of [tab.owner, tab.guest, ...[...this.tabs.values()].map((t) => t.guest)]) if (who && who.current === id) who.current = '';
    this.changed();
    return true;
  }

  closeAll() {
    for (const id of [...this.tabs.keys()]) this.close(id);
  }

  // ---- the panel ----

  /** What the window's page is told: every page, who drives it, and what it is doing. */
  view() {
    const who = (o) => (o ? { name: o.name || 'A chat', key: o.key || '', chat: o.chat || '' } : null);
    return {
      shown: this.shown,
      door: this.door ? { ...this.door } : null,
      tabs: [...this.tabs.values()].filter((t) => !t.wc.isDestroyed()).map((t) => ({
        id: t.id, title: t.title || t.wc.getTitle() || '', url: t.url, icon: t.icon, loading: t.loading,
        // whose browser it stands in: a chat's page in its chat's (that chat's session, while it runs elsewhere)
        home: t.owner ? (t.owner.chat || (t.owner.key ? `s:${t.owner.key}` : '')) : t.home,
        back: t.wc.navigationHistory.canGoBack(), forward: t.wc.navigationHistory.canGoForward(),
        owner: who(t.owner), guest: who(t.guest), busy: t.busy, last: t.last, paused: t.paused, acts: t.acts, made: t.made, used: t.used,
        crashed: t.crashed, failed: t.failed ? { words: t.failed.words, url: t.failed.url } : null, emulated: t.emulated, rec: Boolean(t.rec),
        downloads: t.downloads.slice(-3).map((d) => ({ name: path.basename(d.file), state: d.state })),
      })),
    };
  }

  changed() {
    if (this.timer) return;
    this.timer = setTimeout(() => { this.timer = null; this.sendView(this.view()); }, 60);
  }

  /**
   * Where the panel's page area is, whether it is open, and which page is in front. From the window's page, which says
   * it again every second: one of those can still arrive after the window is gone, while the app closes.
   */
  place(p) {
    if (!p || typeof p !== 'object' || this.win.isDestroyed()) return;
    const zoom = this.win.webContents.getZoomFactor() || 1;
    const ok = [p.x, p.y, p.width, p.height].every(Number.isFinite) && p.width > 20 && p.height > 20;
    const was = this.rect;
    if (ok) this.rect = { x: Math.round(p.x * zoom), y: Math.round(p.y * zoom), width: Math.round(p.width * zoom), height: Math.round(p.height * zoom) };
    if (typeof p.tab === 'string' && this.tabs.has(p.tab)) this.shown = p.tab;
    this.visible = Boolean(p.show && ok);
    this.layout();
    if (ok && (!was || was.width !== this.rect.width || was.height !== this.rect.height)) this.refit();
  }

  /**
   * A page that is not on screen follows the panel's size too (offSize: a chat's own page no narrower than a laptop's
   * screen), so it never keeps a size from before (seen 4 Oct: a page made while the window was still settling kept
   * it). The page in front of the open panel keeps the panel's size while it steps aside for a moment (the window
   * dragged, a dialog over it). A chat's own resize sits inside the page and stays.
   */
  refit() {
    clearTimeout(this.refitTimer);
    this.refitTimer = setTimeout(() => {
      this.refitTimer = null;
      if (this.win.isDestroyed() || !this.rect) return;
      for (const t of this.tabs.values()) if (!(t.id === this.shown && (this.visible || this.holding))) this.fitOff(t);
    }, REFIT_MS);
  }

  /**
   * The page in front of the open panel lies over its page area, on screen; every other page is off it. The page in
   * front takes the panel's size even where nothing may be shown (a window nobody sees: the self-test). up: this put
   * the page on screen; one found there that it did not put was shown from outside (see make), and the log says so.
   */
  layout() {
    if (this.win.isDestroyed()) return;
    const front = this.tabs.get(this.shown);
    const on = Boolean(front && this.visible && this.rect) && !this.holding && !this.hidden && this.win.isVisible() && !this.win.isMinimized();
    for (const t of this.tabs.values()) {
      if (t.page.isDestroyed()) continue;
      if (t === front && this.visible && this.rect && !this.holding && !t.looking) {
        const c = this.win.getContentBounds();
        const b = { x: c.x + this.rect.x, y: c.y + this.rect.y, width: this.rect.width, height: this.rect.height };
        const now = t.page.getBounds();
        if (now.x !== b.x || now.y !== b.y || now.width !== b.width || now.height !== b.height) t.page.setBounds(b);
      }
      if (t === front && on) {
        t.up = true;
        if (!t.page.isVisible()) {
          this.wake(t);
          t.page.showInactive();
        }
      } else if (t.page.isVisible()) {
        if (!t.up) this.log(`browser: ${t.id} was on screen though the panel did not show it (shown from outside, as Windows does when the window comes back from minimized): taken off`);
        t.up = false;
        // a page that leaves the screen gives the keyboard back to the app's window, and takes its size off the screen
        const had = t.page.isFocused();
        t.page.hide();
        if (had && this.win.isVisible()) this.win.focus();
        this.refit();
      } else t.up = false;
    }
  }

  /** The window's page is loading again: every page steps aside until it says where the panel is. */
  hide() {
    this.visible = false;
    this.layout();
  }

  /**
   * The app's window starts or stops being dragged or resized. Started: the panel is handed the page's picture, then
   * the page steps aside. Stopped: the page comes back where the panel is now.
   */
  async hold(on) {
    clearTimeout(this.holdTimer);
    if (!on) {
      if (!this.holding && !this.holdAsk) return;
      this.holdAsk = 0;
      this.holding = false;
      this.layout();
      return;
    }
    const front = this.visible && !this.hidden ? this.tabs.get(this.shown) : null;
    if (this.holding || this.holdAsk || !front) return;
    const ask = Date.now();
    this.holdAsk = ask;
    const pic = await this.still(front.id);
    if (this.holdAsk !== ask) return;
    this.holding = true;
    this.command('browser', { hold: true, still: pic, tab: front.id });
    this.layout();
    // a drag that never says it ended
    this.holdTimer = setTimeout(() => this.hold(false), 20000);
  }

  /**
   * A page off the screen draws one frame a second from the moment a text field in it takes input (Chromium, in a
   * window nobody sees); a picture of one pixel brings it back to full speed, and it stays there.
   */
  async nudge(tab) {
    if (tab.wc.isDestroyed() || tab.page.isDestroyed() || tab.page.isVisible()) return;
    await within(tab.wc.capturePage({ x: 0, y: 0, width: 1, height: 1 }), 2000, 'A picture').catch(() => {});
  }

  /** A page that rests (frozen) is woken before it is used or shown. */
  async wake(tab) {
    if (!tab.frozen || tab.wc.isDestroyed()) return;
    tab.frozen = false;
    await within(tab.wc.debugger.sendCommand('Page.setWebLifecycleState', { state: 'active' }), STEP_MS, 'The page').catch(() => {});
  }

  /** A picture of a page as it is, for the panel to show while it moves: a JPEG, a tenth of the PNG's size. */
  async still(id) {
    const tab = this.tabs.get(id);
    if (!tab || tab.wc.isDestroyed()) return '';
    await this.wake(tab);
    try {
      const img = await within(tab.wc.capturePage(), 4000, 'A picture');
      return img.isEmpty() ? '' : `data:image/jpeg;base64,${img.toJPEG(82).toString('base64')}`;
    } catch { return ''; }
  }

  // ---- what the person does in the panel ----

  /** The person's own: a page they open from the panel, the address bar, the buttons. */
  ask(what, a, b) {
    const tab = typeof a === 'string' ? this.tabs.get(a) : null;
    switch (what) {
      case 'view': return this.view();
      case 'place': this.place(a); return true;
      case 'still': return this.still(a);
      case 'open': {
        let url = '';
        try { url = a ? address(a) : 'about:blank'; } catch (err) { return { error: err.message }; }
        const t = this.make(null, url, null, typeof b === 'string' ? b : '');
        this.shown = t.id;
        this.changed();
        return { id: t.id };
      }
      case 'go': {
        if (!tab) return { error: 'That page was closed.' };
        let url;
        try { url = address(b); } catch (err) { return { error: err.message }; }
        tab.wc.loadURL(url).catch(() => {});
        tab.used = Date.now();
        return { id: tab.id };
      }
      case 'back': if (tab && tab.wc.navigationHistory.canGoBack()) tab.wc.navigationHistory.goBack(); return true;
      case 'forward': if (tab && tab.wc.navigationHistory.canGoForward()) tab.wc.navigationHistory.goForward(); return true;
      case 'reload': if (tab) { if (tab.crashed) { tab.crashed = false; tab.wc.loadURL(tab.url).catch(() => {}); } else tab.wc.reload(); } return true;
      case 'stop': if (tab) tab.wc.stop(); return true;
      case 'close': return this.close(a, 'closed by the person');
      // taken over, a chat's page shows its own boxes to the person again; handed back, it answers them itself
      case 'pause': if (tab) { tab.paused = Boolean(b); this.hook(tab).catch(() => {}); this.changed(); } return true;
      case 'external': return this.external(a);
      // the page back at the panel's size: its button, or the person's drag of the panel's edge (b = 'panel')
      case 'fit': return this.fit(a, b === 'panel' ? 'resized the Browser panel' : 'pressed "Fit to the panel"');
      // the person's yes to a chat that asked for a site of the ask-first list: a = its session, b = the site
      case 'allow': return this.allow(a, b);
      // a window nobody sees is never brought up by a page taking the keyboard
      case 'focus': if (tab && this.visible && this.shown === a && !this.hidden && tab.page.isVisible()) { tab.page.focus(); tab.wc.focus(); } return true;
      case 'forget': return this.forget();
      default: return null;
    }
  }

  external(id) {
    const tab = this.tabs.get(id);
    if (!tab || !/^https?:/i.test(tab.url)) return false;
    shell.openExternal(tab.url).catch(() => {});
    return true;
  }

  async forget() {
    const ses = this.session();
    await ses.clearStorageData();
    await ses.clearCache();
    await ses.clearAuthCache();
    return true;
  }

  // ---- what a chat does: each step on a page waits for the one before it on the same page ----

  /**
   * The page a chat means: the one it names (its own, or one of the person's), else the one it used last. owner: the
   * chat, as browser-mcp.cjs keeps it ({ sid, name, key, chat, current, acts }). look: only looked up, the chat does not
   * turn to it. A page on a site of the ask-first list is not the chat's to read or touch until the person lets it;
   * free: it may all the same (to show it to the person, or to go somewhere else from it).
   */
  mine(owner, id, { need = true, acting = false, look = false, free = false } = {}) {
    let tab = null;
    if (id) {
      tab = this.tabs.get(String(id).trim());
      if (!tab) throw new Say(`There is no page ${id}. tabs with action "list" names the pages this chat can use.`);
      if (tab.owner && tab.owner.sid !== owner.sid) throw new Say(`${id} belongs to another chat (${tab.owner.name}). Open a page of your own with navigate.`);
    } else {
      tab = this.tabs.get(owner.current) || null;
      if (!tab) {
        const own = [...this.tabs.values()].filter((t) => t.owner && t.owner.sid === owner.sid).sort((a, b) => b.used - a.used);
        tab = own[0] || null;
      }
    }
    if (!tab) {
      if (need) throw new Say('No page is open for this chat yet: call navigate with an address first.');
      return null;
    }
    if (acting && tab.paused) throw new Say(`The user took ${tab.id} over in the Browser panel: this chat's clicks and keys stop there until the user hands it back. Wait, or ask in the chat.`);
    if (look) return tab;
    const entry = free ? '' : this.asked(tab.wc.isDestroyed() ? tab.url : tab.wc.getURL() || tab.url);
    if (entry && !this.lets(owner, entry)) throw this.askUser(owner, entry, tab);
    owner.current = tab.id;
    if (!tab.owner) tab.guest = owner;
    return tab;
  }

  /** Runs one step of a chat on a page, after the steps already waiting there. words: what the panel says it is doing. */
  step(owner, tab, words, fn) {
    const run = async () => {
      await tab.ready;
      if (tab.wc.isDestroyed()) throw new Say('That page was closed.');
      await this.wake(tab);
      await this.nudge(tab);
      if (tab.crashed) {
        tab.crashed = false;
        await within(tab.wc.loadURL(tab.url).catch(() => {}), LOAD_MS, 'Loading the page again');
      }
      tab.busy = words;
      tab.used = Date.now();
      tab.acts++;
      if (owner) owner.acts = (owner.acts || 0) + 1;
      this.changed();
      const started = Date.now();
      // what the panel says it did: the words the step settled on once it knew what it was clicking or typing into
      try {
        let out = await fn(started);
        // a step that led the page onto a site of the ask-first list (a link, a script, back) hands nothing of it back
        const entry = owner && !tab.wc.isDestroyed() ? this.asked(tab.wc.getURL()) : '';
        if (entry && !this.lets(owner, entry)) {
          this.askUser(owner, entry, tab);
          out = { text: `Done; page ${tab.id} is now on ${entry}, which is on the user's ask-first list (their mail, files, accounts, payments and private messages): nothing of it is handed to this chat until the user allows it, with the button the Browser panel now shows them. Ask the user in the chat, or navigate elsewhere.` };
        }
        tab.last = { words: tab.busy || words, at: Date.now(), ok: true, who: owner ? owner.name : '' };
        return out;
      } catch (err) {
        tab.last = { words: tab.busy || words, at: Date.now(), ok: false, who: owner ? owner.name : '' };
        throw err;
      } finally {
        // a recording takes the page as each step left it
        if (tab.rec) await this.recFrame(tab, { fresh: true });
        tab.busy = '';
        tab.changedAt = Date.now();
        this.changed();
      }
    };
    const p = tab.queue.then(run, run);
    tab.queue = p.catch(() => {});
    return p;
  }

  /** Runs the part of browser-look.cjs named `fn` inside the page. */
  async inPage(tab, fn, ...args) {
    if (!tab.wc.getURL()) throw new Say('The page is empty (nothing was opened in it yet): navigate goes somewhere in it.');
    const code = `(globalThis.__lowlit ||= ${LOOK}).${fn}(${args.map((a) => JSON.stringify(a === undefined ? null : a)).join(',')})`;
    try {
      return await within(tab.wc.executeJavaScriptInIsolatedWorld(WORLD, [{ code }], fn === 'act'), STEP_MS, 'Reading the page');
    } catch (err) {
      if (err instanceof Say) throw err;
      throw new Say(`The page could not be read: ${clip(String(err && err.message || err), 200)}`);
    }
  }

  /** The page answers questions without a box for the next moment: a chat is acting. */
  async auto(tab) {
    tab.autoUntil = Date.now() + AUTO_MS;
    const a = JSON.stringify({ accept: tab.answer.accept === true, text: typeof tab.answer.text === 'string' ? tab.answer.text : null });
    await this.now(tab, `window.__lowlitAuto = Date.now() + ${AUTO_MS}; window.__lowlitAnswer = ${a}; 0`);
  }

  /** After a click or a key: the load it started, if it started one, else the moment the page stops changing. */
  async after(tab, started) {
    await this.nudge(tab);
    await wait(120);
    if (tab.navAt >= started || tab.wc.isLoading()) {
      await this.loaded(tab, LOAD_MS);
      // a page built by its scripts goes on drawing after it has loaded
      await this.inPage(tab, 'settle', 900, 150).catch(() => {});
    } else {
      await this.inPage(tab, 'settle', 1500, 180).catch(() => {});
    }
  }

  /** Until the page has loaded, or `ms` has gone by: false then. */
  loaded(tab, ms) {
    const wc = tab.wc;
    return new Promise((done) => {
      if (wc.isDestroyed()) { done(false); return; }
      let over = false;
      const end = (ok) => {
        if (over) return;
        over = true;
        clearTimeout(cap);
        clearInterval(look);
        if (!wc.isDestroyed()) wc.off('did-stop-loading', stop);
        done(ok);
      };
      const idle = () => wc.isDestroyed() || !wc.isLoading();
      const stop = () => setTimeout(() => { if (idle()) end(true); }, 80);
      const cap = setTimeout(() => end(false), ms);
      // a load that ended before this was asked, or between two of its events
      const look = setInterval(() => { if (idle()) end(true); }, 250);
      wc.on('did-stop-loading', stop);
    });
  }

  async clickAt(tab, x, y, { button = 'left', count = 1 } = {}) {
    const mask = button === 'left' ? 1 : button === 'right' ? 2 : 4;
    await this.cdp(tab, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none' });
    for (let i = 1; i <= count; i++) {
      await this.cdp(tab, 'Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button, buttons: mask, clickCount: i });
      await this.cdp(tab, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button, buttons: 0, clickCount: i });
    }
  }

  async press(tab, k) {
    const base = { modifiers: k.modifiers, windowsVirtualKeyCode: k.vk, nativeVirtualKeyCode: k.vk, code: k.code, key: k.key };
    await this.cdp(tab, 'Input.dispatchKeyEvent', { ...base, type: k.text ? 'keyDown' : 'rawKeyDown', text: k.text || undefined, unmodifiedText: k.text || undefined });
    await this.cdp(tab, 'Input.dispatchKeyEvent', { ...base, type: 'keyUp' });
  }

  /** Where an element is, ready for a click: scrolled into sight, with what would take the click instead. */
  async target(tab, ref) {
    if (!ref) throw new Say('Say which element, by the ref the snapshot gave it (for example e12).');
    const p = await this.inPage(tab, 'point', String(ref));
    if (!p || p.gone) throw new Say(`${ref} is no longer on the page (or never was). Take a new snapshot and use the refs it gives.`);
    return p;
  }

  /** The person sees where a chat clicks, while they are watching that page or it is being recorded. */
  async ringAt(tab, x, y) {
    if ((this.visible && this.shown === tab.id) || tab.rec) await this.inPage(tab, 'ring', x, y, Boolean(tab.rec)).catch(() => {});
  }

  /** A file on this computer a page asked for and was not given: the chat hears of it with its next step on the page. */
  withhold(wcId, url) {
    const tab = [...this.tabs.values()].find((t) => !t.wc.isDestroyed() && t.wc.id === wcId);
    if (!tab) return;
    const kept = tab.withheld;
    kept.n++;
    if (kept.files.length >= 3) return;
    let file = url;
    try { file = fileURLToPath(url); } catch { /* an address that is no path is said as it came */ }
    kept.files.push(file);
  }

  /**
   * What a step hands back: what it did, the page it is on, and what changed on it (the whole outline after a new
   * page, or when asked for). The outline is kept, to tell the next change. shape: how a whole page is handed back:
   * 'full', 'summary' (its headings and what is on it), 'none', or 'auto' (whole when short, else the summary); by
   * default 'full' when asked for (full), 'auto' for a page a step led to. keys: say where the keyboard is, even nowhere.
   */
  async report(tab, said, { full = false, started = 0, find = '', shape = '', keys = false } = {}) {
    let o;
    try {
      o = await this.inPage(tab, 'outline', { max: OUTLINE_MAX, find });
    } catch (err) {
      const loading = tab.wc.isLoading();
      if (loading || !tab.wc.getURL()) o = { url: tab.wc.getURL() || 'about:blank', title: tab.wc.getTitle(), lines: [], cut: false, loading, scroll: null, dialog: false, focused: '' };
      else throw err;
    }
    const out = [];
    if (said) out.push(said);
    if (tab.fitted) { out.push(tab.fitted); tab.fitted = ''; }
    out.push(`Page ${tab.id}: ${o.title ? `"${clip(o.title, 120)}" ` : ''}${o.url}`);
    if (tab.failed) out.push(`It did not load: ${tab.failed.words} (${tab.failed.code}).`);
    if (tab.refused && started && tab.refused.at >= started) {
      out.push(`It tried to open ${clip(tab.refused.url, 120)}, a file the browser never opens (in a folder whose name starts with a dot, in AppData or on another computer, or one that holds keys): the page stayed where it was.`);
    }
    if (tab.refusedAsk && started && tab.refusedAsk.at >= started) {
      const { entry } = tab.refusedAsk;
      if (tab.owner) this.askUser(tab.owner, entry, tab);
      out.push(`It tried to go to ${entry}, which is on the user's ask-first list (their mail, files, accounts, payments and private messages): the page stayed where it was. The Browser panel shows the user your ask, with a button to allow it for this chat; ask the user in the chat.`);
    }
    const kept = tab.withheld;
    if (kept.n > kept.told) {
      const n = kept.n - kept.told;
      out.push(`The page asked for ${n} file${n === 1 ? '' : 's'} on this computer that it was not given (${kept.files.map((f) => clip(f, 120)).join(', ')}${n > kept.files.length ? ', …' : ''}): the browser never hands a page a file in a folder whose name starts with a dot, in AppData or on another computer, or one that holds keys, so what the page shows from ${n === 1 ? 'it' : 'them'} stays empty.`);
      kept.told = kept.n;
      kept.files = [];
    }
    if (o.loading) out.push('It is still loading: call snapshot again in a moment.');
    for (const d of tab.dialogs.filter((x) => x.at >= started && started)) {
      out.push(d.type === 'alert' ? `The page said, in a box: "${d.message}" (closed).`
        : `The page asked "${d.message}" (${d.type}) and was answered ${d.answer === true ? 'yes' : d.answer === false || d.answer === null ? 'no' : `"${d.answer}"`}${d.answer !== true ? '. To answer yes, call dialog with accept true, then do it again' : ''}.`);
    }
    for (const id of tab.popups.splice(0)) {
      const t = this.tabs.get(id);
      const entry = t ? this.asked(t.url) : '';
      const hide = entry && !this.lets(tab.owner || tab.guest, entry);
      if (t) out.push(`It opened a new page, ${id}: ${hide ? `a page on ${entry}, on the user's ask-first list` : t.url}. This chat still works in ${tab.id}: tabs with action "select" and tab "${id}" turns to the new one.`);
    }
    const errors = tab.logs.filter((l) => l.at >= started && started && l.level === 'error').slice(-3);
    if (errors.length) out.push(`Errors in its console: ${errors.map((l) => clip(l.text, 160)).join(' | ')}`);
    const fresh = tab.downloads.filter((d) => d.at >= started && started);
    for (const d of fresh) out.push(`A download started: ${d.file}`);
    if (o.dialog) out.push('A dialog is open over the page.');
    if (o.focused) out.push(`The keyboard is in: ${o.focused}.`);
    else if (keys) out.push('The keyboard is in no field: on the page itself.');
    if (o.scroll && o.scroll.height > o.scroll.view + 4) out.push(`Scrolled to ${o.scroll.y} of ${o.scroll.height - o.scroll.view} pixels; the window shows ${o.scroll.width}×${o.scroll.view}.`);
    const newPage = o.url !== tab.seenUrl;
    if (find) {
      out.push(o.lines.length ? `What matches "${find}" (with what it sits in):` : `Nothing on the page matches "${find}".`);
      out.push(...o.lines);
      if (o.cut) out.push('… more matches than fit: say more words.');
    } else if (full || newPage || !tab.lines.length) {
      const want = shape || (full ? 'full' : 'auto');
      const size = o.lines.reduce((n, l) => n + l.length + 1, 0);
      if (want === 'none') {
        out.push(`(Its outline is not handed back: ${o.lines.length}${o.cut ? ' lines and more' : ' lines'}. snapshot reads it.)`);
      } else if (want === 'summary' || (want === 'auto' && (o.cut || size > AUTO_OUTLINE))) {
        out.push(...this.summary(o, size));
      } else {
        out.push(...o.lines);
        if (o.cut) out.push('… the page goes on beyond this. snapshot with find gives the parts that hold some words.');
        if (!o.lines.length && !o.loading) out.push('(The page shows nothing that can be read as text: a screenshot shows it.)');
      }
    } else {
      const before = new Map();
      for (const l of tab.lines) before.set(l, (before.get(l) || 0) + 1);
      const added = [];
      for (const l of o.lines) {
        const n = before.get(l) || 0;
        if (n) before.set(l, n - 1); else added.push(l);
      }
      let gone = 0;
      for (const n of before.values()) gone += n;
      if (!added.length && !gone) out.push('Nothing on the page changed.');
      else {
        if (added.length) {
          out.push(`What is new on the page (${added.length} line${added.length === 1 ? '' : 's'}):`);
          out.push(...added.slice(0, CHANGES_MAX).map((l) => l.trimStart()));
          if (added.length > CHANGES_MAX) out.push(`… and ${added.length - CHANGES_MAX} more: snapshot shows the whole page.`);
        }
        if (gone) out.push(`${gone} line${gone === 1 ? '' : 's'} went away.`);
      }
    }
    if (!find) {
      tab.lines = o.lines;
      tab.seenUrl = o.url;
    }
    return { text: out.join('\n') };
  }

  /** A long page in a few lines: how long its outline is, its headings, and how much on it can be clicked or typed into. */
  summary(o, size) {
    const count = (re) => o.lines.filter((l) => re.test(l)).length;
    const heads = o.lines.filter((l) => /^\s*- heading /.test(l)).map((l) => l.trim());
    const parts = [[count(/^\s*- link /), 'link'], [count(/^\s*- (button|clickable)\b/), 'button'],
      [count(/^\s*- (textbox|searchbox|combobox|listbox|checkbox|radio|switch|slider|spinbutton)\b/), 'field'], [count(/^\s*- form\b/), 'form']]
      .filter(([n]) => n).map(([n, w]) => `${n} ${w}${n === 1 ? '' : 's'}`);
    return [
      `The page is long (${o.lines.length.toLocaleString('en-US')}${o.cut ? ' lines and more' : ' lines'} of outline, ${size.toLocaleString('en-US')} characters): only its summary is here. snapshot hands back the whole outline; snapshot with find, only the lines that hold some words, with their refs.`,
      ...(heads.length ? [`Its headings${heads.length > 25 ? ', the first 25' : ''}:`, ...heads.slice(0, 25)] : ['It has no headings.']),
      ...(parts.length ? [`On it: ${parts.join(', ')}.`] : []),
    ];
  }

  // ---- the tools, one by one (browser-mcp.cjs describes them to Claude Code) ----

  async navigate(owner, { url, new_tab: fresh, outline = 'auto' } = {}) {
    const where = String(url || '').trim();
    const shape = ['auto', 'summary', 'full', 'none'].includes(outline) ? outline : 'auto';
    const move = /^(back|forward|reload)$/i.test(where) ? where.toLowerCase() : '';
    if (move) {
      const tab = this.mine(owner, null, { acting: true, free: move !== 'reload' });
      return this.step(owner, tab, `going ${move}`, async (started) => {
        const h = tab.wc.navigationHistory;
        if (move === 'back' && !h.canGoBack()) throw new Say('There is no page before this one.');
        if (move === 'forward' && !h.canGoForward()) throw new Say('There is no page after this one.');
        await this.auto(tab);
        if (move === 'back') h.goBack(); else if (move === 'forward') h.goForward(); else tab.wc.reload();
        await wait(150);
        await this.loaded(tab, LOAD_MS);
        return this.report(tab, `Went ${move}.`, { full: true, started, shape });
      });
    }
    const target = address(where);
    const entry = this.asked(target);
    if (entry && !this.lets(owner, entry)) throw this.askUser(owner, entry);
    const before = this.tabs.has(owner.current) ? owner.current : '';
    // going somewhere else from a page of the ask-first list reads nothing of it
    let tab = fresh ? null : this.mine(owner, null, { need: false, acting: true, free: true });
    const made = !tab;
    if (!tab) tab = this.make(owner);
    if (made && this.popOpen) this.command('browser', { show: tab.id, quiet: true });
    const turned = made && before && before !== tab.id ? ` This chat now works in ${tab.id}: steps without a tab go there (${before} stays open).` : '';
    return this.step(owner, tab, `opening ${clip(target, 60)}`, async (started) => {
      await this.auto(tab);
      tab.failed = null;
      let slow = '';
      try {
        await within(tab.wc.loadURL(target), LOAD_MS, 'The page');
      } catch (err) {
        // ERR_ABORTED: the page sent itself on somewhere else before it had loaded; that load is waited for
        if (err instanceof Say) slow = ` It was still loading after ${LOAD_MS / 1000} s: below is what it shows so far.`;
        else if (String(err && err.code) === 'ERR_ABORTED') await this.loaded(tab, LOAD_MS);
        else if (!tab.failed) tab.failed = { code: err.errno || 0, words: String(err.code || err.message || 'failed'), url: target };
      }
      await this.inPage(tab, 'settle', 800, 150).catch(() => {});
      return this.report(tab, `${made ? `Opened ${target} in a new page, ${tab.id}.${turned}` : `Went to ${target}.`}${slow}`, { full: true, started, shape });
    });
  }

  async snapshot(owner, { find = '', tab: id } = {}) {
    const tab = this.mine(owner, id);
    return this.step(owner, tab, find ? `reading the page for "${clip(find, 40)}"` : 'reading the page', () => this.report(tab, '', { full: true, find: String(find || '').trim() }));
  }

  async click(owner, { ref, double = false, button = 'left', tab: id } = {}) {
    const tab = this.mine(owner, id, { acting: true });
    if (!['left', 'right', 'middle'].includes(button)) throw new Say('button is left, right or middle.');
    return this.step(owner, tab, `clicking ${ref}`, async (started) => {
      const p = await this.target(tab, ref);
      tab.busy = `clicking ${p.what}`;
      this.changed();
      if (p.covered) throw new Say(`${p.what} is covered by ${p.covered}, which would take the click. Close or move that first (often a cookie banner or a dialog), or press Escape.`);
      await this.auto(tab);
      let how = '';
      if (p.zero || p.outside) {
        await this.inPage(tab, 'act', String(ref), 'click');
        how = p.zero ? ' (it has no size on screen, so it was clicked from inside the page)'
          : ' (no part of it could be brought into the window, so it was clicked from inside the page)';
      } else {
        await this.ringAt(tab, p.x, p.y);
        await this.clickAt(tab, p.x, p.y, { button, count: double ? 2 : 1 });
        // the ring is gone within a second of the click: a recording takes it while it shows
        if (tab.rec) { await wait(90); await this.recFrame(tab, { fresh: true }); }
      }
      await this.after(tab, started);
      return this.report(tab, `${double ? 'Double-clicked' : button === 'left' ? 'Clicked' : `${button[0].toUpperCase()}${button.slice(1)}-clicked`} ${p.what}${how}.`, { started, keys: true });
    });
  }

  async hover(owner, { ref, tab: id } = {}) {
    const tab = this.mine(owner, id, { acting: true });
    return this.step(owner, tab, `pointing at ${ref}`, async (started) => {
      const p = await this.target(tab, ref);
      if (p.zero) throw new Say(`${p.what} has no size on screen: there is nothing to point at.`);
      await this.cdp(tab, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x, y: p.y, button: 'none' });
      await this.inPage(tab, 'settle', 800, 150).catch(() => {});
      return this.report(tab, `The pointer is on ${p.what}${p.covered ? ` (under ${p.covered})` : ''}.`, { started });
    });
  }

  async type(owner, { ref, text = '', submit = false, slowly = false, clear = true, tab: id } = {}) {
    const tab = this.mine(owner, id, { acting: true });
    const words = String(text);
    return this.step(owner, tab, `typing into ${ref}`, async (started) => {
      const e = await this.inPage(tab, 'act', String(ref), 'editable');
      if (!e || e.gone) throw new Say(`${ref} is no longer on the page. Take a new snapshot and use the refs it gives.`);
      if (e.file) throw new Say(`${e.what} picks a file: use upload_file.`);
      if (!e.ok) throw new Say(`${e.what} is not a field to type into. Click it, or use press_key to type wherever the keyboard is.`);
      tab.busy = `typing into ${e.what}`;
      this.changed();
      await this.auto(tab);
      const p = await this.target(tab, ref);
      if (!p.zero && !p.outside && !p.covered) {
        await this.ringAt(tab, p.x, p.y);
        await this.clickAt(tab, p.x, p.y);
      } else {
        await this.inPage(tab, 'act', String(ref), 'focus');
      }
      if (clear) await this.inPage(tab, 'act', String(ref), 'select-all');
      if (slowly) {
        for (const ch of words) {
          if (ch === '\n') await this.press(tab, keyOf('Enter'));
          else {
            await this.cdp(tab, 'Input.dispatchKeyEvent', { type: 'keyDown', key: ch, text: ch, unmodifiedText: ch });
            await this.cdp(tab, 'Input.dispatchKeyEvent', { type: 'keyUp', key: ch });
          }
          await wait(25);
        }
      } else if (words) {
        await this.cdp(tab, 'Input.insertText', { text: words });
      } else if (clear) {
        await this.press(tab, keyOf('Backspace'));
      }
      const now = await this.inPage(tab, 'act', String(ref), 'value').catch(() => null);
      if (submit) {
        await this.auto(tab);
        await this.press(tab, keyOf('Enter'));
      }
      await this.after(tab, started);
      const holds = now && now.ok && typeof now.value === 'string' ? ` It now holds "${clip(now.value, 120)}".` : '';
      return this.report(tab, `Typed ${words.length} character${words.length === 1 ? '' : 's'} into ${e.what}.${holds}${submit ? ' Then pressed Enter.' : ''}`, { started, keys: true });
    });
  }

  async pressKey(owner, { key, tab: id } = {}) {
    const tab = this.mine(owner, id, { acting: true });
    const k = keyOf(key);
    return this.step(owner, tab, `pressing ${key}`, async (started) => {
      await this.auto(tab);
      await this.press(tab, k);
      await this.after(tab, started);
      return this.report(tab, `Pressed ${key}.`, { started, keys: true });
    });
  }

  async selectOption(owner, { ref, values, tab: id } = {}) {
    const tab = this.mine(owner, id, { acting: true });
    const list = (Array.isArray(values) ? values : [values]).filter((v) => v !== undefined && v !== null).map(String);
    if (!list.length) throw new Say('Say which choice: values holds the words shown, or the value behind them.');
    return this.step(owner, tab, `picking ${clip(list.join(', '), 40)}`, async (started) => {
      await this.auto(tab);
      const r = await this.inPage(tab, 'act', String(ref), 'options', list);
      if (!r || r.gone) throw new Say(`${ref} is no longer on the page. Take a new snapshot and use the refs it gives.`);
      if (!r.ok) throw new Say(`${r.why}.`);
      await this.after(tab, started);
      return this.report(tab, `Picked ${r.picked.map((x) => `"${x}"`).join(', ')}.`, { started });
    });
  }

  async scroll(owner, { direction = 'down', amount, ref, tab: id } = {}) {
    const tab = this.mine(owner, id, { acting: true });
    const dir = String(direction).toLowerCase();
    if (!['up', 'down', 'left', 'right'].includes(dir)) throw new Say('direction is up, down, left or right.');
    return this.step(owner, tab, `scrolling ${dir}`, async (started) => {
      const size = (await this.now(tab, '[innerWidth, innerHeight]')) || [1280, 800];
      const by = Number.isFinite(Number(amount)) && Number(amount) > 0 ? Number(amount) : Math.round((dir === 'up' || dir === 'down' ? size[1] : size[0]) * 0.8);
      const dx = dir === 'left' ? -by : dir === 'right' ? by : 0;
      const dy = dir === 'up' ? -by : dir === 'down' ? by : 0;
      const r = await this.inPage(tab, 'scroll', { ref: ref ? String(ref) : '', dx, dy });
      if (r && r.gone) throw new Say(`${ref} is no longer on the page.`);
      await this.inPage(tab, 'settle', 1200, 200).catch(() => {});
      const where = r && r.height > r.view ? ` Now at ${r.y} of ${r.height - r.view} pixels.` : '';
      return this.report(tab, r && r.moved ? `Scrolled ${r.what} ${dir} by ${by} pixels.${where}` : `${r ? r.what : 'The page'} did not move: it is at its ${dir === 'up' || dir === 'left' ? 'start' : 'end'} already, or cannot scroll.`, { started });
    });
  }

  async screenshot(owner, { ref, tab: id } = {}) {
    const tab = this.mine(owner, id);
    return this.step(owner, tab, 'looking at the page', async () => {
      let rect;
      if (ref) {
        const b = await this.inPage(tab, 'act', String(ref), 'box');
        if (!b || b.gone || !b.ok) throw new Say(`${ref} is no longer on the page.`);
        const size = (await this.now(tab, '[innerWidth, innerHeight]')) || [1280, 800];
        const x = Math.max(0, b.box.x);
        const y = Math.max(0, b.box.y);
        rect = { x, y, width: Math.max(1, Math.min(size[0] - x, b.box.width)), height: Math.max(1, Math.min(size[1] - y, b.box.height)) };
        await wait(120);
      }
      // a hidden window can hand back the frame from before the last change: a moment later, another is asked for
      let img = await within(tab.wc.capturePage(rect), 8000, 'The picture');
      if (img.isEmpty() || Date.now() - tab.changedAt < 600) { await wait(220); img = await within(tab.wc.capturePage(rect), 8000, 'The picture'); }
      if (img.isEmpty()) throw new Say('The page gave no picture: it may still be loading. Try again in a moment.');
      const size = img.getSize();
      if (size.width > SHOT_WIDTH) img = img.resize({ width: SHOT_WIDTH, quality: 'good' });
      const shot = img.getSize();
      return {
        text: `A picture of ${ref ? String(ref) : `page ${tab.id}`} as it is now (${shot.width}×${shot.height}): ${tab.title ? `"${clip(tab.title, 80)}" ` : ''}${tab.url}`,
        image: { data: img.toJPEG(74).toString('base64'), mimeType: 'image/jpeg' },
      };
    });
  }

  async tabsTool(owner, { action = 'list', tab: id, url } = {}) {
    const act = String(action).toLowerCase();
    if (act === 'new') {
      const target = url ? address(url) : 'about:blank';
      const entry = this.asked(target);
      if (entry && !this.lets(owner, entry)) throw this.askUser(owner, entry);
      const tab = this.make(owner, target === 'about:blank' ? '' : target);
      if (target !== 'about:blank') return this.step(owner, tab, 'opening a page', async (started) => {
        await this.loaded(tab, LOAD_MS);
        return this.report(tab, `Opened ${tab.id}; this chat now works in it.`, { full: true, started, shape: 'auto' });
      });
      return { text: `Opened ${tab.id}, empty; this chat now works in it: navigate goes somewhere in it.` };
    }
    if (act === 'select') {
      const tab = this.mine(owner, id);
      return this.step(owner, tab, 'turning to the page', () => this.report(tab, `This chat now works in ${tab.id}.`, { full: true }));
    }
    if (act === 'close') {
      const tab = this.mine(owner, id, { look: true });
      if (!tab.owner) throw new Say(`${tab.id} is the user's own page: only the user closes it.`);
      this.close(tab.id, 'closed by its chat');
      return { text: `Closed ${tab.id}.` };
    }
    if (act !== 'list') throw new Say('action is list, new, select or close.');
    const lines = [...this.tabs.values()].filter((t) => !t.owner || t.owner.sid === owner.sid).sort((a, b) => a.made - b.made).map((t) => {
      const whose = t.owner ? 'this chat\'s' : 'the user\'s own';
      const front = owner.current === t.id ? ', the one this chat works in' : '';
      const entry = this.asked(t.url);
      const where = entry && !this.lets(owner, entry) ? `a page on ${entry}, on the user's ask-first list (not shown)` : `${t.title ? `"${clip(t.title, 80)}" ` : ''}${t.url}`;
      return `${t.id} (${whose}${front}${t.paused ? ', the user took it over' : ''}): ${where}`;
    });
    return { text: lines.length ? lines.join('\n') : 'No page is open for this chat. navigate opens one.' };
  }

  async waitFor(owner, { text, gone, seconds, tab: id } = {}) {
    const tab = this.mine(owner, id);
    const limit = Math.min(60, Math.max(0.5, Number(seconds) || (text || gone ? 15 : 2))) * 1000;
    return this.step(owner, tab, text ? `waiting for "${clip(String(text), 40)}"` : gone ? `waiting for "${clip(String(gone), 40)}" to go` : 'waiting', async (started) => {
      const end = Date.now() + limit;
      let met = !text && !gone;
      while (!met && Date.now() < end) {
        const here = await this.inPage(tab, 'hasText', String(text || gone)).catch(() => false);
        met = text ? here : !here;
        if (!met) await wait(250);
      }
      if (!text && !gone) await wait(limit);
      const said = text ? (met ? `"${text}" is on the page.` : `"${text}" did not show up within ${Math.round(limit / 1000)} s.`)
        : gone ? (met ? `"${gone}" is gone from the page.` : `"${gone}" was still there after ${Math.round(limit / 1000)} s.`) : `Waited ${Math.round(limit / 1000)} s.`;
      return this.report(tab, said, { started });
    });
  }

  async evaluate(owner, { script, tab: id } = {}) {
    const tab = this.mine(owner, id, { acting: true });
    const src = String(script || '').trim();
    if (!src) throw new Say('script is the JavaScript to run in the page: an expression, or a function such as () => document.title.');
    const fn = /^(async\s+)?(function\b|\([^)]*\)\s*=>|[A-Za-z_$][\w$]*\s*=>)/.test(src);
    const code = `(async () => { const v = await (${fn ? `(${src})()` : `(${src})`}); try { return v === undefined ? { u: 1 } : JSON.parse(JSON.stringify(v)); } catch (e) { return { s: String(v) }; } })()`;
    return this.step(owner, tab, 'running a script in the page', async (started) => {
      await this.auto(tab);
      let v;
      try {
        v = await within(tab.wc.executeJavaScript(code, true), STEP_MS, 'The script');
      } catch (err) {
        if (err instanceof Say) throw err;
        throw new Say(`The script failed: ${clip(String(err && err.message || err), 400)}`);
      }
      const shown = v && v.u === 1 && Object.keys(v).length === 1 ? 'undefined' : v && typeof v.s === 'string' && Object.keys(v).length === 1 ? v.s : JSON.stringify(v, null, 1);
      await this.inPage(tab, 'settle', 600, 120).catch(() => {});
      const r = await this.report(tab, '', { started });
      return { text: `It gave back:\n${clip(String(shown), 20000)}\n\n${r.text}` };
    });
  }

  async consoleTool(owner, { clear = false, only_errors: errorsOnly = false, tab: id } = {}) {
    const tab = this.mine(owner, id);
    const list = tab.logs.filter((l) => !errorsOnly || l.level === 'error');
    const lines = list.slice(-100).map((l) => `[${l.level}] ${l.text}${l.where ? ` (${l.where})` : ''}`);
    if (clear) tab.logs.length = 0;
    return { text: lines.length ? `${list.length > 100 ? `The last 100 of ${list.length}:\n` : ''}${lines.join('\n')}` : `Nothing in the console of ${tab.id}${errorsOnly ? ' that is an error' : ''}.` };
  }

  async networkTool(owner, { only_failures: failures = false, find = '', request, body = false, clear = false, tab: id } = {}) {
    const tab = this.mine(owner, id);
    const one = request === undefined || request === null ? '' : String(request).trim();
    if (one) return this.netOne(tab, one, body === true);
    const words = String(find || '').trim().toLowerCase();
    const bad = (r) => Boolean(r.failed) || r.status >= 400;
    const list = tab.net.filter((r) => (!failures || bad(r)) && (!words || r.url.toLowerCase().includes(words)));
    const shown = list.slice(-NET_SHOWN);
    if (clear) { tab.net.length = 0; tab.netIds.clear(); }
    const which = `${failures ? ' that failed or were answered 400 or more' : ''}${words ? ` with "${clip(String(find), 60)}" in the address` : ''}`;
    const emptied = clear ? ' The list is empty now.' : '';
    if (!shown.length) return { text: `No request on ${tab.id}${which} among the ones it remembers (the newest ${NET_KEPT}).${emptied}` };
    const head = `${list.length} request${list.length === 1 ? '' : 's'} on ${tab.id}${which}${list.length > shown.length ? `, the newest ${shown.length} shown` : ''}, the oldest first. `
      + `request with a number (n12) shows one in full: what was sent and what came back.${emptied}`;
    return { text: `${head}\n${shown.map(netLine).join('\n')}` };
  }

  /** One request in full: its headers both ways, and what came back when the page still holds it. body: what it sent too. */
  async netOne(tab, which, body = false) {
    const n = which.replace(/^n/i, '');
    const r = tab.net.find((x) => String(x.n) === n);
    if (!r) throw new Say(`There is no request ${which} on ${tab.id} (it remembers the newest ${NET_KEPT}): network with no request lists them.`);
    const lines = [netLine(r), '', 'Sent with:', ...headerLines(r.reqHeaders)];
    if (r.body && body) lines.push(...await this.netBody(tab, r));
    else if (r.body) lines.push(`  and a body${r.body > 0 ? ` of ${sizeWords(r.body)}` : ''} (not shown: it can hold what was typed into the page; body true shows it when it is JSON or a form sent to the page's own site, with passwords, keys, tokens and nonces hidden)`);
    if (r.resHeaders) lines.push('', `Answered ${r.status}${r.statusText ? ` ${r.statusText}` : ''}${r.mime ? `, ${r.mime}` : ''}, with:`, ...headerLines(r.resHeaders));
    if (r.to) {
      lines.push('', `It led on to ${r.to}.`);
    } else if (r.failed) {
      lines.push('', `It failed: ${r.failed}.`);
    } else if (!r.done) {
      lines.push('', 'It is still going: what comes back is not here yet.');
    } else {
      let got = null;
      try { got = await this.cdp(tab, 'Network.getResponseBody', { requestId: r.id }); } catch { got = null; }
      const textual = /^(text\/|application\/([\w.+-]*\+)?(json|javascript|xml|x-www-form-urlencoded)|image\/svg)/i.test(r.mime);
      if (!got) {
        lines.push('', 'What came back is no longer held by the page (it holds the newest answers, 8 MB in all).');
      } else if (got.base64Encoded && !textual) {
        lines.push('', `What came back: ${sizeWords(Buffer.byteLength(got.body, 'base64'))} of ${r.mime || 'data'}, not text.`);
      } else {
        const text = got.base64Encoded ? Buffer.from(got.body, 'base64').toString('utf8') : String(got.body);
        lines.push('', `What came back${text.length > BODY_SHOWN ? ` (the first ${BODY_SHOWN} of ${text.length} characters)` : ''}:`, clip(text, BODY_SHOWN));
      }
    }
    return { text: lines.join('\n') };
  }

  /**
   * What a request sent, for a chat that asked: only when it went to the site of the page that sent it, and is JSON or
   * a form; a value that can open an account is hidden (KEYISH, tokenLike). The page is asked for it now: it is never
   * kept here.
   */
  async netBody(tab, r) {
    const size = r.body > 0 ? ` of ${sizeWords(r.body)}` : '';
    if (!sameSite(r.url, r.doc || tab.url)) return [`  and a body${size}, not shown: only what a page sends to its own site is shown, and this went to ${hostOf(r.url)}.`];
    let got = null;
    try { got = await this.cdp(tab, 'Network.getRequestPostData', { requestId: r.id }); } catch { got = null; }
    if (!got || typeof got.postData !== 'string') return [`  and a body${size} that the page no longer holds.`];
    const text = got.postData;
    const type = String((Object.entries(r.reqHeaders || {}).find(([k]) => k.toLowerCase() === 'content-type') || [])[1] || '');
    let shown = '';
    let kind = '';
    if (/json/i.test(type) || /^\s*[[{]/.test(text)) {
      try { shown = JSON.stringify(maskJson(JSON.parse(text)), null, 1); kind = 'JSON'; } catch { shown = ''; }
    }
    if (!shown && /x-www-form-urlencoded/i.test(type)) {
      shown = [...new URLSearchParams(text).entries()].map(([k, v]) => `${k}=${KEYISH.test(k) || tokenLike(v) ? '(hidden)' : clip(v, 4000)}`).join('\n');
      kind = 'a form';
    }
    if (!shown) return [`  and a body${size} that is neither JSON nor a form: not shown.`];
    return [`  and a body (${kind}, ${sizeWords(Buffer.byteLength(text))}; passwords, keys, tokens and nonces hidden)${shown.length > BODY_SHOWN ? `, its first ${BODY_SHOWN} characters` : ''}:`,
      clip(shown, BODY_SHOWN)];
  }

  async recordTool(owner, { action = '', path: where, tab: id } = {}) {
    const act = String(action).toLowerCase();
    if (act !== 'start' && act !== 'stop') throw new Say('action is start or stop.');
    const tab = this.mine(owner, id);
    if (act === 'start') return this.recStart(owner, tab);
    // a recording that stopped by itself was saved then: what was said about it is said now
    if (!tab.rec && tab.recDone) { const said = tab.recDone; tab.recDone = ''; return { text: said }; }
    if (!tab.rec) throw new Say(`Nothing is being recorded on ${tab.id}: record with action "start" begins.`);
    const file = where ? this.gifPath(String(where)) : this.recName();
    const said = await this.recEnd(tab, file);
    // the save that began by itself a moment before (at its 3 minutes) is said once, here
    if (tab.recDone === said) tab.recDone = '';
    return { text: said };
  }

  async recStart(owner, tab) {
    if (tab.rec) throw new Say(`${tab.id} is being recorded already (for ${Math.round((Date.now() - tab.rec.started) / 1000)} s): record with action "stop" saves it.`);
    await tab.ready;
    if (tab.wc.isDestroyed()) throw new Say('That page was closed.');
    await this.wake(tab);
    // the GIF is made in a thread of its own: the window never waits on a frame
    const worker = new Worker(path.join(__dirname, 'gif.cjs'), { workerData: { gif: true }, resourceLimits: { maxOldGenerationSizeMb: 192, maxYoungGenerationSizeMb: 16 } });
    const rec = { who: owner ? owner.name : '', owner: owner || null, started: Date.now(), frames: 0, size: null, busy: null, worker, timer: null, error: '' };
    worker.on('error', (err) => { rec.error = String(err && err.message || err); });
    tab.rec = rec;
    tab.recDone = '';
    rec.timer = setInterval(() => {
      if (tab.rec !== rec) return;
      const over = Date.now() - rec.started >= REC_MAX_MS ? `it reached ${REC_MAX_MS / 60e3} minutes` : rec.frames >= REC_FRAMES ? `it reached ${REC_FRAMES} frames` : '';
      if (!over) { this.recFrame(tab); return; }
      this.recEnd(tab, this.recName(), over).then((said) => { tab.recDone = said; }, (err) => { tab.recDone = err instanceof Say ? err.message : `The GIF could not be made: ${err && err.message}`; });
    }, REC_TICK_MS);
    await this.recFrame(tab, { fresh: true });
    this.changed();
    return { text: `Recording ${tab.id} as a GIF: a frame after every step on it and whenever it changes, with a ring where each click lands, for at most ${REC_MAX_MS / 60e3} minutes. record with action "stop" saves it.` };
  }

  /** One frame of a recording: the page as it is now, at the recording's size, handed to the GIF's thread. It never fails. */
  async recFrame(tab, { fresh = false } = {}) {
    const rec = tab.rec;
    if (!rec) return;
    // one picture at a time: a frame asked for while one is taken is that one, unless it must show what came after
    if (rec.busy) {
      if (!fresh) return;
      await rec.busy;
      if (tab.rec !== rec) return;
    }
    const p = (async () => {
      if (tab.wc.isDestroyed()) return;
      // a page on a site of the ask-first list its chat was not let open is not taken: the GIF waits for it to leave
      const entry = this.asked(tab.wc.getURL());
      if (entry && !this.lets(rec.owner, entry)) return;
      let img = await within(tab.wc.capturePage(), 8000, 'The picture');
      if (img.isEmpty() || tab.rec !== rec) return;
      const s = img.getSize();
      if (!rec.size) rec.size = s.width > REC_WIDTH ? { width: REC_WIDTH, height: Math.max(1, Math.round((s.height * REC_WIDTH) / s.width)) } : { width: s.width, height: s.height };
      const { width, height } = rec.size;
      if (s.width !== width || s.height !== height) img = img.resize({ width, height, quality: 'good' });
      let bits = img.toBitmap();
      // a picture held at another scale than its size says: made again at the recording's size
      if (bits.length !== width * height * 4) { img = img.resize({ width, height, quality: 'good' }); bits = img.toBitmap(); }
      if (bits.length !== width * height * 4) return;
      const copy = new Uint8Array(bits);
      rec.worker.postMessage({ t: 'frame', data: copy.buffer, width, height, at: Date.now() }, [copy.buffer]);
      rec.frames++;
    })().catch(() => {});
    rec.busy = p;
    await p;
    if (rec.busy === p) rec.busy = null;
  }

  /** Ends a recording and has its GIF written at `file`: what to tell the chat. A stop that comes while it is already being saved gets what that save says. */
  recEnd(tab, file, why = '') {
    const rec = tab.rec;
    if (!rec) return Promise.resolve('');
    if (!rec.ending) rec.ending = this.recSave(tab, rec, file, why);
    return rec.ending;
  }

  async recSave(tab, rec, file, why) {
    clearInterval(rec.timer);
    await this.recFrame(tab, { fresh: true });
    tab.rec = null;
    this.changed();
    const seconds = Math.round((Date.now() - rec.started) / 1000);
    try { fs.mkdirSync(path.dirname(file), { recursive: true }); } catch { /* the thread says why it could not write */ }
    const r = await new Promise((done) => {
      const cap = setTimeout(() => done({ t: 'error', message: 'it took longer than a minute' }), 60000);
      rec.worker.once('message', (m) => { clearTimeout(cap); done(m); });
      rec.worker.once('exit', () => { clearTimeout(cap); done({ t: 'error', message: rec.error || 'its thread stopped' }); });
      rec.worker.postMessage({ t: 'end', file });
    });
    rec.worker.terminate().catch(() => {});
    if (!r || r.t !== 'done') throw new Say(`The GIF could not be made: ${r && r.message ? r.message : 'no answer'}.`);
    if (!r.frames) throw new Say(`No picture of ${tab.id} could be taken, so there is no GIF.`);
    this.log(`browser: ${tab.id} recorded as a GIF (${r.frames} frames, ${seconds} s, ${sizeWords(r.bytes)})`);
    return `Saved the GIF of ${tab.id}: ${r.file} (${r.frames} frame${r.frames === 1 ? '' : 's'}, ${r.width}×${r.height}, ${seconds} s, ${sizeWords(r.bytes)}).${why ? ` It stopped by itself: ${why}.` : ''}`;
  }

  /** Where a recording is saved unless the chat says: the downloads folder, under a name not taken yet. */
  recName() {
    const d = new Date();
    const two = (v) => String(v).padStart(2, '0');
    const stem = `Lowlit recording ${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())} ${two(d.getHours())}.${two(d.getMinutes())}.${two(d.getSeconds())}`;
    let file = path.join(this.downloads, `${stem}.gif`);
    for (let i = 2; fs.existsSync(file) && i < 500; i++) file = path.join(this.downloads, `${stem} (${i}).gif`);
    return file;
  }

  /** Where a chat asked a GIF to go: a whole path ending in .gif, in a folder that is there and holds no keys. */
  gifPath(where) {
    const f = where.trim();
    if (!path.isAbsolute(f) || !/\.gif$/i.test(f)) throw new Say('path is a whole path ending in .gif, as in D:\\project\\docs\\demo.gif.');
    if (secretPath(f) || this.inRecord(f)) throw new Say('A GIF is never saved in a folder whose name starts with a dot, in AppData, on another computer or in the user\'s record.');
    let there = false;
    try { there = fs.statSync(path.dirname(f)).isDirectory(); } catch { there = false; }
    if (!there) throw new Say(`There is no folder ${path.dirname(f)} on this machine.`);
    return f;
  }

  /** A page that goes while it is being recorded takes its recording with it. */
  recDrop(tab) {
    const rec = tab.rec;
    if (!rec) return;
    tab.rec = null;
    clearInterval(rec.timer);
    rec.worker.terminate().catch(() => {});
    this.log(`browser: ${tab.id} went while it was being recorded: no GIF`);
  }

  async dialogTool(owner, { accept = false, text, tab: id } = {}) {
    const tab = this.mine(owner, id);
    tab.answer = { accept: accept === true, text: typeof text === 'string' ? text : null };
    await this.hook(tab);
    const last = tab.dialogs[tab.dialogs.length - 1];
    return { text: `The questions ${tab.id} asks from now on are answered ${accept === true ? `yes${typeof text === 'string' ? `, with "${clip(text, 80)}" where words are asked for` : ''}` : 'no'}.${last ? ` The last one was "${last.message}" (${last.type}).` : ''}` };
  }

  async upload(owner, { ref, paths, tab: id } = {}) {
    const tab = this.mine(owner, id, { acting: true });
    const files = (Array.isArray(paths) ? paths : [paths]).filter(Boolean).map(String);
    if (!files.length) throw new Say('paths lists the files to hand to the page, each a whole path.');
    for (const f of files) {
      if (!path.isAbsolute(f)) throw new Say(`${f} is not a whole path (it must start with a drive, as in D:\\folder\\file.pdf).`);
      if (secretPath(f)) throw new Say(`${path.basename(f)} is not handed to a page: the browser never hands over a file in a folder whose name starts with a dot, in AppData or on another computer, or a file that holds keys.`);
      if (this.inRecord(f)) throw new Say(`${path.basename(f)} is in the user's record: nothing from it is handed to a web page.`);
      try { if (!fs.statSync(f).isFile()) throw new Error(); } catch { throw new Say(`${f} is not a file on this machine.`); }
    }
    return this.step(owner, tab, `handing ${files.length} file${files.length === 1 ? '' : 's'} to the page`, async (started) => {
      const e = await this.inPage(tab, 'act', String(ref), 'editable');
      if (!e || e.gone) throw new Say(`${ref} is no longer on the page.`);
      if (!e.file) throw new Say(`${e.what} is not a file picker. The snapshot names it "button \\"Choose file\\"" or similar.`);
      const nonce = `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
      await this.inPage(tab, 'act', String(ref), 'mark', nonce);
      try {
        const { root } = await this.cdp(tab, 'DOM.getDocument', { depth: 0 });
        const { nodeId } = await this.cdp(tab, 'DOM.querySelector', { nodeId: root.nodeId, selector: `[data-lowlit-pick="${nonce}"]` });
        if (!nodeId) throw new Say(`${e.what} sits where files cannot be handed to it from here (inside a component or a frame).`);
        await this.cdp(tab, 'DOM.setFileInputFiles', { files, nodeId });
      } finally {
        await this.inPage(tab, 'act', String(ref), 'unmark').catch(() => {});
      }
      await this.after(tab, started);
      return this.report(tab, `Handed ${files.map((f) => path.basename(f)).join(', ')} to ${e.what}.`, { started });
    });
  }

  /**
   * The file a field is saved to or filled from: a whole path on this machine, never in a folder whose name starts with
   * a dot, in AppData, on another computer or in the person's record, nor a file that holds keys.
   */
  fieldFile(where, writing) {
    const f = String(where || '').trim();
    if (!f || !path.isAbsolute(f)) throw new Say('path is a whole path on this machine, as in D:\\work\\page.html.');
    if (secretPath(f)) throw new Say(`The browser never ${writing ? 'writes' : 'reads'} ${path.basename(f)} there: not in a folder whose name starts with a dot, in AppData or on another computer, nor a file that holds keys.`);
    if (this.inRecord(f)) throw new Say(`${path.basename(f)} is in the user's record: the browser ${writing ? 'writes nothing there' : 'hands nothing from it to a page'}.`);
    return path.resolve(f);
  }

  /** A field's whole text into a file, past the chat: for long texts. */
  async saveField(owner, { ref, path: where, overwrite = false, html = false, tab: id } = {}) {
    const tab = this.mine(owner, id);
    const file = this.fieldFile(where, true);
    let folder = false;
    try { folder = fs.statSync(path.dirname(file)).isDirectory(); } catch { folder = false; }
    if (!folder) throw new Say(`There is no folder ${path.dirname(file)} on this machine.`);
    if (overwrite !== true && fs.existsSync(file)) throw new Say(`${file} is there already: overwrite true replaces it.`);
    return this.step(owner, tab, `saving ${ref} to a file`, async () => {
      const r = await this.inPage(tab, 'act', String(ref), 'text', { html: html === true });
      if (!r || r.gone) throw new Say(`${ref} is no longer on the page. Take a new snapshot and use the refs it gives.`);
      if (!r.ok) throw new Say(`${r.why}.`);
      const bytes = Buffer.from(String(r.value), 'utf8');
      if (bytes.length > FIELD_MAX) throw new Say(`${r.what} holds ${sizeWords(bytes.length)}: a field is saved up to ${sizeWords(FIELD_MAX)}.`);
      try {
        fs.writeFileSync(file, bytes, { flag: overwrite === true ? 'w' : 'wx' });
      } catch (err) {
        throw new Say(err.code === 'EEXIST' ? `${file} is there already: overwrite true replaces it.` : `${file} could not be written: ${err.code || err.message}.`);
      }
      return { text: `Saved what ${r.what} holds to ${file}: ${String(r.value).length} characters (${bytes.length} bytes), SHA-256 ${sha(bytes)}.` };
    });
  }

  /** A field filled with a file's text, as typing would leave it, past the chat: for long texts. */
  async fillField(owner, { ref, path: where, html = false, tab: id } = {}) {
    const tab = this.mine(owner, id, { acting: true });
    const file = this.fieldFile(where, false);
    let bytes;
    try {
      const st = fs.statSync(file);
      if (!st.isFile()) throw new Error('not a file');
      if (st.size > FIELD_MAX) throw new Say(`${path.basename(file)} is ${sizeWords(st.size)}: a field is filled from ${sizeWords(FIELD_MAX)} at most.`);
      bytes = fs.readFileSync(file);
    } catch (err) {
      if (err instanceof Say) throw err;
      throw new Say(`${file} is not a file on this machine.`);
    }
    if (bytes.includes(0)) throw new Say(`${path.basename(file)} is not text (it holds zero bytes): a field is filled with text only.`);
    const text = bytes.toString('utf8').replace(/^\uFEFF/, '');
    return this.step(owner, tab, `filling ${ref} from a file`, async (started) => {
      await this.auto(tab);
      const r = await this.inPage(tab, 'act', String(ref), 'fill', { text, html: html === true });
      if (!r || r.gone) throw new Say(`${ref} is no longer on the page. Take a new snapshot and use the refs it gives.`);
      if (!r.ok) throw new Say(`${r.why}.`);
      tab.busy = `filling ${r.what}`;
      await this.after(tab, started);
      // a text box keeps one line (a file's last line break is left out); a field keeps its line ends as LF
      const want = r.one ? text.replace(/\r?\n$/, '') : text.replace(/\r\n?/g, '\n');
      const got = String(r.value);
      const lf = !r.one && want !== text ? ' (its line ends kept as LF, as fields keep them)' : '';
      const said = got === want
        ? `Filled ${r.what} from ${file}: it now holds ${got.length} characters, SHA-256 ${sha(got)}, the same as the file${lf}.`
        : `Filled ${r.what} from ${file}, but it does not hold the file as it is: ${got.length} characters, SHA-256 ${sha(got)}, against the file's ${want.length} characters, SHA-256 ${sha(want)}${lf}. The page or its editor changed what it was given${html === true ? ' (an editor often rewrites HTML)' : ''}.`;
      return this.report(tab, said, { started, keys: true });
    });
  }

  /** What a form would send now, against what it held when the page was first read (or when a chat marked it). */
  async formPreview(owner, { ref, mark = false, tab: id } = {}) {
    const tab = this.mine(owner, id);
    return this.step(owner, tab, mark === true ? 'marking the forms' : 'reading what the form would send', async () => {
      const r = await this.inPage(tab, 'formPreview', ref ? String(ref) : '', mark === true);
      if (!r || r.gone) throw new Say(`${ref} is no longer on the page. Take a new snapshot and use the refs it gives.`);
      if (!r.ok) throw new Say(`${r.why}.`);
      if (mark === true) return { text: `Marked ${r.marked} form${r.marked === 1 ? '' : 's'} of ${tab.id}: form_preview now says what differs from what ${r.marked === 1 ? 'it holds' : 'they hold'} now.` };
      if (!r.forms.length) return { text: `${tab.id} has no form.` };
      return { text: r.forms.map(formLines).join('\n\n') };
    });
  }

  /** A file inside one of the record's folders, wherever it is reached from (the record's folder can be a junction). */
  inRecord(file) {
    const where = really(file).toLowerCase();
    return this.record().some((folder) => {
      const d = really(folder).toLowerCase().replace(/[\\/]+$/, '');
      return Boolean(d) && (where === d || where.startsWith(`${d}${path.sep}`));
    });
  }

  async show(owner, { message = '', tab: id } = {}) {
    // a page of the ask-first list too: the person is shown it, the chat reads nothing of it
    const tab = this.mine(owner, id, { free: true });
    this.command('browser', { show: tab.id, message: clip(String(message || ''), 200), from: owner.name });
    // the taskbar button blinks for a window that is open behind others; one by the clock or hidden is left alone
    try { if (this.win.isVisible() && !this.win.isFocused()) this.win.flashFrame(true); } catch { /* no window */ }
    return { text: `The Browser panel shows ${tab.id} to the user now${message ? `, with your words: "${clip(String(message), 200)}"` : ''}. It did not take the keyboard from what the user was doing: ask in the chat for what you need, and wait for the answer.` };
  }

  /**
   * The person's size wins over a chat's: a page a chat laid out at a size of its own (resize) goes back to the
   * panel's, and the chat is told at its next step (seen 6 Oct: a chat left its page at a phone's size after 35 of its
   * 36 resizes, and the page no longer followed the panel). Not while it looks at the page at three sizes (look).
   */
  async fit(id, why) {
    const t = this.tabs.get(id);
    if (!t || !t.emulated || t.looking || t.wc.isDestroyed()) return false;
    const was = t.emulated;
    t.emulated = null;
    this.changed();
    await this.cdp(t, 'Emulation.clearDeviceMetricsOverride').catch(() => {});
    await this.cdp(t, 'Emulation.setTouchEmulationEnabled', { enabled: false }).catch(() => {});
    await this.cdp(t, 'Emulation.resetPageScaleFactor').catch(() => {});
    if (t.owner || t.guest) {
      t.fitted = `The user ${why}: this page is laid out at the Browser panel's size again (it was ${was.width}×${was.height}${was.mobile ? ' as on a phone' : ''}). `
        + 'To check another size, call resize again, and resize with no width once done.';
    }
    this.log(`browser: ${t.id} back at the panel's size (was ${was.width}x${was.height}): the person ${why}`);
    return true;
  }

  /** The page the person sees in the open panel, back at the panel's size if a chat had laid it out at its own. */
  fitShown(why) {
    const t = this.visible ? this.tabs.get(this.shown) : null;
    if (t && t.emulated) this.fit(t.id, why).catch(() => {});
  }

  async resize(owner, { width, height, mobile = false, tab: id } = {}) {
    const tab = this.mine(owner, id, { acting: true });
    const w = Math.round(Number(width));
    const h = Math.round(Number(height));
    return this.step(owner, tab, 'resizing the page', async (started) => {
      if (!w || !h) {
        await this.cdp(tab, 'Emulation.clearDeviceMetricsOverride');
        await this.cdp(tab, 'Emulation.setTouchEmulationEnabled', { enabled: false });
        tab.emulated = null;
      } else {
        if (w < 200 || h < 200 || w > 4000 || h > 4000) throw new Say('width and height go from 200 to 4000 pixels.');
        await this.cdp(tab, 'Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 0, mobile: Boolean(mobile) });
        await this.cdp(tab, 'Emulation.setTouchEmulationEnabled', { enabled: Boolean(mobile) });
        tab.emulated = { width: w, height: h, mobile: Boolean(mobile) };
      }
      await this.inPage(tab, 'settle', 1000, 150).catch(() => {});
      return this.report(tab, tab.emulated ? `The page is laid out at ${w}×${h}${mobile ? ' as on a phone (touch)' : ''}, and the user sees it so in the Browser panel until it goes back: `
        + 'once done with this size, call resize with no width. It goes back by itself if the user resizes the panel or the window.' : 'The page is laid out at the panel\'s size again.', { started, full: true });
    });
  }

  /**
   * The page as a phone, a tablet and a laptop show it, one after the other: a picture of each first screen, and what
   * an eye would catch there, measured over the whole page (browser-look.cjs faults). The page goes back to the size it
   * was laid out at and to where it was scrolled.
   */
  async look(owner, { tab: id } = {}) {
    const tab = this.mine(owner, id, { acting: true });
    return this.step(owner, tab, 'looking at the page on a phone, a tablet and a laptop', async () => {
      const had = tab.emulated;
      const y = Number(await this.now(tab, 'scrollY')) || 0;
      // a page on screen keeps its window where the person sees it; one off the screen takes each size for its picture
      const shown = tab.page.isVisible();
      const size = tab.page.getContentSize();
      const images = [];
      const parts = [];
      tab.looking = true;
      try {
        for (const s of LOOK_SIZES) {
          // a phone's zoom is carried to the next size (as on turning a phone), relative to how far the page zooms out:
          // each screen starts afresh, and once laid out is put at the zoom the page asks for
          await this.cdp(tab, 'Emulation.clearDeviceMetricsOverride').catch(() => {});
          if (!shown) tab.page.setContentSize(s.width, s.height);
          await this.cdp(tab, 'Emulation.setDeviceMetricsOverride', { width: s.width, height: s.height, deviceScaleFactor: s.scale, mobile: s.mobile });
          await this.cdp(tab, 'Emulation.setTouchEmulationEnabled', { enabled: s.mobile });
          await this.inPage(tab, 'settle', 600, 120).catch(() => {});
          await this.cdp(tab, 'Emulation.resetPageScaleFactor').catch(() => {});
          await this.now(tab, 'scrollTo(0, 0); 0');
          await this.inPage(tab, 'settle', 1500, 200).catch(() => {});
          const f = await this.inPage(tab, 'faults', s.width);
          let img = await this.lookShot(tab, s, shown);
          if (!img || img.isEmpty()) throw new Say(`The page gave no picture at the ${s.name.toLowerCase()}'s size: it may still be loading. Try again in a moment.`);
          const wide = Math.min(s.width, SHOT_WIDTH);
          if (img.getSize().width !== wide) img = img.resize({ width: wide, quality: 'good' });
          images.push({ data: img.toJPEG(74).toString('base64'), mimeType: 'image/jpeg' });
          parts.push(lookSaid(s, f));
        }
      } finally {
        tab.looking = false;
        if (!tab.wc.isDestroyed()) {
          if (had) await this.cdp(tab, 'Emulation.setDeviceMetricsOverride', { width: had.width, height: had.height, deviceScaleFactor: 0, mobile: had.mobile }).catch(() => {});
          else await this.cdp(tab, 'Emulation.clearDeviceMetricsOverride').catch(() => {});
          await this.cdp(tab, 'Emulation.setTouchEmulationEnabled', { enabled: Boolean(had && had.mobile) }).catch(() => {});
          await this.cdp(tab, 'Emulation.resetPageScaleFactor').catch(() => {});
          if (!shown && !tab.page.isDestroyed()) tab.page.setContentSize(size[0], size[1]);
          this.layout();
          await this.now(tab, `scrollTo(0, ${Math.round(y)}); 0`);
        }
      }
      return {
        text: `Page ${tab.id}${tab.title ? ` "${clip(tab.title, 80)}"` : ''} (${tab.url}) on a phone, a tablet and a laptop; the pictures follow in that order, each its first screen.\n\n${parts.join('\n\n')}\n\n`
          + 'These are measurements, not a verdict: what they cannot catch (a look that is generic, cheap or crowded, spacing that feels off, a hierarchy that does not read) the pictures show.',
        images,
      };
    });
  }

  /**
   * One screen's picture for look. A page on screen gives its own picture of the screen it is laid out on. A page off
   * the screen draws nothing for that picture (it waits for a frame that never comes), so its window, set to the
   * screen's size, is pictured: such a window can first hand back a frame from before the change, so it is asked
   * again until the picture has the screen's shape.
   */
  async lookShot(tab, s, shown) {
    if (shown) {
      const shot = await this.cdp(tab, 'Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false });
      return nativeImage.createFromBuffer(Buffer.from(shot && shot.data ? shot.data : '', 'base64'));
    }
    let img = null;
    for (let i = 0; i < 5; i++) {
      if (i) await wait(250);
      img = await within(tab.wc.capturePage(), 8000, 'The picture');
      const { width, height } = img.getSize();
      if (!img.isEmpty() && height && Math.abs((width / height) / (s.width / s.height) - 1) < 0.02) break;
    }
    if (img && !img.isEmpty() && Date.now() - tab.changedAt < 600) { await wait(220); img = await within(tab.wc.capturePage(), 8000, 'The picture'); }
    return img;
  }

  /**
   * Every minute: pages of chats that ended long enough ago are closed, unless the person is looking at one or took it
   * over; a page nobody used for REST_MS, and not on screen, rests (its scripts and drawing stop) until it is used.
   */
  sweep(gone) {
    const now = Date.now();
    for (const t of [...this.tabs.values()]) {
      if (t.owner && gone(t.owner) && !t.paused && t.id !== this.shown && now - t.used > 15 * 60e3) {
        this.close(t.id, 'its chat ended');
        continue;
      }
      const seen = t.id === this.shown && this.visible;
      if (seen || t.rec || t.frozen || t.busy || !t.attached || t.wc.isDestroyed() || t.wc.isLoading() || now - t.used < REST_MS) continue;
      t.frozen = true;
      t.wc.debugger.sendCommand('Page.setWebLifecycleState', { state: 'frozen' }).catch(() => { t.frozen = false; });
    }
  }
}

module.exports = { Browser, Say, address, keyOf, secretPath, really, askList, ASK_FIRST };
