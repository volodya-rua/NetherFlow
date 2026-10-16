// BridgeTheMusic for NetherFlow - Copyright (C) 2026 Volodya.rua - GNU GPL v3 only, with additional terms (credit, name and logo): see LICENSE and NOTICE.
// BridgeTheMusic, NetherFlow's playlist importer. From a public playlist's (or album's) link that its user pastes, it reads
// the list's name and songs as the service's own public page and web player show them to anyone — nothing signed in, no
// account of the user's, nothing kept. The platform hands it its own way to make a request, so the same code runs in Node
// (NetherFlow's desktop) and in the app's page on Android:
//   get(url, headers) → Promise<string>  ·  post(url, body, headers) → Promise<string>
//
//   const btm = BridgeTheMusic.create({ get, post })
//   await btm.read(link)   { name, from, tracks: [{ title, artist, album, dur, yt?, apple? }], partial }
// partial: some of a long list couldn't be read just now (what came before is kept; try again later).
(function (out) {
  'use strict';
  const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
  const secs = t => (t || '').split(':').reduce((a, n) => a * 60 + +n, 0); // "1:02:03" → 3723
  const WEB_MUSIC = { client: { clientName: 'WEB_REMIX', clientVersion: '1.20250101.01.00', hl: 'en', gl: 'US' } };
  const ytmPost = (post, path, body, headers = {}) => post('https://music.youtube.com/youtubei/v1/' + path + '?prettyPrint=false', JSON.stringify(body),
    { 'Content-Type': 'application/json', 'User-Agent': UA, Origin: 'https://music.youtube.com', Referer: 'https://music.youtube.com/', ...headers }).then(JSON.parse);

  // A playlist (or album) from its link — YouTube / YouTube Music, Spotify, Apple Music — as { name, from, tracks:
  // [{ title, artist, album, dur, yt (its YouTube video, when it's from there), apple (its iTunes id, from Apple) }] }.
  // ponytail: each service's public page or its web app's own API, read as they are now; if one reshapes, its branch is
  // the one spot to fix. Spotify's embed and Apple's page show a list's first 100 songs; the rest come from each one's
  // web player's own API, with the pass that player uses. (Spotify's: the query its web player lists a playlist with,
  // its id read from the player's script, so a new version of it is picked up by itself. Editorial lists too.)
  // a long list's pages, four asked at once, kept in their order: page(at) → its answer, or null (after its own retries)
  const POOL = 4;
  const pages = async (offsets, page) => {
    const got = new Array(offsets.length);
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(POOL, offsets.length) }, async () => { while (next < offsets.length) { const i = next++; got[i] = await page(offsets[i]); } }));
    return got;
  };
  const from100 = total => { const o = []; for (let at = 100; at < Math.min(total, 20000); at += 100) o.push(at); return o; };
  const retry = async f => { for (let tries = 0; tries < 3; tries++) { if (tries) await new Promise(r => setTimeout(r, 2000 * tries)); const v = await f().catch(() => null); if (v) return v; } return null; };
  let spotifyQuery = '';
  const spotifyContents = async (get, post, id, pass) => {
    if (!spotifyQuery) {
      const page = await get('https://open.spotify.com/', { 'User-Agent': UA });
      for (const src of page.match(/https:\/\/open\.spotifycdn\.com\/cdn\/build\/web-player\/web-player\.[\w]+\.js/g) || []) {
        spotifyQuery = (await get(src, { 'User-Agent': UA })).match(/"fetchPlaylistContents","query","([0-9a-f]{64})"/)?.[1] || '';
        if (spotifyQuery) break;
      }
      if (!spotifyQuery) throw new Error('Spotify web player changed');
    }
    const page = at => retry(() => post('https://api-partner.spotify.com/pathfinder/v2/query', JSON.stringify({ variables: { uri: 'spotify:playlist:' + id, offset: at, limit: 100 },
      operationName: 'fetchPlaylistContents', extensions: { persistedQuery: { version: 1, sha256Hash: spotifyQuery } } }),
      { Authorization: 'Bearer ' + pass, 'Content-Type': 'application/json;charset=UTF-8', 'User-Agent': UA }).then(t => JSON.parse(t).data?.playlistV2?.content).then(c => c?.items && c));
    // the first page says how long it is; the rest then four at a time (a page that won't come: the others kept, partial)
    const first = await page(0);
    if (!first) throw new Error('Spotify playlist unreadable');
    const rest = await pages(from100(first.totalCount ?? 0), page), tracks = [];
    for (const c of [first, ...rest]) if (c) for (const it of c.items) {
        const t = it.itemV2?.data;
        if (t?.__typename === 'Track' && t.name) tracks.push({ title: t.name, artist: t.artists?.items?.[0]?.profile?.name || '', album: t.albumOfTrack?.name || '', dur: Math.round((t.trackDuration?.totalMilliseconds || 0) / 1000) });
    }
    return { tracks, partial: rest.includes(null) };
  };
  async function read(get, post, link) {
    const u = new URL(link), find = (o, key) => { if (!o || typeof o !== 'object') return null; if (o[key]) return o[key]; for (const k in o) { const r = find(o[k], key); if (r) return r; } return null; };
    if (/^spotify\.(app\.)?link$/.test(u.hostname)) { // (the Spotify app's short link: its page names the playlist)
      const m = (await get(link, { 'User-Agent': UA })).match(/open\.spotify\.com\/(playlist|album|track)\/([A-Za-z0-9]{22})/);
      if (!m || m[1] === 'track') throw new Error(m ? 'that\'s a song, not a playlist' : 'not a playlist link');
      return read(get, post, `https://open.spotify.com/${m[1]}/${m[2]}`);
    }
    if (/(^|\.)youtube\.com$|^youtu\.be$/.test(u.hostname)) {
      let id = u.searchParams.get('list') || (u.pathname.match(/\/browse\/VL([\w-]+)/) || [])[1];
      const album = (u.pathname.match(/\/browse\/(MPREb_[\w-]+)/) || [])[1];
      if (album) { // (a YouTube Music album's own page: its list of songs)
        const a = await retry(() => ytmPost(post, 'browse', { context: WEB_MUSIC, browseId: album }));
        id = a && JSON.stringify(a).match(/"playlistId":"(OLAK5uy_[\w-]+)"/)?.[1];
      }
      if (!id) throw new Error('not a playlist link');
      let json = await retry(() => ytmPost(post, 'browse', { context: WEB_MUSIC, browseId: 'VL' + id })); // (its first page too: YouTube Music is slow to answer now and then)
      if (!json) throw new Error("YouTube didn't answer: try again in a moment");
      const head = find(json, 'musicResponsiveHeaderRenderer') || find(json, 'musicDetailHeaderRenderer') || find(json, 'musicEditablePlaylistDetailHeaderRenderer');
      const name = (find(head, 'title')?.runs || []).map(x => x.text).join('') || 'YouTube playlist', tracks = [], seen = new Set();
      let partial = false;
      for (let page = 0; page < 200 && json; page++) { // (every page of it: 200 at most, ~20,000 songs)
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
        json = token ? await retry(() => ytmPost(post, 'browse', { context: WEB_MUSIC, continuation: token })) : null;
        if (token && !json) partial = true;
      }
      // (an album's list has no title of its own: the album its songs all share)
      const one = tracks.length && tracks.every(t => t.album && t.album === tracks[0].album) ? tracks[0].album : '';
      return { name: name === 'YouTube playlist' && one || name, from: 'YouTube', tracks, partial };
    }
    if (/(^|\.)spotify\.com$/.test(u.hostname)) {
      const m = u.pathname.match(/\/(playlist|album)\/([A-Za-z0-9]+)/);
      if (!m) throw new Error('not a playlist link');
      const html = await get(`https://open.spotify.com/embed/${m[1]}/${m[2]}`, { 'User-Agent': UA });
      const st = JSON.parse(html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/)?.[1] || '{}').props?.pageProps?.state, e = st?.data?.entity;
      if (!e?.trackList) throw new Error('Spotify page changed');
      let tracks = e.trackList.map(t => ({ title: t.title, artist: (t.subtitle || '').split(',')[0].trim(), album: m[1] === 'album' ? e.name : '', dur: Math.round((t.duration || 0) / 1000) })), partial = false;
      const pass = st.settings?.session?.accessToken;
      if (m[1] === 'playlist' && tracks.length >= 100 && pass) { // (past the embed's 100: the whole list, or the 100 if that fails)
        const all = await spotifyContents(get, post, m[2], pass).catch(() => { spotifyQuery = ''; return null; });
        if (!all) partial = true; // (Spotify not answering just now: the 100, and the importer says to try again later)
        else if (all.tracks.length > tracks.length) ({ tracks, partial } = all);
      }
      return { name: e.name || 'Spotify playlist', from: 'Spotify', tracks, partial };
    }
    if (/(^|\.)apple\.com$/.test(u.hostname)) {
      const html = await get(link, { 'User-Agent': UA });
      const j = JSON.parse(html.match(/<script type="application\/json" id="serialized-server-data">([\s\S]*?)<\/script>/)?.[1] || 'null');
      if (!j) throw new Error('Apple Music page changed');
      const tracks = [], seen = new Set();
      (function walk(o) {
        if (!o || typeof o !== 'object') return;
        const id = o.contentDescriptor?.kind === 'song' && o.contentDescriptor.identifiers?.storeAdamID;
        if (id && typeof o.title === 'string') { if (!seen.has(id)) { seen.add(id); tracks.push({ title: o.title, artist: o.artistName || o.subtitleLinks?.[0]?.title || '', dur: Math.round((o.duration || 0) / 1000), apple: id }); } return; }
        for (const k in o) walk(o[k]);
      })(j);
      // (its own clean name, apple:title; the page title's is "… by its curator - Apple Music")
      const name = (html.match(/<meta name="apple:title" content="([^"]*)"/)?.[1] || (html.match(/<title>([^<]*)<\/title>/)?.[1] || '').replace(/^‎/, '').replace(/\s+-\s+(Playlist|Album|Single|EP).*$/, ''))
        .replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"') || 'Apple Music playlist';
      const pl = u.pathname.match(/^\/([a-z]{2})\/playlist\/(?:[^/]+\/)?(pl\.[\w.-]+)/);
      let partial = false;
      if (pl && tracks.length >= 100) { // (past the page's 100: Apple Music's web API, with its web player's own pass — in its script)
        const js = html.match(/\/assets\/index[^"']*\.js/)?.[0], pass = js && (await get('https://music.apple.com' + js, { 'User-Agent': UA }).catch(() => '')).match(/eyJ[\w-]+\.[\w-]+\.[\w-]+/)?.[0];
        if (!pass) partial = true; // (its script reshaped: the page's 100, and the importer says so)
        // (its length isn't said: four pages at a time, till one comes back short — a few asked past the end at most)
        const page = at => retry(() => get(`https://amp-api.music.apple.com/v1/catalog/${pl[1]}/playlists/${pl[2]}/tracks?offset=${at}&limit=100`,
          { Authorization: 'Bearer ' + pass, Origin: 'https://music.apple.com', 'User-Agent': UA }).then(JSON.parse)
          .then(r => r?.errors?.some(e => e.status === '404') ? { data: [] } : r?.data && r)); // (404: past its end, no more)
        apple: for (let at = 100; pass && at < 20000; at += 100 * POOL) {
          for (const r of await pages(Array.from({ length: POOL }, (_, i) => at + i * 100).filter(o => o < 20000), page)) {
            if (!r) { partial = true; break apple; }
            for (const t of r.data || []) if (t.attributes?.name && !seen.has(t.id)) { seen.add(t.id); tracks.push({ title: t.attributes.name, artist: t.attributes.artistName || '', dur: Math.round((t.attributes.durationInMillis || 0) / 1000), apple: t.id }); }
            if (!r.next) break apple;
          }
        }
      }
      return { name, from: 'Apple Music', tracks, partial };
    }
    throw new Error('not a YouTube, Spotify or Apple Music link');
  }

  class Engine {
    constructor({ get, post } = {}) {
      if (typeof get !== 'function' || typeof post !== 'function') throw new TypeError('BridgeTheMusic: get(url, headers) and post(url, body, headers) are required');
      Object.assign(this, { get, post });
    }
    read(link) { return read(this.get, this.post, String(link || '').trim()); }
  }
  out.create = opts => new Engine(opts);
  out.version = '0.2.0';
})(typeof module === 'object' && module.exports ? module.exports : (globalThis.BridgeTheMusic = {}));
