// NetherFlow - Copyright (C) 2026 Volodya.rua - GNU GPL v3 only, with additional terms (credit, name and logo): see LICENSE and NOTICE.
// NetherFlow desktop app: a window around the player page, served by the built-in server
// (which also hands the page FlowStream's streams, from its own address, so the equalizer and visuals can hear them).
const { app, BrowserWindow, shell, ipcMain, powerSaveBlocker, screen, powerMonitor } = require('electron');
const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');
const srvMod = require('./server'), { start } = srvMod;

const PORT = 41739; // fixed, so settings saved by the page (lyric sync per song) survive restarts
const LITE = !!require('./package.json').lite; // (NetherFlow Lite: built by tools/lite-build.js, without Extreme+)
// The person's country, for the music store the page searches: Windows' "Country or region" (Settings › Time & language
// › Region). The language's own region is often another (English (United States) in India), and Electron reads that one.
let COUNTRY = '';
try { if (process.platform === 'win32') COUNTRY = execFileSync('reg', ['query', String.raw`HKCU\Control Panel\International\Geo`, '/v', 'Name'], { encoding: 'utf8', timeout: 2000, windowsHide: true }).match(/Name\s+REG_SZ\s+([A-Z]{2})\b/)?.[1] || ''; } catch {}

// Songs start right after a search finishes, which isn't a click as far as Chromium is concerned.
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

let win;
// (a second launch: the first one comes forward instead — and this one sets nothing up while it quits)
const first = app.requestSingleInstanceLock();
if (!first) app.quit();
app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
app.on('window-all-closed', () => app.quit());

// The page's own minimize / maximize / close buttons.
ipcMain.on('win', (e, action) => {
  if (!win || e.sender !== win.webContents) return;
  if (action === 'min') win.minimize();
  else if (action === 'max') win.isMaximized() ? win.unmaximize() : win.maximize();
  else if (action === 'close') win.close();
});

// The screen stays on while a song plays and the window is shown (the page asks, and lets go when it stops).
let awake = null;
ipcMain.on('awake', (e, on) => {
  if (!win || e.sender !== win.webContents) return;
  if (on && awake === null) awake = powerSaveBlocker.start('prevent-display-sleep');
  else if (!on && awake !== null) { powerSaveBlocker.stop(awake); awake = null; }
});

srvMod.heads = path.join(app.getPath('userData'), 'heads'); // (the starts of the last songs played, so they start at once: server.js)

