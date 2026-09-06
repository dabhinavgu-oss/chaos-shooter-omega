const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cookieParser = require("cookie-parser");
const jwt = require("jsonwebtoken");

const authRoutes = require("./routes/auth");
const userRoutes = require("./routes/users");
const friendRoutes = require("./routes/friends");
const { PartyManager } = require("./game/parties");
const { FriendsManager } = require("./game/friends");
const { MapManager } = require("./game/maps");
const { EXTENDED_KINDS } = require("./game/enemies");

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

const JWT_SECRET = process.env.JWT_SECRET || "your-secret-key-change-in-production";

app.use(express.json());
app.use(express.static("public"));
app.use(cookieParser());

app.use("/api/auth", authRoutes);
app.use("/api/users", userRoutes);
app.use("/api/friends", friendRoutes);

const partyManager = new PartyManager();
const friendsManager = new FriendsManager();
const mapManager = new MapManager();
mapManager.initializeMaps();

// Game state
const players = {};
const enemies = [];
const sessions = {};
let wave = 1, budget = 0, spawnTimer = 0, spawnInterval = 1.6;
let waveActive = false, intermission = 0;
const pickups = [];
const reviveCards = [];
const blobs = [];
const grenades = [];
const REVIVE_STATIONS = [{ x: 8, z: 8 }, { x: 72, z: 72 }];
const REVIVE_RADIUS = 3, REVIVE_CHANNEL_SEC = 5;

const WORLD = 80, MAX_H = 8;
const SEED = Math.floor(Math.random() * 100000);
const heightMap = [];
const PLAYER_MAX_HP = 100, MAX_SHIELD = 50;

