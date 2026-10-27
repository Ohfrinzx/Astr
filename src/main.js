// Boot: set up display/input/storage/graphics, then run a fixed 60 Hz
// simulation with rendering on every animation frame.
//
// URL options (for testing): ?stage=N  ?god=1  ?debug=1  ?seed=N

import { TICK_MS } from './config.js';
import { display } from './display.js';
import { input } from './input.js';
import { settings, highScores } from './store.js';
import { audio } from './audio.js';
import { initGfx } from './gfx/render.js';
import { App } from './app.js';

const params = new URLSearchParams(location.search);
const opts = {
  stage: Math.max(1, parseInt(params.get('stage'), 10) || 1),
  god: params.get('god') === '1',
  debug: params.get('debug') === '1',
  seed: params.has('seed') ? parseInt(params.get('seed'), 10) >>> 0 : undefined,
};

const canvas = document.getElementById('screen');
display.init(canvas);
input.init(canvas);
input.onGesture = () => audio.init();
// Some iOS versions only unlock audio on touchend/click, not pointerdown.
window.addEventListener('touchend', () => audio.init(), { passive: true });
window.addEventListener('click', () => audio.init());
settings.load();
highScores.load();
audio.setMuted(settings.muted);
initGfx();

const app = new App(opts);
window.__astr = app; // handy for debugging / automated tests

let last = performance.now();
let acc = 0;
let fpsT = last, frames = 0;

function frame(now) {
  acc += Math.min(now - last, TICK_MS * 6); // don't spiral after a stall
  last = now;
  while (acc >= TICK_MS) {
    app.update();
    input.endTick();
    acc -= TICK_MS;
  }
  app.draw();
  frames++;
  if (now - fpsT >= 1000) { app.fps = (frames * 1000) / (now - fpsT); frames = 0; fpsT = now; }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
