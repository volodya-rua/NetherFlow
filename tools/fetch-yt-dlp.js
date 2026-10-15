// NetherFlow - Copyright (C) 2026 Volodya.rua - GNU GPL v3 only, with additional terms (credit, name and logo): see LICENSE and NOTICE.
// Downloads the yt-dlp the desktop app ships with, from yt-dlp's official release, and checks it against the release's
// published SHA-256 before keeping it. Windows: vendor/yt-dlp/yt-dlp.exe; Linux (node tools/fetch-yt-dlp.js linux, or
// run on Linux): yt-dlp_linux, kept as vendor/yt-dlp/yt-dlp. Run: npm run fetch-yt-dlp
// To move to a newer yt-dlp: change VERSION and the SHA-256s (from the release's SHA2-256SUMS, at
// https://github.com/yt-dlp/yt-dlp/releases).
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const VERSION = '2026.08.19';
const BUILDS = {
  win32: { file: 'yt-dlp.exe', as: 'yt-dlp.exe', sha256: '66674953fe251b89f4d08c5f0e35e0728679bd67ab3d7d05c0562af101dd3e7a' },
  linux: { file: 'yt-dlp_linux', as: 'yt-dlp', sha256: '58162f9bfdc27458ea47bfcb311cf47028f17d8154a8bf7d689861d46399230a' },
};
const B = BUILDS[process.argv[2] || process.platform];
if (!B) { console.error(`no yt-dlp for ${process.argv[2] || process.platform} (win32 or linux)`); process.exit(1); }
const OUT = path.join(__dirname, '..', 'vendor', 'yt-dlp', B.as);

const hash = buf => crypto.createHash('sha256').update(buf).digest('hex');

(async () => {
  if (fs.existsSync(OUT) && hash(fs.readFileSync(OUT)) === B.sha256) return console.log(`yt-dlp ${VERSION} (${B.file}): already here`);
  const url = `https://github.com/yt-dlp/yt-dlp/releases/download/${VERSION}/${B.file}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (hash(buf) !== B.sha256) throw new Error(`${B.file} from ${url} doesn't match the expected SHA-256: not kept`);
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, buf, { mode: 0o755 });
  console.log(`yt-dlp ${VERSION} (${B.file}): downloaded and verified`);
})().catch(e => { console.error(e.message); process.exit(1); });
