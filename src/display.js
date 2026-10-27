// Full-screen canvas with uniform (never stretched) scaling.
//
// The arcade screen is 224x288. We scale so that a 224x288 area always fits,
// then EXTEND the world in the other dimension so the canvas fills the whole
// screen with no letterbox bars. World size is therefore at least 224 x 288
// and matches the screen's aspect ratio exactly; gameplay code reads the
// current size from `display.layout` every tick and positions itself from it.

import { BASE_W, BASE_H, LAYOUT, TALL_FORMATION_SHIFT } from './config.js';

export const display = {
  canvas: null,
  ctx: null,
  dpr: 1,
  scale: 1,     // device pixels per world unit
  cssScale: 1,  // CSS pixels per world unit (for converting pointer input)
  w: BASE_W,    // world width
  h: BASE_H,    // world height
  layout: null,
  _safe: null,

  init(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this._safe = document.getElementById('safe-area-probe');
    const onResize = () => this.resize();
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', () => setTimeout(onResize, 100));
    if (window.visualViewport) window.visualViewport.addEventListener('resize', onResize);
    this.resize();
  },

  resize() {
    const cssW = Math.max(1, window.innerWidth);
    const cssH = Math.max(1, window.innerHeight);
    this.dpr = Math.min(window.devicePixelRatio || 1, 3);
    const pw = Math.round(cssW * this.dpr);
    const ph = Math.round(cssH * this.dpr);
    if (this.canvas.width !== pw) this.canvas.width = pw;
    if (this.canvas.height !== ph) this.canvas.height = ph;
    this.canvas.style.width = cssW + 'px';
    this.canvas.style.height = cssH + 'px';

    this.scale = Math.min(pw / BASE_W, ph / BASE_H);
    this.cssScale = this.scale / this.dpr;
    this.w = pw / this.scale;
    this.h = ph / this.scale;
    this.layout = computeLayout(this.w, this.h, this.safeInsets());
  },

  // Safe-area insets (notches, home indicator) converted to world units.
  safeInsets() {
    const out = { top: 0, bottom: 0, left: 0, right: 0 };
    if (!this._safe) return out;
    const cs = getComputedStyle(this._safe);
    for (const k of Object.keys(out)) {
      const px = parseFloat(cs.getPropertyValue('padding-' + k)) || 0;
      out[k] = px / this.cssScale;
    }
    return out;
  },

  // Convert client (CSS pixel) coordinates to world coordinates.
  toWorld(clientX, clientY) {
    return { x: clientX / this.cssScale, y: clientY / this.cssScale };
  },

  beginFrame() {
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.setTransform(this.scale, 0, 0, this.scale, 0, 0);
    ctx.imageSmoothingEnabled = false;
  },
};

export function computeLayout(w, h, safe = { top: 0, bottom: 0, left: 0, right: 0 }) {
  const extraH = Math.max(0, h - BASE_H);
  const top = safe.top;
  const bottom = h - safe.bottom;
  return {
    w, h,
    cx: w / 2,
    left: safe.left,
    right: w - safe.right,
    hudTop: top + LAYOUT.hudTop,          // first HUD text row
    hudBottom: bottom - 12,               // y of reserve ships / badges row center
    formationTop: top + LAYOUT.formationTop + extraH * TALL_FORMATION_SHIFT,
    playerY: bottom - LAYOUT.playerFromBottom,
    bottom,
  };
}
