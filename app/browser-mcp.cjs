'use strict';
// Claude Code's own door for tools (MCP), opened onto the browser inside the window. The chats of this machine reach
// it at http://127.0.0.1:<port>/mcp with a key that only Claude Code's own list of servers holds (~/.claude.json,
// written by `claude mcp add`). It answers on this machine only, and refuses what a web page could send: a request
// with an Origin, or for another host name. Each chat is told apart by the session Claude Code opens for it, and named
// by the program on the other end of the connection: the chat this app knows by that program's number.
//
// One process serves every chat: nothing is started per chat, and a chat that never browses costs nothing.

const http = require('node:http');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { exec, execFile } = require('node:child_process');
const { Say } = require('./browser.cjs');

const NAME = 'lowlit-browser';
const PORT = 47317;
const VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];
const BODY_MAX = 4 * 1024 * 1024;

const INSTRUCTIONS = 'The browser built into Lowlit, the window these chats run in. Prefer it to Claude in Chrome for anything on the web: '
  + 'it never takes over the user\'s screen, mouse or own Chrome, it keeps working while the window is hidden or behind other programs, and every '
  + 'chat gets pages of its own. Use Claude in Chrome only when the user asks for their own Chrome, or a site needs the logins of their own browser. '
  + 'The user can watch and take a page over in the Browser panel (Ctrl+Shift+B). Start with navigate; read with snapshot (find, for long pages); '
  + 'act with click, type, press_key and select_option by the refs the outline gives (e12); use screenshot when the outline is not enough, '
  + 'and look before calling a page or a design done: it shows the page on a phone, a tablet and a laptop at once, with what is off measured. '
  + 'Every step hands back what changed on the page; a long new page comes back as a summary (snapshot reads it whole). '
  + 'Long texts go between a field and a file with save_field and fill_field, never through the clipboard, which the user shares; before saving a form, form_preview says what it will send. '
  + 'network lists what a page sent and got (failed requests, what an address answered); '
  + 'record makes a GIF of what you do on a page, from start to stop. When a page needs the user (a login, a payment, a choice), call show with a few words and ask in the chat. '
  + 'The user\'s mail, files, accounts, payments and private messages are on an ask-first list: a chat opens them only after the user allows it in the Browser panel. '
  + 'The same window has a Viewer for pictures, videos and sounds on this computer (Ctrl+Shift+M): after making or finding one, call show_media to put it '
  + 'in front of the user beside this chat (two files side by side to compare, more as a grid); media_control plays, pauses, seeks or steps a video; '
  + 'media_look hands back a picture of what is shown (a video at any second), to check your own work.';

