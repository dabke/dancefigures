# DanceFigures

DanceFigures is a party app for **Android Chrome**. The phone camera watches the dance floor, and everyone on it appears as an animated figure instead of the camera image. There are four styles: stick figure, neon skeleton, particles and blocky. Show it full screen on the phone, cast or HDMI-mirror it to a projector, or run it on a laptop with a separate projector window.

* **On-device only.** Pose detection runs locally with MediaPipe (WASM + GPU). No frame or sound is uploaded or stored.
* **Fully offline after the first visit.** The app code, the WASM runtime and both pose models are precached by a service worker.
* **No accounts, API keys, analytics or CDNs.** See [DEPENDENCIES.md](DEPENDENCIES.md).

---

## Quick start (developer)

Requires Node.js ≥ 20.19 (22 LTS recommended).

```bash
npm install          # install dependencies
npm run dev          # dev server at http://localhost:5173 (copies WASM + icons first)
npm test             # unit tests (One Euro filter, tracker, beat envelope)
npm run build        # type-check + production build into dist/ + verify precache manifest
npm run preview      # serve dist/ at http://localhost:4173 (service worker active)
npm run test:e2e     # end-to-end smoke test against dist/ (uses your installed Chrome)
```

`npm run build` ends with `scripts/verify-dist.mjs`. It fails the build if `dist/` is missing the `.wasm` or `.task` files, or if the service-worker precache list doesn't include every asset.

### Project layout

```
index.html, projector.html     two entry pages (control/main and projector output)
src/
  main.ts            app controller: start screen, loops, lifecycle, settings wiring
  camera.ts          getUserMedia 1280x720 → 640x480 fallback, front/back, friendly errors
  pose.ts            PoseLandmarker (VIDEO mode), GPU→CPU fallback, rVFC loop with frame skipping
  tracker.ts         person tracking (torso-center matching), colors, fade in/out
  oneEuro.ts         One Euro filter + strength mapping
  audio.ts           mic → AnalyserNode → bass energy → beat envelope
  projector.ts       BroadcastChannel link to the projector window
  projector-main.ts  projector window entry
  settings.ts        settings model + localStorage persistence
  ui.ts              settings slide-over, HUD, toasts, swipe gestures
  device.ts          wake lock, fullscreen, landscape lock
  pwa.ts             service worker registration, offline-ready / update prompts
  renderer/          Renderer, skeleton geometry, 4 styles, backgrounds, palettes
public/models/       pose_landmarker_lite.task, pose_landmarker_full.task (committed)
public/mediapipe/    WASM runtime (copied from node_modules at build time, gitignored)
scripts/             copy-wasm, make-icons, verify-dist, e2e, fetch-models
tests/               Vitest unit tests
```

---

## Testing on a phone during development

Phones only allow camera access over **HTTPS** (or on `localhost`). You can do this in two ways:

1. **USB port forwarding (no deploy needed).** Enable *Developer options → USB debugging* on the phone and plug it into your computer. On the computer, open `chrome://inspect/#devices`, click **Port forwarding**, and add `5173 → localhost:5173` (or `4173` for `npm run preview`). On the phone, open `http://localhost:5173` in Chrome. It counts as a secure context, so the camera works. You can also see the phone's console from `chrome://inspect`.
2. **Deploy to Netlify** (below) and open the HTTPS URL on the phone.

---

## Deploy

### Option A: Netlify (free plan)

`netlify.toml` is already set up: the build command is `npm run build` and the publish directory is `dist`. Headers serve `.wasm` as `application/wasm`, send `no-cache` for `sw.js`, the HTML pages and the manifest, and cache the hashed `/assets/*` files forever.

**Manual deploy (drag and drop, no CLI, no Git):**

1. `npm install && npm run build`. You should see `[verify-dist] OK`.
2. Go to <https://app.netlify.com/drop> and log in or sign up (free).
   (From the dashboard, the same page is *Sites → Add new site → Deploy manually*.)
3. Drag the **`dist` folder** (the folder itself, not its contents, and not the project folder) onto the drop zone.
4. Wait for the upload (~30 MB) to finish. Netlify shows a URL like `https://random-name-123.netlify.app`.
5. Optional: *Site configuration → Change site name* to get a nicer URL, e.g. `https://dancefigures-party.netlify.app`.
6. **Updates:** go to the site → *Deploys*, then drag the new `dist` folder onto the "Need to update your site? Drag and drop…" area. Phones that already have the app show **Update available → Reload**.

> A drag-and-drop deploy doesn't run a build. The headers still apply, because `npm run build` writes them into `dist/_headers`, generated from the `[[headers]]` blocks in `netlify.toml`, and Netlify reads that file from the uploaded folder.

**Git-based deploy (automatic builds):** push this repo to GitHub, then in Netlify use *Add new site → Import an existing project* and pick the repo. Netlify reads `netlify.toml` and builds automatically on every push.

**CLI deploy:** `npx netlify-cli login`, then `npx netlify-cli deploy --prod --dir dist`. Never commit `NETLIFY_AUTH_TOKEN`.

### Option B: GitHub Pages (free for public repos)

The build uses a **relative base path** (`base: './'`), so the same `dist/` works at a domain root or under a subpath like `https://<user>.github.io/<repo>/`.

