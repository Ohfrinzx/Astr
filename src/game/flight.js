// Flight programs: how enemies move when they are not sitting in formation.
//
// Like the arcade original, motion is "turtle" style: an enemy has a heading
// and a speed, and a program is a list of steps that set speed / heading /
// turn rate and run until a condition is met. Headings are in DEGREES,
// 0 = up, 90 = right, 180 = down, 270 (or -90) = left (clockwise on screen).
//
// Step fields (all optional):
//   sp      set speed at step start (units/tick)
//   head    set heading at step start
//   turn    degrees/tick added to heading
//   aim     steer toward the player, max degrees/tick (instead of turn)
//   seek    {x, y} steer toward a fixed point, max `aim` degrees/tick; ends on arrival
//   fire    number of shots to schedule during this step
//   ---- end condition (first one present wins; none = lasts 1 tick) ----
//   t       ticks
//   toHead  turn until heading reaches this value (in the turn direction)
//   untilY  until y crosses this value (either direction)
//   untilX  until x crosses this value (either direction)
//   op      'home'  steer into formation slot, then settle (ends program)
//           'wrap'  fly straight off the bottom, re-enter from the top, home
//           'leave' fly straight until off-screen, then despawn
//           'beam'  commander tractor-beam sequence (handled by the session)
//
// Path factories receive the current layout L and a mirror sign m (+1 = as
// written, for the LEFT side of the screen; -1 = mirrored to the right side)
// and return absolute numbers, so the same paths work on any screen size.

import { ENEMY } from '../config.js';

const RAD = Math.PI / 180;
export const norm = (a) => ((a % 360) + 360) % 360;
export const angDiff = (from, to) => ((to - from + 540) % 360) - 180;
export const headingTo = (dx, dy) => Math.atan2(dx, -dy) / RAD;

export function step(e, speed = e.speed) {
  e.x += Math.sin(e.heading * RAD) * speed;
  e.y -= Math.cos(e.heading * RAD) * speed;
}

function turnToward(e, target, maxTurn) {
  const d = angDiff(e.heading, target);
  e.heading += Math.max(-maxTurn, Math.min(maxTurn, d));
}

export function startProgram(e, steps) {
  e.prog = steps;
  e.pc = -1;
  nextStep(e);
}

function nextStep(e) {
  e.pc++;
  const s = e.prog[e.pc];
  e.stepT = 0;
  if (!s) return;
  if (s.sp !== undefined) e.speed = s.sp;
  if (s.head !== undefined) e.heading = s.head;
  if (s.toHead !== undefined) {
    const turn = s.turn || 0;
    e.stepLeft = turn >= 0 ? norm(s.toHead - e.heading) : norm(e.heading - s.toHead);
  }
  if (s.untilY !== undefined) e.stepDir = Math.sign(s.untilY - e.y) || 1;
  if (s.untilX !== undefined) e.stepDir = Math.sign(s.untilX - e.x) || 1;
  if (s.fire) e.fireQueue = Array.from({ length: s.fire }, (_, i) => 6 + i * 12);
}

// Advance one tick. `world` provides: playerTarget() -> {x,y}|null,
// slotPos(e) -> {x,y}, layout, onWrap(e), onLeave(e), onHome(e), beamTick(e) -> done.
export function runProgram(e, world) {
  const s = e.prog[e.pc];
  if (!s) { world.onHome(e); return; }
  const L = world.layout;

  if (e.fireQueue) {
    for (let i = 0; i < e.fireQueue.length; i++) {
      if (--e.fireQueue[i] === 0) world.enemyFire(e);
    }
  }

  if (s.op === 'home') return homeTick(e, world);
  if (s.op === 'beam') { if (world.beamTick(e)) nextStep(e); return; }
  if (s.op === 'wrap' || s.op === 'leave') {
    if (s.turn) e.heading += s.turn;
    step(e);
    const off = e.y > L.h + 16 || e.y < -40 || e.x < -32 || e.x > L.w + 32;
    if (off) {
      if (s.op === 'leave') world.onLeave(e);
      else {
        const p = world.slotPos(e);
        e.x = p.x; e.y = -16; e.heading = 180; e.speed = ENEMY.entrySpeed;
        world.onWrap(e);
        startProgram(e, [{ op: 'home' }]);
      }
    }
    return;
  }

  // Steering
  if (s.seek) {
    turnToward(e, headingTo(s.seek.x - e.x, s.seek.y - e.y), s.aim ?? 4);
    if (Math.hypot(s.seek.x - e.x, s.seek.y - e.y) <= e.speed + 0.5) {
      e.x = s.seek.x; e.y = s.seek.y;
      nextStep(e);
      return;
    }
  } else if (s.aim) {
    const p = world.playerTarget();
    if (p && p.y - e.y > 24) turnToward(e, headingTo(p.x - e.x, p.y - e.y), s.aim);
  } else if (s.turn) {
    e.heading += s.turn;
  }
  e.heading = norm(e.heading);
  step(e);
  e.stepT++;

  // End conditions
  let done;
  if (s.t !== undefined) done = e.stepT >= s.t;
  else if (s.toHead !== undefined) {
    e.stepLeft -= Math.abs(s.turn || 0);
    if (e.stepLeft <= 0) { e.heading = norm(s.toHead); done = true; }
  } else if (s.untilY !== undefined) done = (e.y - s.untilY) * e.stepDir >= 0;
  else if (s.untilX !== undefined) done = (e.x - s.untilX) * e.stepDir >= 0;
  else done = !s.seek;
  if (done) nextStep(e);
}

