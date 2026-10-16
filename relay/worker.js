// NetherFlow - Copyright (C) 2026 Volodya.rua - GNU GPL v3 only, with additional terms (credit, name and logo): see LICENSE and NOTICE.
// NetherFlow's own relay, for Listen together and playlists edited together: a Cloudflare Worker (the free plan) that
// speaks the little of MQTT 3.1.1 the app's client does (connect, subscribe, publish at QoS 0, retain, ping), over a
// WebSocket. Each topic is one Durable Object, which the app names in the address (?t=), so its members meet there.
// It passes on only what the app sends, already end-to-end encrypted (it can't read it), and only NetherFlow's topics:
//   nf2/<32 hex>    Listen together: passed on live, nothing kept
//   nf1/l<32 hex>   a playlist edited together: passed on, and its latest copy kept for whoever opens it next, deleted
//                   after a year without a change
// Nothing is logged: no console output, and the Worker's observability off (wrangler.toml). Deploy: npx wrangler deploy
const TOPIC = /^(nf2\/[0-9a-f]{32}|nf1\/l[0-9a-f]{32})$/;
const KEEP = 365 * 864e5; // a kept copy, after its last change
const LIMITS = { // per topic: people at once, the biggest message, and messages a person may send (a burst, then per second)
  nf2: { conns: 12, size: 16384, burst: 40, rate: 6 },
  nf1: { conns: 50, size: 262144, burst: 10, rate: 0.5 },
};

export default {
  async fetch(req, env) {
    const url = new URL(req.url), t = url.searchParams.get('t') || '';
    if (url.pathname !== '/mqtt' || !TOPIC.test(t) || req.headers.get('Upgrade') !== 'websocket') return new Response('Not found', { status: 404 });
    return env.TOPICS.get(env.TOPICS.idFromName(t)).fetch(req);
  },
};

// remaining length, as MQTT writes it
const len = n => { const b = []; do { let x = n % 128; n = Math.floor(n / 128); if (n) x |= 128; b.push(x); } while (n); return b; };
const packet = (head, ...parts) => { const n = parts.reduce((a, p) => a + p.length, 0), h = [head, ...len(n)], out = new Uint8Array(h.length + n); out.set(h); let i = h.length; for (const p of parts) { out.set(p, i); i += p.length; } return out; };
const str = s => { const b = new TextEncoder().encode(s); return new Uint8Array([b.length >> 8, b.length & 255, ...b]); };

export class Topic {
  constructor(ctx) { this.ctx = ctx; }

  async fetch(req) {
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

  async alarm() { // a year without a change: the kept copy deleted
    const changed = await this.ctx.storage.get('changed');
    if (!changed || Date.now() - changed >= KEEP) await this.ctx.storage.deleteAll();
    else await this.ctx.storage.setAlarm(changed + KEEP);
  }

  webSocketClose(ws) { try { ws.close(1000); } catch {} } // (never the code it closed with: 1005 and 1006 can't be sent)
  webSocketError() {}
}
