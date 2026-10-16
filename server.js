// NetherFlow - Copyright (C) 2026 Volodya.rua - GNU GPL v3 only, with additional terms (credit, name and logo): see LICENSE and NOTICE.
// NetherFlow's built-in server, started by the desktop app (main.js). `node server.js` also runs it alone.
//  1. Serves the page on localhost (FlowStream's streams play as the page's own: /api/fs/…; a file:// page can't).
//  2. /api/yt?q=… searches YouTube with no API key; /api/ytm?q=… searches YouTube Music's songs (the album recordings).
//  3. /api/words?artist=&title=&dur= fetches word-by-word lyric timing; /api/fs/… FlowStream (flowstream.js): a song's
//     stream, YouTube Music's own lyrics for it, the next songs ahead; /api/suggest?q=… what YouTube Music suggests
//     while a search is typed;
//     /api/audius?q=… Audius's tracks (an artist's own uploads there play at 320 kbps); /api/radio?id=… YouTube Music's radio
//     for a song (what Autoplay picks from); /api/playlist?url=… a Spotify, Apple Music or YouTube playlist's songs;
//     /api/explore, /api/charts, /api/mood, /api/album: YouTube Music's explore page, charts, a mood's playlists, an album;
//     /api/toppods Apple's top podcasts; /api/feed?url=… a podcast's feed, /api/media?url=… an episode's audio (saving it).
// (2 and 3 live in lib.js, which the Android app runs inside the page instead.)
const http = require('http'), fs = require('fs'), path = require('path');
const lib = require('./lib');
const FlowStream = require('./flowstream');

// Only the page's own files are served, never anything else in this folder (like the Android signing key).
const FILES = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/lib.js': ['lib.js', 'text/javascript'],
  '/flowstream.js': ['flowstream.js', 'text/javascript'],
  '/legal.html': ['legal.html', 'text/html; charset=utf-8'],
  '/island.html': ['island.html', 'text/html; charset=utf-8'], // (the desktop app's island: see main.js)
  '/logo.png': ['logo.png', 'image/png'],
};
for (const f of fs.readdirSync(path.join(__dirname, 'licenses'))) FILES['/licenses/' + f] = ['licenses/' + f, 'text/plain; charset=utf-8'];
for (const f of fs.readdirSync(path.join(__dirname, 'fonts'))) FILES['/fonts/' + f] = ['fonts/' + f, f.endsWith('.css') ? 'text/css' : 'font/woff2'];
for (const f of fs.readdirSync(path.join(__dirname, 'emoji'))) FILES['/emoji/' + f] = ['emoji/' + f, f.endsWith('.webp') ? 'image/webp' : 'text/plain; charset=utf-8']; // (Extreme lyrics' emoji)
// Redline's 3D races (race/: the renderer, three.js, the circuits, the cars; not in NetherFlow Lite)
if (fs.existsSync(path.join(__dirname, 'race'))) (function race(dir) {
  for (const e of fs.readdirSync(path.join(__dirname, dir), { withFileTypes: true })) {
    const f = dir + '/' + e.name;
    if (e.isDirectory()) race(f);
    else FILES['/' + f] = [f, { js: 'text/javascript', json: 'application/json', glb: 'model/gltf-binary' }[e.name.split('.').pop()] || 'text/plain; charset=utf-8'];
  }
})('race');
const get = (url, headers) => fetch(url, { headers, signal: AbortSignal.timeout(8000) }).then(r => r.text());
// (YouTube Music's answers take ~0.3–1 s: one that hasn't come in 4 s now and then never does — asked again at once,
// which answers; 8 s in all, as before)
const post = (url, body, headers) => fetch(url, { method: 'POST', body, headers, signal: AbortSignal.timeout(4000) }).then(r => r.text())
  .catch(e => e.name === 'TimeoutError' ? fetch(url, { method: 'POST', body, headers, signal: AbortSignal.timeout(4000) }).then(r => r.text()) : Promise.reject(e));
