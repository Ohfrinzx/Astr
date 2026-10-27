// Tunable constants. All distances are in "world units" (1 unit = 1 arcade pixel
// on the original 224x288 portrait screen). All speeds are per update tick; the
// simulation runs at a fixed 60 ticks per second like the arcade hardware.

export const BASE_W = 224;
export const BASE_H = 288;
export const TICK_MS = 1000 / 60;

// On screens taller than 3:4 the formation is pushed down by this fraction of
// the extra height so the formation-to-player distance stays close to arcade.
export const TALL_FORMATION_SHIFT = 0.5;

export const LAYOUT = {
  hudTop: 0,          // top HUD rows (1UP / HIGH SCORE), 2 text rows = 16 units
  formationTop: 44,   // y of the commander row on a 224x288 screen
  playerFromBottom: 36, // player ship center distance from the bottom edge
  rowGap: 16,
  colGap: 16,
};

export const PLAYER = {
  speed: 1.75,        // keyboard movement, units/tick
  touchMaxSpeed: 2.8, // touch drag follows the finger, capped at this speed
  touchGain: 1.0,     // finger movement -> ship movement multiplier
  shotSpeed: 7,
  maxShots: 2,        // shots on screen (single ship); dual ship allows 2 volleys
  rapidInterval: 7,   // ticks between shots while rapid fire is held
  touchAutoInterval: 16, // ticks between shots for touch auto-fire, rapid OFF
  dualGap: 16,        // distance between the two ships of a dual fighter
  halfW: 5, halfH: 6, // hitbox
};

export const ENEMY = {
  halfW: 6, halfH: 6,
  entrySpeed: 3,
  diveSpeed: 2.4,
  homeTurn: 7,        // max degrees/tick while steering into the formation slot
};

export const BULLET = {
  baseSpeed: 2.6,
  speedPerStage: 0.04,
  maxSpeed: 4,
  maxVx: 1.3,
};

export const START_SHIPS = 3; // 1 in play + 2 in reserve
export const BONUS_LIFE = { first: 20000, second: 70000, every: 70000 };

export const SCORE = {
  drone: [50, 100],      // [in formation, flying]
  escort: [80, 160],
  commander: [150, 400], // flying value doubles per escort present at dive start
  captive: [500, 1000],
  transform: 160,
  transformSet: [1000, 2000, 3000], // bonus for all 3 transforms (type A/B/C)
  challengeHit: 100,
  challengeGroup: [1000, 1000, 1500, 1500, 2000, 2000, 3000], // by challenge index, last value repeats
  challengePerfect: 10000,
};

// Stage numbers 3, 7, 11, ... are challenging (bonus) stages.
export const isChallengeStage = (stage) => stage >= 3 && (stage - 3) % 4 === 0;

export const HIGH_SCORE_COUNT = 5;
