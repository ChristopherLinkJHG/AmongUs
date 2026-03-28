# Phaser + Colyseus Top-Down Template

Minimal browser multiplayer template:

- Phaser renders a top-down scrolling world.
- Colyseus keeps an authoritative shared room state.
- Two or more players can move around shared maps in real time.
- Players can switch between multiple dimensions (levels).
- Each level has its own map size, colors, and box layout.

## Local development

```bash
npm install
npm run dev
```

Then open `http://localhost:5173` in two or more tabs.

In local dev the browser UI is served by Vite on port `5173`, and it connects to the Colyseus server on port `2567`.

The project source is now TypeScript across client, server, and shared code. The server uses Node 24's TypeScript transform support, so use Node `24.x` locally as well.

## Raspberry Pi server with Docker Compose

The Raspberry Pi can now host the complete game from the Node/Colyseus server itself. The Docker image builds the frontend, stores it in `dist/`, and the server serves those files directly.

- [compose.yml](/home/info/99_deleteme/AmongUs/compose.yml)
- [Dockerfile](/home/info/99_deleteme/AmongUs/Dockerfile)

On the Raspberry Pi:

```bash
docker compose up --build -d --force-recreate
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

The server is configured to bind to `0.0.0.0` inside the container, so Docker can publish it on the Raspberry Pi host.

## Docker debugging on the Raspberry Pi

If the page is reachable with `npm run dev` on your laptop but not through Docker on the Pi, debug the Docker publish path first:

```bash
docker compose down
docker compose up --build -d --force-recreate
docker compose ps -a
docker ps
ss -ltnp | grep ':2567'
docker port amongus-server
curl -v http://127.0.0.1:2567/health
curl -I http://127.0.0.1:2567/
```

How to interpret that:

- If `docker compose up` reports `address already in use`, another process is already bound to port `2567` on the Pi.
- If `docker compose ps -a` shows `Created` or `Exited` instead of `Up`, the container never became healthy enough to serve traffic.
- If `ss -ltnp` shows a non-Docker process on `:2567`, that process is blocking Docker from publishing the port.
- If `curl http://127.0.0.1:2567/health` works on the Pi but other devices still cannot connect, the container is fine and the remaining issue is outside the app/container.

To identify a conflicting process on port `2567`:

```bash
sudo lsof -iTCP:2567 -sTCP:LISTEN -n -P
```

## How the browser connects

- When the built app is served by the Pi on port `2567`, the browser automatically connects back to that same origin.
- When you use Vite locally on port `5173`, the client automatically targets `http://<current-host>:2567`.

## Controls

- `WASD`
- Arrow keys
- `Q` / `E` to switch dimensions (levels)
- Walk into a colored portal to teleport to its linked dimension

## Level/Dimension system

This project now includes a multi-level (multi-dimension) system.

What was added:

- A new shared level definition file with multiple predefined levels:
	- `shared/levels.ts`
- Level-aware world state fields:
	- `player.levelId`
	- `box.levelId`
- Server-side level switching and per-level movement/collision limits.
- Client-side level visibility filtering (only your current level is shown).

How to use it:

1. Join the game normally.
2. Press `Q` to move to the previous dimension.
3. Press `E` to move to the next dimension.
4. Or walk into a portal ring to jump to that portal's destination.
5. Portals with the same color are linked pairs.
6. Watch the HUD pill for your current level name.

For a deeper breakdown of all files changed and how to add/edit levels, see:

- [README_levels.md](README_levels.md)

## Notes

- The Colyseus server runs on `http://localhost:2567`
- The Vite client runs on `http://localhost:5173`
- In Docker on the Pi, the server also serves the built frontend from `dist/`
- `npm run typecheck` checks the whole project with `tsc`
