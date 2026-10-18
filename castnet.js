// NetherFlow - Copyright (C) 2026 Volodya.rua - GNU GPL v3 only, with additional terms (credit, name and logo): see LICENSE and NOTICE.
// The house's network for casting (cast.js, in the page, through preload.js): a question sent to the devices in the house
// (UDP, its answers gathered for a moment), a Cast device's TLS connection (its own certificate taken: a TV's is made by
// itself), and HTTP to a DLNA device. Only to addresses in the house — never anywhere on the internet.
const dgram = require('dgram'), tls = require('tls'), http = require('http');
const privateHost = h => /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.)\d+\.\d+(\.\d+)?$/.test(h || '');
const GROUPS = new Set(['224.0.0.251:5353', '239.255.255.250:1900']); // (mDNS, SSDP: the only questions it asks)

function udp(group, port, bytes, ms) {
  if (!GROUPS.has(group + ':' + port)) return Promise.reject(new Error('not a question it asks'));
  return new Promise(res => {
    const got = [], s = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    s.on('message', (m, r) => { if (privateHost(r.address) && got.length < 200) got.push({ from: r.address, data: new Uint8Array(m) }); });
    s.on('error', () => { try { s.close(); } catch {} res(got); });
    s.bind(0, () => { try { s.setMulticastTTL(2); } catch {} for (const at of [0, 600, 1300]) setTimeout(() => { try { s.send(Buffer.from(bytes), port, group); } catch {} }, at); });
    setTimeout(() => { try { s.close(); } catch {} res(got); }, Math.min(Math.max(ms || 2500, 500), 8000));
  });
}
function tlsOpen(host, port, onData, onClose) {
  return new Promise((ok, no) => {
    if (!privateHost(host)) return no(new Error('not a device in the house'));
    let up = false;
    const s = tls.connect({ host, port: +port || 8009, rejectUnauthorized: false, timeout: 8000 }, () => { up = true; s.setTimeout(0); ok({ write: b => s.write(Buffer.from(b)), close: () => s.destroy() }); }); // (a TV makes its own certificate)
    s.on('data', d => onData(new Uint8Array(d)));
    s.on('error', er => { if (!up) no(er); });
    s.on('close', () => { if (up) onClose(); });
    s.on('timeout', () => s.destroy(new Error('the device didn\'t answer')));
  });
}
function httpReq(method, url, headers, body) {
  return new Promise((ok, no) => {
    let u; try { u = new URL(url); } catch { return no(new Error('a strange address')); }
    if (u.protocol !== 'http:' || !privateHost(u.hostname) || !/^(GET|POST)$/.test(method)) return no(new Error('not a device in the house'));
    const req = http.request(u, { method, headers: { ...headers, ...(body && { 'Content-Length': Buffer.byteLength(body) }) }, timeout: 8000 }, r => {
      const parts = []; let n = 0;
      r.on('data', c => { n += c.length; if (n < 2e6) parts.push(c); }); // (a description or an answer: small)
      r.on('end', () => ok({ status: r.statusCode, text: Buffer.concat(parts).toString('utf8') }));
    });
    req.on('timeout', () => req.destroy(new Error('the device didn\'t answer'))); req.on('error', no);
    req.end(body || undefined);
  });
}

function register(ipcMain, getWin) {
  const socks = new Map(); let next = 1;
  const mine = e => { const w = getWin(); return w && !w.isDestroyed() && e.sender === w.webContents; };
  ipcMain.handle('cast-udp', (e, group, port, bytes, ms) => mine(e) ? udp(String(group), +port, bytes, +ms) : []);
  ipcMain.handle('cast-tls-open', async (e, host, port) => {
    if (!mine(e)) throw new Error('not this window');
    const id = next++, w = getWin(), send = (...a) => { if (!w.isDestroyed()) w.webContents.send(...a); };
    socks.set(id, await tlsOpen(String(host), +port, d => send('cast-tls-data', id, d), () => { socks.delete(id); send('cast-tls-close', id); }));
    return id;
  });
  ipcMain.on('cast-tls-write', (e, id, bytes) => { if (mine(e)) socks.get(id)?.write(bytes); });
  ipcMain.on('cast-tls-close', (e, id) => { if (mine(e)) { socks.get(id)?.close(); socks.delete(id); } });
  ipcMain.handle('cast-http', (e, method, url, headers, body) => mine(e) ? httpReq(String(method), String(url), headers || {}, body ? String(body) : '') : Promise.reject(new Error('not this window')));
}
module.exports = { register, net: { udp, tls: tlsOpen, http: httpReq }, privateHost };
