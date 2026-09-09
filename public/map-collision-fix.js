/* Client map collision/cover fix.
   Makes Frost/Neon outposts fully walkable, gives the walls real height,
   and keeps local movement from crossing the same cover the server blocks. */
(() => {
  const MAP_KEY = 'cso_map';
  const groupName = '__CSO_HIGH_COVER_FIX__';
  let group = null;
  let activeMap = '';
  let walls = [];
  let platforms = [];
  const previousGround = window.getMapGroundHeightAt;

  const mapId = () => String(localStorage.getItem(MAP_KEY) || 'delta').toLowerCase();
  const baseGround = (x,z) => typeof groundHeightAt === 'function' ? groundHeightAt(x,z) : 0;

  function addWall(x,z,w,d,h) {
    const base = baseGround(x,z);
    walls.push({x:x-w/2,z:z-d/2,w,d,h,base});
    if (!group) return;
    const m = new THREE.Mesh(
      new THREE.BoxGeometry(w,h,d),
      new THREE.MeshLambertMaterial({color:0x657078,flatShading:true})
    );
    m.position.set(x,base+h/2,z);
    group.add(m);
  }

  function addPlatform(x,z,h) {
    const base=baseGround(x,z);
    platforms.push({x:x-2,z:z-2,w:4,d:4,top:base+h+0.525});
  }

  function rebuild() {
    activeMap=mapId();
    walls=[]; platforms=[];
    if(group) scene.remove(group);
    group=new THREE.Group(); group.name=groupName; scene.add(group);
    if(activeMap!=='frost' && activeMap!=='neon') return;

    // Taller tactical cover than the original 2-block walls.
    addWall(40,20,30,1.8,4.5);
    addWall(40,60,30,1.8,4.5);
    addWall(20,40,1.8,30,4.5);
    addWall(60,40,1.8,30,4.5);

    // The four outpost decks.
    addPlatform(10,10,6);
    addPlatform(70,10,7);
    addPlatform(10,70,7);
    addPlatform(70,70,6);
  }

  function surfaceHeight(x,z) {
    let h=previousGround ? previousGround(x,z) : baseGround(x,z);
    for(const p of platforms) {
      if(x>=p.x && x<=p.x+p.w && z>=p.z && z<=p.z+p.d) h=Math.max(h,p.top);
    }
    return h;
  }
  window.getMapGroundHeightAt=surfaceHeight;
  window.csoMapSurfaceHeight=surfaceHeight;

  function blocked(x,z,y) {
    for(const w of walls) {
      if(x>w.x-0.42 && x<w.x+w.w+0.42 && z>w.z-0.42 && z<w.z+w.d+0.42 && y<w.base+w.h-0.15 && y>w.base-0.8) return true;
    }
    return false;
  }

  const oldEmit = socket.emit.bind(socket);
  socket.emit = function(event,data) {
    if(event==='move' && data && walls.length) {
      const copy={...data};
      if(blocked(copy.x,copy.z,copy.y)) {
        if(!blocked(copy.x,me.z,copy.y)) copy.z=me.z;
        else if(!blocked(me.x,copy.z,copy.y)) copy.x=me.x;
        else { copy.x=me.x; copy.z=me.z; }
      }
      data=copy;
    }
    return oldEmit(event,data);
  };

  function tick() {
    const id=mapId();
    if(id!==activeMap) rebuild();
    if(typeof me!=='undefined' && typeof running!=='undefined' && running && me.alive) {
      const g=surfaceHeight(me.x,me.z);
      if(me.y<g){me.y=g;me.vy=0;me.onGround=true;}
      if(blocked(me.x,me.z,me.y)) {
        // Never let local prediction remain inside tall cover.
        const px=me.x,pz=me.z;
        if(!blocked(px,me.z,me.y)) me.x=px;
        else if(!blocked(me.x,pz,me.y)) me.z=pz;
      }
    }
  }

  rebuild();
  setTimeout(rebuild,300);
  setInterval(tick,16);
})();
