// Stage scripts: which enemies enter, in what order, along which paths.
//
// A stage is { challenge, waves: [wave...] }.
// A wave is { gap, lines: [line...] }: all lines of a wave start together and
// each line spawns its members one after another, `gap` ticks apart.
// A line is { path(L) -> {x, y, head, steps}, lat, members: [{type, row?, col?}] }
// `lat` shifts the whole line sideways (relative to its initial heading) so two
// lines on the same path fly side by side as pairs.

import { ENTRY, CHALLENGE } from './flight.js';
import { isChallengeStage } from '../config.js';

const D = (row, col) => ({ type: 'drone', row, col });
const E = (row, col) => ({ type: 'escort', row, col });
const C = (col) => ({ type: 'commander', row: 0, col });

// Formation slot groups used by every normal stage.
const G = {
  centerDrones: [D(3, 4), D(3, 5), D(4, 4), D(4, 5)],
  centerEscorts: [E(1, 4), E(1, 5), E(2, 4), E(2, 5)],
  commanders: [C(3), C(4), C(5), C(6)],
  commanderEscorts: [E(1, 3), E(1, 6), E(2, 3), E(2, 6)],
  escortsRight: [E(1, 7), E(1, 8), E(2, 7), E(2, 8)],
  escortsLeft: [E(1, 1), E(1, 2), E(2, 1), E(2, 2)],
  dronesRightA: [D(3, 6), D(3, 7), D(4, 6), D(4, 7)],
  dronesRightB: [D(3, 8), D(3, 9), D(4, 8), D(4, 9)],
  dronesLeftA: [D(3, 3), D(3, 2), D(4, 3), D(4, 2)],
  dronesLeftB: [D(3, 1), D(3, 0), D(4, 1), D(4, 0)],
};

const path = (name, m, o) => (L) => ENTRY[name](L, m, o);
const LEFT = 1, RIGHT = -1;

// Three entry variants cycle through the normal stages.
const VARIANTS = [
  // Variant A
  [
    { gap: 7, lines: [
      { path: path('topLoop', LEFT), members: G.centerDrones },
      { path: path('topLoop', RIGHT), members: G.centerEscorts },
    ] },
    { gap: 8, lines: [
      { path: path('sideLoop', LEFT), members: G.commanders },
      { path: path('sideLoop', LEFT), lat: 14, members: G.commanderEscorts },
    ] },
    { gap: 8, lines: [
      { path: path('sideLoop', RIGHT), members: G.escortsRight },
      { path: path('sideLoop', RIGHT), lat: -14, members: G.escortsLeft },
    ] },
    { gap: 8, lines: [
      { path: path('topSwirl', RIGHT), members: G.dronesRightA },
      { path: path('topSwirl', RIGHT), lat: 14, members: G.dronesRightB },
    ] },
    { gap: 8, lines: [
      { path: path('topSwirl', LEFT), members: G.dronesLeftA },
      { path: path('topSwirl', LEFT), lat: -14, members: G.dronesLeftB },
    ] },
  ],
  // Variant B
  [
    { gap: 7, lines: [
      { path: path('topSpiral', LEFT), members: G.centerDrones },
      { path: path('topSpiral', RIGHT), members: G.centerEscorts },
    ] },
    { gap: 8, lines: [
      { path: path('sideLoop', RIGHT, { up: 70, turn: 5.5 }), members: G.commanders },
      { path: path('sideLoop', RIGHT, { up: 70, turn: 5.5 }), lat: -14, members: G.commanderEscorts },
    ] },
    { gap: 8, lines: [
      { path: path('sideLoop', LEFT, { up: 70, turn: 5.5 }), members: G.escortsLeft },
      { path: path('sideLoop', LEFT, { up: 70, turn: 5.5 }), lat: 14, members: G.escortsRight },
    ] },
    { gap: 8, lines: [
      { path: path('topLoop', RIGHT, { dx: 40, drift: 10, loopUp: 90 }), members: G.dronesRightA },
      { path: path('topLoop', RIGHT, { dx: 40, drift: 10, loopUp: 90 }), lat: 14, members: G.dronesRightB },
    ] },
    { gap: 8, lines: [
      { path: path('topLoop', LEFT, { dx: 40, drift: 10, loopUp: 90 }), members: G.dronesLeftA },
      { path: path('topLoop', LEFT, { dx: 40, drift: 10, loopUp: 90 }), lat: -14, members: G.dronesLeftB },
    ] },
  ],
  // Variant C
  [
    { gap: 7, lines: [
      { path: path('topSwirl', LEFT, { dx: 30, head: 170 }), members: G.centerDrones },
      { path: path('topSwirl', RIGHT, { dx: 30, head: 170 }), members: G.centerEscorts },
    ] },
    { gap: 8, lines: [
      { path: path('sideLoop', LEFT, { up: 20 }), members: G.commanders },
      { path: path('sideLoop', LEFT, { up: 20 }), lat: 14, members: G.commanderEscorts },
    ] },
    { gap: 8, lines: [
      { path: path('sideLoop', RIGHT, { up: 20 }), members: G.escortsRight },
      { path: path('sideLoop', RIGHT, { up: 20 }), lat: -14, members: G.escortsLeft },
    ] },
    { gap: 8, lines: [
      { path: path('topSpiral', RIGHT, { dx: 60, turn: 5 }), members: G.dronesRightA },
      { path: path('topSpiral', RIGHT, { dx: 60, turn: 5 }), lat: 14, members: G.dronesRightB },
    ] },
    { gap: 8, lines: [
      { path: path('topSpiral', LEFT, { dx: 60, turn: 5 }), members: G.dronesLeftA },
      { path: path('topSpiral', LEFT, { dx: 60, turn: 5 }), lat: -14, members: G.dronesLeftB },
    ] },
  ],
];

