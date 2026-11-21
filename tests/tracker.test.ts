import { describe, it, expect } from 'vitest';
import { Tracker, poseCenter, NUM_LANDMARKS, type PoseInput } from '../src/tracker';

/** A fake pose whose every landmark sits at (x, y). */
function pose(x: number, y: number, vis = 1): PoseInput {
  const coords = new Float32Array(NUM_LANDMARKS * 3);
  for (let i = 0; i < NUM_LANDMARKS; i++) {
    coords[i * 3] = x;
    coords[i * 3 + 1] = y;
  }
  return { coords, visibility: new Float32Array(NUM_LANDMARKS).fill(vis) };
}
const ids = (tr: Tracker, t: number) => tr.snapshot(t).map((s) => s.id);
const byId = (tr: Tracker, t: number) => Object.fromEntries(tr.snapshot(t).map((s) => [s.id, s]));

describe('Tracker', () => {
  it('poseCenter averages shoulders and hips', () => {
    const p = pose(0, 0);
    const c = p.coords as Float32Array;
    for (const [i, x, y] of [[11, 0.4, 0.3], [12, 0.6, 0.3], [23, 0.4, 0.7], [24, 0.6, 0.7]]) {
      c[i * 3] = x;
      c[i * 3 + 1] = y;
    }
    const [cx, cy] = poseCenter(p.coords, p.visibility);
    expect(cx).toBeCloseTo(0.5);
    expect(cy).toBeCloseTo(0.5);
  });

  it('keeps IDs stable when detection order swaps every frame', () => {
    const tr = new Tracker();
    tr.update([pose(0.2, 0.5), pose(0.8, 0.5)], 0);
    const leftId = Object.values(byId(tr, 0)).find((t) => t.coords[0] < 0.5)!.id;
    for (let f = 1; f <= 30; f++) {
      const dx = f * 0.003; // both people drift toward the middle
      const a = pose(0.2 + dx, 0.5);
      const b = pose(0.8 - dx, 0.5);
      tr.update(f % 2 ? [b, a] : [a, b], f * 33);
    }
    const now = byId(tr, 30 * 33);
    expect(Object.keys(now)).toHaveLength(2);
    expect(now[leftId].coords[0]).toBeLessThan(0.5); // still the left person
  });

  it('assigns distinct colors and keeps them across frames', () => {
    const tr = new Tracker({ colorCount: 6 });
    tr.update([pose(0.1, 0.5), pose(0.5, 0.5), pose(0.9, 0.5)], 0);
    const colors = tr.snapshot(0).map((t) => t.colorIndex);
    expect(new Set(colors).size).toBe(3);
    tr.update([pose(0.9, 0.5), pose(0.1, 0.5), pose(0.5, 0.5)], 33);
    expect(tr.snapshot(33).map((t) => t.colorIndex)).toEqual(colors);
  });

  it('does not match detections farther than the threshold', () => {
    const tr = new Tracker({ matchThreshold: 0.1, fadeInMs: 1 });
    tr.update([pose(0.2, 0.5)], 0);
    const [id1] = ids(tr, 0);
    tr.update([pose(0.8, 0.5)], 33); // jump across the frame = a different person
    const snap = tr.snapshot(100);
    expect(snap).toHaveLength(2); // old one fading out, new one fading in
    expect(snap.find((t) => t.id === id1)!.alpha).toBeLessThan(1);
  });

  it('fades in new tracks', () => {
    const tr = new Tracker({ fadeInMs: 250 });
    tr.update([pose(0.5, 0.5)], 1000);
    expect(tr.snapshot(1000)[0].alpha).toBe(0);
    expect(tr.snapshot(1125)[0].alpha).toBeCloseTo(0.5);
    expect(tr.snapshot(1300)[0].alpha).toBe(1);
  });

  it('fades out lost tracks over ~400 ms, then removes them', () => {
    const tr = new Tracker({ fadeInMs: 1, fadeOutMs: 400 });
    tr.update([pose(0.5, 0.5)], 0);
    tr.update([pose(0.5, 0.5)], 100);
    tr.update([], 200); // lost
    expect(tr.snapshot(200)[0].alpha).toBe(1);
    expect(tr.snapshot(400)[0].alpha).toBeCloseTo(0.5);
    expect(tr.snapshot(601)).toHaveLength(0);
  });

  it('re-acquires a briefly lost person with the same ID', () => {
    const tr = new Tracker({ fadeInMs: 1, fadeOutMs: 400 });
    tr.update([pose(0.5, 0.5)], 0);
    const [id] = ids(tr, 0);
    tr.update([], 33);
    tr.update([], 66);
    tr.update([pose(0.51, 0.5)], 200); // back within the fade window
    expect(ids(tr, 200)).toEqual([id]);
  });

  it('gives a new ID after the fade has completed', () => {
    const tr = new Tracker({ fadeInMs: 1, fadeOutMs: 400 });
    tr.update([pose(0.5, 0.5)], 0);
    const [id] = ids(tr, 0);
    tr.update([], 33);
    tr.update([pose(0.5, 0.5)], 1000);
    expect(ids(tr, 1000)).not.toContain(id);
  });

  it('smooths coordinates of a tracked person', () => {
    const tr = new Tracker({ smoothing: 0.8 });
    tr.update([pose(0.5, 0.5)], 0);
    tr.update([pose(0.6, 0.5)], 33);
    const x = tr.snapshot(33)[0].coords[0];
    expect(x).toBeGreaterThan(0.5);
    expect(x).toBeLessThan(0.6);
  });
});
