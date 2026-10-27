// Headless smoke test: serves the repo, loads the game at several screen
// sizes, fast-forwards the simulation and fails on any console error.
//
//   node tools/smoke-test.cjs [outDir]
//
// Needs Playwright + Chromium available to `require('playwright')`.
// Screenshots are written to outDir (default: ./smoke-out, git-ignored).

const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.resolve(process.argv[2] || path.join(ROOT, 'smoke-out'));
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json' };

function serve() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const url = decodeURIComponent(req.url.split('?')[0]);
      const file = path.join(ROOT, url === '/' ? 'index.html' : url);
      if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
        res.writeHead(404); res.end(); return;
      }
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
      fs.createReadStream(file).pipe(res);
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

const VIEWPORTS = [
  { name: 'desktop-1080p', width: 1920, height: 1080, touch: false },
  { name: 'phone-portrait', width: 390, height: 844, touch: true, dpr: 3 },
  { name: 'phone-landscape', width: 844, height: 390, touch: true, dpr: 3 },
  { name: 'tablet', width: 1024, height: 768, touch: true, dpr: 2 },
];

// Run n simulation ticks synchronously inside the page.
const ff = (page, n) => page.evaluate((n) => { for (let i = 0; i < n; i++) window.__astr.update(); window.__astr.draw(); }, n);

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const server = await serve();
  const base = `http://127.0.0.1:${server.address().port}/`;
  const browser = await chromium.launch();
  const errors = [];
  try {
    for (const vp of VIEWPORTS) {
      const ctx = await browser.newContext({
        viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: vp.dpr || 1,
        hasTouch: vp.touch, isMobile: vp.touch,
      });
      const page = await ctx.newPage();
      page.on('console', (m) => { if (m.type() === 'error') errors.push(`[${vp.name}] ${m.text()}`); });
      page.on('pageerror', (e) => errors.push(`[${vp.name}] ${e.message}`));
      await page.goto(base + '?seed=7&god=1');
      await page.waitForFunction(() => !!window.__astr);
      await ff(page, 5);
      await page.screenshot({ path: path.join(OUT, `${vp.name}-title.png`) });

      // Start a game and play for a while (god mode so it keeps going).
      await page.evaluate(() => window.__astr.startGame());
      await ff(page, 60 * 9);
      await page.screenshot({ path: path.join(OUT, `${vp.name}-entry.png`) });
      await ff(page, 60 * 14);
      await page.screenshot({ path: path.join(OUT, `${vp.name}-play.png`) });
      const state = await page.evaluate(() => {
        const s = window.__astr.session;
        return { phase: s.phase, stage: s.stage, enemies: s.enemies.filter((e) => !e.dead).length, score: s.score };
      });
      console.log(vp.name, JSON.stringify(state));
      await ctx.close();
    }

    // Long soak at the default size: run several stages with an autopilot.
    const ctx = await browser.newContext({ viewport: { width: 900, height: 1000 } });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(`[soak] ${e.message}`));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(`[soak] ${m.text()}`); });
    await page.goto(base + '?seed=3');
    await page.waitForFunction(() => !!window.__astr);
    const soak = await page.evaluate(async () => {
      const { autopilot } = await import('./src/game/autopilot.js');
      const app = window.__astr;
      app.startGame();
      const s = app.session;
      const seen = new Set();
      for (let i = 0; i < 60 * 60 * 6 && !s.done; i++) {
        s.update(autopilot(s), app.L);
        seen.add(`${s.stage}:${s.phase}`);
      }
      return { stage: s.stage, phase: s.phase, score: s.score, done: s.done, seen: [...seen].join(' ') };
    });
    console.log('soak', JSON.stringify(soak));
    await ctx.close();
  } finally {
    await browser.close();
    server.close();
  }
  if (errors.length) {
    console.error('ERRORS:\n' + errors.join('\n'));
    process.exit(1);
  }
  console.log('OK - screenshots in', OUT);
})();
