// NetherFlow - Copyright (C) 2026 Volodya.rua - GNU GPL v3 only, with additional terms (credit, name and logo): see LICENSE and NOTICE.
// Covers kept on this device: an album cover, a song's or a playlist's picture from the music services' image servers
// is answered from here once it's been seen — opening NetherFlow again, the covers are there at once instead of loading
// again (YouTube's say "keep me 2 hours"). The first time, fetched as it would be (no cookies) and kept. Nothing else
// goes through here. ponytail: the newest 4,000 kept (pruned now and then), never refreshed — a cover's address changes
// when its picture does.
const CACHE = 'netherflow-covers-1', MAX = 4000;
const HOSTS = /^(is\d+-ssl\.mzstatic\.com|i\d?\.ytimg\.com|lh\d\.googleusercontent\.com|yt\d\.(ggpht|googleusercontent)\.com|i\.scdn\.co|mosaic\.scdn\.co|image-cdn-\w+\.spotifycdn\.com)$/;
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
let kept = 0;
self.addEventListener('fetch', e => {
  const r = e.request;
  if (r.method !== 'GET' || r.destination !== 'image') return;
  let u; try { u = new URL(r.url); } catch { return; }
  if (u.protocol !== 'https:' || !HOSTS.test(u.hostname)) return;
  e.respondWith((async () => {
    const c = await caches.open(CACHE), hit = await c.match(r.url);
    if (hit) return hit;
    try {
      const res = await fetch(r.url, { mode: 'cors', credentials: 'omit' }); // (a readable copy, to keep: an opaque one counts as megabytes against the device's room)
      if (res.ok) { e.waitUntil(c.put(r.url, res.clone()).then(() => ++kept % 200 || prune(c)).catch(() => {})); return res; }
    } catch {}
    return fetch(r); // (a server that doesn't allow that, or didn't answer: as it would have been, not kept)
  })());
});
async function prune(c) { const keys = await c.keys(); for (const k of keys.slice(0, Math.max(0, keys.length - MAX))) await c.delete(k); }
