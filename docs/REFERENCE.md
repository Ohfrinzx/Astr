# Game rules reference

These are the rules Astr reproduces from the 1981 arcade original (Namco's
*Galaga*, named here only as the research reference; it never appears in the
game). Each rule notes whether it is **confirmed** by sources, **approximate**
(the behaviour is right but exact numbers weren't available), or a
**deviation** (changed on purpose). Numbers live in `src/config.js` and
`src/game/stages.js`.

## Sources

Gathered from web search results in Oct 2026. Full pages couldn't be fetched
from the build environment, so these are summaries of search-result text:

- StrategyWiki, Galaga gameplay: https://strategywiki.org/wiki/Galaga/Gameplay
- StrategyWiki, Galaga walkthrough: https://strategywiki.org/wiki/Galaga/Walkthrough
- Wikipedia, Galaga: https://en.wikipedia.org/wiki/Galaga
- Arcade History, Galaga: https://www.arcade-history.com/game/898/
- RetroAchievements (default DIP settings): https://retroachievements.org/game/32562
- TrueAchievements walkthrough (transforms): https://www.trueachievements.com/game/Galaga/walkthrough
- Exotica, Lost In Translation/Galaga: https://www.exotica.org.uk/wiki/Lost_In_Translation/Galaga

## Player

- Moves horizontally only. At most 2 shots on screen. **Confirmed.**
- Starts with 3 ships (1 in play + 2 in reserve). Bonus ships at 20,000,
  70,000, then every 70,000. This is the default DIP setting. **Confirmed.**
- Speeds: ship 1.75 units/tick, shot 7 units/tick. **Approximate**, tuned by feel.
- Rapid fire toggle: **deviation** (a requested modern option). The 2-shot
  limit still applies.
- Touch controls (relative drag, auto-fire, second finger pauses): **deviation**
  (requested).

## Enemies and scoring

| Enemy (Astr name) | Role in the original | In formation | Flying |
|---|---|---|---|
| drone | rank-and-file "bee" | 50 | 100 |
| escort | mid-tier "butterfly" | 80 | 160 |
| commander (2 hits) | "boss" | 150 | 400 alone / 800 with 1 escort / 1600 with 2 |
| captured fighter | your captured ship | 500 | 1000 |
| transform (x3) | special trio | — | 160 each + set bonus |

- Commander values are **confirmed**. The escort bonus is set by how many
  escorts were present **when the dive began**: one source says escorts shot
  earlier still count.
- Captured fighter values: sources disagree (a flat 1000, or 500 / 1000). We use 500 / 1000.
- Commanders take 2 hits and change color after the first. **Confirmed.**
- Enemies shot while entering count as "flying". **Approximate.**

## Tractor beam, capture and rescue

- A commander may dive alone, stop above the player and open a beam. A ship
  inside the beam is pulled up and captured; the commander takes it home, and
  it sits above the commander in formation. You lose that ship (the next one
  comes from reserve). If it was your last ship, the game ends. **Confirmed.**
- Killing the commander **while it is flying** frees the fighter, which docks
  beside you to make a **dual fighter**: two ships, 2 shots per press, 4 on
  screen, twice the target size. If one half is hit, you keep the other. **Confirmed.**
- Killing the commander **while it is in formation** turns the captured fighter
  hostile. Sources differ on what happens next: one says it swoops and leaves,
  another says it comes back in a later stage. We do both: it dives, and if it
  escapes it returns attached to a commander in the next normal stage.
- No beam while you have a dual fighter or while a captured fighter exists. Only
  one beam at a time. **Approximate.**
- Beam timing (open 0.8 s, hold 2.5 s, close 0.7 s) and capture width (±18
  units): **approximate.**

## Stages

- 40 enemies per normal stage: 4 commanders, 16 escorts, 20 drones, entering in
  5 waves. Formation rows: commanders (cols 3-6), escorts ×2 (cols 1-8),
  drones ×2 (cols 0-9). **Confirmed.**
- The formation sways while enemies enter, then "breathes" (spreads and
  contracts). **Confirmed** (observed behaviour); amplitude and period are approximate.
- Entry paths and wave pairing are recreated by eye in three rotating variants.
  **Approximate.** The original stage scripts are not reproduced byte-for-byte.
- Dive frequency and how many dive at once rise with the stage. When ≤5 enemies
  remain, they attack constantly. **Approximate.**
- After you lose a ship, the next one appears only after all attackers have
  returned to formation and no enemy shots remain (READY). **Confirmed** (observed).
- **Challenging stages** are stages 3, 7, 11, 15, and so on (the first comes
  after stage 2, then every 4th stage).
  - 40 enemies fly by in 5 groups of 8, don't shoot, and leave the screen.
  - Every enemy shot down scores 100.
  - Destroying a whole group of 8 gives a group bonus: 1000 in challenges 1–2,
    1500 in 3–4. We use 2000 for 5–6 and 3000 after that (**approximate**).
  - At the end: hits × 100, or 10,000 for a perfect 40/40. **Confirmed.**
  - Group flight patterns are original choreography.
- **Transforms:** from stage 4, once per normal stage, a drone (or an escort if
  no drones remain) flashes and splits into 3 special enemies. They dive and
  leave. They are worth 160 each, plus a bonus for all three: 1000 (type A,
  stages 4–6), 2000 (B, stages 8–10), 3000 (C, stages 12–14), then the cycle
  repeats. **Confirmed** values; the sprites are original designs.
- Stage badges in the HUD: 50, 30, 20, 10, 5, 1 combined to make the stage
  number. **Confirmed** (the badge art is original).

## Screens

- Attract mode cycles through the title (score table), the top 5 and a demo. **Confirmed** structure.
- Game over is followed by a RESULTS screen (shots fired, number of hits,
  hit-miss ratio %) and then 3-letter initials entry for a top-5 score. **Confirmed.**
- "Insert coin" / credits are replaced by press-to-start (free play). **Deviation** (requested).
- Only single-player. **Deviation** (requested; 2-player alternating is not implemented).

## Display

- **Deviation (requested):** the playfield fills the screen at any aspect
  ratio with uniform scaling and no bars, instead of a fixed 224×288 frame. On
  wide screens the field is wider; on tall screens it is taller, and the
  formation moves down by half the extra height.
