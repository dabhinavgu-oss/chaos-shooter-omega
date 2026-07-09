# Chaos Shooter Omega

A real-time multiplayer **3D voxel FPS** built with Node.js, Express, Socket.io, and Three.js. Everyone shares one procedurally generated blocky world: clear the zombie waves together — or turn on each other, because PvP is always live.

## Features
- **Server-authoritative multiplayer** — the server owns the world seed, player HP/scores, enemy AI, and resolves every hit with its own raycasts. Clients only send intent (movement + shots) and render synced state.
- **Real wave structure** — each wave spawns a fixed budget of zombies (scaling with wave number and player count). Clear them all and you get a 6-second breather before the next wave hits. A full team wipe restarts the current wave instead of snowballing.
- **Zombies that fight fair(ish)** — they shove each other apart instead of stacking into a blob, get knocked back and staggered when shot, and their speed is capped so you can always outrun them. Kill feedback: flinch flash, hitmarker, block-scatter death particles.
- **Spawn protection** — 2.5s of invulnerability on every spawn (firing forfeits it), and respawn points are chosen away from the horde.
- **Synth sound effects** — gunfire, hits, kills, hurt, reload, death, and wave-clear jingle, all generated with WebAudio. No audio files.
- **Full HUD** — health bar (color shifts as it drops), ammo, score, wave, zombies left, player count, kill feed with names, wave banners, damage flash, and nametags over other players.
- **Shared procedural voxel terrain** — every client rebuilds the identical 50×50 map from one seed.

## Getting Started
```bash
npm install
npm start
```
Then open http://localhost:3000 in your browser. Set the `PORT` environment variable to change the port (Render sets this automatically). Open a second tab for instant multiplayer.

## Controls
`WASD` move · `Mouse` look · `Click` shoot · `Space` jump · `R` reload · `Esc` releases the mouse (click to re-capture)

## Tech Stack
- **Node.js + Express** — static hosting and the authoritative game server (30 Hz tick)
- **Socket.io** — real-time networking
- **Three.js** — 3D rendering with instanced meshes for the voxel terrain

## Live Demo
https://chaos-shooter-omega.onrender.com
