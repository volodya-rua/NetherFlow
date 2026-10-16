// FlowStream for NetherFlow - Copyright (C) 2026 Volodya.rua - GNU GPL v3 only, with additional terms (credit, name and logo): see LICENSE and NOTICE.
// FlowStream, NetherFlow's playback engine. For a public video it finds the best public audio stream (Opus, format 251),
// a video stream sized to the screen, and the song's lyrics (synced where they're published), as plain stream addresses
// the device then plays itself: nothing passes through any server of ours. One small request per song; each answer kept
// for as long as its addresses are good; the next songs looked up ahead, a little apart. The platform hands it its own
// way to make a request — post(url, body, headers) → Promise<string> — so the same code runs in Node (NetherFlow's
// desktop) and in the app's page on Android (CapacitorHttp).
//
//   const fs = FlowStream.create({ post })
//   await fs.audio(id)        { url, itag, mime, size, bitrate, loudnessDb, duration, expires }
//   await fs.video(id, { height: 1080, fps: 60, codecs: ['av01', 'vp9', 'avc1'] })   { url, itag, mime, width, height, fps, expires }
//   await fs.lyrics(id)       { lines: [{ t, end, text }] } or { plain }, with { source } (who provides them), or {}
//   fs.prefetch([id, id, id]) the next songs, looked up ahead;  fs.forget(id) after its address stopped working
//
// Only public, unprotected streams: a format with DRM is never chosen, and nothing is signed in. A failure is a
// FlowStream.Error with a code (id, network, blocked, unplayable, drm, shape): NetherFlow then asks its bundled yt-dlp.
(function (out) {
  'use strict';
  const API = 'https://www.youtube.com/youtubei/v1/', MUSIC = 'https://music.youtube.com/youtubei/v1/';
  // The client this asks as: the one yt-dlp asks as when it has no JavaScript runtime (its "visionos" client, which is
  // given plain stream addresses). See NOTICE.
  const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 15_7_3) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15';
  const CLIENT = { clientName: 'VISIONOS', clientVersion: '1.02', deviceMake: 'Apple', deviceModel: 'RealityDevice17,1', userAgent: UA, osName: 'visionOS', osVersion: '26.5.23O471' };
  const CLIENT_ID = '101', WEB_VERSION = '2.20261001.00.00';
  const WEB_MUSIC = { clientName: 'WEB_REMIX', clientVersion: '1.20250101.01.00' };
  const ANDROID_MUSIC = { clientName: 'ANDROID_MUSIC', clientVersion: '7.21.50', androidSdkVersion: 30 }; // (the client given the lyrics' timing)
  const AUDIO = [251, 140, 250, 249, 139]; // the best first: Opus (~130–160 kbps), then AAC, then the smaller ones
  const KEEP = 100; // answers kept, at most (the oldest go first)

  class FlowError extends Error { constructor(code, message) { super(message); this.name = 'FlowStream.Error'; this.code = code; } }
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const find = (o, test) => { if (!o || typeof o !== 'object') return null; for (const k in o) { const v = o[k]; if (test(k, v)) return v; const r = find(v, test); if (r) return r; } return null; };

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

    async ask(id, again = true) {
      const v = await this.visitor();
      const j = await this.json(API + 'player', { context: { client: { ...CLIENT, hl: this.hl, gl: this.gl, visitorData: v } }, videoId: id, contentCheckOk: true, racyCheckOk: true },
        { Origin: 'https://www.youtube.com', 'X-YouTube-Client-Name': CLIENT_ID, 'X-YouTube-Client-Version': CLIENT.clientVersion, 'X-Goog-Visitor-Id': v });
      const st = j.playabilityStatus?.status;
      if (st === 'LOGIN_REQUIRED' && again) { await this.visitor(true); return this.ask(id, false); } // (refused: a new visitor id, once)
      if (st !== 'OK') throw new FlowError(st === 'LOGIN_REQUIRED' ? 'blocked' : 'unplayable', j.playabilityStatus?.reason || st || 'no answer');
      const all = j.streamingData?.adaptiveFormats || [], formats = all.filter(f => f.url && !f.drmFamilies); // (public and unprotected only)
      if (!formats.length) throw new FlowError(all.some(f => f.drmFamilies) ? 'drm' : 'shape', 'no public stream for ' + id);
      return { id, formats, duration: +j.videoDetails?.lengthSeconds || 0, expires: Date.now() + (+j.streamingData.expiresInSeconds || 21600) * 1000 };
    }

    // the best public audio stream
    async audio(id) {
      const p = await this.player(id);
      const f = AUDIO.map(i => p.formats.find(x => x.itag === i)).find(Boolean)
        || p.formats.filter(x => x.mimeType.startsWith('audio/')).sort((a, b) => b.bitrate - a.bitrate)[0];
      if (!f) throw new FlowError('unplayable', 'no audio stream for ' + id);
      return { id, url: f.url, itag: f.itag, mime: f.mimeType, size: +f.contentLength || 0, bitrate: f.averageBitrate || f.bitrate,
        loudnessDb: typeof f.loudnessDb === 'number' ? f.loudnessDb : null, duration: p.duration, expires: p.expires };
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

    // The song's lyrics from YouTube Music: the lyrics tab's id from the song's page, then the lyrics, asked as the
    // Android app (only that client is given their timing). Who provides them (YouTube shows it): source.
    async lyrics(id) {
      if (!/^[\w-]{11}$/.test(String(id))) throw new FlowError('id', 'not a video id: ' + id);
      const music = { Origin: 'https://music.youtube.com', Referer: 'https://music.youtube.com/' };
      const next = await this.json(MUSIC + 'next', { context: { client: { ...WEB_MUSIC, hl: this.hl, gl: this.gl } }, videoId: id, isAudioOnly: true }, music);
      const browseId = find(next, (k, v) => k === 'browseId' && typeof v === 'string' && v.startsWith('MPLY'));
      if (!browseId) return {};
      const j = await this.json(MUSIC + 'browse', { context: { client: { ...ANDROID_MUSIC, hl: this.hl, gl: this.gl } }, browseId },
        { ...music, 'User-Agent': `com.google.android.apps.youtube.music/${ANDROID_MUSIC.clientVersion} (Linux; U; Android 11) gzip` });
      const source = (find(j, (k, v) => typeof v === 'string' && /^Source: ./.test(v)) || '').replace(/^Source: /, '');
      const timed = find(j, k => k === 'timedLyricsData');
      if (timed?.length) {
        const lines = timed.filter(l => l.cueRange).map(l => ({ t: +l.cueRange.startTimeMilliseconds / 1000, end: +l.cueRange.endTimeMilliseconds / 1000, text: String(l.lyricLine || '').replace(/\s+/g, ' ').trim() }))
          .filter(l => l.text && l.text !== '♪');
        if (lines.length) return { lines, source };
      }
      const plain = (find(j, k => k === 'musicDescriptionShelfRenderer')?.description?.runs || []).map(r => r.text).join('');
      return plain ? { plain, source } : {};
    }
  }

  out.create = opts => new Engine(opts);
  out.Error = FlowError;
  out.version = '0.1.0';
})(typeof module === 'object' && module.exports ? module.exports : (globalThis.FlowStream = {}));
