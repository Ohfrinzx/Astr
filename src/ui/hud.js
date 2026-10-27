// Arcade HUD: 1UP score + HIGH SCORE across the top, reserve ships bottom-left,
// stage badges bottom-right. Anchored to the screen edges (and safe areas).

import { drawText } from '../gfx/font.js';
import { drawSprite, spriteSize } from '../gfx/render.js';

export const COLORS = { red: '#f44', white: '#fff', cyan: '#5ff', yellow: '#ff5', blue: '#48f', dim: '#888' };

export function drawHud(ctx, L, { score, high, reserve = 0, badges = [], blink = false, t = 0 }) {
  const y0 = L.hudTop + 1;
  if (!blink || ((t >> 5) & 1)) drawText(ctx, '1UP', L.left + 8, y0, COLORS.red);
  drawText(ctx, String(score).padStart(2, '0'), L.left + 56, y0 + 9, COLORS.white, { align: 'right' });
  drawText(ctx, 'HIGH SCORE', L.cx, y0, COLORS.red, { align: 'center' });
  drawText(ctx, String(high), L.cx + 16, y0 + 9, COLORS.white, { align: 'right' });

  for (let i = 0; i < Math.min(reserve, 8); i++) drawSprite(ctx, 'player', 0, L.left + 10 + i * 16, L.hudBottom);

  let x = L.right - 2;
  for (const v of badges) {
    const name = 'badge' + v;
    const { w } = spriteSize(name);
    x -= w;
    drawSprite(ctx, name, 0, x + w / 2, L.hudBottom);
    x -= 1;
  }
}
