import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { XMLParser } from "fast-xml-parser";
import {
  LEVELS,
  LEVELS_BY_ID,
  type LevelBox,
  type LevelConfig,
  type LevelPortal,
} from "../shared/levels.ts";
import { PLAYER_RADIUS } from "../shared/config.ts";

type WallsMode = "off" | "marker" | "fallback" | "all";
type SharedLevelsWriteMode = "append" | "replace";

const LEVELS_ARRAY_END_ANCHOR = "\n];\n\nexport const DEFAULT_LEVEL_ID";

interface CliOptions {
  inputPath: string;
  levelId: string;
  levelName: string;
  outputPath?: string;
  append: boolean;
  replace: boolean;
  width?: number;
  height?: number;
  scale?: number;
  scaleLikeExisting: boolean;
  wallThickness?: number;
  doorWidth?: number;
  doorPadding?: number;
  wallsMode: WallsMode;
  backgroundColor?: string;
  gridColor?: string;
  boxFillColor?: string;
  boxStrokeColor?: string;
}

interface SvgTraversalContext {
  inheritedKind?: string;
}

interface ExtractionOptions {
  wallsMode: WallsMode;
  wallThickness: number;
  doorWidth: number;
  doorPadding: number;
}

interface ParseResult {
  boxes: LevelBox[];
  portals: LevelPortal[];
  warnings: string[];
  errors: string[];
}

interface ScaleDecision {
  scaleX: number;
  scaleY: number;
  reason: string;
  targetLevelWidth?: number;
  targetLevelHeight?: number;
}

interface AutoScaleInputs {
  sourceDoorOpeningSpan: number;
}

interface CenterResult {
  offsetX: number;
  offsetY: number;
  width: number;
  height: number;
}

interface SourceRange {
  start: number;
  end: number;
}

interface LevelBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  width: number;
  height: number;
}

interface Point {
  x: number;
  y: number;
}

interface Segment {
  from: Point;
  to: Point;
}

interface PathMarker {
  label: string;
  d: string;
}

const DEFAULT_COLORS = {
  backgroundColor: "#1c2530",
  gridColor: "#2f414d",
  boxFillColor: "#738590",
  boxStrokeColor: "#aec0ca",
  portalColor: "#4dabf7",
} as const;

const HELP_TEXT = `
Convert gameplay markers from an SVG floor plan into this project's LevelConfig format.

Usage:
  npm run level:from-svg -- --in Map.svg --id building-floor-1 --name "Building Floor 1" --out shared/generated/building-floor-1.level.json

Required:
  --in <file>                  Source SVG path.
  --id <levelId>               New level id.

Optional:
  --name <displayName>         Level display name (defaults to a titleized level id).
  --out <file>                 Output file path (.json or .ts). Defaults to stdout JSON.
  --append                     Also append generated level object into shared/levels.ts.
  --replace                    Replace an existing level object with the same id in shared/levels.ts.
  --width <number>             Override level width.
  --height <number>            Override level height.
  --scale <number>             Manual global scale factor.
  --scale-like-existing <bool> Auto-scale using outermost geometry corners against reference level sizes (default true).
  --walls <mode>               Path wall extraction mode: off | marker | fallback | all (default fallback).
  --wall-thickness <number>    Wall thickness in SVG units before scaling.
  --door-width <number>        Door opening width in SVG units before scaling.
  --door-padding <number>      Extra opening margin around door markers.
  --background <hex>           Override level background color.
  --grid <hex>                 Override grid color.
  --box-fill <hex>             Override collision box fill color.
  --box-stroke <hex>           Override collision box stroke color.
  --help                       Print this message.

Gameplay markers:
  - Rectangles with data-kind="collision"
  - Circles with data-kind="portal"
  - Paths with data-kind="wall" (or fallback/all modes)
  - Paths/rects with data-kind="door" (or data-kind="opening") carve walkable gaps in walls

Portal circle requirements:
  id, cx, cy, r, data-target-level, data-target-x, data-target-y

Notes:
  - data-kind can live on a parent <g>, and children inherit it.
  - Gameplay transforms are not resolved by this tool; avoid transforms on gameplay layers.
  - Auto-scaling uses geometry bounds (outermost corners), then applies a uniform fit scale against reference map dimensions.
  - Auto-scaling preserves aspect ratio (no X/Y stretch).
  - Auto-scaled levels are centered inside reference bounds.
  - Auto-scale can increase size to keep generated openings walkable for the configured player radius.
  - Portal target points are scaled only when they target the same level id.
  - Use either --append or --replace (not both).
`;

async function main(): Promise<void> {
  const cli = parseCliOptions(process.argv.slice(2));

  if (!cli) {
    return;
  }

  const svgText = await fs.readFile(cli.inputPath, "utf8");
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    allowBooleanAttributes: true,
    parseAttributeValue: false,
    trimValues: true,
  });

  const document = parser.parse(svgText) as Record<string, unknown>;
  const svg = document.svg as Record<string, unknown> | undefined;

  if (!svg) {
    throw new Error(`The file ${cli.inputPath} does not contain a root <svg> element.`);
  }

  const svgAttrs = getAttributes(svg);
  const size = resolveLevelSize(svgAttrs, cli);
  const wallThickness = cli.wallThickness ?? deriveWallThickness(size.width, size.height);
  const resolvedDoorWidth = cli.doorWidth ?? wallThickness * 4;
  const resolvedDoorPadding = cli.doorPadding ?? Math.max(0.2, wallThickness * 0.45);
  const sourceDoorOpeningSpan = resolvedDoorWidth + resolvedDoorPadding * 2;
  const extraction = extractGameplay(svg, {
    wallsMode: cli.wallsMode,
    wallThickness,
    doorWidth: resolvedDoorWidth,
    doorPadding: resolvedDoorPadding,
  });

  if (extraction.errors.length > 0) {
    const message = extraction.errors.map((line) => `- ${line}`).join("\n");
    throw new Error(`SVG marker validation failed:\n${message}`);
  }

  const level: LevelConfig = {
    id: cli.levelId,
    name: cli.levelName,
    width: size.width,
    height: size.height,
    backgroundColor:
      cli.backgroundColor ?? svgAttrs["data-level-background-color"] ?? DEFAULT_COLORS.backgroundColor,
    gridColor: cli.gridColor ?? svgAttrs["data-level-grid-color"] ?? DEFAULT_COLORS.gridColor,
    boxFillColor:
      cli.boxFillColor ?? svgAttrs["data-level-box-fill-color"] ?? DEFAULT_COLORS.boxFillColor,
    boxStrokeColor:
      cli.boxStrokeColor ?? svgAttrs["data-level-box-stroke-color"] ?? DEFAULT_COLORS.boxStrokeColor,
    boxes: extraction.boxes,
    portals: extraction.portals,
  };

  const warnings = [...extraction.warnings];

  if (!cli.width && !cli.height) {
    const bounds = getLevelGeometryBounds(level);

    if (bounds) {
      normalizeLevelToBounds(level, bounds);
      warnings.push(
        `Normalized to geometry bounds corners (${formatNumber(bounds.width)} x ${formatNumber(bounds.height)}).`,
      );
    }
  }

  const scaleDecision = resolveScaleDecision(level, cli, {
    sourceDoorOpeningSpan,
  });
  if (
    scaleDecision &&
    (Math.abs(scaleDecision.scaleX - 1) > 1e-6 || Math.abs(scaleDecision.scaleY - 1) > 1e-6)
  ) {
    applyScale(level, scaleDecision.scaleX, scaleDecision.scaleY);
    warnings.push(
      `Applied scale x=${formatNumber(scaleDecision.scaleX)}, y=${formatNumber(scaleDecision.scaleY)} (${scaleDecision.reason}).`,
    );
  }

  if (scaleDecision?.targetLevelWidth && scaleDecision?.targetLevelHeight) {
    const centered = centerLevelWithinBounds(
      level,
      scaleDecision.targetLevelWidth,
      scaleDecision.targetLevelHeight,
    );

    if (centered.offsetX > 0 || centered.offsetY > 0) {
      warnings.push(
        `Centered level within ${formatNumber(centered.width)}x${formatNumber(centered.height)} (offset x=${formatNumber(centered.offsetX)}, y=${formatNumber(centered.offsetY)}).`,
      );
    }
  }

  level.boxes = clampBoxesToBounds(level.boxes, level.width, level.height);

  const validationErrors = validateLevel(level);

  if (validationErrors.length > 0) {
    const message = validationErrors.map((line) => `- ${line}`).join("\n");
    throw new Error(`Level validation failed:\n${message}`);
  }

  warnings.push(...buildPortalWarnings(level));

  if (level.boxes.length === 0) {
    warnings.push(
      "No collision markers found. Add rect markers with data-kind=\"collision\" or wall paths.",
    );
  }

  if (level.portals.length === 0) {
    warnings.push(
      "No portal markers found. Add circle markers with data-kind=\"portal\" and required data-target-* attributes.",
    );
  }

  await emitOutput(level, cli.outputPath);

  let levelsWriteSummary: string | undefined;
  if (cli.append || cli.replace) {
    const writeMode: SharedLevelsWriteMode = cli.replace ? "replace" : "append";
    levelsWriteSummary = await writeLevelToSharedLevels(level, writeMode);
  }

  console.log(`Converted ${cli.inputPath} -> level ${level.id}`);
  console.log(`Dimensions: ${formatNumber(level.width)} x ${formatNumber(level.height)}`);
  console.log(`Boxes: ${level.boxes.length}`);
  console.log(`Portals: ${level.portals.length}`);

  if (levelsWriteSummary) {
    console.log(levelsWriteSummary);
  }

  if (warnings.length > 0) {
    console.warn("Warnings:");
    for (const warning of warnings) {
      console.warn(`- ${warning}`);
    }
  }
}

