// NetherFlow - Copyright (C) 2026 Volodya.rua - GNU GPL v3 only, with additional terms (credit, name and logo): see LICENSE and NOTICE.
// NetherFlow's own relay, for Listen together and playlists edited together: a Cloudflare Worker (the free plan) that
// speaks the little of MQTT 3.1.1 the app's client does (connect, subscribe, publish at QoS 0, retain, ping), over a
// WebSocket. Each topic is one Durable Object, which the app names in the address (?t=), so its members meet there.
// It passes on only what the app sends, already end-to-end encrypted (it can't read it), and only NetherFlow's topics:
//   nf2/<32 hex>    Listen together: passed on live, nothing kept
//   nf1/l<32 hex>   a playlist edited together: passed on, and its latest copy kept for whoever opens it next, deleted
//                   after a year without a change
// And a shared playlist's short link (/s/<12 letters and numbers>, plain HTTP): its songs, encrypted by the app with a
// key that's only in the link (after #: never sent here), put once (never replaced) and given back to whoever opens the
// link; deleted a year after it was last opened, or when its maker stops sharing it (a delete token only the app that
// made it holds: its hash is kept with the copy), or by NetherFlow's developer on a valid notice (Terms §8):
//   curl -X DELETE -H "Authorization: Bearer $(cat ~/.netherflow-signing/relay-admin.key)" https://netherflow-relay.netherflow.workers.dev/s/<id>
// (<id>: the 12 letters and numbers after #s. in the link reported. The key: a Worker secret, set once with
//  npx wrangler secret put ADMIN_KEY — never in this repository.)
// And NetherFlow's install count (the app's Count me once; the README's badge): one number, and nothing else. An install
// sends POST /c once, when its terms are agreed to with Count me once ticked: an empty request, which adds 1 to it; GET /c
// gives the number to shields.io for the badge. Kept: that number. Never kept: an address, a device, a time, or anything
// sent with a request (an address is held in this Worker's memory only, to stop one sending many: 3 counts an hour,
// forgotten after an hour unused, or when the Worker is evicted; never stored). And GET /dl, the downloads badge: how many times NetherFlow's installers and APKs were
// downloaded from its GitHub releases, added up from GitHub's own counts at most once an hour.
// Nothing is logged: no console output, and the Worker's observability off (wrangler.toml). Deploy: npx wrangler deploy
const TOPIC = /^(nf2\/[0-9a-f]{32}|nf1\/l[0-9a-f]{32})$/;
const KEEP = 365 * 864e5; // a kept copy, after its last change
const LIMITS = { // per topic: people at once, the biggest message, and messages a person may send (a burst, then per second)
  nf2: { conns: 32, size: 16384, burst: 40, rate: 6 }, // (Listen together: up to 30, and room for one on its way out)
  nf1: { conns: 50, size: 262144, burst: 10, rate: 0.5 },
};

