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
    if (!(users[username] &&
