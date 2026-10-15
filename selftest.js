// NetherFlow - Copyright (C) 2026 Volodya.rua - GNU GPL v3 only, with additional terms (credit, name and logo): see LICENSE and NOTICE.
// Smoke test for the desktop app:  npx electron selftest.js
// Opens the app muted, searches and plays a song, then prints what it found and quits.
// (the song: Jonathan Coulton's Code Monkey, which he shares under Creative Commons BY-NC, with synced lyrics on LRCLIB)
const { app } = require('electron');
require('./main');

app.on('browser-window-created', (_, win) => {
  if (win.getTitle() === 'NetherFlow island') return; // (the desktop app's island: not the page)
  win.webContents.setAudioMuted(true);
  win.webContents.once('did-finish-load', async () => {
    const page = js => win.webContents.executeJavaScript(js);
    const wait = ms => new Promise(r => setTimeout(r, ms));
    const report = {};
    try {
      report.fileButtonsGone = await page(`!/\\+ (file|lyrics)/i.test(document.body.innerText)`);
      await page(`(async () => {
        openSearch(); $('q').value = 'code monkey jonathan coulton'; await runSearch($('q').value);
        [...document.querySelectorAll('.row')].find(r => / — Thing a Week Three$/.test(r.querySelector('small').textContent)).click();
      })()`);
      await wait(9000);
      Object.assign(report, await page(`({ engine, state: yt?.getPlayerState(), video: yt?.getVideoData().title,
        t: +P.t.toFixed(1), status: $('status').textContent, syncedLines: synced ? lines.length : 0 })`));
      const ytFrame = win.webContents.mainFrame.framesInSubtree.find(f => /youtube\.com\/embed\//.test(f.url));
      report.frameHelperLoaded = !!ytFrame && await ytFrame.executeJavaScript('!!window.__nfHelper');
      report.playerInterrupted = !!ytFrame && await ytFrame.executeJavaScript(`!!document.querySelector('.ad-showing')`);
    } catch (e) { report.error = e.message; }
    console.log('SELFTEST ' + JSON.stringify(report));
    app.quit();
  });
});