function parseCliOptions(argv: string[]): CliOptions | undefined {
  const args = new Map<string, string>();
  const boolFlags = new Set<string>();
  const standaloneBoolFlags = new Set(["append", "replace"]);

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];

    if (token === "--help" || token === "-h") {
      console.log(HELP_TEXT.trim());
      return undefined;
    }

    if (!token.startsWith("--")) {
      throw new Error(`Unexpected argument: ${token}`);
    }

    const key = token.slice(2);

    if (standaloneBoolFlags.has(key)) {
      boolFlags.add(key);
      continue;
    }

    const value = argv[index + 1];

    if (!value || value.startsWith("--")) {
      throw new Error(`Expected a value after --${key}`);
    }

    args.set(key, value);
    index += 1;
  }

  const inputPath = getRequiredArg(args, "in");
  const levelId = getRequiredArg(args, "id").trim();

  if (!levelId) {
    throw new Error("--id cannot be empty.");
  }

  const levelName = args.get("name")?.trim() || titleizeId(levelId);
  const wallsMode = parseWallsMode(args.get("walls") ?? "fallback");

  if (boolFlags.has("append") && boolFlags.has("replace")) {
    throw new Error("Use either --append or --replace, but not both.");
  }

  return {
    inputPath,
    levelId,
    levelName,
    outputPath: args.get("out"),
    append: boolFlags.has("append"),
    replace: boolFlags.has("replace"),
    width: getOptionalNumberArg(args, "width"),
    height: getOptionalNumberArg(args, "height"),
    scale: getOptionalNumberArg(args, "scale"),
    scaleLikeExisting: getOptionalBooleanArg(args, "scale-like-existing", true),
    wallThickness: getOptionalNumberArg(args, "wall-thickness"),
    doorWidth: getOptionalNumberArg(args, "door-width"),
    doorPadding: getOptionalNumberArg(args, "door-padding"),
    wallsMode,
    backgroundColor: args.get("background"),
    gridColor: args.get("grid"),
    boxFillColor: args.get("box-fill"),
    boxStrokeColor: args.get("box-stroke"),
  };
}

function parseWallsMode(rawMode: string): WallsMode {
  const normalized = rawMode.trim().toLowerCase();

  if (
    normalized === "off" ||
    normalized === "marker" ||
    normalized === "fallback" ||
    normalized === "all"
  ) {
    return normalized;
  }

  throw new Error(`Invalid --walls mode: ${rawMode}. Use off|marker|fallback|all.`);
}

function getRequiredArg(args: Map<string, string>, key: string): string {
  const value = args.get(key);

  if (!value) {
    throw new Error(`Missing required argument --${key}`);
  }

  return value;
}

function getOptionalBooleanArg(
  args: Map<string, string>,
  key: string,
  fallback: boolean,
): boolean {
  const raw = args.get(key);

  if (!raw) {
    return fallback;
  }

  const normalized = raw.trim().toLowerCase();

  if (normalized === "true" || normalized === "1" || normalized === "yes") {
    return true;
  }

  if (normalized === "false" || normalized === "0" || normalized === "no") {
    return false;
  }

  throw new Error(`--${key} must be true or false.`);
}

function getOptionalNumberArg(args: Map<string, string>, key: string): number | undefined {
  const raw = args.get(key);

  if (!raw) {
    return undefined;
  }

  const parsed = Number(raw);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`--${key} must be a positive number.`);
  }

  return parsed;
}

