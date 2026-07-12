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
scene.fog = new THREE.Fog(0x87ceeb, 45, 120);
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
const me = { x:25, y:0, z:25, yaw:0, pitch:0, vy:0, onGround:false, height:1.7, alive:true, permaDead:false };
const keys = {}; const SPEED=6, JUMP=8, GRAVITY=22;
addEventListener('keydown', e=>{
  keys[e.code]=true;
  if(me.permaDead){
    if(e.code==='ArrowLeft') cycleSpectate(-1);
    if(e.code==='ArrowRight') cycleSpectate(1);
    return;
  }
  if(e.code==='KeyR') reload();
  if(e.code==='KeyG') throwGrenade();
  if(e.code==='KeyQ') drinkPotion();
  if(e.code.startsWith('Digit')){ const n=+e.code.slice(5); if(n>=1&&n<=slots.length) selectSlot(n-1); }
  if(e.code==='Tab'){ e.preventDefault(); if(running) showScoreboard(true); }
});
addEventListener('keyup', e=>{ keys[e.code]=false; if(e.code==='Tab') showScoreboard(false); });
document.addEventListener('mousemove', e=>{
  if(document.pointerLockElement!==canvas) return;
  me.yaw   -= e.movementX*0.0022;
  me.pitch -= e.movementY*0.0022;
  me.pitch  = Math.max(-Math.PI/2+0.05, Math.min(Math.PI/2-0.05, me.pitch));
});

function updatePlayer(dt){
  if(me.permaDead){ updateSpectateCamera(); return; }
  if(!me.alive) return; // frozen while dead (awaiting a teammate's revive)
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
  if(shakeT>0){
    shakeT=Math.max(0,shakeT-dt);
    camera.rotation.x+=(Math.random()-.5)*shakeT*0.12;
    camera.rotation.y+=(Math.random()-.5)*shakeT*0.12;
  }

  socket.emit('move', { x:me.x, y:me.y, z:me.z, yaw:me.yaw });
}

function updateSpectateCamera(){
  if(!lastState) return;
  const ids=Object.keys(lastState.players).filter(id=>id!==myId && lastState.players[id].alive);
  if(!ids.includes(spectateTargetId)) spectateTargetId=ids[0]||null;
  const nameEl=document.getElementById('spectateName');
  if(!spectateTargetId){ if(nameEl) nameEl.textContent='No teammates left to watch'; return; }
  const p=lastState.players[spectateTargetId];
  if(!p) return;
  camera.position.set(p.x, p.y+me.height, p.z);
  camera.rotation.order='YXZ';
  camera.rotation.set(0, p.yaw, 0);
  if(nameEl) nameEl.textContent = 'WATCHING '+(p.name||'Player').toUpperCase()+' \u00b7 \u2190/\u2192 to switch';
}
function cycleSpectate(dir){
  if(!lastState) return;
  const ids=Object.keys(lastState.players).filter(id=>id!==myId && lastState.players[id].alive);
  if(!ids.length) return;
  const idx=(ids.indexOf(spectateTargetId)+dir+ids.length)%ids.length;
  spectateTargetId=ids[idx];
}

// ---------- 4) SHOOTING (send intent; recoil/ammo are local feel) ----------
// Client mirror of the server's weapon table + feel (mag sizes, sounds, kick)
const WEAPONS = {
  pistol:  { label:'PSTL', mag:12, reload:900,  interval:350,  auto:false, kick:0.12, pitch:950  },
  smg:     { label:'SMG',  mag:30, reload:1400, interval:110,  auto:true,  kick:0.05, pitch:1100 },
  shotgun: { label:'SHTG', mag:6,  reload:1800, interval:900,  auto:false, kick:0.22, pitch:480  },
  rifle:   { label:'RIFL', mag:8,  reload:1500, interval:500,  auto:false, kick:0.15, pitch:780  },
  sniper:  { label:'SNPR', mag:4,  reload:2000, interval:1200, auto:false, kick:0.30, pitch:380  },
  minigun: { label:'MNGN', mag:60, reload:2500, interval:60,   auto:true,  kick:0.04, pitch:1250 },
};
const WEAPON_ORDER = ['pistol','smg','shotgun','rifle','sniper','minigun'];
const ITEMS = { grenade:{label:'GRND'}, potion:{label:'POTN'} };

