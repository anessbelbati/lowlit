'use strict';
const { contextBridge, ipcRenderer } = require('electron');

// The floating card's only ways out (main.cjs): how tall it is, a chat to bring up in the window, and its own switches.
contextBridge.exposeInMainWorld('card', {
  onModel: (fn) => ipcRenderer.on('float:model', (_event, model, how) => fn(model, how)),
  size: (height) => ipcRenderer.send('float:size', height),
  // a chat of the window by its id, or 'row:' and a session elsewhere
  go: (target) => ipcRenderer.send('float:go', String(target).slice(0, 80)),
  // { on, small, overDesk }
  set: (patch) => ipcRenderer.send('float:set', patch),
});
