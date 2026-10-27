// Persistent per-browser storage: settings and the high score table.
// localStorage can throw (private mode, blocked storage), so every access is
// guarded and the game works without it.

import { HIGH_SCORE_COUNT } from './config.js';

const SETTINGS_KEY = 'astr.settings.v1';
const SCORES_KEY = 'astr.highscores.v1';

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch { return fallback; }
}
function write(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* ignore */ }
}

export const settings = {
  rapidFire: false,
  muted: false,
  load() {
    const s = read(SETTINGS_KEY, {});
    this.rapidFire = !!s.rapidFire;
    this.muted = !!s.muted;
  },
  save() { write(SETTINGS_KEY, { rapidFire: this.rapidFire, muted: this.muted }); },
};

const DEFAULT_SCORES = [
  { score: 20000, name: 'AST' },
  { score: 18000, name: 'ZAP' },
  { score: 16000, name: 'SKY' },
  { score: 14000, name: 'NOV' },
  { score: 12000, name: 'ORB' },
];

export const highScores = {
  list: DEFAULT_SCORES.map((e) => ({ ...e })),
  load() {
    const l = read(SCORES_KEY, null);
    if (Array.isArray(l) && l.length) {
      this.list = l
        .filter((e) => e && Number.isFinite(e.score) && typeof e.name === 'string')
        .slice(0, HIGH_SCORE_COUNT);
    }
    while (this.list.length < HIGH_SCORE_COUNT) this.list.push({ score: 0, name: '...' });
  },
  save() { write(SCORES_KEY, this.list); },
  get top() { return this.list[0].score; },
  // Rank (0-based) a score would take, or -1 if it does not qualify.
  rankOf(score) {
    if (score <= 0) return -1;
    const i = this.list.findIndex((e) => score > e.score);
    return i;
  },
  insert(rank, score, name) {
    this.list.splice(rank, 0, { score, name });
    this.list.length = HIGH_SCORE_COUNT;
    this.save();
  },
};
