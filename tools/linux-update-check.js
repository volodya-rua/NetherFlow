// NetherFlow - Copyright (C) 2026 Volodya.rua - GNU GPL v3 only, with additional terms (credit, name and logo): see LICENSE and NOTICE.
// The AppImage's own updater, checked on GitHub's Ubuntu (see .github/workflows/linux-checks.yml): with an older
// AppImage running, its page open to DevTools on port 9222, this asks the app for an update and downloads it (not
// installed). Prints what happened; exits 1 if it found no newer version or the download failed.
//   node tools/linux-update-check.js
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  let target;
  for (let i = 0; i < 90 && !target; i++) {
    await sleep(1000);
    target = await fetch('http://127.0.0.1:9222/json').then(r => r.json()).then(l => l.find(t => t.type === 'page' && /^http:\/\/localhost:\d+\/$/.test(t.url))).catch(() => null);
  }
  if (!target) throw new Error('the app\'s page never opened');
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((ok, no) => { ws.onopen = ok; ws.onerror = () => no(new Error('DevTools didn\'t answer')); });
  let n = 0;
  const waiting = new Map();
  ws.onmessage = m => { const d = JSON.parse(m.data); waiting.get(d.id)?.(d); };
  const page = js => new Promise(ok => { const id = ++n; waiting.set(id, d => ok(d.result?.exceptionDetails ? 'ERR ' + d.result.exceptionDetails.exception?.description : d.result?.result?.value));
    ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression: js, awaitPromise: true, returnByValue: true } })); });
  for (let i = 0; i < 60 && await page(`typeof netherflowApp === 'object'`) !== true; i++) await sleep(1000);
  const out = { check: await page('netherflowApp.updateCheck()') };
  if (out.check?.next) {
    const t0 = Date.now();
    out.download = await page('netherflowApp.updateGet().then(ok => ok, e => "ERR " + e.message)');
    out.downloadSecs = Math.round((Date.now() - t0) / 1000);
  }
  console.log(JSON.stringify(out, null, 1));
  process.exit(out.check?.next && out.download === true ? 0 : 1);
})().catch(e => { console.error(e.message); process.exit(1); });
