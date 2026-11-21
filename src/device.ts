/**
 * Device behavior: Screen Wake Lock, Fullscreen, landscape orientation.
 */

/** Keeps the screen on while enabled; re-acquires after the page becomes visible again. */
export class WakeLock {
  private sentinel: WakeLockSentinel | null = null;
  private wanted = false;

  constructor() {
    document.addEventListener('visibilitychange', () => {
      // The browser releases the lock automatically when the page is hidden.
      if (document.visibilityState === 'visible' && this.wanted) void this.acquire();
    });
  }

  get supported(): boolean {
    return 'wakeLock' in navigator;
  }

  get held(): boolean {
    return !!this.sentinel && !this.sentinel.released;
  }

  async enable(): Promise<void> {
    this.wanted = true;
    await this.acquire();
  }

  async disable(): Promise<void> {
    this.wanted = false;
    await this.sentinel?.release().catch(() => undefined);
    this.sentinel = null;
  }

  private async acquire(): Promise<void> {
    if (!this.supported || this.held || document.visibilityState !== 'visible') return;
    try {
      this.sentinel = await navigator.wakeLock.request('screen');
      this.sentinel.addEventListener('release', () => (this.sentinel = null));
    } catch (err) {
      // e.g. battery saver mode: not fatal, the screen may just dim.
      console.warn('[wakelock] not acquired', err);
    }
  }
}

export const isFullscreen = () => !!document.fullscreenElement;

/** Enters fullscreen (must be called from a user gesture) and tries to lock landscape. */
export async function enterFullscreen(el: HTMLElement = document.documentElement): Promise<void> {
  if (!document.fullscreenElement && el.requestFullscreen) {
    try {
      await el.requestFullscreen({ navigationUI: 'hide' });
    } catch (err) {
      console.warn('[fullscreen] request failed', err);
    }
  }
  await lockLandscape();
}

export async function exitFullscreen(): Promise<void> {
  if (document.fullscreenElement) await document.exitFullscreen().catch(() => undefined);
}

export async function toggleFullscreen(): Promise<void> {
  if (isFullscreen()) await exitFullscreen();
  else await enterFullscreen();
}

/** Orientation lock only works in fullscreen or installed PWAs; failures are harmless. */
export async function lockLandscape(): Promise<void> {
  const o = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> };
  try {
    await o?.lock?.('landscape');
  } catch {
    /* not supported here (e.g. desktop) */
  }
}

export const isStandalone = () =>
  window.matchMedia('(display-mode: standalone)').matches ||
  window.matchMedia('(display-mode: fullscreen)').matches;
