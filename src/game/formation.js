// The enemy formation grid: 10 columns x 5 rows.
//   row 0: commanders (cols 3-6)   row 1-2: escorts (cols 1-8)   row 3-4: drones (cols 0-9)
// While waves are still entering, the whole grid sways left/right. Once every
// enemy has arrived it switches to "breathing": spreading out and back in.

import { LAYOUT } from '../config.js';

const SWAY_AMP = 12;
const SWAY_PERIOD = 240;
const BREATHE_PERIOD = 128;
const BREATHE_X = 0.2;
const BREATHE_Y = 0.12;

export class Formation {
  constructor() {
    this.t = 0;
    this.mode = 'sway';
    this.swayX = 0;
    this.sx = 1;
    this.sy = 1;
    this.bt = 0;
  }

  update(complete) {
    this.t++;
    if (this.mode === 'sway') {
      const prev = this.swayX;
      this.swayX = SWAY_AMP * Math.sin((this.t * 2 * Math.PI) / SWAY_PERIOD);
      // Switch only when crossing center, so the grid doesn't jump.
      if (complete && Math.sign(prev) !== Math.sign(this.swayX)) {
        this.mode = 'breathe';
        this.swayX = 0;
        this.bt = 0;
      }
    } else {
      this.bt++;
      const f = (1 - Math.cos((this.bt * 2 * Math.PI) / BREATHE_PERIOD)) / 2;
      this.sx = 1 + BREATHE_X * f;
      this.sy = 1 + BREATHE_Y * f;
    }
  }

  pos(L, row, col) {
    return {
      x: L.cx + this.swayX + (col - 4.5) * LAYOUT.colGap * this.sx,
      y: L.formationTop + row * LAYOUT.rowGap * this.sy,
    };
  }
}
