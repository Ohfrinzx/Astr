// Astr sprite definitions and baker.
//
// Every sprite is plain data: an array of frames, each frame an array of
// strings (one char per pixel, '.' = transparent) plus a palette map.
// buildSprites() bakes each frame into a native-resolution canvas.
//
// All art here is original. Ship sprites face UP (nose toward -y) and are
// centered in their frames; the renderer handles scaling and rotation.

// ---------------------------------------------------------------------------
// Authoring helpers
// ---------------------------------------------------------------------------

// Mirror a list of left-half rows into full symmetric rows ("abc" -> "abccba").
function sym(rows) {
  return rows.map((r) => r + r.split('').reverse().join(''));
}

// Create a def that reuses another def's frames with a different palette.
// `overrides` maps palette chars to new colors; unspecified chars keep theirs.
function recolor(def, overrides) {
  return { w: def.w, h: def.h, palette: { ...def.palette, ...overrides }, frames: def.frames };
}

// Deterministic PRNG so procedurally authored frames are stable across loads.
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Tiny grid painter used to author the explosion frames as strings.
function grid(w, h) {
  const g = [];
  for (let y = 0; y < h; y++) g.push(new Array(w).fill('.'));
  return g;
}
function plot(g, x, y, c) {
  x = Math.round(x);
  y = Math.round(y);
  if (y >= 0 && y < g.length && x >= 0 && x < g[0].length) g[y][x] = c;
}
function rows(g) {
  return g.map((r) => r.join(''));
}
// Symmetric 4-way plot around the 32x32 center (between pixels 15 and 16).
function plot4(g, dx, dy, c) {
  plot(g, 15 - dx, 15 - dy, c);
  plot(g, 16 + dx, 15 - dy, c);
  plot(g, 15 - dx, 16 + dy, c);
  plot(g, 16 + dx, 16 + dy, c);
}

// ---------------------------------------------------------------------------
// Ships
// ---------------------------------------------------------------------------

// Player: "Astr Lancer" - a swept-wing delta with a long white spine,
// cyan bubble canopy, red leading-edge wing stripes, notched trailing
// edge with twin wingtip prongs and an orange/yellow engine plume. 14 px wide.
const PLAYER = {
  w: 16,
  h: 16,
  palette: {
    W: '#ffffff', // fuselage
    S: '#a9b6cc', // silver panels
    K: '#4b5a7a', // dark panel / outline
    C: '#38e8ff', // canopy
    c: '#0f86b0', // canopy shade
    R: '#ff2b3c', // wing accents
    O: '#ff8c1a', // engine glow
    Y: '#ffe65a', // engine core
  },
  frames: [
    sym([
      '........',
      '.......W',
      '.......W',
      '......SW',
      '......cC',
      '......cC',
      '.....SWC',
      '.....SWW',
      '....RSWW',
      '...RRSWS',
      '..RRWSWS',
      '.RRWSSKS',
      '.RWSSKKW',
      '.R..KK.S',
      '......OY',
      '.......O',
    ]),
  ],
};

// Captured player: same hull taken over by the enemy - maroon/red hull,
// hot yellow canopy, magenta exhaust.
const PLAYER_CAPTURED = recolor(PLAYER, {
  W: '#ff6f6f',
  S: '#c02a48',
  K: '#5c0c24',
  C: '#ffd84a',
  c: '#b06a00',
  R: '#8c0f2c',
  O: '#ff3cc8',
  Y: '#ffb0f0',
});

// Drone: "Pip" - a round yellow beetle-pod with a blue visor band, two
// white sensor eyes, a pair of springy antennae and blue side fins. The fins
// flap up/down and the antennae swing between frames. 12 px wide.
const DRONE = {
  w: 16,
  h: 16,
  palette: {
    Y: '#ffd43a', // shell
    y: '#c4860e', // shell shade
    B: '#2f6dff', // fins / visor
    b: '#152f8f', // dark blue
    W: '#ffffff', // eyes
  },
  frames: [
    sym([
      '........',
      '........',
      '....B...',
      '.....B..',
      '.....YYY',
      '....YYYY',
      '..B.YWbB',
      '..BBYYBB',
      '..BBYYYY',
      '..B.yYYY',
      '....yyYY',
      '.....yyY',
      '....b..b',
      '........',
      '........',
      '........',
    ]),
    sym([
      '........',
      '........',
      '......B.',
      '.....B..',
      '..B..YYY',
      '..BBYYYY',
      '...BYWbB',
      '....YYBB',
      '....YYYY',
      '....yYYY',
      '....yyYY',
      '.....yyY',
      '.....b.b',
      '........',
      '........',
      '........',
    ]),
  ],
};

