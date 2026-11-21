/**
 * DOM UI: settings slide-over panel, HUD buttons, toasts, swipe gestures.
 * Kept free of app logic: it reads/writes Settings and calls callbacks.
 */
import { BACKGROUNDS, STYLES, type Settings } from './settings';
import { PALETTES } from './renderer/palettes';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

export interface UiCallbacks {
  onChange: (patch: Partial<Settings>) => void;
  onSwitchCamera: () => void;
  onFullscreen: () => void;
  onOpenProjector: () => void;
  onCloseProjector: () => void;
}

export interface Stats {
  renderFps: number;
  detectFps: number;
  inferenceMs: number;
  delegate: string;
  people: number;
  beat: number;
  wakeLock: string;
}

type Option<T> = { id: T; label: string; swatch?: string[] };

export class Ui {
  private panel = $('panel');
  private body = $('panel-body');
  private statsEl!: HTMLElement;
  private beatMeter!: HTMLElement;
  private toastTimers = new Map<string, number>();
  private hudTimer = 0;
  private settings: Settings;

  constructor(settings: Settings, private cb: UiCallbacks) {
    this.settings = settings;
    this.build();
    $('btn-settings').addEventListener('click', () => this.openPanel());
    $('panel-close').addEventListener('click', () => this.closePanel());
    $('panel-scrim').addEventListener('click', () => this.closePanel());
    $('btn-style').addEventListener('click', () => this.cycleStyle(1));
    $('btn-fullscreen').addEventListener('click', () => cb.onFullscreen());
    $('btn-camera').addEventListener('click', () => cb.onSwitchCamera());
    $('btn-close-projector').addEventListener('click', () => cb.onCloseProjector());
    this.installGestures($('stage'));
    window.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowRight') this.cycleStyle(1);
      if (e.key === 'ArrowLeft') this.cycleStyle(-1);
      if (e.key === 'Escape') this.closePanel();
    });
  }

  // ---------- Panel ----------
  openPanel(): void {
    this.panel.classList.add('open');
    document.body.classList.add('panel-open');
    $('panel-scrim').hidden = false;
  }
  closePanel(): void {
    this.panel.classList.remove('open');
    document.body.classList.remove('panel-open');
    $('panel-scrim').hidden = true;
  }

  /** Re-syncs all controls to `s` (e.g. after a programmatic change). */
  update(s: Settings): void {
    this.settings = s;
    this.body.querySelectorAll<HTMLElement>('[data-key]').forEach((el) => {
      const key = el.dataset.key as keyof Settings;
      const val = s[key];
      if (el instanceof HTMLInputElement) el.value = String(val);
      else if (el.dataset.value !== undefined) el.setAttribute('aria-pressed', String(String(val) === el.dataset.value));
      else el.setAttribute('aria-pressed', String(!!val));
    });
    $('btn-style').textContent = STYLES.find((x) => x.id === s.style)?.label ?? 'Style';
    $('fps').hidden = !s.showFps;
    $('sens-row').classList.toggle('disabled', !s.beatEnabled);
  }

  private set(patch: Partial<Settings>): void {
    this.cb.onChange(patch);
  }

  cycleStyle(dir: number): void {
    const i = STYLES.findIndex((x) => x.id === this.settings.style);
    const next = STYLES[(i + dir + STYLES.length) % STYLES.length];
    this.set({ style: next.id });
    this.toast('style', next.label, 900);
  }

  private build(): void {
    const b = this.body;
    b.innerHTML = '';

    this.section(b, 'Look');
    this.segmented(b, 'Style', 'style', STYLES);
    this.segmented(b, 'Background', 'background', BACKGROUNDS);
    this.segmented(
      b, 'Colors', 'palette',
      Object.entries(PALETTES).map(([id, p]) => ({ id, label: p.label, swatch: p.colors.slice(0, 4) })),
    );

    this.section(b, 'Detection');
    this.segmented(b, 'People', 'numPoses', [1, 2, 3, 4].map((n) => ({ id: n, label: String(n) })));
    this.segmented(b, 'Model', 'model', [
      { id: 'lite', label: 'Lite (fast)' },
      { id: 'full', label: 'Full (accurate)' },
    ]);
    this.slider(b, 'Smoothing', 'smoothing');
    const cut = this.slider(b, 'Limb confidence cutoff', 'minVisibility');
    const cutNote = document.createElement('p');
    cutNote.className = 'note';
    cutNote.textContent =
      'Lower: show arms/legs even when the camera is unsure (dim light, partly out of frame). ' +
      'Higher: hide guessed limbs that wobble. Turn on Debug below to see which joints are cut (red).';
    cut.append(cutNote);

    this.section(b, 'Beat');
    this.toggle(b, 'React to music (mic)', 'beatEnabled');
    const sens = this.slider(b, 'Sensitivity', 'beatSensitivity');
    sens.id = 'sens-row';
    this.beatMeter = document.createElement('div');
    this.beatMeter.className = 'meter';
    this.beatMeter.innerHTML = '<span></span>';
    sens.append(this.beatMeter);

    this.section(b, 'Camera');
    this.toggle(b, 'Mirror', 'mirror');
    this.button(b, 'Switch front / back camera', () => this.cb.onSwitchCamera());
    this.toggle(b, 'Debug: show camera + raw landmarks', 'debugCamera');

    this.section(b, 'Output');
    this.button(b, 'Fullscreen (for HDMI / casting the phone)', () => this.cb.onFullscreen());
    this.button(b, 'Open projector window', () => this.cb.onOpenProjector());
    const note = document.createElement('p');
    note.className = 'note';
    note.textContent =
      'Projector window is intended for laptops: drag the new window onto the projector screen and click it to go fullscreen. ' +
      'On a phone, use Fullscreen and mirror the screen via HDMI adapter or Cast instead.';
    b.append(note);

    this.section(b, 'Performance');
    this.toggle(b, 'Show FPS counter', 'showFps');
    this.statsEl = document.createElement('pre');
    this.statsEl.className = 'stats';
    b.append(this.statsEl);

    this.section(b, 'App');
    const about = document.createElement('p');
    about.className = 'note';
    about.id = 'offline-status';
    about.textContent = 'Checking offline support…';
    b.append(about);
    const ver = document.createElement('p');
    ver.className = 'note';
    ver.textContent = `Version ${__APP_VERSION__}. Everything runs on this device; no video or audio is uploaded or stored.`;
    b.append(ver);

    this.update(this.settings);
  }

  private section(parent: HTMLElement, title: string): void {
    const h = document.createElement('h3');
    h.textContent = title;
    parent.append(h);
  }

  private row(parent: HTMLElement, label: string): HTMLElement {
    const row = document.createElement('div');
    row.className = 'row';
    const l = document.createElement('div');
    l.className = 'label';
    l.textContent = label;
    row.append(l);
    parent.append(row);
    return row;
  }

  private segmented<T extends string | number>(parent: HTMLElement, label: string, key: keyof Settings, opts: Option<T>[]): void {
    const row = this.row(parent, label);
    const group = document.createElement('div');
    group.className = 'seg';
    for (const o of opts) {
      const btn = document.createElement('button');
      btn.dataset.key = key;
      btn.dataset.value = String(o.id);
      if (o.swatch) {
        const sw = document.createElement('span');
        sw.className = 'swatch';
        sw.style.background = `linear-gradient(90deg, ${o.swatch.join(',')})`;
        btn.append(sw);
      }
      btn.append(o.label);
      btn.addEventListener('click', () => this.set({ [key]: o.id } as Partial<Settings>));
      group.append(btn);
    }
    row.append(group);
  }

  private toggle(parent: HTMLElement, label: string, key: keyof Settings): void {
    const btn = document.createElement('button');
    btn.className = 'toggle';
    btn.dataset.key = key;
    btn.innerHTML = `<span class="t-label"></span><span class="switch"></span>`;
    (btn.firstChild as HTMLElement).textContent = label;
    btn.addEventListener('click', () => this.set({ [key]: !this.settings[key] } as Partial<Settings>));
    parent.append(btn);
  }

  private slider(parent: HTMLElement, label: string, key: keyof Settings): HTMLElement {
    const row = this.row(parent, label);
    const input = document.createElement('input');
    input.type = 'range';
    input.min = '0';
    input.max = '1';
    input.step = '0.05';
    input.dataset.key = key;
    input.addEventListener('input', () => this.set({ [key]: Number(input.value) } as Partial<Settings>));
    row.append(input);
    return row;
  }

  private button(parent: HTMLElement, label: string, onClick: () => void): void {
    const btn = document.createElement('button');
    btn.className = 'action';
    btn.textContent = label;
    btn.addEventListener('click', onClick);
    parent.append(btn);
  }

  // ---------- Live readouts ----------
  showStats(s: Stats, showFps: boolean): void {
    const text =
      `Render     ${s.renderFps.toFixed(0)} fps\n` +
      `Detection  ${s.detectFps.toFixed(0)} fps\n` +
      `Inference  ${s.inferenceMs.toFixed(1)} ms (${s.delegate})\n` +
      `People     ${s.people}\n` +
      `Wake lock  ${s.wakeLock}`;
    if (this.panel.classList.contains('open')) this.statsEl.textContent = text;
    this.beatMeter.firstElementChild!.setAttribute('style', `width:${Math.round(s.beat * 100)}%`);
    if (showFps) $('fps').textContent = `${s.renderFps.toFixed(0)} fps · ${s.inferenceMs.toFixed(0)} ms · ${s.people}p`;
  }

  setOfflineStatus(text: string): void {
    const el = document.getElementById('offline-status');
    if (el) el.textContent = text;
  }

  // ---------- Toasts ----------
  /** Shows (or replaces) a toast identified by `key`. duration 0 = sticky. */
  toast(key: string, text: string, duration = 4000, action?: { label: string; run: () => void }): void {
    let el = document.querySelector<HTMLElement>(`.toast[data-key="${key}"]`);
    if (!el) {
      el = document.createElement('div');
      el.className = 'toast';
      el.dataset.key = key;
      $('toasts').append(el);
    }
    el.innerHTML = '';
    const span = document.createElement('span');
    span.textContent = text;
    el.append(span);
    if (action) {
      const btn = document.createElement('button');
      btn.textContent = action.label;
      btn.addEventListener('click', () => {
        action.run();
        this.dismiss(key);
      });
      el.append(btn);
    }
    const close = document.createElement('button');
    close.className = 'x';
    close.setAttribute('aria-label', 'Dismiss');
    close.textContent = '×';
    close.addEventListener('click', () => this.dismiss(key));
    el.append(close);
    clearTimeout(this.toastTimers.get(key));
    if (duration > 0) this.toastTimers.set(key, window.setTimeout(() => this.dismiss(key), duration));
  }

  dismiss(key: string): void {
    document.querySelector(`.toast[data-key="${key}"]`)?.remove();
  }

  // ---------- HUD auto-hide + swipe ----------
  /** Shows the HUD buttons, hiding them again after a few seconds of no touches. */
  pokeHud(): void {
    document.body.classList.remove('hud-hidden');
    clearTimeout(this.hudTimer);
    this.hudTimer = window.setTimeout(() => {
      if (!this.panel.classList.contains('open')) document.body.classList.add('hud-hidden');
    }, 4000);
  }

  private installGestures(el: HTMLElement): void {
    let x0 = 0, y0 = 0, t0 = 0, tracking = false;
    el.addEventListener('pointerdown', (e) => {
      tracking = true;
      x0 = e.clientX; y0 = e.clientY; t0 = performance.now();
    });
    el.addEventListener('pointerup', (e) => {
      if (!tracking) return;
      tracking = false;
      const dx = e.clientX - x0, dy = e.clientY - y0;
      if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5 && performance.now() - t0 < 800) {
        this.cycleStyle(dx < 0 ? 1 : -1); // swipe left = next style
      } else {
        this.pokeHud();
      }
    });
    el.addEventListener('pointercancel', () => (tracking = false));
    window.addEventListener('pointermove', () => {
      if (document.body.classList.contains('hud-hidden')) this.pokeHud();
    });
  }
}
