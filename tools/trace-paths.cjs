// Path tuning aid: runs a stage headlessly and draws every enemy's flight
// trail on top of the final frame, so entry / challenge / dive paths can be
// checked by eye after editing src/game/flight.js or src/game/stages.js.
//
//   node tools/trace-paths.cjs <stage> [ticks] [width]x[height] [outDir]
//   e.g. node tools/trace-paths.cjs 1 900 448x576
//
// Writes trace-stage<N>-<w>x<h>.png into outDir (default ./smoke-out).

const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const stage = parseInt(process.argv[2] || '1', 10);
const ticks = parseInt(process.argv[3] || '900', 10);
const [vw, vh] = (process.argv[4] || '448x576').split('x').map(Number);
const OUT = path.resolve(process.argv[5] || path.join(ROOT, 'smoke-out'));

const server = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  const file = path.join(ROOT, url === '/' ? 'index.html' : url);
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
  const type = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' }[path.extname(file)] || 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': type });
  fs.createReadStream(file).pipe(res);
});

server.listen(0, '127.0.0.1', async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: vw, height: vh } });
  page.on('pageerror', (e) => console.error('pageerror', e.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/?god=1&seed=1&stage=${stage}`);
  await page.waitForFunction(() => !!window.__astr);
  await page.evaluate((ticks) => {
    const app = window.__astr;
    app.startGame();
    const s = app.session;
    const trails = new Map();
    // Skip the intro so tick 0 is the first wave.
    while (s.phase !== 'play') s.update({}, app.L);
    for (let i = 0; i < ticks; i++) {
      s.update({}, app.L);
      for (const e of s.enemies) {
        if (e.dead) continue;
        if (!trails.has(e)) trails.set(e, []);
        trails.get(e).push([e.x, e.y]);
      }
    }
    app.draw();
    // Stop the live render loop from painting over the trails.
    app.update = () => {};
    app.draw = () => {};
    const ctx = document.getElementById('screen').getContext('2d');
    const colors = ['#f0f', '#0ff', '#ff0', '#0f0', '#f80', '#88f'];
    let k = 0;
    ctx.lineWidth = 0.6;
    for (const [e, pts] of trails) {
      ctx.strokeStyle = colors[k++ % colors.length];
      ctx.globalAlpha = 0.6;
      ctx.beginPath();
      pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }, ticks);
  const file = path.join(OUT, `trace-stage${stage}-${vw}x${vh}.png`);
  await page.screenshot({ path: file });
  console.log(file);
  await browser.close();
  server.close();
});
