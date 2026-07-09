/* =====================================================================
   CHAOS SHOOTER OMEGA — Authoritative 3D Voxel FPS Server
   The server is the single source of truth:
     - owns the terrain seed (clients rebuild the SAME world from it)
     - owns every player's position/hp/score (validated from client input)
     - runs the shared enemy waves (co-op) + enemy AI
     - resolves ALL damage: enemy->player, player->enemy, player->player (PvP)
   Clients only send intent (movement + shots) and render the synced state.
   ===================================================================== */

const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static("public"));

// ---------------------------------------------------------------------
// WORLD: one shared seed so every client generates an identical terrain.
// Collision height lookups also live here so the server can validate.
// ---------------------------------------------------------------------
const WORLD = 80, MAX_H = 8;
const SEED = Math.floor(Math.random() * 100000);
const heightMap = [];

function hash(x, z) {                        // deterministic, seed-shifted
  let n = Math.sin((x + SEED) * 127.1 + (z + SEED) * 311.7) * 43758.5453;
  return n - Math.floor(n);
}
function smoothNoise(x, z) {
  const xi = Math.floor(x), zi = Math.floor(z);
  const xf = x - xi, zf = z - zi;
  const tl = hash(xi, zi), tr = hash(xi + 1, zi);
  const bl = hash(xi, zi + 1), br = hash(xi + 1, zi + 1);
  const u = xf * xf * (3 - 2 * xf), v = zf * zf * (3 - 2 * zf);
  const top = tl + (tr - tl) * u, bot = bl + (br - bl) * u;
  return top + (bot - top) * v;
}
function terrainHeight(x, z) {
  let h = smoothNoise(x * 0.12, z * 0.12) * 0.6
        + smoothNoise(x * 0.25, z * 0.25) * 0.3
        + smoothNoise(x * 0.5,  z * 0.5)  * 0.1;
  return Math.floor(h * MAX_H) + 1;
}
for (let x = 0; x < WORLD; x++) {
  heightMap[x] = [];
  for (let z = 0; z < WORLD; z++) heightMap[x][z] = terrainHeight(x, z);
}
function groundHeightAt(wx, wz) {
  const gx = Math.round(wx), gz = Math.round(wz);
  if (gx < 0 || gz < 0 || gx >= WORLD || gz >= WORLD) return 0;
  return heightMap[gx][gz] + 0.5;
}

// ---------------------------------------------------------------------
// STATE
// ---------------------------------------------------------------------
const players = {};   // socketId -> {x,y,z,yaw,hp,score,name,color,alive,respawnAt}
const enemies = [];   // shared co-op zombies
let wave = 1, budget = 0, spawnTimer = 0, spawnInterval = 1.6;
let waveActive = false, intermission = 0;
const pickups = [];   // {id,x,y,z,kind,expiresAt} loot dropped by zombies
function waveBudget(w) {
  const n = Object.keys(players).length || 1;
  return 6 + w * 3 + Math.max(0, n - 1) * 3;   // more players -> more zombies
}

const PLAYER_MAX_HP = 100, MAX_SHIELD = 50;

// Server-side weapon truth: damage, fire-rate floor, pellet count, spread, knockback
const WEAPONS = {
  pistol:  { dmg: 2, interval: 350,  pellets: 1, spread: 0.00, knock: 0.5  },
  smg:     { dmg: 1, interval: 110,  pellets: 1, spread: 0.03, knock: 0.25 },
  shotgun: { dmg: 1, interval: 900,  pellets: 6, spread: 0.09, knock: 0.35 },
  rifle:   { dmg: 3, interval: 500,  pellets: 1, spread: 0.00, knock: 0.7  },
  sniper:  { dmg: 8, interval: 1200, pellets: 1, spread: 0.00, knock: 1.2  },
  minigun: { dmg: 1, interval: 60,   pellets: 1, spread: 0.05, knock: 0.2  },
};

