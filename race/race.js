// NetherFlow - Copyright (C) 2026 Volodya.rua - GNU GPL v3 only, with additional terms (credit, name and logo): see LICENSE and NOTICE.
// Redline's 3D races (the desktop app, on Extreme+): real circuits — their layouts and heights (tracks.json) and what's
// round them (maps/: the ground, forests, buildings, grandstands, barriers, roads; all from OpenStreetMap, ODbL) — at
// night under floodlights, with real cars (cars.json: CC-BY models from Sketchfab, credited in legal.html) racing each
// other to the music: each driven by itself, braking for the corners by its own grip, slipstreaming, overtaking.
// Filmed like a broadcast and cut on the beat (index.html: "Redline's races").
// Drawn with three.js (MIT: three/).
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

const V = THREE.Vector3, STEP = 3; // (metres between the track's samples)
const HALF = 6.5, KERB = 7.7, WALL = 18, VERGE = 14; // (the road's half width; out to the kerbs, the barriers, the verge strip)
const PACK = 6, POLE = 70, LIGHTS = 6; // (cars on track; a floodlight every 70 m; how many of them really light the cars)
const c01 = x => Math.min(1, Math.max(0, x)), mix = (a, b, t) => a + (b - a) * t, ss = (a, b, x) => { const t = c01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const rnd = s => () => (s = (s * 16807) % 2147483647) / 2147483647; // (a seeded random: the same scenery every time)

// ---- textures, drawn here (nothing to download)
function canvasTex(w, h, draw, repeat = true, color = false) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  if (color) t.colorSpace = THREE.SRGBColorSpace; // (a colour, not an amount)
  t.anisotropy = 8;
  return t;
}
const glowTex = () => canvasTex(128, 128, (g, w) => {
  const r = g.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
  r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(.18, 'rgba(255,255,255,.55)'); r.addColorStop(.5, 'rgba(255,255,255,.08)'); r.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = r; g.fillRect(0, 0, w, w);
}, false);
const smokeTex = () => canvasTex(64, 64, (g, w) => {
  const r = g.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
  r.addColorStop(0, 'rgba(255,255,255,.8)'); r.addColorStop(.5, 'rgba(255,255,255,.35)'); r.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = r; g.fillRect(0, 0, w, w);
}, false);
const streakTex = () => canvasTex(64, 256, (g, w, h) => { // (a light's reflection on the wet road: long, fading away from it)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const a = Math.exp(-(((x - w / 2) / (w * .22)) ** 2)) * (1 - y / h) ** 1.6;
    g.fillStyle = `rgba(255,255,255,${a})`; g.fillRect(x, y, 1, 1);
  }
}, false);
function asphaltTex(lines = true) { // across the road (u: left edge to right edge) and 6 m along it; white lines at the edges
  return canvasTex(512, 256, (g, w, h) => {
    const r = rnd(7), img = g.createImageData(w, h);
    for (let i = 0; i < w * h; i++) { const v = 34 + r() * 26 + (r() < .02 ? 30 : 0); img.data.set([v, v, v + 2, 255], i * 4); }
    g.putImageData(img, 0, 0);
    if (!lines) return;
    g.fillStyle = 'rgba(0,0,0,.18)'; for (const x of [.3, .62]) g.fillRect(w * x, 0, w * .09, h); // (rubber laid down on the racing lines)
    g.fillStyle = '#e8e8e8'; const px = w / (HALF * 2); g.fillRect(px * .3, 0, px * .22, h); g.fillRect(w - px * .52, 0, px * .22, h);
  }, true, true);
}
const wetTex = () => canvasTex(256, 256, (g, w, h) => { // (roughness: puddles shine; 48 m along)
  const r = rnd(11); g.fillStyle = 'rgb(0,150,0)'; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 40; i++) { const x = r() * w, y = r() * h, s = 10 + r() * 40, gr = g.createRadialGradient(x, y, 0, x, y, s); gr.addColorStop(0, 'rgba(0,40,0,.9)'); gr.addColorStop(1, 'rgba(0,150,0,0)'); g.fillStyle = gr; g.fillRect(x - s, y - s, s * 2, s * 2); }
});
const kerbTex = () => canvasTex(16, 64, (g, w, h) => { g.fillStyle = '#d8d8d8'; g.fillRect(0, 0, w, h); g.fillStyle = '#c4141c'; g.fillRect(0, 0, w, h / 2); }, true, true);
const signTex = () => canvasTex(1024, 80, (g, w, h) => { // (the gantry's sign)
  g.fillStyle = '#07080a'; g.fillRect(0, 0, w, h); g.fillStyle = '#ff1e2d'; g.fillRect(0, 0, w, 6); g.fillRect(0, h - 6, w, 6);
  g.font = "900 46px 'Unbounded', sans-serif"; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = '#f5f6f7'; g.fillText('NETHERFLOW  ·  REDLINE', w / 2, h / 2 + 2);
}, false, true);
const dashTex = () => canvasTex(4, 64, (g, w, h) => { g.fillStyle = '#000'; g.fillRect(0, 0, w, h); g.fillStyle = '#fff'; g.fillRect(0, 0, w, h * .62); });
const detailTex = () => canvasTex(256, 256, (g, w, h) => { // (the ground close up: blades, stones, patches; repeating every 3 m)
  const r = rnd(23), img = g.createImageData(w, h);
  for (let i = 0; i < w * h; i++) { const v = 150 + (r() - .5) * 90; img.data.set([v, v, v, 255], i * 4); }
  g.putImageData(img, 0, 0);
  for (let i = 0; i < 900; i++) { const x = r() * w, y = r() * h, l = 2 + r() * 7; g.strokeStyle = r() < .5 ? 'rgba(40,40,40,.35)' : 'rgba(255,255,255,.18)'; g.lineWidth = 1; g.beginPath(); g.moveTo(x, y); g.lineTo(x + (r() - .5) * 3, y - l); g.stroke(); }
});
const fenceTex = () => canvasTex(64, 64, (g, w) => { // (catch fencing: a diamond mesh, see-through; 35 cm a diamond, 9 rows up the fence)
  g.strokeStyle = '#fff'; g.lineWidth = 3; g.beginPath(); g.moveTo(0, 0); g.lineTo(w, w); g.moveTo(w, 0); g.lineTo(0, w); g.stroke();
  g.fillStyle = '#fff'; g.fillRect(0, 0, w, 3);
});
// the ground's colours, by what OpenStreetMap says covers it (see tools/race-tracks.js: AREA), and its roads
const COVER = { 0: '#33412a', 1: '#1c2717', 2: '#3a4a2c', 3: '#4b4831', 4: '#857d6e', 5: '#38383b', 6: '#0f1d29', 7: '#3b3732' };
function coverTex(M, X0, Z0, SX, SZ) {
  return canvasTex(2048, 2048, (g, W, H) => {
    const px = x => (x - X0) / SX * W, pz = z => (z - Z0) / SZ * H, path = p => { g.beginPath(); for (let i = 0; i < p.length; i += 2) g[i ? 'lineTo' : 'moveTo'](px(p[i]), pz(p[i + 1])); };
    g.fillStyle = COVER[0]; g.fillRect(0, 0, W, H);
    for (const [cls, p] of M.areas || []) { g.fillStyle = COVER[cls]; path(p); g.closePath(); g.fill(); }
    g.lineCap = g.lineJoin = 'round'; g.strokeStyle = '#2b2b2f';
    for (const [w, p] of M.roads || []) { g.lineWidth = w / SX * W; path(p); g.stroke(); }
    const r = rnd(5); // (grain: no field one flat colour)
    for (let i = 0; i < 90000; i++) { g.fillStyle = r() < .5 ? 'rgba(0,0,0,.14)' : 'rgba(255,255,255,.05)'; g.fillRect(r() * W, r() * H, 1 + r() * 3, 1 + r() * 3); }
  }, false, true);
}

