import { Room, type Client } from "colyseus";
import {
  MAX_CLIENTS,
  PLAYER_COLORS,
  PLAYER_RADIUS,
  PLAYER_SPEED,
} from "../../shared/config.ts";
import {
  DEFAULT_LEVEL_ID,
  LEVELS,
  LEVELS_BY_ID,
  MAX_LEVEL_HEIGHT,
  MAX_LEVEL_WIDTH,
  type LevelPortal,
} from "../../shared/levels.ts";
import {
  EVIDENCE_REPORT_RADIUS,
  MEETING_BUTTON_AREA,
  OFFICE_RESPAWN,
} from "../../shared/gameplay.ts";
import type {
  CallMeetingRequest,
  CastVoteRequest,
  CompleteTaskRequest,
  EvidenceItemType,
  GamePhase,
  JoinOptions,
  LevelSwitchRequest,
  MovementInput,
  RestartRoundRequest,
  RoleType,
  StartGameRequest,
  TaskType,
  TeacherCatchRequest,
  TeamType,
} from "../../shared/protocol.ts";
import {
  BoxState,
  EvidenceState,
  MeetingState,
  PlayerState,
  TaskState,
  VoteState,
  WorldState,
} from "../state.ts";

const EMPTY_INPUT = Object.freeze<MovementInput>({
  left: false,
  right: false,
  up: false,
  down: false,
});

interface Point {
  x: number;
  y: number;
}

interface TaskSpawnPoint {
  id: string;
  type: TaskType;
  levelId: string;
  x: number;
  y: number;
  durationMs: number;
}

const TASK_INTERACT_RADIUS = 90;
const TEACHER_CATCH_RADIUS = 78;
const TEACHER_CATCH_COOLDOWN_MS = 30_000;
const MEETING_DISCUSSION_MS = 20_000;
const VOTING_DURATION_MS = 25_000;
const TASK_ACTIVATION_CHANCE = 0.62;
const MIN_TASKS_PER_ROUND = 4;
const MIN_PLAYERS_TO_START = 3;
const EVIDENCE_ITEM_TYPES: readonly EvidenceItemType[] = ["phone", "backpack"];

const PHASE: Record<"LOBBY" | "PLAYING" | "MEETING" | "VOTING" | "ENDED", GamePhase> = {
  LOBBY: "lobby",
  PLAYING: "playing",
  MEETING: "meeting",
  VOTING: "voting",
  ENDED: "ended",
};

const ROLE: Record<"TEACHER" | "STUDENT" | "STUDENT_WITH_KEY", RoleType> = {
  TEACHER: "teacher",
  STUDENT: "student",
  STUDENT_WITH_KEY: "student_with_key",
};

const TEAM: Record<"STUDENTS" | "TEACHER", TeamType> = {
  STUDENTS: "students",
  TEACHER: "teacher",
};

const TASK_SPAWN_POINTS: readonly TaskSpawnPoint[] = [
  {
    id: "orbit-whiteboard-a",
    type: "clean_whiteboard",
    levelId: "orbit",
    x: 390,
    y: 300,
    durationMs: 4000,
  },
  {
    id: "orbit-whiteboard-b",
    type: "clean_whiteboard",
    levelId: "orbit",
    x: 1860,
    y: 1280,
    durationMs: 4000,
  },
  {
    id: "orbit-windows-a",
    type: "open_windows",
    levelId: "orbit",
    x: 2120,
    y: 250,
    durationMs: 3500,
  },
  {
    id: "orbit-windows-b",
    type: "open_windows",
    levelId: "orbit",
    x: 500,
    y: 1480,
    durationMs: 3500,
  },
  {
    id: "orbit-lab-a",
    type: "organize_lab_equipment",
    levelId: "orbit",
    x: 1460,
    y: 820,
    durationMs: 5000,
  },
  {
    id: "orbit-homework-a",
    type: "copy_homework",
    levelId: "orbit",
    x: 1010,
    y: 220,
    durationMs: 4500,
  },
  {
    id: "orbit-pencils-a",
    type: "sort_pencils",
    levelId: "orbit",
    x: 2040,
    y: 700,
    durationMs: 3000,
  },
  {
    id: "orbit-pencils-b",
    type: "sort_pencils",
    levelId: "orbit",
    x: 1120,
    y: 1260,
    durationMs: 3000,
  },
];

