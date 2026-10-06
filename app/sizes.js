'use strict';
/* global h, kept, Terms */
// How wide the three movable parts of the window are: the list of chats on the left, the panel beside a chat (its
// tool calls, or in the Nest the person's day) and the Browser on the right. Each has a grip on its edge: dragged, it
// moves the edge; double-clicked, the edge goes back to where it starts. The chats keep at least TILES_MIN of the
// window: the parts around them stop there, and the panel beside a chat steps aside when even its narrowest would
// leave the chats less (styles/shell.css writes the same numbers). What each was set to is kept, and comes back
// when the window has room for it again.

const Sizes = (() => {
  const SIDE = { min: 200, max: 440, usual: 280 };
  const PANEL = { min: 260, max: 760 };
  const TILES_MIN = 420;
  // the panel the chats sit in: its margin on the right and its two borders
  const STAGE_EDGES = 10;
  let act = null;
  let side = SIDE.usual;
  const $ = (id) => document.getElementById(id);

  /**
   * actions: webWidth() the Browser's width now (0 while closed), webWanted() the width it was given (0 while closed),
   * webMin() its narrowest, setWeb(w) gives it a width at once, aside(on) its page steps aside for its picture while
   * an edge moves, changed() after an edge moved.
   */
  function init(actions) {
    act = actions;
    side = wantedSide();
    for (const [name, key] of [['--insp-w', 'insp-w'], ['--rail-w', 'rail-w']]) {
      const w = Number(kept.get(key, '0'));
      if (w > 0) document.body.style.setProperty(name, `${w}px`);
    }
    const sideGrip = grip('side-grip', 'Width of the list of chats');
    document.body.append(sideGrip);
    drag(sideGrip, {
      start: () => side,
      move: (w0, dx) => setSide(w0 + dx),
      done: () => kept.set('side-w', String(side)),
      reset: () => { kept.set('side-w', '0'); setSide(SIDE.usual); },
    });
    const panelGrip = grip('panel-grip', 'Width of the panel beside the chat');
    $('chat-body').insertBefore(panelGrip, $('inspector'));
    drag(panelGrip, {
      start: () => { const p = panel(); return p ? p.el.getBoundingClientRect().width : 0; },
      move: (w0, dx) => setPanel(w0 - dx),
      done: () => { const p = panel(); if (p) kept.set(p.key, String(Math.round(p.el.getBoundingClientRect().width))); },
      reset: () => { const p = panel(); if (p) { document.body.style.removeProperty(p.name); kept.set(p.key, '0'); } },
    });
    setSide(side);
    let timer = 0;
    window.addEventListener('resize', () => { clearTimeout(timer); timer = setTimeout(fit, 50); });
  }

  function grip(id, label) {
    return h('div', { id, class: 'grip', role: 'separator', 'aria-orientation': 'vertical', 'aria-label': label,
      tip: 'Drag to resize. Double-click: back to the usual width.' });
  }

  /**
   * A grip that moves an edge. start(): the width when the press began; move(w0, dx): the pointer moved dx since;
   * done(): let go; reset(): double-clicked. Meanwhile the terminals keep their size: each new size makes the program
   * in them draw its whole screen again, so they are fitted once, when the grip is let go.
   */
  function drag(el, { start, move, done, reset }) {
    let x0 = 0;
    let w0 = 0;
    let on = false;
    el.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      // a pointer already let go cannot be held: the drag still follows it while it stays over the grip
      try { el.setPointerCapture(e.pointerId); } catch { /* not held */ }
      x0 = e.clientX;
      w0 = start();
      on = true;
      el.classList.add('on');
      document.body.classList.add('sizing');
      Terms.freeze(true);
      act.aside(true);
    });
    el.addEventListener('pointermove', (e) => { if (on) move(w0, e.clientX - x0); });
    const end = () => {
      if (!on) return;
      on = false;
      el.classList.remove('on');
      document.body.classList.remove('sizing');
      done();
      Terms.freeze(false);
      act.aside(false);
      act.changed();
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    el.addEventListener('lostpointercapture', end);
    el.addEventListener('dblclick', (e) => {
      e.preventDefault();
      reset();
      fit();
      act.changed();
    });
  }

  const wantedSide = () => Number(kept.get('side-w', '0')) || SIDE.usual;
  /** The list of chats on the left, in pixels: nothing while it is hidden. */
  const sideWidth = () => (document.body.classList.contains('no-side') ? 0 : side);
  /** The panel beside the chats, while it is on screen: the element, its width's name, and where that is kept. */
  function panel() {
    if ($('chat').hidden) return null;
    if (!$('nest-rail').hidden) return { el: $('nest-rail'), name: '--rail-w', key: 'rail-w' };
    if (!$('inspector').hidden) return { el: $('inspector'), name: '--insp-w', key: 'insp-w' };
    return null;
  }
  /** What the panel the chats sit in needs: room for the chats, and for the panel beside them while it is shown. */
  const stageNeed = () => TILES_MIN + STAGE_EDGES + (panel() ? PANEL.min : 0);
  /** The room the list of chats and the Browser share. */
  const room = () => window.innerWidth - stageNeed();

  function setSide(w) {
    const most = Math.max(SIDE.min, Math.min(SIDE.max, room() - act.webWidth()));
    side = Math.round(Math.min(Math.max(w, SIDE.min), most));
    document.body.style.setProperty('--sidebar', `${side}px`);
  }

  function setPanel(w) {
    const p = panel();
    if (!p) return;
    const stage = $('chat-body').getBoundingClientRect().width;
    const next = Math.round(Math.min(Math.max(w, PANEL.min), PANEL.max, Math.max(PANEL.min, stage - TILES_MIN)));
    document.body.style.setProperty(p.name, `${next}px`);
  }

  /**
   * The window changed size, or a panel came or went. Each part gets the width it was given if there is room; where
   * there is not, the Browser gives way first, down to its narrowest, then the list of chats.
   */
  function fit() {
    if (!act) return;
    const all = room();
    const web = act.webWanted();
    const left = document.body.classList.contains('no-side') ? 0 : wantedSide();
    if (web) act.setWeb(Math.min(web, all - Math.min(left, all - act.webMin())));
    setSide(left);
  }

  return { init, fit, sideWidth, stageNeed, TILES_MIN };
})();