// ---------- the island: what's playing, in a small black island at the top middle of the screen, over every other app
// (always on top, at the screen-saver level, on every desktop, never taking the focus). The page (preload.js) sends
// what's playing ~30 times a second; the island (island.html) sends back what's pressed. Shown while a song's loaded and
// NetherFlow itself isn't in front (there the page shows all of it, and the island would cover its header) — the island
// coming and going within its window, which itself stays shown (a window hidden and shown again can stop repainting:
// it'd take a click but never be seen to open). Its window is
// bigger than the island, room for it to open out, but shaped to the island (setShape, sent by the island as it opens
// and closes): outside it the window isn't there at all for the mouse, so clicks go straight to whatever's under it. It
// puts itself back on top every couple of seconds (other always-on-top windows can come over it), follows the screen's
// size, and comes back if it ever crashes. (Games in exclusive full screen own the screen: nothing can be drawn over those.)
const ISLAND_W = 600, ISLAND_H = 260;
let islandShape = { x: 170, y: 0, width: 260, height: 84 }; // (the island's shape, as it last sent it; till then the compact pill's)
const NOWHERE = { x: 0, y: 0, width: 1, height: 1 }; // (away: a single pixel of the window there for the mouse)
let island = null, islandState = null, islandShown = false, islandPort = 0;
function placeIsland() {
  if (!island || island.isDestroyed()) return;
  const b = screen.getPrimaryDisplay().bounds;
  island.setBounds({ x: Math.round(b.x + (b.width - ISLAND_W) / 2), y: b.y, width: ISLAND_W, height: ISLAND_H });
}
function makeIsland() {
  island = new BrowserWindow({
    width: ISLAND_W, height: ISLAND_H, show: false, frame: false, transparent: true, backgroundColor: '#00000000', hasShadow: false,
    resizable: false, movable: false, minimizable: false, maximizable: false, fullscreenable: false, skipTaskbar: true, focusable: false,
    alwaysOnTop: true, title: 'NetherFlow island',
    webPreferences: { preload: path.join(__dirname, 'island-preload.js'), backgroundThrottling: false },
  });
  island.setAlwaysOnTop(true, 'screen-saver');
  island.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  island.setShape([NOWHERE]);
  placeIsland();
  const me = island;
  me.webContents.on('render-process-gone', () => { if (island === me) { island = null; islandShown = false; } me.destroy(); setTimeout(() => { if (!island && win && !win.isDestroyed()) { makeIsland(); syncIsland(); } }, 1000); });
  me.webContents.on('did-finish-load', () => {
    if (islandState) me.webContents.send('island-state', islandState);
    me.webContents.send('island-visible', islandShown);
    me.showInactive(); me.setAlwaysOnTop(true, 'screen-saver');
    syncIsland();
  });
  me.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  me.webContents.on('will-navigate', e => e.preventDefault());
  me.on('closed', () => { if (island === me) { island = null; islandShown = false; } });
  me.loadURL(`http://127.0.0.1:${islandPort}/island.html`); // (not the main window's address: its size, Settings › Interface size, is kept by address, and the island keeps its own)
}
function syncIsland() {
  if (!island || island.isDestroyed() || island.webContents.isLoading()) return;
  const front = win && !win.isDestroyed() && win.isVisible() && !win.isMinimized() && win.isFocused();
  const want = !!islandState && !front;
  // the window: always shown (asked of it, not remembered: something else may have hidden it — Show desktop, say)
  if (!island.isVisible() || island.isMinimized()) { placeIsland(); if (island.isMinimized()) island.restore(); island.showInactive(); island.setAlwaysOnTop(true, 'screen-saver'); }
  // the island in it: there or away (and for the mouse, its shape or nothing)
  if (want !== islandShown) {
    islandShown = want;
    if (want) island.webContents.send('island-state', islandState); // (what's playing now, before it's seen)
    island.webContents.send('island-visible', want); island.setShape([want ? islandShape : NOWHERE]);
  }
}
ipcMain.on('island-state', (e, st) => {
  if (!win || e.sender !== win.webContents) return;
  const had = !!islandState;
  islandState = st && typeof st === 'object' ? st : null;
  if (had !== !!islandState) syncIsland(); // (a song come or gone: the island there or away)
  else if (islandShown && islandState && island && !island.isDestroyed()) island.webContents.send('island-state', islandState); // (to an island that's out, only)
});
ipcMain.on('island-cmd', (e, cmd, v) => {
  if (!island || e.sender !== island.webContents || !win || win.isDestroyed()) return;
  if (cmd === 'open') { if (win.isMinimized()) win.restore(); win.show(); win.focus(); }
  else if (['toggle', 'next', 'prev', 'seek', 'vol', 'repeat', 'like'].includes(cmd)) win.webContents.send('island-cmd', cmd, typeof v === 'number' && isFinite(v) ? v : undefined);
});
// Discord "Now playing" (Settings: Discord status): the song on your Discord profile while it plays — "Listening to" it,
// its cover, a bar of how far in — through the Discord app's own local connection (its named pipe: nothing goes over the
// internet from here). DISCORD_ID: NetherFlow's application at Discord, which names it there (an id, public, not a
// secret; from discord.com/developers/applications).
const DISCORD_ID = process.env.NETHERFLOW_DISCORD_ID || '1559725339968540834';
const net = require('net');
const rpc = { sock: null, ready: false, want: null, sent: '', retryAt: 0, buf: Buffer.alloc(0), timer: null, last: 0 };
const rpcFrame = (op, obj) => { const j = Buffer.from(JSON.stringify(obj)), h = Buffer.alloc(8); h.writeInt32LE(op, 0); h.writeInt32LE(j.length, 4); return Buffer.concat([h, j]); };
// Where Discord listens: Windows, a named pipe; Linux, a socket in the session's own folder (or Flatpak's or Snap's
// Discord's, inside it). Discord takes the first free of ten. (Another name: for testing.)
const RUN = process.env.XDG_RUNTIME_DIR || process.env.TMPDIR || '/tmp';
const DISCORD_PIPES = process.env.NETHERFLOW_DISCORD_PIPE ? [process.env.NETHERFLOW_DISCORD_PIPE]
  : process.platform === 'win32' ? ['\\\\?\\pipe\\discord-ipc-'] : ['', 'app/com.discordapp.Discord', 'snap.discord'].map(d => path.join(RUN, d, 'discord-ipc-'));