export class WorldRoom extends Room<{ state: WorldState }> {
  maxClients = MAX_CLIENTS;
  patchRate = 50;
  state = new WorldState();
  private readonly inputs = new Map<string, Readonly<MovementInput>>();
  private readonly portalCooldownUntil = new Map<string, number>();
  private readonly portalTouchLock = new Set<string>();
  private readonly teacherCatchCooldownUntil = new Map<string, number>();
  private evidenceCounter = 0;

  onCreate(options: JoinOptions = {}): void {
    const lobbyCode = sanitizeLobbyCode(options.lobbyCode);

    this.state.width = MAX_LEVEL_WIDTH;
    this.state.height = MAX_LEVEL_HEIGHT;
    this.state.lobbyCode = lobbyCode;
    this.state.lobbyOwnerSessionId = "";
    this.state.roundId = 1;
    this.state.gamePhase = PHASE.LOBBY;
    this.state.winnerTeam = "";
    this.state.teacherSessionId = "";
    this.state.statusText = `Lobby ${lobbyCode}: Warte auf Spieler (0/${MIN_PLAYERS_TO_START}).`;
    this.state.taskTotal = 0;
    this.state.taskCompleted = 0;
    this.state.meeting = new MeetingState();
    this.state.meeting.active = false;
    this.state.meeting.calledBy = "";
    this.state.meeting.phase = "";
    this.state.meeting.endsAtMs = 0;
    this.state.meeting.source = "";

    this.seedBoxes();
    this.seedTasks();
  this.setMetadata({ lobbyCode });

    this.onMessage("input", (client, payload) => {
      this.inputs.set(client.sessionId, sanitizeInput(payload));
    });

    this.onMessage("switch-level", (client, payload) => {
      this.switchPlayerLevel(client.sessionId, payload);
    });

    this.onMessage("call-meeting", (client, payload) => {
      this.callMeeting(client.sessionId, payload);
    });

    this.onMessage("vote", (client, payload) => {
      this.castVote(client.sessionId, payload);
    });

    this.onMessage("complete-task", (client, payload) => {
      this.completeTask(client.sessionId, payload);
    });

    this.onMessage("teacher-catch", (client, payload) => {
      this.teacherCatch(client.sessionId, payload);
    });

    this.onMessage("restart-round", (client, payload) => {
      this.restartRound(client.sessionId, payload);
    });

    this.onMessage("start-game", (client, payload) => {
      this.startGame(client.sessionId, payload);
    });

    this.setSimulationInterval((deltaTime) => {
      this.updateRoundState();
      this.updatePlayers(deltaTime);
    });
  }

  onJoin(client: Client, options: JoinOptions = {}): void {
    const requestedColor = sanitizePlayerColor(options.color);

    if (requestedColor && !this.isColorAvailable(requestedColor)) {
      throw new Error("Diese Farbe ist bereits vergeben.");
    }

    const assignedColor = requestedColor ?? this.findFirstAvailableColor();
    if (!assignedColor) {
      throw new Error("Keine Spielerfarbe mehr verfuegbar.");
    }

    const player = new PlayerState();
    const spawn = this.findSpawnPoint(DEFAULT_LEVEL_ID);

    player.name = sanitizeName(options.name, this.state.players.size + 1);
    player.color = assignedColor;
    player.levelId = DEFAULT_LEVEL_ID;
    player.x = spawn.x;
    player.y = spawn.y;
    player.role = ROLE.STUDENT;
    player.alive = true;
    player.tasksCompleted = 0;
    player.hasVoted = false;
    player.votedFor = "";
    player.language = options.language === "de" ? "de" : "en";

    this.state.players.set(client.sessionId, player);
    this.inputs.set(client.sessionId, EMPTY_INPUT);

    if (!this.state.lobbyOwnerSessionId) {
      this.state.lobbyOwnerSessionId = client.sessionId;
    }

    this.assignRoles();
    this.updateLobbyState();
  }

