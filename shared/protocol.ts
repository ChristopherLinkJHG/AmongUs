export interface MovementInput {
  left: boolean;
  right: boolean;
  up: boolean;
  down: boolean;
}

export interface LevelSwitchRequest {
  direction?: -1 | 1;
  levelId?: string;
}

export interface JoinOptions {
  name?: string;
  language?: "de" | "en";
}

export type RoleType = "teacher" | "student" | "student_with_key";

export type GamePhase = "lobby" | "playing" | "meeting" | "voting" | "ended";

export type TeamType = "students" | "teacher";

export type TaskType =
  | "clean_whiteboard"
  | "open_windows"
  | "organize_lab_equipment"
  | "copy_homework"
  | "sort_pencils";

export interface CallMeetingRequest {
  reason?: string;
  evidenceId?: string;
}

export interface CastVoteRequest {
  targetSessionId: string;
}

export interface CompleteTaskRequest {
  taskId: string;
}

export interface TeacherCatchRequest {
  targetSessionId: string;
}

export interface RestartRoundRequest {
  force?: boolean;
}

export type EvidenceItemType = "phone" | "backpack";
