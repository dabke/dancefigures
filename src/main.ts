/**
 * DanceFigures - main (control) window.
 *
 * Pipeline: Camera -> PoseDetector (MediaPipe, rVFC-driven) -> Tracker (IDs,
 * One Euro smoothing, fades) -> Renderer (rAF-driven) and/or projector window.
 * Everything runs on-device; no frames or audio are uploaded or stored.
 */
import './styles.css';
import { BeatDetector } from './audio';
import { Camera, CameraError, describeMediaError } from './camera';
import { WakeLock, enterFullscreen, isStandalone, toggleFullscreen } from './device';
import { PoseDetector } from './pose';
import { ProjectorLink } from './projector';
import { setupPwa } from './pwa';
import { Renderer } from './renderer';
import { PALETTE_KEYS, PALETTE_SIZE } from './renderer/palettes';
import type { FrameData } from './renderer/types';
import { loadSettings, saveSettings, type Settings } from './settings';
import { Tracker, type PoseInput } from './tracker';
import { Ui } from './ui';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

// ---------- State ----------
let settings: Settings = loadSettings(PALETTE_KEYS);
const video = $<HTMLVideoElement>('video');
const camera = new Camera(video);
const detector = new PoseDetector();
const tracker = new Tracker({ smoothing: settings.smoothing, colorCount: PALETTE_SIZE });
const beat = new BeatDetector();
beat.sensitivity = settings.beatSensitivity;
const wake = new WakeLock();
const projector = new ProjectorLink();
const renderer = new Renderer($<HTMLCanvasElement>('stage'));

let running = false; // user pressed Start and we haven't hit a fatal error
let lastRaw: PoseInput[] = [];
let renderFps = 0;
let lastFrameAt = 0;
let lowFpsSince = 0;
let lowFpsHintAt = -Infinity;

// Model loading starts immediately (no user gesture needed), so Start is fast.
let modelReady: Promise<void> = detector.init(settings.model, settings.numPoses);
modelReady.catch((err) => console.error('[pose] init failed', err));

// ---------- UI ----------
const ui = new Ui(settings, {
  onChange: (patch) => void applySettings(patch),
  onSwitchCamera: () => void switchCamera(),
  onFullscreen: () => void toggleFullscreen(),
  onOpenProjector: () => {
    if (!projector.supported) return ui.toast('proj', 'This browser cannot open a projector window.');
    if (!projector.open()) ui.toast('proj', 'Popup blocked: allow popups for this site, then try again.', 6000);
    ui.closePanel();
  },
  onCloseProjector: () => projector.close(),
});

projector.onChange = (connected) => {
  $('control-mode').hidden = !connected;
  ui.toast('proj', connected ? 'Projector window connected' : 'Projector window closed', 2500);
};

setupPwa({
  onOfflineReady: () => ui.toast('offline', '✓ Ready for offline use', 6000),
  onUpdateAvailable: (apply) =>
    ui.toast('update', 'Update available', 0, { label: 'Reload', run: apply }),
  onStatus: (text) => {
    ui.setOfflineStatus(text);
    $('start-offline').textContent = text;
  },
});

async function applySettings(patch: Partial<Settings>): Promise<void> {
  const prev = settings;
  settings = { ...settings, ...patch };
  saveSettings(settings);
  ui.update(settings);

  if (patch.smoothing !== undefined) tracker.setSmoothing(settings.smoothing);
  if (patch.beatSensitivity !== undefined) beat.sensitivity = settings.beatSensitivity;
  if (patch.numPoses !== undefined && patch.numPoses !== prev.numPoses) {
    await detector.setNumPoses(settings.numPoses).catch((e) => console.error(e));
  }
  if (patch.model !== undefined && patch.model !== prev.model) {
    ui.toast('model', `Loading ${settings.model} model…`, 0);
    modelReady = detector.init(settings.model, settings.numPoses);
    try {
      await modelReady;
      ui.toast('model', `${settings.model === 'lite' ? 'Lite' : 'Full'} model ready (${detector.delegate})`, 2000);
    } catch (err) {
      ui.toast('model', `Could not load model: ${(err as Error).message}`, 8000);
    }
  }
  if (patch.beatEnabled !== undefined && running) {
    if (settings.beatEnabled) await startMic();
    else beat.stop();
  }
}

async function startMic(): Promise<void> {
  try {
    await beat.start();
    ui.dismiss('mic');
  } catch (err) {
    ui.toast('mic', `${describeMediaError(err, 'microphone').message} Beat reaction is off for now.`, 10000);
  }
}

async function switchCamera(): Promise<void> {
  if (!running) return;
  try {
    const facing = await camera.switchFacing();
    tracker.reset();
    // Front camera is mirrored by default, back camera is not.
    await applySettings({ facing, mirror: facing === 'user' });
  } catch (err) {
    ui.toast('cam', (err as Error).message, 8000);
  }
}

// ---------- Start screen ----------
function showStartError(message: string): void {
  $('start-error').textContent = message;
  $('start-error').hidden = false;
  $('btn-start').textContent = 'Retry';
}

