import { schema, type SchemaType } from "@colyseus/schema";

export const PlayerState = schema({
  name: "string",
  color: "string",
  levelId: "string",
  x: "number",
  y: "number",
  role: "string",
  alive: "boolean",
  tasksCompleted: "number",
  hasVoted: "boolean",
  votedFor: "string",
  language: "string",
});

export type PlayerState = SchemaType<typeof PlayerState>;

export const BoxState = schema({
  levelId: "string",
  x: "number",
  y: "number",
  width: "number",
  height: "number",
});

export type BoxState = SchemaType<typeof BoxState>;

export const TaskState = schema({
  id: "string",
  type: "string",
  levelId: "string",
  x: "number",
  y: "number",
  durationMs: "number",
  completed: "boolean",
  completedBy: "string",
});

export type TaskState = SchemaType<typeof TaskState>;

export const VoteState = schema({
  voterSessionId: "string",
  targetSessionId: "string",
});

export type VoteState = SchemaType<typeof VoteState>;

export const MeetingState = schema({
  active: "boolean",
  calledBy: "string",
  phase: "string",
  endsAtMs: "number",
  source: "string",
});

export type MeetingState = SchemaType<typeof MeetingState>;

export const EvidenceState = schema({
  id: "string",
  levelId: "string",
  x: "number",
  y: "number",
  itemType: "string",
  ownerSessionId: "string",
  reported: "boolean",
});

export type EvidenceState = SchemaType<typeof EvidenceState>;

export const WorldState = schema({
  width: "number",
  height: "number",
  roundId: "number",
  gamePhase: "string",
  winnerTeam: "string",
  teacherSessionId: "string",
  statusText: "string",
  taskTotal: "number",
  taskCompleted: "number",
  meeting: MeetingState,
  players: { map: PlayerState, default: new Map() },
  boxes: [BoxState],
  tasks: [TaskState],
  evidence: [EvidenceState],
  votes: [VoteState],
});

export type WorldState = SchemaType<typeof WorldState>;