function rpcConnect(i = 0) {
  if (!DISCORD_ID || rpc.sock || Date.now() < rpc.retryAt) return;
  const s = net.createConnection(DISCORD_PIPES[Math.floor(i / 10)] + (i % 10));
  s.once('error', () => { s.destroy(); if (i < DISCORD_PIPES.length * 10 - 1) rpcConnect(i + 1); else rpc.retryAt = Date.now() + 20000; }); // (not running: asked again later)
  s.once('connect', () => {
    rpc.sock = s; rpc.ready = false; rpc.buf = Buffer.alloc(0);
    s.removeAllListeners('error'); s.on('error', () => {});
    s.on('close', () => { if (rpc.sock === s) Object.assign(rpc, { sock: null, ready: false, sent: '', retryAt: Date.now() + 20000 }); });
    s.on('data', d => {
      rpc.buf = Buffer.concat([rpc.buf, d]);
      while (rpc.buf.length >= 8) {
        const op = rpc.buf.readInt32LE(0), n = rpc.buf.readInt32LE(4);
        if (rpc.buf.length < 8 + n) break;
        let m = null; try { m = JSON.parse(rpc.buf.subarray(8, 8 + n).toString()); } catch {}
        rpc.buf = rpc.buf.subarray(8 + n);
        if (op === 3) s.write(rpcFrame(4, m)); // (its ping: pong)
        else if (op === 2) s.destroy();
        else if (m?.evt === 'READY') { rpc.ready = true; rpcSend(); }
      }
    });
    s.write(rpcFrame(0, { v: 1, client_id: DISCORD_ID }));
  });
}
// (at most one change every 4 s: Discord takes five in 20 s; in between, the last wanted waits its turn)
function rpcSend() {
  if (!rpc.ready) return rpcConnect();
  const w = rpc.want, a = w && { type: 2, status_display_type: 2, details: w.title.slice(0, 128), state: ('by ' + w.artist).slice(0, 128),
    timestamps: { start: w.start, end: w.end }, assets: { large_image: w.art || 'netherflow-discord', large_text: (w.album || w.title).slice(0, 128), small_image: 'netherflow-discord', small_text: 'NetherFlow' }, // (netherflow-discord: the logo, an art asset of the app at Discord)
    ...(w.url ? { buttons: [{ label: 'Listen on YouTube', url: w.url }] } : {}) };
  const msg = JSON.stringify(a || null);
  if (msg === rpc.sent) return;
  const wait = rpc.last + 4000 - Date.now();
  if (wait > 0) { clearTimeout(rpc.timer); rpc.timer = setTimeout(rpcSend, wait); return; }
  rpc.sent = msg; rpc.last = Date.now();
  rpc.sock.write(rpcFrame(1, { cmd: 'SET_ACTIVITY', args: { pid: process.pid, ...(a ? { activity: a } : {}) }, nonce: Date.now().toString(36) + Math.random().toString(36).slice(2) }));
}
ipcMain.on('presence', (e, w) => {
  if (!win || e.sender !== win.webContents) return;
  const ok = w && typeof w === 'object' && typeof w.title === 'string' && typeof w.artist === 'string' && Number.isFinite(w.start) && Number.isFinite(w.end);
  rpc.want = ok ? { title: w.title, artist: w.artist, album: typeof w.album === 'string' ? w.album : '', start: w.start, end: w.end,
    art: /^https:\/\//.test(w.art) ? w.art : '', url: /^https:\/\/www\.youtube\.com\/watch\?v=[\w-]{11}$/.test(w.url) ? w.url : '' } : null;
  rpcSend();
});
app.on('before-quit', () => { if (rpc.sock) rpc.sock.destroy(); });

// Phone ↔ PC sync (Settings: Sync with phone): while the page asks (5 minutes at most), a small server on the local network
// that the phone app finds and swaps libraries with. What passes is encrypted by the page with a key made from the code on
// the screen — this server only passes it on, unread; five wrong codes and it closes.
const os = require('os'), http = require('http');
let sync = null; // { srv, port, fails, pending: Map(id → reply), timer }
const lanAddrs = () => Object.entries(os.networkInterfaces()).filter(([n]) => !/vEthernet|VirtualBox|VMware|Loopback|WSL|Hyper-V|Tailscale|ZeroTier/i.test(n))
  .flatMap(([, l]) => l).filter(a => a.family === 'IPv4' && !a.internal).map(a => a.address);
function syncClose() { if (!sync) return; clearTimeout(sync.timer); sync.srv.close(); for (const r of sync.pending.values()) r(null); sync = null; }
function syncHandle(req, res) {
  const send = (code, body) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(body); };
  if (req.method === 'GET' && req.url === '/nf-sync/hello') return send(200, JSON.stringify({ app: 'NetherFlow', name: os.hostname() }));
  if (req.method !== 'POST' || req.url !== '/nf-sync/swap') return send(404, '{}');
  const parts = []; let size = 0;
  req.on('data', c => { size += c.length; if (size > 64e6) req.destroy(); else parts.push(c); }); // (a library with big imported playlists runs to megabytes)
  req.on('end', async () => {
    if (!sync || !win || win.isDestroyed()) return send(410, '{}');
    const id = Math.random().toString(36).slice(2), s = sync;
    const reply = await new Promise(r => { s.pending.set(id, r); win.webContents.send('sync-in', id, Buffer.concat(parts).toString()); setTimeout(() => r(null), 60000); });
    s.pending.delete(id);
    if (!reply || typeof reply.data !== 'string') { if (sync === s && ++s.fails >= 5) syncClose(); return send(403, JSON.stringify({ error: reply?.error || 'refused' })); }
    send(200, JSON.stringify({ data: reply.data }));
  });
}
ipcMain.handle('sync-open', async e => {
  if (!win || e.sender !== win.webContents) return null;
  syncClose();
  for (const port of [47321, 47322, 47323]) { // (the phone looks on these)
    const srv = http.createServer(syncHandle);
    if (await new Promise(r => { srv.once('error', () => r(false)); srv.listen(port, process.env.NETHERFLOW_SYNC_HOST || '0.0.0.0', () => r(true)); })) { // (another address: for testing)
      sync = { srv, port, fails: 0, pending: new Map(), timer: setTimeout(() => { syncClose(); if (!win.isDestroyed()) win.webContents.send('sync-in', '', ''); }, 5 * 60000) };
      return { port, addrs: lanAddrs(), name: os.hostname() };
    }
  }
  return null;
});
ipcMain.on('sync-out', (e, id, reply) => { if (win && e.sender === win.webContents && sync?.pending.has(id)) sync.pending.get(id)(reply && typeof reply === 'object' ? reply : null); });
ipcMain.on('sync-close', e => { if (win && e.sender === win.webContents) syncClose(); });