  onLeave(client: Client): void {
    this.state.players.delete(client.sessionId);
    this.inputs.delete(client.sessionId);
    this.portalCooldownUntil.delete(client.sessionId);
    this.portalTouchLock.delete(client.sessionId);
    this.teacherCatchCooldownUntil.delete(client.sessionId);
    this.removeVotesForPlayer(client.sessionId);

    if (this.state.lobbyOwnerSessionId === client.sessionId) {
      const nextOwnerSessionId = Array.from(this.state.players.keys())[0] ?? "";
      this.state.lobbyOwnerSessionId = nextOwnerSessionId;
    }

    this.assignRoles();
    this.updateLobbyState();
    this.evaluateWinConditions();
  }

  private seedBoxes(): void {
    for (const level of LEVELS) {
      for (const box of level.boxes) {
        const entity = new BoxState();
        entity.levelId = level.id;
        entity.x = box.x;
        entity.y = box.y;
        entity.width = box.width;
        entity.height = box.height;

        this.state.boxes.push(entity);
      }
    }
  }

  private seedTasks(): void {
    this.state.tasks.length = 0;

    const shuffled = shuffleArray([...TASK_SPAWN_POINTS]);
    const selected: TaskSpawnPoint[] = [];

    for (const spawnPoint of shuffled) {
      if (Math.random() < TASK_ACTIVATION_CHANCE) {
        selected.push(spawnPoint);
      }
    }

    if (!selected.some((entry) => entry.type === "open_windows")) {
      const fallback = shuffled.find((entry) => entry.type === "open_windows");
      if (fallback) {
        selected.push(fallback);
      }
    }

    for (const spawnPoint of shuffled) {
      if (selected.length >= MIN_TASKS_PER_ROUND) {
        break;
      }

      if (!selected.some((entry) => entry.id === spawnPoint.id)) {
        selected.push(spawnPoint);
      }
    }

    for (const taskSeed of selected) {
      const task = new TaskState();
      task.id = `${taskSeed.id}-r${this.state.roundId}`;
      task.type = taskSeed.type;
      task.levelId = taskSeed.levelId;
      task.x = taskSeed.x;
      task.y = taskSeed.y;
      task.durationMs = taskSeed.durationMs;
      task.completed = false;
      task.completedBy = "";
      this.state.tasks.push(task);
    }

    this.state.taskTotal = this.state.tasks.length;
    this.state.taskCompleted = 0;
  }

  private findSpawnPoint(levelId: string): Point {
    const level = LEVELS_BY_ID.get(levelId);

    if (!level) {
      return { x: 160, y: 160 };
    }

    for (let attempt = 0; attempt < 120; attempt += 1) {
      const x = randomInt(PLAYER_RADIUS + 48, level.width - PLAYER_RADIUS - 48);
      const y = randomInt(
        PLAYER_RADIUS + 48,
        level.height - PLAYER_RADIUS - 48,
      );

      if (this.overlapsAnyBox(x, y, level.id)) {
        continue;
      }

      const overlapsPlayer = Array.from(this.state.players.values()).some(
        (player) =>
          player.levelId === level.id &&
          Math.hypot(player.x - x, player.y - y) < PLAYER_RADIUS * 3,
      );

      if (!overlapsPlayer) {
        return { x, y };
      }
    }

    return {
      x: clamp(level.width * 0.5, PLAYER_RADIUS + 12, level.width - PLAYER_RADIUS - 12),
      y: clamp(
        level.height * 0.5,
        PLAYER_RADIUS + 12,
        level.height - PLAYER_RADIUS - 12,
      ),
    };
  }

  private switchPlayerLevel(sessionId: string, payload: unknown): void {
    const player = this.state.players.get(sessionId);

    if (!player) {
      return;
    }

    if (this.state.gamePhase !== PHASE.PLAYING) {
      return;
    }

    if (player.alive && !this.canUseElevator(player)) {
      return;
    }

    const targetLevel = this.resolveTargetLevel(player.levelId, payload);

    if (!targetLevel || targetLevel.id === player.levelId) {
      return;
    }

    const spawn = this.findSpawnPoint(targetLevel.id);
    player.levelId = targetLevel.id;
    player.x = spawn.x;
    player.y = spawn.y;
    this.inputs.set(sessionId, EMPTY_INPUT);
  }

