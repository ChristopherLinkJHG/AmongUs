# SVG Converter Guide

Use this guide to convert SVG maps into level data for this project.

## Quick usage

Convert an SVG to JSON output:

```bash
npm run level -- --in Map.svg --id building-floor-1 --name "Building Floor 1" --out shared/generated/building-floor-1.level.json
```

Help:

```bash
npm run level:help
```

Direct wrapper (no npm):

```bash
./tools/level --help
```

## Write into shared levels

Add new level to [shared/levels.ts](shared/levels.ts):

```bash
npm run level -- --in Map.svg --id building-floor-1 --name "Building Floor 1" --append
```

Replace existing level in [shared/levels.ts](shared/levels.ts):

```bash
npm run level -- --in Map.svg --id building-floor-1 --name "Building Floor 1" --replace
```

`--append` and `--replace` are mutually exclusive.

## Supported SVG markers

- `rect` with `data-kind="collision"` -> collision boxes
- `circle` with `data-kind="portal"` -> portals
- `ellipse` with `data-kind="portal"` -> portals
- `path` with `data-kind="wall"` or `data-kind="collision"` -> generated wall boxes
- `path` or `rect` with `data-kind="door"` or `data-kind="opening"` -> opening cutouts in walls

`data-kind` can be inherited from parent `<g>` elements.

## Common options

- `--walls off|marker|fallback|all`
- `--scale <number>`
- `--scale-mode maps|none|size|player`
- `--scale-size <number>` (required with `--scale-mode size`)
- `--scale-player-opening <number>` (for `--scale-mode player`)
- `--walkable-buffer <number>` (default: player size, set `0` to disable)
- `--width <number>` and `--height <number>`

Tip: The UG_Schule_Plan.svg uses an A4-sized viewBox (210 x 297), so its raw coordinates are tiny versus the in-game world size. That is why it needs a big scale. A good starting point is:

```bash
npm run level -- --in UG_Schule_Plan.svg --id UG --name "UG" --replace --scale 20
```

## Notes

- If no collision markers and no wall paths are found, plain `rect` elements are used as a collision fallback.
- If portal target fields are missing, target level/position defaults are applied and shown as warnings.
- Keep marker layers simple and avoid transforms on gameplay marker layers when possible.
