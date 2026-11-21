// Copies the MediaPipe Tasks Vision WASM runtime from node_modules into
// public/mediapipe/wasm so it is served (and precached) from our own origin.
// Nothing is ever loaded from a CDN at runtime.
import { cpSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'node_modules', '@mediapipe', 'tasks-vision', 'wasm');
const dest = join(root, 'public', 'mediapipe', 'wasm');
mkdirSync(dest, { recursive: true });
// We only use the classic (non-ES-module) loader, so copy just that pair.
for (const f of ['vision_wasm_internal.js', 'vision_wasm_internal.wasm']) {
  if (!existsSync(join(src, f))) throw new Error(`Missing ${f} - run npm install`);
  cpSync(join(src, f), join(dest, f));
}
console.log('[copy-wasm] MediaPipe WASM copied to public/mediapipe/wasm');
