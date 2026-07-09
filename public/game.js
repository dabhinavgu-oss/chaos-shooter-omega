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

// ---------- AUDIO: tiny WebAudio synth (no asset files needed) ----------
let AC = null;
function beep(freq, dur, type='square', vol=0.12, slide=0){
  if(!AC) return;
  const t=AC.currentTime, o=AC.createOscillator(), g=AC.createGain();
  o.type=type; o.frequency.setValueAtTime(freq,t);
  if(slide) o.frequency.exponentialRampToValueAtTime(Math.max(30,freq+slide), t+dur);
  g.gain.setValueAtTime(vol,t); g.gain.exponentialRampToValueAtTime(0.0001,t+dur);
  o.connect(g); g.connect(AC.destination); o.start(t); o.stop(t+dur);
}

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
  const flash = new THREE.Mesh(new THREE.BoxGeometry(0.16,0.16,0.16), new THREE.MeshBasicMaterial({color:0xffee44}));
  flash.position.set(0, 0.02, -0.76); flash.visible=false;
  gun.add(body, barrel, grip, flash);
  gun.userData.flash = flash;
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
canvas.addEventListener('mousedown', e=>{
  if(e.button!==0) return;
  // After Esc, the first click re-captures the mouse instead of firing
  if(running && document.pointerLockElement!==canvas){ canvas.requestPointerLock(); return; }
  shoot();
});
function shoot(){
  if(!running || !me.alive || reloading || ammo<=0){
    if(ammo<=0){ beep(200,0.05,'square',0.06); reload(); }
    return;
  }
  ammo--; recoil=0.14; updateAmmo();
  beep(950,0.07,'square',0.10,-600);
  const fl=gun.userData.flash;
  fl.visible=true; fl.rotation.z=Math.random()*Math.PI;
  clearTimeout(fl._t); fl._t=setTimeout(()=>fl.visible=false,55);
  const dir=camera.getWorldDirection(new THREE.Vector3());
  socket.emit('shoot',{ x:camera.position.x, y:camera.position.y, z:camera.position.z, dx:dir.x, dy:dir.y, dz:dir.z });
}
function reload(){
  if(!running||reloading||ammo===MAG) return; reloading=true;
  beep(430,0.07,'square',0.08);
  document.getElementById('ammoText').innerHTML = MAG+' / '+MAG+'<span class="reload">RELOADING…</span>';
  setTimeout(()=>{ ammo=MAG; reloading=false; updateAmmo(); beep(760,0.07,'square',0.08); }, RELOAD*1000);
}
function updateAmmo(){ if(!reloading) document.getElementById('ammoText').textContent = ammo+' / '+MAG; }

const tracers=[];
const particles=[];
function poof(pos){
  for(let i=0;i<8;i++){
    const m=new THREE.Mesh(new THREE.BoxGeometry(0.16,0.16,0.16),
      new THREE.MeshLambertMaterial({color: Math.random()<0.5?0x6b4a33:0x4fae3f, transparent:true}));
    m.position.set(pos.x+(Math.random()-.5)*.5, pos.y+1+(Math.random()-.5)*.8, pos.z+(Math.random()-.5)*.5);
    m.userData.v=new THREE.Vector3((Math.random()-.5)*4, 2+Math.random()*3, (Math.random()-.5)*4);
    m.userData.life=0.6;
    scene.add(m); particles.push(m);
  }
}
function spawnTracer(o,dir){
  const to=new THREE.Vector3(o.x+dir.x*80, o.y+dir.y*80, o.z+dir.z*80);
  const g=new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(o.x,o.y,o.z),to]);
  const m=new THREE.LineBasicMaterial({color:0xffee44,transparent:true,opacity:1});
  const l=new THREE.Line(g,m); scene.add(l); tracers.push({mesh:l,life:0.08});
}

// ---------- 5) REMOTE ENTITIES (other players + shared enemies) ----------
const otherPlayers={};
const roster={};   // id -> latest name (killfeed + nametags)
let lastHp=100;    // detect hp drops so ANY damage flashes (zombies included)
const enemyMeshes={};

function makeNameTag(text){
  const cv=document.createElement('canvas'); cv.width=256; cv.height=64;
  const ctx=cv.getContext('2d');
  ctx.font='bold 30px monospace'; ctx.textAlign='center'; ctx.textBaseline='middle';
  const w=Math.min(244, ctx.measureText(text).width+28);
  ctx.fillStyle='rgba(0,0,0,0.55)'; ctx.fillRect(128-w/2, 10, w, 44);
  ctx.fillStyle='#ffffff'; ctx.fillText(text, 128, 33);
  const sp=new THREE.Sprite(new THREE.SpriteMaterial({map:new THREE.CanvasTexture(cv), transparent:true}));
  sp.scale.set(2.2, 0.55, 1);
  sp.position.y=2.35;
  return sp;
}
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
  const body=new THREE.MeshLambertMaterial({color:0x6b4a33,flatShading:true});   // torn clothes
  const head=new THREE.MeshLambertMaterial({color:0x4fae3f,flatShading:true});   // zombie skin, pops against grass
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
  const spawn = data.players[data.id];   // server picked a random spawn for us
  if(spawn){ me.x=spawn.x; me.y=spawn.y; me.z=spawn.z; me.vy=0; }
  socket.emit('setName', document.getElementById('nameInput').value);
  socket.emit('setColor', document.getElementById('colorInput').value);
});

