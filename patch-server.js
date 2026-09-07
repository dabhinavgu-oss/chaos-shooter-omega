/* Runtime patch for the existing server. npm runs this before server.js on Render.
   It restores the grenade socket handler/projectile simulation without rewriting the
   large authoritative server file in git. The patch is idempotent. */
const fs = require('fs');
const path = require('path');
const file = path.join(__dirname, 'server.js');
let s = fs.readFileSync(file, 'utf8');

if (!s.includes('CSO_GRENADE_PATCH_V1')) {
  const handler = `\n  // CSO_GRENADE_PATCH_V1\n  socket.on("grenade", (d) => {\n    const p = players[socket.id];\n    if (!p || !p.alive) return;\n    const dir = normalize({ x:+d.dx, y:+d.dy, z:+d.dz });\n    grenades.push({\n      id: Math.random().toString(36).slice(2),\n      x: +d.x || p.x, y: +d.y || p.y + 1, z: +d.z || p.z,\n      vx: dir.x * 11, vy: dir.y * 11 + 3.5, vz: dir.z * 11,\n      owner: socket.id, age: 0,\n    });\n  });\n`;
  s = s.replace('  socket.on("setName", (name) => {', handler + '\n  socket.on("setName", (name) => {');

  const tick = `\n  // CSO_GRENADE_TICK_V1\n  for (let i = grenades.length - 1; i >= 0; i--) {\n    const g = grenades[i];\n    g.age += dt;\n    g.vy -= 18 * dt;\n    g.x += g.vx * dt; g.y += g.vy * dt; g.z += g.vz * dt;\n    const ground = groundHeightAt(g.x, g.z);\n    if (g.y < ground + 0.18) { g.y = ground + 0.18; g.vy *= -0.38; g.vx *= 0.72; g.vz *= 0.72; }\n    const explode = g.age >= 1.35;\n    if (!explode) continue;\n    const radius = 5.2;\n    for (const e of [...enemies]) {\n      const dist = Math.hypot(e.x-g.x, e.z-g.z);\n      if (dist <= radius && Math.abs(e.y-g.y) < 4) {\n        const damage = Math.max(6, Math.round(75 * (1 - dist/radius)));\n        e.hp -= damage;\n        e.staggerUntil = now + 450;\n        if (e.hp <= 0) killEnemy(e, g.owner);\n        else io.emit("enemyHit", { id:e.id, by:g.owner });\n      }\n    }\n    io.emit("explosion", { x:g.x, y:g.y, z:g.z, radius, by:g.owner });\n    grenades.splice(i, 1);\n  }\n`;
  s = s.replace('  // Pickups (revive items and health)', tick + '\n  // Pickups (revive items and health)');

  s = s.replace('players, enemies, wave, pickups, reviveCards,', 'players, enemies, wave, pickups, reviveCards, grenades,');
  fs.writeFileSync(file, s);
}

// Make the first zombie visible immediately after a client connects.
// The normal 30Hz loop still controls all subsequent spawning.
if (!s.includes('CSO_START_ZOMBIE_V1')) {
  s = s.replace(
    '  socket.emit("init", {',
    '  // CSO_START_ZOMBIE_V1\n  if (enemies.length === 0) enemies.push(makeEnemy());\n\n  socket.emit("init", {'
  );
  fs.writeFileSync(file, s);
}
