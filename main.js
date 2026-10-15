// NetherFlow - Copyright (C) 2026 Volodya.rua - GNU GPL v3 only, with additional terms (credit, name and logo): see LICENSE and NOTICE.
// NetherFlow desktop app: a window around the player page, served by the built-in server
// (YouTube's player won't run on file:// pages), with YouTube ads skipped automatically.
const { app, BrowserWindow, session, webFrameMain, shell, ipcMain, powerSaveBlocker, screen, powerMonitor } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn, execFileSync } = require('child_process');
const { start } = require('./server');

const PORT = 41739; // fixed, so settings saved by the page (lyric sync per song) survive restarts
const LITE = !!require('./package.json').lite; // (NetherFlow Lite: built by tools/lite-build.js, without Extreme+)
// The person's country, for the music store the page searches: Windows' "Country or region" (Settings › Time & language
// › Region). The language's own region is often another (English (United States) in India), and Electron reads that one.
let COUNTRY = '';
try { if (process.platform === 'win32') COUNTRY = execFileSync('reg', ['query', String.raw`HKCU\Control Panel\International\Geo`, '/v', 'Name'], { encoding: 'utf8', timeout: 2000, windowsHide: true }).match(/Name\s+REG_SZ\s+([A-Z]{2})\b/)?.[1] || ''; } catch {}

// Ad servers the YouTube player calls. Blocking them stops many ads from loading at all.
const AD_URLS = [
  '*://*.doubleclick.net/*', '*://*.googlesyndication.com/*', '*://*.googleadservices.com/*',
  '*://www.youtube.com/pagead/*', '*://www.youtube.com/api/stats/ads*', '*://www.youtube.com/get_midroll_*',
];

// Injected into YouTube's player frame: skips ads, applies the equalizer, shows the song in the
// Windows media panel (see frame-helper.js, shared with the Android app).
const FRAME_HELPER = require('fs').readFileSync(path.join(__dirname, 'frame-helper.js'), 'utf8');
const isYouTubePlayer = url => /^https:\/\/www\.youtube(-nocookie)?\.com\/embed\//.test(url);

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

