// Scrolling, twinkling starfield behind everything. Stars are kept in world
// units and regenerated when the world size changes so density stays even.

const COLORS = ['#ffffff', '#ff5050', '#50ff50', '#5080ff', '#ffff50', '#ff50ff', '#50ffff', '#ffa040'];
const DENSITY = 72 / (224 * 288); // stars per square world unit

export class Starfield {
  constructor() {
    this.stars = [];
    this.w = 0;
    this.h = 0;
    this.speed = 0.6;   // units/tick; set to 0 to freeze (e.g. capture sequence)
    this.t = 0;
  }

  ensure(w, h) {
    if (Math.abs(w - this.w) < 0.5 && Math.abs(h - this.h) < 0.5) return;
    this.w = w; this.h = h;
    const n = Math.round(w * h * DENSITY);
    this.stars = [];
    for (let i = 0; i < n; i++) {
      this.stars.push({
        x: Math.random() * w,
        y: Math.random() * h,
        color: COLORS[(Math.random() * COLORS.length) | 0],
        group: (Math.random() * 4) | 0, // blink group
        depth: 0.6 + Math.random() * 0.8,
      });
    }
  }

  update() {
    this.t++;
    for (const s of this.stars) {
      s.y += this.speed * s.depth;
      if (s.y >= this.h) { s.y -= this.h; s.x = Math.random() * this.w; }
    }
  }

  draw(ctx) {
    // Each group is hidden for part of a 64-tick cycle, giving the classic twinkle.
    const phase = (this.t >> 4) & 3;
    for (const s of this.stars) {
      if (s.group === phase) continue;
      ctx.fillStyle = s.color;
      ctx.fillRect(Math.floor(s.x), Math.floor(s.y), 1, 1);
    }
  }
}