// ---------- updates (the page's Settings › Update): the installed app, from its GitHub releases — only the parts of the
// installer that changed come down (electron-updater, by the installer's block map) — put in place by restarting. The
// portable app is one file run from anywhere and can't update itself: the page sends it to the release page instead.
// (Linux: the AppImage updates itself the same way; the .deb, installed by the system, doesn't: the page sends it to the
// release page too)
const DEB = process.platform === 'linux' && !process.env.APPIMAGE;
let updater;
function getUpdater() {
  if (updater !== undefined) return updater;
  updater = null;
  if (!app.isPackaged || process.env.PORTABLE_EXECUTABLE_DIR || DEB) return updater;
  try {
    updater = require('electron-updater').autoUpdater;
    updater.autoDownload = false; updater.autoInstallOnAppQuit = true;
    if (LITE) { updater.channel = 'lite'; updater.allowDowngrade = false; } // (Lite updates to Lite: lite.yml, not latest.yml)
    updater.on('download-progress', p => { if (win && !win.isDestroyed()) win.webContents.send('update-progress', p.percent / 100); });
  } catch { updater = null; }
  return updater;
}
ipcMain.handle('update-check', async e => {
  if (!win || e.sender !== win.webContents) return null;
  const u = getUpdater(), version = app.getVersion();
  if (!u) return { version, can: false, portable: !!process.env.PORTABLE_EXECUTABLE_DIR, deb: app.isPackaged && DEB }; // (or run from the source: nothing to update)
  try { const r = await u.checkForUpdates(); return { version, can: true, next: r?.isUpdateAvailable ? r.updateInfo.version : null }; }
  catch (er) {
    const m = String(er.message || er).split('\n')[0];
    return /(latest|lite)\.yml|\b404\b/.test(m) ? { version, can: true, next: null } : { version, can: true, error: m }; // (a release without the update's files: nothing to get)
  }
});
ipcMain.handle('update-get', async e => {
  if (!win || e.sender !== win.webContents || !getUpdater()) return false;
  await getUpdater().downloadUpdate();
  return true;
});
ipcMain.on('update-install', e => { if (win && e.sender === win.webContents && getUpdater()) getUpdater().quitAndInstall(true, true); }); // (quietly, then open again)

