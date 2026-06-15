const socket = io({
  transports: ["websocket"]
});

const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");

canvas.width = window.innerWidth;
canvas.height = window.innerHeight;

let loggedIn = false;

const player = {
  x: 400,
  y: 300,
  size: 22,
  speed: 5
};

const keys = {};
const otherPlayers = {};

window.addEventListener("keydown", e => keys[e.key.toLowerCase()] = true);
window.addEventListener("keyup", e => keys[e.key.toLowerCase()] = false);

// LOGIN
function login() {
  socket.emit("login", {
    username: user.value,
    password: pass.value
  });
}

function register() {
  socket.emit("register", {
    username: user.value,
    password: pass.value
  });
}

// LOGIN RESULT
socket.on("loginResult", (data) => {
  alert(data.msg || "OK");

  if (data.success) {
    document.getElementById("login").style.display = "none";
    canvas.style.display = "block";
    loggedIn = true;
  }
});

// PLAYERS
socket.on("playersUpdate", (players) => {
  Object.keys(players).forEach(id => {
    if (id !== socket.id) {
      otherPlayers[id] = players[id];
    }
  });
});

socket.on("playerMoved", (data) => {
  if (otherPlayers[data.id]) {
    otherPlayers[data.id].x = data.x;
    otherPlayers[data.id].y = data.y;
  }
});

socket.on("removePlayer", (id) => {
  delete otherPlayers[id];
});

// MOVE
function update() {
  if (!loggedIn) return;

  if (keys["w"]) player.y -= player.speed;
  if (keys["s"]) player.y += player.speed;
  if (keys["a"]) player.x -= player.speed;
  if (keys["d"]) player.x += player.speed;

  socket.emit("move", {
    x: player.x,
    y: player.y
  });
}

// DRAW
function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // self
  ctx.fillStyle = "black";
  ctx.fillRect(player.x, player.y, player.size, player.size);

  // others
  ctx.fillStyle = "blue";
  Object.values(otherPlayers).forEach(p => {
    ctx.fillRect(p.x, p.y, 22, 22);
  });
}

// LOOP
function loop() {
  update();
  draw();
  requestAnimationFrame(loop);
}

loop();
