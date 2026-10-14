// Downloads the yt-dlp.exe that the Windows app ships with (vendor/yt-dlp/yt-dlp.exe), from yt-dlp's official
// release, and checks it against the release's published SHA-256 before keeping it. Run: npm run fetch-yt-dlp
// To move to a newer yt-dlp: change VERSION and SHA256 (both from https://github.com/yt-dlp/yt-dlp/releases).
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const VERSION = '2026.08.19';
const SHA256 = '66674953fe251b89f4d08c5f0e35e0728679bd67ab3d7d05c0562af101dd3e7a';
const OUT = path.join(__dirname, '..', 'vendor', 'yt-dlp', 'yt-dlp.exe');

const hash = buf => crypto.createHash('sha256').update(buf).digest('hex');

(async () => {
  if (fs.existsSync(OUT) && hash(fs.readFileSync(OUT)) === SHA256) return console.log(`yt-dlp ${VERSION}: already here`);
  const url = `https://github.com/yt-dlp/yt-dlp/releases/download/${VERSION}/yt-dlp.exe`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (hash(buf) !== SHA256) throw new Error(`yt-dlp.exe from ${url} doesn't match the expected SHA-256: not kept`);
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, buf);
  console.log(`yt-dlp ${VERSION}: downloaded and verified`);
})().catch(e => { console.error(e.message); process.exit(1); });
