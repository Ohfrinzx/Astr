# Astr

A browser remake of the 1981 arcade fixed-screen shooter formula: formation
waves, swooping dive attacks, the tractor beam that captures your ship, rescuing
it for a dual fighter, challenging bonus stages, and transforming enemies. All
sprites, the font, and all sound are original. No assets from any commercial
game are used.

Plain HTML/JS/canvas. No build step, no dependencies. It runs straight from
GitHub Pages.

## Play

| | Desktop | Phone / tablet |
|---|---|---|
| Move | `A` / `D` or arrow keys | Drag a finger anywhere (the ship follows your finger's movement, not its position) |
| Fire | `Space` | Automatic while your finger is on the screen |
| Rapid fire on/off | `R` | Tap the setting on the title or pause screen |
| Sound on/off | `M` | Tap the setting on the title or pause screen |
| Pause | `P` or `Esc` | Touch with a second finger |
| Start | `Space` / `Enter` | Tap |

**Rapid fire** works like this:
- Off: one shot per press of `Space`. On touch, a steady auto-fire.
- On: hold `Space` to keep firing. On touch, a faster auto-fire.

Either way, you can only have 2 shots on screen at once (4 with a dual fighter).

The screen fills any window or device with no black bars and no stretching.
The playfield widens or lengthens to match the screen's shape.

## Run locally

Any static file server works. ES modules don't load from `file://`, so use a server:

```sh
python3 -m http.server 8000   # then open http://localhost:8000
```

Testing options in the URL: `?stage=7`, `?god=1` (invincible), `?debug=1`
(hitboxes and FPS), `?seed=123`.

## Deploy to GitHub Pages

1. Merge into `main`.
2. Open the repo's **Settings → Pages**. Set **Source: Deploy from a branch**,
   branch `main`, folder `/ (root)`.
3. The game is served at `https://<user>.github.io/<repo>/`.

## For contributors / AI agents

Start with [`AGENTS.md`](AGENTS.md). After that, read
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md),
[`docs/PROGRESS.md`](docs/PROGRESS.md) and
[`docs/REFERENCE.md`](docs/REFERENCE.md).
