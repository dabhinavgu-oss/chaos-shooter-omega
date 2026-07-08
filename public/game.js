/* =====================================================================
   CHAOS SHOOTER OMEGA — 3D Voxel Multiplayer Client
   Renders the authoritative server state in 3D:
     - builds terrain from the server's SEED (identical world for all)
     - sends local movement + shots as INTENT; server decides outcomes
     - renders other players as colored blocky avatars + shared enemies
   ===================================================================== */

// ---------- 1) NETWORK + CORE SETUP ----------
const socket = io();
let myId = null, running = false;
let SEED = 0, WORLD = 50, MAX_H = 8;
const heightMap = [];

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87ceeb);
scene.fog = new THREE.Fog(0x87ceeb, 35, 90);
const camera = new THREE.PerspectiveCamera(75, innerWidth/innerHeight, 0.1, 500);

const renderer = new THREE.WebGLRenderer({ antialias: false });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
document.body.appendChild(renderer.domElement);
renderer.autoClear = false; // draw world, then gun overlay on top
const canvas = renderer.domElement;

scene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 0.9));
const sun = new THREE.DirectionalLight(0xffffff, 0.7);
sun.position.set(30, 60, 20); scene.add(sun);

// Gun overlay scene so the weapon never clips into terrain
const gunScene = new THREE.Scene();
const gunCamera = new THREE.PerspectiveCamera(60, innerWidth/innerHeight, 0.01, 10);
gunScene.add(new THREE.HemisphereLight(0xffffff, 0x333333, 1.1));
let gun;
{
  gun = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.14,0.14,0.7), new THREE.MeshLambertMaterial({color:0x333333,flatShading:true}));
  const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.06,0.06,0.4), new THREE.MeshLambertMaterial({color:0x111111,flatShading:true})); barrel.position.set(0,0.02,-0.5);
  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.1,0.22,0.12), new THREE.MeshLambertMaterial({color:0x552200,flatShading:true})); grip.position.set(0,-0.16,0.2);
  gun.add(body, barrel, grip);
  gun.position.set(0.28, -0.28, -0.7);
  gunScene.add(gun);
}

// ---------- 2) TERRAIN (same noise as server so worlds match) ----------
function hash(x,z){ let n=Math.sin((x+SEED)*127.1+(z+SEED)*311.7)*43758.5453; return n-Math.floor(n); }
function smoothNoise(x,z){
  const xi=Math.floor(x), zi=Math.floor(z), xf=x-xi, zf=z-zi;
  const tl=hash(xi,zi), tr=hash(xi+1,zi), bl=hash(xi,zi+1), br=hash(xi+1,zi+1);
  const u=xf*xf*(3-2*xf), v=zf*zf*(3-2*zf);
  const t=tl+(tr-tl)*u, b=bl+(br-bl)*u; return t+(b-t)*v;
}
function terrainHeight(x,z){
  let h = smoothNoise(x*0.12,z*0.12)*0.6 + smoothNoise(x*0.25,z*0.25)*0.3 + smoothNoise(x*0.5,z*0.5)*0.1;
  return Math.floor(h*MAX_H)+1;
}
function groundHeightAt(wx,wz){
  const gx=Math.round(wx), gz=Math.round(wz);
  if(gx<0||gz<0||gx>=WORLD||gz>=WORLD) return 0;
  return heightMap[gx][gz]+0.5;
}
const cubeGeo = new THREE.BoxGeometry(1,1,1);
const matGrass = new THREE.MeshLambertMaterial({color:0x5fa832,flatShading:true});
const matDirt  = new THREE.MeshLambertMaterial({color:0x8a5a2b,flatShading:true});
const matStone = new THREE.MeshLambertMaterial({color:0x808080,flatShading:true});
function buildTerrain(){
  const pos={grass:[],dirt:[],stone:[]};
  for(let x=0;x<WORLD;x++){ heightMap[x]=[];
    for(let z=0;z<WORLD;z++){
      const h=terrainHeight(x,z); heightMap[x][z]=h;
      for(let y=h;y>h-3&&y>=0;y--){ if(y===h)pos.grass.push([x,y,z]); else if(y>h-2)pos.dirt.push([x,y,z]); else pos.stone.push([x,y,z]); }
    }
  }
  const d=new THREE.Object3D();
  const make=(list,mat)=>{ const m=new THREE.InstancedMesh(cubeGeo,mat,list.length);
    list.forEach((p,i)=>{ d.position.set(p[0],p[1],p[2]); d.updateMatrix(); m.setMatrixAt(i,d.matrix); });
    m.instanceMatrix.needsUpdate=true; scene.add(m); };
  make(pos.grass,matGrass); make(pos.dirt,matDirt); make(pos.stone,matStone);
}

