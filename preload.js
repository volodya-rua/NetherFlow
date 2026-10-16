// NetherFlow - Copyright (C) 2026 Volodya.rua - GNU GPL v3 only, with additional terms (credit, name and logo): see LICENSE and NOTICE.
// Gives the page its window buttons (it draws its own; the native ones don't match the look).
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('netherflowApp', {
  lite: process.argv.includes('--nf-lite'), // NetherFlow Lite: no Extreme+ (see main.js)
  portMoved: process.argv.includes('--nf-port-moved'), // its usual port was taken: the library and settings kept there aren't here (see main.js)
  country: (process.argv.find(a => a.startsWith('--nf-country=')) || '').slice(13), // Windows' own region (its language often has none, or another country's)
  win: action => ipcRenderer.send('win', action), // 'min' | 'max' | 'close'
  onMaximized: cb => ipcRenderer.on('maximized', (_, on) => cb(on)),
  awake: on => ipcRenderer.send('awake', !!on), // keep the screen on (while a song plays)
  onShown: cb => ipcRenderer.on('shown', (_, on) => cb(on)), // where the window is: 2 in front, 1 behind another app, 0 minimized / hidden
  // the island (see main.js): what's playing, ~30 times a second (null: nothing), and what's pressed on it. Windows only:
  // with neither, the page shows no island settings
  ...(process.platform === 'win32' ? {
    island: state => ipcRenderer.send('island-state', state),
    onIsland: cb => ipcRenderer.on('island-cmd', (_, cmd, v) => cb(cmd, v)),
  } : {}),
  // Discord "Now playing" (see main.js): the song as it plays ({ title, artist, album, art, start, end, url }), or null
  presence: w => ipcRenderer.send('presence', w),
  // phone ↔ PC sync (see main.js): open the local server → { port, addrs, name }; what a phone sends (encrypted) comes in
  // by onSyncIn(id, data) and the page answers with syncOut(id, { data } | { error }); id '' = it closed by itself
  syncOpen: () => ipcRenderer.invoke('sync-open'),
  syncClose: () => ipcRenderer.send('sync-close'),
  onSyncIn: cb => ipcRenderer.on('sync-in', (_, id, data) => cb(id, data)),
  syncOut: (id, reply) => ipcRenderer.send('sync-out', id, reply),
  // updates (see main.js): updateCheck → { version, can (false: the portable app), next (a newer version) | error };
  // updateGet downloads it (onUpdateProgress: 0…1), updateInstall restarts into it
  updateCheck: () => ipcRenderer.invoke('update-check'),
  updateGet: () => ipcRenderer.invoke('update-get'),
  onUpdateProgress: cb => ipcRenderer.on('update-progress', (_, f) => cb(f)),
  updateInstall: () => ipcRenderer.send('update-install'),
});