// Escort: "Vane" - a red arrowhead dart with a white keel, a blue plasma
// core and two blade wings that spread out (frame 1) and sweep tight
// against the hull (frame 2). 14 px wide.
const ESCORT = {
  w: 16,
  h: 16,
  palette: {
    R: '#ff2740', // hull / blades
    r: '#9c0f22', // hull shade
    W: '#ffffff', // keel
    B: '#3a7bff', // core
  },
  frames: [
    sym([
      '........',
      '.......W',
      '......RW',
      '.r....RW',
      '.Rr..RWB',
      '.RRr.RWB',
      '..RRrRWW',
      '..RRRRRW',
      '...RRWRR',
      '....rRWR',
      '.....rRW',
      '.....r.R',
      '......r.',
      '........',
      '........',
      '........',
    ]),
    sym([
      '........',
      '.......W',
      '......RW',
      '......RW',
      '....r.WB',
      '...Rr.WB',
      '...RRrWW',
      '...RRRRW',
      '...rRWRR',
      '...rRRWR',
      '....rrRW',
      '.....r.R',
      '......r.',
      '........',
      '........',
      '........',
    ]),
  ],
};

// Commander: "Warden" - a broad armored manta-crab. Twin pincers reach
// forward, a yellow/orange reactor eye sits in a ridged green carapace and
// wide mantle wings taper into a split tail. Pincers open/close. 14 px wide.
const COMMANDER = {
  w: 16,
  h: 16,
  palette: {
    G: '#2fd04a', // carapace
    g: '#137a2a', // shade
    L: '#a6ff6a', // highlight ridges
    Y: '#ffe14a', // reactor ring
    O: '#ff7a1a', // reactor core
  },
  frames: [
    sym([
      '........',
      '..L.....',
      '.GL.....',
      '.GG.....',
      '.gGG..gG',
      '..gG.gGL',
      '..gGgGYY',
      '.ggGGGYO',
      'gGGLGGGY',
      'gGLGGLGG',
      'gG.gGGLG',
      'g..gGGGG',
      '....gGOG',
      '.....gG.',
      '......g.',
      '........',
    ]),
    sym([
      '........',
      '........',
      '....L...',
      '...GL...',
      '..GG..gG',
      '..gG.gGL',
      '..gGgGYY',
      '.ggGGGYO',
      'gGGLGGGY',
      'gGLGGLGG',
      'gG.gGGLG',
      'g..gGGGG',
      '....gGOG',
      '.....gG.',
      '......g.',
      '........',
    ]),
  ],
};

// Commander after its first hit: armor scorched to purple/blue.
const COMMANDER_HIT = recolor(COMMANDER, {
  G: '#8a5cff',
  g: '#3a1f9a',
  L: '#d2b8ff',
  Y: '#5ad8ff',
  O: '#ffffff',
});

// Transform A: "Trident" - an orange tri-prong craft; three spikes point
// forward from a yellow hub, the prong tips flash between frames.
const TRANSFORM_A = {
  w: 16,
  h: 16,
  palette: {
    O: '#ff8a1a',
    o: '#a84a00',
    Y: '#ffe84a',
    W: '#ffffff',
    R: '#ff2a2a',
  },
  frames: [
    sym([
      '.......W',
      '.......Y',
      '..W....O',
      '..Y....O',
      '..O....O',
      '..O...oO',
      '..Oo..OY',
      '..OOooOY',
      '...OOOYY',
      '....OYYR',
      '.....OYY',
      '....oOOY',
      '...oO.oO',
      '...o...o',
      '........',
      '........',
    ]),
    sym([
      '.......R',
      '.......W',
      '..R....O',
      '..W....O',
      '..O....O',
      '..O...oO',
      '..Oo..OY',
      '..OOooOY',
      '...OOOYY',
      '....OYYW',
      '.....OYY',
      '....oOOY',
      '...oO.oO',
      '...o...o',
      '........',
      '........',
    ]),
  ],
};

