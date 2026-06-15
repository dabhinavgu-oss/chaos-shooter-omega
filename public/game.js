const socket = io();

const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");

canvas.width = window.innerWidth;
canvas.height = window.innerHeight;

const keys = {};
const players = {};
const bullets = {};

let myId = null;

socket.on("connect", () => {
  myId = socket.id;
});

socket.on("init", (data) => {
  Object.assign(players, data.players);
});

socket.on("players", (serverPlayers) => {
  Object.assign(players, serverPlayers);
});

socket.on("playerMove", (data) => {
  if (players[data.id]) {
    players[data.id].x = data.x;
    players[data.id].y = data.y;
  }
});

socket.on("removePlayer", (id) => {
  delete players[id];
});

// 🔫 NEW: receive bullets
socket.on("bullet", (b) => {
  const id = Math.random();
  bullets[id] = b;
});

window.addEventListener("keydown", e => keys[e.key.toLowerCase()] = true);
window.addEventListener("keyup", e => keys[e.key.toLowerCase()] = false);

// 🎯 mouse shoot
window.addEventListener("mousedown", (e) => {
  if (!players[myId]) return;

  const p = players[myId];

  const dx = (e.clientX - p.x) * 0.05;
  const dy = (e.clientY - p.y) * 0.05;

  socket.emit("shoot", {
    x: p.x,
    y: p.y,
    dx,
    dy
  });
});

function update() {
  if (!players[myId]) return;

  let p = players[myId];

  if (keys["w"]) p.y -= 5;
  if (keys["s"]) p.y += 5;
  if (keys["a"]) p.x -= 5;
  if (keys["d"]) p.x += 5;

  socket.emit("move", { x: p.x, y: p.y });
}

function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // players
  Object.keys(players).forEach(id => {
    const p = players[id];

    ctx.fillStyle = id === myId ? "black" : "blue";
    ctx.fillRect(p.x, p.y, p.size, p.size);
  });

  // bullets
  Object.values(bullets).forEach(b => {
    b.x += b.dx;
    b.y += b.dy;

    ctx.fillStyle = "red";
    ctx.fillRect(b.x, b.y, 5, 5);
  });
}

function loop() {
  update();
  draw();
  requestAnimationFrame(loop);
}

loop();
