# Progress

Keep this file current. Add a dated log entry for each work session and tick
items off the checklist.

## Status

**Playable, feature-complete first version.** Every core arcade system is in
place and covered by the rule tests. Most of the remaining work is fidelity
tuning (paths, timings, difficulty) and polish.

## Checklist

### Done
- [x] Full-screen uniform scaling at any aspect ratio, no bars (`display.js`), safe-area aware
- [x] Fixed 60 Hz simulation loop, debug URL flags, `window.__astr`
- [x] Keyboard: A/D/arrows + Space; P/Esc pause, R rapid fire, M mute
- [x] Touch: relative drag, auto-fire, second-finger pause, tap menus; no in-play overlays
- [x] Rapid fire toggle, saved in localStorage
- [x] Original sprites (ships, enemies, transforms, explosions, shots, badges) and bitmap font
- [x] Original synthesized sound effects and jingles (Web Audio)
- [x] Starfield (scrolls, twinkles, stops while you have no ship)
- [x] Formation grid with sway and breathing
- [x] 5-wave entries, 3 rotating entry variants, paired lines
- [x] Dive attacks: drones (with loops), escorts (zig-zag), commanders with up to 2 escorts
- [x] Enemy fire aimed at the player, scaling with stage
- [x] Tractor beam, capture, captive held in formation, rescue and dual fighter
- [x] Captive turns hostile if its host dies in formation; returns in a later stage
- [x] Challenging stages (3, 7, 11, ...): 5 groups of 8, group bonuses, hits / perfect bonus
- [x] Transforms (stage 4+), set bonuses 1000/2000/3000
- [x] Scoring per the arcade table, popups for big kills, bonus ships 20k/70k/every 70k
- [x] Death, READY and respawn after attackers return; game over
- [x] HUD: 1UP, HIGH SCORE, reserve ships, stage badges (tick in at stage start)
- [x] Attract mode: title with score table and settings, top 5, autopilot demo
- [x] Results screen (shots, hits, ratio) and 3-letter initials entry (keys, typing, or drag/tap)
- [x] Pause screen with tappable settings
- [x] Tests: `tools/scenario-test.cjs` (32 rule checks), `tools/smoke-test.cjs`, `tools/trace-paths.cjs`
- [x] Docs: AGENTS.md, ARCHITECTURE.md, REFERENCE.md, this file

### Next (suggested order)
- [ ] Play-test on real phones (iOS Safari, Android Chrome): drag feel (`PLAYER.touchGain`,
      `touchMaxSpeed`), audio unlock, notch safe areas, landscape
- [ ] Tune entry paths against reference footage of the original (shape and timing of each wave)
- [ ] Tune difficulty curve (`difficulty()` in stages.js, bullet speeds in config.js)
- [ ] Late-stage behaviours of the original: enemies that keep diving without returning, faster dives
- [ ] Challenging stages: more distinct choreography per stage (there are only 3 sets now)
- [ ] Transforms: give each type its own flight pattern
- [ ] Optional: 2-player alternating mode (not requested)
- [ ] Optional: PWA manifest + offline cache so it installs to a phone home screen

## Known issues / notes
- On very wide screens (e.g. a phone in landscape) the playfield is much wider
  than the arcade's, which makes dodging easier. This is the trade-off for "no
  bars, no stretching". `TALL_FORMATION_SHIFT` controls the equivalent for tall screens.
- The demo autopilot is simple and usually loses around stage 2. That's fine for attract mode.
- The original's exact flight-path data isn't used; paths are recreated by eye.

## Log

### 2026-10-27 — initial build
- Owner's requirements: arcade 1981 gameplay, GitHub Pages, any screen size with
  no bars and no stretching, WASD + Space, touch drag, no mobile clutter, rapid
  fire toggle, docs for agents. Defaults chosen: 1981 version only, title "Astr",
  1 player, free play, sound on with M to mute, local top-5 scores, no build step.
- Built the whole engine and gameplay (see checklist). Sprites, font and audio
  were written by sub-agents to fixed interfaces and are original.
- Verified with headless Chromium: no console errors at 1920x1080, 390x844,
  844x390 and 1024x768; 32/32 rule scenarios pass; flight paths checked with
  trail renders.
- Owner asked for verified work to be merged into `main` automatically (now in
  AGENTS.md). Before the first merge, also tested it served from the `/Astr/`
  subpath the way GitHub Pages serves it, using real keyboard input (start,
  move, fire, rapid-fire toggle, pause). It works.
