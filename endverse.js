// EndVerse for NetherFlow - Copyright (C) 2026 Volodya.rua - GNU GPL v3 only, with additional terms (credit, name and logo): see LICENSE and NOTICE.
// EndVerse, NetherFlow's lyrics finder. For a song it finds its lyrics in three public places, each asked as anyone may
// ask it: an open lyrics database, by the song's name (synced or plain); two public lyric services, for word-by-word
// timing; and the lyrics a music video's own page lists, synced to that very recording, with who provides them (shown
// with them). Only what's published, read as it's offered: no sign-in, nothing kept here (the app keeps a song's lyrics
// only with the songs its user saves for offline). The platform hands it its own way to make a request, so the same code
// runs in Node (NetherFlow's desktop) and in the app's page on Android:
//   get(url, headers) → Promise<string>  ·  post(url, body, headers) → Promise<string>
//
//   const ev = EndVerse.create({ get, post })
//   await ev.byName(artist, title, dur, alts)   { raw (LRC or plain), dur, src, exact, instrumental?, kind }
//   await ev.words(artist, title, dur)          { yrc (word-timed), dur, src } or { lrc, dur, src } or {}
//   await ev.forVideo(id)                       { lines: [{ t, end, text }], source } or { plain, source } or {}
(function (out) {
  'use strict';
  const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
  const MUSIC = 'https://music.youtube.com/youtubei/v1/';
  const WEB_MUSIC = { clientName: 'WEB_REMIX', clientVersion: '1.20250101.01.00' };
  const ANDROID_MUSIC = { clientName: 'ANDROID_MUSIC', clientVersion: '7.21.50', androidSdkVersion: 30 }; // (the client given the lyrics' timing)
  const find = (o, test) => { if (!o || typeof o !== 'object') return null; for (const k in o) { const v = o[k]; if (test(k, v)) return v; const r = find(v, test); if (r) return r; } return null; };
  // "Song (feat. X) - Remastered 2011" → "Song", so a search still finds it; a name's words, for comparing two
  const clean = s => s.replace(/\s*[([].*?[)\]]/g, '').replace(/\s+-\s+.*$/, '').trim();
  const words = s => (s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim().split(' ').filter(Boolean);
  const TRANSLATED = /translat|traducci|tradu[cç][aã]o|übersetz|traduzione|terjemahan|перевод|翻[译譯]|english version|versi[oó]n en ingl/i;

  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const KEEP = 200; // (answers remembered, at most: the oldest go first)

  class Engine {
    constructor({ get, post, hl = 'en', gl = 'US' } = {}) {
      if (typeof get !== 'function') throw new TypeError('EndVerse: get(url, headers) is required');
      Object.assign(this, { get, post, hl, gl, kept: new Map() });
    }

    // an answer remembered (and one on its way shared): the same song asked again, at once. Only one with lyrics in it is
    // kept: none (it may come back later, or have been a blip), a failure or 'lyrics offline' is asked again next time
    remember(key, ask) {
      if (this.kept.has(key)) return this.kept.get(key);
      const p = ask();
      this.kept.set(key, p);
      while (this.kept.size > KEEP) this.kept.delete(this.kept.keys().next().value);
      p.then(v => { if (!(v?.raw || v?.yrc || v?.lrc || v?.lines || v?.plain || v?.instrumental)) this.kept.delete(key); }, () => this.kept.delete(key));
      return p;
    }

    // The open lyrics database, by the song's name: synced lyrics at the song's length if it has them, else its words.
    // alts: other ways its name may be written (tried when it isn't found by its own). A network failure: kind 'lyrics offline'.
    byName(artist, title, dur = 0, alts = []) { return this.remember(JSON.stringify(['n', artist, title, Math.round(dur), alts]), () => this.byNameNow(artist, title, dur, alts)); }
    async byNameNow(artist, title, dur, alts) {
      // the database's answer: a find, or null (not found). Busy (it says so now and then) or an error page: asked again,
      // twice, a little later each time; still busy: thrown, and the lyrics count as offline (asked again next time)
      const api = async (path, params) => {
        for (let wait = 0; ; wait += 700) {
          if (wait) await sleep(wait);
          let j = null;
          try { j = JSON.parse(await this.get('https://lrclib.net/api/' + path + '?' + new URLSearchParams(params))); } catch (e) { if (e instanceof TypeError || e?.name === 'AbortError' || e?.name === 'TimeoutError') throw e; } // (no network: offline at once)
          if (path === 'search' ? Array.isArray(j) : j && typeof j.id === 'number') return j;
          if (path === 'get' && (j?.statusCode === 404 || j?.name === 'TrackNotFound')) return null;
          if (wait >= 1400) throw new Error('the lyrics database is busy');
        }
      };
      const who = artist.split(/,|&| feat\.? | x /i)[0].trim();
      // Is a find this song? Only if it has the song's name (bracketed bits, "- Remastered…" tails, "feat." credits,
      // apostrophes and "&"/"and" aside) and one of its artists' names — or, under some other name, its very length. Never
      // just any song the search came up with: that's how another song's lyrics end up on this one.
      const tn = x => words(clean(x || '').replace(/\s+(feat|ft)\.?\s.*$/i, '').replace(/['’]/g, '').replace(/\s&\s/g, ' and ')).join(' ');
      const flat = x => (x || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
      const by = artist.split(/,|&|:| feat\.? | x | [-–—] /i).map(flat).filter(a => a.length > 2);
      const byArtist = h => { const a = flat(h.artistName); return a.length > 2 && by.some(b => a.includes(b) || b.includes(a)); };
      const named = (h, name = title) => !!tn(name) && tn(h.trackName) === tn(name);
      const near = h => !dur || Math.abs(h.duration - dur) < 4;
      const own = h => !TRANSLATED.test(h.trackName + ' ' + h.artistName) || TRANSLATED.test(title); // (not a translation of it)
      try {
        let hit = artist && dur ? await api('get', { artist_name: artist, track_name: title, duration: Math.round(dur) }) : null;
        if (hit && !own(hit)) hit = null;
        let exact = !!hit; // (the database's own exact match: name, artist and length)
        if (!hit?.syncedLyrics && !hit?.instrumental) {
          let hits = ((await api('search', { track_name: clean(title), ...(who && { artist_name: who }) })) || []).filter(h => named(h) && byArtist(h) && own(h));
          // the artist unknown to the database (say, a video channel's name): the song's name at its very length
          if (!hits.length && dur) hits = ((await api('search', { q: clean(title) })) || []).filter(h => named(h) && own(h) && Math.abs(h.duration - dur) < 3);
          const best = hits.find(h => (h.syncedLyrics || h.instrumental) && near(h));
          if (best) { hit = best; exact = true; }
          else if (!hit?.plainLyrics) { // the same song at another length (an edit, a live take…): its words, not its timing
            const other = hits.find(h => h.plainLyrics || h.syncedLyrics);
            if (other) hit = { ...other, syncedLyrics: null, plainLyrics: other.plainLyrics || other.syncedLyrics.replace(/^\[[^\]]*\]\s?/gm, '') };
          }
        }
        // not found by its name: by its other names — a find with that name, kept only at the song's length, give or take
        // a few seconds (or by the same artist, give or take a minute: an upload with an intro or outro). Each searched with
        // the artist's name first (a short name alone finds too many other songs), then alone. The artist: the one it came
        // with, or a name from the rest of its title.
        const lead = artist.split(/,|&|:| feat\.? | x | [-–—] /i)[0].trim();
        search: for (const alt of hit || !dur ? [] : alts) for (const q of [...new Set([(alt + ' ' + lead).trim(), alt])]) {
          const names = [...by, ...alts.filter(a => a !== alt).map(flat).filter(a => a.length > 2)];
          const fits = h => named(h, alt) && own(h) && (Math.abs(h.duration - dur) < 4 || (names.some(a => flat(h.artistName).includes(a)) && Math.abs(h.duration - dur) < 60));
          const hs = ((await api('search', { q })) || []).filter(fits).sort((a, b) => Math.abs(a.duration - dur) - Math.abs(b.duration - dur)); // (closest length first)
          if ((hit = hs.find(h => h.syncedLyrics || h.instrumental) || hs.find(h => h.plainLyrics) || null)) break search;
        }
        if (hit?.instrumental) return { raw: '', dur: hit.duration || 0, src: hit.artistName + ' — ' + hit.trackName, exact, instrumental: true, kind: 'instrumental' };
        return { raw: hit?.syncedLyrics || hit?.plainLyrics || '', dur: hit?.duration || 0, src: hit ? hit.artistName + ' — ' + hit.trackName : '', exact,
                 kind: hit ? (hit.syncedLyrics ? 'synced lyrics' : 'plain lyrics') : 'no lyrics found' };
      } catch { return { raw: '', dur: 0, kind: 'lyrics offline' }; }
    }

    // Word-by-word timing from two public lyric services ("yrc", and "krc" turned into it). Each must be the same artist at
    // the same length (±3 s), so the timing matches the recording being played; both are asked, the one closest in length
    // wins. Neither with word timing: line-timed lyrics if one has them ({ lrc }), for songs the database doesn't have.
    // (both asked at once, 6 s each at most; once one has answered word-timed at the song's very length, the other gets
    // half a second more, not the rest of its time)
    words(artist, title, dur) { return this.remember(JSON.stringify(['w', artist, title, Math.round(dur)]), () => this.wordsNow(artist, title, dur)); }
    async wordsNow(artist, title, dur) {
      const found = [];
      await new Promise(done => {
        let left = 2, soon = 0;
        for (const f of [wordsA, wordsB]) Promise.race([f(this.get, artist, title, dur), sleep(6000)]).catch(() => null).then(x => {
          if (x) found.push(x);
          if (!--left) return done();
          if (x?.yrc && (!dur || Math.abs(x.dur - dur) < 1) && !soon) soon = setTimeout(done, 500);
        });
      });
      const fit = (a, b) => Math.abs(a.dur - dur) - Math.abs(b.dur - dur);
      return found.filter(x => x.yrc).sort(fit)[0] || found.filter(x => x.lrc).sort(fit)[0] || {};
    }

    // The lyrics a music video's page lists: the lyrics tab's id from the video's "next" page, then the lyrics, asked as the
    // music app that's given their timing. Who provides them (the page shows it): source. Not found: {}.
    forVideo(id) { return this.remember('v' + id, () => this.forVideoNow(id)); }
    async forVideoNow(id) {
      if (!/^[\w-]{11}$/.test(String(id))) throw new TypeError('EndVerse: not a video id: ' + id);
      if (typeof this.post !== 'function') throw new TypeError('EndVerse: post(url, body, headers) is required for forVideo');
      const music = { 'Content-Type': 'application/json', 'User-Agent': UA, Origin: 'https://music.youtube.com', Referer: 'https://music.youtube.com/' };
      const ask = async (path, body, headers) => {
        for (let again = 1; ; again--) { // (a stray error page or a blip: asked once more, half a second later)
          try { return JSON.parse(await this.post(MUSIC + path + '?prettyPrint=false', JSON.stringify(body), headers)); }
          catch (e) { if (!again) throw e; await new Promise(r => setTimeout(r, 500)); }
        }
      };
      const next = await ask('next', { context: { client: { ...WEB_MUSIC, hl: this.hl, gl: this.gl } }, videoId: id, isAudioOnly: true }, music);
      const browseId = find(next, (k, v) => k === 'browseId' && typeof v === 'string' && v.startsWith('MPLY'));
      if (!browseId) return {};
      const j = await ask('browse', { context: { client: { ...ANDROID_MUSIC, hl: this.hl, gl: this.gl } }, browseId },
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

  // ---- word timing's two services ----
  const norm = s => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/\s*[([].*?[)\]]/g, '').replace(/[^\p{L}\p{N}]/gu, '');
  const sameSong = (a, b) => { a = norm(a); b = norm(b); return !!a && !!b && (a.startsWith(b) || b.startsWith(a)); };

  // the first: its "yrc" word timing, or its line-timed lyrics (without the credit lines at the top)
  async function wordsA(get, artist, title, dur) {
    const json = async url => JSON.parse(await get(url, { 'User-Agent': UA, Referer: 'https://music.163.com/' }));
    const found = await json('https://music.163.com/api/cloudsearch/pc?' + new URLSearchParams({ s: `${title} ${artist}`, type: 1, limit: 10 }));
    const who = artist.toLowerCase();
    const hit = (found.result?.songs || []).find(x =>
      (x.ar || []).some(a => a.name?.length > 1 && (who.includes(a.name.toLowerCase()) || a.name.toLowerCase().includes(who))) &&
      sameSong(x.name, title) && (!dur || Math.abs(x.dt / 1000 - dur) < 3));
    if (!hit) return null;
    const l = await json(`https://music.163.com/api/song/lyric/v1?id=${hit.id}&lv=0&yv=0`);
    const src = (hit.ar || []).map(a => a.name).join(', ') + ' — ' + hit.name + ' (NetEase)'; // (what it matched)
    if (l.yrc?.lyric) return { yrc: l.yrc.lyric, dur: hit.dt / 1000, src };
    const credit = /^\s*(\[[^\]]*\])*\s*(作词|作曲|编曲|制作人?|混音|母带|和声|吉他|贝斯|鼓|弦乐|lyricist|composer|producer|arranger|mix(ing)?|master(ing)?|lyrics|music|written by)\s*[:：]/i;
    const lrc = (l.lrc?.lyric || '').split('\n').filter(x => !credit.test(x)).join('\n');
    return /\[\d+:\d+/.test(lrc) && !/纯音乐/.test(lrc) ? { lrc, dur: hit.dt / 1000, src } : null; // (none for an instrumental)
  }

  // the second: its lyric files come packed (a fixed, published XOR key over zlib-compressed text: a file format, read
  // as its own app reads it), word-timed as "krc", turned into "yrc"
  const KRC_KEY = [64, 71, 97, 119, 94, 50, 116, 71, 81, 54, 49, 45, 206, 210, 110, 105];
  async function wordsB(get, artist, title, dur) {
    const json = async url => JSON.parse(await get(url, { 'User-Agent': UA }));
    const first = artist.split(/,|&| feat\.? | x /i)[0].trim(); // (its search only finds "Artist - Title" with one artist)
    const name = title.replace(/\s*[([].*?[)\]]/g, '').replace(/\s+-\s+.*$/, '').trim();
    const s = await json('https://lyrics.kugou.com/search?' + new URLSearchParams({ ver: 1, man: 'yes', client: 'pc', keyword: `${first} - ${name}`, duration: Math.round(dur * 1000), hash: '' }));
    const hit = (s.candidates || []).find(x => sameSong(x.song, name) && norm(x.singer).includes(norm(first)) && (!dur || Math.abs(x.duration / 1000 - dur) < 3));
    if (!hit) return null;
    const d = await json('https://lyrics.kugou.com/download?' + new URLSearchParams({ ver: 1, client: 'pc', id: hit.id, accesskey: hit.accesskey, fmt: 'krc', charset: 'utf8' }));
    if (!d.content) return null;
    const bytes = Uint8Array.from(atob(d.content), c => c.charCodeAt(0)).subarray(4).map((b, i) => b ^ KRC_KEY[i % 16]);
    const krc = await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate'))).text();
    const yrc = krcToYrc(krc);
    return yrc ? { yrc, dur: hit.duration / 1000, src: hit.singer + ' — ' + hit.song + ' (Kugou)' } : null;
  }
  // krc "[lineMs,durMs]<fromLineStartMs,durMs,0>word…" → yrc "[lineMs,durMs](songMs,durMs,0)word…"
  function krcToYrc(krc) {
    let opening = true;
    return krc.split(/\r?\n/).map(row => {
      const m = /^\[(\d+),(\d+)\](.*)$/.exec(row);
      if (!m) return '';
      const ws = [...m[3].matchAll(/<(\d+),(\d+),\d+>([^<]*)/g)], text = ws.map(w => w[3]).join('');
      // the top has lines that aren't sung: "Title - Artist", "Lyrics by：…", or filler timing (every word the same length)
      if (opening && (/ - |[:：]/.test(text) || ws.length > 1 && ws.every(w => w[2] === ws[0][2]))) return '';
      opening = false;
      return `[${m[1]},${m[2]}]` + ws.map(([, at, len, t]) => `(${+m[1] + +at},${len},0)${t}`).join('');
    }).filter(Boolean).join('\n');
  }

  out.create = opts => new Engine(opts);
  out.krcToYrc = krcToYrc;
  out.version = '0.2.0';
})(typeof module === 'object' && module.exports ? module.exports : (globalThis.EndVerse = {}));
