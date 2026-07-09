/* Clump test: never shoots. Kites while the whole wave converges on it,
   then measures how tightly the mob packs. Before the separation fix,
   zombies stacked at ~0.1-0.3 apart; the fix should hold them near ~1. */
const { io } = require("socket.io-client");
const socket = io("http://localhost:3000");
let myId = null, lastSync = null, died = false;
let minPairDist = Infinity, samples = 0, crowdedSyncs = 0;
const pos = { x: 25, z: 25 };

socket.on("init", (d) => { myId = d.id; pos.x = d.players[d.id].x; pos.z = d.players[d.id].z; });
socket.on("playerKilled", (d) => { if (d.id === myId) died = true; });
socket.on("sync", (s) => {
  lastSync = s;
  if (s.enemies.length >= 3) {
    crowdedSyncs++;
    for (let i = 0; i < s.enemies.length; i++)
      for (let j = i + 1; j < s.enemies.length; j++) {
        const d = Math.hypot(s.enemies[i].x - s.enemies[j].x, s.enemies[i].z - s.enemies[j].z);
        if (d < minPairDist) minPairDist = d;
        samples++;
      }
  }
});
setInterval(() => {          // kite: step away from the nearest zombie
  if (!lastSync) return;
  const es = lastSync.enemies;
  if (es.length) {
    const near = es.reduce((a, b) =>
      Math.hypot(a.x - pos.x, a.z - pos.z) < Math.hypot(b.x - pos.x, b.z - pos.z) ? a : b);
    const nd = Math.hypot(near.x - pos.x, near.z - pos.z) || 1;
    if (nd < 5) {
      pos.x = Math.max(3, Math.min(47, pos.x - (near.x - pos.x) / nd * 4));
      pos.z = Math.max(3, Math.min(47, pos.z - (near.z - pos.z) / nd * 4));
    }
  }
  socket.emit("move", { x: pos.x, y: 0, z: pos.z, yaw: 0 });
}, 250);
setTimeout(() => {
  console.log(`enemies now=${lastSync.enemies.length} crowdedSyncs=${crowdedSyncs} pairSamples=${samples}`);
  console.log(`min pairwise distance in the mob: ${minPairDist === Infinity ? "n/a" : minPairDist.toFixed(2)}`);
  console.log(`bot died: ${died}`);
  const pass = crowdedSyncs > 100 && minPairDist > 0.6;
  console.log(pass ? "PASS  zombies do not clump" : "FAIL  zombies clump");
  process.exit(pass ? 0 : 1);
}, 30000);