let myWeapons=['pistol'], myItems={grenade:0,potion:0,selfRevive:0};
let slots=[], selected=0;
let ammoBy={ pistol: WEAPONS.pistol.mag };
let reloading=false, recoil=0, firing=false, lastFire=0, drinking=false;
let spectateTargetId=null;

function currentSlot(){ return slots[selected] || {type:'weapon', id:'pistol'}; }

function rebuildHotbar(){
  const ns = WEAPON_ORDER.filter(w=>myWeapons.includes(w)).map(id=>({type:'weapon', id}));
  if(myItems.grenade>0) ns.push({type:'item', id:'grenade'});
  if(myItems.potion>0)  ns.push({type:'item', id:'potion'});
  const curId=currentSlot().id;
  slots=ns;
  const keep=slots.findIndex(s=>s.id===curId);
  selected = keep>=0 ? keep : 0;
  document.getElementById('hotbar').innerHTML = slots.map((s,i)=>{
    const label = s.type==='weapon' ? WEAPONS[s.id].label : ITEMS[s.id].label;
    const count = s.type==='item' ? (myItems[s.id]|0) : (ammoBy[s.id]!=null?ammoBy[s.id]:WEAPONS[s.id].mag);
    return '<div class="slot'+(i===selected?' sel':'')+'"><span class="num">'+(i+1)+'</span><span class="lbl">'+label+'</span><span class="count">'+count+'</span></div>';
  }).join('');
}
function selectSlot(i){
  if(i<0||i>=slots.length||i===selected) return;
  selected=i; reloading=false; drinking=false;
  beep(560,0.04,'square',0.06);
  rebuildHotbar(); updateAmmo();
}

canvas.addEventListener('mousedown', e=>{
  if(e.button!==0) return;
  // After Esc, the first click re-captures the mouse instead of firing
  if(running && document.pointerLockElement!==canvas){ canvas.requestPointerLock(); return; }
  firing=true;
  tryFire();
});
addEventListener('mouseup', e=>{ if(e.button===0) firing=false; });
addEventListener('wheel', e=>{
  if(!running || document.pointerLockElement!==canvas || !slots.length) return;
  selectSlot((selected + (e.deltaY>0?1:-1) + slots.length) % slots.length);
});

function tryFire(){
  if(!running || !me.alive) return;
  const s=currentSlot();
  if(s.type==='item'){
    firing=false;
    if(s.id==='grenade') throwGrenade(); else drinkPotion();
    return;
  }
  const id=s.id, w=WEAPONS[id];
  const t=performance.now();
  if(reloading || drinking || t-lastFire < w.interval) return;
  if((ammoBy[id]|0)<=0){ beep(200,0.05,'square',0.06); reload(); return; }
  lastFire=t; ammoBy[id]--;
  recoil=w.kick;
  beep(w.pitch,0.06,'square',0.10,-500);
  const fl=gun.userData.flash;
  fl.visible=true; fl.rotation.z=Math.random()*Math.PI;
  clearTimeout(fl._t); fl._t=setTimeout(()=>fl.visible=false,50);
  const dir=camera.getWorldDirection(new THREE.Vector3());
  socket.emit('shoot',{ x:camera.position.x, y:camera.position.y, z:camera.position.z, dx:dir.x, dy:dir.y, dz:dir.z, w:id });
  updateAmmo(); rebuildHotbar();
}
function reload(){
  const s=currentSlot();
  if(s.type!=='weapon') return;
  const id=s.id, w=WEAPONS[id];
  if(!running||reloading||ammoBy[id]===w.mag) return;
  reloading=true;
  beep(430,0.07,'square',0.08);
  document.getElementById('ammoText').innerHTML = w.mag+' / '+w.mag+'<span class="reload">RELOADING…</span>';
  clearTimeout(reload._t);
  reload._t=setTimeout(()=>{ ammoBy[id]=w.mag; reloading=false; updateAmmo(); rebuildHotbar(); beep(760,0.07,'square',0.08); }, w.reload);
}
function updateAmmo(){
  if(reloading||drinking) return;
  const s=currentSlot();
  if(s.type==='weapon') document.getElementById('ammoText').textContent=(ammoBy[s.id]|0)+' / '+WEAPONS[s.id].mag;
  else document.getElementById('ammoText').textContent=ITEMS[s.id].label+' \u00d7'+(myItems[s.id]|0);
}
function throwGrenade(){
  if(!running || !me.alive) return;
  if((myItems.grenade|0)<=0){ beep(200,0.05,'square',0.06); return; }
  myItems.grenade--; updateAmmo(); rebuildHotbar();
  beep(340,0.08,'square',0.09);
  recoil=0.1;
  const dir=camera.getWorldDirection(new THREE.Vector3());
  socket.emit('grenade',{ x:camera.position.x, y:camera.position.y, z:camera.position.z, dx:dir.x, dy:dir.y, dz:dir.z });
}
function drinkPotion(){
  if(!running || !me.alive || drinking) return;
  if((myItems.potion|0)<=0){ beep(200,0.05,'square',0.06); return; }
  drinking=true;
  document.getElementById('ammoText').innerHTML='<span class="reload">DRINKING…</span>';
  beep(520,0.3,'sine',0.08,120);
  clearTimeout(drinkPotion._t);
  drinkPotion._t=setTimeout(()=>{
    drinking=false;
    if(me.alive){ socket.emit('potion'); myItems.potion=Math.max(0,myItems.potion-1); }
    updateAmmo(); rebuildHotbar();
  },1500);
}

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
const cardMeshes={};
const reviveStationMeshes=[];