// Transform B: "Lantern" - a green domed saucer with a white canopy and a
// ring of rim lights that chase around between frames.
const TRANSFORM_B = {
  w: 16,
  h: 16,
  palette: {
    G: '#36d860',
    g: '#14702c',
    W: '#ffffff',
    C: '#9ff7ff',
    Y: '#fff04a',
    R: '#ff3a5a',
  },
  frames: [
    [
      '................',
      '................',
      '................',
      '......WWWW......',
      '.....WCCCCW.....',
      '....gWCCCCWg....',
      '...gGGGGGGGGg...',
      '..gGGGGGGGGGGg..',
      '.gYGgRGggGRgGYg.',
      '.gGGGGGGGGGGGGg.',
      '..gGGGGGGGGGGg..',
      '...ggGGGGGGgg...',
      '.....gg..gg.....',
      '................',
      '................',
      '................',
    ],
    [
      '................',
      '................',
      '................',
      '......WWWW......',
      '.....WCCCCW.....',
      '....gWCCCCWg....',
      '...gGGGGGGGGg...',
      '..gGGGGGGGGGGg..',
      '.gRGgYGggGYgGRg.',
      '.gGGGGGGGGGGGGg.',
      '..gGGGGGGGGGGg..',
      '...ggGGGGGGgg...',
      '.....gg..gg.....',
      '................',
      '................',
      '................',
    ],
  ],
};

// Transform C: "Prism" - a cyan four-point star craft with a magenta
// heart; the inner facets swap colors to make it shimmer.
const TRANSFORM_C = {
  w: 16,
  h: 16,
  palette: {
    C: '#3cf0ff',
    c: '#0a8aa8',
    M: '#ff3ce0',
    m: '#8a1a8a',
    W: '#ffffff',
  },
  frames: [
    sym([
      '.......W',
      '.......C',
      '.......C',
      '......cC',
      '......CM',
      '..c..cCM',
      '...cCCMM',
      '.cCCCMMW',
      '.cCCCMMW',
      '...cCCMM',
      '..c..cCM',
      '......CM',
      '......cC',
      '.......C',
      '.......c',
      '........',
    ]),
    sym([
      '.......M',
      '.......C',
      '.......C',
      '......cC',
      '......CC',
      '..m..cCW',
      '...mCMCC',
      '.mCMMCCM',
      '.mCMMCCM',
      '...mCMCC',
      '..m..cCW',
      '......CC',
      '......cC',
      '.......C',
      '.......m',
      '........',
    ]),
  ],
};

// ---------------------------------------------------------------------------
// Explosions (authored procedurally into string frames, deterministic)
// ---------------------------------------------------------------------------

const EXPLOSION_PALETTE = {
  W: '#ffffff',
  Y: '#ffe84a',
  O: '#ff9a1a',
  R: '#ff2a2a',
  r: '#9a1020',
  B: '#4a8cff',
  b: '#1e3c9a',
};

