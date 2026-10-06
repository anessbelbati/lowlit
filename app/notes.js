'use strict';
/* global notes, h, fill, ago, noteCard */
// The notes (main.cjs makes their window): a card for each chat that wants the person, finished, or is the Nest that
// answered, and for the limits, drives and countdowns, the newest on top, at the top of the screen in the corner
// Settings names, while Lowlit is not in front. The cards are the window's own (ui.js noteCard): × closes one;
// Go there, or a click on its words, brings Lowlit up where it points. A card that does not wait for the person goes
// by itself after a while, held while the pointer is on the cards.

(() => {
  const root = document.getElementById('stack');
  const AFTER_POINTER_MS = 4000;    // a card held by the pointer goes this long after it leaves, at the soonest
  let list = [];
  let ms = 12000;
  let held = false;
  const ends = new Map();           // card id -> when it goes by itself
  let told = 0;

  function draw() {
    fill(root, list.map((n) => noteCard(n, () => notes.open(n.id), () => notes.close(n.id))),
      list.length > 1 && h('button', { class: 'nc-all', text: 'Close all', onclick: () => notes.clear() }));
    measure();
  }

  /** The cards that wait for nobody go `ms` after they went up (all of them again once that time changes); a card gone from the list loses its end. */
  function timers(again) {
    for (const n of list) if (!n.stays && (again || !ends.has(n.id))) ends.set(n.id, (Number(n.at) || Date.now()) + ms);
    for (const id of [...ends.keys()]) if (!list.some((n) => n.id === id && !n.stays)) ends.delete(id);
  }

  /** The window is as tall as the cards and the margin their shadow falls in. */
  function measure() {
    const tall = list.length ? Math.ceil(root.getBoundingClientRect().height + 16) : 0;
    if (!tall || tall === told) return;
    told = tall;
    notes.size(tall);
  }

  setInterval(() => {
    const now = Date.now();
    if (!held) for (const [id, end] of ends) if (now >= end) { ends.delete(id); notes.close(id); }
    for (const t of root.querySelectorAll('.nc-time')) t.textContent = ago(Number(t.dataset.at), now);
  }, 250);
  root.addEventListener('mouseenter', () => { held = true; });
  root.addEventListener('mouseleave', () => {
    held = false;
    const soonest = Date.now() + Math.min(ms, AFTER_POINTER_MS);
    for (const [id, end] of ends) if (end < soonest) ends.set(id, soonest);
  });

  notes.onModel((next, how) => {
    list = Array.isArray(next) ? next : [];
    const was = ms;
    if (how && typeof how === 'object') {
      document.documentElement.dataset.look = how.look === 'grey' ? 'grey' : 'noir';
      root.classList.toggle('right', how.corner !== 'top-left');
      if (Number(how.ms) > 0) ms = Number(how.ms);
    }
    timers(ms !== was);
    draw();
  });
  // the app's own fonts arrive after the first draw and change its height a little
  document.fonts.addEventListener('loadingdone', measure);
  new ResizeObserver(measure).observe(root);
})();