function makeBar(w){
  const cv=document.createElement('canvas'); cv.width=64; cv.height=10;
  const ctx=cv.getContext('2d');
  const tex=new THREE.CanvasTexture(cv);
  const sp=new THREE.Sprite(new THREE.SpriteMaterial({map:tex, transparent:true, depthTest:false}));
  sp.scale.set(w||1.1,0.16,1);
  sp.userData.ratio=-1;
  sp.userData.draw=(r)=>{
    if(Math.abs(r-sp.userData.ratio)<0.01) return;
    sp.userData.ratio=r;
    ctx.clearRect(0,0,64,10);
    ctx.fillStyle='rgba(0,0,0,0.65)'; ctx.fillRect(0,0,64,10);
    ctx.fillStyle = r>0.5?'#7ddf3a':(r>0.25?'#ffb020':'#e5383b');
    ctx.fillRect(2,2,60*Math.max(0,Math.min(1,r)),6);
    tex.needsUpdate=true;
  };
  return sp;
}
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
  const legGeo=new THREE.BoxGeometry(0.22,0.7,0.25); legGeo.translate(0,-0.35,0);   // pivot at hip
  const legL=new THREE.Mesh(legGeo,mat); legL.position.set(-0.16,0.7,0);
  const legR=new THREE.Mesh(legGeo,mat); legR.position.set(0.16,0.7,0);
  const held=new THREE.Mesh(new THREE.BoxGeometry(0.12,0.12,0.5), new THREE.MeshLambertMaterial({color:0x222222,flatShading:true}));
  held.position.set(0.3,1.15,0.3);
  g.add(torso,hd,legL,legR,held);
  const bar=makeBar(0.9); bar.position.y=2.05; bar.visible=false; g.add(bar);
  g.userData.bar=bar;
  g.userData.parts={legL,legR,torso};
  g.userData.phase=Math.random()*6;
  scene.add(g); return g;
}
function buildReviveStations(stations){
  for(const g of reviveStationMeshes) scene.remove(g);
  reviveStationMeshes.length=0;
  for(const s of (stations||[])){
    const y=groundHeightAt(s.x, s.z);
    const grp=new THREE.Group();
    const pole=new THREE.Mesh(new THREE.CylinderGeometry(0.18,0.22,3.2,8),
      new THREE.MeshLambertMaterial({color:0x8ae234, emissive:0x2a5a10, flatShading:true}));
    pole.position.y=1.6;
    const cap=new THREE.Mesh(new THREE.SphereGeometry(0.42,10,10),
      new THREE.MeshLambertMaterial({color:0xffee44, emissive:0x8a7a10, flatShading:true}));
    cap.position.y=3.3;
    grp.add(pole,cap);
    grp.position.set(s.x,y,s.z);
    scene.add(grp);
    reviveStationMeshes.push(grp);
  }
}
function makeZombie(kind, elite){
  const look = {
    walker:    { skin:0x4fae3f, cloth:0x6b4a33, s:1.0  },
    runner:    { skin:0x9fd44a, cloth:0x554433, s:0.85 },
    spitter:   { skin:0xa4c639, cloth:0x3f4a1e, s:0.95 },
    brute:     { skin:0x2f6b33, cloth:0x3a2a1c, s:1.45 },
    leaper:    { skin:0x54c98a, cloth:0x2e4638, s:0.9  },
    screamer:  { skin:0x9b59b6, cloth:0x4a235a, s:1.0  },
    exploder:  { skin:0xd35400, cloth:0x6e2c00, s:0.95 },
    warden:    { skin:0x8b1a1a, cloth:0x2b0f0f, s:1.9  },
    shielder:  { skin:0x6a7f99, cloth:0x1d2a3d, s:1.15 },
    charger:   { skin:0xd2691e, cloth:0x5c1a0a, s:1.05 },
    spawner:   { skin:0xb5c93c, cloth:0x4a4a1c, s:1.1  },
    swarmling: { skin:0x8fd15c, cloth:0x6b5a3a, s:0.55 },
    poisoner:  { skin:0x6fbf5e, cloth:0x3d1f52, s:0.95 },
    burrower:  { skin:0x5a3d24, cloth:0x2e1f12, s:1.0  },
    netter:    { skin:0xcfd6c9, cloth:0x3a3f38, s:0.9  },
    colossus:  { skin:0x5c0f0f, cloth:0x150505, s:2.3  },
  }[kind] || { skin:0x4fae3f, cloth:0x6b4a33, s:1.0 };
  const g=new THREE.Group();
  const emissive = elite ? 0x8a6a00 : 0x000000;   // elites carry a faint gold glow
  const body=new THREE.MeshLambertMaterial({color:look.cloth,flatShading:true,emissive});
  const head=new THREE.MeshLambertMaterial({color:look.skin,flatShading:true,emissive});
  const torso=new THREE.Mesh(new THREE.BoxGeometry(0.6,0.9,0.35),body); torso.position.y=1.0;
  const hd=new THREE.Mesh(new THREE.BoxGeometry(0.45,0.45,0.45),head); hd.position.y=1.75;
  const legGeo=new THREE.BoxGeometry(0.22,0.7,0.25); legGeo.translate(0,-0.35,0);   // pivot at hip
  const legL=new THREE.Mesh(legGeo,body); legL.position.set(-0.16,0.7,0);
  const legR=new THREE.Mesh(legGeo,body); legR.position.set(0.16,0.7,0);
  const armGeo=new THREE.BoxGeometry(0.2,0.7,0.2); armGeo.translate(0,-0.35,0);     // pivot at shoulder
  const armL=new THREE.Mesh(armGeo,head); armL.position.set(-0.4,1.45,0);
  const armR=new THREE.Mesh(armGeo,head); armR.position.set(0.4,1.45,0);
  armL.rotation.x=-1.2; armR.rotation.x=-1.2;   // arms-out shamble (shoulder pivot)
  g.add(torso,hd,legL,legR,armL,armR);
  g.scale.setScalar(look.s * (elite ? 1.12 : 1));
  const bar=makeBar(1.1); bar.position.y=2.3; g.add(bar);
  g.userData.bar=bar;
  g.userData.parts={legL,legR,armL,armR,torso};
  g.userData.kind=kind;
  g.userData.elite=elite;
  g.userData.phase=Math.random()*6;
  scene.add(g); return g;
}

