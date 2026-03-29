# AmongUs Browser Prototype

A small multiplayer top-down game built with Phaser (client) and Colyseus (server).

## What this project does

- Runs an authoritative multiplayer room on the server
- Renders a top-down map in the browser
- Supports multiple levels (dimensions)
- Supports portals between levels
- Supports importing level collision/portal data from SVG files

## Tech stack

- TypeScript
- Phaser
- Colyseus
- Vite
- Node.js 24+

## Quick start

```bash
npm install
npm run dev
```

Then open:

http://localhost:2567

or on other devices:

http://[THIS_SERVERS_IP]:2567

## Controls

- Move: WASD or arrow keys
- Switch level: Q / E
- Teleport: walk into a portal

## Useful scripts

- `npm run dev` build client and start app
- `npm run typecheck` run TypeScript checks
- `npm run build` build client + typecheck
- `npm run server` run only the server

## Documentation

- [README_levels.md](README_levels.md): level structure and editing
- [README_svg.md](README_svg.md): SVG converter usage and marker rules

## Level data

Level definitions live in [shared/levels.ts](shared/levels.ts).

Each level has:

- size
- colors
- collision boxes
- portal list

See [README_levels.md](README_levels.md) for full level editing details.

## SVG to level conversion

Use the converter to build level data from SVG markers:

```bash
npm run level -- --in Map.svg --id building-floor-1 --name "Building Floor 1" --out shared/generated/building-floor-1.level.json
```

Help:

```bash
npm run level:help
```

Direct wrapper (without npm):

```bash
./tools/level --help
```

Use `--append` to add a new level to [shared/levels.ts](shared/levels.ts), or `--replace` to update an existing one.

See [README_svg.md](README_svg.md) for full marker rules and converter options.

## Docker

You can run the project with Docker Compose:

```bash
docker compose up --build -d
```

Stop:

```bash
docker compose down
```
