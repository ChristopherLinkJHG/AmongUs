# Phaser + Colyseus Top-Down Template

Minimal browser multiplayer template:

- Phaser renders a top-down scrolling world.
- Colyseus keeps an authoritative shared room state.
- Two or more players can move around the same map.
- The world contains randomly placed boxes that block movement.

## Local development

```bash
npm install
npm run dev
```

Then open `http://localhost:5173` in two or more tabs.

In local dev the browser UI is served by Vite on port `5173`, and it connects to the Colyseus server on port `2567`.

## Raspberry Pi server with Docker Compose

The Raspberry Pi can now host the complete game from the Node/Colyseus server itself. The Docker image builds the frontend, stores it in `dist/`, and the server serves those files directly.

- [compose.yml](/home/info/99_deleteme/AmongUs/compose.yml)
- [Dockerfile](/home/info/99_deleteme/AmongUs/Dockerfile)

On the Raspberry Pi:

```bash
docker compose up --build -d
```

Then open this in a browser on any device in the same network:

```text
http://YOUR_PI_IP:2567
```

To stop it:

```bash
docker compose down
```

To view logs:

```bash
docker compose logs -f server
```

## How the browser connects

- When the built app is served by the Pi on port `2567`, the browser automatically connects back to that same origin.
- When you use Vite locally on port `5173`, the client automatically targets `http://<current-host>:2567`.

## Controls

- `WASD`
- Arrow keys

## Notes

- The Colyseus server runs on `http://localhost:2567`
- The Vite client runs on `http://localhost:5173`
- In Docker on the Pi, the server also serves the built frontend from `dist/`
