// End-to-end smoke test against the production build (dist/), using the locally
// installed Google Chrome via Playwright (no browser download needed).
//
//  1. Serves dist/ with `vite preview` (localhost is a secure context).
//  2. Builds a fake camera feed (two people side by side) from a sample photo.
//  3. Online: service worker registers, precache completes ("Ready for offline use").
//  4. Start -> camera -> PoseLandmarker produces landmarks -> tracker -> renderer draws
//     every style without errors. Screenshots go to tests/output/.
//  5. Settings persist across reloads.
//  6. Projector window receives frames over BroadcastChannel.
//  7. Offline: reload with the network cut; app shell, WASM and model load from cache
//     and detection still works.
//
// Usage: npm run build && npm run test:e2e
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const PORT = 4173;
const URL_ = `http://localhost:${PORT}/`;
const FIX = resolve('tests/fixtures');
const OUT = resolve('tests/output');
const PHOTO = `${FIX}/pose.jpg`;
const FAKE_VIDEO = `${FIX}/two-people.mjpeg`;
mkdirSync(FIX, { recursive: true });
mkdirSync(OUT, { recursive: true });

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? '  ✓' : '  ✗'} ${name}${detail ? ` — ${detail}` : ''}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

if (!existsSync('dist/index.html')) throw new Error('Run `npm run build` first.');

// ---------- fixture: sample photo (MediaPipe's own test image; test-only, not shipped) ----------
if (!existsSync(PHOTO)) {
  const res = await fetch('https://storage.googleapis.com/mediapipe-assets/pose.jpg');
  if (!res.ok) throw new Error('Could not download test photo');
  writeFileSync(PHOTO, Buffer.from(await res.arrayBuffer()));
}

// ---------- server ----------
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', String(PORT), '--strictPort'], {
  stdio: ['ignore', 'pipe', 'pipe'],
});
for (let i = 0; i < 60; i++) {
  try {
    if ((await fetch(URL_)).ok) break;
  } catch { /* not up yet */ }
  await sleep(250);
}