// Saving for offline: yt-dlp downloads the song's own audio from its YouTube upload, as it is (no re-recording), with
// this app's own Node (ELECTRON_RUN_AS_NODE) as the JavaScript runtime YouTube's player code needs. It runs from a copy
// in the app's data folder, so it can update itself when a change at YouTube makes saving fail.
const BUNDLED_YTDLP = app.isPackaged ? path.join(process.resourcesPath, 'yt-dlp.exe') : path.join(__dirname, 'vendor', 'yt-dlp', 'yt-dlp.exe');
let ytdlpExe = null, ytdlpUpdated = 0;
const ytdlKids = new Map(); // the page's job key → its yt-dlp process
function ytdlp() {
  if (ytdlpExe) return ytdlpExe;
  const dir = path.join(app.getPath('userData'), 'yt-dlp'), exe = path.join(dir, 'yt-dlp.exe'), mark = path.join(dir, 'bundled.txt');
  const tag = String(fs.statSync(BUNDLED_YTDLP).size); // (a new one with an app update: copied over the old)
  if (!fs.existsSync(exe) || (fs.existsSync(mark) && fs.readFileSync(mark, 'utf8')) !== tag) {
    fs.mkdirSync(dir, { recursive: true }); fs.copyFileSync(BUNDLED_YTDLP, exe); fs.writeFileSync(mark, tag);
  }
  return ytdlpExe = exe;
}
// One download: the best audio-only stream, as YouTube serves it (usually Opus in WebM). Progress goes to the page.
function ytdlOnce(e, id, key) {
  const exe = ytdlp(), out = path.join(app.getPath('temp'), 'netherflow-dl');
  fs.mkdirSync(out, { recursive: true });
  return new Promise((resolve, reject) => {
    const kid = spawn(exe, ['--no-config', '--no-playlist', '--no-part', '--no-mtime', '--newline', '--progress', '-N', '4',
      '--cache-dir', path.join(app.getPath('userData'), 'yt-dlp', 'cache'), '--js-runtimes', 'node:' + process.execPath,
      '-f', 'bestaudio', '-o', path.join(out, key + '.%(ext)s'),
      '--progress-template', 'download:nfp %(progress.downloaded_bytes)s %(progress.total_bytes,progress.total_bytes_estimate)s',
      '--print', 'after_move:nfdone %(filepath)s\t%(duration)s', 'https://www.youtube.com/watch?v=' + id],
      { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, windowsHide: true });
    ytdlKids.set(key, kid);
    let done = null, err = '';
    const timer = setTimeout(() => stopKid(kid), 180000);
    const read = chunk => {
      for (const line of String(chunk).split(/\r?\n/)) {
        const m = /^nfp (\d+) (\d+)/.exec(line);
        if (m && !e.sender.isDestroyed()) e.sender.send('ytdl-progress', { key, frac: Math.min(1, m[1] / m[2]) });
        else if (line.startsWith('nfdone ')) done = line.slice(7).split('\t');
        else if (/ERROR/.test(line)) err = line.replace(/^.*?ERROR:\s*(\[[^\]]*\]\s*)?/, '');
      }
    };
    kid.stdout.on('data', read); kid.stderr.on('data', read);
    kid.on('error', er => { err = er.message; });
    kid.on('close', code => {
      clearTimeout(timer); ytdlKids.delete(key);
      if (kid.cancelled || code !== 0 || !done) { // (nothing kept of a download that didn't finish)
        for (const f of fs.readdirSync(out)) if (f.startsWith(key + '.')) fs.rm(path.join(out, f), { force: true }, () => {});
        return reject(new Error(kid.cancelled ? 'cancelled' : err || 'the download failed'));
      }
      const [file, dur] = done;
      try { resolve({ data: fs.readFileSync(file), ext: path.extname(file).slice(1), dur: +dur || 0 }); }
      catch (er) { reject(er); }
      finally { fs.rm(file, { force: true }, () => {}); }
    });
  });
}
ipcMain.handle('ytdl', async (e, { id, key }) => {
  if (!win || e.sender !== win.webContents || !/^[\w-]{11}$/.test(id) || !/^\w+$/.test(key)) throw new Error('bad request');
  try { return await ytdlOnce(e, id, key); }
  catch (er) {
    // Failing: maybe YouTube changed something — update yt-dlp (at most every 6 hours, and not while other downloads
    // run it: a running program can't be replaced) and try once more.
    if (er.message === 'cancelled' || Date.now() - ytdlpUpdated < 6 * 3600e3 || ytdlKids.size) throw er;
    ytdlpUpdated = Date.now();
    await new Promise(r => { const u = spawn(ytdlp(), ['-U'], { windowsHide: true }); u.on('close', r); u.on('error', r); });
    return ytdlOnce(e, id, key);
  }
});
// yt-dlp.exe unpacks and starts a second process of its own: stop both
const stopKid = kid => spawn('taskkill', ['/pid', String(kid.pid), '/T', '/F'], { windowsHide: true }).on('error', () => kid.kill());
ipcMain.on('ytdl-cancel', (e, key) => { if (!win || e.sender !== win.webContents) return; const kid = ytdlKids.get(key); if (kid) { kid.cancelled = true; stopKid(kid); } });

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
  me.loadURL(`http://localhost:${islandPort}/island.html`);
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
function rpcConnect(i = 0) {
  if (!DISCORD_ID || rpc.sock || Date.now() < rpc.retryAt) return;
  const s = net.createConnection((process.env.NETHERFLOW_DISCORD_PIPE || '\\\\?\\pipe\\discord-ipc-') + i); // (Discord takes the first free of ten; another name: for testing)
  s.once('error', () => { s.destroy(); if (i < 9) rpcConnect(i + 1); else rpc.retryAt = Date.now() + 20000; }); // (not running: asked again later)
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
let updater;
function getUpdater() {
  if (updater !== undefined) return updater;
  updater = null;
  if (!app.isPackaged || process.env.PORTABLE_EXECUTABLE_DIR) return updater;
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
  if (!u) return { version, can: false, portable: !!process.env.PORTABLE_EXECUTABLE_DIR }; // (or run from the source: nothing to update)
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
  session.defaultSession.webRequest.onBeforeRequest({ urls: AD_URLS }, (_, done) => done({ cancel: true }));

  // 1280×820, or as much as the screen has free (a 1366×768 laptop: else the player sat under the taskbar)
  const free = screen.getPrimaryDisplay().workAreaSize;
  win = new BrowserWindow({
    width: Math.min(1280, free.width), height: Math.min(820, free.height), minWidth: Math.min(420, free.width), minHeight: Math.min(620, free.height), show: false,
    title: 'NetherFlow', icon: path.join(__dirname, 'icon.png'), backgroundColor: '#0b0503',
    titleBarStyle: 'hidden', // no native title bar or buttons: the page draws its own (see preload.js)
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      backgroundThrottling: false, // keep timers at full speed when minimized, so ads are still skipped instantly
      additionalArguments: [...(LITE ? ['--nf-lite'] : []), ...(port !== PORT ? ['--nf-port-moved'] : []), '--nf-country=' + (COUNTRY || app.getLocaleCountryCode() || '')], // (see preload.js: lite, portMoved, country)
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

  win.webContents.on('did-frame-finish-load', (_, isMain, pid, rid) => {
    const frame = !isMain && webFrameMain.fromId(pid, rid);
    if (frame && isYouTubePlayer(frame.url)) frame.executeJavaScript(FRAME_HELPER).catch(() => {});
  });
  // Stay on the player page: web links open in the real browser (email links in the email app), nothing navigates the app away.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^(https?:\/\/|mailto:)/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', e => e.preventDefault());

  win.loadURL(`http://localhost:${port}`);

  islandPort = port; makeIsland();
  for (const ev of ['focus', 'blur', 'minimize', 'restore', 'show', 'hide']) win.on(ev, syncIsland);
  win.on('closed', () => { if (island && !island.isDestroyed()) island.destroy(); });
  for (const ev of ['display-metrics-changed', 'display-added', 'display-removed']) screen.on(ev, placeIsland);
  powerMonitor.on('resume', () => { placeIsland(); syncIsland(); });
  // every couple of seconds: shown if it should be (whatever hid it), and back on top of other always-on-top windows
  setInterval(() => { syncIsland(); if (island && !island.isDestroyed() && islandShown) { island.setAlwaysOnTop(true, 'screen-saver'); island.moveTop(); island.setShape([islandShape]); } }, 2000);
  // (and on top of everything else right away, whenever another window comes up)
  app.on('browser-window-focus', () => { if (island && !island.isDestroyed() && islandShown) island.moveTop(); });
});
