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

// Game state - separate for each game session
const gameSessions = {}; // sessionId -> { players, enemies, wave, etc }
let gameSessionCounter = 0;

const WORLD = 80, MAX_H = 8;
const PLAYER_MAX_HP = 100, MAX_SHIELD = 50;
const REVIVE_STATIONS = [{ x: 8, z: 8 }, { x: 72, z: 72 }];
const REVIVE_RADIUS = 3, REVIVE_CHANNEL_SEC = 5;

const WEAPONS = {
  pistol:  { dmg: 2, interval: 350,  pellets: 1, spread: 0.00, knock: 0.5  },
  smg:     { dmg: 1, interval: 110,  pellets: 1, spread: 0.03, knock: 0.25 },
  shotgun: { dmg: 1, interval: 900,  pellets: 6, spread: 0.09, knock: 0.35 },
  rifle:   { dmg: 3, interval: 500,  pellets: 1, spread: 0.00, knock: 0.7  },
  sniper:  { dmg: 8, interval: 1200, pellets: 1, spread: 0.00, knock: 1.2  },
  minigun: { dmg: 1, interval: 60,   pellets: 1, spread: 0.05, knock: 0.2  },
};

const EXTENDED_KINDS = require("./game/enemies").EXTENDED_KINDS;

// Terrain generator
function createTerrainForSeed(seed) {
  const heightMap = [];
  
  function hash(x, z) {
    let n = Math.sin((x + seed) * 127.1 + (z + seed) * 311.7) * 43758.5453;
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

  return heightMap;
}

function groundHeightAt(wx, wz, heightMap) {
  const gx = Math.round(wx), gz = Math.round(wz);
  if (gx < 0 || gz < 0 || gx >= WORLD || gz >= WORLD) return 0;
  return heightMap[gx][gz] + 0.5;
}

function createGameSession() {
  const sessionId = `session_${++gameSessionCounter}_${Date.now()}`;
  const seed = Math.floor(Math.random() * 100000);
  const heightMap = createTerrainForSeed(seed);

  const session = {
    id: sessionId,
    seed,
    heightMap,
    players: {},
    enemies: [],
    pickups: [],
    reviveCards: [],
    wave: 1,
    budget: 0,
    spawnTimer: 0,
    spawnInterval: 1.6,
    waveActive: false,
    intermission: 0,
    gameOver: false,
    lastUpdateTime: Date.now(),
  };

  gameSessions[sessionId] = session;
  return session;
}

function edgeSpawn(heightMap) {
  let x, z;
  const edge = Math.floor(Math.random() * 4);
  if (edge === 0) { x = 1; z = 1 + Math.random() * (WORLD - 2); }
  else if (edge === 1) { x = WORLD - 2; z = 1 + Math.random() * (WORLD - 2); }
  else if (edge === 2) { z = 1; x = 1 + Math.random() * (WORLD - 2); }
  else { z = WORLD - 2; x = 1 + Math.random() * (WORLD - 2); }
  return { x, z };
}

function randomSpawn(enemies, heightMap) {
  let best = null, bestScore = -1;
  for (let i = 0; i < 10; i++) {
    const x = 5 + Math.random() * (WORLD - 10);
    const z = 5 + Math.random() * (WORLD - 10);
    let nearest = Infinity;
    for (const e of enemies) nearest = Math.min(nearest, Math.hypot(e.x - x, e.z - z));
    const score = enemies.length ? nearest : 1;
    if (score > bestScore) { bestScore = score; best = { x, z, y: groundHeightAt(x, z, heightMap) }; }
  }
  return best;
}

function pickKind(wave) {
  const pool = [];
  for (const k in EXTENDED_KINDS) {
    if (EXTENDED_KINDS[k].intro > wave) continue;
    const w = EXTENDED_KINDS[k].intro === wave ? 3 : 1;
    for (let i = 0; i < w; i++) pool.push(k);
  }
  return pool[Math.floor(Math.random() * pool.length)] || "walker";
}

function makeEnemyOfKind(kind, wave, heightMap) {
  const { x, z } = edgeSpawn(heightMap);
  const base = EXTENDED_KINDS[kind];
  if (!base) return makeEnemyOfKind("walker", wave, heightMap);
  const grow = Math.max(0, wave - base.intro);
  const isBoss = base.boss;
  const elite = !isBoss && wave >= 5 && Math.random() < Math.min(0.22, 0.06 + wave * 0.01);
  const hp = Math.round((base.hp + (isBoss ? wave * 2 : 0)) * (1 + 0.06 * grow) * (elite ? 1.6 : 1));
  return {
    id: Math.random().toString(36).slice(2),
    x, z, y: groundHeightAt(x, z, heightMap), yaw: 0, kind, elite,
    hp, maxHp: hp,
    speed: Math.min(base.cap * (elite ? 1.15 : 1), base.speed + 0.05 * grow),
    dmg: Math.round(base.dmg * (elite ? 1.3 : 1)),
    pts: Math.round(base.pts * (elite ? 2 : 1)),
    reach: base.reach,
    attackCd: 0, staggerUntil: 0,
  };
}

function waveBudget(w, playerCount) {
  return 6 + w * 3 + Math.max(0, playerCount - 1) * 3;
}

function gearForWave(w) {
  const g = { weapons: ["pistol"], items: { grenade: 0, potion: 0, selfRevive: 0 } };
  const track = { 1: "smg", 2: "shotgun", 3: "rifle", 4: "grenade3", 5: "sniper", 6: "potion2", 7: "minigun" };
  for (let c = 1; c < w; c++) {
    let r = track[c];
    if (!r) r = c % 2 === 0 ? "grenade2" : "potion1";
    if (r.startsWith("grenade")) g.items.grenade += +r.slice(7);
    else if (r.startsWith("potion")) g.items.potion += +r.slice(6);
    else if (!g.weapons.includes(r)) g.weapons.push(r);
  }
  return g;
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

// Socket.IO - one game session per connection
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

  // Create a fresh game session for this player
  const session = createGameSession();
  console.log("Connected:", socket.id, "Session:", session.id);

  const s = randomSpawn(session.enemies, session.heightMap);
  session.players[socket.id] = {
    x: s.x, y: s.y, z: s.z, yaw: 0,
    hp: PLAYER_MAX_HP, shield: 0, score: 0,
    name: `Player${Math.random().toString(36).slice(7)}`, color: "#1e90ff",
    alive: true, permaDead: false, spectating: false,
    invulnUntil: Date.now() + 2500, invuln: true,
    userId,
    ...gearForWave(session.wave), lastShot: {},
  };

  if (userId) friendsManager.setOnline(userId, socket.id);

  socket.emit("init", {
    id: socket.id,
    seed: session.seed, world: WORLD, maxH: MAX_H,
    players: session.players, enemies: session.enemies, wave: session.wave,
    reviveStations: REVIVE_STATIONS,
  });

  socket.on("move", (d) => {
    const p = session.players[socket.id];
    if (!p || !p.alive) return;
    p.yaw = +d.yaw || 0;
    let x = Math.max(0.5, Math.min(WORLD - 1.5, +d.x || 0));
    let z = Math.max(0.5, Math.min(WORLD - 1.5, +d.z || 0));
    let y = +d.y || 0;
    const ground = groundHeightAt(x, z, session.heightMap);
    if (y < ground) y = ground;
    if (y > ground + 6) y = ground + 6;
    p.x = x; p.y = y; p.z = z;
  });

  socket.on("shoot", (d) => {
    const shooter = session.players[socket.id];
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
      const dir = spec.spread ? normalize({
        x: aim.x + (Math.random() - 0.5) * spec.spread * 2,
        y: aim.y + (Math.random() - 0.5) * spec.spread * 2,
        z: aim.z + (Math.random() - 0.5) * spec.spread * 2
      }) : aim;

      socket.emit("tracer", { x: origin.x, y: origin.y, z: origin.z, dx: dir.x, dy: dir.y, dz: dir.z });

      const RANGE = 110;
      let best = null, bestT = RANGE;
      for (const e of session.enemies) {
        const t = raySphere(origin, dir, { x: e.x, y: e.y + 1.2, z: e.z }, 0.9);
        if (t !== null && t < bestT) { bestT = t; best = { type: "enemy", ref: e }; }
      }
      if (!best) continue;

      const e = best.ref;
      e.hp -= spec.dmg;
      e.x = Math.max(1, Math.min(WORLD - 2, e.x + dir.x * spec.knock));
      e.z = Math.max(1, Math.min(WORLD - 2, e.z + dir.z * spec.knock));
      e.y = groundHeightAt(e.x, e.z, session.heightMap);
      e.staggerUntil = now + 250;
      socket.emit("enemyHit", { id: e.id, by: socket.id });
      if (e.hp <= 0) {
        const i = session.enemies.indexOf(e);
        if (i !== -1 && !e._dead) {
          e._dead = true;
          session.enemies.splice(i, 1);
          if (shooter) shooter.score += e.pts;
          socket.emit("enemyKilled", { id: e.id, pts: e.pts });
          // Rare drop in singleplayer
          if (Math.random() < 0.02) {
            session.pickups.push({
              id: Math.random().toString(36).slice(2),
              x: e.x, y: e.y, z: e.z,
              kind: "revive",
              expiresAt: Date.now() + 25000,
            });
          }
        }
      }
    }
  });

  socket.on("setName", (name) => {
    const p = session.players[socket.id];
    if (p) p.name = String(name).trim().substring(0, 16) || "Player";
  });

  socket.on("disconnect", () => {
    if (userId) friendsManager.setOffline(userId);
    delete session.players[socket.id];
    delete gameSessions[session.id];
  });

  // Game loop for this session @ 30Hz
  const sessionTick = setInterval(() => {
    if (session.gameOver || !gameSessions[session.id]) {
      clearInterval(sessionTick);
      return;
    }

    const now = Date.now();
    const dt = 1 / 30;

    for (const id in session.players) {
      const p = session.players[id];
      p.invuln = p.alive && now < p.invulnUntil;
    }

    const alivePlayers = Object.values(session.players).filter(p => p.alive && !p.permaDead).length;
    const totalPlayers = Object.keys(session.players).length;

    if (alivePlayers === 0 && totalPlayers > 0) {
      session.gameOver = true;
      socket.emit("gameOver", { reason: "Game Over! You died without revival items." });
      clearInterval(sessionTick);
      return;
    } else if (!session.waveActive) {
      session.waveActive = true;
      session.budget = waveBudget(session.wave, totalPlayers);
      session.spawnTimer = session.spawnInterval;
    } else {
      session.spawnTimer += dt;
      const cap = Math.min(24, 10 + Math.floor(session.wave / 2)) + totalPlayers * 2;
      if (session.budget > 0 && session.spawnTimer > session.spawnInterval && session.enemies.length < cap) {
        session.spawnTimer = 0;
        session.budget--;
        session.enemies.push(makeEnemyOfKind(pickKind(session.wave), session.wave, session.heightMap));
      }
      if (session.budget === 0 && session.enemies.length === 0) {
        session.waveActive = false;
        session.wave++;
        for (const id in session.players) applyReward(session.players[id], session.wave - 1);
      }
    }

    // Enemy AI
    for (const e of [...session.enemies]) {
      let target = null, targetId = null, best = Infinity;
      for (const id in session.players) {
        const p = session.players[id];
        if (!p.alive) continue;
        const dist = Math.hypot(p.x - e.x, p.z - e.z);
        if (dist < best) { best = dist; target = p; targetId = id; }
      }
      if (!target) continue;

      const dx = target.x - e.x, dz = target.z - e.z;
      const dist = Math.hypot(dx, dz) || 1;
      e.yaw = Math.atan2(dx, dz);
      e.attackCd -= dt;

      if (dist > 1.2) {
        e.x += (dx / dist) * e.speed * dt;
        e.z += (dz / dist) * e.speed * dt;
        e.y = groundHeightAt(e.x, e.z, session.heightMap);
      }
      if (dist < (e.reach || 1.6) && e.attackCd <= 0 && !target.invuln) {
        e.attackCd = 1.0;
        socket.emit("enemyAttack", { id: e.id });
        if (target.alive && !target.invuln) {
          target.hp -= e.dmg || 8;
          socket.emit("playerHit", { id: targetId });
          if (target.hp <= 0) {
            target.alive = false;
            target.permaDead = true;
            socket.emit("playerKilled", { id: targetId });
          }
        }
      }
    }

    // Pickups
    for (let i = session.pickups.length - 1; i >= 0; i--) {
      const pk = session.pickups[i];
      if (now > pk.expiresAt) { session.pickups.splice(i, 1); continue; }
      for (const id in session.players) {
        const p = session.players[id];
        if (!p.alive) continue;
        if (Math.hypot(p.x - pk.x, p.z - pk.z) < 1.2 && Math.abs(p.y - pk.y) < 2) {
          if (pk.kind === "revive") p.items.selfRevive = (p.items.selfRevive || 0) + 1;
          socket.emit("pickup", { id: pk.id, kind: pk.kind });
          session.pickups.splice(i, 1);
          break;
        }
      }
    }

    socket.emit("sync", {
      players: session.players,
      enemies: session.enemies,
      wave: session.wave,
      pickups: session.pickups,
      left: session.enemies.length + session.budget,
    });
  }, 1000 / 30);
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 Chaos Shooter Omega running on port ${PORT}`));
