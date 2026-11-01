// NetherFlow - Copyright (C) 2026 Volodya.rua - GNU GPL v3 only, with additional terms (credit, name and logo): see LICENSE and NOTICE.
// Adds typefaces from Google Fonts the way fonts/ has them, each family with its own licence text from google/fonts on
// GitHub (licenses/<Family>-OFL.txt or -Apache-2.0.txt, the family's copyright line at its top). Files already there are
// left alone. Then: the family in legal.html's Licenses (Legal's), npm run site:legal, node tools/license-check.js.
//   node tools/font-add.js "Nabla" "Cinzel:wght@900" ...
//       a lyric pair's faces: the latin and latin-ext woff2 files a current Chrome is served
//       (fonts/<Family>-<weight>[i]-<subset>.woff2), their @font-face rules appended to fonts/pairs.css as Google writes them
//   node tools/font-add.js --subset tamil "Anek+Tamil:wdth,wght@75,800" ...
//       a face for another script (fonts/scripts.css, laid out by hand, a family per mood): only that subset's file, named
//       with its width when it has one (AnekTamil-800-w75-tamil.woff2), and its unicode-range printed for the rule
//   node tools/font-add.js --ttf "Monoton" ...
//       a family whose licence reserves its name (a Reserved Font Name): its original files from google/fonts, byte for
//       byte, and their rules in fonts/pairs.css with no unicode-range. Cut down to a subset or turned into woff2 it would
//       be a Modified Version, which may not carry the name (Legal, 1.6.3)
// (a Chrome's user agent: css2 answers by it, and anything else is served a colour font's flat fallback — the colours lost)
// ponytail: a spec pinning every axis gives a static face, a range a variable one (named by its range, e.g.
// Foldit-100_900-latin.woff2).
const fs = require('fs'), path = require('path');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36';
const args = process.argv.slice(2), opt = k => { const i = args.indexOf(k); return i < 0 ? null : args.splice(i, k === '--ttf' ? 1 : 2)[k === '--ttf' ? 0 : 1]; };
const ROOT = path.resolve(opt('--root') || path.join(__dirname, '..')), SUBSET = opt('--subset'), TTF = !!opt('--ttf');
const get = async (u, binary) => { const r = await fetch(u, { headers: { 'user-agent': UA } }); if (!r.ok) throw new Error(r.status + ' ' + u); return binary ? Buffer.from(await r.arrayBuffer()) : r.text(); };
const GF = 'https://raw.githubusercontent.com/google/fonts/main/';
// the family's folder in google/fonts: ofl/ or apache/, its name in lower case without spaces
const folder = async fam => { const dir = fam.toLowerCase().replace(/[^a-z0-9]/g, '');
  for (const [lic, file, as] of [['ofl', 'OFL.txt', 'OFL'], ['apache', 'LICENSE.txt', 'Apache-2.0']]) { try { return { dir: `${lic}/${dir}`, as, text: await get(GF + `${lic}/${dir}/${file}`) }; } catch {} }
  throw new Error(`${fam}: no OFL or Apache licence in google/fonts (ofl/${dir}, apache/${dir}): not one fonts/ can take`); };
