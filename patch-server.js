/* Runtime compatibility/gameplay patch for Chaos Shooter Omega.
   npm runs this before server.js on Render. The patch is idempotent so it can
   safely upgrade the older server without replacing the large authoritative file. */
const fs = require('fs');
const path = require('path');

const serverFile = path.join(__dirname, 'server.js');
let s = fs.readFileSync(serverFile, 'utf8');

if (!s.includes('CSO_GRENADE_PATCH_V1')) {
  const handler = `\n  // CSO_GRENADE_PATCH_V1\n  socket.on("grenade", (d) => {\n    const p = players[socket.id];\n    if (!p || !p.alive) return;\n    const dir = normalize({ x:+d.dx, y:+d.dy, z:+d.dz });\n    grenades.push({ id: Math.random().toString(36).slice(2), x:+d.x||p.x, y:+d.y||p.y+1, z:+d.z||p.z, vx:dir.x*11, vy:dir.y*11+3.5, vz:dir.z*11, owner:socket.id, age:0 });\n  });\n`;
  s = s.replace('  socket.on("setName", (name) => {', handler + '\n  socket.on("setName", (name) => {');
  const tick = `\n  // CSO_GRENADE_TICK_V1\n  for (let i=grenades.length-1;i>=0;i--) {\n    const g=grenades[i]; g.age+=dt; g.vy-=18*dt; g.x+=g.vx*dt; g.y+=g.vy*dt; g.z+=g.vz*dt;\n    const ground=groundHeightAt(g.x,g.z); if(g.y<ground+0.18){g.y=ground+0.18;g.vy*=-0.38;g.vx*=0.72;g.vz*=0.72;}\n    if(g.age<1.35) continue;\n    const radius=5.2; for(const e of [...enemies]){const dist=Math.hypot(e.x-g.x,e.z-g.z); if(dist<=radius&&Math.abs(e.y-g.y)<4){e.hp-=Math.max(6,Math.round(75*(1-dist/radius)));e.staggerUntil=now+450;if(e.hp<=0)killEnemy(e,g.owner);else io.emit("enemyHit",{id:e.id,by:g.owner});}}\n    io.emit("explosion",{x:g.x,y:g.y,z:g.z,radius,by:g.owner}); grenades.splice(i,1);\n  }\n`;
  s = s.replace('  // Pickups (revive items and health)', tick + '\n  // Pickups (revive items and health)');
  s = s.replace('players, enemies, wave, pickups, reviveCards,', 'players, enemies, wave, pickups, reviveCards, grenades,');
  fs.writeFileSync(serverFile,s);
}

if (!s.includes('CSO_START_ZOMBIE_V1')) {
  s=s.replace('  socket.emit("init", {','  // CSO_START_ZOMBIE_V1\n  if (enemies.length===0) enemies.push(makeEnemy());\n\n  socket.emit("init", {');
  fs.writeFileSync(serverFile,s);
}

if (!s.includes('CSO_MATCH_RULES_V1')) {
  const rules=`\n  // CSO_MATCH_RULES_V1\n  socket.on("setGameOptions", (opts) => {\n    const p=players[socket.id]; if(!p) return;\n    const requested=String(opts&&opts.mode||"z1").toLowerCase();\n    p.gameMode=requested.startsWith("p")?"pvp":"zombies"; p.modeId=requested; p.mapId=String(opts&&opts.map||"delta");\n    if(p.gameMode==="pvp" && Object.values(players).every(x=>x.gameMode==="pvp")) { enemies.length=0; budget=0; waveActive=false; intermission=0; }\n  });\n`;
  s=s.replace('  socket.on("setName", (name) => {',rules+'\n  socket.on("setName", (name) => {');
  s=s.replace('spectating: false,\n    invulnUntil:','spectating: false, gameMode:"zombies", modeId:"z1", mapId:"delta",\n    invulnUntil:');
  s=s.replace('      } else {\n        hurtPlayer(best.id, best.ref, spec.dmg * 10, socket.id);\n      }','      } else {\n        const target=best.ref;\n        if(shooter.gameMode!=="pvp" || target.gameMode!=="pvp") hurtPlayer(best.id,target,spec.dmg*10,socket.id);\n      }');
  fs.writeFileSync(serverFile,s);
}

if (!s.includes('CSO_NO_TEAM_AUTO_REVIVE_V1')) {
  s=s.replace('    } else {\n      // Multiplayer - all dead means wave reset/team wipe\n      enemies.length = 0; waveActive = false; intermission = 0;\n      reviveCards.length = 0;\n      for (const id in players) {\n        const p = players[id];\n        if (!p.permaDead) revivePlayer(id);\n      }\n    }','    } else {\n      // CSO_NO_TEAM_AUTO_REVIVE_V1\n      io.emit("gameOver", { reason:"Your whole team was eliminated." });\n      enemies.length=0; waveActive=false; intermission=0; reviveCards.length=0;\n      for(const id in players) players[id].permaDead=true;\n    }');
  fs.writeFileSync(serverFile,s);
}

