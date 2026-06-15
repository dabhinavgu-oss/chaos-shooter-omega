const socket = io();

const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");

canvas.width = window.innerWidth;
canvas.height = window.innerHeight;

const keys = {};
const players = {};
const me = socket.id;

let myId = null;

socket.on("connect", () => {
  myId = socket.id;
});

window.addEventListener("keydown", e => keys[e.key.toLowerCase()] = true);
window.addEventListener("keyup", e => keys[e.key.toLowerCase()] = false);

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

function update() {
  if (!myId || !players[myId]) return;

  let p = players[myId];

  if (keys["w"]) p.y -= 5;
  if (keys["s"]) p.y += 5;
  if (keys["a"]) p.x -= 5;
  if (keys["d"]) p.x += 5;

  socket.emit("move", { x: p.x, y: p.y });
}

function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  Object.keys(players).forEach(id => {
    const p = players[id];

    ctx.fillStyle = id === myId ? "black" : "blue";
    ctx.fillRect(p.x, p.y, p.size, p.size);
  });
}

function loop() {
  update();
  draw();
  requestAnimationFrame(loop);
}

loop();
