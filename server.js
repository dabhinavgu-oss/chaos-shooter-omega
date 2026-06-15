const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static("public"));

const users = {};
const activeUsers = {};
const players = {};

io.on("connection", (socket) => {
  console.log("Connected:", socket.id);

  // REGISTER
  socket.on("register", ({ username, password }) => {
    if (!username || !password) {
      socket.emit("loginResult", {
        success: false,
        msg: "Missing username or password"
      });
      return;
    }

    if (users[username]) {
      socket.emit("loginResult", {
        success: false,
        msg: "User already exists"
      });
      return;
    }

    users[username] = password;

    socket.emit("loginResult", {
      success: true,
      msg: "Registered successfully"
    });
  });

  // LOGIN
  socket.on("login", ({ username, password }) => {
    if (!(users[username] && users[username] === password)) {
      socket.emit("loginResult", {
        success: false,
        msg: "Wrong username or password"
      });
      return;
    }

    if (activeUsers[username]) {
      socket.emit("loginResult", {
        success: false,
        msg: "Account already logged in"
      });
      return;
    }

    activeUsers[username] = socket.id;

    players[socket.id] = {
      username,
      x: 400,
      y: 300,
      health: 100
    };

    socket.emit("loginResult", {
      success: true,
      username
    });

    io.emit("playersUpdate", players);
  });

  // MOVEMENT
  socket.on("move", ({ x, y }) => {
    if (!players[socket.id]) return;

    players[socket.id].x = x;
    players[socket.id].y = y;

    socket.broadcast.emit("playerMoved", {
      id: socket.id,
      x,
      y
    });
  });

 // DISCONNECT
socket.on("disconnect", () => {
  console.log("Disconnected:", socket.id);

  if (players[socket.id]) {
    const username = players[socket.id].username;
    delete activeUsers[username];
  }

  delete players[socket.id];

  io.emit("removePlayer", socket.id);
});

server.listen(process.env.PORT || 3000, () => {
  console.log("Server running");
});
