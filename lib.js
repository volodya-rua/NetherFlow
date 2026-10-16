// NetherFlow - Copyright (C) 2026 Volodya.rua - GNU GPL v3 only, with additional terms (credit, name and logo): see LICENSE and NOTICE.
// Shared by the desktop app's server (Node) and the Android app (inside the page): keyless YouTube
// search and word-by-word lyric timing. Each takes get(url, headers) → Promise<string>, so each side
// brings its own HTTP (Node's fetch on desktop, native HTTP on Android — a browser page can't do it).
(function (lib) {
  const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
  const secs = t => (t || '').split(':').reduce((a, n) => a * 60 + +n, 0); // "1:02:03" → 3723

  // ponytail: reads YouTube's own results page, since there is no keyless search API.
  // If YouTube reshapes that page, the parsing below is the one spot to fix.
  lib.ytSearch = async (get, q) => {
    const html = await get('https://www.youtube.com/results?sp=EgIQAQ%253D%253D&search_query=' + encodeURIComponent(q),
      { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9', Cookie: 'SOCS=CAI; CONSENT=YES+1' }); // cookie skips the EU consent page
    // YouTube serves the results in one of two shapes (it A/B tests them): a JSON data block, or a script variable.
    const json = html.match(/<script[^>]*id="yt-initial-data"[^>]*>([\s\S]*?)<\/script>/)?.[1]
              || html.match(/var ytInitialData = (\{.*?\});<\/script>/s)?.[1];
    if (!json) throw new Error('YouTube search page changed');
    const out = [];
    (function walk(o) {
      if (!o || typeof o !== 'object' || out.length >= 12) return;
      const v = o.videoRenderer;
      if (v?.videoId && v.lengthText?.simpleText) out.push({
        id: v.videoId,
        title: (v.title?.runs || []).map(x => x.text).join(''),
        channel: v.ownerText?.runs?.[0]?.text || '',
        dur: secs(v.lengthText.simpleText),
      });
      for (const k in o) walk(o[k]);
    })(JSON.parse(json));
    return out;
  };

  // YouTube Music's song search: the label's own uploads of the album recordings (the "Artist - Topic" videos, which
  // YouTube's ordinary search leaves out). Lyrics are timed to the album recording, so these keep them in sync.
  // post(url, body, headers) → Promise<string>. ponytail: YouTube Music's own web API; if it reshapes its answers,
  // the walk below is the one spot to fix.
  // Each: { id, title, channel, artist, album, dur, art (its cover, 544 px) }; the list's .corrected: the search YouTube
  // Music ran instead, when it read the words as a misspelling ("levitatng" → "levitating").
  const WEB_MUSIC = { client: { clientName: 'WEB_REMIX', clientVersion: '1.20250101.01.00', hl: 'en', gl: 'US' } };
  const ytmPost = (post, path, body, headers = {}) => post('https://music.youtube.com/youtubei/v1/' + path + '?prettyPrint=false', JSON.stringify(body),
    { 'Content-Type': 'application/json', 'User-Agent': UA, Origin: 'https://music.youtube.com', Referer: 'https://music.youtube.com/', ...headers }).then(JSON.parse);
  lib.ytMusic = async (post, q) => {
    const json = await ytmPost(post, 'search', { context: WEB_MUSIC, query: q, params: 'EgWKAQIIAWoKEAkQBRAKEAMQBA==' }); // (the "Songs" filter)
    const out = [];
    (function walk(o) {
      if (!o || typeof o !== 'object' || out.length >= 10) return;
      if (o.showingResultsForRenderer) out.corrected = (o.showingResultsForRenderer.correctedQuery?.runs || []).map(x => x.text).join('');
      const r = o.musicResponsiveListItemRenderer, id = r?.playlistItemData?.videoId;
      if (id) {
        const col = i => (r.flexColumns?.[i]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs || []).map(x => x.text).join('');
        const meta = col(1).split(' • '), len = meta.find(x => /^\d+(:\d\d)+$/.test(x));
        const art = (r.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails || []).slice(-1)[0]?.url?.replace(/=w\d+-h\d+/, '=w544-h544') || '';
        if (len) out.push({ id, title: col(0), channel: meta[0] + ' - Topic', artist: meta[0], album: meta.length > 2 ? meta[1] : '', dur: secs(len), art });
        return;
      }
      for (const k in o) walk(o[k]);
    })(json);
    return out;
  };
  // What YouTube Music suggests as a search is typed (misspellings mended): up to 8 phrases.
  lib.ytmSuggest = async (post, q) => {
    const json = await ytmPost(post, 'music/get_search_suggestions', { context: WEB_MUSIC, input: q });
    const out = [];
    (function walk(o) {
      if (!o || typeof o !== 'object' || out.length >= 8) return;
      if (o.searchSuggestionRenderer) return void out.push((o.searchSuggestionRenderer.suggestion?.runs || []).map(x => x.text).join(''));
      for (const k in o) walk(o[k]);
    })(json);
    return out;
  };

  // ---- Explore: YouTube Music's own explore page (new albums and singles, moods and genres, what's trending), its charts
  // (a country's: the most played music videos, by genre and language), a mood's or genre's playlists, an album's songs.
  // gl: the country (two letters). ponytail: its web pages' shapes as they are now; if they reshape, these walks are the
  // spots to fix.
  const ctxFor = gl => ({ client: { ...WEB_MUSIC.client, gl: /^[A-Z]{2}$/.test(gl || '') ? gl : 'US' } });
  const runsOf = t => (t?.runs || []).map(x => x.text).join('');
  const firstOf = (o, key) => { if (!o || typeof o !== 'object') return null; if (o[key]) return o[key]; for (const k in o) { const r = firstOf(o[k], key); if (r) return r; } return null; };
  const artOf = o => ((o?.musicThumbnailRenderer?.thumbnail?.thumbnails || o?.thumbnails || []).slice(-1)[0]?.url || '').replace(/=w\d+-h\d+[\w-]*$/, '=w544-h544-l90-rj');
  const shelvesOf = json => { const out = []; (function walk(o) { if (!o || typeof o !== 'object') return; const sh = o.musicCarouselShelfRenderer || o.gridRenderer;
    if (sh) return void out.push({ title: runsOf(sh.header?.musicCarouselShelfBasicHeaderRenderer?.title) || runsOf(sh.header?.gridHeaderRenderer?.title), items: sh.contents || sh.items || [] });
    for (const k in o) walk(o[k]); })(json); return out; };
  const twoRow = c => { const t = c?.musicTwoRowItemRenderer; return t && { id: t.navigationEndpoint?.browseEndpoint?.browseId || '', title: runsOf(t.title), sub: runsOf(t.subtitle), art: artOf(t.thumbnailRenderer) }; };
  // (asked again, a little later, when it doesn't answer: YouTube Music is slow now and then)
  const ytmTry = async f => { for (let tries = 0; tries < 3; tries++) { if (tries) await new Promise(r => setTimeout(r, 1500 * tries)); try { return await f(); } catch {} } throw new Error("YouTube Music didn't answer"); };
  const listOf = (shelf, test) => shelf.items.map(twoRow).filter(t => t && test.test(t.id));
  // { albums: [{ id (MPREb_…), title, artist, kind (Album, Single, EP), art }], moods: [{ title, params, color }], trending:
  // [{ id (a video), title, artist, art }] }
  lib.ytmExplore = async (post, gl) => {
    const json = await ytmTry(() => ytmPost(post, 'browse', { context: ctxFor(gl), browseId: 'FEmusic_explore' })), out = { albums: [], moods: [], trending: [] };
    for (const sh of shelvesOf(json)) for (const c of sh.items) {
      const t = twoRow(c);
      if (t && /^MPREb_/.test(t.id)) { const [kind, ...by] = t.sub.split(' • '); out.albums.push({ id: t.id, title: t.title, artist: by.join(' • ') || kind, kind: by.length ? kind : 'Album', art: t.art }); continue; }
      const n = c.musicNavigationButtonRenderer, be = n?.clickCommand?.browseEndpoint;
      if (be?.browseId === 'FEmusic_moods_and_genres_category' && be.params) {
        out.moods.push({ title: runsOf(n.buttonText), params: be.params, color: n.solid?.leftStripeColor ? '#' + (n.solid.leftStripeColor & 0xffffff).toString(16).padStart(6, '0') : '' }); continue;
      }
      const r = c.musicResponsiveListItemRenderer, id = r?.playlistItemData?.videoId;
      if (id && /^[\w-]{11}$/.test(id)) { const col = i => runsOf(r.flexColumns?.[i]?.musicResponsiveListItemFlexColumnRenderer?.text); out.trending.push({ id, title: col(0), artist: col(1).split(' • ')[0], art: artOf(r.thumbnail) }); }
    }
    if (!out.albums.length && !out.moods.length && !out.trending.length) throw new Error('YouTube Music explore page changed');
    return out;
  };
  // { where (the country YouTube Music gave charts for: "Global" where it has none of its own), lists: [{ id (a playlist),
  // title, sub, art, group }] }
  lib.ytmCharts = async (post, gl) => {
    const json = await ytmTry(() => ytmPost(post, 'browse', { context: ctxFor(gl), browseId: 'FEmusic_charts', formData: { selectedValues: [/^[A-Z]{2}$/.test(gl || '') ? gl : 'US'] } }));
    const lists = [];
    for (const sh of shelvesOf(json)) for (const t of listOf(sh, /^VL[\w-]+$/)) lists.push({ id: t.id.slice(2), title: t.title, sub: t.sub, art: t.art, group: sh.title });
    if (!lists.length) throw new Error('YouTube Music charts changed');
    return { where: runsOf(firstOf(json, 'musicSortFilterButtonRenderer')?.title), lists };
  };
  // a mood's or genre's page: { title, groups: [{ title, lists: [{ id, title, sub, art }] }] } (YouTube Music's own playlists)
  lib.ytmMood = async (post, params, gl) => {
    if (!/^[\w-]{8,120}={0,2}$/.test(params || '')) throw new Error('not a mood');
    const json = await ytmTry(() => ytmPost(post, 'browse', { context: ctxFor(gl), browseId: 'FEmusic_moods_and_genres_category', params }));
    const groups = shelvesOf(json).map(sh => ({ title: sh.title, lists: listOf(sh, /^VL[\w-]+$/).map(t => ({ id: t.id.slice(2), title: t.title, sub: t.sub, art: t.art })) })).filter(g => g.lists.length);
    if (!groups.length) throw new Error('YouTube Music mood page changed');
    return { title: runsOf(firstOf(json, 'musicHeaderRenderer')?.title), groups };
  };
  // an album (MPREb_…): { title, artist, kind, year, art, tracks: [{ id (its song), title, artist, dur }] }
  lib.ytmAlbum = async (post, id, gl) => {
    if (!/^MPREb_[\w-]{4,40}$/.test(id || '')) throw new Error('not an album');
    const json = await ytmTry(() => ytmPost(post, 'browse', { context: ctxFor(gl), browseId: id }));
    const h = firstOf(json, 'musicResponsiveHeaderRenderer') || firstOf(json, 'musicDetailHeaderRenderer') || {}, sub = runsOf(h.subtitle).split(' • ');
    const artist = runsOf(h.straplineTextOne) || sub[1] || '', tracks = [];
    (function walk(o) {
      if (!o || typeof o !== 'object') return;
      const r = o.musicResponsiveListItemRenderer, v = r?.playlistItemData?.videoId;
      if (v) {
        const col = i => runsOf(r.flexColumns?.[i]?.musicResponsiveListItemFlexColumnRenderer?.text);
        tracks.push({ id: v, title: col(0), artist: col(1) || artist, dur: secs(runsOf(r.fixedColumns?.[0]?.musicResponsiveListItemFixedColumnRenderer?.text)) });
        return;
      }
      for (const k in o) walk(o[k]);
    })(json);
    if (!tracks.length) throw new Error('YouTube Music album page changed');
    return { title: runsOf(h.title), artist, kind: sub[0] || 'Album', year: +sub.find(x => /^\d{4}$/.test(x)) || 0, art: artOf(h.thumbnail), tracks };
  };

  // Apple's top podcasts in a country (its own chart): [{ id (Apple's), name, artist, art, genre }] — their feeds looked up
  // by id at Apple (which a page may ask itself)
  lib.topPodcasts = async (get, cc) => {
    let j; try { j = JSON.parse(await get(`https://rss.marketingtools.apple.com/api/v2/${/^[a-z]{2}$/.test(cc) ? cc : 'us'}/podcasts/top/50/podcasts.json`, { 'User-Agent': UA })); }
    catch (e) { throw new Error(/timeout/i.test(e.message) ? 'Apple\'s chart took too long' : 'Apple\'s chart didn\'t answer'); } // (an error page, not the chart)
    return (j.feed?.results || []).filter(x => /^\d+$/.test(x.id)).map(x => ({ id: +x.id, name: String(x.name || ''), artist: String(x.artistName || ''), art: String(x.artworkUrl100 || ''), genre: x.genres?.[0]?.name || '' }));
  };

  // YouTube Music's radio for a song: what its Autoplay plays after it — songs alike in genre, mood, era and language, by
  // what listeners play together. Each { id (the label's own upload, an album recording), title, artist, album, year, dur,
  // art, type }; the song itself left out.
  lib.ytmRadio = async (post, id) => {
    const json = await ytmPost(post, 'next', { context: WEB_MUSIC, videoId: id, playlistId: 'RDAMVM' + id, isAudioOnly: true });
    const out = [], seen = new Set([id]);
    (function walk(o) {
      if (!o || typeof o !== 'object') return;
      const v = o.playlistPanelVideoRenderer;
      if (v?.videoId) {
        const by = (v.longBylineText?.runs || []).map(x => x.text).join('').split(' • '), len = v.lengthText?.runs?.[0]?.text || '';
        const art = (v.thumbnail?.thumbnails || []).slice(-1)[0]?.url?.replace(/=w\d+-h\d+/, '=w544-h544') || '';
        if (!seen.has(v.videoId) && len) { seen.add(v.videoId); out.push({ id: v.videoId, title: (v.title?.runs || []).map(x => x.text).join(''), artist: by[0] || '',
          album: by.length > 2 ? by[1] : '', year: +by.find(x => /^\d{4}$/.test(x)) || 0, dur: secs(len), art,
          type: (v.navigationEndpoint?.watchEndpoint?.watchEndpointMusicSupportedConfigs?.watchEndpointMusicConfig?.musicVideoType || '').replace('MUSIC_VIDEO_TYPE_', '') }); } // (ATV: the album recording; OMV: its music video; UGC: anyone's upload)
        return;
      }
      for (const k in o) walk(o[k]);
    })(json);
    return out;
  };

  // A playlist (or album) from its link — YouTube / YouTube Music, Spotify, Apple Music — as { name, from, tracks:
  // [{ title, artist, album, dur, yt (its YouTube video, when it's from there), apple (its iTunes id, from Apple) }] }.
  // ponytail: each service's public page or its web app's own API, read as they are now; if one reshapes, its branch is
  // the one spot to fix. Spotify's embed and Apple's page show a list's first 100 songs; the rest come from each one's
  // web player's own API, with the pass that player uses. (Spotify's: the query its web player lists a playlist with,
  // its id read from the player's script, so a new version of it is picked up by itself. Editorial lists too.)
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
    const tracks = [];
    let total = Infinity, partial = false;
    for (let at = 0; at < total && at < 20000; at += 100) {
      const body = JSON.stringify({ variables: { uri: 'spotify:playlist:' + id, offset: at, limit: 100 }, operationName: 'fetchPlaylistContents',
        extensions: { persistedQuery: { version: 1, sha256Hash: spotifyQuery } } });
      const c = await retry(() => post('https://api-partner.spotify.com/pathfinder/v2/query', body,
        { Authorization: 'Bearer ' + pass, 'Content-Type': 'application/json;charset=UTF-8', 'User-Agent': UA }).then(t => JSON.parse(t).data?.playlistV2?.content).then(c => c?.items && c));
      if (!c) { if (!tracks.length) throw new Error('Spotify playlist unreadable'); partial = true; break; } // (what came before is kept)
      total = c.totalCount ?? 0;
      for (const it of c.items) {
        const t = it.itemV2?.data;
        if (t?.__typename === 'Track' && t.name) tracks.push({ title: t.name, artist: t.artists?.items?.[0]?.profile?.name || '', album: t.albumOfTrack?.name || '', dur: Math.round((t.trackDuration?.totalMilliseconds || 0) / 1000) });
      }
      if (!c.items.length) break;
    }
    return { tracks, partial };
  };
  lib.playlist = async (get, post, link) => {
    const u = new URL(link), find = (o, key) => { if (!o || typeof o !== 'object') return null; if (o[key]) return o[key]; for (const k in o) { const r = find(o[k], key); if (r) return r; } return null; };
    if (/^spotify\.(app\.)?link$/.test(u.hostname)) { // (the Spotify app's short link: its page names the playlist)
      const m = (await get(link, { 'User-Agent': UA })).match(/open\.spotify\.com\/(playlist|album|track)\/([A-Za-z0-9]{22})/);
      if (!m || m[1] === 'track') throw new Error(m ? 'that\'s a song, not a playlist' : 'not a playlist link');
      return lib.playlist(get, post, `https://open.spotify.com/${m[1]}/${m[2]}`);
    }
    if (/(^|\.)youtube\.com$|^youtu\.be$/.test(u.hostname)) {
      const id = u.searchParams.get('list') || (u.pathname.match(/\/browse\/VL([\w-]+)/) || [])[1];
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
      return { name, from: 'YouTube', tracks, partial };
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
        for (let at = 100; pass && at < 20000; at += 100) {
          const r = await retry(() => get(`https://amp-api.music.apple.com/v1/catalog/${pl[1]}/playlists/${pl[2]}/tracks?offset=${at}&limit=100`,
            { Authorization: 'Bearer ' + pass, Origin: 'https://music.apple.com', 'User-Agent': UA }).then(JSON.parse)
            .then(r => r?.errors?.some(e => e.status === '404') ? { data: [] } : r?.data && r)); // (404: past its end, no more)
          if (!r) { partial = true; break; }
          for (const t of r.data || []) if (t.attributes?.name && !seen.has(t.id)) { seen.add(t.id); tracks.push({ title: t.attributes.name, artist: t.attributes.artistName || '', dur: Math.round((t.attributes.durationInMillis || 0) / 1000), apple: t.id }); }
          if (!r.next) break;
        }
      }
      return { name, from: 'Apple Music', tracks, partial };
    }
    throw new Error('not a YouTube, Spotify or Apple Music link');
  };

  // Audius (an open music platform with a public API for apps): its tracks for a search, each { id, title, artist,
  // verified (the artist's own, checked account), dur, url (its full stream: 320 kbps MP3) }.
  lib.audius = async (get, q) => {
    const j = JSON.parse(await get('https://api.audius.co/v1/tracks/search?' + new URLSearchParams({ query: q, app_name: 'NetherFlow' }), { 'User-Agent': UA }));
    return (j.data || []).filter(t => t.is_streamable !== false && !t.is_stream_gated).map(t => ({ id: t.id, title: t.title || '', artist: t.user?.name || '',
      verified: !!t.user?.is_verified, dur: t.duration || 0, url: `https://api.audius.co/v1/tracks/${t.id}/stream?app_name=NetherFlow` }));
  };

  // Word-by-word lyric timing from two music services' public lyric endpoints: NetEase Cloud Music ("yrc") and
  // Kugou ("krc"). Each must be the same artist at the same length (±3s), so the timing matches the recording
  // being played. Both are asked; the one closest in length wins. Returned in NetEase's yrc format. Neither with word
  // timing: NetEase's line-timed lyrics if it has them ({ lrc }), for songs the other lyrics sources don't have.
  const norm = s => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/\s*[([].*?[)\]]/g, '').replace(/[^\p{L}\p{N}]/gu, '');
  const sameSong = (a, b) => { a = norm(a); b = norm(b); return !!a && !!b && (a.startsWith(b) || b.startsWith(a)); };
  lib.words = async (get, artist, title, dur) => {
    const found = (await Promise.all([netease, kugou].map(f => f(get, artist, title, dur).catch(() => null)))).filter(Boolean);
    const fit = (a, b) => Math.abs(a.dur - dur) - Math.abs(b.dur - dur);
    return found.filter(x => x.yrc).sort(fit)[0] || found.filter(x => x.lrc).sort(fit)[0] || {};
  };

  async function netease(get, artist, title, dur) {
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
    // no word timing: its line-timed lyrics, without the credit lines at the top (and none for an instrumental)
    const credit = /^\s*(\[[^\]]*\])*\s*(作词|作曲|编曲|制作人?|混音|母带|和声|吉他|贝斯|鼓|弦乐|lyricist|composer|producer|arranger|mix(ing)?|master(ing)?|lyrics|music|written by)\s*[:：]/i;
    const lrc = (l.lrc?.lyric || '').split('\n').filter(x => !credit.test(x)).join('\n');
    return /\[\d+:\d+/.test(lrc) && !/纯音乐/.test(lrc) ? { lrc, dur: hit.dt / 1000, src } : null;
  }

  // Kugou's lyric files are XOR-scrambled with a fixed key, then zlib-compressed.
  const KRC_KEY = [64, 71, 97, 119, 94, 50, 116, 71, 81, 54, 49, 45, 206, 210, 110, 105];
  async function kugou(get, artist, title, dur) {
    const json = async url => JSON.parse(await get(url, { 'User-Agent': UA }));
    const first = artist.split(/,|&| feat\.? | x /i)[0].trim(); // its search only finds "Artist - Title" with one artist
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
      const words = [...m[3].matchAll(/<(\d+),(\d+),\d+>([^<]*)/g)], text = words.map(w => w[3]).join('');
      // the top has lines that aren't sung: "Title - Artist", "Lyrics by：…", or filler timing (every word the same length)
      if (opening && (/ - |[:：]/.test(text) || words.length > 1 && words.every(w => w[2] === words[0][2]))) return '';
      opening = false;
      return `[${m[1]},${m[2]}]` + words.map(([, at, len, text]) => `(${+m[1] + +at},${len},0)${text}`).join('');
    }).filter(Boolean).join('\n');
  }
  lib.krcToYrc = krcToYrc; // for the self-check

  // A QR code for a text (a shared playlist's link): its modules, row by row, true = dark; null if it's too long for one.
  // Byte mode, versions 1–40: the smallest version it fits at error correction L, then the strongest level (M, Q, H)
  // that still fits that version; the mask that scores best. (After Project Nayuki's QR Code generator.)
  lib.qr = text => {
    const ECC = [ // per level (L, M, Q, H): error-correction codewords per block, and blocks, for versions 1–40
      [[7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
        [1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25], 1],
      [[10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28],
        [1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49], 0],
      [[13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28, 30, 30, 30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
        [1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68], 3],
      [[17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
        [1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81], 2]];
    const bytes = new TextEncoder().encode(text);
    const raw = v => { let n = (16 * v + 128) * v + 64; if (v >= 2) { const a = Math.floor(v / 7) + 2; n -= (25 * a - 10) * a - 55; if (v >= 7) n -= 36; } return n; };
    const room = (v, e) => (Math.floor(raw(v) / 8) - ECC[e][0][v - 1] * ECC[e][1][v - 1]) * 8;
    const need = v => 4 + (v < 10 ? 8 : 16) + bytes.length * 8;
    let ver = 1;
    while (ver <= 40 && need(ver) > room(ver, 0)) ver++;
    if (ver > 40) return null;
    let ecl = 0;
    while (ecl < 3 && need(ver) <= room(ver, ecl + 1)) ecl++;
    // the data: mode, count, bytes, terminator, then padding to fill
    const bits = [], put = (val, n) => { for (let i = n - 1; i >= 0; i--) bits.push(val >>> i & 1); };
    put(4, 4); put(bytes.length, ver < 10 ? 8 : 16); bytes.forEach(b => put(b, 8));
    const cap = room(ver, ecl);
    put(0, Math.min(4, cap - bits.length)); put(0, (8 - bits.length % 8) % 8);
    for (let pad = 0xEC; bits.length < cap; pad ^= 0xEC ^ 0x11) put(pad, 8);
    const data = []; for (let i = 0; i < bits.length; i += 8) data.push(bits.slice(i, i + 8).reduce((a, b) => a << 1 | b, 0));
    // Reed–Solomon over GF(256), split into blocks and interleaved
    const mul = (x, y) => { let z = 0; for (let i = 7; i >= 0; i--) { z = (z << 1) ^ ((z >>> 7) * 0x11D); z ^= ((y >>> i) & 1) * x; } return z; };
    const blocks = ECC[ecl][1][ver - 1], eccLen = ECC[ecl][0][ver - 1], total = Math.floor(raw(ver) / 8);
    const div = new Array(eccLen).fill(0); div[eccLen - 1] = 1;
    for (let i = 0, root = 1; i < eccLen; i++, root = mul(root, 2)) for (let j = 0; j < eccLen; j++) { div[j] = mul(div[j], root); if (j + 1 < eccLen) div[j] ^= div[j + 1]; }
    const short = blocks - total % blocks, shortLen = Math.floor(total / blocks), parts = [];
    for (let i = 0, k = 0; i < blocks; i++) {
      const dat = data.slice(k, k + shortLen - eccLen + (i < short ? 0 : 1)); k += dat.length;
      const rem = new Array(eccLen).fill(0);
      for (const b of dat) { const f = b ^ rem.shift(); rem.push(0); div.forEach((c, j) => { rem[j] ^= mul(c, f); }); }
      if (i < short) dat.push(0);
      parts.push(dat.concat(rem));
    }
    const words = [];
    for (let i = 0; i < parts[0].length; i++) parts.forEach((p, j) => { if (i !== shortLen - eccLen || j >= short) words.push(p[i]); });
    // the patterns: finders, timing, alignment, format and version areas (fixed: the mask leaves them be)
    const size = ver * 4 + 17, m = [], fixed = [];
    for (let y = 0; y < size; y++) { m.push(new Array(size).fill(false)); fixed.push(new Array(size).fill(false)); }
    const set = (x, y, dark) => { m[y][x] = dark; fixed[y][x] = true; };
    for (let i = 0; i < size; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
    for (const [cx, cy] of [[3, 3], [size - 4, 3], [3, size - 4]])
      for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
        const x = cx + dx, y = cy + dy, d = Math.max(Math.abs(dx), Math.abs(dy));
        if (x >= 0 && x < size && y >= 0 && y < size) set(x, y, d !== 2 && d !== 4);
      }
    if (ver > 1) {
      const n = Math.floor(ver / 7) + 2, step = Math.floor((ver * 8 + n * 3 + 5) / (n * 4 - 4)) * 2, at = [6];
      for (let p = size - 7; at.length < n; p -= step) at.splice(1, 0, p);
      at.forEach((y, i) => at.forEach((x, j) => {
        if (i === 0 && j === 0 || i === 0 && j === n - 1 || i === n - 1 && j === 0) return;
        for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(x + dx, y + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
      }));
    }
    const format = mask => {
      const d = ECC[ecl][2] << 3 | mask; let r = d;
      for (let i = 0; i < 10; i++) r = (r << 1) ^ ((r >>> 9) * 0x537);
      const b = (d << 10 | r) ^ 0x5412, bit = i => (b >>> i & 1) === 1;
      for (let i = 0; i <= 5; i++) set(8, i, bit(i));
      set(8, 7, bit(6)); set(8, 8, bit(7)); set(7, 8, bit(8));
      for (let i = 9; i < 15; i++) set(14 - i, 8, bit(i));
      for (let i = 0; i < 8; i++) set(size - 1 - i, 8, bit(i));
      for (let i = 8; i < 15; i++) set(8, size - 15 + i, bit(i));
      set(8, size - 8, true);
    };
    format(0);
    if (ver >= 7) {
      let r = ver; for (let i = 0; i < 12; i++) r = (r << 1) ^ ((r >>> 11) * 0x1F25);
      const b = ver << 12 | r;
      for (let i = 0; i < 18; i++) { const dark = (b >>> i & 1) === 1, a = size - 11 + i % 3, c = Math.floor(i / 3); set(a, c, dark); set(c, a, dark); }
    }
    // the codewords, in two-column zigzags from the bottom right
    for (let right = size - 1, i = 0; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (let v = 0; v < size; v++) for (let j = 0; j < 2; j++) {
        const x = right - j, y = (right + 1) & 2 ? v : size - 1 - v;
        if (!fixed[y][x] && i < words.length * 8) { m[y][x] = (words[i >>> 3] >>> (7 - (i & 7)) & 1) === 1; i++; }
      }
    }
    // the mask: each of the eight tried, the one with the fewest look-alike runs, blocks and finder shapes kept
    const MASKS = [(x, y) => (x + y) % 2, (x, y) => y % 2, x => x % 3, (x, y) => (x + y) % 3, (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2,
      (x, y) => x * y % 2 + x * y % 3, (x, y) => (x * y % 2 + x * y % 3) % 2, (x, y) => ((x + y) % 2 + x * y % 3) % 2];
    const flip = k => { for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (!fixed[y][x] && MASKS[k](x, y) === 0) m[y][x] = !m[y][x]; };
    const score = () => {
      let s = 0, dark = 0;
      const lines = [];
      for (let y = 0; y < size; y++) { lines.push(m[y].map(Number).join('')); lines.push(m.map(r => +r[y]).join('')); }
      for (const l of lines) {
        for (const run of l.match(/0{5,}|1{5,}/g) || []) s += run.length - 2;
        s += 40 * ((l.match(/(?=10111010000|00001011101)/g) || []).length);
      }
      for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
        if (m[y][x]) dark++;
        if (x && y && m[y][x] === m[y - 1][x] && m[y][x] === m[y][x - 1] && m[y][x] === m[y - 1][x - 1]) s += 3;
      }
      return s + 10 * Math.floor(Math.abs(dark * 20 - size * size * 10) / (size * size));
    };
    let best = 0, low = Infinity;
    for (let k = 0; k < 8; k++) { flip(k); format(k); const s = score(); if (s < low) { low = s; best = k; } flip(k); }
    flip(best); format(best);
    return m;
  };
})(typeof module === 'object' && module.exports ? module.exports : (window.netherflowLib = {}));
