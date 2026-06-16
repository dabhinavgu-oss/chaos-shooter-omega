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
// 👾 spawn enemies
function spawnEnemy() {
  return {
    id: Math.random().toString(36).substr(2, 9),
    x: Math.random() * 2000,
    y: Math.random() * 2000,
    size: 30,
    hp: 50
  };
}

// initial enemies
for (let i = 0; i < 8; i++) {
  enemies.push(spawnEnemy());
}

io.on("connection", (socket) => {
  console.log("Connected:", socket.id);

  players[socket.id] = {
    x: 400,
    y: 300,
    size: 30,
    hp: 100
  };

  socket.emit("init", { id: socket.id, players, enemies });

  socket.broadcast.emit("players", players);

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
    bullets.push({
      id: socket.id,
      x: data.x,
      y: data.y,
      dx: data.dx,
      dy: data.dy
    });

    io.emit("bullet", bullets[bullets.length - 1]);
  });

  socket.on("disconnect", () => {
    delete players[socket.id];
    io.emit("removePlayer", socket.id);
  });
});

// 🔥 game loop (server-side logic)
setInterval(() => {
  // move bullets
  for (let i = bullets.length - 1; i >= 0; i--) {
    const b = bullets[i];
    b.x += b.dx;
    b.y += b.dy;

    // check enemy hit
    for (let e of enemies) {
      const dist = Math.hypot(b.x - e.x, b.y - e.y);

      if (dist < e.size) {
        e.hp -= 25;
        bullets.splice(i, 1);

        if (e.hp <= 0) {
          const index = enemies.indexOf(e);
          enemies.splice(index, 1);
          enemies.push(spawnEnemy());
        }
        break;
      }
    }
  }

 // keep enemy count at 8
 io.emit("bullet", bullets[bullets.length - 1]);
  });

  socket.on("disconnect", () => {
    delete players[socket.id];
    io.emit("removePlayer", socket.id);
  });
});

// 🔥 game loop (server-side logic)
setInterval(() => {
  // move bullets
  for (let i = bullets.length - 1; i >= 0; i--) {
    const b = bullets[i];
    b.x += b.dx;
    b.y += b.dy;

    // check enemy hit
    for (let e of enemies) {
      const dist = Math.hypot(b.x - e.x, b.y - e.y);

      if (dist < e.size) {
        e.hp -= 25;
        bullets.splice(i, 1);

        if (e.hp <= 0) {
          const index = enemies.indexOf(e);
          enemies.splice(index, 1);
          enemies.push(spawnEnemy());
        }
        break;
      }
    }
  }

if (enemies.length === 0) {

  for (let i = 0; i < 12; i++) {
    enemies.push(spawnEnemy());
  }

}

// enemy AI
for (const enemy of enemies) {

  let nearest = null;
  let nearestDist = Infinity;

  for (const id in players) {

    const player = players[id];

    const dist = Math.hypot(
      player.x - enemy.x,
      player.y - enemy.y
    );

    if (dist < nearestDist) {
      nearestDist = dist;
      nearest = player;
    }
  }

  if (nearest) {

    const dx = nearest.x - enemy.x;
    const dy = nearest.y - enemy.y;

    const dist = Math.hypot(dx, dy);

    if (dist > 0) {
      enemy.x += (dx / dist) * 1.5;
      enemy.y += (dy / dist) * 1.5;
    }
  }
}

io.emit("sync", { enemies, bullets });
}, 1000 / 30);

server.listen(process.env.PORT || 3000, () => {
  console.log("Server running");
});
}, 1000 / 30);

server.listen(process.env.PORT || 3000, () => {
  console.log("Server running");
});