async function start(): Promise<void> {
  const btn = $<HTMLButtonElement>('btn-start');
  btn.disabled = true;
  $('start-error').hidden = true;
  $('start-progress').textContent = 'Starting camera…';
  try {
    // Fullscreen + audio + camera + mic all need this user gesture.
    if (!isStandalone()) void enterFullscreen();
    await camera.start(settings.facing);
    $('start-progress').textContent = 'Loading pose model…';
    try {
      await modelReady;
    } catch {
      modelReady = detector.init(settings.model, settings.numPoses); // retry once
      await modelReady;
    }
    if (settings.beatEnabled) await startMic();
    await wake.enable();
    running = true;
    $('start').hidden = true;
    startDetection();
    ui.pokeHud();
    if (detector.delegate === 'CPU') ui.toast('cpu', 'GPU unavailable: running on CPU (slower).', 6000);
  } catch (err) {
    console.error(err);
    camera.stop();
    const msg =
      err instanceof CameraError ? err.message : `Could not start: ${(err as Error)?.message ?? err}. Check your connection for the first load, then Retry.`;
    showStartError(msg);
  } finally {
    btn.disabled = false;
    $('start-progress').textContent = '';
  }
}
$('btn-start').addEventListener('click', () => void start());

function startDetection(): void {
  detector.start(video, ({ poses, time }) => {
    lastRaw = poses;
    tracker.aspect = camera.width / camera.height;
    tracker.update(poses, time);
  });
}

// ---------- Page lifecycle: release camera/mic when hidden, resume when shown ----------
async function suspend(): Promise<void> {
  detector.stop();
  camera.stop();
  beat.stop();
}
async function resume(): Promise<void> {
  if (!running || camera.running) return;
  try {
    await camera.start(settings.facing);
    tracker.reset();
    startDetection();
    if (settings.beatEnabled) await startMic();
  } catch (err) {
    running = false;
    $('start').hidden = false;
    showStartError(err instanceof CameraError ? err.message : String(err));
  }
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') void suspend();
  else void resume();
});
window.addEventListener('pagehide', () => void suspend());
window.addEventListener('pageshow', (e) => {
  if (e.persisted) void resume();
});

// ---------- Render loop ----------
function frameData(now: number): FrameData {
  return {
    tracks: tracker.snapshot(now),
    beat: settings.beatEnabled ? beat.sample(now) : 0,
    videoWidth: camera.width,
    videoHeight: camera.height,
    mirror: settings.mirror,
    style: settings.style,
    palette: settings.palette,
    background: settings.background,
  };
}

let statsAt = 0;
function loop(now: number): void {
  requestAnimationFrame(loop);
  if (lastFrameAt) {
    const inst = 1000 / Math.max(1, now - lastFrameAt);
    renderFps = renderFps ? renderFps * 0.95 + inst * 0.05 : inst;
  }
  lastFrameAt = now;

  const frame = frameData(now);
  if (projector.connected) {
    // Control-only mode: the projector window does the drawing.
    projector.send(frame);
  } else {
    renderer.draw(frame, now, settings.debugCamera && running ? { video, raw: lastRaw } : undefined);
  }

  if (now - statsAt > 250) {
    statsAt = now;
    ui.showStats(
      {
        renderFps,
        detectFps: detector.detectFps,
        inferenceMs: detector.inferenceMs,
        delegate: detector.ready ? detector.delegate : 'loading',
        people: frame.tracks.filter((t) => t.alpha > 0.5).length,
        beat: frame.beat,
        wakeLock: wake.supported ? (wake.held ? 'on' : 'off') : 'unsupported',
      },
      settings.showFps,
    );
    checkLowFps(now);
  }
}
requestAnimationFrame(loop);

/** Hint after several seconds below 20 FPS (at most once a minute). */
function checkLowFps(now: number): void {
  if (!running || document.visibilityState !== 'visible') return;
  const effective = Math.min(renderFps, detector.detectFps || renderFps);
  if (effective >= 20) {
    lowFpsSince = 0;
    return;
  }
  lowFpsSince ||= now;
  if (now - lowFpsSince > 4000 && now - lowFpsHintAt > 60000) {
    lowFpsHintAt = now;
    // Fast inference but few detections => the camera itself is slow (Android drops
    // to ~15 fps in dim light). Fewer people won't help there; more light will.
    if (detector.inferenceMs > 0 && detector.inferenceMs < 25 && detector.detectFps < 20 && renderFps >= 20) {
      ui.toast('lowfps', `Camera is delivering only ${detector.detectFps.toFixed(0)} fps, usually because the room is too dark. Add some steady light on the dancers.`, 8000);
      return;
    }
    const tips = [
      settings.numPoses > 2 ? 'reduce People to 1-2' : '',
      settings.model === 'full' ? 'switch to the Lite model' : '',
      settings.style === 'neon' || settings.style === 'particles' ? 'try the Stick style' : '',
    ].filter(Boolean);
    ui.toast('lowfps', `Low frame rate (${effective.toFixed(0)} fps). Tip: ${tips.join(', ') || 'close other apps and keep the phone cool'}.`, 8000);
  }
}

// Read-only hook for automated tests (scripts/e2e.mjs). Exposes no controls.
Object.defineProperty(window, '__dancefigures', {
  value: {
    get people() { return tracker.count; },
    get rawPoses() { return lastRaw.length; },
    get detectFps() { return detector.detectFps; },
    get inferenceMs() { return detector.inferenceMs; },
    get delegate() { return detector.delegate; },
    get renderFps() { return renderFps; },
    get running() { return running; },
  },
});
