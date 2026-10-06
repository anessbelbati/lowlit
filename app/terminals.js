'use strict';
/* global Terminal, FitAddon, UnicodeGraphemesAddon, WebglAddon, desk, toast */
// The terminal widgets: one per chat. Up to four are on screen at a time, each
// in a place of its own and sized to it. One that is not on screen keeps taking
// its chat's output into its own history; it only stops drawing.

// Windows Terminal's default look (Cascadia Mono 12pt, the Campbell colours),
// so a session here reads like the tabs it replaces. Only the ground is the
// window's own: the colour of the panel the terminal sits in (--panel of the
// look in front, see setGround), so the terminal has no edge of its own.
const CAMPBELL = {
  background: '#111113',
  foreground: '#cccccc',
  cursor: '#ffffff',
  cursorAccent: '#111113',
  selectionBackground: '#ffffff40',
  black: '#0c0c0c',
  red: '#c50f1f',
  green: '#13a10e',
  yellow: '#c19c00',
  blue: '#0037da',
  magenta: '#881798',
  cyan: '#3a96dd',
  white: '#cccccc',
  brightBlack: '#767676',
  brightRed: '#e74856',
  brightGreen: '#16c60c',
  brightYellow: '#f9f1a5',
  brightBlue: '#3b78ff',
  brightMagenta: '#b4009e',
  brightCyan: '#61d6d6',
  brightWhite: '#f2f2f2',
};
const FONT_MIN = 10;
const FONT_MAX = 26;
// A run of changes of size is over once none has come for this long.
const RUN_MS = 300;
// A full-screen program asked to draw itself again is first told of one column less; its size is given back once it
// has drawn at that one (never sooner than the first, never later than the second): told of both before it looks,
// it finds its size unchanged and draws nothing.
const NUDGE_MIN_MS = 120;
const NUDGE_MAX_MS = 1000;
// The typing meter. A key is timed only while its program has printed nothing by itself for QUIET_MS (an answer
// streaming in is no echo). What it prints within REPLY_MS of a key so timed answers that key (Claude Code may draw its
// box twice for one key), not by itself. A key with nothing back after ECHO_WAIT_MS showed nothing, and the next key
// is timed instead; an echo later than ECHO_MAX_MS was none. At most ECHO_KEEP timings wait for the next report.
const QUIET_MS = 300;
const REPLY_MS = 250;
const ECHO_WAIT_MS = 500;
const ECHO_MAX_MS = 2000;
const ECHO_KEEP = 5000;
const MODIFIER_KEYS = new Set(['Control', 'Shift', 'Alt', 'AltGraph', 'Meta', 'CapsLock']);
// a web address as it appears in running text; what may trail it (a full stop, a closing bracket) is cut off below
const WEB_ADDRESS = /https?:\/\/[^\s<>"'`\\^{}|]+/g;

/** Candidates only: main decides whether each name belongs to a file. Offsets count UTF-16 characters, like the cell map. */
function pathCandidates(text) {
  const found = [];
  const tokens = /"[^"\r\n]+"(?::\d+(?::\d+)?|\(\d+(?:,\d+)?\))?|'[^'\r\n]+'(?::\d+(?::\d+)?|\(\d+(?:,\d+)?\))?|`[^`\r\n]+`(?::\d+(?::\d+)?|\(\d+(?:,\d+)?\))?|[^\s<>"'`|]+/g;
  for (const m of text.matchAll(tokens)) {
    let word = m[0];
    let index = m.index;
    const quote = /^["'`]/.test(word) ? word[0] : '';
    let outside = '';
    if (quote) {
      const end = word.lastIndexOf(quote);
      outside = word.slice(end + 1);
      word = word.slice(1, end);
      index++;
    } else {
      const pairs = { '(': ')', '[': ']', '{': '}' };
      while (pairs[word[0]]) {
        const open = word[0];
        const close = pairs[open];
        let depth = 0;
        let end = -1;
        for (let i = 0; i < word.length; i++) {
          if (word[i] === open) depth++;
          if (word[i] === close && --depth === 0) { end = i; break; }
        }
        // Balanced brackets inside a name belong to the file, as in [page].js.
        if (end >= 0 && !/^[.,;:!?)\]}]*$/.test(word.slice(end + 1))) break;
        word = word.slice(1);
        index++;
      }
      word = word.replace(/[.,;:!?]+$/, '');
      while (/[)\]}]$/.test(word)) {
        const close = word.slice(-1);
        const open = Object.keys(pairs).find((key) => pairs[key] === close);
        let depth = 0;
        for (const ch of word) { if (ch === open) depth++; else if (ch === close) depth--; }
        if (depth >= 0) break;
        word = word.slice(0, -1).replace(/[.,;:!?]+$/, '');
      }
    }
    let place = /(?::(\d{1,7})(?::(\d{1,7}))?|\((\d{1,7})(?:,(\d{1,7}))?\))$/.exec(outside || word);
    if (outside && (!place || place.index !== 0)) continue;
    const file = place && !outside ? word.slice(0, place.index) : word;
    const body = /^[A-Za-z]:[\\/]/.test(file) ? file.slice(2) : file;
    if (!body || /[:\r\n<>|]/.test(body) || /\(\d+(?:,\d+)?\)?$/.test(body)
      || /^[\\/]{2}/.test(file) || (!/[\\/]/.test(body) && !/^.+\.[^.\\/\s]+$/.test(body))) continue;
    const length = word.length;
    found.push({ path: file, line: place ? Number(place[1] || place[3]) : undefined,
      column: place && (place[2] || place[4]) ? Number(place[2] || place[4]) : undefined,
      index, text: text.slice(index, index + length) });
    if (found.length === 20) break;
  }
  return found;
}

