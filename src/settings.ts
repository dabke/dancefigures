/**
 * App settings: types, defaults, and localStorage persistence.
 */

export type FigureStyle = 'stick' | 'neon' | 'particles' | 'blocky';
export type Background = 'black' | 'gradient' | 'beat';
export type ModelVariant = 'lite' | 'full';
export type Facing = 'user' | 'environment';

export const STYLES: { id: FigureStyle; label: string }[] = [
  { id: 'stick', label: 'Stick' },
  { id: 'neon', label: 'Neon' },
  { id: 'particles', label: 'Particles' },
  { id: 'blocky', label: 'Blocky' },
];

export const BACKGROUNDS: { id: Background; label: string }[] = [
  { id: 'black', label: 'Black' },
  { id: 'gradient', label: 'Gradient' },
  { id: 'beat', label: 'Beat' },
];

export interface Settings {
  style: FigureStyle;
  numPoses: number; // 1..4
  model: ModelVariant;
  smoothing: number; // 0..1
  minVisibility: number; // 0..1, joints below this confidence are hidden
  mirror: boolean;
  palette: string; // key of PALETTES
  background: Background;
  beatEnabled: boolean;
  beatSensitivity: number; // 0..1
  showFps: boolean;
  debugCamera: boolean;
  facing: Facing;
}

export const DEFAULT_SETTINGS: Settings = {
  style: 'neon',
  numPoses: 3,
  model: 'lite',
  smoothing: 0.5,
  minVisibility: 0.25,
  mirror: false, // back camera by default: not mirrored (front camera switches mirroring on)
  palette: 'neon',
  background: 'gradient',
  beatEnabled: true,
  beatSensitivity: 0.5,
  showFps: false,
  debugCamera: false,
  // Back camera: at a party the phone faces the dance floor, not the person holding it.
  facing: 'environment',
};

const KEY = 'dancefigures.settings.v1';
/**
 * Schema version stored alongside the settings.
 * v2: default camera changed from front to back. Settings saved before v2 have
 * facing 'user' only because it was the old default, so they are moved to the
 * back camera (unmirrored) once; everything else is kept.
 */
export const SETTINGS_VERSION = 2;

/** Upgrades raw stored settings from older versions. Pure, so it is unit-testable. */
export function migrate(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object') return raw;
  const r = { ...(raw as Record<string, unknown>) };
  const v = typeof r.v === 'number' ? r.v : 1;
  if (v < 2) {
    r.facing = 'environment';
    r.mirror = false;
  }
  r.v = SETTINGS_VERSION;
  return r;
}

const clamp = (v: unknown, lo: number, hi: number, d: number) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d;
const oneOf = <T extends string>(v: unknown, opts: readonly T[], d: T): T =>
  opts.includes(v as T) ? (v as T) : d;
const bool = (v: unknown, d: boolean) => (typeof v === 'boolean' ? v : d);

/** Validates arbitrary (possibly stale or corrupted) data into a full Settings object. */
export function sanitize(raw: unknown, palettes: readonly string[]): Settings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const d = DEFAULT_SETTINGS;
  return {
    style: oneOf(r.style, STYLES.map((s) => s.id), d.style),
    numPoses: Math.round(clamp(r.numPoses, 1, 4, d.numPoses)),
    model: oneOf(r.model, ['lite', 'full'] as const, d.model),
    smoothing: clamp(r.smoothing, 0, 1, d.smoothing),
    minVisibility: clamp(r.minVisibility, 0, 1, d.minVisibility),
    mirror: bool(r.mirror, d.mirror),
    palette: oneOf(r.palette, palettes, d.palette),
    background: oneOf(r.background, BACKGROUNDS.map((b) => b.id), d.background),
    beatEnabled: bool(r.beatEnabled, d.beatEnabled),
    beatSensitivity: clamp(r.beatSensitivity, 0, 1, d.beatSensitivity),
    showFps: bool(r.showFps, d.showFps),
    debugCamera: bool(r.debugCamera, d.debugCamera),
    facing: oneOf(r.facing, ['user', 'environment'] as const, d.facing),
  };
}

export function loadSettings(palettes: readonly string[]): Settings {
  try {
    return sanitize(migrate(JSON.parse(localStorage.getItem(KEY) ?? 'null')), palettes);
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...s, v: SETTINGS_VERSION }));
  } catch {
    /* storage full or disabled: settings just won't persist */
  }
}
