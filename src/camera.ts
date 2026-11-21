/**
 * Camera access: getUserMedia at 1280x720 with a 640x480 fallback,
 * front/back switching, and clean stop/restart for page lifecycle.
 * Frames stay in the <video> element and are never uploaded or stored.
 */
import type { Facing } from './settings';

export class CameraError extends Error {
  constructor(
    message: string,
    public kind: 'denied' | 'notfound' | 'inuse' | 'insecure' | 'unsupported' | 'other',
  ) {
    super(message);
  }
}

/** Converts a getUserMedia DOMException into a friendly, actionable message. */
export function describeMediaError(err: unknown, device: 'camera' | 'microphone'): CameraError {
  const name = (err as DOMException)?.name ?? '';
  if (!window.isSecureContext)
    return new CameraError(`The ${device} only works over HTTPS (or on localhost).`, 'insecure');
  if (!navigator.mediaDevices?.getUserMedia)
    return new CameraError(`This browser does not support ${device} access. Use Chrome on Android.`, 'unsupported');
  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return new CameraError(
        `${device === 'camera' ? 'Camera' : 'Microphone'} permission was denied. Tap the lock/tune icon in Chrome's address bar → Permissions → allow ${device}, then tap Retry.`,
        'denied',
      );
    case 'NotFoundError':
    case 'OverconstrainedError':
      return new CameraError(`No ${device} was found on this device.`, 'notfound');
    case 'NotReadableError':
    case 'AbortError':
      return new CameraError(
        `The ${device} is in use by another app (close video-call or camera apps) or failed to start.`,
        'inuse',
      );
    default:
      return new CameraError(`Could not start the ${device}: ${(err as Error)?.message ?? err}`, 'other');
  }
}

export class Camera {
  readonly video: HTMLVideoElement;
  private stream: MediaStream | null = null;
  facing: Facing = 'user';

  constructor(video: HTMLVideoElement) {
    this.video = video;
    video.muted = true;
    video.playsInline = true;
    video.autoplay = true;
  }

  get running(): boolean {
    return !!this.stream && this.stream.getVideoTracks().some((t) => t.readyState === 'live');
  }

  get width(): number {
    return this.video.videoWidth || 1280;
  }
  get height(): number {
    return this.video.videoHeight || 720;
  }

  /** Starts the camera, trying 1280x720 first and falling back to 640x480, then anything. */
  async start(facing: Facing = this.facing): Promise<void> {
    this.stop();
    this.facing = facing;
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      throw describeMediaError(null, 'camera');
    }
    const attempts: MediaTrackConstraints[] = [
      { facingMode: facing, width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } },
      { facingMode: facing, width: { ideal: 640 }, height: { ideal: 480 } },
      {}, // any camera at all
    ];
    let lastErr: unknown;
    for (const video of attempts) {
      try {
        this.stream = await navigator.mediaDevices.getUserMedia({ video, audio: false });
        break;
      } catch (err) {
        lastErr = err;
        // Permission problems won't be fixed by lowering resolution.
        const n = (err as DOMException)?.name;
        if (n === 'NotAllowedError' || n === 'SecurityError') break;
      }
    }
    if (!this.stream) throw describeMediaError(lastErr, 'camera');

    this.video.srcObject = this.stream;
    await this.video.play().catch(() => undefined);
    if (!this.video.videoWidth) {
      await new Promise<void>((resolve) => {
        const done = () => resolve();
        this.video.addEventListener('loadeddata', done, { once: true });
        setTimeout(done, 3000);
      });
    }
  }

  /** Stops all tracks (camera light goes off). */
  stop(): void {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.video.srcObject = null;
  }

  async switchFacing(): Promise<Facing> {
    const next: Facing = this.facing === 'user' ? 'environment' : 'user';
    await this.start(next);
    return next;
  }
}
