// NetherFlow - Copyright (C) 2026 Volodya.rua - GNU GPL v3 only, with additional terms (credit, name and logo): see LICENSE and NOTICE.
// Voice control's recognizer, a worker of its own: OpenAI's Whisper (base.en — made ONNX by Hugging Face's
// onnx-community) run by ONNX Runtime Web on this device: what's said never leaves it. The page sends one sentence (16 kHz,
// one channel); this sends back its words. Its encoder — the work every sentence costs — on the graphics card where
// there's one (WebGPU, 4-bit: 80 ms, against 430 on the processor, measured; half precision there wrote nonsense), else
// on the processor (int8); its decoder, word by word, on the processor. The engine and the model aren't in the app: the voice pack, downloaded when
// the user asks for it and kept on the device (see voicePack in index.html), handed over first.
//   in:  { init: { ort, mjs, wasm (the engine's files, as addresses), threads, encoder (int8), encoderGpu (4-bit, or
//          none), decoder (the merged one, that keeps what it's worked out), vocab, merges, gen (its
//          vocabulary, word-pieces and generation settings: text) } } · { id, pcm (Float32Array, 16 kHz), langs, names (the
//          library's, to hear them as spelt), wake (only "Hey NetherFlow…" wanted: anything else given up early), end }
//   out: { ready, gpu } · { id, text, lang, ms } · { id, error }
const SR = 16000, NFFT = 400, HOP = 160, MELS = 80, FRAMES = 3000, BINS = NFFT / 2 + 1;
const HEADS = 8, HEAD = 64; // (Whisper base's attention: 8 heads of 64)
let nets = null, vocab = null, merges = null, gen = null;

// ---- the log-mel spectrogram, as Whisper's own feature extractor makes it: 30 s (the rest silence), a periodic Hann
// window of 400, hop 160, reflect-padded at the ends; 80 mel bands (Slaney's scale and areas, as librosa makes them);
// log10, the quietest held at 8 below the loudest, then (x + 4) / 4
const hann = Float64Array.from({ length: NFFT }, (_, i) => .5 - .5 * Math.cos(2 * Math.PI * i / NFFT));
const cosT = new Float64Array(BINS * NFFT), sinT = new Float64Array(BINS * NFFT);
for (let k = 0; k < BINS; k++) for (let n = 0; n < NFFT; n++) { const a = 2 * Math.PI * k * n / NFFT; cosT[k * NFFT + n] = Math.cos(a); sinT[k * NFFT + n] = Math.sin(a); }
const melFilters = (() => {
  const fSp = 200 / 3, minLogHz = 1000, minLogMel = minLogHz / fSp, step = Math.log(6.4) / 27;
  const toMel = hz => hz >= minLogHz ? minLogMel + Math.log(hz / minLogHz) / step : hz / fSp;
  const toHz = m => m >= minLogMel ? minLogHz * Math.exp(step * (m - minLogMel)) : fSp * m;
  const top = toMel(SR / 2), pts = Array.from({ length: MELS + 2 }, (_, i) => toHz(top * i / (MELS + 1)));
  const w = new Float64Array(MELS * BINS);
  for (let m = 0; m < MELS; m++) {
    const lo = pts[m], mid = pts[m + 1], hi = pts[m + 2], norm = 2 / (hi - lo);
    for (let k = 0; k < BINS; k++) { const f = k * SR / NFFT; w[m * BINS + k] = Math.max(0, Math.min((f - lo) / (mid - lo), (hi - f) / (hi - mid))) * norm; }
  }
  return w;
})();
function logMel(pcm) {
  const n = Math.min(pcm.length, SR * 30), padded = new Float32Array(SR * 30 + NFFT);
  // (centred frames: the sound reflect-padded by half a window at its start; its end padded with silence, as Whisper's
  // pads the 30 s, then reflected)
  const x = new Float32Array(SR * 30); x.set(pcm.subarray(0, n));
  for (let i = 0; i < NFFT / 2; i++) padded[i] = x[NFFT / 2 - i];
  padded.set(x, NFFT / 2);
  for (let i = 0; i < NFFT / 2; i++) padded[NFFT / 2 + x.length + i] = x[x.length - 2 - i];
  const out = new Float32Array(MELS * FRAMES), power = new Float64Array(BINS), frame = new Float64Array(NFFT);
  const live = Math.min(FRAMES, Math.ceil(n / HOP) + 2); // (frames past the sound are silence: their value worked out once)
  let max = -Infinity;
  for (let t = 0; t < FRAMES; t++) {
    if (t < live) {
      for (let i = 0; i < NFFT; i++) frame[i] = padded[t * HOP + i] * hann[i];
      for (let k = 0; k < BINS; k++) { let re = 0, im = 0; const o = k * NFFT; for (let i = 0; i < NFFT; i++) { re += frame[i] * cosT[o + i]; im -= frame[i] * sinT[o + i]; } power[k] = re * re + im * im; }
    } else if (t === live) power.fill(0);
    for (let m = 0; m < MELS; m++) {
      let s = 0; const o = m * BINS; for (let k = 0; k < BINS; k++) s += melFilters[o + k] * power[k];
      const v = Math.log10(Math.max(s, 1e-10)); out[m * FRAMES + t] = v; if (v > max) max = v;
    }
  }
  for (let i = 0; i < out.length; i++) out[i] = (Math.max(out[i], max - 8) + 4) / 4;
  return out;
}

