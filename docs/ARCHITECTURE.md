# Architecture

Vanilla ES modules on one `<canvas>`. No build step and no dependencies.
`index.html` loads `src/main.js`.

```
index.html, style.css        page shell (full-screen canvas, safe-area probe)
src/
  main.js                    boot + fixed-timestep loop (60 ticks/s), URL flags
  config.js                  every tunable number (speeds, scores, layout, bonus lives)
  display.js                 canvas sizing, uniform scale, world size, layout
  input.js                   keyboard + pointer/touch, sampled per tick
  store.js                   localStorage: settings (rapid fire, mute) + top-5 scores
  audio.js                   Web Audio synth: one-shot SFX, loops, jingles (original)
  app.js                     screen state machine: attract / play / pause / results / entry
  ui/hud.js                  1UP, HIGH SCORE, reserve ships, stage badges
  gfx/sprites.js             pixel-art data (strings + palettes) -> canvases (original art)
  gfx/font.js                8x8 bitmap font, drawText/textWidth (original)
  gfx/render.js              drawSprite with cached 32-step rotations
  gfx/starfield.js           scrolling, twinkling background
  game/session.js            ONE play-through: all gameplay rules
  game/flight.js             flight-program interpreter + entry/challenge/dive paths
  game/formation.js          10x5 grid positions, sway then "breathing"
  game/stages.js             wave scripts per stage, challenge groups, difficulty curve
  game/autopilot.js          AI that plays the attract-mode demo
tools/
  smoke-test.cjs             headless load at 4 screen sizes + soak run
  scenario-test.cjs          rule tests (capture, rescue, dual, transforms, bonuses...)
  trace-paths.cjs            draws enemy flight trails for tuning paths
```

## Coordinates and scaling (`display.js`)

- One **world unit** is one arcade pixel. The reference screen is 224x288 (portrait 3:4).
- `scale = min(canvasW/224, canvasH/288)` in device pixels. The world is
  `canvasW/scale` by `canvasH/scale`, so one dimension is exactly 224 or 288 and
  the other is larger. The result fills the screen with no bars and no distortion.
- `display.layout` (`L`) holds the anchors that game code uses: `w, h, cx, left,
  right, hudTop, hudBottom, formationTop, playerY, bottom`. Safe-area insets
  (notches) are folded in through the hidden `#safe-area-probe` element.
- On tall screens the formation moves down by `TALL_FORMATION_SHIFT` (50%) of
  the extra height, so the gap between the formation and the player stays close
  to the arcade's. On wide screens the playfield is wider and the formation stays centered.
- `layout` is recomputed on every resize. Entities store world coordinates, and
  the formation and player clamp read `L` every tick, so rotating a phone
  mid-game works.

## Main loop (`main.js`)

`requestAnimationFrame` gathers real time. `app.update()` runs once per 16.67 ms
(at most 6 catch-up ticks per frame), and `input.endTick()` clears
edge-triggered input after each tick. `app.draw()` runs once per frame.
`window.__astr` exposes the App for debugging and tests.

## Input (`input.js`)

- `isHeld(action)` / `wasPressed(action)` with action names `left, right, up,
  down, fire, start, pause, rapid, mute, quit` (bindings at the top of the file).
- Touch / pointer: the first pointer down is the *drag* pointer, and its
  horizontal movement adds up in `dragDX` (world units), read by
  `consumeDrag()`. `touching` is true while it is down. A second pointer sets
  `takePause()`. A short tap with no movement is queued for `takeTap()` (menus).
- `mode` is `'keys'` or `'touch'` (the last one used). Screens use it to show
  the right hints.

## App / screens (`app.js`)

States: `attract` (pages `title`, then `scores`, then `demo`, cycling), `play`,
`pause`, `results`, `entry`. The App owns the `Starfield` and the current
`Session`. It turns input into a `controls` object for the session:
`{ left, right, fireHeld, firePressed, touchActive, dragDX, rapid }`. Menu rows
that can be tapped are recorded in `hitRects` while drawing and checked against
taps on the next tick.

## Session (`game/session.js`)

Holds score, reserve ships, stage, entities and phase.

