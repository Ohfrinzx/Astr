# Agent instructions — Astr

Read this file first. Then read `docs/PROGRESS.md` for what's done and what's
next, `docs/ARCHITECTURE.md` for how the code fits together, and
`docs/REFERENCE.md` for the game rules this project reproduces.

## What this project is

Astr is a faithful *gameplay* recreation of the 1981 arcade game that put
tractor beams in this genre (formation, dives, capture/rescue, dual fighter,
challenging stages, transforms, scoring, attract mode). It runs in any browser
and is hosted on GitHub Pages.

The owner's requirements (keep these true):
1. Behaves like the 1981 arcade original. Gameplay rules and numbers are in
   `docs/REFERENCE.md`.
2. Fills **any** screen with **no letterbox bars and no stretching**. Scaling is
   uniform; the world grows in one dimension to match the screen's shape (see
   `src/display.js`).
3. Desktop: `A`/`D` (and arrow keys) move, `Space` fires. `W`/`S` do nothing in
   play, because the ship only moves horizontally, as in the arcade.
4. Touch: drag anywhere to move (relative movement) with automatic fire. **No
   on-screen buttons or overlays during play.** Settings live on the title and
   pause screens.
5. Rapid fire is a toggle (`R`, or tap on the title/pause screen) and is saved.
6. Keep this file and `docs/` up to date so any agent can continue the work.

## Hard rules

- **No copyrighted assets.** Do not add sprites, fonts, music, sound samples,
  logos or names taken from Namco/Bandai Namco games (or any commercial game).
  Do not use the original game's title or its enemy names in user-visible text.
  All art in `src/gfx/sprites.js` and `src/gfx/font.js` and all audio in
  `src/audio.js` is original. Keep it that way: design new art and compose new
  jingles yourself. Copying game *rules and numbers* (scores, timings) is fine.
- **No build step, no npm dependencies at runtime.** Plain ES modules served as
  static files. GitHub Pages serves the repo root as-is. `.nojekyll` must stay.
- All paths in `index.html` and imports are **relative** (the site is served
  from `/<repo>/`, not `/`).
- The simulation runs at a **fixed 60 ticks/second**. All speeds are in world
  units per tick. Never use frame delta time inside game logic.
- Game logic reads layout from `display.layout` / `session.L`, never from fixed
  224x288 numbers, so it keeps working at every aspect ratio.

## Workflow

1. Read `docs/PROGRESS.md` and choose the next item, or do what the user asked.
2. Make the change, matching the existing code style (small modules, comments
   on the *why*, 2-space indent, single quotes, semicolons).
3. Run the checks (they need Playwright + Chromium; `require('playwright')`
   must resolve):
   ```sh
   node tools/scenario-test.cjs        # gameplay rule tests, must be all PASS
   node tools/smoke-test.cjs           # loads 4 screen sizes + 6-minute soak, must print OK
   node tools/trace-paths.cjs 1 900    # optional: draws flight-path trails to smoke-out/
   ```
   Look at the screenshots in `smoke-out/` when you change visuals or layout.
4. Update `docs/PROGRESS.md` (log entry + checklist), and `docs/ARCHITECTURE.md`
   if you changed structure or interfaces.
5. Commit with a clear message.
6. **Owner's standing instruction:** once the checks in step 3 pass, merge the
   work into `main` and push it, without waiting to be asked. `main` is what
   GitHub Pages serves. Never merge work that fails a check.

## Handy debugging

- URL flags: `?stage=N` start stage, `?god=1` invincible, `?debug=1` hitboxes
  and FPS, `?seed=N` deterministic RNG.
- `window.__astr` is the `App`. In the devtools console, `__astr.session` is the
  running game. Call `__astr.update()` to step one tick.
