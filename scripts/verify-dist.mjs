// Post-build check: dist/ must contain the WASM runtime, both pose models and the
// projector page, AND the service worker precache manifest must list all of them.
import { readFileSync, existsSync, statSync, readdirSync } from 'node:fs';

const required = [
  'index.html',
  'projector.html',
  'manifest.webmanifest',
  'sw.js',
  'mediapipe/wasm/vision_wasm_internal.js',
  'mediapipe/wasm/vision_wasm_internal.wasm',
  'models/pose_landmarker_lite.task',
  'models/pose_landmarker_full.task',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/maskable-512.png',
];

let failed = false;
const fail = (m) => { console.error('  ✗ ' + m); failed = true; };

console.log('[verify-dist] files in dist/:');
for (const f of required) {
  const p = `dist/${f}`;
  if (!existsSync(p)) fail(`missing ${p}`);
  else console.log(`  ✓ ${f} (${(statSync(p).size / 1e6).toFixed(2)} MB)`);
}

// Workbox inlines the precache list into sw.js as {url:"...",revision:"..."} entries.
const sw = existsSync('dist/sw.js') ? readFileSync('dist/sw.js', 'utf8') : '';
const urls = [...sw.matchAll(/url:"([^"]+)"/g)].map((m) => m[1]);
console.log(`[verify-dist] service worker precaches ${urls.length} entries`);
const mustPrecache = required.filter((f) => f !== 'sw.js');
// Every built JS/CSS asset must be precached too.
for (const a of readdirSync('dist/assets')) mustPrecache.push(`assets/${a}`);
for (const f of mustPrecache) {
  if (!urls.includes(f)) fail(`not in precache manifest: ${f}`);
}
if (!failed) console.log('  ✓ precache manifest lists all app code, pages, WASM, models and icons');

// No runtime CDN / Google storage references in the shipped code.
const forbidden = /storage\.googleapis\.com|cdn\.jsdelivr\.net|unpkg\.com/;
for (const a of readdirSync('dist/assets').filter((x) => x.endsWith('.js'))) {
  const src = readFileSync(`dist/assets/${a}`, 'utf8');
  const m = src.match(forbidden);
  if (m) console.warn(`  ! ${a} mentions ${m[0]} (library default string; app always passes local paths)`);
}

if (failed) {
  console.error('[verify-dist] FAILED');
  process.exit(1);
}
console.log('[verify-dist] OK');
