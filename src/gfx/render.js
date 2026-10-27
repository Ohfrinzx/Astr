// Sprite drawing on top of the baked canvases from sprites.js.
//
// Ships rotate to face their direction of travel. To keep the chunky arcade
// look, rotation is pre-computed at ROT_STEPS fixed angles with
// nearest-neighbour sampling at the sprite's own pixel resolution (instead of
// rotating the scaled-up image, which would look smooth/modern).
//
// Angle convention everywhere in the game: radians, 0 = facing up (-y),
// increasing clockwise on screen (PI/2 = facing right).

import { buildSprites } from './sprites.js';

const ROT_STEPS = 32;
let baked = null;     // name -> canvas[] (unrotated)
const rotCache = new Map(); // `${name}:${frame}` -> canvas[ROT_STEPS]

export function initGfx() {
  baked = buildSprites();
}

export function spriteFrames(name) {
  const f = baked[name];
  if (!f) throw new Error(`Unknown sprite "${name}"`);
  return f;
}

function rotations(name, frame) {
  const key = name + ':' + frame;
  let list = rotCache.get(key);
  if (list) return list;
  const src = spriteFrames(name)[frame];
  const sw = src.width, sh = src.height;
  const sdata = src.getContext('2d').getImageData(0, 0, sw, sh).data;
  const D = Math.ceil(Math.hypot(sw, sh)) | 1;
  list = [];
  for (let i = 0; i < ROT_STEPS; i++) {
    const a = (i / ROT_STEPS) * Math.PI * 2;
    const c = Math.cos(a), s = Math.sin(a);
    const cv = document.createElement('canvas');
    cv.width = D; cv.height = D;
    const cx = cv.getContext('2d');
    const img = cx.createImageData(D, D);
    for (let dy = 0; dy < D; dy++) {
      for (let dx = 0; dx < D; dx++) {
        const u = dx + 0.5 - D / 2, v = dy + 0.5 - D / 2;
        // inverse-rotate the destination pixel back into source space
        const sx = Math.floor(u * c + v * s + sw / 2);
        const sy = Math.floor(-u * s + v * c + sh / 2);
        if (sx < 0 || sy < 0 || sx >= sw || sy >= sh) continue;
        const si = (sy * sw + sx) * 4, di = (dy * D + dx) * 4;
        img.data[di] = sdata[si];
        img.data[di + 1] = sdata[si + 1];
        img.data[di + 2] = sdata[si + 2];
        img.data[di + 3] = sdata[si + 3];
      }
    }
    cx.putImageData(img, 0, 0);
    list.push(cv);
  }
  rotCache.set(key, list);
  return list;
}

// Draw sprite `name` frame `frame` centered at (x, y), rotated by `angle`.
export function drawSprite(ctx, name, frame, x, y, angle = 0) {
  const frames = spriteFrames(name);
  const f = ((frame % frames.length) + frames.length) % frames.length;
  let step = Math.round((angle / (Math.PI * 2)) * ROT_STEPS) % ROT_STEPS;
  if (step < 0) step += ROT_STEPS;
  if (step === 0) {
    const src = frames[f];
    ctx.drawImage(src, Math.round(x - src.width / 2), Math.round(y - src.height / 2));
    return;
  }
  const cv = rotations(name, f)[step];
  ctx.drawImage(cv, Math.round(x - cv.width / 2), Math.round(y - cv.height / 2));
}

export function spriteSize(name) {
  const c = spriteFrames(name)[0];
  return { w: c.width, h: c.height };
}
