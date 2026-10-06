'use strict';
/* global desk, h, fill, icon, toast, kept, Sizes, Terms */
// The Viewer (its files: viewer.cjs): pictures, videos and sounds beside a chat, in the window's fourth column, which
// slides in from the right while the chats make room. One per chat, as the Browser has: what a chat showed stays in
// its Viewer. One file fills it; two stand side by side, or one over the other with a line to wipe between them; more
// make a grid. A video's bar plays, seeks, changes speed, loops and turns the sound on; a picture or a video zooms
// under the wheel and moves when dragged. The arrows go through every file the chat showed, or through the folder of
// the one in front, and the pictures on either side are loaded ahead. The Viewer and the Browser take turns: one
// opening closes the other.

const Viewer = (() => {
  const MIN_W = 360;
  const MOVE_MS = 460;
  const SPEEDS = [0.25, 0.5, 1, 1.5, 2];
  const LOOK_MAX = 1568;             // the long side of a picture handed to a chat
  const PIXELS_AT = 2.5;             // magnified past this many screen pixels to one of the file's: drawn as squares
  let act = null;
  let els = null;
  let view = { homes: {} };
  let told = false;
  const seen = new Map();            // a Viewer -> the last show this page knew of
  const opened = new Set();          // the Viewers wanted open, by the chat (or '') they belong to
  const asked = new Set();           // a file and where it was read, when the window could not play it: a copy was asked for
  let scope = { key: '', name: '' };
  let open = false;
  let big = false;
  let width = 0;
  let userW = Number(kept.get('view-w', '0')) || 0;
  // a video starts silent until the person turns its sound on once; from then on videos start with it
  let soundOn = kept.get('view-sound', '0') === '1';
  // one sound level for every chat's Viewer, kept from one start to the next
  const level = (v) => { const n = Number(v); return Number.isFinite(n) ? Math.round(Math.min(1, Math.max(0, n)) * 100) / 100 : 1; };
  let volume = level(kept.get('view-volume', '1'));
  let heard = volume || 0.5;         // the level the speaker brings back after the slider was taken down to nothing
  let moveTimer = 0;
  let frame = 0;
  const ui = new Map();              // a Viewer -> how it stands: { index, pick, list, mode, look, split, z, x, y, rate, loop, time, paused }
  let staged = '';                   // what the stage holds now: built again only when this changes
  let media = [];                    // what is on the stage: [{ item, el, ready, pane, zoom, canvas }]
  const warmed = new Map();          // a picture's address -> its element, loaded ahead of the arrows
  const listing = new Map();         // a Viewer and a file -> when the folder of that file was asked for

  const usual = () => Math.round(window.innerWidth * 0.42);
  function clampWidth(w) {
    const most = Math.max(MIN_W, window.innerWidth - Sizes.sideWidth() - Sizes.stageNeed());
    return Math.round(Math.min(Math.max(w || 0, MIN_W), most));
  }
  /** The Viewer shown for a chat: its own; with no chat in front, the one that showed something last. */
  function homeKey(key) {
    if (key) return key;
    let best = '';
    let at = -1;
    for (const [k, hs] of Object.entries(view.homes)) if (hs.at > at) { at = hs.at; best = k; }
    return best;
  }
  const homeOf = (hk) => view.homes[hk] || null;
  /** The files a Viewer's last show named, in order: what file numbers count. */
  const shownOf = (hs) => (hs ? hs.shown.map((id) => hs.items.find((it) => it.id === id)).filter(Boolean) : []);
  /** A file of a Viewer: one a chat showed, or one of the folder being flipped through. */
  const itemOf = (hs, id) => hs.items.find((it) => it.id === id) || (hs.folder ? hs.folder.items.find((it) => it.id === id) : null) || null;
  function stateOf(hk) {
    let s = ui.get(hk);
    if (!s) ui.set(hk, s = { index: 0, pick: '', list: '', mode: 'one', look: 'side', split: 50, z: 1, x: 0, y: 0, rate: 1, loop: false, time: 0, paused: true });
    return s;
  }
  /** What a Viewer puts in front: the file picked (from its strip, its grid or by an arrow), else the files its last show named. */
  function current(hk) {
    const hs = homeOf(hk);
    const s = stateOf(hk);
    if (!hs) return { hs, s, items: [], mode: 'one' };
    const pick = s.pick ? itemOf(hs, s.pick) : null;
    const items = pick ? [pick] : shownOf(hs);
    return { hs, s, items, mode: pick || items.length < 2 ? 'one' : s.mode };
  }
  /**
   * What the arrows go through from the file in front: every file this chat showed, the newest last, or the files of
   * the folder of the one in front, by name. Unless the person picked one, the folder when the chat showed one file.
   */
  function flipOf(hs, s, front) {
    const folder = front && hs.folder && hs.folder.dir === front.dir && hs.folder.items.length > 1 && hs.folder.items.some((it) => it.id === front.id) ? hs.folder.items : null;
    const which = s.list || (hs.items.length > 1 || !folder ? 'shown' : 'folder');
    return which === 'folder' && folder ? { which, list: folder } : { which: 'shown', list: hs.items };
  }
  /** One file alone in front: by its number in the last show when it is in it, else picked. */
  function putInFront(hs, s, item) {
    const k = shownOf(hs).findIndex((it) => it.id === item.id);
    Object.assign(s, k >= 0 ? { pick: '', index: k } : { pick: item.id }, { mode: 'one', z: 1, x: 0, y: 0, time: 0 });
  }
  const oneOf = (items, s) => items[Math.min(s.index, items.length - 1)];
  const urlOf = (item, host) => `lowlit-media://${host}/${item.token}`;
  /** Where the page reads a file: its copy once one is needed (nothing until it is ready), else the file itself. */
  const srcOf = (item) => (item.copy ? (item.copy.state === 'ready' ? urlOf(item, 'c') : '') : item.native ? urlOf(item, 'o') : '');
  const lead = () => media.find((m) => m.el.tagName !== 'IMG') || null;
  const timeWords = (s) => {
    if (!Number.isFinite(s) || s < 0) return '0:00.0';
    const m = Math.floor(s / 60);
    const r = s - m * 60;
    return `${m}:${r < 10 ? '0' : ''}${r.toFixed(1)}`;
  };
  const sizeWords = (n) => (n >= 1024 ** 3 ? `${(n / 1024 ** 3).toFixed(1)} GB` : n >= 1024 ** 2 ? `${(n / 1024 ** 2).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
  const later = (ms) => new Promise((done) => setTimeout(() => done(null), ms));

  /**
   * actions: changed() what the Viewer shows or whether it is open changed; scopes() whose Viewer may show, the first
   * preferred: [{ key, name }]; opening() it is about to slide in (the Browser steps aside); otherOpen() the Browser
   * holds the right of the window; done() the panel let go of the keyboard.
   */
  function init(root, a) {
    act = a;
    els = {
      root,
      whose: h('span', { class: 'vw-whose-name' }),
      title: h('div', { class: 'vw-title' }),
      modes: h('div', { class: 'vw-modes', role: 'group', 'aria-label': 'How the files stand' }),
      stage: h('div', { class: 'vw-stage', tabindex: '-1' }),
      busy: h('div', { class: 'vw-busy', hidden: true }),
      empty: h('div', { class: 'vw-empty', hidden: true }),
      bar: h('div', { class: 'vw-bar', hidden: true }),
      info: h('div', { class: 'vw-info' }),
      note: h('div', { class: 'vw-note', hidden: true }),
      strip: h('div', { class: 'vw-strip', hidden: true }),
    };
    els.bigBtn = h('button', { class: 'icon-btn', 'aria-label': 'Fill the window', 'aria-pressed': 'false', tip: 'Fill the window with it (F)\nEscape: back beside the chat.',
      onclick: () => setBig(!big) }, icon('expand', 15));
    els.card = h('div', { class: 'vw-card', tabindex: '-1' },
      h('div', { class: 'vw-top' },
        h('div', { class: 'vw-whose' }, icon('image', 14), els.whose),
        els.title, els.modes, els.bigBtn,
        h('button', { class: 'icon-btn', 'aria-label': 'Close the Viewer', tip: 'Close (Escape)', onclick: () => toggleFor(scope.key, false) }, icon('x', 15))),
      els.stage, els.bar, els.info, els.note, els.strip);
    fill(els.empty, h('div', { class: 'vw-empty-mark' }, icon('image', 24)), h('b', { text: 'Nothing to show here yet' }),
      h('span', { text: 'When this chat makes a picture, a video or a sound, it can show it to you here. You can also drop files here.' }),
      h('button', { class: 'vw-open-btn', onclick: () => openDialog() }, 'Open files…'));
    els.prev = h('button', { class: 'vw-hint prev', hidden: true, 'aria-label': 'The one before', tip: 'The one before (←)', onclick: () => step(-1) }, icon('arrow-left', 16));
    els.next = h('button', { class: 'vw-hint next', hidden: true, 'aria-label': 'The next one', tip: 'The next one (→)', onclick: () => step(1) }, icon('arrow-right', 16));
    els.count = h('div', { class: 'vw-count', hidden: true });
    els.stage.append(els.busy, els.empty, els.prev, els.next, els.count);
    fill(root, els.card);
    root.hidden = false;
    els.grip = h('div', { class: 'grip vw-grip', role: 'separator', 'aria-orientation': 'vertical', 'aria-label': 'Width of the Viewer',
      tip: 'Drag to resize. Double-click: back to the usual width.' });
    document.body.append(els.grip);
    grip();
    els.card.addEventListener('keydown', key);
    els.stage.addEventListener('wheel', wheel, { passive: false });
    els.stage.addEventListener('pointerdown', pan);
    els.stage.addEventListener('dblclick', (e) => {
      if (e.target.closest('button, .vw-wipe-handle, .vw-grid')) return;
      zoomTo(stateOf(homeKey(scope.key)).z === 1 ? 'actual' : 'fit');
    });
    // files dropped on the Viewer open in it, as the person's own
    root.addEventListener('dragover', (e) => { e.preventDefault(); e.stopPropagation(); root.classList.add('drop'); });
    root.addEventListener('dragleave', (e) => { if (!root.contains(e.relatedTarget)) root.classList.remove('drop'); });
    root.addEventListener('drop', (e) => {
      e.preventDefault();
      e.stopPropagation();
      root.classList.remove('drop');
      const paths = [...(e.dataTransfer ? e.dataTransfer.files : [])].map((f) => desk.pathOf(f)).filter(Boolean);
      if (paths.length) openPaths(paths);
    });
    let timer = 0;
    window.addEventListener('resize', () => { clearTimeout(timer); timer = setTimeout(() => { if (open) setWidth(clampWidth(userW || usual())); }, 60); });
    desk.viewer.onView(take);
    desk.viewer.onAsk(answer);
    desk.viewer.ask('view').then((v) => { if (!told) take(v); }, () => {});
  }

  // ---- what main says ----

  function take(v) {
    if (!v || typeof v.homes !== 'object') return;
    view = v;
    let opening = null;
    // a show opens in its own chat's page only, while that chat is the one in front: a chat beside it on screen, or
    // away, waits for the person to go to it
    const front = (act.scopes()[0] || { key: '' }).key;
    for (const [hk, hs] of Object.entries(view.homes)) {
      const was = seen.get(hk) || 0;
      seen.set(hk, hs.seq);
      // what was shown before this page was loaded stays where it was: no Viewer pops open
      if (!told || hs.seq <= was) continue;
      fresh(hk, hs);
      opened.add(hk);
      if (hk === front) opening = hk;
      else if (hs.by !== 'you') {
        toast(`${hs.by || 'A chat'} has something to show you: its Viewer opens when you go to it.`, 9000,
          { kind: 'show', title: hs.by || 'A chat', what: 'has something to show you', body: 'Its Viewer opens when you go to it.', target: hk.startsWith('s:') ? `row:${hk.slice(2)}` : hk });
      }
    }
    told = true;
    if (opening !== null) toggleFor(opening, true);
    else draw();
    act.changed();
  }

  /** A new show starts from its first file, as its chat asked for it. */
  function fresh(hk, hs) {
    const s = stateOf(hk);
    const first = shownOf(hs)[0];
    const d = first && first.info ? first.info.duration || 0 : 0;
    Object.assign(s, { index: 0, pick: '', list: '', mode: hs.mode, z: 1, x: 0, y: 0, time: hs.start || 0, rate: 1,
      loop: hs.loop === null ? Boolean(first && first.kind === 'video' && d > 0 && d <= 30) : hs.loop,
      paused: hs.play === null ? !(first && first.kind === 'video') : !hs.play });
  }

  /** A question from main, for a chat: answered once it can be. */
  async function answer(q) {
    if (!q || typeof q !== 'object') return;
    let r;
    try {
      const a = q.args && typeof q.args === 'object' ? q.args : {};
      if (q.what === 'shown') r = await shown(a);
      else if (q.what === 'control') r = await control(a);
      else if (q.what === 'look') r = await look(a);
      else r = { error: `The Viewer cannot ${q.what}.` };
    } catch (err) {
      r = { error: String((err && err.message) || err) };
    }
    desk.viewer.reply(q.id, r);
  }

  // ---- whose Viewer shows ----

  /**
   * The Viewer the panel shows: the one of the chat in front, while it is wanted there. A chat beside it on screen
   * keeps its own for when the person goes to it. It stays shut while the Browser holds the right of the window.
   */
  function follow() {
    if (!els) return;
    const list = act.scopes();
    if (!list.length) return;
    const pick = list[0];
    const moved = pick.key !== scope.key || pick.name !== scope.name;
    scope = pick;
    // opened by the person with nothing in it yet, it stays open: files can be dropped on it
    const want = opened.has(scope.key) && !act.otherOpen();
    if (want !== open) setOpen(want, false);
    else if (moved) draw();
  }

  function toggle(want) {
    const list = act.scopes();
    return toggleFor(list.length ? list[0].key : '', want, true);
  }

  /**
   * Opens or closes the Viewer of a chat: its button, the palette, a show. The panel shows only the chat in front's:
   * another chat's is kept wanted or not for when the person goes to it. focusIt: the keyboard goes to it.
   */
  function toggleFor(key, want, focusIt) {
    if (!els) return;
    const shownNow = open && scope.key === key;
    const on = want === undefined ? !shownNow : Boolean(want);
    if (on) opened.add(key); else opened.delete(key);
    scope = act.scopes()[0] || { key: '', name: '' };
    const wantNow = opened.has(scope.key);
    if (wantNow !== open) setOpen(wantNow, true);
    else draw();
    if (on && focusIt && open) els.card.focus({ preventScroll: true });
    act.changed();
  }

  /** The Browser opened: the Viewer steps aside, and is no longer wanted for that chat. */
  function shut() { if (open) toggleFor(scope.key, false); }

  function setOpen(want, slide) {
    // the Browser steps aside first, so that nothing, meanwhile, finds both open
    if (want && slide) act.opening();
    open = want;
    const body = document.body;
    clearTimeout(moveTimer);
    if (!slide) body.classList.add('vw-drag');
    if (open) {
      width = clampWidth(userW || usual());
      body.style.setProperty('--view-full', `${width}px`);
      body.classList.add('vw-open');
      body.style.setProperty('--view-w', `${width}px`);
      draw();
    } else {
      setBig(false);
      body.classList.remove('vw-open');
      body.style.setProperty('--view-w', '0px');
      for (const m of media) if (m.el.pause) m.el.pause();
      // the stage empties once the panel has slid away: its files let go of what they hold
      moveTimer = setTimeout(() => { if (!open) { unstage(); cool(); } }, slide ? MOVE_MS + 40 : 0);
      if (els.card.contains(document.activeElement)) act.done();
    }
    if (!slide) { void body.offsetWidth; body.classList.remove('vw-drag'); }
    act.changed();
  }

  function setBig(want) {
    big = Boolean(want) && open;
    document.body.classList.toggle('vw-big', big);
    els.bigBtn.setAttribute('aria-pressed', String(big));
    els.bigBtn.classList.toggle('on', big);
    if (big) els.card.focus({ preventScroll: true });
  }

  function setWidth(w) {
    width = w;
    const body = document.body;
    body.classList.add('vw-drag');
    body.style.setProperty('--view-full', `${w}px`);
    if (open) body.style.setProperty('--view-w', `${w}px`);
    void body.offsetWidth;
    if (!body.classList.contains('sizing')) body.classList.remove('vw-drag');
  }

  // ---- drawing ----

  function draw() {
    if (!els) return;
    const hk = homeKey(scope.key);
    const { hs, s, items, mode } = current(hk);
    els.whose.textContent = scope.key ? scope.name : 'Every chat';
    // a file picked or gone to by an arrow is named, rather than with the words of the show it is not in
    els.title.textContent = !hs ? '' : s.pick && items.length === 1 ? items[0].name : hs.title || (items.length === 1 ? items[0].name : `${items.length} files`);
    drawModes(hs, mode, s);
    const empty = !hs || !items.length;
    els.empty.hidden = !empty;
    if (empty) {
      unstage();
      cool();
      drawFlip(null);
      els.bar.hidden = true;
      fill(els.info);
      els.note.hidden = true;
      els.strip.hidden = true;
      return;
    }
    const front = mode === 'one' ? oneOf(items, s) : null;
    if (open) stage(hk, hs, items, mode, s);
    drawFlip(hs, s, front);
    if (open) {
      warm(hs, s, front);
      if (front) wantFolder(hk, hs, front);
    }
    drawInfo(items, mode, s);
    // the chat's words with what it showed: a line of text under the file's name
    els.note.hidden = !hs.note;
    els.note.textContent = hs.note || '';
    drawStrip(hk, hs, items, s, front);
    drawBar();
  }

  function drawModes(hs, mode, s) {
    const kids = [];
    if (hs && hs.shown.length > 1) {
      const pick = (m) => () => { s.mode = m; s.pick = ''; draw(); };
      for (const [m, name, words] of [['one', 'tile-1', 'One at a time'], ['compare', 'tile-2', 'Side by side (C)'], ['grid', 'tile-4', 'All of them (G)']]) {
        const on = mode === m && !s.pick;
        kids.push(h('button', { class: `icon-btn${on ? ' on' : ''}`, 'aria-pressed': String(on), 'aria-label': words, tip: words, onclick: pick(m) }, icon(name, 15)));
      }
      if (mode === 'compare') {
        kids.push(h('button', { class: `vw-wipe-btn${s.look === 'wipe' ? ' on' : ''}`, 'aria-pressed': String(s.look === 'wipe'), text: 'Wipe',
          tip: 'One over the other, with a line to drag between them (W)', onclick: () => { s.look = s.look === 'wipe' ? 'side' : 'wipe'; draw(); } }));
      }
    }
    fill(els.modes, kids);
  }

  /** The files on the stage: built again only when what it should hold changed. */
  function stage(hk, hs, items, mode, s) {
    const front = mode === 'one' ? [oneOf(items, s)] : mode === 'compare' ? items.slice(0, 2) : items;
    const want = JSON.stringify([hk, hs.seq, mode, mode === 'compare' ? s.look : '', front.map((it) => [it.id, srcOf(it), Boolean(it.copy && it.copy.state === 'failed')])]);
    if (want === staged) { progress(front); place(s); busyLine(front); return; }
    unstage();
    staged = want;
    els.stage.dataset.mode = mode === 'compare' ? `compare-${s.look}` : mode;
    if (mode === 'grid') { grid(items, s); busyLine([]); return; }
    const panes = front.map((item, n) => {
      const pane = h('div', { class: 'vw-pane', data: { id: item.id } });
      const zoom = h('div', { class: 'vw-zoom' });
      pane.append(zoom);
      if (front.length > 1) pane.append(h('span', { class: 'vw-label', text: item.name }));
      const m = mount(item, pane, zoom, s, n === 0);
      if (m) media.push(m);
      return pane;
    });
    if (mode === 'compare' && s.look === 'wipe' && panes.length === 2) {
      const handle = h('div', { class: 'vw-wipe-handle', role: 'separator', 'aria-label': 'Wipe between the two' });
      panes[1].classList.add('vw-top-pane');
      els.stage.append(...panes, handle);
      wipe(handle, s, panes[1]);
    } else {
      els.stage.append(...panes);
    }
    place(s);
    busyLine(front);
    // a sound's levels at rest, until it plays
    if (media.some((m) => m.canvas)) levels();
  }

  /** A picture's element reading src, which notes for itself whether it could be read. */
  function picture(src) {
    const img = h('img', { alt: '', draggable: 'false', crossorigin: 'anonymous', decoding: 'async' });
    img.addEventListener('load', () => { img.dataset.state = 'ok'; }, { once: true });
    img.addEventListener('error', () => { img.dataset.state = 'bad'; }, { once: true });
    img.src = src;
    return img;
  }

  /** One file as an element on the stage (a picture loaded ahead is taken as it is), or the line that says why it cannot be shown yet. */
  function mount(item, pane, zoom, s, first) {
    const src = srcOf(item);
    if (!src) { pane.append(waitBlock(item)); if (!item.copy) make(item); return null; }
    pane.classList.add('loading');
    const loaded = () => pane.classList.remove('loading');
    let el;
    let ready;
    let canvas = null;
    if (item.kind === 'image') {
      el = warmed.get(src) || picture(src);
      warmed.delete(src);
      el.className = `vw-media${item.ext === 'svg' ? ' vw-svg' : ''}`;
      el.alt = item.name;
      ready = new Promise((done) => {
        let settled = false;
        const now = () => {
          if (settled) return;
          settled = true;
          loaded();
          if (el.dataset.state === 'ok') { done({ w: el.naturalWidth, h: el.naturalHeight }); drawInfoNow(); return; }
          done({ error: 'it could not be read as a picture' });
          failed(item, src, 'picture');
        };
        if (el.dataset.state) now();
        else { el.addEventListener('load', now, { once: true }); el.addEventListener('error', now, { once: true }); }
      });
      zoom.append(el);
    } else {
      const audio = item.kind === 'audio';
      el = h(audio ? 'audio' : 'video', { class: 'vw-media', crossorigin: 'anonymous', preload: 'auto', playsinline: true });
      // two side by side: only the first is heard
      el.muted = !first || (!audio && !soundOn);
      el.loop = s.loop;
      el.volume = volume;
      ready = new Promise((done) => {
        el.addEventListener('loadedmetadata', () => {
          el.playbackRate = s.rate;
          if (s.time > 0 && s.time < el.duration) el.currentTime = s.time;
          if (!s.paused) el.play().catch(() => { if (first) { s.paused = true; drawBar(); } });
          done({ w: el.videoWidth || 0, h: el.videoHeight || 0, duration: el.duration });
          drawInfoNow();
          drawBar();
        }, { once: true });
        el.addEventListener('loadeddata', loaded, { once: true });
        el.addEventListener('error', () => { loaded(); done({ error: 'it could not be played' }); failed(item, src, audio ? 'sound' : 'video'); }, { once: true });
      });
      el.addEventListener('waiting', () => pane.classList.add('loading'));
      el.addEventListener('playing', loaded);
      if (first) wire(el, s);
      el.src = src;
      if (audio) {
        canvas = h('canvas', { width: Math.round(420 * devicePixelRatio), height: Math.round(96 * devicePixelRatio) });
        pane.append(h('div', { class: 'vw-sound' }, icon('volume', 26), h('b', { text: item.name }), canvas), el);
      } else {
        zoom.append(el);
      }
    }
    return { item, el, ready, pane, zoom, canvas };
  }

  function waitBlock(item) {
    const c = item.copy;
    const failedNow = Boolean(c && c.state === 'failed');
    return h('div', { class: `vw-wait${failedNow ? ' failed' : ''}` }, h('b', { text: item.name }),
      h('span', { class: 'vw-wait-words', text: waitWords(item) }),
      !failedNow && h('div', { class: 'vw-wait-bar' }, h('i', { style: `--k: ${c ? c.progress || 0 : 0}` })));
  }
  function waitWords(item) {
    const c = item.copy;
    if (!c) return 'Waiting to be made playable here.';
    if (c.state === 'failed') return c.said || 'It could not be made playable here.';
    return c.progress > 0 ? `Making a copy this window can play: ${Math.round(c.progress * 100)}%` : 'Making a copy this window can play…';
  }
  /** How far the copies being made have come, without building the stage again. */
  function progress(front) {
    for (const it of front) {
      const w = els.stage.querySelector(`.vw-pane[data-id="${it.id}"] .vw-wait`);
      if (!w) continue;
      const words = w.querySelector('.vw-wait-words');
      if (words) words.textContent = waitWords(it);
      const bar = w.querySelector('.vw-wait-bar i');
      if (bar && it.copy) bar.style.setProperty('--k', String(it.copy.progress || 0));
    }
  }

  /** The first video or sound on the stage drives the bar; one beside it keeps its time. */
  function wire(el, s) {
    el.addEventListener('timeupdate', () => { s.time = el.currentTime; drawTime(); follower(el); });
    el.addEventListener('play', () => {
      s.paused = false;
      drawBar();
      run();
      for (const m of media) if (m.el !== el && m.el.play && m.el.paused) m.el.play().catch(() => {});
    });
    el.addEventListener('pause', () => {
      if (!el.ended || !el.loop) s.paused = true;
      drawBar();
      for (const m of media) if (m.el !== el && m.el.pause) m.el.pause();
    });
    el.addEventListener('ended', drawBar);
    el.addEventListener('ratechange', () => { for (const m of media) if (m.el !== el && m.el.tagName !== 'IMG') m.el.playbackRate = el.playbackRate; });
    el.addEventListener('volumechange', drawBar);
    el.addEventListener('progress', drawTime);
    el.addEventListener('seeked', () => follower(el));
  }
  function follower(first) {
    for (const m of media) {
      if (m.el === first || m.el.tagName === 'IMG' || !Number.isFinite(m.el.duration)) continue;
      if (Math.abs(m.el.currentTime - first.currentTime) > 0.15) m.el.currentTime = Math.min(first.currentTime, m.el.duration);
    }
  }

  /** The window could not play a file as it is (or its copy): main makes one it can, or says why not. Asked once per source. */
  function failed(item, src, what) {
    const k = `${item.id}|${src}`;
    if (asked.has(k)) return;
    asked.add(k);
    desk.viewer.ask('copy', item.id, `the window could not play this ${what}`).catch(() => {});
  }

  function busyLine(front) {
    els.busy.hidden = !front.some((it) => it.copy && (it.copy.state === 'making' || it.copy.state === 'waiting'));
  }

  function unstage() {
    cancelAnimationFrame(frame);
    frame = 0;
    for (const m of media) {
      // a picture read whole stays at hand, for an arrow back to it
      const src = m.el.tagName === 'IMG' ? m.el.getAttribute('src') : '';
      if (src && m.el.dataset.state === 'ok' && !warmed.has(src)) { m.el.remove(); warmed.set(src, m.el); continue; }
      if (m.el.pause) m.el.pause();
      m.el.removeAttribute('src');
      if (m.el.load) m.el.load();
      if (m.ctx) m.ctx.close().catch(() => {});
    }
    media = [];
    staged = '';
    const keep = new Set([els.busy, els.empty, els.prev, els.next, els.count]);
    for (const el of [...els.stage.children]) if (!keep.has(el)) el.remove();
  }

  /** The pictures before and after the one in front, loaded ahead: an arrow puts them on the stage at once, whole. */
  function warm(hs, s, front) {
    const keep = new Set();
    const list = front ? flipOf(hs, s, front).list : [];
    const i = front ? list.findIndex((it) => it.id === front.id) : -1;
    if (i >= 0 && list.length > 1) {
      for (const d of [1, -1]) {
        const it = list[(i + d + list.length) % list.length];
        const src = it.kind === 'image' ? srcOf(it) : '';
        if (!src) continue;
        keep.add(src);
        if (!warmed.has(src)) {
          const img = picture(src);
          img.decode().catch(() => {});
          warmed.set(src, img);
        }
      }
    }
    cool(keep);
  }
  /** Lets go of the pictures loaded ahead, but those kept. */
  function cool(keep) {
    for (const [src, img] of warmed) {
      if (keep && keep.has(src)) continue;
      img.removeAttribute('src');
      warmed.delete(src);
    }
  }

  /** The one before, the next one and where this one stands, there while there is more than one file to go through. */
  function drawFlip(hs, s, front) {
    const list = hs && front ? flipOf(hs, s, front).list : [];
    const on = list.length > 1;
    els.prev.hidden = !on;
    els.next.hidden = !on;
    els.count.hidden = !on;
    if (on) {
      const i = list.findIndex((it) => it.id === front.id);
      els.count.textContent = `${i < 0 ? '–' : i + 1} / ${list.length}`;
    }
  }

  /** The folder of the file in front, asked of main once a while: its other files can then be gone through. */
  function wantFolder(hk, hs, front) {
    if (hs.folder && hs.folder.dir === front.dir && hs.folder.items.some((it) => it.id === front.id)) return;
    const k = `${hk}\n${front.id}`;
    if (Date.now() - (listing.get(k) || 0) < 20000) return;
    if (listing.size > 400) listing.clear();
    listing.set(k, Date.now());
    desk.viewer.ask('folder', front.id, hk).catch(() => {});
  }

  /** A file of the folder that the window cannot show as it is: main makes the copy it can, once. */
  function make(item) {
    const k = `make|${item.id}`;
    if (asked.has(k)) return;
    asked.add(k);
    desk.viewer.ask('make', item.id).catch(() => {});
  }

  function grid(items, s) {
    els.stage.append(h('div', { class: 'vw-grid' }, items.map((item) => {
      const d = item.info && item.info.duration;
      return h('button', { class: 'vw-cell', tip: item.name, onclick: () => { s.pick = item.id; Object.assign(s, { z: 1, x: 0, y: 0, time: 0 }); draw(); } },
        h('div', { class: 'vw-cell-pic' }, small(item, 22), item.kind !== 'image' && d ? h('span', { class: 'vw-cell-time', text: timeWords(d) }) : null),
        h('span', { class: 'vw-cell-name', text: item.name }));
    })));
  }

  /** A file's small picture (made by main), or its picture itself, or a mark for what it is. lazy: made once near the view. */
  function small(item, size, lazy) {
    if (item.kind === 'audio') return icon('volume', size);
    const img = h('img', { alt: '', draggable: 'false', decoding: 'async', loading: lazy ? 'lazy' : null, src: urlOf(item, 't') });
    img.addEventListener('error', () => {
      const src = item.kind === 'image' ? srcOf(item) : '';
      if (src && img.getAttribute('src') !== src) img.src = src;
      else img.replaceWith(icon(item.kind === 'video' ? 'play' : 'image', size));
    });
    return img;
  }

  /**
   * The strip under the stage: what the arrows go through, the file in front lit; a press puts one in front. Beside it,
   * while the folder of the file in front holds others, a switch between what this chat showed and that folder.
   */
  function drawStrip(hk, hs, items, s, front) {
    const folder = front && hs.folder && hs.folder.dir === front.dir && hs.folder.items.length > 1 && hs.folder.items.some((it) => it.id === front.id) ? hs.folder : null;
    const { which, list } = front ? flipOf(hs, s, front) : { which: 'shown', list: hs.items };
    els.strip.hidden = list.length < 2 && !folder;
    if (els.strip.hidden) return;
    const stamp = JSON.stringify([hk, which, list.map((it) => [it.id, srcOf(it)]), folder ? [folder.dir, folder.items.length, folder.total] : 0, hs.items.length]);
    if (els.strip.dataset.stamp !== stamp) {
      els.strip.dataset.stamp = stamp;
      delete els.strip.dataset.on;
      const choose = (name) => () => {
        s.list = name;
        const now = current(hk);
        const at = now.hs && now.mode === 'one' ? oneOf(now.items, s) : null;
        // back to what the chat showed from a file of the folder: its last show in front
        if (name === 'shown' && at && !now.hs.items.some((it) => it.id === at.id)) Object.assign(s, { pick: '', index: 0, mode: 'one', z: 1, x: 0, y: 0, time: 0 });
        // the folder read again: files made since come in
        if (name === 'folder' && at) { listing.delete(`${hk}\n${at.id}`); desk.viewer.ask('folder', at.id, hk).catch(() => {}); }
        draw();
      };
      const many = (n) => `${n} file${n === 1 ? '' : 's'}`;
      const lists = folder && h('div', { class: 'vw-lists', role: 'group', 'aria-label': 'What the arrows go through' },
        h('button', { class: `vw-list-btn${which === 'shown' ? ' on' : ''}`, 'aria-pressed': String(which === 'shown'), onclick: choose('shown'),
          tip: `What this chat showed: ${many(hs.items.length)}, the newest last` }, h('span', { text: 'Shown' }), h('i', { text: String(hs.items.length) })),
        h('button', { class: `vw-list-btn${which === 'folder' ? ' on' : ''}`, 'aria-pressed': String(which === 'folder'), onclick: choose('folder'),
          tip: `The pictures, videos and sounds in its folder, ${folder.name}, by name${folder.total > folder.items.length ? `: the ${folder.items.length} nearest of ${folder.total}` : ''}` },
        h('span', { text: 'Folder' }), h('i', { text: String(folder.items.length) })));
      fill(els.strip, lists, h('div', { class: 'vw-thumbs' }, list.map((item) => h('button', { class: 'vw-thumb', data: { id: item.id },
        tip: `${item.name}${item.by ? `\nShown by ${item.by === 'you' ? 'you' : item.by}` : ''}`, 'aria-label': item.name,
        onclick: () => { const now = homeOf(hk); if (now) { putInFront(now, s, item); draw(); } } }, small(item, 16, list.length > 24)))));
    }
    const lit = new Set((front ? [front] : items).map((it) => it.id));
    let on = null;
    for (const b of els.strip.querySelectorAll('.vw-thumb')) {
      const yes = lit.has(b.dataset.id);
      b.classList.toggle('on', yes);
      if (yes && !on) on = b;
    }
    if (on && els.strip.dataset.on !== on.dataset.id) {
      els.strip.dataset.on = on.dataset.id;
      on.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
  }

  function drawInfo(items, mode, s) {
    if (mode !== 'one') {
      fill(els.info, h('span', { class: 'vw-info-name', text: `${items.length} files` }),
        h('span', { class: 'vw-info-facts', text: mode === 'compare' ? (s.look === 'wipe' ? 'one over the other' : 'side by side') : 'a press opens one' }));
      return;
    }
    const it = oneOf(items, s);
    const m = media.find((x) => x.item.id === it.id);
    const i = it.info || {};
    const w = i.w || (m ? m.el.naturalWidth || m.el.videoWidth : 0);
    const ht = i.h || (m ? m.el.naturalHeight || m.el.videoHeight : 0);
    const d = i.duration || (m && Number.isFinite(m.el.duration) ? m.el.duration : 0);
    const facts = [w && ht ? `${w} × ${ht}` : '', it.kind !== 'image' && d ? timeWords(d) : '', it.kind === 'video' && i.fps ? `${i.fps} fps` : '',
      it.kind !== 'image' && i.codec ? i.codec : '', it.ext ? it.ext.toUpperCase() : '', sizeWords(it.size), it.copy && it.copy.state === 'ready' ? 'shown from a copy' : ''].filter(Boolean);
    fill(els.info, h('span', { class: 'vw-info-name', text: it.name }), h('span', { class: 'vw-info-facts', text: facts.join(' · ') }),
      h('span', { class: 'vw-info-acts' },
        h('button', { class: 'icon-btn', 'aria-label': 'Show it in its folder', tip: 'Show it in its folder', onclick: () => desk.viewer.ask('reveal', it.id).catch(() => {}) }, icon('folder', 14)),
        h('button', { class: 'icon-btn', 'aria-label': 'Open it in its own program', tip: 'Open it in the program Windows opens it with',
          onclick: () => desk.viewer.ask('external', it.id).then((r) => { if (r && r.error) toast(r.error, 6000); }, () => {}) }, icon('external', 14))));
  }
  function drawInfoNow() {
    const { items, mode, s } = current(homeKey(scope.key));
    if (items.length) drawInfo(items, mode, s);
  }

  // ---- the bar under a video or a sound ----

  function drawBar() {
    const m = lead();
    els.bar.hidden = !m;
    if (!m) return;
    const s = stateOf(homeKey(scope.key));
    if (!els.play) {
      els.play = h('button', { class: 'icon-btn vw-play', onclick: () => playPause() });
      els.time = h('span', { class: 'vw-time' });
      els.buffered = h('div', { class: 'vw-buffered' });
      els.done = h('div', { class: 'vw-done' });
      els.knob = h('div', { class: 'vw-knob' });
      els.track = h('div', { class: 'vw-track', role: 'slider', 'aria-label': 'Where it is' }, els.buffered, els.done, els.knob);
      els.speed = h('button', { class: 'vw-speed', tip: 'Speed', onclick: () => { const st = stateOf(homeKey(scope.key)); setRate(SPEEDS[(SPEEDS.indexOf(st.rate) + 1) % SPEEDS.length]); } });
      els.loop = h('button', { class: 'icon-btn', 'aria-label': 'Play it again and again', tip: 'Play it again and again', onclick: () => setLoop(!stateOf(homeKey(scope.key)).loop) }, icon('loop', 15));
      els.sound = h('button', { class: 'icon-btn', onclick: () => soundSwitch() });
      els.volDone = h('div', { class: 'vw-vol-done' });
      els.volKnob = h('div', { class: 'vw-vol-knob' });
      els.vol = h('div', { class: 'vw-vol', role: 'slider', 'aria-label': 'Sound level', 'aria-valuemin': '0', 'aria-valuemax': '100' }, els.volDone, els.volKnob);
      fill(els.bar, els.play, els.time, els.track, els.speed, els.loop, els.sound, els.vol);
      seekDrag(els.track);
      volumeDrag(els.vol);
      for (const el of [els.sound, els.vol]) el.addEventListener('wheel', (e) => { e.preventDefault(); setVolume(volume + (e.deltaY < 0 ? 0.05 : -0.05), true); }, { passive: false });
    }
    const v = m.el;
    const playing = !v.paused && !v.ended;
    fill(els.play, icon(playing ? 'pause' : 'play', 15));
    els.play.setAttribute('aria-label', playing ? 'Pause' : 'Play');
    els.play.dataset.tip = playing ? 'Pause (Space)' : 'Play (Space)';
    els.speed.textContent = `${s.rate}×`;
    els.loop.classList.toggle('on', s.loop);
    els.loop.setAttribute('aria-pressed', String(s.loop));
    const quiet = v.muted || v.volume === 0;
    fill(els.sound, icon(quiet ? 'volume-off' : 'volume', 16));
    els.sound.setAttribute('aria-label', quiet ? 'Turn the sound on' : 'Turn the sound off');
    els.sound.dataset.tip = quiet ? 'Turn the sound on (M)' : 'Turn the sound off (M)';
    const now = quiet ? 0 : volume;
    els.volDone.style.transform = `scaleX(${now})`;
    els.volKnob.style.left = `${now * 100}%`;
    els.vol.setAttribute('aria-valuenow', String(Math.round(now * 100)));
    els.vol.dataset.tip = `Sound ${Math.round(volume * 100)}%${v.muted ? ', off' : ''}\nThe same in every chat's Viewer. ↑ ↓ or the wheel.`;
    drawTime();
  }

  function drawTime() {
    const m = lead();
    if (!m || !els.time) return;
    const v = m.el;
    const d = Number.isFinite(v.duration) ? v.duration : 0;
    els.time.textContent = `${timeWords(v.currentTime)} / ${timeWords(d)}`;
    const k = d ? Math.min(1, v.currentTime / d) : 0;
    els.done.style.transform = `scaleX(${k})`;
    els.knob.style.left = `${k * 100}%`;
    let end = 0;
    const b = v.buffered;
    for (let i = 0; i < b.length; i++) if (b.start(i) <= v.currentTime + 0.5) end = Math.max(end, b.end(i));
    els.buffered.style.transform = `scaleX(${d ? Math.min(1, end / d) : 0})`;
  }

  /** While something plays and the window draws: the bar moves smoothly, and a sound's levels dance. */
  function run() {
    if (frame) return;
    const go = () => {
      frame = 0;
      const m = lead();
      if (!m || !open || m.el.paused) { levels(); return; }
      drawTime();
      levels();
      frame = requestAnimationFrame(go);
    };
    frame = requestAnimationFrame(go);
  }

  /** A sound's levels, from what it plays now (through the window's own audio graph, made at its first play). */
  function levels() {
    for (const m of media) {
      if (!m.canvas) continue;
      if (!m.analyser && !m.el.paused && !m.deaf) {
        try {
          const ctx = new AudioContext();
          const an = ctx.createAnalyser();
          an.fftSize = 128;
          an.smoothingTimeConstant = 0.8;
          ctx.createMediaElementSource(m.el).connect(an);
          an.connect(ctx.destination);
          ctx.resume().catch(() => {});
          Object.assign(m, { ctx, analyser: an, bins: new Uint8Array(an.frequencyBinCount) });
        } catch { m.deaf = true; }
      }
      const g = m.canvas.getContext('2d');
      const W = m.canvas.width;
      const H = m.canvas.height;
      g.clearRect(0, 0, W, H);
      const n = 28;
      const gap = 5;
      const bw = (W - gap * (n - 1)) / n;
      const live = Boolean(m.analyser) && !m.el.paused;
      if (live) m.analyser.getByteFrequencyData(m.bins);
      for (let i = 0; i < n; i++) {
        // still, a gentle wave at rest; playing, what it plays now
        const v = live ? m.bins[Math.floor((i / n) * m.bins.length * 0.7)] / 255 : 0.1 + 0.16 * Math.abs(Math.sin(i * 0.55));
        const bh = Math.max(3, v * H);
        g.fillStyle = `rgba(255, 255, 255, ${live ? 0.25 + v * 0.7 : 0.22})`;
        g.beginPath();
        g.roundRect(i * (bw + gap), (H - bh) / 2, bw, bh, Math.min(3, bw / 2));
        g.fill();
      }
    }
  }

  function seekDrag(track) {
    const at = (e) => {
      const m = lead();
      if (!m || !Number.isFinite(m.el.duration)) return null;
      const r = track.getBoundingClientRect();
      return Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * m.el.duration;
    };
    track.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      try { track.setPointerCapture(e.pointerId); } catch { /* not held */ }
      track.classList.add('held');
      const t = at(e);
      if (t !== null) seek(t);
    });
    track.addEventListener('pointermove', (e) => {
      const t = at(e);
      if (t === null) return;
      track.dataset.tip = timeWords(t);
      if (track.classList.contains('held')) seek(t);
    });
    const end = () => track.classList.remove('held');
    track.addEventListener('pointerup', end);
    track.addEventListener('pointercancel', end);
  }
  function volumeDrag(slider) {
    const at = (e) => { const r = slider.getBoundingClientRect(); return r.width ? (e.clientX - r.left) / r.width : volume; };
    slider.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      try { slider.setPointerCapture(e.pointerId); } catch { /* not held */ }
      slider.classList.add('held');
      setVolume(at(e), true);
    });
    slider.addEventListener('pointermove', (e) => { if (slider.classList.contains('held')) setVolume(at(e), true); });
    const end = () => slider.classList.remove('held');
    slider.addEventListener('pointerup', end);
    slider.addEventListener('pointercancel', end);
  }

  // ---- what the person or a chat does with it ----

  function playPause(want) {
    const m = lead();
    if (!m) return false;
    const go = want === undefined ? m.el.paused || m.el.ended : want;
    stateOf(homeKey(scope.key)).paused = !go;
    if (go) { if (m.el.ended) m.el.currentTime = 0; m.el.play().catch(() => {}); } else m.el.pause();
    return true;
  }
  function seek(t) {
    const m = lead();
    if (!m) return;
    const d = Number.isFinite(m.el.duration) ? m.el.duration : 0;
    const to = Math.max(0, Math.min(d, t));
    for (const x of media) if (x.el.tagName !== 'IMG') x.el.currentTime = Math.min(to, Number.isFinite(x.el.duration) ? x.el.duration : to);
    stateOf(homeKey(scope.key)).time = to;
    drawTime();
  }
  function stepFrames(n) {
    const m = lead();
    if (!m) return;
    const fps = (m.item.info && m.item.info.fps) || 30;
    m.el.pause();
    seek(m.el.currentTime + n / fps);
  }
  function setRate(r) {
    stateOf(homeKey(scope.key)).rate = r;
    for (const m of media) if (m.el.tagName !== 'IMG') m.el.playbackRate = r;
    drawBar();
  }
  function setLoop(on) {
    stateOf(homeKey(scope.key)).loop = on;
    for (const m of media) if (m.el.tagName !== 'IMG') m.el.loop = on;
    drawBar();
  }
  function setMuted(on) {
    const m = lead();
    if (!m) return;
    m.el.muted = on;
    if (m.el.tagName === 'VIDEO') { soundOn = !on; kept.set('view-sound', soundOn ? '1' : '0'); }
    drawBar();
  }
  /**
   * The one sound level of every Viewer, kept. The person raising it on a silent video turns its sound on, as a
   * player does; a chat's level never turns on a sound the person left off.
   */
  function setVolume(v, byPerson = false) {
    volume = level(v);
    if (volume > 0) heard = volume;
    kept.set('view-volume', String(volume));
    for (const m of media) if (m.el.tagName !== 'IMG') m.el.volume = volume;
    const l = lead();
    if (byPerson && l && l.el.muted && volume > 0) setMuted(false); else drawBar();
  }
  /** The speaker: off, or on again at the level it had before it was taken down to nothing. */
  function soundSwitch() {
    const l = lead();
    if (!l) return;
    if (!l.el.muted && volume > 0) { setMuted(true); return; }
    if (volume === 0) setVolume(heard, true);
    setMuted(false);
  }
  /**
   * The file before (n -1) or after (n 1) the one in front, alone: in what the arrows go through, or, for a chat
   * (mine), in the files this chat showed.
   */
  function step(n, hk = homeKey(scope.key), mine = false) {
    const { hs, s, items, mode } = current(hk);
    if (!hs || !items.length) return;
    const front = mode === 'one' ? oneOf(items, s) : items[0];
    const list = mine ? hs.items : flipOf(hs, s, front).list;
    if (list.length < 2) return;
    const i = list.findIndex((it) => it.id === front.id);
    putInFront(hs, s, i < 0 ? list[n > 0 ? 0 : list.length - 1] : list[(i + n + list.length) % list.length]);
    if (hk === homeKey(scope.key)) draw();
  }
  /** How many files the arrows go through from the one in front. */
  function flipCount() {
    const { hs, s, items, mode } = current(homeKey(scope.key));
    return hs && items.length ? flipOf(hs, s, mode === 'one' ? oneOf(items, s) : items[0]).list.length : 0;
  }

  // ---- zoom and move ----

  const canZoom = () => media.some((m) => m.item.kind !== 'audio');

  function place(s) {
    const t = s.z === 1 && !s.x && !s.y ? '' : `translate(${s.x}px, ${s.y}px) scale(${s.z})`;
    for (const m of media) m.zoom.style.transform = t;
    els.stage.classList.toggle('zoomed', s.z > 1);
    // past a few screen pixels to each of the file's, the file is drawn as the squares it is made of
    let squares = false;
    const m = media.find((x) => x.item.kind !== 'audio');
    if (m && s.z > 1) {
      const nw = m.el.naturalWidth || m.el.videoWidth;
      const nh = m.el.naturalHeight || m.el.videoHeight;
      const r = m.el.getBoundingClientRect();
      if (nw && nh) squares = (Math.min(r.width, r.height * (nw / nh)) * devicePixelRatio) / nw > PIXELS_AT;
    }
    els.stage.classList.toggle('pixels', squares);
  }
  /** Zooms to z with the point (x, y) of a pane, in its own pixels, staying where it is. */
  function zoomAt(s, z, x, y) {
    const next = Math.max(1, Math.min(48, z));
    s.x = x - (next / s.z) * (x - s.x);
    s.y = y - (next / s.z) * (y - s.y);
    s.z = next;
    if (s.z === 1) { s.x = 0; s.y = 0; }
    place(s);
  }
  /** fit: the whole file in view; actual: one of its pixels to one of the screen's; or a factor. */
  function zoomTo(how) {
    const s = stateOf(homeKey(scope.key));
    const m = media.find((x) => x.item.kind !== 'audio');
    if (how === 'fit' || !m) { Object.assign(s, { z: 1, x: 0, y: 0 }); place(s); return; }
    let want = Number(how);
    if (how === 'actual') {
      const nw = m.el.naturalWidth || m.el.videoWidth;
      const nh = m.el.naturalHeight || m.el.videoHeight;
      if (!nw || !nh) return;
      const r = m.el.getBoundingClientRect();
      want = nw / (Math.min(r.width / s.z, (r.height / s.z) * (nw / nh)) * devicePixelRatio);
    }
    if (!(want > 0)) return;
    const box = m.pane.getBoundingClientRect();
    Object.assign(s, { z: 1, x: 0, y: 0 });
    zoomAt(s, want, box.width / 2, box.height / 2);
  }
  function zoomBy(k) {
    const m = media.find((x) => x.item.kind !== 'audio');
    if (!m) return;
    const s = stateOf(homeKey(scope.key));
    const box = m.pane.getBoundingClientRect();
    zoomAt(s, s.z * k, box.width / 2, box.height / 2);
  }
  function wheel(e) {
    const pane = e.target.closest('.vw-pane');
    if (!pane || !canZoom()) return;
    e.preventDefault();
    const s = stateOf(homeKey(scope.key));
    const box = pane.getBoundingClientRect();
    zoomAt(s, s.z * Math.exp(-e.deltaY * 0.0015), e.clientX - box.left, e.clientY - box.top);
  }
  function pan(e) {
    const s = stateOf(homeKey(scope.key));
    if (s.z <= 1 || e.button !== 0 || e.target.closest('button, .vw-wipe-handle')) return;
    e.preventDefault();
    const start = { x: e.clientX - s.x, y: e.clientY - s.y };
    try { els.stage.setPointerCapture(e.pointerId); } catch { /* not held */ }
    els.stage.classList.add('moving');
    const move = (ev) => { s.x = ev.clientX - start.x; s.y = ev.clientY - start.y; place(s); };
    const up = () => {
      els.stage.classList.remove('moving');
      els.stage.removeEventListener('pointermove', move);
      els.stage.removeEventListener('pointerup', up);
      els.stage.removeEventListener('pointercancel', up);
    };
    els.stage.addEventListener('pointermove', move);
    els.stage.addEventListener('pointerup', up);
    els.stage.addEventListener('pointercancel', up);
  }
  function wipe(handle, s, top) {
    const set = () => { top.style.clipPath = `inset(0 0 0 ${s.split}%)`; handle.style.left = `${s.split}%`; };
    set();
    handle.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      try { handle.setPointerCapture(e.pointerId); } catch { /* not held */ }
      const move = (ev) => { const r = els.stage.getBoundingClientRect(); s.split = Math.max(0, Math.min(100, ((ev.clientX - r.left) / r.width) * 100)); set(); };
      const up = () => { handle.removeEventListener('pointermove', move); handle.removeEventListener('pointerup', up); handle.removeEventListener('pointercancel', up); };
      handle.addEventListener('pointermove', move);
      handle.addEventListener('pointerup', up);
      handle.addEventListener('pointercancel', up);
    });
  }

  // ---- the panel's width: its grip, as the other edges of the window have ----

  function grip() {
    const g = els.grip;
    let x0 = 0;
    let w0 = 0;
    let on = false;
    g.addEventListener('pointerdown', (e) => {
      if (!open || e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      try { g.setPointerCapture(e.pointerId); } catch { /* not held */ }
      x0 = e.clientX;
      w0 = width;
      on = true;
      g.classList.add('on');
      document.body.classList.add('sizing', 'vw-drag');
      Terms.freeze(true);
    });
    g.addEventListener('pointermove', (e) => { if (on) setWidth(clampWidth(w0 - (e.clientX - x0))); });
    const end = () => {
      if (!on) return;
      on = false;
      g.classList.remove('on');
      document.body.classList.remove('sizing', 'vw-drag');
      userW = width;
      kept.set('view-w', String(userW));
      Terms.freeze(false);
      act.changed();
    };
    g.addEventListener('pointerup', end);
    g.addEventListener('pointercancel', end);
    g.addEventListener('lostpointercapture', end);
    g.addEventListener('dblclick', (e) => {
      e.preventDefault();
      userW = 0;
      kept.set('view-w', '0');
      if (open) setWidth(clampWidth(usual()));
      act.changed();
    });
  }

  // ---- keys, while the keyboard is in the Viewer ----

  function key(e) {
    if (e.ctrlKey || e.altKey || e.metaKey) return;
    const s = stateOf(homeKey(scope.key));
    const m = lead();
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    let used = true;
    if (k === 'Escape') { if (big) setBig(false); else toggleFor(scope.key, false); }
    else if ((k === ' ' || k === 'k') && m) playPause();
    // the arrows go to the file before or after; inside a video with Shift, or when it is the only file
    else if (k === 'ArrowLeft' || k === 'ArrowRight') {
      const d = k === 'ArrowLeft' ? -1 : 1;
      if (m && (e.shiftKey || flipCount() < 2)) seek(m.el.currentTime + 5 * d); else step(d);
    }
    else if (k === 'j' && m) seek(m.el.currentTime - 10);
    else if (k === 'l' && m) seek(m.el.currentTime + 10);
    else if (k === ',' && m) stepFrames(-1);
    else if (k === '.' && m) stepFrames(1);
    else if (k === 'Home' && m) seek(0);
    else if (k === 'End' && m) seek(Infinity);
    else if (k === '[') step(-1);
    else if (k === ']') step(1);
    else if (k === 'm' && m) soundSwitch();
    else if ((k === 'ArrowUp' || k === 'ArrowDown') && m) setVolume(volume + (k === 'ArrowUp' ? 0.1 : -0.1), true);
    else if (k === 'f') setBig(!big);
    else if (k === '0') zoomTo('fit');
    else if (k === '1') zoomTo('actual');
    else if (k === '+' || k === '=') zoomBy(1.25);
    else if (k === '-') zoomBy(0.8);
    else if (k === 'g') { s.pick = ''; s.mode = s.mode === 'grid' ? 'one' : 'grid'; draw(); }
    else if (k === 'c') { s.pick = ''; s.mode = 'compare'; draw(); }
    else if (k === 'w') { s.look = s.look === 'wipe' ? 'side' : 'wipe'; draw(); }
    else used = false;
    if (used) { e.preventDefault(); e.stopPropagation(); }
  }

  // ---- what a chat asks, through main ----

  /** Whether a chat's Viewer is on screen now, and what the window found of its files once they loaded (4 s at most). */
  async function shown(a) {
    const here = open && homeKey(scope.key) === a.home;
    const items = {};
    if (here) {
      const late = later(4000);
      for (const m of media) items[m.item.id] = (await Promise.race([m.ready, late])) || {};
    }
    return { open: here, items };
  }

  function stateWords(hk) {
    const { hs, s, items, mode } = current(hk);
    if (!hs || !items.length) return 'This chat\'s Viewer shows nothing.';
    const here = open && homeKey(scope.key) === hk;
    const list = shownOf(hs);
    const at = mode === 'one' ? oneOf(items, s) : null;
    const n = at ? list.findIndex((it) => it.id === at.id) : -1;
    const f = at && n < 0 && hs.folder ? hs.folder.items.findIndex((it) => it.id === at.id) : -1;
    const where = n >= 0 ? (list.length > 1 ? ` (file ${n + 1} of ${list.length})` : '')
      : at && hs.items.some((it) => it.id === at.id) ? ' (a file this chat showed before)'
        : f >= 0 ? ` (a file of its folder the user went to, ${f + 1} of ${hs.folder.items.length} there)` : '';
    const parts = [mode === 'one' ? `It shows ${at.name}${where}`
      : mode === 'compare' ? `It shows ${items[0].name} and ${items[1].name} ${s.look === 'wipe' ? `one over the other, the line at ${Math.round(s.split)}%` : 'side by side'}`
        : `It shows ${items.length} files as a grid`];
    const m = here ? lead() : null;
    if (m) {
      const d = Number.isFinite(m.el.duration) ? m.el.duration : 0;
      parts.push(`${m.el.paused ? 'paused' : 'playing'} at ${timeWords(m.el.currentTime)} of ${timeWords(d)}`, `speed ${m.el.playbackRate}×`,
        m.el.loop ? 'looping' : 'not looping', m.el.muted ? 'sound off' : `sound on at ${Math.round(m.el.volume * 100)}%`);
    } else if (at && at.kind !== 'image') {
      parts.push(`${s.paused ? 'paused' : 'to play'} at ${timeWords(s.time)}`, `speed ${s.rate}×`, s.loop ? 'looping' : 'not looping', `sound level ${Math.round(volume * 100)}%`);
    }
    if (here && s.z !== 1) parts.push(`zoomed ${s.z.toFixed(2)}×`);
    if (!here) parts.push('this chat\'s Viewer is not on screen now: the user sees it on going to this chat');
    return `${parts.join(', ')}.`;
  }

  async function control(a) {
    const hk = typeof a.home === 'string' ? a.home : '';
    const here = open && homeKey(scope.key) === hk;
    const { hs, s } = current(hk);
    if (!hs) return { error: 'This chat has shown nothing in the Viewer yet: show_media first.' };
    const list = shownOf(hs);
    const v = a.value;
    const num = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
    const on = v === undefined || v === null || v === '' ? true : !(v === false || v === 0 || ['false', 'off', 'no', '0'].includes(String(v).toLowerCase()));
    const m = here ? lead() : null;
    switch (a.action) {
      case 'state': break;
      case 'play': case 'pause': {
        if (here && !m) return { error: 'What the Viewer shows is not a video or a sound.' };
        s.paused = a.action === 'pause';
        if (m) playPause(a.action === 'play');
        break;
      }
      case 'seek':
        if (!(num >= 0)) return { error: 'seek takes a second in value, such as 12.5.' };
        s.time = num;
        if (m) seek(num);
        break;
      case 'step':
        if (!m) return { error: here ? 'Only a video steps by frames.' : 'step works while this chat\'s Viewer is on screen.' };
        stepFrames(Math.trunc(num) || 1);
        break;
      case 'speed':
        if (!(num >= 0.0625 && num <= 16)) return { error: 'speed takes a number from 0.0625 to 16 in value.' };
        s.rate = num;
        if (here) setRate(num);
        break;
      case 'loop': s.loop = on; if (here) setLoop(on); break;
      case 'mute': if (m) setMuted(on); else { soundOn = !on; kept.set('view-sound', soundOn ? '1' : '0'); } break;
      case 'volume':
        if (!(num >= 0 && num <= 1)) return { error: 'volume takes a number from 0 to 1 in value.' };
        setVolume(num);
        break;
      case 'zoom':
        if (!here) return { error: 'zoom works while this chat\'s Viewer is on screen.' };
        if (v === 'fit' || v === 'actual') zoomTo(v);
        else if (num >= 1) zoomTo(num);
        else return { error: 'zoom takes fit, actual or a factor of 1 or more in value.' };
        break;
      case 'select': {
        const n = Math.trunc(num);
        if (!(n >= 1 && n <= list.length)) return { error: `select takes a file's number in value, 1 to ${list.length}.` };
        Object.assign(s, { mode: 'one', index: n - 1, pick: '', z: 1, x: 0, y: 0, time: 0 });
        if (here) draw();
        break;
      }
      case 'next': case 'previous': step(a.action === 'next' ? 1 : -1, hk, true); break;
      case 'mode':
        if (!['one', 'compare', 'grid'].includes(v)) return { error: 'mode takes one, compare or grid in value.' };
        if (v !== 'one' && list.length < 2) return { error: `${v} needs two files or more: show_media with them.` };
        Object.assign(s, { mode: v, pick: '' });
        if (here) draw();
        break;
      case 'close':
        if (here) toggleFor(scope.key, false); else opened.delete(hk);
        return { said: 'This chat\'s Viewer is closed.' };
      default: return { error: `There is no ${a.action} here.` };
    }
    // a moment for the video to get where it was sent
    if (m && (a.action === 'seek' || a.action === 'step') && m.el.seeking) {
      await Promise.race([new Promise((done) => m.el.addEventListener('seeked', done, { once: true })), later(1500)]);
    }
    return { said: stateWords(hk) };
  }

  /** A picture of what a chat's Viewer shows: a picture file, the frame where its video stands (or at a second), or two side by side. */
  async function look(a) {
    const hk = typeof a.home === 'string' ? a.home : '';
    const { hs, s, items, mode } = current(hk);
    if (!hs || !items.length) return { error: 'This chat has shown nothing in the Viewer yet: show_media first.' };
    const here = open && homeKey(scope.key) === hk;
    const list = shownOf(hs);
    let pick;
    if (a.file !== null && a.file !== undefined) {
      const it = list[Math.trunc(Number(a.file)) - 1];
      if (!it) return { error: `file takes a number from 1 to ${list.length}.` };
      pick = [it];
    } else {
      pick = mode === 'one' ? [oneOf(items, s)] : mode === 'compare' ? items.slice(0, 2) : items.slice(0, 1);
    }
    const at = a.at === null || a.at === undefined ? null : Number(a.at);
    const frames = [];
    for (const it of pick) {
      if (it.kind === 'audio') return { error: `${it.name} is a sound: it has no picture to look at.` };
      const src = srcOf(it);
      if (!src) return { error: `${it.name} cannot be seen yet: ${waitWords(it)}` };
      const onStage = here ? media.find((m) => m.item.id === it.id) : null;
      const el = await frameOf(it, src, onStage, at);
      const t = it.kind !== 'video' ? null : at !== null ? at : onStage ? onStage.el.currentTime : s.time;
      frames.push({ it, el, t, w: el.videoWidth || el.naturalWidth || 1024, h: el.videoHeight || el.naturalHeight || 1024 });
    }
    const w = frames.reduce((n, f) => n + f.w, 0);
    const ht = Math.max(...frames.map((f) => f.h));
    const k = Math.min(1, LOOK_MAX / Math.max(w, ht));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(w * k));
    canvas.height = Math.max(1, Math.round(ht * k));
    const g = canvas.getContext('2d');
    g.fillStyle = '#000';
    g.fillRect(0, 0, canvas.width, canvas.height);
    let x = 0;
    for (const f of frames) {
      g.drawImage(f.el, x, (canvas.height - f.h * k) / 2, f.w * k, f.h * k);
      x += f.w * k;
    }
    for (const f of frames) if (f.el.dataset.mine) { f.el.removeAttribute('src'); if (f.el.load) f.el.load(); }
    const data = canvas.toDataURL('image/jpeg', 0.86).replace(/^data:image\/jpeg;base64,/, '');
    const said = frames.map((f) => `${f.it.name}${f.t !== null ? ` at ${timeWords(f.t)}` : ''} (${f.w} × ${f.h})`).join(' beside ');
    return { data, said: `${said}; this picture is ${canvas.width} × ${canvas.height}.` };
  }

  /** What a file is drawn from: its element on the stage when it stands where asked, else one of its own, loaded aside. */
  async function frameOf(it, src, onStage, at) {
    if (onStage && (at === null || onStage.el.tagName === 'IMG')) {
      await Promise.race([onStage.ready, later(8000)]);
      if (onStage.el.tagName === 'IMG' ? onStage.el.complete && onStage.el.naturalWidth > 0 : onStage.el.readyState >= 2) return onStage.el;
    }
    if (it.kind === 'image') {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.dataset.mine = '1';
      await new Promise((done, fail) => {
        const t = setTimeout(() => fail(new Error(`${it.name} did not load in time.`)), 15000);
        img.onload = () => { clearTimeout(t); done(); };
        img.onerror = () => { clearTimeout(t); fail(new Error(`${it.name} could not be read as a picture.`)); };
        img.src = src;
      });
      return img;
    }
    const v = document.createElement('video');
    v.crossOrigin = 'anonymous';
    v.muted = true;
    v.preload = 'auto';
    v.dataset.mine = '1';
    await new Promise((done, fail) => {
      const t = setTimeout(() => fail(new Error(`${it.name} did not load in time.`)), 15000);
      v.addEventListener('loadeddata', () => { clearTimeout(t); done(); }, { once: true });
      v.addEventListener('error', () => { clearTimeout(t); fail(new Error(`${it.name} could not be played.`)); }, { once: true });
      v.src = src;
    });
    const to = Math.max(0, Math.min(Number.isFinite(v.duration) ? Math.max(0, v.duration - 0.001) : 0, at === null ? 0 : at));
    if (to > 0) {
      await Promise.race([new Promise((done) => { v.addEventListener('seeked', done, { once: true }); v.currentTime = to; }), later(8000)]);
    }
    return v;
  }

  // ---- files the person opens ----

  function whenOpened(r) {
    if (r && r.refused && r.refused.length) toast(r.refused[0], 9000);
    if (r && r.shown) toggleFor(scope.key, true, true);
  }
  function openPaths(paths) { desk.viewer.ask('open', paths, scope.key).then(whenOpened, () => {}); }
  function openDialog() { desk.viewer.ask('dialog', scope.key).then(whenOpened, () => {}); }

  /** What one chat's Viewer holds, for its button on the chat's strip. */
  function of(key) {
    const hs = view.homes[key];
    return { n: hs ? hs.items.length : 0, open: open && scope.key === key };
  }

  return {
    init, follow, toggle, toggleFor, shut, of, openDialog, openPaths,
    isOpen: () => open,
    width: () => (open ? width : 0),
    state: () => {
      const { hs, mode, s, items } = current(homeKey(scope.key));
      const front = hs && items.length ? (mode === 'one' ? oneOf(items, s) : items[0]) : null;
      const flip = front ? flipOf(hs, s, front) : { which: '', list: [] };
      return { open, big, scope: scope.key, opened: [...opened], mode, staged: Boolean(staged), ui: { ...s }, volume, soundOn,
        flip: { which: flip.which, names: flip.list.map((it) => it.name) }, count: els && !els.count.hidden ? els.count.textContent : '',
        warm: [...warmed].map(([src, img]) => ({ src, state: img.dataset.state || '' })),
        media: media.map((m) => ({ id: m.item.id, name: m.item.name, tag: m.el.tagName, src: m.el.currentSrc || m.el.src || '', paused: m.el.paused === undefined ? null : m.el.paused,
          time: m.el.currentTime || 0, duration: m.el.duration || 0, w: m.el.naturalWidth || m.el.videoWidth || 0, h: m.el.naturalHeight || m.el.videoHeight || 0,
          muted: Boolean(m.el.muted), volume: m.el.volume === undefined ? null : m.el.volume, zoom: m.zoom.style.transform })) };
    },
  };
})();
