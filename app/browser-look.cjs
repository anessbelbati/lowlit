'use strict';
// What runs inside a page of the browser, in a world of its own: the page's scripts cannot see it and it cannot
// see theirs, while both see the same elements. It writes the outline the chats read (what is on the page, with a
// ref like e12 on everything that can be clicked or typed into), finds an element again by its ref, says where to
// click it and what covers it, and does the few things a click or a key cannot (pick in a list, select a field's
// text, read a field out whole or fill it from a file, say what a form would send). It is handed to the page as
// source text, so nothing outside the function can be used inside it.
//
// The ring drawn where a chat clicks is the only thing it adds to a page, for the person watching: it carries
// data-lowlit-ui, is skipped by the outline, and goes again after a moment.

function look() {
  const refs = new Map();          // 'e12' -> a weak hold on its element
  const named = new WeakMap();     // element -> 'e12'
  let next = 1;
  const refOf = (el) => {
    let r = named.get(el);
    if (!r) {
      r = `e${next++}`;
      named.set(el, r);
      refs.set(r, new WeakRef(el));
    }
    return r;
  };
  const byRef = (ref) => {
    const key = String(ref || '').trim().replace(/^\[?(ref=)?/, '').replace(/\]$/, '');
    const hold = refs.get(key);
    const el = hold && hold.deref();
    return el && el.isConnected ? el : null;
  };

  const squash = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
  const clip = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
  const quote = (s) => JSON.stringify(s);

  const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'META', 'LINK', 'HEAD', 'TITLE', 'BASE', 'PARAM', 'SOURCE', 'TRACK']);
  const INTERACTIVE = new Set(['link', 'button', 'textbox', 'searchbox', 'checkbox', 'radio', 'combobox', 'listbox', 'option', 'menuitem',
    'menuitemcheckbox', 'menuitemradio', 'tab', 'switch', 'slider', 'spinbutton', 'treeitem', 'clickable']);
  // interactive, with more of the same inside them
  const HOLDS = new Set(['listbox', 'menu', 'menubar', 'tablist', 'radiogroup', 'tree', 'treegrid', 'grid']);
  const STRUCT = new Set(['navigation', 'main', 'complementary', 'banner', 'contentinfo', 'form', 'dialog', 'alertdialog', 'list', 'listitem',
    'table', 'row', 'cell', 'columnheader', 'rowheader', 'group', 'region', 'menu', 'menubar', 'tablist', 'radiogroup', 'tree', 'treegrid',
    'grid', 'toolbar', 'tabpanel', 'search', 'article', 'figure', 'alert', 'status']);
  const NAME_FROM_TEXT = new Set(['link', 'button', 'tab', 'menuitem', 'menuitemcheckbox', 'menuitemradio', 'option', 'treeitem', 'switch',
    'checkbox', 'radio', 'heading', 'cell', 'columnheader', 'rowheader', 'clickable', 'listitem']);
  const CAN_HOLD_CONTROLS = 'a[href],button,input,select,textarea,summary,[role],[onclick],[tabindex],[contenteditable=""],[contenteditable="true"]';

  const inSection = (el) => Boolean(el.parentElement && el.parentElement.closest('article,aside,main,nav,section'));
  const headingLevel = (el) => {
    const m = /^H([1-6])$/.exec(el.tagName);
    return m ? Number(m[1]) : Number(el.getAttribute('aria-level')) || 2;
  };

  function roleOf(el) {
    const own = (el.getAttribute('role') || '').trim().split(/\s+/)[0].toLowerCase();
    if (own && own !== 'presentation' && own !== 'none' && own !== 'generic') return own;
    switch (el.tagName) {
      case 'A': case 'AREA': return el.hasAttribute('href') ? 'link' : '';
      case 'BUTTON': case 'SUMMARY': return 'button';
      case 'INPUT': {
        const t = (el.getAttribute('type') || 'text').toLowerCase();
        if (t === 'hidden') return '';
        if (t === 'button' || t === 'submit' || t === 'reset' || t === 'image' || t === 'file') return 'button';
        if (t === 'checkbox') return el.getAttribute('switch') !== null ? 'switch' : 'checkbox';
        if (t === 'radio') return 'radio';
        if (t === 'range') return 'slider';
        if (t === 'number') return 'spinbutton';
        if (t === 'search') return 'searchbox';
        return el.hasAttribute('list') ? 'combobox' : 'textbox';
      }
      case 'SELECT': return el.multiple || el.size > 1 ? 'listbox' : 'combobox';
      case 'TEXTAREA': return 'textbox';
      case 'OPTION': return 'option';
      case 'IMG': return squash(el.getAttribute('alt')) ? 'img' : '';
      case 'H1': case 'H2': case 'H3': case 'H4': case 'H5': case 'H6': return 'heading';
      case 'NAV': return 'navigation';
      case 'MAIN': return 'main';
      case 'ASIDE': return 'complementary';
      case 'HEADER': return inSection(el) ? '' : 'banner';
      case 'FOOTER': return inSection(el) ? '' : 'contentinfo';
      case 'FORM': return 'form';
      case 'DIALOG': return 'dialog';
      case 'UL': case 'OL': case 'MENU': return 'list';
      case 'LI': return 'listitem';
      case 'TABLE': return 'table';
      case 'TR': return 'row';
      case 'TH': return 'columnheader';
      case 'TD': return 'cell';
      case 'IFRAME': case 'FRAME': return 'iframe';
      case 'FIELDSET': return 'group';
      case 'SECTION': return el.hasAttribute('aria-label') || el.hasAttribute('aria-labelledby') ? 'region' : '';
      case 'SVG': case 'svg': return el.getAttribute('aria-label') ? 'img' : '';
      case 'VIDEO': return 'video';
      case 'AUDIO': return 'audio';
      case 'CANVAS': return 'canvas';
      default: break;
    }
    if (el.isContentEditable && !(el.parentElement && el.parentElement.isContentEditable)) return 'textbox';
    return '';
  }

  function nameOf(el, role) {
    const doc = el.ownerDocument;
    const by = el.getAttribute('aria-labelledby');
    if (by) {
      const t = squash(by.split(/\s+/).map((id) => { const x = doc.getElementById(id); return x ? x.innerText || x.textContent : ''; }).join(' '));
      if (t) return t;
    }
    const aria = squash(el.getAttribute('aria-label'));
    if (aria) return aria;
    const tag = el.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
      const t = (el.type || '').toLowerCase();
      if (t === 'button' || t === 'submit' || t === 'reset') return squash(el.value) || (t === 'submit' ? 'Submit' : t === 'reset' ? 'Reset' : '');
      if (t === 'image') return squash(el.alt || el.value) || 'Submit';
      const labels = el.labels ? [...el.labels].map((l) => squash(l.innerText || l.textContent)).filter(Boolean) : [];
      if (labels.length) return labels.join(' ');
      if (t === 'file') return 'Choose file';
      return squash(el.getAttribute('placeholder') || el.getAttribute('title') || el.getAttribute('name'));
    }
    if (tag === 'IMG') return squash(el.alt || el.title);
    if (role === 'textbox') return squash(el.getAttribute('aria-placeholder') || el.getAttribute('placeholder') || el.getAttribute('title'));
    if (NAME_FROM_TEXT.has(role)) {
      const t = squash(el.innerText || el.textContent);
      if (t) return t;
      // a button drawn as an icon: the picture or the label inside it says what it is
      const inner = el.querySelector('img[alt],svg[aria-label],[aria-label],[title]');
      if (inner) return squash(inner.getAttribute('alt') || inner.getAttribute('aria-label') || inner.getAttribute('title'));
    }
    return squash(el.getAttribute('title'));
  }

  function statesOf(el, role) {
    const a = (n) => el.getAttribute(n);
    const out = [];
    if (role === 'checkbox' || role === 'radio' || role === 'switch' || role === 'menuitemcheckbox' || role === 'menuitemradio') {
      const on = el.tagName === 'INPUT' ? el.checked : a('aria-checked') === 'true';
      if (on) out.push('checked');
      else if (el.indeterminate || a('aria-checked') === 'mixed') out.push('mixed');
    }
    if (el.disabled || a('aria-disabled') === 'true') out.push('disabled');
    if (a('aria-expanded') === 'true') out.push('expanded');
    if (a('aria-selected') === 'true' || (el.tagName === 'OPTION' && el.selected)) out.push('selected');
    if (a('aria-pressed') === 'true') out.push('pressed');
    if (a('aria-current') && a('aria-current') !== 'false') out.push('current');
    if (el.required || a('aria-required') === 'true') out.push('required');
    return out;
  }

  function valueOf(el, role) {
    if (el.tagName === 'SELECT') {
      const picked = [...el.selectedOptions].map((o) => squash(o.label || o.textContent));
      return picked.join(', ');
    }
    if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
      const t = (el.type || '').toLowerCase();
      if (t === 'checkbox' || t === 'radio' || t === 'button' || t === 'submit' || t === 'reset' || t === 'image') return '';
      if (t === 'file') return [...(el.files || [])].map((f) => f.name).join(', ');
      if (t === 'password') return el.value ? `(${el.value.length} characters, hidden)` : '';
      return el.value || '';
    }
    if (role === 'textbox' && el.isContentEditable) return squash(el.innerText);
    if (role === 'slider' || role === 'spinbutton') return squash(el.getAttribute('aria-valuetext') || el.getAttribute('aria-valuenow'));
    return '';
  }

  function shortUrl(el) {
    const href = el.href;
    if (!href || typeof href !== 'string' || /^javascript:/i.test(href)) return '';
    try {
      const u = new URL(href);
      const here = el.ownerDocument.location;
      if (u.origin === here.origin) return clip(u.pathname + u.search + u.hash, 90);
    } catch { /* not an address */ }
    return clip(href, 110);
  }

  /** What an element is, in a few words: its kind and name, else its tag with its id or first class. */
  function describe(el) {
    if (!el || el.nodeType !== 1) return 'nothing';
    const role = roleOf(el);
    const name = clip(nameOf(el, role || 'clickable'), 60);
    if (role && name) return `${role} ${quote(name)}`;
    const cls = typeof el.className === 'string' && el.className.trim() ? `.${el.className.trim().split(/\s+/)[0]}` : '';
    return `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : cls}${name ? ` ${quote(name)}` : ''}`;
  }

  /** The children an element shows: its shadow root's when it has one, what a slot is given, else its own. */
  function kids(node) {
    if (node.shadowRoot) return node.shadowRoot.childNodes;
    if (node.tagName === 'SLOT') {
      const given = node.assignedNodes({ flatten: true });
      return given.length ? given : node.childNodes;
    }
    return node.childNodes;
  }

  /** Something made to be clicked that does not say so: it takes the pointer itself, or has a click handler, and holds no control. */
  function looksClickable(el, style) {
    if (el.hasAttribute('onclick')) return true;
    const tab = el.getAttribute('tabindex');
    const pointer = style.cursor === 'pointer' && !(el.parentElement && getComputedStyle(el.parentElement).cursor === 'pointer');
    if (!pointer && !(tab !== null && Number(tab) >= 0)) return false;
    if (el.querySelector(CAN_HOLD_CONTROLS)) return false;
    return Boolean(squash(el.innerText || el.getAttribute('aria-label') || el.getAttribute('title')));
  }

  function outline({ max = 20000, find = '', full = false } = {}) {
    // a page that lives for hours (a web app) keeps making elements: the refs of those that are gone are let go
    if (refs.size > 20000) for (const [r, hold] of refs) { const el = hold.deref(); if (!el || !el.isConnected) refs.delete(r); }
    // a form is first read before a chat changes it: what it holds then is what form_preview compares with
    formBase(false);
    const lines = [];
    let size = 0;
    let cut = false;
    const limit = find ? 600000 : max;
    const push = (d, s) => {
      if (cut) return;
      lines.push({ d, s });
      size += s.length + d * 2 + 1;
      if (size > limit) cut = true;
    };
    const flush = (d, text) => {
      if (!text.length) return;
      const t = squash(text.join(' '));
      text.length = 0;
      if (t) push(d, `- text: ${clip(t, full ? 2000 : 500)}`);
    };
    const line = (el, role, d) => {
      let s = `- ${role}`;
      const name = clip(nameOf(el, role), 150);
      if (name) s += ` ${quote(name)}`;
      for (const x of statesOf(el, role)) s += ` [${x}]`;
      if (role === 'heading') s += ` [level=${headingLevel(el)}]`;
      if (INTERACTIVE.has(role) || role === 'iframe') s += ` [ref=${refOf(el)}]`;
      const v = valueOf(el, role);
      if (v) s += `: ${quote(clip(v, 150))}`;
      if (el.tagName === 'SELECT' && !el.multiple) {
        const opts = [...el.options];
        if (opts.length) s += ` (${opts.length} options: ${opts.slice(0, 8).map((o) => squash(o.label || o.textContent)).join(', ')}${opts.length > 8 ? ', …' : ''})`;
      }
      if (role === 'link') {
        const u = shortUrl(el);
        if (u) s += ` → ${u}`;
      }
      push(d, s);
    };
    // a block with nothing to press in it is said in one line: "- listitem: Fast builds"
    const plain = (el) => !el.querySelector(CAN_HOLD_CONTROLS) && !el.querySelector('iframe,canvas,video,h1,h2,h3,h4,h5,h6,ul,ol,table');

    // quiet: the node itself is not shown (visibility: hidden), so its own words are not either; what inside it is
    // made visible again still is
    function walk(node, d, text, quiet = false) {
      for (const child of kids(node)) {
        if (cut) return;
        if (child.nodeType === 3) {
          if (!quiet && /\S/.test(child.data)) text.push(child.data);
          continue;
        }
        if (child.nodeType !== 1) continue;
        const el = child;
        if (SKIP.has(el.tagName) || el.hasAttribute('data-lowlit-ui')) continue;
        const style = getComputedStyle(el);
        if (style.display === 'none' || el.getAttribute('aria-hidden') === 'true') continue;
        if (style.visibility === 'hidden' || style.visibility === 'collapse') {
          if (el.firstElementChild || el.shadowRoot) walk(el, d, text, true);
          continue;
        }
        let role = roleOf(el);
        if (!role && looksClickable(el, style)) role = 'clickable';
        if (role === 'option' && !el.closest('[role="listbox"],[role="combobox"],datalist')) role = '';
        if (INTERACTIVE.has(role)) {
          flush(d, text);
          line(el, role, d);
          if (HOLDS.has(role) && el.tagName !== 'SELECT') walk(el, d + 1, []);
          continue;
        }
        if (role === 'heading') {
          flush(d, text);
          if (plain(el)) line(el, role, d);
          else { line(el, role, d); walk(el, d + 1, []); }
          continue;
        }
        if (role === 'img') { flush(d, text); push(d, `- img ${quote(clip(nameOf(el, role), 150))}`); continue; }
        if (role === 'iframe') {
          flush(d, text);
          let inner = null;
          try { inner = el.contentDocument; } catch { inner = null; }
          const title = squash(el.getAttribute('title') || el.getAttribute('name') || el.getAttribute('aria-label'));
          if (inner && inner.body) { push(d, `- iframe${title ? ` ${quote(title)}` : ''}:`); walk(inner.body, d + 1, []); }
          else push(d, `- iframe${title ? ` ${quote(title)}` : ''} [ref=${refOf(el)}] (another site: not readable here; a screenshot shows it)`);
          continue;
        }
        if (role === 'canvas') {
          const r = el.getBoundingClientRect();
          if (r.width * r.height > 40000) { flush(d, text); push(d, `- canvas ${Math.round(r.width)}×${Math.round(r.height)} (drawn, not text: a screenshot shows it)`); }
          continue;
        }
        if (role === 'video' || role === 'audio') {
          flush(d, text);
          push(d, `- ${role}${squash(el.getAttribute('title') || el.getAttribute('aria-label')) ? ` ${quote(squash(el.getAttribute('title') || el.getAttribute('aria-label')))}` : ''}${el.paused === false ? ' [playing]' : ''}`);
          continue;
        }
        // a label says its control's name: its words would be said twice
        if (el.tagName === 'LABEL' && el.control) { walk(el, d, []); continue; }
        if (STRUCT.has(role)) {
          flush(d, text);
          const name = role === 'listitem' || role === 'cell' || role === 'row' ? '' : clip(nameOf(el, role), 100);
          if (role === 'row' && plain(el)) {
            const cells = [...el.children].map((c) => clip(squash(c.innerText || c.textContent), 120)).filter(Boolean);
            if (cells.length) push(d, `- row: ${cells.join(' | ')}`);
            continue;
          }
          if ((role === 'listitem' || role === 'cell' || role === 'columnheader') && plain(el)) {
            const t = clip(squash(el.innerText || el.textContent), full ? 2000 : 400);
            if (t) push(d, `- ${role}: ${t}`);
            continue;
          }
          push(d, `- ${role}${name ? ` ${quote(name)}` : ''}${el.tagName === 'DIALOG' && el.open ? ' [open]' : ''}:`);
          const inner = [];
          walk(el, d + 1, inner);
          flush(d + 1, inner);
          continue;
        }
        const inline = !role && (style.display.startsWith('inline') || style.display === 'contents');
        if (inline) { walk(el, d, text); continue; }
        // a block of its own: what came before it is said first, then what is in it, at the same depth
        flush(d, text);
        walk(el, d, text);
        flush(d, text);
      }
    }

    const doc = document;
    const top = [];
    walk(doc.body || doc.documentElement, 0, top);
    flush(0, top);

    let shown = lines;
    if (find) {
      const words = squash(find).toLowerCase().split(' ').filter(Boolean);
      const keep = new Set();
      const stack = [];
      lines.forEach((l, i) => {
        stack[l.d] = i;
        stack.length = l.d + 1;
        const low = l.s.toLowerCase();
        if (words.every((w) => low.includes(w))) for (const j of stack) keep.add(j);
      });
      shown = lines.filter((_, i) => keep.has(i));
      let total = 0;
      const capped = [];
      for (const l of shown) { total += l.s.length + l.d * 2 + 1; if (total > max) { cut = true; break; } capped.push(l); }
      if (capped.length < shown.length) shown = capped;
      else cut = false;
    }
    const scroller = doc.scrollingElement || doc.documentElement;
    const open = doc.querySelector('dialog[open],[role="dialog"][aria-modal="true"],[role="alertdialog"]');
    return {
      url: location.href,
      title: doc.title || '',
      lines: shown.map((l) => `${'  '.repeat(l.d)}${l.s}`),
      cut,
      found: find ? shown.length : -1,
      scroll: { y: Math.round(scroller.scrollTop), height: Math.round(scroller.scrollHeight), view: Math.round(innerHeight), width: Math.round(innerWidth) },
      dialog: Boolean(open && open.getClientRects().length),
      focused: doc.activeElement && doc.activeElement !== doc.body ? describe(doc.activeElement) : '',
    };
  }

  /** Whether `inner` is `outer` or inside it, through the components it sits in. */
  const within = (outer, inner) => {
    for (let n = inner; n; n = n.parentNode || n.host) if (n === outer) return true;
    return false;
  };

  /** The documents an element sits in, from its own out to the top, with each frame's element. */
  function frameChain(el) {
    const chain = [];
    let w = el.ownerDocument.defaultView;
    while (w && w.frameElement) {
      chain.push(w.frameElement);
      w = w.parent;
    }
    return chain;
  }

  /**
   * Where to click an element, in the top page's own pixels: the middle of the part of its first box the window
   * shows, once it is scrolled into sight (a box taller than the window, such as a long text area, is brought in by its
   * top and clicked in what shows of it). covered: what would take the click instead. zero: it has no size (a control
   * drawn by its label, say).
   */
  function point(ref, { scroll = true } = {}) {
    let el = byRef(ref);
    if (!el) return { gone: true };
    let r = el.getClientRects()[0] || el.getBoundingClientRect();
    // a control drawn by its label (a hidden checkbox under a styled box) is clicked through the label
    if ((r.width < 1 || r.height < 1) && el.labels && el.labels.length) {
      const label = [...el.labels].find((l) => l.getClientRects().length);
      if (label) { el = label; r = el.getClientRects()[0]; }
    }
    const v = el.ownerDocument.defaultView;
    if (scroll) {
      const away = r.top < 0 || r.left < 0 || r.bottom > v.innerHeight || r.right > v.innerWidth;
      const tall = r.height > v.innerHeight;
      const wide = r.width > v.innerWidth;
      if (away && (tall || wide)) el.scrollIntoView({ block: tall ? 'start' : 'center', inline: wide ? 'start' : 'center', behavior: 'instant' });
      else if (away) {
        if (typeof el.scrollIntoViewIfNeeded === 'function') el.scrollIntoViewIfNeeded(true);
        else el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
      }
      // a frame wholly out of sight is brought in; one that shows only in part is left, as is a frame taller than the window
      for (const f of frameChain(el)) {
        const fr = f.getBoundingClientRect();
        const fv = f.ownerDocument.defaultView;
        if (fr.bottom < 0 || fr.top > fv.innerHeight) f.scrollIntoView({ block: 'nearest', behavior: 'instant' });
      }
      r = el.getClientRects()[0] || el.getBoundingClientRect();
    }
    const left = Math.max(r.left, 0);
    const top = Math.max(r.top, 0);
    const right = Math.min(r.right, v.innerWidth);
    const bottom = Math.min(r.bottom, v.innerHeight);
    const seen = right - left >= 1 && bottom - top >= 1;
    const lx = seen ? (left + right) / 2 : r.left + r.width / 2;
    const ly = seen ? (top + bottom) / 2 : r.top + r.height / 2;
    let dx = 0;
    let dy = 0;
    for (const f of frameChain(el)) {
      const fr = f.getBoundingClientRect();
      dx += fr.left + f.clientLeft;
      dy += fr.top + f.clientTop;
    }
    const x = lx + dx;
    const y = ly + dy;
    const zero = r.width < 1 || r.height < 1;
    // asked of the element's own root: inside a component, the document would only name the component
    const root = el.getRootNode();
    const hit = zero ? null : (typeof root.elementFromPoint === 'function' ? root : el.ownerDocument).elementFromPoint(lx, ly);
    const fine = !hit || within(el, hit) || within(hit, el);
    const outside = x < 0 || y < 0 || x > innerWidth || y > innerHeight;
    return {
      x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10, zero, outside,
      covered: fine ? '' : describe(hit), what: describe(el),
      box: { x: Math.round(r.left + dx), y: Math.round(r.top + dy), width: Math.round(r.width), height: Math.round(r.height) },
    };
  }

  const NO_TEXT = ['checkbox', 'radio', 'button', 'submit', 'reset', 'image', 'file', 'range', 'color', 'hidden'];

  /**
   * A field's whole text read out ('text'), or put in from a file ('fill'), for save_field and fill_field: a text box, a
   * text area, or an editable area (its HTML when html is set). A password is never read out nor filled. A fill sets
   * the value the way the browser itself does, past whatever a page's framework wraps the field in, so the framework
   * hears of it as of typing: input, then change.
   */
  function field(el, what, { text = '', html = false } = {}) {
    const t = (el.type || '').toLowerCase();
    const plain = el.tagName === 'INPUT' || el.tagName === 'TEXTAREA';
    if (el.tagName === 'INPUT' && t === 'password') return { ok: false, why: `${describe(el)} is a password field: what it holds is never read out or filled from a file` };
    if (el.tagName === 'INPUT' && NO_TEXT.includes(t)) return { ok: false, why: `${describe(el)} holds no text` };
    if (!plain && !el.isContentEditable) return { ok: false, why: `${describe(el)} is not a field: a text box, a text area or an editable area is` };
    const now = () => (plain ? el.value : html ? el.innerHTML : el.innerText);
    if (what === 'text') return { ok: true, value: now(), what: describe(el), one: el.tagName === 'INPUT' };
    if (el.disabled || el.readOnly) return { ok: false, why: `${describe(el)} cannot be written in: it is ${el.disabled ? 'disabled' : 'read-only'}` };
    let put = String(text);
    // a text box drops line breaks without a word: the file's last one is left out, and a file of several lines refused
    if (el.tagName === 'INPUT') {
      put = put.replace(/\r?\n$/, '');
      if (/[\r\n]/.test(put)) return { ok: false, why: `${describe(el)} holds one line, and the file has several: fill a text area, or put one line in the file` };
    }
    el.focus({ preventScroll: true });
    if (plain) {
      const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, put);
      el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertReplacementText' }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    } else {
      const doc = el.ownerDocument;
      const range = doc.createRange();
      range.selectNodeContents(el);
      const sel = doc.defaultView.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      // as a paste would: the editor's own handlers run; an editor that refuses it is filled directly and told
      if (!doc.execCommand(html ? 'insertHTML' : 'insertText', false, put)) {
        if (html) el.innerHTML = put; else el.textContent = put;
        el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertReplacementText' }));
      }
    }
    return { ok: true, value: now(), what: describe(el), one: el.tagName === 'INPUT' };
  }

  // ---- what a form would send: against what it held when the chat first read the page, or when a chat marked it ----
  const bases = new WeakMap();
  // as KEYISH in browser.cjs: a field whose name says it can open an account
  const KEYISH = /pass(word|wd|phrase)?(?![a-z])|pwd|secret|token|api[-_]?key|(?<![a-z])auth(?![a-z])|authorization|session|cookie|nonce|csrf|xsrf|(?<![a-z])otp(?![a-z])|signature|private[-_]?key/i;

  /** What a form would send now, as [name, value] pairs in order: a file as its name and size. */
  function entriesOf(form) {
    let data;
    try { data = new FormData(form); } catch { return []; }
    return [...data.entries()].map(([k, v]) => [k, typeof v === 'string' ? v : `(a file: ${v.name || 'no name'}, ${v.size} bytes)`]);
  }

  /** Every form of the page gets its starting point the first time it is seen; mark: every form starts again from now. */
  function formBase(mark = false) {
    for (const f of document.forms) if (mark || !bases.has(f)) bases.set(f, { at: Date.now(), entries: entriesOf(f), marked: mark });
  }

  /**
   * The fields of a form (the one ref sits in, else every form of the page) that would be sent otherwise than at its
   * starting point: changed, added or gone. A password, and a field named like a key, a token or a nonce, says only
   * that it changed and how long it is. mark: the starting point becomes what they hold now.
   */
  function formPreview(ref, mark) {
    let list = [...document.forms];
    if (ref) {
      const el = byRef(ref);
      if (!el) return { gone: true };
      const f = el.tagName === 'FORM' ? el : el.form || el.closest('form');
      if (!f) return { ok: false, why: `${describe(el)} is not inside a form` };
      list = [f];
    }
    if (mark) {
      for (const f of list) bases.set(f, { at: Date.now(), entries: entriesOf(f), marked: true });
      return { ok: true, marked: list.length };
    }
    const group = (pairs) => { const m = new Map(); for (const [k, v] of pairs) { if (!m.has(k)) m.set(k, []); m.get(k).push(v); } return m; };
    const forms = list.map((f) => {
      const now = entriesOf(f);
      let base = bases.get(f);
      const late = !base;
      if (late) { base = { at: Date.now(), entries: now, marked: false }; bases.set(f, base); }
      const was = group(base.entries);
      const is = group(now);
      const changes = [];
      for (const name of new Set([...was.keys(), ...is.keys()])) {
        const a = was.get(name) || [];
        const b = is.get(name) || [];
        if (a.length === b.length && a.every((x, i) => x === b[i])) continue;
        const ctl = f.elements.namedItem(name);
        const one = ctl && typeof ctl.length === 'number' && !ctl.tagName ? ctl[0] : ctl;
        const secret = KEYISH.test(name) || Boolean(one && (one.type || '').toLowerCase() === 'password');
        changes.push({ name, how: !a.length ? 'added' : !b.length ? 'gone' : 'changed', secret,
          before: secret ? a.map((x) => x.length) : a, after: secret ? b.map((x) => x.length) : b });
        if (changes.length >= 80) break;
      }
      return { what: describe(f), action: f.getAttribute('action') || location.pathname, method: (f.getAttribute('method') || 'get').toUpperCase(),
        fields: now.length, since: base.at, marked: base.marked, late, changes };
    });
    return { ok: true, forms };
  }

  /** The things a click or a key cannot do, and the few looks a step needs. */
  function act(ref, what, arg) {
    const el = byRef(ref);
    if (!el) return { gone: true };
    if (what === 'focus') {
      el.focus({ preventScroll: false });
      const active = el.ownerDocument.activeElement;
      return { ok: active === el || el.contains(active) };
    }
    if (what === 'select-all') {
      if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
        try { el.select(); } catch { /* a field that cannot be selected: its value is replaced as typed */ }
      } else if (el.isContentEditable) {
        const range = el.ownerDocument.createRange();
        range.selectNodeContents(el);
        const sel = el.ownerDocument.defaultView.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
      }
      return { ok: true };
    }
    if (what === 'click') {
      el.click();
      // a click from inside the page leaves the keyboard where it was: what takes the keyboard is given it, as a real click would
      if (typeof el.focus === 'function' && (el.isContentEditable || el.matches('input,textarea,select,button,a[href],[tabindex]'))) el.focus({ preventScroll: true });
      return { ok: true };
    }
    if (what === 'text' || what === 'fill') return field(el, what, arg || {});
    if (what === 'editable') {
      const t = (el.type || '').toLowerCase();
      const field = (el.tagName === 'INPUT' && !['checkbox', 'radio', 'button', 'submit', 'reset', 'image', 'file', 'range', 'color'].includes(t)) || el.tagName === 'TEXTAREA';
      return { ok: field || el.isContentEditable, file: el.tagName === 'INPUT' && t === 'file', what: describe(el) };
    }
    if (what === 'options') {
      if (el.tagName !== 'SELECT') return { ok: false, why: `${describe(el)} is not a list to pick from: click it, then click the choice` };
      const want = (Array.isArray(arg) ? arg : [arg]).map((v) => squash(v).toLowerCase());
      const picked = [];
      for (const o of el.options) {
        const hit = want.includes(squash(o.value).toLowerCase()) || want.includes(squash(o.label || o.textContent).toLowerCase());
        if (el.multiple) o.selected = hit;
        else if (hit && !picked.length) o.selected = true;
        if (hit && (el.multiple || picked.length === 0)) picked.push(squash(o.label || o.textContent));
      }
      if (!picked.length) return { ok: false, why: `none of the choices is ${want.map(quote).join(' or ')}: it offers ${[...el.options].slice(0, 12).map((o) => quote(squash(o.label || o.textContent))).join(', ')}` };
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return { ok: true, picked };
    }
    if (what === 'mark') { el.setAttribute('data-lowlit-pick', String(arg)); return { ok: true }; }
    if (what === 'unmark') { el.removeAttribute('data-lowlit-pick'); return { ok: true }; }
    if (what === 'value') return { ok: true, value: valueOf(el, roleOf(el) || 'textbox') };
    if (what === 'box') {
      const p = point(ref, { scroll: true });
      return { ok: !p.gone, box: p.box };
    }
    return { ok: false, why: `unknown step ${what}` };
  }

  /** Scrolls what the person would scroll there: the element's own scrolling box, or the box under the middle of the window, or the page. */
  function scroll({ ref = '', dx = 0, dy = 0 } = {}) {
    const can = (el) => {
      if (!el || el.nodeType !== 1) return false;
      const s = getComputedStyle(el);
      const y = /(auto|scroll|overlay)/.test(s.overflowY) && el.scrollHeight > el.clientHeight + 1;
      const x = /(auto|scroll|overlay)/.test(s.overflowX) && el.scrollWidth > el.clientWidth + 1;
      return (dy && y) || (dx && x);
    };
    let start = ref ? byRef(ref) : document.elementFromPoint(innerWidth / 2, innerHeight / 2);
    if (ref && !start) return { gone: true };
    let box = null;
    for (let el = start; el && el !== document.documentElement; el = el.parentElement || (el.getRootNode() && el.getRootNode().host)) {
      if (can(el)) { box = el; break; }
    }
    const target = box || document.scrollingElement || document.documentElement;
    const before = [target.scrollLeft, target.scrollTop];
    target.scrollBy({ left: dx, top: dy, behavior: 'instant' });
    return {
      moved: target.scrollLeft !== before[0] || target.scrollTop !== before[1],
      what: box ? describe(box) : 'the page',
      y: Math.round(target.scrollTop), height: Math.round(target.scrollHeight), view: Math.round(target.clientHeight),
    };
  }

  /**
   * A soft ring where a chat clicks, for the person watching. Drawn over the page, never part of it. strong: the page
   * is being recorded, and a GIF shows the ring small and still: red-orange with a white edge, seen on any page.
   */
  function ring(x, y, strong) {
    try {
      const el = document.createElement('div');
      el.setAttribute('data-lowlit-ui', '');
      el.setAttribute('aria-hidden', 'true');
      const s = el.style;
      s.cssText = 'position:fixed;z-index:2147483647;pointer-events:none;width:34px;height:34px;margin:-17px 0 0 -17px;border-radius:50%;'
        + (strong ? 'border:3px solid rgba(236,88,62,.95);box-shadow:0 0 0 2px rgba(255,255,255,.95),0 0 14px 2px rgba(236,88,62,.35);background:rgba(236,88,62,.16)'
          : 'border:2px solid rgba(255,255,255,.95);box-shadow:0 0 0 2px rgba(0,0,0,.35),0 0 22px 4px rgba(255,255,255,.45);background:rgba(255,255,255,.12)');
      s.left = `${x}px`;
      s.top = `${y}px`;
      document.documentElement.appendChild(el);
      const ms = strong ? 900 : 650;
      el.animate(strong ? [{ transform: 'scale(.7)', opacity: 1 }, { transform: 'scale(1.4)', opacity: 0 }] : [{ transform: 'scale(.35)', opacity: 1 }, { transform: 'scale(1.5)', opacity: 0 }],
        { duration: ms, easing: 'cubic-bezier(.2,.8,.2,1)' });
      setTimeout(() => el.remove(), ms + 50);
    } catch { /* a page that refuses a child of its root: no ring */ }
    return true;
  }

  /**
   * What an eye catches on the page at the size it is laid out at, measured over the whole page: a page wider than
   * its screen and what sticks out; pictures shown larger than their file holds at this screen's density (soft),
   * stretched, or not loaded; text cut off, over other text, under 12 pixels on a phone, or off the middle of a small
   * box that centres it; emojis standing in for icons; fonts that did not load; where the content sits across the
   * screen. A few of each at most, in the page's order, each saying whether it is on the first screen.
   */
  function faults(screenWidth) {
    const root = document.documentElement;
    const se = document.scrollingElement || root;
    // the width of the screen less a scroll bar: a phone widens the layout of a page wider than its screen (innerWidth
    // says the wider one), and shows it at the zoom the page asks for, or zoomed out to fit
    const W = Math.min(Number(screenWidth) || Infinity, se.clientWidth || innerWidth);
    const vv = window.visualViewport;
    const H = vv && vv.height ? vv.height : innerHeight;
    const scale = vv && vv.scale ? vv.scale : 1;
    const MAX = 5;
    const out = { width: W, height: H, dense: devicePixelRatio || 1, tall: se.scrollHeight, wide: se.scrollWidth, zoomed: Math.abs(scale - 1) > 0.02 ? Math.round(scale * 100) : 0,
      sticking: [], soft: [], stretched: [], broken: [], cut: [], over: [], tiny: [], tinyCount: 0, offCentre: [], emoji: [], fonts: [], span: null };
    const add = (list, item) => { if (list.length < MAX) list.push(item); };
    const words = (s, n = 40) => { const t = String(s || '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };
    const where = (r) => (r.top + scrollY < H ? 'first screen' : `${Math.round(r.top + scrollY)} px down`);
    const name = (el) => {
      const tag = el.tagName.toLowerCase();
      const id = el.id ? `#${el.id}` : '';
      const cls = !id && typeof el.className === 'string' && el.className.trim() ? `.${el.className.trim().split(/\s+/)[0]}` : '';
      const said = words(el.getAttribute('aria-label') || el.getAttribute('alt') || el.textContent, 36);
      return `${tag}${id}${cls}${said ? ` "${said}"` : ''}`;
    };
    const fileOf = (img) => words(decodeURIComponent(String(img.currentSrc || img.src || '').split(/[?#]/)[0].split('/').pop() || '') || 'a picture', 60);
    const ownText = (el) => [...el.childNodes].some((n) => n.nodeType === 3 && n.nodeValue.trim());
    // hidden by itself or by what it sits in (a slide faded out, a closed menu)
    const hidden = (el, cs) => cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0
      || (typeof el.checkVisibility === 'function' && !el.checkVisibility({ opacityProperty: true, visibilityProperty: true }));
    const ours = (el) => Boolean(el.closest && el.closest('[data-lowlit-ui]'));
    const clipped = (o) => o === 'hidden' || o === 'clip';
    // a page that clips what is wider than its screen does not scroll sideways
    out.sideways = out.wide > W + 1 && !clipped(getComputedStyle(root).overflowX) && !(document.body && clipped(getComputedStyle(document.body).overflowX)) ? out.wide - W : 0;

    // pictures
    for (const img of document.images) {
      if (ours(img)) continue;
      const r = img.getBoundingClientRect();
      if (r.width < 24 || r.height < 24) continue;
      const cs = getComputedStyle(img);
      if (hidden(img, cs)) continue;
      const file = fileOf(img);
      if (img.complete && !img.naturalWidth) { if (img.getAttribute('src') || img.currentSrc) add(out.broken, `${file} (${where(r)})`); continue; }
      if (!img.complete || !img.naturalWidth || /\.svg$/i.test(file) || /^data:image\/svg/i.test(img.currentSrc || '')) continue;
      const nw = img.naturalWidth;
      const nh = img.naturalHeight;
      const fit = cs.objectFit;
      const across = fit === 'cover' ? Math.max(r.width / nw, r.height / nh)
        : fit === 'contain' ? Math.min(r.width / nw, r.height / nh)
          : fit === 'scale-down' ? Math.min(1, r.width / nw, r.height / nh)
            : fit === 'none' ? 1 : Math.max(r.width / nw, r.height / nh);
      if (across * out.dense > 1.15) add(out.soft, `${file}: a ${nw}×${nh} file shown at ${Math.round(r.width)}×${Math.round(r.height)}${out.dense > 1 ? ` on a ${out.dense}× screen` : ''} (${where(r)})`);
      if ((!fit || fit === 'fill') && Math.abs((r.width / r.height) / (nw / nh) - 1) > 0.03) add(out.stretched, `${file}: a ${nw}×${nh} file drawn ${Math.round(r.width)}×${Math.round(r.height)} (${where(r)})`);
    }

    // every element once: what sticks out, cut text, small boxes off their middle, emojis, tiny text, the content's span
    const all = document.body ? document.body.getElementsByTagName('*') : [];
    const out1 = [];
    const scrolls = (el) => { for (let p = el.parentElement; p && p !== document.body && p !== root; p = p.parentElement) { const o = getComputedStyle(p).overflowX; if (o !== 'visible') return true; } return false; };
    // drawn as a coloured emoji: by itself, or a symbol asked to (U+FE0F); an arrow or a sign drawn as text is no emoji
    const EMOJI = /\p{Emoji_Presentation}|\p{Extended_Pictographic}️/u;
    const BOXY = /(^|[\s_-])(btn|button|badge|chip|tag|pill)([\s_-]|$)/i;
    let left = Infinity;
    let right = -Infinity;
    const texts = [];
    for (let i = 0; i < all.length && i < 8000; i++) {
      const el = all[i];
      if (ours(el) || el.tagName === 'SCRIPT' || el.tagName === 'STYLE' || el.tagName === 'NOSCRIPT') continue;
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      const cs = getComputedStyle(el);
      if (hidden(el, cs)) continue;
      if (out.sideways && r.right > W + 1 && cs.position !== 'fixed' && !out1.some((s) => s.contains(el)) && !scrolls(el)) {
        out1.push(el);
        add(out.sticking, `${name(el)} reaches ${Math.round(r.right)} px (${where(r)})`);
      }
      const own = ownText(el);
      if (own) {
        texts.push(el);
        const size = parseFloat(cs.fontSize) || 16;
        if (W < 600 && size < 12) { out.tinyCount++; if (out.tiny.length < 3) out.tiny.push(`"${words(el.textContent, 30)}" (${Math.round(size)} px)`); }
        if (r.width < W * 0.98) { left = Math.min(left, r.left); right = Math.max(right, r.right); }
        // cut: a box that hides what does not fit (one that scrolls means to)
        const sideways = (clipped(cs.overflowX) || cs.textOverflow === 'ellipsis') && el.scrollWidth > el.clientWidth + 1;
        const clamped = cs.webkitLineClamp && cs.webkitLineClamp !== 'none' && el.scrollHeight > el.clientHeight + 1;
        const below = clipped(cs.overflowY) && el.scrollHeight > el.clientHeight + 2 && el.clientHeight > 0;
        if (sideways || clamped || below) add(out.cut, `${name(el)}: ${clamped ? `cut after ${cs.webkitLineClamp} lines` : sideways ? `cut at its right edge${cs.textOverflow === 'ellipsis' ? ' with …' : ''}` : 'cut at its bottom'} (${where(r)})`);
        const tag = el.tagName;
        if ((tag === 'BUTTON' || tag === 'A' || tag === 'LI' || tag === 'LABEL' || /^H[1-6]$/.test(tag) || el.closest('nav, button, [role=button], [role=tab], [role=menuitem]')) && EMOJI.test(el.textContent)) {
          add(out.emoji, `${(EMOJI.exec(el.textContent) || [''])[0]} in ${name(el)} (${where(r)})`);
        }
        const centres = cs.textAlign === 'center' || (/flex|grid/.test(cs.display) && /center/.test(cs.justifyContent) && /center/.test(cs.alignItems));
        const small = r.width < 480 && r.height < 90;
        if (centres && small && (tag === 'BUTTON' || el.getAttribute('role') === 'button' || BOXY.test(typeof el.className === 'string' ? el.className : '') || (tag === 'A' && cs.display !== 'inline'))) {
          const range = document.createRange();
          range.selectNodeContents(el);
          const t = range.getBoundingClientRect();
          const px = (v) => parseFloat(v) || 0;
          const boxX = r.left + px(cs.borderLeftWidth) + px(cs.paddingLeft);
          const boxW = r.width - px(cs.borderLeftWidth) - px(cs.borderRightWidth) - px(cs.paddingLeft) - px(cs.paddingRight);
          const boxY = r.top + px(cs.borderTopWidth) + px(cs.paddingTop);
          const boxH = r.height - px(cs.borderTopWidth) - px(cs.borderBottomWidth) - px(cs.paddingTop) - px(cs.paddingBottom);
          const dx = Math.round((t.left + t.width / 2) - (boxX + boxW / 2));
          const dy = Math.round((t.top + t.height / 2) - (boxY + boxH / 2));
          if (t.width && (Math.abs(dx) >= 2 || Math.abs(dy) >= 3)) {
            add(out.offCentre, `${name(el)}: its text sits ${[Math.abs(dx) >= 2 ? `${Math.abs(dx)} px ${dx > 0 ? 'right' : 'left'}` : '', Math.abs(dy) >= 3 ? `${Math.abs(dy)} px ${dy > 0 ? 'low' : 'high'}` : ''].filter(Boolean).join(' and ')} of the middle (${where(r)})`);
          }
        }
      } else if (el.tagName === 'IMG' || el.tagName === 'svg' || el.tagName === 'VIDEO' || el.tagName === 'CANVAS') {
        if (r.width < W * 0.98) { left = Math.min(left, r.left); right = Math.max(right, r.right); }
      }
    }

    // text over text: the boxes of the words of two different elements cross by more than a fifth of the smaller one
    const boxes = [];
    for (const el of texts) {
      if (boxes.length >= 1200) break;
      const range = document.createRange();
      for (const n of el.childNodes) {
        if (n.nodeType !== 3 || !n.nodeValue.trim()) continue;
        range.selectNodeContents(n);
        const b = range.getBoundingClientRect();
        if (b.width > 1 && b.height > 1) boxes.push({ el, b });
      }
    }
    for (let i = 0; i < boxes.length && out.over.length < MAX; i++) {
      const a = boxes[i];
      for (let j = i + 1; j < boxes.length; j++) {
        const c = boxes[j];
        if (a.el === c.el || a.el.contains(c.el) || c.el.contains(a.el)) continue;
        const w = Math.min(a.b.right, c.b.right) - Math.max(a.b.left, c.b.left);
        const h = Math.min(a.b.bottom, c.b.bottom) - Math.max(a.b.top, c.b.top);
        if (w <= 2 || h <= 2) continue;
        if (w * h > 0.2 * Math.min(a.b.width * a.b.height, c.b.width * c.b.height)) {
          add(out.over, `"${words(a.el.textContent, 30)}" and "${words(c.el.textContent, 30)}" (${where(a.b)})`);
          break;
        }
      }
    }

    try { for (const f of document.fonts) if (f.status === 'error' && !out.fonts.includes(f.family)) add(out.fonts, f.family.replace(/^["']|["']$/g, '')); } catch { /* no font list */ }
    if (left < right) out.span = { left: Math.max(0, Math.round(left)), right: Math.round(W - Math.min(W, right)) };
    return out;
  }

  /** Waits until the page stops changing for a moment (or `ms` has gone by). Timers are not slowed in these pages. */
  function settle(ms = 1500, quiet = 180) {
    return new Promise((done) => {
      let timer = 0;
      const end = () => { observer.disconnect(); clearTimeout(timer); clearTimeout(cap); done(true); };
      const observer = new MutationObserver(() => { clearTimeout(timer); timer = setTimeout(end, quiet); });
      observer.observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true });
      timer = setTimeout(end, quiet);
      const cap = setTimeout(end, ms);
    });
  }

  const hasText = (t) => ((document.body && document.body.innerText) || '').includes(String(t));

  return { outline, point, act, scroll, ring, settle, hasText, describe, formPreview, faults };
}

module.exports = { LOOK: `(${look.toString()})()` };