const SHARE = /^\/s\/([A-Za-z0-9]{12})$/, SHARE_MAX = 256 * 1024; // (a short link's copy: the biggest — a 10,000-song playlist of any kind, with room; a bigger one gets the long link)
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, PUT, POST, DELETE, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, X-Delete-Hash, X-Delete-Token, Authorization', 'Access-Control-Max-Age': '86400' };
// (per address: so many at once, then so many an hour — held only in this Worker's memory, never stored or logged, and
// forgotten after an hour unused (its allowance whole again anyway) or when the Worker is evicted)
const limit = (burst, hourly) => {
  const m = new Map(); // (in the order they were last used: the oldest first)
  return ip => {
    const now = Date.now();
    for (const [k, v] of m) { if (now - v.at < 3600e3) break; m.delete(k); }
    const b = m.get(ip) || { tokens: burst, at: now }; b.tokens = Math.min(burst, b.tokens + (now - b.at) * hourly / 3600e3); b.at = now;
    m.delete(ip); if (m.size >= 5000) m.clear(); m.set(ip, b);
    if (b.tokens < 1) return false; b.tokens -= 1; return true;
  };
};
const putOk = limit(20, 20); // (short links made)
const countOk = limit(3, 3); // (counts: loose — a school's or a phone network's people can share one address)
// (an address as the count's limit takes it: IPv4 whole, IPv6 by its first half — a /64, one home's or one phone's, so
// the countless addresses in it are one)
const ipKey = ip => {
  if (!ip.includes(':') || ip.includes('.')) return ip;
  const [a, b] = ip.split('::'), h = a ? a.split(':') : [], t = b ? b.split(':') : [];
  return (b === undefined ? h : [...h, ...Array(Math.max(0, 8 - h.length - t.length)).fill('0'), ...t]).slice(0, 4).join(':');
};
// a badge's number, as shields.io's endpoint badge takes it (the README's), kept an hour by whoever passes it on
const badge = (label, n) => new Response(JSON.stringify({ schemaVersion: 1, label, message: String(n) }), { headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=3600' } });
// NetherFlow's downloads from its GitHub releases: its installers and APKs only (not update.json, latest.yml, the block
// maps and SHA256SUMS, which update checks fetch: most of GitHub's own total). GITHUB_TOKEN, if it's set (a Worker secret:
// npx wrangler secret put GITHUB_TOKEN — never in this repository), lifts GitHub's limit for asking without one, which
// the addresses Cloudflare shares with others can use up.
const INSTALLERS = /\.(exe|apk|deb|AppImage)$/;
const sumDownloads = async token => {
  let n = 0;
  for (let page = 1; page <= 10; page++) { // ponytail: 1,000 releases at most, each page read whole; GitHub's GraphQL (with the token) if it ever has that many
    const r = await fetch(`https://api.github.com/repos/volodya-rua/NetherFlow/releases?per_page=100&page=${page}`,
      { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'netherflow-relay', ...(token ? { Authorization: 'Bearer ' + token } : {}) } });
    if (!r.ok) throw new Error('GitHub ' + r.status);
    const list = await r.json();
    for (const rel of list) for (const a of rel.assets) if (INSTALLERS.test(a.name)) n += a.download_count;
    if (list.length < 100) break;
  }
  return n;
};

export default {
  async fetch(req, env) {
    const url = new URL(req.url), t = url.searchParams.get('t') || '', s = url.pathname.match(SHARE);
    if (s) {
      if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
      if (!['GET', 'PUT', 'DELETE'].includes(req.method)) return new Response('Not found', { status: 404, headers: CORS });
      if (req.method === 'PUT' && !putOk(req.headers.get('CF-Connecting-IP') || '')) return new Response('Slow down', { status: 429, headers: CORS });
      return env.TOPICS.get(env.TOPICS.idFromName('nf3/' + s[1])).fetch(req);
    }
    if (url.pathname === '/c' || url.pathname === '/dl') { // (the install count, POST adding 1; and the README's two badges)
      if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
      const add = req.method === 'POST' && url.pathname === '/c';
      if (!add && req.method !== 'GET') return new Response('Not found', { status: 404, headers: CORS });
      if (add && !countOk(ipKey(req.headers.get('CF-Connecting-IP') || ''))) return new Response('Slow down', { status: 429, headers: CORS });
      // (handed on bare, the method alone: nothing the app or its connection sent reaches the object that keeps the number)
      return env.TOPICS.get(env.TOPICS.idFromName('nf4' + url.pathname)).fetch(new Request(url.origin + url.pathname, { method: req.method }));
    }
    if (url.pathname !== '/mqtt' || !TOPIC.test(t) || req.headers.get('Upgrade') !== 'websocket') return new Response('Not found', { status: 404 });
    return env.TOPICS.get(env.TOPICS.idFromName(t)).fetch(req);
  },
};

// remaining length, as MQTT writes it
const len = n => { const b = []; do { let x = n % 128; n = Math.floor(n / 128); if (n) x |= 128; b.push(x); } while (n); return b; };
const packet = (head, ...parts) => { const n = parts.reduce((a, p) => a + p.length, 0), h = [head, ...len(n)], out = new Uint8Array(h.length + n); out.set(h); let i = h.length; for (const p of parts) { out.set(p, i); i += p.length; } return out; };
const str = s => { const b = new TextEncoder().encode(s); return new Uint8Array([b.length >> 8, b.length & 255, ...b]); };

export class Topic {
  constructor(ctx, env) { this.ctx = ctx; this.env = env; }

  async fetch(req) {
    const path = new URL(req.url).pathname;
    if (path.startsWith('/s/')) return this.share(req);
    if (path === '/c') return this.count(req.method === 'POST');
    if (path === '/dl') return this.downloads();
    const t = new URL(req.url).searchParams.get('t'), L = LIMITS[t.slice(0, 3)];
    if (this.ctx.getWebSockets().length >= L.conns) return new Response('Full', { status: 429 });
    const [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server); // (hibernating between messages: nothing to pay while it's quiet)
    server.serializeAttachment({ t, connected: false, subscribed: false, tokens: L.burst, at: Date.now() });
    return new Response(null, { status: 101, webSocket: client, headers: { 'Sec-WebSocket-Protocol': 'mqtt' } });
  }

  async webSocketMessage(ws, data) {
    const s = ws.deserializeAttachment(), L = LIMITS[s.t.slice(0, 3)];
    if (typeof data === 'string') return ws.close(1003, 'binary only');
    const b = new Uint8Array(data);
    for (let p = 0; p < b.length;) { // (a frame may hold several packets)
      let n = 0, mul = 1, i = p + 1, c;
      do { if (i >= b.length || mul > 128 ** 3) return ws.close(1002, 'bad packet'); c = b[i++]; n += (c & 127) * mul; mul *= 128; } while (c & 128);
      if (i + n > b.length) return ws.close(1002, 'partial packet');
      const head = b[p], type = head >> 4, body = b.subarray(i, i + n);
      p = i + n;
      if (type === 1) { s.connected = true; ws.send(new Uint8Array([0x20, 2, 0, 0])); } // CONNECT → CONNACK
      else if (!s.connected) return ws.close(1002, 'connect first');
      else if (type === 8) { // SUBSCRIBE (one topic, this one) → SUBACK, then the kept copy
        const tl = (body[2] << 8) | body[3], topic = new TextDecoder().decode(body.subarray(4, 4 + tl));
        if (topic !== s.t) return ws.close(1008, 'not this topic');
        s.subscribed = true;
        ws.send(new Uint8Array([0x90, 3, body[0], body[1], 0]));
        const kept = s.t.startsWith('nf1') && await this.ctx.storage.get('copy');
        if (kept?.byteLength) ws.send(packet(0x31, str(s.t), new Uint8Array(kept)));
      } else if (type === 3) { // PUBLISH
        if (head & 6) return ws.close(1002, 'QoS 0 only');
        const tl = (body[0] << 8) | body[1], topic = new TextDecoder().decode(body.subarray(2, 2 + tl)), payload = body.subarray(2 + tl);
        if (topic !== s.t) return ws.close(1008, 'not this topic');
        if (payload.length > L.size) return ws.close(1009, 'too big');
        const now = Date.now(); // (a token bucket: a burst, then so many a second; over it, dropped)
        s.tokens = Math.min(L.burst, s.tokens + (now - s.at) / 1000 * L.rate); s.at = now;
        if (s.tokens < 1) continue;
        s.tokens -= 1;
        const out = packet(0x30, str(s.t), payload);
        for (const o of this.ctx.getWebSockets()) if (o.deserializeAttachment()?.subscribed) try { o.send(out); } catch {}
        if (head & 1 && s.t.startsWith('nf1')) { // retain: the latest copy kept (an empty one: none kept)
          if (payload.length) { await this.ctx.storage.put({ copy: payload.slice().buffer, changed: now }); await this.ctx.storage.setAlarm(now + KEEP); }
          else await this.ctx.storage.deleteAll();
        }
      } else if (type === 12) ws.send(new Uint8Array([0xd0, 0])); // PINGREQ → PINGRESP
      else if (type === 14) return ws.close(1000, 'bye'); // DISCONNECT
      else return ws.close(1002, 'not supported');
    }
    ws.serializeAttachment(s);
  }

  // a short link's copy: given (its year started again — written at most once a day), put once, or deleted — by its
  // maker's token, or the developer's key
  async share(req) {
    const now = Date.now(), sha = async s => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))].map(b => b.toString(16).padStart(2, '0')).join('');
    if (req.method === 'DELETE') {
      if (!(await this.ctx.storage.get('copy'))) return new Response('Not found', { status: 404, headers: CORS });
      const auth = req.headers.get('Authorization') || '', token = req.headers.get('X-Delete-Token') || '', del = await this.ctx.storage.get('del');
      const admin = !!this.env.ADMIN_KEY && auth.startsWith('Bearer ') && await sha(auth.slice(7)) === await sha(this.env.ADMIN_KEY); // (compared as hashes: no timing to learn from)
      const maker = !!del && /^[\w-]{22,64}$/.test(token) && await sha(token) === del;
      if (!admin && !maker) return new Response('Not yours', { status: 403, headers: CORS });
      await this.ctx.storage.deleteAll(); await this.ctx.storage.deleteAlarm();
      return new Response(null, { status: 204, headers: CORS });
    }
    if (req.method === 'GET') {
      const copy = await this.ctx.storage.get('copy');
      if (!copy) return new Response('Not found', { status: 404, headers: CORS });
      if (now - (await this.ctx.storage.get('changed') || 0) > 864e5) { await this.ctx.storage.put('changed', now); await this.ctx.storage.setAlarm(now + KEEP); }
      return new Response(copy, { headers: { ...CORS, 'Content-Type': 'application/octet-stream', 'Cache-Control': 'no-store' } });
    }
    if (await this.ctx.storage.get('copy')) return new Response('Taken', { status: 409, headers: CORS }); // (never replaced: a link always opens what was shared)
    if (+req.headers.get('Content-Length') > SHARE_MAX) return new Response('Too big', { status: 413, headers: CORS });
    const copy = await req.arrayBuffer();
    if (!copy.byteLength || copy.byteLength > SHARE_MAX) return new Response('Too big', { status: 413, headers: CORS });
    const del = (req.headers.get('X-Delete-Hash') || '').toLowerCase(); // (its maker's delete token's SHA-256: kept, the token never sent here until it's used)
    await this.ctx.storage.put({ copy, changed: now, ...(/^[0-9a-f]{64}$/.test(del) ? { del } : {}) }); await this.ctx.storage.setAlarm(now + KEEP);
    return new Response(null, { status: 201, headers: CORS });
  }

  // the install count (object nf4/c): one number, and 1 added to it (never an alarm set here: alarm() below would delete it)
  async count(add) {
    const n = await this.ctx.storage.get('n') || 0;
    if (!add) return badge('counted installs', n);
    await this.ctx.storage.put('n', n + 1);
    return new Response(null, { status: 204, headers: CORS });
  }

  // the downloads (object nf4/dl): added up at most once an hour, the sum kept for the rest of it (and given while GitHub
  // can't be reached)
  async downloads() {
    const kept = await this.ctx.storage.get('dl');
    if (kept && Date.now() - kept.at < 3600e3) return badge('downloads', kept.n);
    this.summing ||= sumDownloads(this.env.GITHUB_TOKEN).then(async n => { await this.ctx.storage.put('dl', { n, at: Date.now() }); return n; })
      .finally(() => { this.summing = null; }); // (asked again meanwhile: the same look at GitHub)
    const n = await this.summing.catch(() => kept?.n);
    return n == null ? new Response('GitHub unreachable', { status: 502, headers: CORS }) : badge('downloads', n);
  }

  async alarm() { // a year without a change (a short link's: unopened): the kept copy deleted
    const changed = await this.ctx.storage.get('changed');
    if (!changed || Date.now() - changed >= KEEP) await this.ctx.storage.deleteAll();
    else await this.ctx.storage.setAlarm(changed + KEEP);
  }

  webSocketClose(ws) { try { ws.close(1000); } catch {} } // (never the code it closed with: 1005 and 1006 can't be sent)
  webSocketError() {}
}