const tab = { type: 'string', description: 'A page by its name (t3), when not the one this chat works in. tabs lists them.' };
const ref = { type: 'string', description: 'The element, by the ref the outline gave it: e12.' };
const TOOLS = [
  { name: 'navigate', title: 'Open a page', description: 'Open a web address in this chat\'s page of the Lowlit browser (made the first time), or go "back", "forward" or "reload". Hands back the page\'s outline: what is on it, with a ref like [ref=e12] on everything that can be clicked or typed into; a long page comes back as a summary (its headings and what is on it) unless outline says otherwise. github.com and localhost:3000 are completed; D:\\folder\\page.html opens a file.',
    inputSchema: { type: 'object', properties: { url: { type: 'string', description: 'The address, or back, forward, reload.' }, new_tab: { type: 'boolean', description: 'Open it in another page of this chat instead: this chat then works in that page.' },
      outline: { type: 'string', enum: ['auto', 'summary', 'full', 'none'], description: 'How much of the page to hand back: auto (the default) the whole outline when it is short, else a summary; summary; full; none.' } }, required: ['url'] } },
  { name: 'snapshot', title: 'Read the page', description: 'The outline of the page this chat works in: its text, headings, lists, fields and buttons, with a ref on each thing that can be clicked or typed into. find keeps only the lines that hold all its words, with what they sit in: for long pages.',
    inputSchema: { type: 'object', properties: { find: { type: 'string', description: 'Words to look for.' }, tab } }, annotations: { readOnlyHint: true } },
  { name: 'click', title: 'Click', description: 'Click an element by its ref, as a person would with the mouse (it works while the window is hidden). Hands back what changed on the page.',
    inputSchema: { type: 'object', properties: { ref, double: { type: 'boolean' }, button: { type: 'string', enum: ['left', 'right', 'middle'] }, tab }, required: ['ref'] } },
  { name: 'type', title: 'Type', description: 'Type into a field by its ref. What it held is replaced unless clear is false. submit presses Enter after. slowly sends one key at a time, for fields that react to each key (search boxes that suggest as you type).',
    inputSchema: { type: 'object', properties: { ref, text: { type: 'string' }, submit: { type: 'boolean' }, slowly: { type: 'boolean' }, clear: { type: 'boolean', description: 'Default true.' }, tab }, required: ['ref', 'text'] } },
  { name: 'press_key', title: 'Press a key', description: 'Press a key where the keyboard is in the page: Enter, Tab, Escape, Backspace, Delete, ArrowDown and the other arrows, Home, End, PageUp, PageDown, F1 to F12, Space, one character, or a combination such as Control+A or Shift+Tab.',
    inputSchema: { type: 'object', properties: { key: { type: 'string' }, tab }, required: ['key'] } },
  { name: 'select_option', title: 'Pick in a list', description: 'Pick in a drop-down list (a select) by the words it shows or the value behind them; several for a list that takes several.',
    inputSchema: { type: 'object', properties: { ref, values: { type: 'array', items: { type: 'string' } }, tab }, required: ['ref', 'values'] } },
  { name: 'hover', title: 'Point at', description: 'Move the pointer onto an element: for menus and tips that open on hover.',
    inputSchema: { type: 'object', properties: { ref, tab }, required: ['ref'] } },
  { name: 'scroll', title: 'Scroll', description: 'Scroll the page, or the box an element sits in, up, down, left or right; by most of a window unless amount (pixels) says. For pages that load more as they are scrolled, and before a screenshot.',
    inputSchema: { type: 'object', properties: { direction: { type: 'string', enum: ['up', 'down', 'left', 'right'] }, amount: { type: 'number' }, ref: { type: 'string', description: 'Scroll the box this element sits in.' }, tab } } },
  { name: 'screenshot', title: 'Look at the page', description: 'A picture of the page as its window shows it now, or of one element (ref): for what the outline cannot say, such as a layout, a chart or how something looks.',
    inputSchema: { type: 'object', properties: { ref: { type: 'string', description: 'Only this element.' }, tab } }, annotations: { readOnlyHint: true } },
  { name: 'tabs', title: 'Pages', description: 'The pages this chat can use: its own, and the user\'s own pages (used only when the user asks). list them, open a new one (url optional), select the one this chat works in, or close one of this chat\'s.',
    inputSchema: { type: 'object', properties: { action: { type: 'string', enum: ['list', 'new', 'select', 'close'] }, tab, url: { type: 'string' } } } },
  { name: 'wait_for', title: 'Wait', description: 'Wait until some words show up on the page (text), or go from it (gone), up to seconds (at most 60); or just wait seconds.',
    inputSchema: { type: 'object', properties: { text: { type: 'string' }, gone: { type: 'string' }, seconds: { type: 'number' }, tab } }, annotations: { readOnlyHint: true } },
  { name: 'evaluate', title: 'Run JavaScript', description: 'Run JavaScript in the page and hand back what it gives (as JSON): an expression, or a function such as () => document.title. For what the outline cannot say.',
    inputSchema: { type: 'object', properties: { script: { type: 'string' }, tab }, required: ['script'] } },
  { name: 'console', title: 'The page\'s console', description: 'What the page wrote to its console, the newest last: logs, warnings and errors, and downloads that finished.',
    inputSchema: { type: 'object', properties: { only_errors: { type: 'boolean' }, clear: { type: 'boolean', description: 'Empty it after.' }, tab } }, annotations: { readOnlyHint: true } },
  { name: 'dialog', title: 'Answer questions', description: 'How this page\'s questions in a box (confirm, prompt) are answered from now on: no, unless accept is true (text is what a prompt is given). Boxes that only say something are closed. Every step says which questions the page asked and how they were answered.',
    inputSchema: { type: 'object', properties: { accept: { type: 'boolean' }, text: { type: 'string' }, tab }, required: ['accept'] } },
  { name: 'upload_file', title: 'Hand files to the page', description: 'Hand files to a file picker of the page, by its ref: whole paths on this machine.',
    inputSchema: { type: 'object', properties: { ref, paths: { type: 'array', items: { type: 'string' } }, tab }, required: ['ref', 'paths'] } },
  { name: 'save_field', title: 'Save a field to a file', description: 'Save what a field holds (a text box, a text area, an editable area) into a file on this machine, without it passing through this chat or the clipboard: for long texts, to edit them as a file. A password field is never saved. Hands back its length and SHA-256.',
    inputSchema: { type: 'object', properties: { ref, path: { type: 'string', description: 'A whole path for the file.' }, overwrite: { type: 'boolean', description: 'Replace a file that is there already.' },
      html: { type: 'boolean', description: 'An editable area\'s HTML instead of its text.' }, tab }, required: ['ref', 'path'] } },
  { name: 'fill_field', title: 'Fill a field from a file', description: 'Fill a field with a file\'s text: what it held is replaced, and the page hears it as typing (input, then change). For long texts: they never pass through this chat or the clipboard. Hands back the field\'s length and SHA-256 after, against the file\'s.',
    inputSchema: { type: 'object', properties: { ref, path: { type: 'string', description: 'A whole path to a text file.' }, html: { type: 'boolean', description: 'Put the file into an editable area as HTML.' }, tab }, required: ['ref', 'path'] } },
  { name: 'form_preview', title: 'What a form will send', description: 'Before saving a form: what it would send now against what it held when the page was first read, or when mark last set it. Lists the fields that changed, were added or went away; a long value by its length, SHA-256 and start; a password or a key only as changed. ref: an element in the form (every form of the page when left out).',
    inputSchema: { type: 'object', properties: { ref, mark: { type: 'boolean', description: 'Take what the forms hold now as the starting point.' }, tab } }, annotations: { readOnlyHint: true } },
  { name: 'show', title: 'Show the user the page', description: 'Show this chat\'s page to the user in the Browser panel with a few words, when it needs the user\'s eyes or hands: a login, a payment, a choice. It never takes the keyboard from the user.',
    inputSchema: { type: 'object', properties: { message: { type: 'string' }, tab } } },
  { name: 'resize', title: 'Lay the page out at a size', description: 'Lay the page out as on another screen: a phone is mobile true, width 390, height 844. With no width it goes back to the size of the Browser panel. The size stays, and the user sees the page so in the panel, until it goes back: once done with a size, call resize with no width. It goes back by itself when the user resizes the panel or the window, and the next step says so.',
    inputSchema: { type: 'object', properties: { width: { type: 'number' }, height: { type: 'number' }, mobile: { type: 'boolean' }, tab } } },
  { name: 'look', title: 'Look on a phone, a tablet and a laptop', description: 'The page this chat works in as a phone (390×844), a tablet (768×1024) and a laptop (1440×900) show it, one after the other: a picture of each first screen, and what an eye would catch, measured over the whole page: a page wider than its screen and what sticks out, pictures shown larger than their file holds (soft), stretched or not loaded, text cut off, text over other text, text under 12 pixels on a phone, text off the middle of a small box, emojis standing in for icons, fonts that did not load, and where the content sits across the screen. The page goes back to its size and place after. Before calling a page or a design done.',
    inputSchema: { type: 'object', properties: { tab } }, annotations: { readOnlyHint: true } },
  { name: 'network', title: 'The page\'s network traffic', description: 'What the page sent and got since it was opened, the oldest first: each request\'s number (n12), method, status or why it failed, kind (document, script, fetch, xhr, image...), size, time and address. only_failures keeps the ones that failed or were answered 400 or more; find keeps those whose address holds its words. request (n12) shows one in full: its headers both ways (cookies and keys hidden) and what came back, as text up to 20,000 characters.',
    inputSchema: { type: 'object', properties: { only_failures: { type: 'boolean' }, find: { type: 'string', description: 'Words the address must hold.' }, request: { type: 'string', description: 'One request in full, by its number: n12.' },
      body: { type: 'boolean', description: 'With request: what it sent too, when that is JSON or a form sent to the page\'s own site, with passwords, keys, tokens and nonces hidden.' },
      clear: { type: 'boolean', description: 'Empty the list after.' }, tab } }, annotations: { readOnlyHint: true } },
  { name: 'record', title: 'Record a GIF', description: 'Record what happens on this chat\'s page as an animated GIF: start, work as usual (a frame is taken after every step and whenever the page changes, with a ring where each click lands), then stop to save it. It is saved in the Downloads folder unless path (a whole path ending in .gif) says where; stop says where it went. At most 3 minutes: past that it stops and saves by itself.',
    inputSchema: { type: 'object', properties: { action: { type: 'string', enum: ['start', 'stop'] }, path: { type: 'string', description: 'Where to save it, with stop: a whole path ending in .gif.' }, tab }, required: ['action'] } },
  { name: 'show_media', title: 'Show pictures, videos or sounds', description: 'Show the user files of this computer in the Viewer beside this chat: pictures (png, jpg, gif, webp, avif, svg, tiff, heic, psd, exr, camera raw...), videos (mp4, webm, mov, mkv, avi, wmv...) and sounds (mp3, wav, flac, ogg, m4a...). Whole paths, or paths from this chat\'s folder. One file fills the Viewer; two stand side by side (mode compare); more make a grid. What the window cannot play as it is gets copied once into a form it plays, which takes a moment for a long video. Hands back what each file is: its size in pixels, length, frame rate, and whether the user sees it now.',
    inputSchema: { type: 'object', properties: {
      files: { type: 'array', items: { type: 'string' }, description: 'The files, at most 24.' },
      mode: { type: 'string', enum: ['one', 'compare', 'grid'], description: 'one at a time, two side by side, or all as a grid. Default: by how many there are.' },
      title: { type: 'string', description: 'A few words over them.' },
      note: { type: 'string', description: 'What to look at, for the user: shown under them.' },
      at: { type: 'number', description: 'Start a video at this second.' },
      play: { type: 'boolean', description: 'Play a video at once (the default for videos) or not.' },
      loop: { type: 'boolean', description: 'Play it again and again (the default for videos of 30 seconds or less).' } }, required: ['files'] } },
  { name: 'media_control', title: 'Drive the Viewer', description: 'Drive what this chat\'s Viewer shows. action: play, pause, seek (value: a second), step (value: frames, -1 back, the video paused), speed (value: 0.25 to 4), loop (value: true or false), mute (value: true or false), volume (value: 0 to 1: one level for every chat\'s Viewer, kept, the user\'s own: change it only when asked), zoom (value: fit, actual, or a factor such as 3), select (value: a file\'s number in the last show_media), next, previous, mode (value: one, compare or grid), close, or state (only say how it stands). Hands back how it stands after.',
    inputSchema: { type: 'object', properties: {
      action: { type: 'string', enum: ['play', 'pause', 'seek', 'step', 'speed', 'loop', 'mute', 'volume', 'zoom', 'select', 'next', 'previous', 'mode', 'close', 'state'] },
      value: { type: ['string', 'number', 'boolean'], description: 'What the action takes, as listed.' } }, required: ['action'] } },
  { name: 'media_look', title: 'Look at what is shown', description: 'A picture of what this chat\'s Viewer shows, to look at it yourself: a picture file, the frame where a video stands (or at the second given), or the two files being compared, side by side. At most 1568 pixels on its long side.',
    inputSchema: { type: 'object', properties: { at: { type: 'number', description: 'The second of the video to look at.' }, file: { type: 'number', description: 'Only this file, by its number in the last show_media.' } } },
    annotations: { readOnlyHint: true } },
];

