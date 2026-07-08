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
const WORLD = 50, MAX_H = 8;
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
let wave = 1, spawnTimer = 0, waveTimer = 0, spawnInterval = 2.5;

const PLAYER_MAX_HP = 100;
const RESPAWN_MS = 4000;

function randomSpawn() {
  const x = 5 + Math.random() * (WORLD - 10);
  const z = 5 + Math.random() * (WORLD - 10);
  return { x, z, y: groundHeightAt(x, z) };
}

function makeEnemy() {
  const edge = Math.floor(Math.random() * 4);
  let x, z;
  if (edge === 0) { x = 1; z = 1 + Math.random() * (WORLD - 2); }
  else if (edge === 1) { x = WORLD - 2; z = 1 + Math.random() * (WORLD - 2); }
  else if (edge === 2) { z = 1; x = 1 + Math.random() * (WORLD - 2); }
  else { z = WORLD - 2; x = 1 + Math.random() * (WORLD - 2); }
  return {
    id: Math.random().toString(36).slice(2),
    x, y: groundHeightAt(x, z), z,
    hp: 3 + Math.floor(wave / 3),
    speed: 1.8 + wave * 0.12,
    attackCd: 0,
  };
}

// ---------------------------------------------------------------------
// CONNECTIONS  (event names kept close to the original repo's style)
// ---------------------------------------------------------------------
io.on("connection", (socket) => {
  console.log("Connected:", socket.id);
  const s = randomSpawn();
  players[socket.id] = {
    x: s.x, y: s.y, z: s.z, yaw: 0,
    hp: PLAYER_MAX_HP, score: 0,
    name: "Player", color: "#1e90ff",
    alive: true, respawnAt: 0,
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
    const origin = { x: +d.x, y: +d.y, z: +d.z };
    const dir = normalize({ x: +d.dx, y: +d.dy, z: +d.dz });

    io.emit("tracer", { x: origin.x, y: origin.y, z: origin.z,
                        dx: dir.x, dy: dir.y, dz: dir.z });

    const RANGE = 80;
    let best = null, bestT = RANGE;

    // Enemy hits (co-op)
    for (const e of enemies) {
      const t = raySphere(origin, dir, { x: e.x, y: e.y + 1.2, z: e.z }, 0.9);
      if (t !== null && t < bestT) { bestT = t; best = { type: "enemy", ref: e }; }
    }
    // Player hits (PvP) — skip self
    for (const id in players) {
      if (id === socket.id) continue;
      const tp = players[id];
      if (!tp.alive) continue;
      const t = raySphere(origin, dir, { x: tp.x, y: tp.y + 1.2, z: tp.z }, 0.8);
      if (t !== null && t < bestT) { bestT = t; best = { type: "player", id, ref: tp }; }
    }

    if (!best) return;
    if (best.type === "enemy") {
      best.ref.hp -= 1;
      if (best.ref.hp <= 0) {
        const i = enemies.indexOf(best.ref);
        if (i !== -1) enemies.splice(i, 1);
        shooter.score += 10;
        io.emit("enemyKilled", { id: best.ref.id, by: socket.id });
      }
    } else { // PvP
      best.ref.hp -= 25;
      io.emit("playerHit", { id: best.id, by: socket.id });
      if (best.ref.hp <= 0) {
        best.ref.alive = false;
        best.ref.respawnAt = Date.now() + RESPAWN_MS;
        shooter.score += 50;          // PvP kill worth more
        io.emit("playerKilled", { id: best.id, by: socket.id });
      }
    }
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
    }
  }

  // --- Waves: ramp difficulty over time (co-op) ---
  waveTimer += dt;
  if (waveTimer > 15) { waveTimer = 0; wave++; spawnInterval = Math.max(0.6, spawnInterval - 0.25); }
  spawnTimer += dt;
  const alivePlayers = Object.values(players).filter(p => p.alive).length;
  const maxEnemies = 6 + wave * 2 + alivePlayers * 2;    // scale with player count
  if (alivePlayers > 0 && spawnTimer > spawnInterval && enemies.length < maxEnemies) {
    spawnTimer = 0;
    enemies.push(makeEnemy());
  }

  // --- Enemy AI: chase nearest ALIVE player, melee at close range ---
  for (const e of enemies) {
    let target = null, best = Infinity;
    for (const id in players) {
      const p = players[id];
      if (!p.alive) continue;
      const dist = Math.hypot(p.x - e.x, p.z - e.z);
      if (dist < best) { best = dist; target = p; }
    }
    if (!target) continue;
    const dx = target.x - e.x, dz = target.z - e.z;
    const dist = Math.hypot(dx, dz) || 1;
    if (dist > 1.2) {
      e.x += (dx / dist) * e.speed * dt;
      e.z += (dz / dist) * e.speed * dt;
      e.y = groundHeightAt(e.x, e.z);
    }
    e.attackCd -= dt;
    if (dist < 1.6 && e.attackCd <= 0) {
      e.attackCd = 1.0;
      target.hp -= 8;
      if (target.hp <= 0) {
        target.alive = false;
        target.respawnAt = now + RESPAWN_MS;
        // find the socket id to announce the death
        const tid = Object.keys(players).find(k => players[k] === target);
        io.emit("playerKilled", { id: tid, by: "zombie" });
      }
    }
  }

  // --- Broadcast the authoritative snapshot ---
  io.emit("sync", { players, enemies, wave });
}, TICK);

// ---------------------------------------------------------------------
// START (Render provides PORT)
// ---------------------------------------------------------------------
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT} (seed ${SEED})`));
