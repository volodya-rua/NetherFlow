// NetherFlow - Copyright (C) 2026 Volodya.rua - GNU GPL v3 only, with additional terms (credit, name and logo): see LICENSE and NOTICE.
// The island's window (see main.js, island.html): what's playing comes in; what's pressed on it, and the shape of the
// island (the rest of its window isn't there for the mouse: clicks go through to whatever's under it), go out.
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('islandApp', {
  onState: cb => ipcRenderer.on('island-state', (_, s) => cb(s)),
  cmd: (c, v) => ipcRenderer.send('island-cmd', c, v),
  shape: r => ipcRenderer.send('island-shape', r),
  onVisible: cb => ipcRenderer.on('island-visible', (_, on) => cb(!!on)), // (the island there, or away)
});