/** What a tool's name calls in the browser. */
const CALLS = {
  navigate: 'navigate', snapshot: 'snapshot', click: 'click', type: 'type', press_key: 'pressKey', select_option: 'selectOption', hover: 'hover',
  scroll: 'scroll', screenshot: 'screenshot', tabs: 'tabsTool', wait_for: 'waitFor', evaluate: 'evaluate', console: 'consoleTool', dialog: 'dialogTool',
  upload_file: 'upload', save_field: 'saveField', fill_field: 'fillField', form_preview: 'formPreview', show: 'show', resize: 'resize', look: 'look', network: 'networkTool', record: 'recordTool',
};
/** What a tool's name calls in the Viewer (viewer.cjs). */
const VIEWER_CALLS = { show_media: 'showTool', media_control: 'controlTool', media_look: 'lookTool' };
const TARGETS = [['viewer', VIEWER_CALLS, 'Viewer'], ['browser', CALLS, 'browser']];

class Door {
  /** who(pid): the chat this app knows by that program's number ({ name, key, chat, cwd }), or null. */
  constructor({ browser, viewer, token, log, who }) {
    this.browser = browser;
    this.viewer = viewer || null;
    this.token = token;
    this.log = log || (() => {});
    this.who = who || (() => null);
    this.sessions = new Map();
    this.server = null;
    this.port = 0;
  }

