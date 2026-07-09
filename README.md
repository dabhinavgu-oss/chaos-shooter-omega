# Chaos Shooter Omega

A real-time multiplayer **3D voxel FPS** built with Node.js, Express, Socket.io, and Three.js. Everyone shares one procedurally generated 80×80 blocky world: clear the monster waves together, earn a new weapon after every wave — or turn on each other, because PvP is always live.

## The loop
Clear a wave → get a **reward for the whole team** → 6-second breather → a **harder wave with a brand-new monster type**. Repeat until the horde wins.

## Monsters — one new kind every wave
| Wave | Monster | Gimmick |
|------|---------|---------|
| 1 | Walker | The classic shambler |
| 2 | Runner | Fast and fragile |
| 3 | Spitter | Keeps its distance, lobs ballistic acid (dodgeable!) |
| 4 | Brute | Huge, slow, hits like a truck |
| 5 | Leaper | Pounces from mid-range |
| 6 | Screamer | Speed-buffs every monster near it — kill it first |
| 7 | Exploder | Kamikaze; detonates near you *and* when shot |
| 8+ | Warden | Mini-boss escort, one or more per wave |

Older kinds keep appearing and scale up every wave (more HP, more speed, bigger budgets, faster spawns).

## Weapons & items — wave rewards
Pistol → **SMG** (auto) → **Shotgun** → **Rifle** → **Grenades ×3** → **Sniper** → **Shield Potion ×2** → **Minigun**, then restocks forever. Everything lives on a Fortnite-style **hotbar**: keys `1-8` or mouse wheel to switch, `G` quick-throws a grenade, `Q` drinks a shield potion (+50 blue bar that absorbs damage first). Late joiners automatically receive everything the team has earned.

## Feel
- Server-authoritative everything: hits, damage, waves, loot, grenades, rewards
- Floating health bars over every monster and player; your own health + shield bars sit Fortnite-style above the hotbar
- Interpolated 60fps movement with speed-matched walk cycles, attack lunges, pounces, and a pulsing glow on exploders
- Hitmarkers, knockback, stagger, muzzle flash, camera shake, death particles, and WebAudio synth sound for every weapon and event
- Spawn protection, safe respawn placement, kill feed with names, Tab scoreboard, loot drops (health / ammo)

## Getting Started
```bash
npm install
npm start
```
Open http://localhost:3000 (set `PORT` to change it; Render does this automatically). Open a second tab for instant multiplayer.

## Controls
`WASD` move · `Mouse` look · `Click` shoot (hold for autos) · `Space` jump · `R` reload · `1-8`/`Wheel` switch · `G` grenade · `Q` potion · `Tab` scoreboard · `Esc` releases the mouse (click to re-capture)

## Tech Stack
Node.js + Express (authoritative 30 Hz server) · Socket.io (networking) · Three.js (rendering, instanced voxel terrain)

## Live Demo
https://chaos-shooter-omega.onrender.com