function homeTick(e, world) {
  const p = world.slotPos(e);
  const dx = p.x - e.x, dy = p.y - e.y;
  const dist = Math.hypot(dx, dy);
  const sp = Math.max(e.speed, 1.5);
  if (dist <= sp) {
    e.x = p.x; e.y = p.y;
    world.onHome(e);
    return;
  }
  const want = headingTo(dx, dy);
  if (dist < 36) e.heading = want;
  else turnToward(e, want, ENEMY.homeTurn);
  e.heading = norm(e.heading);
  step(e, sp);
}

// ---------------------------------------------------------------------------
// Entry paths (normal stages end with 'home'; challenge versions end 'leave').

const edgeX = (L, m) => (m > 0 ? -12 : L.w + 12);

export const ENTRY = {
  // From the top near the center, drift outward, U-turn low and climb home.
  topLoop(L, m, o = {}) {
    const loopY = L.playerY - (o.loopUp ?? 112);
    return {
      x: L.cx - m * (o.dx ?? 10), y: -10, head: 180,
      steps: [
        { sp: ENEMY.entrySpeed, t: 6 },
        { turn: 1.2 * m, toHead: 180 + (o.drift ?? 22) * m },
        { untilY: loopY },
        { turn: (o.turn ?? 4.5) * m, toHead: norm((o.end ?? 10) * m) },
        { op: 'home' },
      ],
    };
  },

  // From the lower side edge, sweep in toward the center, big loop, home.
  sideLoop(L, m, o = {}) {
    return {
      x: edgeX(L, m), y: L.playerY - (o.up ?? 46), head: (o.head ?? 52) * m,
      steps: [
        { sp: ENEMY.entrySpeed, untilX: L.cx - (o.toX ?? 46) * m },
        { turn: -(o.turn ?? 5) * m, t: o.loopT ?? 82 },
        { op: 'home' },
      ],
    };
  },

  // From a top corner, slant across toward the center, curl back up, home.
  topSwirl(L, m, o = {}) {
    return {
      x: L.cx - (o.dx ?? 60) * m, y: -10, head: (o.head ?? 162) * m,
      steps: [
        { sp: ENEMY.entrySpeed, untilY: L.formationTop + (o.depth ?? 86) },
        { turn: (o.turn ?? 4) * m, toHead: norm((o.end ?? 330) * m) },
        { op: 'home' },
      ],
    };
  },

  // From the top, straight down the side then a tight double loop.
  topSpiral(L, m, o = {}) {
    return {
      x: L.cx - (o.dx ?? 36) * m, y: -10, head: 180,
      steps: [
        { sp: ENEMY.entrySpeed, untilY: L.playerY - (o.up ?? 120) },
        { turn: (o.turn ?? 6) * m, t: o.loopT ?? 90 },
        { turn: -1.5 * m, toHead: norm(-20 * m) },
        { op: 'home' },
      ],
    };
  },
};

