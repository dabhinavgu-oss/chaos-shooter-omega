/* Server-side map collision / cover patch for Chaos Shooter Omega.
   Runs before server.js and upgrades the authoritative movement + hitscan rules. */
const fs = require('fs');
const path = require('path');
const file = path.join(__dirname, 'server.js');
let s = fs.readFileSync(file, 'utf8');

if (!s.includes('CSO_MAP_COLLISION_V2')) {
  const helpers = `
// CSO_MAP_COLLISION_V2
function csoMapObstacles(mapId) {
  const id=String(mapId||'delta').toLowerCase();
  if(id!=='frost' && id!=='neon') return [];
  const out=[];
  const add=(x,z,w,d,h)=>out.push({x:x-w/2,z:z-d/2,w,d,h,base:groundHeightAt(x,z)});
  // Frost/Neon outpost walls: deliberately tall cover.
  add(40,20,30,1.8,4.5); add(40,60,30,1.8,4.5);
  add(20,40,1.8,30,4.5); add(60,40,1.8,30,4.5);
  // Outpost tower bodies.
  add(10,10,2.4,2.4,6); add(70,10,2.4,2.4,7);
  add(10,70,2.4,2.4,7); add(70,70,2.4,2.4,6);
  return out;
}
function csoPointBlocked(mapId,x,z,y) {
  for(const o of csoMapObstacles(mapId)) {
    if(x>o.x-0.42 && x<o.x+o.w+0.42 && z>o.z-0.42 && z<o.z+o.d+0.42 && y < o.base+o.h-0.15 && y > o.base-0.8) return true;
  }
  return false;
}
function csoMoveEntity(mapId,e,nx,nz) {
  if(!csoPointBlocked(mapId,nx,nz,e.y)) return {x:nx,z:nz};
  if(!csoPointBlocked(mapId,nx,e.z,e.y)) return {x:nx,z:e.z};
  if(!csoPointBlocked(mapId,e.x,nz,e.y)) return {x:e.x,z:nz};
  return {x:e.x,z:e.z};
}
function csoRayBox(o,d,maxT,b) {
  const minX=b.x, maxX=b.x+b.w, minY=b.base, maxY=b.base+b.h, minZ=b.z, maxZ=b.z+b.d;
  let tmin=0,tmax=maxT;
  for(const axis of ['x','y','z']) {
    const ov=o[axis], dv=d[axis];
    const mn=axis==='x'?minX:(axis==='y'?minY:minZ), mx=axis==='x'?maxX:(axis==='y'?maxY:maxZ);
    if(Math.abs(dv)<1e-9){ if(ov<mn||ov>mx) return null; continue; }
    let a=(mn-ov)/dv,bv=(mx-ov)/dv; if(a>bv){const q=a;a=bv;bv=q;}
    tmin=Math.max(tmin,a); tmax=Math.min(tmax,bv); if(tmin>tmax) return null;
  }
  return tmin>=0 && tmin<=maxT ? tmin : null;
}
function csoShotBlocked(mapId,o,d,maxT) {
  let hit=false,best=maxT;
  for(const b of csoMapObstacles(mapId)){const t=csoRayBox(o,d,best,b);if(t!==null&&t<best){best=t;hit=true;}}
  return hit;
}
`;
  s=s.replace('function groundHeightAt(wx, wz) {', helpers+'\nfunction groundHeightAt(wx, wz) {');

  s=s.replace('let y = +d.y || 0;\n    const ground = groundHeightAt(x, z);\n    if (y < ground) y = ground;\n    if (y > ground + 6) y = ground + 6;\n    p.x = x; p.y = y; p.z = z;',
`let y = +d.y || 0;
    const ground = groundHeightAt(x, z);
    if (y < ground) y = ground;
    if (y > ground + 9) y = ground + 9;
    const moved=csoMoveEntity(p.mapId,x,z,y);
    p.x = moved.x; p.y = y; p.z = moved.z;`);

  s=s.replace('      if (best.type === "enemy") {',
`      if (best && csoShotBlocked(shooter.mapId, origin, dir, bestT)) continue;
      if (best.type === "enemy") {`);

  s=s.replace('    if (dist > 1.2 && !staggered) {\n      e.x += (dx / dist) * spd * dt;\n      e.z += (dz / dist) * spd * dt;\n      e.y = groundHeightAt(e.x, e.z);\n    }',
`    if (dist > 1.2 && !staggered) {
      const nx=e.x+(dx/dist)*spd*dt, nz=e.z+(dz/dist)*spd*dt;
      const moved=csoMoveEntity(e.mapId,nx,nz,e.y);
      e.x=moved.x; e.z=moved.z;
      e.y=groundHeightAt(e.x,e.z);
    }`);

  if (!s.includes('mapId: "delta"')) {
    s=s.replace('spectating: false,\n    invulnUntil:', 'spectating: false, mapId: "delta",\n    invulnUntil:');
  }
  fs.writeFileSync(file,s);
}
