export interface LevelBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface LevelConfig {
  id: string;
  name: string;
  width: number;
  height: number;
  backgroundColor: string;
  gridColor: string;
  boxFillColor: string;
  boxStrokeColor: string;
  boxes: readonly LevelBox[];
  portals: readonly LevelPortal[];
}

export interface LevelPortal {
  id: string;
  x: number;
  y: number;
  radius: number;
  color: string;
  targetLevelId: string;
  targetX: number;
  targetY: number;
}

export const LEVELS: readonly LevelConfig[] = [
  {
    id: "orbit",
    name: "Orbital Deck",
    width: 2400,
    height: 1800,
    backgroundColor: "#162028",
    gridColor: "#24343f",
    boxFillColor: "#70808b",
    boxStrokeColor: "#a9b6be",
    boxes: [
      { x: 300, y: 240, width: 220, height: 120 },
      { x: 900, y: 160, width: 280, height: 150 },
      { x: 1440, y: 260, width: 180, height: 210 },
      { x: 1910, y: 180, width: 240, height: 140 },
      { x: 460, y: 720, width: 200, height: 220 },
      { x: 980, y: 690, width: 300, height: 140 },
      { x: 1520, y: 760, width: 220, height: 240 },
      { x: 2040, y: 660, width: 180, height: 220 },
      { x: 360, y: 1260, width: 290, height: 170 },
      { x: 980, y: 1220, width: 230, height: 250 },
      { x: 1510, y: 1300, width: 320, height: 150 },
      { x: 2050, y: 1210, width: 210, height: 230 },
    ],
    portals: [
      {
        id: "orbit-to-ember",
        x: 220,
        y: 1580,
        radius: 32,
        color: "#ff6b9c",
        targetLevelId: "ember",
        targetX: 1820,
        targetY: 220,
      },
      {
        id: "orbit-to-void",
        x: 2200,
        y: 320,
        radius: 32,
        color: "#4dabf7",
        targetLevelId: "void",
        targetX: 360,
        targetY: 1720,
      },
    ],
  },
  {
    id: "ember",
    name: "Ember Core",
    width: 2000,
    height: 1500,
    backgroundColor: "#2b1518",
    gridColor: "#4d272f",
    boxFillColor: "#8a5551",
    boxStrokeColor: "#d0998f",
    boxes: [
      { x: 210, y: 170, width: 200, height: 130 },
      { x: 650, y: 120, width: 260, height: 170 },
      { x: 1090, y: 200, width: 180, height: 180 },
      { x: 1420, y: 140, width: 320, height: 120 },
      { x: 210, y: 570, width: 260, height: 210 },
      { x: 620, y: 590, width: 170, height: 250 },
      { x: 960, y: 540, width: 330, height: 140 },
      { x: 1460, y: 600, width: 270, height: 220 },
      { x: 330, y: 1060, width: 300, height: 170 },
      { x: 870, y: 980, width: 240, height: 270 },
      { x: 1290, y: 1030, width: 360, height: 180 },
    ],
    portals: [
      {
        id: "ember-to-orbit",
        x: 1820,
        y: 220,
        radius: 32,
        color: "#ff6b9c",
        targetLevelId: "orbit",
        targetX: 220,
        targetY: 1580,
      },
      {
        id: "ember-to-void",
        x: 220,
        y: 1220,
        radius: 32,
        color: "#ffd43b",
        targetLevelId: "void",
        targetX: 2400,
        targetY: 340,
      },
    ],
  },
  {
    id: "void",
    name: "Void Lab",
    width: 2800,
    height: 2000,
    backgroundColor: "#10112b",
    gridColor: "#2e3363",
    boxFillColor: "#5f66b8",
    boxStrokeColor: "#a3adff",
    boxes: [
      { x: 280, y: 220, width: 250, height: 150 },
      { x: 760, y: 180, width: 220, height: 200 },
      { x: 1180, y: 160, width: 320, height: 130 },
      { x: 1700, y: 200, width: 220, height: 180 },
      { x: 2160, y: 140, width: 300, height: 160 },
      { x: 380, y: 780, width: 290, height: 240 },
      { x: 910, y: 700, width: 220, height: 260 },
      { x: 1400, y: 760, width: 350, height: 140 },
      { x: 1960, y: 690, width: 240, height: 220 },
      { x: 2360, y: 760, width: 210, height: 250 },
      { x: 420, y: 1430, width: 320, height: 170 },
      { x: 980, y: 1330, width: 230, height: 280 },
      { x: 1500, y: 1380, width: 360, height: 150 },
      { x: 2140, y: 1320, width: 280, height: 230 },
    ],
    portals: [
      {
        id: "void-to-orbit",
        x: 360,
        y: 1720,
        radius: 32,
        color: "#4dabf7",
        targetLevelId: "orbit",
        targetX: 2200,
        targetY: 320,
      },
      {
        id: "void-to-ember",
        x: 2400,
        y: 340,
        radius: 32,
        color: "#ffd43b",
        targetLevelId: "ember",
        targetX: 220,
        targetY: 1220,
      },
    ],
  },
  {
    id: "bitmap-test",
    name: "Bitmap Test",
    width: 2472,
    height: 1872,
    backgroundColor: "#1c2530",
    gridColor: "#2f414d",
    boxFillColor: "#738590",
    boxStrokeColor: "#aec0ca",
    boxes: [
      { x: 708.176, y: 71.668, width: 29.046, height: 1728.385 },
      { x: 707.461, y: 1768.092, width: 1057.078, height: 62.827 },
      { x: 1614.619, y: 36, width: 77.255, height: 1800 },
      { x: 719.879, y: 74.281, width: 561.041, height: 45.786 },
    ],
    portals: [
      {
        id: "path391",
        x: 910.805,
        y: 272.31,
        radius: 107.514,
        color: "#000000",
        targetLevelId: "bitmap-test",
        targetX: 910.805,
        targetY: 272.31,
      },
    ],
  },

];

export const DEFAULT_LEVEL_ID = LEVELS[0]?.id ?? "orbit";

export const LEVELS_BY_ID = new Map(LEVELS.map((level) => [level.id, level]));

export const LEVEL_COUNT = LEVELS.length;

export const MAX_LEVEL_WIDTH = Math.max(...LEVELS.map((level) => level.width));
export const MAX_LEVEL_HEIGHT = Math.max(...LEVELS.map((level) => level.height));
