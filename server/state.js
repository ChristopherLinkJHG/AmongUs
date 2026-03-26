import { schema } from "@colyseus/schema";

export const PlayerState = schema({
  name: "string",
  color: "string",
  x: "number",
  y: "number",
});

export const BoxState = schema({
  x: "number",
  y: "number",
  width: "number",
  height: "number",
});

export const WorldState = schema({
  width: "number",
  height: "number",
  players: { map: PlayerState, default: new Map() },
  boxes: [BoxState],
});
