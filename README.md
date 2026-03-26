# Phaser + Colyseus Top-Down Template

Minimal browser multiplayer template:

- Phaser renders a top-down scrolling world.
- Colyseus keeps an authoritative shared room state.
- Two or more players can move around the same map.
- The world contains randomly placed boxes that block movement.

## Run it

```bash
npm install
npm run dev
```

Then open `http://localhost:5173` in two or more tabs.

## Controls

- `WASD`
- Arrow keys

## Notes

- The Colyseus server runs on `http://localhost:2567`
- The Vite client runs on `http://localhost:5173`
- You can change the backend URL through `VITE_SERVER_URL`