  private resolveTargetLevel(
    currentLevelId: string,
    payload: unknown,
  ): (typeof LEVELS)[number] | undefined {
    const request = payload as LevelSwitchRequest | undefined;

    if (request?.levelId) {
      return LEVELS_BY_ID.get(request.levelId);
    }

    if (LEVELS.length === 0) {
      return undefined;
    }

    const currentIndex = Math.max(
      0,
      LEVELS.findIndex((level) => level.id === currentLevelId),
    );
    const direction = request?.direction === -1 ? -1 : 1;
    const targetIndex = (currentIndex + direction + LEVELS.length) % LEVELS.length;
    return LEVELS[targetIndex];
  }

  private updatePlayers(deltaTime: number): void {
    if (this.state.gamePhase !== PHASE.PLAYING) {
      return;
    }

    const distance = PLAYER_SPEED * (deltaTime / 1000);

    this.state.players.forEach((player, sessionId) => {
      const level = LEVELS_BY_ID.get(player.levelId);

      if (!level) {
        return;
      }

      const input = this.inputs.get(sessionId) ?? EMPTY_INPUT;
      let dx = Number(input.right) - Number(input.left);
      let dy = Number(input.down) - Number(input.up);

      if (dx !== 0 || dy !== 0) {
        const length = Math.hypot(dx, dy);
        dx = (dx / length) * distance;
        dy = (dy / length) * distance;
      }

      const nextX = clamp(
        player.x + dx,
        PLAYER_RADIUS,
        level.width - PLAYER_RADIUS,
      );
      if (!player.alive || !this.overlapsAnyBox(nextX, player.y, level.id)) {
        player.x = nextX;
      }

      const nextY = clamp(
        player.y + dy,
        PLAYER_RADIUS,
        level.height - PLAYER_RADIUS,
      );
      if (!player.alive || !this.overlapsAnyBox(player.x, nextY, level.id)) {
        player.y = nextY;
      }

      this.tryUsePortal(player, sessionId);
    });
  }

  private updateRoundState(): void {
    if (!this.state.meeting.active) {
      return;
    }

    const now = Date.now();

    if (this.state.gamePhase === PHASE.MEETING && now >= this.state.meeting.endsAtMs) {
      this.state.gamePhase = PHASE.VOTING;
      this.state.meeting.phase = PHASE.VOTING;
      this.state.meeting.endsAtMs = now + VOTING_DURATION_MS;
      this.state.statusText = "Abstimmung gestartet.";
      return;
    }

    if (
      this.state.gamePhase === PHASE.VOTING &&
      (now >= this.state.meeting.endsAtMs || this.haveAllActivePlayersVoted())
    ) {
      this.resolveVoting();
    }
  }

  private callMeeting(sessionId: string, payload: unknown): void {
    const request = payload as CallMeetingRequest | undefined;
    const caller = this.state.players.get(sessionId);

    if (!caller || !caller.alive) {
      return;
    }

    if (this.state.gamePhase !== PHASE.PLAYING) {
      return;
    }

    const evidence = this.findReportableEvidence(caller, request?.evidenceId);
    const fromButton = this.isNearMeetingButton(caller);

    if (!fromButton && !evidence) {
      return;
    }

    this.resetVotingState();
    this.state.meeting.active = true;
    this.state.meeting.calledBy = sessionId;
    this.state.meeting.phase = PHASE.MEETING;
    this.state.meeting.endsAtMs = Date.now() + MEETING_DISCUSSION_MS;
    this.state.meeting.source = evidence ? "evidence" : "button";
    this.state.gamePhase = PHASE.MEETING;

    if (evidence) {
      evidence.reported = true;
      this.state.statusText = `${caller.name} hat einen Hinweis gefunden.`;
    } else {
      this.state.statusText = `Besprechung von ${caller.name} einberufen.`;
    }
  }

  private castVote(sessionId: string, payload: unknown): void {
    if (this.state.gamePhase !== PHASE.VOTING) {
      return;
    }

    const request = payload as CastVoteRequest | undefined;
    const voter = this.state.players.get(sessionId);

    if (!voter || !voter.alive || voter.hasVoted) {
      return;
    }

    const targetId = request?.targetSessionId?.trim();

    if (!targetId) {
      return;
    }

    if (targetId !== "skip") {
      const target = this.state.players.get(targetId);
      if (!target || !target.alive) {
        return;
      }
    }

    const vote = new VoteState();
    vote.voterSessionId = sessionId;
    vote.targetSessionId = targetId;
    this.state.votes.push(vote);

    voter.hasVoted = true;
    voter.votedFor = targetId;

    if (this.haveAllActivePlayersVoted()) {
      this.resolveVoting();
    }
  }

