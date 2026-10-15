// NetherFlow - Copyright (C) 2026 Volodya.rua - GNU GPL v3 only, with additional terms (credit, name and logo): see LICENSE and NOTICE.
// Builds race/tracks.json, the circuits Redline's 3D races are driven on (desktop, Extreme+), from real map data:
//  - the layout: each circuit's relation (type=circuit) in OpenStreetMap, © OpenStreetMap contributors, ODbL 1.0
//  - the heights: NASA's SRTM (30 m, public domain) through OpenTopoData's API
//  - what's round it (race/maps/): buildings, forests, barriers, roads… also OpenStreetMap's
// The loop is the one through the relation's ways (pit lanes left out) closest to the real lap length.
// Run: node tools/race-tracks.js   (tracks.json is ODbL, as a database derived from OpenStreetMap)
const fs = require('fs'), path = require('path');
const CIRCUITS = { // OSM relation, lap in metres, and its name and country as shown
  spa: [284560, 7004, 'Spa-Francorchamps', 'Belgium'],
  monza: [284565, 5793, 'Monza', 'Italy'],
  suzuka: [284570, 5807, 'Suzuka', 'Japan'],
  interlagos: [6781071, 4309, 'Interlagos', 'Brazil'],
  nurburgring: [38567, 5148, 'Nürburgring', 'Germany'],
  zandvoort: [13545573, 4259, 'Zandvoort', 'Netherlands'],
  imola: [9291096, 4909, 'Imola', 'Italy'],
  redbullring: [5309181, 4318, 'Red Bull Ring', 'Austria'],
};
const UA = { 'User-Agent': 'NetherFlow track builder (github.com/volodya-rua/NetherFlow)' };
// (answers kept a day in the temp folder: a second run asks the servers nothing)
const cacheDir = path.join(require('os').tmpdir(), 'netherflow-race-cache');
const cached = async (key, fn) => {
  const f = path.join(cacheDir, require('crypto').createHash('sha1').update(key).digest('hex'));
  try { if (Date.now() - fs.statSync(f).mtimeMs < 864e5) return fs.readFileSync(f, 'utf8'); } catch {}
  const t = await fn(); fs.mkdirSync(cacheDir, { recursive: true }); fs.writeFileSync(f, t); return t;
};
const get = u => cached(u, async () => { for (let i = 0; i < 5; i++) { const r = await fetch(u, { headers: UA }).catch(() => null); if (r?.ok) return r.text(); await new Promise(f => setTimeout(f, 4000 * (i + 1))); } throw new Error('failed: ' + u); });
const tags = s => Object.fromEntries([...s.matchAll(/<tag k="([^"]+)" v="([^"]*)"/g)].map(t => [t[1], t[2]]));
const R = 6371000, RAD = Math.PI / 180;
const dist = (a, b) => R * Math.hypot((b[0] - a[0]) * RAD, (b[1] - a[1]) * RAD * Math.cos((a[0] + b[0]) / 2 * RAD));

