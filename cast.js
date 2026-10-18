// NetherFlow - Copyright (C) 2026 Volodya.rua - GNU GPL v3 only, with additional terms (credit, name and logo): see LICENSE and NOTICE.
// Casting: the song played on a TV or a speaker in the house, by their own open protocols — Google Cast's (Chromecast,
// Google TV and Android TVs, Nest speakers) and DLNA's (smart TVs, Sonos and other speakers) — over the house's own
// network, with no library of Google's. The device plays the song's stream address itself (as FlowStream's always are:
// nothing passes through any server of ours); this tells it what to play, from where, and asks how it's getting on.
// The platform hands it the network (desktop: castnet.js, through preload.js; Android: CastPlugin.java), only ever to
// addresses in the house:
//   udp(group, port, bytes, ms) → [{ from, data }]   a question to the house's devices, and their answers
//   tls(host, port, onData(bytes), onClose()) → { write(bytes), close() }   a Cast device (its own certificate taken)
//   http(method, url, headers, body) → { status, text }   a DLNA device
//
//   const c = NFCast.create({ net });  await c.devices(ms) → [{ id, kind ('cast' | 'dlna'), name, model, … }]
//   const s = await c.open(device);  await s.load({ url, mime, title, artist, album, art, at });  s.play() s.pause()
//   s.seek(t) s.volume(0–1) s.close();  s.onstatus = { state ('playing' 'paused' 'buffering' 'idle' 'ended' 'error'), t, dur }
//   s.onclose = () => …  (the device let go: turned off, another phone took it)
(function (out) {
  'use strict';
  const enc = new TextEncoder(), dec = new TextDecoder();
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const privateHost = h => /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.)\d+\.\d+(\.\d+)?$/.test(h || '');
  const xml = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]);
  const unxml = s => String(s || '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
  const tag = (x, name) => unxml(((x || '').match(new RegExp(`<(?:\\w+:)?${name}[^>]*>([\\s\\S]*?)</(?:\\w+:)?${name}>`, 'i')) || [])[1] || '').trim();
  const hms = t => { t = Math.max(0, Math.floor(t || 0)); return `${Math.floor(t / 3600)}:${String(Math.floor(t / 60) % 60).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`; };
  const secs = s => String(s || '').split(':').reduce((a, n) => a * 60 + (parseFloat(n) || 0), 0);

  // ---- finding them: Google Cast's devices answer mDNS (_googlecast._tcp.local); DLNA's media renderers, SSDP. Each
  // question from a port of its own, so the answers come straight back to it (no listening on the shared ports).
  function mdnsQuery(name) {
    const b = [0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0];
    for (const p of name.split('.')) { const e = enc.encode(p); b.push(e.length, ...e); }
    b.push(0, 0, 12, 0x80, 1); // (PTR, class IN with the unicast-answer bit)
    return new Uint8Array(b);
  }
  // an mDNS answer → { name (its TXT fn), model (md), port (its SRV's) }, or null
  function mdnsParse(d) {
    if (!d || d.length < 12) return null;
    const v = new DataView(d.buffer, d.byteOffset, d.byteLength), n16 = i => v.getUint16(i);
    const name = (i, hops = 0) => { const parts = []; for (;;) { if (i >= d.length) return [parts.join('.'), i]; const l = d[i];
      if (l === 0) return [parts.join('.'), i + 1];
      if ((l & 0xc0) === 0xc0) { if (hops > 10) return [parts.join('.'), i + 2]; return [[...parts, name(((l & 0x3f) << 8) | d[i + 1], hops + 1)[0]].filter(Boolean).join('.'), i + 2]; }
      parts.push(dec.decode(d.subarray(i + 1, i + 1 + l))); i += 1 + l; } };
    let i = 12;
    for (let q = n16(4); q > 0; q--) { i = name(i)[1] + 4; }
    const out = { name: '', model: '', port: 8009, cast: false, id: '' };
    for (let r = n16(6) + n16(8) + n16(10); r > 0 && i + 10 <= d.length; r--) {
      const [rn, j] = name(i), type = n16(j), len = n16(j + 8), at = j + 10;
      if (/_googlecast\._tcp/i.test(rn)) out.cast = true;
      if (type === 33 && at + 6 <= d.length) out.port = n16(at + 4); // SRV
      if (type === 16) for (let k = at; k < at + len && k < d.length;) { const l = d[k], s = dec.decode(d.subarray(k + 1, k + 1 + l)); k += 1 + l; // TXT
        const [key, ...val] = s.split('='); if (key === 'fn') out.name = val.join('='); if (key === 'md') out.model = val.join('='); if (key === 'id') out.id = val.join('='); }
      i = at + len;
    }
    return out.cast ? out : null;
  }
  const SSDP = 'M-SEARCH * HTTP/1.1\r\nHOST: 239.255.255.250:1900\r\nMAN: "ssdp:discover"\r\nMX: 2\r\nST: urn:schemas-upnp-org:device:MediaRenderer:1\r\n\r\n';
  // a DLNA renderer's description (its LOCATION) → its name, and where to send its AVTransport and RenderingControl commands
  async function dlnaDescribe(net, location) {
    const r = await net.http('GET', location, {}, '');
    if (r.status >= 400) return null;
    const x = r.text, base = tag(x, 'URLBase') || location, service = id => {
      const s = (x.match(/<service>[\s\S]*?<\/service>/gi) || []).find(b => new RegExp(`service:${id}:`).test(tag(b, 'serviceType')));
      try { return s ? new URL(tag(s, 'controlURL'), base).href : ''; } catch { return ''; }
    };
    const av = service('AVTransport');
    return av ? { name: tag(x, 'friendlyName') || 'TV or speaker', model: [tag(x, 'manufacturer'), tag(x, 'modelName')].filter(Boolean).join(' '), av, rc: service('RenderingControl') } : null;
  }

  // ---- Google Cast: its CASTV2 messages over TLS (port 8009): each a 4-byte length, then a protobuf CastMessage —
  // protocol_version 1, source_id 2, destination_id 3, namespace 4, payload_type 5 (0: text), payload_utf8 6
  const NS = { conn: 'urn:x-cast:com.google.cast.tp.connection', beat: 'urn:x-cast:com.google.cast.tp.heartbeat',
    recv: 'urn:x-cast:com.google.cast.receiver', media: 'urn:x-cast:com.google.cast.media' };
  const APP = 'CC1AD845'; // (the Default Media Receiver: Google's own player on every Cast device)
  const varint = n => { const b = []; while (n > 127) { b.push((n & 127) | 128); n >>>= 7; } b.push(n); return b; };
  const lenField = (no, bytes) => [(no << 3) | 2, ...varint(bytes.length), ...bytes];
  function castFrame(src, dst, ns, obj) {
    const body = [8, 0, ...lenField(2, enc.encode(src)), ...lenField(3, enc.encode(dst)), ...lenField(4, enc.encode(ns)), 40, 0, ...lenField(6, enc.encode(JSON.stringify(obj)))];
    const f = new Uint8Array(4 + body.length); new DataView(f.buffer).setUint32(0, body.length); f.set(body, 4);
    return f;
  }
  function castRead(b) { // a CastMessage's bytes → { src, dst, ns, payload }
    const m = {}; let i = 0;
    const vi = () => { let n = 0, s = 0, c; do { c = b[i++]; n |= (c & 127) << s; s += 7; } while (c & 128 && i < b.length); return n >>> 0; };
    while (i < b.length) {
      const t = vi(), no = t >> 3, wt = t & 7;
      if (wt === 0) vi();
      else if (wt === 2) { const l = vi(), s = b.subarray(i, i + l); i += l; if (no === 2) m.src = dec.decode(s); else if (no === 3) m.dst = dec.decode(s); else if (no === 4) m.ns = dec.decode(s); else if (no === 6) m.payload = dec.decode(s); }
      else break;
    }
    return m;
  }
  async function castOpen(net, d) {
    let buf = new Uint8Array(0), sock = null, req = 1, to = null, mediaId = null, appSession = null, lastPong = Date.now(), closed = false, last = null;
    const waits = new Map(), timers = [];
    const s = { onstatus: null, onclose: null, kind: 'cast', name: d.name, get last() { return last; } };
    const send = (dst, ns, obj) => sock && sock.write(castFrame('sender-nf', dst, ns, obj));
    const ask = (dst, ns, obj, ms = 10000) => new Promise((ok, no) => {
      const id = req++, t = setTimeout(() => { waits.delete(id); no(new Error('the device didn\'t answer')); }, ms);
      waits.set(id, { ok, no, t }); send(dst, ns, { ...obj, requestId: id });
    });
    const status = st => {
      if (!st) return;
      mediaId = st.mediaSessionId ?? mediaId;
      const ps = st.playerState, dur = st.media?.duration ?? last?.dur ?? 0;
      const state = ps === 'PLAYING' ? 'playing' : ps === 'PAUSED' ? 'paused' : ps === 'BUFFERING' || ps === 'LOADING' ? 'buffering'
        : st.idleReason === 'FINISHED' ? 'ended' : st.idleReason === 'ERROR' ? 'error' : 'idle';
      last = { state, t: typeof st.currentTime === 'number' ? st.currentTime : last?.t || 0, dur, at: Date.now() };
      s.onstatus?.(last);
    };
    const gone = () => { if (closed) return; closed = true; for (const t of timers) clearInterval(t); for (const w of waits.values()) { clearTimeout(w.t); w.no(new Error('the device let go')); } waits.clear(); try { sock?.close(); } catch {} s.onclose?.(); };
    const onMsg = m => {
      let j; try { j = JSON.parse(m.payload || '{}'); } catch { return; }
      if (m.ns === NS.beat) { if (j.type === 'PING') send(m.src, NS.beat, { type: 'PONG' }); else if (j.type === 'PONG') lastPong = Date.now(); return; }
      if (m.ns === NS.conn && j.type === 'CLOSE') { if (m.src !== 'receiver-0' && m.src === to) return gone(); return; }
      const w = j.requestId && waits.get(j.requestId);
      if (w) { waits.delete(j.requestId); clearTimeout(w.t); /FAILED|INVALID|ERROR/.test(j.type) ? w.no(new Error(j.reason || j.detailedErrorCode || j.type)) : w.ok(j); }
      if (j.type === 'MEDIA_STATUS') status((j.status || [])[0]);
      if (j.type === 'RECEIVER_STATUS' && to && !(j.status?.applications || []).some(a => a.transportId === to)) gone(); // (another app on it now)
    };
    sock = await net.tls(d.host, d.port || 8009, bytes => {
      const b = new Uint8Array(buf.length + bytes.length); b.set(buf); b.set(bytes, buf.length); buf = b;
      while (buf.length >= 4) { const l = new DataView(buf.buffer, buf.byteOffset).getUint32(0); if (buf.length < 4 + l) break; const m = castRead(buf.subarray(4, 4 + l)); buf = buf.slice(4 + l); onMsg(m); }
    }, gone);
    send('receiver-0', NS.conn, { type: 'CONNECT' });
    timers.push(setInterval(() => { send('receiver-0', NS.beat, { type: 'PING' }); if (Date.now() - lastPong > 20000) gone(); }, 5000));
    const launched = await ask('receiver-0', NS.recv, { type: 'LAUNCH', appId: APP }, 20000);
    const app = (launched.status?.applications || []).find(a => a.appId === APP);
    if (!app) { gone(); throw new Error('the device didn\'t open its player'); }
    to = app.transportId; appSession = app.sessionId;
    send(to, NS.conn, { type: 'CONNECT' });
    timers.push(setInterval(() => { if (to && mediaId != null) send(to, NS.media, { type: 'GET_STATUS', mediaSessionId: mediaId, requestId: 0 }); }, 1500)); // (where it's at, a second and a half apart)
    const media = c => c && to && mediaId != null && send(to, NS.media, { type: c.type, mediaSessionId: mediaId, requestId: req++, ...c });
    Object.assign(s, {
      async load({ url, mime, title, artist, album, art, at = 0, dur = 0 }) {
        mediaId = null;
        const r = await ask(to, NS.media, { type: 'LOAD', autoplay: true, currentTime: at, media: { contentId: url, contentType: mime || 'audio/mp4', streamType: 'BUFFERED', ...(dur && { duration: dur }),
          metadata: { metadataType: 3, title: title || '', artist: artist || '', albumName: album || '', images: art ? [{ url: art }] : [] } } }, 25000);
        status((r.status || [])[0]);
      },
      play: () => media({ type: 'PLAY' }), pause: () => media({ type: 'PAUSE' }), seek: t => media({ type: 'SEEK', currentTime: Math.max(0, t) }),
      volume: v => send('receiver-0', NS.recv, { type: 'SET_VOLUME', volume: { level: Math.max(0, Math.min(1, v)) }, requestId: req++ }),
      close() { if (closed) return; try { if (appSession) send('receiver-0', NS.recv, { type: 'STOP', sessionId: appSession, requestId: req++ }); } catch {} setTimeout(gone, 300); },
    });
    return s;
  }

  // ---- DLNA: SOAP to the renderer's AVTransport (what plays) and RenderingControl (its volume); asked where it's at
  // a second apart (it says nothing by itself)
  const AV = 'urn:schemas-upnp-org:service:AVTransport:1', RC = 'urn:schemas-upnp-org:service:RenderingControl:1';
  async function dlnaOpen(net, d) {
    let closed = false, last = null, playing = false, loadAt = 0;
    const s = { onstatus: null, onclose: null, kind: 'dlna', name: d.name, get last() { return last; } };
    const soap = async (url, svc, action, args = {}) => {
      const body = '<?xml version="1.0" encoding="utf-8"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/"><s:Body>'
        + `<u:${action} xmlns:u="${svc}">${Object.entries({ InstanceID: 0, ...args }).map(([k, v]) => `<${k}>${xml(v)}</${k}>`).join('')}</u:${action}></s:Body></s:Envelope>`;
      const r = await net.http('POST', url, { 'Content-Type': 'text/xml; charset="utf-8"', SOAPACTION: `"${svc}#${action}"` }, body);
      if (r.status >= 400) throw new Error(`the device said no (${tag(r.text, 'errorDescription') || tag(r.text, 'faultstring') || r.status})`);
      return r.text;
    };
    let fails = 0;
    const poll = setInterval(async () => {
      if (closed) return;
      try {
        const [ti, pi] = await Promise.all([soap(d.av, AV, 'GetTransportInfo'), soap(d.av, AV, 'GetPositionInfo')]);
        fails = 0;
        const ts = tag(ti, 'CurrentTransportState'), t = secs(tag(pi, 'RelTime')), dur = secs(tag(pi, 'TrackDuration')) || last?.dur || 0;
        if (ts === 'PLAYING') playing = true;
        // (stopped after playing, near its end, or a while after it began: the song over)
        const state = ts === 'PLAYING' ? 'playing' : ts === 'PAUSED_PLAYBACK' ? 'paused' : ts === 'TRANSITIONING' ? 'buffering'
          : playing && (dur && (last?.t || 0) > dur - 4 || Date.now() - loadAt > 8000) ? 'ended' : 'idle';
        if (state === 'ended') playing = false;
        last = { state, t: t || (state === 'ended' ? dur : last?.t || 0), dur, at: Date.now() };
        s.onstatus?.(last);
      } catch { if (++fails > 8) s.close(); } // (gone ten seconds: turned off, or off the network)
    }, 1000);
    Object.assign(s, {
      async load({ url, mime, title, artist, album, art, at = 0 }) {
        const didl = '<DIDL-Lite xmlns="urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:upnp="urn:schemas-upnp-org:metadata-1-0/upnp/">'
          + `<item id="0" parentID="-1" restricted="1"><dc:title>${xml(title)}</dc:title><dc:creator>${xml(artist)}</dc:creator><upnp:artist>${xml(artist)}</upnp:artist><upnp:album>${xml(album)}</upnp:album>`
          + (art ? `<upnp:albumArtURI>${xml(art)}</upnp:albumArtURI>` : '') + `<upnp:class>object.item.audioItem.musicTrack</upnp:class><res protocolInfo="http-get:*:${xml(mime || 'audio/mp4')}:*">${xml(url)}</res></item></DIDL-Lite>`;
        playing = false; loadAt = Date.now();
        await soap(d.av, AV, 'SetAVTransportURI', { CurrentURI: url, CurrentURIMetaData: didl });
        await soap(d.av, AV, 'Play', { Speed: 1 });
        if (at > 1) { for (let i = 0; i < 10 && last?.state !== 'playing'; i++) await sleep(500); await soap(d.av, AV, 'Seek', { Unit: 'REL_TIME', Target: hms(at) }).catch(() => {}); }
      },
      play: () => soap(d.av, AV, 'Play', { Speed: 1 }).catch(() => {}), pause: () => soap(d.av, AV, 'Pause').catch(() => {}),
      seek: t => soap(d.av, AV, 'Seek', { Unit: 'REL_TIME', Target: hms(t) }).catch(() => {}),
      volume: v => d.rc && soap(d.rc, RC, 'SetVolume', { Channel: 'Master', DesiredVolume: Math.round(Math.max(0, Math.min(1, v)) * 100) }).catch(() => {}),
      close() { if (closed) return; closed = true; clearInterval(poll); soap(d.av, AV, 'Stop').catch(() => {}); s.onclose?.(); },
    });
    return s;
  }

  class Caster {
    constructor({ net }) { this.net = net; }
    // the TVs and speakers that answer within ms (a device both Cast and DLNA: Cast's, the better of the two)
    async devices(ms = 2500) {
      const [casts, renderers] = await Promise.all([
        this.net.udp('224.0.0.251', 5353, mdnsQuery('_googlecast._tcp.local'), ms).catch(() => []),
        this.net.udp('239.255.255.250', 1900, enc.encode(SSDP), ms).catch(() => []),
      ]);
      const out = new Map();
      for (const a of casts) { if (!privateHost(a.from)) continue; const c = mdnsParse(a.data); if (c && !out.has('cast:' + a.from)) out.set('cast:' + a.from, { id: 'cast:' + a.from, kind: 'cast', name: c.name || 'Cast device', model: c.model, host: a.from, port: c.port }); }
      const locs = new Map();
      for (const a of renderers) { const loc = (dec.decode(a.data).match(/^LOCATION:\s*(\S+)/im) || [])[1]; try { if (loc && privateHost(new URL(loc).hostname) && !locs.has(loc)) locs.set(loc, a.from); } catch {} }
      await Promise.all([...locs].map(async ([loc, host]) => {
        if (out.has('cast:' + host)) return;
        const d = await Promise.race([dlnaDescribe(this.net, loc).catch(() => null), sleep(3000).then(() => null)]);
        if (d) out.set('dlna:' + loc, { id: 'dlna:' + loc, kind: 'dlna', host, ...d });
      }));
      return [...out.values()].sort((a, b) => a.name.localeCompare(b.name));
    }
    open(d) { if (!privateHost(d.host)) throw new Error('not a device in the house'); return d.kind === 'cast' ? castOpen(this.net, d) : dlnaOpen(this.net, d); }
  }
  out.create = opts => new Caster(opts);
  out._test = { mdnsQuery, mdnsParse, castFrame, castRead, privateHost, hms, secs }; // (for its checks)
})(typeof module === 'object' && module.exports ? module.exports : (self.NFCast = {}));
