/*
 * Astr - audio module. Every sound is synthesized live with the Web Audio API
 * (oscillators, a shared white-noise buffer, gain envelopes). There are no
 * audio files, and all motifs are original compositions.
 *
 * API
 *   audio.init()        Call from a user gesture. Creates/resumes the AudioContext (safe to repeat).
 *   audio.setMuted(b)   Mute/unmute instantly via the master gain.
 *   audio.isMuted()     -> boolean
 *   audio.play(name)    One-shot sound. No-op before init() or without audio support.
 *   audio.loop(name)    Start a looping sound (idempotent).
 *   audio.stop(name)    Stop a looping sound (no-op if not playing).
 *   audio.stopAll()     Stop all loops and every scheduled sound/jingle.
 *
 * One-shots: shot, hitDrone, hitEscort, hitCommander, killCommander,
 *   playerExplode, dive, captured, rescued, gameStart, stageStart,
 *   challengeStart, challengeEnd, challengePerfect, extraLife, badgeTick,
 *   transform, select, highScore, gameOver
 * Loops: beam
 */

const MASTER_VOLUME = 0.25;

let ctx = null;
let master = null;
let noiseBuf = null;
let muted = false;
let unlocked = false;

const live = new Set();          // every scheduled source node (for stopAll)
const activeLoops = new Map();   // name -> { gain, nodes }
const throttle = new Map();      // name -> array of end times
const warned = new Set();

// ---------------------------------------------------------------- helpers

const NOTE_INDEX = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