**Phases:** `intro` (PLAYER 1), then `stageIntro` (STAGE N / CHALLENGING STAGE,
badges tick in), then `play`. From `play` the game goes to `stageClear` (and
`stageIntro` again) or to `csResults`, and finally to `gameOver`, which sets
`done = true`.

**Player:** `player.state` is one of `none | alive | exploding | waiting |
captured | dead`, plus the `dual` flag. `respawn` handles waiting for all
attackers to go home before showing READY and bringing in the next ship.

**Enemy objects** are plain objects. The important fields:
- `type`: `drone | escort | commander | captive | transformA/B/C`
- `mode`:
  - `enter`: flying an entry program
  - `formation`: sitting in its grid slot
  - `dive`: flying an attack program
  - `escort`: locked to `leader` at `offset` in the leader's local frame
  - `captive`: the captured fighter, drawn 16 units above `host`
  - `transforming`: blinking before it splits into three
  - `cs`: challenging-stage flyer
- `row, col`: the slot (`undefined` = no slot)
- `hp`: 2 for commanders
- `escortCount`: escorts present when the dive started (sets the 400/800/1600 value)
- `captive` / `host`: links between a commander and the fighter it captured
- `group`: challenge group or transform trio, used for set bonuses

**Key methods:**
- `launchAttack` and `commanderAttack` choose dives (a tractor-beam dive or an
  escorted dive).
- `beamTick` runs the beam, and `startCapture` / `updateCapture` handle a capture.
- `freeCaptive` decides between a rescue (host killed in flight) and the
  captive turning hostile (host killed in formation).
- `updateRescue` docks the rescued ship to make a dual fighter.
- `scoreFor` holds all scoring.

Sounds go through the `sfx` callbacks; the demo session is silent.

## Flight programs (`game/flight.js`)

Movement works like a turtle: `heading` in degrees (0 = up, clockwise) and
`speed`. A program is an array of steps. Each step can set `sp` / `head`, steer
with `turn` / `aim` / `seek`, schedule shots with `fire`, and runs until `t` /
`toHead` / `untilY` / `untilX` is met. Special ops are `home` (steer into the
slot), `wrap` (off the bottom, re-enter from the top, home), `leave` (despawn
off-screen) and `beam`.

Path factories (`ENTRY.*`, `CHALLENGE.*`, `DIVES.*`) take the layout and a
mirror sign `m` (+1 = written for the left side, -1 = mirrored) and return
absolute numbers. That is how one path definition works for both sides and at
every screen size. Use `tools/trace-paths.cjs` to see them.

## Stages (`game/stages.js`)

- `buildStage(n)` returns `{ challenge, waves }`. A wave is a set of lines that
  start together. Each line has a `path(L)`, an optional `lat` (side offset, so
  paired lines fly side by side) and `members` (`{type, row, col}`).
- Normal stages cycle through three entry variants.
- Challenging stages (3, 7, 11, ...) cycle through three sets of 5 groups of 8.
- `difficulty(n)` sets the attack interval, the number of attacks at once,
  firing during entry, and whether attacks start before the formation is complete.
- `transformType(n)` picks the transform type (stage 4+).

## Graphics

- `sprites.js`: `SPRITE_DEFS[name] = { w, h, palette, frames: [[rows]] }`.
  `buildSprites()` validates the data and bakes canvases.
- Ship sprites face **up**. `render.drawSprite(ctx, name, frame, x, y,
  angleRad)` pre-rotates them at 32 steps with nearest-neighbour sampling, which
  keeps the chunky arcade look.
- Sprite names: `player, playerCaptured, drone, escort, commander, commanderHit,
  transformA/B/C, enemyExplosion(5f), playerExplosion(4f), playerShot,
  enemyShot, badge1/5/10/20/30/50`.
- `font.js`: `drawText(ctx, text, x, y, color, {align, scale})` with 8x8 cells.

## Audio (`audio.js`)

`audio.init()` (called on the first user gesture), `play(name)`,
`loop(name)` / `stop(name)`, `stopAll()`, `setMuted(bool)`. All sounds are
synthesized. The full list of names is in the header comment of `audio.js`.

## Persistence (`store.js`)

`localStorage` keys `astr.settings.v1` (`{rapidFire, muted}`) and
`astr.highscores.v1` (top 5 `{score, name}`). Every access is wrapped in
try/catch, and the game works without storage.
