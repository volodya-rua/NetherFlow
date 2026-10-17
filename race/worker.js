// NetherFlow - Copyright (C) 2026 Volodya.rua - GNU GPL v3 only, with additional terms (credit, name and logo): see LICENSE and NOTICE.
// Redline's 3D race (race.js) in a worker of its own, drawing on the canvas the page hands it: its graphics context
// (~0.35 s to make), its shaders (~0.8 s to compile) and each frame's work all off the page's thread — choosing Redline
// froze the page for a second. The page sends what the music's doing each frame; the newest is drawn at the worker's
// own frame, so frames the race can't keep up with are dropped, not queued.
//   page → { canvas, opts, size: [w, h, dpr] } · { size } · { song: key } · { frame: { now, kick, energy, playing, kind } }
//   worker → { car: [n, all] } · { ready, cars, errors } · { failed } · { info, key } · { kmh }
import { create } from './race.js';
let m = null, want = null, kmh, queued = false;
const draw = () => { queued = false; const r = m.frame(want.now, want); if (r.kmh !== kmh) postMessage({ kmh: kmh = r.kmh }); };
onmessage = async ({ data: d }) => {
  if (d.canvas) {
    // (the gantry's sign is lettered in Unbounded: a worker has none of the page's fonts)
    await new FontFace('Unbounded', 'url(/fonts/Unbounded-900-latin.woff2)', { weight: '900' }).load().then(f => fonts.add(f), () => {});
    try { m = await create(d.canvas, { ...d.opts, onCar: (n, all) => postMessage({ car: [n, all] }) }); m.resize(...d.size); postMessage({ ready: m.ready, cars: m.cars, errors: m.errors }); }
    catch (e) { postMessage({ failed: String(e?.message || e) }); }
  }
  else if (!m) return;
  else if (d.size) m.resize(...d.size);
  else if (d.song) postMessage({ info: m.song(d.song), key: d.song });
  else if (d.frame) { want = d.frame; if (!queued) { queued = true; (globalThis.requestAnimationFrame || setTimeout)(draw); } }
};
