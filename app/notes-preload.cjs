'use strict';
const { contextBridge, ipcRenderer } = require('electron');

// The notes' only ways out (main.cjs): how tall they are, a card closed or opened by its id, all of them closed.
contextBridge.exposeInMainWorld('notes', {
  onModel: (fn) => ipcRenderer.on('notes:model', (_event, list, how) => fn(list, how)),
  size: (height) => ipcRenderer.send('notes:size', height),
  close: (id) => ipcRenderer.send('notes:close', String(id).slice(0, 20)),
  open: (id) => ipcRenderer.send('notes:open', String(id).slice(0, 20)),
  clear: () => ipcRenderer.send('notes:clear'),
});
