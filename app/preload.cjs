'use strict';
const { contextBridge, ipcRenderer, webUtils } = require('electron');

const on = (channel) => (fn) => ipcRenderer.on(channel, (_event, ...args) => fn(...args));

contextBridge.exposeInMainWorld('desk', {
  info: () => ipcRenderer.invoke('desk:info'),
  // what a chat's console printed lately, for a page that has just started; and that page loaded again
  tail: (id) => ipcRenderer.invoke('desk:tail', id),
  reload: () => ipcRenderer.invoke('desk:reload'),
  restart: () => ipcRenderer.invoke('desk:restart'),
  create: (ask) => ipcRenderer.invoke('desk:create', ask),
  close: (id) => ipcRenderer.invoke('desk:close', id),
  unclose: (id) => ipcRenderer.invoke('desk:unclose', id),
  repository: (cwd) => ipcRenderer.invoke('desk:repository', cwd),
  git: (id) => ipcRenderer.invoke('desk:git', id),
  gitSwitch: (id, name) => ipcRenderer.invoke('desk:git-switch', id, name),
  rename: (id, title) => ipcRenderer.send('desk:rename', id, title),
  input: (id, data) => ipcRenderer.send('desk:input', id, data),
  // a slow moment of the window (held up, a terminal's graphics context lost): a line in the app's log
  slow: (what) => ipcRenderer.send('desk:slow', String(what).slice(0, 400)),
  // a line in the app's log of a kind main knows: how typing went (once an hour), a change of the window's scaling
  note: (kind, what) => ipcRenderer.send('desk:note', String(kind).slice(0, 20), String(what).slice(0, 400)),
  // drawn again by hand (F5, the palette): main repaints the window and notes when
  redraw: () => ipcRenderer.send('desk:redraw'),
  resize: (id, cols, rows) => ipcRenderer.send('desk:resize', id, { cols, rows }),
  pickFolder: () => ipcRenderer.invoke('desk:pick-folder'),
  recent: () => ipcRenderer.invoke('desk:recent'),
  usage: (range) => ipcRenderer.invoke('desk:usage', range),
  typed: (query) => ipcRenderer.invoke('desk:typed', query),
  find: (q) => ipcRenderer.invoke('desk:find', q),
  findSorted: (q) => ipcRenderer.invoke('desk:find-sort', q),
  // Jev: 'view', ('on', true|false), ('key', text); the key is never given back
  jev: (what, value) => ipcRenderer.invoke('desk:jev', what, value),
  read: (ask) => ipcRenderer.invoke('desk:read', ask),
  history: () => ipcRenderer.invoke('desk:history'),
  record: (ask) => ipcRenderer.invoke('desk:record', ask),
  // the servers page: ('view'), ('watch', on), ('start', id), ('stop', id, holder), ('add', server) and the rest (main.cjs)
  servers: (what, a, b) => ipcRenderer.invoke('desk:servers', what, a, b),
  // the shift clock: ('view'), ('day', working day), ('week'), ('start', hours), ('length', hours), ('add', minutes), ('end') (work.cjs)
  work: (what, value) => ipcRenderer.invoke('desk:work', what, value),
  refresh: () => ipcRenderer.invoke('desk:refresh'),
  showFile: (key, agent) => ipcRenderer.invoke('desk:show-file', key, agent),
  forget: (session) => ipcRenderer.send('desk:forget', session),
  previousDone: () => ipcRenderer.send('desk:previous-done'),
  settings: (patch) => ipcRenderer.invoke('desk:settings', patch),
  shortcut: (kind, on) => ipcRenderer.invoke('desk:shortcut', kind, on),
  readClipboard: () => ipcRenderer.invoke('desk:clip-read'),
  writeClipboard: (text) => ipcRenderer.send('desk:clip-write', text),
  openUrl: (url) => ipcRenderer.send('desk:open-url', url),
  openFolder: (dir) => ipcRenderer.send('desk:open-folder', dir),
  pathsExist: (id, files) => ipcRenderer.invoke('desk:paths-exist', id, files),
  openFile: (id, file, line, column) => ipcRenderer.invoke('desk:open-file', id, file, line, column),
  badge: (image, text, n) => ipcRenderer.send('desk:badge', image, text, n),
  watchAgain: () => ipcRenderer.send('desk:watch-again'),
  // where a file dropped onto the window lives on disk
  pathOf: (file) => { try { return webUtils.getPathForFile(file); } catch { return ''; } },
  quit: () => ipcRenderer.send('desk:quit'),
  gaming: () => ipcRenderer.send('desk:gaming'),
  leave: (how, remember) => ipcRenderer.send('desk:leave', how, remember),
  front: (id) => ipcRenderer.send('desk:front', id),
  // the Nest closed; byKey: with its key, so a window the key brought up goes back to how it was
  nestLeft: (byKey) => ipcRenderer.send('desk:nest-left', byKey === true),
  // what the floating card shows (main.cjs, float.js): sent only while it is switched on, and only when it changed
  float: (model) => ipcRenderer.send('desk:float', model),
  // The Browser. ask: ('view'), ('still', tab), ('open', address, home: whose browser it opens in), ('go', tab, address), ('back' | 'forward' | 'reload' |
  // 'stop' | 'close' | 'external' | 'focus', tab), ('pause', tab, on), ('forget'). place: where its page area is, and
  // whether the page shows there. onView: what pages there are. onDo: what main asks of the panel.
  viewer: {
    ask: (what, a, b) => ipcRenderer.invoke('desk:viewer', what, a, b),
    reply: (id, result) => ipcRenderer.send('desk:viewer-reply', id, result),
    onView: on('desk:viewer'),
    onAsk: on('desk:viewer-ask'),
  },
  browser: {
    ask: (what, a, b) => ipcRenderer.invoke('desk:browser', what, a, b),
    place: (p) => ipcRenderer.send('desk:browser-place', p),
    onView: on('desk:browser'),
    onDo: on('desk:browser-do'),
  },
  onOutput: on('desk:output'),
  onExit: on('desk:exit'),
  onChats: on('desk:chats'),
  onSnapshot: on('desk:snapshot'),
  onRes: on('desk:res'),
  onCommand: on('desk:command'),
  onVersion: on('desk:version'),
  onFindProgress: on('desk:find-progress'),
  onJev: on('desk:jev'),
  onServers: on('desk:servers'),
  onWork: on('desk:work'),
});
