const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static("public"));

// SIMPLE LOGIN STORE (temporary memory)
const users = {}; // username -> password
const loggedIn = {}; // socket.id -> username

const players = {};

io.on("connection", (socket) => {
  console.log("connected:", socket.id);

  // LOGIN
  socket.on("register", ({ username, password }) => {
    if (users[username]) {
      socket.emit("loginResult", { success: false, msg: "User exists" });
      return;
    }

    users[username] = password;
    socket.emit("loginResult", { success: true });
  });

  socket.on("login", ({ username, password }) => {
    if (users[username] === password) {
      loggedIn[socket.id] = username;

      players[socket.id] = {
        x: 400,
        y: 300,
        username
      };

      socket.emit("loginResult", { success: true });
      io.emit("playersUpdate", players);
    } else {
      socket.emit("loginResult", { success: false, msg: "Wrong login" });
    }
  });

  // MOVEMENT
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
    delete loggedIn[socket.id];
    io.emit("removePlayer", socket.id);
  });
});

server.listen(process.env.PORT || 3000, () => {
  console.log("Server running");
});