// ---- the track: samples every 3 m round the lap
function sampleTrack(T) {
  const src = T.pts, pts = [];
  for (let i = 0; i < src.length; i += 3) pts.push(new V(src[i], src[i + 1], src[i + 2]));
  const sp = new THREE.CatmullRomCurve3(pts, true, 'centripetal').getSpacedPoints(Math.round(T.len / STEP)); sp.pop();
  const n = sp.length, S = { n, len: n * STEP };
  for (const k of ['px', 'py', 'pz', 'tx', 'tz', 'nx', 'nz', 'k', 'slope', 'line', 'lim']) S[k] = new Float32Array(n);
  const at = i => sp[(i % n + n) % n];
  for (let i = 0; i < n; i++) { let y = 0; for (let j = -4; j <= 4; j++) y += at(i + j).y; S.px[i] = sp[i].x; S.py[i] = y / 9; S.pz[i] = sp[i].z; }
  bridges(S);
  const head = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const a = at(i - 1), b = at(i + 1), dx = b.x - a.x, dz = b.z - a.z, l = Math.hypot(dx, dz) || 1;
    S.tx[i] = dx / l; S.tz[i] = dz / l; S.nx[i] = dz / l; S.nz[i] = -dx / l; // (n: to the left, going round)
    head[i] = Math.atan2(dx, dz);
    S.slope[i] = (S.py[(i + 1) % n] - S.py[(i - 1 + n) % n]) / (2 * STEP);
  }
  const W = 4, raw = new Float32Array(n);
  for (let i = 0; i < n; i++) { let d = head[(i + W) % n] - head[(i - W + n) % n]; d -= Math.round(d / (2 * Math.PI)) * 2 * Math.PI; raw[i] = d / (2 * W * STEP); } // (>0: turning left)
  for (let i = 0; i < n; i++) { let s = 0; for (let j = -3; j <= 3; j++) s += raw[(i + j + n) % n]; S.k[i] = s / 7; }
  // the racing line: out before a corner, in at its apex, out again after (smoothed)
  const ahead = Math.round(36 / STEP), line = new Float32Array(n);
  for (let i = 0; i < n; i++) line[i] = Math.max(-4.6, Math.min(4.6, (S.k[i] - S.k[(i + ahead) % n] * 1.1) * 420));
  for (let i = 0; i < n; i++) { let s = 0; for (let j = -12; j <= 12; j++) s += line[(i + j + n) % n]; S.line[i] = s / 25; }
  // how far out the scenery may go on each side before it folds over itself in a tight corner
  for (let i = 0; i < n; i++) { let m = 0; for (let j = -6; j <= 6; j++) m = Math.max(m, Math.abs(S.k[(i + j + n) % n])); S.lim[i] = m > 1e-4 ? .85 / m : 1e9; }
  return S;
}
// how fast a car takes each bit of the lap: its grip in the corners, braking before them, its power out of them
function paceOf(S, grip, power) {
  const n = S.n, v = new Float32Array(n), top = 72 + 16 * power, brake = 27 * grip, acc = 8.5 * power;
  for (let i = 0; i < n; i++) v[i] = Math.min(top, Math.sqrt(27 * grip / Math.max(Math.abs(S.k[i]), 1e-4)));
  for (let pass = 0; pass < 2; pass++) for (let i = n - 1; i >= 0; i--) v[i] = Math.min(v[i], Math.sqrt(v[(i + 1) % n] ** 2 + 2 * brake * STEP));
  for (let pass = 0; pass < 2; pass++) for (let i = 0; i < n; i++) v[i] = Math.min(v[i], Math.sqrt(v[(i - 1 + n) % n] ** 2 + 2 * acc * STEP));
  return v;
}
// Where a circuit crosses itself (Suzuka), the second pass over is raised onto a bridge (the map's heights are the ground's)
function bridges(S) {
  const n = S.n, gap = Math.round(300 / STEP);
  for (let i = 0; i < n; i += 2) for (let j = i + gap; j < n - (i < gap ? gap - i : 0); j += 2) {
    if (Math.hypot(S.px[i] - S.px[j], S.pz[i] - S.pz[j]) > 6) continue;
    const span = Math.round(160 / STEP), lift = 9 + S.py[i] - S.py[j];
    for (let d = -span; d <= span; d++) S.py[(j + d + n) % n] += Math.max(0, lift) * (.5 + .5 * Math.cos(Math.PI * d / span));
    return;
  }
}
// a strip along the track between two sideways offsets (o: left of the middle; a left of b) — or a wall at one offset
function ribbon(S, a, b, ya, yb, vLen, mask, color, uvw) {
  const n = S.n, pos = new Float32Array(n * 6), uv = new Float32Array(n * 4), col = color && new Float32Array(n * 6), idx = [];
  const lim = (i, o) => o > 0 ? Math.min(o, S.lim[i] * (S.k[i] > 0 ? 1 : 1e3)) : Math.max(o, -S.lim[i] * (S.k[i] < 0 ? 1 : 1e3));
  for (let i = 0; i < n; i++) {
    const oa = lim(i, a), ob = lim(i, b), x = S.px[i], y = S.py[i], z = S.pz[i], xa = x + S.nx[i] * oa, za = z + S.nz[i] * oa, xb = x + S.nx[i] * ob, zb = z + S.nz[i] * ob;
    pos.set([xa, y + ya, za, xb, y + yb, zb], i * 6);
    uv.set(uvw ? [...uvw(xa, za), ...uvw(xb, zb)] : [0, i * STEP / vLen, 1, i * STEP / vLen], i * 4);
    if (col) { const c = color(i, oa), d = color(i, ob); col.set([...c, ...d], i * 6); }
    if (!mask || mask[i]) { const j = (i + 1) % n; idx.push(2 * i, 2 * i + 1, 2 * j, 2 * i + 1, 2 * j + 1, 2 * j); }
  }
  return geo(pos, uv, col, idx);
}
function geo(pos, uv, col, idx) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos instanceof Float32Array ? pos : new Float32Array(pos), 3));
  if (uv) g.setAttribute('uv', new THREE.BufferAttribute(uv instanceof Float32Array ? uv : new Float32Array(uv), 2));
  if (col) g.setAttribute('color', new THREE.BufferAttribute(col instanceof Float32Array ? col : new Float32Array(col), 3));
  g.setIndex(idx); g.computeVertexNormals();
  return g;
}
// a flat strip along a map's line (a road), or a wall standing on it (a barrier, a fence)
function lineStrip(lines, width, yOf, color) {
  const pos = [], uv = [], col = [], idx = [];
  for (const p of lines) {
    const m = p.length / 2; if (m < 2) continue;
    let along = 0; const base = pos.length / 3;
    for (let i = 0; i < m; i++) {
      const a = Math.max(0, i - 1), b = Math.min(m - 1, i + 1), dx = p[b * 2] - p[a * 2], dz = p[b * 2 + 1] - p[a * 2 + 1], l = Math.hypot(dx, dz) || 1;
      const x = p[i * 2], z = p[i * 2 + 1], ox = dz / l * width / 2, oz = -dx / l * width / 2, y = yOf(x, z);
      if (i) along += Math.hypot(x - p[i * 2 - 2], z - p[i * 2 - 1]);
      pos.push(x + ox, y, z + oz, x - ox, y, z - oz); uv.push(0, along / 6, 1, along / 6);
      if (color) { const c = color(x, z); col.push(...c, ...c); }
      if (i) { const q = base + i * 2; idx.push(q - 2, q - 1, q, q - 1, q + 1, q); }
    }
  }
  return pos.length ? geo(pos, uv, color && col, idx) : null;
}
function lineWall(lines, h0, h1, yOf, uLen) {
  const pos = [], uv = [], idx = [];
  for (const p of lines) {
    const m = p.length / 2; if (m < 2) continue;
    let along = 0; const base = pos.length / 3;
    for (let i = 0; i < m; i++) {
      const x = p[i * 2], z = p[i * 2 + 1], y = yOf(x, z);
      if (i) along += Math.hypot(x - p[i * 2 - 2], z - p[i * 2 - 1]);
      pos.push(x, y + h0, z, x, y + h1, z); uv.push(0, along / uLen, (h1 - h0) / uLen, along / uLen); // (v along it: a light strip's dashes run along, a fence's mesh square)
      if (i) { const q = base + i * 2; idx.push(q - 2, q, q - 1, q - 1, q, q + 1); }
    }
  }
  return pos.length ? geo(pos, uv, null, idx) : null;
}
// the buildings: walls and a roof for each footprint, as tall as mapped; a grandstand's roof sloping up away from the
// track (its seats). Each gets a seed for its lit windows (see the material).
function buildingGeo(list, ground, away, pool) {
  const pos = [], nor = [], uv = [], col = [], seed = [], idx = [], r = rnd(17), a = new V(), b = new V(), c = new V(), n = new V();
  const tri = (i0, i1, i2, want) => { // (wound to face the way it should)
    a.fromArray(pos, i0 * 3); b.fromArray(pos, i1 * 3); c.fromArray(pos, i2 * 3);
    n.subVectors(b, a).cross(c.sub(a)); if (n.dot(want) < 0) idx.push(i0, i2, i1); else idx.push(i0, i1, i2);
  };
  for (const [h, flat, kind] of list) {
    let ring = []; for (let i = 0; i < flat.length; i += 2) ring.push([flat[i], flat[i + 1]]);
    if (ring.length > 3 && Math.hypot(ring[0][0] - ring[ring.length - 1][0], ring[0][1] - ring[ring.length - 1][1]) < .5) ring.pop();
    if (ring.length < 3) continue;
    let area = 0; for (let i = 0; i < ring.length; i++) { const [x1, z1] = ring[i], [x2, z2] = ring[(i + 1) % ring.length]; area += x1 * z2 - x2 * z1; }
    if (area < 0) ring.reverse(); // (one way round, so "out" is always the same side)
    const ys = ring.map(([x, z]) => ground(x, z)), base = Math.min(...ys) - .3, top = Math.max(...ys) + h, seat = kind === 1;
    const near = Math.min(...ring.map(([x, z]) => away(x, z))), far = Math.max(...ring.map(([x, z]) => away(x, z)));
    const roofY = ([x, z]) => seat ? base + 2 + (top - base - 2) * c01((away(x, z) - near) / Math.max(1, far - near)) : top;
    const cx = ring.reduce((s, p) => s + p[0], 0) / ring.length, cz = ring.reduce((s, p) => s + p[1], 0) / ring.length, lit = .25 + Math.min(1.5, pool(cx, cz)) * .8;
    const tone = seat ? [.16, .16, .18] : [[.42, .4, .37], [.36, .33, .3], [.3, .31, .33], [.45, .36, .3], [.25, .25, .26]][Math.floor(r() * 5)], s = seat ? -1 : r() * 100;
    const put = (x, y, z, nx, ny, nz, u, v) => { pos.push(x, y, z); nor.push(nx, ny, nz); uv.push(u, v); col.push(tone[0] * lit, tone[1] * lit, tone[2] * lit); seed.push(s); return pos.length / 3 - 1; };
    let along = 0;
    for (let i = 0; i < ring.length; i++) { // walls
      const [x1, z1] = ring[i], [x2, z2] = ring[(i + 1) % ring.length], L = Math.hypot(x2 - x1, z2 - z1) || 1, ox = (z2 - z1) / L, oz = -(x2 - x1) / L;
      const t1 = roofY(ring[i]), t2 = roofY(ring[(i + 1) % ring.length]);
      const q0 = put(x1, base, z1, ox, 0, oz, along, 0), q1 = put(x2, base, z2, ox, 0, oz, along + L, 0), q2 = put(x2, t2, z2, ox, 0, oz, along + L, t2 - base), q3 = put(x1, t1, z1, ox, 0, oz, along, t1 - base);
      const out = n.set(ox, 0, oz).clone(); tri(q0, q1, q2, out); tri(q0, q2, q3, out); along += L;
    }
    const tris = THREE.ShapeUtils.triangulateShape(ring.map(([x, z]) => new THREE.Vector2(x, z)), []), b0 = pos.length / 3;
    for (const p of ring) put(p[0], roofY(p), p[1], 0, 1, 0, 0, -1);
    for (const [i, j, k] of tris) tri(b0 + i, b0 + j, b0 + k, new V(0, 1, 0));
  }
  if (!pos.length) return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.setAttribute('seed', new THREE.Float32BufferAttribute(seed, 1));
  g.setIndex(idx);
  return g;
}
const breath = () => new Promise(r => setTimeout(r)); // (a long job in steps: the page's frames go on between them)
const inPoly = (p, x, z) => { let k = false; for (let i = 0, j = p.length - 2; i < p.length; j = i, i += 2) if ((p[i + 1] > z) !== (p[j + 1] > z) && x < (p[j] - p[i]) * (z - p[i + 1]) / (p[j + 1] - p[i + 1]) + p[i]) k = !k; return k; };