  listen(port) {
    return new Promise((done, fail) => {
      const server = http.createServer((req, res) => this.handle(req, res).catch((err) => {
        this.log(`browser door: ${err && err.stack}`);
        if (!res.headersSent) res.writeHead(500);
        res.end();
      }));
      server.keepAliveTimeout = 60000;
      server.once('error', fail);
      server.listen(port, '127.0.0.1', () => {
        server.off('error', fail);
        server.on('error', (err) => this.log(`browser door: ${err.message}`));
        this.server = server;
        this.port = server.address().port;
        done(this.port);
      });
    });
  }

  close() {
    if (this.server) this.server.close();
    this.server = null;
    this.port = 0;
  }

  authorized(req) {
    const got = Buffer.from(String(req.headers.authorization || ''));
    const want = Buffer.from(`Bearer ${this.token}`);
    return got.length === want.length && crypto.timingSafeEqual(got, want);
  }

  async handle(req, res) {
    const plain = (code, words, more = {}) => { res.writeHead(code, { 'Content-Type': 'text/plain; charset=utf-8', ...more }); res.end(words); };
    // a web page in a browser on this machine could reach 127.0.0.1: it always says where it comes from, and is turned away
    if (req.headers.origin) return plain(403, 'Not for web pages.');
    const host = String(req.headers.host || '').toLowerCase();
    if (host !== `127.0.0.1:${this.port}` && host !== `localhost:${this.port}`) return plain(403, 'Wrong host.');
    if (String(req.url || '').split('?')[0] !== '/mcp') return plain(404, 'Not here.');
    if (!this.authorized(req)) return plain(401, 'The key is missing or wrong.');
    if (req.method === 'DELETE') {
      const sid = String(req.headers['mcp-session-id'] || '');
      this.sessions.delete(sid);
      return plain(200, '');
    }
    // nothing is ever sent to the chats unasked: no stream to keep open
    if (req.method !== 'POST') return plain(405, 'POST only.', { Allow: 'POST, DELETE' });
    if (!/application\/json/i.test(String(req.headers['content-type'] || ''))) return plain(415, 'JSON only.');
    let body;
    try { body = JSON.parse(await this.read(req)); } catch (err) { return this.json(res, 400, { jsonrpc: '2.0', id: null, error: { code: -32700, message: `Not JSON: ${err.message}` } }); }
    const many = Array.isArray(body);
    const list = many ? body : [body];
    let sid = String(req.headers['mcp-session-id'] || '');
    const first = list.find((m) => m && m.method === 'initialize');
    if (first || !sid) sid = crypto.randomUUID();
    const drv = this.session(sid, req);
    const answers = [];
    for (const msg of list) {
      const a = await this.answer(drv, msg);
      if (a) answers.push(a);
    }
    const head = { 'Mcp-Session-Id': sid };
    if (!answers.length) { res.writeHead(202, head); res.end(); return undefined; }
    return this.json(res, 200, many ? answers : answers[0], head);
  }

