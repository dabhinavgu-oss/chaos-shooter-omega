# Chaos Shooter Omega

A real-time multiplayer **3D voxel FPS** built with Node.js, Express, Socket.io, and Three.js. Everyone shares one procedurally generated blocky world: fight the zombie waves together — or turn on each other, because PvP is always live.

## Features
- **Server-authoritative multiplayer** — the server owns the world seed, all player HP/scores, the enemy AI, and resolves every hit with its own raycasts. Clients only send intent (movement + shots) and render synced state.
- **Shared procedural voxel terrain** — every client rebuilds the identical 50×50 map from one seed.
- **Co-op zombie waves** that scale with the wave number *and* the player count, with kill scoring (+10 zombie, +50 player).
- **First-person controls** — pointer-lock mouse look, WASD, jump, reload, recoil, tracers.
- **Full HUD** — health bar, ammo, score, wave, player count, kill feed with names, damage flash, and nametags floating over other players.
- **Death & respawn cycle** (4 s), per-player name and color chosen on the start screen.

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