async function licence(fam, stem) {
  if (fs.readdirSync(path.join(ROOT, 'licenses')).some(f => /-(OFL|Apache-2\.0)\.txt$/.test(f) && f.split('-')[0] === stem)) return;
  const { as, text } = await folder(fam);
  if (as === 'OFL' && !/Copyright/i.test(text.split('This Font Software is licensed')[0])) throw new Error(`${fam}: its OFL.txt has no copyright line`);
  fs.writeFileSync(path.join(ROOT, 'licenses', `${stem}-${as}.txt`), text); console.log(`  licenses/${stem}-${as}.txt`);
}
(async () => {
  if (!args.length) throw new Error('usage: node tools/font-add.js [--root dir] [--subset <script> | --ttf] <family spec> ...');
  const cssFile = path.join(ROOT, 'fonts', 'pairs.css');
  let pairs = fs.readFileSync(cssFile, 'utf8');
  for (const spec of args) {
    if (TTF) { // the family's own files, as google/fonts has them (METADATA.pb lists each with its style and weight)
      const fam = spec.replace(/\+/g, ' '), stem = fam.replace(/[^A-Za-z0-9]/g, ''), { dir } = await folder(fam);
      const meta = await get(GF + dir + '/METADATA.pb');
      for (const [, body] of meta.matchAll(/fonts\s*\{([^}]+)\}/g)) {
        const p = k => (body.match(new RegExp('\\b' + k + ':\\s*"?([^"\\n]+)"?')) || [])[1], name = p('filename'), to = path.join(ROOT, 'fonts', name);
        if (!fs.existsSync(to)) fs.writeFileSync(to, await get(GF + dir + '/' + name, true));
        if (!pairs.includes(`url(${name})`)) pairs += `/* ${fam} (its original file: the licence reserves its name) */\n@font-face {\n  font-family: '${fam}';\n  font-style: ${p('style')};\n  font-weight: ${p('weight')};\n  font-display: swap;\n  src: url(${name}) format('truetype');\n}\n`;
        console.log('  ' + name + ' ' + (fs.statSync(to).size / 1024).toFixed(1) + ' KB');
      }
      await licence(fam, stem); console.log(fam + ': done'); continue;
    }
    const css = await get(`https://fonts.googleapis.com/css2?family=${spec}&display=swap`);
    const faces = [...css.matchAll(/\/\*\s*([\w-]+)\s*\*\/\s*@font-face\s*\{([^}]+)\}/g)].map(([, subset, body]) => {
      const p = k => (body.match(new RegExp('\\b' + k + ':\\s*([^;]+);')) || [])[1];
      return { subset, family: p('font-family').replace(/'/g, ''), style: p('font-style'), weight: p('font-weight'), stretch: p('font-stretch'), src: body.match(/url\(([^)]+)\)/)[1], range: p('unicode-range') };
    }).filter(f => SUBSET ? f.subset === SUBSET : ['latin-ext', 'latin'].includes(f.subset));
    if (!faces.length) throw new Error(`no ${SUBSET || 'latin'} faces for ${spec}`);
    const fam = faces[0].family, stem = fam.replace(/[^A-Za-z0-9]/g, '');
    // (font matching tries font-stretch before font-style: an upright face at 75% beside an italic at 100% and the
    // sung line, which asks for 100%, gets the italic — ask for one width for every style of a family)
    if (new Set(faces.map(f => f.stretch || '')).size > 1) throw new Error(`${fam}: its faces have different widths (font-stretch ${[...new Set(faces.map(f => f.stretch))].join(', ')}): pin the same wdth for every style`);
    for (const f of faces) {
      const w = f.stretch && f.stretch !== '100%' ? '-w' + f.stretch.replace(/[% ]/g, '') : '';
      const name = `${stem}-${String(f.weight).replace(' ', '_')}${f.style === 'italic' ? 'i' : ''}${w}-${f.subset}.woff2`, to = path.join(ROOT, 'fonts', name);
      if (!fs.existsSync(to)) fs.writeFileSync(to, await get(f.src, true));
      if (SUBSET) console.log(`  ${name} ${(fs.statSync(to).size / 1024).toFixed(1)} KB, ${f.style} ${f.weight}${f.stretch ? ' ' + f.stretch : ''}: unicode-range: ${f.range};`);
      else {
        if (!pairs.includes(`url(${name})`)) pairs += `/* ${fam} ${f.subset} */\n@font-face {\n  font-family: '${fam}';\n  font-style: ${f.style};\n  font-weight: ${f.weight};\n` +
          (f.stretch ? `  font-stretch: ${f.stretch};\n` : '') + `  font-display: swap;\n  src: url(${name}) format('woff2');\n  unicode-range: ${f.range};\n}\n`;
        console.log('  ' + name + ' ' + (fs.statSync(to).size / 1024).toFixed(1) + ' KB');
      }
    }
    await licence(fam, stem);
    console.log(fam + ': done');
  }
  fs.writeFileSync(cssFile, pairs);
})().catch(e => { console.error(e.message); process.exitCode = 1; });