  read(req) {
    return new Promise((done, fail) => {
      const parts = [];
      let size = 0;
      req.on('data', (c) => {
        size += c.length;
        if (size > BODY_MAX) { fail(new Error('too large')); req.destroy(); return; }
        parts.push(c);
      });
      req.on('end', () => done(Buffer.concat(parts).toString('utf8')));
      req.on('error', fail);
    });
  }

  json(res, code, obj, head = {}) {
    const text = JSON.stringify(obj);
    res.writeHead(code, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(text), ...head });
    res.end(text);
  }

  /**
   * The chat behind a session. A session this app does not know (the app was started again under a running chat) is
   * taken as a new one: the chat goes on browsing without being told to connect again.
   */
  session(sid, req) {
    let drv = this.sessions.get(sid);
    if (!drv) {
      drv = { sid, pid: 0, name: 'A chat', key: '', chat: '', current: '', acts: 0, made: Date.now(), seen: Date.now() };
      this.sessions.set(sid, drv);
      drv.owner = this.ownerOf(req.socket.remotePort).then((pid) => {
        drv.pid = pid;
        this.name(drv);
        this.browser.changed();
      });
    }
    drv.seen = Date.now();
    return drv;
  }

  /**
   * The chat's name as this app shows it, looked up again at each step: it may have been named since. The pages it
   * drives hold this same object, so they follow.
   */
  name(drv) {
    const c = this.who(drv.pid, drv);
    if (c) Object.assign(drv, { name: c.name || 'A chat', key: c.key || '', chat: c.chat || '', cwd: c.cwd || '' });
  }

  /** The number of the program on the other end of a connection to this door, from Windows' own table of connections. */
  ownerOf(remotePort) {
    return new Promise((done) => {
      execFile('netstat', ['-ano', '-p', 'TCP'], { windowsHide: true, timeout: 8000, maxBuffer: 16 * 1024 * 1024 }, (err, out) => {
        if (err) { done(0); return; }
        for (const line of String(out).split(/\r?\n/)) {
          const m = /^\s*TCP\s+\S+:(\d+)\s+\S+:(\d+)\s+\S+\s+(\d+)\s*$/.exec(line);
          if (m && Number(m[1]) === remotePort && Number(m[2]) === this.port) { done(Number(m[3])); return; }
        }
        done(0);
      });
    });
  }

  /** Whether the chat behind a page has ended: its program is gone. */
  gone(owner) {
    if (!owner || !owner.pid) return Date.now() - (owner ? owner.seen || 0 : 0) > 60 * 60e3;
    try { process.kill(owner.pid, 0); return false; } catch { return true; }
  }

  async answer(drv, msg) {
    if (!msg || typeof msg !== 'object' || msg.jsonrpc !== '2.0') return { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Not a JSON-RPC 2.0 message.' } };
    // answers to questions this door never asks, and notices: nothing to say back
    if (typeof msg.method !== 'string' || msg.id === undefined || msg.id === null) return null;
    const ok = (result) => ({ jsonrpc: '2.0', id: msg.id, result });
    const p = msg.params && typeof msg.params === 'object' ? msg.params : {};
    switch (msg.method) {
      case 'initialize': {
        const asked = String(p.protocolVersion || '');
        return ok({
          protocolVersion: VERSIONS.includes(asked) ? asked : VERSIONS[1],
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: NAME, title: 'Lowlit browser', version: '1.0.0' },
          instructions: INSTRUCTIONS,
        });
      }
      case 'ping': return ok({});
      case 'tools/list': return ok({ tools: TOOLS });
      case 'tools/call': return ok(await this.call(drv, String(p.name || ''), p.arguments && typeof p.arguments === 'object' ? p.arguments : {}));
      default: return { jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: `No ${msg.method} here.` } };
    }
  }

  async call(drv, name, args) {
    const [kind, calls, what] = TARGETS.find(([, map]) => Object.hasOwn(map, name)) || [];
    if (!kind) return { content: [{ type: 'text', text: `There is no tool ${name}.` }], isError: true };
    const target = this[kind];
    if (!target) return { content: [{ type: 'text', text: `The ${what} is not ready: Lowlit is still starting.` }], isError: true };
    // which chat calls decides beside which chat the Viewer shows: its program is known before such a tool runs
    if (kind === 'viewer' && !drv.pid && drv.owner) await drv.owner;
    this.name(drv);
    try {
      const r = await target[calls[name]](drv, args);
      const content = [{ type: 'text', text: r.text }];
      for (const im of [r.image, ...(Array.isArray(r.images) ? r.images : [])]) if (im) content.push({ type: 'image', data: im.data, mimeType: im.mimeType });
      return { content };
    } catch (err) {
      if (!(err instanceof Say)) this.log(`${kind} tool ${name}: ${err && err.stack}`);
      return { content: [{ type: 'text', text: err instanceof Say ? err.message : `The ${what} could not do it: ${err && err.message}` }], isError: true };
    }
  }
}