function loop(x, target) {
  const nodes = new Map(); for (const m of x.matchAll(/<node id="(\d+)"[^>]*lat="([\d.-]+)" lon="([\d.-]+)"/g)) nodes.set(m[1], [+m[2], +m[3]]);
  const ways = new Map(); for (const m of x.matchAll(/<way id="(\d+)"[\s\S]*?<\/way>/g)) ways.set(m[1], { nd: [...m[0].matchAll(/<nd ref="(\d+)"/g)].map(n => n[1]), t: tags(m[0]) });
  const rel = x.match(/<relation id="\d+"[\s\S]*?<\/relation>/)[0];
  const use = [...new Map([...rel.matchAll(/<member type="way" ref="(\d+)" role="([^"]*)"/g)]
    .filter(m => ways.has(m[1]) && !/pit/i.test(m[2] + ' ' + (ways.get(m[1]).t.name || ''))).map(m => [m[1], ways.get(m[1])])).values()];
  // Split the ways where they meet, then search the loops through them
  const seen = new Map(); for (const w of use) for (const n of w.nd) seen.set(n, (seen.get(n) || 0) + 1);
  const edges = [];
  for (const w of use) for (let s = 0, i = 1; i < w.nd.length; i++) if (i === w.nd.length - 1 || seen.get(w.nd[i]) > 1) {
    const p = w.nd.slice(s, i + 1); let len = 0; for (let j = 1; j < p.length; j++) len += dist(nodes.get(p[j - 1]), nodes.get(p[j]));
    edges.push({ a: p[0], b: p[p.length - 1], p, len, one: w.t.oneway === 'yes' }); s = i;
  }
  const adj = new Map(), add = (n, s) => (adj.get(n) || adj.set(n, []).get(n)).push(s);
  for (const e of edges) { add(e.a, { e, to: e.b, fwd: true }); add(e.b, { e, to: e.a, fwd: false }); }
  const start = edges.reduce((a, b) => a.len > b.len ? a : b).a, stack = [], on = new Set([start]);
  let best = null, steps = 0;
  (function dfs(n, len) {
    if (++steps > 2e6 || len > target * 1.08) return;
    for (const s of adj.get(n) || []) {
      if (stack.some(t => t.e === s.e)) continue;
      if (s.to === start) { const L = len + s.e.len; if (Math.abs(L - target) < target * .08 && (!best || Math.abs(L - target) < Math.abs(best.len - target))) best = { len: L, steps: [...stack, s] }; continue; }
      if (on.has(s.to)) continue;
      on.add(s.to); stack.push(s); dfs(s.to, len + s.e.len); stack.pop(); on.delete(s.to);
    }
  })(start, 0);
  if (!best) throw new Error('no loop near ' + target + ' m');
  const ids = [start]; let along = 0, against = 0;
  for (const s of best.steps) { ids.push(...(s.fwd ? s.e.p : [...s.e.p].reverse()).slice(1)); if (s.e.one) s.fwd ? along += s.e.len : against += s.e.len; }
  ids.pop(); if (against > along) ids.reverse(); // (driven the way its one-way tags say)
  return ids.map(i => nodes.get(i));
}

// Even spacing along a centripetal Catmull-Rom through the map's points (closed)
function resample(pts, step) {
  const n = pts.length, P = i => pts[(i + n) % n], dense = [];
  for (let i = 0; i < n; i++) {
    const p0 = P(i - 1), p1 = P(i), p2 = P(i + 1), p3 = P(i + 2), d = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]), k = Math.max(1, Math.ceil(d / 1));
    const t01 = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) ** .5 || 1e-4, t12 = d ** .5 || 1e-4, t23 = Math.hypot(p3[0] - p2[0], p3[1] - p2[1]) ** .5 || 1e-4;
    for (let j = 0; j < k; j++) {
      const u = j / k, q = [0, 0];
      for (const c of [0, 1]) { // (Barry-Goldman form)
        const m1 = (p2[c] - p1[c] + t12 * ((p1[c] - p0[c]) / t01 - (p2[c] - p0[c]) / (t01 + t12))) ;
        const m2 = (p2[c] - p1[c] + t12 * ((p3[c] - p2[c]) / t23 - (p3[c] - p1[c]) / (t12 + t23)));
        const a = 2 * p1[c] - 2 * p2[c] + m1 + m2, b = -3 * p1[c] + 3 * p2[c] - 2 * m1 - m2;
        q[c] = a * u ** 3 + b * u ** 2 + m1 * u + p1[c];
      }
      dense.push(q);
    }
  }
  const out = [dense[0]]; let acc = 0;
  for (let i = 1; i <= dense.length; i++) { const a = dense[i - 1], b = dense[i % dense.length]; acc += Math.hypot(b[0] - a[0], b[1] - a[1]); if (acc >= step) { out.push(b); acc = 0; } }
  if (Math.hypot(out[out.length - 1][0] - out[0][0], out[out.length - 1][1] - out[0][1]) < step / 2) out.pop();
  return out;
}

const heights = async lls => { // (OpenTopoData's SRTM 30 m: a hundred points a request, one request a second)
  const hs = [];
  for (let i = 0; i < lls.length; i += 100) {
    const part = lls.slice(i, i + 100);
    hs.push(...JSON.parse(await get(`https://api.opentopodata.org/v1/srtm30m?locations=${part.map(p => p[0].toFixed(6) + ',' + p[1].toFixed(6)).join('|')}`)).results.map(r => r.elevation ?? 0));
    await new Promise(f => setTimeout(f, 1100));
  }
  return hs;
};

