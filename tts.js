// NetherFlow - Copyright (C) 2026 Volodya.rua - GNU GPL v3 only, with additional terms (credit, name and logo): see LICENSE and NOTICE.
// The AI assistant's voice, a worker of its own: Kokoro (82M, Apache-2.0 — made ONNX by Hugging Face's onnx-community)
// run by ONNX Runtime Web on this computer — on its graphics card where it can — so what it says is made here. Text →
// its sounds (eSpeak NG, by phonemizer.js) → Kokoro, in one of its own made-up voices (never anyone real's) → 24 kHz audio.
// (The text's tidying and the sounds' fixes follow kokoro-js, Apache-2.0.)
//   in:  { init: { ort, mjs, wasm, phonemizer (addresses), model, gpu (on the graphics card), vocab (Kokoro's sounds →
//          numbers: JSON) } } · { voice: name, style (its 510×256 numbers: an ArrayBuffer) } · { id, text, voice, speed }
//   out: { ready, gpu } · { id, audio (Float32Array, 24 kHz), ms } · { id?, error }
let ort = null, sess = null, vocab = null, phonemize = null, gpu = false;
const styles = new Map();

// the text tidied as it's said: numbers, times, money, titles (kokoro-js's rules, the ones that matter here)
const tidy = t => t.replace(/[‘’]/g, "'").replace(/[“”«»]/g, '"').replace(/\s+/g, ' ')
  .replace(/\bDr\.(?= [A-Z])/g, 'Doctor').replace(/\bMr\./g, 'Mister').replace(/\bMs\./g, 'Miss').replace(/\bMrs\./g, 'Missus')
  .replace(/(\d+)%/g, '$1 percent').replace(/\b(\d{1,2}):(\d\d)\b/g, (m, h, mm) => +mm ? `${h} ${+mm < 10 ? 'oh ' + +mm : mm}` : `${h} o'clock`)
  .replace(/(?<=\d),(?=\d)/g, '').replace(/(?<=\d)-(?=\d)/g, ' to ').trim();
const PUNCT = /(\s*[;:,.!?¡¿—…"()\[\]{}]+\s*)+/g;
async function sounds(text, lang) {
  text = tidy(text);
  const parts = []; let at = 0;
  for (const m of text.matchAll(PUNCT)) { if (m.index > at) parts.push([false, text.slice(at, m.index)]); parts.push([true, m[0]]); at = m.index + m[0].length; }
  if (at < text.length) parts.push([false, text.slice(at)]);
  const out = (await Promise.all(parts.map(async ([p, s]) => p ? s : (await phonemize(s, lang)).join(' ')))).join('');
  return out.replace(/ʲ/g, 'j').replace(/r/g, 'ɹ').replace(/x/g, 'k').replace(/ɬ/g, 'l').replace(/(?<=[a-zɹː])(?=hˈʌndɹɪd)/g, ' ')
    .replace(/ z(?=[;:,.!?¡¿—…"«»“” ]|$)/g, 'z').replace(/(?<=nˈaɪn)ti(?!ː)/g, 'di').trim();
}
async function say(text, voice, speed = 1) {
  const style = styles.get(voice); if (!style) throw new Error('voice ' + voice);
  const lang = /^[bh]/.test(voice) ? (voice[0] === 'h' ? 'hi' : 'en') : 'en-us';
  const ids = [0, ...[...await sounds(text, lang)].map(c => vocab[c]).filter(x => x != null).slice(0, 510), 0]; // ($ … $: its start and end)
  const row = Math.min(Math.max(ids.length - 2, 0), 509) * 256;
  const r = await sess.run({ input_ids: new ort.Tensor('int64', BigInt64Array.from(ids.map(BigInt)), [1, ids.length]), style: new ort.Tensor('float32', style.slice(row, row + 256), [1, 256]), speed: new ort.Tensor('float32', [speed], [1]) });
  return (await r.waveform.getData?.()) ?? r.waveform.data;
}

onmessage = async ({ data: d }) => {
  try {
    if (d.init) {
      ort = await import(d.init.ort); ort.env.logLevel = 'error'; ort.env.wasm.wasmPaths = { mjs: d.init.mjs, wasm: d.init.wasm }; ort.env.wasm.numThreads = d.init.threads || 4;
      ({ phonemize } = await import(d.init.phonemizer));
      vocab = JSON.parse(d.init.vocab);
      if (d.init.gpu && self.navigator?.gpu) try { sess = await ort.InferenceSession.create(new Uint8Array(d.init.gpu), { executionProviders: ['webgpu'], logSeverityLevel: 3 }); gpu = true; } catch { sess = null; }
      sess ||= await ort.InferenceSession.create(new Uint8Array(d.init.model), { executionProviders: ['wasm'] });
      return postMessage({ ready: true, gpu });
    }
    if (d.voice && d.style) { styles.set(d.voice, new Float32Array(d.style)); return postMessage({ voice: d.voice }); }
    if (d.text != null) {
      const t0 = performance.now(), audio = await say(d.text, d.voice, d.speed);
      return postMessage({ id: d.id, audio, ms: Math.round(performance.now() - t0) }, [audio.buffer]);
    }
  } catch (e) { postMessage({ id: d.id, error: String(e && e.message || e) }); }
};
