const socket = io();
const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");

const joystick = document.getElementById("joystick");
const shootBtn = document.getElementById("shootBtn") || null;
let joyX = 0;
let joyY = 0;
let mobileShoot = false;

canvas.width = window.innerWidth;
canvas.height = window.innerHeight;

const keys = {};
const players = {};

let bullets = [];
let enemies = [];

let myId = null;

// ======================
// SOCKET EVENTS
// ======================

socket.on("connect", () => {
  myId = socket.id;
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
if (shootBtn) {
  shootBtn.addEventListener("touchstart", () => {

    if (!loggedIn) return;

    socket.emit("shoot", {
      x: player.x,
      y: player.y,
      dx: Math.cos(angle) * 12,
      dy: Math.sin(angle) * 12
    });

  });
}

  if (!loggedIn) return;

  socket.emit("shoot", {
    x: player.x,
    y: player.y,

    dx: Math.cos(angle) * 12,
    dy: Math.sin(angle) * 12
  });

});
  if (!loggedIn) return;

  socket.emit("shoot", {
    x: player.x,
    y: player.y,

    dx: Math.cos(angle) * 12,
    dy: Math.sin(angle) * 12
  });

});
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

// ======================
// UPDATE
// ======================

function update() {
  if (!players[myId]) return;

  const player = players[myId];
player.x += joyX * player.speed;
  player.y += joyY * player.speed;

  if (keys["w"]) player.y -= 5;
  if (keys["s"]) player.y += 5;
  if (keys["a"]) player.x -= 5;
  if (keys["d"]) player.x += 5;

  player.x = Math.max(0, Math.min(canvas.width - player.size, player.x));
  player.y = Math.max(0, Math.min(canvas.height - player.size, player.y));

  socket.emit("move", {
    x: player.x,
    y: player.y
  });
}

// ======================
// DRAW
// ======================

function drawGrid() {
  ctx.strokeStyle = "#dddddd";

  for (let x = 0; x < canvas.width; x += 50) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, canvas.height);
    ctx.stroke();
  }

  for (let y = 0; y < canvas.height; y += 50) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(canvas.width, y);
    ctx.stroke();
  }
}

function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  drawGrid();

  // enemies
  enemies.forEach(enemy => {
    ctx.fillStyle = "purple";

    ctx.fillRect(
      enemy.x,
      enemy.y,
      enemy.size,
      enemy.size
    );

    // hp bar
    ctx.fillStyle = "red";
    ctx.fillRect(
      enemy.x,
      enemy.y - 8,
      enemy.size,
      5
    );

    ctx.fillStyle = "lime";
    ctx.fillRect(
      enemy.x,
      enemy.y - 8,
      (enemy.hp / 50) * enemy.size,
      5
    );
  });

  // bullets
  bullets.forEach(bullet => {
    ctx.fillStyle = "red";

    ctx.beginPath();
    ctx.arc(
      bullet.x,
      bullet.y,
      4,
      0,
      Math.PI * 2
    );
    ctx.fill();
  });

  // players
  Object.keys(players).forEach(id => {
    const p = players[id];

    ctx.fillStyle =
      id === myId
        ? "black"
        : "dodgerblue";

    ctx.fillRect(
      p.x,
      p.y,
      p.size,
      p.size
    );

    if (id === myId) {
      ctx.strokeStyle = "yellow";
      ctx.strokeRect(
        p.x - 2,
        p.y - 2,
        p.size + 4,
        p.size + 4
      );
    }
  });

  // UI
  ctx.fillStyle = "black";
  ctx.font = "20px Arial";

  ctx.fillText(
    `Players: ${Object.keys(players).length}`,
    20,
    30
  );

  ctx.fillText(
    `Enemies: ${enemies.length}`,
    20,
    60
  );
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
