/**
 * Renderer: draws a FrameData onto a full-screen canvas.
 * Used by both the main window and the projector window (each has its own instance).
 */
import type { PoseInput } from '../tracker';
import { drawBackground } from './backgrounds';
import { personColor } from './palettes';
import { ALL_SEGMENTS, computeView, projectCoords, toFigure } from './skeleton';
import { ParticleStyle, drawBlocky, drawNeon, drawStick } from './styles';
import type { FrameData } from './types';

export type { FrameData } from './types';

/** Debug overlay input: the raw camera image and unsmoothed detections. */
export interface DebugInput {
  video: HTMLVideoElement;
  raw: PoseInput[];
}

/** Device-pixel-ratio cap: full DPR on high-density phones costs a lot of fill rate. */
const MAX_DPR = 1.5;

export class Renderer {
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private particles = new ParticleStyle();
  private w = 0;
  private h = 0;
  private cssW = 0;
  private cssH = 0;
  private rawPx = new Float32Array(66);

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d', { alpha: false, desynchronized: true });
    if (!ctx) throw new Error('Canvas 2D not supported');
    this.ctx = ctx;
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  /** Matches the backing store to the CSS size (call on resize/orientation change). */
  resize(): void {
    const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
    const w = Math.max(1, Math.round(this.canvas.clientWidth * dpr));
    const h = Math.max(1, Math.round(this.canvas.clientHeight * dpr));
    if (w !== this.canvas.width || h !== this.canvas.height) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    this.w = w;
    this.h = h;
    this.cssW = this.canvas.clientWidth;
    this.cssH = this.canvas.clientHeight;
  }

  draw(frame: FrameData, now: number, debug?: DebugInput): void {
    // Cheap check catches fullscreen/orientation changes that skip 'resize'.
    if (this.canvas.clientWidth !== this.cssW || this.canvas.clientHeight !== this.cssH) this.resize();
    const { ctx, w, h } = this;
    const view = computeView(w, h, frame.videoWidth, frame.videoHeight, frame.mirror);

    drawBackground(ctx, frame.background, w, h, now, frame.beat, frame.palette);

    if (debug) this.drawDebugVideo(debug, view);

    const figures = frame.tracks
      .filter((t) => t.alpha > 0.01)
      .map((t) => toFigure(t, view, personColor(frame.palette, t.colorIndex), frame.beat, h));

    switch (frame.style) {
      case 'stick':
        figures.forEach((f) => drawStick(ctx, f));
        break;
      case 'neon':
        figures.forEach((f) => drawNeon(ctx, f, frame.beat));
        break;
      case 'blocky':
        figures.forEach((f) => drawBlocky(ctx, f));
        break;
      case 'particles':
        this.particles.draw(ctx, figures, frame.beat, now);
        break;
    }

    if (debug) this.drawDebugLandmarks(debug, view);
  }

  /** Debug: the camera image, letterboxed and mirrored exactly like the figures. */
  private drawDebugVideo(debug: DebugInput, view: ReturnType<typeof computeView>): void {
    const { ctx } = this;
    const v = debug.video;
    if (v.readyState < 2) return;
    ctx.save();
    ctx.globalAlpha = 0.6;
    const dw = view.vw * view.scale;
    const dh = view.vh * view.scale;
    if (view.mirror) {
      ctx.translate(view.ox + dw, view.oy);
      ctx.scale(-1, 1);
      ctx.drawImage(v, 0, 0, dw, dh);
    } else {
      ctx.drawImage(v, view.ox, view.oy, dw, dh);
    }
    ctx.restore();
  }

  /** Debug: raw (unsmoothed, untracked) landmarks as thin lines + dots. */
  private drawDebugLandmarks(debug: DebugInput, view: ReturnType<typeof computeView>): void {
    const { ctx } = this;
    ctx.save();
    ctx.lineWidth = 2;
    for (const p of debug.raw) {
      const px = projectCoords(p.coords, view, this.rawPx);
      ctx.strokeStyle = 'rgba(255,60,60,0.9)';
      ctx.beginPath();
      for (const [a, b] of ALL_SEGMENTS) {
        ctx.moveTo(px[a * 2], px[a * 2 + 1]);
        ctx.lineTo(px[b * 2], px[b * 2 + 1]);
      }
      ctx.stroke();
      for (let i = 0; i < 33; i++) {
        ctx.fillStyle = p.visibility[i] > 0.5 ? '#fff' : 'rgba(255,255,255,0.35)';
        ctx.fillRect(px[i * 2] - 3, px[i * 2 + 1] - 3, 6, 6);
      }
    }
    ctx.restore();
  }
}