  private completeTask(sessionId: string, payload: unknown): void {
    if (this.state.gamePhase !== PHASE.PLAYING) {
      return;
    }

    const request = payload as CompleteTaskRequest | undefined;
    const player = this.state.players.get(sessionId);

    if (!player || !player.alive || player.role === ROLE.TEACHER) {
      return;
    }

    const taskId = request?.taskId?.trim();
    if (!taskId) {
      return;
    }

    const task = this.state.tasks.find((entry) => entry.id === taskId);
    if (!task || task.completed) {
      return;
    }

    if (task.levelId !== player.levelId) {
      return;
    }

    if (Math.hypot(task.x - player.x, task.y - player.y) > TASK_INTERACT_RADIUS) {
      return;
    }

    task.completed = true;
    task.completedBy = sessionId;
    player.tasksCompleted += 1;
    this.state.taskCompleted += 1;
    this.state.statusText = `Aufgabe erledigt: ${this.taskTypeToGerman(task.type)}.`;
    this.evaluateWinConditions();
  }

  private teacherCatch(sessionId: string, payload: unknown): void {
    if (this.state.gamePhase !== PHASE.PLAYING) {
      return;
    }

    const request = payload as TeacherCatchRequest | undefined;
    const teacher = this.state.players.get(sessionId);

    if (!teacher || !teacher.alive || teacher.role !== ROLE.TEACHER) {
      return;
    }

    const targetId = request?.targetSessionId?.trim();
    if (!targetId) {
      return;
    }

    const cooldownUntil = this.teacherCatchCooldownUntil.get(sessionId) ?? 0;
    if (Date.now() < cooldownUntil) {
      return;
    }

    const target = this.state.players.get(targetId);
    if (!target || !target.alive || target.role === ROLE.TEACHER) {
      return;
    }

    if (teacher.levelId !== target.levelId) {
      return;
    }

    const distance = Math.hypot(teacher.x - target.x, teacher.y - target.y);
    if (distance > TEACHER_CATCH_RADIUS) {
      return;
    }

    const evidenceX = target.x;
    const evidenceY = target.y;
    const evidenceLevelId = target.levelId;

    target.alive = false;
    target.x = OFFICE_RESPAWN.x;
    target.y = OFFICE_RESPAWN.y;
    target.levelId = OFFICE_RESPAWN.levelId;
    this.inputs.set(targetId, EMPTY_INPUT);

    this.createEvidenceDrop(targetId, evidenceLevelId, evidenceX, evidenceY);

    this.teacherCatchCooldownUntil.set(sessionId, Date.now() + TEACHER_CATCH_COOLDOWN_MS);
    this.state.statusText = `${target.name} wurde ins Buero gebracht.`;
    this.evaluateWinConditions();
  }

  private assignRoles(randomize = false): void {
    const entries = Array.from(this.state.players.entries());

    if (randomize) {
      shuffleArray(entries);
    }

    this.state.teacherSessionId = "";

    if (entries.length === 0) {
      return;
    }

    const teacherCount = this.getTeacherCount(entries.length);
    const keyStudentIndex = teacherCount;

    entries.forEach(([sessionId, player], index) => {
      if (entries.length === 1) {
        player.role = ROLE.STUDENT_WITH_KEY;
        return;
      }

      if (index < teacherCount) {
        player.role = ROLE.TEACHER;
        if (!this.state.teacherSessionId) {
          this.state.teacherSessionId = sessionId;
        }
        return;
      }

      if (index === keyStudentIndex) {
        player.role = ROLE.STUDENT_WITH_KEY;
        return;
      }

      player.role = ROLE.STUDENT;
    });
  }