// What's round a circuit, from OpenStreetMap (race/maps/<circuit>.json, read by race.js): the ground's heights on a
// 60 m grid; what covers it (forest, grass, fields, gravel, tarmac, water, town), drawn on it; the buildings and
// grandstands, as tall as mapped; the barriers and fences; the roads and the pit lane; single trees.
const AREA = { forest: 1, grass: 2, farm: 3, gravel: 4, paved: 5, water: 6, town: 7 };
function areaClass(t) {
  if (t['area:highway'] || t.amenity === 'parking' || ['asphalt', 'concrete', 'paved', 'paving_stones'].includes(t.surface) && t.area !== 'no') return AREA.paved;
  if (t.natural === 'water' || t.landuse === 'reservoir' || t.landuse === 'basin' || t.waterway === 'riverbank') return AREA.water;
  if (t.landuse === 'forest' || t.natural === 'wood') return AREA.forest;
  if (['gravel', 'sand', 'fine_gravel', 'pebblestone'].includes(t.surface) || ['sand', 'bare_rock', 'scree'].includes(t.natural)) return AREA.gravel;
  if (['farmland', 'orchard', 'vineyard', 'farmyard', 'allotments'].includes(t.landuse)) return AREA.farm;
  if (['grass', 'meadow', 'recreation_ground', 'village_green', 'greenfield'].includes(t.landuse) || ['grassland', 'heath', 'scrub'].includes(t.natural) || ['park', 'pitch', 'golf_course', 'garden'].includes(t.leisure) || t.surface === 'grass') return AREA.grass;
  if (['residential', 'industrial', 'commercial', 'retail', 'railway', 'construction', 'brownfield'].includes(t.landuse)) return AREA.town;
  return 0;
}
const BARRIER = { guard_rail: 1, wall: 2, retaining_wall: 2, jersey_barrier: 2, fence: 3, tyres: 4 };
const ROAD = { motorway: 13, trunk: 11, primary: 9, secondary: 8, tertiary: 7, unclassified: 6, residential: 6, service: 4.5, raceway: 11, track: 3 };
function buildingHeight(t) {
  const h = parseFloat(t.height) || parseFloat(t['building:levels']) * 3.2;
  if (h > 0) return Math.min(h, 80);
  return { grandstand: 13, industrial: 10, warehouse: 10, commercial: 10, house: 7, detached: 7, residential: 9, garage: 3, garages: 3, roof: 4, shed: 3, hut: 3 }[t.building] || 7;
}
// Douglas-Peucker on a line of [x, z]; a closed ring split in two at its far side first (its ends being one point)
function simplify(p, tol) {
  if (p.length < 4) return p;
  if (Math.hypot(p[0][0] - p[p.length - 1][0], p[0][1] - p[p.length - 1][1]) < 1e-6) {
    let k = 1; for (let i = 1; i < p.length; i++) if (Math.hypot(p[i][0] - p[0][0], p[i][1] - p[0][1]) > Math.hypot(p[k][0] - p[0][0], p[k][1] - p[0][1])) k = i;
    return [...simplify(p.slice(0, k + 1), tol).slice(0, -1), ...simplify(p.slice(k), tol)];
  }
  const keep = new Uint8Array(p.length); keep[0] = keep[p.length - 1] = 1;
  const st = [[0, p.length - 1]];
  while (st.length) {
    const [a, b] = st.pop(); let m = -1, md = tol;
    for (let i = a + 1; i < b; i++) {
      const [x1, z1] = p[a], [x2, z2] = p[b], [x, z] = p[i], L = Math.hypot(x2 - x1, z2 - z1) || 1e-9;
      const d = Math.abs((x2 - x1) * (z1 - z) - (x1 - x) * (z2 - z1)) / L;
      if (d > md) { md = d; m = i; }
    }
    if (m >= 0) { keep[m] = 1; st.push([a, m], [m, b]); }
  }
  return p.filter((_, i) => keep[i]);
}
// outer ways of a multipolygon joined into rings
function rings(ways) {
  const out = [], pool = ways.map(w => w.slice());
  while (pool.length) {
    const r = pool.shift();
    for (let guard = 0; guard < 500 && pool.length && (r[0][0] !== r[r.length - 1][0] || r[0][1] !== r[r.length - 1][1]); guard++) {
      const end = r[r.length - 1], i = pool.findIndex(w => w[0][0] === end[0] && w[0][1] === end[1] || w[w.length - 1][0] === end[0] && w[w.length - 1][1] === end[1]);
      if (i < 0) break;
      const w = pool.splice(i, 1)[0]; if (w[0][0] !== end[0] || w[0][1] !== end[1]) w.reverse();
      r.push(...w.slice(1));
    }
    if (r.length > 3) out.push(r);
  }
  return out;
}
// Everything in a box from OpenStreetMap's own API (quartered while it's too much for one answer), in the shape Overpass
// gives ("out geom": each way with its points, each relation with its ways' points)
async function osmApi(s, w, n, e) {
  const r = await fetch(`https://api.openstreetmap.org/api/0.6/map?bbox=${w},${s},${e},${n}`, { headers: UA, signal: AbortSignal.timeout(200000) });
  if (r.status === 400 || r.status === 509) {
    const ms = (s + n) / 2, mw = (w + e) / 2, parts = [];
    for (const [a, b, c, d] of [[s, w, ms, mw], [s, mw, ms, e], [ms, w, n, mw], [ms, mw, n, e]]) parts.push(...await osmApi(a, b, c, d));
    const seen = new Set(); return parts.filter(p => !seen.has(p.type + p.id) && seen.add(p.type + p.id));
  }
  if (!r.ok) throw new Error('OSM API ' + r.status);
  const x = await r.text(), nodes = new Map(), ways = new Map(), out = [];
  for (const m of x.matchAll(/<node id="(\d+)"[^>]*?lat="([\d.-]+)" lon="([\d.-]+)"(\/>|>([\s\S]*?)<\/node>)/g)) {
    nodes.set(m[1], { lat: +m[2], lon: +m[3] });
    const t = tags(m[5] || ''); if (t.natural === 'tree') out.push({ type: 'node', id: +m[1], lat: +m[2], lon: +m[3], tags: t });
  }
  for (const m of x.matchAll(/<way id="(\d+)"[\s\S]*?<\/way>/g)) {
    const geometry = [...m[0].matchAll(/<nd ref="(\d+)"/g)].map(nd => nodes.get(nd[1])).filter(Boolean), t = tags(m[0]);
    ways.set(m[1], geometry); if (Object.keys(t).length) out.push({ type: 'way', id: +m[1], tags: t, geometry });
  }
  for (const m of x.matchAll(/<relation id="(\d+)"[\s\S]*?<\/relation>/g)) {
    const t = tags(m[0]); if (t.type !== 'multipolygon') continue;
    out.push({ type: 'relation', id: +m[1], tags: t, members: [...m[0].matchAll(/<member type="way" ref="(\d+)" role="([^"]*)"/g)].map(mm => ({ type: 'way', ref: +mm[1], role: mm[2], geometry: ways.get(mm[1]) })).filter(mm => mm.geometry) });
  }
  return out;
}
async function surroundings(key, track, lat0, lon0, lo) {
  const c = Math.cos(lat0 * RAD), P = ([la, ln]) => [(ln - lon0) * RAD * R * c, -(la - lat0) * RAD * R];
  const xs = track.map(p => p[0]), zs = track.map(p => p[1]), M = 700;
  const x0 = Math.min(...xs) - M, x1 = Math.max(...xs) + M, z0 = Math.min(...zs) - M, z1 = Math.max(...zs) + M;
  const toLL = (x, z) => [lat0 - z / R / RAD, lon0 + x / R / RAD / c];
  const [s, w] = toLL(x0, z1), [n, e] = toLL(x1, z0), bb = `${s.toFixed(5)},${w.toFixed(5)},${n.toFixed(5)},${e.toFixed(5)}`;
  // the ground: a 60 m grid of heights (decimetres above the track's lowest point)
  const step = 60, nx = Math.ceil((x1 - x0) / step) + 1, nz = Math.ceil((z1 - z0) / step) + 1, pts = [];
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) pts.push(toLL(x0 + i * step, z0 + j * step));
  const grid = { x0: Math.round(x0), z0: Math.round(z0), step, nx, nz, h: (await heights(pts)).map(v => Math.round((v - lo) * 10)) };
  // the map's features
  const q = `[out:json][timeout:180];(way["building"](${bb});relation["building"](${bb});way["landuse"](${bb});relation["landuse"](${bb});way["natural"~"^(wood|water|scrub|sand|heath|grassland|bare_rock|tree_row)$"](${bb});relation["natural"~"^(wood|water)$"](${bb});way["leisure"~"^(park|pitch|golf_course|garden)$"](${bb});way["area:highway"](${bb});way["amenity"="parking"](${bb});way["surface"~"^(gravel|sand|fine_gravel|grass|asphalt|concrete)$"]["highway"!~"."](${bb});way["waterway"="riverbank"](${bb});way["barrier"~"^(guard_rail|wall|retaining_wall|jersey_barrier|fence|tyres)$"](${bb});way["highway"~"^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|service|raceway|track)$"](${bb});node["natural"="tree"](${bb}););out geom;`;
  const osm = JSON.parse(await cached(q, async () => {
    for (const ep of ['https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter', 'https://maps.mail.ru/osm/tools/overpass/api/interpreter'])
      for (let i = 0; i < 3; i++) {
        const r = await fetch(ep, { method: 'POST', headers: { ...UA, 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'data=' + encodeURIComponent(q), signal: AbortSignal.timeout(200000) }).catch(() => null);
        const t = r?.ok ? await r.text().catch(() => '') : ''; if (t.startsWith('{')) return t; await new Promise(f => setTimeout(f, 8000));
      }
    return JSON.stringify({ elements: await osmApi(s, w, n, e) }); // (Overpass down: the OSM API's own map of the box)
  }));
  // how far something is from the track (a coarse grid of the track's points)
  const cell = 50, near = new Map();
  track.forEach(([x, z]) => { const k = Math.floor(x / cell) + ',' + Math.floor(z / cell); (near.get(k) || near.set(k, []).get(k)).push([x, z]); });
  const dist = (x, z) => { let d = 1e9; const cx = Math.floor(x / cell), cz = Math.floor(z / cell); for (let a = -12; a <= 12; a++) for (let b = -12; b <= 12; b++) for (const [px, pz] of near.get((cx + a) + ',' + (cz + b)) || []) d = Math.min(d, Math.hypot(px - x, pz - z)); return d; };
  const r1 = v => Math.round(v * 10) / 10, flat = ring => ring.flatMap(([x, z]) => [r1(x), r1(z)]);
  const loopIds = new Set();
  const out = { grid, areas: [], buildings: [], barriers: [], roads: [], trees: [] };
  for (const el of osm.elements) {
    const t = el.tags || {};
    if (el.type === 'node') { const [x, z] = P([el.lat, el.lon]); if (dist(x, z) < 500) out.trees.push(r1(x), r1(z)); continue; }
    const geoms = el.type === 'way' ? [(el.geometry || []).map(p => [p.lat, p.lon])] : rings((el.members || []).filter(m => m.role === 'outer' && m.geometry).map(m => m.geometry.map(p => [p.lat, p.lon])));
    for (const g of geoms) {
      const ring = g.map(P); if (ring.length < 2) continue;
      const closed = ring.length > 3 && Math.hypot(ring[0][0] - ring[ring.length - 1][0], ring[0][1] - ring[ring.length - 1][1]) < .5;
      const mid = ring.reduce((a, p) => [a[0] + p[0] / ring.length, a[1] + p[1] / ring.length], [0, 0]), d = dist(...mid);
      if (t.building && closed) { if (d < 600) out.buildings.push([+buildingHeight(t).toFixed(1), flat(simplify(ring, .3)), t.building === 'grandstand' || t.leisure === 'stadium' ? 1 : 0]); continue; }
      if (t.barrier) { if (BARRIER[t.barrier] && d < 120) out.barriers.push([BARRIER[t.barrier], flat(simplify(ring, .3))]); continue; }
      if (t.highway && !t['area:highway']) { if (t.highway === 'raceway' && d < 6) continue; if (ROAD[t.highway] && d < 600) out.roads.push([ROAD[t.highway] || 5, flat(simplify(ring, .5))]); continue; }
      if (t.natural === 'tree_row') { for (let i = 1; i < ring.length; i++) { const L = Math.hypot(ring[i][0] - ring[i - 1][0], ring[i][1] - ring[i - 1][1]); for (let k = 0; k < L; k += 8) out.trees.push(r1(ring[i - 1][0] + (ring[i][0] - ring[i - 1][0]) * k / L), r1(ring[i - 1][1] + (ring[i][1] - ring[i - 1][1]) * k / L)); } continue; }
      const cls = areaClass(t); if (cls && closed) out.areas.push([cls, flat(simplify(ring, cls === AREA.paved ? .3 : 1))]);
    }
  }
  out.areas.sort((a, b) => (a[0] === AREA.paved || a[0] === AREA.gravel) - (b[0] === AREA.paved || b[0] === AREA.gravel)); // (run-offs and car parks drawn last: over the grass they're in)
  fs.mkdirSync(path.join(__dirname, '..', 'race', 'maps'), { recursive: true });
  fs.writeFileSync(path.join(__dirname, '..', 'race', 'maps', key + '.json'), JSON.stringify(out));
  return `${out.buildings.length} buildings, ${out.areas.length} areas, ${out.barriers.length} barriers, ${out.roads.length} roads, ${out.trees.length / 2} trees, ${nx}×${nz} heights`;
}

(async () => {
  const file = path.join(__dirname, '..', 'race', 'tracks.json'), only = process.argv.slice(2);
  const out = only.length ? JSON.parse(fs.readFileSync(file, 'utf8')) : { tracks: {} };
  out.source = 'Layouts and surroundings © OpenStreetMap contributors (openstreetmap.org/copyright), ODbL 1.0. Heights: NASA SRTM (public domain) via OpenTopoData.';
  for (const [key, [rel, lap, name, country]] of Object.entries(CIRCUITS)) {
    if (only.length && !only.includes(key)) continue;
    const ll = loop(await get(`https://api.openstreetmap.org/api/0.6/relation/${rel}/full`), lap);
    const lat0 = ll.reduce((s, p) => s + p[0], 0) / ll.length, lon0 = ll.reduce((s, p) => s + p[1], 0) / ll.length, c = Math.cos(lat0 * RAD);
    const xz = resample(ll.map(([la, lo]) => [(lo - lon0) * RAD * R * c, -(la - lat0) * RAD * R]), 8); // metres: x east, z south
    // Heights every 4th point (the DEM is 90 m), then smoothed over ~150 m and filled in between
    const every = 4, hs = await heights(xz.filter((_, i) => i % every === 0).map(([x, z]) => [lat0 - z / R / RAD, lon0 + x / R / RAD / c]));
    const n = hs.length, sm = hs.map((_, i) => { let s = 0, w = 0; for (let k = -2; k <= 2; k++) { const f = 3 - Math.abs(k); s += hs[(i + k + n) % n] * f; w += f; } return s / w; });
    const lo = Math.min(...sm), y = xz.map((_, i) => { const a = Math.floor(i / every), t = i / every - a; return sm[a % n] * (1 - t) + sm[(a + 1) % n] * t - lo; });
    let len = 0; for (let i = 0; i < xz.length; i++) { const a = xz[i], b = xz[(i + 1) % xz.length]; len += Math.hypot(b[0] - a[0], b[1] - a[1]); }
    out.tracks[key] = { name, country, len: Math.round(len), pts: xz.flatMap(([x, z], i) => [+x.toFixed(1), +y[i].toFixed(1), +z.toFixed(1)]) };
    console.log(key, name, Math.round(len), 'm,', xz.length, 'points, climbs', Math.round(Math.max(...y)), 'm;', await surroundings(key, xz, lat0, lon0, lo).catch(e => 'NO MAP: ' + e.message));
    fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(out)); // (kept after each circuit)
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(out));
})();
