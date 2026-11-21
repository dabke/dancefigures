/**
 * Multi-person tracker.
 *
 * MediaPipe PoseLandmarker returns poses in arbitrary order each frame, with no
 * identity. We match detections to existing tracks by the distance between
 * their torso centers (mean of shoulders + hips), greedily pairing the closest
 * pairs first, within a distance threshold. Each track keeps its own color,
 * One Euro smoothing state and fade-in / fade-out alpha.
 */
import { LandmarkSmoother, paramsForStrength, type OneEuroParams } from './oneEuro';

export const NUM_LANDMARKS = 33;

/** One detected pose: flat normalized coordinates [x0,y0,z0,x1,...] and per-landmark visibility. */
export interface PoseInput {
  coords: ArrayLike<number>; // length 33*3
  visibility: ArrayLike<number>; // length 33
}

/** What the renderer needs for one person. Also what is sent to the projector window. */
export interface RenderTrack {
  id: number;
  colorIndex: number;
  alpha: number; // 0..1 fade
  coords: Float32Array; // smoothed, length 33*3
  visibility: Float32Array; // length 33
}

export interface TrackerOptions {
  /** Max match distance between torso centers, in frame-height units. */
  matchThreshold: number;
  fadeInMs: number;
  fadeOutMs: number;
  /** Number of distinct colors available (palette size). */
  colorCount: number;
  /** Smoothing strength 0..1 (see paramsForStrength). */
  smoothing: number;
}

export const DEFAULT_TRACKER_OPTIONS: TrackerOptions = {
  matchThreshold: 0.25,
  fadeInMs: 250,
  fadeOutMs: 400,
  colorCount: 6,
  smoothing: 0.5,
};

interface Track {
  id: number;
  colorIndex: number;
  coords: Float32Array;
  visibility: Float32Array;
  smoother: LandmarkSmoother;
  cx: number;
  cy: number;
  lastSeen: number;
  /** true while the track is matched in the latest detection */
  present: boolean;
  /** alpha value and time at which the current fade started */
  fadeFromAlpha: number;
  fadeStart: number;
}

const TORSO = [11, 12, 23, 24]; // shoulders + hips

/** Torso center of a pose, visibility-weighted; falls back to all landmarks. */
export function poseCenter(coords: ArrayLike<number>, visibility: ArrayLike<number>): [number, number] {
  let sx = 0, sy = 0, sw = 0;
  for (const i of TORSO) {
    const w = Math.max(0.05, visibility[i] ?? 1);
    sx += coords[i * 3] * w;
    sy += coords[i * 3 + 1] * w;
    sw += w;
  }
  if (sw > 0) return [sx / sw, sy / sw];
  // Unreachable in practice (weights are clamped), kept for safety.
  let ax = 0, ay = 0;
  for (let i = 0; i < NUM_LANDMARKS; i++) { ax += coords[i * 3]; ay += coords[i * 3 + 1]; }
  return [ax / NUM_LANDMARKS, ay / NUM_LANDMARKS];
}

export class Tracker {
  private tracks: Track[] = [];
  private nextId = 1;
  private opts: TrackerOptions;
  private oneEuro: OneEuroParams;
  /** Width / height of the video, so x distances are measured in the same units as y. */
  aspect = 16 / 9;

  constructor(opts: Partial<TrackerOptions> = {}) {
    this.opts = { ...DEFAULT_TRACKER_OPTIONS, ...opts };
    this.oneEuro = paramsForStrength(this.opts.smoothing);
  }

  setSmoothing(strength: number): void {
    this.opts.smoothing = strength;
    this.oneEuro = paramsForStrength(strength);
    for (const t of this.tracks) t.smoother.setParams(this.oneEuro);
  }

  setColorCount(n: number): void {
    this.opts.colorCount = Math.max(1, n);
  }

