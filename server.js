const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static("public"));

const players = {};

io.on("connection", (socket) => {
  console.log("Player connected:", socket.id);

  // create player
  players[socket.id] = {
    x: 400,
    y: 300,
    health: 100
  };

  // send all players to new player
  socket.emit("currentPlayers", players);

  // broadcast new player
  socket.broadcast.emit("newPlayer", {
    id: socket.id,
    player: players[socket.id]
  });

  // movement sync
  socket.on("move", (data) => {
    if (players[socket.id]) {
      players[socket.id].x = data.x;
      players[socket.id].y = data.y;

      socket.broadcast.emit("playerMoved", {
        id: socket.id,
        x: data.x,
        y: data.y
      });
    }
  });

  // disconnect
  socket.on("disconnect", () => {
    delete players[socket.id];
    io.emit("removePlayer", socket.id);
  });
});

server.listen(process.env.PORT || 3000, () => {
  console.log("Server running");
});
