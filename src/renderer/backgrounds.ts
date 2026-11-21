/** Backgrounds: solid black, slow animated gradient, beat-reactive. */
import type { Background } from '../settings';
import { personColor, withAlpha } from './palettes';

export function drawBackground(
  ctx: CanvasRenderingContext2D,
  kind: Background,
  w: number,
  h: number,
  now: number,
  beat: number,
  palette: string,
): void {
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
  const t = now / 1000;

  if (kind === 'black') {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, w, h);
    return;
  }

  if (kind === 'gradient') {
    // Hue drifts ~6 deg/s; brightness bumps slightly with the beat.
    const hue = (t * 6) % 360;
    const l = 9 + beat * 6;
    const g = ctx.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, `hsl(${hue},70%,${l}%)`);
    g.addColorStop(0.5, `hsl(${(hue + 60) % 360},60%,${l * 0.6}%)`);
    g.addColorStop(1, `hsl(${(hue + 140) % 360},70%,${l}%)`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    return;
  }

  // Beat-reactive: dark base + radial bloom whose size/intensity follows the bass.
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, w, h);
  const c1 = personColor(palette, Math.floor(t / 4) % 6); // color rotates every 4 s
  const c2 = personColor(palette, (Math.floor(t / 4) + 3) % 6);
  const r = Math.max(w, h) * (0.35 + beat * 0.5);
  const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, r);
  g.addColorStop(0, withAlpha(c1, 0.12 + beat * 0.5));
  g.addColorStop(0.6, withAlpha(c2, 0.05 + beat * 0.2));
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
}
