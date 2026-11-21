/**
 * Pose detection with MediaPipe PoseLandmarker (VIDEO mode).
 *
 * - WASM runtime and .task models are served from our own origin
 *   (public/mediapipe/wasm, public/models) and precached for offline use.
 * - GPU delegate first, automatic CPU fallback (at creation or on first failure).
 * - Driven by requestVideoFrameCallback (fallback requestAnimationFrame).
 *   detectForVideo() is synchronous, and we only re-arm the callback after it
 *   returns, so if inference is slower than the camera, frames are simply
 *   skipped - they never queue up.
 */
import { PoseLandmarker } from '@mediapipe/tasks-vision';
import type { ModelVariant } from './settings';
import { NUM_LANDMARKS, type PoseInput } from './tracker';

/** Not exported by the package, so derive it. */
type WasmFileset = Parameters<typeof PoseLandmarker.createFromOptions>[0];

export type Delegate = 'GPU' | 'CPU';

export interface DetectionFrame {
  poses: PoseInput[];
  /** Timestamp (performance.now() ms) of the processed video frame. */
  time: number;
}

/** Resolves an asset path relative to the page, so it works under any base path. */
export const assetUrl = (path: string) => new URL(path, document.baseURI).href;

function wasmFileset(): WasmFileset {
  // Built manually (rather than FilesetResolver) to guarantee local paths only.
  return {
    wasmLoaderPath: assetUrl('mediapipe/wasm/vision_wasm_internal.js'),
    wasmBinaryPath: assetUrl('mediapipe/wasm/vision_wasm_internal.wasm'),
  };
}

export const modelUrl = (m: ModelVariant) => assetUrl(`models/pose_landmarker_${m}.task`);

export class PoseDetector {
  private landmarker: PoseLandmarker | null = null;
  private video: HTMLVideoElement | null = null;
  private onFrame: ((f: DetectionFrame) => void) | null = null;
  private running = false;
  private rvfcHandle = 0;
  private rafHandle = 0;
  private lastTs = 0;
  private lastVideoTime = -1;
  private gpuFailed = false;

  delegate: Delegate = 'GPU';
  model: ModelVariant = 'lite';
  numPoses = 3;

  /** Exponential moving average of inference time in ms. */
  inferenceMs = 0;
  /** Detections per second (EMA). */
  detectFps = 0;
  private lastDetectAt = 0;
  /** Frames to leave out of the stats: the first GPU inferences include shader compilation. */
  private warmup = 0;
  private static readonly WARMUP_FRAMES = 5;

  /** (Re)creates the landmarker. Tries GPU, falls back to CPU. */
  async init(model: ModelVariant, numPoses: number): Promise<void> {
    this.model = model;
    this.numPoses = numPoses;
    this.warmup = PoseDetector.WARMUP_FRAMES;
    this.inferenceMs = 0;
    this.detectFps = 0;
    const old = this.landmarker;
    this.landmarker = null;
    old?.close();

    const create = (delegate: Delegate) =>
      PoseLandmarker.createFromOptions(wasmFileset(), {
        baseOptions: { modelAssetPath: modelUrl(model), delegate },
        runningMode: 'VIDEO',
        numPoses,
        minPoseDetectionConfidence: 0.5,
        minPosePresenceConfidence: 0.5,
        minTrackingConfidence: 0.5,
        outputSegmentationMasks: false,
      });

    if (!this.gpuFailed) {
      try {
        this.landmarker = await create('GPU');
        this.delegate = 'GPU';
        return;
      } catch (err) {
        console.warn('[pose] GPU delegate unavailable, falling back to CPU', err);
        this.gpuFailed = true;
      }
    }
    this.landmarker = await create('CPU');
    this.delegate = 'CPU';
  }

  async setNumPoses(n: number): Promise<void> {
    this.numPoses = n;
    await this.landmarker?.setOptions({ numPoses: n });
  }

  get ready(): boolean {
    return !!this.landmarker;
  }

  /** Starts the detection loop on `video`, calling `onFrame` with each result. */
  start(video: HTMLVideoElement, onFrame: (f: DetectionFrame) => void): void {
    this.video = video;
    this.onFrame = onFrame;
    if (this.running) return;
    this.running = true;
    this.lastDetectAt = 0; // don't count the paused time as one very slow frame
    this.warmup = Math.max(this.warmup, 2);
    this.schedule();
  }

  stop(): void {
    this.running = false;
    if (this.video && this.rvfcHandle && 'cancelVideoFrameCallback' in this.video) {
      this.video.cancelVideoFrameCallback(this.rvfcHandle);
    }
    cancelAnimationFrame(this.rafHandle);
    this.rvfcHandle = 0;
    this.rafHandle = 0;
  }

  private schedule(): void {
    if (!this.running || !this.video) return;
    if ('requestVideoFrameCallback' in this.video) {
      this.rvfcHandle = this.video.requestVideoFrameCallback(() => this.tick());
    } else {
      this.rafHandle = requestAnimationFrame(() => this.tick());
    }
  }

  private tick(): void {
    try {
      this.detectOnce();
    } finally {
      // Re-arm only after inference finished: slow inference => skipped frames, no queue.
      this.schedule();
    }
  }

  private detectOnce(): void {
    const video = this.video;
    const lm = this.landmarker;
    if (!video || !lm || video.readyState < 2 || !video.videoWidth) return;
    // With the rAF fallback, skip if the video hasn't advanced.
    if (video.currentTime === this.lastVideoTime) return;
    this.lastVideoTime = video.currentTime;

    // MediaPipe requires strictly increasing timestamps.
    const now = performance.now();
    const ts = Math.max(now, this.lastTs + 1);
    this.lastTs = ts;

    const t0 = performance.now();
    let result;
    try {
      result = lm.detectForVideo(video, ts);
    } catch (err) {
      console.error('[pose] detection failed', err);
      if (this.delegate === 'GPU') {
        // Some GPUs create fine but fail at runtime: rebuild on CPU.
        this.gpuFailed = true;
        this.landmarker = null;
        void this.init(this.model, this.numPoses);
      }
      return;
    }
    const dt = performance.now() - t0;
    if (this.warmup > 0) {
      this.warmup--;
    } else {
      this.inferenceMs = this.inferenceMs ? this.inferenceMs * 0.9 + dt * 0.1 : dt;
      if (this.lastDetectAt) {
        const inst = 1000 / Math.max(1, now - this.lastDetectAt);
        this.detectFps = this.detectFps ? this.detectFps * 0.9 + inst * 0.1 : inst;
      }
    }
    this.lastDetectAt = now;

    const poses: PoseInput[] = result.landmarks.map((lms) => {
      const coords = new Float32Array(NUM_LANDMARKS * 3);
      const visibility = new Float32Array(NUM_LANDMARKS);
      for (let i = 0; i < NUM_LANDMARKS && i < lms.length; i++) {
        coords[i * 3] = lms[i].x;
        coords[i * 3 + 1] = lms[i].y;
        coords[i * 3 + 2] = lms[i].z;
        visibility[i] = lms[i].visibility ?? 1;
      }
      return { coords, visibility };
    });
    this.onFrame?.({ poses, time: now });
  }
}
