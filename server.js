const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static("public"));

const players = {};
const bullets = [];

io.on("connection", (socket) => {
  console.log("Connected:", socket.id);

  players[socket.id] = {
    x: 400,
    y: 300,
    size: 30
  };

  socket.emit("init", { id: socket.id, players });

  socket.broadcast.emit("players", players);

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

  // 🔫 NEW: shoot event
  socket.on("shoot", (data) => {
    const bullet = {
      id: socket.id,
      x: data.x,
      y: data.y,
      dx: data.dx,
      dy: data.dy
    };

    bullets.push(bullet);

    io.emit("bullet", bullet);
  });

  socket.on("disconnect", () => {
    delete players[socket.id];
    io.emit("removePlayer", socket.id);
  });
});

server.listen(process.env.PORT || 3000, () => {
  console.log("Server running");
});
