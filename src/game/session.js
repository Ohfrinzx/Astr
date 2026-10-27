// One play-through: score, ships, stage flow and every gameplay rule.
// The App owns a Session while a game (or the attract-mode demo) is running
// and feeds it a `controls` object each tick.
//
// controls = { left, right, fireHeld, firePressed, touchActive, dragDX, rapid }

import {
  PLAYER, ENEMY, BULLET, SCORE, START_SHIPS, BONUS_LIFE,
} from '../config.js';
import { Formation } from './formation.js';
import { buildStage, difficulty, transformType, challengeIndex } from './stages.js';
import { startProgram, runProgram, DIVES, norm, angDiff } from './flight.js';
import { drawSprite } from '../gfx/render.js';
import { drawText } from '../gfx/font.js';

const RAD = Math.PI / 180;
const BEAM_OPEN = 48, BEAM_HOLD = 150, BEAM_CLOSE = 40;
const CAPTIVE_DY = -16;

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Session {
  constructor({ stage = 1, demo = false, seed = (Math.random() * 2 ** 32) >>> 0, god = false, sfx = {}, layout }) {
    this.rng = mulberry32(seed);
    this.demo = demo;
    this.god = god;
    this.sfx = sfx; // { play(name), loop(name), stop(name) }
    this.L = layout;

    this.score = 0;
    this.reserve = START_SHIPS - 1;
    this.nextBonus = BONUS_LIFE.first;
    this.shotsFired = 0;
    this.hits = 0;
    this.stage = stage;
    this.t = 0;
    this.done = false;
    this.pendingCaptive = false;

    this.player = { x: layout.cx, state: 'none', dual: false, touchTarget: null, cd: 0, explodeT: 0 };
    this.respawn = null;   // { t } while waiting to bring in the next ship
    this.capture = null;   // tractor beam capture in progress
    this.rescue = null;    // rescued fighter flying down to dock

    this.enemies = [];
    this.playerShots = [];
    this.enemyShots = [];
    this.explosions = [];
    this.popups = [];
    this.message = null;   // { lines: [{text, color}], t }
    this.badgeShown = 0;

    this.setPhase('intro');
    if (!demo) this.play('gameStart');
  }

  // ---- helpers -------------------------------------------------------------
  play(name) { if (!this.demo) this.sfx.play?.(name); }
  loop(name) { if (!this.demo) this.sfx.loop?.(name); }
  stop(name) { this.sfx.stop?.(name); }

  setPhase(p) { this.phase = p; this.phaseT = 0; }
  say(lines, t = 120) { this.message = { lines, t }; }
  get alive() { return this.player.state === 'alive'; }
  get living() { return this.enemies.filter((e) => !e.dead); }

  addScore(n) {
    if (this.demo) return;
    this.score += n;
    while (this.score >= this.nextBonus) {
      this.reserve++;
      this.play('extraLife');
      this.nextBonus = this.nextBonus === BONUS_LIFE.first ? BONUS_LIFE.second : this.nextBonus + BONUS_LIFE.every;
    }
  }

  popup(x, y, text, color = '#5ff') { this.popups.push({ x, y, text, color, t: 80 }); }

  // ---- stage flow ------------------------------------------------------------
  beginStage() {
    const def = buildStage(this.stage);
    this.challenge = def.challenge;
    this.waves = def.waves;
    this.waveIndex = -1;
    this.waveT = 0;
    this.waveSpawned = true; // nothing to spawn until the first wave starts
    this.formation = new Formation();
    this.diff = difficulty(this.stage);
    this.attackTimer = 60;
    this.attacks = 0;
    this.transform = transformType(this.stage) ? { done: false, timer: 240 + this.rng() * 360 } : null;
    this.csHits = 0;
    this.csGroups = [];
    this.badgeShown = 0;
    this.enemyShots.length = 0;
    this.playerShots.length = 0;
    if (this.challenge) {
      this.say([{ text: 'CHALLENGING STAGE', color: '#5ff' }], 150);
      this.play('challengeStart');
    } else {
      this.say([{ text: `STAGE ${this.stage}`, color: '#5ff' }], 120);
      this.play('stageStart');
    }
    if (this.player.state === 'none') this.spawnPlayer(false);
    else if (this.respawn && !this.respawn.gameOver && this.player.state !== 'alive') this.spawnPlayer(true);
    this.setPhase('stageIntro');
  }

  // consume: take the ship from the reserve (false only for the very first ship).
  spawnPlayer(consume) {
    if (consume) this.reserve--;
    this.player.state = 'alive';
    this.player.x = this.L.cx - (this.player.dual ? PLAYER.dualGap / 2 : 0);
    this.player.touchTarget = null;
    this.respawn = null;
  }

  startWave(i) {
    this.waveIndex = i;
    this.waveT = 0;
    this.waveSpawned = false;
    this.waveMembers = [];
    if (this.challenge) {
      const size = this.waves[i].lines.reduce((n, l) => n + l.members.length, 0);
      this.csGroups[i] = { killed: 0, size };
    }
  }

  spawnFromWave() {
    const wave = this.waves[this.waveIndex];
    let allSpawned = true;
    for (const line of wave.lines) {
      for (let i = 0; i < line.members.length; i++) {
        const at = i * wave.gap;
        if (this.waveT < at) { allSpawned = false; continue; }
        if (this.waveT !== at) continue;
        this.spawnEnemy(line, line.members[i]);
      }
    }
    this.waveT++;
    if (allSpawned) this.waveSpawned = true;
  }

  spawnEnemy(line, mem) {
    const p = line.path(this.L);
    const lat = line.lat || 0;
    const h = p.head * RAD;
    const e = {
      type: mem.type, row: mem.row, col: mem.col,
      x: p.x + Math.cos(h) * lat, y: p.y + Math.sin(h) * lat,
      heading: p.head, speed: ENEMY.entrySpeed,
      mode: this.challenge ? 'cs' : 'enter',
      hp: mem.type === 'commander' ? 2 : 1,
      escorts: [], escortCount: 0, anim: (this.rng() * 16) | 0,
    };
    startProgram(e, p.steps);
    if (this.challenge) {
      e.group = this.csGroups[this.waveIndex];
    } else if (this.rng() < this.diff.entryFireChance) {
      e.fireQueue = [40 + ((this.rng() * 80) | 0)];
    }
    this.enemies.push(e);
    this.waveMembers.push(e);
    if (e.type === 'commander' && this.pendingCaptive && !this.challenge) {
      this.pendingCaptive = false;
      this.attachCaptive(e);
    }
    return e;
  }

  attachCaptive(host) {
    const c = { type: 'captive', mode: 'captive', host, x: host.x, y: host.y + CAPTIVE_DY, heading: 0, speed: 0, hp: 1, escorts: [], anim: 0 };
    host.captive = c;
    this.enemies.push(c);
    return c;
  }

  // ---- world interface for flight programs ----------------------------------
  get layout() { return this.L; }
  playerTarget() { return this.alive ? { x: this.player.x, y: this.L.playerY } : { x: this.L.cx, y: this.L.playerY }; }
  slotPos(e) {
    if (e.row === undefined) return { x: e.x, y: e.y };
    return this.formation.pos(this.L, e.row, e.col);
  }
  onHome(e) {
    e.mode = 'formation';
    e.prog = null;
    e.fireQueue = null;
    e.escortCount = 0;
  }
  onWrap(e) {
    for (const s of e.escorts) if (!s.dead && s.leader === e) this.detach(s, [{ op: 'wrap' }]);
  }
  onLeave(e) {
    for (const s of e.escorts) if (!s.dead && s.leader === e) this.detach(s, [{ op: 'leave' }]);
    e.dead = true;
    e.escaped = true;
    if (e.type === 'captive') this.pendingCaptive = true;
  }
  detach(s, steps) {
    s.leader = null;
    s.mode = 'dive';
    startProgram(s, steps);
  }

  enemyFire(e) {
    if (this.challenge || !this.alive || this.enemyShots.length >= 10) return;
    if (e.y > this.L.playerY - 50 || e.y < 0) return;
    const sp = Math.min(BULLET.baseSpeed + this.stage * BULLET.speedPerStage, BULLET.maxSpeed);
    const dy = Math.max(30, this.L.playerY - e.y);
    let vx = ((this.player.x - e.x) * sp) / dy + (this.rng() - 0.5) * 0.3;
    vx = Math.max(-BULLET.maxVx, Math.min(BULLET.maxVx, vx));
    this.enemyShots.push({ x: e.x, y: e.y + 6, vx, vy: sp });
  }

  // Commander tractor beam. Returns true when the beam sequence is finished.
  beamTick(e) {
    if (!e.beam) {
      e.beam = { t: 0, len: 0 };
      this.loop('beam');
    }
    const b = e.beam;
    const apex = e.y + 8;
    const maxLen = this.L.playerY + 12 - apex;
    if (this.capture && this.capture.boss === e) {
      b.len = maxLen;
      return false; // the capture sequence drives things from here
    }
    b.t++;
    if (b.t <= BEAM_OPEN) b.len = (maxLen * b.t) / BEAM_OPEN;
    else if (b.t <= BEAM_OPEN + BEAM_HOLD) b.len = maxLen;
    else if (b.t <= BEAM_OPEN + BEAM_HOLD + BEAM_CLOSE) b.len = maxLen * (1 - (b.t - BEAM_OPEN - BEAM_HOLD) / BEAM_CLOSE);
    else {
      e.beam = null;
      this.stop('beam');
      return true;
    }
    // Capture check: player inside the cone once the beam reaches the ship.
    if (this.alive && !this.player.dual && !this.rescue && b.t <= BEAM_OPEN + BEAM_HOLD &&
        b.len >= this.L.playerY - apex - 4 && Math.abs(this.player.x - e.x) < 18 && !this.god) {
      this.startCapture(e);
    }
    return false;
  }

  startCapture(boss) {
    this.capture = { boss, x: this.player.x, y: this.L.playerY, spin: 0, t: 0, stage: 'rise' };
    this.player.state = 'captured';
    this.playerShots.length = 0;
  }

  // ---- update ------------------------------------------------------------------
  update(controls, layout) {
    this.L = layout;
    this.t++;
    this.phaseT++;
    if (this.message && --this.message.t <= 0) this.message = null;

    // Like the arcade, the action freezes while a freed fighter docks, so the
    // ship (which is held still) can't be shot or rammed meanwhile.
    if (this.rescue) {
      this.updatePlayer(controls);
      this.updateRescue();
      this.updateEffects();
      return;
    }

    switch (this.phase) {
      case 'intro':
        if (this.phaseT === 1) this.say([{ text: 'PLAYER 1', color: '#5ff' }], this.demo ? 60 : 250);
        if (this.phaseT >= (this.demo ? 60 : 270)) this.beginStage();
        break;
      case 'stageIntro': {
        const total = this.badgeCount();
        if (this.phaseT % 5 === 0 && this.badgeShown < total) { this.badgeShown++; this.play('badgeTick'); }
        if (this.phaseT >= (this.challenge ? 150 : 110)) { this.badgeShown = total; this.startWave(0); this.setPhase('play'); }
        break;
      }
      case 'play': this.updatePlay(); break;
      case 'stageClear':
        if (this.phaseT >= 90) { this.stage++; this.beginStage(); }
        break;
      case 'csResults': this.updateCsResults(); break;
      case 'gameOver':
        if (this.phaseT === 1) { this.say([{ text: 'GAME OVER', color: '#f44' }], 9999); this.play('gameOver'); this.stop('beam'); }
        if (this.phaseT >= 200) this.done = true;
        break;
    }

    if (this.formation) this.formation.update(this.formationComplete());
    this.updatePlayer(controls);
    this.updateEnemies();
    this.updateShots();
    this.updateCapture();
    this.updateRescue();
    this.updateEffects();
    if (this.phase === 'play') this.checkStageEnd();
  }

  formationComplete() {
    return this.waves && this.waveIndex >= this.waves.length - 1 && this.waveSpawned &&
      !this.enemies.some((e) => !e.dead && e.mode === 'enter');
  }

  updatePlay() {
    // Waves: next wave starts when the current one has finished spawning and
    // its members have arrived (or after a timeout).
    if (this.waveIndex < this.waves.length) {
      if (!this.waveSpawned) this.spawnFromWave();
      else if (this.waveIndex < this.waves.length - 1) {
        this.waveT++;
        const busy = this.waveMembers.some((e) => !e.dead && (e.mode === 'enter' || e.mode === 'cs'));
        const limit = this.challenge ? 200 : 170;
        if (!busy || this.waveT > limit) this.startWave(this.waveIndex + 1);
      }
    }
    if (!this.challenge) {
      this.updateAttacks();
      this.updateTransform();
    }
    this.updateRespawn();
  }

  // ---- player ------------------------------------------------------------------
  updatePlayer(c) {
    const p = this.player;
    const L = this.L;
    const minX = L.left + 8;
    const maxX = L.right - 8 - (p.dual ? PLAYER.dualGap : 0);
    if (p.state === 'exploding' && --p.explodeT <= 0) p.state = this.reserve > 0 ? 'waiting' : 'dead';
    if (p.state !== 'alive') return;
    if (!this.rescue) { // the ship holds still while a rescued fighter docks
      if (c.touchActive) {
        if (p.touchTarget === null) p.touchTarget = p.x;
        p.touchTarget = Math.max(minX, Math.min(maxX, p.touchTarget + c.dragDX * PLAYER.touchGain));
        const d = p.touchTarget - p.x;
        p.x += Math.max(-PLAYER.touchMaxSpeed, Math.min(PLAYER.touchMaxSpeed, d));
      } else {
        p.touchTarget = null;
        p.x += ((c.right ? 1 : 0) - (c.left ? 1 : 0)) * PLAYER.speed;
      }
    }
    p.x = Math.max(minX, Math.min(maxX, p.x));

    // Firing
    if (this.capture || this.rescue || this.phase === 'gameOver') return;
    if (p.cd > 0) p.cd--;
    if (c.touchActive) {
      if (p.cd <= 0 && this.fire()) p.cd = c.rapid ? PLAYER.rapidInterval : PLAYER.touchAutoInterval;
    } else if (c.rapid) {
      if (!c.fireHeld) p.cd = 0;
      else if (p.cd <= 0 && this.fire()) p.cd = PLAYER.rapidInterval;
    } else if (c.firePressed) {
      this.fire();
    }
  }

  fire() {
    const p = this.player;
    const per = p.dual ? 2 : 1;
    if (this.playerShots.length + per > PLAYER.maxShots * per) return false;
    const y = this.L.playerY - 8;
    this.playerShots.push({ x: p.x, y });
    if (p.dual) this.playerShots.push({ x: p.x + PLAYER.dualGap, y });
    if (!this.demo) this.shotsFired += per;
    this.play('shot');
    return true;
  }

  playerShips() {
    if (!this.alive) return [];
    const ships = [{ x: this.player.x, side: 0 }];
    if (this.player.dual) ships.push({ x: this.player.x + PLAYER.dualGap, side: 1 });
    return ships;
  }

  hitPlayer(ship) {
    if (this.god) return;
    const p = this.player;
    this.explode(ship.x, this.L.playerY, 'playerExplosion');
    this.play('playerExplode');
    if (p.dual) {
      if (ship.side === 0) p.x += PLAYER.dualGap;
      p.dual = false;
      return;
    }
    p.state = 'exploding';
    p.explodeT = 60;
    this.playerShots.length = 0;
    this.afterShipLost();
  }

  afterShipLost() {
    if (this.reserve > 0) this.respawn = { t: 0 };
    else this.respawn = { t: 0, gameOver: true };
  }

  updateRespawn() {
    const r = this.respawn;
    if (!r) return;
    r.t++;
    if (this.capture || (this.player.state === 'exploding')) return;
    if (r.gameOver) {
      if (r.t > 90) { this.respawn = null; this.setPhase('gameOver'); }
      return;
    }
    if (!r.ready) {
      // Wait until every attacker has gone home and no enemy shots remain.
      const attacking = this.enemies.some((e) => !e.dead && (e.mode === 'dive' || e.mode === 'escort'));
      if (r.t > 90 && !attacking && this.enemyShots.length === 0 && !this.rescue) {
        r.ready = true;
        r.t = 0;
        this.say([{ text: 'READY', color: '#f44' }], 100);
      }
    } else if (r.t >= 100) {
      this.spawnPlayer(true);
    }
  }

  // ---- enemies -----------------------------------------------------------------
  updateEnemies() {
    for (const e of this.enemies) {
      if (e.dead) continue;
      e.anim++;
      switch (e.mode) {
        case 'formation': {
          const p = this.slotPos(e);
          e.x = p.x; e.y = p.y;
          const d = angDiff(e.heading, 0);
          e.heading = norm(e.heading + Math.max(-12, Math.min(12, d)));
          break;
        }
        case 'escort': this.followLeader(e); break;
        case 'captive':
          if (!e.host || e.host.dead) break;
          e.x = e.host.x; e.y = e.host.y + CAPTIVE_DY;
          e.heading = e.host.mode === 'formation' ? 0 : e.host.heading;
          break;
        case 'transforming':
          if (--e.transformT <= 0) this.splitTransform(e);
          else { const p = this.slotPos(e); e.x = p.x; e.y = p.y; }
          break;
        default:
          if (e.prog) runProgram(e, this);
      }
    }
    // Enemy vs player collisions.
    for (const ship of this.playerShips()) {
      for (const e of this.enemies) {
        if (e.dead || e.mode === 'formation' || e.mode === 'transforming') continue;
        if (Math.abs(e.x - ship.x) < 10 && Math.abs(e.y - this.L.playerY) < 10) {
          this.killEnemy(e);
          this.hitPlayer(ship);
          break;
        }
      }
    }
    if (this.enemies.length > 80 || this.t % 120 === 0) this.enemies = this.enemies.filter((e) => !e.dead);
  }

  followLeader(e) {
    const l = e.leader;
    if (!l || l.dead) { this.orphan(e); return; }
    const h = l.heading * RAD;
    e.x = l.x + Math.cos(h) * e.offset.lat + Math.sin(h) * e.offset.fwd;
    e.y = l.y + Math.sin(h) * e.offset.lat - Math.cos(h) * e.offset.fwd;
    e.heading = l.heading;
  }

  orphan(e) {
    e.leader = null;
    e.mode = 'dive';
    startProgram(e, e.row !== undefined ? DIVES.orphan(this.L) : [{ aim: 1.5, untilY: this.L.playerY }, { op: 'leave' }]);
  }

  updateAttacks() {
    const busy = this.capture || this.rescue || !this.alive || this.respawn;
    const living = this.living;
    const complete = this.formationComplete();
    if (!complete && !this.diff.attackDuringEntry) return;
    const remaining = living.length;
    const endgame = complete && remaining <= 5;
    if (--this.attackTimer > 0 || busy) return;
    const groups = living.filter((e) => e.mode === 'dive' && !e.leader).length;
    const max = endgame ? remaining : this.diff.maxAttacks;
    if (groups >= max) { this.attackTimer = 10; return; }
    this.launchAttack();
    this.attackTimer = endgame ? 14 : this.diff.attackInterval + ((this.rng() * 30) | 0);
  }

  launchAttack() {
    const inForm = this.enemies.filter((e) => !e.dead && e.mode === 'formation' && e.type !== 'captive');
    if (!inForm.length) return;
    const pick = (list) => list[(this.rng() * list.length) | 0];
    const commanders = inForm.filter((e) => e.type === 'commander');
    const escorts = inForm.filter((e) => e.type === 'escort');
    const drones = inForm.filter((e) => e.type === 'drone');
    const r = this.rng();
    if (commanders.length && (r < 0.3 || (!escorts.length && !drones.length))) {
      this.commanderAttack(pick(commanders), escorts);
    } else if (escorts.length && (r < 0.62 || !drones.length)) {
      this.dive(pick(escorts), DIVES.escort);
    } else if (drones.length) {
      const d = pick(drones);
      this.dive(d, DIVES.drone);
      const buddy = drones.find((o) => o !== d && o.row === d.row && Math.abs(o.col - d.col) === 1);
      if (buddy && this.rng() < 0.5) this.dive(buddy, DIVES.drone);
    } else if (commanders.length) {
      this.commanderAttack(pick(commanders), escorts);
    }
  }

  side(e) { return e.col >= 4.5 ? 1 : -1; }

  dive(e, factory, ...args) {
    e.mode = 'dive';
    startProgram(e, factory(this.L, this.side(e), this.stage, this.rng, ...args));
    this.play('dive');
  }

  commanderAttack(boss, escorts) {
    const anyCaptive = this.pendingCaptive || this.enemies.some((e) => !e.dead && e.type === 'captive');
    const beaming = this.enemies.some((e) => !e.dead && e.beam);
    if (!boss.captive && !anyCaptive && !beaming && !this.player.dual && this.rng() < 0.45) {
      boss.escortCount = 0;
      this.dive(boss, DIVES.beam, this.player.x);
      return;
    }
    const near = escorts.filter((s) => s.row === 1 && Math.abs(s.col - boss.col) <= 1)
      .sort(() => this.rng() - 0.5).slice(0, 2);
    boss.escortCount = near.length;
    boss.escorts = near;
    this.dive(boss, DIVES.commander);
    for (const s of near) {
      s.mode = 'escort';
      s.leader = boss;
      s.prog = null;
      s.offset = { lat: s.x - boss.x, fwd: boss.y - s.y };
    }
  }

  updateTransform() {
    const tr = this.transform;
    if (!tr || tr.done || !this.formationComplete() || !this.alive || this.capture || this.rescue) return;
    if (--tr.timer > 0) return;
    const inForm = this.enemies.filter((e) => !e.dead && e.mode === 'formation');
    const pool = inForm.filter((e) => e.type === 'drone');
    const list = pool.length ? pool : inForm.filter((e) => e.type === 'escort');
    if (!list.length) { tr.done = true; return; }
    const e = list[(this.rng() * list.length) | 0];
    e.mode = 'transforming';
    e.transformT = 50;
    tr.done = true;
    this.play('transform');
  }

  splitTransform(src) {
    src.dead = true;
    const type = transformType(this.stage);
    const idx = ['transformA', 'transformB', 'transformC'].indexOf(type);
    const group = { killed: 0, size: 3, bonus: SCORE.transformSet[idx] };
    const m = this.side(src);
    const lead = { type, x: src.x, y: src.y, heading: 0, speed: 2, mode: 'dive', hp: 1, escorts: [], anim: 0, group, transformGroup: true };
    startProgram(lead, DIVES.kamikaze(this.L, m, this.stage));
    this.enemies.push(lead);
    for (const lat of [-14, 14]) {
      const f = { type, x: src.x + lat, y: src.y + 8, heading: 0, speed: 2, mode: 'escort', hp: 1, escorts: [], anim: 0, group, transformGroup: true, leader: lead, offset: { lat, fwd: -8 } };
      lead.escorts.push(f);
      this.enemies.push(f);
    }
  }

  // Value of destroying e right now.
  scoreFor(e) {
    if (this.challenge) return SCORE.challengeHit;
    const flying = e.mode !== 'formation' && e.mode !== 'transforming' &&
      !(e.mode === 'captive' && e.host && e.host.mode === 'formation');
    switch (e.type) {
      case 'drone': return SCORE.drone[flying ? 1 : 0];
      case 'escort': return SCORE.escort[flying ? 1 : 0];
      case 'commander': return flying ? SCORE.commander[1] * 2 ** (e.escortCount || 0) : SCORE.commander[0];
      case 'captive': return SCORE.captive[flying ? 1 : 0];
      default: return SCORE.transform;
    }
  }

  // Called when a player shot hits e.
  hitEnemy(e) {
    this.hits++;
    if (e.type === 'commander' && e.hp > 1) {
      e.hp--;
      this.play('hitCommander');
      return;
    }
    this.killEnemy(e);
  }

  killEnemy(e) {
    if (e.dead) return;
    const value = this.scoreFor(e);
    this.addScore(value);
    e.dead = true;
    this.explode(e.x, e.y, 'enemyExplosion');
    this.play(e.type === 'commander' ? 'killCommander' : e.type === 'escort' ? 'hitEscort' : 'hitDrone');
    if (!this.challenge && (e.type === 'commander' || e.type === 'captive') && value >= 400) this.popup(e.x, e.y, String(value));
    if (e.beam) { e.beam = null; this.stop('beam'); }

    for (const s of e.escorts) if (!s.dead && s.leader === e) this.orphan(s);
    if (e.leader) e.leader.escorts = e.leader.escorts.filter((s) => s !== e);
    if (e.type === 'captive' && e.host) e.host.captive = null;

    if (e.captive && !e.captive.dead) this.freeCaptive(e);
    if (this.capture && this.capture.boss === e) this.abortCapture();

    if (e.group) {
      e.group.killed++;
      if (e.group.killed === e.group.size) {
        const bonus = this.challenge ? this.csGroupBonus() : e.group.bonus;
        this.addScore(bonus);
        this.popup(e.x, e.y, String(bonus), '#ff5');
      }
    }
    if (this.challenge) this.csHits++;
  }

  csGroupBonus() {
    const t = SCORE.challengeGroup;
    return t[Math.min(challengeIndex(this.stage), t.length - 1)];
  }

  // Host commander destroyed while holding a captured fighter.
  freeCaptive(host) {
    const c = host.captive;
    host.captive = null;
    c.host = null;
    // Freed in flight: the fighter comes back to the player. This also works
    // when the player's ship was destroyed a moment earlier (e.g. by a shot
    // still in the air): the fighter then becomes the next ship.
    const canRescue = host.mode !== 'formation' && !this.player.dual && !this.rescue &&
      this.player.state !== 'captured' && this.phase !== 'gameOver';
    if (canRescue) {
      c.dead = true;
      this.rescue = { x: c.x, y: c.y, spin: 0, t: 0, phase: 'spin' };
      this.play('rescued');
    } else {
      // Freed in formation (or a dual fighter already flying): it turns on the player.
      c.mode = 'dive';
      c.row = undefined;
      startProgram(c, DIVES.kamikaze(this.L, c.x > this.L.cx ? 1 : -1, this.stage));
    }
  }

  // ---- capture / rescue -------------------------------------------------------
  updateCapture() {
    const c = this.capture;
    if (!c) return;
    const boss = c.boss;
    c.t++;
    if (c.stage === 'rise') {
      const tx = boss.x, ty = boss.y + CAPTIVE_DY;
      c.x += Math.max(-1, Math.min(1, tx - c.x));
      c.y -= 0.9;
      c.spin += 14;
      if (c.y <= ty) {
        c.y = ty; c.x = tx; c.spin = 0;
        c.stage = 'hold'; c.t = 0;
        this.attachCaptive(boss);
        this.say([{ text: 'FIGHTER CAPTURED', color: '#f44' }], 150);
        this.stop('beam');
        this.play('captured');
        boss.beam = null;
      }
    } else if (c.stage === 'hold' && c.t >= 150) {
      // Commander flies home with its prize.
      boss.mode = 'dive';
      startProgram(boss, [{ sp: 2, op: 'home' }]);
      this.capture = null;
      this.player.state = 'waiting';
      this.afterShipLost();
    }
  }

  abortCapture() {
    // Commander destroyed while its beam was pulling the ship up: the ship
    // simply drops back into place.
    const c = this.capture;
    this.capture = null;
    this.stop('beam');
    if (c.stage === 'rise') this.player.state = 'alive';
    else { this.player.state = 'waiting'; this.afterShipLost(); }
  }

  updateRescue() {
    const r = this.rescue;
    if (!r) return;
    r.t++;
    const p = this.player;
    if (r.phase === 'spin') {
      r.spin += 15;
      if (r.t >= 70) { r.phase = 'fly'; r.spin = 0; }
      return;
    }
    const L = this.L;
    if (!this.alive) {
      // No ship in play (it was destroyed just before the rescue): the freed
      // fighter becomes the player's ship without using one from the reserve.
      const tx = Math.max(L.left + 8, Math.min(L.right - 8, r.x));
      if (!this.flyRescue(tx, L.playerY)) return;
      this.rescue = null;
      Object.assign(p, { state: 'alive', x: tx, dual: false, touchTarget: null });
      this.respawn = null;
      this.message = null;
      return;
    }
    const maxX = L.right - 8 - PLAYER.dualGap;
    if (p.x > maxX) p.x = Math.max(maxX, p.x - PLAYER.speed);
    if (!this.flyRescue(p.x + PLAYER.dualGap, L.playerY)) return;
    this.rescue = null;
    p.dual = true;
  }

  // Move the rescued fighter toward (tx, ty); true once it has arrived.
  flyRescue(tx, ty) {
    const r = this.rescue;
    const dx = tx - r.x, dy = ty - r.y;
    const d = Math.hypot(dx, dy);
    if (d <= 2) return true;
    r.x += (dx / d) * Math.min(d, 1.6);
    r.y += (dy / d) * Math.min(d, 1.6);
    return false;
  }

  // ---- shots / effects -----------------------------------------------------------
  updateShots() {
    const L = this.L;
    for (const s of this.playerShots) {
      s.y -= PLAYER.shotSpeed;
      if (s.y < -8) { s.dead = true; continue; }
      for (const e of this.enemies) {
        if (e.dead) continue;
        if (Math.abs(s.x - e.x) < ENEMY.halfW + 1.5 && Math.abs(s.y - e.y) < ENEMY.halfH + 4) {
          s.dead = true;
          this.hitEnemy(e);
          break;
        }
      }
    }
    this.playerShots = this.playerShots.filter((s) => !s.dead);

    for (const b of this.enemyShots) {
      b.x += b.vx; b.y += b.vy;
      if (b.y > L.h + 8) { b.dead = true; continue; }
      for (const ship of this.playerShips()) {
        if (Math.abs(b.x - ship.x) < PLAYER.halfW + 1 && Math.abs(b.y - L.playerY) < PLAYER.halfH + 3) {
          b.dead = true;
          this.hitPlayer(ship);
          break;
        }
      }
    }
    this.enemyShots = this.enemyShots.filter((b) => !b.dead);
  }

  explode(x, y, sprite) { this.explosions.push({ x, y, sprite, t: 0, rate: sprite === 'playerExplosion' ? 8 : 5 }); }

  updateEffects() {
    for (const x of this.explosions) x.t++;
    this.explosions = this.explosions.filter((x) => x.t < x.rate * (x.sprite === 'playerExplosion' ? 4 : 5));
    for (const p of this.popups) p.t--;
    this.popups = this.popups.filter((p) => p.t > 0);
  }

  checkStageEnd() {
    if (this.respawn?.gameOver || this.capture || this.rescue) return;
    if (this.waveIndex < this.waves.length - 1 || !this.waveSpawned) return;
    if (this.enemies.some((e) => !e.dead)) return;
    if (this.explosions.length) return;
    this.enemyShots.length = 0;
    this.stop('beam');
    if (this.challenge) this.setPhase('csResults');
    else this.setPhase('stageClear');
  }

  updateCsResults() {
    const t = this.phaseT;
    const total = this.csGroups.reduce((n, g) => n + (g?.size || 0), 0);
    const perfect = this.csHits >= total;
    if (t === 1) {
      this.say([{ text: 'NUMBER OF HITS', color: '#5ff' }, { text: String(this.csHits), color: '#fff' }], 260);
      this.play(perfect ? 'challengePerfect' : 'challengeEnd');
    }
    if (t === 70) {
      const bonus = perfect ? SCORE.challengePerfect : this.csHits * SCORE.challengeHit;
      this.addScore(bonus);
      this.say(perfect
        ? [{ text: 'PERFECT !', color: '#f44' }, { text: `SPECIAL BONUS ${bonus} PTS`, color: '#ff5' }]
        : [{ text: 'NUMBER OF HITS', color: '#5ff' }, { text: String(this.csHits), color: '#fff' }, { text: `BONUS  ${bonus}`, color: '#ff5' }], 200);
    }
    if (t >= 280) { this.message = null; this.stage++; this.beginStage(); }
  }

  // Badge icons for the HUD (largest first).
  badges() {
    const out = [];
    let n = this.stage;
    for (const v of [50, 30, 20, 10, 5, 1]) while (n >= v) { out.push(v); n -= v; }
    return out;
  }
  badgeCount() { return this.badges().length; }

  // ---- drawing -------------------------------------------------------------------
  draw(ctx, debug = false) {
    const L = this.L;
    // Tractor beams under everything else.
    for (const e of this.enemies) if (!e.dead && e.beam) drawBeam(ctx, e, this.t);

    const capt = this.capture;
    if (capt && capt.stage === 'rise') drawSprite(ctx, 'player', 0, capt.x, capt.y, capt.spin * RAD);

    for (const e of this.enemies) {
      if (e.dead) continue;
      const fast = e.mode !== 'formation' && e.mode !== 'captive';
      const frame = this.formation && !fast ? (this.formation.t >> 4) & 1 : (e.anim >> 3) & 1;
      let name = e.type;
      if (e.type === 'commander' && e.hp < 2) name = 'commanderHit';
      if (e.type === 'captive') name = 'playerCaptured';
      if (e.mode === 'transforming') {
        if ((e.transformT >> 2) & 1) continue;
        name = transformType(this.stage) || name;
      }
      drawSprite(ctx, name, frame, e.x, e.y, e.heading * RAD);
    }

    for (const ship of this.playerShips()) drawSprite(ctx, 'player', 0, ship.x, L.playerY);
    if (this.rescue) drawSprite(ctx, 'player', 0, this.rescue.x, this.rescue.y, this.rescue.spin * RAD);

    for (const s of this.playerShots) drawSprite(ctx, 'playerShot', 0, s.x, s.y);
    for (const b of this.enemyShots) drawSprite(ctx, 'enemyShot', 0, b.x, b.y);
    for (const x of this.explosions) drawSprite(ctx, x.sprite, Math.floor(x.t / x.rate), x.x, x.y);
    for (const p of this.popups) drawText(ctx, p.text, p.x, p.y - 4, p.color, { align: 'center' });

    if (this.message) {
      const y0 = L.formationTop + 96;
      this.message.lines.forEach((ln, i) => drawText(ctx, ln.text, L.cx, y0 + i * 16, ln.color, { align: 'center' }));
    }

    if (debug) {
      ctx.strokeStyle = '#0f0';
      ctx.lineWidth = 0.5;
      for (const e of this.enemies) if (!e.dead) ctx.strokeRect(e.x - ENEMY.halfW, e.y - ENEMY.halfH, ENEMY.halfW * 2, ENEMY.halfH * 2);
      for (const s of this.playerShips()) ctx.strokeRect(s.x - PLAYER.halfW, L.playerY - PLAYER.halfH, PLAYER.halfW * 2, PLAYER.halfH * 2);
    }
  }
}

function drawBeam(ctx, e, t) {
  const apex = e.y + 8;
  const len = e.beam.len;
  const colors = ['#4af', '#8ff', '#26f', '#fff'];
  for (let d = 0; d < len; d += 3) {
    const half = 5 + d * 0.2;
    const band = ((d / 3) | 0) + (t >> 2);
    ctx.fillStyle = colors[band % colors.length];
    ctx.globalAlpha = 0.75;
    // Ragged edges: the band is drawn as a dashed row of pixels.
    for (let x = -half; x < half; x += 2) {
      if (((x + band) & 3) === 0) continue;
      ctx.fillRect(Math.round(e.x + x), Math.round(apex + d), 2, 2);
    }
  }
  ctx.globalAlpha = 1;
}