  private updateLobbyState(): void {
    if (this.state.gamePhase !== PHASE.LOBBY) {
      return;
    }

    const playerCount = this.state.players.size;
    if (playerCount < MIN_PLAYERS_TO_START) {
      this.state.statusText = `Lobby ${this.state.lobbyCode}: Warte auf Spieler (${playerCount}/${MIN_PLAYERS_TO_START}).`;
      return;
    }

    const owner = this.state.players.get(this.state.lobbyOwnerSessionId);
    const ownerName = owner?.name ?? "Der Lobby-Host";
    this.state.statusText = `${ownerName} kann das Spiel starten (${playerCount}/${MIN_PLAYERS_TO_START}).`;
  }

  private startGame(sessionId: string, payload: unknown): void {
    const request = payload as StartGameRequest | undefined;

    if (this.state.gamePhase !== PHASE.LOBBY && !request?.force) {
      return;
    }

    if (sessionId !== this.state.lobbyOwnerSessionId) {
      return;
    }

    if (this.state.players.size < MIN_PLAYERS_TO_START) {
      this.updateLobbyState();
      return;
    }

    this.assignRoles(true);
    this.state.gamePhase = PHASE.PLAYING;
    this.state.statusText = "Runde gestartet.";
  }

  private resolveVoting(): void {
    const tally = new Map<string, number>();

    for (const vote of this.state.votes) {
      tally.set(vote.targetSessionId, (tally.get(vote.targetSessionId) ?? 0) + 1);
    }

    let leaderId = "";
    let leaderCount = 0;
    let tie = false;

    for (const [targetId, count] of tally.entries()) {
      if (count > leaderCount) {
        leaderId = targetId;
        leaderCount = count;
        tie = false;
      } else if (count === leaderCount) {
        tie = true;
      }
    }

    if (!tie && leaderId && leaderId !== "skip") {
      const eliminated = this.state.players.get(leaderId);
      if (eliminated && eliminated.alive) {
        eliminated.alive = false;
        eliminated.levelId = OFFICE_RESPAWN.levelId;
        eliminated.x = OFFICE_RESPAWN.x;
        eliminated.y = OFFICE_RESPAWN.y;
        this.inputs.set(leaderId, EMPTY_INPUT);
        this.state.statusText = `${eliminated.name} wurde herausgewaehlt.`;
      }
    } else {
      this.state.statusText = "Gleichstand: Niemand wurde herausgewaehlt.";
    }

    this.endMeeting();
    this.evaluateWinConditions();
  }

  private endMeeting(): void {
    this.state.meeting.active = false;
    this.state.meeting.calledBy = "";
    this.state.meeting.phase = "";
    this.state.meeting.endsAtMs = 0;
    this.state.meeting.source = "";

    this.resetVotingState();

    if (this.state.gamePhase === PHASE.MEETING || this.state.gamePhase === PHASE.VOTING) {
      this.state.gamePhase = PHASE.PLAYING;
    }
  }

  private resetVotingState(): void {
    this.state.votes.length = 0;
    this.state.players.forEach((player) => {
      player.hasVoted = false;
      player.votedFor = "";
    });
  }

  private removeVotesForPlayer(sessionId: string): void {
    const keptVotes = this.state.votes.filter(
      (vote) => vote.voterSessionId !== sessionId && vote.targetSessionId !== sessionId,
    );

    this.state.votes.length = 0;

    for (const voteData of keptVotes) {
      const vote = new VoteState();
      vote.voterSessionId = voteData.voterSessionId;
      vote.targetSessionId = voteData.targetSessionId;
      this.state.votes.push(vote);
    }
  }

  private haveAllActivePlayersVoted(): boolean {
    const activePlayers = Array.from(this.state.players.values()).filter(
      (player) => player.alive,
    );

    if (activePlayers.length === 0) {
      return false;
    }

    return activePlayers.every((player) => player.hasVoted);
  }