// ---------- 3) LOCAL PLAYER + CONTROLS (client prediction) ----------
const me = { x:25, y:0, z:25, yaw:0, pitch:0, vy:0, onGround:false, height:1.7, alive:true };
const keys = {}; const SPEED=6, JUMP=8, GRAVITY=22;
addEventListener('keydown', e=>{ keys[e.code]=true; if(e.code==='KeyR') reload(); });
addEventListener('keyup',   e=>{ keys[e.code]=false; });
document.addEventListener('mousemove', e=>{
  if(document.pointerLockElement!==canvas) return;
  me.yaw   -= e.movementX*0.0022;
  me.pitch -= e.movementY*0.0022;
  me.pitch  = Math.max(-Math.PI/2+0.05, Math.min(Math.PI/2-0.05, me.pitch));
});

function updatePlayer(dt){
  if(!me.alive) return; // frozen while dead (server respawns us)
  const fwd  = new THREE.Vector3(-Math.sin(me.yaw),0,-Math.cos(me.yaw));
  const right= new THREE.Vector3( Math.cos(me.yaw),0,-Math.sin(me.yaw));
  const mv = new THREE.Vector3();
  if(keys['KeyW']) mv.add(fwd); if(keys['KeyS']) mv.sub(fwd);
  if(keys['KeyD']) mv.add(right); if(keys['KeyA']) mv.sub(right);
  if(mv.lengthSq()>0) mv.normalize().multiplyScalar(SPEED);

  const nx=me.x+mv.x*dt, nz=me.z+mv.z*dt;
  if(groundHeightAt(nx,me.z) <= me.y+1.1) me.x=nx;
  if(groundHeightAt(me.x,nz) <= me.y+1.1) me.z=nz;

  if(keys['Space'] && me.onGround){ me.vy=JUMP; me.onGround=false; }
  me.vy -= GRAVITY*dt;
  me.y += me.vy*dt;
  const g = groundHeightAt(me.x,me.z);
  if(me.y<=g){ me.y=g; me.vy=0; me.onGround=true; } else me.onGround=false;
  me.x=Math.max(0.5,Math.min(WORLD-1.5,me.x));
  me.z=Math.max(0.5,Math.min(WORLD-1.5,me.z));

  camera.position.set(me.x, me.y+me.height, me.z);
  camera.rotation.order='YXZ';
  camera.rotation.set(me.pitch, me.yaw, 0);

  socket.emit('move', { x:me.x, y:me.y, z:me.z, yaw:me.yaw });
}

// ---------- 4) SHOOTING (send intent; recoil/ammo are local feel) ----------
const MAG=30, RELOAD=1.3; let ammo=MAG, reloading=false, recoil=0;
canvas.addEventListener('mousedown', e=>{ if(e.button===0) shoot(); });
function shoot(){
  if(!running || !me.alive || reloading || ammo<=0){ if(ammo<=0) reload(); return; }
  ammo--; recoil=0.14; updateAmmo();
  const dir=camera.getWorldDirection(new THREE.Vector3());
  socket.emit('shoot',{ x:camera.position.x, y:camera.position.y, z:camera.position.z, dx:dir.x, dy:dir.y, dz:dir.z });
}
function reload(){
  if(!running||reloading||ammo===MAG) return; reloading=true;
  document.getElementById('ammoText').innerHTML = MAG+' / '+MAG+'<span class="reload">RELOADING…</span>';
  setTimeout(()=>{ ammo=MAG; reloading=false; updateAmmo(); }, RELOAD*1000);
}
function updateAmmo(){ if(!reloading) document.getElementById('ammoText').textContent = ammo+' / '+MAG; }

const tracers=[];
function spawnTracer(o,dir){
  const to=new THREE.Vector3(o.x+dir.x*80, o.y+dir.y*80, o.z+dir.z*80);
  const g=new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(o.x,o.y,o.z),to]);
  const m=new THREE.LineBasicMaterial({color:0xffee44,transparent:true,opacity:1});
  const l=new THREE.Line(g,m); scene.add(l); tracers.push({mesh:l,life:0.08});
}