// Challenging-stage paths: fly a show pattern and exit the screen.
export const CHALLENGE = {
  topLoop(L, m) {
    return {
      x: L.cx - m * 8, y: -10, head: 180,
      steps: [
        { sp: 3, untilY: L.playerY - 130 },
        { turn: 4.5 * m, t: 80 },
        { turn: 0.8 * m, t: 50 },
        { op: 'leave' },
      ],
    };
  },
  sideLoop(L, m) {
    return {
      x: edgeX(L, m), y: L.playerY - 40, head: 60 * m,
      steps: [
        { sp: 3, untilX: L.cx - 10 * m },
        { turn: -4.5 * m, t: 80 },
        { turn: -1.2 * m, t: 30 },
        { op: 'leave' },
      ],
    };
  },
  figure8(L, m) {
    return {
      x: edgeX(L, m), y: L.formationTop + 40, head: 100 * m,
      steps: [
        { sp: 3, untilX: L.cx - 30 * m },
        { turn: 5 * m, t: 72 },
        { turn: -5 * m, t: 72 },
        { op: 'leave' },
      ],
    };
  },
  zigzag(L, m) {
    return {
      x: L.cx - 70 * m, y: -10, head: 150 * m,
      steps: [
        { sp: 2.6, t: 30 },
        { turn: 2.5 * m, t: 24 }, { turn: -2.5 * m, t: 48 }, { turn: 2.5 * m, t: 48 },
        { turn: -2.5 * m, t: 48 },
        { turn: -4 * m, toHead: norm(-10 * m) },
        { op: 'leave' },
      ],
    };
  },
  dropSwoop(L, m) {
    return {
      x: L.cx - 30 * m, y: -10, head: 180,
      steps: [
        { sp: 3.2, untilY: L.playerY - 70 },
        { turn: -3.5 * m, toHead: norm(0) },
        { turn: -1 * m, t: 60 },
        { op: 'leave' },
      ],
    };
  },
};

// ---------------------------------------------------------------------------
// Dive attacks from the formation. `m` = +1 if the diver sits on the right
// half (it peels out to the right), -1 on the left. `stage` scales shots.

const shots = (stage) => Math.min(1 + Math.floor((stage + 1) / 4), 3);

export const DIVES = {
  drone(L, m, stage, rng) {
    const loop = rng() < 0.5;
    const steps = [
      { sp: 1.8, turn: 6 * m, toHead: 180 },
      { sp: 2.4, aim: 1.8, untilY: L.playerY - (loop ? 120 : 30), fire: shots(stage) },
    ];
    if (loop) {
      steps.push({ turn: -5 * m, t: 72 }, { aim: 2, untilY: L.playerY });
    }
    steps.push({ op: 'wrap' });
    return steps;
  },

  escort(L, m, stage) {
    return [
      { sp: 1.8, turn: 6 * m, toHead: 180 },
      { sp: 2.4, aim: 1.5, untilY: L.playerY - 90, fire: shots(stage) },
      { turn: 3 * m, t: 18 }, { turn: -3 * m, t: 36 }, { turn: 3 * m, t: 18 },
      { op: 'wrap' },
    ];
  },

  commander(L, m, stage) {
    return [
      { sp: 1.6, turn: 5 * m, toHead: 180 },
      { sp: 2.2, aim: 1.2, untilY: L.playerY - 40, fire: shots(stage) },
      { op: 'wrap' },
    ];
  },

  // Fly to a point above the player's current x, then open the tractor beam.
  beam(L, m, stage, rng, targetX) {
    const x = Math.max(L.left + 24, Math.min(L.right - 24, targetX));
    return [
      { sp: 1.6, turn: 5 * m, toHead: 180 },
      { sp: 2.2, seek: { x, y: L.playerY - 108 }, aim: 3 },
      { sp: 0, head: 180 },
      { op: 'beam' },
      { sp: 2.2, untilY: L.playerY + 30 },
      { op: 'wrap' },
    ];
  },

  // Hostile captured fighter or transformed enemies: dive and exit.
  kamikaze(L, m, stage) {
    return [
      { sp: 2, turn: 6 * m, toHead: 180 },
      { sp: 2.6, aim: 2, untilY: L.playerY - 20, fire: shots(stage) },
      { op: 'leave' },
    ];
  },

  // Independent continuation for escorts whose leader was destroyed.
  orphan(L) {
    return [{ aim: 1.5, untilY: L.playerY + 10 }, { op: 'wrap' }];
  },
};
