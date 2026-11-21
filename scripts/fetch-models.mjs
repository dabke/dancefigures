// One-time developer helper: re-downloads the pose models into public/models.
// The models are committed to the repo, so this is only needed to update them.
// (The app itself never downloads anything at runtime.)
import { writeFileSync, mkdirSync } from 'node:fs';
const base = 'https://storage.googleapis.com/mediapipe-models/pose_landmarker';
mkdirSync('public/models', { recursive: true });
for (const v of ['lite', 'full']) {
  const url = `${base}/pose_landmarker_${v}/float16/latest/pose_landmarker_${v}.task`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  writeFileSync(`public/models/pose_landmarker_${v}.task`, Buffer.from(await res.arrayBuffer()));
  console.log('downloaded', v);
}
