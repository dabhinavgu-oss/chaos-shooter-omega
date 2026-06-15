const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static("public"));

const users = {};
const players = {};

io.on("connection", (socket) => {
  console.log("connected:", socket.id);

  // REGISTER
  socket.on("register", ({ username, password }) => {
    if (!username || !password) {
      socket.emit("loginResult", { success: false, msg: "Missing fields" });
      return;
    }

    if (users[username]) {
      socket.emit("loginResult", { success: false, msg: "User exists" });
      return;
    }

    users[username] = password;
    socket.emit("loginResult", { success: true, msg: "Registered" });
  });

  // LOGIN
  socket.on("login", ({ username, password }) => {
    if (users[username] && users[username] === password) {
      players[socket.id] = {
        x: 400,
        y: 300,
        username
      };

      socket.emit("loginResult", { success: true, username });
      io.emit("playersUpdate", players);
    } else {
      socket.emit("loginResult", { success: false, msg: "Wrong login" });
    }
  });

  // MOVE
  socket.on("move", (data) => {
    if (!players[socket.id]) return;

    players[socket.id].x = data.x;
    players[socket.id].y = data.y;

    socket.broadcast.emit("playerMoved", {
      id: socket.id,
      x: data.x,
      y: data.y
    });
  });

  // DISCONNECT
  socket.on("disconnect", () => {
    delete players[socket.id];
    io.emit("removePlayer", socket.id);
  });
});

server.listen(process.env.PORT || 3000, () => {
  console.log("Server running");
});