// ---------- 5) REMOTE ENTITIES (other players + shared enemies) ----------
const otherPlayers={};
const enemyMeshes={};

function makeAvatar(color){
  const g=new THREE.Group();
  const mat=new THREE.MeshLambertMaterial({color:color||0x1e90ff, flatShading:true});
  const head=new THREE.MeshLambertMaterial({color:0xffe0bd, flatShading:true});
  const torso=new THREE.Mesh(new THREE.BoxGeometry(0.6,0.9,0.35),mat); torso.position.y=1.0;
  const hd=new THREE.Mesh(new THREE.BoxGeometry(0.45,0.45,0.45),head); hd.position.y=1.75;
  const legL=new THREE.Mesh(new THREE.BoxGeometry(0.22,0.7,0.25),mat); legL.position.set(-0.16,0.35,0);
  const legR=legL.clone(); legR.position.x=0.16;
  g.add(torso,hd,legL,legR);
  scene.add(g); return g;
}
function makeZombie(){
  const g=new THREE.Group();
  const body=new THREE.MeshLambertMaterial({color:0x3a7d3a,flatShading:true});
  const head=new THREE.MeshLambertMaterial({color:0x2e5e2e,flatShading:true});
  const torso=new THREE.Mesh(new THREE.BoxGeometry(0.6,0.9,0.35),body); torso.position.y=1.0;
  const hd=new THREE.Mesh(new THREE.BoxGeometry(0.45,0.45,0.45),head); hd.position.y=1.75;
  const legL=new THREE.Mesh(new THREE.BoxGeometry(0.22,0.7,0.25),body); legL.position.set(-0.16,0.35,0);
  const legR=legL.clone(); legR.position.x=0.16;
  const armL=new THREE.Mesh(new THREE.BoxGeometry(0.2,0.7,0.2),body); armL.position.set(-0.4,1.05,0.15);
  const armR=armL.clone(); armR.position.x=0.4;
  g.add(torso,hd,legL,legR,armL,armR);
  scene.add(g); return g;
}

// ---------- 6) NETWORKING: apply authoritative snapshots ----------
socket.on('init', (data)=>{
  myId=data.id; SEED=data.seed; WORLD=data.world; MAX_H=data.maxH;
  buildTerrain();
  socket.emit('setName', document.getElementById('nameInput').value);
  socket.emit('setColor', document.getElementById('colorInput').value);
});

socket.on('sync', (state)=>{
  const mine = state.players[myId];
  if(mine){
    document.getElementById('healthBar').style.width = Math.max(0,mine.hp)+'%';
    document.getElementById('score').textContent = mine.score;
    const wasAlive=me.alive; me.alive = mine.alive;
    if(!mine.alive){ document.getElementById('deadOverlay').style.display='flex'; }
    else if(!wasAlive){
      document.getElementById('deadOverlay').style.display='none';
      me.x=mine.x; me.y=mine.y; me.z=mine.z; me.vy=0;
    }
  }
  document.getElementById('wave').textContent = state.wave;
  document.getElementById('pcount').textContent = Object.keys(state.players).length;

  for(const id in state.players){
    if(id===myId) continue;
    const p=state.players[id];
    if(!otherPlayers[id]) otherPlayers[id]=makeAvatar(p.color);
    const g=otherPlayers[id];
    g.visible=p.alive;
    g.position.set(p.x, p.y, p.z);
    g.rotation.y = p.yaw;
  }
  for(const id in otherPlayers){ if(!state.players[id]){ scene.remove(otherPlayers[id]); delete otherPlayers[id]; } }

  const seen={};
  for(const e of state.enemies){
    seen[e.id]=true;
    if(!enemyMeshes[e.id]) enemyMeshes[e.id]=makeZombie();
    const g=enemyMeshes[e.id];
    g.position.set(e.x, e.y, e.z);
    g.rotation.y = Math.atan2(me.x-e.x, me.z-e.z);
  }
  for(const id in enemyMeshes){ if(!seen[id]){ scene.remove(enemyMeshes[id]); delete enemyMeshes[id]; } }
});

socket.on('tracer', (t)=> spawnTracer({x:t.x,y:t.y,z:t.z},{x:t.dx,y:t.dy,z:t.dz}) );
socket.on('removePlayer', (id)=>{ if(otherPlayers[id]){ scene.remove(otherPlayers[id]); delete otherPlayers[id]; } });

