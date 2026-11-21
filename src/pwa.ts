/**
 * Service worker registration (vite-plugin-pwa / Workbox, "prompt" mode).
 *  - "Ready for offline use" once every asset (app, projector page, WASM, models) is precached.
 *  - "Update available" with a Reload button when a new version has been deployed.
 */
import { registerSW } from 'virtual:pwa-register';

const OFFLINE_FLAG = 'dancefigures.offlineReady';

export interface PwaHandlers {
  onOfflineReady: () => void;
  onUpdateAvailable: (apply: () => void) => void;
  onStatus: (text: string) => void;
}

export function setupPwa(h: PwaHandlers): void {
  if (!('serviceWorker' in navigator)) {
    h.onStatus('Offline mode is not supported in this browser.');
    return;
  }
  if (localStorage.getItem(OFFLINE_FLAG) && navigator.serviceWorker.controller) {
    h.onStatus('✓ Ready for offline use (all files cached on this device).');
  } else {
    h.onStatus('Downloading files for offline use…');
  }

  const updateSW = registerSW({
    immediate: true,
    onOfflineReady() {
      localStorage.setItem(OFFLINE_FLAG, '1');
      h.onStatus('✓ Ready for offline use (all files cached on this device).');
      h.onOfflineReady();
    },
    onNeedRefresh() {
      h.onUpdateAvailable(() => void updateSW(true));
    },
    onRegisteredSW(_url, reg) {
      // While online, check for a new deployment every 30 minutes.
      if (reg) setInterval(() => navigator.onLine && reg.update().catch(() => undefined), 30 * 60 * 1000);
    },
    onRegisterError(err) {
      console.error('[pwa] service worker registration failed', err);
      h.onStatus('Offline mode unavailable (service worker failed to register).');
    },
  });
}
