// NetherFlow - Copyright (C) 2026 Volodya.rua - GNU GPL v3 only, with additional terms (credit, name and logo): see LICENSE and NOTICE.
// NetherFlow's built-in server, started by the desktop app (main.js). `node server.js` also runs it alone.
//  1. Serves the page on localhost. YouTube's player refuses to run on file:// pages.
//  2. /api/yt?q=… searches YouTube with no API key; /api/ytm?q=… searches YouTube Music's songs (the album recordings).
//  3. /api/words?artist=&title=&dur= fetches word-by-word lyric timing; /api/ytmlyrics?id=… YouTube Music's own lyrics
//     for a video (time-synced when it has them); /api/suggest?q=… what YouTube Music suggests while a search is typed;
//     /api/audius?q=… Audius's tracks (an artist's own uploads there play at 320 kbps); /api/radio?id=… YouTube Music's radio
//     for a song (what Autoplay picks from); /api/playlist?url=… a Spotify, Apple Music or YouTube playlist's songs;
//     /api/explore, /api/charts, /api/mood, /api/album: YouTube Music's explore page, charts, a mood's playlists, an album;
//     /api/toppods Apple's top podcasts; /api/feed?url=… a podcast's feed, /api/media?url=… an episode's audio (saving it);
//     /api/agents the Tactical theme's agents (Riot Games' art, by valorant-api.com).
// (2 and 3 live in lib.js, which the Android app runs inside the page instead.)
const http = require('http'), fs = require('fs'), path = require('path');
const lib = require('./lib');

// Only the page's own files are served, never anything else in this folder (like the Android signing key).
const FILES = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/lib.js': ['lib.js', 'text/javascript'],
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
const post = (url, body, headers) => fetch(url, { method: 'POST', body, headers, signal: AbortSignal.timeout(8000) }).then(r => r.text());
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

async function handle(req, res) {
  // Only for this app's own page: a request named for any other host is a web page trying to reach in (DNS rebinding)
  if (!/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(req.headers.host || '')) return send(res, 403, 'forbidden', 'text/plain');
  const url = new URL(req.url, 'http://localhost');
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
  if (url.pathname === '/api/ytmlyrics') {
    const id = url.searchParams.get('id') || '';
    if (!/^[\w-]{11}$/.test(id)) return send(res, 400, '{}');
    try { return send(res, 200, JSON.stringify(await lib.ytmLyrics(post, id))); }
    catch { return send(res, 200, '{}'); } // none: the other lyric sources still work
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
  if (url.pathname === '/api/agents') { // (the Tactical theme's agents: see lib.agents)
    try { return send(res, 200, JSON.stringify(await lib.agents(get))); }
    catch { return send(res, 200, '[]'); }
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

module.exports = { start };
if (require.main === module) start(+process.env.PORT || 5173).then(p => console.log(`NetherFlow is up: http://localhost:${p}`));
