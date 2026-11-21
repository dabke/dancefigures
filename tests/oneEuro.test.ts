import { describe, it, expect } from 'vitest';
import { OneEuroFilter, paramsForStrength, smoothingAlpha, LandmarkSmoother } from '../src/oneEuro';

// Deterministic pseudo-random noise so tests are reproducible.
function rng(seed: number) {
  return () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32 - 0.5;
}

describe('OneEuroFilter', () => {
  it('returns the first sample unchanged', () => {
    const f = new OneEuroFilter();
    expect(f.filter(0.42, 0)).toBe(0.42);
  });

  it('converges to a constant input', () => {
    const f = new OneEuroFilter({ minCutoff: 1, beta: 0, dCutoff: 1 });
    f.filter(0, 0);
    let y = 0;
    for (let i = 1; i <= 300; i++) y = f.filter(1, i / 30);
    expect(y).toBeCloseTo(1, 3);
  });

  it('reduces jitter on a noisy static signal', () => {
    const noise = rng(7);
    const f = new OneEuroFilter(paramsForStrength(0.7));
    let rawVar = 0;
    let filtVar = 0;
    for (let i = 0; i < 300; i++) {
      const raw = 0.5 + noise() * 0.02;
      const out = f.filter(raw, i / 30);
      if (i > 30) {
        rawVar += (raw - 0.5) ** 2;
        filtVar += (out - 0.5) ** 2;
      }
    }
    expect(filtVar).toBeLessThan(rawVar * 0.25);
  });

  it('follows fast motion with less lag when beta > 0 (speed adaptation)', () => {
    const slow = new OneEuroFilter({ minCutoff: 0.5, beta: 0, dCutoff: 1 });
    const adaptive = new OneEuroFilter({ minCutoff: 0.5, beta: 20, dCutoff: 1 });
    let ys = 0;
    let ya = 0;
    let x = 0;
    for (let i = 0; i <= 15; i++) {
      x = i * 0.04;
      ys = slow.filter(x, i / 30);
      ya = adaptive.filter(x, i / 30);
    }
    expect(Math.abs(x - ya)).toBeLessThan(Math.abs(x - ys));
  });

  it('ignores non-increasing timestamps', () => {
    const f = new OneEuroFilter();
    f.filter(0, 1);
    expect(f.filter(5, 1)).toBe(0);
    expect(f.filter(5, 0.5)).toBe(0);
  });

  it('reset() forgets history', () => {
    const f = new OneEuroFilter();
    f.filter(0, 0);
    f.filter(1, 0.1);
    f.reset();
    expect(f.filter(3, 0.2)).toBe(3);
  });

  it('smoothingAlpha is in (0,1) and grows with cutoff', () => {
    const a1 = smoothingAlpha(1, 1 / 30);
    const a2 = smoothingAlpha(10, 1 / 30);
    expect(a1).toBeGreaterThan(0);
    expect(a2).toBeLessThan(1);
    expect(a2).toBeGreaterThan(a1);
  });

  it('strength mapping: stronger smoothing = lower cutoff, input clamped', () => {
    expect(paramsForStrength(1).minCutoff).toBeLessThan(paramsForStrength(0).minCutoff);
    expect(paramsForStrength(5)).toEqual(paramsForStrength(1));
  });

  it('LandmarkSmoother filters every coordinate', () => {
    const s = new LandmarkSmoother(2, paramsForStrength(0.5));
    const out = new Float32Array(6);
    s.apply([1, 2, 3, 4, 5, 6], out, 0);
    expect(Array.from(out)).toEqual([1, 2, 3, 4, 5, 6]);
    s.apply([2, 2, 3, 4, 5, 6], out, 1 / 30);
    expect(out[0]).toBeGreaterThan(1);
    expect(out[0]).toBeLessThan(2);
  });
});
