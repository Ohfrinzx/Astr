// Keyboard + touch/pointer input, sampled once per simulation tick.
//
// Keyboard: A/D or arrows move, Space fires. W/S/arrows up/down only matter in
// menus (the ship only moves horizontally, as in the arcade).
// Touch: one finger drags the ship (relative movement, so the finger never has
// to cover the ship) and auto-fires while down. A second finger = pause.
// Taps (short touch / click without movement) are queued for menus.

import { display } from './display.js';

const BINDINGS = {
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  up: ['KeyW', 'ArrowUp'],
  down: ['KeyS', 'ArrowDown'],
  fire: ['Space'],
  start: ['Space', 'Enter'],
  pause: ['KeyP', 'Escape'],
  rapid: ['KeyR'],
  mute: ['KeyM'],
  quit: ['KeyQ'],
};
const BLOCK_DEFAULT = new Set(['Space', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']);
const TAP_MAX_MOVE_CSS = 12;
const TAP_MAX_MS = 400;

export const input = {
  held: new Set(),     // key codes currently down
  pressed: new Set(),  // key codes pressed since the last tick
  pointers: new Map(), // pointerId -> { x, y, startX, startY, t, moved }
  dragId: null,        // pointer currently steering the ship
  dragDX: 0,           // accumulated horizontal drag (world units) since last tick
  taps: [],            // [{ x, y }] world coords
  pausePressed: false, // second-finger tap
  focusLost: false,
  mode: matchMedia('(pointer: coarse)').matches ? 'touch' : 'keys',
  onGesture: null,     // called on every user gesture (used to unlock audio)

  init(target) {
    window.addEventListener('keydown', (e) => {
      if (BLOCK_DEFAULT.has(e.code)) e.preventDefault();
      this.mode = 'keys';
      this.onGesture?.();
      if (!e.repeat) this.pressed.add(e.code);
      this.held.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.held.delete(e.code));
    window.addEventListener('blur', () => this.loseFocus());
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.loseFocus(); });

    target.addEventListener('pointerdown', (e) => this.pointerDown(e));
    window.addEventListener('pointermove', (e) => this.pointerMove(e));
    window.addEventListener('pointerup', (e) => this.pointerUp(e));
    window.addEventListener('pointercancel', (e) => this.pointerUp(e, true));
    // Stop iOS/Android scrolling, pinch-zoom and double-tap zoom.
    const block = (e) => e.preventDefault();
    target.addEventListener('touchstart', block, { passive: false });
    target.addEventListener('touchmove', block, { passive: false });
    target.addEventListener('contextmenu', block);
  },

  loseFocus() {
    this.held.clear();
    this.pointers.clear();
    this.dragId = null;
    this.focusLost = true;
  },

  pointerDown(e) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (e.pointerType !== 'mouse') this.mode = 'touch';
    this.onGesture?.();
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, startX: e.clientX, startY: e.clientY, t: performance.now(), moved: false });
    if (this.dragId === null) this.dragId = e.pointerId;
    else this.pausePressed = true;
  },

  pointerMove(e) {
    const p = this.pointers.get(e.pointerId);
    if (!p) return;
    if (e.pointerId === this.dragId) this.dragDX += (e.clientX - p.x) / display.cssScale;
    p.x = e.clientX;
    p.y = e.clientY;
    if (Math.hypot(p.x - p.startX, p.y - p.startY) > TAP_MAX_MOVE_CSS) p.moved = true;
  },

  pointerUp(e, cancelled = false) {
    const p = this.pointers.get(e.pointerId);
    if (!p) return;
    this.pointers.delete(e.pointerId);
    if (!cancelled && !p.moved && performance.now() - p.t < TAP_MAX_MS) {
      this.taps.push(display.toWorld(p.startX, p.startY));
    }
    if (e.pointerId === this.dragId) {
      // Hand steering to another finger that is still down, if any.
      const next = this.pointers.keys().next();
      this.dragId = next.done ? null : next.value;
    }
  },

  isHeld(action) { return BINDINGS[action].some((c) => this.held.has(c)); },
  wasPressed(action) { return BINDINGS[action].some((c) => this.pressed.has(c)); },
  get touching() { return this.dragId !== null; },

  consumeDrag() { const d = this.dragDX; this.dragDX = 0; return d; },
  takeTap() { return this.taps.shift() || null; },
  takePause() { const p = this.pausePressed; this.pausePressed = false; return p; },
  takeFocusLost() { const f = this.focusLost; this.focusLost = false; return f; },

  // Call after each simulation tick: clears edge-triggered state.
  endTick() {
    this.pressed.clear();
    this.taps.length = 0;
    this.pausePressed = false;
  },
};
