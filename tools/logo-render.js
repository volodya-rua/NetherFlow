// NetherFlow - Copyright (C) 2026 Volodya.rua - GNU GPL v3 only, with additional terms (credit, name and logo): see LICENSE and NOTICE.
// Renders NetherFlow's logo: a black question mark, nothing behind it (the user's design, 2026-11-01) — one stroke for
// its hook and stem, round-ended, and a round dot; drawn from the path below, so it's sharp at every size.
// Writes every place it's used: logo.png (the page), icon.png (the desktop app), the Android launcher icons (plain,
// round, and the adaptive icon's layer — smaller, in its safe zone), the splash, the TV banner and F-Droid's icon.
//   electron tools/logo-render.js [preview.png]   (one argument: a 512 px preview there, and nothing else written)
const { app, BrowserWindow } = require('electron');
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..'), RES = path.join(ROOT, 'android/app/src/main/res');

// the mark on a 100 × 100 square: the hook and stem, one stroke 13.5 wide; the dot below it
const HOOK = 'M30.5 35.5A19.5 19.5 0 1 1 64.6 48.5C57 54.5 50 57 50 67', STROKE = 13.5, DOT = [50, 84, 7.6];
// (what to write: file, size, how much of the square the mark fills; 'adaptive' — Android's layer, its safe zone a
// circle 61% across, so the mark smaller)
const D = ['mdpi', 'hdpi', 'xhdpi', 'xxhdpi', 'xxxhdpi'], K = [1, 1.5, 2, 3, 4];
const JOBS = process.argv[2] ? [[process.argv[2], 512, 1]] : [
  ['logo.png', 512, 1], ['icon.png', 1024, 1], ['fastlane/metadata/android/en-US/images/icon.png', 512, 1],
  ...D.flatMap((d, i) => [[`android/app/src/main/res/mipmap-${d}/ic_launcher.png`, 48 * K[i], .92], [`android/app/src/main/res/mipmap-${d}/ic_launcher_round.png`, 48 * K[i], .92],
    [`android/app/src/main/res/mipmap-${d}/ic_launcher_foreground.png`, 108 * K[i], .5], [`android/app/src/main/res/drawable-${d}/splash_icon.png`, 288 * K[i], .5]]),
  ['android/app/src/main/res/drawable-xhdpi/tv_banner.png', [320, 180], .78],
];

app.whenReady().then(async () => {
  const w = new BrowserWindow({ show: false, width: 400, height: 400 });
  await w.loadURL('data:text/html,<canvas></canvas>');
  for (const [file, size, fill] of JOBS) {
    const [W, H] = Array.isArray(size) ? size : [size, size];
    const png = await w.webContents.executeJavaScript(`(() => {
      const c = document.createElement('canvas'); c.width = ${W}; c.height = ${H};
      const g = c.getContext('2d'), k = ${Math.min(W, H)} / 100 * ${fill};
      g.translate(${W} / 2 - 50 * k, ${H} / 2 - 50 * k); g.scale(k, k);
      g.strokeStyle = g.fillStyle = '#000'; g.lineWidth = ${STROKE}; g.lineCap = g.lineJoin = 'round';
      g.stroke(new Path2D(${JSON.stringify(HOOK)}));
      g.beginPath(); g.arc(${DOT.join(', ')}, 0, Math.PI * 2); g.fill();
      return c.toDataURL('image/png').split(',')[1];
    })()`);
    const dest = path.isAbsolute(file) ? file : path.join(ROOT, file);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, Buffer.from(png, 'base64'));
    console.log('LOGO', file, W + 'x' + H);
  }
  app.quit();
}).catch(e => { console.error(e); app.exit(1); });