socket.on('sync', (state)=>{
  const mine = state.players[myId];
  if(mine){
    document.getElementById('healthBar').style.width = Math.max(0,mine.hp)+'%';
    if(me.alive && mine.alive && mine.hp < lastHp) flashDamage();
    lastHp = mine.hp;
    const bar=document.getElementById('healthBar');
    bar.className = mine.hp<=25 ? 'crit' : (mine.hp<=50 ? 'low' : '');
    document.getElementById('healthLabel').textContent = mine.invuln ? 'HEALTH \u00b7 PROTECTED' : 'HEALTH';
    document.getElementById('score').textContent = mine.score;
    const wasAlive=me.alive; me.alive = mine.alive;
    if(!mine.alive){
      if(wasAlive) beep(220,0.7,'sawtooth',0.16,-190);
      document.getElementById('deadOverlay').style.display='flex';
    }
    else if(!wasAlive){
      document.getElementById('deadOverlay').style.display='none';
      me.x=mine.x; me.y=mine.y; me.z=mine.z; me.vy=0;
    }
  }
  document.getElementById('wave').textContent = state.wave;
  document.getElementById('pcount').textContent = Object.keys(state.players).length;
  document.getElementById('left').textContent = state.left!=null ? state.left : '\u2013';
  updateWaveBanner(state.wave, state.intermission|0);

  for(const id in state.players){
    roster[id]=state.players[id].name;
    if(id===myId) continue;
    const p=state.players[id];
    if(!otherPlayers[id]) otherPlayers[id]=makeAvatar(p.color);
    const g=otherPlayers[id];
    if(g.userData.name!==p.name){
      if(g.userData.tag) g.remove(g.userData.tag);
      const tag=makeNameTag(p.name); g.add(tag);
      g.userData.tag=tag; g.userData.name=p.name;
    }
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

function hitmark(){
  const c=document.getElementById('crosshair');
  c.classList.add('hit');
  clearTimeout(hitmark._t); hitmark._t=setTimeout(()=>c.classList.remove('hit'),120);
}
socket.on('enemyHit', (d)=>{
  if(d.by===myId){ hitmark(); beep(1500,0.045,'triangle',0.10); }
  const g=enemyMeshes[d.id];
  if(g){
    g.traverse(o=>{ if(o.isMesh) o.material.emissive.setHex(0xff4422); });
    clearTimeout(g._ft); g._ft=setTimeout(()=>g.traverse(o=>{ if(o.isMesh) o.material.emissive.setHex(0x000000); }),110);
  }
});

let bannerWave=1, bannerInter=0;
function updateWaveBanner(w, inter){
  const el=document.getElementById('waveBanner');
  if(inter>0){
    el.style.display='block';
    el.textContent = 'WAVE '+w+' CLEARED \u2014 NEXT IN '+inter;
    if(bannerInter===0){ beep(660,0.09,'square',0.10); setTimeout(()=>beep(880,0.09,'square',0.10),110); setTimeout(()=>beep(1100,0.12,'square',0.10),220); }
  } else if(w!==bannerWave){
    el.style.display='block'; el.textContent='WAVE '+w;
    clearTimeout(updateWaveBanner._t);
    updateWaveBanner._t=setTimeout(()=>{ el.style.display='none'; },1600);
  } else if(bannerInter>0){
    el.style.display='none';
  }
  bannerWave=w; bannerInter=inter;
}
socket.on('removePlayer', (id)=>{ if(otherPlayers[id]){ scene.remove(otherPlayers[id]); delete otherPlayers[id]; } });

const feed=document.getElementById('killfeed');
function addFeed(txt){ const d=document.createElement('div'); d.textContent=txt; feed.appendChild(d);
  setTimeout(()=>d.remove(),4000); while(feed.children.length>5) feed.firstChild.remove(); }
socket.on('playerKilled', (d)=>{
  const victim = d.id===myId ? 'You were' : `${roster[d.id]||'A player'} was`;
  const by = d.by==='zombie' ? 'a zombie' : (d.by===myId ? 'YOU' : (roster[d.by]||'someone'));
  addFeed(`${victim} killed by ${by}`);
});
function flashDamage(){
  beep(150,0.22,'sawtooth',0.14,-60);
  const f=document.getElementById('damageFlash');
  f.style.background='rgba(255,0,0,.35)';
  setTimeout(()=>f.style.background='rgba(255,0,0,0)',100);
}
socket.on('playerHit', (d)=>{ if(d.id===myId) flashDamage(); });
socket.on('enemyKilled', (d)=>{
  if(d.by===myId){ addFeed('+10 zombie down'); hitmark(); beep(320,0.18,'sawtooth',0.12,-220); }
  const g=enemyMeshes[d.id];
  if(g){ poof(g.position); scene.remove(g); delete enemyMeshes[d.id]; }
});

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
    for(let i=particles.length-1;i>=0;i--){ const m=particles[i];
      m.userData.life-=dt; m.userData.v.y-=12*dt;
      m.position.addScaledVector(m.userData.v,dt);
      m.material.opacity=Math.max(0,m.userData.life/0.6);
      if(m.userData.life<=0){ scene.remove(m); particles.splice(i,1); } }
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
  if(!AC){ try{ AC=new (window.AudioContext||window.webkitAudioContext)(); }catch(e){} }
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
