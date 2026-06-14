const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");

canvas.width = window.innerWidth;
canvas.height = window.innerHeight;

// PLAYER
const player = {
  x: canvas.width / 2,
  y: canvas.height / 2,
  size: 22,
  speed: 5,
  health: 100
};

let gameOver = false;

// INPUT
const keys = {};
let mouse = { x: 0, y: 0 };

window.addEventListener("keydown", (e) => keys[e.key.toLowerCase()] = true);
window.addEventListener("keyup", (e) => keys[e.key.toLowerCase()] = false);

window.addEventListener("mousemove", (e) => {
  mouse.x = e.clientX;
  mouse.y = e.clientY;
});

// ENTITIES
const bullets = [];
const enemies = [];
let boss = null;

// WEAPON
let lastShot = 0;

// SHOOT
function shoot() {
  if (gameOver) return;

  const now = Date.now();
  if (now - lastShot < 200) return;
  lastShot = now;

  const angle = Math.atan2(mouse.y - player.y, mouse.x - player.x);

  bullets.push({
    x: player.x,
    y: player.y,
    dx: Math.cos(angle) * 7,
    dy: Math.sin(angle) * 7,
    size: 5,
    damage: 10
  });
}

window.addEventListener("mousedown", shoot);

// ENEMIES
function spawnEnemy() {
  return {
    x: Math.random() * canvas.width,
    y: Math.random() * canvas.height,
    size: 25,
    speed: 1.5,
    health: 30
  };
}

// BOSS
function spawnBoss() {
  return {
    x: canvas.width / 2,
    y: 80,
    size: 90,
    speed: 1.2,
    health: 300
  };
}

// START
for (let i = 0; i < 6; i++) enemies.push(spawnEnemy());

// UPDATE
function update() {
  if (gameOver) return;

  // movement
  if (keys["w"]) player.y -= player.speed;
  if (keys["s"]) player.y += player.speed;
  if (keys["a"]) player.x -= player.speed;
  if (keys["d"]) player.x += player.speed;

  // bullets
  bullets.forEach(b => {
    b.x += b.dx;
    b.y += b.dy;
  });

  // enemies AI
  enemies.forEach((e, i) => {
    let dx = player.x - e.x;
    let dy = player.y - e.y;
    let dist = Math.sqrt(dx * dx + dy * dy);

    e.x += (dx / dist) * e.speed;
    e.y += (dy / dist) * e.speed;

    // anti clump
    enemies.forEach((o, j) => {
      if (i !== j) {
        let dx2 = e.x - o.x;
        let dy2 = e.y - o.y;
        let d = Math.sqrt(dx2 * dx2 + dy2 * dy2);

        if (d < 25) {
          e.x += dx2 * 0.05;
          e.y += dy2 * 0.05;
        }
      }
    });
  });

  // bullet hits enemy
  for (let i = enemies.length - 1; i >= 0; i--) {
    for (let j = bullets.length - 1; j >= 0; j--) {
      let e = enemies[i];
      let b = bullets[j];

      if (
        b.x < e.x + e.size &&
        b.x + b.size > e.x &&
        b.y < e.y + e.size &&
        b.y + b.size > e.y
      ) {
        e.health -= b.damage;
        bullets.splice(j, 1);

        if (e.health <= 0) enemies.splice(i, 1);
        break;
      }
    }
  }

  // spawn boss when empty
  if (enemies.length === 0 && !boss) {
    boss = spawnBoss();
  }

  // boss AI
  if (boss) {
    let dx = player.x - boss.x;
    let dy = player.y - boss.y;
    let dist = Math.sqrt(dx * dx + dy * dy);

    boss.x += (dx / dist) * boss.speed;
    boss.y += (dy / dist) * boss.speed;

    // bullet hit boss
    for (let j = bullets.length - 1; j >= 0; j--) {
      let b = bullets[j];

      if (
        b.x < boss.x + boss.size &&
        b.x + b.size > boss.x &&
        b.y < boss.y + boss.size &&
        b.y + b.size > boss.y
      ) {
        boss.health -= b.damage;
        bullets.splice(j, 1);

        if (boss.health <= 0) {
          boss = null;
          for (let i = 0; i < 6; i++) enemies.push(spawnEnemy());
        }
      }
    }
  }

  // enemy damage
  enemies.forEach(e => {
    let dx = player.x - e.x;
    let dy = player.y - e.y;
    let dist = Math.sqrt(dx * dx + dy * dy);

    if (dist < 20) player.health -= 1;
  });

  if (boss) {
    let dx = player.x - boss.x;
    let dy = player.y - boss.y;
    let dist = Math.sqrt(dx * dx + dy * dy);

    if (dist < 50) player.health -= 2;
  }

  if (player.health <= 0) gameOver = true;
}

// DRAW
function draw() {
  ctx.fillStyle = "white";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // player
  ctx.fillStyle = "black";
  ctx.fillRect(player.x, player.y, player.size, player.size);

  // enemies
  ctx.fillStyle = "green";
  enemies.forEach(e => ctx.fillRect(e.x, e.y, e.size, e.size));

  // boss
  if (boss) {
    ctx.fillStyle = "purple";
    ctx.fillRect(boss.x, boss.y, boss.size, boss.size);
  }

  // bullets
  ctx.fillStyle = "red";
  bullets.forEach(b => ctx.fillRect(b.x, b.y, b.size, b.size));

  // UI
  ctx.fillStyle = "black";
  ctx.fillText("Health: " + player.health, 20, 20);
  ctx.fillText("Enemies: " + enemies.length, 20, 40);

  if (gameOver) {
    ctx.fillText("GAME OVER", canvas.width / 2 - 50, canvas.height / 2);
  }
}

// LOOP
function loop() {
  update();
  draw();
  requestAnimationFrame(loop);
}

loop();