// Reward track: what clearing wave N hands to every player
function applyReward(g, clearedWave) {
  const track = { 1: "smg", 2: "shotgun", 3: "rifle", 4: "grenade3", 5: "sniper", 6: "potion2", 7: "minigun" };
  let r = track[clearedWave];
  if (!r) r = clearedWave % 2 === 0 ? "grenade2" : "potion1";
  if (r.startsWith("grenade")) { g.items.grenade += +r.slice(7); return { kind: "item", id: "grenade", n: +r.slice(7) }; }
  if (r.startsWith("potion"))  { g.items.potion  += +r.slice(6); return { kind: "item", id: "potion",  n: +r.slice(6) }; }
  if (!g.weapons.includes(r)) g.weapons.push(r);
  return { kind: "weapon", id: r };
}
function gearForWave(w) {   // late joiners get everything already earned
  const g = { weapons: ["pistol"], items: { grenade: 0, potion: 0 } };
  for (let c = 1; c < w; c++) applyReward(g, c);
  return g;
}
function grantWaveReward(clearedWave) {
  let info = null;
  for (const id in players) info = applyReward(players[id], clearedWave);
  io.emit("reward", { wave: clearedWave, ...(info || {}) });
}

// Shield-aware damage; handles death + scoring in one place
function hurtPlayer(pid, p, amount, by) {
  if (!p.alive || p.invuln) return;
  const absorbed = Math.min(p.shield || 0, amount);
  p.shield = (p.shield || 0) - absorbed;
  p.hp -= (amount - absorbed);
  io.emit("playerHit", { id: pid, by });
  if (p.hp <= 0) {
    p.alive = false;
    p.shield = 0;
    p.respawnAt = Date.now() + RESPAWN_MS;
    io.emit("playerKilled", { id: pid, by });
    if (by && players[by] && by !== pid) players[by].score += 50;
  }
}

const blobs = [];      // spitter acid projectiles
const grenades = [];   // thrown player grenades

function killEnemy(e, by) {
  const i = enemies.indexOf(e);
  if (i === -1 || e._dead) return;
  e._dead = true;
  enemies.splice(i, 1);
  if (by && players[by]) players[by].score += e.pts;
  io.emit("enemyKilled", { id: e.id, by, kind: e.kind });
  if (e.kind === "exploder" && !e._selfDetonated) explode(e.x, e.y + 0.8, e.z, 16, 3.0, by);
  const r = Math.random();
  if (r < 0.34) {
    pickups.push({
      id: Math.random().toString(36).slice(2),
      x: e.x, y: e.y, z: e.z,
      kind: r < 0.17 ? "health" : "ammo",
      expiresAt: Date.now() + 20000,
    });
  }
}

function explode(x, y, z, dmg, radius, by) {
  io.emit("explosion", { x, y, z, radius });
  for (const id in players) {
    const p = players[id];
    if (!p.alive) continue;
    const d = Math.hypot(p.x - x, (p.y + 1) - y, p.z - z);
    if (d < radius) hurtPlayer(id, p, Math.round(dmg * 3 * (1 - d / radius)), by || "zombie");
  }
  for (const e of [...enemies]) {
    const d = Math.hypot(e.x - x, (e.y + 1) - y, e.z - z);
    if (d < radius) {
      e.hp -= dmg * (1 - d / (radius * 1.4));
      e.staggerUntil = Date.now() + 300;
      if (e.hp <= 0) killEnemy(e, by);
    }
  }
}
const RESPAWN_MS = 4000;

function randomSpawn() {
  // Try several spots and keep the one farthest from the nearest zombie,
  // so respawning never drops you inside the horde.
  let best = null, bestScore = -1;
  for (let i = 0; i < 10; i++) {
    const x = 5 + Math.random() * (WORLD - 10);
    const z = 5 + Math.random() * (WORLD - 10);
    let nearest = Infinity;
    for (const e of enemies) nearest = Math.min(nearest, Math.hypot(e.x - x, e.z - z));
    const score = enemies.length ? nearest : 1;
    if (score > bestScore) { bestScore = score; best = { x, z, y: groundHeightAt(x, z) }; }
  }
  return best;
}

