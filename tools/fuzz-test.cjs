// Stuck-state fuzzer: plays many seeded games with the autopilot (biased to
// stand still sometimes so tractor beams catch it, and to fire freely so
// rescues happen) and fails if a game ever hangs:
//   - no ship in play for more than MAX_NO_SHIP_SEC (e.g. a respawn deadlock)
//   - a single stage lasting more than MAX_STAGE_SEC
//   - any page error
//
//   node tools/fuzz-test.cjs [seeds=16]

const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const SEEDS = parseInt(process.argv[2] || '16', 10);
const MAX_NO_SHIP_SEC = 20;
const MAX_STAGE_SEC = 180;

const server = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  const file = path.join(ROOT, url === '/' ? 'index.html' : url);
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
  const type = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' }[path.extname(file)] || 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': type });
  fs.createReadStream(file).pipe(res);
});

server.listen(0, '127.0.0.1', async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 500, height: 700 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.waitForFunction(() => !!window.__astr);
  const report = await page.evaluate(async (SEEDS) => {
    const { Session } = await import('./src/game/session.js');
    const { autopilot } = await import('./src/game/autopilot.js');
    const L = window.__astr.L;
    const out = [];
    for (let seed = 1; seed <= SEEDS; seed++) {
      const god = seed % 5 === 0; // some invincible runs to reach later stages
      const s = new Session({ seed, god, layout: L, sfx: {} });
      let noShip = 0, maxNoShip = 0, stageT = 0, maxStageT = 0, lastStage = s.stage, rescues = 0;
      for (let t = 0; t < 60 * 60 * (god ? 10 : 8) && !s.done; t++) {
        const c = autopilot(s);
        if ((t >> 9) % 3 === 0) c.left = c.right = false;
        c.firePressed = c.firePressed || t % 9 === 0;
        s.update(c, L);
        if (s.rescue && s.rescue.t === 1) rescues++;
        noShip = s.player.state === 'alive' || s.phase === 'gameOver' ? 0 : noShip + 1;
        maxNoShip = Math.max(maxNoShip, noShip);
        if (s.stage !== lastStage) { lastStage = s.stage; stageT = 0; } else stageT++;
        maxStageT = Math.max(maxStageT, stageT);
      }
      out.push({ seed, god, stage: s.stage, rescues, maxNoShipSec: maxNoShip / 60, maxStageSec: maxStageT / 60 });
    }
    return out;
  }, SEEDS);
  await browser.close();
  server.close();

  let failed = 0;
  for (const r of report) {
    const bad = r.maxNoShipSec > MAX_NO_SHIP_SEC || r.maxStageSec > MAX_STAGE_SEC;
    if (bad) failed++;
    console.log(`${bad ? 'FAIL' : 'ok  '} seed ${r.seed}${r.god ? ' (god)' : ''}: reached stage ${r.stage}, ` +
      `rescues ${r.rescues}, longest without ship ${r.maxNoShipSec.toFixed(1)}s, longest stage ${r.maxStageSec.toFixed(0)}s`);
  }
  for (const e of errors) console.log('ERROR', e);
  console.log(failed || errors.length ? 'FUZZ FAILED' : `OK - ${report.length} games, no stuck states`);
  process.exit(failed || errors.length ? 1 : 0);
});
