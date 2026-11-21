import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

export default defineConfig({
  // Relative base: the same build works at a domain root (Netlify) and under a
  // subpath (GitHub Pages, e.g. https://user.github.io/dancefigures/).
  base: './',
  define: {
    __APP_VERSION__: JSON.stringify(`${pkg.version} (${new Date().toISOString().slice(0, 10)})`),
  },
  build: {
    target: 'es2022',
    rollupOptions: {
      input: {
        main: 'index.html',
        projector: 'projector.html',
      },
    },
  },
  server: { host: true }, // reachable from a phone on the same Wi-Fi (camera needs HTTPS there; see README)
  plugins: [
    VitePWA({
      registerType: 'prompt', // show "Update available" instead of silently reloading mid-party
      injectRegister: false, // we register manually in src/pwa.ts
      manifest: {
        name: 'DanceFigures',
        short_name: 'DanceFigures',
        description: 'Turns dancers into animated neon figures. Runs fully on-device and offline.',
        start_url: './',
        scope: './',
        display: 'standalone',
        orientation: 'landscape',
        background_color: '#000000',
        theme_color: '#000000',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Precache EVERYTHING the app needs offline: code, both pages, WASM runtime, pose models.
        globPatterns: ['**/*.{js,css,html,png,svg,ico,webmanifest,wasm,task}'],
        // WASM is ~15 MB and the full model ~9 MB; default limit is 2 MiB.
        maximumFileSizeToCacheInBytes: 64 * 1024 * 1024,
        navigateFallback: 'index.html',
        cleanupOutdatedCaches: true,
        clientsClaim: true, // control the page right after first install
      },
    }),
  ],
});