const feed=document.getElementById('killfeed');
function addFeed(txt){ const d=document.createElement('div'); d.textContent=txt; feed.appendChild(d);
  setTimeout(()=>d.remove(),4000); while(feed.children.length>5) feed.firstChild.remove(); }
socket.on('playerKilled', (d)=>{ const by = d.by==='zombie'?'a zombie':(d.by===myId?'YOU':'someone'); addFeed(`${d.id===myId?'You were':'A player was'} killed by ${by}`); });
socket.on('playerHit', (d)=>{ if(d.id===myId){ const f=document.getElementById('damageFlash'); f.style.background='rgba(255,0,0,.35)'; setTimeout(()=>f.style.background='rgba(255,0,0,0)',100);} });
socket.on('enemyKilled', (d)=>{ if(d.by===myId) addFeed('+10 zombie down'); });

// ---------- 7) MAIN LOOP ----------
let last=performance.now();
function loop(now){
  requestAnimationFrame(loop);
  const dt=Math.min(0.05,(now-last)/1000); last=now;
  if(running){
    updatePlayer(dt);
    recoil *= 0.8; gun.position.z = -0.7 + recoil;
    for(let i=tracers.length-1;i>=0;i--){ const t=tracers[i]; t.life-=dt;
      t.mesh.material.opacity=Math.max(0,t.life/0.08);
      if(t.life<=0){ scene.remove(t.mesh); tracers.splice(i,1); } }
  }
  renderer.clear();
  renderer.render(scene, camera);
  renderer.clearDepth();
  gunCamera.aspect=camera.aspect;
  renderer.render(gunScene, gunCamera);
}
requestAnimationFrame(loop);

// ---------- 8) START + RESIZE ----------
document.getElementById('playBtn').addEventListener('click', ()=>{
  document.getElementById('startScreen').style.display='none';
  document.getElementById('hud').style.display='block';
  canvas.requestPointerLock();
  running=true;
});
addEventListener('resize', ()=>{
  camera.aspect=innerWidth/innerHeight; camera.updateProjectionMatrix();
  gunCamera.aspect=innerWidth/innerHeight; gunCamera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});/* =====================================================================
   CHAOS SHOOTER OMEGA — 3D Voxel Multiplayer Client
   Renders the authoritative server state in 3D:
     - builds terrain from the server's SEED (identical world for all)
     - sends local movement + shots as INTENT; server decides outcomes
     - renders other players as colored blocky avatars + shared enemies
   ===================================================================== */

// ---------- 1) NETWORK + CORE SETUP ----------
const socket = io();
let myId = null, running = false;
let SEED = 0, WORLD = 50, MAX_H = 8;
const heightMap = [];

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87ceeb);
scene.fog = new THREE.Fog(0x87ceeb, 35, 90);
const camera = new THREE.PerspectiveCamera(75, innerWidth/innerHeight, 0.1, 500);

const renderer = new THREE.WebGLRenderer({ antialias: false });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
document.body.appendChild(renderer.domElement);
renderer.autoClear = false; // draw world, then gun overlay on top
const canvas = renderer.domElement;

scene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 0.9));
const sun = new THREE.DirectionalLight(0xffffff, 0.7);
sun.position.set(30, 60, 20); scene.add(sun);

// Gun overlay scene so the weapon never clips into terrain
const gunScene = new THREE.Scene();
const gunCamera = new THREE.PerspectiveCamera(60, innerWidth/innerHeight, 0.01, 10);
gunScene.add(new THREE.HemisphereLight(0xffffff, 0x333333, 1.1));
let gun;
{
  gun = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.14,0.14,0.7), new THREE.MeshLambertMaterial({color:0x333333,flatShading:true}));
  const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.06,0.06,0.4), new THREE.MeshLambertMaterial({color:0x111111,flatShading:true})); barrel.position.set(0,0.02,-0.5);
  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.1,0.22,0.12), new THREE.MeshLambertMaterial({color:0x552200,flatShading:true})); grip.position.set(0,-0.16,0.2);
  gun.add(body, barrel, grip);
  gun.position.set(0.28, -0.28, -0.7);
  gunScene.add(gun);
}

