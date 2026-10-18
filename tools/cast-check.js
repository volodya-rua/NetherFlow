// NetherFlow - Copyright (C) 2026 Volodya.rua - GNU GPL v3 only, with additional terms (credit, name and logo): see LICENSE and NOTICE.
// A self-check for cast.js, finding TVs and speakers and its Cast messages:  node tools/cast-check.js
// No network: the house's answers made here, as a Chromecast's (mDNS) and a DLNA speaker's (SSDP, its description) are.
const assert = require('assert');
const NFCast = require('../cast.js'), { mdnsQuery, mdnsParse, castFrame, castRead, privateHost, hms, secs } = NFCast._test;

// an mDNS answer: PTR, SRV (port 8009), TXT (id, md, fn), A
const name = n => Buffer.concat([...n.split('.').map(p => Buffer.concat([Buffer.from([p.length]), Buffer.from(p)])), Buffer.from([0])]);
const rr = (n, type, data) => { const h = Buffer.alloc(10); h.writeUInt16BE(type, 0); h.writeUInt16BE(1, 2); h.writeUInt32BE(120, 4); h.writeUInt16BE(data.length, 8); return Buffer.concat([name(n), h, data]); };
const txt = l => Buffer.concat(l.map(s => Buffer.concat([Buffer.from([Buffer.byteLength(s)]), Buffer.from(s)])));
const head = Buffer.alloc(12); head.writeUInt16BE(0x8400, 2); head.writeUInt16BE(4, 6);
const inst = 'Living-Room-TV-1a2b._googlecast._tcp.local', srv = Buffer.concat([Buffer.from([0, 0, 0, 0, 0x1f, 0x49]), name('1a2b.local')]);
const answer = new Uint8Array(Buffer.concat([head, rr('_googlecast._tcp.local', 12, name(inst)), rr(inst, 33, srv), rr(inst, 16, txt(['id=1a2b', 'md=Chromecast', 'fn=Living Room TV'])), rr('1a2b.local', 1, Buffer.from([192, 168, 1, 20]))]));
assert.deepStrictEqual(mdnsParse(answer), { name: 'Living Room TV', model: 'Chromecast', port: 8009, cast: true, id: '1a2b' });
assert.strictEqual(mdnsParse(new Uint8Array(mdnsQuery('_other._tcp.local'))), null, 'a question is no answer');

// a Cast message there and back (its 4-byte length, then the CastMessage)
const f = castFrame('sender-nf', 'receiver-0', 'urn:x-cast:com.google.cast.receiver', { type: 'LAUNCH', appId: 'CC1AD845', requestId: 1 });
assert.strictEqual(new DataView(f.buffer).getUint32(0), f.length - 4);
const m = castRead(f.subarray(4));
assert.deepStrictEqual([m.src, m.dst, m.ns, JSON.parse(m.payload).appId], ['sender-nf', 'receiver-0', 'urn:x-cast:com.google.cast.receiver', 'CC1AD845']);

// only the house: never anywhere on the internet
for (const h of ['192.168.1.20', '10.0.0.5', '172.16.4.1', '172.31.255.255']) assert(privateHost(h), h);
for (const h of ['8.8.8.8', '172.32.0.1', '127.0.0.1', 'evil.example', '192.168.1.20.evil.example']) assert(!privateHost(h), h);
assert.strictEqual(hms(3725), '1:02:05'); assert.strictEqual(secs('1:02:05.500'), 3725.5);

// finding them: the TV by mDNS, the speaker by SSDP and its description; one address on the internet, ignored
const desc = `<root><device><friendlyName>Bedroom &amp; Speaker</friendlyName><manufacturer>Acme</manufacturer><modelName>One</modelName><serviceList>
<service><serviceType>urn:schemas-upnp-org:service:AVTransport:1</serviceType><controlURL>/av</controlURL></service>
<service><serviceType>urn:schemas-upnp-org:service:RenderingControl:1</serviceType><controlURL>rc</controlURL></service></serviceList></device></root>`;
const ssdp = loc => new TextEncoder().encode(`HTTP/1.1 200 OK\r\nLOCATION: ${loc}\r\nST: urn:schemas-upnp-org:device:MediaRenderer:1\r\n\r\n`);
const net = {
  udp: async (g, port) => port === 5353 ? [{ from: '192.168.1.20', data: answer }, { from: '8.8.8.8', data: answer }]
    : [{ from: '192.168.1.30', data: ssdp('http://192.168.1.30:49152/desc.xml') }, { from: '192.168.1.31', data: ssdp('http://93.184.216.34/desc.xml') }],
  http: async (method, url) => { assert(privateHost(new URL(url).hostname), 'asked the internet: ' + url); return { status: 200, text: desc }; },
};
NFCast.create({ net }).devices(10).then(list => {
  assert.deepStrictEqual(list.map(d => [d.kind, d.name, d.host]), [['dlna', 'Bedroom & Speaker', '192.168.1.30'], ['cast', 'Living Room TV', '192.168.1.20']]);
  assert.deepStrictEqual([list[0].av, list[0].rc, list[0].model], ['http://192.168.1.30:49152/av', 'http://192.168.1.30:49152/rc', 'Acme One']);
  assert.throws(() => NFCast.create({ net }).open({ kind: 'cast', host: '8.8.8.8' }), /not a device in the house/);
  console.log('cast.js: ok');
});