/**
 * How many cells each character takes. The console lays text out by counting
 * cells and the widget must count the same, or everything after a miscounted
 * character on that line is drawn off. The widget's built-in table gives most
 * emoji one cell; the add-on's counts them as the console does (two cells,
 * also when an emoji is built from several code points), but its data stops at
 * the emoji of 2020 and draws every later one a cell short. Those sit in
 * blocks that hold nothing but emoji, so the blocks are widened here, which
 * covers the ones still to come as well.
 */
function widthTable() {
  const found = [];
  // the add-on hands its tables to whatever terminal it is given; this made-up one only collects them
  new UnicodeGraphemesAddon.UnicodeGraphemesAddon().activate({ unicode: { register: (table) => found.push(table) } });
  const base = found.find((table) => table.version === '15-graphemes');
  const newer = (cp) => (cp >= 0x1FA70 && cp <= 0x1FAFF)
    || (cp >= 0x1F90C && cp <= 0x1F9FF && cp !== 0x1F93B && cp !== 0x1F946)
    || (cp >= 0x1F6D5 && cp <= 0x1F6DF)
    || cp === 0x1F7F0;
  return {
    version: 'desk',
    wcwidth: (cp) => (newer(cp) ? 2 : base.wcwidth(cp)),
    charProperties(cp, preceding) {
      const props = base.charProperties(cp, preceding);
      // bit 0: joined onto the character before it; bits 1-2: its cells.
      // Only a one-cell character standing on its own is widened.
      return newer(cp) && (props & 7) === 2 ? (props & ~6) | 4 : props;
    },
  };
}

