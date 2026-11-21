import { describe, it, expect } from 'vitest';
import { updateBeatEnvelope, initialBeatState, bandEnergy, type BeatState } from '../src/audio';

const DT = 1 / 60;
function run(state: BeatState, energy: number, seconds: number, sens = 0.5): BeatState {
  for (let t = 0; t < seconds; t += DT) state = updateBeatEnvelope(state, energy, DT, sens);
  return state;
}

describe('beat envelope', () => {
  it('stays at zero in silence', () => {
    expect(run(initialBeatState(), 0, 2).env).toBe(0);
  });

  it('rises fast on a kick', () => {
    const quiet = run(initialBeatState(), 0.15, 2);
    expect(run(quiet, 0.6, 0.05).env).toBeGreaterThan(0.5);
  });

  it('decays after the kick ends', () => {
    const quiet = run(initialBeatState(), 0.15, 2);
    const kick = run(quiet, 0.6, 0.05);
    expect(run(kick, 0.15, 0.8).env).toBeLessThan(0.1);
  });

  it('adapts to a steady loud level (no pulse on a constant drone)', () => {
    expect(run(initialBeatState(), 0.5, 6).env).toBeLessThan(0.05);
  });

  it('higher sensitivity gives a stronger response', () => {
    const base = run(initialBeatState(), 0.15, 2);
    const lo = run(base, 0.25, 0.05, 0.1).env;
    const hi = run(base, 0.25, 0.05, 0.9).env;
    expect(hi).toBeGreaterThan(lo);
  });

  it('is clamped to 0..1 and ignores bad dt', () => {
    const s = run(initialBeatState(), 5, 0.2, 1);
    expect(s.env).toBeLessThanOrEqual(1);
    expect(updateBeatEnvelope(s, 1, 0, 1)).toBe(s);
    expect(updateBeatEnvelope(s, 1, NaN, 1)).toBe(s);
  });

  it('bandEnergy averages the requested bins', () => {
    const bins = new Uint8Array(1024);
    bins.fill(255, 0, 8); // bins 0-7 (~0-187 Hz at 48 kHz / 2048) are full
    expect(bandEnergy(bins, 48000, 2048, 35, 150)).toBeCloseTo(1);
    expect(bandEnergy(bins, 48000, 2048, 1000, 2000)).toBe(0);
  });
});