function titleizeId(levelId: string): string {
  return levelId
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function resolveLevelSize(
  svgAttrs: Record<string, string>,
  cli: CliOptions,
): { width: number; height: number } {
  if (cli.width && cli.height) {
    return { width: cli.width, height: cli.height };
  }

  const attrWidth = parseSvgNumber(svgAttrs.width);
  const attrHeight = parseSvgNumber(svgAttrs.height);

  if (attrWidth && attrHeight) {
    return {
      width: cli.width ?? attrWidth,
      height: cli.height ?? attrHeight,
    };
  }

  const viewBox = svgAttrs.viewBox?.trim().split(/[\s,]+/).map(Number);

  if (viewBox && viewBox.length === 4) {
    const width = cli.width ?? viewBox[2];
    const height = cli.height ?? viewBox[3];

    if (Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0) {
      return { width, height };
    }
  }

  throw new Error(
    "Could not resolve level dimensions. Add width/height to SVG or pass --width and --height.",
  );
}

function deriveWallThickness(width: number, height: number): number {
  const shortest = Math.max(1, Math.min(width, height));
  return Math.max(0.9, shortest * 0.004);
}

function extractGameplay(svg: Record<string, unknown>, options: ExtractionOptions): ParseResult {
  const collisionBoxes: LevelBox[] = [];
  const portals: LevelPortal[] = [];
  const errors: string[] = [];
  const warnings: string[] = [];
  const markerIds = new Set<string>();

  const explicitWallPaths: PathMarker[] = [];
  const explicitDoorPaths: PathMarker[] = [];
  const doorRectCutouts: LevelBox[] = [];
  const allPathCandidates: PathMarker[] = [];

  const visit = (
    name: string,
    node: Record<string, unknown>,
    context: SvgTraversalContext,
  ): void => {
    const elementName = getLocalName(name);
    const attrs = getAttributes(node);
    const kind = normalizeKind(attrs["data-kind"] ?? context.inheritedKind);

    if (kind && attrs.transform) {
      warnings.push(
        `${formatNode(name, attrs)} uses transform. Gameplay transforms are not resolved by this converter.`,
      );
    }

    if (elementName === "rect" && kind === "collision") {
      const x = getRequiredNumber(attrs, "x", errors, name);
      const y = getRequiredNumber(attrs, "y", errors, name);
      const width = getRequiredNumber(attrs, "width", errors, name);
      const height = getRequiredNumber(attrs, "height", errors, name);

      if (width <= 0 || height <= 0) {
        errors.push(`${formatNode(name, attrs)} width/height must be > 0.`);
      } else {
        collisionBoxes.push({ x, y, width, height });
      }

      const maybeId = attrs.id;
      if (maybeId) {
        registerMarkerId(maybeId, markerIds, errors, name);
      }
    }

    if (elementName === "rect" && isDoorKind(kind)) {
      const x = getRequiredNumber(attrs, "x", errors, name);
      const y = getRequiredNumber(attrs, "y", errors, name);
      const width = getRequiredNumber(attrs, "width", errors, name);
      const height = getRequiredNumber(attrs, "height", errors, name);

      if (width > 0 && height > 0) {
        const span = options.doorPadding;
        doorRectCutouts.push({
          x: x - span,
          y: y - span,
          width: width + span * 2,
          height: height + span * 2,
        });
      }

      const maybeId = attrs.id;
      if (maybeId) {
        registerMarkerId(maybeId, markerIds, errors, name);
      }
    }

    if (elementName === "circle" && kind === "portal") {
      const portal = parsePortal(attrs, errors);

      if (portal) {
        portals.push(portal);
        registerMarkerId(portal.id, markerIds, errors, name);
      }
    }

    if (elementName === "path") {
      const d = attrs.d?.trim();
      if (d) {
        const marker: PathMarker = { label: formatNode(name, attrs), d };
        allPathCandidates.push(marker);

        if (isWallKind(kind)) {
          explicitWallPaths.push(marker);
          if (attrs.id?.trim()) {
            registerMarkerId(attrs.id, markerIds, errors, name);
          }
        }

        if (isDoorKind(kind)) {
          explicitDoorPaths.push(marker);
          if (attrs.id?.trim()) {
            registerMarkerId(attrs.id, markerIds, errors, name);
          }
        }
      }
    }

    for (const child of getElementChildren(node)) {
      visit(child.name, child.node, { inheritedKind: kind });
    }
  };

  for (const child of getElementChildren(svg)) {
    visit(child.name, child.node, { inheritedKind: undefined });
  }

  const wallPathSource = selectWallPathSource(
    options.wallsMode,
    collisionBoxes.length,
    explicitWallPaths,
    allPathCandidates,
  );

  if (wallPathSource.mode === "fallback") {
    warnings.push(
      "No explicit wall path markers were found, so path-to-wall fallback was applied to all SVG paths.",
    );
  }

  if (wallPathSource.mode === "marker-missing") {
    warnings.push(
      "Walls mode is marker, but no path markers with data-kind=\"wall\" (or data-kind=\"collision\") were found.",
    );
  }

  if (wallPathSource.paths.length > 0 && options.wallThickness <= 0) {
    errors.push("wall thickness must be > 0.");
  }

  const wallBoxes: LevelBox[] = [];
  for (const marker of wallPathSource.paths) {
    wallBoxes.push(...pathToWallBoxes(marker, options.wallThickness, warnings));
  }

  const doorCutouts: LevelBox[] = [...doorRectCutouts];

  if (explicitDoorPaths.length > 0) {
    for (const marker of explicitDoorPaths) {
      doorCutouts.push(...pathToDoorCutouts(marker, options.doorWidth, options.doorPadding, warnings));
    }
  }

  let cleanedWalls = dedupeBoxes(wallBoxes);

  if (doorCutouts.length > 0) {
    cleanedWalls = subtractCutoutsFromBoxes(cleanedWalls, doorCutouts);
  }

  cleanedWalls = cleanupWallBoxes(cleanedWalls, options.wallThickness);

  const combinedBoxes = dedupeBoxes([...collisionBoxes, ...cleanedWalls]);

  return {
    boxes: combinedBoxes,
    portals,
    warnings,
    errors,
  };
}

function isWallKind(kind: string | undefined): boolean {
  return kind === "wall" || kind === "collision" || kind === "collision-wall";
}

function isDoorKind(kind: string | undefined): boolean {
  return kind === "door" || kind === "opening";
}

function selectWallPathSource(
  wallsMode: WallsMode,
  collisionRectCount: number,
  explicitPaths: PathMarker[],
  allPaths: PathMarker[],
): { mode: "marker" | "fallback" | "all" | "off" | "marker-missing"; paths: PathMarker[] } {
  if (wallsMode === "off") {
    return { mode: "off", paths: [] };
  }

  if (wallsMode === "all") {
    return { mode: "all", paths: allPaths };
  }

  if (explicitPaths.length > 0) {
    return { mode: "marker", paths: explicitPaths };
  }

  if (wallsMode === "marker") {
    return { mode: "marker-missing", paths: [] };
  }

  if (collisionRectCount === 0 && allPaths.length > 0) {
    return { mode: "fallback", paths: allPaths };
  }

  return { mode: "marker", paths: [] };
}

function parsePortal(
  attrs: Record<string, string>,
  errors: string[],
): LevelPortal | undefined {
  const id = attrs.id?.trim();

  if (!id) {
    errors.push("Portal circle is missing required id.");
    return undefined;
  }

  const x = getRequiredNumber(attrs, "cx", errors, `portal#${id}`);
  const y = getRequiredNumber(attrs, "cy", errors, `portal#${id}`);
  const radius = getRequiredNumber(attrs, "r", errors, `portal#${id}`);
  const targetLevelId = attrs["data-target-level"]?.trim();

  if (!targetLevelId) {
    errors.push(`portal#${id} is missing data-target-level.`);
    return undefined;
  }

  const targetX = getRequiredNumber(attrs, "data-target-x", errors, `portal#${id}`);
  const targetY = getRequiredNumber(attrs, "data-target-y", errors, `portal#${id}`);

  if (radius <= 0) {
    errors.push(`portal#${id} must have r > 0.`);
  }

  return {
    id,
    x,
    y,
    radius,
    color: readPortalColor(attrs),
    targetLevelId,
    targetX,
    targetY,
  };
}

function readPortalColor(attrs: Record<string, string>): string {
  const fromData = attrs["data-color"]?.trim();
  if (fromData) {
    return fromData;
  }

  const fromFill = attrs.fill?.trim();
  if (fromFill && fromFill !== "none") {
    return fromFill;
  }

  const styleFill = getStyleValue(attrs.style, "fill");
  if (styleFill && styleFill !== "none") {
    return styleFill;
  }

  const fromStroke = attrs.stroke?.trim();
  if (fromStroke && fromStroke !== "none") {
    return fromStroke;
  }

  const styleStroke = getStyleValue(attrs.style, "stroke");
  if (styleStroke && styleStroke !== "none") {
    return styleStroke;
  }

  return DEFAULT_COLORS.portalColor;
}

function getStyleValue(styleValue: string | undefined, key: string): string | undefined {
  if (!styleValue) {
    return undefined;
  }

  for (const declaration of styleValue.split(";")) {
    const [rawProperty, rawValue] = declaration.split(":");
    if (!rawProperty || !rawValue) {
      continue;
    }

    if (rawProperty.trim() === key) {
      return rawValue.trim();
    }
  }

  return undefined;
}

function getRequiredNumber(
  attrs: Record<string, string>,
  key: string,
  errors: string[],
  nodeLabel: string,
): number {
  const raw = attrs[key];
  const value = parseSvgNumber(raw);

  if (!raw || value === undefined) {
    errors.push(`${nodeLabel} is missing numeric ${key}.`);
    return Number.NaN;
  }

  return value;
}

function resolveScaleDecision(
  level: LevelConfig,
  cli: CliOptions,
  autoScaleInputs: AutoScaleInputs,
): ScaleDecision | undefined {
  if (cli.scale) {
    return {
      scaleX: cli.scale,
      scaleY: cli.scale,
      reason: "manual --scale",
    };
  }

  if (!cli.scaleLikeExisting) {
    return undefined;
  }

  if (cli.width || cli.height) {
    return undefined;
  }

  const sourceWidth = level.width;
  const sourceHeight = level.height;

  if (!Number.isFinite(sourceWidth) || !Number.isFinite(sourceHeight)) {
    return undefined;
  }

  if (sourceWidth <= 0 || sourceHeight <= 0) {
    return undefined;
  }

  const referenceLevels = getReferenceLevels(level.id);
  const targetWidth = median(referenceLevels.map((entry) => entry.width));
  const targetHeight = median(referenceLevels.map((entry) => entry.height));

  if (!Number.isFinite(targetWidth) || !Number.isFinite(targetHeight)) {
    return undefined;
  }

  // Keep source geometry ratio by fitting within reference dimensions using one scale factor.
  const fitScale = Math.min(targetWidth / sourceWidth, targetHeight / sourceHeight);
  const requiredOpening = PLAYER_RADIUS * 2 + 6;
  const openingScale =
    autoScaleInputs.sourceDoorOpeningSpan > 0
      ? requiredOpening / autoScaleInputs.sourceDoorOpeningSpan
      : fitScale;
  const uniformScale = Math.max(fitScale, openingScale);

  if (Math.abs(uniformScale - 1) <= 0.08) {
    return undefined;
  }

  const walkabilityRaised = openingScale > fitScale + 1e-6;
  const reason = walkabilityRaised
    ? `auto-scale keeps aspect ratio, fits/centers to reference bounds, and raises scale for walkable openings (target >= ${formatNumber(requiredOpening)})`
    : `auto-scale bounds to fit within median reference size ${formatNumber(targetWidth)}x${formatNumber(targetHeight)} (aspect ratio preserved)`;

  return {
    scaleX: uniformScale,
    scaleY: uniformScale,
    reason,
    targetLevelWidth: targetWidth,
    targetLevelHeight: targetHeight,
  };
}

function centerLevelWithinBounds(
  level: LevelConfig,
  minWidth: number,
  minHeight: number,
): CenterResult {
  const centeredWidth = Math.max(minWidth, level.width);
  const centeredHeight = Math.max(minHeight, level.height);
  const offsetX = (centeredWidth - level.width) * 0.5;
  const offsetY = (centeredHeight - level.height) * 0.5;

  if (offsetX <= 0 && offsetY <= 0) {
    level.width = round(centeredWidth, 3);
    level.height = round(centeredHeight, 3);
    return {
      offsetX: 0,
      offsetY: 0,
      width: level.width,
      height: level.height,
    };
  }

  const shiftX = round(offsetX, 3);
  const shiftY = round(offsetY, 3);

  level.boxes = level.boxes.map((box) => {
    return {
      x: round(box.x + shiftX, 3),
      y: round(box.y + shiftY, 3),
      width: box.width,
      height: box.height,
    };
  });

  level.portals = level.portals.map((portal) => {
    const shiftedTarget =
      portal.targetLevelId === level.id
        ? {
            targetX: round(portal.targetX + shiftX, 3),
            targetY: round(portal.targetY + shiftY, 3),
          }
        : {
            targetX: portal.targetX,
            targetY: portal.targetY,
          };

    return {
      ...portal,
      x: round(portal.x + shiftX, 3),
      y: round(portal.y + shiftY, 3),
      ...shiftedTarget,
    };
  });

  level.width = round(centeredWidth, 3);
  level.height = round(centeredHeight, 3);

  return {
    offsetX: shiftX,
    offsetY: shiftY,
    width: level.width,
    height: level.height,
  };
}

function applyScale(level: LevelConfig, scaleX: number, scaleY: number): void {
  level.width = round(level.width * scaleX, 3);
  level.height = round(level.height * scaleY, 3);
  const radiusScale = Math.sqrt(scaleX * scaleY);

  level.boxes = level.boxes.map((box) => {
    return {
      x: round(box.x * scaleX, 3),
      y: round(box.y * scaleY, 3),
      width: round(box.width * scaleX, 3),
      height: round(box.height * scaleY, 3),
    };
  });

  level.portals = level.portals.map((portal) => {
    const scaledTarget =
      portal.targetLevelId === level.id
        ? {
            targetX: round(portal.targetX * scaleX, 3),
            targetY: round(portal.targetY * scaleY, 3),
          }
        : {
            targetX: portal.targetX,
            targetY: portal.targetY,
          };

    return {
      ...portal,
      x: round(portal.x * scaleX, 3),
      y: round(portal.y * scaleY, 3),
      radius: round(portal.radius * radiusScale, 3),
      ...scaledTarget,
    };
  });
}

function clampBoxesToBounds(boxes: readonly LevelBox[], width: number, height: number): LevelBox[] {
  const clamped: LevelBox[] = [];

  for (const box of boxes) {
    const left = Math.max(0, box.x);
    const top = Math.max(0, box.y);
    const right = Math.min(width, box.x + box.width);
    const bottom = Math.min(height, box.y + box.height);

    const clippedWidth = right - left;
    const clippedHeight = bottom - top;

    if (clippedWidth <= 0.5 || clippedHeight <= 0.5) {
      continue;
    }

    clamped.push({
      x: round(left, 3),
      y: round(top, 3),
      width: round(clippedWidth, 3),
      height: round(clippedHeight, 3),
    });
  }

  return dedupeBoxes(clamped);
}

function getReferenceLevels(levelId: string): readonly LevelConfig[] {
  const canonicalIds = new Set(["orbit", "ember", "void"]);
  const canonicalLevels = LEVELS.filter((entry) => canonicalIds.has(entry.id));

  if (canonicalLevels.length >= 2) {
    return canonicalLevels;
  }

  const otherLevels = LEVELS.filter((entry) => entry.id !== levelId);

  if (otherLevels.length > 0) {
    return otherLevels;
  }

  return LEVELS;
}

function getLevelGeometryBounds(level: LevelConfig): LevelBounds | undefined {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (const box of level.boxes) {
    minX = Math.min(minX, box.x);
    minY = Math.min(minY, box.y);
    maxX = Math.max(maxX, box.x + box.width);
    maxY = Math.max(maxY, box.y + box.height);
  }

  for (const portal of level.portals) {
    minX = Math.min(minX, portal.x - portal.radius);
    minY = Math.min(minY, portal.y - portal.radius);
    maxX = Math.max(maxX, portal.x + portal.radius);
    maxY = Math.max(maxY, portal.y + portal.radius);
  }

  if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) {
    return undefined;
  }

  const width = maxX - minX;
  const height = maxY - minY;

  if (width <= 0 || height <= 0) {
    return undefined;
  }

  return {
    minX,
    minY,
    maxX,
    maxY,
    width,
    height,
  };
}