function edgeSpawn() {
  let x, z;
  const edge = Math.floor(Math.random() * 4);
  if (edge === 0) { x = 1; z = 1 + Math.random() * (WORLD - 2); }
  else if (edge === 1) { x = WORLD - 2; z = 1 + Math.random() * (WORLD - 2); }
  else if (edge === 2) { z = 1; x = 1 + Math.random() * (WORLD - 2); }
  else { z = WORLD - 2; x = 1 + Math.random() * (WORLD - 2); }
  return { x, z };
}

// One NEW monster unlocks every wave (intro), then keeps appearing, slightly stronger each wave
const KINDS = {
  walker:   { intro: 1, hp: 4,  speed: 1.8,  cap: 4.0, dmg: 8,  pts: 10,  reach: 1.6 },
  runner:   { intro: 2, hp: 2,  speed: 3.6,  cap: 5.2, dmg: 5,  pts: 15,  reach: 1.5 },
  spitter:  { intro: 3, hp: 3,  speed: 1.6,  cap: 2.6, dmg: 10, pts: 20,  reach: 1.4 },
  brute:    { intro: 4, hp: 16, speed: 1.2,  cap: 1.9, dmg: 16, pts: 30,  reach: 1.9 },
  leaper:   { intro: 5, hp: 3,  speed: 2.0,  cap: 3.2, dmg: 12, pts: 25,  reach: 1.5 },
  screamer: { intro: 6, hp: 5,  speed: 1.5,  cap: 2.4, dmg: 4,  pts: 35,  reach: 1.4 },
  exploder: { intro: 7, hp: 2,  speed: 2.8,  cap: 4.4, dmg: 0,  pts: 25,  reach: 1.7 },
  warden:   { intro: 8, hp: 40, speed: 1.35, cap: 1.9, dmg: 22, pts: 100, reach: 2.1 },   // mini-boss, spawned separately
};
function pickKind() {
  const pool = [];
  for (const k in KINDS) {
    if (k === "warden" || KINDS[k].intro > wave) continue;
    const w = KINDS[k].intro === wave ? 3 : 1;   // this wave's debut monster shows up a lot
    for (let i = 0; i < w; i++) pool.push(k);
  }
  return pool[Math.floor(Math.random() * pool.length)] || "walker";
}
function makeEnemyOfKind(kind) {
  const { x, z } = edgeSpawn();
  const base = KINDS[kind];
  const grow = Math.max(0, wave - base.intro);
  const hp = Math.round((base.hp + (kind === "warden" ? wave * 2 : 0)) * (1 + 0.06 * grow));
  return {
    id: Math.random().toString(36).slice(2),
    x, z, y: groundHeightAt(x, z), yaw: 0, kind,
    hp, maxHp: hp,
    speed: Math.min(base.cap, base.speed + 0.05 * grow),
    dmg: base.dmg, pts: base.pts, reach: base.reach,
    attackCd: 0, lungeCd: 0,
  };
}
function makeEnemy() { return makeEnemyOfKind(pickKind()); }

