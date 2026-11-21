/**
 * Beat reaction: microphone -> AnalyserNode -> bass-band energy -> envelope.
 *
 * The envelope logic is a pure function (`updateBeatEnvelope`) so it can be
 * unit tested without Web Audio. Audio never leaves the device.
 */

export interface BeatState {
  /** Slow running average of bass energy (adaptive baseline). */
  avg: number;
  /** Output envelope 0..1 that drives visual pulses. */
  env: number;
}

export const initialBeatState = (): BeatState => ({ avg: 0, env: 0 });

/** Time constants (seconds). */
const AVG_TAU = 1.2; // baseline adapts over ~1 s so steady drones don't pulse
const ATTACK_TAU = 0.015; // very fast rise on a kick
const RELEASE_TAU = 0.18; // smooth decay between beats

const expSmooth = (tau: number, dt: number) => 1 - Math.exp(-dt / tau);

/**
 * Advances the beat envelope by one step.
 * @param state       previous state
 * @param energy      bass-band energy for this step, 0..1
 * @param dt          seconds since the previous step
 * @param sensitivity 0..1 user setting (higher = stronger reaction)
 * @returns new state (input is not mutated)
 */
export function updateBeatEnvelope(state: BeatState, energy: number, dt: number, sensitivity: number): BeatState {
  if (!(dt > 0)) return state;
  const e = Math.min(1, Math.max(0, energy));
  const avg = state.avg + (e - state.avg) * expSmooth(AVG_TAU, dt);
  // How far above the recent baseline are we? Scaled by sensitivity.
  const gain = 1 + 11 * Math.min(1, Math.max(0, sensitivity));
  // Small absolute floor so near-silence never produces pulses.
  const target = e < 0.04 ? 0 : Math.min(1, Math.max(0, (e - avg) * gain));
  const k = target > state.env ? expSmooth(ATTACK_TAU, dt) : expSmooth(RELEASE_TAU, dt);
  const env = state.env + (target - state.env) * k;
  return { avg, env };
}

/** Mean magnitude (0..1) of the FFT bins between loHz and hiHz. */
export function bandEnergy(bins: Uint8Array, sampleRate: number, fftSize: number, loHz: number, hiHz: number): number {
  const hzPerBin = sampleRate / fftSize;
  const lo = Math.max(0, Math.floor(loHz / hzPerBin));
  const hi = Math.min(bins.length - 1, Math.ceil(hiHz / hzPerBin));
  if (hi < lo) return 0;
  let sum = 0;
  for (let i = lo; i <= hi; i++) sum += bins[i];
  return sum / ((hi - lo + 1) * 255);
}

/** Microphone analyser. Call start() from a user gesture. */
export class BeatDetector {
  private ctx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private analyser: AnalyserNode | null = null;
  private bins: Uint8Array<ArrayBuffer> = new Uint8Array(0);
  private state = initialBeatState();
  private lastT = 0;
  sensitivity = 0.5;

  get active(): boolean {
    return !!this.analyser && this.ctx?.state === 'running';
  }

  async start(): Promise<void> {
    if (this.stream) return;
    // Disable all voice processing so music (especially bass) isn't filtered out.
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      video: false,
    });
    this.ctx ??= new AudioContext();
    const src = this.ctx.createMediaStreamSource(this.stream);
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 2048;
    this.analyser.smoothingTimeConstant = 0; // we do our own smoothing
    this.analyser.minDecibels = -85;
    this.analyser.maxDecibels = -20;
    src.connect(this.analyser); // not connected to destination: no feedback
    this.bins = new Uint8Array(this.analyser.frequencyBinCount);
    if (this.ctx.state !== 'running') await this.ctx.resume();
  }

  /** Returns the current beat envelope 0..1. Call once per rendered frame. */
  sample(nowMs: number): number {
    if (!this.analyser || !this.ctx) return 0;
    this.analyser.getByteFrequencyData(this.bins);
    const energy = bandEnergy(this.bins, this.ctx.sampleRate, this.analyser.fftSize, 35, 150);
    const dt = this.lastT ? Math.min(0.1, (nowMs - this.lastT) / 1000) : 1 / 60;
    this.lastT = nowMs;
    this.state = updateBeatEnvelope(this.state, energy, dt, this.sensitivity);
    return this.state.env;
  }

  /** Stop the mic completely (page hidden or beat disabled). */
  stop(): void {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.analyser = null;
    this.state = initialBeatState();
    void this.ctx?.suspend();
  }
}
