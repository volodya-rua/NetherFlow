// NetherFlow - Copyright (C) 2026 Volodya.rua - GNU GPL v3 only, with additional terms (credit, name and logo): see LICENSE and NOTICE.
// The AI assistant's brain, a worker of its own: a small language model (Qwen3, ONNX, 4-bit — made by Hugging Face's
// onnx-community) run by ONNX Runtime Web on this computer's graphics card: what's asked never leaves it. Given the
// app's instructions once (the prefix: what it can do, its settings — worked out once and kept), then each request:
// its answer, word by word, greedy.
//   in:  { init: { ort, mjs, wasm (the engine's files, as addresses), model (the net), vocab, merges, config, added (its
//          special tokens: JSON text) } } · { prefix: text } · { id, text (after the prefix), max (tokens), stream }
//   out: { ready, gpu } · { prefixed, tokens, ms } · { id, part (its answer so far: streaming) } · { id, text, tokens, ms:
//        { prefill, decode } } · { id?, error }
let ort = null, sess = null, cfg = null, vocab = null, byId = null, rank = null, prefix = null, kvType = 'float16';
const SPECIAL = /(<\|im_start\|>|<\|im_end\|>|<\|endoftext\|>|<think>|<\/think>)/;

// ---- words to tokens and back: byte-level BPE, as GPT-2's, with Qwen's way of cutting text into pieces first
const byteChar = [], charByte = new Map();
{ const bs = []; for (let b = 33; b <= 126; b++) bs.push(b); for (let b = 161; b <= 172; b++) bs.push(b); for (let b = 174; b <= 255; b++) bs.push(b);
  const cs = bs.slice(); let k = 0; for (let b = 0; b < 256; b++) if (!bs.includes(b)) { bs.push(b); cs.push(256 + k++); }
  bs.forEach((b, i) => { byteChar[b] = String.fromCharCode(cs[i]); charByte.set(String.fromCharCode(cs[i]), b); }); }
const PIECES = /'[sS]|'[tT]|'[rR][eE]|'[vV][eE]|'[mM]|'[lL][lL]|'[dD]|[^\r\n\p{L}\p{N}]?\p{L}+|\p{N}| ?[^\s\p{L}\p{N}]+[\r\n]*|\s*[\r\n]+|\s+(?!\S)|\s+/gu;
function encode(text) {
  const out = [];
  for (const part of text.split(SPECIAL)) {
    if (!part) continue;
    if (SPECIAL.test(part) && vocab[part] != null) { out.push(vocab[part]); continue; }
    for (const piece of part.match(PIECES) || []) {
      const w = [...new TextEncoder().encode(piece)].map(b => byteChar[b]);
      for (;;) { // (the best-ranked pair joined, again and again)
        let at = -1, best = Infinity;
        for (let i = 0; i < w.length - 1; i++) { const r = rank.get(w[i] + ' ' + w[i + 1]); if (r < best) { best = r; at = i; } }
        if (at < 0) break;
        w.splice(at, 2, w[at] + w[at + 1]);
      }
      for (const t of w) if (vocab[t] != null) out.push(vocab[t]);
    }
  }
  return out;
}
function decode(ids) {
  const bytes = [];
  for (const id of ids) { const t = byId[id]; if (t == null || SPECIAL.test(t)) continue; for (const ch of t) { const b = charByte.get(ch); if (b != null) bytes.push(b); } }
  return new TextDecoder().decode(new Uint8Array(bytes));
}

