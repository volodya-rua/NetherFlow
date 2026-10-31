// NetherFlow - Copyright (C) 2026 Volodya.rua - GNU GPL v3 only, with additional terms (credit, name and logo): see LICENSE and NOTICE.
// Renders NetherFlow's logo: the word NOLOGO in black, nothing behind it (the user's design, 2026-11-01). Its letters are
// drawn here from strokes — round-ended, one weight — not taken from a font, so it's sharp at every size and wholly ours.
// Writes every place it's used: logo.png (the page), icon.png (the desktop app), the Android launcher icons (plain,
// round, and the adaptive icon's layer — smaller, in its safe zone), the splash, the TV banner and F-Droid's icon; the
// status-bar icon (a vector, white) is written as NO over LOGO, to read at its few pixels.
// The TV banner also says NetherFlow under it, small (Google's TV guideline: the banner names the app; Legal): set in
// Instrument Serif italic, the name's own face on the page (SIL OFL, credited). NOLOGO is the icon only, never a name.
// The fallback, if a NOLOGO or NO LOGO owner ever minds (Legal: we switch, we don't argue): the question mark it
// replaced, drawn from its own strokes — `--fallback` writes it everywhere instead.
//   electron tools/logo-render.js [preview.png] [--fallback]   (a .png: a 512 px preview there, nothing else written)
const { app, BrowserWindow } = require('electron');
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');

// the letters, 100 high, their strokes' middles 8 in from the edges (the stroke 16 wide): [width, draw(g) → path calls]
const SW = 16, GAP = 16;
const LETTERS = {
  N: [70, 'M8 92L8 8L62 92L62 8'],
  O: [90, 'M82 50A37 42 0 1 1 8 50A37 42 0 1 1 82 50Z'],
  L: [58, 'M8 8L8 92L50 92'],
  G: [90, 'M68.8 17.8A37 42 0 1 0 81.9 53.7L52 53.7'],
};
// the fallback: the question mark (its hook and stem one stroke 13.5 wide on a 100 square; a dot below)
const FALLBACK = process.argv.includes('--fallback'), Q = { hook: 'M30.5 35.5A19.5 19.5 0 1 1 64.6 48.5C57 54.5 50 57 50 67', sw: 13.5, dot: [50, 84, 7.6] };
const word = (text) => { let x = 0; const out = []; for (const ch of text) { const [w, d] = LETTERS[ch]; out.push([x, d]); x += w + GAP; } return { parts: out, w: x - GAP }; };
const MARK = word('NOLOGO');
// (what to write: file, size, how much of the width the word fills)
const D = ['mdpi', 'hdpi', 'xhdpi', 'xxhdpi', 'xxxhdpi'], K = [1, 1.5, 2, 3, 4];
const PREVIEW = process.argv.slice(2).find(a => a.endsWith('.png'));
const JOBS = PREVIEW ? [[PREVIEW, 512, .86]] : [
  ['logo.png', 512, .9], ['icon.png', 1024, .86], ['fastlane/metadata/android/en-US/images/icon.png', 512, .86],
  ...D.flatMap((d, i) => [[`android/app/src/main/res/mipmap-${d}/ic_launcher.png`, 48 * K[i], .9], [`android/app/src/main/res/mipmap-${d}/ic_launcher_round.png`, 48 * K[i], .78],
    [`android/app/src/main/res/mipmap-${d}/ic_launcher_foreground.png`, 108 * K[i], .56], [`android/app/src/main/res/drawable-${d}/splash_icon.png`, 288 * K[i], .6]]),
  ['android/app/src/main/res/drawable-xhdpi/tv_banner.png', [320, 180], .7, 'NetherFlow'],
];