// ---------- SMOOTH NET MOVEMENT: lerp toward 30Hz server snapshots ----------
function setNetTarget(g,x,y,z,yaw){
  if(!g.userData.net){ g.position.set(x,y,z); g.rotation.y=yaw||0; g.userData.net={x,y,z,yaw:yaw||0,moving:false,spd:0}; return; }
  const n=g.userData.net;
  n.spd = Math.hypot(x-n.x, z-n.z)*30;   // units/sec estimated from 30Hz snapshots
  n.moving = n.spd > 0.3;
  n.x=x; n.y=y; n.z=z; n.yaw=yaw||0;
}
function animateNet(dt){
  for(const g of [...Object.values(otherPlayers), ...Object.values(enemyMeshes)]){
    const n=g.userData.net; if(!n) continue;
    const k=Math.min(1, dt*14);
    g.position.x+=(n.x-g.position.x)*k;
    g.position.y+=(n.y-g.position.y)*k;
    g.position.z+=(n.z-g.position.z)*k;
    let dy=n.yaw-g.rotation.y;
    while(dy>Math.PI)dy-=Math.PI*2; while(dy<-Math.PI)dy+=Math.PI*2;
    g.rotation.y+=dy*Math.min(1,dt*10);
    const P=g.userData.parts;
    if(P){
      const rate = 3 + Math.min(11, (n.spd||0)*2.6);   // gait speed follows movement speed
      if(n.moving) g.userData.phase=(g.userData.phase||0)+dt*rate;
      const sw=n.moving?Math.sin(g.userData.phase)*0.7:0;
      if(P.legL)P.legL.rotation.x=sw;
      if(P.legR)P.legR.rotation.x=-sw;
      if(P.torso)P.torso.position.y=1.0+(n.moving?Math.abs(Math.sin(g.userData.phase))*0.05:0);
      let armBase=-1.2;
      const armSw=n.moving?Math.sin(g.userData.phase)*0.2:0;
      if(g.userData.lungeT>0){ g.userData.lungeT-=dt; armBase=-1.75; }   // attack lunge
      if(P.armL)P.armL.rotation.x=armBase+armSw;
      if(P.armR)P.armR.rotation.x=armBase-armSw;
    }
    if(g.userData.kind==='exploder'){
      const p=(Math.sin(performance.now()*0.012)+1)/2;   // menacing pulse
      g.traverse(o=>{ if(o.isMesh&&o.material.emissive) o.material.emissive.setRGB(p*0.9,p*0.15,0); });
    }
  }
}