function normalizeLevelToBounds(level: LevelConfig, bounds: LevelBounds): void {
  level.width = round(bounds.width, 3);
  level.height = round(bounds.height, 3);

  level.boxes = level.boxes.map((box) => {
    return {
      x: round(box.x - bounds.minX, 3),
      y: round(box.y - bounds.minY, 3),
      width: round(box.width, 3),
      height: round(box.height, 3),
    };
  });

  level.portals = level.portals.map((portal) => {
    const normalizedTarget =
      portal.targetLevelId === level.id
        ? {
            targetX: round(portal.targetX - bounds.minX, 3),
            targetY: round(portal.targetY - bounds.minY, 3),
          }
        : {
            targetX: portal.targetX,
            targetY: portal.targetY,
          };

    return {
      ...portal,
      x: round(portal.x - bounds.minX, 3),
      y: round(portal.y - bounds.minY, 3),
      ...normalizedTarget,
    };
  });
}

function validateLevel(level: LevelConfig): string[] {
  const errors: string[] = [];

  if (!level.id.trim()) {
    errors.push("level.id cannot be empty.");
  }

  if (level.width <= 0 || level.height <= 0) {
    errors.push("level width/height must be > 0.");
  }

  for (let index = 0; index < level.boxes.length; index += 1) {
    const box = level.boxes[index];

    if (!isFiniteNumber(box.x) || !isFiniteNumber(box.y)) {
      errors.push(`boxes[${index}] has non-finite coordinates.`);
      continue;
    }

    if (box.width <= 0 || box.height <= 0) {
      errors.push(`boxes[${index}] width/height must be > 0.`);
    }

    if (box.x < 0 || box.y < 0) {
      errors.push(`boxes[${index}] starts outside the level bounds.`);
    }

    if (box.x + box.width > level.width || box.y + box.height > level.height) {
      errors.push(`boxes[${index}] extends outside level bounds ${level.width}x${level.height}.`);
    }
  }

  const portalIds = new Set<string>();

  for (let index = 0; index < level.portals.length; index += 1) {
    const portal = level.portals[index];

    if (portalIds.has(portal.id)) {
      errors.push(`portals[${index}] duplicate id: ${portal.id}`);
    }
    portalIds.add(portal.id);

    if (portal.radius <= 0) {
      errors.push(`portals[${index}] radius must be > 0.`);
    }

    if (!isFiniteNumber(portal.x) || !isFiniteNumber(portal.y)) {
      errors.push(`portals[${index}] has non-finite coordinates.`);
    }

    if (portal.x < 0 || portal.x > level.width || portal.y < 0 || portal.y > level.height) {
      errors.push(`portals[${index}] center is outside this level bounds.`);
    }
  }

  return errors;
}

