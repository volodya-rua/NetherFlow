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
  // YouTube Music's own lyrics for a video (from LyricFind), time-synced to its recording when it has them: { lines:
  // [{ t, end, text }] } (seconds), or { plain } (text alone), or {} — the lyrics tab's id from the video's "next" page,
  // then the lyrics themselves, asked as YouTube Music's Android app (only that client is given the timing).
  lib.ytmLyrics = async (post, id) => {
    const find = (o, key) => { if (!o || typeof o !== 'object') return null; if (o[key]) return o[key]; for (const k in o) { const r = find(o[k], key); if (r) return r; } return null; };
    const next = await ytmPost(post, 'next', { context: WEB_MUSIC, videoId: id, isAudioOnly: true });
    const tabs = [];
    (function walk(o) { if (o && typeof o === 'object') { if (o.tabRenderer) tabs.push(o.tabRenderer); for (const k in o) walk(o[k]); } })(next);
    const browseId = tabs.map(t => t.endpoint?.browseEndpoint?.browseId).find(b => b && b.startsWith('MPLY'));
    if (!browseId) return {};
    const json = await ytmPost(post, 'browse', { context: { client: { clientName: 'ANDROID_MUSIC', clientVersion: '7.21.50', androidSdkVersion: 30, hl: 'en', gl: 'US' } }, browseId },
      { 'User-Agent': 'com.google.android.apps.youtube.music/7.21.50 (Linux; U; Android 11) gzip' });
    const timed = find(json, 'timedLyricsData');
    if (timed?.length) return { lines: timed.filter(l => l.cueRange).map(l => ({ t: +l.cueRange.startTimeMilliseconds / 1000, end: +l.cueRange.endTimeMilliseconds / 1000,
      text: (l.lyricLine || '').replace(/\s+/g, ' ').trim() })).filter(l => l.text && l.text !== '♪') };
    const plain = find(json, 'musicDescriptionShelfRenderer')?.description?.runs?.map(r => r.text).join('') || '';
    return plain ? { plain } : {};
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
  // own web API, with the pass its own player uses (Spotify keeps its editorial lists to itself: those stop at 100).
  lib.playlist = async (get, post, link) => {
    const u = new URL(link), find = (o, key) => { if (!o || typeof o !== 'object') return null; if (o[key]) return o[key]; for (const k in o) { const r = find(o[k], key); if (r) return r; } return null; };
    if (/(^|\.)youtube\.com$|^youtu\.be$/.test(u.hostname)) {
      const id = u.searchParams.get('list') || (u.pathname.match(/\/browse\/VL([\w-]+)/) || [])[1];
      if (!id) throw new Error('not a playlist link');
      let json = await ytmPost(post, 'browse', { context: WEB_MUSIC, browseId: 'VL' + id });
      const head = find(json, 'musicResponsiveHeaderRenderer') || find(json, 'musicDetailHeaderRenderer') || find(json, 'musicEditablePlaylistDetailHeaderRenderer');
      const name = (find(head, 'title')?.runs || []).map(x => x.text).join('') || 'YouTube playlist', tracks = [], seen = new Set();
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
        json = token ? await ytmPost(post, 'browse', { context: WEB_MUSIC, continuation: token }).catch(() => null) : null;
      }
      return { name, from: 'YouTube', tracks };
    }
    if (/(^|\.)spotify\.com$/.test(u.hostname)) {
      const m = u.pathname.match(/\/(playlist|album)\/([A-Za-z0-9]+)/);
      if (!m) throw new Error('not a playlist link');
      const html = await get(`https://open.spotify.com/embed/${m[1]}/${m[2]}`, { 'User-Agent': UA });
      const st = JSON.parse(html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/)?.[1] || '{}').props?.pageProps?.state, e = st?.data?.entity;
      if (!e?.trackList) throw new Error('Spotify page changed');
      const tracks = e.trackList.map(t => ({ title: t.title, artist: (t.subtitle || '').split(',')[0].trim(), album: m[1] === 'album' ? e.name : '', dur: Math.round((t.duration || 0) / 1000) }));
      const pass = st.settings?.session?.accessToken;
      if (m[1] === 'playlist' && tracks.length >= 100 && pass) for (let at = 100; at < 20000; at += 100) { // (past the embed's 100)
        const r = JSON.parse(await get(`https://api.spotify.com/v1/playlists/${m[2]}/tracks?offset=${at}&limit=100&fields=next,items(track(name,duration_ms,artists(name),album(name)))`,
          { Authorization: 'Bearer ' + pass, 'User-Agent': UA }).catch(() => '{}') || '{}');
        for (const x of r.items || []) if (x?.track?.name) tracks.push({ title: x.track.name, artist: x.track.artists?.[0]?.name || '', album: x.track.album?.name || '', dur: Math.round((x.track.duration_ms || 0) / 1000) });
        if (!r.next) break;
      }
      return { name: e.name || 'Spotify playlist', from: 'Spotify', tracks };
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
      const name = (html.match(/<title>([^<]*)<\/title>/)?.[1] || '').replace(/^‎/, '').replace(/\s+-\s+(Playlist|Album|Single|EP).*$/, '').replace(/&amp;/g, '&').replace(/&#39;/g, "'") || 'Apple Music playlist';
      const pl = u.pathname.match(/^\/([a-z]{2})\/playlist\/(?:[^/]+\/)?(pl\.[\w.-]+)/);
      if (pl && tracks.length >= 100) { // (past the page's 100: Apple Music's web API, with its web player's own pass — in its script)
        const js = html.match(/\/assets\/index[^"']*\.js/)?.[0], pass = js && (await get('https://music.apple.com' + js, { 'User-Agent': UA }).catch(() => '')).match(/eyJ[\w-]+\.[\w-]+\.[\w-]+/)?.[0];
        for (let at = 100; pass && at < 20000; at += 100) {
          const r = JSON.parse(await get(`https://amp-api.music.apple.com/v1/catalog/${pl[1]}/playlists/${pl[2]}/tracks?offset=${at}&limit=100`,
            { Authorization: 'Bearer ' + pass, Origin: 'https://music.apple.com', 'User-Agent': UA }).catch(() => '{}') || '{}');
          for (const t of r.data || []) if (t.attributes?.name && !seen.has(t.id)) { seen.add(t.id); tracks.push({ title: t.attributes.name, artist: t.attributes.artistName || '', dur: Math.round((t.attributes.durationInMillis || 0) / 1000), apple: t.id }); }
          if (!r.next) break;
        }
      }
      return { name, from: 'Apple Music', tracks };
    }
    throw new Error('not a YouTube, Spotify or Apple Music link');
  };

  // The Tactical theme's agents: Riot Games' own art for VALORANT's agents, as valorant-api.com (a community site) serves
  // it — used under Riot's "Legal Jibber Jabber" policy for free fan projects (the notice is in the app and its README).
  // Nothing of it is in this repository. → [{ id, name, role, portrait, bg (its backdrop art), icon, colors (4 hex) }]
  lib.agents = async get => JSON.parse(await get('https://valorant-api.com/v1/agents?isPlayableCharacter=true', { 'User-Agent': UA })).data
    .filter(a => a.fullPortrait).map(a => ({ id: a.uuid, name: a.displayName, role: a.role?.displayName || '', portrait: a.fullPortrait, bg: a.background || '',
      icon: a.displayIcon, colors: (a.backgroundGradientColors || []).map(c => '#' + String(c).slice(0, 6)) }));

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
})(typeof module === 'object' && module.exports ? module.exports : (window.netherflowLib = {}));
