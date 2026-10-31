// NetherFlow - Copyright (C) 2026 Volodya.rua - GNU GPL v3 only, with additional terms (credit, name and logo): see LICENSE and NOTICE.
// Renders NetherFlow's logo: the word NOLOGO in black, nothing behind it (the user's design, 2026-11-01). Its letters are
// drawn here from strokes — round-ended, one weight — not taken from a font, so it's sharp at every size and wholly ours.
// Writes every place it's used: logo.png (the page), icon.png (the desktop app), the Android launcher icons (plain,
// round, and the adaptive icon's layer — smaller, in its safe zone), the splash, the TV banner and F-Droid's icon; the
// status-bar icon (a vector, white) is written as NO over LOGO, to read at its few pixels.
//   electron tools/logo-render.js [preview.png]   (one argument: a 512 px preview there, and nothing else written)
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
const word = (text) => { let x = 0; const out = []; for (const ch of text) { const [w, d] = LETTERS[ch]; out.push([x, d]); x += w + GAP; } return { parts: out, w: x - GAP }; };
const MARK = word('NOLOGO');
// (what to write: file, size, how much of the width the word fills)
const D = ['mdpi', 'hdpi', 'xhdpi', 'xxhdpi', 'xxxhdpi'], K = [1, 1.5, 2, 3, 4];
const JOBS = process.argv[2] ? [[process.argv[2], 512, .86]] : [
  ['logo.png', 512, .9], ['icon.png', 1024, .86], ['fastlane/metadata/android/en-US/images/icon.png', 512, .86],
  ...D.flatMap((d, i) => [[`android/app/src/main/res/mipmap-${d}/ic_launcher.png`, 48 * K[i], .9], [`android/app/src/main/res/mipmap-${d}/ic_launcher_round.png`, 48 * K[i], .78],
    [`android/app/src/main/res/mipmap-${d}/ic_launcher_foreground.png`, 108 * K[i], .56], [`android/app/src/main/res/drawable-${d}/splash_icon.png`, 288 * K[i], .6]]),
  ['android/app/src/main/res/drawable-xhdpi/tv_banner.png', [320, 180], .8],
];

app.whenReady().then(async () => {
  const w = new BrowserWindow({ show: false, width: 400, height: 400 });
  await w.loadURL('data:text/html,<canvas></canvas>');
  for (const [file, size, fill] of JOBS) {
    const [W, H] = Array.isArray(size) ? size : [size, size];
    const png = await w.webContents.executeJavaScript(`(() => {
      const c = document.createElement('canvas'); c.width = ${W}; c.height = ${H};
      const g = c.getContext('2d'), k = ${W} * ${fill} / ${MARK.w};
      g.translate((${W} - ${MARK.w} * k) / 2, (${H} - 100 * k) / 2); g.scale(k, k);
      g.strokeStyle = '#000'; g.lineWidth = ${SW}; g.lineCap = g.lineJoin = 'round';
      for (const [x, d] of ${JSON.stringify(MARK.parts)}) { g.save(); g.translate(x, 0); g.stroke(new Path2D(d)); g.restore(); }
      return c.toDataURL('image/png').split(',')[1];
    })()`);
    const dest = path.isAbsolute(file) ? file : path.join(ROOT, file);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, Buffer.from(png, 'base64'));
    console.log('LOGO', file, W + 'x' + H);
  }
  if (!process.argv[2]) { // the status-bar icon: NO over LOGO, white, the same strokes
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
  app.quit();
}).catch(e => { console.error(e); app.exit(1); });
