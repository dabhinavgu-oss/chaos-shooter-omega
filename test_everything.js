/* Comprehensive integration simulation: auth, profiles, friends, parties, maps and 2-player gameplay. */
const fs = require('fs');
const { io } = require('socket.io-client');
const { PartyManager } = require('./game/parties');
const { dbAll } = require('./db');

const BASE = process.env.SIM_BASE || 'http://localhost:3000';
const results = [];
const checks = (name, ok, detail = '') => {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function json(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, { ...options, headers: { 'Content-Type': 'application/json', ...(options.headers || {}) } });
  let body = null;
  try { body = await res.json(); } catch {}
  return { res, body };
}

async function auth(username, email) {
  const password = 'SimPass!2026';
  let r = await json('/api/auth/register', { method: 'POST', body: JSON.stringify({ username, email, password }) });
  if (r.res.status === 409) r = await json('/api/auth/login', { method: 'POST', body: JSON.stringify({ identifier: username, password }) });
  if (!r.body?.token) throw new Error(`auth failed for ${username}: ${r.res.status} ${JSON.stringify(r.body)}`);
  return r.body;
}

async function main() {
  // ---- Static map catalogue: all 12 visual maps + all server DB maps ----
  const visuals = fs.readFileSync('public/map-visuals.js', 'utf8');
  const expectedVisualMaps = ['delta','frost','inferno','void','sanctuary','neon','ruins','harbor','mine','lab','swamp','sky'];
  for (const id of expectedVisualMaps) checks(`visual map ${id}`, new RegExp(`\\b${id}:\\s*\\{`).test(visuals));
  const maps = await dbAll('SELECT id, name, seed, mode FROM maps ORDER BY id');
  const expectedDbMaps = ['map_delta','map_frost','map_inferno','map_void','map_sanctuary'];
  for (const id of expectedDbMaps) checks(`database map ${id}`, maps.some(m => m.id === id));
  checks('map catalogue has 5 server maps', maps.length >= 5, `${maps.length} found`);

  // ---- Account persistence + profile + stats ----
  const suffix = Date.now();
  const a = await auth(`sim_${suffix}`, `sim_${suffix}@example.com`);
  const b = await auth(`sim2_${suffix}`, `sim2_${suffix}@example.com`);
  checks('register/login works', !!a.token && !!b.token);
  let r = await json('/api/auth/verify', { headers: { Authorization: `Bearer ${a.token}` } });
  checks('token verify works', r.res.ok && r.body?.userId === a.userId);
  r = await json(`/api/users/profile/${a.userId}`, { headers: { Authorization: `Bearer ${a.token}` } });
  checks('profile read works', r.res.ok && r.body?.username === a.username);
  r = await json('/api/users/profile/update', { method: 'POST', headers: { Authorization: `Bearer ${a.token}` }, body: JSON.stringify({ bio: 'simulation', color: '#123456' }) });
  checks('profile update works', r.res.ok);
  r = await json(`/api/users/profile/${a.userId}`, { headers: { Authorization: `Bearer ${a.token}` } });
  checks('profile update persists', r.res.ok && r.body?.bio === 'simulation' && r.body?.color === '#123456');
  r = await json('/api/users/stats/record', { method: 'POST', headers: { Authorization: `Bearer ${a.token}` }, body: JSON.stringify({ sessionId: `sim-${suffix}`, kills: 2, deaths: 1, score: 100, won: true }) });
  checks('stats record works', r.res.ok);
  r = await json('/api/users/leaderboard');
  checks('leaderboard works', r.res.ok && Array.isArray(r.body));

  // ---- Friends: real persistent request, accept, list; also explicitly try test2 ----
  const authA = { Authorization: `Bearer ${a.token}` };
  const authB = { Authorization: `Bearer ${b.token}` };
  r = await json(`/api/friends/search?q=${encodeURIComponent(b.username)}`, { headers: authA });
  checks('friend search finds second player', r.res.ok && r.body.some(x => Number(x.id) === Number(b.userId)));
  r = await json(`/api/friends/search?q=test2`, { headers: authA });
  checks('friend search can query test2', r.res.ok, r.res.ok ? `${r.body.length} result(s)` : JSON.stringify(r.body));
  const test2 = r.body?.find(x => String(x.username).toLowerCase() === 'test2');
  if (test2) {
    const fr = await json('/api/friends/request', { method: 'POST', headers: authA, body: JSON.stringify({ targetUsername: 'test2' }) });
    checks('friend request to test2 is handled', [200, 409].includes(fr.res.status), `${fr.res.status} ${fr.body?.error || 'ok'}`);
  } else checks('test2 account exists', false, 'not found; skipped live test2 request');

  r = await json('/api/friends/request', { method: 'POST', headers: authA, body: JSON.stringify({ targetUsername: b.username }) });
  checks('friend request sends', r.res.ok || r.res.status === 409, `${r.res.status}`);
  r = await json('/api/friends/pending', { headers: authB });
  checks('receiver sees pending request', r.res.ok && r.body.some(x => Number(x.id) === Number(a.userId)));
  r = await json('/api/friends/accept', { method: 'POST', headers: authB, body: JSON.stringify({ fromUserId: a.userId }) });
  checks('receiver can accept request', r.res.ok || r.res.status === 409, `${r.res.status}`);
  const fa = await json('/api/friends/list', { headers: authA });
  const fb = await json('/api/friends/list', { headers: authB });
  checks('friend appears for sender', fa.res.ok && fa.body.some(x => Number(x.id) === Number(b.userId)));
  checks('friend appears for receiver', fb.res.ok && fb.body.some(x => Number(x.id) === Number(a.userId)));
  const self = await json('/api/friends/request', { method: 'POST', headers: authA, body: JSON.stringify({ targetUsername: a.username }) });
  checks('self-friend request is blocked', self.res.status === 400);

  // ---- Party manager: create, join, ready, leave, mode/capacity ----
  const pm = new PartyManager();
  const partyId = await pm.createParty(a.userId, `sim-party-${suffix}`, 'zombies', 2);
  checks('party creates', !!partyId && !!pm.getParty(partyId));
  let pr = await pm.joinParty(partyId, b.userId);
  checks('party join works', pr?.success === true);
  await pm.setReady(partyId, b.userId, true);
  checks('party ready works', pm.areAllReady(partyId) === true);
  const p = pm.getParty(partyId);
  checks('party capacity/mode are correct', p.capacity === 2 && p.mode === 'zombies' && p.members.length === 2);
  await pm.leaveParty(partyId, b.userId);
  checks('party leave works', pm.getParty(partyId)?.members.length === 1);
  await pm.leaveParty(partyId, a.userId);
  checks('empty party is removed', !pm.getParty(partyId));

  // ---- Two live sockets: sync, players, movement, shooting, loot, waves, projectiles ----
  const sockets = [io(BASE, { extraHeaders: { Authorization: `Bearer ${a.token}` } }), io(BASE, { extraHeaders: { Authorization: `Bearer ${b.token}` } })];
  const state = sockets.map(() => ({ init: null, sync: null, hits: 0, kills: 0, pickups: 0, rewards: 0, playerHit: 0, revived: 0 }));
  sockets.forEach((s, i) => {
    s.on('init', d => state[i].init = d);
    s.on('sync', d => state[i].sync = d);
    s.on('enemyHit', d => { if (d.by === state[i].init?.id) state[i].hits++; });
    s.on('enemyKilled', d => { if (d.by === state[i].init?.id) state[i].kills++; });
    s.on('pickup', d => { if (d.by === state[i].init?.id) state[i].pickups++; });
    s.on('reward', () => state[i].rewards++);
    s.on('playerHit', d => { if (d.id === state[i].init?.id) state[i].playerHit++; });
    s.on('playerRevived', d => { if (d.id === state[i].init?.id) state[i].revived++; });
  });
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('socket init timeout')), 8000);
    const tick = () => { if (state.every(x => x.init)) { clearTimeout(t); resolve(); } else setTimeout(tick, 50); };
    tick();
  });
  checks('two authenticated players connect', state.every(x => x.init?.id));
  checks('server exposes revive stations', state[0].init?.reviveStations?.length === 2);
  checks('both players are synchronized', state.every(x => x.init?.players && Object.keys(x.init.players).length >= 2));

  let running = true;
  const positions = sockets.map((_, i) => ({ x: state[i].init.players[state[i].init.id].x, z: state[i].init.players[state[i].init.id].z }));
  const mover = setInterval(() => {
    if (!running) return;
    sockets.forEach((s, i) => {
      const me = state[i].sync?.players?.[state[i].init.id] || state[i].init.players[state[i].init.id];
      const es = state[i].sync?.enemies || [];
      if (es[0]) {
        const e = es[0]; const dx = e.x - positions[i].x, dz = e.z - positions[i].z; const d = Math.hypot(dx, dz) || 1;
        s.emit('shoot', { x: positions[i].x, y: (me.y || 0) + 1.7, z: positions[i].z, dx, dy: (e.y + 1.1) - ((me.y || 0) + 1.7), dz, w: ['pistol','smg','shotgun','rifle','sniper','minigun'][Math.floor(Date.now()/500)%6] });
        if (d < 5) { positions[i].x -= dx / d * 3; positions[i].z -= dz / d * 3; }
      } else { positions[i].x += i ? -0.6 : 0.6; }
      positions[i].x = Math.max(2, Math.min(78, positions[i].x));
      positions[i].z = Math.max(2, Math.min(78, positions[i].z));
      s.emit('move', { x: positions[i].x, y: me.y || 1, z: positions[i].z, yaw: 0 });
    });
  }, 250);
  await sleep(15000);
  running = false; clearInterval(mover);
  checks('live sync arrives', state.every(x => x.sync && Array.isArray(x.sync.enemies)));
  checks('enemy health fields sync', state.every(x => (x.sync?.enemies || []).every(e => 'hp' in e && 'maxHp' in e && 'kind' in e && 'yaw' in e)));
  checks('player gear syncs', state.every(x => { const p = x.sync?.players?.[x.init.id]; return p && Array.isArray(p.weapons) && p.items && 'shield' in p; }));
  checks('projectile sync keys exist', state.every(x => x.sync && 'blobs' in x.sync && 'grenades' in x.sync));
  checks('wave state syncs', state.every(x => typeof x.sync?.wave === 'number' && typeof x.sync?.intermission === 'number'));
  checks('no NaN enemy positions', state.every(x => (x.sync?.enemies || []).every(e => [e.x,e.y,e.z].every(Number.isFinite))));
  checks('combat registered a hit or kill', state.some(x => x.hits > 0 || x.kills > 0));
  checks('two-player state remains present', state.every(x => Object.keys(x.sync?.players || {}).length >= 2));
  sockets.forEach(s => s.close());

  // Clean enough for repeated CI runs; generated users remain intentionally harmless.
  console.log(`\n${results.filter(x => x.ok).length}/${results.length} checks passed.`);
  if (results.some(x => !x.ok)) process.exitCode = 1;
}

main().catch(err => { console.error('SIM ERROR', err); process.exitCode = 1; });
