// NetherFlow - Copyright (C) 2026 Volodya.rua - GNU GPL v3 only, with additional terms (credit, name and logo): see LICENSE and NOTICE.
// A release's Android update file (the app's Settings › Update): update.json, uploaded to the GitHub release with the APK.
//   node tools/update-manifest.js <the release APK> [out file, default dist/update.json]
// Run at the release's commit (its tag v<version>, pushed). It lists the page's files — those `npm run android:web` puts
// in the APK — with each one's SHA-256 and size as the repository has them (the app downloads changed ones from the
// tag, raw), says the oldest APK they can run in (min: the first release with the app's native side as it is now), and
// is signed with the developer's update key: update-key.pem in ~/.netherflow-signing (or NETHERFLOW_SIGNING), never
// in this repository. The app checks that signature against its own copy of the public key (UpdatePlugin.java).
const fs = require('fs'), path = require('path'), crypto = require('crypto'), { execFileSync } = require('child_process');
const root = path.join(__dirname, '..'), git = (...a) => execFileSync('git', a, { cwd: root, encoding: 'utf8', maxBuffer: 64e6 }).trim();
const blob = f => execFileSync('git', ['cat-file', 'blob', 'HEAD:' + f], { cwd: root, maxBuffer: 64e6 });
const [apkPath, outPath = path.join(root, 'dist', 'update.json')] = process.argv.slice(2);
if (!apkPath || !fs.existsSync(apkPath)) throw new Error('usage: node tools/update-manifest.js <the release APK> [out]');
const keyFile = path.join(process.env.NETHERFLOW_SIGNING || path.join(require('os').homedir(), '.netherflow-signing'), 'update-key.pem');
const version = JSON.parse(blob('package.json')).version, gradle = f => +f.match(/versionCode\s+(\d+)/)[1], code = gradle(blob('android/app/build.gradle').toString());
if (git('status', '--porcelain', '--', 'index.html', 'lib.js', 'flowstream.js', 'endverse.js', 'bridgethemusic.js', 'legal.html', 'fonts', 'licenses')) throw new Error('the page has changes not committed: commit them (and tag) first');

// the page's files (as `npm run android:web` copies them)
const list = [...['index.html', 'lib.js', 'flowstream.js', 'endverse.js', 'bridgethemusic.js', 'legal.html', 'logo.png'], ...git('ls-tree', '-r', '--name-only', 'HEAD', '--', 'licenses', 'fonts').split('\n').filter(Boolean)];
const files = {};
for (const f of list.sort()) { const b = blob(f); files[f] = [crypto.createHash('sha256').update(b).digest('hex'), b.length]; }

// min: the app's native side (its Java, Python, resources, manifest, Capacitor's plugins) last changed in some commit; the
// first release with that commit is the oldest APK this page runs in. ponytail: a Capacitor upgrade alone (in
// package.json) isn't seen here — touch something under android/app/src/main with it.
const NATIVE = ['android/app/src/main/java', 'android/app/src/main/python', 'android/app/src/main/res', 'android/app/src/main/AndroidManifest.xml',
  'android/capacitor-cordova-android-plugins', 'android/app/capacitor.build.gradle'];
const last = git('log', '-1', '--format=%H', '--', ...NATIVE);
const first = last && git('tag', '--contains', last, '--sort=version:refname', '--list', 'v*').split('\n').filter(Boolean)[0];
const min = first ? gradle(git('show', `${first}:android/app/build.gradle`)) : code;

const manifest = JSON.stringify({ version, min, base: `https://raw.githubusercontent.com/volodya-rua/NetherFlow/v${version}/`, files });
const sig = crypto.sign('sha256', Buffer.from(manifest), fs.readFileSync(keyFile)).toString('base64');
const apk = fs.readFileSync(apkPath);
const out = { version, code, min, apk: { url: `https://github.com/volodya-rua/NetherFlow/releases/download/v${version}/NetherFlow-${version}.apk`,
  sha256: crypto.createHash('sha256').update(apk).digest('hex'), size: apk.length }, manifest, sig };
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(out, null, 1));
console.log(`update.json: ${version} (APK ${code}; the page runs in APK ${min} and newer), ${list.length} files, ${(Object.values(files).reduce((n, f) => n + f[1], 0) / 1e6).toFixed(1)} MB in all`);
// (checked as the app will check it)
const pub = crypto.createPublicKey(fs.readFileSync(keyFile)).export({ type: 'spki', format: 'der' }).toString('base64');
console.assert(crypto.verify('sha256', Buffer.from(out.manifest), { key: Buffer.from(pub, 'base64'), format: 'der', type: 'spki' }, Buffer.from(out.sig, 'base64')), 'signature broken');
