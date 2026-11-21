/**
 * BlazePose skeleton topology (33 landmarks) and helpers to project a tracked
 * person into canvas pixels.
 */
import type { RenderTrack } from '../tracker';
import type { Figure, View } from './types';

export const L = {
  NOSE: 0, L_EYE: 2, R_EYE: 5, L_EAR: 7, R_EAR: 8, MOUTH_L: 9, MOUTH_R: 10,
  L_SHOULDER: 11, R_SHOULDER: 12, L_ELBOW: 13, R_ELBOW: 14, L_WRIST: 15, R_WRIST: 16,
  L_INDEX: 19, R_INDEX: 20, L_HIP: 23, R_HIP: 24, L_KNEE: 25, R_KNEE: 26,
  L_ANKLE: 27, R_ANKLE: 28, L_HEEL: 29, R_HEEL: 30, L_FOOT: 31, R_FOOT: 32,
} as const;

/** Body segments (face and finger detail omitted for a clean stylized look). */
export const LIMBS: [number, number][] = [
  [L.L_SHOULDER, L.L_ELBOW], [L.L_ELBOW, L.L_WRIST], [L.L_WRIST, L.L_INDEX],
  [L.R_SHOULDER, L.R_ELBOW], [L.R_ELBOW, L.R_WRIST], [L.R_WRIST, L.R_INDEX],
  [L.L_HIP, L.L_KNEE], [L.L_KNEE, L.L_ANKLE], [L.L_ANKLE, L.L_FOOT], [L.L_HEEL, L.L_FOOT],
  [L.R_HIP, L.R_KNEE], [L.R_KNEE, L.R_ANKLE], [L.R_ANKLE, L.R_FOOT], [L.R_HEEL, L.R_FOOT],
];
export const TORSO: [number, number][] = [
  [L.L_SHOULDER, L.R_SHOULDER], [L.L_SHOULDER, L.L_HIP], [L.R_SHOULDER, L.R_HIP], [L.L_HIP, L.R_HIP],
];
export const ALL_SEGMENTS = [...TORSO, ...LIMBS];

/** Joints drawn as dots / emitters by the particle & blocky styles. */
export const JOINTS = [
  L.L_SHOULDER, L.R_SHOULDER, L.L_ELBOW, L.R_ELBOW, L.L_WRIST, L.R_WRIST,
  L.L_HIP, L.R_HIP, L.L_KNEE, L.R_KNEE, L.L_ANKLE, L.R_ANKLE,
];

/**
 * Default minimum MediaPipe visibility (0..1) for a joint to be drawn. User-configurable
 * in Settings ("Limb confidence cutoff"): lower shows limbs even when the model is unsure
 * (dim light, partly out of frame), higher hides guessed/jittery limbs.
 */
export const DEFAULT_MIN_VISIBILITY = 0.25;

/** Aspect-preserving "contain" fit of the video frame into the canvas. */
export function computeView(cw: number, ch: number, vw: number, vh: number, mirror: boolean): View {
  const scale = Math.min(cw / vw, ch / vh);
  return { scale, ox: (cw - vw * scale) / 2, oy: (ch - vh * scale) / 2, vw, vh, mirror };
}

/** Projects normalized coords (x,y,z triples) to pixels (x,y pairs). */
export function projectCoords(coords: ArrayLike<number>, view: View, out: Float32Array): Float32Array {
  const w = view.vw * view.scale;
  const h = view.vh * view.scale;
  for (let i = 0; i < out.length / 2; i++) {
    const x = coords[i * 3];
    out[i * 2] = view.ox + (view.mirror ? 1 - x : x) * w;
    out[i * 2 + 1] = view.oy + coords[i * 3 + 1] * h;
  }
  return out;
}

const dist = (px: Float32Array, a: number, b: number) =>
  Math.hypot(px[a * 2] - px[b * 2], px[a * 2 + 1] - px[b * 2 + 1]);

