// Screen state machine: attract (title / top scores / demo), play, pause,
// results, and initials entry. Owns the Starfield and the current Session.

import { display } from './display.js';
import { input } from './input.js';
import { settings, highScores } from './store.js';
import { audio } from './audio.js';
import { Session } from './game/session.js';
import { autopilot } from './game/autopilot.js';
import { Starfield } from './gfx/starfield.js';
import { drawText } from './gfx/font.js';
import { drawSprite } from './gfx/render.js';
import { drawHud, COLORS } from './ui/hud.js';

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ. ';
const ATTRACT_PAGES = [
  { page: 'title', ticks: 600 },
  { page: 'scores', ticks: 360 },
  { page: 'demo', ticks: 1800 },
];

export class App {
  constructor(opts = {}) {
    this.opts = opts;          // { stage, god, debug, seed }
    this.stars = new Starfield();
    this.t = 0;
    this.state = 'attract';
    this.attractIndex = 0;
    this.attractT = 0;
    this.session = null;
    this.hitRects = [];        // tappable menu rows from the last draw
    this.toast = null;
    this.lastScore = 0;
    this.sfx = { play: (n) => audio.play(n), loop: (n) => audio.loop(n), stop: (n) => audio.stop(n) };
  }

  get L() { return display.layout; }

  // ---- input helpers --------------------------------------------------------
  humanControls() {
    return {
      left: input.isHeld('left'),
      right: input.isHeld('right'),
      fireHeld: input.isHeld('fire'),
      firePressed: input.wasPressed('fire'),
      touchActive: input.touching,
      dragDX: input.consumeDrag(),
      rapid: settings.rapidFire,
    };
  }

  tapAction(tap) {
    if (!tap) return null;
    for (const r of this.hitRects) {
      if (tap.x >= r.x && tap.x <= r.x + r.w && tap.y >= r.y && tap.y <= r.y + r.h) return r.action;
    }
    return 'other';
  }

  toggleRapid() {
    settings.rapidFire = !settings.rapidFire;
    settings.save();
    audio.play('select');
    this.showToast(`RAPID FIRE ${settings.rapidFire ? 'ON' : 'OFF'}`);
  }

  toggleMute() {
    settings.muted = !settings.muted;
    settings.save();
    audio.setMuted(settings.muted);
    audio.play('select');
    this.showToast(`SOUND ${settings.muted ? 'OFF' : 'ON'}`);
  }

  showToast(text) { if (input.mode === 'keys') this.toast = { text, t: 70 }; }

  // ---- state transitions ----------------------------------------------------
  startGame() {
    audio.stopAll();
    this.session = new Session({
      stage: this.opts.stage || 1, god: !!this.opts.god, seed: this.opts.seed, sfx: this.sfx, layout: this.L,
    });
    this.state = 'play';
    input.consumeDrag();
  }

  toAttract(page = 0) {
    audio.stopAll();
    this.state = 'attract';
    this.attractIndex = page;
    this.attractT = 0;
    this.session = null;
  }

  // ---- update ---------------------------------------------------------------
  update() {
    this.t++;
    if (this.toast && --this.toast.t <= 0) this.toast = null;
    const s = this.session;
    const shipUp = !s || s.player.state === 'alive' || s.demo || s.phase === 'intro' || s.phase === 'stageIntro';
    this.stars.speed = shipUp ? 0.6 : 0;
    this.stars.ensure(this.L.w, this.L.h);
    this.stars.update();

    switch (this.state) {
      case 'attract': this.updateAttract(); break;
      case 'play': this.updatePlay(); break;
      case 'pause': this.updatePause(); break;
      case 'results': this.updateResults(); break;
      case 'entry': this.updateEntry(); break;
    }
  }

  updateAttract() {
    this.attractT++;
    const page = ATTRACT_PAGES[this.attractIndex].page;
    if (input.wasPressed('rapid')) this.toggleRapid();
    if (input.wasPressed('mute')) this.toggleMute();

    const act = this.tapAction(input.takeTap());
    if (act === 'rapid' && page !== 'demo') return this.toggleRapid();
    if (act === 'mute' && page !== 'demo') return this.toggleMute();
    if (act || input.wasPressed('start')) return this.startGame();

    if (page === 'demo') {
      if (!this.session) {
        this.session = new Session({ demo: true, sfx: this.sfx, layout: this.L });
      }
      this.session.update(autopilot(this.session), this.L);
      if (this.session.done) this.attractT = Infinity;
    }
    if (this.attractT >= ATTRACT_PAGES[this.attractIndex].ticks) {
      this.session = null;
      this.attractIndex = (this.attractIndex + 1) % ATTRACT_PAGES.length;
      this.attractT = 0;
    }
  }

