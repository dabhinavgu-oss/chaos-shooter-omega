const socket = io();

const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");

const joystick = document.getElementById("joystick");
const shootBtn = document.getElementById("shootBtn");

canvas.width = window.innerWidth;
canvas.height = window.innerHeight;

const keys = {};
const players = {};

let bullets = [];
let enemies = [];
let myId = null;
let wave = 1;

const nickname = prompt("Enter nickname") || "Player";

let joyX = 0;
let joyY = 0;

// ======================
// SOCKET EVENTS
// ======================

socket.on("connect", () => {
  myId = socket.id;
  socket.emit("setName", nickname);
});

socket.on("init", (data) => {
  myId = data.id;
  Object.keys(players).forEach(id => delete players[id]);
  Object.assign(players, data.players);
  enemies = data.enemies || [];
});

socket.on("players", (serverPlayers) => {
  Object.assign(players, serverPlayers);
});

socket.on("playerMove", (data) => {
  if (!players[data.id]) return;
  players[data.id].x = data.x;
  players[data.id].y = data.y;
});

socket.on("bullet", (bullet) => {
  bullets.push(bullet);
});

socket.on("sync", (data) => {
  enemies = data.enemies || [];
  bullets = data.bullets || [];
  if (typeof data.wave === "number") wave = data.wave;
});

socket.on("removePlayer", (id) => {
  delete players[id];
});

// ======================
// INPUT
// ======================

window.addEventListener("keydown", (e) => {
  keys[e.key.toLowerCase()] = true;
});

window.addEventListener("keyup", (e) => {
  keys[e.key.toLowerCase()] = false;
});

window.addEventListener("mousedown", (e) => {
  if (!players[myId]) return;
  const player = players[myId];
  const dx = e.clientX - player.x;
  const dy = e.clientY - player.y;
  const length = Math.hypot(dx, dy);
  if (length === 0) return;
  socket.emit("shoot", {
    x: player.x,
    y: player.y,
    dx: (dx / length) * 12,
    dy: (dy / length) * 12
  });
});

// Mobile joystick
if (joystick) {
  joystick.addEventListener("touchmove", (e) => {
    e.preventDefault();
    const touch = e.touches[0];
    const rect = joystick.getBoundingClientRect();
    const x = touch.clientX - (rect.left + rect.width / 2);
    const y = touch.clientY - (rect.top + rect.height / 2);
    joyX = Math.max(-1, Math.min(1, x / 40));
    joyY = Math.max(-1, Math.min(1, y / 40));
  });

  joystick.addEventListener("touchend", () => {
    joyX = 0;
    joyY = 0;
  });
}

if (shootBtn) {
  shootBtn.addEventListener("touchstart", () => {
    if (!players[myId]) return;
    socket.emit("shoot", {
      x: players[myId].x,
      y: players[myId].y,
      dx: 12,
      dy: 0
    });
  });
}

// ======================
// UPDATE
// ======================

function update() {
  if (!players[myId]) return;
  const player = players[myId];

  player.x += joyX * 5;
  player.y += joyY * 5;

  if (keys["w"]) player.y -= 5;
  if (keys["s"]) player.y += 5;
  if (keys["a"]) player.x -= 5;
  if (keys["d"]) player.x += 5;

  player.x = Math.max(0, Math.min(canvas.width - player.size, player.x));
  player.y = Math.max(0, Math.min(canvas.height - player.size, player.y));

  socket.emit("move", { x: player.x, y: player.y });
}

// ======================
// DRAW
// ======================

function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Enemies + HP bars
  enemies.forEach(enemy => {
    ctx.fillStyle = "purple";
    ctx.fillRect(enemy.x, enemy.y, enemy.size, enemy.size);

    ctx.fillStyle = "red";
    ctx.fillRect(enemy.x, enemy.y - 8, enemy.size, 5);
    ctx.fillStyle = "lime";
    ctx.fillRect(enemy.x, enemy.y - 8, (enemy.hp / 50) * enemy.size, 5);
  });

  // Bullets
  bullets.forEach(bullet => {
    ctx.fillStyle = "red";
    ctx.beginPath();
    ctx.arc(bullet.x, bullet.y, 4, 0, Math.PI * 2);
    ctx.fill();
  });

  // Players + names
  Object.keys(players).forEach(id => {
    const p = players[id];

    ctx.fillStyle = id === myId ? "black" : "dodgerblue";
    ctx.fillRect(p.x, p.y, p.size, p.size);

    ctx.fillStyle = "black";
    ctx.font = "14px Arial";
    ctx.textAlign = "center";
    ctx.fillText(p.name || "Player", p.x + p.size / 2, p.y - 10);
  });

  // HUD
  ctx.fillStyle = "black";
  ctx.textAlign = "left";
  ctx.font = "20px Arial";
  ctx.fillText("Wave: " + wave, 20, 30);
  ctx.fillText("Enemies: " + enemies.length, 20, 60);
  ctx.fillText("Players: " + Object.keys(players).length, 20, 90);
}

// ======================
// LOOP
// ======================

function loop() {
  update();
  draw();
  requestAnimationFrame(loop);
}

loop();
