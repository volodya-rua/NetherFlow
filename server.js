// NetherFlow's built-in server, started by the desktop app (main.js). `node server.js` also runs it alone.
//  1. Serves the page on localhost. YouTube's player refuses to run on file:// pages.
//  2. /api/yt?q=… searches YouTube with no API key; /api/ytm?q=… searches YouTube Music's songs (the album recordings).
//  3. /api/words?artist=&title=&dur= fetches word-by-word lyric timing; /api/ytmlyrics?id=… YouTube Music's own lyrics
//     for a video (time-synced when it has them); /api/suggest?q=… what YouTube Music suggests while a search is typed;
//     /api/audius?q=… Audius's tracks (an artist's own uploads there play at 320 kbps); /api/radio?id=… YouTube Music's radio
//     for a song (what Autoplay picks from); /api/playlist?url=… a Spotify, Apple Music or YouTube playlist's songs.
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
const get = (url, headers) => fetch(url, { headers, signal: AbortSignal.timeout(8000) }).then(r => r.text());
const post = (url, body, headers) => fetch(url, { method: 'POST', body, headers, signal: AbortSignal.timeout(8000) }).then(r => r.text());
const send = (res, code, body, type = 'application/json') => { res.writeHead(code, { 'Content-Type': type }); res.end(body); };

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
    if (!/^(music\.youtube\.com|(www\.|m\.)?youtube\.com|youtu\.be|open\.spotify\.com|music\.apple\.com)$/.test(host)) return send(res, 400, JSON.stringify({ error: 'not a playlist link' }));
    try { return send(res, 200, JSON.stringify(await lib.playlist(get, post, link))); }
    catch (e) { return send(res, 502, JSON.stringify({ error: e.message })); }
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