// ---------- 6) NETWORKING: apply authoritative snapshots ----------
socket.on('init', (data)=>{
  myId=data.id; SEED=data.seed; WORLD=data.world; MAX_H=data.maxH;
  buildTerrain();
  buildReviveStations(data.reviveStations);
  const spawn = data.players[data.id];   // server picked a random spawn for us
  if(spawn){ me.x=spawn.x; me.y=spawn.y; me.z=spawn.z; me.vy=0; }
  socket.emit('setName', document.getElementById('nameInput').value);
  socket.emit('setColor', document.getElementById('colorInput').value);
});

let lastState=null, lastGearKey='';
socket.on('sync', (state)=>{
  lastState=state;
  const mine = state.players[myId];
  if(mine){
    document.getElementById('healthBar').style.width = Math.max(0,mine.hp)+'%';
    if(me.alive && mine.alive && mine.hp < lastHp) flashDamage();
    lastHp = mine.hp;
    const bar=document.getElementById('healthBar');
    bar.className = mine.hp<=25 ? 'crit' : (mine.hp<=50 ? 'low' : '');
    document.getElementById('healthLabel').textContent = mine.invuln ? 'HEALTH \u00b7 PROTECTED' : 'HEALTH';
    document.getElementById('shieldBar').style.width=(Math.max(0,mine.shield||0)/50*100)+'%';
    const gearKey=JSON.stringify([mine.weapons,mine.items]);
    if(gearKey!==lastGearKey){
      lastGearKey=gearKey;
      myWeapons=(mine.weapons||['pistol']).slice();
      myItems=Object.assign({grenade:0,potion:0,selfRevive:0}, mine.items||{});
      for(const wid of myWeapons) if(ammoBy[wid]==null) ammoBy[wid]=WEAPONS[wid].mag;
      rebuildHotbar(); updateAmmo();
    }
    document.getElementById('score').textContent = mine.score;
    document.getElementById('reviveCount').textContent = myItems.selfRevive||0;
    document.getElementById('reviveCountWrap').style.display = myItems.selfRevive>0 ? 'inline' : 'none';

    const wasAlive=me.alive; me.alive = mine.alive; me.permaDead = !!mine.permaDead;
    if(!mine.alive){
      if(wasAlive) beep(220,0.7,'sawtooth',0.16,-190);
      if(!mine.permaDead){
        const multi = Object.keys(state.players).length > 1;
        const myCard = multi ? (state.reviveCards||[]).find(c=>c.forId===myId) : null;
        let msg = 'YOU DIED';
        if(multi){
          msg = myCard && myCard.carriedBy ? 'A TEAMMATE HAS YOUR CARD \u2014 GET TO A REVIVER'
              : 'YOU DIED \u2014 A TEAMMATE MUST GRAB YOUR REVIVE CARD';
        }
        document.getElementById('deadOverlay').textContent = msg;
        document.getElementById('deadOverlay').style.display='flex';
      }
    }
    else if(!wasAlive){
      document.getElementById('deadOverlay').style.display='none';
      document.getElementById('spectateOverlay').style.display='none';
      document.getElementById('gameOverOverlay').style.display='none';
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
    setNetTarget(g, p.x, p.y, p.z, p.yaw);
    if(g.userData.bar){
      const r=Math.max(0,p.hp)/100;
      g.userData.bar.visible = p.alive && r<0.999;
      g.userData.bar.userData.draw(r);
    }
  }
  for(const id in otherPlayers){ if(!state.players[id]){ scene.remove(otherPlayers[id]); delete otherPlayers[id]; } }

  // --- Revive cards: ground mesh while lying around, HUD while carried ---
  const myCard = (state.reviveCards||[]).find(c=>c.carriedBy===myId);
  const reviveHud = document.getElementById('reviveHud');
  if(myCard){
    const pct = Math.min(100, myCard.channelProgress/5*100).toFixed(0);
    reviveHud.style.display='block';
    reviveHud.innerHTML = 'CARRYING '+(myCard.forName||'TEAMMATE').toUpperCase()+'\u2019S REVIVE CARD<br/>GET TO A REVIVER'
      + '<div class="bar"><div style="width:'+pct+'%"></div></div>'
      + Math.min(5,myCard.channelProgress).toFixed(1)+'s / 5s';
  } else {
    reviveHud.style.display='none';
  }
  const cseen={};
  for(const c of (state.reviveCards||[])){
    if(c.carriedBy){ if(cardMeshes[c.id]){ scene.remove(cardMeshes[c.id]); delete cardMeshes[c.id]; } continue; }
    cseen[c.id]=true;
    if(!cardMeshes[c.id]){
      const m=new THREE.Mesh(new THREE.BoxGeometry(0.42,0.58,0.06),
        new THREE.MeshLambertMaterial({color:0xffee44, emissive:0x8a7a10, flatShading:true}));
      scene.add(m); cardMeshes[c.id]=m;
    }
    const m=cardMeshes[c.id];
    m.position.set(c.x, c.y+0.9, c.z);
    m.rotation.y += 0.03;
  }
  for(const id in cardMeshes){ if(!cseen[id]){ scene.remove(cardMeshes[id]); delete cardMeshes[id]; } }

  const seen={};
  for(const e of state.enemies){
    seen[e.id]=true;
    if(!enemyMeshes[e.id]) enemyMeshes[e.id]=makeZombie(e.kind, e.elite);
    const g=enemyMeshes[e.id];
    setNetTarget(g, e.x, e.y, e.z, e.yaw);
    g.visible = !e.burrowed;   // burrowers stay hidden until they erupt
    if(g.userData.bar) g.userData.bar.userData.draw(Math.max(0,e.hp)/(e.maxHp||e.hp||1));
  }
  for(const id in enemyMeshes){ if(!seen[id]){ scene.remove(enemyMeshes[id]); delete enemyMeshes[id]; } }

  const pseen={};
  for(const pk of (state.pickups||[])){
    pseen[pk.id]=true;
    if(!pickupMeshes[pk.id]){
      const c = pk.kind==='health' ? 0xff4444 : 0xffee44;
      const m=new THREE.Mesh(new THREE.BoxGeometry(0.45,0.45,0.45),
        new THREE.MeshLambertMaterial({color:c, emissive:c, emissiveIntensity:0.35}));
      m.position.set(pk.x, pk.y+0.9, pk.z);
      m.userData.base=pk.y+0.9;
      scene.add(m); pickupMeshes[pk.id]=m;
    }
  }
  for(const id in pickupMeshes){ if(!pseen[id]){ scene.remove(pickupMeshes[id]); delete pickupMeshes[id]; } }

  syncSimple(state.blobs, blobMeshes, ()=>{
    const m=new THREE.Mesh(new THREE.BoxGeometry(0.28,0.28,0.28),
      new THREE.MeshLambertMaterial({color:0x7fff00, emissive:0x39d353}));
    scene.add(m); return m;
  });
  syncSimple(state.grenades, grenadeMeshes, ()=>{
    const m=new THREE.Mesh(new THREE.BoxGeometry(0.22,0.22,0.22),
      new THREE.MeshLambertMaterial({color:0x333333}));
    scene.add(m); return m;
  });
});
const pickupMeshes={};
const blobMeshes={}, grenadeMeshes={};
function syncSimple(list, map, make){
  const seen={};
  for(const o of (list||[])){
    seen[o.id]=true;
    if(!map[o.id]) map[o.id]=make();
    map[o.id].position.set(o.x,o.y,o.z);
  }
  for(const id in map){ if(!seen[id]){ scene.remove(map[id]); delete map[id]; } }
}
socket.on('pickup', (d)=>{
  const m=pickupMeshes[d.id];
  if(m){ scene.remove(m); delete pickupMeshes[d.id]; }
  if(d.by===myId){
    if(d.kind==='ammo'){ for(const wid of myWeapons) ammoBy[wid]=WEAPONS[wid].mag; reloading=false; updateAmmo(); rebuildHotbar(); addFeed('AMMO REFILLED'); beep(500,0.07,'square',0.10); setTimeout(()=>beep(820,0.09,'square',0.10),90); }
    else { addFeed('+30 HP'); beep(620,0.08,'triangle',0.12); setTimeout(()=>beep(930,0.12,'triangle',0.12),90); }
  }
});

function showScoreboard(on){
  const el=document.getElementById('scoreboard');
  if(!on){ el.style.display='none'; return; }
  if(!lastState) return;
  const esc=s=>String(s).replace(/[&<>"]/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  el.querySelector('tbody').innerHTML = Object.entries(lastState.players)
    .sort((a,b)=>b[1].score-a[1].score)
    .map(([id,p])=>'<tr class="'+(id===myId?'me':'')+'"><td><span class="sw" style="background:'+esc(p.color)+'"></span>'+esc(p.name)+'</td><td>'+p.score+'</td><td>'+(p.alive?Math.max(0,p.hp)+' HP':'DEAD')+'</td></tr>')
    .join('');
  el.style.display='block';
}

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

let lastReward=null, shakeT=0;
socket.on('reward', (d)=>{
  lastReward=d;
  const label = d.kind==='weapon'
    ? ((WEAPONS[d.id]||{}).label||d.id)
    : ((ITEMS[d.id]||{}).label||d.id)+' \u00d7'+(d.n||1);
  addFeed('REWARD: '+label);
  beep(520,0.1,'square',0.1); setTimeout(()=>beep(780,0.14,'square',0.1),120);
});
socket.on('enemyAttack', (d)=>{ const g=enemyMeshes[d.id]; if(g) g.userData.lungeT=0.3; });
socket.on('explosion', (d)=>{
  for(let i=0;i<14;i++){
    const m=new THREE.Mesh(new THREE.BoxGeometry(0.2,0.2,0.2),
      new THREE.MeshLambertMaterial({color:i%2?0xffb020:0xff5722, transparent:true}));
    m.position.set(d.x+(Math.random()-.5), d.y+(Math.random()-.5), d.z+(Math.random()-.5));
    m.userData.v=new THREE.Vector3((Math.random()-.5)*9, 2+Math.random()*5, (Math.random()-.5)*9);
    m.userData.life=0.7;
    scene.add(m); particles.push(m);
  }
  const dd=Math.hypot(me.x-d.x, me.z-d.z);
  if(dd<14) shakeT=Math.max(shakeT, 0.35*(1-dd/14));
  beep(90,0.5,'sawtooth',Math.max(0.05,0.22-dd*0.01),-40);
});

let bannerWave=1, bannerInter=0;
function updateWaveBanner(w, inter){
  const el=document.getElementById('waveBanner');
  if(inter>0){
    el.style.display='block';
    const rw=(lastReward && lastReward.wave===w)
      ? ' \u2014 +'+(lastReward.kind==='weapon'
          ? ((WEAPONS[lastReward.id]||{}).label||lastReward.id)
          : ((ITEMS[lastReward.id]||{}).label||lastReward.id)+' \u00d7'+(lastReward.n||1))
      : '';
    el.textContent = 'WAVE '+w+' CLEARED'+rw+' \u2014 NEXT IN '+inter;
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
socket.on('netted', (d)=>{ if(d.id===myId){ beep(200,0.3,'sine',0.1,-80); addFeed('NETTED \u2014 CAN\u2019T MOVE'); } });
socket.on('gameOver', (d)=>{
  if(d.id!==myId) return;
  document.getElementById('deadOverlay').style.display='none';
  const mine=lastState && lastState.players[myId];
  document.getElementById('gameOverStats').textContent =
    'FINAL SCORE: '+(mine?mine.score:0)+'   \u00b7   REACHED WAVE '+(lastState?lastState.wave:1);
  document.getElementById('gameOverOverlay').style.display='flex';
});
socket.on('playerSpectating', (d)=>{
  if(d.id!==myId) return;
  document.getElementById('deadOverlay').style.display='none';
  spectateTargetId=null;
  document.getElementById('spectateOverlay').style.display='flex';
});
socket.on('selfRevived', (d)=>{ if(d.id===myId){ addFeed('SELF-REVIVE USED'); beep(500,0.3,'sine',0.15,140); } });
socket.on('playerRevived', (d)=>{
  if(d.id===myId) addFeed('BACK IN THE FIGHT');
  else if(roster[d.id]) addFeed(roster[d.id]+' is back up');
});
socket.on('cardPickedUp', (d)=>{ addFeed((d.by===myId?'You':'A teammate')+' grabbed '+(d.forName||'a')+'\u2019s card'); });
socket.on('cardReady', (d)=>{ addFeed((d.forName||'Teammate')+' will be back next wave'); beep(600,0.25,'sine',0.12,200); });
socket.on('enemyKilled', (d)=>{
  if(d.by===myId){
    addFeed('+'+(d.pts||10)+' '+(d.elite?'ELITE ':'')+(d.kind||'zombie')+' down');
    hitmark(); beep(d.kind==='brute'||d.kind==='colossus'?170:320,0.18,'sawtooth',0.12,-220);
  }
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
    if(firing) tryFire();
    for(let i=tracers.length-1;i>=0;i--){ const t=tracers[i]; t.life-=dt;
      t.mesh.material.opacity=Math.max(0,t.life/0.08);
      if(t.life<=0){ scene.remove(t.mesh); tracers.splice(i,1); } }
    for(let i=particles.length-1;i>=0;i--){ const m=particles[i];
      m.userData.life-=dt; m.userData.v.y-=12*dt;
      m.position.addScaledVector(m.userData.v,dt);
      m.material.opacity=Math.max(0,m.userData.life/0.6);
      if(m.userData.life<=0){ scene.remove(m); particles.splice(i,1); } }
  }
  animateNet(dt);
  for(const id in pickupMeshes){
    const m=pickupMeshes[id];
    m.rotation.y+=dt*2.5;
    m.position.y=m.userData.base+Math.sin(now*0.004)*0.12;
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
document.getElementById('restartBtn').addEventListener('click', ()=>location.reload());
addEventListener('resize', ()=>{
  camera.aspect=innerWidth/innerHeight; camera.updateProjectionMatrix();
  gunCamera.aspect=innerWidth/innerHeight; gunCamera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});
