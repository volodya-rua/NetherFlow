// FlowStream for NetherFlow - Copyright (C) 2026 Volodya.rua - GNU GPL v3 only, with additional terms (credit, name and logo): see LICENSE and NOTICE.
// FlowStream, NetherFlow's playback engine. For a public video it finds the best public audio stream (Opus, format 251),
// and a video stream sized to the screen, as plain stream addresses
// the device then plays itself: nothing passes through any server of ours. One small request per song; each answer kept
// for as long as its addresses are good; the next songs looked up ahead, a little apart. The platform hands it its own
// way to make a request — post(url, body, headers) → Promise<string> — so the same code runs in Node (NetherFlow's
// desktop) and in the app's page on Android (CapacitorHttp).
//
//   const fs = FlowStream.create({ post })
//   await fs.audio(id)        { url, itag, mime, size, bitrate, loudnessDb, duration, expires, client (the one given it) }
//   await fs.video(id, { height: 1080, fps: 60, codecs: ['av01', 'vp9', 'avc1'] })   { url, itag, mime, width, height, fps, expires }
//   fs.prefetch([id, id, id]) the next songs, looked up ahead;  fs.forget(id) after its address stopped working
//
// Only public, unprotected streams: a format with DRM is never chosen, and nothing is signed in. A failure is a
// FlowStream.Error with a code (id, network, blocked, unplayable, drm, shape): NetherFlow then tries the song's next upload.
(function (out) {
  'use strict';
  const API = 'https://www.youtube.com/youtubei/v1/';
  // The clients this asks as, in turn, until one is given the video: the ones yt-dlp asks as that are given plain stream
  // addresses (its "visionos", its default when it has no JavaScript runtime; then its "android_vr", a spare for when
  // YouTube changes the first). See NOTICE.
  const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 15_7_3) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15';
  const CLIENTS = [
    { id: '101', client: { clientName: 'VISIONOS', clientVersion: '1.02', deviceMake: 'Apple', deviceModel: 'RealityDevice17,1', userAgent: UA, osName: 'visionOS', osVersion: '26.5.23O471' } },
    { id: '28', client: { clientName: 'ANDROID_VR', clientVersion: '1.65.10', deviceMake: 'Oculus', deviceModel: 'Quest 3', androidSdkVersion: 32, osName: 'Android', osVersion: '12L',
      userAgent: 'com.google.android.apps.youtube.vr.oculus/1.65.10 (Linux; U; Android 12L; eureka-user Build/SQ3A.220605.009.A1) gzip' } },
  ];
  const WEB_VERSION = '2.20261001.00.00';
  const AUDIO = [251, 140, 250, 249, 139]; // the best first: Opus (~130–160 kbps), then AAC, then the smaller ones
  const KEEP = 100; // answers kept, at most (the oldest go first)

  class FlowError extends Error { constructor(code, message) { super(message); this.name = 'FlowStream.Error'; this.code = code; } }
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  class Engine {
    // post: the platform's request; visitor/saveVisitor: the visitor id kept between runs (asked for once, otherwise);
    // hl, gl: language and country; gap: ms between the requests made ahead of time (never more than one at once)
    constructor({ post, visitor = '', saveVisitor, hl = 'en', gl = 'US', gap = 400 } = {}) {
      if (typeof post !== 'function') throw new TypeError('FlowStream: post(url, body, headers) is required');
      Object.assign(this, { post, visitorData: visitor, saveVisitor, hl, gl, gap, cache: new Map(), queue: Promise.resolve(), asked: 0 });
    }

    // a request and its JSON answer; a failed one asked once more, half a second later (a stray error page, a blip)
    async json(url, body, headers = {}, again = true) {
      let text;
      this.asked++;
      try {
        text = await this.post(url + '?prettyPrint=false', JSON.stringify(body), { 'Content-Type': 'application/json', 'User-Agent': UA, ...headers });
        return JSON.parse(text);
      } catch (e) {
        if (again) { await sleep(500); return this.json(url, body, headers, false); }
        throw text === undefined ? new FlowError('network', String(e?.message || e)) : new FlowError('shape', 'the answer wasn\'t JSON: ' + String(text).replace(/\s+/g, ' ').slice(0, 120));
      }
    }

    // the visitor id the player asks for (one per install, kept by the app): asked for once, again only when refused
    visitor(fresh = false) {
      if (this.visitorData && !fresh) return Promise.resolve(this.visitorData);
      return this.visitorAsk ||= this.json(API + 'visitor_id', { context: { client: { clientName: 'WEB', clientVersion: WEB_VERSION, hl: this.hl, gl: this.gl } } }, { Origin: 'https://www.youtube.com' })
        .then(j => {
          const v = j.responseContext?.visitorData;
          if (!v) throw new FlowError('shape', 'no visitor id');
          this.visitorData = v; this.saveVisitor?.(v);
          return v;
        }).finally(() => { this.visitorAsk = null; });
    }

    // the player's answer for a video: once while its addresses are good (asked again 5 minutes before they expire).
    // ahead: one looked up before it's needed, in line behind the others, a gap apart; asked for now, it goes first.
    player(id, { ahead = false } = {}) {
      if (!/^[\w-]{11}$/.test(String(id))) return Promise.reject(new FlowError('id', 'not a video id: ' + id));
      const had = this.cache.get(id);
      if (had && had.until > Date.now()) return had.p;
      const p = ahead ? this.queue.then(() => sleep(this.gap)).then(() => this.ask(id)) : this.ask(id);
      if (ahead) this.queue = p.catch(() => {}); // (the line goes on, a gap apart, whatever this one's answer)
      const entry = { p, until: Infinity };
      this.cache.delete(id); this.cache.set(id, entry);
      while (this.cache.size > KEEP) this.cache.delete(this.cache.keys().next().value);
      p.then(a => { entry.until = a.expires - 5 * 60e3; }, () => { if (this.cache.get(id) === entry) this.cache.delete(id); });
      return p;
    }

    // each client in turn; the first one's reason kept if none is given it (it says the most). The first client, after
    // three songs in a row it wasn't given and the spare was (YouTube has stopped serving it): asked second for half an
    // hour, a request saved on every song, then first again.
    async ask(id) {
      let first;
      const order = Date.now() < this.demoted ? [...CLIENTS.slice(1), CLIENTS[0]] : CLIENTS;
      for (const c of order) {
        try {
          const a = await this.askAs(c, id);
          if (order === CLIENTS) this.misses = c === CLIENTS[0] ? 0 : (this.misses || 0) + 1;
          if (this.misses >= 3) { this.demoted = Date.now() + 30 * 60e3; this.misses = 0; }
          return a;
        } catch (e) { if (e.code === 'network') throw e; first ||= e; }
      }
      throw first;
    }

    async askAs({ id: num, client }, id, again = true) {
      const v = await this.visitor();
      const j = await this.json(API + 'player', { context: { client: { ...client, hl: this.hl, gl: this.gl, visitorData: v } }, videoId: id, contentCheckOk: true, racyCheckOk: true },
        { Origin: 'https://www.youtube.com', 'User-Agent': client.userAgent, 'X-YouTube-Client-Name': num, 'X-YouTube-Client-Version': client.clientVersion, 'X-Goog-Visitor-Id': v });
      const st = j.playabilityStatus?.status;
      if (st === 'LOGIN_REQUIRED' && again) { await this.visitor(true); return this.askAs({ id: num, client }, id, false); } // (refused: a new visitor id, once)
      if (st !== 'OK') throw new FlowError(st === 'LOGIN_REQUIRED' ? 'blocked' : 'unplayable', j.playabilityStatus?.reason || st || 'no answer');
      const all = j.streamingData?.adaptiveFormats || [], formats = all.filter(f => f.url && !f.drmFamilies); // (public and unprotected only)
      if (!formats.length) throw new FlowError(all.some(f => f.drmFamilies) ? 'drm' : 'shape', 'no public stream for ' + id);
      return { id, client: client.clientName, formats, duration: +j.videoDetails?.lengthSeconds || 0, expires: Date.now() + (+j.streamingData.expiresInSeconds || 21600) * 1000 };
    }

    // the best public audio stream
    async audio(id) {
      const p = await this.player(id);
      const f = AUDIO.map(i => p.formats.find(x => x.itag === i)).find(Boolean)
        || p.formats.filter(x => x.mimeType.startsWith('audio/')).sort((a, b) => b.bitrate - a.bitrate)[0];
      if (!f) throw new FlowError('unplayable', 'no audio stream for ' + id);
      return { id, url: f.url, itag: f.itag, mime: f.mimeType, size: +f.contentLength || 0, bitrate: f.averageBitrate || f.bitrate,
        loudnessDb: typeof f.loudnessDb === 'number' ? f.loudnessDb : null, duration: p.duration, expires: p.expires, client: p.client };
    }

    // a video stream (no sound: the sound is audio()'s) no taller than the screen needs, no faster than it shows, in the
    // first codec of codecs it has (the ones the device decodes in hardware first)
    async video(id, { height = 1080, fps = 60, codecs = ['av01', 'vp9', 'avc1'] } = {}) {
      const p = await this.player(id), codec = f => codecs.findIndex(c => (f.mimeType.match(/codecs="([^".]+)/) || [])[1] === c);
      const ok = p.formats.filter(f => f.mimeType.startsWith('video/') && codec(f) >= 0 && f.height <= height && (f.fps || 30) <= fps);
      const f = ok.sort((a, b) => b.height - a.height || (b.fps || 0) - (a.fps || 0) || codec(a) - codec(b))[0];
      if (!f) throw new FlowError('unplayable', 'no video stream for ' + id);
      return { id, url: f.url, itag: f.itag, mime: f.mimeType, width: f.width, height: f.height, fps: f.fps || 30, expires: p.expires };
    }

    // the next songs, looked up before they're needed (three at most, one at a time)
    prefetch(ids) { for (const id of (ids || []).slice(0, 3)) this.player(id, { ahead: true }).catch(() => {}); }
    // an address that stopped working (a 403, say): asked again next time
    forget(id) { this.cache.delete(id); }
  }

  out.create = opts => new Engine(opts);
  out.Error = FlowError;
  out.version = '0.3.0';
})(typeof module === 'object' && module.exports ? module.exports : (globalThis.FlowStream = {}));
