# Chaos Shooter Omega

A real-time multiplayer top-down shooter built with Node.js, Express, and Socket.io. Players move around a shared arena, shoot at waves of chasing enemies, and see each other's nicknames in real time.

## Features
- Real-time multiplayer via Socket.io
- WASD movement (desktop) and on-screen joystick + fire button (mobile)
- Click / tap to shoot toward a target
- Enemy waves that scale up each round, with simple chase AI
- Player nicknames and an on-screen HUD (wave, enemy count, player count)

## Getting Started
```bash
npm install
npm start
```
Then open http://localhost:3000 in your browser. Set the `PORT` environment variable to change the port (Render sets this automatically).

## Tech Stack
- Node.js + Express — static hosting and game server
- Socket.io — real-time networking
- HTML5 Canvas — rendering

## Live Demo
https://chaos-shooter-omega.onrender.com