  private evaluateWinConditions(): void {
    if (this.state.gamePhase === PHASE.ENDED) {
      return;
    }

    if (this.state.taskTotal > 0 && this.state.taskCompleted >= this.state.taskTotal) {
      this.finishRound(TEAM.STUDENTS, "Die Schueler haben alle Aufgaben erledigt.");
      return;
    }

    const aliveTeachers = Array.from(this.state.players.values()).filter(
      (player) => player.alive && player.role === ROLE.TEACHER,
    ).length;

    if (aliveTeachers === 0) {
      this.finishRound(TEAM.STUDENTS, "Alle Lehrer wurden entfernt. Schueler gewinnen.");
      return;
    }

    const aliveStudents = Array.from(this.state.players.values()).filter(
      (player) => player.alive && player.role !== ROLE.TEACHER,
    ).length;

    if (aliveStudents <= aliveTeachers && this.state.players.size >= 2) {
      this.finishRound(
        TEAM.TEACHER,
        "Zu wenige Schueler uebrig. Lehrer-Team gewinnt.",
      );
      return;
    }

    if (this.state.players.size < 2) {
      this.state.gamePhase = PHASE.LOBBY;
      this.updateLobbyState();
    }
  }

  private findReportableEvidence(
    player: PlayerState,
    evidenceId?: string,
  ): EvidenceState | undefined {
    if (!player.alive) {
      return undefined;
    }

    const preferred = evidenceId?.trim();

    const candidates = this.state.evidence.filter((entry) => {
      if (entry.reported || entry.levelId !== player.levelId) {
        return false;
      }

      return Math.hypot(entry.x - player.x, entry.y - player.y) <= EVIDENCE_REPORT_RADIUS;
    });

    if (preferred) {
      const matching = candidates.find((entry) => entry.id === preferred);
      if (matching) {
        return matching;
      }
    }

    return candidates[0];
  }

  private createEvidenceDrop(
    ownerSessionId: string,
    levelId: string,
    x: number,
    y: number,
  ): void {
    this.evidenceCounter += 1;

    const evidence = new EvidenceState();
    evidence.id = `evidence-${this.state.roundId}-${this.evidenceCounter}`;
    evidence.levelId = levelId;
    evidence.x = x;
    evidence.y = y;
    evidence.itemType = EVIDENCE_ITEM_TYPES[this.evidenceCounter % EVIDENCE_ITEM_TYPES.length];
    evidence.ownerSessionId = ownerSessionId;
    evidence.reported = false;

    this.state.evidence.push(evidence);
  }

  private restartRound(sessionId: string, payload: unknown): void {
    const request = payload as RestartRoundRequest | undefined;

    if (this.state.gamePhase !== PHASE.ENDED && !request?.force) {
      return;
    }

    if (!this.state.players.has(sessionId)) {
      return;
    }

    this.resetRound();
  }

  private resetRound(): void {
    this.state.roundId += 1;
    this.state.winnerTeam = "";
  this.state.statusText = "Neue Runde vorbereitet.";
    this.state.gamePhase = PHASE.LOBBY;

    this.resetVotingState();
    this.endMeeting();
    this.seedTasks();

    this.state.evidence.length = 0;
    this.evidenceCounter = 0;
    this.teacherCatchCooldownUntil.clear();

    this.state.players.forEach((player, sessionId) => {
      const spawn = this.findSpawnPoint(DEFAULT_LEVEL_ID);
      player.alive = true;
      player.tasksCompleted = 0;
      player.hasVoted = false;
      player.votedFor = "";
      player.levelId = DEFAULT_LEVEL_ID;
      player.x = spawn.x;
      player.y = spawn.y;
      this.inputs.set(sessionId, EMPTY_INPUT);
    });

    this.assignRoles(true);
    this.updateLobbyState();
  }

  private isColorAvailable(color: string): boolean {
    const normalized = color.toLowerCase();
    return !Array.from(this.state.players.values()).some(
      (player) => player.color.toLowerCase() === normalized,
    );
  }

  private findFirstAvailableColor(): string | undefined {
    return PLAYER_COLORS.find((color) => this.isColorAvailable(color));
  }

  private getTeacherCount(playerCount: number): number {
    const rawCount = Math.ceil(playerCount / 6);
    const maxAllowed = Math.max(1, playerCount - 1);
    return clamp(rawCount, 1, maxAllowed);
  }

  private finishRound(winnerTeam: TeamType, message: string): void {
    this.state.gamePhase = PHASE.ENDED;
    this.state.winnerTeam = winnerTeam;
    this.state.statusText = message;
    this.endMeeting();
  }

  private canUseElevator(player: PlayerState): boolean {
    return player.role === ROLE.TEACHER || player.role === ROLE.STUDENT_WITH_KEY;
  }