// Enemy explosion, 5 frames: tiny cross spark -> star burst with blue rays ->
// wide burst ring -> scattered fragments -> sparse fading embers.
function makeEnemyExplosion() {
  const frames = [];
  const rand = rng(1981);

  // Frame 0: small white/yellow spark.
  let g = grid(32, 32);
  for (let d = 0; d <= 2; d++) {
    plot4(g, d, 0, d < 1 ? 'W' : 'Y');
    plot4(g, 0, d, d < 1 ? 'W' : 'Y');
  }
  plot4(g, 1, 1, 'O');
  frames.push(rows(g));

  // Frame 1: star burst, 8 rays.
  g = grid(32, 32);
  for (let d = 0; d <= 6; d++) {
    const c = d < 2 ? 'W' : d < 4 ? 'Y' : d < 6 ? 'O' : 'R';
    plot4(g, d, 0, c);
    plot4(g, 0, d, c);
    if (d <= 4) plot4(g, d, d, d < 2 ? 'Y' : d < 4 ? 'R' : 'B');
  }
  plot4(g, 1, 0, 'W');
  plot4(g, 2, 1, 'Y');
  plot4(g, 1, 2, 'Y');
  frames.push(rows(g));

  // Frame 2: big burst - hollowing ring with flame tongues and blue sparks.
  g = grid(32, 32);
  for (let a = 0; a < 64; a++) {
    const ang = (a / 64) * Math.PI * 2;
    const r = 7 + (a % 4 === 0 ? 3 : a % 2 === 0 ? 1.5 : 0) + rand() * 1.2;
    for (let t = 0; t <= r; t += 0.5) {
      const c = t > r - 1 ? 'R' : t > r - 3 ? 'O' : t > 4 ? 'Y' : 'W';
      plot(g, 15.5 + Math.cos(ang) * t, 15.5 + Math.sin(ang) * t, c);
    }
  }
  for (let i = 0; i < 8; i++) {
    const ang = (i / 8) * Math.PI * 2 + 0.39;
    plot(g, 15.5 + Math.cos(ang) * 12, 15.5 + Math.sin(ang) * 12, 'B');
    plot(g, 15.5 + Math.cos(ang) * 13, 15.5 + Math.sin(ang) * 13, 'b');
  }
  frames.push(rows(g));

  // Frame 3: scattered fragments flying outward.
  g = grid(32, 32);
  for (let i = 0; i < 22; i++) {
    const ang = (i / 22) * Math.PI * 2 + rand() * 0.25;
    const r = 8 + rand() * 6;
    const x = 15.5 + Math.cos(ang) * r;
    const y = 15.5 + Math.sin(ang) * r;
    const c = ['Y', 'O', 'R', 'W', 'B'][i % 5];
    plot(g, x, y, c);
    // short trail toward center
    plot(g, 15.5 + Math.cos(ang) * (r - 1), 15.5 + Math.sin(ang) * (r - 1), c === 'W' ? 'Y' : 'r');
  }
  for (let i = 0; i < 6; i++) {
    const ang = rand() * Math.PI * 2;
    const r = 2 + rand() * 3;
    plot(g, 15.5 + Math.cos(ang) * r, 15.5 + Math.sin(ang) * r, 'R');
  }
  frames.push(rows(g));

  // Frame 4: sparse dim embers at the edge.
  g = grid(32, 32);
  for (let i = 0; i < 12; i++) {
    const ang = (i / 12) * Math.PI * 2 + rand() * 0.4;
    const r = 11 + rand() * 4;
    plot(g, 15.5 + Math.cos(ang) * r, 15.5 + Math.sin(ang) * r, i % 3 === 0 ? 'b' : 'r');
  }
  frames.push(rows(g));

  return { w: 32, h: 32, palette: EXPLOSION_PALETTE, frames };
}

// Player explosion, 4 frames: violent jagged flash -> large ragged fireball
// -> torn shards and debris -> smoldering scattered sparks.
function makePlayerExplosion() {
  const frames = [];
  const rand = rng(2600);

  // Frame 0: jagged flash with uneven spikes.
  let g = grid(32, 32);
  for (let a = 0; a < 12; a++) {
    const ang = (a / 12) * Math.PI * 2 + rand() * 0.3;
    const len = 4 + rand() * 6;
    for (let t = 0; t <= len; t += 0.6) {
      const c = t < 2 ? 'W' : t < len * 0.6 ? 'Y' : 'R';
      plot(g, 15.5 + Math.cos(ang) * t, 15.5 + Math.sin(ang) * t, c);
    }
  }
  for (let y = -2; y <= 2; y++) for (let x = -2; x <= 2; x++) if (x * x + y * y <= 5) plot(g, 15.5 + x, 15.5 + y, 'W');
  frames.push(rows(g));

  // Frame 1: big ragged fireball.
  g = grid(32, 32);
  for (let a = 0; a < 90; a++) {
    const ang = (a / 90) * Math.PI * 2;
    const r = 8 + rand() * 6;
    for (let t = 0; t <= r; t += 0.6) {
      let c = t > r - 1.5 ? 'R' : t > r - 4 ? 'O' : t > 4 ? 'Y' : 'W';
      if (rand() < 0.08) c = '.';
      plot(g, 15.5 + Math.cos(ang) * t, 15.5 + Math.sin(ang) * t, c);
    }
  }
  frames.push(rows(g));

  // Frame 2: hollow core, torn shards flung outward.
  g = grid(32, 32);
  for (let a = 0; a < 70; a++) {
    const ang = (a / 70) * Math.PI * 2;
    const r = 10 + rand() * 5;
    for (let t = 6 + rand() * 2; t <= r; t += 0.7) {
      if (rand() < 0.35) continue;
      const c = t > r - 1.5 ? 'r' : t > r - 3.5 ? 'R' : 'O';
      plot(g, 15.5 + Math.cos(ang) * t, 15.5 + Math.sin(ang) * t, c);
    }
  }
  for (let i = 0; i < 14; i++) {
    const ang = rand() * Math.PI * 2;
    const r = 2 + rand() * 4;
    plot(g, 15.5 + Math.cos(ang) * r, 15.5 + Math.sin(ang) * r, i % 2 ? 'Y' : 'W');
  }
  // a few big shards (2x2 blocks)
  for (let i = 0; i < 6; i++) {
    const ang = (i / 6) * Math.PI * 2 + rand();
    const r = 12 + rand() * 2;
    const x = 15 + Math.cos(ang) * r;
    const y = 15 + Math.sin(ang) * r;
    plot(g, x, y, 'Y');
    plot(g, x + 1, y, 'O');
    plot(g, x, y + 1, 'O');
    plot(g, x + 1, y + 1, 'R');
  }
  frames.push(rows(g));

  // Frame 3: smoldering scattered sparks.
  g = grid(32, 32);
  for (let i = 0; i < 26; i++) {
    const ang = rand() * Math.PI * 2;
    const r = 6 + rand() * 9.5;
    plot(g, 15.5 + Math.cos(ang) * r, 15.5 + Math.sin(ang) * r, ['r', 'R', 'O', 'r', 'Y'][i % 5]);
  }
  frames.push(rows(g));

  return { w: 32, h: 32, palette: EXPLOSION_PALETTE, frames };
}

