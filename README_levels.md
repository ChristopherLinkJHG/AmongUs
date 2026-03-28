# Multi-Level / Dimension Feature Guide

This document explains the new level system, what changed, and how to use or extend it.

## What was implemented

The game now supports multiple levels (dimensions) in one shared room.

- Levels are predefined in one shared source file.
- Players have a current `levelId`.
- Boxes belong to a specific `levelId`.
- Portals are predefined per level and linked by color.
- Movement and collision are enforced inside the active level's bounds.
- Players can switch levels at runtime.

## Files changed

### New

- `shared/levels.ts`
  - Stores all level configs.
  - Includes dimensions, colors, box layout, and portal layout for each level.
  - Exposes:
    - `LEVELS`
    - `LEVELS_BY_ID`
    - `DEFAULT_LEVEL_ID`
    - `MAX_LEVEL_WIDTH`
    - `MAX_LEVEL_HEIGHT`

### Updated

- `server/state.ts`
  - Added `levelId` to `PlayerState`.
  - Added `levelId` to `BoxState`.

- `shared/protocol.ts`
  - Added `LevelSwitchRequest` for switch messages.

- `server/rooms/WorldRoom.ts`
  - Seeds all boxes from `shared/levels.ts`.
  - Spawns players in `DEFAULT_LEVEL_ID`.
  - Added `switch-level` message handler.
  - Detects portal contact server-side and teleports to predetermined coordinates.
  - Applies a small cooldown to prevent immediate portal bounce-back.
  - Moves players only within their level dimensions.
  - Runs collision checks only against boxes in the same level.

- `src/main.ts`
  - Renders backdrop and box styling per level.
  - Renders colored portals with destination labels.
  - Tracks local level and updates camera bounds/background.
  - Hides players/boxes from other dimensions.
  - Sends `switch-level` messages on `Q`/`E`.
  - Updates HUD with active level name.

- `index.html`
  - Added level status element in HUD (`#level-state`).

- `README.md`
  - Updated controls and added level system summary.

## How to use in game

- Move: `WASD` or arrow keys
- Switch dimension:
  - `Q` = previous level
  - `E` = next level
- Or walk into a portal ring to teleport.
- Matching portal colors indicate linked routes between levels.

When switching, the server teleports your player to a valid spawn point in the target level.
When using a portal, the server teleports your player to that portal's predefined destination coordinates.

## How to add a new level

Edit `shared/levels.ts` and add another object to `LEVELS`:

- Required fields:
  - `id`
  - `name`
  - `width`
  - `height`
  - `backgroundColor`
  - `gridColor`
  - `boxFillColor`
  - `boxStrokeColor`
  - `boxes`
  - `portals`

Portal field requirements:

- `id`
- `x`, `y`
- `radius`
- `color`
- `targetLevelId`
- `targetX`, `targetY`

Tips:

- Keep a safe spawn area near the map center or open spaces.
- Ensure each box stays inside level bounds.
- Ensure each portal destination is not inside a box.
- Use distinct colors per level to make switching obvious.
- Reuse the same color for linked bi-directional portal pairs.

## Notes

- Level switching is authoritative on the server.
- The room still remains one shared Colyseus room.
- Different players can be in different dimensions at the same time.
