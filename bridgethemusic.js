// BridgeTheMusic for NetherFlow - Copyright (C) 2026 Volodya.rua - GNU GPL v3 only, with additional terms (credit, name and logo): see LICENSE and NOTICE.
// BridgeTheMusic, NetherFlow's playlist importer. From a public playlist's (or album's) link that its user pastes, it reads
// the list's name and songs as the service's own public page and web player show them to anyone — nothing signed in, no
// account of the user's, nothing kept. The platform hands it its own way to make a request, so the same code runs in Node
// (NetherFlow's desktop) and in the app's page on Android:
//   get(url, headers) → Promise<string>  ·  post(url, body, headers) → Promise<string>
//
//   const btm = BridgeTheMusic.create({ get, post, keep })   keep (optional): { get(name), set(name, value) }, a few
//                                            strings kept between runs (Spotify's query id: its 4 MB player not read again)
//   await btm.read(link)   { name, from, tracks: [{ title, artist, album, dur, yt?, apple?, art? }], partial }
//   await btm.read(link, { gentle: true })   the same, more slowly: for a read nobody is waiting for (a daily sync)
//   await btm.read(link, { first: 100 })     about its first 100 songs, its own page only, at once; { first: 500 } (or
//                                            true): its first 500 — { name, from, tracks, more } (more: there's more of
//                                            it — read it all after: what the first read asked for isn't asked for twice)
// Apple's songs also carry what its pages say of them: album, art (100 px), preview, genre, released, no, disc.
// partial: some of a long list couldn't be read just now (what came before is kept; try again later).
(function (out) {
  'use strict';
  const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
  const secs = t => (t || '').split(':').reduce((a, n) => a * 60 + +n, 0); // "1:02:03" → 3723
  const WEB_MUSIC = { client: { clientName: 'WEB_REMIX', clientVersion: '1.20250101.01.00', hl: 'en', gl: 'US' } };
  const ytmPost = (post, path, body, headers = {}) => post('https://music.youtube.com/youtubei/v1/' + path + '?prettyPrint=false', JSON.stringify(body),
    { 'Content-Type': 'application/json', 'User-Agent': UA, Origin: 'https://music.youtube.com', Referer: 'https://music.youtube.com/', ...headers }).then(JSON.parse);

  // A playlist (or album) from its link — YouTube / YouTube Music, Spotify, Apple Music — as { name, from, tracks:
  // [{ title, artist, album, dur, yt (its YouTube video, when it's from there), apple (its iTunes id, from Apple), art (its
  // album's cover, 640 px, on Spotify's image server: a Spotify list past its first 100, read from the web player's API) }] }.
  // ponytail: each service's public page or its web app's own API, read as they are now; if one reshapes, its branch is
  // the one spot to fix. Spotify's embed and Apple's page show a list's first 100 songs; the rest come from each one's
  // web player's own API, with the pass that player uses. (Spotify's: the query its web player lists a playlist with,
  // its id read from the player's script, so a new version of it is picked up by itself. Editorial lists too.)
  // a long list's pages, four asked at once (gentle: two, each 0.6 s after the last), kept in their order: page(at) →
  // its answer, or null (after its own retries)
  const POOL = 4, GENTLE = { pool: 2, gap: 600 }, BRISK = { pool: POOL, gap: 0 };
  const pause = ms => ms && new Promise(r => setTimeout(r, ms));
  const pages = async (offsets, page, { pool, gap }) => {
    const got = new Array(offsets.length);
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(pool, offsets.length) }, async () => { while (next < offsets.length) { const i = next++; await pause(gap); got[i] = await page(offsets[i]); } }));
    return got;
  };
  const HEAD = 500; // (first: a list's first songs, there at once)
  const from = (start, total) => { const o = []; for (let at = start; at < Math.min(total, 20000); at += 1000) o.push(at); return o; }; // (Spotify's: 1,000 a page)
  // (a request asked for again within a minute — a list's first 500, then all of it — answered from the first time; a
  // failed one asked again)
  const recent = new Map();
  const once = (key, f) => {
    const r = recent.get(key);
    if (r && Date.now() - r.at < 60000) return r.v;
    const v = f();
    recent.set(key, { v, at: Date.now() }); if (recent.size > 24) recent.delete(recent.keys().next().value);
    Promise.resolve(v).catch(() => recent.get(key)?.v === v && recent.delete(key));
    return v;
  };
  const pageOf = (get, url) => once(url, () => get(url, { 'User-Agent': UA }));
  // (Apple's cover address, its size left open: at 100 px, as Apple's own search gives it)
  const appleArt = u => /^https:\/\/[\w.-]+\.mzstatic\.com\/.+\/\{w\}x\{h\}(bb|\{c\})?\.(\{f\}|jpg|png|webp)$/.test(u || '') ? u.replace(/\{w\}x\{h\}(bb|\{c\})?\.(\{f\}|jpg|png|webp)$/, '100x100bb.jpg') : undefined;
  const retry = async f => { for (let tries = 0; tries < 3; tries++) { if (tries) await new Promise(r => setTimeout(r, 2000 * tries)); const v = await f().catch(() => null); if (v) return v; } return null; };
  // (the query's id, read from Spotify's web player — a 4 MB script — once, and kept: in the engine, and in the
  // platform's keep, if it gave one, for next time; Spotify saying it's out of date: read again)
  const spotifyQueryId = async (get, pace, fresh) => {
    const { state, keep } = pace;
    if (!fresh && !state.spotifyQuery) try { const k = keep?.get('spotifyQuery'); if (/^[0-9a-f]{64}$/.test(k || '')) state.spotifyQuery = k; } catch {}
    if (state.spotifyQuery && !fresh) return;
    state.spotifyQuery = '';
    const page = await get('https://open.spotify.com/', { 'User-Agent': UA });
    for (const src of page.match(/https:\/\/open\.spotifycdn\.com\/cdn\/build\/web-player\/web-player\.[\w]+\.js/g) || []) {
      state.spotifyQuery = (await get(src, { 'User-Agent': UA })).match(/"fetchPlaylistContents","query","([0-9a-f]{64})"/)?.[1] || '';
      if (state.spotifyQuery) break;
    }
    if (!state.spotifyQuery) throw new Error('Spotify web player changed');
    try { keep?.set('spotifyQuery', state.spotifyQuery); } catch {}
  };
  const spotifyContents = async (get, post, id, pass, pace) => {
    await spotifyQueryId(get, pace);
    const ask = (at, n) => post('https://api-partner.spotify.com/pathfinder/v2/query', JSON.stringify({ variables: { uri: 'spotify:playlist:' + id, offset: at, limit: n },
      operationName: 'fetchPlaylistContents', extensions: { persistedQuery: { version: 1, sha256Hash: pace.state.spotifyQuery } } }),
      { Authorization: 'Bearer ' + pass, 'Content-Type': 'application/json;charset=UTF-8', 'User-Agent': UA });
    const page = (at, n = 1000) => retry(() => (at === 0 && n === HEAD ? once(`spotify:${id}:${pace.state.spotifyQuery}`, () => ask(at, n)) : ask(at, n))
      .then(t => /Invalid query hash|PersistedQueryNotFound/i.test(t.slice(0, 200)) ? { stale: true } : JSON.parse(t).data?.playlistV2?.content).then(c => (c?.stale || c?.items) && c));
    // the first page (500: all a first read gives) says how long it is; the rest then a thousand at a time, four at once
    // (a page that won't come: the others kept, partial; one shorter than asked, before the end: the rest of it a hundred
    // at a time)
    let first = await page(0, HEAD);
    if (first?.stale) { await spotifyQueryId(get, pace, true); first = await page(0, HEAD); } // (Spotify's player changed since: its id read again)
    if (!first?.items) throw new Error('Spotify playlist unreadable');
    const total = Math.min(first.totalCount ?? 0, 20000), songs = cs => cs.flatMap(c => c ? c.items.map(it => it.itemV2?.data).filter(t => t?.__typename === 'Track' && t.name)
      .map(t => ({ title: t.name, artist: t.artists?.items?.[0]?.profile?.name || '', album: t.albumOfTrack?.name || '', dur: Math.round((t.trackDuration?.totalMilliseconds || 0) / 1000),
        art: t.albumOfTrack?.coverArt?.sources?.find(x => x.width === 640)?.url || undefined })) : []);
    if (pace.first) return { tracks: songs([first]), partial: false, more: first.items.length < total };
    const offsets = from(first.items.length, total), rest = await pages(offsets, page, pace);
    let part = rest.includes(null);
    for (let k = 0; k < rest.length; k++) {
      const c = rest[k], want = Math.min(1000, total - offsets[k]);
      if (!c || c.items.length >= want) continue;
      const fill = await pages(Array.from({ length: Math.ceil((want - c.items.length) / 100) }, (_, i) => offsets[k] + c.items.length + i * 100), at => page(at, 100), pace);
      if (fill.includes(null)) part = true;
      for (const x of fill) if (x) c.items.push(...x.items);
    }
    return { tracks: songs([first, ...rest]), partial: part };
  };
  async function read(get, post, link, pace) {
    const u = new URL(link), find = (o, key) => { if (!o || typeof o !== 'object') return null; if (o[key]) return o[key]; for (const k in o) { const r = find(o[k], key); if (r) return r; } return null; };
    if (/^spotify\.(app\.)?link$/.test(u.hostname)) { // (the Spotify app's short link: its page names the playlist)
      const m = (await get(link, { 'User-Agent': UA })).match(/open\.spotify\.com\/(playlist|album|track)\/([A-Za-z0-9]{22})/);
      if (!m || m[1] === 'track') throw new Error(m ? 'that\'s a song, not a playlist' : 'not a playlist link');
      return read(get, post, `https://open.spotify.com/${m[1]}/${m[2]}`, pace);
    }
    if (/(^|\.)youtube\.com$|^youtu\.be$/.test(u.hostname)) {
      let id = u.searchParams.get('list') || (u.pathname.match(/\/browse\/VL([\w-]+)/) || [])[1];
      const album = (u.pathname.match(/\/browse\/(MPREb_[\w-]+)/) || [])[1];
      if (album) { // (a YouTube Music album's own page: its list of songs)
        const a = await retry(() => once('ytm:' + album, () => ytmPost(post, 'browse', { context: WEB_MUSIC, browseId: album })));
        id = a && JSON.stringify(a).match(/"playlistId":"(OLAK5uy_[\w-]+)"/)?.[1];
      }
      if (!id) throw new Error('not a playlist link');
      let json = await retry(() => once('ytm:VL' + id, () => ytmPost(post, 'browse', { context: WEB_MUSIC, browseId: 'VL' + id }))); // (its first page too: YouTube Music is slow to answer now and then)
      if (!json) throw new Error("YouTube didn't answer: try again in a moment");
      const head = find(json, 'musicResponsiveHeaderRenderer') || find(json, 'musicDetailHeaderRenderer') || find(json, 'musicEditablePlaylistDetailHeaderRenderer');
      const name = (find(head, 'title')?.runs || []).map(x => x.text).join('') || 'YouTube playlist', tracks = [], seen = new Set();
      let partial = false, more = false;
      for (let page = 0; page < 200 && json; page++) { // (every page of it: 200 at most, ~20,000 songs; first: up to five, ~500)
        (function walk(o) {
          if (!o || typeof o !== 'object') return;
          const r = o.musicResponsiveListItemRenderer, vid = r?.playlistItemData?.videoId;
          if (vid) {
            const col = i => (r.flexColumns?.[i]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs || []).map(x => x.text).join('');
            const len = (r.fixedColumns?.[0]?.musicResponsiveListItemFixedColumnRenderer?.text?.runs || []).map(x => x.text).join('');
            if (!seen.has(vid)) { seen.add(vid); tracks.push({ title: col(0), artist: col(1).split(' • ')[0], album: col(2), dur: secs(len), yt: vid }); }
            return;
          }
          for (const k in o) walk(o[k]);
        })(json);
        const token = find(json, 'continuationCommand')?.token || find(json, 'nextContinuationData')?.continuation;
        if (pace.first && (tracks.length >= pace.first || page === 4)) { more = !!token; break; }
        if (token) await pause(pace.gap);
        const next = () => ytmPost(post, 'browse', { context: WEB_MUSIC, continuation: token });
        json = token ? await retry(() => page < 4 ? once('ytm:' + token, next) : next()) : null;
        if (token && !json) partial = true;
      }
      // (an album's list has no title of its own: the album its songs all share)
      const one = tracks.length && tracks.every(t => t.album && t.album === tracks[0].album) ? tracks[0].album : '';
      return { name: name === 'YouTube playlist' && one || name, from: 'YouTube', tracks, partial, ...(pace.first ? { more } : {}) };
    }
    if (/(^|\.)spotify\.com$/.test(u.hostname)) {
      const m = u.pathname.match(/\/(playlist|album)\/([A-Za-z0-9]+)/);
      if (!m) throw new Error('not a playlist link');
      const html = await pageOf(get, `https://open.spotify.com/embed/${m[1]}/${m[2]}`);
      const st = JSON.parse(html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/)?.[1] || '{}').props?.pageProps?.state, e = st?.data?.entity;
      if (!e?.trackList) throw new Error('Spotify page changed');
      let tracks = e.trackList.map(t => ({ title: t.title, artist: (t.subtitle || '').split(',')[0].trim(), album: m[1] === 'album' ? e.name : '', dur: Math.round((t.duration || 0) / 1000) })), partial = false;
      const pass = st.settings?.session?.accessToken;
      let more = false;
      if (pace.first && pace.first <= 100) return { name: e.name || 'Spotify playlist', from: 'Spotify', tracks, partial, more: m[1] === 'playlist' && tracks.length >= 100 && !!pass };
      if (m[1] === 'playlist' && tracks.length >= 100 && pass) { // (past the embed's 100: the whole list — first: its first 500 — or the 100 if that fails)
        const all = await spotifyContents(get, post, m[2], pass, pace).catch(() => { pace.state.spotifyQuery = ''; return null; });
        if (!all) { partial = !pace.first; more = pace.first; } // (Spotify not answering just now: the 100, and the importer says to try again later)
        else { if (all.tracks.length > tracks.length) ({ tracks, partial } = all); more = !!all.more; }
      }
      return { name: e.name || 'Spotify playlist', from: 'Spotify', tracks, partial, ...(pace.first ? { more } : {}) };
    }
    if (/(^|\.)apple\.com$/.test(u.hostname)) {
      const html = await pageOf(get, link);
      const j = JSON.parse(html.match(/<script type="application\/json" id="serialized-server-data">([\s\S]*?)<\/script>/)?.[1] || 'null');
      if (!j) throw new Error('Apple Music page changed');
      const tracks = [], seen = new Set();
      (function walk(o) {
        if (!o || typeof o !== 'object') return;
        const id = o.contentDescriptor?.kind === 'song' && o.contentDescriptor.identifiers?.storeAdamID;
        if (id && typeof o.title === 'string') { if (!seen.has(id)) { seen.add(id); tracks.push({ title: o.title, artist: o.artistName || o.subtitleLinks?.[0]?.title || '', dur: Math.round((o.duration || 0) / 1000), apple: id,
          album: o.tertiaryLinks?.[0]?.title || undefined, art: appleArt(o.artwork?.dictionary?.url), no: o.trackNumber || undefined }); } return; }
        for (const k in o) walk(o[k]);
      })(j);
      // (its own clean name, apple:title; the page title's is "… by its curator - Apple Music")
      const name = (html.match(/<meta name="apple:title" content="([^"]*)"/)?.[1] || (html.match(/<title>([^<]*)<\/title>/)?.[1] || '').replace(/^‎/, '').replace(/\s+-\s+(Playlist|Album|Single|EP).*$/, ''))
        .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d)).replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
        .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&').trim() || 'Apple Music playlist'; // (every entity: a name with "&#x27;" showed it as that)
      const pl = u.pathname.match(/^\/([a-z]{2})\/playlist\/(?:[^/]+\/)?(pl\.[\w.-]+)/);
      let partial = false;
      if (/\/album\//.test(u.pathname)) for (const t of tracks) t.album ||= name; // (an album's songs: its name)
      let more = false;
      if (pace.first && pace.first <= 100) return { name, from: 'Apple Music', tracks, partial: false, more: !!pl && tracks.length >= 100 };
      if (pl && tracks.length >= 100) { // (past the page's 100: Apple Music's web API, with its web player's own pass — in its script)
        const js = html.match(/\/assets\/index[^"']*\.js/)?.[0], pass = js && (await pageOf(get, 'https://music.apple.com' + js).catch(() => '')).match(/eyJ[\w-]+\.[\w-]+\.[\w-]+/)?.[0];
        if (!pass) partial = true; // (its script reshaped: the page's 100, and the importer says so)
        // (its length isn't said: four pages at a time, till one comes back short — a few asked past the end at most)
        const ask = at => get(`https://amp-api.music.apple.com/v1/catalog/${pl[1]}/playlists/${pl[2]}/tracks?offset=${at}&limit=100`,
          { Authorization: 'Bearer ' + pass, Origin: 'https://music.apple.com', 'User-Agent': UA });
        const page = at => retry(() => (at < HEAD ? once(`apple:${pl[2]}:${at}`, () => ask(at)) : ask(at)).then(JSON.parse)
          .then(r => r?.errors?.some(e => e.status === '404') ? { data: [] } : r?.data && r)); // (404: past its end, no more)
        const end = pace.first || 20000;
        let done = false;
        apple: for (let at = 100; pass && at < end; at += 100 * pace.pool) {
          for (const r of await pages(Array.from({ length: pace.pool }, (_, i) => at + i * 100).filter(o => o < end), page, pace)) {
            if (!r) { partial = true; break apple; }
            for (const t of r.data || []) if (t.attributes?.name && !seen.has(t.id)) { seen.add(t.id); { const a = t.attributes; tracks.push({ title: a.name, artist: a.artistName || '', dur: Math.round((a.durationInMillis || 0) / 1000), apple: t.id,
              album: a.albumName || undefined, art: appleArt(a.artwork?.url), preview: a.previews?.[0]?.url || undefined, genre: a.genreNames?.find(g => g !== 'Music') || a.genreNames?.[0],
              released: a.releaseDate || undefined, no: a.trackNumber || undefined, disc: a.discNumber || undefined }); } }
            if (!r.next) { done = true; break apple; }
          }
        }
        more = pace.first && !done; // (first: there's more past its 500 — or a page of them that didn't come: all of it read after)
      }
      return { name, from: 'Apple Music', tracks, partial: pace.first ? false : partial, ...(pace.first ? { more } : {}) };
    }
    throw new Error('not a YouTube, Spotify or Apple Music link');
  }

  class Engine {
    constructor({ get, post, keep } = {}) {
      if (typeof get !== 'function' || typeof post !== 'function') throw new TypeError('BridgeTheMusic: get(url, headers) and post(url, body, headers) are required');
      Object.assign(this, { get, post, keep, state: { spotifyQuery: '' } });
    }
    read(link, { gentle = false, first = false } = {}) { // (first: true — its first 500; a number — about that many: 100 or fewer, just its own page)
      return read(this.get, this.post, String(link || '').trim(), { ...(gentle ? GENTLE : BRISK), first: first === true ? HEAD : Math.min(HEAD, Math.max(0, +first || 0)), state: this.state, keep: this.keep });
    }
  }
  out.create = opts => new Engine(opts);
  out.version = '0.5.1';
})(typeof module === 'object' && module.exports ? module.exports : (globalThis.BridgeTheMusic = {}));