  private isNearMeetingButton(player: PlayerState): boolean {
    if (player.levelId !== MEETING_BUTTON_AREA.levelId) {
      return false;
    }

    return (
      Math.hypot(player.x - MEETING_BUTTON_AREA.x, player.y - MEETING_BUTTON_AREA.y) <=
      MEETING_BUTTON_AREA.radius
    );
  }

  private taskTypeToGerman(taskType: string): string {
    switch (taskType) {
      case "clean_whiteboard":
        return "Tafel reinigen";
      case "open_windows":
        return "Fenster oeffnen";
      case "organize_lab_equipment":
        return "Laborgeraete sortieren";
      case "copy_homework":
        return "Hausaufgaben abschreiben";
      case "sort_pencils":
        return "Stifte sortieren";
      default:
        return "Unbekannte Aufgabe";
    }
  }

  private tryUsePortal(player: PlayerState, sessionId: string): void {
    const touchingPortal = this.getTouchingPortal(player.levelId, player.x, player.y);

    if (!touchingPortal) {
      this.portalTouchLock.delete(sessionId);
      return;
    }

    if (this.portalTouchLock.has(sessionId)) {
      return;
    }

    const now = Date.now();
    const cooldownUntil = this.portalCooldownUntil.get(sessionId) ?? 0;

    if (now < cooldownUntil) {
      return;
    }

    const portal = touchingPortal;

    const destination = LEVELS_BY_ID.get(portal.targetLevelId);

    if (!destination) {
      return;
    }

    player.levelId = destination.id;
    player.x = clamp(portal.targetX, PLAYER_RADIUS, destination.width - PLAYER_RADIUS);
    player.y = clamp(portal.targetY, PLAYER_RADIUS, destination.height - PLAYER_RADIUS);

    this.inputs.set(sessionId, EMPTY_INPUT);
    this.portalTouchLock.add(sessionId);
    this.portalCooldownUntil.set(sessionId, now + 650);
  }

  private getTouchingPortal(
    levelId: string,
    x: number,
    y: number,
  ): LevelPortal | undefined {
    const level = LEVELS_BY_ID.get(levelId);

    if (!level) {
      return undefined;
    }

    return level.portals.find((portal) => {
      return Math.hypot(portal.x - x, portal.y - y) <= portal.radius + PLAYER_RADIUS;
    });
  }

  private overlapsAnyBox(x: number, y: number, levelId: string): boolean {
    const left = x - PLAYER_RADIUS;
    const right = x + PLAYER_RADIUS;
    const top = y - PLAYER_RADIUS;
    const bottom = y + PLAYER_RADIUS;

    return this.state.boxes.some((box) => {
      if (box.levelId !== levelId) {
        return false;
      }

      return (
        right > box.x &&
        left < box.x + box.width &&
        bottom > box.y &&
        top < box.y + box.height
      );
    });
  }
}

function sanitizeInput(payload: unknown): MovementInput {
  const input = payload as Partial<MovementInput> | undefined;

  return {
    left: Boolean(input?.left),
    right: Boolean(input?.right),
    up: Boolean(input?.up),
    down: Boolean(input?.down),
  };
}

function sanitizeName(rawName: unknown, playerNumber: number): string {
  const trimmed = String(rawName ?? "").trim().slice(0, 14);
  return trimmed || `Player ${playerNumber}`;
}

function sanitizeLobbyCode(rawCode: unknown): string {
  const normalized = String(rawCode ?? "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 8);

  if (normalized.length >= 4) {
    return normalized;
  }

  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let fallback = "";

  for (let index = 0; index < 6; index += 1) {
    const charIndex = Math.floor(Math.random() * alphabet.length);
    fallback += alphabet[charIndex] ?? "A";
  }

  return fallback;
}

function sanitizePlayerColor(rawColor: unknown): string {
  const normalized = String(rawColor ?? "").trim().toLowerCase();
  const matching = PLAYER_COLORS.find((paletteColor) => paletteColor.toLowerCase() === normalized);
  return matching ?? "";
}

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function shuffleArray<T>(items: T[]): T[] {
  for (let i = items.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    const current = items[i];
    items[i] = items[j] as T;
    items[j] = current as T;
  }

  return items;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