function buildPortalWarnings(level: LevelConfig): string[] {
  const warnings: string[] = [];

  for (const portal of level.portals) {
    if (portal.targetLevelId === level.id) {
      continue;
    }

    const destination = LEVELS_BY_ID.get(portal.targetLevelId);

    if (!destination) {
      warnings.push(
        `Portal ${portal.id} targets unknown level ${portal.targetLevelId}. Add that level before runtime tests.`,
      );
      continue;
    }

    const inBounds =
      portal.targetX >= 0 &&
      portal.targetX <= destination.width &&
      portal.targetY >= 0 &&
      portal.targetY <= destination.height;

    if (!inBounds) {
      warnings.push(
        `Portal ${portal.id} target point (${portal.targetX}, ${portal.targetY}) is outside ${destination.id} bounds ${destination.width}x${destination.height}.`,
      );
    }
  }

  return warnings;
}

async function emitOutput(level: LevelConfig, outputPath: string | undefined): Promise<void> {
  const payload = {
    level,
    generatedAt: new Date().toISOString(),
  };

  if (!outputPath) {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  const absoluteOutput = path.resolve(outputPath);
  await fs.mkdir(path.dirname(absoluteOutput), { recursive: true });

  if (absoluteOutput.endsWith(".ts")) {
    const moduleContent = buildTsModule(level, absoluteOutput);
    await fs.writeFile(absoluteOutput, moduleContent, "utf8");
  } else {
    await fs.writeFile(absoluteOutput, JSON.stringify(payload, null, 2) + "\n", "utf8");
  }

  console.log(`Wrote ${absoluteOutput}`);
}

async function writeLevelToSharedLevels(
  level: LevelConfig,
  mode: SharedLevelsWriteMode,
): Promise<string> {
  const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const levelsFilePath = path.resolve(projectRoot, "shared/levels.ts");
  const source = await fs.readFile(levelsFilePath, "utf8");
  const levelLiteral = buildLevelLiteral(level, 2);
  const existingRange = findLevelObjectRangeInLevelsSource(source, level.id);
  const anchorIndex = source.indexOf(LEVELS_ARRAY_END_ANCHOR);

  if (anchorIndex === -1) {
    throw new Error("Could not locate LEVELS array end in shared/levels.ts.");
  }

  if (mode === "append") {
    if (LEVELS_BY_ID.has(level.id) || existingRange) {
      throw new Error(`Level id ${level.id} already exists in shared/levels.ts.`);
    }

    const updated = source.slice(0, anchorIndex) + `${levelLiteral},\n` + source.slice(anchorIndex);
    await fs.writeFile(levelsFilePath, updated, "utf8");
    return `Appended level ${level.id} to ${levelsFilePath}`;
  }

  if (!existingRange) {
    throw new Error(`Cannot replace level ${level.id}: id was not found in shared/levels.ts.`);
  }

  const updated = source.slice(0, existingRange.start) + levelLiteral + source.slice(existingRange.end);
  await fs.writeFile(levelsFilePath, updated, "utf8");
  return `Replaced level ${level.id} in ${levelsFilePath}`;
}

function findLevelObjectRangeInLevelsSource(source: string, levelId: string): SourceRange | undefined {
  const levelsDecl = "export const LEVELS: readonly LevelConfig[] = [";
  const declIndex = source.indexOf(levelsDecl);

  if (declIndex === -1) {
    throw new Error("Could not locate LEVELS declaration in shared/levels.ts.");
  }

  const arrayOpenIndex = source.indexOf("[", declIndex);
  const arrayEndIndex = source.indexOf(LEVELS_ARRAY_END_ANCHOR, declIndex);

  if (arrayOpenIndex === -1 || arrayEndIndex === -1 || arrayEndIndex <= arrayOpenIndex) {
    throw new Error("Could not parse LEVELS array in shared/levels.ts.");
  }

  const arrayBodyStart = arrayOpenIndex + 1;
  const arrayBody = source.slice(arrayBodyStart, arrayEndIndex);
  const objectRanges = findTopLevelObjectRanges(arrayBody);
  const idPattern = new RegExp(`\\bid\\s*:\\s*["']${escapeRegExp(levelId)}["']`);

  for (const range of objectRanges) {
    const objectSource = arrayBody.slice(range.start, range.end);
    if (!idPattern.test(objectSource)) {
      continue;
    }

    const lineStart = arrayBody.lastIndexOf("\n", range.start);
    const localStart = lineStart === -1 ? range.start : lineStart + 1;

    return {
      start: arrayBodyStart + localStart,
      end: arrayBodyStart + range.end,
    };
  }

  return undefined;
}

function findTopLevelObjectRanges(source: string): SourceRange[] {
  const ranges: SourceRange[] = [];
  let depth = 0;
  let objectStart = -1;
  let inString = false;
  let quoteChar = "";
  let escaped = false;

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];

    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }

      if (char === "\\") {
        escaped = true;
        continue;
      }

      if (char === quoteChar) {
        inString = false;
        quoteChar = "";
      }

      continue;
    }

    if (char === '"' || char === "'" || char === "`") {
      inString = true;
      quoteChar = char;
      continue;
    }

    if (char === "{") {
      if (depth === 0) {
        objectStart = index;
      }
      depth += 1;
      continue;
    }

    if (char === "}") {
      if (depth === 0) {
        continue;
      }

      depth -= 1;
      if (depth === 0 && objectStart >= 0) {
        ranges.push({ start: objectStart, end: index + 1 });
        objectStart = -1;
      }
    }
  }

  return ranges;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&");
}

