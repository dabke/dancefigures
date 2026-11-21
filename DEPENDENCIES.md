# Dependencies and licenses

Every dependency is free and open source. Nothing needs an API key or account, and nothing is fetched from a CDN at runtime.

## Shipped to the browser (runtime)

| Name | Version | License | What it does |
|---|---|---|---|
| [@mediapipe/tasks-vision](https://www.npmjs.com/package/@mediapipe/tasks-vision) | 1.2.3 | Apache-2.0 | PoseLandmarker JS API plus the WASM runtime (`vision_wasm_internal.js/.wasm`). The WASM is copied into `public/mediapipe/wasm/` at build time and served from our own origin. |
| MediaPipe Pose Landmarker models: `pose_landmarker_lite.task`, `pose_landmarker_full.task` (float16) | "latest" as of 2026-11-21 | Apache-2.0 (see the [MediaPipe Pose Landmarker docs](https://ai.google.dev/edge/mediapipe/solutions/vision/pose_landmarker#models)) | Pose models. They are committed in `public/models/` and served locally. `npm run fetch-models` re-downloads them; this is a developer step only. |
| [workbox-window](https://www.npmjs.com/package/workbox-window) | 7.4.1 | MIT | Service worker registration helper, bundled by vite-plugin-pwa. |
| Workbox runtime (`workbox-precaching`, `workbox-routing`, …), generated into `sw.js` | 7.4.1 | MIT | Precaching and offline serving in the service worker. |

## Build and test tools (development only, not shipped)

| Name | Version | License | Purpose |
|---|---|---|---|
| [vite](https://vitejs.dev) | 8.3.8 | MIT | Dev server and bundler |
| [vite-plugin-pwa](https://vite-pwa-org.netlify.app) | 2.0.0 | MIT | Generates the web manifest and the Workbox service worker |
| [typescript](https://www.typescriptlang.org) | 7.0.2 | Apache-2.0 | Type checking |
| [vitest](https://vitest.dev) | 5.1.1 | MIT | Unit tests |
| [@playwright/test](https://playwright.dev) | 1.65.1 | Apache-2.0 | End-to-end smoke test. It drives the Chrome you already have installed, so no browser download is needed. |

### Transitive packages

I scanned `node_modules` on 2026-11-21. Of the ~360 transitive packages, almost all use MIT, ISC, Apache-2.0, BSD-2/3-Clause, 0BSD or BlueOak-1.0.0. There are two exceptions, and both are free:

- `lightningcss` uses **MPL-2.0**, a weak copyleft license. Vite uses it for CSS tooling at build time only. It is not shipped, and the app doesn't modify it, so MPL places no obligations on this app.
- `caniuse-lite` uses **CC-BY-4.0**. It is browser-support data used by build tooling and is not shipped.

## Test fixture (not in the repo, not shipped)

`scripts/e2e.mjs` downloads `pose.jpg` from the MediaPipe test-assets bucket into `tests/fixtures/` (gitignored). It uses the image only to build a fake camera feed locally. The image is never committed or deployed.

## Policy

Before adding a dependency, add it here with its license and confirm that it is free and open source and needs no account, API key or network access at runtime.
