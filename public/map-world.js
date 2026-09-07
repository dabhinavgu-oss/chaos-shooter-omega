/* =====================================================================
   CHAOS SHOOTER OMEGA — REAL MAP GEOMETRY
   The lobby maps are now physical voxel layouts, not just recolors.
   Each layout creates walls, buildings, towers, outposts, crates and lanes.
   ===================================================================== */
(() => {
  const GROUP_NAME = '__CSO_MAP_GEOMETRY__';
  let group = null;
  let collision = [];
  let builtFor = '';

  const mats = {};
  function mat(color, metal = false) {
    const key = color + ':' + metal;
    if (!mats[key]) mats[key] = new THREE.MeshLambertMaterial({ color, flatShading: true, ...(metal ? { emissive: color, emissiveIntensity: 0.08 } : {}) });
    return mats[key];
  }

  function clear() {
    if (group) scene.remove(group);
    group = new THREE.Group();
    group.name = GROUP_NAME;
    scene.add(group);
    collision = [];
  }

  function box(x, y, z, sx, sy, sz, color, solid = true) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), mat(color, color === 0x263238 || color === 0x37474f));
    m.position.set(x, y, z);
    group.add(m);
    if (solid) collision.push({ x: x - sx/2, z: z - sz/2, w: sx, d: sz, h: sy });
    return m;
  }

  function groundBox(x, z, sx, sy, sz, color, solid = true) {
    const y = groundHeightAt(x, z) + sy / 2;
    return box(x, y, z, sx, sy, sz, color, solid);
  }

  function wall(x, z, sx, sz, h = 2.5, color = 0x59636b) {
    return groundBox(x, z, sx, h, sz, color, true);
  }

  function crate(x, z, color = 0x7a5a2d) {
    groundBox(x, z, 1.2, 1.2, 1.2, color, true);
  }

  function tower(x, z, h = 5, color = 0x59636b) {
    const baseY = groundHeightAt(x, z);
    box(x, baseY + h/2, z, 2.4, h, 2.4, color, true);
    box(x, baseY + h + 0.35, z, 4.0, 0.35, 4.0, 0x37474f, true);
    for (const [dx,dz] of [[-1.7,-1.7],[1.7,-1.7],[-1.7,1.7],[1.7,1.7]]) {
      box(x+dx, baseY+h+1.0, z+dz, 0.25, 1.3, 0.25, 0x263238, false);
    }
    for (let i=0;i<4;i++) box(x-2.0+i*0.5, baseY+0.15+i*(h/4), z+2.0, 0.55, 0.3+i*0.15, 1.0, 0x6d7478, false);
  }

  function building(x, z, w, d, h, color = 0x59636b, doorAxis = 'x') {
    wall(x-w/2, z, 0.5, d, h, color);
    wall(x+w/2, z, 0.5, d, h, color);
    wall(x, z-d/2, w, 0.5, h, color);
    if (doorAxis === 'x') {
      wall(x-w/2+1.0, z+d/2, Math.max(0.5,w/2-1.0), 0.5, h, color);
      wall(x+w/2-1.0, z+d/2, Math.max(0.5,w/2-1.0), 0.5, h, color);
    } else {
      wall(x+w/2, z-d/2+1.0, 0.5, Math.max(0.5,d/2-1.0), h, color);
      wall(x+w/2, z+d/2-1.0, 0.5, Math.max(0.5,d/2-1.0), h, color);
    }
    box(x, groundHeightAt(x,z)+h+0.15, z, w+0.2, 0.3, d+0.2, 0x37474f, false);
  }

  function maze() {
    const c=0x4f5961, a=0x7c8a93;
    const rows = [
      [8,18,22,2.2],[22,18,16,2.2],[36,18,22,2.2],[52,18,18,2.2],
      [18,30,2.2,18],[34,30,2.2,18],[50,30,2.2,18],[66,30,2.2,18],
      [8,42,22,2.2],[22,42,16,2.2],[40,42,20,2.2],[58,42,18,2.2],
      [18,54,2.2,18],[34,54,2.2,18],[50,54,2.2,18],[66,54,2.2,18],
      [8,66,22,2.2],[26,66,16,2.2],[44,66,20,2.2],[62,66,16,2.2]
    ];
    for(const [x,z,w,d] of rows) wall(x,z,w,d,2.8,c);
    for(const [x,z] of [[6,6],[74,6],[6,74],[74,74],[40,40]]) crate(x,z,a);
  }

  function sniperOutposts() {
    tower(10,10,6,0x4b555c); tower(70,10,7,0x4b555c); tower(10,70,7,0x4b555c); tower(70,70,6,0x4b555c);
    wall(40,20,30,1.8,2.0,0x5c666d); wall(40,60,30,1.8,2.0,0x5c666d);
    wall(20,40,1.8,30,2.0,0x5c666d); wall(60,40,1.8,30,2.0,0x5c666d);
    for(const [x,z] of [[24,24],[56,24],[24,56],[56,56],[40,40]]) crate(x,z,0x75552b);
  }

  function militaryBase() {
    const wallC=0x56616a, bunker=0x3f4a52;
    wall(40,4,34,2,3,wallC); wall(40,76,34,2,3,wallC);
    wall(4,40,2,34,3,wallC); wall(76,40,2,34,3,wallC);
    building(40,22,18,12,5,bunker,'x');
    building(19,40,12,16,4,0x56616a,'z');
    building(61,40,12,16,4,0x56616a,'z');
    building(40,58,24,10,5,0x45515a,'x');
    tower(10,10,5,0x465158); tower(70,10,5,0x465158); tower(10,70,5,0x465158); tower(70,70,5,0x465158);
    for(let x=30;x<=50;x+=5){ crate(x,40,0x6d5838); crate(x,47,0x6d5838); }
    for(const [x,z] of [[12,32],[12,48],[68,32],[68,48]]) wall(x,z,5,1.5,1.0,0x8a7958);
  }

  function ruins() {
    building(18,18,16,12,4,0x5d5d5d,'x');
    building(62,18,14,14,3,0x6b6257,'z');
    building(18,62,14,14,3,0x625b52,'x');
    building(62,62,16,12,4,0x55585b,'z');
    for(let i=0;i<8;i++){ const x=28+i*3, z=40+(i%2)*3; wall(x,z,2.2,2.2,1.8,0x6e665d); }
  }

  function harbor() {
    for(let x=12;x<=68;x+=8) box(x,groundHeightAt(x,16)+0.35,16,6,0.7,10,0x6b7074,true);
    for(let x=10;x<=70;x+=10){
      box(x,groundHeightAt(x,28)+1.0,28,5,2,2.5,0x8a3f2f,true);
      box(x,groundHeightAt(x,34)+1.0,34,5,2,2.5,0x2f5870,true);
    }
    wall(40,52,62,2.2,2.5,0x49545b);
    for(let z=58;z<=70;z+=6) box(40,groundHeightAt(40,z)+1,z,10,2,4,0x5d4c38,true);
  }

  function mine() {
    for(let z=12;z<=68;z+=7){
      wall(20,z,1.3,4,3.5,0x5d4b3a); wall(28,z,1.3,4,3.5,0x5d4b3a);
      box(24,groundHeightAt(24,z)+3.5,z,10,0.8,4,0x4b4035,true);
    }
    for(let x=42;x<=70;x+=7){
      wall(x,28,4,1.3,3.5,0x5d4b3a); wall(x,36,4,1.3,3.5,0x5d4b3a);
      box(x,groundHeightAt(x,32)+3.5,32,4,0.8,10,0x4b4035,true);
    }
    for(const [x,z] of [[24,18],[24,62],[56,32],[64,56]]) crate(x,z,0x8a6b3d);
  }

  function lab() {
    building(20,20,18,14,4,0x66757b,'x');
    building(60,20,18,14,4,0x66757b,'x');
    building(20,60,18,14,4,0x66757b,'x');
    building(60,60,18,14,4,0x66757b,'x');
    for(let z=28;z<=52;z+=6) box(40,groundHeightAt(40,z)+1.1, z, 6,2.2,2,0x374c54,true);
    for(const [x,z] of [[30,40],[50,40],[40,12],[40,68]]) crate(x,z,0x315b67);
  }

  function swamp() {
    for(let x=10;x<72;x+=6) box(x,groundHeightAt(x,24)+0.3,24,5,0.6,2.4,0x70553a,true);
    for(let z=30;z<72;z+=6) box(40,groundHeightAt(40,z)+0.3,z,2.4,0.6,5,0x70553a,true);
    building(16,54,10,10,3,0x4e4a3e,'x'); building(64,54,10,10,3,0x4e4a3e,'x');
  }

  function sky() {
    const islands=[[18,18,14,14],[62,18,14,14],[18,62,14,14],[62,62,14,14],[40,40,20,20]];
    for(const [x,z,w,d] of islands){
      box(x,groundHeightAt(x,z)+3,z,w,6,d,0x59606a,true);
      box(x,groundHeightAt(x,z)+6.1,z,w+1,0.3,d+1,0x7d8791,false);
    }
    wall(40,29,2,8,2,0x4e5660); wall(40,51,2,8,2,0x4e5660);
  }

  function build(id) {
    clear();
    const map = id || 'delta';
    if(map==='frost') sniperOutposts();
    else if(map==='inferno') ruins();
    else if(map==='void') maze();
    else if(map==='sanctuary') militaryBase();
    else if(map==='neon') sniperOutposts();
    else if(map==='ruins') ruins();
    else if(map==='harbor') harbor();
    else if(map==='mine') mine();
    else if(map==='lab') lab();
    else if(map==='swamp') swamp();
    else if(map==='sky') sky();
    else maze();
    builtFor = map;
  }

  function pushOut(p) {
    if(!p || !collision.length) return;
    for(let pass=0;pass<2;pass++){
      for(const c of collision){
        const r=0.42;
        const minX=c.x-r, maxX=c.x+c.w+r, minZ=c.z-r, maxZ=c.z+c.d+r;
        if(p.x>minX && p.x<maxX && p.z>minZ && p.z<maxZ && p.y < groundHeightAt(p.x,p.z)+c.h+1.2){
          const left=Math.abs(p.x-minX), right=Math.abs(maxX-p.x), top=Math.abs(p.z-minZ), bottom=Math.abs(maxZ-p.z);
          const m=Math.min(left,right,top,bottom);
          if(m===left) p.x=minX; else if(m===right) p.x=maxX; else if(m===top) p.z=minZ; else p.z=maxZ;
        }
      }
    }
  }

  function start() {
    const id=localStorage.getItem('cso_map') || 'delta';
    if(id!==builtFor) build(id);
  }

  socket.on('init', start);
  setTimeout(start, 900);
  setInterval(()=>{ if(running && me && me.alive) pushOut(me); }, 30);

  const oldEmit=socket.emit.bind(socket);
  socket.emit=function(event,data){
    if(event==='move' && data){
      const copy={...data};
      pushOut(copy);
      data=copy;
    }
    return oldEmit(event,data);
  };
})();
