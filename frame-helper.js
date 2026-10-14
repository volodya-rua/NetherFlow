// Runs inside YouTube's player frame, injected by the NetherFlow app (desktop: main.js, Android: MainActivity).
//  1. Ads: if an ad still shows, jump to its end and press Skip ("ad-showing" is set while an ad plays).
//  2. Equalizer and volume booster: the NetherFlow page sends band gains and a boost (1…2); they're applied to the
//     player's audio here, the boost through a limiter so a boosted song never distorts. And the song's own loudness
//     (orig): YouTube turns loud songs down to one level, by up to ~8 dB (the <video>'s volume under the player's);
//     that's given back here, so it plays as loud as it was mastered.
//  3. System media controls (Windows media panel): show NetherFlow's song (title, artist, cover) instead of
//     YouTube's video title, and pass previous / next / skip ±10 s presses (media keys, headphones) to the page.
//  4. Lyric sync: how late the sound comes out after the equalizer, so the page can delay the lyrics to match.
//  5. Beat visuals: the page can't hear YouTube's audio (it plays in this frame), so when asked ({ nfViz: true }; false stops it)
//     the sound runs through an analyser here and its spectrum goes up to the page ~60 times a second.
//  6. The music video, cut like an edit (desktop, Extreme lyrics): in the page's own muted player for the song's video,
//     the page sends, every frame ({ nfEdit }), where to cut to, how fast to play, and the zoom, shake, colour fringes,
//     flashes, freezes and grade; the picture's drawn here through them, on a canvas over the player (only here can
//     the video's frames be read). Back to the page, a few times a second ({ nfEditInfo }): its length, what's loaded,
//     how bright it is.
// Only the NetherFlow page (http://localhost:<port> on desktop, https://localhost on Android) can talk to it.
(() => {
  if (window.__nfHelper) return;
  const APP = /^(http:\/\/localhost:\d+|https:\/\/localhost)$/;
  const FREQS = [60, 150, 400, 1000, 2400, 15000];
  let app = null, eq = null, ctx = null, bands = null, wired = null, meta = null, sentLat = null, analyser = null, wantViz = false, spec = null;
  let boost = null, limiter = null, port = null, src = null, path = null, tinyFor = null, sing = null; // port: the page's channel for the spectrum, when it gave one
  // read-only status, for checking the equalizer from developer tools / tests
  window.__nfHelper = { gains: () => bands && bands.map(b => b.gain.value), audio: () => (ctx ? ctx.state : 'untouched'), boost: () => boost && boost.gain.value, path: () => path,
    edit: () => ed && { off: !!ed.off, cut: ed.cut, size: ed.cv.width + 'x' + ed.cv.height, drawn: Math.round(ed.drawn), asked: Math.round(edAt), err: ed.err || null } };

  // The sound's path once the equalizer, booster or beat visuals want it: video → equalizer bands → analyser → boost →
  // limiter → speakers — with only what's in use in it: the bands while the equalizer's on, the boost while boosting, the
  // limiter with either (each node more is work for the sound's own thread every few milliseconds; on a phone busy
  // drawing, that thread late is a crack). (The analyser sits before the boost, so the visuals stay the same however
  // loud it's set.)
  // Until then the audio is left untouched. The video is only routed in once the audio context is running,
  // so a context the browser holds back can never silence the song.
  // Sing mode: the voice turned down (eq.sing: 0…1, how far). A singer's mixed in the middle of the stereo picture: the
  // middle's part between the bass and the sizzle (160 Hz–6.5 kHz) goes, the sides (the band, spread wide) and the
  // middle's bass (kick, bass line) and top stay. Blended, not subtracted: nothing's left hollow. (As in the page.)
  function makeSing(c) {
    const g = v => { const n = c.createGain(); n.gain.value = v; return n; }, mono = n => { n.channelCount = 1; n.channelCountMode = 'explicit'; return n; };
    const inp = g(1), split = c.createChannelSplitter(2), out = c.createChannelMerger(2), low = c.createBiquadFilter(), high = c.createBiquadFilter();
    const mid = mono(g(.5)), side = mono(g(.5)), flip = mono(g(-1)), keep = mono(g(1)), lowG = mono(g(0)), highG = mono(g(0)), m2 = mono(g(1)), sNeg = mono(g(-1));
    inp.channelCount = 2; inp.channelCountMode = 'explicit'; inp.channelInterpretation = 'speakers'; // (a mono song: on both sides)
    inp.connect(split);
    split.connect(mid, 0); split.connect(mid, 1); split.connect(side, 0); split.connect(flip, 1); flip.connect(side); // middle (L+R)/2, side (L−R)/2
    low.type = 'lowpass'; low.frequency.value = 160; high.type = 'highpass'; high.frequency.value = 6500;
    mid.connect(keep); mid.connect(low); low.connect(lowG); mid.connect(high); high.connect(highG);
    for (const n of [keep, lowG, highG]) n.connect(m2);
    m2.connect(out, 0, 0); m2.connect(out, 0, 1); side.connect(out, 0, 0); side.connect(sNeg); sNeg.connect(out, 0, 1);
    return { inp, out, set: a => { const t = c.currentTime; keep.gain.setTargetAtTime(1 - a, t, .05); lowG.gain.setTargetAtTime(a, t, .05); highG.gain.setTargetAtTime(a * .7, t, .05); } };
  }
  function wireEq() {
    const v = document.querySelector('video');
    if (!v || (!(eq && (eq.on || eq.boost > 1 || eq.orig || eq.sing > 0)) && !wantViz && !ctx)) return;
    if (!ctx) {
      // (playback: the larger buffers meant for music — with the smallest, a phone busy drawing misses one now and then:
      // a crack or a pop. The extra delay is measured and the lyrics wait for it: see nfLatency below)
      ctx = new AudioContext({ latencyHint: 'playback' });
      bands = FREQS.map((f, i) => {
        const b = ctx.createBiquadFilter();
        b.type = i === 0 ? 'lowshelf' : i === FREQS.length - 1 ? 'highshelf' : 'peaking';
        b.frequency.value = f;
        b.Q.value = 1.1;
        return b;
      });
      analyser = ctx.createAnalyser();
      analyser.fftSize = 1024; analyser.smoothingTimeConstant = 0.55; // the same as the page's own analyser
      boost = ctx.createGain();
      limiter = ctx.createDynamicsCompressor();
      // (a soft knee and an unhurried attack: it eases the loudest peaks down instead of crushing them — a hard 2 ms one
      // crunched the bass when boosting)
      limiter.knee.value = 6; limiter.ratio.value = 20; limiter.attack.value = 0.004; limiter.release.value = 0.25;
      sing = makeSing(ctx);
    }
    if (ctx.state !== 'running') { ctx.resume(); return; }
    if (wired !== v) { // a new <video>: route it too (and its volume watched: YouTube sets each song's level on it)
      src?.disconnect(); src = ctx.createMediaElementSource(v); wired = v; path = null;
      v.addEventListener('volumechange', wireEq);
    }
    // (levels glide to a change over a few milliseconds: set at once, the jump is heard as a click)
    const to = (p, v) => p.setTargetAtTime(v, ctx.currentTime, .015);
    const useEq = !!(eq && eq.on), g = eq && eq.boost > 1 ? Math.min(2, eq.boost) : 1;
    // the song's own loudness: what YouTube took off its level (the player's volume over the <video>'s), back on
    const mp = document.getElementById('movie_player'), want = mp && mp.getVolume ? mp.getVolume() / 100 : 0;
    const lift = eq && eq.orig && !v.muted && v.volume > 0 && want > v.volume ? Math.min(4, want / v.volume) : 1;
    const gain = g * lift, up = gain > 1.001;
    // (the bands out of the path: back to flat at once — no one hears them — so they come back in from flat)
    bands.forEach((b, i) => { if (useEq) to(b.gain, eq.gains[i]); else { b.gain.cancelScheduledValues(0); b.gain.value = 0; } });
    to(boost.gain, gain);
    to(limiter.threshold, g > 1 ? -1 : 0); // not boosted by the slider, only what would clip anyway is touched
    const singing = eq && eq.sing > 0 ? Math.min(1, eq.sing) : 0;
    sing.set(singing);
    const key = (useEq ? 'eq' : '') + (up ? '+boost' : '') + (singing ? '+sing' : '');
    if (key === path) return;
    path = key;
    for (const n of [src, ...bands, sing.out, analyser, boost, limiter]) n.disconnect();
    // (the limiter also while the equalizer's on: a band turned up can take the loudest peaks past full scale)
    [src, ...(useEq ? bands : []), ...(singing ? [sing] : []), analyser, ...(up ? [boost] : []), ...(useEq || up ? [limiter] : []), ctx.destination].reduce((a, b) => (a.connect(b.inp || b), b.out || b));
  }
  // The spectrum, measured as if at full volume: the player's volume (and YouTube's loudness levelling) is
  // applied before the analyser, so its range shifts by the same amount and the visuals don't shrink with it.
  function sendSpectrum() {
    const v = wired;
    if (!wantViz || !analyser || !v || v.paused || !app) return;
    const g = 20 * Math.log10(Math.max(v.muted ? 0 : v.volume, 0.02));
    // (-92…-12 dB: room above loud masters, so a kick still stands out from the bass under it — as on the page)
    if (Math.abs(analyser.maxDecibels - (-12 + g)) > 0.5) { analyser.minDecibels = -92 + g; analyser.maxDecibels = -12 + g; }
    analyser.getByteFrequencyData(spec ||= new Uint8Array(analyser.frequencyBinCount));
    if (port) port.postMessage({ nfFreq: spec, sr: ctx.sampleRate }); else parent.postMessage({ nfFreq: spec, sr: ctx.sampleRate }, app);
  }
  setInterval(sendSpectrum, 16);

  function setMeta() {
    if (!meta || !('mediaSession' in navigator)) return;
    const cur = navigator.mediaSession.metadata;
    if (cur && cur.title === meta.title && cur.artist === meta.artist) return;
    navigator.mediaSession.metadata = new MediaMetadata({
      title: meta.title, artist: meta.artist, album: meta.album || '',
      artwork: meta.art ? [{ src: meta.art, sizes: '600x600', type: 'image/jpeg' }] : [],
    });
    // headphone / media-key gestures: previous, next, skip ±10 s, stop (play/pause stays with YouTube's player)
    for (const [action, name] of [['previoustrack', 'prev'], ['nexttrack', 'next'], ['seekforward', 'fwd'], ['seekbackward', 'back'], ['stop', 'stop']]) {
      try { navigator.mediaSession.setActionHandler(action, () => app && parent.postMessage({ nfAction: name }, app)); } catch {}
    }
  }

  addEventListener('message', e => {
    if (!APP.test(e.origin) || !e.data || typeof e.data !== 'object') return;
    app = e.origin;
    if (e.data.nfEq) { eq = e.data.nfEq; wireEq(); }
    if ('nfViz' in e.data) { wantViz = !!e.data.nfViz; if (e.ports[0]) port = e.ports[0]; wireEq(); } // (false: the app is away, no spectrum needed)
    if (e.data.nfMeta) { meta = e.data.nfMeta; setMeta(); }
    if (e.data.nfEdit) { edm = e.data.nfEdit; edAt = performance.now(); if (!ed) ed = editInit(); } // (and its quality kept up: see below)
  });

  // ---- 6. the edit: the video through a shader — a zoom, turn and shake; a glitch's shoved rows; colour fringes; a zoom
  // blur; a still frame held (a cut waiting for its new shot, a freeze) or dissolving away; a grade; a flash; a negative;
  // a trail of the frames before (motion blur, when it's sped up)
  let ed = null, edm = null, edAt = 0, hdAsked = 0;
  const ED_FS = `#version 300 es
precision highp float;
uniform sampler2D V, H, F; uniform vec2 R, VS, off; uniform vec3 cA, cB;
uniform float z, rot, ca, zb, mb, fl, inv, mir, gli, gr, sat, hold, t, vg, k;
out vec4 o;
float h1(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
// (a point on the screen, 0…1 from the top left → the video's: filling the screen, its overflow cut off)
vec2 fit(vec2 p) { float a = R.x / R.y, va = VS.x / max(1., VS.y); vec2 s = a > va ? vec2(1., va / a) : vec2(a / va, 1.); return (p - .5) * s + .5; }
vec3 px(sampler2D T, vec2 q) { return texture(T, clamp(q, .001, .999)).rgb; }
vec3 rgbAt(sampler2D T, vec2 q, vec2 d) { return vec3(px(T, q + d).r, px(T, q).g, px(T, q - d).b); }
void main() {
  vec2 u = vec2(gl_FragCoord.x / R.x, 1. - gl_FragCoord.y / R.y), p = u - .5;
  float asp = R.x / R.y;
  p.x *= asp; p = mat2(cos(rot), sin(rot), -sin(rot), cos(rot)) * p / z; p.x /= asp; p += .5 + off;
  if (mir > .5) p.x = 1. - p.x;
  float row = floor(u.y * 28.), fr = floor(t * 24.);
  p.x += gli * step(.7, h1(vec2(row, fr))) * (h1(vec2(row, fr + 7.)) - .5) * .14;
  vec2 q = fit(p), d = (q - .5) * ca;
  vec3 c = rgbAt(V, q, d);
  if (zb > .002) { for (int i = 1; i < 8; i++) c += rgbAt(V, mix(q, vec2(.5), zb * float(i) / 7.), d); c /= 8.; }
  if (hold > .001) c = mix(c, rgbAt(H, q, d), hold);
  float l = dot(c, vec3(.299, .587, .114));
  if (gr == 1.) c += mix(vec3(-.05, .01, .06), vec3(.08, .02, -.07), smoothstep(.2, .8, l)); // teal shadows, orange highlights
  else if (gr == 2.) c = vec3(smoothstep(.05, .92, l)); // black and white, hard
  else if (gr == 3.) c = c * vec3(1.05, 1., .86) + vec3(.045, .032, .02); // warm film, the blacks lifted
  else if (gr == 4.) c = mix(c, c * vec3(.78, .95, 1.18), .75); // cool, night blue
  else if (gr == 5.) c = mix(cA * .22, mix(cB, vec3(1.), .55), smoothstep(.08, .92, l)); // duotone in the song's colours: its darks deep, its lights pale (the shapes kept)
  l = dot(c, vec3(.299, .587, .114));
  c = mix(vec3(l), c, sat);
  c = (c - .5) * 1.08 + .5;
  c = mix(c, 1. - c, inv) * (1. + k * .12) + fl;
  c *= 1. - vg * smoothstep(.35, 1.1, length((u - .5) * vec2(asp * .75, 1.)));
  if (mb > .001) c = mix(c, texture(F, gl_FragCoord.xy / R).rgb, mb);
  o = vec4(c, 1.);
}`;
  function editInit() {
    const cv = document.createElement('canvas');
    cv.style.cssText = 'position:fixed;left:0;top:0;width:100vw;height:100vh;z-index:2147483647;pointer-events:none;background:#000';
    document.documentElement.append(cv);
    const g = cv.getContext('webgl2', { alpha: false, antialias: false });
    if (!g) return { off: true };
    const sh = (type, src) => { const s = g.createShader(type); g.shaderSource(s, src); g.compileShader(s); return s; };
    const pr = g.createProgram();
    g.attachShader(pr, sh(g.VERTEX_SHADER, '#version 300 es\nin vec2 a; void main() { gl_Position = vec4(a, 0., 1.); }'));
    g.attachShader(pr, sh(g.FRAGMENT_SHADER, ED_FS));
    g.bindAttribLocation(pr, 0, 'a'); g.linkProgram(pr); g.useProgram(pr);
    g.bindBuffer(g.ARRAY_BUFFER, g.createBuffer()); g.bufferData(g.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), g.STATIC_DRAW);
    g.enableVertexAttribArray(0); g.vertexAttribPointer(0, 2, g.FLOAT, false, 0, 0);
    const tex = () => { const t = g.createTexture(); g.bindTexture(g.TEXTURE_2D, t); for (const [p, v] of [[g.TEXTURE_MIN_FILTER, g.LINEAR], [g.TEXTURE_MAG_FILTER, g.LINEAR], [g.TEXTURE_WRAP_S, g.CLAMP_TO_EDGE], [g.TEXTURE_WRAP_T, g.CLAMP_TO_EDGE]]) g.texParameteri(g.TEXTURE_2D, p, v);
      g.texImage2D(g.TEXTURE_2D, 0, g.RGBA, 1, 1, 0, g.RGBA, g.UNSIGNED_BYTE, new Uint8Array(4)); return t; };
    const U = {};
    for (const n of ['V', 'H', 'F', 'R', 'VS', 'off', 'cA', 'cB', 'z', 'rot', 'ca', 'zb', 'mb', 'fl', 'inv', 'mir', 'gli', 'gr', 'sat', 'hold', 't', 'vg', 'k']) U[n] = g.getUniformLocation(pr, n);
    g.uniform1i(U.V, 0); g.uniform1i(U.H, 1); g.uniform1i(U.F, 2);
    const e = { cv, g, U, V: tex(), H: tex(), fb: [0, 1].map(() => ({ f: g.createFramebuffer(), t: tex() })), i: 0, cut: 0, waiting: false, fade: 0, rel: 0, frozen: false, info: 0, drawn: 0,
      small: Object.assign(document.createElement('canvas'), { width: 16, height: 9 }) };
    e.sg = e.small.getContext('2d', { willReadFrequently: true });
    requestAnimationFrame(function loop(now) { requestAnimationFrame(loop); editDraw(now); });
    return e;
  }
  // the frame showing now, kept (to hold over a cut, or for a freeze)
  const snap = v => { const g = ed.g; g.activeTexture(g.TEXTURE1); g.bindTexture(g.TEXTURE_2D, ed.H); g.texImage2D(g.TEXTURE_2D, 0, g.RGBA, g.RGBA, g.UNSIGNED_BYTE, v); };
  function editDraw(now) { try { editDraw1(now); } catch (e) { if (ed) ed.err = String(e).slice(0, 200); } }
  function editDraw1(now) {
    const v = document.querySelector('video'), m = edm;
    if (!ed || ed.off || !v || !m || now - ed.drawn < 14) return; // (about 60 a second, on a faster screen too)
    ed.drawn = now;
    // (the page stopped asking — hidden, or behind another app: rest. Paused through the player: a <video> paused behind its
    // back, it plays on)
    if (now - edAt > 1500) { if (!v.paused) { document.getElementById('movie_player')?.pauseVideo?.(); ed.rested = true; } return; }
    if (ed.rested && m.play) { ed.rested = false; document.getElementById('movie_player')?.playVideo?.(); } // (asked again: on where it rested)
    const g = ed.g, U = ed.U, ad = !!document.querySelector('.ad-showing');
    if (!v.muted) v.muted = true; // (never heard: the song plays in the page's other player)
    const rate = Math.max(.1, Math.min(4, m.r || 1));
    if (!ad && Math.abs(v.playbackRate - rate) > .02) v.playbackRate = rate;
    // a cut: the frame showing held till the new shot's first frame is ready (then let go at once, or dissolved over m.cut.fade)
    if (m.cut && m.cut.id !== ed.cut && v.readyState > 1 && !ad) {
      ed.cut = m.cut.id; ed.fade = m.cut.fade || 0;
      snap(v); ed.waiting = now;
      v.addEventListener('seeked', () => v.requestVideoFrameCallback(() => { ed.waiting = false; ed.rel = performance.now(); }), { once: true });
      v.currentTime = Math.min(m.cut.t, (v.duration || 1e9) - 3);
    }
    if (ed.waiting && now - ed.waiting > 1500) ed.waiting = false; // (a seek that never said it was done: let go anyway)
    if (m.fz && !ed.frozen && !ed.waiting && v.readyState > 1) { snap(v); ed.frozen = true; } // a freeze: this frame, held while the video runs on under it
    if (!m.fz) ed.frozen = false;
    const W = Math.round(innerWidth * Math.min(1.5, devicePixelRatio || 1)), Hh = Math.round(innerHeight * Math.min(1.5, devicePixelRatio || 1));
    if (ed.cv.width !== W || ed.cv.height !== Hh) {
      ed.cv.width = W; ed.cv.height = Hh; g.activeTexture(g.TEXTURE3); // (a unit of its own: none the shader reads)
      for (const b of ed.fb) { g.bindTexture(g.TEXTURE_2D, b.t); g.texImage2D(g.TEXTURE_2D, 0, g.RGBA, W, Hh, 0, g.RGBA, g.UNSIGNED_BYTE, null); g.bindFramebuffer(g.FRAMEBUFFER, b.f); g.framebufferTexture2D(g.FRAMEBUFFER, g.COLOR_ATTACHMENT0, g.TEXTURE_2D, b.t, 0); }
    }
    g.activeTexture(g.TEXTURE0); g.bindTexture(g.TEXTURE_2D, ed.V);
    if (v.readyState > 1 && !ad) g.texImage2D(g.TEXTURE_2D, 0, g.RGBA, g.RGBA, g.UNSIGNED_BYTE, v);
    const hold = ed.waiting || ed.frozen || ad ? 1 : ed.fade ? Math.max(0, 1 - (now - ed.rel) / (ed.fade * 1000)) : 0;
    const A = ed.fb[ed.i], B = ed.fb[1 - ed.i];
    g.activeTexture(g.TEXTURE1); g.bindTexture(g.TEXTURE_2D, ed.H);
    g.activeTexture(g.TEXTURE2); g.bindTexture(g.TEXTURE_2D, B.t);
    g.bindFramebuffer(g.FRAMEBUFFER, A.f); g.viewport(0, 0, W, Hh);
    g.uniform2f(U.R, W, Hh); g.uniform2f(U.VS, v.videoWidth || 16, v.videoHeight || 9); g.uniform2f(U.off, m.ox || 0, m.oy || 0);
    g.uniform3fv(U.cA, m.cA || [1, .4, .2]); g.uniform3fv(U.cB, m.cB || [.2, .4, 1]);
    for (const n of ['z', 'rot', 'ca', 'zb', 'mb', 'fl', 'inv', 'mir', 'gli', 'gr', 'sat', 'vg', 'k']) g.uniform1f(U[n], +m[n] || 0);
    g.uniform1f(U.z, m.z || 1); g.uniform1f(U.sat, m.sat ?? 1); g.uniform1f(U.hold, hold); g.uniform1f(U.t, now / 1000 % 1000);
    g.drawArrays(g.TRIANGLES, 0, 3);
    g.bindFramebuffer(g.READ_FRAMEBUFFER, A.f); g.bindFramebuffer(g.DRAW_FRAMEBUFFER, null);
    g.blitFramebuffer(0, 0, W, Hh, 0, 0, W, Hh, g.COLOR_BUFFER_BIT, g.NEAREST);
    ed.i = 1 - ed.i;
    // back to the page, four times a second: the video's length, what's loaded around it, how bright the shot is
    if (now - ed.info > 250 && app) {
      ed.info = now;
      let luma = 1;
      if (v.readyState > 1) { try { ed.sg.drawImage(v, 0, 0, 16, 9); const d = ed.sg.getImageData(0, 0, 16, 9).data; luma = 0; for (let i = 0; i < d.length; i += 4) luma += d[i] * .3 + d[i + 1] * .59 + d[i + 2] * .11; luma /= 144 * 255; } catch {} }
      const buf = []; for (let i = 0; i < v.buffered.length; i++) buf.push([v.buffered.start(i), v.buffered.end(i)]);
      parent.postMessage({ nfEditInfo: { dur: v.duration || 0, t: v.currentTime, buf, ok: v.readyState > 1 && !ad, luma, cut: ed.cut, waiting: !!ed.waiting } }, app);
    }
  }

  setInterval(() => {
    const player = document.querySelector('.html5-video-player');
    if (player && player.classList.contains('ad-showing')) {
      const v = player.querySelector('video');
      if (v && isFinite(v.duration) && v.duration > 0) v.currentTime = v.duration;
      document.querySelector('.ytp-skip-ad-button, .ytp-ad-skip-button, .ytp-ad-skip-button-modern')?.click();
    }
    if ((eq || wantViz) && document.querySelector('video') !== wired) wireEq(); // a new <video>, or still waiting to start
    setMeta(); // YouTube sets its own video title when a video loads: put the song back
    // The picture, never seen: the smallest there is, once a video — YouTube's best sound comes with any picture, and a
    // phone needn't be decoding (or downloading) 720p video for nothing
    // (the edit's player excepted: its picture is the point — 720p, up to 1080p, asked again whenever it's below: YouTube
    // keeps one choice for all its frames, so the song's own player asking for the smallest sets it here too)
    const mp = document.getElementById('movie_player'), id = mp?.getVideoData?.().video_id;
    if (ed) { if (mp?.setPlaybackQualityRange && mp.getPlaybackQuality && !/^hd/.test(mp.getPlaybackQuality()) && performance.now() - hdAsked > 2000) { hdAsked = performance.now(); mp.setPlaybackQualityRange('hd720', 'hd1080'); } }
    else if (id && id !== tinyFor && mp.setPlaybackQualityRange) { tinyFor = id; mp.setPlaybackQualityRange('tiny', 'tiny'); }
    // Through the equalizer the sound reaches the speakers later than the player's clock says (the clock stops
    // counting at the equalizer, more so on Bluetooth): tell the page how much, so the lyrics wait for the sound.
    const lat = ctx ? Math.round(((ctx.baseLatency || 0) + (ctx.outputLatency || 0)) * 1000) : 0;
    if (app && lat !== sentLat) { sentLat = lat; parent.postMessage({ nfLatency: lat / 1000 }, app); }
  }, 150);
})();