const send = (res, code, body, type = 'application/json') => { res.writeHead(code, { 'Content-Type': type }); res.end(body); };
// A podcast's addresses (its feed's, its episodes') are anyone's to write: only http(s), and never this computer or its
// network, checked at each redirect too. (ponytail: names only, not where they resolve; a name pointed at 127.0.0.1
// still gets through, read-only and only to this app's own page. Resolve and check the address if that ever matters.)
const outside = u => /^https?:$/.test(u.protocol) && !/^(localhost|.*\.localhost|.*\.local|.*\.internal|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|0\.|\[)/i.test(u.hostname) && !/^\d+$/.test(u.hostname);
async function fetchOut(href, headers, signal) {
  for (let hop = 0; hop <= 10; hop++) {
    let u; try { u = new URL(href || ''); } catch { throw new Error('not a feed address'); }
    if (!outside(u)) throw new Error('not a feed address');
    const r = await fetch(u, { headers: { 'User-Agent': 'NetherFlow/1 (podcasts; +https://github.com/volodya-rua/NetherFlow)', ...headers }, signal, redirect: 'manual' });
    const to = r.status >= 300 && r.status < 400 && r.headers.get('location');
    if (!to) return r;
    href = new URL(to, u).href;
  }
  throw new Error('too many redirects');
}

// FlowStream (NetherFlow's playback engine, flowstream.js): a song's best public stream, played by the page's own player
// through here (same origin, so the equalizer and visuals work on it as on a saved song). Straight from its source to
// this computer: nothing passes through any other server. If FlowStream can't find it, the bundled yt-dlp is asked (its
// path from main.js: module.exports.ytdlp).
// (its own, shorter wait: an answer takes ~0.15 s, so one that hasn't come in 3.5 s is asked again, see flowstream.js)
const flow = FlowStream.create({ post: (url, body, headers) => fetch(url, { method: 'POST', body, headers, signal: AbortSignal.timeout(url.includes('music.youtube.com') ? 8000 : 3500) }).then(r => r.text()) }); // (lyrics: no hurry)
const flowKept = new Map(); // a video → the address yt-dlp found (when FlowStream couldn't), till it expires
function viaYtdlp(id) {
  const had = flowKept.get(id);
  if (had && had.until > Date.now()) return Promise.resolve(had.s);
  const exe = module.exports.ytdlp?.();
  if (!exe || !/^[\w-]{11}$/.test(id)) return Promise.reject(new Error('no yt-dlp'));
  return new Promise((ok, no) => {
    const kid = require('child_process').spawn(exe, ['--no-config', '--no-playlist', '--no-warnings', '-f', '251/140/bestaudio', '--print', '%(url)s\n%(format_id)s\n%(ext)s', '--', id], { windowsHide: true });
    let out = ''; kid.stdout.on('data', d => out += d); kid.on('error', no);
    kid.on('close', code => {
      const [url, itag, ext] = out.trim().split('\n');
      if (code || !/^https:\/\//.test(url || '')) return no(new Error('yt-dlp found nothing'));
      const s = { url, itag: +itag, mime: ext === 'webm' ? 'audio/webm' : 'audio/mp4', loudnessDb: null };
      flowKept.set(id, { s, until: (+(new URL(url).searchParams.get('expire')) || 0) * 1000 - 5 * 60e3 });
      ok(s);
    });
  });
}
let flowWhy = ''; // (why FlowStream last handed a song to yt-dlp: its error code)
const flowAudio = id => flow.audio(id).then(s => ({ ...s, via: 'FlowStream' }), e => { flowWhy = e.code || e.message; return viaYtdlp(id).then(s => ({ ...s, via: 'yt-dlp', why: flowWhy })); });
// The next song's first 256 KB (about 15 s), fetched ahead into memory, so it starts the moment it's asked for (the
// rest follows from its source as it plays). Two songs' at most.
const HEAD = 262144, flowHeads = new Map();
function flowAhead(ids) {
  flow.prefetch(ids);
  for (const id of ids.slice(0, 2)) if (/^[\w-]{11}$/.test(id) && !flowHeads.has(id) && !keptMeta(id)) { // (kept already: not fetched again)
    const p = flowAudio(id).then(async s => {
      const r = await fetch(s.url, { headers: { Range: `bytes=0-${HEAD - 1}` }, signal: AbortSignal.timeout(15000) });
      const total = +(r.headers.get('content-range') || '').split('/')[1];
      if (r.status !== 206 || !total) throw new Error('no head');
      const buf = Buffer.from(await r.arrayBuffer());
      keepHead(id, buf, s, total);
      return { buf, total, mime: s.mime.split(';')[0], until: Date.now() + 30 * 60e3 };
    });
    flowHeads.set(id, p); p.catch(() => flowHeads.delete(id));
    while (flowHeads.size > 2) flowHeads.delete(flowHeads.keys().next().value);
  }
}
// The same first 256 KB of the last 100 songs played, kept on this computer too (main.js's folder for them:
// module.exports.heads), so a song starts the moment it's played, even the first after opening, its address asked for
// as it plays. A start that turns out not to be the stream's (its length differs: re-encoded since) is dropped.
// ponytail: the last 100 kept, not the most played.
const KEPT = 100;
const keptFile = (id, ext) => module.exports.heads && /^[\w-]{11}$/.test(id) ? path.join(module.exports.heads, id + ext) : null;
function keptMeta(id) { try { return JSON.parse(fs.readFileSync(keptFile(id, '.json'), 'utf8')); } catch { return null; } }
const dropKept = id => { for (const ext of ['.json', '.head']) if (keptFile(id, ext)) try { fs.rmSync(keptFile(id, ext), { force: true }); } catch {} }; // (at once: the page asks again straight after)
async function keepHead(id, buf, s, total) {
  const dir = module.exports.heads;
  if (!keptFile(id, '') || buf.length < HEAD || !total) return;
  try {
    await fs.promises.mkdir(dir, { recursive: true });
    await fs.promises.writeFile(keptFile(id, '.head'), buf.subarray(0, HEAD)); // (then its description: there only once the start is whole)
    await fs.promises.writeFile(keptFile(id, '.json'), JSON.stringify({ mime: s.mime.split(';')[0], total, itag: s.itag, loudnessDb: s.loudnessDb, duration: s.duration || 0 }));
    const kept = (await fs.promises.readdir(dir)).filter(n => n.endsWith('.json'));
    if (kept.length <= KEPT + 10) return;
    const aged = await Promise.all(kept.map(async n => [n.slice(0, -5), (await fs.promises.stat(path.join(dir, n))).mtimeMs]));
    for (const [old] of aged.sort((a, b) => b[1] - a[1]).slice(KEPT)) dropKept(old); // (the oldest beyond 100 go)
  } catch {}
}
// a stream, forwarded as asked (a range of it: seeking); an address that stopped working asked for again, once
async function flowMedia(req, res, url) {
  const id = url.searchParams.get('id') || '', video = url.searchParams.get('kind') === 'video';
  const pick = () => video ? flow.video(id, { height: +url.searchParams.get('h') || 1080, fps: +url.searchParams.get('fps') || 60, codecs: (url.searchParams.get('codecs') || 'av01,vp9,avc1').split(',') }) : flowAudio(id);
  const stop = new AbortController();
  res.on('close', () => stop.abort());
  // its start, kept here or fetched ahead: answered from the disk or memory (the player asks for the rest next). The
  // kept one first: one fetched ahead may still be on its way.
  const first = !video && /^bytes=0-/.test(req.headers.range || ''), kept = first && keptMeta(id);
  const head = first && !kept && await flowHeads.get(id)?.catch(() => null);
  const start = kept ? { ...kept, buf: await fs.promises.readFile(keptFile(id, '.head')).catch(() => null) } : head && head.until > Date.now() && head;
  if (start?.buf) {
    flowHeads.delete(id);
    res.writeHead(206, { 'Content-Type': start.mime, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store', 'Content-Length': start.buf.length, 'Content-Range': `bytes 0-${start.buf.length - 1}/${start.total}` });
    return res.end(start.buf);
  }
  try {
    let s = await pick(), r;
    for (let tries = 0; tries < 2; tries++) {
      const late = setTimeout(() => stop.abort(), 15000); // (no answer in 15 s: given up on, and the page moves on)
      r = await fetch(s.url, { headers: req.headers.range ? { Range: req.headers.range } : {}, signal: stop.signal }).finally(() => clearTimeout(late));
      if (r.status !== 403 || tries) break;
      flow.forget(id); flowKept.delete(id); s = await pick(); // (expired, or tied to another address: a fresh one)
    }
    if (!r.ok) return send(res, 502, JSON.stringify({ error: 'the stream answered ' + r.status }));
    const total = +(r.headers.get('content-range') || '').split('/')[1] || +r.headers.get('content-length') || 0, had = !video && keptMeta(id);
    if (had && total && had.total !== total) { dropKept(id); if (!/^bytes=0-/.test(req.headers.range || '')) return send(res, 502, JSON.stringify({ error: 'the kept start was another file' })); }
    const head = { 'Content-Type': s.mime.split(';')[0], 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store' };
    for (const k of ['content-length', 'content-range']) if (r.headers.get(k)) head[k] = r.headers.get(k);
    res.writeHead(r.status, head);
    // its start, kept: a copy fetched alongside (the player reads only a little from the start before it asks for the end)
    if (!video && !had && keptFile(id, '') && /^(bytes=0-.*)?$/.test(req.headers.range || ''))
      fetch(s.url, { headers: { Range: `bytes=0-${HEAD - 1}` }, signal: AbortSignal.timeout(15000) }).then(async k => k.status === 206 && keepHead(id, Buffer.from(await k.arrayBuffer()), s, total)).catch(() => {});
    for await (const c of r.body) { // (as /api/media, by hand)
      if (res.destroyed) break;
      if (!res.write(c)) await new Promise(ok => { const go = () => { res.off('drain', go); res.off('close', go); ok(); }; res.on('drain', go); res.on('close', go); });
    }
    return res.end();
  } catch (e) { return res.headersSent ? res.destroy() : send(res, 502, JSON.stringify({ error: e.code ? 'FlowStream: ' + e.code : 'no stream' })); }
}

async function handle(req, res) {
  // Only for this app's own page: a request named for any other host is a web page trying to reach in (DNS rebinding)
  if (!/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(req.headers.host || '')) return send(res, 403, 'forbidden', 'text/plain');
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/api/fs/media') return flowMedia(req, res, url);
  if (url.pathname === '/api/fs/audio') { // a song's stream, described (the page then plays /api/fs/media)
    const id = url.searchParams.get('id') || '', kept = keptMeta(id);
    if (kept) { flowAudio(id).catch(() => {}); return send(res, 200, JSON.stringify({ itag: kept.itag, mime: kept.mime, loudnessDb: kept.loudnessDb, duration: kept.duration, via: 'FlowStream', kept: true })); } // (its start kept here: at once, its address asked for meanwhile)
    try { const s = await flowAudio(url.searchParams.get('id') || ''); return send(res, 200, JSON.stringify({ itag: s.itag, mime: s.mime, loudnessDb: s.loudnessDb, duration: s.duration || 0, via: s.via, why: s.why || '' })); }
    catch (e) { return send(res, 502, JSON.stringify({ error: e.code || e.message })); }
  }
  if (url.pathname === '/api/fs/ahead') { flowAhead((url.searchParams.get('ids') || '').split(',')); return send(res, 204, ''); } // (the next songs, looked up ahead)
  if (url.pathname === '/api/fs/lyrics') {
    try { return send(res, 200, JSON.stringify(await flow.lyrics(url.searchParams.get('id') || ''))); }
    catch (e) { return send(res, 502, JSON.stringify({ error: e.code || e.message })); }
  }
  if (url.pathname === '/api/yt') {
    const q = (url.searchParams.get('q') || '').slice(0, 200);
    try { return send(res, 200, JSON.stringify(q ? await lib.ytSearch(get, q) : [])); }
    catch (e) { return send(res, 502, JSON.stringify({ error: e.message })); }
  }
  if (url.pathname === '/api/ytm') {
    const q = (url.searchParams.get('q') || '').slice(0, 200);
    try { const r = q ? await lib.ytMusic(post, q) : []; return send(res, 200, JSON.stringify({ songs: r, corrected: r.corrected || '' })); }
    catch (e) { return send(res, 502, JSON.stringify({ error: e.message })); }
  }
  if (url.pathname === '/api/audius') {
    const q = (url.searchParams.get('q') || '').slice(0, 200);
    try { return send(res, 200, JSON.stringify(q ? await lib.audius(get, q) : [])); }
    catch { return send(res, 200, '[]'); } // (none: YouTube still plays it)
  }
  if (url.pathname === '/api/suggest') {
    const q = (url.searchParams.get('q') || '').slice(0, 120);
    try { return send(res, 200, JSON.stringify(q.trim() ? await lib.ytmSuggest(post, q) : [])); }
    catch { return send(res, 200, '[]'); } // no suggestions: the search itself still works
  }
  if (url.pathname === '/api/playlist') {
    const link = (url.searchParams.get('url') || '').slice(0, 500);
    let host = ''; try { host = new URL(link).hostname; } catch {}
    if (!/^(music\.youtube\.com|(www\.|m\.)?youtube\.com|youtu\.be|open\.spotify\.com|spotify\.(app\.)?link|music\.apple\.com)$/.test(host)) return send(res, 400, JSON.stringify({ error: 'not a playlist link' }));
    try { return send(res, 200, JSON.stringify(await lib.playlist(get, post, link))); }
    catch (e) { return send(res, 502, JSON.stringify({ error: e.message })); }
  }
  // Explore (see lib.ytmExplore…): gl, the country; p, a mood's page; id, an album
  if (/^\/api\/(explore|charts|mood|album)$/.test(url.pathname)) {
    const p = url.searchParams, gl = /^[A-Z]{2}$/.test(p.get('gl') || '') ? p.get('gl') : 'US', kind = url.pathname.slice(5);
    try {
      const out = kind === 'explore' ? await lib.ytmExplore(post, gl) : kind === 'charts' ? await lib.ytmCharts(post, gl)
        : kind === 'mood' ? await lib.ytmMood(post, (p.get('p') || '').slice(0, 200), gl) : await lib.ytmAlbum(post, (p.get('id') || '').slice(0, 60), gl);
      return send(res, 200, JSON.stringify(out));
    } catch (e) { return send(res, 502, JSON.stringify({ error: e.message })); }
  }
  if (url.pathname === '/api/toppods') {
    const cc = (url.searchParams.get('cc') || 'us').toLowerCase();
    try { return send(res, 200, JSON.stringify(await lib.topPodcasts(get, cc))); }
    catch (e) { return send(res, 502, JSON.stringify({ error: e.message })); }
  }
  // a podcast's feed (its RSS, which most hosts don't let a page read itself): 30 MB at most, 25 s
  if (url.pathname === '/api/feed') {
    try {
      const r = await fetchOut(url.searchParams.get('url'), { Accept: 'application/rss+xml, application/xml, text/xml, */*' }, AbortSignal.timeout(25000));
      if (!r.ok) return send(res, 502, JSON.stringify({ error: 'the feed answered ' + r.status }));
      const parts = []; let size = 0;
      for await (const c of r.body) { size += c.length; if (size > 30e6) return send(res, 502, JSON.stringify({ error: 'the feed is too big' })); parts.push(c); }
      return send(res, 200, Buffer.concat(parts), 'text/xml; charset=utf-8');
    } catch (e) { return send(res, e.message === 'not a feed address' ? 400 : 502, JSON.stringify({ error: e.name === 'TimeoutError' ? 'the feed took too long' : e.message === 'not a feed address' ? e.message : 'the feed didn\'t load' })); }
  }
  // an episode's or chapter's audio, passed through as it comes (saving it for offline: hosts don't let a page read it)
  if (url.pathname === '/api/media') {
    const stop = new AbortController();
    res.on('close', () => stop.abort()); // (the page cancelled)
    try {
      const r = await fetchOut(url.searchParams.get('url'), {}, stop.signal);
      if (!r.ok) return send(res, 502, JSON.stringify({ error: 'its host answered ' + r.status }));
      const len = r.headers.get('content-length');
      res.writeHead(200, { 'Content-Type': r.headers.get('content-type') || 'application/octet-stream', ...(len ? { 'Content-Length': len } : {}) });
      // (read and written by hand: Readable.fromWeb + pipeline stalled the next one after a download was stopped)
      for await (const c of r.body) {
        if (res.destroyed) break;
        if (!res.write(c)) await new Promise(ok => { const go = () => { res.off('drain', go); res.off('close', go); ok(); }; res.on('drain', go); res.on('close', go); });
      }
      return res.end();
    } catch (e) { return res.headersSent ? res.destroy() : send(res, 502, JSON.stringify({ error: e.message === 'not a feed address' ? 'not an address it can fetch' : 'its host didn\'t answer' })); }
  }
  if (url.pathname === '/api/radio') {
    const id = url.searchParams.get('id') || '';
    if (!/^[\w-]{11}$/.test(id)) return send(res, 400, '[]');
    try { return send(res, 200, JSON.stringify(await lib.ytmRadio(post, id))); }
    catch { return send(res, 200, '[]'); } // (none: the music stops at the end of the list, as it would without Autoplay)
  }
  if (url.pathname === '/api/words') {
    const p = url.searchParams, artist = (p.get('artist') || '').slice(0, 200), title = (p.get('title') || '').slice(0, 200);
    try { return send(res, 200, JSON.stringify(artist && title ? await lib.words(get, artist, title, +p.get('dur') || 0) : {})); }
    catch { return send(res, 200, JSON.stringify({})); } // no word timing is fine: line timing still works
  }
  const f = FILES[url.pathname];
  if (!f) return send(res, 404, 'not found', 'text/plain');
  fs.readFile(path.join(__dirname, f[0]), (err, data) => err ? send(res, 500, 'unreadable', 'text/plain') : send(res, 200, data, f[1]));
}

// Resolves with the port actually used (pass 0 for any free one). Only reachable from this machine.
const start = port => new Promise((resolve, reject) => {
  const srv = http.createServer(handle).once('error', reject);
  srv.listen(port, '127.0.0.1', () => resolve(srv.address().port));
});

module.exports = { start, ytdlp: null, heads: null }; // (ytdlp: main.js's, for FlowStream's fallback; heads: its folder for songs' starts)
if (require.main === module) start(+process.env.PORT || 5173).then(p => console.log(`NetherFlow is up: http://localhost:${p}`));