if (!s.includes('CSO_MAP_VOTE_V1')) {
  const voteState=`\n// CSO_MAP_VOTE_V1\nconst csoMapVotes=new Map(); const csoMapVoteOrder=[];\nfunction csoVoteSnapshot(){const counts={};for(const map of csoMapVotes.values())counts[map]=(counts[map]||0)+1;return counts;}\nfunction csoPickMap(){const counts=csoVoteSnapshot();let best=null,bestCount=-1,bestOrder=Infinity;for(const map of Object.keys(counts)){const count=counts[map],order=csoMapVoteOrder.indexOf(map);if(count>bestCount||(count===bestCount&&order<bestOrder)){best=map;bestCount=count;bestOrder=order;}}return best;}\n`;
  s=s.replace('const REVIVE_STATIONS = [{ x: 8, z: 8 }, { x: 72, z: 72 }];','const REVIVE_STATIONS = [{ x: 8, z: 8 }, { x: 72, z: 72 }];'+voteState);
  const vh=`\n  // CSO_MAP_VOTE_V1\n  socket.on("mapVote", (mapId) => { const map=String(mapId||"delta").slice(0,32); if(!csoMapVoteOrder.includes(map))csoMapVoteOrder.push(map); csoMapVotes.set(socket.id,map); io.emit("mapVotes",{votes:csoVoteSnapshot(),winner:csoPickMap()}); });\n`;
  s=s.replace('  socket.on("setName", (name) => {',vh+'\n  socket.on("setName", (name) => {');
  s=s.replace('    delete players[socket.id];','    csoMapVotes.delete(socket.id);\n    delete players[socket.id];');
  fs.writeFileSync(serverFile,s);
}

// PvP is a separate ruleset: no zombie wave spawning at all.
if (!s.includes('CSO_PVP_NO_ZOMBIES_V1')) {
  s=s.replace('  } else if (intermission > 0) {','  } else if (Object.values(players).some(p=>p.gameMode==="pvp")) {\n    // CSO_PVP_NO_ZOMBIES_V1\n    enemies.length=0; budget=0; waveActive=false; intermission=0;\n  } else if (intermission > 0) {');
  fs.writeFileSync(serverFile,s);
}

const clientFile=path.join(__dirname,'public','game.js');
let g=fs.readFileSync(clientFile,'utf8');
if(!g.includes('CSO_100_LOOKS_V1')){
  const visualPatch=`\n// CSO_100_LOOKS_V1\n(()=>{\n  const baseMakeZombie=makeZombie;\n  const hash=text=>{let h=2166136261;for(let i=0;i<text.length;i++){h^=text.charCodeAt(i);h=Math.imul(h,16777619);}return h>>>0;};\n  const palette=[0x4fae3f,0x39a86b,0x7b5cc7,0xc95b32,0x2f77a8,0xb59b35,0x8d3b66,0x3d8f7d,0x8b5a2b,0x6f6f6f,0x9a4d4d,0x3f6b8a];\n  makeZombie=function(kind,elite){const g=baseMakeZombie(kind,elite),h=hash(String(kind));g.scale.multiplyScalar(0.78+((h>>>8)%70)/100);g.userData.variantIndex=h%100;g.traverse(o=>{if(!o.isMesh||!o.material||!o.material.color)return;if(o.position.y>1.35)o.material.color.setHex(palette[h%palette.length]);if((h%9)===0)o.rotation.z+=0.08;if((h%11)===0&&o.geometry&&o.geometry.type==='BoxGeometry')o.scale.y*=1.18;if(elite&&o.material.emissive)o.material.emissive.setHex(0xffaa22);});return g;};\n})();\n`;
  const marker='// ---------- SMOOTH NET MOVEMENT: lerp toward 30Hz server snapshots ----------';
  if(g.includes(marker)){g=g.replace(marker,visualPatch+'\n'+marker);fs.writeFileSync(clientFile,g);}
}
if(!g.includes('CSO_GAME_SOCKET_EXPORT_V1')){
  g=g.replace('const socket = io();','const socket = io();\n// CSO_GAME_SOCKET_EXPORT_V1\nwindow.csoGameSocket=socket; window.csoSetGameOptions=(mode,map)=>socket.emit("setGameOptions",{mode,map}); window.csoVoteMap=(map)=>socket.emit("mapVote",map);');
  fs.writeFileSync(clientFile,g);
}

// Wire the already-built home screen into shared voting/match rules and show
// live friend online state from the existing friends API.
const homeFile=path.join(__dirname,'public','home.js');
let h=fs.readFileSync(homeFile,'utf8');
if(!h.includes('CSO_HOME_WIRING_V1')){
  h=h.replace("pending:[] }", "pending:[], voteCounts:{} } // CSO_HOME_WIRING_V1");
  h=h.replace("${x[0]===state.map?'YOUR VOTE':''}", "${(state.voteCounts[x[0]]||0)} VOTES");
  h=h.replace("state.map=b.dataset.map;localStorage.setItem(MAP_KEY,state.map);notify('Map vote: '+b.textContent.replace(/\\d+\\. /,''));renderHome();", "state.map=b.dataset.map;localStorage.setItem(MAP_KEY,state.map);if(window.csoVoteMap)window.csoVoteMap(state.map);notify('Map vote: '+b.textContent.replace(/\\d+\\. /,''));renderHome();");
  h=h.replace("<span class=\"online\">ONLINE / FRIEND</span>", "<span class=\"${f.online?'online':'offline'}\">${f.online?'ONLINE':'OFFLINE'} / FRIEND</span>");
  h=h.replace("$('playSelected').onclick=()=>{localStorage.setItem(MODE_KEY,state.mode);", "$('playSelected').onclick=()=>{if(window.csoSetGameOptions)window.csoSetGameOptions(state.mode,state.map);localStorage.setItem(MODE_KEY,state.mode);");
  h=h.replace("  function renderHome(){", "  if(window.csoGameSocket && !window.__csoMapVoteListener){ window.__csoMapVoteListener=true; window.csoGameSocket.on('mapVotes',d=>{state.voteCounts=d.votes||{}; if(d.winner)state.map=d.winner; renderHome();}); }\n  function renderHome(){");
  fs.writeFileSync(homeFile,h);
}
