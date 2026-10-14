// Renders NetherFlow's logo: a black vinyl record melting — its lower half sagging back as if draped over an edge, and
// dripping, one drop falling free — Dalí's melting clocks, for music. Dark, no glow: only studio light, catching the
// grooves (vinyl's sheen) and the wet edges of the melt; one colour, the label.
// Ray-marched in a WebGL shader (so it's modelled and lit, not painted), 4 samples a pixel.
//   electron tools/logo-render.js [out.png] [size] [tile|bleed]
//   tile: the rounded app icon (default) · bleed: square, edge to edge, the scene smaller (Android's adaptive icon)
const { app, BrowserWindow } = require('electron');
const fs = require('fs'), path = require('path');
const out = process.argv[2] || path.join(__dirname, '..', 'logo.png'), size = +process.argv[3] || 1024, mode = process.argv[4] || 'tile';

const FRAG = `
precision highp float;
uniform vec2 R; uniform float BLEED;
float smin(float a, float b, float k) { float h = clamp(.5 + .5 * (b - a) / k, 0., 1.); return mix(b, a, h) - k * h * (1. - h); }
float seg(vec2 p, vec2 a, vec2 b, float r) { vec2 pa = p - a, ba = b - a; return length(pa - ba * clamp(dot(pa, ba) / dot(ba, ba), 0., 1.)) - r; }
// ---- the record, flat: the disc and its bottom sagging, melted together (given a vinyl's thickness below)
float outline(vec2 p) {
  float d = length(p) - 1.;
  return smin(d, length((p - vec2(.04, -.78)) / vec2(.80, .52)) * .55 - .55 * .98, .30);   // the sag
}
// the sag's lower edge, across it: where the drips hang from
float sagBottom(float x) { float u = clamp((x - .04) / .784, -1., 1.); return -.78 - .51 * sqrt(1. - u * u); }
// a cone with round ends, r1 at a and r2 at b (Inigo Quilez's)
float roundCone(vec3 p, vec3 a, vec3 b, float r1, float r2) {
  vec3 ba = b - a; float l2 = dot(ba, ba), rr = r1 - r2, a2 = l2 - rr * rr, il2 = 1. / l2;
  vec3 pa = p - a; float y = dot(pa, ba), z = y - l2; vec3 xv = pa * l2 - ba * y;
  float x2 = dot(xv, xv), y2 = y * y * l2, z2 = z * z * l2, k = sign(rr) * rr * rr * x2;
  if (sign(z) * a2 * z2 > k) return sqrt(x2 + z2) * il2 - r2;
  if (sign(y) * a2 * y2 < k) return sqrt(x2 + y2) * il2 - r1;
  return (sqrt(x2 * a2 * il2) + y * rr) * il2 - r1;
}
// the drips: where each hangs (x), how long, its width where it leaves, at its neck, and its bead
void dripP(int i, out float x, out float len, out float r1, out float r2, out float rb) {
  if (i == 0) { x = -.50; len = .28; r1 = .085; r2 = .046; rb = .072; }
  else if (i == 1) { x = -.23; len = .62; r1 = .10; r2 = .048; rb = .086; }
  else if (i == 2) { x = .03; len = 1.02; r1 = .12; r2 = .052; rb = .10; }
  else if (i == 3) { x = .31; len = .40; r1 = .09; r2 = .047; rb = .078; }
  else { x = .56; len = .15; r1 = .068; r2 = .044; rb = .058; }
}
// a drip: flat where it leaves the record (as thin as the vinyl), swelling round as it falls, narrowing to a neck,
// then a heavy bead, a little long, at its end
const float TH = .042;
float drip(vec3 q, int i) {
  float x, len, r1, r2, rb; dripP(i, x, len, r1, r2, rb);
  vec3 a = vec3(x, sagBottom(x) + .06, 0.), b = a - vec3(0., len, 0.);
  float sq = mix(1., r1 / TH, smoothstep(a.y - .32, a.y + .02, q.y));                       // (squashed flat near the top)
  vec3 p = vec3(q.x, q.y, q.z * sq);
  return smin(roundCone(p, a, b, r1, r2), length((p - b + vec3(0., rb * .3, 0.)) / vec3(1., 1.18, 1.)) - rb, .07) / sq;
}
float drips(vec3 q) {
  q.x += .012 * sin(q.y * 4.1 + 1.3);                                                       // (not ruled straight: liquid)
  float d = drip(q, 0);
  for (int i = 1; i < 5; i++) d = min(d, drip(q, i));
  return d;
}
// which drip a point is on: its x (and where the drop falls); a big number on the record itself
float dripAt(vec3 q) {
  q.x += .012 * sin(q.y * 4.1 + 1.3);
  float best = 1e3, bx = 9.;
  for (int i = 0; i < 5; i++) { float x, len, r1, r2, rb; dripP(i, x, len, r1, r2, rb); float d = drip(q, i); if (d < best) { best = d; bx = x; } }
  return bx;
}
// a drop come free under the long one, falling: round, drawn up a little behind it
float drop(vec3 q) { vec3 c = vec3(.03, -2.62, 0.); return roundCone(q, c, c + vec3(0., .10, 0.), .082, .045); }
// ---- in 3D: the record given a vinyl's thickness (edges rounded), the drips flowing out of it, all a little bent back
// as it hangs (draped over an edge)
vec3 local(vec3 p) {                                                                      // (the world, into the record's own frame)
  float c = cos(.32), s = sin(.32); p.xz = mat2(c, s, -s, c) * p.xz;                       // (turned: we see its thickness)
  c = cos(.05); s = sin(.05); p.yz = mat2(c, -s, s, c) * p.yz;                             // (leaning back a hair)
  p.z += .10 * pow(max(0., -.25 - p.y), 2.);                                               // (bending back as it hangs)
  return p;
}
vec3 toLocal(vec3 v) {                                                                    // (a direction, into the record's frame — the bend left out)
  float c = cos(.32), s = sin(.32); v.xz = mat2(c, s, -s, c) * v.xz;
  c = cos(.05); s = sin(.05); v.yz = mat2(c, -s, s, c) * v.yz;
  return v;
}
vec3 toWorld(vec3 v) {                                                                    // (a direction in the record's frame, back to the world's)
  float c = cos(.05), s = sin(.05); v.yz = mat2(c, s, -s, c) * v.yz;
  c = cos(.32); s = sin(.32); v.xz = mat2(c, -s, s, c) * v.xz;
  return v;
}
float rec(vec3 p) {
  vec3 q = local(p);
  vec2 w = vec2(outline(q.xy) + .025, abs(q.z) - TH - .018 * smoothstep(.16, 0., q.y - sagBottom(q.x)) + .025);
  float d = smin(min(max(w.x, w.y), 0.) + length(max(w, 0.)) - .025, drips(q), .08);      // (the drips flowing out of it)
  return min(d, drop(q)) * .7;                                                             // (the bend makes it inexact: a careful step)
}
vec3 nrm(vec3 p) { vec2 e = vec2(.0012, 0.); return normalize(vec3(rec(p + e.xyy) - rec(p - e.xyy), rec(p + e.yxy) - rec(p - e.yxy), rec(p + e.yyx) - rec(p - e.yyx))); }
float march(vec3 ro, vec3 rd) { float t = 3.; for (int i = 0; i < 220; i++) { float d = rec(ro + rd * t); if (d < .0004) return t; t += d; if (t > 12.) break; } return -1.; }
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
// ---- light: a soft key from the upper left, a thin rim from behind on the right; the backdrop near-black, lighter above
const vec3 KEY = vec3(-.55, .70, .55), RIM = vec3(.85, .15, -.50);
// (a studio wall, lit softly behind it: the black record stands out as a silhouette — light on a wall, not a glow)
vec3 backdrop(vec2 uv) { float l = exp(-dot(uv - vec2(-.04, .06), uv - vec2(-.04, .06)) * 2.2); return mix(vec3(.030, .028, .033), vec3(.135, .128, .142), l); }
vec3 shade(vec3 p, vec3 rd) {
  vec3 n = nrm(p), q = local(p), L = normalize(KEY), L2 = normalize(RIM), h = normalize(L - rd);
  float r = length(q.xy), down = smoothstep(.02, -.14, q.y - sagBottom(q.x));             // (down: 0 on the record, 1 down a drip)
  float rm = length(vec2(q.x, q.y < 0. ? q.y * mix(1., .72, smoothstep(-.2, -1.1, q.y)) : q.y)); // (the rings as the melt stretched them)
  float dx = q.x + .012 * sin(q.y * 4.1 + 1.3) - (q.y < -2.4 ? .03 : dripAt(q)), rd2 = length(vec2(dx, q.z));
  float arc = atan(dx, q.z) * rd2;                                                          // (round the drip, along its surface)
  float lines = .5 + .5 * sin(arc * 300.);
  // cut into the surface, they tilt it: the reflections down a drip break into fine lines
  vec3 around = toWorld(vec3(q.z, 0., -dx) / max(rd2, .001));
  n = normalize(n + around * cos(arc * 300.) * .06 * down);
  float dif = max(dot(n, L), 0.), spec = pow(max(dot(n, h), 0.), 60.), fres = pow(1. - max(dot(n, -rd), 0.), 4.);
  vec3 c = vec3(.012) + vec3(.03) * dif;                                                   // black vinyl
  // the grooves: fine rings, and their sheen — the light running along them (anisotropic: the two bright wedges facing
  // the light that a record always has); gone where it's melted (beyond the disc) and on the label
  vec3 tang = toWorld(vec3(-q.y, q.x, 0.) / max(r, .001));                                // (round the rings)
  float tdh = dot(tang, h), aniso = pow(sqrt(max(0., 1. - tdh * tdh)), 90.);
  float grooves = .55 + .45 * sin(rm * 520.) * sin(rm * 37.);
  float onVinyl = smoothstep(.33, .36, r);                                                 // (everywhere but the label)
  c += vec3(.62, .60, .66) * aniso * grooves * onVinyl * .55 * (1. - down);
  // the label: one colour, matte, a fine ring printed on it; the spindle hole
  float lab = smoothstep(.335, .325, r);
  c = mix(c, vec3(.42, .055, .045) * (.35 + .75 * dif) + vec3(.08) * spec, lab);
  c = mix(c, c * .55, lab * smoothstep(.006, 0., abs(r - .23)));
  c = mix(c, backdrop(vec2(0.)) * .6, smoothstep(.034, .028, r));
  // the melt: wet, glossy — its rounded edges catch the key and the rim
  c += vec3(.85, .84, .9) * (spec * .55 + pow(max(dot(n, h), 0.), 220.) * .9) * (1. - lab) + vec3(.55, .58, .7) * pow(max(dot(reflect(rd, n), L2), 0.), 24.) * .45;
  c += vec3(.1, .1, .12) * fres;
  // wet: two tall strip lights, left and right, mirrored the length of each drip — broken into lines by the grooves
  vec3 R = reflect(rd, n); vec2 az = normalize(R.xz + vec2(0., 1e-4));
  float s1 = smoothstep(.62, .99, dot(az, normalize(vec2(-.78, .62)))) * smoothstep(-1.05, -.35, R.y) * smoothstep(.85, .35, R.y);
  float s2 = smoothstep(.86, .995, dot(az, normalize(vec2(.88, .47)))) * smoothstep(-1.05, -.35, R.y) * smoothstep(.85, .35, R.y);
  c += (vec3(.78, .77, .84) * s1 * .55 + vec3(.55, .58, .72) * s2 * .30) * down * (.12 + .88 * lines);
  return c;
}
void main() {
  vec3 col = vec3(0.);
  for (int i = 0; i < 4; i++) {                                                            // 4 samples a pixel
    vec2 o = vec2(mod(float(i), 2.), floor(float(i) / 2.)) * .5 - .25;
    vec2 uv = (gl_FragCoord.xy + o - .5 * R) / R.y * (1. + BLEED * .5);
    vec3 ro = vec3(0., -.35, 8.6), ta = vec3(.02, -.80, 0.);
    vec3 f = normalize(ta - ro), r = normalize(cross(f, vec3(0., 1., 0.))), u = cross(r, f);
    vec3 rd = normalize(f * 2.0 + uv.x * r + uv.y * u);
    float t = march(ro, rd);
    col += t > 0. ? shade(ro + rd * t, rd) : backdrop(uv);
  }
  col /= 4.;
  col = pow(col, vec3(.95));
  col += (hash(gl_FragCoord.xy) - .5) * .012;                                              // a hair of grain
  gl_FragColor = vec4(col, 1.);
}`;

