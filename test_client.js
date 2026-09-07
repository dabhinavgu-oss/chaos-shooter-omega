/* Integration test bot: plays the game headlessly for ~32s and verifies
   the wave system, hit feedback, loot, projectiles, and map geometry contracts. */
const fs = require("fs");
const { io } = require("socket.io-client");
const socket = io("http://localhost:3000");

let myId = null, lastSync = null;
let hits = 0, kills = 0, sawIntermission = false, sawWave2 = false;
let sawPickupInSync = false, gotPickup = false, enemyFieldsOk = true;
let gotReward = false, hasGear = false, hasMaxHp = true, hasProjKeys = false;
let minPairDist = Infinity, nanSeen = false;
const pos = { x: 25, z: 25 };

// Map-geometry contract checks. The headless bot cannot render Three.js, so these
// verify that the actual map builder still contains the required door openings
// and four-corner outposts instead of silently losing them during refactors.
let mapWorld = "";
try { mapWorld = fs.readFileSync("public/map-world.js", "utf8"); } catch (_) {}
const mapGeometryChecks = {
  "map has building door openings": /function building\([\s\S]*?if \(doorAxis === 'x'\)/.test(mapWorld),
  "military base has four outposts": (() => {
    const m = mapWorld.match(/function militaryBase\(\)\s*\{([\s\S]*?)\n\s*\}/);
    return !!m && (m[1].match(/tower\(/g) || []).length >= 4;
  })(),
  "sniper outposts has four towers": (() => {
    const m = mapWorld.match(/function sniperOutposts\(\)\s*\{([\s\S]*?)\n\s*\}/);
    return !!m && (m[1].match(/tower\(/g) || []).length >= 4;
  })(),
  "outposts include climbable stair geometry": /for\(let i=0;i<4;i\+\+\) box\(x-2\.0\+i\*0\.5/.test(mapWorld),
};

socket.on("init", (d) => {
  myId = d.id;
  const me = d.players[d.id];
  pos.x = me.x; pos.z = me.z;
  console.log(`init ok: seed=${d.seed} world=${d.world} spawn=(${me.x.toFixed(1)},${me.z.toFixed(1)})`);
});
socket.on("enemyHit", (d) => { if (d.by === myId) hits++; });
socket.on("enemyKilled", (d) => { if (d.by === myId) kills++; });
socket.on("pickup", (d) => { if (d.by === myId) gotPickup = true; });
socket.on("reward", () => { gotReward = true; });
socket.on("sync", (s) => {
  lastSync = s;
  if (s.intermission > 0) sawIntermission = true;
  if ((s.pickups || []).length) sawPickupInSync = true;
  for (const e of s.enemies) if (!("yaw" in e) || !("kind" in e)) enemyFieldsOk = false;
  for (const e of s.enemies) if (!("maxHp" in e)) hasMaxHp = false;
  if ("blobs" in s && "grenades" in s) hasProjKeys = true;
  const meP = s.players[myId];
  if (meP && Array.isArray(meP.weapons) && "shield" in meP && meP.items) hasGear = true;
  if (s.wave >= 2) sawWave2 = true;
  for (let i = 0; i < s.enemies.length; i++) {
    const a = s.enemies[i];
    if (Number.isNaN(a.x) || Number.isNaN(a.z) || Number.isNaN(a.y)) nanSeen = true;
    for (let j = i + 1; j < s.enemies.length; j++) {
      const b = s.enemies[j];
      minPairDist = Math.min(minPairDist, Math.hypot(a.x - b.x, a.z - b.z));
    }
  }
});

setInterval(() => {
  if (!myId || !lastSync) return;
  const me = lastSync.players[myId];
  if (!me) return;
  const es = lastSync.enemies;
  if (es.length) {
    const near = es.reduce((a, b) =>
      Math.hypot(a.x - pos.x, a.z - pos.z) < Math.hypot(b.x - pos.x, b.z - pos.z) ? a : b);
    const nd = Math.hypot(near.x - pos.x, near.z - pos.z);
    if (nd < 4) {
      pos.x = Math.max(2, Math.min(48, pos.x - (near.x - pos.x) / nd * 5));
      pos.z = Math.max(2, Math.min(48, pos.z - (near.z - pos.z) / nd * 5));
    }
    const eye = { x: pos.x, y: (me.y || 0) + 1.7, z: pos.z };
    const t = { x: near.x, y: near.y + 1.2, z: near.z };
    socket.emit("shoot", { x: eye.x, y: eye.y, z: eye.z, dx: t.x-eye.x, dy: t.y-eye.y, dz: t.z-eye.z, w: "pistol" });
  }
  const lootList = lastSync.pickups || [];
  const loot = lootList.length
    ? lootList.reduce((a, b) => Math.hypot(a.x - pos.x, a.z - pos.z) < Math.hypot(b.x - pos.x, b.z - pos.z) ? a : b)
    : null;
  if (loot) {
    const ld = Math.hypot(loot.x - pos.x, loot.z - pos.z) || 1;
    const step = Math.min(4.5, ld);
    pos.x = Math.max(2, Math.min(48, pos.x + (loot.x - pos.x) / ld * step));
    pos.z = Math.max(2, Math.min(48, pos.z + (loot.z - pos.z) / ld * step));
  }
  socket.emit("move", { x: pos.x, y: 0, z: pos.z, yaw: 0 });
}, 250);

setTimeout(() => {
  const s = lastSync || {};
  const me = (s.players || {})[myId] || {};
  const results = {
    "sync has left/intermission": "left" in s && "intermission" in s,
    "player has invuln flag": "invuln" in me,
    "landed hits (enemyHit)": hits > 0,
    "scored kills (enemyKilled)": kills > 0,
    "score updated on server": (me.score || 0) > 0,
    "saw wave cleared intermission": sawIntermission,
    "reached wave 2": sawWave2,
    "no NaN positions": !nanSeen,
    "enemies carry yaw + kind": enemyFieldsOk,
    "loot appeared in sync": sawPickupInSync,
    "bot collected a pickup": gotPickup,
    "player carries weapons/items/shield": hasGear,
    "enemies carry maxHp (for health bars)": hasMaxHp,
    "sync ships blobs + grenades": hasProjKeys,
    "wave-clear reward granted": gotReward,
    "zombies keep distance (>0.55)": minPairDist === Infinity || minPairDist > 0.55,
    ...mapGeometryChecks,
  };
  let pass = true;
  for (const [k, v] of Object.entries(results)) {
    console.log(`${v ? "PASS" : "FAIL"}  ${k}`);
    if (!v) pass = false;
  }
  console.log(`stats: hits=${hits} kills=${kills} score=${me.score} wave=${s.wave} minPairDist=${minPairDist === Infinity ? "n/a" : minPairDist.toFixed(2)}`);
  process.exit(pass ? 0 : 1);
}, 32000);
