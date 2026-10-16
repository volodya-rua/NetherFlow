// NetherFlow - Copyright (C) 2026 Volodya.rua - GNU GPL v3 only, with additional terms (credit, name and logo): see LICENSE and NOTICE.
// The Linux build's check, on GitHub's Ubuntu (see .github/workflows/linux.yml): with the app already started on a
// virtual screen, its page open to DevTools on port 9222, this asks the page itself: it loaded; songs found; Apple's
// podcast chart; FlowStream there (playing and saving songs), and no island (Windows only).
//   node tools/linux-smoke.js [quick: only that the page loaded]
// Exits 1 on anything wrong.
const [, , quick] = process.argv;
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const out = {};
  let target;
  for (let i = 0; i < 90 && !target; i++) {
    await sleep(1000);
    target = await fetch('http://127.0.0.1:9222/json').then(r => r.json()).then(l => l.find(t => t.type === 'page' && /^http:\/\/localhost:\d+\/$/.test(t.url))).catch(() => null);
  }
  if (!target) throw new Error('the app\'s page never opened');
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((ok, no) => { ws.onopen = ok; ws.onerror = () => no(new Error('DevTools didn\'t answer')); });
  let n = 0;
  const waiting = new Map(), errors = [];
  ws.onmessage = m => {
    const d = JSON.parse(m.data);
    if (d.method === 'Runtime.exceptionThrown') errors.push(d.params.exceptionDetails.exception?.description?.split('\n')[0] || d.params.exceptionDetails.text);
    waiting.get(d.id)?.(d);
  };
  const send = (method, params) => new Promise(ok => { const id = ++n; waiting.set(id, ok); ws.send(JSON.stringify({ id, method, params })); });
  const page = async js => { const d = await send('Runtime.evaluate', { expression: js, awaitPromise: true, returnByValue: true }); return d.result?.exceptionDetails ? 'ERR ' + d.result.exceptionDetails.exception?.description : d.result?.result?.value; };
  await send('Runtime.enable');
  for (let i = 0; i < 60 && await page(`typeof searchSongs === 'function' && typeof podTop === 'function'`) !== true; i++) await sleep(1000);
  out.title = await page('document.title');
  if (!quick) {
    out.island = await page('typeof netherflowApp.island');
    out.flowstream = await page('typeof FlowStream?.create');
    out.search = await page(`searchSongs('blinding lights the weeknd').then(l => l.length, e => 'ERR ' + e.message)`);
    out.podcasts = await page(`podTop().then(l => l.length, e => 'ERR ' + e.message)`);
    out.feed = await page(`fetch('/api/feed?url=' + encodeURIComponent('https://feeds.npr.org/510318/podcast.xml')).then(r => r.status)`);
    out.deb = await page('netherflowApp.updateCheck().then(r => r.deb)'); // (installed from the .deb: sent to the release page for updates)
  }
  await sleep(3000); // (anything thrown while it settles)
  out.errors = errors;
  console.log(JSON.stringify(out, null, 1));
  const bad = [
    !/NetherFlow/.test(out.title || '') && 'the page',
    !quick && out.island !== 'undefined' && 'the island',
    !quick && out.flowstream !== 'function' && 'FlowStream',
    !quick && !(out.search > 0) && 'search',
    !quick && !(out.podcasts > 10) && 'podcasts',
    !quick && out.feed !== 200 && 'a podcast feed',
    !quick && out.deb !== true && 'the .deb update note',
    errors.length && 'errors on the page',
  ].filter(Boolean);
  if (bad.length) { console.error('WRONG: ' + bad.join(', ')); process.exit(1); }
  process.exit(0);
})().catch(e => { console.error(e.message); process.exit(1); });