/** Head circle from face landmarks: center = mean of visible face points, radius from ear/eye-mouth spacing. */
export function headCircle(px: Float32Array, vis: Float32Array, torsoLen: number, minVis: number): Figure['head'] {
  let sx = 0, sy = 0, n = 0;
  for (let i = 0; i <= 10; i++) {
    if (vis[i] < minVis) continue;
    sx += px[i * 2]; sy += px[i * 2 + 1]; n++;
  }
  if (n < 3) return null;
  const ears = dist(px, L.L_EAR, L.R_EAR) * 0.62;
  const eyeMidX = (px[L.L_EYE * 2] + px[L.R_EYE * 2]) / 2;
  const eyeMidY = (px[L.L_EYE * 2 + 1] + px[L.R_EYE * 2 + 1]) / 2;
  const mouthMidX = (px[L.MOUTH_L * 2] + px[L.MOUTH_R * 2]) / 2;
  const mouthMidY = (px[L.MOUTH_L * 2 + 1] + px[L.MOUTH_R * 2 + 1]) / 2;
  const eyeMouth = Math.hypot(eyeMidX - mouthMidX, eyeMidY - mouthMidY) * 2.2;
  // Clamp relative to torso so a bad face estimate can't produce a giant head.
  const r = Math.min(Math.max(ears, eyeMouth, torsoLen * 0.15), torsoLen * 0.45 || 1e9);
  return { x: sx / n, y: sy / n, r };
}

/** Shoulder-midpoint to hip-midpoint length in px (a stable "person size"). */
export function torsoLength(px: Float32Array): number {
  const sx = (px[L.L_SHOULDER * 2] + px[L.R_SHOULDER * 2]) / 2;
  const sy = (px[L.L_SHOULDER * 2 + 1] + px[L.R_SHOULDER * 2 + 1]) / 2;
  const hx = (px[L.L_HIP * 2] + px[L.R_HIP * 2]) / 2;
  const hy = (px[L.L_HIP * 2 + 1] + px[L.R_HIP * 2 + 1]) / 2;
  return Math.hypot(sx - hx, sy - hy);
}

export const visible = (f: Figure, i: number) => f.vis[i] >= f.minVis;
export const segVisible = (f: Figure, a: number, b: number) => f.vis[a] >= f.minVis && f.vis[b] >= f.minVis;

/** Builds a Figure (pixel-space person) from a tracked person. */
export function toFigure(
  t: RenderTrack,
  view: View,
  color: string,
  beat: number,
  canvasH: number,
  minVis = DEFAULT_MIN_VISIBILITY,
): Figure {
  const px = projectCoords(t.coords, view, new Float32Array(66));
  const torso = torsoLength(px);
  const base = Math.min(Math.max(torso * 0.075, 3), canvasH * 0.03);
  return {
    id: t.id,
    color,
    alpha: t.alpha,
    px,
    vis: t.visibility,
    minVis,
    head: headCircle(px, t.visibility, torso, minVis),
    lineWidth: base * (1 + beat * 0.7),
  };
}

/** A Path2D containing every visible bone (plus a neck to the head). */
export function bonesPath(f: Figure, segments = ALL_SEGMENTS): Path2D {
  const p = new Path2D();
  for (const [a, b] of segments) {
    if (!segVisible(f, a, b)) continue;
    p.moveTo(f.px[a * 2], f.px[a * 2 + 1]);
    p.lineTo(f.px[b * 2], f.px[b * 2 + 1]);
  }
  if (f.head && segVisible(f, L.L_SHOULDER, L.R_SHOULDER)) {
    const nx = (f.px[L.L_SHOULDER * 2] + f.px[L.R_SHOULDER * 2]) / 2;
    const ny = (f.px[L.L_SHOULDER * 2 + 1] + f.px[L.R_SHOULDER * 2 + 1]) / 2;
    // Neck stops at the bottom of the head circle.
    const dx = f.head.x - nx, dy = f.head.y - ny;
    const d = Math.hypot(dx, dy);
    if (d > f.head.r) {
      p.moveTo(nx, ny);
      p.lineTo(f.head.x - (dx / d) * f.head.r, f.head.y - (dy / d) * f.head.r);
    }
  }
  return p;
}