// ---- its words back from its tokens, and words to tokens (byte-level BPE, as GPT-2's: each token's characters stand for bytes)
let tokenText = null;
function decode(ids) {
  tokens();
  const bytes = [];
  for (const id of ids) { const t = tokenText.byId[id]; if (t == null || id >= EOT) continue; for (const ch of t) { const b = tokenText.byte.get(ch); if (b != null) bytes.push(b); } }
  return new TextDecoder().decode(new Uint8Array(bytes)).trim();
}
function encode(text) {
  tokens();
  const out = [], rank = tokenText.rank;
  for (const piece of text.match(/'s|'t|'re|'ve|'m|'ll|'d| ?\p{L}+| ?\p{N}+| ?[^\s\p{L}\p{N}]+|\s+(?!\S)|\s+/gu) || []) {
    let w = [...new TextEncoder().encode(piece)].map(b => tokenText.char[b]);
    for (;;) { // (the best-ranked pair joined, again and again)
      let at = -1, best = Infinity;
      for (let i = 0; i < w.length - 1; i++) { const r = rank.get(w[i] + ' ' + w[i + 1]); if (r < best) { best = r; at = i; } }
      if (at < 0) break;
      w.splice(at, 2, w[at] + w[at + 1]);
    }
    for (const t of w) if (vocab[t] != null) out.push(vocab[t]);
  }
  return out;
}
function tokens() {
  if (!tokenText) {
    const byte = new Map(), bs = [];
    for (let b = 33; b <= 126; b++) bs.push(b); for (let b = 161; b <= 172; b++) bs.push(b); for (let b = 174; b <= 255; b++) bs.push(b);
    const cs = bs.slice(); let k = 0;
    for (let b = 0; b < 256; b++) if (!bs.includes(b)) { bs.push(b); cs.push(256 + k++); }
    bs.forEach((b, i) => byte.set(String.fromCharCode(cs[i]), b));
    const char = []; byte.forEach((b, ch) => { char[b] = ch; });
    tokenText = { byId: Object.fromEntries(Object.entries(vocab).map(([t, i]) => [i, t])), byte, char, rank: new Map(merges.split('\n').slice(1).filter(Boolean).map((m, i) => [m, i])) };
  }
}

// ---- one sentence: the encoder once, then the decoder token by token (greedy, what it's worked out kept from step to
// step): its language first (among those it's told the listener may speak, English always), then its words, never
// timestamps or its non-speech symbols. The library's names go before, as if said just now: Whisper then writes them as
// they're spelt there ("Sid Sriram", not "Sid Shriram").
let EOT = 50257; // (its end: its special tokens come after — the English-only model's one earlier, from its settings)
async function hear(pcm, langs, names, wake, end) {
  const [enc, dec] = await nets;
  const t0 = performance.now(), feats = new ort.Tensor('float32', logMel(pcm), [1, MELS, FRAMES]), t1 = performance.now();
  const hidden = (await enc.run({ [enc.inputNames[0]]: feats }))[enc.outputNames[0]], t2 = performance.now();
  const pastNames = dec.inputNames.filter(n => n.startsWith('past_key_values')), none = new ort.Tensor('float32', new Float32Array(0), [1, HEADS, 0, HEAD]);
  let past = null;
  const step = async ids => { // (the new tokens: its scores for what comes after the last)
    const feeds = { input_ids: new ort.Tensor('int64', BigInt64Array.from(ids.map(BigInt)), [1, ids.length]), encoder_hidden_states: hidden, use_cache_branch: new ort.Tensor('bool', [!!past], [1]) };
    for (const n of pastNames) feeds[n] = past?.[n] || none;
    const out = await dec.run(feeds), V = out.logits.dims[2], kept = {};
    for (const n of pastNames) kept[n] = past && n.includes('.encoder.') ? past[n] : out[n.replace('past_key_values', 'present')]; // (the sound's own: worked out once, at the first step)
    past = kept;
    return out.logits.data.subarray((ids.length - 1) * V, ids.length * V);
  };
  const SOT = gen.decoder_start_token_id ?? 50258, PREV = gen.prev_sot_token_id ?? 50361, NO_TS = gen.no_timestamps_token_id ?? 50363, TRANSCRIBE = gen.task_to_id?.transcribe ?? 50359;
  let said = []; // (as many names as 160 of its tokens hold — Whisper's limit is 224 — the first given nearest: they count most)
  for (const n of names || []) { const t = encode(' ' + n + (said.length ? ',' : '.')); if (said.length + t.length > 160) break; said = [...t, ...said]; }
  if (end && said.length) said = [...said, ...encode(' ' + end)];
  const langIds = Object.entries(gen.lang_to_id || {}), wanted = new Set(['en', ...(langs || [])].map(l => `<|${l}|>`));
  const first = await step(said.length ? [PREV, ...said, SOT] : [SOT]), t3 = performance.now();
  const en = gen.lang_to_id?.['<|en|>'] ?? 50259; let lang = en, best = -Infinity;
  for (const [tok, id] of langIds) if (wanted.has(tok) && first[id] > best) { best = first[id]; lang = id; }
  // (English, where it's nearly as likely as another: song names and commands come out in Latin letters, as searched)
  if (lang !== en && first[en] > best - 1.5) lang = en;
  const suppress = new Set(gen.suppress_tokens || []), begin = new Set(gen.begin_suppress_tokens || [220, EOT]), ids = [];
  let l = await step(gen.is_multilingual === false ? [NO_TS] : [lang, TRANSCRIBE, NO_TS]); // (the English-only model: no language, no task)
  for (let i = 0; i < 48; i++) {
    let top = -1, v = -Infinity;
    for (let t = 0; t <= EOT; t++) { if (suppress.has(t) || (i === 0 && begin.has(t))) continue; if (l[t] > v) { v = l[t]; top = t; } } // (words and the end: never its other special tokens, nor timestamps)
    if (top === EOT || top < 0) break;
    ids.push(top);
    if (ids.length > 8 && ids.slice(-4).join() === ids.slice(-8, -4).join()) break; // (going round in circles)
    if (wake && ids.length === 6 && !/flo|nether|neither|never/i.test(decode(ids))) break; // (listening for "Hey NetherFlow": six words' worth, and not it)
    l = await step([top]);
  }
  const code = langIds.find(([, id]) => id === lang)?.[0].slice(2, -2) || 'en';
  return { text: decode(ids), lang: code, ms: { mel: Math.round(t1 - t0), encoder: Math.round(t2 - t1), first: Math.round(t3 - t2), decoder: Math.round(performance.now() - t2), tokens: ids.length, prompt: said.length } };
}

onmessage = async ({ data: d }) => {
  if (d.init) {
    try {
      self.ort = await import(d.init.ort);
      ort.env.wasm.wasmPaths = { mjs: d.init.mjs, wasm: d.init.wasm };
      ort.env.wasm.numThreads = d.init.threads || 1; // (more: SharedArrayBuffer, the page cross-origin isolated by server.js)
      vocab = JSON.parse(d.init.vocab); gen = JSON.parse(d.init.gen); merges = d.init.merges; EOT = gen.eos_token_id ?? 50257;
      const cpu = b => ort.InferenceSession.create(new Uint8Array(b), { executionProviders: ['wasm'] });
      let gpu = false, enc = null;
      if (d.init.encoderGpu && self.navigator?.gpu) try { // (on the graphics card, run once on silence: its first run builds its shaders, ~1 s)
        enc = await ort.InferenceSession.create(new Uint8Array(d.init.encoderGpu), { executionProviders: ['webgpu'] });
        await enc.run({ [enc.inputNames[0]]: new ort.Tensor('float32', new Float32Array(MELS * FRAMES).fill(-1.5), [1, MELS, FRAMES]) });
        gpu = true;
      } catch { enc = null; } // (no graphics card it can use: the processor)
      nets = Promise.all([enc || cpu(d.init.encoder), cpu(d.init.decoder)]);
      await nets;
      postMessage({ ready: true, gpu });
    } catch (e) { postMessage({ error: String(e && e.message || e) }); }
    return;
  }
  if (d.pcm) {
    try { postMessage({ id: d.id, ...(await hear(d.pcm, d.langs, d.names, d.wake, d.end)) }); }
    catch (e) { postMessage({ id: d.id, error: String(e && e.message || e) }); }
  }
};