// ---------------------------------------------------------------------------
// Challenging stages: 5 groups of 8 that fly a show pattern and leave.

const cs = (name, m) => (L) => CHALLENGE[name](L, m);
const four = (type) => [0, 1, 2, 3].map(() => ({ type }));
const eight = (type) => [...four(type), ...four(type)];
const mixed = (a, b) => [{ type: a }, { type: b }, { type: a }, { type: b }];

const pairGroup = (name, typeL, typeR = typeL) => ({ gap: 8, lines: [
  { path: cs(name, LEFT), members: four(typeL) },
  { path: cs(name, RIGHT), members: four(typeR) },
] });
const sideGroup = (name, m, typeA, typeB = typeA) => ({ gap: 8, lines: [
  { path: cs(name, m), members: four(typeA) },
  { path: cs(name, m), lat: 14 * m, members: four(typeB) },
] });
const trainGroup = (name, m, type) => ({ gap: 7, lines: [{ path: cs(name, m), members: eight(type) }] });

const CHALLENGES = [
  [
    pairGroup('topLoop', 'drone'),
    sideGroup('sideLoop', LEFT, 'commander', 'escort'),
    sideGroup('sideLoop', RIGHT, 'escort'),
    trainGroup('figure8', RIGHT, 'drone'),
    trainGroup('figure8', LEFT, 'drone'),
  ],
  [
    pairGroup('zigzag', 'escort'),
    { gap: 8, lines: [{ path: cs('dropSwoop', LEFT), members: mixed('commander', 'escort') },
      { path: cs('dropSwoop', RIGHT), members: mixed('escort', 'commander') }] },
    trainGroup('sideLoop', LEFT, 'transformB'),
    trainGroup('sideLoop', RIGHT, 'transformB'),
    pairGroup('topLoop', 'drone'),
  ],
  [
    pairGroup('figure8', 'transformA'),
    trainGroup('topLoop', LEFT, 'transformC'),
    trainGroup('topLoop', RIGHT, 'transformC'),
    pairGroup('zigzag', 'drone', 'escort'),
    pairGroup('dropSwoop', 'commander', 'escort'),
  ],
];

export function challengeIndex(stage) { return Math.floor((stage - 3) / 4); }

export function buildStage(stage) {
  if (isChallengeStage(stage)) {
    return { challenge: true, waves: CHALLENGES[challengeIndex(stage) % CHALLENGES.length] };
  }
  const normalIndex = stage - 1 - Math.floor((stage + 1) / 4); // 0-based count of normal stages before this one
  return { challenge: false, waves: VARIANTS[normalIndex % VARIANTS.length] };
}

// Difficulty curve.
export const difficulty = (stage) => ({
  attackInterval: Math.max(24, 100 - stage * 5),
  maxAttacks: Math.min(2 + Math.floor(stage / 4), 5),
  entryFireChance: stage <= 1 ? 0 : Math.min(0.08 * stage, 0.5),
  attackDuringEntry: stage >= 5,
});

// Transform type for a stage (stage 4+ normal stages), or null.
export function transformType(stage) {
  if (stage < 4 || isChallengeStage(stage)) return null;
  return ['transformA', 'transformB', 'transformC'][Math.floor((stage - 4) / 4) % 3];
}
