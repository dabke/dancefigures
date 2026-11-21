import type { RenderTrack } from '../tracker';
import type { Background, FigureStyle } from '../settings';

/**
 * Everything needed to draw one frame. This exact object is also what the
 * control window sends to the projector window over BroadcastChannel, so it
 * must stay structured-cloneable (plain objects + typed arrays).
 */
export interface FrameData {
  tracks: RenderTrack[];
  /** Beat envelope 0..1 (0 when beat reaction is off). */
  beat: number;
  videoWidth: number;
  videoHeight: number;
  mirror: boolean;
  style: FigureStyle;
  palette: string;
  background: Background;
}

/** Maps normalized landmark coords to canvas pixels (aspect-preserving "contain" fit). */
export interface View {
  scale: number; // px per video pixel
  ox: number;
  oy: number;
  vw: number;
  vh: number;
  mirror: boolean;
}

/** Projected 2D joints of one person, in canvas pixels. */
export interface Figure {
  id: number;
  color: string;
  alpha: number;
  /** x,y in px for each of the 33 landmarks */
  px: Float32Array;
  vis: Float32Array;
  head: { x: number; y: number; r: number } | null;
  /** Base line width in px, scaled to the person's size on screen (and the beat). */
  lineWidth: number;
}