  updatePlay() {
    const s = this.session;
    if (input.takeFocusLost() || input.takePause() || input.wasPressed('pause')) {
      this.state = 'pause';
      audio.stop('beam');
      return;
    }
    if (input.wasPressed('rapid')) this.toggleRapid();
    if (input.wasPressed('mute')) this.toggleMute();
    s.update(this.humanControls(), this.L);
    if (s.done) {
      this.lastScore = s.score;
      this.state = 'results';
      this.resultsT = 0;
    }
  }

  updatePause() {
    input.consumeDrag();
    if (input.wasPressed('rapid')) this.toggleRapid();
    if (input.wasPressed('mute')) this.toggleMute();
    if (input.wasPressed('quit')) return this.toAttract();
    const act = this.tapAction(input.takeTap());
    if (act === 'rapid') return this.toggleRapid();
    if (act === 'mute') return this.toggleMute();
    if (act === 'quit') return this.toAttract();
    if (act === 'resume' || input.wasPressed('pause') || input.wasPressed('start')) {
      this.state = 'play';
      if (this.session.enemies.some((e) => !e.dead && e.beam)) audio.loop('beam');
    }
  }

  updateResults() {
    this.resultsT++;
    const skip = this.resultsT > 90 && (input.wasPressed('start') || input.takeTap());
    if (this.resultsT >= 360 || skip) {
      const rank = highScores.rankOf(this.lastScore);
      if (rank >= 0) {
        this.state = 'entry';
        this.entry = { rank, letters: [0, 0, 0], pos: 0, t: 0, drag: 0 };
        audio.play('highScore');
      } else {
        this.toAttract(1);
      }
    }
  }

  updateEntry() {
    const en = this.entry;
    en.t++;
    let delta = 0;
    if (input.wasPressed('left') || input.wasPressed('down')) delta = -1;
    if (input.wasPressed('right') || input.wasPressed('up')) delta = 1;
    en.drag += input.consumeDrag();
    while (en.drag > 12) { delta++; en.drag -= 12; }
    while (en.drag < -12) { delta--; en.drag += 12; }
    if (delta) {
      en.letters[en.pos] = (en.letters[en.pos] + delta + LETTERS.length * 4) % LETTERS.length;
      audio.play('select');
    }
    // Typing a letter directly also works on keyboards.
    for (const code of input.pressed) {
      const m = /^Key([A-Z])$/.exec(code);
      if (m) { en.letters[en.pos] = LETTERS.indexOf(m[1]); this.advanceEntry(); return; }
    }
    if (input.wasPressed('start') || input.takeTap()) this.advanceEntry();
    else if (en.t > 60 * 30) { en.pos = 2; this.advanceEntry(); }
  }

  advanceEntry() {
    const en = this.entry;
    audio.play('select');
    if (++en.pos < 3) return;
    const name = en.letters.map((i) => LETTERS[i]).join('');
    highScores.insert(en.rank, this.lastScore, name);
    this.toAttract(1);
  }

  // ---- drawing --------------------------------------------------------------
  draw() {
    const ctx = display.ctx;
    const L = this.L;
    display.beginFrame();
    this.stars.ensure(L.w, L.h);
    this.stars.draw(ctx);
    this.hitRects = [];

    const s = this.session;
    const score = this.state === 'attract' ? this.lastScore : s ? s.score : this.lastScore;
    const high = Math.max(highScores.top, s && !s.demo ? s.score : 0, this.lastScore);

    if (this.state === 'attract') {
      const page = ATTRACT_PAGES[this.attractIndex].page;
      if (page === 'demo' && s) {
        s.draw(ctx);
        drawText(ctx, 'DEMO PLAY', L.cx, L.formationTop - 20, COLORS.yellow, { align: 'center' });
        this.drawStartPrompt(ctx, L.playerY - 40);
      } else if (page === 'scores') this.drawScoresPage(ctx);
      else this.drawTitlePage(ctx);
      drawHud(ctx, L, { score, high });
    } else if (this.state === 'play' || this.state === 'pause') {
      s.draw(ctx, this.opts.debug);
      drawHud(ctx, L, {
        score: s.score, high, reserve: s.reserve, t: this.t,
        badges: s.badges().slice(0, s.badgeShown), blink: s.phase === 'play',
      });
      if (this.state === 'pause') this.drawPause(ctx);
    } else if (this.state === 'results') {
      this.drawResults(ctx);
      drawHud(ctx, L, { score, high });
    } else if (this.state === 'entry') {
      this.drawEntry(ctx);
      drawHud(ctx, L, { score, high });
    }

    if (this.toast) drawText(ctx, this.toast.text, L.cx, L.hudBottom - 4, COLORS.yellow, { align: 'center' });
    if (this.opts.debug) drawText(ctx, `${this.fps | 0} FPS`, L.right - 4, L.hudTop + 20, COLORS.dim, { align: 'right' });
  }

