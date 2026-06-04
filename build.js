#!/usr/bin/env node
// Archive Master — Build Script
// Usage: node build.js chrome | node build.js firefox | node build.js all

'use strict';

const fs   = require('fs');
const path = require('path');

const ROOT = __dirname;
const SRC  = path.join(ROOT, 'src');
const DIST = path.join(ROOT, 'dist');

function cp(src, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
}

function cpDir(srcDir, destDir) {
  if (!fs.existsSync(srcDir)) return;
  fs.mkdirSync(destDir, { recursive: true });
  for (const entry of fs.readdirSync(srcDir)) {
    const s = path.join(srcDir, entry);
    const d = path.join(destDir, entry);
    if (fs.statSync(s).isDirectory()) cpDir(s, d);
    else cp(s, d);
  }
}

function buildChrome() {
  const dest = path.join(DIST, 'chrome');
  fs.rmSync(dest, { recursive: true, force: true });
  fs.mkdirSync(dest, { recursive: true });

  // Manifest
  cp(path.join(ROOT, 'manifests', 'manifest.chrome.json'), path.join(dest, 'manifest.json'));

  // Source files
  cpDir(path.join(SRC, 'background'), path.join(dest, 'background'));
  cpDir(path.join(SRC, 'content'),    path.join(dest, 'content'));
  cpDir(path.join(SRC, 'offscreen'),  path.join(dest, 'offscreen'));
  cpDir(path.join(SRC, 'popup'),      path.join(dest, 'popup'));
  cpDir(path.join(SRC, 'lib'),        path.join(dest, 'lib'));

  // Icons
  cpDir(path.join(ROOT, 'icons'), path.join(dest, 'icons'));

  // Chrome doesn't need the Firefox content script
  const ffScript = path.join(dest, 'content', 'content-script-ff.js');
  if (fs.existsSync(ffScript)) fs.rmSync(ffScript);

  // Remove the old monolithic content script (replaced by main + bridge)
  const oldCs = path.join(dest, 'content', 'content-script.js');
  if (fs.existsSync(oldCs)) fs.rmSync(oldCs);

  // Chrome doesn't use background-page.js
  const ffBg = path.join(dest, 'background', 'background-page.js');
  if (fs.existsSync(ffBg)) fs.rmSync(ffBg);

  console.log('✓ Chrome build → dist/chrome/');
}

function buildFirefox() {
  const dest = path.join(DIST, 'firefox');
  fs.rmSync(dest, { recursive: true, force: true });
  fs.mkdirSync(dest, { recursive: true });

  // Manifest
  cp(path.join(ROOT, 'manifests', 'manifest.firefox.json'), path.join(dest, 'manifest.json'));

  // Source files (no offscreen for Firefox)
  cpDir(path.join(SRC, 'background'), path.join(dest, 'background'));
  cpDir(path.join(SRC, 'content'),    path.join(dest, 'content'));
  cpDir(path.join(SRC, 'popup'),      path.join(dest, 'popup'));
  cpDir(path.join(SRC, 'lib'),        path.join(dest, 'lib'));

  // Icons
  cpDir(path.join(ROOT, 'icons'), path.join(dest, 'icons'));

  // Firefox doesn't use Chrome-specific scripts
  const swFile = path.join(dest, 'background', 'service-worker.js');
  if (fs.existsSync(swFile)) fs.rmSync(swFile);

  for (const f of ['content-script-main.js', 'content-bridge.js', 'content-script.js']) {
    const p = path.join(dest, 'content', f);
    if (fs.existsSync(p)) fs.rmSync(p);
  }

  console.log('✓ Firefox build → dist/firefox/');
}

const target = process.argv[2];
if (!target || target === 'all') {
  buildChrome();
  buildFirefox();
} else if (target === 'chrome') {
  buildChrome();
} else if (target === 'firefox') {
  buildFirefox();
} else {
  console.error('Unknown target:', target);
  console.error('Usage: node build.js [chrome|firefox|all]');
  process.exit(1);
}
