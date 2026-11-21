/**
 * One Euro filter (Casiez, Roussel & Vogel, CHI 2012).
 *
 * An adaptive low-pass filter: at low speeds it uses a low cutoff frequency
 * (removing jitter), at high speeds the cutoff rises (reducing lag). Ideal for
 * pose landmarks, which jitter when still but must follow fast dance moves.
 */

export interface OneEuroParams {
  /** Minimum cutoff frequency in Hz. Lower = smoother but laggier when slow. */
  minCutoff: number;
  /** Speed coefficient. Higher = less lag during fast motion. */
  beta: number;
  /** Cutoff frequency (Hz) used to smooth the derivative. */
  dCutoff: number;
}

export const DEFAULT_ONE_EURO: OneEuroParams = { minCutoff: 1.0, beta: 0.5, dCutoff: 1.0 };

/** Smoothing factor for an exponential filter with cutoff `cutoff` Hz at timestep `dt` s. */
export function smoothingAlpha(cutoff: number, dt: number): number {
  const tau = 1 / (2 * Math.PI * cutoff);
  return 1 / (1 + tau / dt);
}

/** Filters a single scalar signal. */
export class OneEuroFilter {
  private xPrev: number | null = null;
  private dxPrev = 0;
  private tPrev = 0;

  constructor(public params: OneEuroParams = { ...DEFAULT_ONE_EURO }) {}

  /**
   * @param x   new raw sample
   * @param t   timestamp in seconds (must be increasing)
   * @returns   filtered value
   */
  filter(x: number, t: number): number {
    if (this.xPrev === null) {
      this.xPrev = x;
      this.tPrev = t;
      this.dxPrev = 0;
      return x;
    }
    // Guard against zero/negative dt (duplicate timestamps): keep previous value.
    const dt = t - this.tPrev;
    if (dt <= 0) return this.xPrev;

    const { minCutoff, beta, dCutoff } = this.params;
    const dx = (x - this.xPrev) / dt;
    const aD = smoothingAlpha(dCutoff, dt);
    const dxHat = aD * dx + (1 - aD) * this.dxPrev;

    const cutoff = minCutoff + beta * Math.abs(dxHat);
    const a = smoothingAlpha(cutoff, dt);
    const xHat = a * x + (1 - a) * this.xPrev;

    this.xPrev = xHat;
    this.dxPrev = dxHat;
    this.tPrev = t;
    return xHat;
  }

  reset(): void {
    this.xPrev = null;
    this.dxPrev = 0;
  }
}

/**
 * Maps a user-facing "smoothing strength" (0..1) to One Euro parameters.
 * 0 = almost raw (very responsive), 1 = very smooth.
 * Coordinates are normalized (0..1 of the frame), so beta is scaled accordingly.
 */
export function paramsForStrength(strength: number): OneEuroParams {
  const s = Math.min(1, Math.max(0, strength));
  // minCutoff goes from 8 Hz (barely filtered) down to 0.4 Hz (heavily filtered).
  const minCutoff = 8 * Math.pow(0.05, s);
  // beta: less speed adaptation when stronger smoothing is requested.
  const beta = 40 - 32 * s;
  return { minCutoff, beta, dCutoff: 1.0 };
}

/** A bank of filters for a whole pose: 33 landmarks x (x, y, z). */
export class LandmarkSmoother {
  private filters: OneEuroFilter[];

  constructor(count: number, params: OneEuroParams) {
    this.filters = Array.from({ length: count * 3 }, () => new OneEuroFilter({ ...params }));
  }

  setParams(params: OneEuroParams): void {
    for (const f of this.filters) f.params = { ...params };
  }

  /** Filters `src` (flat [x,y,z,...]) into `dst` in-place. */
  apply(src: ArrayLike<number>, dst: Float32Array, tSeconds: number): void {
    for (let i = 0; i < this.filters.length; i++) dst[i] = this.filters[i].filter(src[i], tSeconds);
  }
}
