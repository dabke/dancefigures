/**
 * Entry point for projector.html: a chrome-less output window that renders
 * frames received from the control window over BroadcastChannel.
 */
import './styles.css';
import { CHANNEL, type ProjectorMessage } from './projector';
import { Renderer } from './renderer';
import type { FrameData } from './renderer/types';
import { WakeLock, enterFullscreen, isFullscreen } from './device';

const canvas = document.getElementById('stage') as HTMLCanvasElement;
const waiting = document.getElementById('waiting') as HTMLElement;
const hint = document.getElementById('fs-hint') as HTMLElement;
const renderer = new Renderer(canvas);
const wake = new WakeLock();
void wake.enable();

let latest: FrameData | null = null;
let lastFrameAt = 0;

const channel = new BroadcastChannel(CHANNEL);
const hello = () => channel.postMessage({ type: 'hello' } satisfies ProjectorMessage);
channel.onmessage = (e: MessageEvent<ProjectorMessage>) => {
  const msg = e.data;
  if (msg.type === 'frame') {
    latest = msg.frame;
    lastFrameAt = performance.now();
  } else if (msg.type === 'ping') {
    hello();
  }
};
hello();
setInterval(hello, 1000);
window.addEventListener('pagehide', () => channel.postMessage({ type: 'bye' } satisfies ProjectorMessage));

// Click / tap / F anywhere to go fullscreen (needs a gesture in *this* window).
const goFullscreen = () => void enterFullscreen();
canvas.addEventListener('click', goFullscreen);
hint.addEventListener('click', goFullscreen);
window.addEventListener('keydown', (e) => {
  if (e.key === 'f' || e.key === 'F') goFullscreen();
});

// Hide the cursor when idle so it doesn't show on the projector.
let cursorTimer = window.setTimeout(() => document.body.classList.add('hide-cursor'), 6000);
window.addEventListener('mousemove', () => {
  document.body.classList.remove('hide-cursor');
  clearTimeout(cursorTimer);
  cursorTimer = window.setTimeout(() => document.body.classList.add('hide-cursor'), 2000);
});

const EMPTY: FrameData = {
  tracks: [], beat: 0, videoWidth: 1280, videoHeight: 720, mirror: true,
  style: 'neon', palette: 'neon', background: 'gradient',
};

function loop(now: number) {
  const stale = !latest || now - lastFrameAt > 2000;
  waiting.hidden = !stale;
  hint.hidden = isFullscreen();
  renderer.draw(stale ? { ...(latest ?? EMPTY), tracks: [], beat: 0 } : latest!, now);
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
