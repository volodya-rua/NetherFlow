// NetherFlow - Copyright (C) 2026 Volodya.rua - GNU GPL v3 only, with additional terms (credit, name and logo): see LICENSE and NOTICE.
// NetherFlow Lite for Windows: everything but Extreme+ (no Redline theme, its 3D race, three.js, the circuits' maps or
// the cars: about 18 MB smaller). Its own file names, and its own update channel (lite.yml), so a Lite install updates
// to Lite. The app knows it's Lite from package.json's "lite" (main.js), and tells the page (preload.js).
// Build: npx electron-builder --win --publish never --config tools/lite-build.js
const base = require('../package.json').build;
module.exports = {
  ...base,
  extraMetadata: { lite: true },
  files: base.files.filter(f => !f.startsWith('race')),
  directories: { output: 'dist/lite' },
  nsis: { ...base.nsis, artifactName: 'NetherFlow-Lite-Setup-${version}.exe' },
  portable: { artifactName: 'NetherFlow-Lite.exe' },
  publish: base.publish.map(p => ({ ...p, channel: 'lite' })),
};
