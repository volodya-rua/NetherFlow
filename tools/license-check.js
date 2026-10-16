// NetherFlow - Copyright (C) 2026 Volodya.rua - GNU GPL v3 only, with additional terms (credit, name and logo): see LICENSE and NOTICE.
// Checks that NetherFlow's license notices haven't fallen behind the code: every bundled part has its license text and a
// row on the legal page, the copies are in sync, and every NetherFlow source file has its GPL notice. Run it before each
// release (and after adding a library, font or asset):  node tools/license-check.js   It prints what's wrong, or OK.
const fs = require('fs'), path = require('path'), os = require('os'), { execFileSync } = require('child_process');
process.chdir(path.join(__dirname, '..'));
const problems = [], read = f => fs.readFileSync(f, 'utf8'), legal = read('legal.html');

// 1. The legal page and licenses/: every license text is linked, and every link has its text
const linked = new Set([...legal.matchAll(/href="(licenses\/[^"#]+)"/g)].map(m => m[1]));
for (const f of fs.readdirSync('licenses')) if (!linked.has('licenses/' + f)) problems.push(`licenses/${f} isn't linked from legal.html's Licenses`);
for (const f of linked) if (!fs.existsSync(f)) problems.push(`legal.html links ${f}, which doesn't exist`);

// 2. Every font has its license text: the app's in licenses/, the website's next to it in docs/fonts/
const family = f => f.split('-')[0];
for (const [dir, texts] of [['fonts', 'licenses'], ['docs/fonts', 'docs/fonts']]) {
  const have = fs.readdirSync(texts).filter(f => f.endsWith('.txt')).map(family);
  for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.woff2')))
    if (!have.includes(family(f))) problems.push(`${dir}/${f} has no license text in ${texts}/`);
}

// 3. The copies that must stay identical
const same = (a, b) => { if (read(a) !== read(b)) problems.push(`${b} differs from ${a}`); };
same('NOTICE', 'licenses/NetherFlow-NOTICE.txt');
same('LICENSE', 'licenses/NetherFlow-GPL-3.0.txt');
{ // the website's copy of the legal page, as npm run site:legal would make it
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nf-legal-'));
  fs.mkdirSync(path.join(tmp, 'docs')); fs.mkdirSync(path.join(tmp, 'licenses'));
  fs.copyFileSync('legal.html', path.join(tmp, 'legal.html')); fs.copyFileSync('NOTICE', path.join(tmp, 'NOTICE'));
  execFileSync(process.execPath, [path.resolve('tools/site-legal.js')], { cwd: tmp, stdio: 'ignore' });
  if (read(path.join(tmp, 'docs/legal.html')) !== read('docs/legal.html')) problems.push('docs/legal.html is out of date: run npm run site:legal');
  fs.rmSync(tmp, { recursive: true, force: true });
}

// 4. Every NetherFlow source file starts with the GPL notice (the section 7 terms need it there)
const NOTICE_LINE = 'GNU GPL v3 only, with additional terms';
const THIRD_PARTY = /^(race\/three\/|docs\/vendor\/|android\/app\/src\/(test|androidTest)\/|docs\/google)/;
for (const f of execFileSync('git', ['ls-files', '*.js', '*.html', '*.java', '*.py']).toString().split('\n').filter(Boolean))
  if (!THIRD_PARTY.test(f) && !read(f).split('\n').slice(0, 3).join('\n').includes(NOTICE_LINE)) problems.push(`${f} has no GPL notice at the top`);

// 5. Each car model's author is credited (CC BY 4.0)
for (const c of JSON.parse(read('race/cars.json'))) if (!legal.includes(c.by)) problems.push(`race/cars.json: ${c.by} (${c.name}) isn't credited on legal.html`);

// 7. Every npm package the apps ship has a row on the legal page (build-only tools don't ship)
const SHIPPED_AS = { electron: 'Electron', 'electron-updater': 'electron-updater', three: 'three.js', '@capacitor/core': 'Capacitor', '@capacitor/android': 'Capacitor', '@capacitor/app': 'Capacitor' };
const BUILD_ONLY = ['@capacitor/cli', 'electron-builder'];
const pkg = JSON.parse(read('package.json'));
for (const name of Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }).filter(n => !BUILD_ONLY.includes(n))) {
  const shown = SHIPPED_AS[name];
  if (!shown) problems.push(`new package ${name}: add its license row to legal.html, then add it to SHIPPED_AS (or BUILD_ONLY) here`);
  else if (!legal.includes(shown)) problems.push(`${name} ships but legal.html doesn't mention ${shown}`);
}

if (problems.length) { console.log('License check: ' + problems.length + ' problem(s)\n- ' + problems.join('\n- ')); process.exit(1); }
console.log('License check: OK');
