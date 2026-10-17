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
//   await ev.byName(artist, title, dur, alts)   { raw (LRC or plain), dur, src, exact, instrumental?, kind, id (LRCLIB) }
//   await ev.byId(lrclibId)                     the lyrics of one LRCLIB entry: { raw, dur, src, kind, id } or {}
//   await ev.words(artist, title, dur)          { yrc (word-timed), dur, src } or { lrc, dur, src } or {}  (AMLL first, then NetEase, Kugou)
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
  // a recording's version, said in its name (a different recording of the same words: their timing differs)
  const VERSION = /\b(live|remix(?:ed)?|acoustic|unplugged|instrumental|karaoke|slowed|sped up|reverb|nightcore|8d|orchestral|symphonic|reprise|lo-?fi|demo)\b/gi;

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
    // The open lyrics database's answer: a find, or null (not found). Busy — it says "retry in a moment", at times to 2 in
    // 5 requests (measured 2026-10) — or an error page: asked again three times, a little later each time (jittered, so
    // many apps don't come back at once); still busy: thrown, and the lyrics count as offline (asked again next time).
    // No network: offline at once.
    async lrclib(path, params) {
      for (let k = 0; ; k++) {
        if (k) await sleep(500 * k + Math.random() * 300);
        let j = null;
        try { j = JSON.parse(await this.get('https://lrclib.net/api/' + path + (params ? '?' + new URLSearchParams(params) : ''))); } catch (e) { if (e instanceof TypeError || e?.name === 'AbortError' || e?.name === 'TimeoutError') throw e; }
        if (path === 'search' ? Array.isArray(j) : j && typeof j.id === 'number') return j;
        if (j?.statusCode === 404 || j?.name === 'TrackNotFound') return null;
        if (k >= 3) throw new Error('the lyrics database is busy');
      }
    }
    async byNameNow(artist, title, dur, alts) {
      const api = (path, params) => this.lrclib(path, params);
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
      // The version the song is — its "(Live)", "- Remix", "Acoustic"…, outside its plain name: an entry of another version
      // has its words but not its timing (a studio entry's timing on a live take was seconds out: measured).
      const ver = s => (String(s || '').match(VERSION) || []).map(v => v.toLowerCase());
      const wantVer = ver(title).filter(v => !ver(clean(title)).includes(v)), sameVer = h => wantVer.every(v => ver(h.trackName).includes(v));
      const wordsOnly = h => ({ ...h, instrumental: false, syncedLyrics: null, plainLyrics: h.plainLyrics || h.syncedLyrics.replace(/^\[[^\]]*\]\s?/gm, '') });
      try {
        let hit = artist && dur ? await api('get', { artist_name: artist, track_name: title, duration: Math.round(dur) }) : null;
        if (hit && !own(hit)) hit = null;
        let exact = !!hit; // (the database's own exact match: name, artist and length)
        if (hit && !sameVer(hit)) { exact = false; hit = hit.syncedLyrics || hit.plainLyrics ? wordsOnly(hit) : null; } // (another version of it)
        // An entry marked instrumental is someone's say-so, so the others are looked at too — measured: "Tum Hi Ho" under
        // its composer's and its singer's names together was marked so, while eight entries of it have its lyrics.
        if (!hit?.syncedLyrics) {
          let hits = ((await api('search', { track_name: clean(title), ...(who && { artist_name: who }) })) || []).filter(h => named(h) && byArtist(h) && own(h));
          // the artist unknown to the database (say, a video channel's name): the song's name at its very length
          if (!hits.length && dur) hits = ((await api('search', { q: clean(title) })) || []).filter(h => named(h) && own(h) && Math.abs(h.duration - dur) < 3);
          const sung = hits.filter(h => !h.instrumental && (h.syncedLyrics || h.plainLyrics)).sort((a, b) => Math.abs(a.duration - dur) - Math.abs(b.duration - dur));
          const best = sung.find(h => h.syncedLyrics && near(h) && sameVer(h));
          if (best) { hit = best; exact = true; }
          // the same song at another length (an edit, a live take…), or marked instrumental against all these: its words,
          // not its timing
          else if (sung.length && (!hit || hit.instrumental)) { hit = wordsOnly(sung[0]); exact = false; }
          else if (!hit) { const inst = hits.find(h => h.instrumental && near(h)); if (inst) { hit = inst; exact = true; } }
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
          const h0 = hs.find(h => h.syncedLyrics && sameVer(h)) || hs.find(h => h.instrumental) || hs.find(h => h.plainLyrics || h.syncedLyrics);
          if ((hit = h0 ? (h0.syncedLyrics && !sameVer(h0) ? wordsOnly(h0) : h0) : null)) break search; // (another version's: its words)
        }
        if (hit?.instrumental) return { raw: '', dur: hit.duration || 0, src: hit.artistName + ' — ' + hit.trackName, exact, instrumental: true, kind: 'instrumental', id: hit.id || 0 };
        return { raw: hit?.syncedLyrics || hit?.plainLyrics || '', dur: hit?.duration || 0, src: hit ? hit.artistName + ' — ' + hit.trackName : '', exact,
                 kind: hit ? (hit.syncedLyrics ? 'synced lyrics' : 'plain lyrics') : 'no lyrics found', id: hit?.id || 0 };
      } catch { return { raw: '', dur: 0, kind: 'lyrics offline', id: 0 }; }
    }

    // Word-by-word timing: the open AMLL TTML DB first (keyed by the NetEase id), then two public lyric services ("yrc", and "krc" turned into it). Each must be the same artist at
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
      const yrc = found.filter(x => x.yrc).sort(fit);
      return yrc.find(x => x.amll) || yrc[0] || found.filter(x => x.lrc).sort(fit)[0] || {}; // (AMLL preferred — open and hand-made)
    }

    // Lyrics straight from an LRCLIB entry by its id — the shared match cache points here (LRCLIB is open/CC0). The
    // caller checks the entry fits the song (name/length) before trusting it. {} if there's nothing, the id's bad or the
    // database stays busy (then the caller looks by name).
    byId(id) { return /^\d+$/.test(String(id)) ? this.remember('i' + id, () => this.byIdNow(id)) : Promise.resolve({}); }
    async byIdNow(id) {
      let j; try { j = await this.lrclib('get/' + id); } catch { return {}; }
      if (!j) return {};
      if (j.instrumental) return { raw: '', dur: j.duration || 0, src: j.artistName + ' — ' + j.trackName, exact: true, instrumental: true, kind: 'instrumental', id: j.id };
      return { raw: j.syncedLyrics || j.plainLyrics || '', dur: j.duration || 0, src: j.artistName + ' — ' + j.trackName, exact: true,
               kind: j.syncedLyrics ? 'synced lyrics' : j.plainLyrics ? 'plain lyrics' : 'no lyrics found', id: j.id };
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
    const amll = await amllYrc(get, hit.id).catch(() => ''); // (prefer the open, hand-made AMLL word timing when it has this song)
    if (amll) return { yrc: amll, dur: hit.dt / 1000, src: (hit.ar || []).map(a => a.name).join(', ') + ' — ' + hit.name + ' (AMLL)', amll: true };
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

  // ---- AMLL TTML DB: open (CC0), hand-made word-by-word lyrics, keyed by platform id ----
  // one TTML entry → "yrc" word timing (the same shape NetEase gives). Each sung word is a <span begin end>; background
  // vocals (ttm:role="x-bg", a span of word spans) and translations (x-translation, no timing) are left out. A per-device
  // fetch for the song being played — never mirrored or hosted, no id kept in the shared cache (Legal: can't prove an entry CC0).
  const ttmlTime = t => { let n = 0; for (const x of String(t).trim().split(':')) n = n * 60 + parseFloat(x || 0); return Math.round(n * 1000); };
  const unent = x => x.replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d)).replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
  function ttmlToYrc(ttml) {
    if (!/<tt[\s>]/.test(ttml || '')) return ''; // (a 404 page, not a TTML)
    const out = [];
    for (const p of ttml.matchAll(/<p\b([^>]*)>([\s\S]*?)<\/p>/g)) {
      const ls = ttmlTime((/\bbegin="([^"]+)"/.exec(p[1]) || [])[1]), le = ttmlTime((/\bend="([^"]+)"/.exec(p[1]) || [])[1]);
      if (!(le > ls)) continue;
      const body = p[2].replace(/<span\b[^>]*ttm:role="x-bg"[^>]*>(?:<span\b[^>]*>[^<]*<\/span>|[^<])*<\/span>/g, ''); // (drop background vocals, a nested span of spans)
      const words = [];
      for (const sp of body.matchAll(/<span\b([^>]*)>([\s\S]*?)<\/span>/g)) {
        if (/ttm:role=/.test(sp[1])) continue; // (translation etc. — not a sung word)
        const b = /\bbegin="([^"]+)"/.exec(sp[1]), e = /\bend="([^"]+)"/.exec(sp[1]);
        if (!b || !e) continue;
        const text = unent(sp[2].replace(/<[^>]+>/g, '')); if (!text) continue;
        const ws = ttmlTime(b[1]), we = ttmlTime(e[1]);
        words.push(`(${ws},${Math.max(0, we - ws)},0)${text}`);
      }
      if (words.length) out.push(`[${ls},${le - ls}]` + words.join(''));
    }
    return out.join('\n');
  }
  async function amllYrc(get, ncmId) {
    if (!/^\d+$/.test(String(ncmId))) return '';
    let yrc = '';
    try { const t = await get('https://raw.githubusercontent.com/amll-dev/amll-ttml-db/refs/heads/main/ncm-lyrics/' + ncmId + '.ttml', { 'User-Agent': UA });
      yrc = t && t.length <= 1e6 ? ttmlToYrc(t) : ''; } // (untrusted external file: cap the size, fail closed; a miss falls through to the next source)
    catch { return ''; }
    // (only an entry timed word by word: one with each line's words in one piece is timed by the line, and the next
    // source's word timing is better then — measured: such an entry was also seconds off its song)
    const lines = yrc.split('\n').filter(Boolean);
    return lines.length && lines.filter(l => (l.match(/\(\d+,\d+,0\)/g) || []).length > 1).length >= lines.length / 2 ? yrc : '';
  }

  out.create = opts => new Engine(opts);
  out.krcToYrc = krcToYrc;
  out.ttmlToYrc = ttmlToYrc;
  out.version = '0.5.0';
})(typeof module === 'object' && module.exports ? module.exports : (globalThis.EndVerse = {}));