app.whenReady().then(async () => {
  const w = new BrowserWindow({ show: false, width: 400, height: 400 });
  await w.loadURL('data:text/html,<canvas></canvas>');
  const png = await w.webContents.executeJavaScript(`(() => {
    const S = ${size}, c = document.querySelector('canvas'); c.width = c.height = S;
    const gl = c.getContext('webgl', { preserveDrawingBuffer: true, antialias: false });
    const sh = (t, src) => { const s = gl.createShader(t); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
    const pr = gl.createProgram();
    gl.attachShader(pr, sh(gl.VERTEX_SHADER, 'attribute vec2 p;void main(){gl_Position=vec4(p,0,1);}'));
    gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, ${JSON.stringify(FRAG)}));
    gl.bindAttribLocation(pr, 0, 'p'); gl.linkProgram(pr); gl.useProgram(pr);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer()); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.uniform2f(gl.getUniformLocation(pr, 'R'), S, S); gl.uniform1f(gl.getUniformLocation(pr, 'BLEED'), ${mode === 'bleed' ? 1 : 0});
    gl.viewport(0, 0, S, S); gl.drawArrays(gl.TRIANGLES, 0, 3);
    // the app icon: rounded (Apple's 22.4% corner) with a faint edge; bleed: square, as rendered
    const o = document.createElement('canvas'); o.width = o.height = S;
    const g = o.getContext('2d');
    if (${mode === 'tile'}) { const rr = new Path2D(); rr.roundRect(0, 0, S, S, S * .2237); g.clip(rr); }
    g.drawImage(c, 0, 0);
    if (${mode === 'tile'}) { g.strokeStyle = 'rgba(255,255,255,.07)'; g.lineWidth = S / 512; const rr = new Path2D(); rr.roundRect(S / 1024, S / 1024, S - S / 512, S - S / 512, S * .2237); g.stroke(rr); }
    return o.toDataURL('image/png').split(',')[1];
  })()`);
  fs.writeFileSync(out, Buffer.from(png, 'base64'));
  console.log('LOGO', out, size, mode);
  app.quit();
});
