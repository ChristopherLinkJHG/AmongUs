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

## Raspberry Pi server with Docker Compose

The repository now includes a Pi-friendly server container setup:

- [compose.yml](/home/info/99_deleteme/AmongUs/compose.yml)
- [Dockerfile](/home/info/99_deleteme/AmongUs/Dockerfile)

On the Raspberry Pi:

```bash
docker compose up --build -d
```

The Colyseus server will be exposed on port `2567`.

To stop it:

```bash
docker compose down
```

To view logs:

```bash
docker compose logs -f server
```

## Connecting the browser client to the Pi

If you run the browser client on another machine, point it to the Pi's IP address before starting Vite:

```bash
VITE_SERVER_URL=http://YOUR_PI_IP:2567 npm run dev
```

Example:

```bash
VITE_SERVER_URL=http://192.168.1.50:2567 npm run dev
```

Then open the client in multiple tabs or on multiple devices in the same network.

## Controls

- `WASD`
- Arrow keys

## Notes

- The Colyseus server runs on `http://localhost:2567`
- The Vite client runs on `http://localhost:5173`
- You can change the backend URL through `VITE_SERVER_URL`
- The Docker setup only runs the multiplayer server, not the Vite dev client