const Terms = (() => {
  const all = new Map();       // chat id -> { id, term, fit, el, opened, gl, title, told }
  let park = null;             // where the terminals that are not on screen wait
  let info = null;
  let table = null;
  let shown = [];              // the chats on screen
  let active = '';             // the one that holds the keyboard
  // the size a new terminal starts at: the one last fitted
  let cols = 120;
  let rows = 30;
  let fontSize = 16;
  let frozen = false;          // an edge of the window is being dragged: sizes wait until it is let go
  let onTitle = () => {};
  let onFont = () => {};
  let onScale = () => {};
  let keyAt = -Infinity;       // when a key was last pressed in a terminal (performance.now)
  const echoes = [];           // the typing meter: ms from a key to the frame that shows what its program printed back

  /**
   * parkEl: a hidden element that holds the terminals not on screen. room: the element the places on screen share;
   * when its size changes, so does theirs.
   */
  function init(parkEl, room, deskInfo, titleChanged, fontChanged, scaleChanged) {
    park = parkEl;
    info = deskInfo;
    table = widthTable();
    cols = info.size.cols;
    rows = info.size.rows;
    fontSize = (info.settings && info.settings.fontSize) || 16;
    onTitle = titleChanged;
    onFont = fontChanged || onFont;
    onScale = scaleChanged || onScale;
    // Chromium paints a canvas whose graphics context is gone white all over, and the add-on waits 3 s for it to come
    // back before the plain renderer takes over: a terminal's canvas is off the screen while its context is gone
    const ownCanvas = (e) => (e.target instanceof HTMLCanvasElement && e.target.closest('.xterm') ? e.target : null);
    document.addEventListener('webglcontextlost', (e) => { const c = ownCanvas(e); if (c) c.style.visibility = 'hidden'; }, true);
    document.addEventListener('webglcontextrestored', (e) => { const c = ownCanvas(e); if (c) c.style.visibility = ''; }, true);
    // A timer, not an animation frame: frames stop while the window is hidden,
    // and a resize must still reach the consoles.
    let pending = 0;
    new ResizeObserver(() => {
      clearTimeout(pending);
      pending = setTimeout(fit, 60);
    }).observe(room);
    watchScale();
  }

  /**
   * The window went to a screen of another scaling (or the scaling of its screen changed). Its places keep their size
   * in the page's units, so nothing else tells the terminals: each would go on with cells measured for the old
   * scaling, drawn off their places. Everything is drawn again.
   */
  function watchScale() {
    const was = window.devicePixelRatio;
    matchMedia(`(resolution: ${was}dppx)`).addEventListener('change', () => {
      watchScale();
      if (window.devicePixelRatio === was) return;
      redrawAll();
      onScale(window.devicePixelRatio);
    }, { once: true });
  }

  function copy(term) {
    const text = term.getSelection();
    if (text) desk.writeClipboard(text);
    return Boolean(text);
  }
  async function paste(term) {
    const text = await desk.readClipboard();
    if (text) term.paste(text);
  }

  function keys(term, id) {
    let copiedAt = 0;
    term.attachCustomKeyEventHandler((e) => {
      if (e.type === 'keydown' && !MODIFIER_KEYS.has(e.key)) {
        keyAt = performance.now();
        const entry = all.get(id);
        if (entry) entry.keyDownAt = keyAt;
      }
      const bare = !e.altKey && !e.metaKey;
      // Shift+Enter would send the same byte as Enter. A line feed is the
      // newline every agent CLI accepts (it is what Ctrl+J sends).
      if (e.key === 'Enter' && e.shiftKey && !e.ctrlKey && bare) {
        if (e.type === 'keydown') {
          e.preventDefault();
          desk.input(id, '\n');
        }
        return false;
      }
      // Ctrl+Shift+C and Ctrl+Shift+V: copy and paste, whatever the program in the terminal does with Ctrl+C and Ctrl+V.
      if ((e.code === 'KeyC' || e.code === 'KeyV') && e.ctrlKey && e.shiftKey && bare) {
        if (e.type === 'keydown') {
          e.preventDefault();
          if (e.code === 'KeyC') copy(term); else paste(term);
        }
        return false;
      }
      // Ctrl+V pastes instead of sending ^V, as Windows Terminal does (there too an agent CLI takes a picture with Alt+V).
      if (e.code === 'KeyV' && e.ctrlKey && !e.shiftKey && bare) {
        if (e.type === 'keydown') {
          e.preventDefault();
          paste(term);
        }
        return false;
      }
      // Ctrl+C copies when text is selected and interrupts otherwise, as Windows Terminal does.
      if (e.code === 'KeyC' && e.ctrlKey && !e.shiftKey && bare) {
        if (term.hasSelection()) {
          if (e.type === 'keydown') {
            e.preventDefault();
            copy(term);
            term.clearSelection();
            copiedAt = Date.now();
          }
          return false;
        }
        // the key still held down from that copy must not turn into an interrupt
        if (e.repeat && Date.now() - copiedAt < 3000) return false;
      }
      return true;
    });
  }

  /** A click on a web address opens it in the browser, with Ctrl held: a bare click belongs to the program in the terminal. */
  function follow(event, address) {
    if (event.ctrlKey) desk.openUrl(address);
    else toast('Hold Ctrl and click to open the link.', 2200);
  }

  /** Web addresses in plain text. A line the console wrapped is read as one, so an address broken over two rows stays whole. */
  function links(term) {
    term.registerLinkProvider({
      provideLinks(y, done) {
        const buf = term.buffer.active;
        let first = y - 1;
        while (first > 0 && buf.getLine(first) && buf.getLine(first).isWrapped) first--;
        let last = y - 1;
        while (buf.getLine(last + 1) && buf.getLine(last + 1).isWrapped) last++;
        if (last - first > 24) { done(undefined); return; }
        let text = '';
        const at = [];           // where each character of `text` sits: [column, row]
        for (let row = first; row <= last; row++) {
          const line = buf.getLine(row);
          if (!line) break;
          for (let x = 0; x < line.length; x++) {
            const cell = line.getCell(x);
            // the second cell of a wide character holds nothing of its own
            if (!cell || cell.getWidth() === 0) continue;
            const chars = cell.getChars() || ' ';
            for (let i = 0; i < chars.length; i++) at.push([x, row]);
            text += chars;
          }
        }
        const found = [];
        for (const m of text.matchAll(WEB_ADDRESS)) {
          const address = m[0].replace(/[.,;:!?)\]]+$/, '');
          const start = at[m.index];
          const end = at[m.index + address.length - 1];
          if (!start || !end || end[1] < y - 1 || start[1] > y - 1) continue;
          found.push({ text: address, range: { start: { x: start[0] + 1, y: start[1] + 1 }, end: { x: end[0] + 1, y: end[1] + 1 } }, activate: follow });
        }
        done(found.length ? found : undefined);
      },
    });
  }

  function fileLinks(term, id) {
    const cache = new Map();
    term.registerLinkProvider({
      async provideLinks(y, done) {
        const buf = term.buffer.active;
        let first = y - 1;
        let last = first;
        while (first > 0 && buf.getLine(first) && buf.getLine(first).isWrapped && last - first < 24) first--;
        while (buf.getLine(last + 1) && buf.getLine(last + 1).isWrapped && last - first < 24) last++;
        if (last - first >= 24) { done(undefined); return; }
        let text = '';
        const at = [];
        for (let row = first; row <= last; row++) {
          const line = buf.getLine(row);
          if (!line) break;
          for (let x = 0; x < line.length; x++) {
            const cell = line.getCell(x);
            if (!cell || cell.getWidth() === 0) continue;
            const chars = cell.getChars() || ' ';
            for (let i = 0; i < chars.length; i++) at.push([x, row]);
            text += chars;
          }
        }
        const candidates = pathCandidates(text);
        if (!candidates.length) { done(undefined); return; }
        const key = JSON.stringify([buf.type, first, term.cols, text]);
        const now = Date.now();
        for (const [k, value] of cache) if (value.until <= now) cache.delete(k);
        let answer = cache.get(key);
        if (!answer) {
          if (cache.size >= 64) cache.delete(cache.keys().next().value);
          answer = { until: now + 10000, files: Promise.resolve().then(() => desk.pathsExist(id, candidates.map((c) => c.path))) };
          cache.set(key, answer);
        }
        try {
          const exists = await answer.files;
          // Output or a resize while main was checking must not put links over different text.
          if (term.buffer.active !== buf || !at.length) { done(undefined); return; }
          let current = '';
          for (let row = first; row <= last; row++) {
            const line = buf.getLine(row);
            if (!line) { done(undefined); return; }
            current += line.translateToString(false);
          }
          if (current !== text) { done(undefined); return; }
          const found = [];
          candidates.forEach((c, i) => {
            if (!exists[i]) return;
            const start = at[c.index];
            const end = at[c.index + c.text.length - 1];
            if (!start || !end || end[1] < y - 1 || start[1] > y - 1) return;
            found.push({ text: c.text, range: { start: { x: start[0] + 1, y: start[1] + 1 }, end: { x: end[0] + 1, y: end[1] + 1 } },
              async activate(event) {
                if (!event.ctrlKey) { toast('Hold Ctrl and click to open the file.', 2200); return; }
                try {
                  const opened = await desk.openFile(id, c.path, c.line, c.column);
                  if (!opened || !opened.opened) toast('The file could not be opened.', 2200);
                  else if (opened.notice) toast(opened.notice, 6500);
                } catch { toast('The file could not be opened.', 2200); }
              } });
          });
          done(found.length ? found : undefined);
        } catch { cache.delete(key); done(undefined); }
      },
    });
  }

  /**
   * A program in the terminal asking to put text on the clipboard (how the
   * agent CLI copies a selection made on its own screen). It may write; a
   * request to read the clipboard is never answered.
   */
  function clipboardRequest(data) {
    const cut = data.indexOf(';');
    const body = cut < 0 ? '' : data.slice(cut + 1);
    if (!body || body === '?') return true;
    try {
      const text = new TextDecoder().decode(Uint8Array.from(atob(body), (ch) => ch.charCodeAt(0)));
      if (text) desk.writeClipboard(text);
    } catch {
      // not the encoding the request is meant to carry: nothing is copied
    }
    return true;
  }

  function mouse(entry) {
    const { term, el } = entry;
    // Right click copies the selection, or pastes when there is none, as Windows Terminal does. While the program
    // in the terminal is taking the mouse for itself, the click is its own unless Shift is held.
    el.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      if (term.hasSelection()) { copy(term); term.clearSelection(); return; }
      if (term.modes.mouseTrackingMode === 'none' || e.shiftKey) paste(term);
    });
    // A file dropped on a terminal types its path, quoted when it holds a space.
    el.addEventListener('dragover', (e) => {
      if (!e.dataTransfer || !Array.from(e.dataTransfer.types).includes('Files')) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    });
    el.addEventListener('drop', (e) => {
      const files = e.dataTransfer ? Array.from(e.dataTransfer.files) : [];
      if (!files.length) return;
      e.preventDefault();
      const paths = files.map((f) => desk.pathOf(f)).filter(Boolean).map((p) => (/\s/.test(p) ? `"${p}"` : p));
      if (paths.length) term.paste(paths.join(' '));
      term.focus();
    });
    // Ctrl and the wheel: text size.
    term.attachCustomWheelEventHandler((e) => {
      if (!e.ctrlKey) return true;
      e.preventDefault();
      zoom(e.deltaY < 0 ? 1 : -1);
      return false;
    });
  }

  function create(id) {
    if (all.has(id)) return all.get(id);
    const el = document.createElement('div');
    el.className = 'term';
    el.hidden = true;
    park.append(el);
    const term = new Terminal({
      cols,
      rows,
      fontFamily: '"Cascadia Mono", Consolas, monospace',
      fontSize,
      theme: { ...CAMPBELL },
      cursorStyle: 'bar',
      cursorBlink: true,
      scrollback: 10000,
      // The Windows console re-wraps long lines itself on resize; told so, the widget does not wrap them a second time.
      windowsPty: { backend: 'conpty', buildNumber: info.build },
      // links a program marks as such (it names their target itself)
      linkHandler: { activate: follow, allowNonHttpProtocols: false },
      // needed for the width-table switch below, which the widget still labels "proposed"
      allowProposedApi: true,
    });
    const fitter = new FitAddon.FitAddon();
    term.loadAddon(fitter);
    term.unicode.register(table);
    term.unicode.activeVersion = 'desk';
    // told: the size its console was last given ('' until it has been fitted once). seq: the last arrival of its
    // console's output it holds (main numbers them). held: arrivals kept back while what came before them is on its
    // way. muted: it is reading old output, and what it would answer goes nowhere. redraw: a full-screen program
    // is to be asked to draw itself again once the terminal is on screen. outs: how many arrivals it has drawn.
    // run: what its console was told when the widget's own size began to change (null while it holds still).
    // keyDownAt, quietKeyAt, echoFrom, otherAt: the typing meter's marks (a key went down; the last key typed while its
    // program was quiet; the key whose echo is awaited; the last output its program printed by itself).
    const entry = { id, term, fit: fitter, el, opened: false, gl: null, glLost: 0, glFails: 0, glRetry: 0, title: '', told: '', seq: 0, held: null, muted: false, redraw: false, nudged: 0,
      outs: 0, run: null, runEnd: 0, keyDownAt: -Infinity, quietKeyAt: -Infinity, echoFrom: 0, otherAt: -Infinity };
    keys(term, id);
    links(term);
    fileLinks(term, id);
    mouse(entry);
    term.parser.registerOscHandler(52, (data) => entry.muted || clipboardRequest(data));
    term.onData((data) => {
      if (entry.muted) return;
      // a character typed with a key (not a paste, the terminal answering its program, a click or focus) while its
      // program was quiet: those always show
      const now = performance.now();
      const typed = data.length === 1 && data >= ' ' && data !== '\x7f';
      if (typed && now - entry.keyDownAt < 50 && now - entry.otherAt > QUIET_MS) {
        entry.quietKeyAt = now;
        if (!entry.echoFrom || now - entry.echoFrom > ECHO_WAIT_MS) entry.echoFrom = entry.keyDownAt;
      }
      desk.input(id, data);
    });
    term.onTitleChange((title) => { entry.title = title; onTitle(id, title); });
    all.set(id, entry);
    return entry;
  }

  function remove(id) {
    const entry = all.get(id);
    if (!entry) return;
    if (active === id) { active = ''; window.term = null; }
    shown = shown.filter((x) => x !== id);
    clearTimeout(entry.runEnd);
    dropGl(entry);
    entry.term.dispose();
    entry.el.remove();
    all.delete(id);
  }

  /**
   * A graphics-card context for each terminal on screen, and for no other. It
   * paints box and block characters itself, so frames, bars and block art come
   * out seamless; plain page text leaves hairline gaps between them. If the
   * context is lost (the graphics driver restarted, the computer slept) the
   * plain renderer carries on, far slower, and a new context is tried a moment
   * later while the terminal is still on screen.
   */
  function addGl(entry) {
    if (info.renderer !== 'webgl' || entry.gl) return;
    clearTimeout(entry.glRetry);
    entry.glRetry = 0;
    try {
      const gl = new WebglAddon.WebglAddon();
      gl.onContextLoss(() => {
        if (entry.gl !== gl) return;
        dropGl(entry);
        entry.glLost++;
        desk.slow(`a terminal lost its graphics context (${entry.glLost} time${entry.glLost === 1 ? '' : 's'}): drawn by the page's own text until it is back`);
        const wait = Math.min(30000, 1000 * 2 ** Math.min(5, entry.glLost - 1));
        entry.glRetry = setTimeout(() => { entry.glRetry = 0; if (shown.includes(entry.id)) addGl(entry); }, wait);
      });
      entry.term.loadAddon(gl);
      entry.gl = gl;
      entry.glFails = 0;
    } catch {
      // no usable graphics context (the graphics process is starting again, or the chip cannot be had): the plain
      // renderer draws meanwhile, and a context is tried again, less and less often
      entry.glFails = (entry.glFails || 0) + 1;
      const wait = Math.min(30000, 1000 * 2 ** Math.min(5, entry.glFails - 1));
      entry.glRetry = setTimeout(() => { entry.glRetry = 0; if (shown.includes(entry.id)) addGl(entry); }, wait);
    }
  }
  /**
   * The widget's own dispose leaves the context to the garbage collector, and the page holds only 16 at a time: past
   * that it takes the oldest away, which can be a terminal still on screen. Let go of, it is freed at once. The
   * context is reached for inside the add-on, as wake() does; if a later version keeps it elsewhere, it is left to
   * the garbage collector as before.
   */
  function dropGl(entry) {
    clearTimeout(entry.glRetry);
    entry.glRetry = 0;
    if (!entry.gl) return;
    const renderer = entry.gl._renderer;
    const ctx = renderer && renderer._gl;
    try { entry.gl.dispose(); } catch { /* its context was already gone */ }
    entry.gl = null;
    try {
      const lose = ctx && typeof ctx.isContextLost === 'function' && !ctx.isContextLost() && ctx.getExtension('WEBGL_lose_context');
      if (lose) lose.loseContext();
    } catch { /* already gone */ }
  }

  /**
   * Tells a terminal that it can be seen again. The widget finds that out by itself only when the next frame is
   * drawn, and until then it puts off every change of size: output that arrives in between is laid out against
   * the height the terminal had before, which leaves it scrolled up by the difference, and no longer following
   * what is printed. It has no public way to be told, so this reaches into it (as its own fit add-on does); if a
   * later version has no such part, the terminal behaves as it would without this.
   */
  function wake(entry) {
    const render = entry.term._core && entry.term._core._renderService;
    if (render && render._isPaused && typeof render._handleIntersectionChange === 'function') {
      render._handleIntersectionChange({ isIntersecting: true, intersectionRatio: 1 });
    }
  }

  /**
   * Puts terminals on screen, each in its place. places: [{ id, host }], the chats to show and the element each
   * is drawn in; none hides them all. front: the one that takes the keyboard. The others stop drawing.
   */
  function show(places, front) {
    const want = new Map(places.filter((p) => all.has(p.id)).map((p) => [p.id, p.host]));
    for (const [id, t] of all) {
      if (want.has(id)) continue;
      t.el.hidden = true;
      dropGl(t);
      if (t.el.parentElement !== park) park.append(t.el);
    }
    for (const [id, host] of want) {
      const t = all.get(id);
      if (t.el.parentElement !== host) host.append(t.el);
      t.el.hidden = false;
      // opened only once it can be seen: the widget measures its font on the spot
      if (!t.opened) {
        t.term.open(t.el);
        t.opened = true;
      }
      wake(t);
      addGl(t);
    }
    shown = [...want.keys()];
    active = want.has(front) ? front : '';
    window.term = active ? all.get(active).term : null;
    fit();
    if (active) all.get(active).term.focus();
  }

  /**
   * Sizes each terminal on screen to the place it is drawn in, and tells its console. Asked for several times in one
   * go (a line shown and hidden again, two panels moving at once), it fits once, to where things end up: a size
   * that is gone again before the go ends never reaches a terminal or its console.
   */
  let fitting = false;
  function fit() {
    if (fitting) return;
    fitting = true;
    queueMicrotask(() => { fitting = false; fitNow(); });
  }

  /**
   * One that is not on screen keeps the size it had: it is fitted when it comes back. A place without a size
   * (hidden, or the window mid-minimise) is skipped: fitting to that would squeeze the console to two columns and
   * re-wrap everything on its screen.
   */
  function fitNow() {
    if (frozen) return;
    for (const id of shown) {
      const t = all.get(id);
      const host = t && t.el.parentElement;
      if (!t || !t.opened || !host || host.clientWidth < 80 || host.clientHeight < 40) continue;
      const want = t.fit.proposeDimensions();
      if (!want || !Number.isFinite(want.cols) || !Number.isFinite(want.rows)) continue;
      if (id === active || !active) { cols = want.cols; rows = want.rows; }
      if (t.term.cols !== want.cols || t.term.rows !== want.rows) {
        if (t.run === null) t.run = t.told;
        clearTimeout(t.runEnd);
        t.runEnd = setTimeout(() => runOver(t), RUN_MS);
        t.term.resize(want.cols, want.rows);
      }
      if (t.redraw && want.cols > 2) {
        // A full-screen program sends only what changed on its screen. Told of a new size it draws all of itself.
        t.redraw = false;
        t.told = '';
        t.nudged = Date.now() + NUDGE_MAX_MS;
        nudge(t, want.cols - 1, want.rows);
        continue;
      }
      if (t.nudged > Date.now()) continue;
      const size = `${want.cols}x${want.rows}`;
      if (t.told !== size) {
        t.told = size;
        desk.resize(id, want.cols, want.rows);
      }
    }
  }

  /** Tells the console one column less, and hands the terminal back to fit() once its program has drawn at that. */
  function nudge(t, narrower, height) {
    const outs = t.outs;
    const at = Date.now();
    desk.resize(t.id, narrower, height);
    const back = () => {
      if (all.get(t.id) !== t || !t.nudged) return;
      const waited = Date.now() - at;
      if (waited < NUDGE_MAX_MS && (waited < NUDGE_MIN_MS || t.outs === outs)) { setTimeout(back, 40); return; }
      t.nudged = 0;
      fit();
    };
    setTimeout(back, NUDGE_MIN_MS);
  }

  /**
   * The terminal's size held still. When it has come back to the size its console had before it began to change,
   * a full-screen program in it may have been told of the sizes in between too late to see any: to it nothing
   * changed, and it draws nothing, while the terminal has already dropped the rows the smaller sizes had no room
   * for. It is asked to draw itself again.
   */
  function runOver(t) {
    const from = t.run;
    t.run = null;
    t.runEnd = 0;
    if (all.get(t.id) !== t || !from || t.told !== from || t.term.buffer.active.type !== 'alternate') return;
    t.redraw = true;
    fit();
  }

  /** The text size of every terminal; the consoles on screen are then given their new number of rows and columns. */
  function setFontSize(size) {
    const next = Math.min(FONT_MAX, Math.max(FONT_MIN, Math.round(Number(size)) || fontSize));
    if (next === fontSize) return;
    fontSize = next;
    for (const t of all.values()) t.term.options.fontSize = next;
    fit();
  }
  /** The ground follows the panel the terminals sit in, whichever look is picked. */
  function setGround(color) {
    if (!/^#[0-9a-f]{6}$/i.test(color) || color === CAMPBELL.background) return;
    CAMPBELL.background = color;
    CAMPBELL.cursorAccent = color;
    for (const t of all.values()) t.term.options.theme = { ...CAMPBELL, ...t.own };
  }
  /** A chat's own colours over every terminal's (the Nest's chat in the Nest's mood); null gives it back the common ones. */
  function setTheme(id, own) {
    const t = all.get(id);
    const stamp = own ? JSON.stringify(own) : '';
    if (!t || (t.ownStamp || '') === stamp) return;
    t.ownStamp = stamp;
    t.own = own || null;
    t.term.options.theme = { ...CAMPBELL, ...t.own };
  }
  function zoom(step) {
    const before = fontSize;
    setFontSize(fontSize + step);
    if (fontSize !== before) onFont(fontSize);
  }

  /** seq: main's number for this arrival. One the terminal already holds (it came with the old output) is skipped. */
  function write(id, data, seq) {
    const entry = create(id);
    if (entry.held) entry.held.push({ data, seq });
    else take(entry, data, seq);
  }
  function take(entry, data, seq) {
    if (seq <= entry.seq) return;
    entry.seq = seq;
    entry.outs++;
    const now = performance.now();
    if (now - entry.quietKeyAt > REPLY_MS) entry.otherAt = now;
    const from = entry.echoFrom;
    entry.echoFrom = 0;
    if (!from || now - from >= ECHO_MAX_MS) {
      entry.term.write(data);
      return;
    }
    // timed to the frame that draws it; a hidden window draws none, and there to the moment the terminal has read it
    entry.term.write(data, () => {
      const timed = () => { const ms = performance.now() - from; if (ms < ECHO_MAX_MS && echoes.length < ECHO_KEEP) echoes.push(ms); };
      if (info.hidden) timed(); else requestAnimationFrame(timed);
    });
  }

  /**
   * Everything drawn again from scratch: after the window changed screen, scaling or graphics chip, after the computer
   * woke, and when asked (F5). Each terminal on screen gets a fresh graphics context and is measured and fitted again,
   * and a full-screen program in it is asked to draw its whole screen; one off screen is asked once it is back.
   */
  function redrawAll() {
    for (const t of all.values()) {
      if (!t.opened) continue;
      if (t.term.buffer.active.type === 'alternate') t.redraw = true;
      if (!shown.includes(t.id)) continue;
      wake(t);
      dropGl(t);
      addGl(t);
      const measure = t.term._core && t.term._core._charSizeService;
      if (measure && typeof measure.measure === 'function') measure.measure();
      t.term.refresh(0, t.term.rows - 1);
    }
    fit();
  }

  /** What arrives for this chat is kept back until what its console printed before this page was there is drawn. */
  function hold(id) {
    const entry = create(id);
    if (!entry.held) entry.held = [];
  }

  /**
   * What a chat's console printed before this page was there (see replay.cjs), drawn first and at the console's own
   * size, so what was laid out for that size lands where it was; then what arrived meanwhile. While the terminal reads
   * the old output, whatever it would answer is dropped. Resolves once it has read it.
   */
  function replay(id, tail) {
    const entry = all.get(id);
    if (!entry) return Promise.resolve();
    const held = entry.held || [];
    entry.held = null;
    let read = Promise.resolve();
    if (tail && tail.data) {
      if (tail.cols > 2 && tail.rows > 0) entry.term.resize(tail.cols, tail.rows);
      entry.seq = tail.seq;
      entry.muted = true;
      read = new Promise((done) => entry.term.write(tail.data, () => {
        entry.muted = false;
        entry.redraw = entry.term.buffer.active.type === 'alternate';
        done();
      }));
    } else if (tail) entry.seq = tail.seq;
    for (const piece of held) take(entry, piece.data, piece.seq);
    return read.then(() => fit());
  }

  function focus() {
    const entry = all.get(active);
    if (entry) entry.term.focus();
  }

  /**
   * While an edge of the window is dragged the terminals keep their size: each new size makes the program in them draw
   * its whole screen again. Let go, they are fitted once.
   */
  function freeze(on) {
    frozen = Boolean(on);
    if (!frozen) fit();
  }

  return { init, create, remove, show, fit, freeze, write, hold, replay, focus, setFontSize, setGround, setTheme, redrawAll, get: (id) => all.get(id), active: () => active, shown: () => shown.slice(),
    size: () => ({ cols, rows }), fontSize: () => fontSize,
    // ms since a key was last pressed in a terminal; the typing meter's timings (drain: the report takes them)
    sinceKey: () => performance.now() - keyAt,
    echoes: (drain) => { const list = echoes.slice(); if (drain) echoes.length = 0; return list; },
    // how the terminals on screen draw, for the note on a slow moment
    drawing: () => ({ shown: shown.length, gl: shown.filter((id) => all.get(id) && all.get(id).gl).length }) };
})();
