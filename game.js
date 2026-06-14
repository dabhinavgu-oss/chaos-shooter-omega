const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");

canvas.width = window.innerWidth;
canvas.height = window.innerHeight;

// ================= PLAYER =================
const player = {
  x: canvas.width / 2,
  y: canvas.height / 2,
  size: 22,
  speed: 5,
  health: 100
};

let gameOver = false;

// ================= STATE =================
let wave = 1;
let score = 0;
let coins = 0;
let enemiesToSpawn = 5;
let inShop = false;
let boss = null;

// ================= INPUT =================
const keys = {};
let mouse = { x: 0, y: 0 };

window.addEventListener("keydown", (e) => {
  keys[e.key.toLowerCase()] = true;

  if (e.key === "1") currentWeapon = "pistol";
  if (e.key === "2") currentWeapon = "smg";
  if (e.key === "3") currentWeapon = "shotgun";

  if (e.key === "Tab") {
    e.preventDefault();
    inShop = !inShop;
  }
});

window.addEventListener("keyup", (e) => {
  keys[e.key.toLowerCase()] = false;
});

window.addEventListener("mousemove", (e) => {
  mouse.x = e.clientX;
  mouse.y = e.clientY;
});

// ================= MOBILE MOVE =================
window.addEventListener("touchmove", (e) => {
  const t = e.touches[0];
  player.x += (t.clientX - canvas.width / 2) * 0.02;
  player.y += (t.clientY - canvas.height / 2) * 0.02;
});

// ================= WEAPONS =================
const weapons = {
  pistol: { cooldown: 300, speed: 6, damage: 10 },
  smg: { cooldown: 90, speed: 7, damage: 6 },
  shotgun: { cooldown: 600, speed: 5, damage: 8, pellets: 6 }
};

let currentWeapon = "pistol";
let lastShot = 0;

// ================= ENTITIES =================
const bullets = [];
const enemies = [];
const grenades = [];

// ================= SHOOT =================
function shoot() {
  if (gameOver || inShop) return;

  const now = Date.now();
  const w = weapons[currentWeapon];

  if (now - lastShot < w.cooldown) return;
  lastShot = now;

  const angle = Math.atan2(mouse.y - player.y, mouse.x - player.x);
  const count = w.pellets || 1;

  for (let i = 0; i < count; i++) {
    const spread = (Math.random() - 0.5) * 0.4;

    bullets.push({
      x: player.x,
      y: player.y,
      dx: Math.cos(angle + spread) * w.speed,
      dy: Math.sin(angle + spread) * w.speed,
      size: 5,
      damage: w.damage
    });
  }
}

window.addEventListener("mousedown", shoot);

// mobile fire button
document.getElementById("shootBtn").addEventListener("touchstart", shoot);
document.getElementById("shootBtn").addEventListener("mousedown", shoot);

// ================= ENEMIES =================
function spawnEnemy() {
  return {
    x: Math.random() * canvas.width,
    y: Math.random() * canvas.height,
    size: 25,
    speed: 1 + wave * 0.1,
    health: 20 + wave * 5
  };
}

function spawnBoss() {
  return {
    x: canvas.width / 2,
    y: 100,
    size: 80,
    speed: 1.5,
    health: 300 + wave * 50
  };
}

function startWave() {
  enemies.length = 0;

  for (let i = 0; i < enemiesToSpawn; i++) {
    enemies.push(spawnEnemy());
  }

  if (wave % 3 === 0) {
    boss = spawnBoss();
  } else {
    boss = null;
  }
}

startWave();

// ================= UPDATE =================
function update() {
  if (gameOver || inShop) return;

  let speed = player.speed;

  if (keys["w"]) player.y -= speed;
  if (keys["s"]) player.y += speed;
  if (keys["a"]) player.x -= speed;
  if (keys["d"]) player.x += speed;

  // bullets
  bullets.forEach(b => {
    b.x += b.dx;
    b.y += b.dy;
  });

  // enemies + anti-clump
  enemies.forEach((e, i) => {
    let dx = player.x - e.x;
    let dy = player.y - e.y;
    let dist = Math.sqrt(dx * dx + dy * dy);

    e.x += (dx / dist) * e.speed;
    e.y += (dy / dist) * e.speed;

    enemies.forEach((o, j) => {
      if (i !== j) {
        let dx2 = e.x - o.x;
        let dy2 = e.y - o.y;
        let d = Math.sqrt(dx2 * dx2 + dy2 * dy2);

        if (d < 25 && d > 0) {
          e.x += dx2 * 0.05;
          e.y += dy2 * 0.05;
        }
      }
    });
  });

  // boss AI
  if (boss) {
    let dx = player.x - boss.x;
    let dy = player.y - boss.y;
    let dist = Math.sqrt(dx * dx + dy * dy);

    boss.x += (dx / dist) * boss.speed;
    boss.y += (dy / dist) * boss.speed;
  }

  // bullet hits
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

        if (e.health <= 0) {
          enemies.splice(i, 1);
          score += 10;
          coins += 5;
        }
        break;
      }
    }
  }

  // boss hit
  if (boss) {
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
      }
    }

    if (boss.health <= 0) {
      boss = null;
      score += 100;
      coins += 50;
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

  // GAME OVER
  if (player.health <= 0) {
    gameOver = true;
  }

  // next wave
  if (enemies.length === 0 && !boss) {
    wave++;
    enemiesToSpawn += 2;
    startWave();
    inShop = true;
  }
}

// ================= DRAW =================
function draw() {
  ctx.fillStyle = "white";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.fillStyle = "black";
  ctx.fillRect(player.x, player.y, player.size, player.size);

  ctx.fillStyle = "green";
  enemies.forEach(e => ctx.fillRect(e.x, e.y, e.size, e.size));

  if (boss) {
    ctx.fillStyle = "purple";
    ctx.fillRect(boss.x, boss.y, boss.size, boss.size);
  }

  ctx.fillStyle = "red";
  bullets.forEach(b => ctx.fillRect(b.x, b.y, b.size, b.size));

  ctx.fillStyle = "black";
  ctx.fillText("Wave: " + wave, 20, 20);
  ctx.fillText("Score: " + score, 20, 40);
  ctx.fillText("Coins: " + coins, 20, 60);
  ctx.fillText("Health: " + player.health, 20, 80);

  if (gameOver) {
    ctx.fillStyle = "rgba(0,0,0,0.7)";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.fillStyle = "white";
    ctx.font = "40px Arial";
    ctx.fillText("GAME OVER", canvas.width / 2 - 100, canvas.height / 2);
  }
}

// ================= LOOP =================
function loop() {
  update();
  draw();
  requestAnimationFrame(loop);
}

loop();