// ---------- 2) TERRAIN (same noise as server so worlds match) ----------
function hash(x,z){ let n=Math.sin((x+SEED)*127.1+(z+SEED)*311.7)*43758.5453; return n-Math.floor(n); }
function smoothNoise(x,z){
  const xi=Math.floor(x), zi=Math.floor(z), xf=x-xi, zf=z-zi;
  const tl=hash(xi,zi), tr=hash(xi+1,zi), bl=hash(xi,zi+1), br=hash(xi+1,zi+1);
  const u=xf*xf*(3-2*xf), v=zf*zf*(3-2*zf);
  const t=tl+(tr-tl)*u, b=bl+(br-bl)*u; return t+(b-t)*v;
}
function terrainHeight(x,z){
  let h = smoothNoise(x*0.12,z*0.12)*0.6 + smoothNoise(x*0.25,z*0.25)*0.3 + smoothNoise(x*0.5,z*0.5)*0.1;
  return Math.floor(h*MAX_H)+1;
}
function groundHeightAt(wx,wz){
  const gx=Math.round(wx), gz=Math.round(wz);
  if(gx<0||gz<0||gx>=WORLD||gz>=WORLD) return 0;
  return heightMap[gx][gz]+0.5;
}
const cubeGeo = new THREE.BoxGeometry(1,1,1);
const matGrass = new THREE.MeshLambertMaterial({color:0x5fa832,flatShading:true});
const matDirt  = new THREE.MeshLambertMaterial({color:0x8a5a2b,flatShading:true});
const matStone = new THREE.MeshLambertMaterial({color:0x808080,flatShading:true});
function buildTerrain(){
  const pos={grass:[],dirt:[],stone:[]};
  for(let x=0;x<WORLD;x++){ heightMap[x]=[];
    for(let z=0;z<WORLD;z++){
      const h=terrainHeight(x,z); heightMap[x][z]=h;
      for(let y=h;y>h-3&&y>=0;y--){ if(y===h)pos.grass.push([x,y,z]); else if(y>h-2)pos.dirt.push([x,y,z]); else pos.stone.push([x,y,z]); }
    }
  }
  const d=new THREE.Object3D();
  const make=(list,mat)=>{ const m=new THREE.InstancedMesh(cubeGeo,mat,list.length);
    list.forEach((p,i)=>{ d.position.set(p[0],p[1],p[2]); d.updateMatrix(); m.setMatrixAt(i,d.matrix); });
    m.instanceMatrix.needsUpdate=true; scene.add(m); };
  make(pos.grass,matGrass); make(pos.dirt,matDirt); make(pos.stone,matStone);
}

// ---------- 3) LOCAL PLAYER + CONTROLS (client prediction) ----------
const me = { x:25, y:0, z:25, yaw:0, pitch:0, vy:0, onGround:false, height:1.7, alive:true };
const keys = {}; const SPEED=6, JUMP=8, GRAVITY=22;
addEventListener('keydown', e=>{ keys[e.code]=true; if(e.code==='KeyR') reload(); });
addEventListener('keyup',   e=>{ keys[e.code]=false; });
document.addEventListener('mousemove', e=>{
  if(document.pointerLockElement!==canvas) return;
  me.yaw   -= e.movementX*0.0022;
  me.pitch -= e.movementY*0.0022;
  me.pitch  = Math.max(-Math.PI/2+0.05, Math.min(Math.PI/2-0.05, me.pitch));
});

function updatePlayer(dt){
  if(!me.alive) return; // frozen while dead (server respawns us)
  const fwd  = new THREE.Vector3(-Math.sin(me.yaw),0,-Math.cos(me.yaw));
  const right= new THREE.Vector3( Math.cos(me.yaw),0,-Math.sin(me.yaw));
  const mv = new THREE.Vector3();
  if(keys['KeyW']) mv.add(fwd); if(keys['KeyS']) mv.sub(fwd);
  if(keys['KeyD']) mv.add(right); if(keys['KeyA']) mv.sub(right);
  if(mv.lengthSq()>0) mv.normalize().multiplyScalar(SPEED);

  const nx=me.x+mv.x*dt, nz=me.z+mv.z*dt;
  if(groundHeightAt(nx,me.z) <= me.y+1.1) me.x=nx;
  if(groundHeightAt(me.x,nz) <= me.y+1.1) me.z=nz;

  if(keys['Space'] && me.onGround){ me.vy=JUMP; me.onGround=false; }
  me.vy -= GRAVITY*dt;
  me.y += me.vy*dt;
  const g = groundHeightAt(me.x,me.z);
  if(me.y<=g){ me.y=g; me.vy=0; me.onGround=true; } else me.onGround=false;
  me.x=Math.max(0.5,Math.min(WORLD-1.5,me.x));
  me.z=Math.max(0.5,Math.min(WORLD-1.5,me.z));

  camera.position.set(me.x, me.y+me.height, me.z);
  camera.rotation.order='YXZ';
  camera.rotation.set(me.pitch, me.yaw, 0);

  socket.emit('move', { x:me.x, y:me.y, z:me.z, yaw:me.yaw });
}