1. Push the repo to GitHub.
2. Go to *Settings → Pages → Build and deployment → Source: **GitHub Actions***.
3. Go to *Actions → "Deploy to GitHub Pages" → Run workflow*. The workflow is `.github/workflows/deploy-pages.yml`, which runs the unit tests and the build, then publishes `dist/`.
4. Your app is at `https://<user>.github.io/<repo>/`.

GitHub Pages can't set custom headers. That's fine, because it serves `.wasm` as `application/wasm` and caches HTML for only 10 minutes.

---

## Installing on Android

1. Open the HTTPS URL in **Chrome** on the phone.
2. Wait for the start screen to show **"✓ Ready for offline use"**. You can see the same status under ⚙ Settings → App.
3. Open the Chrome menu **⋮ → Install app** (some versions say *Add to Home screen → Install*).
4. Launch **DanceFigures** from the home screen. It opens without browser bars, in landscape.

## Verifying offline mode

1. Open the app once **while online** and wait for **"✓ Ready for offline use"**. This means everything is cached: app, projector page, WASM runtime and both models (~30 MB).
2. Close the app completely (swipe it away from recent apps).
3. Turn on **Airplane mode**. If you want to be thorough, also turn Wi-Fi off.
4. Open DanceFigures from the home screen and tap **Start**. Figures should appear as usual.

## Using it at the party

* Tap **Start** and allow the **camera** and **microphone** (the mic is for the beat effect; you can deny it and the rest still works).
* **Tap** the screen to show the buttons: Style · ⟲ switch camera · ⛶ fullscreen · ⚙ settings. They hide after 4 s.
* **Swipe left or right** to change style.
* In ⚙ Settings: style, background, colors, number of people (1–4), Lite/Full model, smoothing, mirror, beat on/off and sensitivity (with a live meter), FPS counter, and a debug camera view. Settings are remembered.
* The screen stays on while the app runs (Screen Wake Lock).

## Connecting a projector or TV

| Setup | How |
|---|---|
| **Phone + HDMI adapter** | Use a USB-C → HDMI adapter. The phone must support DisplayPort Alt Mode; most Samsung Galaxy S/Note, Pixel 8 and newer, and many recent flagships do, but many budget phones don't. Plug in, open DanceFigures, tap **⛶ Fullscreen**. The projector mirrors the phone. |
| **Phone + Cast** | Android quick settings → **Screen Cast / Smart View**, and pick the Chromecast or smart TV. Then tap ⛶ Fullscreen in the app. Casting adds a little latency, which is fine for visuals. |
| **Laptop + second screen** | Open the app URL in Chrome on a laptop with a webcam and the projector connected as an extended display. ⚙ → **Open projector window**, drag the new window onto the projector, then click it (or press **F**) for fullscreen. The first window becomes the control panel. This mode is meant for laptops; on a phone use fullscreen and mirroring. |

Place the phone or webcam where it can see **whole bodies**: high up, 3–6 m from the dancers, in landscape. Use the back camera (⟲) for better quality; it's not mirrored by default.

---

## Troubleshooting

**Black screen / no camera**
* Make sure you're on the **HTTPS** URL (or `localhost`). Plain `http://192.168…` won't get camera access.
* Permission denied: tap the **tune / lock icon** in the address bar → *Permissions* → allow Camera, then tap **Retry**. For the installed app: long-press the icon → App info → Permissions.
* Another app may be using the camera (video calls, the camera app). Close it and tap Retry.
* Turn on ⚙ → *Debug: show camera + raw landmarks* to check what the camera actually sees.

**No figures in the dark**
* Pose detection needs to see bodies. In a very dark room it fails, and party lights that strobe or flicker make it unreliable. Add some soft, steady light on the dance floor (even one lamp or uplight helps). Avoid having bright lights behind the dancers, pointing at the camera.
* People need to be reasonably visible: try to keep at least the upper body in frame and avoid very wide shots where people are tiny.
* Try the **Full** model for difficult scenes (it's slower).

**Low FPS / laggy figures**
* The app shows a hint if the frame rate stays under 20 FPS for several seconds.
* Lower **People** to 1–2, use the **Lite** model, and try the **Stick** style (Neon and Particles draw more).
* Keep the phone cool and plugged in. Phones slow down when they get hot or are in battery saver.
* ⚙ → Performance shows render FPS, detection FPS, inference time and whether the **GPU** or **CPU** is used. "CPU" means the GPU delegate failed and detection will be slower.

**"Update available" doesn't appear / old version keeps loading**
* Open the app online and wait a few seconds. The service worker checks for updates on load and every 30 minutes, then shows **Update available → Reload**.
* If you deployed without `netlify.toml` headers, an old `sw.js` may be cached for a short time. Wait a few minutes and reopen.
* Last resort: Chrome → ⋮ → Settings → Site settings → *your site* → **Clear & reset**, then open the URL online again and wait for "Ready for offline use".

**"Ready for offline use" never appears**
* The first visit downloads about 30 MB. Stay on the page with a working connection until the message appears.
* Incognito mode and some data-saver settings block service workers.

**No beat reaction**
* Allow the microphone (address-bar tune icon → Permissions). Increase **Sensitivity**. The meter under the slider should move with the bass.
* The mic gets bass best when the phone is in the room with the speakers, not right next to them (clipping).

---

## Privacy

Camera frames go from the `<video>` element straight into the on-device pose model. Only the resulting joint coordinates are used for drawing. With the projector window, only those coordinates are sent, over a same-device `BroadcastChannel`. Microphone audio is analysed for bass energy in memory and never recorded. When you leave or hide the app, the camera and mic are turned off.
