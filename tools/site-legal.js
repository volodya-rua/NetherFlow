// The website's copy of the in-app Terms, Privacy & Licenses page (docs/legal.html), so the policy has a public address
// that shows as a page, not as source. Run it after changing legal.html:  npm run site:legal
const fs = require('fs');
const FONTS = '<link rel="stylesheet" href="fonts/fonts.css">';
let s = fs.readFileSync('legal.html', 'utf8');
if (!s.includes(FONTS)) throw new Error('legal.html no longer links fonts/fonts.css: update tools/site-legal.js');
s = s.replace(FONTS, '<style>' + // (the website's own copies of the two typefaces the page uses)
  '@font-face { font-family: "Instrument Serif"; src: url(fonts/InstrumentSerif-400i-latin.woff2) format("woff2"); font-style: italic; font-display: swap; }' +
  '@font-face { font-family: "Martian Mono"; src: url(fonts/MartianMono-latin.woff2) format("woff2"); font-weight: 100 800; font-display: swap; }</style>')
  .replaceAll('href="licenses/', 'href="https://github.com/volodya-rua/NetherFlow/blob/main/licenses/'); // (not on the website)
fs.writeFileSync('docs/legal.html', s);
console.log('docs/legal.html written');
