/* CHAOS SHOOTER OMEGA — REAL MAP GEOMETRY + CLIMBABLE OUTPOSTS */
(() => {
  const GROUP_NAME='__CSO_MAP_GEOMETRY__';
  let group=null, collision=[], builtFor='';
  const mats={};
  function mat(color,metal=false){const k=color+':'+metal;return mats[k]||(mats[k]=new THREE.MeshLambertMaterial({color,flatShading:true,...(metal?{emissive:color,emissiveIntensity:.08}:{})}));}
  function clear(){if(group)scene.remove(group);group=new THREE.Group();group.name=GROUP_NAME;scene.add(group);collision=[];}
  function box(x,y,z,sx,sy,sz,color,solid=true,stair=false){const m=new THREE.Mesh(new THREE.BoxGeometry(sx,sy,sz),mat(color,color===0x263238||color===0x37474f));m.position.set(x,y,z);group.add(m);if(solid)collision.push({x:x-sx/2,z:z-sz/2,w:sx,d:sz,h:sy,y:y,stair});return m;}
  function groundBox(x,z,sx,sy,sz,color,solid=true){return box(x,groundHeightAt(x,z)+sy/2,z,sx,sy,sz,color,solid);}
  function wall(x,z,sx,sz,h=2.5,color=0x59636b){return groundBox(x,z,sx,h,sz,color,true);}
  function crate(x,z,color=0x7a5a2d){groundBox(x,z,1.2,1.2,1.2,color,true);}

  function tower(x,z,h=6,color=0x59636b){
    const baseY=groundHeightAt(x,z);
    // Four open support legs: no giant solid column, so the outpost can actually be entered.
    for(const [dx,dz] of [[-0.85,-0.85],[0.85,-0.85],[-0.85,0.85],[0.85,0.85]]) box(x+dx,baseY+h/2,z+dz,.45,h,.45,color,true);
    box(x,baseY+h+.18,z,4.4,.36,4.4,0x37474f,true);
    // Real climbable staircase. Each step is a low obstacle; pushOut raises the player onto it.
    const steps=12, run=5.8, stepH=h/steps;
    for(let i=0;i<steps;i++){
      const zz=z+2.75-(i+.5)*(run/steps);
      const gy=groundHeightAt(x,zz);
      const hh=stepH*(i+1);
      box(x,gy+hh/2,zz,1.8,hh,.55,0x6d7478,true,true);
    }
    for(const [dx,dz] of [[-1.9,-1.9],[1.9,-1.9],[-1.9,1.9],[1.9,1.9]]) box(x+dx,baseY+h+.9,z+dz,.25,1.3,.25,0x263238,false);
  }

  function building(x,z,w,d,h,color=0x59636b,doorAxis='x'){
    wall(x-w/2,z,.5,d,h,color);wall(x+w/2,z,.5,d,h,color);wall(x,z-d/2,w,.5,h,color);
    if(doorAxis==='x'){wall(x-w/2+1,z+d/2,Math.max(.5,w/2-1),.5,h,color);wall(x+w/2-1,z+d/2,Math.max(.5,w/2-1),.5,h,color);}
    else {wall(x+w/2,z-d/2+1,.5,Math.max(.5,d/2-1),h,color);wall(x+w/2,z+d/2-1,.5,Math.max(.5,d/2-1),h,color);}
    box(x,groundHeightAt(x,z)+h+.15,z,w+.2,.3,d+.2,0x37474f,false);
  }
  function maze(){const c=0x4f5961,a=0x7c8a93;for(const q of [[8,18,22,2.2],[22,18,16,2.2],[36,18,22,2.2],[52,18,18,2.2],[18,30,2.2,18],[34,30,2.2,18],[50,30,2.2,18],[66,30,2.2,18],[8,42,22,2.2],[22,42,16,2.2],[40,42,20,2.2],[58,42,18,2.2],[18,54,2.2,18],[34,54,2.2,18],[50,54,2.2,18],[66,54,2.2,18],[8,66,22,2.2],[26,66,16,2.2],[44,66,20,2.2],[62,66,16,2.2]])wall(q[0],q[1],q[2],q[3],2.8,c);for(const q of [[6,6],[74,6],[6,74],[74,74],[40,40]])crate(q[0],q[1],a);}
  function sniperOutposts(){tower(10,10,6);tower(70,10,7);tower(10,70,7);tower(70,70,6);wall(40,20,30,1.8,2,0x5c666d);wall(40,60,30,1.8,2,0x5c666d);wall(20,40,1.8,30,2,0x5c666d);wall(60,40,1.8,30,2,0x5c666d);for(const q of [[24,24],[56,24],[24,56],[56,56],[40,40]])crate(q[0],q[1],0x75552b);}
  function militaryBase(){const wc=0x56616a,b=0x3f4a52;wall(40,4,34,2,3,wc);wall(40,76,34,2,3,wc);wall(4,40,2,34,3,wc);wall(76,40,2,34,3,wc);building(40,22,18,12,5,b);building(19,40,12,16,4,wc,'z');building(61,40,12,16,4,wc,'z');building(40,58,24,10,5,0x45515a);tower(10,10,5);tower(70,10,5);tower(10,70,5);tower(70,70,5);for(let x=30;x<=50;x+=5){crate(x,40,0x6d5838);crate(x,47,0x6d5838);}for(const q of [[12,32],[12,48],[68,32],[68,48]])wall(q[0],q[1],5,1.5,1,0x8a7958);}
  function ruins(){building(18,18,16,12,4,0x5d5d5d);building(62,18,14,14,3,0x6b6257,'z');building(18,62,14,14,3,0x625b52);building(62,62,16,12,4,0x55585b,'z');for(let i=0;i<8;i++)wall(28+i*3,40+(i%2)*3,2.2,2.2,1.8,0x6e665d);}
  function harbor(){for(let x=12;x<=68;x+=8)box(x,groundHeightAt(x,16)+.35,16,6,.7,10,0x6b7074,true);for(let x=10;x<=70;x+=10){box(x,groundHeightAt(x,28)+1,28,5,2,2.5,0x8a3f2f,true);box(x,groundHeightAt(x,34)+1,34,5,2,2.5,0x2f5870,true);}wall(40,52,62,2.2,2.5,0x49545b);for(let z=58;z<=70;z+=6)box(40,groundHeightAt(40,z)+1,z,10,2,4,0x5d4c38,true);}
  function mine(){for(let z=12;z<=68;z+=7){wall(20,z,1.3,4,3.5,0x5d4b3a);wall(28,z,1.3,4,3.5,0x5d4b3a);box(24,groundHeightAt(24,z)+3.5,z,10,.8,4,0x4b4035,true);}for(let x=42;x<=70;x+=7){wall(x,28,4,1.3,3.5,0x5d4b3a);wall(x,36,4,1.3,3.5,0x5d4b3a);box(x,groundHeightAt(x,32)+3.5,32,4,.8,10,0x4b4035,true);}for(const q of [[24,18],[24,62],[56,32],[64,56]])crate(q[0],q[1],0x8a6b3d);}
  function lab(){building(20,20,18,14,4,0x66757b);building(60,20,18,14,4,0x66757b);building(20,60,18,14,4,0x66757b);building(60,60,18,14,4,0x66757b);for(let z=28;z<=52;z+=6)box(40,groundHeightAt(40,z)+1.1,z,6,2.2,2,0x374c54,true);for(const q of [[30,40],[50,40],[40,12],[40,68]])crate(q[0],q[1],0x315b67);}
  function swamp(){for(let x=10;x<72;x+=6)box(x,groundHeightAt(x,24)+.3,24,5,.6,2.4,0x70553a,true);for(let z=30;z<72;z+=6)box(40,groundHeightAt(40,z)+.3,z,2.4,.6,5,0x70553a,true);building(16,54,10,10,3,0x4e4a3e);building(64,54,10,10,3,0x4e4a3e);}
  function sky(){for(const q of [[18,18,14,14],[62,18,14,14],[18,62,14,14],[62,62,14,14],[40,40,20,20]]){box(q[0],groundHeightAt(q[0],q[1])+3,q[1],q[2],6,q[3],0x59606a,true);box(q[0],groundHeightAt(q[0],q[1])+6.1,q[1],q[2]+1,.3,q[3]+1,0x7d8791,false);}wall(40,29,2,8,2,0x4e5660);wall(40,51,2,8,2,0x4e5660);}
  function build(id){clear();if(id==='frost'||id==='neon')sniperOutposts();else if(id==='inferno'||id==='ruins')ruins();else if(id==='void')maze();else if(id==='sanctuary')militaryBase();else if(id==='harbor')harbor();else if(id==='mine')mine();else if(id==='lab')lab();else if(id==='swamp')swamp();else if(id==='sky')sky();else maze();builtFor=id||'delta';}

  function pushOut(p){if(!p||!collision.length)return;for(let pass=0;pass<2;pass++)for(const c of collision){const r=.42,minX=c.x-r,maxX=c.x+c.w+r,minZ=c.z-r,maxZ=c.z+c.d+r;if(p.x>minX&&p.x<maxX&&p.z>minZ&&p.z<maxZ){const base=groundHeightAt(p.x,p.z),top=c.y+c.h/2;
      // Stairs: climb instead of being pushed sideways. This makes the outpost genuinely climbable.
      if(c.stair && p.y <= top+.9 && top-base < 7){p.y=Math.max(p.y,top+.12);continue;}
      if(p.y < base+c.h+1.2){const a=Math.abs(p.x-minX),b=Math.abs(maxX-p.x),d=Math.abs(p.z-minZ),e=Math.abs(maxZ-p.z),m=Math.min(a,b,d,e);if(m===a)p.x=minX;else if(m===b)p.x=maxX;else if(m===d)p.z=minZ;else p.z=maxZ;}
    }} }

  function start(){const id=localStorage.getItem('cso_map')||'delta';if(id!==builtFor)build(id);}
  function fixZombies(){if(!scene||!collision.length)return;scene.traverse(o=>{const n=o.userData&&o.userData.net;if(!n)return;const before={x:n.x,y:n.y,z:n.z};pushOut(n);if(n.x!==before.x||n.y!==before.y||n.z!==before.z){o.position.set(n.x,n.y,n.z);}});}
  socket.on('init',start);setTimeout(start,900);setInterval(()=>{if(running&&me&&me.alive)pushOut(me);fixZombies();},30);
  const oldEmit=socket.emit.bind(socket);socket.emit=function(event,data){if(event==='move'&&data){data={...data};pushOut(data);}return oldEmit(event,data);};
})();
