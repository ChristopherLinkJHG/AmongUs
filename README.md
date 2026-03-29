# AmongUs School Prototype

Multiplayer top-down social deduction prototype with Phaser (client) and Colyseus (server).

## Current gameplay

- German gameplay UI and prompts
- Roles: `teacher`, `student`, `student_with_key`
- Student tasks with global team progress
- Emergency meeting button in the lobby
- Evidence drops (phone/backpack) when a student is caught
- Meetings + voting with tie = nobody eliminated
- Win conditions:
	- students win if all tasks are completed
	- students win if teacher is voted out
	- teacher wins if only one student remains
- Round restart flow without restarting the server

## Quick start

```bash
npm install
npm run dev
```

Open `http://localhost:2567`.

## Controls

- Move: `WASD` or arrow keys
- Level switch (elevator roles only): `Q` / `E`
- Call meeting: `M`
- Complete nearby task: `F`
- Teacher catch action: `C`
- Vote skip: `V`
- Vote first candidate (shortcut): `1`
- Restart round after end: `R`

## Scripts

- `npm run dev` typecheck, build client, start server
- `npm run typecheck` TypeScript validation
- `npm run build` production build
- `npm run server` run server only
- `npm run level` SVG converter entrypoint

## Documentation

- [README_gameplay.md](README_gameplay.md): roles, phases, meeting/voting, evidence, restart flow
- [README_levels.md](README_levels.md): level definitions and structure
- [README_svg.md](README_svg.md): SVG converter usage and marker rules

## Docker

```bash
docker compose up --build -d
```

Stop with:

```bash
docker compose down
```
