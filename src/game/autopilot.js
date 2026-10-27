// Simple AI that plays the attract-mode demo. Produces the same `controls`
// object a human would, so the Session cannot tell the difference.

export function autopilot(session) {
  const L = session.L;
  const p = session.player;
  const c = { left: false, right: false, fireHeld: false, firePressed: false, touchActive: false, dragDX: 0, rapid: false };
  if (p.state !== 'alive') return c;

  // 1) Dodge: predict where each nearby enemy shot will cross the ship's row.
  let danger = null;
  for (const b of session.enemyShots) {
    const dy = L.playerY - b.y;
    if (dy < 0 || dy > 90) continue;
    const xAt = b.x + (b.vx * dy) / b.vy;
    if (Math.abs(xAt - p.x) < 14) danger = xAt;
  }
  // 2) Otherwise line up under the lowest attacker, or the nearest enemy.
  let target = null;
  if (danger === null) {
    let best = null;
    for (const e of session.enemies) {
      if (e.dead || e.y > L.playerY - 20) continue;
      const score = (e.mode === 'formation' ? 0 : 1000) + e.y - Math.abs(e.x - p.x) * 0.5;
      if (!best || score > best.score) best = { score, x: e.x };
    }
    target = best ? best.x : L.cx;
  } else {
    target = p.x + (p.x >= danger ? 30 : -30);
    if (target < L.left + 12 || target > L.right - 12) target = p.x + (p.x >= danger ? -30 : 30);
  }
  if (target < p.x - 2) c.left = true;
  else if (target > p.x + 2) c.right = true;

  const aligned = Math.abs(target - p.x) < 10;
  c.firePressed = aligned && session.t % 10 === 0;
  return c;
}