// ---------------------------------------------------------------------------
// Shots
// ---------------------------------------------------------------------------

// Player shot: a white-hot tip trailing into a cyan bolt.
const PLAYER_SHOT = {
  w: 3,
  h: 8,
  palette: { W: '#ffffff', C: '#5af2ff', c: '#1a8ac8' },
  frames: [['.W.', 'WWW', 'CWC', '.C.', '.C.', '.c.', '.c.', '...']],
};

// Enemy shot: a red capsule with a white/yellow core.
const ENEMY_SHOT = {
  w: 3,
  h: 8,
  palette: { R: '#ff2a3a', Y: '#ffe84a', W: '#ffffff' },
  frames: [['.R.', 'RYR', 'RWR', 'RWR', 'RYR', 'RYR', '.R.', '.R.']],
};

// ---------------------------------------------------------------------------
// Stage badges (HUD stage counters)
// ---------------------------------------------------------------------------

const BADGE_PALETTE = {
  W: '#ffffff',
  S: '#a0a8b8',
  R: '#ff2a3a',
  r: '#9a1020',
  Y: '#ffe14a',
  O: '#ff8a1a',
  B: '#3a7bff',
  b: '#1a3a9a',
  G: '#2fd04a',
  g: '#137a2a',
  P: '#b05cff',
  p: '#5a1fa0',
  C: '#5af2ff',
};

// Badge 1: small red triangular pennant with a yellow stripe on a white pole.
const BADGE1 = {
  w: 7,
  h: 12,
  palette: BADGE_PALETTE,
  frames: [
    [
      'Y......',
      'WRR....',
      'WRRRR..',
      'WYYYYY.',
      'WRRRR..',
      'WRR....',
      'W......',
      'W......',
      'W......',
      'W......',
      'S......',
      'S......',
    ],
  ],
};

// Badge 5: blue swallowtail banner with a white bar.
const BADGE5 = {
  w: 7,
  h: 13,
  palette: BADGE_PALETTE,
  frames: [
    [
      'Y......',
      'WBBBBBB',
      'WBBBBBB',
      'WWWWWWW',
      'WBBBBBB',
      'WBBb.bB',
      'WBb...b',
      'W......',
      'W......',
      'W......',
      'W......',
      'S......',
      'S......',
    ],
  ],
};

// Badge 10: green shield with a yellow chevron.
const BADGE10 = {
  w: 8,
  h: 12,
  palette: BADGE_PALETTE,
  frames: [
    [
      'gGGGGGGg',
      'gGGGGGGg',
      'gYGGGGYg',
      'gGYGGYGg',
      'gGGYYGGg',
      'gYGGGGYg',
      'gGYGGYGg',
      'gGGYYGGg',
      '.gGGGGg.',
      '.gGGGGg.',
      '..gGGg..',
      '...gg...',
    ],
  ],
};

// Badge 20: purple faceted diamond insignia with a white glint.
const BADGE20 = {
  w: 8,
  h: 13,
  palette: BADGE_PALETTE,
  frames: [
    [
      '...pp...',
      '..pPPp..',
      '..PWPP..',
      '.pWPPPp.',
      '.PPPPPP.',
      'pPPpPPPp',
      'PPpPPpPP',
      'pPPPpPPp',
      '.PPPPPP.',
      '.pPPPPp.',
      '..PPPP..',
      '..pPPp..',
      '...pp...',
    ],
  ],
};

