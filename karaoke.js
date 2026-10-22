// NetherFlow - Copyright (C) 2026 Volodya.rua - GNU GPL v3 only, with additional terms (credit, name and logo): see LICENSE and NOTICE.
// Sing's AI voice remover, a worker of its own: Spleeter (Deezer's voice and music separation — its 2-stem model, made
// ONNX, int8, by sherpa-onnx's author) run by ONNX Runtime Web on this device: the song's sound never leaves it. The page
// sends a song (44.1 kHz, stereo) and where it's playing; this sends back, a part at a time (11.9 s: the model's 512
// frames), the song without its voice (stereo) and its voice alone (one channel) — the part playing first, then on from
// there, then what's before it.
// The engine and the model aren't in the app: the AI karaoke pack, downloaded when the user asks for it and kept on the
// device (see aiPack in index.html), handed over first.
//   in:  { init: { ort, mjs, wasm (the engine's files, as addresses), vocals, accompaniment (the model's two nets) } }
//        { song, L, R, from } a song, from its part `from` · { song, from } on from another part (a seek) · { stop: true }
//   out: { song, part, acc: [L, R], voice } · { song, done: true } · { song, error }
const SR = 44100, N = 4096, HOP = 1024, F = 1024, T = 512, B = N / 2 + 1, SEG = T * HOP, EPS = 1e-10;
let nets = null, job = null;
const load = () => nets || Promise.reject(new Error('no AI pack'));
// a radix-2 FFT, in place (inv: the inverse, unscaled)
const rev = new Uint16Array(N), wc = new Float64Array(N / 2), ws = new Float64Array(N / 2), win = new Float64Array(N);
for (let i = 0, bits = Math.log2(N); i < N; i++) { let r = 0; for (let b = 0, x = i; b < bits; b++, x >>= 1) r = (r << 1) | (x & 1); rev[i] = r; }
for (let i = 0; i < N / 2; i++) { wc[i] = Math.cos(2 * Math.PI * i / N); ws[i] = Math.sin(2 * Math.PI * i / N); }
for (let i = 0; i < N; i++) win[i] = .5 - .5 * Math.cos(2 * Math.PI * i / N); // (periodic Hann, as Spleeter's)
function fft(re, im, inv) {
  for (let i = 0; i < N; i++) { const j = rev[i]; if (j > i) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; } }
  for (let size = 2; size <= N; size <<= 1) {
    const half = size >> 1, step = N / size, sg = inv ? 1 : -1;
    for (let i = 0; i < N; i += size) for (let j = 0, k = 0; j < half; j++, k += step) {
      const a = i + j, b = a + half, c = wc[k], s = sg * ws[k], tr = re[b] * c - im[b] * s, ti = re[b] * s + im[b] * c;
      re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
    }
  }
}
const re = new Float64Array(N), im = new Float64Array(N);
// one frame of the song (it starts N samples in: padded with silence, as Spleeter pads it), both sides at once: their
// spectra into l and r (B bins, re/im interleaved)
function frame(L, R, f, l, r) {
  const at = f * HOP - N;
  for (let i = 0; i < N; i++) { const j = at + i, ok = j >= 0 && j < L.length; re[i] = ok ? L[j] * win[i] : 0; im[i] = ok ? R[j] * win[i] : 0; }
  fft(re, im, false);
  for (let k = 0; k < B; k++) { const j = (N - k) % N; l[2 * k] = (re[k] + re[j]) / 2; l[2 * k + 1] = (im[k] - im[j]) / 2; r[2 * k] = (im[k] + im[j]) / 2; r[2 * k + 1] = (re[j] - re[k]) / 2; }
}
// a part: its frames' spectra, the two nets' guesses at each side's voice and music, each a share of the song (Spleeter's
// soft masks; above the model's 11 kHz, the music's share as it was up to there on average, so the cymbals' air stays),
// and back to sound
async function part(L, R, p) {
  const [vNet, aNet] = await load(), f0 = p * T, X = new Float32Array(2 * T * F);
  const spec = Array.from({ length: T + 3 }, () => [new Float32Array(2 * B), new Float32Array(2 * B)]); // (3 before it: their sound overlaps this part's start)
  for (let i = 0; i < T + 3; i++) frame(L, R, f0 - 3 + i, spec[i][0], spec[i][1]);
  for (let c = 0; c < 2; c++) for (let t = 0; t < T; t++) { const s = spec[t + 3][c], o = (c * T + t) * F; for (let k = 0; k < F; k++) X[o + k] = Math.hypot(s[2 * k], s[2 * k + 1]); }
  const shape = [2, 1, T, F], run = async net => (await net.run({ [net.inputNames[0]]: new ort.Tensor('float32', X, shape) }))[net.outputNames[0]].data;
  const v = await run(vNet), a = await run(aNet);
  const accL = new Float32Array(SEG), accR = new Float32Array(SEG), vocL = new Float32Array(SEG), vocR = new Float32Array(SEG), ma = new Float32Array(B);
  const out = [[accL, accR], [vocL, vocR]], start = f0 * HOP; // (this part's sound: the padded song's samples from start)
  for (let i = 0; i < T + 3; i++) {
    const t = Math.max(0, i - 3), fAt = (f0 - 3 + i) * HOP;
    for (let stem = 0; stem < 2; stem++) {
      for (let c = 0; c < 2; c++) {
        const o = (c * T + t) * F;
        let top = 0;
        for (let k = 0; k < F; k++) { const vv = v[o + k] * v[o + k], aa = a[o + k] * a[o + k], sum = vv + aa + EPS; ma[k] = stem ? (vv + EPS / 2) / sum : (aa + EPS / 2) / sum; if (k >= F - 124) top += ma[k]; }
        const ext = top / 124; for (let k = F; k < B; k++) ma[k] = ext;
        const s = spec[i][c];
        // (each side into its own half of one inverse FFT: left real, right imaginary)
        if (!c) { re.fill(0); im.fill(0); }
        for (let k = 0; k < B; k++) { const m = ma[k], xr = s[2 * k] * m, xi = s[2 * k + 1] * m;
          if (!c) { re[k] += xr; im[k] += xi; if (k && k < B - 1) { re[N - k] += xr; im[N - k] -= xi; } }
          else { re[k] -= xi; im[k] += xr; if (k && k < B - 1) { re[N - k] += xi; im[N - k] += xr; } } }
      }
      fft(re, im, true);
      const [oL, oR] = out[stem], g = 1 / (N * 1.5); // (Hann at a quarter's hop: its squares sum to 1.5)
      for (let n = 0; n < N; n++) { const j = fAt + n - start; if (j >= 0 && j < SEG) { oL[j] += re[n] * win[n] * g; oR[j] += im[n] * win[n] * g; } }
    }
  }
  const voice = new Float32Array(SEG); for (let j = 0; j < SEG; j++) voice[j] = (vocL[j] + vocR[j]) / 2;
  return { acc: [accL, accR], voice };
}
onmessage = async ({ data: d }) => {
  if (d.init) {
    importScripts(d.init.ort);
    ort.env.wasm.wasmPaths = { mjs: d.init.mjs, wasm: d.init.wasm };
    ort.env.wasm.numThreads = 1; // (more need the page cross-origin isolated, which this app isn't)
    nets = Promise.all([d.init.vocals, d.init.accompaniment].map(b => ort.InferenceSession.create(new Uint8Array(b), { executionProviders: ['wasm'] })));
    nets.catch(e => postMessage({ error: 'engine: ' + (e?.message || e) }));
    return;
  }
  if (d.stop) { job = null; return; }
  if (d.L) job = { song: d.song, L: d.L, R: d.R, done: new Set(), parts: Math.ceil((d.L.length + N) / SEG), from: d.from || 0, busy: false };
  else if (job && d.song === job.song) job.from = d.from;
  else return;
  const j = job;
  if (j.busy) return; // (already going: it picks up `from` at its next part)
  j.busy = true;
  try {
    for (;;) {
      if (job !== j) return;
      const order = [...Array(j.parts).keys()].map(i => (j.from + i) % j.parts), p = order.find(i => !j.done.has(i)); // (from where it plays, on to the end, then the start)
      if (p === undefined) { postMessage({ song: j.song, done: true }); return; }
      const r = await part(j.L, j.R, p);
      if (job !== j) return;
      j.done.add(p);
      postMessage({ song: j.song, part: p, acc: r.acc, voice: r.voice }, [r.acc[0].buffer, r.acc[1].buffer, r.voice.buffer]);
    }
  } catch (e) { postMessage({ song: j.song, error: String(e?.message || e) }); }
  finally { j.busy = false; }
};