  // Content block of height h, centered vertically between the HUD rows.
  blockTop(h) {
    const L = this.L;
    return Math.max(L.hudTop + 24, L.hudTop + 20 + (L.hudBottom - L.hudTop - 30 - h) / 2);
  }

  drawLogo(ctx, y) {
    const L = this.L;
    drawText(ctx, 'ASTR', L.cx + 2, y + 2, COLORS.red, { align: 'center', scale: 4 });
    drawText(ctx, 'ASTR', L.cx, y, COLORS.cyan, { align: 'center', scale: 4 });
  }

  drawTitlePage(ctx) {
    const L = this.L;
    let y = this.blockTop(240);
    this.drawLogo(ctx, y);
    y += 46;
    drawText(ctx, '- SCORE -', L.cx, y, COLORS.red, { align: 'center' });
    y += 14;
    drawText(ctx, 'FORMATION  ATTACK', L.cx + 16, y, COLORS.dim, { align: 'center' });
    y += 14;
    const rows = [['drone', '50', '100'], ['escort', '80', '160'], ['commander', '150', '400+']];
    for (const [name, a, b] of rows) {
      drawSprite(ctx, name, (this.t >> 4) & 1, L.cx - 60, y + 3);
      drawText(ctx, a, L.cx + 0, y, COLORS.white, { align: 'right' });
      drawText(ctx, b, L.cx + 64, y, COLORS.white, { align: 'right' });
      y += 20;
    }
    this.drawSettings(ctx, y + 6);
    this.drawStartPrompt(ctx, y + 52);
    this.drawControlsHint(ctx, y + 72);
  }

  drawScoresPage(ctx) {
    const L = this.L;
    let y = this.blockTop(200);
    drawText(ctx, 'THE TOP 5', L.cx, y, COLORS.red, { align: 'center' });
    y += 20;
    drawText(ctx, 'SCORE   NAME', L.cx + 8, y, COLORS.cyan, { align: 'center' });
    y += 16;
    const ord = ['1ST', '2ND', '3RD', '4TH', '5TH'];
    highScores.list.forEach((e, i) => {
      drawText(ctx, ord[i], L.cx - 64, y, COLORS.yellow);
      drawText(ctx, String(e.score), L.cx + 16, y, COLORS.white, { align: 'right' });
      drawText(ctx, e.name, L.cx + 32, y, COLORS.white);
      y += 14;
    });
    this.drawSettings(ctx, y + 12);
    this.drawStartPrompt(ctx, y + 58);
  }

  drawSettings(ctx, y) {
    const L = this.L;
    const keys = input.mode === 'keys';
    const rows = [
      ['rapid', `RAPID FIRE${keys ? ' (R)' : ''}`, settings.rapidFire ? 'ON' : 'OFF'],
      ['mute', `SOUND${keys ? ' (M)' : ''}`, settings.muted ? 'OFF' : 'ON'],
    ];
    for (const [action, label, value] of rows) {
      drawText(ctx, label, L.cx - 80, y, COLORS.cyan);
      drawText(ctx, value, L.cx + 80, y, value === 'ON' ? COLORS.yellow : COLORS.dim, { align: 'right' });
      this.hitRects.push({ x: L.cx - 92, y: y - 5, w: 184, h: 18, action });
      y += 18;
    }
  }

  drawStartPrompt(ctx, y) {
    if ((this.t >> 5) & 1) return;
    const text = input.mode === 'keys' ? 'PUSH SPACE TO START' : 'TAP TO START';
    drawText(ctx, text, this.L.cx, y, COLORS.white, { align: 'center' });
  }

