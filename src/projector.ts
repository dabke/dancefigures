/**
 * Projector output via a second window (intended for laptops with an external display).
 *
 * The control window runs camera + detection + tracking and posts one FrameData
 * per rendered frame on a BroadcastChannel. The projector window (projector.html)
 * renders those frames with its own Renderer. Only landmark coordinates are sent;
 * no images ever leave the control window, and BroadcastChannel never leaves the device.
 */
import type { FrameData } from './renderer/types';

export const CHANNEL = 'dancefigures-projector';

export type ProjectorMessage =
  | { type: 'frame'; frame: FrameData }
  | { type: 'hello' } // projector -> control: I'm open
  | { type: 'bye' } // projector -> control: I'm closing
  | { type: 'ping' }; // control -> projector: are you there?

/** Control-window side. */
export class ProjectorLink {
  private channel: BroadcastChannel | null = null;
  private win: Window | null = null;
  private lastHello = 0;
  private checkTimer = 0;
  onChange: (connected: boolean) => void = () => {};
  connected = false;

  get supported(): boolean {
    return 'BroadcastChannel' in window;
  }

  constructor() {
    if (!this.supported) return;
    this.channel = new BroadcastChannel(CHANNEL);
    this.channel.onmessage = (e: MessageEvent<ProjectorMessage>) => {
      if (e.data.type === 'hello') {
        this.lastHello = performance.now();
        this.setConnected(true);
      } else if (e.data.type === 'bye') {
        this.setConnected(false);
      }
    };
    // A projector window left open from a previous session will answer this.
    this.channel.postMessage({ type: 'ping' } satisfies ProjectorMessage);
    this.checkTimer = window.setInterval(() => this.check(), 1000);
  }

  /** Must be called from a click handler (popup blockers). */
  open(): boolean {
    const url = new URL('projector.html', document.baseURI).href;
    this.win = window.open(url, 'dancefigures-projector', 'popup,width=1280,height=720');
    if (!this.win) return false;
    this.win.focus();
    return true;
  }

  close(): void {
    this.win?.close();
    this.win = null;
    this.setConnected(false);
  }

  send(frame: FrameData): void {
    if (this.connected) this.channel?.postMessage({ type: 'frame', frame } satisfies ProjectorMessage);
  }

  private check(): void {
    if (this.win?.closed) {
      this.win = null;
      this.setConnected(false);
    }
    // Projector re-announces itself every second; treat 3 s of silence as closed.
    if (this.connected && performance.now() - this.lastHello > 3000) this.setConnected(false);
    this.channel?.postMessage({ type: 'ping' } satisfies ProjectorMessage);
  }

  private setConnected(c: boolean): void {
    if (c === this.connected) return;
    this.connected = c;
    this.onChange(c);
  }

  dispose(): void {
    clearInterval(this.checkTimer);
    this.channel?.close();
  }
}
