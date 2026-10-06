'use strict';
/* global desk, h, fill, icon, menuUnder, folderOf, leftShort, bytes, selectionIn, sync, clockShort, toast */
// The servers page: the dev servers and dashboards the person pins, what each one is doing, and the ones that run on
// this machine without being pinned. The main process starts and stops them and says what runs (servers.cjs); this
// page shows what it is told and asks for what is clicked. A row is built again only when what it says changes: the
// figures that move (how long it has run, its memory) are written in place.

const Servers = (() => {
  const OUT_MS = 2000;
  let root = null;
  let els = null;
  let act = null;
  let view = { at: 0, ready: false, servers: [], loose: [], hidden: 0 };
  let shown = false;
  let form = null;                 // the form being filled in: { id ('' for a new one), el, f }
  const rows = new Map();          // row key -> { el, stamp, figs, s, loose }
  const outs = new Map();          // server id -> { el, pre, size } while what it printed is shown
  const busy = new Set();          // rows with a request out: their buttons wait for the answer
  let outTimer = 0;

  const live = (s) => s.state === 'running' || s.state === 'starting' || s.state === 'elsewhere';
  const urlOf = (s) => s.url || s.seen || (s.ports && s.ports.length ? `http://localhost:${s.ports[0]}/` : '');
  const addressText = (url) => String(url || '').replace(/^https?:\/\//, '').replace(/\/$/, '');
  const portsText = (ports) => (ports.length > 1 ? `ports ${ports.join(', ')}` : `port ${ports[0]}`);

  function init(el, actions) {
    root = el;
    act = actions;
    els = {
      add: h('button', { class: 'btn sm', onclick: () => openForm(null) }, icon('plus', 14), h('span', { text: 'Add a server' })),
      form: h('div', { class: 'srv-form', hidden: true }),
      pinned: h('div', { class: 'srv-list', role: 'list', 'aria-label': 'Pinned servers' }),
      pinnedNote: h('span', { class: 'note' }),
      pinnedEmpty: h('p', { class: 'quiet srv-empty', text: 'Nothing pinned yet. Pin one of the servers running below, or add one: the folder it runs in and the command that starts it.' }),
      loose: h('div', { class: 'srv-list', role: 'list', 'aria-label': 'Servers running that are not pinned' }),
      looseNote: h('span', { class: 'note' }),
      looseEmpty: h('p', { class: 'quiet srv-empty' }),
      unhide: h('button', { class: 'btn sm ghost srv-unhide', hidden: true, onclick: () => ask('hide', '*', false) }),
    };
    root.append(h('div', { class: 'd-wrap wide srv-wrap' },
      h('div', { class: 'page-head' },
        h('div', { class: 'srv-title' }, h('h1', { class: 'd-title', text: 'Servers' }),
          h('p', { class: 'quiet srv-lede', text: 'The dev servers and dashboards of your projects. Start and stop them from here: they keep running when Lowlit closes.' })),
        els.add),
      els.form,
      h('section', { class: 'sec srv-section' }, h('div', { class: 'sec-head' }, h('h2', { text: 'Pinned' }), els.pinnedNote), els.pinned, els.pinnedEmpty),
      h('section', { class: 'sec srv-section' }, h('div', { class: 'sec-head' }, h('h2', { text: 'Running now, not pinned' }), els.looseNote, els.unhide), els.loose, els.looseEmpty)));
    desk.onServers((v) => { if (v) take(v); });
    desk.servers('view').then((v) => { if (v) take(v); });
  }

  function take(v) {
    view = v;
    if (shown) draw();
    act.changed();
  }

  /** The page comes into sight, or leaves it: while it is in sight the main process looks every 3 s instead of 20. */
  function show(on) {
    if (on === shown) return;
    shown = on;
    desk.servers('watch', on).then((v) => { if (v) take(v); });
    if (on) { draw(); pollOutput(); } else clearTimeout(outTimer);
  }

  function draw() {
    if (!root || selectionIn(root)) return;
    const pinned = view.servers || [];
    const loose = view.loose || [];
    const running = pinned.filter(live).length;
    els.pinnedNote.textContent = pinned.length ? `${running} of ${pinned.length} running` : '';
    els.pinnedEmpty.hidden = pinned.length > 0;
    sync(els.pinned, pinned.map((s) => row(`pin:${s.id}`, s, pinnedRow)));
    els.looseNote.textContent = loose.length ? String(loose.length) : '';
    els.looseEmpty.hidden = loose.length > 0;
    els.looseEmpty.textContent = !view.ready ? 'Looking at what runs on this machine…' : view.hidden ? 'None, besides the ones you hid.' : 'No other dev server runs on this machine.';
    sync(els.loose, loose.map((s) => row(`loose:${s.key}`, s, looseRow)));
    els.unhide.hidden = !view.hidden;
    els.unhide.textContent = view.hidden === 1 ? 'Show the one you hid' : `Show the ${view.hidden} you hid`;
    const keys = new Set([...pinned.map((s) => `pin:${s.id}`), ...loose.map((s) => `loose:${s.key}`)]);
    for (const key of rows.keys()) if (!keys.has(key)) rows.delete(key);
    for (const id of outs.keys()) if (!pinned.some((s) => s.id === id)) outs.delete(id);
    tick();
  }

  function row(key, s, build) {
    const { mem, since, at, ...fixed } = s;
    const stamp = JSON.stringify([fixed, busy.has(key), outs.has(s.id)]);
    let r = rows.get(key);
    if (!r || r.stamp !== stamp) {
      r = { ...build(s, key), stamp, loose: build === looseRow };
      rows.set(key, r);
      // what it printed was moved into the new row: it is shown from its end again
      const out = outs.get(s.id);
      if (out && build === pinnedRow) requestAnimationFrame(() => { out.pre.scrollTop = out.pre.scrollHeight; });
    }
    r.s = s;
    return r.el;
  }

  function button(label, name, run, { wait = false, primary = false, tip = '' } = {}) {
    return h('button', { class: `btn sm${primary ? ' primary' : ''}`, disabled: wait || undefined, tip, onclick: run }, name && icon(name, 13), h('span', { text: label }));
  }

  /** What the row says of where it is: running, how it got there, or why it stopped. */
  function stateWords(s) {
    if (s.state === 'running' || s.state === 'starting') return [s.state === 'running' ? 'Running' : 'Starting', s.label].filter(Boolean).join(' · ');
    if (s.state === 'elsewhere') return `Running, started outside Lowlit${s.holder ? ` by ${s.holder.name}` : ''}`;
    if (s.state === 'blocked') return `${s.ports.length > 1 ? `Ports ${s.ports.join(', ')} are` : `Port ${s.ports[0]} is`} taken by ${s.holder.name}${s.holder.folder ? ` in ${folderOf(s.holder.folder)}` : ''}`;
    if (s.state === 'failed') return `Stopped on its own at ${clockShort(s.exit.at)}, with an error`;
    if (s.state === 'checking') return 'Checking';
    return 'Stopped';
  }

  function pinnedRow(s, key) {
    const url = urlOf(s);
    const wait = busy.has(key);
    const acts = [];
    if (s.state === 'stopped' || s.state === 'failed') acts.push(button('Start', 'play', () => ask('start', s.id, null, key), { wait, primary: true }));
    if (s.state === 'running' || s.state === 'starting') {
      acts.push(button('Restart', 'refresh', () => ask('restart', s.id, null, key), { wait }), button('Stop', 'x', () => ask('stop', s.id, null, key), { wait }));
    }
    if (s.state === 'elsewhere') {
      acts.push(button('Stop…', 'x', () => ask('stop', s.id, s.holder, key), { wait, tip: 'Lowlit did not start it: before it stops it, it says which program that is.' }));
    }
    if (s.state === 'blocked') acts.push(button('Stop what holds it…', 'x', () => ask('stop', s.id, s.holder, key), { wait }));
    if (s.state === 'failed' && !outs.has(s.id)) acts.push(button('What it printed', 'list', () => toggleOut(s.id)));
    const more = h('button', { class: 'icon-btn', 'aria-label': `More for ${s.name}`, onclick: () => menuUnder(more, [
      { label: outs.has(s.id) ? 'Hide what it printed' : 'What it printed', icon: 'list', run: () => toggleOut(s.id) },
      { label: 'Edit…', icon: 'pencil', run: () => openForm(s) },
      { label: 'Open its folder', icon: 'folder', run: () => desk.openFolder(s.folder) },
      url ? { label: 'Copy its address', icon: 'copy', run: () => { desk.writeClipboard(url); toast('Address copied.'); } } : false,
      null,
      { label: live(s) && s.state !== 'elsewhere' ? 'Unpin (it keeps running)' : 'Unpin', icon: 'x', danger: true, run: () => ask('remove', s.id, null, key) },
    ].filter((x) => x !== false)) }, icon('more', 15));
    const figs = h('span', { class: 'srv-figs' });
    const out = outs.get(s.id);
    const el = h('div', { class: `srv-row s-${s.state}`, role: 'listitem', data: { id: s.id, state: s.state } },
      h('div', { class: 'srv-main' },
        h('span', { class: `srv-dot s-${s.state}`, 'aria-hidden': 'true' }),
        h('div', { class: 'srv-text' },
          h('div', { class: 'srv-line' },
            h('span', { class: 'srv-name', text: s.name }),
            url && (live(s)
              ? h('button', { class: 'srv-addr', text: addressText(url), tip: `Open ${url} in your browser`, onclick: () => desk.openUrl(url) })
              : h('span', { class: 'srv-addr off', text: addressText(url) })),
            h('span', { class: 'srv-state', text: stateWords(s) }),
            figs),
          h('div', { class: 'srv-line sub' },
            h('span', { class: 'srv-folder', text: s.folder, tip: s.folder }),
            h('code', { class: 'srv-cmd', text: s.command }),
            s.by === 'claude' && h('span', { class: 'srv-by', text: 'pinned by Claude Code' }))),
        h('div', { class: 'srv-acts' }, ...acts, more)),
      out && out.el);
    return { el, figs };
  }

  function looseRow(s, key) {
    const url = s.ports.length ? `http://localhost:${s.ports[0]}/` : '';
    const name = folderOf(s.folder) || s.label || s.name;
    const wait = busy.has(key);
    const kind = [s.label && s.label !== name ? s.label : s.name, s.via && s.via !== s.label ? s.via : ''].filter(Boolean).join(' · ');
    const figs = h('span', { class: 'srv-figs' });
    const el = h('div', { class: 'srv-row loose', role: 'listitem', data: { key: s.key } },
      h('div', { class: 'srv-main' },
        h('span', { class: 'srv-dot s-running', 'aria-hidden': 'true' }),
        h('div', { class: 'srv-text' },
          h('div', { class: 'srv-line' },
            h('span', { class: 'srv-name', text: name }),
            url && h('button', { class: 'srv-addr', text: addressText(url), tip: `Open ${url} in your browser${s.ports.length > 1 ? `. It listens on ${portsText(s.ports)}.` : ''}`, onclick: () => desk.openUrl(url) }),
            h('span', { class: 'srv-state', text: kind }),
            figs),
          h('div', { class: 'srv-line sub' }, h('span', { class: 'srv-folder', text: s.folder || 'Its folder could not be read', tip: s.folder }))),
        h('div', { class: 'srv-acts' },
          button('Pin', 'pin', () => pinLoose(s), { wait, tip: 'Keep it on the list above, to start and stop it from here' }),
          button('Stop…', 'x', () => ask('stop-loose', s.key, { pid: s.pid, started: s.started }, key), { wait, tip: 'Lowlit did not start it: before it stops it, it says which program that is.' }),
          h('button', { class: 'btn sm ghost', disabled: wait || undefined, tip: 'Not one of yours: it is not shown here any more', onclick: () => ask('hide', s.key, true, key) }, h('span', { text: 'Hide' })))));
    return { el, figs };
  }

  /** How long each server has run and what it holds, written in place every second. */
  function tick() {
    if (!shown) return;
    const now = Date.now();
    for (const r of rows.values()) {
      const s = r.s;
      if (!s || !r.figs) continue;
      const text = (r.loose || live(s)) && s.since ? [`up ${leftShort(now - s.since)}`, s.mem ? bytes(s.mem) : ''].filter(Boolean).join(' · ') : '';
      if (r.figs.textContent !== text) r.figs.textContent = text;
    }
  }

  async function ask(what, a, b, key) {
    if (key) { busy.add(key); draw(); }
    let res = null;
    try { res = await desk.servers(what, a, b); } catch { res = { error: 'Lowlit did not answer.' }; } finally { if (key) busy.delete(key); }
    if (res && res.error) toast(res.error, 6000);
    const v = await desk.servers('view');
    if (v) take(v); else draw();
    return res;
  }

  // ---- what a server printed, under its row: read again every 2 s while it is shown ----
  function toggleOut(id) {
    if (outs.has(id)) outs.delete(id);
    else {
      const pre = h('pre', { class: 'srv-pre', tabindex: '0', 'aria-label': 'What it printed' });
      outs.set(id, { el: h('div', { class: 'srv-out' }, pre), pre, size: -1 });
    }
    draw();
    pollOutput();
  }

  async function pollOutput() {
    clearTimeout(outTimer);
    if (!shown || !outs.size) return;
    for (const [id, o] of [...outs]) {
      const res = await desk.servers('output', id);
      if (!res || outs.get(id) !== o || res.size === o.size || selectionIn(o.pre)) continue;
      const bottom = o.size < 0 || o.pre.scrollHeight - o.pre.scrollTop - o.pre.clientHeight < 24;
      o.size = res.size;
      o.pre.textContent = res.text || 'Nothing printed yet.';
      if (bottom) o.pre.scrollTop = o.pre.scrollHeight;
    }
    if (shown && outs.size) outTimer = setTimeout(pollOutput, OUT_MS);
  }

  // ---- the form: a server to add, one to change, or one that runs to pin ----
  async function pinLoose(s) {
    const guess = await desk.servers('guess', s.key);
    if (!guess) { toast('It is not running any more.'); return; }
    openForm(null, guess);
  }

  function openForm(s, guess) {
    const v = s || guess || {};
    const input = (id, value, placeholder, extra = {}) => h('input', { id, class: `input${extra.mono ? ' mono' : ''}`, type: 'text', spellcheck: 'false', autocomplete: 'off', maxlength: extra.max || '260', value: value || '', placeholder });
    const f = {
      name: input('srv-f-name', v.name, 'Chess dashboard', { max: '40' }),
      folder: input('srv-f-folder', v.folder, 'D:\\projects\\my-app'),
      command: input('srv-f-command', v.command, 'npm run dev', { mono: true, max: '1000' }),
      url: input('srv-f-url', v.url, 'localhost:5173, or leave it empty: Lowlit finds it once it runs', { max: '400' }),
      scripts: h('div', { class: 'srv-scripts' }),
      error: h('p', { class: 'srv-form-error', role: 'alert', hidden: true }),
    };
    const field = (label, id, ...kids) => h('div', { class: 'field' }, h('label', { for: id, text: label }), ...kids);
    const el = h('form', { class: 'srv-form-inner', 'aria-label': s ? `Edit ${s.name}` : 'A server to pin', onsubmit: (e) => { e.preventDefault(); submit(); } },
      h('h2', { text: s ? `Edit ${s.name}` : guess ? 'Pin this server' : 'Add a server' }),
      guess && !guess.command && h('p', { class: 'quiet srv-form-note', text: `Lowlit could not tell which command started it: type the one you use in that folder${guess.scripts && guess.scripts.length ? ', or pick one of its scripts' : ''}.` }),
      h('div', { class: 'srv-grid' },
        field('Name', 'srv-f-name', f.name),
        field('Folder', 'srv-f-folder', h('div', { class: 'srv-folder-pick' }, f.folder,
          h('button', { class: 'btn sm', type: 'button', onclick: pickFolder }, icon('folder', 13), h('span', { text: 'Choose…' })))),
        field('Command that starts it', 'srv-f-command', f.command, f.scripts),
        field('Address (optional)', 'srv-f-url', f.url)),
      f.error,
      h('div', { class: 'srv-form-acts' },
        h('button', { class: 'btn sm primary', type: 'submit' }, h('span', { text: s ? 'Save' : 'Pin it' })),
        h('button', { class: 'btn sm ghost', type: 'button', onclick: closeForm }, h('span', { text: 'Cancel' }))));
    el.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeForm(); } });
    f.folder.addEventListener('change', () => scriptsFor(f.folder.value));
    form = { id: s ? s.id : '', el, f };
    fill(els.form, el);
    els.form.hidden = false;
    scriptsFor(f.folder.value, guess && guess.scripts);
    const first = [f.name, f.folder, f.command].find((x) => !x.value.trim()) || (s ? f.name : f.url);
    first.focus();
  }

  function closeForm() {
    form = null;
    els.form.hidden = true;
    fill(els.form);
  }

  async function scriptsFor(folder, given) {
    const list = given || (folder.trim() ? await desk.servers('scripts', folder.trim()) : []);
    if (!form) return;
    const runs = (list || []).map((x) => (typeof x === 'string' ? x : x.run)).filter(Boolean).slice(0, 8);
    fill(form.f.scripts, runs.map((run) => h('button', { class: 'chip srv-chip', type: 'button', text: run, onclick: () => { form.f.command.value = run; form.f.command.focus(); } })));
  }

  async function pickFolder() {
    const dir = await desk.servers('pick-folder');
    if (!dir || !form) return;
    form.f.folder.value = dir;
    if (!form.f.name.value.trim()) form.f.name.value = folderOf(dir);
    scriptsFor(dir);
  }

  async function submit() {
    if (!form) return;
    const { id, f } = form;
    const s = { name: f.name.value, folder: f.folder.value, command: f.command.value, url: f.url.value };
    const res = id ? await desk.servers('update', id, s) : await desk.servers('add', s);
    if (!form || form.f !== f) return;
    if (!res || res.error) {
      f.error.textContent = (res && res.error) || 'It could not be saved.';
      f.error.hidden = false;
      return;
    }
    closeForm();
    toast(res.already ? 'It was pinned already.' : id ? 'Saved.' : `${s.name.trim()} is pinned.`);
    const v = await desk.servers('view');
    if (v) take(v);
  }

  /** For the line in the sidebar: how many pinned servers run, and how many stopped with an error or cannot start. */
  function summary() {
    const list = view.servers || [];
    return { pinned: list.length, running: list.filter(live).map((s) => s.name), wrong: list.filter((s) => s.state === 'failed' || s.state === 'blocked').map((s) => s.name) };
  }

  return { init, show, render: () => { if (shown) draw(); }, tick, summary, view: () => view, isForm: () => Boolean(form) };
})();