// ---------- 4) SHOOTING (send intent; recoil/ammo are local feel) ----------
const MAG=30, RELOAD=1.3; let ammo=MAG, reloading=false, recoil=0;
canvas.addEventListener('mousedown', e=>{ if(e.button===0) shoot(); });
function shoot(){
  if(!running || !me.alive || reloading || ammo<=0){ if(ammo<=0) reload(); return; }
  ammo--; recoil=0.14; updateAmmo();
  const dir=camera.getWorldDirection(new THREE.Vector3());
  socket.emit('shoot',{ x:camera.position.x, y:camera.position.y, z:camera.position.z, dx:dir.x, dy:dir.y, dz:dir.z });
}
function reload(){
  if(!running||reloading||ammo===MAG) return; reloading=true;
  document.getElementById('ammoText').innerHTML = MAG+' / '+MAG+'<span class="reload">RELOADING…</span>';
  setTimeout(()=>{ ammo=MAG; reloading=false; updateAmmo(); }, RELOAD*1000);
}
function updateAmmo(){ if(!reloading) document.getElementById('ammoText').textContent = ammo+' / '+MAG; }

const tracers=[];
function spawnTracer(o,dir){
  const to=new THREE.Vector3(o.x+dir.x*80, o.y+dir.y*80, o.z+dir.z*80);
  const g=new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(o.x,o.y,o.z),to]);
  const m=new THREE.LineBasicMaterial({color:0xffee44,transparent:true,opacity:1});
  const l=new THREE.Line(g,m); scene.add(l); tracers.push({mesh:l,life:0.08});
}

// ---------- 5) REMOTE ENTITIES (other players + shared enemies) ----------
const otherPlayers={};
const enemyMeshes={};

function makeAvatar(color){
  const g=new THREE.Group();
  const mat=new THREE.MeshLambertMaterial({color:color||0x1e90ff, flatShading:true});
  const head=new THREE.MeshLambertMaterial({color:0xffe0bd, flatShading:true});
  const torso=new THREE.Mesh(new THREE.BoxGeometry(0.6,0.9,0.35),mat); torso.position.y=1.0;
  const hd=new THREE.Mesh(new THREE.BoxGeometry(0.45,0.45,0.45),head); hd.position.y=1.75;
  const legL=new THREE.Mesh(new THREE.BoxGeometry(0.22,0.7,0.25),mat); legL.position.set(-0.16,0.35,0);
  const legR=legL.clone(); legR.position.x=0.16;
  g.add(torso,hd,legL,legR);
  scene.add(g); return g;
}
function makeZombie(){
  const g=new THREE.Group();
  const body=new THREE.MeshLambertMaterial({color:0x3a7d3a,flatShading:true});
  const head=new THREE.MeshLambertMaterial({color:0x2e5e2e,flatShading:true});
  const torso=new THREE.Mesh(new THREE.BoxGeometry(0.6,0.9,0.35),body); torso.position.y=1.0;
  const hd=new THREE.Mesh(new THREE.BoxGeometry(0.45,0.45,0.45),head); hd.position.y=1.75;
  const legL=new THREE.Mesh(new THREE.BoxGeometry(0.22,0.7,0.25),body); legL.position.set(-0.16,0.35,0);
  const legR=legL.clone(); legR.position.x=0.16;
  const armL=new THREE.Mesh(new THREE.BoxGeometry(0.2,0.7,0.2),body); armL.position.set(-0.4,1.05,0.15);
  const armR=armL.clone(); armR.position.x=0.4;
  g.add(torso,hd,legL,legR,armL,armR);
  scene.add(g); return g;
}

