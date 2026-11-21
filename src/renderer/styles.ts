/**
 * The four figure styles. Each draws one Figure (already projected to pixels).
 * The particle style keeps per-person trail history and a shared particle pool,
 * so it lives in a small stateful class.
 */
import { ALL_SEGMENTS, JOINTS, L, LIMBS, TORSO, bonesPath, segVisible, visible } from './skeleton';
import { withAlpha } from './palettes';
import type { Figure } from './types';

type Ctx = CanvasRenderingContext2D;

// ---------- Stick figure: lines plus a circle head ----------
export function drawStick(ctx: Ctx, f: Figure): void {
  ctx.globalAlpha = f.alpha;
  ctx.strokeStyle = f.color;
  ctx.lineWidth = f.lineWidth;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.stroke(bonesPath(f));
  if (f.head) {
    ctx.beginPath();
    ctx.arc(f.head.x, f.head.y, f.head.r, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

// ---------- Neon glow skeleton: additive glow with a bright core ----------
// Uses several wide translucent strokes instead of shadowBlur (much faster on phones).
export function drawNeon(ctx: Ctx, f: Figure, beat: number): void {
  const path = bonesPath(f);
  if (f.head) {
    path.moveTo(f.head.x + f.head.r, f.head.y);
    path.arc(f.head.x, f.head.y, f.head.r, 0, Math.PI * 2);
  }
  const glow = 1 + beat * 0.8;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  // [width multiplier, alpha]: wide & faint -> narrow & strong approximates a soft glow.
  const passes: [number, number][] = [
    [6.5 * glow, 0.035],
    [5 * glow, 0.05],
    [3.8 * glow, 0.08],
    [2.7, 0.14],
    [1.9, 0.28],
    [1.3, 0.5],
  ];
  for (const [w, a] of passes) {
    ctx.strokeStyle = withAlpha(f.color, Math.min(1, a * f.alpha * glow));
    ctx.lineWidth = f.lineWidth * w;
    ctx.stroke(path);
  }
  // Bright white-ish core.
  ctx.strokeStyle = `rgba(255,255,255,${0.9 * f.alpha})`;
  ctx.lineWidth = Math.max(1.5, f.lineWidth * 0.45);
  ctx.stroke(path);
  ctx.restore();
}

// ---------- Blocky: circles for joints, rounded rectangles for limbs ----------
export function drawBlocky(ctx: Ctx, f: Figure): void {
  const w = f.lineWidth * 2.4;
  ctx.save();
  ctx.globalAlpha = f.alpha;
  ctx.fillStyle = f.color;
  ctx.strokeStyle = 'rgba(0,0,0,0.35)';
  ctx.lineWidth = Math.max(1, f.lineWidth * 0.25);

  // Torso as a filled quad.
  const q = [L.L_SHOULDER, L.R_SHOULDER, L.R_HIP, L.L_HIP];
  if (q.every((i) => visible(f, i))) {
    ctx.beginPath();
    q.forEach((i, k) => (k ? ctx.lineTo(f.px[i * 2], f.px[i * 2 + 1]) : ctx.moveTo(f.px[i * 2], f.px[i * 2 + 1])));
    ctx.closePath();
    ctx.globalAlpha = f.alpha * 0.85;
    ctx.fill();
    ctx.globalAlpha = f.alpha;
  }

  // Limbs as rotated rounded rectangles.
  for (const [a, b] of [...LIMBS, ...TORSO]) {
    if (!segVisible(f, a, b)) continue;
    const ax = f.px[a * 2], ay = f.px[a * 2 + 1];
    const dx = f.px[b * 2] - ax, dy = f.px[b * 2 + 1] - ay;
    const len = Math.hypot(dx, dy);
    if (len < 1) continue;
    ctx.save();
    ctx.translate(ax, ay);
    ctx.rotate(Math.atan2(dy, dx));
    ctx.beginPath();
    ctx.roundRect(0, -w / 2, len, w, w / 2.5);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  // Joints as circles (slightly lighter).
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  for (const j of JOINTS) {
    if (!visible(f, j)) continue;
    ctx.beginPath();
    ctx.arc(f.px[j * 2], f.px[j * 2 + 1], w * 0.42, 0, Math.PI * 2);
    ctx.fill();
  }

  // Head as a rounded square.
  if (f.head) {
    const s = f.head.r * 2;
    ctx.fillStyle = f.color;
    ctx.beginPath();
    ctx.roundRect(f.head.x - f.head.r, f.head.y - f.head.r, s, s, s * 0.25);
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
}

// ---------- Particles: dots at joints with fading motion trails ----------
interface Particle { x: number; y: number; vx: number; vy: number; life: number; max: number; color: string; size: number }

const TRAIL_LEN = 10;
const MAX_PARTICLES = 700;
const TRAIL_JOINTS = [...JOINTS, L.L_INDEX, L.R_INDEX, L.L_FOOT, L.R_FOOT];
const EMITTERS = [L.L_WRIST, L.R_WRIST, L.L_ANKLE, L.R_ANKLE];

export class ParticleStyle {
  /** Per-person ring buffer of past joint positions. */
  private trails = new Map<number, { frames: Float32Array[]; head: number }>();
  private particles: Particle[] = [];
  private lastT = 0;

  draw(ctx: Ctx, figures: Figure[], beat: number, now: number): void {
    const dt = this.lastT ? Math.min(0.05, (now - this.lastT) / 1000) : 1 / 60;
    this.lastT = now;
    const seen = new Set<number>();

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const f of figures) {
      seen.add(f.id);
      let tr = this.trails.get(f.id);
      if (!tr) {
        tr = { frames: [], head: 0 };
        this.trails.set(f.id, tr);
      }
      // Push current positions.
      const snap = new Float32Array(f.px);
      const prev = tr.frames.length ? tr.frames[(tr.head - 1 + tr.frames.length) % tr.frames.length] : null;
      if (tr.frames.length < TRAIL_LEN) tr.frames.push(snap);
      else tr.frames[tr.head] = snap;
      tr.head = (tr.head + 1) % TRAIL_LEN;

      // Draw trails: oldest = smallest & faintest.
      const n = tr.frames.length;
      for (let k = 0; k < n; k++) {
        const frame = tr.frames[(tr.head + k) % n];
        const age = (k + 1) / n; // 1 = newest
        ctx.fillStyle = withAlpha(f.color, f.alpha * age * age * 0.8);
        const r = f.lineWidth * (0.35 + 0.85 * age) * (1 + beat * 0.5);
        ctx.beginPath();
        for (const j of TRAIL_JOINTS) {
          if (!visible(f, j)) continue;
          ctx.moveTo(frame[j * 2] + r, frame[j * 2 + 1]);
          ctx.arc(frame[j * 2], frame[j * 2 + 1], r, 0, Math.PI * 2);
        }
        ctx.fill();
      }
      // Faint skeleton hint so the body reads as a person.
      ctx.strokeStyle = withAlpha(f.color, 0.18 * f.alpha);
      ctx.lineWidth = f.lineWidth * 0.5;
      ctx.lineCap = 'round';
      ctx.stroke(bonesPath(f, ALL_SEGMENTS));
      if (f.head) {
        ctx.fillStyle = withAlpha(f.color, 0.5 * f.alpha);
        ctx.beginPath();
        ctx.arc(f.head.x, f.head.y, f.head.r * 0.8, 0, Math.PI * 2);
        ctx.fill();
      }

      // Emit sparks from hands & feet, more when moving fast or on a beat.
      if (prev) {
        for (const j of EMITTERS) {
          if (!visible(f, j)) continue;
          const vx = (snap[j * 2] - prev[j * 2]) / dt;
          const vy = (snap[j * 2 + 1] - prev[j * 2 + 1]) / dt;
          const speed = Math.hypot(vx, vy) / Math.max(30, f.lineWidth * 20);
          const count = Math.min(4, Math.floor(speed * 0.6 + beat * 3 + Math.random()));
          for (let c = 0; c < count && this.particles.length < MAX_PARTICLES; c++) {
            const life = 0.5 + Math.random() * 0.6;
            this.particles.push({
              x: snap[j * 2], y: snap[j * 2 + 1],
              vx: vx * 0.15 + (Math.random() - 0.5) * 120,
              vy: vy * 0.15 + (Math.random() - 0.5) * 120 - 40,
              life, max: life, color: f.color,
              size: f.lineWidth * (0.3 + Math.random() * 0.5),
            });
          }
        }
      }
    }

    // Update & draw free particles.
    let w = 0;
    for (const p of this.particles) {
      p.life -= dt;
      if (p.life <= 0) continue;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 60 * dt; // light gravity
      p.vx *= 0.98;
      const a = p.life / p.max;
      ctx.fillStyle = withAlpha(p.color, a * 0.9);
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * (0.4 + a * 0.6), 0, Math.PI * 2);
      ctx.fill();
      this.particles[w++] = p;
    }
    this.particles.length = w;
    ctx.restore();

    // Forget trails of people who are gone.
    for (const id of this.trails.keys()) if (!seen.has(id)) this.trails.delete(id);
  }
}
