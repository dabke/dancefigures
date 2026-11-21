/** Person color palettes. Each tracked person gets one color by index. */
export const PALETTES: Record<string, { label: string; colors: string[] }> = {
  neon: { label: 'Neon', colors: ['#ff2bd6', '#00f0ff', '#b8ff00', '#ffb000', '#8a5cff', '#ff4d4d'] },
  pastel: { label: 'Pastel', colors: ['#ffadd2', '#a0e7ff', '#c8f7a6', '#ffe29a', '#d4b8ff', '#ffc2a8'] },
  fire: { label: 'Fire', colors: ['#ff3d00', '#ffb300', '#ff6f91', '#ffe066', '#ff8a00', '#ff1744'] },
  ocean: { label: 'Ocean', colors: ['#00e5ff', '#1de9b6', '#448aff', '#84ffff', '#7c4dff', '#64ffda'] },
  rainbow: { label: 'Rainbow', colors: ['#ff1744', '#ff9100', '#ffea00', '#00e676', '#2979ff', '#d500f9'] },
  mono: { label: 'White', colors: ['#ffffff', '#e0e0ff', '#ffe0f0', '#e0fff0', '#fff4d0', '#d0f0ff'] },
};

export const PALETTE_KEYS = Object.keys(PALETTES);
export const PALETTE_SIZE = 6;

export function personColor(palette: string, index: number): string {
  const p = PALETTES[palette] ?? PALETTES.neon;
  return p.colors[index % p.colors.length];
}

/** '#rrggbb' -> 'rgba(r,g,b,a)' */
export function withAlpha(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}