// ---------- 6) NETWORKING: apply authoritative snapshots ----------
socket.on('init', (data)=>{
  myId=data.id; SEED=data.seed; WORLD=data.world; MAX_H=data.maxH;
  buildTerrain();
  socket.emit('setName', document.getElementById('nameInput').value);
  socket.emit('setColor', document.getElementById('colorInput').value);
});

socket.on('sync', (state)=>{
  const mine = state.players[myId];
  if(mine){
    document.getElementById('healthBar').style.width = Math.max(0,mine.hp)+'%';
    document.getElementById('score').textContent = mine.score;
    const wasAlive=me.alive; me.alive = mine.alive;
    if(!mine.alive){ document.getElementById('deadOverlay').style.display='flex'; }
    else if(!wasAlive){
      document.getElementById('deadOverlay').style.display='none';
      me.x=mine.x; me.y=mine.y; me.z=mine.z; me.vy=0;
    }
  }
  document.getElementById('wave').textContent = state.wave;
  document.getElementById('pcount').textContent = Object.keys(state.players).length;

  for(const id in state.players){
    if(id===myId) continue;
    const p=state.players[id];
    if(!otherPlayers[id]) otherPlayers[id]=makeAvatar(p.color);
    const g=otherPlayers[id];
    g.visible=p.alive;
    g.position.set(p.x, p.y, p.z);
    g.rotation.y = p.yaw;
  }
  for(const id in otherPlayers){ if(!state.players[id]){ scene.remove(otherPlayers[id]); delete otherPlayers[id]; } }

  const seen={};
  for(const e of state.enemies){
    seen[e.id]=true;
    if(!enemyMeshes[e.id]) enemyMeshes[e.id]=makeZombie();
    const g=enemyMeshes[e.id];
    g.position.set(e.x, e.y, e.z);
    g.rotation.y = Math.atan2(me.x-e.x, me.z-e.z);
  }
  for(const id in enemyMeshes){ if(!seen[id]){ scene.remove(enemyMeshes[id]); delete enemyMeshes[id]; } }
});

socket.on('tracer', (t)=> spawnTracer({x:t.x,y:t.y,z:t.z},{x:t.dx,y:t.dy,z:t.dz}) );
socket.on('removePlayer', (id)=>{ if(otherPlayers[id]){ scene.remove(otherPlayers[id]); delete otherPlayers[id]; } });

const feed=document.getElementById('killfeed');
function addFeed(txt){ const d=document.createElement('div'); d.textContent=txt; feed.appendChild(d);
  setTimeout(()=>d.remove(),4000); while(feed.children.length>5) feed.firstChild.remove(); }
socket.on('playerKilled', (d)=>{ const by = d.by==='zombie'?'a zombie':(d.by===myId?'YOU':'someone'); addFeed(`${d.id===myId?'You were':'A player was'} killed by ${by}`); });
socket.on('playerHit', (d)=>{ if(d.id===myId){ const f=document.getElementById('damageFlash'); f.style.background='rgba(255,0,0,.35)'; setTimeout(()=>f.style.background='rgba(255,0,0,0)',100);} });
socket.on('enemyKilled', (d)=>{ if(d.by===myId) addFeed('+10 zombie down'); });

// ---------- 7) MAIN LOOP ----------
let last=performance.now();
function loop(now){
  requestAnimationFrame(loop);
  const dt=Math.min(0.05,(now-last)/1000); last=now;
  if(running){
    updatePlayer(dt);
    recoil *= 0.8; gun.position.z = -0.7 + recoil;
    for(let i=tracers.length-1;i>=0;i--){ const t=tracers[i]; t.life-=dt;
      t.mesh.material.opacity=Math.max(0,t.life/0.08);
      if(t.life<=0){ scene.remove(t.mesh); tracers.splice(i,1); } }
  }
  renderer.clear();
  renderer.render(scene, camera);
  renderer.clearDepth();
  gunCamera.aspect=camera.aspect;
  renderer.render(gunScene, gunCamera);
}
requestAnimationFrame(loop);

// ---------- 8) START + RESIZE ----------
document.getElementById('playBtn').addEventListener('click', ()=>{
  document.getElementById('startScreen').style.display='none';
  document.getElementById('hud').style.display='block';
  canvas.requestPointerLock();
  running=true;
});
addEventListener('resize', ()=>{
  camera.aspect=innerWidth/innerHeight; camera.updateProjectionMatrix();
  gunCamera.aspect=innerWidth/innerHeight; gunCamera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});