function buildTsModule(level: LevelConfig, outputPath: string): string {
  const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const levelsPath = path.resolve(projectRoot, "shared/levels.ts");
  let importPath = path.relative(path.dirname(outputPath), levelsPath).replaceAll("\\", "/");

  if (!importPath.startsWith(".")) {
    importPath = `./${importPath}`;
  }

  const exportName = toPascalCase(level.id) + "Level";
  const levelJson = JSON.stringify(level, null, 2);

  return [
    `import type { LevelConfig } from \"${importPath}\";`,
    "",
    `export const ${exportName}: LevelConfig = ${levelJson};`,
    "",
  ].join("\n");
}

function buildLevelLiteral(level: LevelConfig, baseIndent: number): string {
  const i0 = " ".repeat(baseIndent);
  const i1 = " ".repeat(baseIndent + 2);
  const i2 = " ".repeat(baseIndent + 4);
  const i3 = " ".repeat(baseIndent + 6);

  const lines: string[] = [];

  lines.push(`${i0}{`);
  lines.push(`${i1}id: ${JSON.stringify(level.id)},`);
  lines.push(`${i1}name: ${JSON.stringify(level.name)},`);
  lines.push(`${i1}width: ${formatNumber(level.width)},`);
  lines.push(`${i1}height: ${formatNumber(level.height)},`);
  lines.push(`${i1}backgroundColor: ${JSON.stringify(level.backgroundColor)},`);
  lines.push(`${i1}gridColor: ${JSON.stringify(level.gridColor)},`);
  lines.push(`${i1}boxFillColor: ${JSON.stringify(level.boxFillColor)},`);
  lines.push(`${i1}boxStrokeColor: ${JSON.stringify(level.boxStrokeColor)},`);

  lines.push(`${i1}boxes: [`);
  for (const box of level.boxes) {
    lines.push(
      `${i2}{ x: ${formatNumber(box.x)}, y: ${formatNumber(box.y)}, width: ${formatNumber(box.width)}, height: ${formatNumber(box.height)} },`,
    );
  }
  lines.push(`${i1}],`);

  lines.push(`${i1}portals: [`);
  for (const portal of level.portals) {
    lines.push(`${i2}{`);
    lines.push(`${i3}id: ${JSON.stringify(portal.id)},`);
    lines.push(`${i3}x: ${formatNumber(portal.x)},`);
    lines.push(`${i3}y: ${formatNumber(portal.y)},`);
    lines.push(`${i3}radius: ${formatNumber(portal.radius)},`);
    lines.push(`${i3}color: ${JSON.stringify(portal.color)},`);
    lines.push(`${i3}targetLevelId: ${JSON.stringify(portal.targetLevelId)},`);
    lines.push(`${i3}targetX: ${formatNumber(portal.targetX)},`);
    lines.push(`${i3}targetY: ${formatNumber(portal.targetY)},`);
    lines.push(`${i2}},`);
  }
  lines.push(`${i1}],`);

  lines.push(`${i0}}`);

  return lines.join("\n");
}

