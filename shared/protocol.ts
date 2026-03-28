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
}
