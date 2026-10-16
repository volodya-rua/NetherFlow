// NetherFlow - Copyright (C) 2026 Volodya.rua - GNU GPL v3 only, with additional terms (credit, name and logo): see LICENSE and NOTICE.
// FlowStream's daily check (.github/workflows/flowstream-health.yml; or by hand: node tools/flowstream-check.js): a
// song asked for as the app asks for it — its best audio, the stream itself, its lyrics, and the spare client when the
// first is refused — so a change on YouTube's side is seen within the day. Exits 1 if anything's wrong. A bot check
// (YouTube asking the machine to sign in, as it does some servers) is only a warning: not a change, and the app never signs in.
// (Jonathan Coulton's "Code Monkey": he shares it under Creative Commons BY-NC.)
const FlowStream = require('../flowstream.js');
const SONG = 'AEBld6I_AKs';
const post = (url, body, headers) => fetch(url, { method: 'POST', body, headers, signal: AbortSignal.timeout(15000) }).then(r => r.text());
const bad = [], ok = (c, m) => { if (!c) bad.push(m); console.log((c ? 'ok   ' : 'FAIL ') + m); };
(async () => {
  const a = await FlowStream.create({ post }).audio(SONG).catch(e => e);
  if (a.code === 'blocked') { console.log(`::warning::YouTube asked this machine to sign in (${a.message}): FlowStream can't be checked from here today`); return; }
  ok(a.itag === 251, `audio: format ${a.itag || a.code + ' ' + a.message} (${a.client || ''})`);
  const head = a.url ? new Uint8Array(await (await fetch(a.url, { headers: { Range: 'bytes=0-1023' } })).arrayBuffer()) : [];
  ok(head[0] === 0x1a && head[1] === 0x45, 'the stream answers, and it\'s WebM');
  const l = await FlowStream.create({ post }).lyrics(SONG).catch(e => ({ error: e.message }));
  ok(l.lines?.length > 20, `lyrics: ${l.lines?.length || 0} synced lines${l.error ? ' (' + l.error + ')' : ''}`);
  const spare = await FlowStream.create({ post: (url, body, headers) => /"VISIONOS"/.test(body) ? Promise.resolve('{"playabilityStatus":{"status":"UNPLAYABLE"}}') : post(url, body, headers) }).audio(SONG).catch(e => e);
  ok(spare.itag === 251 && spare.client === 'ANDROID_VR', `the spare client: ${spare.client || spare.code + ' ' + spare.message}`);
  if (bad.length) { console.log(`::error::FlowStream: ${bad.join('; ')}`); process.exitCode = 1; }
})().catch(e => { console.log('::error::FlowStream check failed: ' + e.message); process.exitCode = 1; });