app.whenReady().then(async () => {
  const w = new BrowserWindow({ show: false, width: 400, height: 400 });
  await w.loadURL('data:text/html,<canvas></canvas>');
  const face = fs.readFileSync(path.join(ROOT, 'fonts/InstrumentSerif-400i-latin.woff2')).toString('base64');
  await w.webContents.executeJavaScript(`(async () => { const b = Uint8Array.from(atob('${face}'), c => c.charCodeAt(0)); const f = new FontFace('NFName', b.buffer, { style: 'italic' }); await f.load(); document.fonts.add(f); })()`);
  for (const [file, size, fill, name] of JOBS) {
    const [W, H] = Array.isArray(size) ? size : [size, size];
    const png = await w.webContents.executeJavaScript(`(() => {
      const c = document.createElement('canvas'); c.width = ${W}; c.height = ${H};
      const g = c.getContext('2d'), name = ${JSON.stringify(name || '')}, under = name ? ${H} * .16 : 0; // (the name's line, under the mark)
      g.strokeStyle = g.fillStyle = '#000'; g.lineCap = g.lineJoin = 'round';
      if (${FALLBACK}) { // the question mark
        const k = (Math.min(${W}, ${H}) - under) / 100 * ${fill};
        g.save(); g.translate(${W} / 2 - 50 * k, (${H} - under) / 2 - 50 * k); g.scale(k, k); g.lineWidth = ${Q.sw};
        g.stroke(new Path2D(${JSON.stringify(Q.hook)})); g.beginPath(); g.arc(${Q.dot.join(', ')}, 0, Math.PI * 2); g.fill(); g.restore();
      } else {
        const k = Math.min(${W} * ${fill} / ${MARK.w}, (${H} - under) * .8 / 100);
        g.save(); g.translate((${W} - ${MARK.w} * k) / 2, (${H} - under - 100 * k) / 2); g.scale(k, k); g.lineWidth = ${SW};
        for (const [x, d] of ${JSON.stringify(MARK.parts)}) { g.save(); g.translate(x, 0); g.stroke(new Path2D(d)); g.restore(); }
        g.restore();
      }
      if (name) { g.font = 'italic ' + Math.round(under * .95) + 'px NFName'; g.textAlign = 'center'; g.textBaseline = 'alphabetic'; g.fillText(name, ${W} / 2, ${H} - under * .45); }
      return c.toDataURL('image/png').split(',')[1];
    })()`);
    const dest = path.isAbsolute(file) ? file : path.join(ROOT, file);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, Buffer.from(png, 'base64'));
    console.log('LOGO', file, W + 'x' + H);
  }
  if (!PREVIEW && !FALLBACK) { // the status-bar icon: NO over LOGO, white, the same strokes
    const lines = [word('NO'), word('LOGO')], V = Math.max(...lines.map(l => l.w)) + SW, LH = 100, LG = 34, VH = LH * 2 + LG;
    const paths = lines.flatMap((l, i) => l.parts.map(([x, d]) => `        <group android:translateX="${((V - l.w) / 2 + x).toFixed(1)}" android:translateY="${(i * (LH + LG) + (V - VH) / 2).toFixed(1)}">\n            <path android:fillColor="#00000000" android:strokeColor="#FFFFFFFF" android:strokeWidth="${SW}" android:strokeLineCap="round" android:strokeLineJoin="round" android:pathData="${d.replace(/([A-Z])/g, ' $1').trim()}" />\n        </group>`));
    fs.writeFileSync(path.join(ROOT, 'android/app/src/main/res/drawable/ic_stat_netherflow.xml'), `<?xml version="1.0" encoding="utf-8"?>
<!-- Status-bar icon for the "now playing" notification: NetherFlow's logo, NO over LOGO (white on transparent, as Android
     requires: it's tinted by the system). Written by tools/logo-render.js, from the same strokes as the logo. -->
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="24dp"
    android:height="24dp"
    android:viewportWidth="${V}"
    android:viewportHeight="${V}">
${paths.join('\n')}
</vector>
`);
    console.log('LOGO status-bar icon');
  }
  if (FALLBACK && !PREVIEW) { // (the fallback's status-bar icon: the question mark's strokes, white)
    fs.writeFileSync(path.join(ROOT, 'android/app/src/main/res/drawable/ic_stat_netherflow.xml'), `<?xml version="1.0" encoding="utf-8"?>
<!-- Status-bar icon for the "now playing" notification: the fallback logo, a question mark (white on transparent, as
     Android requires). Written by tools/logo-render.js --fallback. -->
<vector xmlns:android="http://schemas.android.com/apk/res/android" android:width="24dp" android:height="24dp" android:viewportWidth="100" android:viewportHeight="100">
    <path android:fillColor="#00000000" android:strokeColor="#FFFFFFFF" android:strokeWidth="${Q.sw}" android:strokeLineCap="round" android:strokeLineJoin="round" android:pathData="M30.5,35.5 A19.5,19.5 0 1,1 64.6,48.5 C57,54.5 50,57 50,67" />
    <path android:fillColor="#FFFFFFFF" android:pathData="M42.4,84 a7.6,7.6 0 1,0 15.2,0 a7.6,7.6 0 1,0 -15.2,0 z" />
</vector>
`);
    console.log('LOGO fallback status-bar icon');
  }
  app.quit();
}).catch(e => { console.error(e); app.exit(1); });