// ---------------------------------------------------------------------
// CONNECTIONS  (event names kept close to the original repo's style)
// ---------------------------------------------------------------------
io.on("connection", (socket) => {
  console.log("Connected:", socket.id);
  const s = randomSpawn();
  players[socket.id] = {
    x: s.x, y: s.y, z: s.z, yaw: 0,
    hp: PLAYER_MAX_HP, shield: 0, score: 0,
    name: "Player", color: "#1e90ff",
    alive: true, respawnAt: 0,
    invulnUntil: Date.now() + 2500, invuln: true,   // brief spawn protection
    ...gearForWave(wave), lastShot: {},             // weapons + items earned so far
  };

  // Send the world seed + current state so the client can build the map
  socket.emit("init", {
    id: socket.id,
    seed: SEED, world: WORLD, maxH: MAX_H,
    players, enemies, wave,
  });

  // Player sends its intended position (server clamps/validates lightly).
  // Authoritative note: we trust movement but re-snap to terrain + bounds,
  // so a client can't fly or leave the map. HP/score are never client-set.
  socket.on("move", (d) => {
    const p = players[socket.id];
    if (!p || !p.alive) return;
    let x = Math.max(0.5, Math.min(WORLD - 1.5, +d.x || 0));
    let z = Math.max(0.5, Math.min(WORLD - 1.5, +d.z || 0));
    let y = +d.y || 0;
    const ground = groundHeightAt(x, z);
    if (y < ground) y = ground;                 // can't sink through terrain
    if (y > ground + 6) y = ground + 6;         // anti-fly clamp
    p.x = x; p.y = y; p.z = z; p.yaw = +d.yaw || 0;
  });

  // Player fires. Client sends ray origin + normalized direction.
  // SERVER resolves the hit against BOTH enemies (co-op) and players (PvP).
  socket.on("shoot", (d) => {
    const shooter = players[socket.id];
    if (!shooter || !shooter.alive) return;
    shooter.invulnUntil = 0;   // firing forfeits spawn protection

    // Validate the weapon: must be owned, must respect its fire rate
    const w = WEAPONS[d.w] ? d.w : "pistol";
    if (!shooter.weapons.includes(w)) return;
    const now = Date.now();
    if (now - (shooter.lastShot[w] || 0) < WEAPONS[w].interval * 0.7) return;
    shooter.lastShot[w] = now;

    const spec = WEAPONS[w];
    const origin = { x: +d.x, y: +d.y, z: +d.z };
    const aim = normalize({ x: +d.dx, y: +d.dy, z: +d.dz });

    for (let pellet = 0; pellet < spec.pellets; pellet++) {
      const dir = spec.spread
        ? normalize({ x: aim.x + (Math.random() - 0.5) * spec.spread * 2,
                      y: aim.y + (Math.random() - 0.5) * spec.spread * 2,
                      z: aim.z + (Math.random() - 0.5) * spec.spread * 2 })
        : aim;

      io.emit("tracer", { x: origin.x, y: origin.y, z: origin.z,
                          dx: dir.x, dy: dir.y, dz: dir.z });

      const RANGE = 110;
      let best = null, bestT = RANGE;
      for (const e of enemies) {
        const t = raySphere(origin, dir, { x: e.x, y: e.y + 1.2, z: e.z }, e.kind === "warden" ? 1.4 : (e.kind === "brute" ? 1.15 : 0.9));
        if (t !== null && t < bestT) { bestT = t; best = { type: "enemy", ref: e }; }
      }
      for (const id in players) {
        if (id === socket.id) continue;
        const tp = players[id];
        if (!tp.alive || tp.invuln) continue;
        const t = raySphere(origin, dir, { x: tp.x, y: tp.y + 1.2, z: tp.z }, 0.8);
        if (t !== null && t < bestT) { bestT = t; best = { type: "player", id, ref: tp }; }
      }
      if (!best) continue;

      if (best.type === "enemy") {
        const e = best.ref;
        e.hp -= spec.dmg;
        e.x = Math.max(1, Math.min(WORLD - 2, e.x + dir.x * spec.knock));
        e.z = Math.max(1, Math.min(WORLD - 2, e.z + dir.z * spec.knock));
        e.y = groundHeightAt(e.x, e.z);
        e.staggerUntil = now + 250;
        io.emit("enemyHit", { id: e.id, by: socket.id });
        if (e.hp <= 0) killEnemy(e, socket.id);
      } else {
        hurtPlayer(best.id, best.ref, spec.dmg * 10, socket.id);   // PvP: 10x scale vs 100 HP pool
      }
    }
  });

  // Fortnite-style items: grenades (thrown, simulated server-side) + shield potions
  socket.on("grenade", (d) => {
    const p = players[socket.id];
    if (!p || !p.alive || p.items.grenade <= 0) return;
    p.items.grenade--;
    p.invulnUntil = 0;
    const dir = normalize({ x: +d.dx, y: +d.dy, z: +d.dz });
    grenades.push({
      id: Math.random().toString(36).slice(2),
      x: +d.x, y: +d.y, z: +d.z,
      vx: dir.x * 14, vy: dir.y * 14 + 3.5, vz: dir.z * 14,
      by: socket.id, fuse: 1.5,
    });
  });
  socket.on("potion", () => {
    const p = players[socket.id];
    if (!p || !p.alive || p.items.potion <= 0) return;
    p.items.potion--;
    p.shield = MAX_SHIELD;
    io.emit("drank", { id: socket.id });
  });

  socket.on("setName", (name) => {
    const p = players[socket.id]; if (!p) return;
    p.name = String(name).trim().substring(0, 16) || "Player";
  });
  socket.on("setColor", (color) => {
    const p = players[socket.id]; if (!p) return;
    if (typeof color === "string" && /^#[0-9a-fA-F]{6}$/.test(color)) p.color = color;
  });

  socket.on("disconnect", () => {
    delete players[socket.id];
    io.emit("removePlayer", socket.id);
    console.log("Disconnected:", socket.id);
  });
});

// ---------------------------------------------------------------------
// MATH HELPERS (server-side raycast for authoritative hit detection)
// ---------------------------------------------------------------------
function normalize(v) {
  const m = Math.hypot(v.x, v.y, v.z) || 1;
  return { x: v.x / m, y: v.y / m, z: v.z / m };
}
// Returns distance t along ray to sphere surface, or null if no hit.
function raySphere(o, d, c, r) {
  const ox = o.x - c.x, oy = o.y - c.y, oz = o.z - c.z;
  const b = ox * d.x + oy * d.y + oz * d.z;
  const cc = ox * ox + oy * oy + oz * oz - r * r;
  const disc = b * b - cc;
  if (disc < 0) return null;
  const t = -b - Math.sqrt(disc);
  return t >= 0 ? t : null;
}

// ---------------------------------------------------------------------
// AUTHORITATIVE GAME LOOP @ 30 Hz  (enemy AI, waves, respawns, broadcast)
// ---------------------------------------------------------------------
const TICK = 1000 / 30, dt = 1 / 30;
setInterval(() => {
  // --- Respawns ---
  const now = Date.now();
  for (const id in players) {
    const p = players[id];
    if (!p.alive && now >= p.respawnAt) {
      const s = randomSpawn();
      p.x = s.x; p.y = s.y; p.z = s.z; p.hp = PLAYER_MAX_HP; p.alive = true;
      p.invulnUntil = now + 2500;   // spawn protection
    }
  }

  // --- Invulnerability flags (computed once per tick) ---
  for (const id in players) { const p = players[id]; p.invuln = p.alive && now < p.invulnUntil; }

  // --- Waves: spawn a fixed budget, wait for the clear, breathe, repeat ---
  const alivePlayers = Object.values(players).filter(p => p.alive).length;
  if (alivePlayers === 0) {
    // Full wipe: clear the horde so respawners restart this wave fresh
    if (enemies.length || waveActive) { enemies.length = 0; waveActive = false; intermission = 0; }
  } else if (intermission > 0) {
    intermission -= dt;
    if (intermission <= 0) {
      intermission = 0; wave++; waveActive = true;
      budget = waveBudget(wave);
      spawnInterval = Math.max(0.45, 1.6 - wave * 0.06);
      spawnTimer = spawnInterval;   // first zombie shows up promptly
      for (let k = 0; k < (wave >= 8 ? 1 + Math.floor((wave - 8) / 4) : 0); k++)
        enemies.push(makeEnemyOfKind("warden"));   // mini-boss escort from wave 8
    }
  } else if (!waveActive) {
    waveActive = true; budget = waveBudget(wave); spawnTimer = spawnInterval;
  } else {
    spawnTimer += dt;
    const cap = Math.min(24, 10 + Math.floor(wave / 2)) + Object.keys(players).length * 2;   // on screen at once
    if (budget > 0 && spawnTimer > spawnInterval && enemies.length < cap) {
      spawnTimer = 0; budget--;
      enemies.push(makeEnemy());
    }
    if (budget === 0 && enemies.length === 0) {
      intermission = 6;   // wave cleared!
      grantWaveReward(wave);
    }
  }

  // --- Enemy AI: every kind fights differently ---
  const screamers = enemies.filter(e => e.kind === "screamer");
  for (const e of [...enemies]) {          // copy: exploders remove themselves mid-loop
    let target = null, targetId = null, best = Infinity;
    for (const id in players) {
      const p = players[id];
      if (!p.alive) continue;
      const dist = Math.hypot(p.x - e.x, p.z - e.z);
      if (dist < best) { best = dist; target = p; targetId = id; }
    }
    if (!target) continue;
    const staggered = e.staggerUntil && now < e.staggerUntil;
    const dx = target.x - e.x, dz = target.z - e.z;
    const dist = Math.hypot(dx, dz) || 1;
    e.yaw = Math.atan2(dx, dz);
    e.attackCd -= dt;
    e.lungeCd -= dt;

    // Screamer aura: nearby monsters move 40% faster
    let spd = e.speed;
    for (const s of screamers) {
      if (s !== e && Math.hypot(s.x - e.x, s.z - e.z) < 6) { spd *= 1.4; break; }
    }

    if (e.kind === "spitter") {
      // Ranged: advance to 9 units, retreat inside 5, spit acid within 13
      if (!staggered) {
        if (dist > 9)      { e.x += (dx / dist) * spd * dt; e.z += (dz / dist) * spd * dt; }
        else if (dist < 5) { e.x -= (dx / dist) * spd * 0.8 * dt; e.z -= (dz / dist) * spd * 0.8 * dt; }
        e.x = Math.max(1, Math.min(WORLD - 2, e.x));
        e.z = Math.max(1, Math.min(WORLD - 2, e.z));
        e.y = groundHeightAt(e.x, e.z);
      }
      if (dist < 13 && e.attackCd <= 0 && !target.invuln) {
        e.attackCd = 2.4;
        io.emit("enemyAttack", { id: e.id });
        const sy = e.y + 1.4, ty = target.y + 1.2;
        const d3 = Math.hypot(dx, ty - sy, dz) || 1;
        blobs.push({
          id: Math.random().toString(36).slice(2),
          x: e.x, y: sy, z: e.z,
          vx: dx / d3 * 10, vy: (ty - sy) / d3 * 10 + 0.6 * d3, vz: dz / d3 * 10,   // +0.6*d3 = exact gravity comp for 12 u/s^2 over d3/10 s
          dmg: e.dmg, ttl: 2.5,
        });
      }
      continue;
    }

    if (e.kind === "exploder" && dist < (e.reach || 1.7)) {
      e._selfDetonated = true;
      explode(e.x, e.y + 0.8, e.z, 16, 3.0, null);
      killEnemy(e, null);
      continue;
    }

    if (e.kind === "leaper" && !staggered && e.lungeCd <= 0 && dist > 4 && dist < 9) {
      e.lungeUntil = now + 450;   // pounce!
      e.lungeCd = 3;
      io.emit("enemyAttack", { id: e.id });
    }
    if (e.kind === "leaper" && now < (e.lungeUntil || 0)) spd = 7.5;

    if (dist > 1.2 && !staggered) {
      e.x += (dx / dist) * spd * dt;
      e.z += (dz / dist) * spd * dt;
      e.y = groundHeightAt(e.x, e.z);
    }
    if (dist < (e.reach || 1.6) && e.attackCd <= 0 && !staggered && !target.invuln) {
      e.attackCd = 1.0;
      io.emit("enemyAttack", { id: e.id });
      hurtPlayer(targetId, target, e.dmg || 8, "zombie");
    }
  }

  // --- Acid blobs (spitter projectiles) ---
  for (let i = blobs.length - 1; i >= 0; i--) {
    const b = blobs[i];
    b.ttl -= dt;
    b.vy -= 12 * dt;
    b.x += b.vx * dt; b.y += b.vy * dt; b.z += b.vz * dt;
    let gone = b.ttl <= 0 || b.y <= groundHeightAt(b.x, b.z) + 0.1;
    if (!gone) for (const id in players) {
      const p = players[id];
      if (!p.alive) continue;
      if (Math.hypot(p.x - b.x, (p.y + 1.2) - b.y, p.z - b.z) < 0.8) {
        hurtPlayer(id, p, b.dmg, "zombie");
        gone = true; break;
      }
    }
    if (gone) blobs.splice(i, 1);
  }

  // --- Grenades (player throwables): arc, then boom ---
  for (let i = grenades.length - 1; i >= 0; i--) {
    const g = grenades[i];
    g.fuse -= dt;
    g.vy -= 22 * dt;
    g.x += g.vx * dt; g.y += g.vy * dt; g.z += g.vz * dt;
    const ground = groundHeightAt(g.x, g.z);
    if (g.fuse <= 0 || g.y <= ground + 0.15) {
      grenades.splice(i, 1);
      explode(g.x, Math.max(g.y, ground + 0.3), g.z, 14, 3.5, g.by);
    }
  }

  // --- Pickups: collect on touch, expire after 20s ---
  for (let i = pickups.length - 1; i >= 0; i--) {
    const pk = pickups[i];
    if (now > pk.expiresAt) { pickups.splice(i, 1); continue; }
    for (const id in players) {
      const p = players[id];
      if (!p.alive) continue;
      if (Math.hypot(p.x - pk.x, p.z - pk.z) < 1.2 && Math.abs(p.y - pk.y) < 2) {
        if (pk.kind === "health") p.hp = Math.min(PLAYER_MAX_HP, p.hp + 30);
        io.emit("pickup", { id: pk.id, by: id, kind: pk.kind });
        pickups.splice(i, 1);
        break;
      }
    }
  }

  // --- Separation: zombies shove each other apart instead of stacking ---
  for (let i = 0; i < enemies.length; i++) {
    for (let j = i + 1; j < enemies.length; j++) {
      const a = enemies[i], b = enemies[j];
      const sx = b.x - a.x, sz = b.z - a.z;
      const d = Math.hypot(sx, sz);
      if (d > 0.001 && d < 1.1) {
        const push = (1.1 - d) * 0.5, ux = sx / d, uz = sz / d;
        a.x = Math.max(1, Math.min(WORLD - 2, a.x - ux * push));
        a.z = Math.max(1, Math.min(WORLD - 2, a.z - uz * push));
        b.x = Math.max(1, Math.min(WORLD - 2, b.x + ux * push));
        b.z = Math.max(1, Math.min(WORLD - 2, b.z + uz * push));
        a.y = groundHeightAt(a.x, a.z); b.y = groundHeightAt(b.x, b.z);
      }
    }
  }

  // --- Separation: zombies shove each other apart instead of stacking ---
  for (let i = 0; i < enemies.length; i++) {
    for (let j = i + 1; j < enemies.length; j++) {
      const a = enemies[i], b = enemies[j];
      const sx = b.x - a.x, sz = b.z - a.z;
      const d = Math.hypot(sx, sz);
      if (d > 0.001 && d < 1.1) {
        const push = (1.1 - d) * 0.5, ux = sx / d, uz = sz / d;
        a.x = Math.max(1, Math.min(WORLD - 2, a.x - ux * push));
        a.z = Math.max(1, Math.min(WORLD - 2, a.z - uz * push));
        b.x = Math.max(1, Math.min(WORLD - 2, b.x + ux * push));
        b.z = Math.max(1, Math.min(WORLD - 2, b.z + uz * push));
        a.y = groundHeightAt(a.x, a.z); b.y = groundHeightAt(b.x, b.z);
      }
    }
  }

  // --- Broadcast the authoritative snapshot ---
  io.emit("sync", {
    players, enemies, wave, pickups, blobs, grenades,
    left: enemies.length + budget,          // zombies remaining this wave
    intermission: Math.ceil(intermission),  // seconds until next wave (0 = fighting)
  });
}, TICK);

// ---------------------------------------------------------------------
// START (Render provides PORT)
// ---------------------------------------------------------------------
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT} (seed ${SEED})`));
