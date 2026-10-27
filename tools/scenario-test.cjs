// Rule tests: drives the real game modules in headless Chromium through
// specific situations (capture, rescue, dual fighter, transforms, challenge
// bonus, extra lives, game over -> initials entry, touch drag) and asserts
// on the outcome.
//
//   node tools/scenario-test.cjs
//
// Exits non-zero on the first failed assertion or any page error.

const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const server = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  const file = path.join(ROOT, url === '/' ? 'index.html' : url);
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
  const type = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' }[path.extname(file)] || 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': type });
  fs.createReadStream(file).pipe(res);
});

// Runs inside the page. Every scenario returns a list of [ok, message].
async function scenarios() {
  const { Session } = await import('./src/game/session.js');
  const { DIVES } = await import('./src/game/flight.js');
  const { input } = await import('./src/input.js');
  const app = window.__astr;
  const L = () => app.L;
  const results = [];
  const check = (ok, msg) => results.push([!!ok, msg]);
  const idle = { left: false, right: false, fireHeld: false, firePressed: false, touchActive: false, dragDX: 0, rapid: false };
  const run = (s, n, c = idle, until) => { for (let i = 0; i < n; i++) { s.update(c, L()); if (until && until()) return true; } return false; };
  const toFormation = (s) => run(s, 4000, idle, () => s.phase === 'play' && s.formationComplete() && s.living.every((e) => e.mode === 'formation'));
  const newSession = (opts = {}) => new Session({ seed: 5, layout: L(), sfx: {}, ...opts });
  // Keep attacks from interfering with a scripted scenario.
  const calm = (s) => { s.updateAttacks = () => {}; s.enemyFire = () => {}; };

  // --- Capture, rescue, dual fighter -------------------------------------
  {
    const s = newSession();
    calm(s);
    check(toFormation(s), 'stage 1 formation completes');
    const boss = s.living.find((e) => e.type === 'commander');
    s.player.x = L().cx;
    s.dive(boss, DIVES.beam, s.player.x);
    const reserve0 = s.reserve;
    check(run(s, 2000, idle, () => s.capture), 'tractor beam captures the ship');
    check(run(s, 2000, idle, () => boss.captive), 'captured fighter attaches to commander');
    check(run(s, 3000, idle, () => s.player.state === 'alive'), 'next ship arrives after capture');
    check(s.reserve === reserve0 - 1, `reserve used for next ship (${reserve0} -> ${s.reserve})`);
    check(run(s, 2000, idle, () => boss.mode === 'formation'), 'commander returns home with captive');
    s.dive(boss, DIVES.commander);
    run(s, 600, idle, () => boss.y > L().formationTop + 60);
    const scoreBefore = s.score;
    s.hitEnemy(boss); s.hitEnemy(boss);
    check(s.score - scoreBefore === 400, `diving commander alone worth 400 (got ${s.score - scoreBefore})`);
    check(s.rescue, 'killing diving host starts a rescue');
    check(run(s, 1000, idle, () => !s.rescue), 'rescued fighter docks');
    check(s.player.dual, 'player now has a dual fighter');
    s.playerShots.length = 0;
    s.fire();
    check(s.playerShots.length === 2, 'dual fighter fires two shots');
    s.fire();
    check(s.playerShots.length === 4 && !s.fire(), 'dual fighter capped at 4 shots on screen');
    s.hitPlayer({ x: s.player.x + 16, side: 1 });
    check(!s.player.dual && s.player.state === 'alive', 'losing one half of the dual fighter keeps the other');
  }

  // Sets up: ship captured, next ship in play, commander diving with the captive.
  const divingHost = () => {
    const s = newSession();
    calm(s);
    toFormation(s);
    const boss = s.living.find((e) => e.type === 'commander');
    s.player.x = L().cx;
    s.dive(boss, DIVES.beam, s.player.x);
    run(s, 6000, idle, () => boss.captive && boss.mode === 'formation' && s.player.state === 'alive');
    s.dive(boss, DIVES.commander);
    run(s, 600, idle, () => boss.y > L().formationTop + 60);
    return { s, boss };
  };

  // --- Regression: enemy fire during a rescue must not kill the docking ship or freeze the game
  {
    const { s, boss } = divingHost();
    s.enemyShots.push({ x: s.player.x, y: L().playerY - 30, vx: 0, vy: 3 }); // already on its way
    s.hitEnemy(boss); s.hitEnemy(boss);
    check(s.rescue, 'rescue starts with an enemy shot incoming');
    check(run(s, 1500, idle, () => !s.rescue), 'rescue completes with an enemy shot incoming');
    check(s.player.state === 'alive' && s.player.dual, `docking ship is not shot while frozen (state ${s.player.state}, dual ${s.player.dual})`);
    const before = s.living.map((e) => e.x + e.y).join();
    run(s, 120);
    check(s.living.map((e) => e.x + e.y).join() !== before, 'game keeps running after the rescue');
  }

  // --- Regression: freeing the fighter right after losing the last ship gives that fighter back
  {
    const { s, boss } = divingHost();
    s.reserve = 0;
    s.hitPlayer({ x: s.player.x, side: 0 });        // last ship destroyed...
    s.hitEnemy(boss); s.hitEnemy(boss);             // ...and its shot still kills the host
    check(s.rescue, 'host killed just after the player died still frees the fighter');
    check(run(s, 1500, idle, () => !s.rescue), 'freed fighter arrives');
    check(s.player.state === 'alive' && !s.player.dual && s.reserve === 0, `freed fighter becomes the player's ship (state ${s.player.state})`);
    run(s, 600);
    check(s.phase !== 'gameOver' && s.player.state === 'alive', `no game over after getting the fighter back (phase ${s.phase})`);
  }

  // --- Host destroyed in formation: captive turns hostile, returns next stage
  {
    const s = newSession();
    calm(s);
    toFormation(s);
    const boss = s.living.find((e) => e.type === 'commander');
    s.player.x = L().cx;
    s.dive(boss, DIVES.beam, s.player.x);
    run(s, 4000, idle, () => boss.captive && boss.mode === 'formation' && s.player.state === 'alive');
    const cap = boss.captive;
    s.hitEnemy(boss); s.hitEnemy(boss);
    check(cap && cap.mode === 'dive', 'captive turns hostile when host dies in formation');
    const ships = s.playerShips;
    s.playerShips = () => []; // let it fly past instead of ramming the player
    run(s, 2000, idle, () => cap.dead);
    s.playerShips = ships;
    check(cap.escaped && s.pendingCaptive, 'hostile captive that escapes is carried to a later stage');
    for (const e of s.enemies) e.dead = true;
    check(run(s, 400, idle, () => s.stage === 2), 'stage clears when all enemies are gone');
    run(s, 2000, idle, () => s.enemies.some((e) => e.type === 'captive'));
    check(s.enemies.some((e) => e.type === 'captive' && e.host && e.host.type === 'commander'), 'captive returns attached to a commander');
  }

  // --- Commander escorts scoring ------------------------------------------
  {
    const s = newSession();
    calm(s);
    toFormation(s);
    const boss = s.living.find((e) => e.type === 'commander' && s.living.some((x) => x.type === 'escort' && x.row === 1 && Math.abs(x.col - e.col) <= 1));
    s.commanderAttack = s.commanderAttack.bind(s);
    s.rng = () => 0.9; // force escort dive (no beam)
    s.commanderAttack(boss, s.living.filter((e) => e.type === 'escort' && e.mode === 'formation'));
    check(boss.escortCount === 2, `commander dives with 2 escorts (${boss.escortCount})`);
    run(s, 60);
    const sc = s.score;
    s.hitEnemy(boss); s.hitEnemy(boss);
    check(s.score - sc === 1600, `commander with 2 escorts worth 1600 (got ${s.score - sc})`);
  }

  // --- Transform on stage 4 ------------------------------------------------
  {
    const s = newSession({ stage: 4, god: true });
    s.enemyFire = () => {};
    const found = run(s, 6000, idle, () => s.enemies.some((e) => !e.dead && e.type === 'transformA'));
    check(found, 'stage 4 drone transforms into three special enemies');
    check(s.enemies.filter((e) => !e.dead && e.type === 'transformA').length === 3, 'transform spawns exactly 3');
  }

  // --- Perfect challenging stage -------------------------------------------
  {
    const s = newSession({ stage: 3, god: true });
    let shot = 0;
    run(s, 6000, idle, () => {
      for (const e of s.enemies) if (!e.dead && e.mode === 'cs' && e.y > 10 && e.y < L().h - 10 && e.x > 0 && e.x < L().w) { while (!e.dead) { s.hitEnemy(e); shot++; } }
      return s.phase === 'csResults' && s.phaseT > 80;
    });
    // 40 x 100 per hit + 5 group bonuses x 1000 + 10000 perfect
    check(s.csHits === 40, `all 40 challenge enemies hit (${s.csHits})`);
    check(s.score === 40 * 100 + 5 * 1000 + 10000, `perfect challenge score (got ${s.score})`);
    run(s, 400, idle, () => s.stage === 4);
    check(s.stage === 4, 'game continues to stage 4 after the challenge');
  }

  // --- Extra lives -------------------------------------------------------------
  {
    const s = newSession();
    const r = s.reserve;
    s.addScore(20000);
    check(s.reserve === r + 1, 'extra ship at 20000');
    s.addScore(50000);
    check(s.reserve === r + 2, 'extra ship at 70000');
    s.addScore(70000);
    check(s.reserve === r + 3, 'extra ship every 70000 after that');
  }

  // --- Game over -> results -> initials entry -> high score table ---------------
  {
    app.startGame();
    const s = app.session;
    run(s, 400);
    s.score = 99999;
    s.reserve = 0;
    s.hitPlayer({ x: s.player.x, side: 0 });
    let guard = 0;
    while (app.state !== 'entry' && guard++ < 3000) { app.update(); input.endTick(); }
    check(app.state === 'entry', `game over leads to initials entry (state ${app.state})`);
    for (const code of ['KeyX', 'KeyY', 'KeyZ']) { input.pressed.add(code); app.update(); input.endTick(); }
    const { highScores } = await import('./src/store.js');
    check(highScores.list[0].score === 99999 && highScores.list[0].name === 'XYZ', `high score saved (${JSON.stringify(highScores.list[0])})`);
  }

  // --- Touch drag steers the ship -------------------------------------------------
  {
    app.startGame();
    const s = app.session;
    for (let i = 0; i < 600 && s.player.state !== 'alive'; i++) { app.update(); input.endTick(); }
    const canvas = document.getElementById('screen');
    const x0 = s.player.x;
    const ev = (type, x, target = window) => target.dispatchEvent(new PointerEvent(type, { pointerId: 7, pointerType: 'touch', clientX: x, clientY: 300, bubbles: true }));
    ev('pointerdown', 200, canvas);
    for (let i = 1; i <= 30; i++) { ev('pointermove', 200 - i * 4); app.update(); input.endTick(); }
    for (let i = 0; i < 30; i++) { app.update(); input.endTick(); }
    check(s.player.x < x0 - 20, `dragging left moves the ship left (${x0.toFixed(1)} -> ${s.player.x.toFixed(1)})`);
    check(s.shotsFired > 0, 'touching the screen auto-fires');
    ev('pointerup', 80);
    // Second finger pauses.
    ev('pointerdown', 200, canvas);
    canvas.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 8, pointerType: 'touch', clientX: 300, clientY: 300, bubbles: true }));
    app.update(); input.endTick();
    check(app.state === 'pause', 'second finger pauses the game');
  }
  return results;
}

server.listen(0, '127.0.0.1', async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 420, height: 860 }, hasTouch: true });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.waitForFunction(() => !!window.__astr);
  let results = [];
  try {
    results = await page.evaluate(scenarios);
  } catch (e) {
    errors.push(e.message);
  }
  await browser.close();
  server.close();
  let failed = 0;
  for (const [ok, msg] of results) {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`);
    if (!ok) failed++;
  }
  for (const e of errors) console.log('ERROR ', e);
  console.log(`${results.length - failed}/${results.length} passed`);
  process.exit(failed || errors.length ? 1 : 0);
});