function noteFreq(n) {
  if (typeof n === 'number') return n;
  if (!n || n === 'R' || n === '-') return 0;
  const m = /^([A-G])([#b]?)(-?\d)$/.exec(n);
  if (!m) return 0;
  let semi = NOTE_INDEX[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
  const midi = (parseInt(m[3], 10) + 1) * 12 + semi;
  return 440 * Math.pow(2, (midi - 69) / 12);
}

function track(node) {
  live.add(node);
  node.onended = () => {
    live.delete(node);
    try { node.disconnect(); } catch (e) { /* ignore */ }
  };
  return node;
}

function getNoise() {
  if (noiseBuf) return noiseBuf;
  const len = Math.floor(ctx.sampleRate * 1.5);
  noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  return noiseBuf;
}

// Envelope: quick attack to `vol`, exponential-ish decay to silence at t+dur.
function env(t, dur, vol, attack = 0.004) {
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(vol, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + Math.max(dur, attack + 0.005));
  g.connect(master);
  return g;
}

// Single oscillator tone with optional pitch sweep.
function tone({ type = 'square', f0, f1 = f0, dur, vol = 0.3, t = ctx.currentTime, attack, curve = 'exp' }) {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(f0, t);
  if (f1 !== f0) {
    if (curve === 'exp') o.frequency.exponentialRampToValueAtTime(Math.max(f1, 1), t + dur);
    else o.frequency.linearRampToValueAtTime(f1, t + dur);
  }
  o.connect(env(t, dur, vol, attack));
  o.start(t);
  o.stop(t + dur + 0.02);
  track(o);
  return o;
}

// Filtered noise burst with optional filter sweep.
function noise({ dur, vol = 0.3, t = ctx.currentTime, type = 'lowpass', f0 = 4000, f1 = f0, q = 1, attack }) {
  const src = ctx.createBufferSource();
  src.buffer = getNoise();
  src.loop = true;
  const filt = ctx.createBiquadFilter();
  filt.type = type;
  filt.Q.value = q;
  filt.frequency.setValueAtTime(f0, t);
  if (f1 !== f0) filt.frequency.exponentialRampToValueAtTime(Math.max(f1, 20), t + dur);
  src.connect(filt);
  filt.connect(env(t, dur, vol, attack));
  src.start(t);
  src.stop(t + dur + 0.02);
  track(src);
  return src;
}

/*
 * Tiny sequencer. voices: [{ wave, vol, notes: [[note|freq|'R', beats], ...], gate, octave }]
 * All voices start together at time t. Returns total duration in seconds.
 */
function sequence(bpm, voices, t = ctx.currentTime + 0.03) {
  const beat = 60 / bpm;
  let longest = 0;
  for (const v of voices) {
    let at = t;
    const gate = v.gate ?? 0.9;
    for (const [n, beats] of v.notes) {
      const len = beats * beat;
      const f = noteFreq(n) * (v.mult || 1);
      if (f > 0) {
        const d = Math.max(0.03, len * gate);
        const o = ctx.createOscillator();
        o.type = v.wave || 'square';
        o.frequency.setValueAtTime(f, at);
        if (v.vibrato && d > 0.25) {
          const lfo = ctx.createOscillator();
          const lg = ctx.createGain();
          lfo.frequency.value = 6;
          lg.gain.setValueAtTime(0, at);
          lg.gain.linearRampToValueAtTime(f * 0.012, at + d);
          lfo.connect(lg);
          lg.connect(o.frequency);
          lfo.start(at);
          lfo.stop(at + d + 0.02);
          track(lfo);
        }
        const g = ctx.createGain();
        const vol = v.vol ?? 0.2;
        g.gain.setValueAtTime(0.0001, at);
        g.gain.linearRampToValueAtTime(vol, at + 0.006);
        g.gain.linearRampToValueAtTime(vol * 0.7, at + Math.max(0.007, d - 0.03));
        g.gain.exponentialRampToValueAtTime(0.0001, at + d);
        g.connect(master);
        o.connect(g);
        o.start(at);
        o.stop(at + d + 0.02);
        track(o);
      }
      at += len;
    }
    longest = Math.max(longest, at - t);
  }
  return longest;
}

// Drop sounds when too many of the same name overlap.
function allow(name, dur, max = 3) {
  const now = ctx.currentTime;
  const list = (throttle.get(name) || []).filter((e) => e > now);
  if (list.length >= max) { throttle.set(name, list); return false; }
  list.push(now + dur);
  throttle.set(name, list);
  return true;
}

// ---------------------------------------------------------------- one-shots

const SOUNDS = {
  shot() {
    if (!allow('shot', 0.08)) return;
    const t = ctx.currentTime;
    tone({ type: 'square', f0: 1500, f1: 380, dur: 0.075, vol: 0.09, t });
    tone({ type: 'triangle', f0: 2400, f1: 900, dur: 0.05, vol: 0.06, t });
  },

  hitDrone() {
    if (!allow('hit', 0.16)) return;
    const t = ctx.currentTime;
    noise({ dur: 0.14, vol: 0.28, t, f0: 5000, f1: 600 });
    tone({ type: 'square', f0: 720, f1: 140, dur: 0.12, vol: 0.12, t });
  },

  hitEscort() {
    if (!allow('hit', 0.2)) return;
    const t = ctx.currentTime;
    noise({ dur: 0.18, vol: 0.28, t, type: 'bandpass', f0: 2600, f1: 400, q: 1.5 });
    tone({ type: 'square', f0: 480, f1: 960, dur: 0.05, vol: 0.12, t });
    tone({ type: 'square', f0: 900, f1: 120, dur: 0.12, vol: 0.12, t: t + 0.05 });
  },

  hitCommander() {
    if (!allow('hit', 0.2)) return;
    const t = ctx.currentTime;
    // Inharmonic partials make a metallic clank.
    tone({ type: 'square', f0: 620, f1: 560, dur: 0.18, vol: 0.1, t });
    tone({ type: 'square', f0: 1013, f1: 940, dur: 0.14, vol: 0.07, t });
    tone({ type: 'triangle', f0: 1587, dur: 0.1, vol: 0.08, t });
    noise({ dur: 0.04, vol: 0.18, t, type: 'highpass', f0: 3000 });
  },

  killCommander() {
    if (!allow('hit', 0.4)) return;
    const t = ctx.currentTime;
    noise({ dur: 0.4, vol: 0.38, t, f0: 6000, f1: 250 });
    tone({ type: 'square', f0: 300, f1: 45, dur: 0.35, vol: 0.14, t });
    tone({ type: 'square', f0: 1200, f1: 300, dur: 0.08, vol: 0.08, t });
  },

  playerExplode() {
    const t = ctx.currentTime;
    noise({ dur: 1.1, vol: 0.45, t, f0: 7000, f1: 120 });
    noise({ dur: 0.5, vol: 0.2, t: t + 0.25, type: 'bandpass', f0: 1200, f1: 150, q: 2 });
    tone({ type: 'square', f0: 420, f1: 30, dur: 1.0, vol: 0.12, t });
    tone({ type: 'triangle', f0: 160, f1: 25, dur: 1.0, vol: 0.2, t });
  },

  dive() {
    if (!allow('dive', 0.6, 2)) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(1400, t);
    o.frequency.exponentialRampToValueAtTime(260, t + 0.6);
    const lfo = ctx.createOscillator();
    const lg = ctx.createGain();
    lfo.frequency.value = 14;
    lg.gain.value = 40;
    lfo.connect(lg);
    lg.connect(o.frequency);
    o.connect(env(t, 0.6, 0.09, 0.03));
    o.start(t); o.stop(t + 0.62);
    lfo.start(t); lfo.stop(t + 0.62);
    track(o); track(lfo);
  },

  captured() {
    // Slow, minor, sinking motif with a low drone.
    sequence(96, [
      { wave: 'square', vol: 0.12, gate: 0.95, vibrato: true,
        notes: [['D5', 0.5], ['C#5', 0.5], ['A4', 0.5], ['Bb4', 0.5], ['F4', 0.5], ['E4', 0.5], ['D4', 0.5]] },
      { wave: 'triangle', vol: 0.3, gate: 1,
        notes: [['D3', 1.5], ['Bb2', 1], ['A2', 1]] },
    ]);
  },

  rescued() {
    sequence(150, [
      { wave: 'square', vol: 0.12,
        notes: [['G4', 0.5], ['B4', 0.5], ['D5', 0.5], ['G5', 0.5], ['F#5', 0.25], ['E5', 0.25],
                ['F#5', 0.5], ['A5', 0.5], ['D6', 1.5]] },
      { wave: 'triangle', vol: 0.28,
        notes: [['G3', 1], ['D3', 1], ['D3', 1], ['G3', 0.5], ['D4', 1.5]] },
    ]);
  },

  gameStart() {
    sequence(170, [
      { wave: 'square', vol: 0.11,
        notes: [['E4', 0.5], ['G4', 0.5], ['C5', 1], ['B4', 0.5], ['G4', 0.5], ['A4', 1],
                ['F4', 0.5], ['A4', 0.5], ['D5', 1], ['C5', 0.5], ['A4', 0.5], ['B4', 1],
                ['G4', 0.5], ['B4', 0.5], ['E5', 1], ['D5', 0.5], ['B4', 0.5], ['C5', 2.5]] },
      { wave: 'square', vol: 0.05, gate: 0.6,
        notes: [['C4', 1], ['E4', 1], ['C4', 1], ['E4', 1], ['A3', 1], ['D4', 1], ['B3', 1], ['D4', 1],
                ['G3', 1], ['E4', 1], ['G3', 1], ['G4', 1], ['E4', 2.5]] },
      { wave: 'triangle', vol: 0.3, gate: 0.8,
        notes: [['C3', 1], ['C3', 1], ['A2', 1], ['A2', 1], ['F2', 1], ['F2', 1], ['G2', 1], ['G2', 1],
                ['E2', 1], ['E2', 1], ['G2', 1], ['G2', 1], ['C3', 2.5]] },
    ]);
  },

  stageStart() {
    sequence(180, [
      { wave: 'square', vol: 0.11,
        notes: [['A4', 0.5], ['E5', 0.5], ['D5', 0.5], ['E5', 0.5], ['G5', 0.5], ['A5', 1.5]] },
      { wave: 'triangle', vol: 0.28,
        notes: [['A2', 1], ['G2', 1], ['A2', 2]] },
    ]);
  },

  challengeStart() {
    sequence(200, [
      { wave: 'square', vol: 0.11, gate: 0.7,
        notes: [['C5', 0.5], ['C5', 0.5], ['E5', 0.5], ['G5', 0.5], ['F5', 0.5], ['A5', 0.5], ['G5', 0.5], ['E5', 0.5],
                ['F5', 0.5], ['D5', 0.5], ['B4', 0.5], ['G5', 0.5], ['C6', 1.5]] },
      { wave: 'triangle', vol: 0.28, gate: 0.6,
        notes: [['C3', 0.5], ['C4', 0.5], ['C3', 0.5], ['C4', 0.5], ['F2', 0.5], ['F3', 0.5], ['F2', 0.5], ['F3', 0.5],
                ['G2', 0.5], ['G3', 0.5], ['G2', 0.5], ['G3', 0.5], ['C3', 1.5]] },
    ]);
  },

  challengeEnd() {
    sequence(160, [
      { wave: 'square', vol: 0.1,
        notes: [['E5', 0.5], ['C5', 0.5], ['D5', 0.5], ['G4', 0.5], ['A4', 0.5], ['C5', 1.5]] },
      { wave: 'triangle', vol: 0.26,
        notes: [['C3', 1], ['G2', 1], ['F2', 0.5], ['C3', 1.5]] },
    ]);
  },

  challengePerfect() {
    sequence(180, [
      { wave: 'square', vol: 0.11,
        notes: [['C5', 0.25], ['E5', 0.25], ['G5', 0.25], ['C6', 0.25], ['B5', 0.5], ['G5', 0.5],
                ['A5', 0.25], ['F5', 0.25], ['D5', 0.25], ['A5', 0.25], ['G5', 1],
                ['E5', 0.25], ['G5', 0.25], ['C6', 0.5], ['D6', 0.5], ['E6', 2]] },
      { wave: 'square', vol: 0.05,
        notes: [['E4', 1], ['G4', 1], ['F4', 1], ['B4', 1], ['G4', 1], ['C5', 2]] },
      { wave: 'triangle', vol: 0.28,
        notes: [['C3', 1], ['E3', 1], ['F3', 1], ['G3', 1], ['G2', 1], ['C3', 2]] },
    ]);
  },

  extraLife() {
    const notes = [];
    for (const n of ['C5', 'E5', 'G5', 'C6', 'E5', 'G5', 'C6', 'E6']) notes.push([n, 0.25]);
    notes.push(['G6', 1]);
    sequence(240, [{ wave: 'square', vol: 0.1, gate: 0.8, notes }]);
  },

  badgeTick() {
    const t = ctx.currentTime;
    tone({ type: 'square', f0: 1760, f1: 1320, dur: 0.045, vol: 0.08, t });
  },

  transform() {
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'square';
    o.frequency.setValueAtTime(300, t);
    o.frequency.linearRampToValueAtTime(900, t + 0.5);
    const lfo = ctx.createOscillator();
    const lg = ctx.createGain();
    lfo.type = 'square';
    lfo.frequency.setValueAtTime(10, t);
    lfo.frequency.linearRampToValueAtTime(28, t + 0.5);
    lg.gain.value = 120;
    lfo.connect(lg);
    lg.connect(o.frequency);
    o.connect(env(t, 0.5, 0.09, 0.02));
    o.start(t); o.stop(t + 0.52);
    lfo.start(t); lfo.stop(t + 0.52);
    track(o); track(lfo);
  },

  select() {
    const t = ctx.currentTime;
    tone({ type: 'square', f0: 990, dur: 0.035, vol: 0.08, t });
    tone({ type: 'square', f0: 1320, dur: 0.04, vol: 0.08, t: t + 0.035 });
  },

  highScore() {
    sequence(140, [
      { wave: 'square', vol: 0.1,
        notes: [['G4', 0.5], ['C5', 0.5], ['E5', 0.5], ['D5', 0.5], ['C5', 0.5], ['A4', 0.5], ['B4', 1],
                ['A4', 0.5], ['D5', 0.5], ['F5', 0.5], ['E5', 0.5], ['D5', 0.5], ['B4', 0.5], ['C5', 1.5]] },
      { wave: 'triangle', vol: 0.26,
        notes: [['C3', 1], ['A2', 1], ['G2', 2], ['D3', 1], ['G2', 1], ['C3', 1.5]] },
    ]);
  },

  gameOver() {
    sequence(110, [
      { wave: 'square', vol: 0.1, vibrato: true,
        notes: [['G4', 0.5], ['F4', 0.5], ['Eb4', 0.5], ['D4', 0.5], ['C4', 1.5]] },
      { wave: 'triangle', vol: 0.28,
        notes: [['C3', 1], ['Ab2', 1], ['C2', 1.5]] },
    ]);
  },
};

// ---------------------------------------------------------------- loops

const LOOPS = {
  beam() {
    const t = ctx.currentTime;
    const out = ctx.createGain();
    out.gain.setValueAtTime(0.0001, t);
    out.gain.linearRampToValueAtTime(0.1, t + 0.08);
    out.connect(master);

    const a = ctx.createOscillator();
    a.type = 'square';
    a.frequency.value = 196;
    const b = ctx.createOscillator();
    b.type = 'triangle';
    b.frequency.value = 294;

    const lfoA = ctx.createOscillator();
    lfoA.frequency.value = 7;
    const lgA = ctx.createGain();
    lgA.gain.value = 30;
    lfoA.connect(lgA); lgA.connect(a.frequency);

    const lfoB = ctx.createOscillator();
    lfoB.type = 'triangle';
    lfoB.frequency.value = 1.3;
    const lgB = ctx.createGain();
    lgB.gain.value = 60;
    lfoB.connect(lgB); lgB.connect(b.frequency);

    const ga = ctx.createGain(); ga.gain.value = 0.45;
    const gb = ctx.createGain(); gb.gain.value = 0.8;
    a.connect(ga); ga.connect(out);
    b.connect(gb); gb.connect(out);

    const nodes = [a, b, lfoA, lfoB];
    for (const n of nodes) { n.start(t); track(n); }
    return { gain: out, nodes };
  },
};

function stopLoop(name) {
  const l = activeLoops.get(name);
  if (!l) return;
  activeLoops.delete(name);
  try {
    const t = ctx.currentTime;
    l.gain.gain.cancelScheduledValues(t);
    l.gain.gain.setValueAtTime(l.gain.gain.value, t);
    l.gain.gain.linearRampToValueAtTime(0.0001, t + 0.04);
    for (const n of l.nodes) { try { n.stop(t + 0.05); } catch (e) { /* ignore */ } }
  } catch (e) { /* ignore */ }
}

function warnOnce(name) {
  if (warned.has(name)) return;
  warned.add(name);
  try { console.warn(`[audio] unknown sound "${name}"`); } catch (e) { /* ignore */ }
}

function ready() {
  return !!(ctx && master && ctx.state !== 'closed');
}

// ---------------------------------------------------------------- public API

export const audio = {
  init() {
    try {
      if (!ctx) {
        const AC = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext);
        if (!AC) return;
        ctx = new AC();
        const comp = ctx.createDynamicsCompressor();
        comp.threshold.value = -10;
        comp.knee.value = 6;
        comp.ratio.value = 8;
        comp.attack.value = 0.003;
        comp.release.value = 0.15;
        comp.connect(ctx.destination);
        master = ctx.createGain();
        master.gain.value = muted ? 0 : MASTER_VOLUME;
        master.connect(comp);
      }
      if (ctx.state === 'suspended' && ctx.resume) {
        const p = ctx.resume();
        if (p && p.catch) p.catch(() => {});
      }
      if (!unlocked) {
        // iOS unlock: play a 1-sample silent buffer inside the gesture.
        unlocked = true;
        const buf = ctx.createBuffer(1, 1, ctx.sampleRate || 22050);
        const src = ctx.createBufferSource();
        src.buffer = buf;
        src.connect(ctx.destination);
        src.start(0);
      }
    } catch (e) {
      // Audio unavailable: stay silent.
    }
  },

  setMuted(b) {
    muted = !!b;
    try {
      if (!ready()) return;
      const t = ctx.currentTime;
      master.gain.cancelScheduledValues(t);
      master.gain.setValueAtTime(muted ? 0 : MASTER_VOLUME, t);
    } catch (e) { /* ignore */ }
  },

  isMuted() {
    return muted;
  },

  play(name) {
    try {
      const fn = Object.prototype.hasOwnProperty.call(SOUNDS, name) ? SOUNDS[name] : null;
      if (!fn) { warnOnce(name); return; }
      if (!ready() || muted) return;
      fn();
    } catch (e) { /* never throw */ }
  },

  loop(name) {
    try {
      const fn = Object.prototype.hasOwnProperty.call(LOOPS, name) ? LOOPS[name] : null;
      if (!fn) { warnOnce(name); return; }
      if (!ready() || activeLoops.has(name)) return;
      activeLoops.set(name, fn());
    } catch (e) { /* never throw */ }
  },

  stop(name) {
    try {
      if (!ready()) return;
      stopLoop(name);
    } catch (e) { /* never throw */ }
  },

  stopAll() {
    try {
      if (!ready()) return;
      for (const name of [...activeLoops.keys()]) stopLoop(name);
      const t = ctx.currentTime;
      for (const n of [...live]) {
        try { n.stop(t); } catch (e) { /* already stopped */ }
      }
      throttle.clear();
    } catch (e) { /* never throw */ }
  },
};

export default audio;