// Terrain
function hash(x, z) {
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
  let h = smoothNoise(x * 0.12, z * 0.12) * 0.6 + smoothNoise(x * 0.25, z * 0.25) * 0.3 + smoothNoise(x * 0.5, z * 0.5) * 0.1;
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

const WEAPONS = {
  pistol:  { dmg: 2, interval: 350,  pellets: 1, spread: 0.00, knock: 0.5  },
  smg:     { dmg: 1, interval: 110,  pellets: 1, spread: 0.03, knock: 0.25 },
  shotgun: { dmg: 1, interval: 900,  pellets: 6, spread: 0.09, knock: 0.35 },
  rifle:   { dmg: 3, interval: 500,  pellets: 1, spread: 0.00, knock: 0.7  },
  sniper:  { dmg: 8, interval: 1200, pellets: 1, spread: 0.00, knock: 1.2  },
  minigun: { dmg: 1, interval: 60,   pellets: 1, spread: 0.05, knock: 0.2  },
};

function randomSpawn() {
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

function pickKind() {
  const pool = [];
  for (const k in EXTENDED_KINDS) {
    if (EXTENDED_KINDS[k].intro > wave) continue;
    const w = EXTENDED_KINDS[k].intro === wave ? 3 : 1;
    for (let i = 0; i < w; i++) pool.push(k);
  }
  return pool[Math.floor(Math.random() * pool.length)] || "walker";
}

function makeEnemyOfKind(kind) {
  const { x, z } = edgeSpawn();
  const base = EXTENDED_KINDS[kind];
  if (!base) return makeEnemyOfKind("walker");
  const grow = Math.max(0, wave - base.intro);
  const isBoss = base.boss;
  const elite = !isBoss && wave >= 5 && Math.random() < Math.min(0.22, 0.06 + wave * 0.01);
  const hp = Math.round((base.hp + (isBoss ? wave * 2 : 0)) * (1 + 0.06 * grow) * (elite ? 1.6 : 1));
  return {
    id: Math.random().toString(36).slice(2),
    x, z, y: groundHeightAt(x, z), yaw: 0, kind, elite,
    hp, maxHp: hp,
    speed: Math.min(base.cap * (elite ? 1.15 : 1), base.speed + 0.05 * grow),
    dmg: Math.round(base.dmg * (elite ? 1.3 : 1)),
    pts: Math.round(base.pts * (elite ? 2 : 1)),
    reach: base.reach,
    frontDR: base.frontDR || 0,
    dashSpeed: base.dashSpeed || 0,
    poison: base.poison || 0,
    attackCd: 0, lungeCd: 0, dashCd: 2 + Math.random() * 2, spawnCd: 4 + Math.random() * 2,
    burrowed: kind === "burrower",
    staggerUntil: 0,
  };
}

function makeEnemy() { return makeEnemyOfKind(pickKind()); }

function waveBudget(w) {
  const n = Object.keys(players).length || 1;
  return 6 + w * 3 + Math.max(0, n - 1) * 3;
}

function applyReward(g, clearedWave) {
  const track = { 1: "smg", 2: "shotgun", 3: "rifle", 4: "grenade3", 5: "sniper", 6: "potion2", 7: "minigun" };
  let r = track[clearedWave];
  if (!r) r = clearedWave % 2 === 0 ? "grenade2" : "potion1";
  if (r.startsWith("grenade")) { g.items.grenade += +r.slice(7); return { kind: "item", id: "grenade", n: +r.slice(7) }; }
  if (r.startsWith("potion"))  { g.items.potion  += +r.slice(6); return { kind: "item", id: "potion",  n: +r.slice(6) }; }
  if (!g.weapons.includes(r)) g.weapons.push(r);
  return { kind: "weapon", id: r };
}

function gearForWave(w) {
  const g = { weapons: ["pistol"], items: { grenade: 0, potion: 0, selfRevive: 0 } };
  for (let c = 1; c < w; c++) applyReward(g, c);
  return g;
}

function grantWaveReward(clearedWave) {
  let info = null;
  for (const id in players) info = applyReward(players[id], clearedWave);
  io.emit("reward", { wave: clearedWave, ...(info || {}) });
}

function revivePlayer(id, hp) {
  const p = players[id];
  if (!p) return;
  const s = randomSpawn();
  p.x = s.x; p.y = s.y; p.z = s.z;
  p.hp = hp != null ? hp : PLAYER_MAX_HP;
  p.shield = 0;
  p.alive = true;
  p.permaDead = false;
  p.invulnUntil = Date.now() + 2500;
  p.poisonUntil = 0; p.rootedUntil = 0;
  io.emit("playerRevived", { id });
}

function hurtPlayer(pid, p, amount, by) {
  if (!p.alive || p.invuln) return;
  const absorbed = Math.min(p.shield || 0, amount);
  p.shield = (p.shield || 0) - absorbed;
  p.hp -= (amount - absorbed);
  io.emit("playerHit", { id: pid, by });
  if (p.hp <= 0) {
    p.alive = false;
    p.shield = 0;
    io.emit("playerKilled", { id: pid, by });
    if (by && players[by] && by !== pid) players[by].score += 50;

    const playerCount = Object.keys(players).length;
    const solo = playerCount === 1;

    if (solo) {
      // SINGLE PLAYER: Only revive with rare self-revive item, otherwise GAME OVER
      if (p.items && p.items.selfRevive > 0) {
        p.items.selfRevive--;
        revivePlayer(pid, Math.round(PLAYER_MAX_HP * 0.5));
        io.emit("selfRevived", { id: pid });
      } else {
        p.permaDead = true;
        io.emit("gameOver", { id: pid, reason: "You died. No revival items available." });
      }
    } else {
      // MULTIPLAYER: Drop revive card
      reviveCards.push({
        id: Math.random().toString(36).slice(2),
        forId: pid, forName: p.name,
        x: p.x, y: p.y, z: p.z,
        carriedBy: null, channelProgress: 0, ready: false,
      });
      io.emit("playerDown", { id: pid, name: p.name });
    }
  }
}

function killEnemy(e, by) {
  const i = enemies.indexOf(e);
  if (i === -1 || e._dead) return;
  e._dead = true;
  enemies.splice(i, 1);
  if (by && players[by]) players[by].score += e.pts;
  io.emit("enemyKilled", { id: e.id, by, kind: e.kind, pts: e.pts, elite: e.elite || false });
  
  // Rare drop: self-revive item in singleplayer
  const solo = Object.keys(players).length === 1;
  if (solo && Math.random() < 0.02) {
    pickups.push({
      id: Math.random().toString(36).slice(2),
      x: e.x, y: e.y, z: e.z,
      kind: "revive",
      expiresAt: Date.now() + 25000,
    });
  }
}

function normalize(v) {
  const m = Math.hypot(v.x, v.y, v.z) || 1;
  return { x: v.x / m, y: v.y / m, z: v.z / m };
}

function raySphere(o, d, c, r) {
  const ox = o.x - c.x, oy = o.y - c.y, oz = o.z - c.z;
  const b = ox * d.x + oy * d.y + oz * d.z;
  const cc = ox * ox + oy * oy + oz * oz - r * r;
  const disc = b * b - cc;
  if (disc < 0) return null;
  const t = -b - Math.sqrt(disc);
  return t >= 0 ? t : null;
}

// Socket.IO
io.on("connection", (socket) => {
  const token = socket.handshake.headers.authorization?.split(" ")[1];
  let userId = null;
  if (token) {
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      userId = decoded.id;
    } catch (err) {
      console.warn("Invalid token");
    }
  }

  console.log("Connected:", socket.id, userId);

  const s = randomSpawn();
  players[socket.id] = {
    x: s.x, y: s.y, z: s.z, yaw: 0,
    hp: PLAYER_MAX_HP, shield: 0, score: 0,
    name: `Player${Math.random().toString(36).slice(7)}`, color: "#1e90ff",
    alive: true, permaDead: false, spectating: false,
    invulnUntil: Date.now() + 2500, invuln: true,
    userId,
    ...gearForWave(wave), lastShot: {},
  };

  if (userId) friendsManager.setOnline(userId, socket.id);

  socket.emit("init", {
    id: socket.id,
    seed: SEED, world: WORLD, maxH: MAX_H,
    players, enemies, wave,
    reviveStations: REVIVE_STATIONS,
  });

  socket.on("move", (d) => {
    const p = players[socket.id];
    if (!p || !p.alive) return;
    p.yaw = +d.yaw || 0;
    if (p.rootedUntil && Date.now() < p.rootedUntil) return;
    let x = Math.max(0.5, Math.min(WORLD - 1.5, +d.x || 0));
    let z = Math.max(0.5, Math.min(WORLD - 1.5, +d.z || 0));
    let y = +d.y || 0;
    const ground = groundHeightAt(x, z);
    if (y < ground) y = ground;
    if (y > ground + 6) y = ground + 6;
    p.x = x; p.y = y; p.z = z;
  });

  socket.on("shoot", (d) => {
    const shooter = players[socket.id];
    if (!shooter || !shooter.alive) return;
    shooter.invulnUntil = 0;
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
        ? normalize({
            x: aim.x + (Math.random() - 0.5) * spec.spread * 2,
            y: aim.y + (Math.random() - 0.5) * spec.spread * 2,
            z: aim.z + (Math.random() - 0.5) * spec.spread * 2
          })
        : aim;

      io.emit("tracer", { x: origin.x, y: origin.y, z: origin.z, dx: dir.x, dy: dir.y, dz: dir.z });

      const RANGE = 110;
      let best = null, bestT = RANGE;
      for (const e of enemies) {
        const t = raySphere(origin, dir, { x: e.x, y: e.y + 1.2, z: e.z }, 0.9);
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
        hurtPlayer(best.id, best.ref, spec.dmg * 10, socket.id);
      }
    }
  });

  socket.on("setName", (name) => {
    const p = players[socket.id];
    if (p) p.name = String(name).trim().substring(0, 16) || "Player";
  });

  socket.on("disconnect", () => {
    if (userId) friendsManager.setOffline(userId);
    delete players[socket.id];
    io.emit("removePlayer", socket.id);
  });
});