// ---- the door in Claude Code's own list of servers ----

/** This door as Claude Code's list of servers for every folder holds it now ({ url, auth }), or null. Only its own entry is read. */
function listed(home = os.homedir()) {
  try {
    const all = JSON.parse(fs.readFileSync(path.join(home, '.claude.json'), 'utf8'));
    const s = all && all.mcpServers && all.mcpServers[NAME];
    return s ? { url: String(s.url || ''), auth: String((s.headers && (s.headers.Authorization || s.headers.authorization)) || '') } : null;
  } catch {
    return null;
  }
}

/**
 * Runs `claude mcp ...` the way a terminal would (through cmd, so `claude` is found on the PATH however it was
 * installed): Claude Code writes its own list. env: what the chats start with.
 */
function claude(args, env) {
  return new Promise((done) => {
    exec(`claude ${args}`, { windowsHide: true, timeout: 60000, env: env || process.env }, (err, out, errOut) => {
      done({ ok: !err, said: `${out || ''}${errOut || ''}`.trim().slice(0, 400) });
    });
  });
}

/**
 * Puts this door in Claude Code's list of servers for every folder, or brings its entry up to date: chats started
 * from then on can browse; running chats keep what they started with. ok: the list says so now. said: why not.
 */
async function register({ port, token, env, log = () => {} }) {
  const url = `http://127.0.0.1:${port}/mcp`;
  const auth = `Bearer ${token}`;
  const now = listed();
  if (now && now.url === url && now.auth === auth) return { ok: true, said: '' };
  if (now) await claude(`mcp remove ${NAME} -s user`, env);
  const r = await claude(`mcp add --transport http --scope user ${NAME} ${url} --header "Authorization: ${auth}"`, env);
  const after = listed();
  const ok = Boolean(after && after.url === url && after.auth === auth);
  // what claude said may repeat the line it was given: the key never reaches a log or the window
  const said = r.said.split(token).join('(key)');
  log(ok ? `browser: listed in Claude Code at ${url}` : `browser: not listed in Claude Code (${said || 'no answer'})`);
  return { ok, said: ok ? '' : said || 'Claude Code gave no answer.' };
}

/** Takes this door out of Claude Code's list of servers. */
async function unregister({ env, log = () => {} } = {}) {
  if (!listed()) return { ok: true, said: '' };
  const r = await claude(`mcp remove ${NAME} -s user`, env);
  const ok = !listed();
  log(ok ? 'browser: taken out of Claude Code\'s list' : `browser: still in Claude Code's list (${r.said || 'no answer'})`);
  return { ok, said: ok ? '' : r.said || 'Claude Code gave no answer.' };
}

module.exports = { Door, register, unregister, listed, NAME, PORT, TOOLS };