ipcMain.on('island-shape', (e, r) => {
  if (!island || e.sender !== island.webContents || !r || ![r.x, r.y, r.width, r.height].every(Number.isFinite)) return;
  const c = (v, max) => Math.max(0, Math.min(max, Math.round(v)));
  islandShape = { x: c(r.x, ISLAND_W), y: c(r.y, ISLAND_H), width: c(r.width, ISLAND_W), height: c(r.height, ISLAND_H) };
  if (islandShown) island.setShape([islandShape]);
});

app.whenReady().then(async () => {
  if (!first) return;
  // The fixed port: the page's library and settings belong to its address, port and all. Taken (a NetherFlow still
  // closing, another build of it, another program): waited for a few seconds, then any free one, and the page says why
  // everything there looks new (see preload.js: portMoved).
  let port = 0;
  for (let i = 0; i < 12 && !port; i++) port = await start(PORT).catch(() => new Promise(r => setTimeout(r, 250, 0)));
  if (!port) port = await start(0);

  // 1280×820, or as much as the screen has free (a 1366×768 laptop: else the player sat under the taskbar)
  const free = screen.getPrimaryDisplay().workAreaSize;
  win = new BrowserWindow({
    width: Math.min(1280, free.width), height: Math.min(820, free.height), minWidth: Math.min(420, free.width), minHeight: Math.min(620, free.height), show: false,
    title: 'NetherFlow', icon: path.join(__dirname, 'icon.png'), backgroundColor: '#0b0503',
    titleBarStyle: 'hidden', // no native title bar or buttons: the page draws its own (see preload.js)
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      backgroundThrottling: false, // keep timers at full speed when minimized (the next song readied, Smooth mix on time)
      additionalArguments: [...(LITE ? ['--nf-lite'] : []), ...(port !== PORT ? ['--nf-port-moved'] : []), '--nf-country=' + (COUNTRY || app.getLocaleCountryCode() || ''), '--nf-version=' + app.getVersion()], // (see preload.js: lite, portMoved, country)
    },
  });
  win.removeMenu();
  win.once('ready-to-show', () => win.show());
  for (const ev of ['maximize', 'unmaximize']) win.on(ev, () => { if (!win.webContents.isDestroyed()) win.webContents.send('maximized', win.isMaximized()); });
  // Where the window is, for the page — 2 in front, 1 on screen behind another app, 0 minimized or hidden: it only
  // moves while it's on screen (timers keep running, see above, so the page can't tell on its own).
  const where = () => !win.isVisible() || win.isMinimized() ? 0 : win.isFocused() ? 2 : 1;
  for (const ev of ['minimize', 'restore', 'hide', 'show', 'focus', 'blur']) win.on(ev, () => { if (!win.webContents.isDestroyed()) win.webContents.send('shown', where()); });
  win.webContents.on('did-finish-load', () => win.webContents.send('shown', where()));

  // Stay on the player page: web links open in the real browser (email links in the email app), nothing navigates the app away.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^(https?:\/\/|mailto:)/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', e => e.preventDefault());

  win.loadURL(`http://localhost:${port}`);

  // (Windows only. ponytail: Linux would need a compositor for the see-through window, and Wayland ignores always-on-top
  // and placing; try it there on X11 if people ask)
  islandPort = port; if (process.platform === 'win32') makeIsland();
  for (const ev of ['focus', 'blur', 'minimize', 'restore', 'show', 'hide']) win.on(ev, syncIsland);
  win.on('closed', () => { if (island && !island.isDestroyed()) island.destroy(); });
  for (const ev of ['display-metrics-changed', 'display-added', 'display-removed']) screen.on(ev, placeIsland);
  powerMonitor.on('resume', () => { placeIsland(); syncIsland(); });
  // every couple of seconds: shown if it should be (whatever hid it), and back on top of other always-on-top windows
  setInterval(() => { syncIsland(); if (island && !island.isDestroyed() && islandShown) { island.setAlwaysOnTop(true, 'screen-saver'); island.moveTop(); island.setShape([islandShape]); } }, 2000);
  // (and on top of everything else right away, whenever another window comes up)
  app.on('browser-window-focus', () => { if (island && !island.isDestroyed() && islandShown) island.moveTop(); });
});
