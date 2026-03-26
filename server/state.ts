import { schema, type SchemaType } from "@colyseus/schema";

export const PlayerState = schema({
  name: "string",
  color: "string",
  x: "number",
  y: "number",
});

export type PlayerState = SchemaType<typeof PlayerState>;

export const BoxState = schema({
  x: "number",
  y: "number",
  width: "number",
  height: "number",
});

export type BoxState = SchemaType<typeof BoxState>;

export const WorldState = schema({
  width: "number",
  height: "number",
  players: { map: PlayerState, default: new Map() },
  boxes: [BoxState],
});

export type WorldState = SchemaType<typeof WorldState>;