function toPascalCase(value: string): string {
  const cleaned = value.replace(/[^a-zA-Z0-9]+/g, " ").trim();

  if (!cleaned) {
    return "Generated";
  }

  return cleaned
    .split(/\s+/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
}

function normalizeKind(rawKind: string | undefined): string | undefined {
  if (!rawKind) {
    return undefined;
  }

  const value = rawKind.trim().toLowerCase();
  return value || undefined;
}

function getLocalName(tagName: string): string {
  const separatorIndex = tagName.indexOf(":");

  if (separatorIndex === -1) {
    return tagName;
  }

  return tagName.slice(separatorIndex + 1);
}

function registerMarkerId(
  id: string,
  markerIds: Set<string>,
  errors: string[],
  nodeLabel: string,
): void {
  if (markerIds.has(id)) {
    errors.push(`${nodeLabel} has duplicate id ${id}.`);
  }

  markerIds.add(id);
}

function formatNode(name: string, attrs: Record<string, string>): string {
  const id = attrs.id?.trim();
  return id ? `${name}#${id}` : `<${name}>`;
}

function getAttributes(node: Record<string, unknown>): Record<string, string> {
  const attrs: Record<string, string> = {};

  for (const [key, value] of Object.entries(node)) {
    if (!key.startsWith("@_")) {
      continue;
    }

    attrs[key.slice(2)] = String(value);
  }

  return attrs;
}

function getElementChildren(
  node: Record<string, unknown>,
): Array<{ name: string; node: Record<string, unknown> }> {
  const children: Array<{ name: string; node: Record<string, unknown> }> = [];

  for (const [key, value] of Object.entries(node)) {
    if (key.startsWith("@_") || key === "#text") {
      continue;
    }

    if (Array.isArray(value)) {
      for (const item of value) {
        if (isObject(item)) {
          children.push({ name: key, node: item });
        }
      }
      continue;
    }

    if (isObject(value)) {
      children.push({ name: key, node: value });
    }
  }

  return children;
}

function pathToWallBoxes(pathMarker: PathMarker, thickness: number, warnings: string[]): LevelBox[] {
  const segments = pathDataToSegments(pathMarker.d, pathMarker.label, warnings);

  if (segments.length === 0) {
    return [];
  }

  const merged = mergeCollinearSegments(segments, Math.max(0.0001, thickness * 0.18));
  return segmentsToThickBoxes(merged, thickness, Math.max(0.75, thickness * 0.95));
}

function pathToDoorCutouts(
  pathMarker: PathMarker,
  doorWidth: number,
  doorPadding: number,
  warnings: string[],
): LevelBox[] {
  const segments = pathDataToSegments(pathMarker.d, pathMarker.label, warnings);

  if (segments.length === 0) {
    return [];
  }

  const span = Math.max(0.3, doorWidth + doorPadding * 2);
  const merged = mergeCollinearSegments(segments, Math.max(0.0001, span * 0.22));
  return segmentsToThickBoxes(merged, span, Math.max(0.5, span * 0.45));
}

function pathDataToSegments(d: string, label: string, warnings: string[]): Segment[] {
  const tokens = tokenizePathData(d);

  if (tokens.length === 0) {
    return [];
  }

  const segments: Segment[] = [];
  let cursor = 0;
  let currentCommand = "";
  let current: Point = { x: 0, y: 0 };
  let subpathStart: Point = { x: 0, y: 0 };

  const nextToken = (): string | undefined => tokens[cursor];

  const readNumber = (): number | undefined => {
    const token = nextToken();

    if (!token || isPathCommand(token)) {
      return undefined;
    }

    cursor += 1;
    const parsed = Number(token);
    return Number.isFinite(parsed) ? parsed : undefined;
  };

  const readNumbers = (count: number): number[] | undefined => {
    const values: number[] = [];

    for (let index = 0; index < count; index += 1) {
      const value = readNumber();
      if (value === undefined) {
        return undefined;
      }

      values.push(value);
    }

    return values;
  };

  while (cursor < tokens.length) {
    const token = nextToken();

    if (token && isPathCommand(token)) {
      currentCommand = token;
      cursor += 1;
    } else if (!currentCommand) {
      warnings.push(`Skipping malformed path at ${label}: missing initial command.`);
      break;
    }

    const upper = currentCommand.toUpperCase();
    const relative = currentCommand === currentCommand.toLowerCase();

    if (upper === "Z") {
      if (!pointsAlmostEqual(current, subpathStart, 1e-9)) {
        segments.push({ from: { ...current }, to: { ...subpathStart } });
      }
      current = { ...subpathStart };
      continue;
    }

    if (upper === "M") {
      const first = readNumbers(2);
      if (!first) {
        warnings.push(`Skipping malformed move command in ${label}.`);
        continue;
      }

      const moveTo = toAbsolutePoint(first[0], first[1], relative, current);
      current = moveTo;
      subpathStart = moveTo;

      while (true) {
        const pair = readNumbers(2);
        if (!pair) {
          break;
        }

        const to = toAbsolutePoint(pair[0], pair[1], relative, current);
        segments.push({ from: { ...current }, to });
        current = to;
      }

      continue;
    }

    if (upper === "L") {
      while (true) {
        const pair = readNumbers(2);
        if (!pair) {
          break;
        }

        const to = toAbsolutePoint(pair[0], pair[1], relative, current);
        segments.push({ from: { ...current }, to });
        current = to;
      }

      continue;
    }

    if (upper === "H") {
      while (true) {
        const value = readNumber();
        if (value === undefined) {
          break;
        }

        const to: Point = relative
          ? { x: current.x + value, y: current.y }
          : { x: value, y: current.y };
        segments.push({ from: { ...current }, to });
        current = to;
      }

      continue;
    }

    if (upper === "V") {
      while (true) {
        const value = readNumber();
        if (value === undefined) {
          break;
        }

        const to: Point = relative
          ? { x: current.x, y: current.y + value }
          : { x: current.x, y: value };
        segments.push({ from: { ...current }, to });
        current = to;
      }

      continue;
    }

    if (upper === "C") {
      while (true) {
        const params = readNumbers(6);
        if (!params) {
          break;
        }

        const to = toAbsolutePoint(params[4], params[5], relative, current);
        segments.push({ from: { ...current }, to });
        current = to;
      }

      continue;
    }

    if (upper === "S") {
      while (true) {
        const params = readNumbers(4);
        if (!params) {
          break;
        }

        const to = toAbsolutePoint(params[2], params[3], relative, current);
        segments.push({ from: { ...current }, to });
        current = to;
      }

      continue;
    }

    if (upper === "Q") {
      while (true) {
        const params = readNumbers(4);
        if (!params) {
          break;
        }

        const to = toAbsolutePoint(params[2], params[3], relative, current);
        segments.push({ from: { ...current }, to });
        current = to;
      }

      continue;
    }

    if (upper === "T") {
      while (true) {
        const params = readNumbers(2);
        if (!params) {
          break;
        }

        const to = toAbsolutePoint(params[0], params[1], relative, current);
        segments.push({ from: { ...current }, to });
        current = to;
      }

      continue;
    }

    if (upper === "A") {
      while (true) {
        const params = readNumbers(7);
        if (!params) {
          break;
        }

        const to = toAbsolutePoint(params[5], params[6], relative, current);
        segments.push({ from: { ...current }, to });
        current = to;
      }

      continue;
    }

    warnings.push(`Unsupported path command ${currentCommand} in ${label}.`);
    break;
  }

  return segments.filter((segment) => !pointsAlmostEqual(segment.from, segment.to, 1e-9));
}

function tokenizePathData(d: string): string[] {
  const tokens: string[] = [];
  const regex = /[AaCcHhLlMmQqSsTtVvZz]|[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g;

  for (const match of d.matchAll(regex)) {
    tokens.push(match[0]);
  }

  return tokens;
}

function isPathCommand(token: string): boolean {
  return /^[AaCcHhLlMmQqSsTtVvZz]$/.test(token);
}

function toAbsolutePoint(x: number, y: number, relative: boolean, current: Point): Point {
  if (relative) {
    return {
      x: current.x + x,
      y: current.y + y,
    };
  }

  return { x, y };
}

function mergeCollinearSegments(segments: Segment[], tolerance: number): Segment[] {
  if (segments.length <= 1) {
    return segments;
  }

  const merged: Segment[] = [];
  let active = { ...segments[0], from: { ...segments[0].from }, to: { ...segments[0].to } };

  for (let index = 1; index < segments.length; index += 1) {
    const next = segments[index];

    if (
      pointsAlmostEqual(active.to, next.from, tolerance) &&
      segmentsAreMergeable(active, next, tolerance)
    ) {
      active = {
        from: active.from,
        to: next.to,
      };
      continue;
    }

    merged.push(active);
    active = { ...next, from: { ...next.from }, to: { ...next.to } };
  }

  merged.push(active);
  return merged;
}

function segmentsAreMergeable(a: Segment, b: Segment, tolerance: number): boolean {
  const adx = a.to.x - a.from.x;
  const ady = a.to.y - a.from.y;
  const bdx = b.to.x - b.from.x;
  const bdy = b.to.y - b.from.y;

  const aVertical = Math.abs(adx) <= tolerance;
  const bVertical = Math.abs(bdx) <= tolerance;

  if (aVertical && bVertical) {
    return Math.abs(a.from.x - b.from.x) <= tolerance;
  }

  const aHorizontal = Math.abs(ady) <= tolerance;
  const bHorizontal = Math.abs(bdy) <= tolerance;

  if (aHorizontal && bHorizontal) {
    return Math.abs(a.from.y - b.from.y) <= tolerance;
  }

  const cross = adx * bdy - ady * bdx;
  return Math.abs(cross) <= tolerance;
}

function segmentsToThickBoxes(
  segments: Segment[],
  thickness: number,
  minLength: number,
): LevelBox[] {
  const boxes: LevelBox[] = [];
  const half = thickness / 2;
  const orthogonalSnap = Math.max(0.0001, thickness * 0.16);

  for (const segment of segments) {
    let dx = segment.to.x - segment.from.x;
    let dy = segment.to.y - segment.from.y;

    if (Math.abs(dx) <= orthogonalSnap) {
      dx = 0;
    }

    if (Math.abs(dy) <= orthogonalSnap) {
      dy = 0;
    }

    const length = Math.hypot(dx, dy);

    if (length < minLength) {
      continue;
    }

    const fromX = segment.from.x;
    const fromY = segment.from.y;
    const toX = fromX + dx;
    const toY = fromY + dy;

    const x = Math.min(fromX, toX) - half;
    const y = Math.min(fromY, toY) - half;
    const width = Math.abs(dx) + thickness;
    const height = Math.abs(dy) + thickness;

    boxes.push({
      x: round(x, 3),
      y: round(y, 3),
      width: round(width, 3),
      height: round(height, 3),
    });
  }

  return dedupeBoxes(boxes);
}

function subtractCutoutsFromBoxes(
  boxes: readonly LevelBox[],
  cutouts: readonly LevelBox[],
): LevelBox[] {
  let working = [...boxes];

  for (const cutout of cutouts) {
    const next: LevelBox[] = [];

    for (const box of working) {
      next.push(...subtractRect(box, cutout));
    }

    working = next;
  }

  return dedupeBoxes(working);
}

function subtractRect(box: LevelBox, cutout: LevelBox): LevelBox[] {
  const bx1 = box.x;
  const by1 = box.y;
  const bx2 = box.x + box.width;
  const by2 = box.y + box.height;

  const cx1 = cutout.x;
  const cy1 = cutout.y;
  const cx2 = cutout.x + cutout.width;
  const cy2 = cutout.y + cutout.height;

  const ix1 = Math.max(bx1, cx1);
  const iy1 = Math.max(by1, cy1);
  const ix2 = Math.min(bx2, cx2);
  const iy2 = Math.min(by2, cy2);

  if (ix1 >= ix2 || iy1 >= iy2) {
    return [box];
  }

  const pieces: LevelBox[] = [];

  addRectIfValid(pieces, bx1, by1, bx2 - bx1, iy1 - by1);
  addRectIfValid(pieces, bx1, iy2, bx2 - bx1, by2 - iy2);
  addRectIfValid(pieces, bx1, iy1, ix1 - bx1, iy2 - iy1);
  addRectIfValid(pieces, ix2, iy1, bx2 - ix2, iy2 - iy1);

  return pieces;
}

function cleanupWallBoxes(boxes: readonly LevelBox[], wallThickness: number): LevelBox[] {
  let working = dedupeBoxes(boxes);
  // Use a scale-independent player-clearance proxy in source SVG units.
  // Default door width is 4x wall thickness, which should stay passable for players.
  const playerDiameter = Math.max(1, wallThickness * 4);
  const minLongSide = Math.max(0.7, wallThickness * 0.85, playerDiameter * 0.5);
  const epsilon = Math.max(0.05, wallThickness * 0.08);
  const axisTolerance = Math.max(0.1, wallThickness * 0.34, playerDiameter * 0.09);
  const gapTolerance = Math.max(0.14, wallThickness * 0.75, playerDiameter * 0.75);
  const maxPerpendicularSpan = Math.max(wallThickness * 2.4, playerDiameter * 0.95);
  const snapStep = Math.max(0.06, wallThickness * 0.32, playerDiameter * 0.1);

  working = working.map((box) => {
    return {
      x: snap(box.x, snapStep),
      y: snap(box.y, snapStep),
      width: Math.max(0.05, snap(box.width, snapStep)),
      height: Math.max(0.05, snap(box.height, snapStep)),
    };
  });

  working = dedupeBoxes(working);

  working = working.filter((box) => {
    return Math.max(box.width, box.height) >= minLongSide;
  });

  working = removeContainedBoxes(working, epsilon);
  working = mergeAlignedBoxes(working, axisTolerance, gapTolerance, maxPerpendicularSpan, 12);

  return dedupeBoxes(working);
}

function snap(value: number, step: number): number {
  return round(Math.round(value / step) * step, 3);
}

function removeContainedBoxes(boxes: readonly LevelBox[], epsilon: number): LevelBox[] {
  const result: LevelBox[] = [];

  for (let index = 0; index < boxes.length; index += 1) {
    const box = boxes[index];
    let contained = false;

    for (let compareIndex = 0; compareIndex < boxes.length; compareIndex += 1) {
      if (index === compareIndex) {
        continue;
      }

      const other = boxes[compareIndex];

      if (
        box.x >= other.x - epsilon &&
        box.y >= other.y - epsilon &&
        box.x + box.width <= other.x + other.width + epsilon &&
        box.y + box.height <= other.y + other.height + epsilon
      ) {
        contained = true;
        break;
      }
    }

    if (!contained) {
      result.push(box);
    }
  }

  return result;
}

function mergeAlignedBoxes(
  boxes: readonly LevelBox[],
  axisTolerance: number,
  gapTolerance: number,
  maxPerpendicularSpan: number,
  maxIterations: number,
): LevelBox[] {
  let working = [...boxes];

  for (let iteration = 0; iteration < maxIterations; iteration += 1) {
    let changed = false;

    outer: for (let leftIndex = 0; leftIndex < working.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < working.length; rightIndex += 1) {
        const merged = tryMergeBoxes(
          working[leftIndex],
          working[rightIndex],
          axisTolerance,
          gapTolerance,
          maxPerpendicularSpan,
        );

        if (!merged) {
          continue;
        }

        const next = working.filter((_value, index) => index !== leftIndex && index !== rightIndex);
        next.push(merged);
        working = next;
        changed = true;
        break outer;
      }
    }

    if (!changed) {
      break;
    }
  }

  return working;
}

function tryMergeBoxes(
  first: LevelBox,
  second: LevelBox,
  axisTolerance: number,
  gapTolerance: number,
  maxPerpendicularSpan: number,
): LevelBox | undefined {
  const firstX2 = first.x + first.width;
  const firstY2 = first.y + first.height;
  const secondX2 = second.x + second.width;
  const secondY2 = second.y + second.height;

  if (isContained(first, second, axisTolerance)) {
    return second;
  }

  if (isContained(second, first, axisTolerance)) {
    return first;
  }

  const horizontalAligned =
    Math.abs(first.y - second.y) <= axisTolerance &&
    Math.abs(first.height - second.height) <= axisTolerance;

  if (horizontalAligned) {
    const horizontalGap = rangeGap(first.x, firstX2, second.x, secondX2);
    if (horizontalGap <= gapTolerance) {
      const mergedHeight = (first.height + second.height) / 2;
      if (mergedHeight > maxPerpendicularSpan) {
        return undefined;
      }

      return {
        x: Math.min(first.x, second.x),
        y: (first.y + second.y) / 2,
        width: Math.max(firstX2, secondX2) - Math.min(first.x, second.x),
        height: mergedHeight,
      };
    }
  }

  const verticalAligned =
    Math.abs(first.x - second.x) <= axisTolerance &&
    Math.abs(first.width - second.width) <= axisTolerance;

  if (verticalAligned) {
    const verticalGap = rangeGap(first.y, firstY2, second.y, secondY2);
    if (verticalGap <= gapTolerance) {
      const mergedWidth = (first.width + second.width) / 2;
      if (mergedWidth > maxPerpendicularSpan) {
        return undefined;
      }

      return {
        x: (first.x + second.x) / 2,
        y: Math.min(first.y, second.y),
        width: mergedWidth,
        height: Math.max(firstY2, secondY2) - Math.min(first.y, second.y),
      };
    }
  }

  return undefined;
}

function isContained(inner: LevelBox, outer: LevelBox, tolerance: number): boolean {
  return (
    inner.x >= outer.x - tolerance &&
    inner.y >= outer.y - tolerance &&
    inner.x + inner.width <= outer.x + outer.width + tolerance &&
    inner.y + inner.height <= outer.y + outer.height + tolerance
  );
}

function addRectIfValid(
  boxes: LevelBox[],
  x: number,
  y: number,
  width: number,
  height: number,
): void {
  if (width <= 0.05 || height <= 0.05) {
    return;
  }

  boxes.push({
    x: round(x, 3),
    y: round(y, 3),
    width: round(width, 3),
    height: round(height, 3),
  });
}

function rangeGap(startA: number, endA: number, startB: number, endB: number): number {
  if (endA < startB) {
    return startB - endA;
  }

  if (endB < startA) {
    return startA - endB;
  }

  return 0;
}

function dedupeBoxes(boxes: readonly LevelBox[]): LevelBox[] {
  const unique = new Map<string, LevelBox>();

  for (const box of boxes) {
    const key = [
      round(box.x, 3),
      round(box.y, 3),
      round(box.width, 3),
      round(box.height, 3),
    ].join(":");

    if (!unique.has(key)) {
      unique.set(key, {
        x: round(box.x, 3),
        y: round(box.y, 3),
        width: round(box.width, 3),
        height: round(box.height, 3),
      });
    }
  }

  return Array.from(unique.values());
}

function pointsAlmostEqual(a: Point, b: Point, tolerance: number): boolean {
  return Math.abs(a.x - b.x) <= tolerance && Math.abs(a.y - b.y) <= tolerance;
}

function parseSvgNumber(raw: string | undefined): number | undefined {
  if (!raw) {
    return undefined;
  }

  const normalized = raw.trim();
  if (!normalized) {
    return undefined;
  }

  const parsed = Number.parseFloat(normalized);
  if (!Number.isFinite(parsed)) {
    return undefined;
  }

  return parsed;
}

function median(values: readonly number[]): number {
  if (values.length === 0) {
    return Number.NaN;
  }

  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);

  if (sorted.length % 2 === 1) {
    return sorted[middle];
  }

  return (sorted[middle - 1] + sorted[middle]) / 2;
}

function round(value: number, places: number): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

function formatNumber(value: number): string {
  return Number(round(value, 3)).toString();
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isFiniteNumber(value: number): boolean {
  return Number.isFinite(value);
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