  /** Current alpha of a track at time `now` (ms). */
  private alphaOf(t: Track, now: number): number {
    const dt = now - t.fadeStart;
    if (t.present) return Math.min(1, t.fadeFromAlpha + dt / this.opts.fadeInMs);
    return Math.max(0, t.fadeFromAlpha - dt / this.opts.fadeOutMs);
  }

  private setPresent(t: Track, present: boolean, now: number): void {
    if (t.present === present) return;
    t.fadeFromAlpha = this.alphaOf(t, now);
    t.fadeStart = now;
    t.present = present;
  }

  private freeColor(): number {
    const used = new Set(this.tracks.map((t) => t.colorIndex));
    for (let c = 0; c < this.opts.colorCount; c++) if (!used.has(c)) return c;
    return (this.nextId - 1) % this.opts.colorCount;
  }

  /**
   * Feed one frame of detections.
   * @param poses detections for this frame (any order)
   * @param now   timestamp in ms (monotonic)
   */
  update(poses: PoseInput[], now: number): void {
    const tSec = now / 1000;
    // Fully faded tracks must not be re-matched: drop them first.
    this.prune(now);
    const centers = poses.map((p) => poseCenter(p.coords, p.visibility));

    // Build all candidate (track, detection) pairs within the threshold.
    const pairs: { ti: number; di: number; d: number }[] = [];
    this.tracks.forEach((t, ti) => {
      centers.forEach(([x, y], di) => {
        const d = Math.hypot((x - t.cx) * this.aspect, y - t.cy);
        if (d <= this.opts.matchThreshold) pairs.push({ ti, di, d });
      });
    });
    pairs.sort((a, b) => a.d - b.d);

    // Greedy assignment: closest pairs first, each track/detection used once.
    const trackUsed = new Set<number>();
    const detUsed = new Set<number>();
    for (const { ti, di } of pairs) {
      if (trackUsed.has(ti) || detUsed.has(di)) continue;
      trackUsed.add(ti);
      detUsed.add(di);
      const t = this.tracks[ti];
      const p = poses[di];
      t.smoother.apply(p.coords, t.coords, tSec);
      for (let i = 0; i < NUM_LANDMARKS; i++) t.visibility[i] = p.visibility[i] ?? 1;
      [t.cx, t.cy] = centers[di];
      t.lastSeen = now;
      this.setPresent(t, true, now);
    }

    // Unmatched tracks start (or continue) fading out.
    this.tracks.forEach((t, ti) => {
      if (!trackUsed.has(ti)) this.setPresent(t, false, now);
    });

    // Unmatched detections become new tracks (fading in).
    poses.forEach((p, di) => {
      if (detUsed.has(di)) return;
      const smoother = new LandmarkSmoother(NUM_LANDMARKS, this.oneEuro);
      const coords = new Float32Array(NUM_LANDMARKS * 3);
      smoother.apply(p.coords, coords, tSec);
      const visibility = new Float32Array(NUM_LANDMARKS);
      for (let i = 0; i < NUM_LANDMARKS; i++) visibility[i] = p.visibility[i] ?? 1;
      const track: Track = {
        id: this.nextId++,
        colorIndex: this.freeColor(),
        coords,
        visibility,
        smoother,
        cx: centers[di][0],
        cy: centers[di][1],
        lastSeen: now,
        present: true,
        fadeFromAlpha: 0,
        fadeStart: now,
      };
      this.tracks.push(track);
    });

    this.prune(now);
  }

  /** Drop tracks that have fully faded out. */
  private prune(now: number): void {
    this.tracks = this.tracks.filter((t) => t.present || this.alphaOf(t, now) > 0);
  }

  /** Snapshot for rendering at time `now` (ms). Arrays are shared, not copied. */
  snapshot(now: number): RenderTrack[] {
    this.prune(now);
    return this.tracks.map((t) => ({
      id: t.id,
      colorIndex: t.colorIndex,
      alpha: this.alphaOf(t, now),
      coords: t.coords,
      visibility: t.visibility,
    }));
  }

  reset(): void {
    this.tracks = [];
  }

  get count(): number {
    return this.tracks.length;
  }
}