// ---- the net: its tokens in, with what it's worked out already (its keys and values, kept on the graphics card)
const half = h => { const s = h >> 15, e = (h >> 10) & 31, f = h & 1023; return (s ? -1 : 1) * (e ? e === 31 ? (f ? NaN : Infinity) : 2 ** (e - 15) * (1 + f / 1024) : 2 ** -14 * (f / 1024)); };
async function run(ids, past, pastLen) {
  const L = cfg.num_hidden_layers, H = cfg.num_key_value_heads, D = cfg.head_dim || cfg.hidden_size / cfg.num_attention_heads, n = ids.length;
  const feeds = {
    input_ids: new ort.Tensor('int64', BigInt64Array.from(ids.map(BigInt)), [1, n]),
    attention_mask: new ort.Tensor('int64', new BigInt64Array(pastLen + n).fill(1n), [1, pastLen + n]),
    position_ids: new ort.Tensor('int64', BigInt64Array.from({ length: n }, (_, i) => BigInt(pastLen + i)), [1, n]),
  };
  for (let i = 0; i < L; i++) for (const kv of ['key', 'value']) feeds[`past_key_values.${i}.${kv}`] = past?.[`${i}.${kv}`] || new ort.Tensor(kvType, kvType === 'float16' ? new Uint16Array(0) : new Float32Array(0), [1, H, 0, D]);
  const out = await sess.run(feeds), kept = {};
  for (let i = 0; i < L; i++) for (const kv of ['key', 'value']) kept[`${i}.${kv}`] = out[`present.${i}.${kv}`];
  const V = out.logits.dims[2], all = await out.logits.getData(), last = all.subarray((n - 1) * V, n * V);
  out.logits.dispose?.();
  return { kept, last };
}
const drop = (kv, keep) => { for (const k in kv) if (kv[k] !== keep?.[k]) kv[k].dispose?.(); };
const argmax = l => { let top = 0, v = -Infinity; const f16 = l instanceof Uint16Array; for (let t = 0; t < l.length; t++) { const x = f16 ? half(l[t]) : l[t]; if (x > v) { v = x; top = t; } } return top; };

onmessage = async ({ data: d }) => {
  try {
    if (d.init) {
      ort = await import(d.init.ort); ort.env.logLevel = 'error';
      ort.env.wasm.wasmPaths = { mjs: d.init.mjs, wasm: d.init.wasm };
      cfg = JSON.parse(d.init.config); vocab = JSON.parse(d.init.vocab);
      for (const [t, id] of Object.entries(JSON.parse(d.init.added || '{}'))) vocab[t] = id;
      byId = []; for (const [t, id] of Object.entries(vocab)) byId[id] = t;
      rank = new Map(d.init.merges.split('\n').slice(1).filter(Boolean).map((m, i) => [m, i]));
      const outs = {}; for (let i = 0; i < cfg.num_hidden_layers; i++) for (const kv of ['key', 'value']) outs[`present.${i}.${kv}`] = 'gpu-buffer';
      // (its graph left as made: the engine's optimizing makes a second copy of a 1.4 GB net, more than its memory holds)
      sess = await ort.InferenceSession.create(new Uint8Array(d.init.model), { executionProviders: ['webgpu'], preferredOutputLocation: outs, graphOptimizationLevel: 'disabled', logSeverityLevel: 3 });
      kvType = sess.inputMetadata?.find?.(m => m.name === 'past_key_values.0.key')?.type || 'float16'; // (what it keeps, in half precision or full: as the model was made)
      return postMessage({ ready: true, gpu: true });
    }
    if (d.prefix != null) {
      const t0 = performance.now(), ids = encode(d.prefix);
      if (prefix) drop(prefix.kv);
      const { kept } = await run(ids, null, 0);
      prefix = { kv: kept, n: ids.length };
      return postMessage({ prefixed: true, tokens: ids.length, ms: Math.round(performance.now() - t0) });
    }
    if (d.text != null) {
      const t0 = performance.now(), ids = encode(d.text), eos = new Set([cfg.eos_token_id, vocab['<|im_end|>'], vocab['<|endoftext|>']].flat());
      let { kept, last } = await run(ids, prefix?.kv, prefix?.n || 0), len = (prefix?.n || 0) + ids.length;
      const t1 = performance.now(), got = [];
      for (let i = 0; i < (d.max || 96); i++) {
        const top = argmax(last);
        if (eos.has(top)) break;
        got.push(top);
        if (d.stream) postMessage({ id: d.id, part: decode(got) });
        const r = await run([top], kept, len); len++;
        drop(kept, prefix?.kv); kept = r.kept; last = r.last;
      }
      drop(kept, prefix?.kv);
      return postMessage({ id: d.id, text: decode(got), tokens: got.length, ms: { prefill: Math.round(t1 - t0), decode: Math.round(performance.now() - t1) } });
    }
  } catch (e) { postMessage({ id: d.id, error: String(e && e.message || e) }); }
};