// Badge 30: orange square banner with a red-and-yellow star, on a pole.
const BADGE30 = {
  w: 8,
  h: 15,
  palette: BADGE_PALETTE,
  frames: [
    [
      'Y.......',
      'WOOOOOOO',
      'WOOOYOOO',
      'WOOYYYOO',
      'WOYYRYYO',
      'WOOYYYOO',
      'WOOYOYOO',
      'WOOOOOOO',
      'WrOrOrOr',
      'W.......',
      'W.......',
      'W.......',
      'W.......',
      'S.......',
      'S.......',
    ],
  ],
};

// Badge 50: gold crowned crest with a red gem and cyan wings.
const BADGE50 = {
  w: 8,
  h: 16,
  palette: BADGE_PALETTE,
  frames: [
    [
      'Y..Y..Y.',
      'YY.YY.YY',
      'YYYYYYYY',
      'OYOYYOYO',
      '........',
      'CYYYYYYC',
      'CYYRRYYC',
      'CYRWRRYC',
      'CYRRRRYC',
      '.YYRRYY.',
      '.OYYYYO.',
      '..OYYO..',
      '...OO...',
      '..R..R..',
      '.R....R.',
      'R......R',
    ],
  ],
};

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export const SPRITE_DEFS = {
  player: PLAYER,
  playerCaptured: PLAYER_CAPTURED,
  drone: DRONE,
  escort: ESCORT,
  commander: COMMANDER,
  commanderHit: COMMANDER_HIT,
  transformA: TRANSFORM_A,
  transformB: TRANSFORM_B,
  transformC: TRANSFORM_C,
  enemyExplosion: makeEnemyExplosion(),
  playerExplosion: makePlayerExplosion(),
  playerShot: PLAYER_SHOT,
  enemyShot: ENEMY_SHOT,
  badge1: BADGE1,
  badge5: BADGE5,
  badge10: BADGE10,
  badge20: BADGE20,
  badge30: BADGE30,
  badge50: BADGE50,
};

// ---------------------------------------------------------------------------
// Validation + baking
// ---------------------------------------------------------------------------

function validateDef(name, def) {
  if (!def || !Number.isInteger(def.w) || !Number.isInteger(def.h) || def.w <= 0 || def.h <= 0) {
    throw new Error(`Sprite "${name}": invalid w/h`);
  }
  if (!Array.isArray(def.frames) || def.frames.length === 0) {
    throw new Error(`Sprite "${name}": no frames`);
  }
  def.frames.forEach((frame, fi) => {
    if (!Array.isArray(frame) || frame.length !== def.h) {
      throw new Error(
        `Sprite "${name}" frame ${fi}: has ${frame && frame.length} rows, expected h=${def.h}`
      );
    }
    frame.forEach((row, ri) => {
      if (typeof row !== 'string' || row.length !== def.w) {
        throw new Error(
          `Sprite "${name}" frame ${fi} row ${ri}: length ${row && row.length}, expected w=${def.w} ("${row}")`
        );
      }
      for (let x = 0; x < row.length; x++) {
        const ch = row[x];
        if (ch !== '.' && !(ch in def.palette)) {
          throw new Error(
            `Sprite "${name}" frame ${fi} row ${ri} col ${x}: char '${ch}' missing from palette`
          );
        }
      }
    });
  });
}

function hexToRgb(hex) {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) throw new Error(`Bad palette color "${hex}" (expected #rrggbb)`);
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function bakeFrame(def, frame) {
  const canvas = document.createElement('canvas');
  canvas.width = def.w;
  canvas.height = def.h;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(def.w, def.h);
  const rgb = {};
  for (const k of Object.keys(def.palette)) rgb[k] = hexToRgb(def.palette[k]);
  for (let y = 0; y < def.h; y++) {
    const row = frame[y];
    for (let x = 0; x < def.w; x++) {
      const ch = row[x];
      if (ch === '.') continue;
      const c = rgb[ch];
      const i = (y * def.w + x) * 4;
      img.data[i] = c[0];
      img.data[i + 1] = c[1];
      img.data[i + 2] = c[2];
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

// Bakes every def into canvases: { [name]: HTMLCanvasElement[] }.
export function buildSprites() {
  const out = {};
  for (const [name, def] of Object.entries(SPRITE_DEFS)) {
    validateDef(name, def);
    out[name] = def.frames.map((f) => bakeFrame(def, f));
  }
  return out;
}
