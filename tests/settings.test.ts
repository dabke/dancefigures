import { describe, it, expect } from 'vitest';
import { DEFAULT_SETTINGS, SETTINGS_VERSION, migrate, sanitize } from '../src/settings';

const PALETTES = ['neon', 'fire'];
const load = (raw: unknown) => sanitize(migrate(raw), PALETTES);

describe('settings', () => {
  it('defaults to the back camera, unmirrored', () => {
    expect(DEFAULT_SETTINGS.facing).toBe('environment');
    expect(DEFAULT_SETTINGS.mirror).toBe(false);
    expect(load(null).facing).toBe('environment');
  });

  it('moves pre-v2 saved settings to the back camera but keeps everything else', () => {
    const s = load({ facing: 'user', mirror: true, style: 'stick', palette: 'fire', numPoses: 2 });
    expect(s.facing).toBe('environment');
    expect(s.mirror).toBe(false);
    expect(s.style).toBe('stick');
    expect(s.palette).toBe('fire');
    expect(s.numPoses).toBe(2);
  });

  it('respects an explicit front-camera choice saved by the current version', () => {
    const s = load({ v: SETTINGS_VERSION, facing: 'user', mirror: true });
    expect(s.facing).toBe('user');
    expect(s.mirror).toBe(true);
  });

  it('falls back to defaults for invalid values', () => {
    const s = load({ v: SETTINGS_VERSION, facing: 'sideways', numPoses: 9, palette: 'nope' });
    expect(s.facing).toBe('environment');
    expect(s.numPoses).toBe(4);
    expect(s.palette).toBe('neon');
  });
});