export async function create(canvas, { palA = [1, .12, .18], palB = [.09, .78, 1], test = false, onCar = () => {} } = {}) {
  const renderer = new THREE.WebGLRenderer({ canvas, powerPreference: 'high-performance', antialias: false, stencil: false });
  await new Promise(r => setTimeout(r, 0)); // (the page a frame between making the context, ~0.35 s, and the reflections' shaders, ~0.6 s)
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1;
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(55, 16 / 9, .1, 7000);
  const A = new THREE.Color().setRGB(...palA, THREE.SRGBColorSpace), B = new THREE.Color().setRGB(...palB, THREE.SRGBColorSpace);
  const fogC = new THREE.Color().setRGB(.012, .013, .02);
  scene.fog = new THREE.FogExp2(fogC, .0009); scene.background = fogC;
  scene.add(new THREE.HemisphereLight(new THREE.Color().setRGB(.16, .2, .32), new THREE.Color().setRGB(.03, .025, .02), .2));
  const moon = new THREE.DirectionalLight(new THREE.Color().setRGB(.55, .65, 1), .35); moon.position.set(-.4, .8, -.45); scene.add(moon); // (moonlight: the hills' and buildings' shapes)

  // the night: the sky darkest overhead, a faint glow of towns along the horizon, stars, the moon
  const sky = new THREE.Mesh(new THREE.SphereGeometry(5000, 48, 24), new THREE.ShaderMaterial({ side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { hor: { value: new THREE.Color().setRGB(.03, .028, .04) }, zen: { value: new THREE.Color().setRGB(.002, .003, .009) }, glow: { value: A.clone().multiplyScalar(.025).add(new THREE.Color().setRGB(.05, .03, .02)) }, moon: { value: moon.position.clone().normalize() } },
    vertexShader: 'varying vec3 d; void main() { d = normalize(position); gl_Position = (projectionMatrix * modelViewMatrix * vec4(position, 1.)).xyww; }',
    fragmentShader: `uniform vec3 hor, zen, glow, moon; varying vec3 d;
      float h(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
      void main() { float y = d.y; vec3 c = mix(hor, zen, pow(clamp(y, 0., 1.), .4)) + glow * exp(-max(y, 0.) * 9.);
        vec3 q = floor(d * 380.); c += step(.9982, h(q)) * smoothstep(.04, .35, y) * vec3(1.6, 1.7, 2.) * (.4 + h(q + 1.));
        float m = dot(d, moon); c += vec3(2.4, 2.4, 2.2) * smoothstep(.99965, .9998, m) + vec3(.05, .06, .09) * pow(max(m, 0.), 300.);
        gl_FragColor = vec4(y < 0. ? hor * .5 : c, 1.); }` }));
  sky.renderOrder = -1; scene.add(sky);

  // what the cars' paint reflects: dark, the floodlights' panels round the horizon, a red and a blue glow
  const pmrem = new THREE.PMREMGenerator(renderer), env = new THREE.Scene();
  env.add(new THREE.Mesh(new THREE.SphereGeometry(100, 16, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color().setRGB(.012, .012, .02), side: THREE.BackSide })));
  for (let i = 0; i < 14; i++) {
    const a = i / 14 * Math.PI * 2, p = new THREE.Mesh(new THREE.PlaneGeometry(26, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color().setRGB(9, 8.6, 8), side: THREE.DoubleSide }));
    p.position.set(Math.cos(a) * 80, 28 + (i % 3) * 9, Math.sin(a) * 80); p.lookAt(0, 0, 0); env.add(p);
  }
  for (const [c, y] of [[A, 4], [B, 9]]) { const r = new THREE.Mesh(new THREE.TorusGeometry(90, 1.4, 6, 64), new THREE.MeshBasicMaterial({ color: c.clone().multiplyScalar(3) })); r.rotation.x = Math.PI / 2; r.position.y = y; env.add(r); }
  const envMap = pmrem.fromScene(env, .03).texture;

  // ---- materials
  const glow = glowTex(), detail = detailTex();
  const road = new THREE.MeshStandardMaterial({ map: asphaltTex(), roughnessMap: wetTex(), roughness: 1, metalness: 0, vertexColors: true, envMap, envMapIntensity: .07 }); // (faint: the lamps' own shine is the real one)
  road.roughnessMap.repeat.set(1, 6 / 48);
  const street = new THREE.MeshStandardMaterial({ map: asphaltTex(false), roughness: .8, vertexColors: true, polygonOffset: true, polygonOffsetFactor: -2 });
  const kerbM = new THREE.MeshStandardMaterial({ map: kerbTex(), roughness: .5, vertexColors: true });
  const wallM = new THREE.MeshStandardMaterial({ color: new THREE.Color().setRGB(.5, .52, .56), roughness: .32, metalness: .75, side: THREE.DoubleSide });
  const concreteM = new THREE.MeshStandardMaterial({ color: new THREE.Color().setRGB(.4, .4, .39), roughness: .9, side: THREE.DoubleSide });
  const tyreM = new THREE.MeshStandardMaterial({ color: new THREE.Color().setRGB(.02, .02, .02), roughness: .9, side: THREE.DoubleSide });
  const fenceM = new THREE.MeshStandardMaterial({ alphaMap: fenceTex(), alphaTest: .5, color: new THREE.Color().setRGB(.45, .46, .48), metalness: .6, roughness: .5, side: THREE.DoubleSide });
  const led = [A, B].map(c => new THREE.MeshBasicMaterial({ map: dashTex(), color: c.clone(), side: THREE.DoubleSide, fog: false }));
  const groundM = new THREE.MeshStandardMaterial({ roughness: 1, vertexColors: true });
  const treeM = new THREE.MeshStandardMaterial({ roughness: .95, vertexColors: true });
  const standM = new THREE.MeshStandardMaterial({ color: new THREE.Color().setRGB(.05, .05, .06), roughness: .8 });
  const poleM = new THREE.MeshStandardMaterial({ color: new THREE.Color().setRGB(.25, .25, .27), roughness: .6, metalness: .6 });
  const headM = new THREE.MeshBasicMaterial({ color: new THREE.Color().setRGB(7, 6.6, 5.8) });
  // buildings: their windows lit here and there (a grid on the walls, a few lit warm, others cool or dark)
  const houseM = new THREE.MeshStandardMaterial({ roughness: .85, vertexColors: true });
  houseM.onBeforeCompile = sh => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float seed; varying float vSeed; varying vec2 vB; varying float vWall;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvSeed = seed; vB = uv; vWall = 1. - abs(normal.y);');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vSeed; varying vec2 vB; varying float vWall;\nfloat hsh(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }')
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        if (vSeed >= 0. && vWall > .5 && vB.y > 1.2) {
          vec2 g = vec2(vB.x / 2.9, (vB.y - .4) / 3.3), cell = floor(g), f = fract(g);
          float win = step(.2, f.x) * step(f.x, .8) * step(.28, f.y) * step(f.y, .82), r = hsh(cell + vSeed);
          totalEmissiveRadiance += win * step(.66, r) * mix(vec3(1., .72, .42), vec3(.7, .85, 1.), step(.92, r)) * (.5 + hsh(cell + vSeed + 7.) * 1.1);
        }`);
  };

  // ---- a track: its line, then what's round it (the map)
  const TRACKS = (await (await fetch('/race/tracks.json')).json()).tracks, KEYS = Object.keys(TRACKS);
  let S = null, world = null, poles = [], trackKey = '', starts = [], crowd = null, building = null;
  async function build(key) {
    const M = await fetch(`/race/maps/${key}.json`).then(r => r.ok ? r.json() : {}).catch(() => ({}));
    const T = sampleTrack(TRACKS[key]), n = T.n, r = rnd(n), W = new THREE.Group();
    // what's near the track: the nearest sample (and the lowest within 25 m: under a bridge, the ground's the lower road)
    const cell = 40, grid = new Map(), key2 = (x, z) => Math.floor(x / cell) + ',' + Math.floor(z / cell);
    for (let i = 0; i < n; i += 2) { const k = key2(T.px[i], T.pz[i]); (grid.get(k) || grid.set(k, []).get(k)).push(i); }
    const near = (x, z, R = 160) => { let best = R * R, bi = -1, low = 1e9; const cx = Math.floor(x / cell), cz = Math.floor(z / cell), m = Math.ceil(R / cell);
      for (let a = -m; a <= m; a++) for (let b = -m; b <= m; b++) for (const i of grid.get((cx + a) + ',' + (cz + b)) || []) { const d = (T.px[i] - x) ** 2 + (T.pz[i] - z) ** 2; if (d < best) { best = d; bi = i; } if (d < 625) low = Math.min(low, T.py[i]); }
      return bi < 0 ? null : { i: bi, d: Math.sqrt(best), y: Math.min(low, T.py[bi]) }; };
    // the ground: the map's heights, meeting the track's own along it
    const G = M.grid, lo = [Infinity, Infinity], hi = [-Infinity, -Infinity];
    for (let i = 0; i < n; i++) { lo[0] = Math.min(lo[0], T.px[i]); lo[1] = Math.min(lo[1], T.pz[i]); hi[0] = Math.max(hi[0], T.px[i]); hi[1] = Math.max(hi[1], T.pz[i]); }
    let avg = 0; for (let i = 0; i < n; i++) avg += T.py[i]; avg /= n;
    const X0 = G ? G.x0 : lo[0] - 700, Z0 = G ? G.z0 : lo[1] - 700, SX = G ? (G.nx - 1) * G.step : hi[0] - lo[0] + 1400, SZ = G ? (G.nz - 1) * G.step : hi[1] - lo[1] + 1400;
    // how far anywhere is from the track: a 20 m grid of distances (a chamfer pass out from the track's samples)
    const DC = 20, dnx = Math.ceil(SX / DC) + 1, dnz = Math.ceil(SZ / DC) + 1, D = new Float32Array(dnx * dnz).fill(1e6);
    for (let i = 0; i < n; i++) {
      const ci = Math.round((T.px[i] - X0) / DC), cj = Math.round((T.pz[i] - Z0) / DC);
      if (ci >= 0 && cj >= 0 && ci < dnx && cj < dnz) D[cj * dnx + ci] = Math.min(D[cj * dnx + ci], Math.hypot(X0 + ci * DC - T.px[i], Z0 + cj * DC - T.pz[i]));
    }
    for (const [j0, j1, dj, i0, i1, di] of [[0, dnz, 1, 0, dnx, 1], [dnz - 1, -1, -1, dnx - 1, -1, -1]])
      for (let j = j0; j !== j1; j += dj) for (let i = i0; i !== i1; i += di) {
        let v = D[j * dnx + i];
        for (const [a, b, c] of [[-di, 0, DC], [0, -dj, DC], [-di, -dj, DC * 1.414], [di, -dj, DC * 1.414]]) { const x = i + a, y = j + b; if (x >= 0 && y >= 0 && x < dnx && y < dnz) v = Math.min(v, D[y * dnx + x] + c); }
        D[j * dnx + i] = v;
      }
    const away = (x, z) => D[Math.min(dnz - 1, Math.max(0, Math.round((z - Z0) / DC))) * dnx + Math.min(dnx - 1, Math.max(0, Math.round((x - X0) / DC)))];
    const dem = (x, z) => {
      if (!G) return avg - 2;
      const fx = c01((x - G.x0) / SX) * (G.nx - 1), fz = c01((z - G.z0) / SZ) * (G.nz - 1), i = Math.min(G.nx - 2, Math.floor(fx)), j = Math.min(G.nz - 2, Math.floor(fz)), u = fx - i, v = fz - j, H = (a, b) => G.h[b * G.nx + a] / 10;
      return mix(mix(H(i, j), H(i + 1, j), u), mix(H(i, j + 1), H(i + 1, j + 1), u), v);
    };
    // (over 110 m from the track it's the map's own height: far off by the distance grid — which reads up to ~25 m long
    // there — the nearest-sample search, most of a circuit's building time, is skipped)
    const ground = (x, z) => { if (away(x, z) > 140) return dem(x, z); const q = near(x, z, 120); return q ? mix(q.y - .35, dem(x, z), ss(VERGE + 2, 110, q.d)) : dem(x, z); };
    const uvw = (x, z) => [(x - X0) / SX, 1 - (z - Z0) / SZ];
    // the floodlights, and the light they put on the ground (worked out once: it's what most of the track's lit by)
    const P0 = [];
    for (let i = 0, side = 1; i < n; i += Math.round(POLE / STEP), side = -side) {
      const o = side * Math.min(WALL + 5, T.lim[i] * .8), x = T.px[i] + T.nx[i] * o, z = T.pz[i] + T.nz[i] * o;
      P0.push({ i, side, p: new V(x, T.py[i] + 20, z), base: new V(x, T.py[i], z), aim: new V(T.px[i] - T.nx[i] * o * .25, T.py[i], T.pz[i] - T.nz[i] * o * .25) });
    }
    const pg = new Map(), pk = (x, z) => Math.floor(x / 100) + ',' + Math.floor(z / 100);
    for (const P of P0) { const k = pk(P.aim.x, P.aim.z); (pg.get(k) || pg.set(k, []).get(k)).push(P); }
    const pool = (x, z) => { let s = 0; const cx = Math.floor(x / 100), cz = Math.floor(z / 100); for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (const P of pg.get((cx + a) + ',' + (cz + b)) || []) s += Math.exp(-((P.aim.x - x) ** 2 + (P.aim.z - z) ** 2) / (2 * 26 * 26)); return s; };
    const litAt = (x, z, k = 1) => .12 + Math.min(1.6, pool(x, z)) * k;
    const lit = (base, k) => (i, o) => { const f = litAt(T.px[i] + T.nx[i] * o, T.pz[i] + T.nz[i] * o, k); return [base[0] * f, base[1] * f, base[2] * f]; };
    const corner = new Uint8Array(n); for (let i = 0; i < n; i++) if (Math.abs(T.k[i]) > 1 / 260) for (let j = -7; j <= 7; j++) corner[(i + j + n) % n] = 1;
    const add = (g, m) => { if (!g) return null; const o = new THREE.Mesh(g, m); W.add(o); return o; };
    const cover = coverTex(M, X0, Z0, SX, SZ), groundMat = groundM.clone(); groundMat.map = cover;
    groundMat.onBeforeCompile = sh => { // (the map's colours, with a fine texture repeating over them)
      sh.uniforms.detail = { value: detail };
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec2 vGround;').replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvGround = (modelMatrix * vec4(transformed, 1.)).xz;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform sampler2D detail; varying vec2 vGround;').replace('#include <map_fragment>', '#include <map_fragment>\ndiffuseColor.rgb *= .45 + 1.1 * texture2D(detail, vGround / 3.).r * texture2D(detail, vGround / 17. + .37).r;');
    };
    // the track, its kerbs, the verge beside it (the map's colours: the real grass, gravel or tarmac run-off)
    add(ribbon(T, HALF, -HALF, .04, .04, 6, null, lit([1, 1, 1], 1.4)), road);
    for (const s of [1, -1]) {
      add(ribbon(T, s > 0 ? KERB : -HALF, s > 0 ? HALF : -KERB, .07, .07, 3, corner, lit([1, 1, 1], 1.2)), kerbM);
      add(ribbon(T, s > 0 ? VERGE : -HALF, s > 0 ? HALF : -VERGE, s > 0 ? -.3 : 0, s > 0 ? 0 : -.3, 10, null, lit([1, 1, 1], 1.1), uvw), groundMat);
    }
    await breath();
    const terrain = new THREE.PlaneGeometry(SX, SZ, Math.round(SX / 12), Math.round(SZ / 12));
    terrain.rotateX(-Math.PI / 2); terrain.translate(X0 + SX / 2, 0, Z0 + SZ / 2);
    const tp = terrain.attributes.position, tc = new Float32Array(tp.count * 3), tu = terrain.attributes.uv;
    for (let v = 0; v < tp.count; v++) {
      const x = tp.getX(v), z = tp.getZ(v); tp.setY(v, ground(x, z) - .05);
      const f = litAt(x, z, .9); tc.set([f, f, f], v * 3); tu.setXY(v, ...uvw(x, z));
    }
    terrain.setAttribute('color', new THREE.BufferAttribute(tc, 3)); terrain.computeVertexNormals();
    add(terrain, groundMat);
    await breath();
    // the roads round it and the pit lane, on the ground
    for (const w of [...new Set((M.roads || []).map(r => r[0]))]) add(lineStrip(M.roads.filter(r => r[0] === w).map(r => r[1]), w, (x, z) => ground(x, z) + .06, (x, z) => { const f = litAt(x, z, .9); return [f, f, f]; }), street);
    // barriers: the map's, where it has them along the track; otherwise a wall each side
    const bars = (M.barriers || []).filter(b => { const p = b[1]; return p.length >= 4 && away(p[0], p[1]) < 45; });
    let barLen = 0; for (const [, p] of bars) for (let i = 2; i < p.length; i += 2) barLen += Math.hypot(p[i] - p[i - 2], p[i + 1] - p[i - 1]);
    const ownWalls = barLen < T.len * .8;
    const onGround = (x, z) => ground(x, z) + .02;
    add(lineWall(bars.filter(b => b[0] === 1).map(b => b[1]), 0, .75, onGround, 4), wallM);
    add(lineWall(bars.filter(b => b[0] === 2).map(b => b[1]), 0, 1.1, onGround, 4), concreteM);
    add(lineWall(bars.filter(b => b[0] === 4).map(b => b[1]), 0, .9, onGround, 4), tyreM);
    add(lineWall(bars.filter(b => b[0] === 3).map(b => b[1]), 0, 3.2, onGround, .35), fenceM); // (catch fencing)
    const lit2 = bars.filter(b => (b[0] === 1 || b[0] === 2) && away(b[1][0], b[1][1]) < 30); // (the barriers by the track: a light strip along their top, red and blue)
    for (const k of [0, 1]) add(lineWall(lit2.filter((_, i) => i % 2 === k).map(b => b[1]), 1.12, 1.26, onGround, 6), led[k]);
    if (ownWalls) for (const s of [1, -1]) {
      add(ribbon(T, s * WALL, s * WALL, 0, 1.05, 4, null), wallM);
      add(ribbon(T, s * (WALL - .02), s * (WALL - .02), 1.05, 1.2, 6, null), led[s > 0 ? 0 : 1]);
    }
    await breath();
    // the buildings, grandstands among them
    add(buildingGeo(M.buildings || [], ground, away, pool), houseM);
    await breath();
    // trees: the map's forests filled (near the track; further off the ground's colour and the dark do), its single trees
    const pine = mergeGeometries([cone(3.6, 4.2, 0, [.045, .08, .045]), cone(3.1, 4, 2.6, [.05, .088, .05]), cone(2.5, 3.8, 5, [.056, .095, .054]), cone(1.9, 3.4, 7.3, [.06, .1, .058]), cone(1.2, 3, 9.4, [.066, .108, .062]), trunk(.25, 2.5)]);
    const leafy = mergeGeometries([blob(2.9, 5.6, 0, [.065, .095, .045]), blob(2.2, 7.4, 1.4, [.072, .1, .05]), blob(2.1, 6.6, -1.6, [.06, .09, .045]), trunk(.3, 4)]);
    const spots = [];
    for (let i = 0; i < (M.trees || []).length; i += 2) spots.push([M.trees[i], M.trees[i + 1], 1]);
    for (const [cls, p] of M.areas || []) {
      if (cls !== 1) continue;
      let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9; for (let i = 0; i < p.length; i += 2) { x0 = Math.min(x0, p[i]); x1 = Math.max(x1, p[i]); z0 = Math.min(z0, p[i + 1]); z1 = Math.max(z1, p[i + 1]); }
      for (let k = 0, m = Math.min(4000, (x1 - x0) * (z1 - z0) / 85); k < m; k++) {
        const x = x0 + r() * (x1 - x0), z = z0 + r() * (z1 - z0), d = away(x, z);
        if (d > 26 && d < 420 && inPoly(p, x, z)) spots.push([x, z, r() < .7 ? 0 : 1]);
      }
    }
    const MAXT = 14000; if (spots.length > MAXT) spots.sort((a, b) => away(a[0], a[1]) - away(b[0], b[1])).length = MAXT;
    const m4 = new THREE.Matrix4(), q4 = new THREE.Quaternion(), tint = new THREE.Color();
    for (const [g, kind] of [[pine, 0], [leafy, 1]]) {
      const list = spots.filter(s => s[2] === kind); if (!list.length) continue;
      const im = new THREE.InstancedMesh(g, treeM, list.length);
      list.forEach(([x, z], t) => { const s = .75 + r() * .7, f = litAt(x, z, 2.2); im.setMatrixAt(t, m4.compose(new V(x, ground(x, z) - .2, z), q4.setFromAxisAngle(new V(0, 1, 0), r() * 6.3), new V(s, s * (.85 + r() * .4), s))); im.setColorAt(t, tint.setRGB(f * (.8 + r() * .4), f * (.8 + r() * .4), f)); });
      W.add(im);
    }
    await breath();
    // the floodlights: a pole, a lamp facing the track, a glow
    const poleG = new THREE.CylinderGeometry(.22, .32, 20, 8); poleG.translate(0, 10, 0);
    const P1 = new THREE.InstancedMesh(poleG, poleM, P0.length), P2 = new THREE.InstancedMesh(new THREE.BoxGeometry(3.4, 1.3, .35), headM, P0.length), dots = new Float32Array(P0.length * 3);
    P0.forEach((P, k) => {
      P1.setMatrixAt(k, m4.makeTranslation(P.base.x, P.base.y, P.base.z));
      const dir = P.aim.clone().sub(P.p).normalize();
      P2.setMatrixAt(k, m4.compose(P.p, q4.setFromUnitVectors(new V(0, 0, 1), dir), new V(1, 1, 1)));
      dots.set([P.p.x + dir.x * .4, P.p.y + dir.y * .4, P.p.z + dir.z * .4], k * 3);
    });
    W.add(P1, P2);
    const dg = new THREE.BufferGeometry(); dg.setAttribute('position', new THREE.BufferAttribute(dots, 3));
    W.add(new THREE.Points(dg, new THREE.PointsMaterial({ map: glow, size: 5, color: new THREE.Color().setRGB(2.2, 2.05, 1.8), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false })));
    // the main straight (the longest): the start line's gantry over it, two thirds along
    let best = [0, 0], run = 0;
    for (let j = 0; j < n * 2; j++) { if (Math.abs(T.k[j % n]) < 1 / 900) { if (++run > best[1]) best = [j - run + 1, run]; } else run = 0; }
    const g0 = best[0] % n, glen = Math.min(best[1], n);
    T.gantry = (g0 + Math.round(glen * .62)) % n;
    // the crowd: on the map's grandstands (their seats slope up away from the track), or a grandstand of ours along the
    // straight where the map has none by it; their phones' flashes go off on the beat
    const cp = [], cc = [], person = () => { const t = r(), b = .5 + r(); cc.push((.12 + t * .3) * b, (.1 + r() * .2) * b, (.12 + (1 - t) * .3) * b); };
    const stands = (M.buildings || []).filter(b => b[2] === 1 && away(b[1][0], b[1][1]) < 160);
    for (const [h, p] of stands) {
      let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9; for (let i = 0; i < p.length; i += 2) { x0 = Math.min(x0, p[i]); x1 = Math.max(x1, p[i]); z0 = Math.min(z0, p[i + 1]); z1 = Math.max(z1, p[i + 1]); }
      const ds = []; for (let i = 0; i < p.length; i += 2) ds.push(away(p[i], p[i + 1]));
      const dn = Math.min(...ds), df = Math.max(...ds), ys = []; for (let i = 0; i < p.length; i += 2) ys.push(ground(p[i], p[i + 1]));
      const base = Math.min(...ys) - .3, top = Math.max(...ys) + h;
      for (let k = 0, m = Math.min(2500, (x1 - x0) * (z1 - z0) / 1.6); k < m; k++) {
        const x = x0 + r() * (x1 - x0), z = z0 + r() * (z1 - z0); if (!inPoly(p, x, z)) continue;
        cp.push(x, base + 2 + (top - base - 2) * c01((away(x, z) - dn) / Math.max(1, df - dn)) + .45, z); person();
      }
    }
    const nearStand = stands.some(([, p]) => { const q = near(p[0], p[1], 200); return q && ((q.i - g0 + n) % n) < glen; });
    if (!nearStand) {
      const room = side => { let m = 1e9; for (let j = .15; j <= .85; j += .1) { const i = (g0 + Math.round(glen * j)) % n, q = near(T.px[i] + T.nx[i] * side * 46, T.pz[i] + T.nz[i] * side * 46); if (q && Math.abs(((q.i - i + n * 1.5) % n) - n / 2) > 30) m = Math.min(m, q.d); } return m; };
      const sd = room(1) >= room(-1) ? 1 : -1, sm = new Uint8Array(n), seat = [];
      for (let j = Math.round(glen * .18); j < glen * .82; j++) sm[(g0 + j) % n] = 1;
      for (let k = 0; k < 12; k++) {
        const o0 = 24 + k * 1.7, o1 = o0 + 1.7, y = 1 + k * .95;
        add(ribbon(T, sd > 0 ? o1 : -o0, sd > 0 ? o0 : -o1, y, y, 8, sm), standM); add(ribbon(T, sd * o0, sd * o0, y - .95, y, 8, sm), standM); seat.push([o0 + .5, y]);
      }
      add(ribbon(T, sd * 44.4, sd * 44.4, -1, 12.4, 8, sm), standM);
      add(ribbon(T, sd > 0 ? 46 : -22, sd > 0 ? 22 : -46, 17, 15.5, 8, sm), standM); // (its roof)
      add(ribbon(T, sd * 22.2, sd * 22.2, 15.2, 15.6, 8, sm), led[sd > 0 ? 0 : 1]); // (a light strip along the roof's edge)
      for (let i = 0; i < n; i++) if (sm[i]) for (const [o, y] of seat) for (let m = 0; m < 2; m++) {
        const off = sd * (o + r() * .9), along = (r() - .5) * STEP;
        cp.push(T.px[i] + T.nx[i] * off + T.tx[i] * along, T.py[i] + y + .45, T.pz[i] + T.nz[i] * off + T.tz[i] * along); person();
      }
    }
    let crowdNew = null;
    if (cp.length) {
      const crowdG = new THREE.BufferGeometry(); crowdG.setAttribute('position', new THREE.Float32BufferAttribute(cp, 3)); crowdG.setAttribute('color', new THREE.Float32BufferAttribute(cc, 3));
      crowdNew = new THREE.Points(crowdG, new THREE.PointsMaterial({ map: glow, size: .7, vertexColors: true, transparent: true, depthWrite: false }));
      crowdNew.userData.base = Float32Array.from(cc); W.add(crowdNew);
    }
    // the gantry: two posts, a beam with the five red lights (on one by one through a build, out as the chorus lands);
    // the start line and the grid's boxes painted behind it
    const gi = T.gantry, gantry = new THREE.Group(), startsNew = [];
    gantry.position.set(T.px[gi], T.py[gi], T.pz[gi]); gantry.rotation.y = Math.atan2(T.tx[gi], T.tz[gi]);
    for (const x of [-1, 1]) { const p = new THREE.Mesh(new THREE.BoxGeometry(.7, 8, .7), poleM); p.position.set(x * (HALF + 1.4), 4, 0); gantry.add(p); }
    const bar = new THREE.Mesh(new THREE.BoxGeometry(HALF * 2 + 3.5, 1.6, .9), standM); bar.position.y = 7.4; gantry.add(bar);
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(HALF * 2 + 3, 1.1), new THREE.MeshBasicMaterial({ map: signTex(), color: new THREE.Color().setRGB(2, 2, 2) }));
    sign.position.set(0, 7.4, -.47); sign.rotation.y = Math.PI; gantry.add(sign, sign.clone().translateZ(-.94).rotateY(Math.PI));
    const white = new THREE.MeshStandardMaterial({ color: new THREE.Color().setRGB(.8, .8, .8), roughness: .6, polygonOffset: true, polygonOffsetFactor: -3 });
    const lineM = new THREE.Mesh(new THREE.PlaneGeometry(HALF * 2, .5).rotateX(-Math.PI / 2), white); lineM.position.y = .06; gantry.add(lineM);
    for (let k = 0; k < 10; k++) { const box = new THREE.Mesh(new THREE.PlaneGeometry(2.4, .25).rotateX(-Math.PI / 2), white); box.position.set((k % 2 ? 1 : -1) * 2.6, .06, -8 - k * 8); gantry.add(box); }
    for (let k = 0; k < 5; k++) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color: new THREE.Color().setRGB(9, .25, .2), blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0 }));
      sp.position.set((k - 2) * 1.3, 8.6, -.5); sp.scale.setScalar(1.5); gantry.add(sp); startsNew.push(sp);
    }
    W.add(gantry);
    // in place of the last circuit
    if (world) { scene.remove(world); world.traverse(o => { o.geometry?.dispose(); if (o.material?.map === world.userData.cover) o.material.dispose(); }); world.userData.cover?.dispose(); }
    W.userData.cover = cover; world = W; scene.add(W);
    // where the buildings stand (a 6 m grid of their footprints): a camera by the track mustn't film one instead of the race
    const occ = new Set();
    for (const [, p] of M.buildings || []) {
      let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9; for (let i = 0; i < p.length; i += 2) { x0 = Math.min(x0, p[i]); x1 = Math.max(x1, p[i]); z0 = Math.min(z0, p[i + 1]); z1 = Math.max(z1, p[i + 1]); }
      const big = (x1 - x0) * (z1 - z0) > 4000; // (a small one: all its box; a big one: what's inside it)
      for (let x = Math.floor(x0 / 6); x <= Math.floor(x1 / 6); x++) for (let z = Math.floor(z0 / 6); z <= Math.floor(z1 / 6); z++) if (!big || inPoly(p, x * 6 + 3, z * 6 + 3)) occ.add(x + ',' + z);
    }
    T.blocked = (x, z) => occ.has(Math.floor(x / 6) + ',' + Math.floor(z / 6));
    T.ground = ground;
    S = T; trackKey = key; poles = P0; starts = startsNew; crowd = crowdNew;
    shot.at = -1e9; // (a new shot at once: the last one was set up on the old circuit)
    for (const c of cars) c.pace = paceOf(S, c.grip, c.power);
  }
  // trees' shapes (vertex colours: needles, leaves, bark)
  function cone(r, h, y, c) { const g = new THREE.ConeGeometry(r, h, 12, 2, true); const p = g.attributes.position; for (let i = 0; i < p.count; i++) { const rr = Math.hypot(p.getX(i), p.getZ(i)); p.setY(i, p.getY(i) - rr * .18 + Math.sin(Math.atan2(p.getZ(i), p.getX(i)) * 6) * .12 * rr); } g.computeVertexNormals(); g.translate(0, y + h / 2 + 1.5, 0); return paint(g, c); }
  function blob(r, y, x, c) { const g = new THREE.IcosahedronGeometry(r, 2); const p = g.attributes.position; for (let i = 0; i < p.count; i++) { const k = 1 + .14 * Math.sin(p.getX(i) * 2.1) * Math.cos(p.getZ(i) * 1.7 + p.getY(i)); p.setXYZ(i, p.getX(i) * k, p.getY(i) * k * .82, p.getZ(i) * k); } g.computeVertexNormals(); g.translate(x, y, x * .4); return paint(g, c); }
  function trunk(r, h) { const g = new THREE.CylinderGeometry(r * .7, r, h, 5); g.translate(0, h / 2, 0); return paint(g, [.05, .035, .025]); }
  function paint(g, c) { if (g.index) g = g.toNonIndexed(); const a = new Float32Array(g.attributes.position.count * 3); for (let i = 0; i < a.length; i += 3) a.set(c, i); g.setAttribute('color', new THREE.BufferAttribute(a, 3)); g.deleteAttribute('uv'); return g; }

  // the floodlights nearest the action really light it (the paint's highlights, the wet road's shine)
  const lamps = [];
  for (let k = 0; k < LIGHTS; k++) { const L = new THREE.PointLight(new THREE.Color().setRGB(1, .93, .82), 5200, 140, 2); scene.add(L); lamps.push(L); }
  const beam = new THREE.SpotLight(new THREE.Color().setRGB(.85, .92, 1), 2600, 150, .42, .55, 2); scene.add(beam, beam.target); // (the hero car's headlights)

  // ---- the cars: each model brought to its real length, facing forward, its paint given a clear coat, its own lamps
  // found (their glows put there; tail lights brighter as it brakes), its wheels turning — the front ones steering
  const CARS = await (await fetch('/race/cars.json')).json().catch(() => []);
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const errors = []; let got = 0; // (each car that didn't come, and why: for Settings › 3D race)
  const models = (await Promise.all(CARS.map(async cfg => {
    try { const root = (await loader.loadAsync('/race/cars/' + cfg.file)).scene; onCar(++got, CARS.length); return { cfg, root }; }
    catch (e) { const body = await e?.response?.text?.().catch(() => ''); errors.push(cfg.name + ': ' + (body || e?.message || e)); console.warn('race: no ' + cfg.file, e); }
  }))).filter(Boolean); // (in the list's order, whichever arrive)
  if (!models.length && test) models.push({ cfg: { len: 4.5, name: 'test' }, root: standIn() });
  const shadow = canvasTex(128, 128, (g, w) => { const r = g.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2); r.addColorStop(0, 'rgba(0,0,0,.85)'); r.addColorStop(.6, 'rgba(0,0,0,.5)'); r.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = r; g.fillRect(0, 0, w, w); }, false);
  const PAINTS = ['#b0101c', '#0c3f94', '#e6e6e6', '#121212', '#f06400', '#0d4f2e', '#e8b800'];
  const FRONT = /head|front.?l(igh)?t|drl|xenon|hd.?light|lightemissivewhite|emitter|lamp.?f|lgt_f/i, REAR = /tail|rear.?l(igh)?t|brake.?l|stop.?l|red.?l(igh)?t|glassred|emission.?red|lamp.?r|lgt_r/i, PAINT = /paint|carross|colou?red|livery|body_?paint|carpaint/i;
  const cars = [];
  for (let k = 0; models.length && k < PACK; k++) {
    const { cfg, root } = models[k % models.length], twin = k >= models.length, inner = new THREE.Group(), car = new THREE.Group();
    const model = twin ? root.clone() : root;
    inner.add(model);
    let b = new THREE.Box3().setFromObject(inner), s = b.getSize(new V());
    if (s.x > s.z) inner.rotation.y = Math.PI / 2;
    if (cfg.flip) inner.rotation.y += Math.PI;
    inner.updateMatrixWorld(true); b = new THREE.Box3().setFromObject(inner); s = b.getSize(new V());
    const sc = cfg.len / s.z; inner.scale.setScalar(sc);
    inner.position.set(-(b.min.x + b.max.x) / 2 * sc, -b.min.y * sc, -(b.min.z + b.max.z) / 2 * sc);
    const len = s.z * sc, wid = s.x * sc, hgt = s.y * sc;
    car.add(inner); car.updateMatrixWorld(true);
    const lampMeshes = { f: [], r: [] }, rearMats = new Set(), coat = new Map();
    inner.traverse(o => {
      if (!o.isMesh) return;
      const mats = [].concat(o.material).map(m => {
        const name = (m.name || '') + ' ' + o.name;
        if (m.transmission > 0 || /glass|window|windscreen/i.test(m.name || '') && m.opacity < 1) { m.transmission = 0; m.transparent = true; m.opacity = Math.min(m.opacity, .35); }
        if (FRONT.test(name) && !/int|interior/i.test(name)) lampMeshes.f.push(o);
        else if (REAR.test(name) && !/int|interior/i.test(name)) { lampMeshes.r.push(o); rearMats.add(m); }
        if (PAINT.test(m.name || '') && m.isMeshStandardMaterial) { // (a clear coat over the paint: the floodlights' highlights sharp on it; a second of a model in another colour)
          if (!coat.has(m)) {
            const p = m.isMeshPhysicalMaterial ? m.clone() : new THREE.MeshPhysicalMaterial({ color: m.color.clone(), map: m.map, normalMap: m.normalMap, metalnessMap: m.metalnessMap, roughnessMap: m.roughnessMap, metalness: Math.min(m.metalness, .7), roughness: Math.min(m.roughness, .4), clearcoat: 1, clearcoatRoughness: .04 });
            if (twin) { p.color.set(PAINTS[k % PAINTS.length]); p.map = null; }
            coat.set(m, p);
          }
          return coat.get(m);
        }
        return m;
      });
      o.material = Array.isArray(o.material) ? mats : mats[0];
      for (const m of [].concat(o.material)) if ('envMapIntensity' in m) { m.envMap = envMap; m.envMapIntensity = 1.2; }
    });
    for (const m of rearMats) { m.emissive?.setRGB(1, .05, .05); m.emissiveIntensity = 1.2; }
    // where its lamps are: the model's own, left and right (or, failing that, guessed from its size)
    const spots = (list, z) => {
      const L = [], R = [];
      for (const o of list) { const c = new THREE.Box3().setFromObject(o).getCenter(new V()); if (Math.abs(c.x) < wid * .65 && Math.sign(c.z) === Math.sign(z)) (c.x > 0 ? L : R).push(c); }
      const avg = a => a.reduce((s, p) => s.add(p), new V()).multiplyScalar(1 / a.length);
      return L.length && R.length ? [avg(L), avg(R)] : [new V(wid / 2 - .28, hgt * (z > 0 ? .45 : .55), z), new V(-(wid / 2 - .28), hgt * (z > 0 ? .45 : .55), z)];
    };
    // the wheels (named so, or drawn in a tyre's or a rim's material, and a wheel's size): each on a pivot at its middle
    const wheels = [];
    inner.traverse(o => {
      if (o === inner || wheels.some(w => isIn(o, w.o))) return;
      const named = /wheel|tyre|tire|rim/i.test(o.name) && !/steer|arch|well|cover|spare|controller/i.test(o.name), drawn = o.isMesh && [].concat(o.material).some(m => /tyre|tire|rim|wheel/i.test(m.name || '') && !/steer/i.test(m.name || ''));
      if (!named && !drawn) return;
      const size = new THREE.Box3().setFromObject(o).getSize(new V());
      const mid = new THREE.Box3().setFromObject(o).getCenter(new V());
      if (size.y > .25 && size.y < 1.2 && size.z < 1.2 && size.x < .8 && mid.y < .65 && Math.abs(mid.z) > len * .18) wheels.push({ o });
    });
    if (wheels.length < 4) inner.traverse(o => {
      if (!o.isMesh || wheels.some(w => w.o === o || isIn(o, w.o))) return;
      const bx = new THREE.Box3().setFromObject(o), sz = bx.getSize(new V()), mid = bx.getCenter(new V());
      if (sz.y > .45 && sz.y < .9 && Math.abs(sz.y - sz.z) < .1 && sz.x > .12 && sz.x < .45 && mid.y < .5 && Math.abs(mid.x) > wid * .28 && Math.abs(mid.z) > len * .2) wheels.push({ o });
    });
    for (const w of wheels) {
      const bx = new THREE.Box3().setFromObject(w.o), mid = bx.getCenter(new V()), parent = w.o.parent, pivot = new THREE.Group();
      parent.add(pivot); pivot.position.copy(parent.worldToLocal(mid.clone())); pivot.updateMatrixWorld(true); pivot.attach(w.o);
      const inv = parent.matrixWorld.clone().invert();
      Object.assign(w, { pivot, axis: new V(1, 0, 0).transformDirection(inv), up: new V(0, 1, 0).transformDirection(inv), front: mid.z > 0, r: Math.max(.2, bx.getSize(new V()).y / 2), a: 0 });
    }
    const sh = new THREE.Mesh(new THREE.PlaneGeometry(wid * 1.5, len * 1.25), new THREE.MeshBasicMaterial({ map: shadow, transparent: true, depthWrite: false }));
    sh.rotation.x = -Math.PI / 2; sh.position.y = .05; car.add(sh);
    const lights = [];
    for (const [front, list, c, sz] of [[true, lampMeshes.f, [3.2, 3.4, 3.8], .38], [false, lampMeshes.r, [4, .15, .18], .32]]) for (const p of spots(list, front ? len / 2 - .1 : -len / 2 + .05)) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color: new THREE.Color().setRGB(...c), blending: THREE.AdditiveBlending, depthWrite: false }));
      sp.position.copy(p).add(new V(0, 0, front ? .08 : -.06)); sp.scale.setScalar(sz); car.add(sp); lights.push({ sp, front, base: sp.material.color.clone() });
    }
    const flare = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color: new THREE.Color().setRGB(.5, 1.1, 2.2), blending: THREE.AdditiveBlending, depthWrite: false }));
    flare.position.copy(lights[0].sp.position).setX(0); flare.scale.set(6, .12, 1); car.add(flare); // (an anamorphic lens's streak)
    const pop = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color: new THREE.Color().setRGB(6, 2.6, .8), blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0 }));
    pop.position.set(0, .35, -len / 2 - .15); pop.scale.setScalar(.6); car.add(pop); // (a flame from the exhaust as it lifts off)
    scene.add(car);
    const r = rnd(k + 3);
    cars.push({ o: car, len, wid, hgt, lights, wheels, pop, rearMats: [...rearMats], name: cfg.name, power: cfg.perf ?? .97, grip: cfg.grip ?? .97, drift: cfg.style === 'drift',
      s: 0, v: 0, d: 0, a: 0, aS: 0, slip: 0, pass: 0, passing: null, steer: 0, lineK: .85 + r() * .2, trail: [[], []], pace: null, popAt: 0 });
  }

  // light trails behind the tail lights (a long exposure's), and their reflections in the wet road
  const TRAIL = 40, trailPos = new Float32Array(PACK * 2 * TRAIL * 2 * 3), trailCol = new Float32Array(trailPos.length), tIdx = [];
  for (let t = 0; t < PACK * 2; t++) for (let i = 0; i < TRAIL - 1; i++) { const a = (t * TRAIL + i) * 2; tIdx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  const trailG = new THREE.BufferGeometry(); trailG.setAttribute('position', new THREE.BufferAttribute(trailPos, 3)); trailG.setAttribute('color', new THREE.BufferAttribute(trailCol, 3)); trailG.setIndex(tIdx);
  const trails = new THREE.Mesh(trailG, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false }));
  trails.frustumCulled = false; scene.add(trails);
  const flat = new THREE.PlaneGeometry(1, 1); flat.rotateX(-Math.PI / 2); flat.translate(0, 0, .5);
  const wet = new THREE.InstancedMesh(flat, new THREE.MeshBasicMaterial({ map: streakTex(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, polygonOffset: true, polygonOffsetFactor: -4 }), PACK * 4);
  wet.frustumCulled = false; wet.setColorAt(0, new THREE.Color()); scene.add(wet); // (its colours there from the start: they change its shader, made before it's drawn — see warm)
  // sparks from under the car (its floor on the track over a crest, on the beat)
  const SPARKS = 500, spP = new Float32Array(SPARKS * 3), spV = new Float32Array(SPARKS * 3), spL = new Float32Array(SPARKS);
  const sparkG = new THREE.BufferGeometry(); sparkG.setAttribute('position', new THREE.BufferAttribute(spP, 3));
  const sparks = new THREE.Points(sparkG, new THREE.PointsMaterial({ map: glow, size: .22, color: new THREE.Color().setRGB(9, 3.6, .9), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  sparks.frustumCulled = false; scene.add(sparks); let spN = 0;
  // tyre smoke (a drifting car's): puffs growing and thinning as they drift off
  const PUFFS = 700, puP = new Float32Array(PUFFS * 3), puV = new Float32Array(PUFFS * 3), puAge = new Float32Array(PUFFS).fill(1);
  const puffG = new THREE.BufferGeometry(); puffG.setAttribute('position', new THREE.BufferAttribute(puP, 3)); puffG.setAttribute('age', new THREE.BufferAttribute(puAge, 1));
  const puffs = new THREE.Points(puffG, new THREE.ShaderMaterial({ transparent: true, depthWrite: false, uniforms: { map: { value: smokeTex() }, scale: { value: 400 } },
    vertexShader: 'attribute float age; varying float a; uniform float scale; void main() { vec4 mv = modelViewMatrix * vec4(position, 1.); gl_PointSize = (1. + age * 5.) * scale / -mv.z; a = (1. - age) * (1. - age) * .16; gl_Position = projectionMatrix * mv; }',
    fragmentShader: 'uniform sampler2D map; varying float a; void main() { gl_FragColor = vec4(vec3(.3, .31, .33), texture2D(map, gl_PointCoord).a * a); }' }));
  puffs.frustumCulled = false; scene.add(puffs); let puN = 0;

  // ---- the picture: bloom, then a lens (speed blur, colour fringes, vignette, grain), then ACES
  const rt = new THREE.WebGLRenderTarget(16, 16, { type: THREE.HalfFloatType, samples: 4 });
  const composer = new EffectComposer(renderer, rt);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(16, 16), .6, .3, 1.6); // (only lights glow: not the wet road's shine)
  bloom.radius = 0; bloom.compositeMaterial.uniforms.bloomFactors.value = [1, .55, .2, .06, .015]; // (a tight glow: the widest blurs had every floodlight fog the whole picture)
  composer.addPass(bloom);
  const lens = new ShaderPass({ uniforms: { tDiffuse: { value: null }, blur: { value: 0 }, ca: { value: .004 }, vig: { value: .55 }, time: { value: 0 }, grain: { value: .06 }, flash: { value: 0 } },
    vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }',
    fragmentShader: `uniform sampler2D tDiffuse; uniform float blur, ca, vig, time, grain, flash; varying vec2 vUv;
      float h(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
      void main() { vec2 c = vUv - .5; float r = length(c); vec3 col = texture2D(tDiffuse, vUv).rgb;
        if (blur > .001) { for (int i = 1; i < 10; i++) col += texture2D(tDiffuse, .5 + c * (1. - blur * r * float(i) / 9.)).rgb; col /= 10.; }
        float k = ca * r * r * 4.; col.r = mix(col.r, texture2D(tDiffuse, .5 + c * (1. + k)).r, .8); col.b = mix(col.b, texture2D(tDiffuse, .5 + c * (1. - k)).b, .8);
        col *= 1. - vig * smoothstep(.3, .95, r); col *= 1. + (h(vUv * 911. + time) - .5) * grain; gl_FragColor = vec4(col + flash, 1.); }` });
  composer.addPass(lens); composer.addPass(new OutputPass());

  // ---- the race: each car drives itself round at its own pace (a little quicker as the music's louder): off the
  // throttle behind a slower car in its line, in its slipstream on the straights, and past it on the other side when
  // it's quicker; the field kept together (the back markers a touch quicker, the leaders a touch slower)
  let startN = 0, clock = 0, ts = 1, slowUntil = 0, last = 0, w = 0, h = 0, scale = 1, ema = 1 / 60, emaAt = 0;
  const at = (s, k) => { const n = S.n, f = ((s / STEP) % n + n) % n, i = Math.floor(f), j = (i + 1) % n, t = f - i; return S[k][i] + (S[k][j] - S[k][i]) * t; };
  const paceAt = (c, s) => { const n = S.n, f = ((s / STEP) % n + n) % n, i = Math.floor(f), t = f - i; return c.pace[i] + (c.pace[(i + 1) % n] - c.pace[i]) * t; };
  const corner = s => Math.abs(at(s, 'k')) > 1 / 260;
  const posAt = (s, d, out) => out.set(at(s, 'px') + at(s, 'nx') * d, at(s, 'py'), at(s, 'pz') + at(s, 'nz') * d);
  const qa = new THREE.Quaternion(), qb = new THREE.Quaternion();
  function place(s0) { // (the field lined up two by two, rolling)
    cars.forEach((c, i) => { c.s = s0 - i * 24; c.v = paceAt(c, c.s) * .9; c.d = i % 2 ? -2.6 : 2.6; c.pass = 0; c.passing = null; c.slip = 0; c.trail = [[], []]; });
  }
  function drive(dt, energy, now) {
    if (!dt) return;
    const order = cars.map(c => c.s).sort((a, b) => a - b), median = order[order.length >> 1], mf = .86 + energy * .2;
    for (const c of cars) {
      let target = paceAt(c, c.s) * mf * (1 + Math.max(-.03, Math.min(.03, (median - c.s) / 600)));
      let ahead = null, gap = 1e9; for (const o of cars) { const g = o.s - c.s; if (o !== c && g > 0 && g < gap) { gap = g; ahead = o; } }
      const straight = Math.abs(at(c.s, 'k')) < 1 / 500;
      if (ahead && gap < 45) {
        if (straight && gap > 5 && gap < 35 && Math.abs(ahead.d - c.d) < 2) target *= 1.04; // (its slipstream)
        if (!c.passing && gap < 22 && target > ahead.v * 1.025 + .5 && now - (c.passedAt || 0) > 3000) { c.passing = ahead; c.pass = ahead.d > at(c.s, 'line') ? -1 : 1; } // (out of its wake, the other side)
        if (Math.abs(ahead.d - c.d) < (c.wid + ahead.wid) / 2 + .5 && gap < (c.len + ahead.len) / 2 + 6) target = Math.min(target, ahead.v - .5); // (no room: off the throttle)
      }
      if (c.passing && (c.s > c.passing.s + c.passing.len + 3 || c.passing.s - c.s > 45)) { c.passing = null; c.pass = 0; c.passedAt = now; } // (past it, or it got away)
      const dv = target > c.v ? Math.min(target - c.v, (8.5 * c.power * (1 - c.v / 105) + 1.5) * dt) : -Math.min(c.v - target, 27 * c.grip * dt);
      c.v = Math.max(0, c.v + dv); c.s += c.v * dt; c.a = dv / dt; c.aS += (c.a - c.aS) * c01(dt * 5);
      // across the road: the racing line (each a little their own), or beside the car being passed
      const lim = HALF - c.wid / 2 - .35, want = c.passing ? c.passing.d + c.pass * ((c.wid + c.passing.wid) / 2 + 1) : at(c.s, 'line') * c.lineK;
      const d0 = c.d; c.d += Math.max(-2.8 * dt, Math.min(2.8 * dt, Math.max(-lim, Math.min(lim, want)) - c.d));
      for (const o of cars) if (o !== c && Math.abs(o.s - c.s) < (c.len + o.len) / 2 + .6 && Math.abs(o.d - c.d) < (c.wid + o.wid) / 2 + .3) c.d += Math.sign(c.d - o.d || 1) * 1.5 * dt; // (never through each other)
      c.d = Math.max(-lim, Math.min(lim, c.d));
      // how it sits: nose down braking, squatting under power, leaning out in a corner, the tail out (a drift car's far)
      const k = at(c.s, 'k'), lat = c.v * c.v * k, tx = at(c.s, 'tx'), tz = at(c.s, 'tz');
      const slipTo = c.drift ? Math.max(-.55, Math.min(.55, lat * .02)) : Math.max(-.06, Math.min(.06, lat * .0022));
      c.slip += (slipTo - c.slip) * c01(dt * (c.drift ? 2.5 : 4));
      posAt(c.s, c.d, c.o.position);
      if (Math.abs(c.d) > HALF - c.wid / 2 - .25 && corner(c.s)) c.o.position.y += Math.sin(c.s * 9) * .018; // (over a kerb: a rattle)
      c.o.rotation.set(-Math.atan(at(c.s, 'slope')) - c.aS * .0011, Math.atan2(tx, tz) + Math.atan((c.d - d0) / Math.max(c.v * dt, .01)) * .6 + c.slip, Math.max(-.05, Math.min(.05, lat * .0013)), 'YXZ');
      c.steer += (Math.max(-.55, Math.min(.55, Math.atan(2.7 * k) - c.slip * (c.drift ? 1.1 : .6))) - c.steer) * c01(dt * 8); // (into the corner; against a slide)
      for (const w of c.wheels) {
        w.a = (w.a + c.v * dt / w.r) % (Math.PI * 2); qb.setFromAxisAngle(w.axis, w.a);
        if (w.front) w.pivot.quaternion.multiplyQuaternions(qa.setFromAxisAngle(w.up, c.steer), qb); else w.pivot.quaternion.copy(qb);
      }
      // brake lights; a pop from the exhaust as it lifts
      const braking = c.aS < -6;
      for (const L of c.lights) if (!L.front) L.sp.material.color.copy(L.base).multiplyScalar(braking ? 2.4 : 1);
      for (const m of c.rearMats) m.emissiveIntensity = braking ? 4 : 1.2;
      if (c.a < -12 && c.aS > -4 && now - c.popAt > 400 && Math.random() < .5) c.popAt = now;
      c.pop.material.opacity = now - c.popAt < 70 ? 1 : 0;
      if (c.drift && Math.abs(c.slip) > .16 && c.v > 10) smoke(c, dt);
    }
  }
  function smoke(c, dt) {
    f.set(0, 0, 1).applyEuler(c.o.rotation); l.set(1, 0, 0).applyEuler(c.o.rotation);
    for (const side of [-1, 1]) for (let j = 0; j < Math.ceil(60 * dt); j++) {
      const i = puN++ % PUFFS;
      tmp.copy(c.o.position).addScaledVector(f, -c.len * .32).addScaledVector(l, side * c.wid * .42); tmp.y += .3;
      puP.set([tmp.x, tmp.y, tmp.z], i * 3); puV.set([(Math.random() - .5) * 2 + l.x * side * 1.5, .6 + Math.random(), (Math.random() - .5) * 2 + l.z * side * 1.5], i * 3); puAge[i] = 0;
    }
  }
  function puffsMove(dt) {
    for (let i = 0; i < PUFFS; i++) { if (puAge[i] >= 1) continue; puAge[i] = Math.min(1, puAge[i] + dt / 2.2); for (let a = 0; a < 3; a++) puP[i * 3 + a] += puV[i * 3 + a] * dt; }
    puffG.attributes.position.needsUpdate = puffG.attributes.age.needsUpdate = true;
  }

  // ---- the film: shots of one car (the hero), cut on the beat; as in the footage, quick cuts in a chorus, long ones in
  // a verse and a break
  const SHOTS = { drop: ['low', 'flyby', 'wheel', 'front', 'orbit', 'chase', 'roof', 'low'], build: ['chase', 'trackside', 'heli', 'front', 'wheel', 'roof'],
    flow: ['chase', 'heli', 'trackside', 'top', 'orbit', 'chase', 'roof'], break: ['heli', 'top', 'orbit', 'trackside'] };
  const shot = { type: 'chase', at: 0, beats: 8, hero: 0, side: 1, seed: 0, fix: new V(), fov: 55, n: 0 };
  const beatS = { onsets: [], beat: .5, kPrev: 0, kind: 'flow' };
  const tmp = new V(), look = new V(), camPos = new V(), f = new V(), l = new V(), u = new V(0, 1, 0), dirV = new V(), sideV = new V(), toCam = new V(), gone = new V(0, -999, 0);
  function cut(now, kind, into) {
    const r = Math.random, list = SHOTS[kind] || SHOTS.flow;
    let type; do type = list[Math.floor(r() * list.length)]; while (type === shot.type && r() < .8);
    if (into) type = 'gantry';
    if (shot.want) type = shot.want; // (tests: see shoot)
    let hero = cars.length > 1 && r() < .55 ? (shot.hero + 1 + Math.floor(r() * (cars.length - 1))) % cars.length : shot.hero;
    if (type === 'front') hero = cars.reduce((b, c, i) => c.s > cars[b].s ? i : b, 0); // (the leader: nobody ahead for the camera to be in)
    if (/orbit|wheel|low|roof/.test(type)) { const room = c => Math.min(...cars.filter(o => o !== c).map(o => Math.hypot(o.s - c.s, (o.d - c.d) * 2))); const best = cars.reduce((b, c) => room(c) > room(b) ? c : b); if (room(cars[hero]) < 14) hero = cars.indexOf(best); } // (a car with room round it: the camera in no one else)
    if (shot.wantHero != null) hero = shot.wantHero % cars.length; // (tests)
    Object.assign(shot, { type, at: now, hero, side: r() < .5 ? -1 : 1, seed: r(), n: shot.n + 1,
      beats: kind === 'drop' ? (r() < .6 ? 2 : 4) : kind === 'build' ? 4 : kind === 'break' ? 16 : (r() < .6 ? 8 : 16) });
    const c = cars[hero];
    if (type === 'gantry') { // (the chorus lands: the field put just short of the start line, the lights going out)
      const target = S.gantry * STEP - 28;
      place(target + cars.indexOf(c) * 24); shot.beats = 4;
      posAt(target + 54, shot.side * (HALF - 1.6), shot.fix); shot.fix.y += 1.1;
    }
    if (type === 'trackside' || type === 'flyby') { // (a camera by the track, ahead: the car comes to it and past)
      const ahead = type === 'flyby' ? 60 + r() * 30 : Math.min(260, 70 + c.v * shot.beats * beatS.beat * .55), s = c.s + ahead;
      // its side, distance out and height: the first where nothing built, and no hill, stands between it and the car
      let top = -1e9; for (let d = 0; d < ahead; d += STEP) top = Math.max(top, at(c.s + d, 'py')); // (over any crest between)
      const from = new V(), clear = () => {
        posAt(c.s, c.d, from); from.y += 1;
        for (let k = 1; k <= 24; k++) { tmp.lerpVectors(from, shot.fix, k / 24); if (S.blocked(tmp.x, tmp.z) || S.ground(tmp.x, tmp.z) > tmp.y - .3) return false; }
        return true;
      };
      let ok = false;
      for (const side of [shot.side, -shot.side]) for (const out of type === 'flyby' ? [8.8] : [15 + r() * 6, 11]) for (const lift of type === 'flyby' ? [.7, 2] : [2.5 + r() * 5, 9]) {
        if (ok) break;
        posAt(s, side * Math.min(WALL - 1, out), shot.fix);
        shot.fix.y = Math.max(shot.fix.y + lift, top + (type === 'flyby' ? .7 : 3), S.ground(shot.fix.x, shot.fix.z) + 1.6);
        if (clear()) { ok = true; shot.side = side; }
      }
      if (!ok) { shot.type = 'chase'; shot.snap = true; return; } // (hemmed in both sides: a chase shot instead)
    }
    shot.snap = true;
  }
  function film(dt, now, kick, punch) {
    const c = cars[shot.hero], p = c.o.position, e = (now - shot.at) / 1000;
    f.set(0, 0, 1).applyEuler(c.o.rotation); l.set(1, 0, 0).applyEuler(c.o.rotation);
    let fov = 55, lag = 0, sh = .02;
    camera.up.set(0, 1, 0);
    switch (shot.type) {
      case 'chase': camPos.copy(p).addScaledVector(f, -c.len / 2 - 3.4 - c.v * .012).addScaledVector(u, 1.9).addScaledVector(l, shot.side * .5); look.copy(p).addScaledVector(f, 7).addScaledVector(u, .8); fov = 54 + c.v * .08; lag = 30; break;
      case 'roof': camPos.copy(p).addScaledVector(f, -c.len * .05).addScaledVector(u, c.hgt + .22); look.copy(p).addScaledVector(f, 40).addScaledVector(u, c.hgt * .5); fov = 72; sh = .035; break; // (onboard, over the roof: the race ahead)
      case 'low': camPos.copy(p).addScaledVector(f, -c.len / 2 - 2.4).addScaledVector(u, .42).addScaledVector(l, shot.side * .8); look.copy(p).addScaledVector(f, 12).addScaledVector(u, .5); fov = 74; sh = .05; break;
      case 'wheel': camPos.copy(p).addScaledVector(l, shot.side * (c.wid / 2 + .38)).addScaledVector(f, -c.len * .28).addScaledVector(u, .42); look.copy(p).addScaledVector(f, 30).addScaledVector(l, shot.side * .9).addScaledVector(u, .3); fov = 86; sh = .06; break;
      case 'front': camPos.copy(p).addScaledVector(f, c.len / 2 + 6 + Math.sin(e * .7) * 1.5).addScaledVector(u, 1).addScaledVector(l, shot.side * 1.3); look.copy(p).addScaledVector(u, .6); fov = 46; lag = 9; break;
      case 'orbit': { const a = shot.seed * 6.28 + e * .38 * shot.side; camPos.copy(p).addScaledVector(f, Math.cos(a) * 6.4).addScaledVector(l, Math.sin(a) * 6.4).addScaledVector(u, 1.3); look.copy(p).addScaledVector(u, .55); fov = 40; break; }
      case 'trackside': case 'flyby': { camPos.copy(shot.fix); look.copy(p).addScaledVector(u, .6); const d = camPos.distanceTo(look); fov = shot.type === 'flyby' ? 66 : Math.max(9, Math.min(48, 2 * Math.atan(7 / d) * 57.3)); sh = .01; break; }
      case 'gantry': camPos.copy(shot.fix); look.copy(p).addScaledVector(u, 1.6); fov = 54; sh = .01; break; // (the gantry behind the car as it comes; then a whip round after it)
      case 'heli': camPos.copy(p).addScaledVector(f, -42).addScaledVector(l, shot.side * 34).addScaledVector(u, 36); look.copy(p).addScaledVector(f, 18); fov = 32; lag = 2.5; break;
      case 'top': camPos.copy(p).addScaledVector(u, 52).addScaledVector(f, -8); look.copy(p).addScaledVector(f, 14); camera.up.copy(f); fov = 42; lag = 3; break;
    }
    const jx = Math.sin(now * .031) * Math.cos(now * .017), jy = Math.sin(now * .027 + 1) * Math.cos(now * .013);
    camPos.addScaledVector(l, jx * sh * (1 + kick * 4)).addScaledVector(u, jy * sh * (1 + kick * 4));
    if (shot.snap || !lag) camera.position.copy(camPos); else camera.position.lerp(camPos, c01(dt * lag));
    if (lag !== 2.5 && lag !== 3 && !/trackside|flyby|gantry/.test(shot.type)) camera.position.y = Math.max(camera.position.y, at(c.s, 'py') + .25); // (on the car: never under the road)
    camera.lookAt(look);
    shot.fov = shot.snap ? fov : mix(shot.fov, fov, c01(dt * 4)); shot.snap = false;
    camera.fov = shot.fov * (1 - punch * .06) + kick * 1.5; camera.updateProjectionMatrix();
  }

  // the floodlights that light the hero car, its headlights' beam, the trails and the reflections
  function lights(kick) {
    const c = cars[shot.hero], i = Math.floor(((c.s / STEP) % S.n + S.n) % S.n);
    const near = poles.map(P => ({ P, d: Math.abs(((P.i - i + S.n * 1.5) % S.n) - S.n / 2) })).sort((a, b) => a.d - b.d).slice(0, LIGHTS);
    near.forEach(({ P }, k) => lamps[k].position.copy(P.p));
    f.set(0, 0, 1).applyEuler(c.o.rotation);
    beam.position.copy(c.o.position).addScaledVector(f, c.len / 2).add(tmp.set(0, c.hgt * .45, 0));
    beam.target.position.copy(c.o.position).addScaledVector(f, 30);
    for (const m of led) { m.color.copy(m === led[0] ? A : B).multiplyScalar(2.2 + kick * 6); m.map.offset.y -= .02 + kick * .05; }
    let wi = 0; const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), col = new THREE.Color();
    for (const car of cars) {
      car.o.updateMatrixWorld();
      let ti = 0;
      for (const L of car.lights) {
        L.sp.getWorldPosition(tmp);
        L.sp.material.opacity = c01((tmp.distanceTo(camera.position) - 1.2) / 4); // (a glow right by the lens would white the picture out)
        if (!L.front && ti < 2) { const tr = car.trail[ti++]; tr.unshift(tmp.clone()); if (tr.length > TRAIL || tr.length > 2 && tr[0].distanceTo(tr[tr.length - 1]) > 22) tr.pop(); } // (a few car lengths, however fast)
        if (wi >= PACK * 4) continue;
        // its reflection: down on the road, stretched towards the camera
        const gy = car.o.position.y + .06, dx = camera.position.x - tmp.x, dz = camera.position.z - tmp.z, yaw = Math.atan2(dx, dz), near = Math.hypot(dx, dz) * .45; // (never reaching under the camera)
        m4.compose(tmp.set(tmp.x, gy, tmp.z), q.setFromAxisAngle(u, yaw), new V(L.front ? .9 : .7, 1, Math.min(L.front ? 9 : 6.5, near)));
        wet.setMatrixAt(wi, m4); wet.setColorAt(wi++, L.front ? col.setRGB(.9, 1, 1.2) : col.setRGB(1.4, .08, .1));
      }
    }
    wet.count = wi; wet.instanceMatrix.needsUpdate = true; if (wet.instanceColor) wet.instanceColor.needsUpdate = true;
    // trails: a ribbon facing the camera through each tail light's last positions, fading
    let o = 0;
    for (let t = 0; t < PACK * 2; t++) {
      const tr = cars[t >> 1]?.trail[t & 1] || [];
      for (let i = 0; i < TRAIL; i++) {
        const p = tr[Math.min(i, tr.length - 1)] || gone, q2 = tr[Math.min(i + 1, tr.length - 1)] || p;
        const side = sideV.crossVectors(dirV.copy(q2).sub(p), toCam.copy(camera.position).sub(p)).normalize().multiplyScalar(.09 * (1 - i / TRAIL));
        const a = (1 - i / TRAIL) ** 1.5 * (i < tr.length - 1 ? 1 : 0) * 3.2 * c01((p.distanceTo(camera.position) - 2.5) / 12); // (faded close to the camera)
        trailPos.set([p.x + side.x, p.y + side.y, p.z + side.z, p.x - side.x, p.y - side.y, p.z - side.z], o * 3);
        trailCol.set([a, a * .05, a * .07, a, a * .05, a * .07], o * 3); o += 2;
      }
    }
    trailG.attributes.position.needsUpdate = trailG.attributes.color.needsUpdate = true;
  }
  function spark(c, k) {
    f.set(0, 0, 1).applyEuler(c.o.rotation); l.set(1, 0, 0).applyEuler(c.o.rotation);
    for (let j = 0; j < k; j++) {
      const i = spN++ % SPARKS, back = Math.random() - .5, sp = c.v * (.55 + Math.random() * .3);
      tmp.copy(c.o.position).addScaledVector(f, -c.len * .3).addScaledVector(l, back * c.wid * .8);
      spP.set([tmp.x, tmp.y + .05, tmp.z], i * 3);
      spV.set([f.x * sp + (Math.random() - .5) * 6 + l.x * back * 5, 1 + Math.random() * 3.5, f.z * sp + (Math.random() - .5) * 6 + l.z * back * 5], i * 3);
      spL[i] = .3 + Math.random() * .5;
    }
  }
  function sparksMove(dt) {
    for (let i = 0; i < SPARKS; i++) {
      if (spL[i] <= 0) { spP[i * 3 + 1] = -9999; continue; }
      spL[i] -= dt; spV[i * 3 + 1] -= 9.8 * dt;
      for (let a = 0; a < 3; a++) spP[i * 3 + a] += spV[i * 3 + a] * dt;
    }
    sparkG.attributes.position.needsUpdate = true;
  }

  function resize(W, H) {
    w = W; h = H; const pr = Math.min(devicePixelRatio || 1, 1.5) * scale;
    renderer.setPixelRatio(pr); renderer.setSize(W, H, false); composer.setPixelRatio(pr); composer.setSize(W, H);
    camera.aspect = W / H; camera.updateProjectionMatrix(); puffs.material.uniforms.scale.value = H * pr * .55;
  }
  // a song: its circuit (the same each time it plays), the field somewhere round it
  function song(key) {
    let hsh = 0; for (const ch of String(key)) hsh = (hsh * 31 + ch.charCodeAt(0)) >>> 0;
    const want = KEYS[hsh % KEYS.length];
    building = (want !== trackKey ? build(want) : Promise.resolve()).then(warm).then(() => { place((hsh % 997) / 997 * S.len); clock = 0; });
    return { name: TRACKS[want].name, country: TRACKS[want].country, len: TRACKS[want].len };
  }
  // A circuit's shaders compiled before its first frame, alongside the page (KHR_parallel_shader_compile): drawn at once,
  // they were compiled there and then, the page frozen for seconds (3.4 s measured, choosing Redline on Extreme+). Compiled
  // as the composer's first pass draws them — into its own picture, so no tone mapping — or they'd be made again then.
  // (a few at a time, a breath between: handing the graphics chip every shader at once was itself a third of a second)
  let warming = false;
  async function warm() {
    warming = true;
    try {
      const one = new Map(); // (one thing of each kind: its material, and what changes its shader — instanced, coloured, points)
      scene.traverse(o => { if (o.material) one.set([].concat(o.material).map(m => m.uuid).join() + (o.isInstancedMesh ? 'i' + !!o.instanceColor : '') + (o.isPoints ? 'p' : ''), o); }); // (a car's parts: several materials each)
      const all = [...one.values()], waits = [];
      for (let i = 0; i < all.length; i += 4) {
        renderer.setRenderTarget(composer.readBuffer);
        for (const o of all.slice(i, i + 4)) waits.push(renderer.compileAsync(o, camera, scene));
        renderer.setRenderTarget(null);
        await new Promise(r => setTimeout(r, 0));
      }
      await Promise.all(waits);
    } finally { warming = false; }
  }
  // every frame (show: on screen; otherwise the race goes on unseen, the beat still followed)
  function frame(now, { show = true, kick = 0, energy = .5, playing = true, kind = 'flow' } = {}) {
    let dt = Math.min(.05, last ? (now - last) / 1000 : 0); last = now;
    let onset = false;
    if (kick > .5 && beatS.kPrev <= .5 && now - (beatS.onsets[beatS.onsets.length - 1] || 0) > 200) { beatS.onsets.push(now); if (beatS.onsets.length > 16) beatS.onsets.shift(); onset = true; }
    beatS.kPrev = kick;
    const gaps = beatS.onsets.slice(1).map((x, i) => { let g = (x - beatS.onsets[i]) / 1000; while (g > .9) g /= 2; while (g < .33) g *= 2; return g; }).sort((a, b) => a - b);
    if (gaps.length >= 4) beatS.beat += (gaps[gaps.length >> 1] - beatS.beat) * .1;
    const into = kind === 'drop' && beatS.kind !== 'drop'; beatS.kind = kind;
    if (!cars.length || !S || !cars[0].pace || warming) return { onset };
    // slow motion: as a chorus lands, and now and then on its beat
    if (into || (kind === 'drop' && onset && Math.random() < .08)) slowUntil = now + (into ? 1600 : 800);
    ts = mix(ts, !playing ? .06 : now < slowUntil ? .22 : 1, c01(dt * (now < slowUntil ? 12 : 3)));
    const sdt = dt * ts; clock += sdt;
    drive(sdt, energy, now);
    if (!show) return { onset };
    const e = (now - shot.at) / 1000;
    if (into || shot.n === 0 || (onset && e > shot.beats * beatS.beat * .8) || e > shot.beats * beatS.beat * 1.6) cut(now, kind, into && shot.n > 0);
    const punch = 1 - c01((now - shot.at) / 300);
    // the start lights: one more on each beat of a build; out as anything else begins
    if (kind === 'build') { if (onset && startN < 5) startN++; } else startN = 0;
    starts.forEach((sp, k) => { sp.material.opacity = k < startN ? 1 : 0; });
    if (crowd) { // (the crowd's flashes: on the beat, and now and then)
      const col = crowd.geometry.attributes.color, a = col.array, b = crowd.userData.base;
      for (let i = 0; i < a.length; i++) a[i] += (b[i] - a[i]) * .2;
      for (let k = onset ? 70 : Math.random() < .4 ? 2 : 0; k > 0; k--) { const i = Math.floor(Math.random() * b.length / 3) * 3; a[i] = a[i + 1] = a[i + 2] = 7; }
      col.needsUpdate = true;
    }
    if (onset && kind === 'drop' && playing) spark(cars[shot.hero], 40);
    sparksMove(sdt); puffsMove(sdt);
    film(dt, now, kick, kind === 'drop' ? punch : 0);
    lights(kick);
    sky.position.copy(camera.position);
    bloom.strength = .5 + kick * .45 + (kind === 'drop' ? .2 : 0);
    const u0 = lens.uniforms;
    u0.blur.value = (kind === 'drop' ? .05 + kick * .06 : .015) * c01(cars[shot.hero].v / 60) * (ts > .5 ? 1 : .2) + (shot.type === 'wheel' || shot.type === 'low' ? .03 : 0);
    u0.ca.value = .003 + kick * .006 + punch * (kind === 'drop' ? .01 : 0); u0.time.value = now % 1000; u0.flash.value = into ? .25 : u0.flash.value * .85;
    composer.render(dt);
    // the picture's size: smaller while frames come too slowly, back up when there's room
    ema += (dt - ema) * .05;
    if (now - emaAt > 2000) { emaAt = now; const s0 = scale; if (ema > 1 / 48 && scale > .55) scale -= .1; else if (ema < 1 / 70 && scale < 1) scale = Math.min(1, scale + .05); if (s0 !== scale) resize(w, h); }
    return { onset, kmh: Math.round(cars[shot.hero].v * 3.6) };
  }
  // (tests: a shot, a car to film, a circuit)
  const shoot = (type, key, hero) => { shot.want = type; shot.wantHero = hero; if (type) shot.at = -1e9; if (key && key !== trackKey) building = build(key).then(() => place(S.len * .3)); return building; };
  const probe = () => ({ scene, bloom, lens, beam, lamps, type: shot.type, cam: camera.position.toArray(), fov: camera.fov, hero: cars[shot.hero]?.o.position.toArray(), v: cars[shot.hero]?.v, ts, scale,
    field: cars.map(c => ({ name: c.name, s: Math.round(c.s), kmh: Math.round(c.v * 3.6), d: +c.d.toFixed(1), passing: !!c.passing, slip: +c.slip.toFixed(2), wheels: c.wheels.length, lamps: c.lights.length })) });
  return { frame, song, resize, shoot, probe, ready: cars.length > 0, cars: cars.map(c => c.name), tracks: KEYS, errors };
}

const isIn = (o, a) => { for (let p = o.parent; p; p = p.parent) if (p === a) return true; return false; };
// (tests only, before any car's downloaded: a box with wheels)
function standIn() {
  const g = new THREE.Group(), paint = new THREE.MeshStandardMaterial({ color: 0xb01020, metalness: .6, roughness: .25 }), tyre = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: .8 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(1.9, .7, 4.5), paint); body.position.y = .6; g.add(body);
  const cab = new THREE.Mesh(new THREE.BoxGeometry(1.6, .5, 2), paint); cab.position.set(0, 1.15, -.3); g.add(cab);
  for (const [x, z] of [[-.9, 1.4], [.9, 1.4], [-.9, -1.4], [.9, -1.4]]) { const w = new THREE.Mesh(new THREE.CylinderGeometry(.34, .34, .28, 20), tyre); w.name = 'wheel'; w.rotation.z = Math.PI / 2; w.position.set(x, .34, z); g.add(w); }
  return g;
}