// Game loop @ 30Hz
const TICK = 1000 / 30, dt = 1 / 30;
setInterval(() => {
  const now = Date.now();

  // Revive cards (MULTIPLAYER ONLY)
  for (const card of reviveCards) {
    if (card.ready) continue;
    if (card.carriedBy == null) {
      for (const id in players) {
        const p = players[id];
        if (!p.alive || id === card.forId) continue;
        if (Math.hypot(p.x - card.x, p.z - card.z) < 1.3) {
          card.carriedBy = id;
          io.emit("cardPickedUp", { cardId: card.id, by: id, forName: card.forName });
          break;
        }
      }
    } else {
      const carrier = players[card.carriedBy];
      if (!carrier || !carrier.alive) {
        card.carriedBy = null;
        if (carrier) { card.x = carrier.x; card.y = carrier.y; card.z = carrier.z; }
      } else {
        card.x = carrier.x; card.y = carrier.y; card.z = carrier.z;
        const atStation = REVIVE_STATIONS.some(s => Math.hypot(carrier.x - s.x, carrier.z - s.z) < REVIVE_RADIUS);
        if (atStation) {
          card.channelProgress += dt;
          if (card.channelProgress >= REVIVE_CHANNEL_SEC) {
            card.ready = true;
            io.emit("cardReady", { cardId: card.id, forName: card.forName });
          }
        }
      }
    }
  }

  for (const id in players) { const p = players[id]; p.invuln = p.alive && now < p.invulnUntil; }

  const alivePlayers = Object.values(players).filter(p => p.alive && !p.permaDead).length;
  const totalPlayers = Object.keys(players).length;

  // Check for full wipe or game over
  if (alivePlayers === 0 && totalPlayers > 0) {
    // All players dead/permadead - check if multiplayer or singleplayer
    const isSingleplayer = totalPlayers === 1;
    if (isSingleplayer) {
      // Single player - broadcast game over
      io.emit("gameOver", { reason: "Game Over! You died without revival items." });
      enemies.length = 0; waveActive = false; intermission = 0;
      reviveCards.length = 0;
    } else {
      // Multiplayer - all dead means wave reset/team wipe
      enemies.length = 0; waveActive = false; intermission = 0;
      reviveCards.length = 0;
      for (const id in players) {
        const p = players[id];
        if (!p.permaDead) revivePlayer(id);
      }
    }
  } else if (intermission > 0) {
    intermission -= dt;
    if (intermission <= 0) {
      intermission = 0; wave++; waveActive = true;
      budget = waveBudget(wave);
      spawnInterval = Math.max(0.45, 1.6 - wave * 0.06);
      spawnTimer = spawnInterval;
    }
  } else if (!waveActive) {
    waveActive = true; budget = waveBudget(wave); spawnTimer = spawnInterval;
  } else {
    spawnTimer += dt;
    const cap = Math.min(24, 10 + Math.floor(wave / 2)) + totalPlayers * 2;
    if (budget > 0 && spawnTimer > spawnInterval && enemies.length < cap) {
      spawnTimer = 0; budget--;
      enemies.push(makeEnemy());
    }
    if (budget === 0 && enemies.length === 0) {
      intermission = 6;
      grantWaveReward(wave);
      for (let i = reviveCards.length - 1; i >= 0; i--) {
        const card = reviveCards[i];
        if (card.ready) {
          revivePlayer(card.forId);
        } else {
          const dead = players[card.forId];
          if (dead) {
            dead.permaDead = true;
            dead.spectating = true;
            io.emit("playerSpectating", { id: card.forId });
          }
        }
        reviveCards.splice(i, 1);
      }
    }
  }

  // ENEMY AI
  const screamers = enemies.filter(e => e.kind === "screamer");
  for (const e of [...enemies]) {
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
    e.dashCd -= dt;
    e.spawnCd -= dt;

    let spd = e.speed;
    for (const s of screamers) {
      if (s !== e && Math.hypot(s.x - e.x, s.z - e.z) < 6) { spd *= 1.4; break; }
    }

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

  // Pickups (revive items and health)
  for (let i = pickups.length - 1; i >= 0; i--) {
    const pk = pickups[i];
    if (now > pk.expiresAt) { pickups.splice(i, 1); continue; }
    for (const id in players) {
      const p = players[id];
      if (!p.alive) continue;
      if (Math.hypot(p.x - pk.x, p.z - pk.z) < 1.2 && Math.abs(p.y - pk.y) < 2) {
        if (pk.kind === "health") p.hp = Math.min(PLAYER_MAX_HP, p.hp + 30);
        if (pk.kind === "revive") p.items.selfRevive = (p.items.selfRevive || 0) + 1;
        io.emit("pickup", { id: pk.id, by: id, kind: pk.kind });
        pickups.splice(i, 1);
        break;
      }
    }
  }

  io.emit("sync", {
    players, enemies, wave, pickups, reviveCards,
    left: enemies.length + budget,
    intermission: Math.ceil(intermission),
  });
}, TICK);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 Chaos Shooter Omega running on port ${PORT} (seed ${SEED})`));
