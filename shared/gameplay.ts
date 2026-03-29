export interface CircleArea {
  levelId: string;
  x: number;
  y: number;
  radius: number;
}

export interface RectArea {
  levelId: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export const MEETING_BUTTON_AREA: CircleArea = {
  levelId: "orbit",
  x: 220,
  y: 220,
  radius: 90,
};

export const EVIDENCE_REPORT_RADIUS = 120;

export const OFFICE_ZONE: RectArea = {
  levelId: "orbit",
  x: 40,
  y: 40,
  width: 320,
  height: 220,
};

export const OFFICE_RESPAWN = {
  levelId: OFFICE_ZONE.levelId,
  x: OFFICE_ZONE.x + OFFICE_ZONE.width * 0.5,
  y: OFFICE_ZONE.y + OFFICE_ZONE.height * 0.5,
};
