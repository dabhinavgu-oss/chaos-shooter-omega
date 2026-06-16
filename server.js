const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static("public"));

const players = {};
const bullets = [];
const enemies = [];

let wave = 1;

// ======================
// ENEMIES
// ======================

function spawnEnemy() {
  return {
    id: Math.random().toString(36).slice(2),
    x: Math.random() * 2000,
    y: Math.random() * 2000,
    size: 30,
    hp: 50
  };
}

for (let i = 0; i < 8; i++) {
  enemies.push(spawnEnemy());
}

// ======================
// CONNECTIONS
// ======================

io.on("connection", (socket) => {
  console.log("Connected:", socket.id);

  players[socket.id] = {
    x: 400,
    y: 300,
    size: 30,
    hp: 100
  };

  socket.emit("init", {
    id: socket.id,
    players,
    enemies
  });

  io.emit("players", players);

  // movement
  socket.on("move", (data) => {
    if (!players[socket.id]) return;

    players[socket.id].x = data.x;
    players[socket.id].y = data.y;

    socket.broadcast.emit("playerMove", {
      id: socket.id,
      x: data.x,
      y: data.y
    });
  });

  // shooting
  socket.on("shoot", (data) => {
    const bullet = {
      owner: socket.id,
      x: data.x,
      y: data.y,
      dx: data.dx,
      dy: data.dy
    };

    bullets.push(bullet);

    io.emit("bullet", bullet);
  });

  socket.on("disconnect", () => {
    console.log("Disconnected:", socket.id);

    delete players[socket.id];

    io.emit("removePlayer", socket.id);
  });
});

// ======================
// GAME LOOP
// ======================

setInterval(() => {

  // move bullets
  for (let i = bullets.length - 1; i >= 0; i--) {

    const b = bullets[i];

    b.x += b.dx;
    b.y += b.dy;

    // remove far bullets
    if (
      b.x < -500 ||
      b.y < -500 ||
      b.x > 3000 ||
      b.y > 3000
    ) {
      bullets.splice(i, 1);
      continue;
    }

    // enemy hits
    for (const e of enemies) {

      const dist = Math.hypot(
        b.x - e.x,
        b.y - e.y
      );

      if (dist < e.size) {

        e.hp -= 25;

        bullets.splice(i, 1);

        if (e.hp <= 0) {

          const index = enemies.indexOf(e);

          if (index !== -1) {
            enemies.splice(index, 1);
          }
        }

        break;
      }
    }
  }

  // next wave
  if (enemies.length === 0) {

    wave++;

    const amount = 8 + wave * 2;

    for (let i = 0; i < amount; i++) {
      enemies.push(spawnEnemy());
    }

    console.log("Wave", wave);
  }

  // enemy AI
  for (const enemy of enemies) {

    let nearestPlayer = null;
    let nearestDistance = Infinity;

    for (const id in players) {

      const player = players[id];

      const dist = Math.hypot(
        player.x - enemy.x,
        player.y - enemy.y
      );

      if (dist < nearestDistance) {
        nearestDistance = dist;
        nearestPlayer = player;
      }
    }

    if (nearestPlayer) {

      const dx = nearestPlayer.x - enemy.x;
      const dy = nearestPlayer.y - enemy.y;

      const dist = Math.hypot(dx, dy);

      if (dist > 0) {

        enemy.x += (dx / dist) * 1.5;
        enemy.y += (dy / dist) * 1.5;
      }
    }
  }

  io.emit("sync", {
    enemies,
    bullets,
    wave
  });

}, 1000 / 30);

// ======================
// START SERVER
// ======================

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
