// NetherFlow - Copyright (C) 2026 Volodya.rua - GNU GPL v3 only, with additional terms (credit, name and logo): see LICENSE and NOTICE.
// Covers kept on this device: an album cover, a song's or a playlist's picture from the music services' image servers
// is answered from here once it's been seen — opening NetherFlow again, the covers are there at once instead of loading
// again (YouTube's say "keep me 2 hours"). The first time, fetched as it would be (no cookies) and kept. Nothing else
// goes through here. ponytail: the newest 4,000 kept (pruned now and then), never refreshed — a cover's address changes
// when its picture does.
const CACHE = 'netherflow-covers-1', MAX = 4000;
const HOSTS = /^(is\d+-ssl\.mzstatic\.com|i\d?\.ytimg\.com|lh\d\.googleusercontent\.com|yt\d\.(ggpht|googleusercontent)\.com|i\.scdn\.co|mosaic\.scdn\.co|image-cdn-\w+\.spotifycdn\.com)$/;
self.addEventListener('install', e => {
  self.skipWaiting();
  // the page itself never comes through here (straight from the app): with it waiting on this worker, Android's web view
  // now and then never finished opening it — a black screen at start, seen on a TV. A browser without this way of
  // skipping a worker (a web view before 123): as before. Every later sw.js keeps this: a worker gets its routes only as
  // it's installed, so one without it would bring the black screen back.
  if (e.addRoutes) e.addRoutes({ condition: { requestMode: 'navigate' }, source: 'network' }).catch(() => {});
});
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
let kept = 0;
// a server that said "too many" (429) or turned the readable copy down: left alone for a while, its covers fetched just as
// they would be — asking twice each time doubled what Google's image server saw, and it turned more covers down
const resting = new Map(); // host → until (ms)
// asked for without the app's address as the page it's for: YouTube Music's image server (yt3) answers a cover asked for
// with it 429, "too many", every time, and the same cover without it 200 — on the computer and the phone alike — and the
// first 429 left every cover of that server to itself for 10 minutes: blank playlist covers
const BARE = { credentials: 'omit', referrerPolicy: 'no-referrer' };
self.addEventListener('fetch', e => {
  const r = e.request;
  if (r.method !== 'GET' || r.destination !== 'image') return;
  let u; try { u = new URL(r.url); } catch { return; }
  if (u.protocol !== 'https:' || !HOSTS.test(u.hostname)) return;
  e.respondWith((async () => {
    const c = await caches.open(CACHE), hit = await c.match(r.url);
    if (hit) return hit;
    if ((resting.get(u.hostname) || 0) > Date.now()) return fetch(r.url, { ...BARE, mode: r.mode });
    try {
      const res = await fetch(r.url, { ...BARE, mode: 'cors' }); // (a readable copy, to keep: an opaque one counts as megabytes against the device's room)
      if (res.ok) { e.waitUntil(c.put(r.url, res.clone()).then(() => ++kept % 200 || prune(c)).catch(() => {})); return res; }
      if (res.status === 429 || res.status >= 500) resting.set(u.hostname, Date.now() + 10 * 60e3);
    } catch { resting.set(u.hostname, Date.now() + 10 * 60e3); }
    return fetch(r.url, { ...BARE, mode: r.mode }); // (a server that doesn't allow that, or didn't answer: as it would have been, not kept)
  })());
});
async function prune(c) { const keys = await c.keys(); for (const k of keys.slice(0, Math.max(0, keys.length - MAX))) await c.delete(k); }
