'use strict';
/* global desk, h, fill, icon, kept, toast, Sizes, Terms */
// The Browser: real web pages beside the chats. The chats open them, read them and click in them through Claude Code
// (main.cjs, browser.cjs, browser-mcp.cjs); the person watches, takes a page over, or browses in it too. Each chat has
// a browser of its own: the pages it opened, and the ones the person opened in it. The globe on a chat's strip opens
// and closes it, and the window remembers for each chat whether its browser was open. The panel is a third column of
// the window that slides in from its right edge while the chats make room; going to another chat it changes at once,
// to that chat's browser or to none. A page is a window of its own that main lays over this panel's page area once
// the panel stands still; while the panel moves, the app's window is dragged, or anything floats over it, a picture
// of the page stands in its place, so nothing jumps. Main learns where the page area is from here
// (desk.browser.place), and only from here. Under a main from before the browser there is no desk.browser: the panel
// and its buttons stay away.

const Browser = (() => {
  const MOVE_MS = 460;               // as long as the panel takes to slide (styles/browser.css)
  const MIN_W = 380;
  const FLOATS = ['picker', 'palette', 'leave', 'menu'];
  const SAID_MS = 60000;             // what a chat last did is said for this long after
  const KEPT_OPEN = 40;
  let api = null;
  let root = null;
  let els = null;
  let act = null;
  let view = { tabs: [], door: null };
  let open = false;
  let moving = false;
  let moves = 0;
  let moveTimer = 0;
  let moveDone = null;
  let asides = 0;
  let covered = false;
  let dragging = false;
  // whose browser the panel shows: key is a chat of this window, 's:' and a session that runs elsewhere, or '' for
  // every page (while no chat is in front)
  let scope = { key: '', name: 'Every page' };
  const opened = new Set();          // the browsers that are open: one per chat
  const fronts = new Map();          // a browser -> the page last in front in it
  const needs = new Map();           // page -> { message, from }: a chat asked for the person on that page
  let front = '';                    // the page in front in the panel
  const acted = new Map();           // page -> how many steps chats had taken on it when main last said
  let told = false;                  // main has said once where every page stands (since this page loaded)
  let wanted = null;                 // a page main asked for before its list had it: { ...what it asked, until }
  let placedKey = '';
  let shows = false;                 // main was last told that a page shows in the panel
  let frame = 0;
  let frameTimer = 0;
  let width = 0;                     // the panel's width now
  let userW = 0;                     // the width the person gave it
  let stillOf = '';
  const tabEls = new Map();

  const can = () => Boolean(api);
  const isOpen = () => open;
  const tabOf = (id) => view.tabs.find((t) => t.id === id) || null;
  const inScope = (t, key = scope.key) => Boolean(t) && (key === '' || t.home === key);
  const scoped = (key = scope.key) => view.tabs.filter((t) => inScope(t, key));
  const host = (url) => { try { const u = new URL(url); return u.protocol === 'file:' ? 'file' : u.hostname.replace(/^www\./, ''); } catch { return ''; } };
  /** An address as the bar shows it while it is not being typed in: no https://, no lone slash after the site's name. */
  const pretty = (url) => (!url || url === 'about:blank' ? '' : url.replace(/^https:\/\//, '').replace(/^((?:http:\/\/)?[^/?#]+)\/$/, '$1'));
  const ago = (at) => { const s = Math.max(0, Math.round((Date.now() - at) / 1000)); return s < 60 ? `${s}s ago` : `${Math.round(s / 60)}m ago`; };
  const whoOf = (t) => (t.owner ? t.owner.name : t.guest ? t.guest.name : '');
  const usual = () => Math.round(window.innerWidth * 0.42);

  /**
   * actions: changed() what the browsers hold changed; scopes() whose browser may show, the first preferred:
   * [{ key, name }]; palette(), inside() the person clicked into a page, done() the panel let go of the keyboard,
   * opening() it was asked to slide in (the Viewer steps aside).
   */
  function init(el, actions) {
    api = typeof desk === 'object' && desk && desk.browser ? desk.browser : null;
    root = el;
    act = actions;
    if (!api) { root.hidden = true; return false; }
    build();
    userW = Number(kept.get('web-w', '0')) || 0;
    width = clampWidth(userW || usual());
    document.body.style.setProperty('--web-full', `${width}px`);
    try { for (const key of JSON.parse(kept.get('web-open', '[]'))) if (typeof key === 'string') opened.add(key); } catch { /* none kept */ }
    root.hidden = false;
    api.onView((v) => take(v));
    api.onDo((arg) => order(arg));
    // loaded again under running pages ("Load new version"): each chat's browser comes back as it was
    api.ask('view').then((v) => { take(v); settle(false); }, () => {});
    watchFloats();
    new ResizeObserver(() => queuePlace()).observe(els.page);
    window.addEventListener('resize', () => { if (open) queuePlace(); });
    return true;
  }

  // ---- the panel's parts ----

  function button(name, label, run, extra = '') {
    return h('button', { class: `icon-btn${extra ? ` ${extra}` : ''}`, 'aria-label': label, tip: label, 'data-tip-up': '', onclick: run }, icon(name, 15));
  }

  function build() {
    els = {};
    els.whose = h('div', { class: 'web-whose' }, icon('globe', 13), h('span', { class: 'web-whose-name' }));
    els.tabs = h('div', { class: 'web-tabs', role: 'tablist', 'aria-label': 'Pages' });
    els.tabs.addEventListener('wheel', (e) => { if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) { els.tabs.scrollLeft += e.deltaY; e.preventDefault(); } }, { passive: false });
    els.add = button('plus', 'A page of your own (Ctrl T in a page)', () => newPage(), 'web-add');
    els.shut = button('x', 'Close this browser (Ctrl Shift B). Its pages stay open: the chat keeps working in them.', () => shut(), 'web-shut');
    els.back = button('arrow-left', 'Back (Alt ←)', () => go('back'));
    els.fwd = button('arrow-right', 'Forward (Alt →)', () => go('forward'));
    els.reload = button('refresh', 'Reload (F5)', () => go(els.reload.classList.contains('stop') ? 'stop' : 'reload'));
    els.site = h('span', { class: 'web-site', 'aria-hidden': 'true' });
    els.url = h('input', { class: 'web-url', type: 'text', spellcheck: 'false', autocomplete: 'off', placeholder: 'Type an address', 'aria-label': 'Address' });
    els.where = h('label', { class: 'web-where' }, els.site, els.url);
    els.hold = h('button', { class: 'web-hold', 'data-tip-up': '', onclick: () => hold() });
    els.out = button('external', 'Open in your own browser', () => { if (front) api.ask('external', front); });
    els.bar = h('div', { class: 'web-bar' }, els.back, els.fwd, els.reload, els.where, els.hold, els.out);
    els.now = h('div', { class: 'web-now', role: 'status' });
    els.still = h('img', { class: 'web-still', alt: '', hidden: true });
    els.emptyTitle = h('h2');
    els.emptyWords = h('p');
    els.empty = h('div', { class: 'web-empty' },
      h('div', { class: 'web-empty-mark' }, icon('globe', 26)),
      els.emptyTitle, els.emptyWords,
      h('p', { class: 'web-empty-keys' }, h('kbd', { text: 'Ctrl Shift B' }), h('span', { text: 'opens and closes the browser of the chat in front' })));
    els.page = h('div', { class: 'web-page' }, els.still, els.empty);
    els.card = h('div', { class: 'web-card' },
      h('div', { class: 'web-top' }, els.whose, els.tabs, els.add, els.shut),
      els.bar, els.now, els.page);
    fill(root, els.card);
    // the grip stands in the gap between the chats and the panel, outside the panel, which hides what overflows it
    els.grip = h('div', { class: 'grip web-grip', role: 'separator', 'aria-orientation': 'vertical', 'aria-label': 'Width of the browser',
      tip: 'Drag to resize. Double-click: back to the usual width.' });
    document.body.append(els.grip);

    els.url.addEventListener('focus', () => {
      const t = tabOf(front);
      els.url.value = t && t.url !== 'about:blank' ? t.url : '';
      els.url.select();
    });
    els.url.addEventListener('blur', () => draw());
    els.url.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') { e.preventDefault(); submit(els.url.value); }
      else if (e.key === 'Escape') { e.preventDefault(); els.url.blur(); act.done(); }
    });
    drag();
  }

  // ---- what main says ----

  function take(v) {
    if (!v || !Array.isArray(v.tabs)) return;
    view = v;
    for (const id of [...needs.keys()]) if (!tabOf(id)) needs.delete(id);
    followChats();
    if (wanted && tabOf(wanted.show)) {
      const w = wanted;
      wanted = null;
      // the person's own new page, in the browser shown; anything else in its own chat's
      if (w.here && inScope(tabOf(w.show))) front = w.show;
      else call(w);
    }
    if (wanted && Date.now() > wanted.until) wanted = null;
    if (!inScope(tabOf(front))) front = '';
    if (!front) pickFront();
    draw();
    act.changed();
    if (open) queuePlace();
  }

  /**
   * A chat at work on a page: that page comes to the front of its browser, so the page the person sees there is the one
   * the chat works on (now if that browser is shown, else once it is). Not while the person types an address, nor over
   * a page the person has taken over.
   */
  function followChats() {
    const last = new Map();          // a browser -> the page a chat worked on last in it, since main last said
    for (const t of view.tabs) {
      const was = acted.get(t.id) || 0;
      acted.set(t.id, t.acts || 0);
      if (!told || (t.acts || 0) <= was) continue;
      const b = last.get(t.home);
      if (!b || (t.used || 0) > (b.used || 0)) last.set(t.home, t);
    }
    for (const id of [...acted.keys()]) if (!tabOf(id)) acted.delete(id);
    told = true;
    for (const [home, t] of last) {
      const here = scope.key === '' || home === scope.key;
      const was = tabOf(here ? front : fronts.get(home));
      if (was && was.id !== t.id && was.paused) continue;
      fronts.set(home, t.id);
      if (here && !(els && document.activeElement === els.url)) front = t.id;
    }
  }

  function order(arg) {
    if (!arg || typeof arg !== 'object') return;
    if (arg.key === 'toggle') toggle();
    else if (arg.key === 'palette') act.palette();
    else if (arg.key === 'address') { toggle(true).then(() => focusAddress()); }
    else if (arg.key === 'new') newPage();
    else if (typeof arg.focus === 'string') act.inside();
    else if (arg.hold === true) {
      // the app's window is being dragged or resized: the page shows as its picture until it stops
      if (arg.still && arg.tab === front) { els.still.src = arg.still; els.still.hidden = false; stillOf = front; }
    }
    else if (typeof arg.show === 'string') call(arg);
  }

  /**
   * A page main wants seen: a chat calling for the person on it (with its words), or a page opened for the person to
   * see (quiet: a page the person's own page opened, or a chat's new page while Settings says to show those). It
   * opens in its own chat's browser. When that chat is not the one in front, the screen is left as it is: its
   * browser is open when the person goes there, and a call says so on a card, with Go there to that chat.
   */
  function call(arg) {
    const t = tabOf(arg.show);
    if (!t) { wanted = { ...arg, until: Date.now() + 3000 }; return; }
    // allow: a chat stopped at a site of the ask-first list, { sid, entry }: the person's yes lets that chat in
    const allow = arg.allow && typeof arg.allow.sid === 'string' && typeof arg.allow.entry === 'string' ? { sid: arg.allow.sid, entry: arg.allow.entry } : null;
    if (!arg.quiet) needs.set(t.id, { message: String(arg.message || '').slice(0, 200), from: String(arg.from || ''), allow });
    fronts.set(t.home, t.id);
    opened.add(t.home);
    // with no chat in front every page shows: there it shows at once
    const first = (act.scopes()[0] || { key: '' }).key;
    if (first === '') { fronts.set('', t.id); opened.add(''); }
    keep();
    if (first === t.home || first === '') settle(true);
    else if (!arg.quiet) {
      const words = String(arg.message || '').trim().slice(0, 200);
      toast(`${arg.from || 'A chat'} needs you on one of its pages. Its browser opens when you go to that chat.`, 9000,
        { kind: 'page', title: arg.from || 'A chat', what: 'needs you on one of its pages', body: words || 'Its browser opens when you go to that chat.',
          target: t.home.startsWith('s:') ? `row:${t.home.slice(2)}` : t.home });
    }
    act.changed();
  }

  /** The page in front when none is picked: the one used last in this browser. */
  function pickFront() {
    const pick = scoped().sort((a, b) => b.used - a.used)[0];
    front = pick ? pick.id : '';
  }

  function keep() {
    kept.set('web-open', JSON.stringify([...opened].slice(-KEPT_OPEN)));
  }

  // ---- whose browser shows ----

  /**
   * The browser the panel shows: of the scopes desk offers (the chat in front, then the other chats on screen), the
   * first whose browser is open, so the panel does not jump while the keyboard moves between chats side by side;
   * else the first, its browser closed. slideIt: the change was asked for, and is seen moving.
   */
  function settle(slideIt) {
    if (!api || !els) return Promise.resolve();
    const list = act.scopes();
    if (!list.length) return Promise.resolve();
    const pick = list.find((s) => opened.has(s.key)) || list[0];
    const changed = pick.key !== scope.key || pick.name !== scope.name;
    if (pick.key !== scope.key) {
      if (front) fronts.set(scope.key, front);
      front = fronts.get(pick.key) || '';
      if (!inScope(tabOf(front), pick.key)) front = '';
    }
    scope = pick;
    if (!front) pickFront();
    const want = opened.has(scope.key);
    if (want !== open) return slideIt ? slide(want) : jump(want);
    if (changed || slideIt) { draw(); queuePlace(); }
    return Promise.resolve();
  }

  /**
   * The window's view changed (each time the window is drawn): the panel turns to the browser of the chat now in
   * front, and main hears where its page area is, if that moved: a page a chat opens is laid out at that size, and a
   * window that draws no frames (hidden) never says it was resized.
   */
  function follow() { settle(false); queuePlace(); }

  /** Opens or closes the browser of the chat in front (Ctrl Shift B, the search box, a page's own keys). */
  function toggle(want) {
    const list = act.scopes();
    const key = list.length ? list[0].key : '';
    return toggleFor(key, want);
  }

  /** Opens or closes one chat's browser: its globe. want: open (true), closed (false), the other way (undefined). */
  function toggleFor(key, want) {
    if (!api) return Promise.resolve();
    const shown = open && scope.key === key;
    const on = want === undefined ? !shown : Boolean(want);
    if (on) opened.add(key);
    else { opened.delete(key); for (const t of scoped(key)) needs.delete(t.id); }
    keep();
    act.changed();
    return settle(true);
  }

  /** The cross on the panel: the browser it shows closes. */
  function shut() { return toggleFor(scope.key, false); }

  // ---- opening and closing ----

  function clampWidth(w) {
    const most = Math.max(MIN_W, window.innerWidth - Sizes.sideWidth() - Sizes.stageNeed());
    return Math.round(Math.min(Math.max(w || 0, MIN_W), most));
  }

  function setWidth(w, now = false) {
    width = w;
    const body = document.body;
    if (now) body.classList.add('web-drag');
    body.style.setProperty('--web-full', `${w}px`);
    if (open) body.style.setProperty('--web-w', `${w}px`);
    if (now) { void body.offsetWidth; body.classList.remove('web-drag'); }
  }

  /** Whoever waits for the last slide to end is let go: a newer one, or a jump, took its place. */
  function moved() {
    if (!moveDone) return;
    const done = moveDone;
    moveDone = null;
    done();
  }

  /** The panel opens or closes at once, as going to another chat changes it. */
  function jump(want) {
    open = want;
    moves++;
    moving = false;
    clearTimeout(moveTimer);
    moved();
    const body = document.body;
    body.classList.add('web-drag');
    if (open) {
      width = clampWidth(userW || usual());
      body.style.setProperty('--web-full', `${width}px`);
      body.classList.add('web-open');
      body.style.setProperty('--web-w', `${width}px`);
    } else {
      body.classList.remove('web-open');
      body.style.setProperty('--web-w', '0px');
    }
    void body.offsetWidth;
    body.classList.remove('web-drag');
    els.still.hidden = true;
    stillOf = '';
    draw();
    placeNow(true);
    act.changed();
    return Promise.resolve();
  }

  /** The panel slides in or out, as asked for by the person or a chat. */
  async function slide(want) {
    if (want === open) { draw(); queuePlace(); return; }
    open = want;
    const seq = ++moves;
    moving = true;
    if (open) {
      if (act.opening) act.opening();
      width = clampWidth(userW || usual());
      document.body.style.setProperty('--web-full', `${width}px`);
      if (!front) pickFront();
      draw();
      // the page as it is now, shown while the panel slides in
      await picture();
      if (seq !== moves) return;
      document.body.classList.add('web-open');
      document.body.style.setProperty('--web-w', `${width}px`);
    } else {
      // the page steps aside for its picture first: what slides away is what was there
      await picture();
      if (seq !== moves) return;
      placeNow(true);
      document.body.classList.remove('web-open');
      document.body.style.setProperty('--web-w', '0px');
    }
    act.changed();
    clearTimeout(moveTimer);
    moved();
    const still = document.documentElement.classList.contains('still');
    await new Promise((done) => {
      moveDone = done;
      moveTimer = setTimeout(() => {
        moved();
        if (seq !== moves) return;
        moving = false;
        placeNow(true);
        if (!open) act.done();
      }, still ? 0 : MOVE_MS + 40);
    });
  }

  /** A picture of the page in front, put where the page goes while the real one is away. */
  async function picture() {
    const id = front;
    if (!id || !tabOf(id)) { els.still.hidden = true; stillOf = ''; return; }
    let pic = '';
    try { pic = await api.ask('still', id); } catch { pic = ''; }
    if (pic && id === front) { els.still.src = pic; els.still.hidden = false; stillOf = id; }
    else if (stillOf !== front) { els.still.hidden = true; stillOf = ''; }
  }

  // ---- where the page goes ----

  function queuePlace() {
    if (frame) return;
    frame = requestAnimationFrame(() => placeNow());
    // a window that draws no frames (hidden, or under a program in full screen) still tells main where the page goes
    frameTimer = setTimeout(() => placeNow(), 120);
  }

  /** Tells main where the page area is, whether the page shows there, and which page. force: even when nothing changed. */
  function placeNow(force = false) {
    if (frame) { cancelAnimationFrame(frame); frame = 0; }
    clearTimeout(frameTimer);
    if (!api || !els) return;
    const r = els.page.getBoundingClientRect();
    const t = tabOf(front);
    const show = open && !moving && !covered && !dragging && Boolean(t) && r.width > 40 && r.height > 40;
    const p = { x: r.left, y: r.top, width: r.width, height: r.height, show, tab: t ? t.id : '' };
    const key = JSON.stringify(p);
    if (!force && key === placedKey) return;
    placedKey = key;
    shows = show;
    api.place(p);
  }

  /** Anything that floats over the window (a dialog, the search box, a menu): the page steps aside for its picture meanwhile. */
  function watchFloats() {
    const list = FLOATS.map((id) => document.getElementById(id)).filter(Boolean);
    const up = () => list.some((e) => !e.hidden);
    const watch = new MutationObserver(async () => {
      const now = up();
      if (now === covered) return;
      if (now && open && tabOf(front)) {
        await picture();
        covered = up();
      } else {
        covered = now;
      }
      placeNow();
    });
    for (const e of list) watch.observe(e, { attributes: true, attributeFilter: ['hidden'] });
  }

  /**
   * The page steps aside for its picture while another edge of the window is dragged: the pointer may pass over
   * where it lies, and a page is a window of its own that would take it.
   */
  async function aside(on) {
    if (!api) return;
    const seq = ++asides;
    if (on && open && tabOf(front)) await picture();
    // let go before its picture came: it stays where it is
    if (seq !== asides) return;
    dragging = on;
    placeNow();
  }

  /** The grip on the panel's left edge: dragged, the panel widens; double-clicked, it goes back to the usual width. */
  function drag() {
    let startX = 0;
    let startW = 0;
    els.grip.addEventListener('pointerdown', async (e) => {
      if (e.button !== 0 || !open) return;
      e.preventDefault();
      try { els.grip.setPointerCapture(e.pointerId); } catch { /* a pointer already let go: not held */ }
      startX = e.clientX;
      startW = width;
      els.grip.classList.add('on');
      document.body.classList.add('web-drag', 'sizing');
      Terms.freeze(true);
      await aside(true);
    });
    els.grip.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      setWidth(clampWidth(startW + (startX - e.clientX)));
    });
    const end = () => {
      if (!document.body.classList.contains('sizing') || !els.grip.classList.contains('on')) return;
      els.grip.classList.remove('on');
      document.body.classList.remove('web-drag', 'sizing');
      userW = width;
      kept.set('web-w', String(width));
      Terms.freeze(false);
      aside(false);
      // the person's size wins over a chat's: a page a chat laid out at its own size follows the panel again
      const t = tabOf(front);
      if (t && t.emulated) api.ask('fit', t.id, 'panel');
    };
    els.grip.addEventListener('pointerup', end);
    els.grip.addEventListener('pointercancel', end);
    els.grip.addEventListener('lostpointercapture', end);
    els.grip.addEventListener('dblclick', () => {
      userW = 0;
      kept.set('web-w', '0');
      setWidth(clampWidth(usual()), true);
      Terms.fit();
      queuePlace();
    });
  }

  // ---- what the person does ----

  async function submit(text) {
    const words = String(text || '').trim();
    if (!words) return;
    const t = tabOf(front);
    // the person's own address goes into the person's own page: a chat's page keeps its chat's place
    const r = t && !t.owner ? await api.ask('go', t.id, words) : await api.ask('open', words, scope.key);
    if (r && r.error) { toast(r.error, 6000); return; }
    if (r && r.id) showTab(r.id);
    els.url.blur();
    api.ask('focus', r && r.id ? r.id : front);
  }

  /** The page to put in front of the browser shown, once its list has it. */
  function showTab(id) {
    if (tabOf(id)) front = id;
    else wanted = { show: id, quiet: true, here: true, until: Date.now() + 3000 };
    draw();
    queuePlace();
  }

  async function newPage() {
    if (!open) await toggle(true);
    const r = await api.ask('open', '', scope.key);
    if (r && r.id) showTab(r.id);
    focusAddress();
  }

  function focusAddress() {
    els.url.focus();
    els.url.select();
  }

  function go(what) {
    if (front) api.ask(what, front);
  }

  function hold() {
    const t = tabOf(front);
    if (!t || !t.owner) return;
    const next = !t.paused;
    // the button turns at once; main's next word on the pages says the same
    t.paused = next;
    if (next) needs.delete(t.id);
    draw();
    act.changed();
    api.ask('pause', t.id, next);
  }

  function closeTab(id) {
    const t = tabOf(id);
    if (!t) return;
    if (id === front) {
      const list = scoped();
      const i = list.findIndex((x) => x.id === id);
      const next = list[i + 1] || list[i - 1];
      front = next ? next.id : '';
    }
    api.ask('close', id);
  }

  // ---- drawing ----

  function favicon(t) {
    if (t.icon) return h('img', { src: t.icon, alt: '' });
    const name = host(t.url);
    // a site by its name gets its first letter; a number address, this computer, a file or an empty page, the globe
    if (!name || name === 'file' || name === 'localhost' || /^[\d.]+$|^\[|:/.test(name)) return icon('globe', 12);
    return h('b', { text: name[0].toUpperCase() });
  }

  function tabEl(t) {
    let el = tabEls.get(t.id);
    if (!el) {
      el = h('div', { class: 'web-tab', role: 'tab', tabindex: '0', data: { id: t.id } });
      el.addEventListener('click', () => { front = t.id; draw(); placeNow(); });
      el.addEventListener('auxclick', (e) => { if (e.button === 1) closeTab(t.id); });
      el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); el.click(); } });
      el.append(h('span', { class: 'web-fav' }), h('span', { class: 'web-tab-words' }, h('span', { class: 'web-tab-title' }), h('span', { class: 'web-tab-who' })),
        h('span', { class: 'web-live', 'aria-hidden': 'true' }),
        h('button', { class: 'web-x', 'aria-label': 'Close this page', onclick: (e) => { e.stopPropagation(); closeTab(t.id); } }, icon('x', 11)));
      tabEls.set(t.id, el);
    }
    const title = t.title || pretty(t.url) || 'New page';
    // in a chat's own browser its pages need no name under them: the person's do, and every page does where all show
    const who = !t.owner ? (t.guest ? `yours, with ${t.guest.name}` : 'yours') : scope.key === '' || t.home !== scope.key ? t.owner.name : '';
    el.classList.toggle('on', t.id === front);
    el.classList.toggle('busy', Boolean(t.busy));
    el.classList.toggle('mine', !t.owner);
    el.classList.toggle('held', Boolean(t.paused));
    el.classList.toggle('needs', needs.has(t.id));
    el.classList.toggle('rec', Boolean(t.rec));
    el.setAttribute('aria-selected', String(t.id === front));
    el.dataset.tip = [title, host(t.url), t.owner ? `${t.owner.name}'s page${t.paused ? ': you have it now' : ''}` : 'Your page',
      t.rec ? 'Being recorded as a GIF' : ''].filter(Boolean).join('\n');
    const [fav, words] = el.children;
    const iconKey = t.icon || host(t.url);
    if (fav.dataset.key !== iconKey) { fav.dataset.key = iconKey; fill(fav, favicon(t)); }
    if (words.children[0].textContent !== title) words.children[0].textContent = title;
    if (words.children[1].textContent !== who) words.children[1].textContent = who;
    return el;
  }

  function draw() {
    if (!els) return;
    const tabs = scoped().sort((a, b) => a.made - b.made);
    for (const id of [...tabEls.keys()]) if (!tabOf(id)) tabEls.delete(id);
    const kids = tabs.map(tabEl);
    kids.forEach((el, i) => { if (els.tabs.children[i] !== el) els.tabs.insertBefore(el, els.tabs.children[i] || null); });
    while (els.tabs.children.length > kids.length) els.tabs.lastChild.remove();
    // the page in front is scrolled into sight in its strip, and only there (scrollIntoView would move the panel too)
    const on = tabEls.get(front);
    if (on && open) {
      const a = on.offsetLeft;
      const b = a + on.offsetWidth;
      if (a < els.tabs.scrollLeft) els.tabs.scrollLeft = Math.max(0, a - 8);
      else if (b > els.tabs.scrollLeft + els.tabs.clientWidth) els.tabs.scrollLeft = b - els.tabs.clientWidth + 8;
    }
    const name = els.whose.lastChild;
    if (name.textContent !== scope.name) name.textContent = scope.name;
    els.whose.dataset.tip = scope.key === '' ? 'Every page, of every chat: no chat is in front.' : `The browser of ${scope.name}: the pages it opened, and the ones you opened in it.`;

    const t = tabOf(front);
    els.empty.hidden = Boolean(t);
    if (!t) {
      const title = scope.key === '' ? 'No page is open' : `${scope.name} has no page open`;
      // switched off in Settings, the chats are not offered the browser: said here, where the person looks for their pages
      const off = view.door && view.door.on === false ? ' Your chats are not offered this browser yet: Settings > Browser switches that on.' : '';
      const words = (scope.key === ''
        ? 'When a chat opens a page, it shows up in that chat\'s browser: the globe on the chat\'s strip opens it.'
        : 'When this chat opens a page, it shows up here. Watch it work, take a page over, or type an address above to open one of your own. It keeps browsing while this panel is closed.') + off;
      if (els.emptyTitle.textContent !== title) els.emptyTitle.textContent = title;
      if (els.emptyWords.textContent !== words) els.emptyWords.textContent = words;
    }
    if (!t && !wanted) { els.still.hidden = true; stillOf = ''; }
    els.back.disabled = !t || !t.back;
    els.fwd.disabled = !t || !t.forward;
    els.reload.disabled = !t;
    els.out.disabled = !t || !/^https?:/i.test(t.url);
    const loading = Boolean(t && t.loading);
    els.bar.classList.toggle('loading', loading);
    if (els.reload.classList.contains('stop') !== loading) {
      els.reload.classList.toggle('stop', loading);
      fill(els.reload, icon(loading ? 'x' : 'refresh', 15));
      els.reload.dataset.tip = loading ? 'Stop loading' : 'Reload (F5)';
      els.reload.setAttribute('aria-label', loading ? 'Stop loading' : 'Reload');
    }
    if (document.activeElement !== els.url) els.url.value = t ? pretty(t.url) : '';
    const site = t ? host(t.url) : '';
    const siteKey = t ? t.icon || site : '';
    if (els.site.dataset.key !== siteKey) { els.site.dataset.key = siteKey; fill(els.site, t ? favicon(t) : icon('globe', 13)); }

    // taking a page over: only a chat's page has anyone to take it from
    els.hold.hidden = !t || !t.owner;
    if (t && t.owner) {
      const held = Boolean(t.paused);
      els.hold.classList.toggle('on', held);
      fill(els.hold, icon(held ? 'play' : 'pause', 13), h('span', { text: held ? 'Hand back' : 'Take over' }));
      els.hold.dataset.tip = held ? `${t.owner.name} waits while you have this page. Hand it back and it carries on.`
        : `Take this page over: ${t.owner.name}'s clicks and keys stop here until you hand it back.`;
    }
    drawNow(t);
    els.page.classList.toggle('live', Boolean(t && t.busy));
    els.page.classList.toggle('needs', Boolean(t && needs.has(t.id)));
  }

  /** The line under the address: who works in this page and what it is doing, or a chat's call for the person. */
  function drawNow(t) {
    const el = els.now;
    el.classList.remove('needs', 'busy', 'quiet');
    if (!t) { fill(el, h('span', { text: 'No page open' })); el.classList.add('quiet'); return; }
    const need = needs.get(t.id);
    if (need && need.allow) {
      const done = () => { needs.delete(t.id); draw(); act.changed(); };
      el.classList.add('needs');
      fill(el, icon('bell', 13), h('b', { text: need.from || 'A chat' }),
        h('span', { class: 'doing', text: `wants to open ${need.allow.entry}, on your ask-first list` }),
        h('button', { class: 'web-ok web-allow', text: 'Allow for this chat', tip: `Until the app closes, ${need.from || 'this chat'} may open ${need.allow.entry} and read it. Other chats still ask.`,
          onclick: async () => {
            const ok = await api.ask('allow', need.allow.sid, need.allow.entry).catch(() => false);
            done();
            toast(ok ? `${need.from || 'The chat'} may open ${need.allow.entry} now. Tell it in the chat.` : `${need.allow.entry} is no longer on your ask-first list.`, 6000);
          } }),
        h('button', { class: 'web-ok', text: 'No', onclick: done }));
      return;
    }
    if (need) {
      el.classList.add('needs');
      fill(el, icon('bell', 13), h('b', { text: need.from || 'A chat' }),
        h('span', { class: 'doing', text: need.message ? `needs you here: ${need.message}` : 'needs you on this page. Answer it in the chat.' }),
        h('button', { class: 'web-ok', text: 'Got it', onclick: () => { needs.delete(t.id); draw(); act.changed(); } }));
      return;
    }
    const who = whoOf(t);
    if (t.paused) {
      fill(el, icon('pause', 12), h('b', { text: 'You have this page' }), h('span', { text: `· ${t.owner.name} waits until you hand it back` }));
      return;
    }
    if (t.busy) {
      el.classList.add('busy');
      fill(el, h('i', { class: 'web-dot', 'aria-hidden': 'true' }), h('b', { text: who || 'A chat' }), h('span', { class: 'doing', text: t.busy }));
      return;
    }
    // a chat laid the page out at a size of its own: it no longer follows the panel until it goes back
    if (t.emulated) {
      const e = t.emulated;
      fill(el, icon('expand', 13), h('b', { text: `${e.width} × ${e.height}` }),
        h('span', { class: 'doing', text: `· ${who || 'A chat'} set this page to ${e.mobile ? 'a phone\'s' : 'this'} size` }),
        h('button', { class: 'web-ok', text: 'Fit to the panel', tip: 'The page stays at that size, whatever the panel\'s, until the chat or you put it back. Resizing the panel or the window puts it back too; the chat is told.',
          onclick: () => api.ask('fit', t.id) }));
      return;
    }
    if (t.last && Date.now() - t.last.at < SAID_MS) {
      fill(el, h('b', { text: t.last.who || who || 'A chat' }), h('span', { class: 'doing', text: t.last.ok ? t.last.words.replace(/^(\w+)ing\b/, (m, w) => past(w)) : `could not finish ${t.last.words}` }),
        h('span', { class: 'ago', text: ago(t.last.at) }));
      return;
    }
    el.classList.add('quiet');
    if (t.owner) fill(el, h('b', { text: t.owner.name }), h('span', { text: '· its page. It keeps working here while the panel is closed.' }));
    else if (t.guest) fill(el, h('b', { text: 'Your page' }), h('span', { text: `· ${t.guest.name} worked in it` }));
    else fill(el, h('b', { text: 'Your page' }), h('span', { text: '· a chat works in it only when you ask it to' }));
  }

  /** "open" (of "opening") -> "opened", "typ" -> "typed": what a chat did, said in the past. */
  function past(w) {
    const odd = { go: 'went', read: 'read', runn: 'ran' };
    return odd[w] || `${w}ed`;
  }

  /**
   * The 1-second beat. Main hears again what the panel shows: a page is a window of its own, which Windows can bring
   * back by itself (6 Oct: a chat's page left floating over the Nest), and main takes off the screen any page the panel
   * does not show. Not while the panel slides: its page stays until its picture is taken. With no page showing, only
   * that is said: where the page area is stays as last told. Then, while the panel is open: how long ago a chat acted.
   */
  function tick() {
    if (!api || !els) return;
    if (!moving) { if (shows) placeNow(true); else api.place({ show: false }); }
    if (!open) return;
    const t = tabOf(front);
    if (t && !t.busy && t.last && !needs.has(t.id)) drawNow(t);
  }

  /** What one chat's browser holds, for its globe and its row: pages, how many a chat works in, a call for the person. */
  function of(key) {
    const list = scoped(key);
    return { can: Boolean(api), n: list.length, busy: list.filter((t) => t.busy).length, needs: list.some((t) => needs.has(t.id)),
      open: open && scope.key === key, kept: opened.has(key) };
  }

  /** The browsers with a call for the person in them. */
  const calling = () => [...new Set([...needs.keys()].map((id) => (tabOf(id) || {}).home).filter((k) => k !== undefined))];

  return { init, toggle, toggleFor, shut, follow, tick, of, calling, can, isOpen, place: () => placeNow(true), aside, door: () => view.door,
    ask: (what, a, b) => (api ? api.ask(what, a, b) : null),
    // Sizes: how wide it is now, the width it was given (0 while closed), its narrowest, and a width at once
    width: () => (open ? width : 0), wanted: () => (open ? userW || usual() : 0), min: () => MIN_W,
    fit: (w) => { if (!open) return; const next = clampWidth(w); if (next !== width) { setWidth(next, true); queuePlace(); } },
    state: () => ({ open, moving, covered, front, scope: scope.key, opened: [...opened], needs: [...needs.keys()], width, tabs: scoped().map((t) => t.id), all: view.tabs.map((t) => t.id), placed: placedKey ? JSON.parse(placedKey) : null }) };
})();