  drawControlsHint(ctx, y) {
    const L = this.L;
    const lines = input.mode === 'keys'
      ? ['A D OR ARROWS  MOVE', 'SPACE  FIRE    P  PAUSE']
      : ['DRAG TO MOVE - AUTO FIRE', 'TWO FINGERS TO PAUSE'];
    lines.forEach((ln, i) => drawText(ctx, ln, L.cx, y + i * 11, COLORS.dim, { align: 'center' }));
  }

  drawPause(ctx) {
    const L = this.L;
    ctx.fillStyle = 'rgba(0,0,0,0.7)';
    ctx.fillRect(0, 0, L.w, L.h);
    let y = this.blockTop(110);
    drawText(ctx, 'PAUSED', L.cx, y, COLORS.red, { align: 'center', scale: 2 });
    y += 34;
    const keys = input.mode === 'keys';
    const row = (action, text, color) => {
      drawText(ctx, text, L.cx, y, color, { align: 'center' });
      this.hitRects.push({ x: L.cx - 92, y: y - 5, w: 184, h: 18, action });
      y += 20;
    };
    row('resume', keys ? 'RESUME (P)' : 'RESUME', COLORS.white);
    row('rapid', `RAPID FIRE${keys ? ' (R)' : ''}  ${settings.rapidFire ? 'ON' : 'OFF'}`, COLORS.cyan);
    row('mute', `SOUND${keys ? ' (M)' : ''}  ${settings.muted ? 'OFF' : 'ON'}`, COLORS.cyan);
    row('quit', keys ? 'QUIT (Q)' : 'QUIT', COLORS.dim);
  }

  drawResults(ctx) {
    const L = this.L;
    const s = this.session;
    const shots = s ? s.shotsFired : 0, hits = s ? s.hits : 0;
    const ratio = shots ? ((hits / shots) * 100).toFixed(1) : '0.0';
    let y = this.blockTop(90);
    drawText(ctx, '- RESULTS -', L.cx, y, COLORS.red, { align: 'center' });
    y += 28;
    const row = (label, value, color) => {
      drawText(ctx, label, L.cx - 84, y, color);
      drawText(ctx, value, L.cx + 84, y, color, { align: 'right' });
      y += 18;
    };
    row('SHOTS FIRED', String(shots), COLORS.yellow);
    row('NUMBER OF HITS', String(hits), COLORS.yellow);
    row('HIT-MISS RATIO', `${ratio} %`, COLORS.white);
  }

  drawEntry(ctx) {
    const L = this.L;
    const en = this.entry;
    let y = this.blockTop(200);
    drawText(ctx, 'ENTER YOUR INITIALS !', L.cx, y, COLORS.red, { align: 'center' });
    y += 24;
    drawText(ctx, 'SCORE       NAME', L.cx, y, COLORS.cyan, { align: 'center' });
    y += 16;
    drawText(ctx, String(this.lastScore), L.cx - 8, y, COLORS.white, { align: 'right' });
    for (let i = 0; i < 3; i++) {
      if (i === en.pos && (en.t >> 3) & 1) continue;
      const ch = i <= en.pos ? LETTERS[en.letters[i]] : '_';
      drawText(ctx, ch, L.cx + 32 + i * 10, y, i === en.pos ? COLORS.yellow : COLORS.white);
    }
    y += 22;
    const hint = input.mode === 'keys' ? 'A D CHANGE   SPACE SET' : 'DRAG TO CHANGE - TAP TO SET';
    drawText(ctx, hint, L.cx, y, COLORS.dim, { align: 'center' });
    y += 24;
    drawText(ctx, 'THE TOP 5', L.cx, y, COLORS.red, { align: 'center' });
    y += 16;
    const preview = highScores.list.slice();
    preview.splice(en.rank, 0, { score: this.lastScore, name: en.letters.slice(0, en.pos + 1).map((i) => LETTERS[i]).join('') });
    preview.slice(0, 5).forEach((e, i) => {
      const color = i === en.rank ? COLORS.yellow : COLORS.white;
      drawText(ctx, String(e.score), L.cx + 16, y, color, { align: 'right' });
      drawText(ctx, e.name, L.cx + 32, y, color);
      y += 13;
    });
  }
}
