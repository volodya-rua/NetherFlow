// NetherFlow - Copyright (C) 2026 Volodya.rua - GNU GPL v3 only, with additional terms (credit, name and logo): see LICENSE and NOTICE.
// NetherFlow's match cache: a Cloudflare Worker (free plan) that remembers which YouTube video is a given song, so a
// song one person has matched is matched for everyone without a fresh YouTube search. It stores only facts — a song's
// normalised title, artist and length, and the public YouTube video id — never any audio, thumbnail, account, identity
// or listening history, and nothing about who asked. Legal approved on these terms (ids only; anonymous; internal to
// the app; votes before trust; strict validation; rate limited; pruned; no logs).
//
//   GET  /m?k=<key>            → { ids: ["<11-char id>", …], lyr: "lrclib:<id>" | "" }   top-voted video ids + lyrics pointer
//   POST /m   {k, id?, lyr?}    → { ok: true }                    add a vote for the video id and/or the LRCLIB lyrics pointer
// Only a per-song lookup — never a list of everything (a public "song → id" dump would look like a ripping aid; a
// private per-song lookup inside the app does not). Nothing is logged (observability off in wrangler.toml, no console).

const KEY = /^[a-z0-9]+(?: [a-z0-9]+)*\|[a-z0-9]+(?: [a-z0-9]+)*\|\d{1,4}$/; // "title words|artist words|seconds" (already normalised by the app)
const VID = /^[\w-]{11}$/;
const LYR = /^lrclib:\d{1,12}$/; // a lyrics pointer: LRCLIB only (open/CC0). Never other sources — that would re-derive their index.
const TRUST = 2;            // an id is served only once at least this many people have contributed it
const VOTE_CAP = 60;        // a single id's votes stop here (no runaway, harder to game)
const STALE = 180 * 864e5;  // an id not seen for this long is pruned
const BODY_MAX = 256;       // a contribution is tiny; anything bigger is refused
const IP = { burst: 30, rate: 0.5 }; // writes per IP: a burst, then one every 2 s (anti-spam, anti-cost)
const SHARDS = 64;

// which shard a key lives in (spreads writes; the same key always lands in the same one, so everyone meets there)
const shardOf = key => { let h = 0; for (const c of key) h = (h * 31 + c.charCodeAt(0)) >>> 0; return 'm' + (h % SHARDS); };
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '86400' };
const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json', ...CORS } });

export default {
  async fetch(req, env) {
    if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
    const url = new URL(req.url);
    if (url.pathname !== '/m') return new Response('Not found', { status: 404 });
    if (req.method === 'GET') {
      const k = url.searchParams.get('k') || '';
      if (!KEY.test(k)) return json({ ids: [] });
      return env.CACHE.get(env.CACHE.idFromName(shardOf(k))).fetch(req);
    }
    if (req.method === 'POST') {
      const body = await req.text();
      if (body.length > BODY_MAX) return json({ error: 'too big' }, 413);
      let d; try { d = JSON.parse(body); } catch { return json({ error: 'bad json' }, 400); }
      const hasId = VID.test(d?.id || ''), hasLyr = LYR.test(d?.lyr || '');
      if (!KEY.test(d?.k || '') || (!hasId && !hasLyr) || (d.id != null && !hasId) || (d.lyr != null && !hasLyr)) return json({ error: 'bad request' }, 400); // (strict schema: a valid key and a valid id and/or lrclib pointer, nothing else)
      return env.CACHE.get(env.CACHE.idFromName(shardOf(d.k))).fetch(new Request(req.url, { method: 'POST', headers: { 'X-IP': req.headers.get('CF-Connecting-IP') || '0', 'Content-Type': 'application/json' }, body }));
    }
    return new Response('Method not allowed', { status: 405 });
  },
};

export class Cache {
  constructor(ctx) {
    this.sql = ctx.storage.sql;
    this.sql.exec('CREATE TABLE IF NOT EXISTS m (k TEXT, vid TEXT, votes INTEGER, at INTEGER, PRIMARY KEY (k, vid))');
    this.sql.exec('CREATE TABLE IF NOT EXISTS lyr (k TEXT, ref TEXT, votes INTEGER, at INTEGER, PRIMARY KEY (k, ref))'); // (the LRCLIB pointer for a song)
    this.ip = new Map(); // per-IP token bucket (this shard only; IPs spread across shards)
  }
  take(ip) {
    const now = Date.now(), b = this.ip.get(ip) || { t: IP.burst, at: now };
    b.t = Math.min(IP.burst, b.t + (now - b.at) / 1000 * IP.rate); b.at = now;
    if (this.ip.size > 5000) this.ip.clear(); // (bounded; it's only anti-spam)
    if (b.t < 1) { this.ip.set(ip, b); return false; }
    b.t -= 1; this.ip.set(ip, b); return true;
  }
  async fetch(req) {
    const url = new URL(req.url), now = Date.now();
    if (req.method === 'GET') {
      const k = url.searchParams.get('k');
      const rows = this.sql.exec('SELECT vid FROM m WHERE k = ? AND votes >= ? AND at > ? ORDER BY votes DESC, at DESC LIMIT 3', k, TRUST, now - STALE).toArray();
      const lref = this.sql.exec('SELECT ref FROM lyr WHERE k = ? AND votes >= ? AND at > ? ORDER BY votes DESC, at DESC LIMIT 1', k, TRUST, now - STALE).toArray();
      return json({ ids: rows.map(r => r.vid), lyr: lref[0]?.ref || '' });
    }
    // POST: one vote for (k, id)
    if (!this.take(req.headers.get('X-IP') || '0')) return json({ error: 'slow down' }, 429);
    const { k, id, lyr } = await req.json();
    if (VID.test(id || '')) this.sql.exec('INSERT INTO m (k, vid, votes, at) VALUES (?, ?, 1, ?) ON CONFLICT (k, vid) DO UPDATE SET votes = min(votes + 1, ?), at = ?', k, id, now, VOTE_CAP, now);
    if (LYR.test(lyr || '')) this.sql.exec('INSERT INTO lyr (k, ref, votes, at) VALUES (?, ?, 1, ?) ON CONFLICT (k, ref) DO UPDATE SET votes = min(votes + 1, ?), at = ?', k, lyr, now, VOTE_CAP, now);
    if (Math.random() < 0.02) { this.sql.exec('DELETE FROM m WHERE at < ?', now - STALE); this.sql.exec('DELETE FROM lyr WHERE at < ?', now - STALE); } // (prune stale, now and then)
    return json({ ok: true });
  }
}
