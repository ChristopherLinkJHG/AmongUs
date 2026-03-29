# Levels Guide

This file explains how levels are defined and how to add or update them.

## Where levels are stored

All levels are defined in [shared/levels.ts](shared/levels.ts).

Each level object includes:

- `id`
- `name`
- `width`, `height`
- `backgroundColor`, `gridColor`
- `boxFillColor`, `boxStrokeColor`
- `boxes`
- `portals`

## Portal fields

Each portal needs:

- `id`
- `x`, `y`
- `radius`
- `color`
- `targetLevelId`
- `targetX`, `targetY`

## In-game behavior

- Players move inside their current level only.
- Collision is checked against boxes from the same level.
- `Q` and `E` switch levels.
- Portals teleport players to configured targets.

## Add or update levels from SVG

Add a new level entry:

```bash
npm run level -- --in Map.svg --id building-floor-1 --name "Building Floor 1" --out shared/generated/building-floor-1.level.json --append
```

Replace an existing level entry by id:

```bash
npm run level -- --in Map.svg --id building-floor-1 --name "Building Floor 1" --out shared/generated/building-floor-1.level.json --replace
```

`--append` and `--replace` cannot be used together.

## Manual editing tips

- Keep all boxes inside level bounds.
- Keep portal centers inside level bounds.
- Use portal pairs if you want two-way travel between levels.