let browser;
try {
  // ---------- fixture: 1280x720 frame with two people, as a single-frame MJPEG ----------
  if (!existsSync(FAKE_VIDEO)) {
    const b = await chromium.launch({ channel: 'chrome' });
    const p = await b.newPage();
    const dataUrl = `data:image/jpeg;base64,${readFileSync(PHOTO).toString('base64')}`;
    const jpeg = await p.evaluate(async (src) => {
      const img = new Image();
      img.src = src;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = 1280; c.height = 720;
      const g = c.getContext('2d');
      g.fillStyle = '#8fb8d8'; g.fillRect(0, 0, 1280, 720);
      // Crop the person (central 60% of the photo) into each half of the frame.
      const sx = img.width * 0.2, sw = img.width * 0.6;
      const dh = 700, dw = (sw / img.height) * dh;
      g.drawImage(img, sx, 0, sw, img.height, 320 - dw / 2, 10, dw, dh);
      g.drawImage(img, sx, 0, sw, img.height, 960 - dw / 2, 10, dw, dh);
      return c.toDataURL('image/jpeg', 0.92).split(',')[1];
    }, dataUrl);
    writeFileSync(FAKE_VIDEO, Buffer.from(jpeg, 'base64'));
    await b.close();
  }

  browser = await chromium.launch({
    channel: 'chrome',
    args: [
      '--use-fake-device-for-media-stream',
      '--use-fake-ui-for-media-stream',
      `--use-file-for-fake-video-capture=${FAKE_VIDEO}`,
      '--autoplay-policy=no-user-gesture-required',
      '--enable-unsafe-swiftshader',
    ],
  });
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    permissions: ['camera', 'microphone'],
  });
  const errors = [];
  const watch = (page, label) => {
    page.on('pageerror', (e) => errors.push(`[${label}] ${e.message}`));
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(`[${label}] console: ${m.text()}`);
    });
  };
  const page = await ctx.newPage();
  watch(page, 'main');

  // Track every network request to prove nothing is loaded from a CDN.
  const external = [];
  ctx.on('request', (r) => {
    if (!r.url().startsWith(URL_) && !r.url().startsWith('data:') && !r.url().startsWith('blob:')) external.push(r.url());
  });

  console.log('\n[1] Online load + service worker precache');
  await page.goto(URL_);
  const swOk = await page.evaluate(async () => !!(await navigator.serviceWorker.ready));
  check('service worker registers and activates', swOk);
  await page.waitForFunction(() => /Ready for offline use/.test(document.getElementById('start-offline')?.textContent ?? ''), null, { timeout: 180000 });
  check('"Ready for offline use" indicator shown after precache', true);
  const cached = await page.evaluate(async () => {
    const out = [];
    for (const name of await caches.keys()) {
      const c = await caches.open(name);
      for (const req of await c.keys()) out.push(new URL(req.url).pathname);
    }
    return out;
  });
  for (const f of ['vision_wasm_internal.wasm', 'vision_wasm_internal.js', 'pose_landmarker_lite.task', 'pose_landmarker_full.task', 'projector.html', 'index.html']) {
    check(`cache contains ${f}`, cached.some((u) => u.endsWith(f)));
  }

  console.log('\n[2] Start -> camera -> pose detection -> tracking -> rendering');
  await page.click('#btn-start');
  await page.waitForFunction(() => window.__dancefigures?.running, null, { timeout: 60000 });
  check('Start button starts the pipeline', true);
  await page.waitForFunction(() => window.__dancefigures.rawPoses >= 1, null, { timeout: 60000 }).catch(() => {});
  await sleep(3000);
  const stats = await page.evaluate(() => {
    const d = window.__dancefigures;
    return { rawPoses: d.rawPoses, people: d.people, detectFps: d.detectFps, inferenceMs: d.inferenceMs, delegate: d.delegate, renderFps: d.renderFps };
  });
  check('PoseLandmarker produces landmarks from the fake camera', stats.rawPoses >= 1, `raw poses=${stats.rawPoses}`);
  check('both people in the frame are detected and tracked', stats.people >= 2, `tracked=${stats.people}`);
  check('detection loop running', stats.detectFps > 0, `${stats.detectFps.toFixed(1)} det fps, ${stats.inferenceMs.toFixed(1)} ms/inference, delegate=${stats.delegate}`);
  check('render loop running', stats.renderFps > 0, `${stats.renderFps.toFixed(1)} render fps (headless, software GL)`);

  // ID stability: sample tracked count repeatedly; static scene must not churn IDs.
  const churn = await page.evaluate(async () => {
    const counts = [];
    for (let i = 0; i < 20; i++) { counts.push(window.__dancefigures.people); await new Promise((r) => setTimeout(r, 100)); }
    return counts;
  });
  check('tracked person count stays stable over 2 s', Math.max(...churn) - Math.min(...churn) === 0, `counts=${[...new Set(churn)].join(',')}`);

  for (const style of ['neon', 'stick', 'particles', 'blocky']) {
    await page.evaluate((s) => {
      const btn = document.querySelector(`#panel-body button[data-key="style"][data-value="${s}"]`);
      btn.click();
    }, style);
    await sleep(600);
    await page.screenshot({ path: `${OUT}/style-${style}.png` });
    // Canvas must contain colored (non-background) pixels where figures are drawn.
    const lit = await page.evaluate(() => {
      const c = document.getElementById('stage');
      const g = document.createElement('canvas');
      g.width = 160; g.height = 90;
      const x = g.getContext('2d');
      x.drawImage(c, 0, 0, 160, 90);
      const d = x.getImageData(0, 0, 160, 90).data;
      let n = 0;
      for (let i = 0; i < d.length; i += 4) if (d[i] + d[i + 1] + d[i + 2] > 300) n++;
      return n;
    });
    check(`style "${style}" draws figures`, lit > 20, `${lit} bright px`);
  }
  for (const bg of ['black', 'beat', 'gradient']) {
    await page.evaluate((b) => document.querySelector(`#panel-body button[data-key="background"][data-value="${b}"]`).click(), bg);
    await sleep(300);
  }
  await page.screenshot({ path: `${OUT}/background-gradient.png` });
  check('backgrounds switch without errors', true);

  // Debug camera view.
  await page.evaluate(() => document.querySelector('#panel-body button[data-key="debugCamera"]').click());
  await sleep(800);
  await page.screenshot({ path: `${OUT}/debug-camera.png` });
  await page.evaluate(() => document.querySelector('#panel-body button[data-key="debugCamera"]').click());
  check('debug camera overlay renders', true, 'see tests/output/debug-camera.png');

  // Settings panel screenshot.
  await page.click('body', { position: { x: 640, y: 360 } });
  await page.click('#btn-settings');
  await sleep(400);
  await page.screenshot({ path: `${OUT}/settings-panel.png` });
  await page.click('#panel-close');

  console.log('\n[3] Settings persistence');
  await page.evaluate(() => {
    document.querySelector('#panel-body button[data-key="palette"][data-value="fire"]').click();
    document.querySelector('#panel-body button[data-key="numPoses"][data-value="2"]').click();
  });
  await page.reload();
  const persisted = await page.evaluate(() => JSON.parse(localStorage.getItem('dancefigures.settings.v1')));
  const pressed = await page.evaluate(() =>
    document.querySelector('#panel-body button[data-key="palette"][data-value="fire"]').getAttribute('aria-pressed'));
  check('settings persist in localStorage and restore on reload', persisted.palette === 'fire' && persisted.numPoses === 2 && pressed === 'true');
  await page.evaluate(() => document.querySelector('#panel-body button[data-key="numPoses"][data-value="3"]').click());

  console.log('\n[4] Projector window (BroadcastChannel)');
  await page.click('#btn-start');
  await page.waitForFunction(() => window.__dancefigures?.running, null, { timeout: 60000 });
  await page.waitForFunction(() => window.__dancefigures.people >= 1, null, { timeout: 30000 }).catch(() => {});
  const [proj] = await Promise.all([
    ctx.waitForEvent('page'),
    page.evaluate(() => [...document.querySelectorAll('#panel-body button.action')].find((b) => b.textContent.includes('projector')).click()),
  ]);
  watch(proj, 'projector');
  await proj.waitForLoadState();
  await page.waitForFunction(() => !document.getElementById('control-mode').hidden, null, { timeout: 10000 }).catch(() => {});
  await sleep(1500);
  const controlMode = await page.evaluate(() => !document.getElementById('control-mode').hidden);
  const projWaiting = await proj.evaluate(() => document.getElementById('waiting').hidden === false);
  await proj.screenshot({ path: `${OUT}/projector-window.png` });
  await page.screenshot({ path: `${OUT}/control-window.png` });
  check('control window switches to controls-only mode', controlMode);
  check('projector window receives and renders frames', !projWaiting, 'see tests/output/projector-window.png');
  await proj.close();
  await sleep(2500);
  check('control window resumes drawing after projector closes', await page.evaluate(() => document.getElementById('control-mode').hidden));

  console.log('\n[5] Offline');
  check('no requests to external hosts (CDN etc.) while online', external.length === 0, external.slice(0, 3).join(', '));
  await ctx.setOffline(true);
  await page.reload();
  const shell = await page.evaluate(() => !!document.getElementById('btn-start'));
  check('app shell loads offline', shell);
  await page.click('#btn-start');
  await page.waitForFunction(() => window.__dancefigures?.running, null, { timeout: 60000 }).catch(() => {});
  await page.waitForFunction(() => window.__dancefigures.rawPoses >= 1, null, { timeout: 60000 }).catch(() => {});
  const offStats = await page.evaluate(() => ({ running: window.__dancefigures.running, raw: window.__dancefigures.rawPoses }));
  check('WASM + model load offline and detection works', offStats.running && offStats.raw >= 1, `raw poses=${offStats.raw}`);
  const p2 = await ctx.newPage();
  await p2.goto(`${URL_}projector.html`);
  check('projector page loads offline', await p2.evaluate(() => !!document.getElementById('stage')));
  await p2.close();
  await page.screenshot({ path: `${OUT}/offline-running.png` });

  // Ignore errors caused deliberately by the offline phase (e.g. SW update checks).
  const real = errors.filter((e) => !/ERR_INTERNET_DISCONNECTED|Failed to fetch|net::ERR/.test(e));
  check('no page errors / console errors', real.length === 0, real.slice(0, 5).join(' | '));
} finally {
  await browser?.close();
  server.kill();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
writeFileSync(`${OUT}/e2e-results.json`, JSON.stringify(results, null, 2));
process.exit(failed.length ? 1 : 0);
