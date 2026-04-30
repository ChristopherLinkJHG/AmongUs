import Phaser from "phaser";
import { Callbacks, Client, type Room } from "@colyseus/sdk";
import "./styles.css";
import {
  GRID_SIZE,
  PLAYER_COLORS,
  ROOM_NAME,
  VIEWPORT_HEIGHT,
  VIEWPORT_WIDTH,
} from "../shared/config.ts";
import {
  EVIDENCE_REPORT_RADIUS,
  MEETING_BUTTON_AREA,
  OFFICE_ZONE,
} from "../shared/gameplay.ts";
import {
  DEFAULT_LEVEL_ID,
  LEVELS,
  LEVELS_BY_ID,
  type LevelPortal,
} from "../shared/levels.ts";
import type {
  CallMeetingRequest,
  CastVoteRequest,
  CompleteTaskRequest,
  GamePhase,
  JoinOptions,
  LevelSwitchRequest,
  MovementInput,
  RestartRoundRequest,
  RoleType,
  StartGameRequest,
  TaskType,
  TeacherCatchRequest,
} from "../shared/protocol.ts";
import type {
  BoxState,
  EvidenceState,
  PlayerState,
  TaskState,
  VoteState,
  WorldState,
} from "../server/state.ts";

const SERVER_URL = resolveServerUrl();
const LOBBY_CODE = resolveLobbyCode();

const phaseValue = requireElement<HTMLElement>("#phase-value");
const roleValue = requireElement<HTMLElement>("#role-value");
const taskValue = requireElement<HTMLElement>("#task-value");
const statusBanner = requireElement<HTMLElement>("#status-banner");
const joinPanel = requireElement<HTMLElement>("#join-panel");
const joinNameInput = requireElement<HTMLInputElement>("#join-name-input");
const joinColorGrid = requireElement<HTMLElement>("#join-color-grid");
const joinError = requireElement<HTMLElement>("#join-error");
const joinSubmitButton = requireElement<HTMLButtonElement>("#join-submit-btn");
const lobbyCodeValue = requireElement<HTMLElement>("#lobby-code-value");
const lobbyCodeInput = requireElement<HTMLInputElement>("#lobby-code-input");
const lobbyApplyCodeButton = requireElement<HTMLButtonElement>("#lobby-apply-code-btn");
const startGameButton = requireElement<HTMLButtonElement>("#start-game-btn");
const roleBriefing = requireElement<HTMLElement>("#role-briefing");
const meetingPanel = requireElement<HTMLElement>("#meeting-panel");
const meetingMeta = requireElement<HTMLElement>("#meeting-meta");
const meetingTimer = requireElement<HTMLElement>("#meeting-timer");
const voteList = requireElement<HTMLElement>("#vote-list");
const voteSkipButton = requireElement<HTMLButtonElement>("#vote-skip-btn");
const roundEndPanel = requireElement<HTMLElement>("#round-end-panel");
const roundEndText = requireElement<HTMLElement>("#round-end-text");
const restartRoundButton = requireElement<HTMLButtonElement>("#restart-round-btn");
const taskWindowPanel = requireElement<HTMLElement>("#task-window-panel");
const taskWindowTitle = requireElement<HTMLElement>("#task-window-title");
const taskWindowInfo = requireElement<HTMLElement>("#task-window-info");
const taskMiniWindow = requireElement<HTMLElement>("#task-mini-window");
const taskMiniWhiteboard = requireElement<HTMLElement>("#task-mini-whiteboard");
const taskMiniLab = requireElement<HTMLElement>("#task-mini-lab");
const taskMiniHomework = requireElement<HTMLElement>("#task-mini-homework");
const taskMiniPencils = requireElement<HTMLElement>("#task-mini-pencils");
const windowHandleOne = requireElement<HTMLInputElement>("#window-handle-1");
const windowHandleTwo = requireElement<HTMLInputElement>("#window-handle-2");
const windowHandleThree = requireElement<HTMLInputElement>("#window-handle-3");
const whiteboardSmudges = Array.from(
  document.querySelectorAll<HTMLButtonElement>("#whiteboard-smudges .smudge"),
);
const homeworkTarget = requireElement<HTMLElement>("#homework-target");
const homeworkInput = requireElement<HTMLInputElement>("#homework-input");
const homeworkSubmitButton = requireElement<HTMLButtonElement>("#homework-submit-btn");
const labPool = requireElement<HTMLElement>("#lab-pool");
const labSlots = requireElement<HTMLElement>("#lab-slots");
const pencilPool = requireElement<HTMLElement>("#pencil-pool");
const pencilSlots = requireElement<HTMLElement>("#pencil-slots");
const taskWindowCancelButton = requireElement<HTMLButtonElement>("#task-window-cancel-btn");

const TASK_INTERACT_RADIUS = 90;

interface DirectionKeys {
  up: Phaser.Input.Keyboard.Key;
  left: Phaser.Input.Keyboard.Key;
  down: Phaser.Input.Keyboard.Key;
  right: Phaser.Input.Keyboard.Key;
}

interface LevelSwitchKeys {
  previous: Phaser.Input.Keyboard.Key;
  next: Phaser.Input.Keyboard.Key;
}

interface ActionKeys {
  callMeeting: Phaser.Input.Keyboard.Key;
  doTask: Phaser.Input.Keyboard.Key;
  catchStudent: Phaser.Input.Keyboard.Key;
  startGame: Phaser.Input.Keyboard.Key;
  voteSkip: Phaser.Input.Keyboard.Key;
  voteFirst: Phaser.Input.Keyboard.Key;
  restartRound: Phaser.Input.Keyboard.Key;
}

interface AvatarConfig {
  color: string;
  isLocal: boolean;
  name: string;
}

interface AvatarParts {
  body: Phaser.GameObjects.Ellipse;
  backpack: Phaser.GameObjects.Ellipse;
  container: Phaser.GameObjects.Container;
  ghostAura: Phaser.GameObjects.Ellipse;
  isAlive: boolean;
  label: Phaser.GameObjects.Text;
  levelId: string;
  ownerSessionId: string;
  serverX: number;
  serverY: number;
  unbind: Array<() => void>;
}

interface BoxParts {
  levelId: string;
  rectangle: Phaser.GameObjects.Rectangle;
}

interface PortalParts {
  levelId: string;
  ring: Phaser.GameObjects.Arc;
  core: Phaser.GameObjects.Arc;
  label: Phaser.GameObjects.Text;
}

interface EvidenceParts {
  icon: Phaser.GameObjects.Ellipse;
  levelId: string;
  marker: Phaser.GameObjects.Text;
}

function getRoomCallbacks(room: Room<any, WorldState>) {
  return Callbacks.get(room);
}

type RoomCallbacks = ReturnType<typeof getRoomCallbacks>;

class MainScene extends Phaser.Scene {
  private readonly players = new Map<string, AvatarParts>();
  private readonly playerStates = new Map<string, PlayerState>();
  private readonly boxes: BoxParts[] = [];
  private readonly tasks = new Map<string, TaskState>();
  private readonly taskMarkers = new Map<string, Phaser.GameObjects.Container>();
  private readonly evidence = new Map<string, EvidenceState>();
  private readonly evidenceMarkers = new Map<string, EvidenceParts>();
  private readonly portals: PortalParts[] = [];
  private readonly backdrops = new Map<string, Phaser.GameObjects.Graphics>();
  private currentInput: MovementInput = {
    left: false,
    right: false,
    up: false,
    down: false,
  };
  private localLevelId = DEFAULT_LEVEL_ID;
  private client?: Client;
  private room?: Room<any, WorldState>;
  private callbacks?: RoomCallbacks;
  private sessionId?: string;
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private wasd!: DirectionKeys;
  private levelSwitchKeys!: LevelSwitchKeys;
  private actionKeys!: ActionKeys;
  private meetingButtonLabel?: Phaser.GameObjects.Text;
  private meetingButtonRing?: Phaser.GameObjects.Ellipse;
  private officeZoneLabel?: Phaser.GameObjects.Text;
  private officeZoneVisual?: Phaser.GameObjects.Rectangle;
  private lastRoundId = -1;
  private roleBriefingTimeout?: number;
  private voteUiCacheKey = "";
  private activeTaskId?: string;
  private activeTaskType?: TaskType;
  private activeDragItem?: HTMLElement;
  private selectedJoinColor = PLAYER_COLORS[0] ?? "";
  private joining = false;
  private readonly cleanedSmudges = new Set<string>();

  constructor() {
    super("main");
  }

  create(): void {
    const initialLevel = getLevelById(this.localLevelId);

    this.cameras.main.setBackgroundColor(initialLevel.backgroundColor);
    this.cameras.main.setBounds(0, 0, initialLevel.width, initialLevel.height);

    this.drawBackdrops();
    this.drawPortals();
    this.drawMeetingButton();
    this.drawOfficeZone();
    this.setupKeyboard();
    this.setupDomUi();
  }

  private setupDomUi(): void {
    this.setupJoinUi();
    this.setupTextInputFocusHandling();

    lobbyCodeValue.textContent = LOBBY_CODE;
    lobbyCodeInput.value = LOBBY_CODE;

    lobbyApplyCodeButton.addEventListener("click", () => {
      const nextCode = sanitizeLobbyCode(lobbyCodeInput.value) || generateLobbyCode();
      setLobbyCodeInUrl(nextCode);
      window.location.reload();
    });

    startGameButton.addEventListener("click", () => {
      this.room?.send<StartGameRequest>("start-game", {});
    });

    voteSkipButton.addEventListener("click", () => {
      this.room?.send<CastVoteRequest>("vote", { targetSessionId: "skip" });
    });

    restartRoundButton.addEventListener("click", () => {
      this.room?.send<RestartRoundRequest>("restart-round", {});
    });

    const onHandleInput = () => {
      this.updateWindowTaskProgress();
    };

    windowHandleOne.addEventListener("input", onHandleInput);
    windowHandleTwo.addEventListener("input", onHandleInput);
    windowHandleThree.addEventListener("input", onHandleInput);

    taskWindowCancelButton.addEventListener("click", () => {
      this.closeWindowTaskPanel();
    });

    for (const smudge of whiteboardSmudges) {
      smudge.addEventListener("click", () => {
        this.handleWhiteboardSmudge(smudge);
      });
    }

    homeworkSubmitButton.addEventListener("click", () => {
      this.submitHomeworkTask();
    });

    homeworkInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        this.submitHomeworkTask();
      }
    });

    const dragItems = Array.from(
      document.querySelectorAll<HTMLElement>(".task-mini .drag-item"),
    );

    for (const item of dragItems) {
      item.addEventListener("dragstart", (event) => {
        this.handleTaskDragStart(event, item);
      });
    }

    const dropSlots = Array.from(
      document.querySelectorAll<HTMLElement>(".task-mini .drop-slot"),
    );

    for (const slot of dropSlots) {
      slot.dataset.baseLabel = slot.textContent ?? "";
      slot.addEventListener("dragover", (event) => {
        event.preventDefault();
      });
      slot.addEventListener("drop", (event) => {
        event.preventDefault();
        this.handleTaskDrop(slot);
      });
    }
  }

  private setupJoinUi(): void {
    joinNameInput.value = buildPlayerName();
    joinColorGrid.innerHTML = "";

    for (const color of PLAYER_COLORS) {
      const colorButton = document.createElement("button");
      colorButton.type = "button";
      colorButton.className = "join-color-option";
      colorButton.style.backgroundColor = color;
      colorButton.dataset.color = color;
      colorButton.setAttribute("aria-label", `Farbe ${color}`);

      if (color === this.selectedJoinColor) {
        colorButton.classList.add("selected");
      }

      colorButton.addEventListener("click", () => {
        this.selectedJoinColor = color;
        this.setJoinError("");

        for (const button of Array.from(joinColorGrid.querySelectorAll<HTMLButtonElement>(".join-color-option"))) {
          button.classList.toggle("selected", button.dataset.color === color);
        }
      });

      joinColorGrid.append(colorButton);
    }

    const onSubmit = () => {
      void this.submitJoin();
    };

    joinSubmitButton.addEventListener("click", onSubmit);
    joinNameInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        onSubmit();
      }
    });
  }

  private setupTextInputFocusHandling(): void {
    const keyboard = this.input.keyboard;

    const setKeyboardEnabled = (enabled: boolean) => {
      if (!keyboard) {
        return;
      }

      keyboard.enabled = enabled;
    };

    const attachFocusHandlers = (input: HTMLInputElement) => {
      input.addEventListener("focus", () => setKeyboardEnabled(false));
      input.addEventListener("blur", () => setKeyboardEnabled(true));
      input.addEventListener("keydown", (event) => {
        event.stopPropagation();
      });
    };

    attachFocusHandlers(joinNameInput);
    attachFocusHandlers(lobbyCodeInput);
    attachFocusHandlers(homeworkInput);
  }

  private async submitJoin(): Promise<void> {
    if (this.joining) {
      return;
    }

    const name = joinNameInput.value.trim().slice(0, 14);
    if (!name) {
      this.setJoinError("Bitte gib zuerst einen Namen ein.");
      return;
    }

    if (!this.selectedJoinColor) {
      this.setJoinError("Bitte waehle eine Farbe aus.");
      return;
    }

    this.joining = true;
    joinSubmitButton.disabled = true;
    this.setJoinError("");

    const connected = await this.connect({
      name,
      language: "de",
      lobbyCode: LOBBY_CODE,
      color: this.selectedJoinColor,
    } satisfies JoinOptions);

    this.joining = false;
    joinSubmitButton.disabled = false;

    if (connected) {
      joinPanel.classList.add("hidden");
      return;
    }

    joinPanel.classList.remove("hidden");
  }

  private setJoinError(message: string): void {
    joinError.textContent = message;
    joinError.classList.toggle("hidden", !message);
  }

  private drawBackdrops(): void {
    for (const level of LEVELS) {
      const graphics = this.add.graphics();
      graphics.fillStyle(hexToNumber(level.backgroundColor), 1);
      graphics.fillRect(0, 0, level.width, level.height);

      graphics.lineStyle(1, hexToNumber(level.gridColor), 0.55);
      for (let x = 0; x <= level.width; x += GRID_SIZE) {
        graphics.lineBetween(x, 0, x, level.height);
      }

      for (let y = 0; y <= level.height; y += GRID_SIZE) {
        graphics.lineBetween(0, y, level.width, y);
      }

      graphics.setVisible(level.id === this.localLevelId);
      this.backdrops.set(level.id, graphics);
    }
  }

  private drawMeetingButton(): void {
    const ring = this.add.ellipse(
      MEETING_BUTTON_AREA.x,
      MEETING_BUTTON_AREA.y,
      MEETING_BUTTON_AREA.radius * 2,
      MEETING_BUTTON_AREA.radius * 2,
      0xc73434,
      0.28,
    );
    ring.setStrokeStyle(4, 0xf06e6e, 0.85);
    ring.setDepth(MEETING_BUTTON_AREA.y + 10);
    ring.setVisible(MEETING_BUTTON_AREA.levelId === this.localLevelId);

    this.meetingButtonLabel = this.add
      .text(MEETING_BUTTON_AREA.x, MEETING_BUTTON_AREA.y - 6, "Meeting", {
        fontFamily: "monospace",
        fontSize: "12px",
        color: "#ffe3e3",
        stroke: "#190707",
        strokeThickness: 3,
      })
      .setOrigin(0.5)
      .setDepth(MEETING_BUTTON_AREA.y + 12)
      .setVisible(MEETING_BUTTON_AREA.levelId === this.localLevelId);

    this.meetingButtonRing = ring;
  }

  private drawOfficeZone(): void {
    const zone = this.add.rectangle(
      OFFICE_ZONE.x + OFFICE_ZONE.width / 2,
      OFFICE_ZONE.y + OFFICE_ZONE.height / 2,
      OFFICE_ZONE.width,
      OFFICE_ZONE.height,
      0x9b4f20,
      0.2,
    );
    zone.setStrokeStyle(3, 0xe5b085, 0.65);
    zone.setDepth(OFFICE_ZONE.y + OFFICE_ZONE.height);
    zone.setVisible(OFFICE_ZONE.levelId === this.localLevelId);

    this.officeZoneLabel = this.add
      .text(OFFICE_ZONE.x + OFFICE_ZONE.width / 2, OFFICE_ZONE.y + 14, "Sekretariat", {
        fontFamily: "monospace",
        fontSize: "12px",
        color: "#f8d7ba",
        stroke: "#2a1305",
        strokeThickness: 3,
      })
      .setOrigin(0.5, 0)
      .setDepth(OFFICE_ZONE.y + OFFICE_ZONE.height + 2)
      .setVisible(OFFICE_ZONE.levelId === this.localLevelId);

    this.officeZoneVisual = zone;
  }

  private setupKeyboard(): void {
    const keyboard = this.input.keyboard;

    if (!keyboard) {
      throw new Error("Keyboard input is not available.");
    }

    this.cursors = keyboard.createCursorKeys();
    this.wasd = keyboard.addKeys({
      up: Phaser.Input.Keyboard.KeyCodes.W,
      left: Phaser.Input.Keyboard.KeyCodes.A,
      down: Phaser.Input.Keyboard.KeyCodes.S,
      right: Phaser.Input.Keyboard.KeyCodes.D,
    }) as DirectionKeys;

    this.levelSwitchKeys = keyboard.addKeys({
      previous: Phaser.Input.Keyboard.KeyCodes.Q,
      next: Phaser.Input.Keyboard.KeyCodes.E,
    }) as LevelSwitchKeys;

    this.actionKeys = keyboard.addKeys({
      callMeeting: Phaser.Input.Keyboard.KeyCodes.M,
      doTask: Phaser.Input.Keyboard.KeyCodes.F,
      catchStudent: Phaser.Input.Keyboard.KeyCodes.C,
      startGame: Phaser.Input.Keyboard.KeyCodes.G,
      voteSkip: Phaser.Input.Keyboard.KeyCodes.V,
      voteFirst: Phaser.Input.Keyboard.KeyCodes.ONE,
      restartRound: Phaser.Input.Keyboard.KeyCodes.R,
    }) as ActionKeys;
  }

  private async connect(joinOptions: JoinOptions): Promise<boolean> {
    const timeoutMs = 8000;
    let timeoutId: number | undefined;

    try {
      this.client = new Client(SERVER_URL);
      statusBanner.textContent = "Verbinde...";

      const joinPromise = this.client.joinOrCreate<WorldState>(ROOM_NAME, joinOptions);
      const timeoutPromise = new Promise<Room<any, WorldState>>((_, reject) => {
        timeoutId = window.setTimeout(() => {
          reject(new Error("Verbindung dauert zu lange. Bitte erneut versuchen."));
        }, timeoutMs);
      });

      this.room = await Promise.race([joinPromise, timeoutPromise]);
      this.callbacks = Callbacks.get(this.room);
      this.sessionId = this.room.sessionId;

      this.registerStateCallbacks();
      this.registerRoomCallbacks();

      window.addEventListener(
        "beforeunload",
        () => {
          void this.room?.leave();
        },
        { once: true },
      );
      return true;
    } catch (error: unknown) {
      const message = formatError(error);
      statusBanner.textContent = "Verbindung fehlgeschlagen.";
      this.room = undefined;
      this.callbacks = undefined;
      this.sessionId = undefined;
      this.setJoinError(
        message.includes("Farbe")
          ? message
          : `Verbindung fehlgeschlagen: ${message}`,
      );
      console.error(`Connection failed: ${message}`);
      return false;
    } finally {
      if (timeoutId) {
        window.clearTimeout(timeoutId);
      }
    }
  }

  private registerRoomCallbacks(): void {
    if (!this.room) {
      return;
    }

    this.room.onLeave((code) => {
      console.warn(`Disconnected (${code})`);
    });

    this.room.onError((code, message) => {
      console.error(`Error ${code}: ${message ?? "Unknown error"}`);
    });
  }

  private registerStateCallbacks(): void {
    const callbacks = this.getCallbacks();

    callbacks.listen(this.room!.state, "gamePhase", () => {
      for (const [sessionId, avatar] of this.players.entries()) {
        this.updateAvatarVisibility(sessionId, avatar);
      }
    });

    callbacks.onAdd("boxes", (box) => {
      this.addBox(box);
    });

    callbacks.onAdd("players", (player, sessionId) => {
      this.playerStates.set(sessionId, player);
      this.addPlayer(player, sessionId);
    });

    callbacks.onRemove("players", (_player, sessionId) => {
      this.playerStates.delete(sessionId);
      this.removePlayer(sessionId);
    });

    callbacks.onAdd("tasks", (task) => {
      this.tasks.set(task.id, task);
      this.addTaskMarker(task);
    });

    callbacks.onRemove("tasks", (task) => {
      this.tasks.delete(task.id);
      const marker = this.taskMarkers.get(task.id);
      marker?.destroy();
      this.taskMarkers.delete(task.id);
    });

    callbacks.onAdd("evidence", (evidence) => {
      this.evidence.set(evidence.id, evidence);
      this.addEvidenceMarker(evidence);
    });

    callbacks.onRemove("evidence", (evidence) => {
      this.evidence.delete(evidence.id);
      const marker = this.evidenceMarkers.get(evidence.id);
      marker?.icon.destroy();
      marker?.marker.destroy();
      this.evidenceMarkers.delete(evidence.id);
    });
  }

  private getCallbacks(): RoomCallbacks {
    if (!this.callbacks) {
      throw new Error("Callbacks are not available before the room connects.");
    }

    return this.callbacks;
  }

  private addBox(box: BoxState): void {
    const level = getLevelById(box.levelId);
    const rectangle = this.add.rectangle(
      box.x + box.width / 2,
      box.y + box.height / 2,
      box.width,
      box.height,
      hexToNumber(level.boxFillColor),
      1,
    );

    rectangle.setStrokeStyle(3, hexToNumber(level.boxStrokeColor), 0.8);
    rectangle.setDepth(rectangle.y - 1);
    rectangle.setVisible(box.levelId === this.localLevelId);

    this.boxes.push({
      levelId: box.levelId,
      rectangle,
    });
  }

  private addTaskMarker(task: TaskState): void {
    const marker = this.buildTaskMarker(task);
    marker.setDepth(task.y - 1);
    marker.setVisible(task.levelId === this.localLevelId && !task.completed);

    const callbacks = this.getCallbacks();
    callbacks.listen(task, "completed", (value) => {
      if (value && this.activeTaskId === task.id) {
        this.closeWindowTaskPanel();
      }

      marker.setVisible(!value && task.levelId === this.localLevelId);
    });

    callbacks.listen(task, "levelId", (value) => {
      marker.setVisible(!task.completed && value === this.localLevelId);
    });

    this.taskMarkers.set(task.id, marker);
  }

  private buildTaskMarker(task: TaskState): Phaser.GameObjects.Container {
    const children: Phaser.GameObjects.GameObject[] = [];

    switch (task.type) {
      case "clean_whiteboard": {
        const board = this.add.rectangle(0, 0, 30, 20, 0x327b54, 0.95);
        board.setStrokeStyle(2, 0xa9d8bd, 0.85);
        const chalk = this.add.rectangle(0, 4, 16, 2, 0xe9f7ef, 0.9);
        children.push(board, chalk);
        break;
      }
      case "open_windows": {
        const frame = this.add.rectangle(0, 0, 28, 22, 0x9ed2f2, 0.9);
        frame.setStrokeStyle(2, 0x16435d, 0.8);
        const divider = this.add.rectangle(0, 0, 2, 18, 0x2f5870, 0.9);
        const handleLeft = this.add.circle(-6, 0, 2, 0x0f2c3d, 0.9);
        const handleRight = this.add.circle(6, 0, 2, 0x0f2c3d, 0.9);
        children.push(frame, divider, handleLeft, handleRight);
        break;
      }
      case "organize_lab_equipment": {
        const flaskTop = this.add.rectangle(0, -5, 8, 8, 0xd0e2ff, 0.9);
        const flaskBody = this.add.triangle(0, 4, -10, 6, 10, 6, 0, 16, 0x6ea1ff, 0.92);
        flaskBody.setStrokeStyle(2, 0x213f7a, 0.7);
        children.push(flaskTop, flaskBody);
        break;
      }
      case "copy_homework": {
        const paper = this.add.rectangle(0, 0, 24, 30, 0xf4f7fb, 0.95);
        paper.setStrokeStyle(2, 0x5e6f80, 0.7);
        const lineA = this.add.rectangle(0, -6, 14, 2, 0x9eb0c2, 0.8);
        const lineB = this.add.rectangle(0, 0, 14, 2, 0x9eb0c2, 0.8);
        const lineC = this.add.rectangle(0, 6, 10, 2, 0x9eb0c2, 0.8);
        children.push(paper, lineA, lineB, lineC);
        break;
      }
      case "sort_pencils":
      default: {
        const p1 = this.add.rectangle(-7, 2, 5, 22, 0xf29c38, 0.95).setAngle(20);
        const p2 = this.add.rectangle(0, 0, 5, 22, 0xe44d4d, 0.95).setAngle(-10);
        const p3 = this.add.rectangle(7, 2, 5, 22, 0x5ac87f, 0.95).setAngle(12);
        children.push(p1, p2, p3);
        break;
      }
    }

    const label = this.add
      .text(0, 19, this.taskShortLabel(task.type), {
        fontFamily: "monospace",
        fontSize: "9px",
        color: "#f3f6f9",
        stroke: "#0b1014",
        strokeThickness: 3,
      })
      .setOrigin(0.5, 0.5);

    children.push(label);

    return this.add.container(task.x, task.y, children);
  }

  private addEvidenceMarker(evidence: EvidenceState): void {
    const iconColor = evidence.itemType === "phone" ? 0x55d6ff : 0xffa84a;
    const icon = this.add.ellipse(evidence.x, evidence.y, 22, 18, iconColor, 0.9);
    icon.setStrokeStyle(3, 0x0d1a21, 0.8);
    icon.setDepth(evidence.y + 1);

    const marker = this.add
      .text(evidence.x, evidence.y - 24, this.evidenceLabel(evidence.itemType), {
        fontFamily: "monospace",
        fontSize: "11px",
        color: "#ffeecb",
        stroke: "#1a1206",
        strokeThickness: 3,
      })
      .setOrigin(0.5)
      .setDepth(evidence.y + 2);

    const visible = !evidence.reported && evidence.levelId === this.localLevelId;
    icon.setVisible(visible);
    marker.setVisible(visible);

    const callbacks = this.getCallbacks();
    callbacks.listen(evidence, "reported", (value) => {
      const nextVisible = !value && evidence.levelId === this.localLevelId;
      icon.setVisible(nextVisible);
      marker.setVisible(nextVisible);
    });
    callbacks.listen(evidence, "levelId", (levelId) => {
      const nextVisible = !evidence.reported && levelId === this.localLevelId;
      icon.setVisible(nextVisible);
      marker.setVisible(nextVisible);
    });

    this.evidenceMarkers.set(evidence.id, {
      icon,
      levelId: evidence.levelId,
      marker,
    });
  }

  private drawPortals(): void {
    for (const level of LEVELS) {
      for (const portal of level.portals) {
        this.addPortal(level.id, portal);
      }
    }
  }

  private addPortal(levelId: string, portal: LevelPortal): void {
    const ringColor = hexToNumber(portal.color);
    const coreColor = lightenColor(ringColor, 0.2);
    const destinationName = getLevelById(portal.targetLevelId).name;

    const ring = this.add.circle(portal.x, portal.y, portal.radius, ringColor, 0.38);
    ring.setStrokeStyle(4, ringColor, 0.95);

    const core = this.add.circle(
      portal.x,
      portal.y,
      Math.max(8, portal.radius - 10),
      coreColor,
      0.78,
    );

    const label = this.add
      .text(portal.x, portal.y - portal.radius - 14, `To ${destinationName}`, {
        fontFamily: "monospace",
        fontSize: "12px",
        color: "#f8fbff",
        stroke: "#0b1014",
        strokeThickness: 3,
      })
      .setOrigin(0.5);

    ring.setDepth(portal.y - 2);
    core.setDepth(portal.y - 1);
    label.setDepth(portal.y + 3);

    const visible = levelId === this.localLevelId;
    ring.setVisible(visible);
    core.setVisible(visible);
    label.setVisible(visible);

    this.portals.push({
      levelId,
      ring,
      core,
      label,
    });
  }

  private addPlayer(player: PlayerState, sessionId: string): void {
    const callbacks = this.getCallbacks();
    const avatar = createAvatar(this, {
      color: player.color,
      isLocal: sessionId === this.sessionId,
      name: player.name,
    });

    avatar.container.setPosition(player.x, player.y);
    avatar.levelId = player.levelId;
    avatar.isAlive = player.alive;
    avatar.ownerSessionId = sessionId;
    avatar.serverX = player.x;
    avatar.serverY = player.y;
    avatar.unbind = [
      callbacks.listen(player, "x", (value) => {
        avatar.serverX = value;
      }),
      callbacks.listen(player, "y", (value) => {
        avatar.serverY = value;
      }),
      callbacks.listen(player, "name", (value) => {
        avatar.label.setText(value);
        this.applyAvatarLifeState(avatar, avatar.isAlive);
      }),
      callbacks.listen(player, "color", (value) => {
        applyAvatarColor(avatar, value);
      }),
      callbacks.listen(player, "levelId", (value) => {
        avatar.levelId = value;
        this.updateAvatarVisibility(sessionId, avatar);

        if (sessionId === this.sessionId) {
          this.applyLocalLevel(value);
        }
      }),
      callbacks.listen(player, "alive", (value) => {
        avatar.isAlive = value;
        this.applyAvatarLifeState(avatar, value);
        this.updateAvatarVisibility(sessionId, avatar);

        if (sessionId === this.sessionId) {
          if (!value && this.activeTaskId) {
            this.closeWindowTaskPanel();
          }

          for (const [otherSessionId, otherAvatar] of this.players.entries()) {
            this.updateAvatarVisibility(otherSessionId, otherAvatar);
          }
          this.updateSpectatorCamera();
        }
      }),
    ];

    this.applyAvatarLifeState(avatar, player.alive);
    this.updateAvatarVisibility(sessionId, avatar);
    this.players.set(sessionId, avatar);

    if (sessionId === this.sessionId) {
      this.applyLocalLevel(player.levelId);
      this.cameras.main.startFollow(avatar.container, true, 0.12, 0.12);
    }
  }

  private removePlayer(sessionId: string): void {
    const avatar = this.players.get(sessionId);

    if (!avatar) {
      return;
    }

    for (const unbind of avatar.unbind) {
      unbind();
    }

    avatar.container.destroy(true);
    this.players.delete(sessionId);
  }

  update(): void {
    if (this.room) {
      this.pushInput();
      this.pushLevelSwitchInput();
      this.pushActionInput();
      this.syncOverlayUi();
      this.syncRoleBriefing();
      this.updateSpectatorCamera();
    }

    for (const [sessionId, avatar] of this.players.entries()) {
      const amount = sessionId === this.sessionId ? 0.34 : 0.2;
      avatar.container.x = Phaser.Math.Linear(
        avatar.container.x,
        avatar.serverX,
        amount,
      );
      avatar.container.y = Phaser.Math.Linear(
        avatar.container.y,
        avatar.serverY,
        amount,
      );
      avatar.container.setDepth(avatar.container.y);
    }
  }

  private pushLevelSwitchInput(): void {
    if (!this.room) {
      return;
    }

    if (this.activeTaskId) {
      return;
    }

    const me = this.sessionId ? this.playerStates.get(this.sessionId) : undefined;
    if (!me || this.room.state.gamePhase !== "playing") {
      return;
    }

    if (Phaser.Input.Keyboard.JustDown(this.levelSwitchKeys.previous)) {
      this.room.send<LevelSwitchRequest>("switch-level", { direction: -1 });
    }

    if (Phaser.Input.Keyboard.JustDown(this.levelSwitchKeys.next)) {
      this.room.send<LevelSwitchRequest>("switch-level", { direction: 1 });
    }
  }

  private pushActionInput(): void {
    if (!this.room) {
      return;
    }

    if (this.activeTaskId) {
      return;
    }

    const me = this.sessionId ? this.playerStates.get(this.sessionId) : undefined;
    const gamePhase = this.room.state.gamePhase as GamePhase;

    if (gamePhase === "playing" && me?.alive && Phaser.Input.Keyboard.JustDown(this.actionKeys.callMeeting)) {
      const evidence = this.findNearestReportableEvidence();
      const payload: CallMeetingRequest = {
        reason: evidence ? "evidence" : "button",
        evidenceId: evidence?.id,
      };
      this.room.send<CallMeetingRequest>("call-meeting", payload);
    }

    if (gamePhase === "playing" && me?.alive && Phaser.Input.Keyboard.JustDown(this.actionKeys.doTask)) {
      const task = this.findNearestTask();
      if (task) {
        this.openWindowTaskPanel(task);
      }
    }

    if (
      gamePhase === "playing" &&
      me?.alive &&
      Phaser.Input.Keyboard.JustDown(this.actionKeys.catchStudent)
    ) {
      const targetId = this.findNearestCatchTarget();
      if (targetId) {
        this.room.send<TeacherCatchRequest>("teacher-catch", {
          targetSessionId: targetId,
        });
      }
    }

    if (Phaser.Input.Keyboard.JustDown(this.actionKeys.voteSkip)) {
      this.room.send<CastVoteRequest>("vote", { targetSessionId: "skip" });
    }

    if (Phaser.Input.Keyboard.JustDown(this.actionKeys.voteFirst)) {
      const targetId = this.findFirstVoteTarget();
      if (targetId) {
        this.room.send<CastVoteRequest>("vote", { targetSessionId: targetId });
      }
    }

    if (Phaser.Input.Keyboard.JustDown(this.actionKeys.restartRound)) {
      this.room.send<RestartRoundRequest>("restart-round", {});
    }

    if (
      gamePhase === "lobby" &&
      this.sessionId === this.room.state.lobbyOwnerSessionId &&
      Phaser.Input.Keyboard.JustDown(this.actionKeys.startGame)
    ) {
      this.room.send<StartGameRequest>("start-game", {});
    }
  }

  private updateAvatarVisibility(sessionId: string, avatar: AvatarParts): void {
    const gamePhase = this.room?.state.gamePhase as GamePhase | undefined;
    if (gamePhase === "lobby" && sessionId === this.sessionId) {
      avatar.container.setVisible(false);
      return;
    }

    if (avatar.levelId !== this.localLevelId) {
      avatar.container.setVisible(false);
      return;
    }

    if (sessionId === this.sessionId) {
      avatar.container.setVisible(true);
      return;
    }

    if (avatar.isAlive) {
      avatar.container.setVisible(true);
      return;
    }

    const localPlayer = this.sessionId ? this.playerStates.get(this.sessionId) : undefined;
    avatar.container.setVisible(Boolean(localPlayer && !localPlayer.alive));
  }

  private applyLocalLevel(levelId: string): void {
    const level = getLevelById(levelId);
    this.localLevelId = level.id;

    this.cameras.main.setBackgroundColor(level.backgroundColor);
    this.cameras.main.setBounds(0, 0, level.width, level.height);

    for (const [id, backdrop] of this.backdrops.entries()) {
      backdrop.setVisible(id === level.id);
    }

    for (const box of this.boxes) {
      box.rectangle.setVisible(box.levelId === level.id);
    }

    for (const portal of this.portals) {
      const visible = portal.levelId === level.id;
      portal.ring.setVisible(visible);
      portal.core.setVisible(visible);
      portal.label.setVisible(visible);
    }

    this.meetingButtonRing?.setVisible(MEETING_BUTTON_AREA.levelId === level.id);
    this.meetingButtonLabel?.setVisible(MEETING_BUTTON_AREA.levelId === level.id);
    this.officeZoneVisual?.setVisible(OFFICE_ZONE.levelId === level.id);
    this.officeZoneLabel?.setVisible(OFFICE_ZONE.levelId === level.id);

    for (const [taskId, marker] of this.taskMarkers.entries()) {
      const task = this.tasks.get(taskId);
      marker.setVisible(Boolean(task && !task.completed && task.levelId === level.id));
    }

    for (const [evidenceId, visuals] of this.evidenceMarkers.entries()) {
      const evidence = this.evidence.get(evidenceId);
      const visible = Boolean(evidence && !evidence.reported && evidence.levelId === level.id);
      visuals.icon.setVisible(visible);
      visuals.marker.setVisible(visible);
    }

    for (const [sessionId, avatar] of this.players.entries()) {
      this.updateAvatarVisibility(sessionId, avatar);
    }
  }

  private pushInput(): void {
    if (!this.room) {
      return;
    }

    if (this.activeTaskId) {
      return;
    }

    const me = this.sessionId ? this.playerStates.get(this.sessionId) : undefined;
    if (!me || this.room.state.gamePhase !== "playing") {
      return;
    }

    const nextInput: MovementInput = {
      left: this.cursors.left.isDown || this.wasd.left.isDown,
      right: this.cursors.right.isDown || this.wasd.right.isDown,
      up: this.cursors.up.isDown || this.wasd.up.isDown,
      down: this.cursors.down.isDown || this.wasd.down.isDown,
    };

    if (sameInput(this.currentInput, nextInput)) {
      return;
    }

    this.currentInput = nextInput;
    this.room.send<MovementInput>("input", nextInput);
  }

  private syncOverlayUi(): void {
    if (!this.room || !this.sessionId) {
      return;
    }

    const state = this.room.state;
    const me = this.playerStates.get(this.sessionId);
    const phase = state.gamePhase as GamePhase;
    if (phase !== "playing" && this.activeTaskId) {
      this.closeWindowTaskPanel();
    }

    const meetingActive = phase === "meeting" || phase === "voting";

    phaseValue.textContent = this.phaseToGerman(phase);
    roleValue.textContent = me ? this.roleToGerman(me.role as RoleType) : "Unbekannt";
    taskValue.textContent = `${state.taskCompleted}/${state.taskTotal}`;

    const evidenceNearby = this.findNearestReportableEvidence();
    const playerCount = state.players.size;
    const isHost = this.sessionId === state.lobbyOwnerSessionId;

    lobbyCodeValue.textContent = state.lobbyCode || LOBBY_CODE;
    startGameButton.classList.toggle("hidden", phase !== "lobby" || !isHost);
    startGameButton.disabled = phase !== "lobby" || !isHost || playerCount < 3;

    const hints: string[] = [];
    if (me?.alive && phase === "playing") {
      hints.push("M = Besprechung");
      hints.push("F = Aufgabe");
      if (me.role === "teacher") {
        hints.push("C = Schueler fangen");
      }
      if (evidenceNearby) {
        hints.push("Hinweis gefunden: M druecken");
      }
    }

    if (phase === "lobby") {
      hints.push(`Spieler: ${playerCount}/3`);
      if (isHost) {
        hints.push("G = Spiel starten");
      }
    }

    statusBanner.textContent = [state.statusText, hints.join(" | ")]
      .filter(Boolean)
      .join(" | ");

    meetingPanel.classList.toggle("hidden", !meetingActive);
    roundEndPanel.classList.toggle("hidden", phase !== "ended");
    voteSkipButton.disabled = phase !== "voting" || !me?.alive || Boolean(me?.hasVoted);

    if (phase === "ended") {
      roundEndText.textContent = `${state.statusText} (R fuer neue Runde)`;
    }

    if (!meetingActive) {
      this.voteUiCacheKey = "";
      voteList.innerHTML = "";
      return;
    }

    const remainingSeconds = Math.max(
      0,
      Math.ceil((state.meeting.endsAtMs - Date.now()) / 1000),
    );
    meetingTimer.textContent = `${remainingSeconds}s`;

    const modeLabel = phase === "voting" ? "Abstimmung" : "Diskussion";
    meetingMeta.textContent = `${modeLabel} - Quelle: ${this.meetingSourceToGerman(
      state.meeting.source,
    )}`;

    this.renderVoteList(phase, me);
  }

  private syncRoleBriefing(): void {
    if (!this.room || !this.sessionId) {
      return;
    }

    if (this.room.state.roundId === this.lastRoundId) {
      return;
    }

    const me = this.playerStates.get(this.sessionId);
    if (!me || this.room.state.gamePhase !== "playing") {
      return;
    }

    this.lastRoundId = this.room.state.roundId;

    roleBriefing.innerHTML = `
      <h2>Rolleninfo</h2>
      <p><strong>${this.roleToGerman(me.role as RoleType)}</strong></p>
      <p>${this.roleBriefingText(me.role as RoleType)}</p>
      <p>Steuerung: WASD/Pfeile, M fuer Besprechung, F fuer Aufgaben</p>
    `;
    roleBriefing.classList.remove("hidden");

    if (this.roleBriefingTimeout) {
      window.clearTimeout(this.roleBriefingTimeout);
    }

    this.roleBriefingTimeout = window.setTimeout(() => {
      roleBriefing.classList.add("hidden");
    }, 4800);
  }

  private renderVoteList(phase: GamePhase, me?: PlayerState): void {
    if (!this.room || !this.sessionId) {
      return;
    }

    const alivePlayers = Array.from(this.playerStates.entries())
      .filter(([, player]) => player.alive)
      .map(([sessionId, player]) => ({ sessionId, player }));

    const votes = this.room.state.votes as VoteState[];
    const cacheKey = JSON.stringify({
      phase,
      voted: Boolean(me?.hasVoted),
      players: alivePlayers.map((entry) => [entry.sessionId, entry.player.name]),
      votes: votes.map((vote) => [vote.voterSessionId, vote.targetSessionId]),
    });

    if (cacheKey === this.voteUiCacheKey) {
      return;
    }

    this.voteUiCacheKey = cacheKey;
    voteList.innerHTML = "";

    for (const entry of alivePlayers) {
      const row = document.createElement("div");
      row.className = "vote-row";

      const label = document.createElement("span");
      label.textContent = entry.player.name;

      const voteCount = votes.filter((vote) => vote.targetSessionId === entry.sessionId).length;
      const voteBadge = document.createElement("small");
      voteBadge.textContent = `${voteCount} Stimmen`;

      const button = document.createElement("button");
      button.type = "button";
      button.textContent = "Stimme";
      button.disabled = phase !== "voting" || !me?.alive || Boolean(me.hasVoted);
      button.addEventListener("click", () => {
        this.room?.send<CastVoteRequest>("vote", { targetSessionId: entry.sessionId });
      });

      const right = document.createElement("div");
      right.style.display = "flex";
      right.style.gap = "8px";
      right.style.alignItems = "center";
      right.append(voteBadge, button);

      row.append(label, right);
      voteList.append(row);
    }
  }

  private findNearestTask(): TaskState | undefined {
    if (!this.sessionId) {
      return undefined;
    }

    const avatar = this.players.get(this.sessionId);
    if (!avatar) {
      return undefined;
    }

    let nearest: TaskState | undefined;
    let nearestDistance = Number.POSITIVE_INFINITY;

    for (const task of this.tasks.values()) {
      if (task.completed || task.levelId !== avatar.levelId) {
        continue;
      }

      const distance = Math.hypot(task.x - avatar.serverX, task.y - avatar.serverY);
      if (distance > TASK_INTERACT_RADIUS) {
        continue;
      }

      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearest = task;
      }
    }

    return nearest;
  }

  private openWindowTaskPanel(task: TaskState): void {
    if (task.completed) {
      return;
    }

    this.activeTaskId = task.id;
    this.activeTaskType = task.type as TaskType;
    this.hideTaskPanels();

    switch (task.type as TaskType) {
      case "open_windows":
        taskWindowTitle.textContent = "Fenster oeffnen";
        taskMiniWindow.classList.remove("hidden");
        this.resetWindowTaskUi();
        this.updateWindowTaskProgress();
        break;
      case "clean_whiteboard":
        taskWindowTitle.textContent = "Tafel reinigen";
        taskMiniWhiteboard.classList.remove("hidden");
        this.resetWhiteboardTaskUi();
        this.updateWhiteboardTaskProgress();
        break;
      case "organize_lab_equipment":
        taskWindowTitle.textContent = "Labor sortieren";
        taskMiniLab.classList.remove("hidden");
        this.resetDragTaskUi("organize_lab_equipment");
        this.updateDragTaskProgress();
        break;
      case "copy_homework":
        taskWindowTitle.textContent = "Hausaufgaben abschreiben";
        taskMiniHomework.classList.remove("hidden");
        this.resetHomeworkTaskUi();
        this.updateHomeworkTaskHint();
        break;
      case "sort_pencils":
      default:
        taskWindowTitle.textContent = "Stifte sortieren";
        taskMiniPencils.classList.remove("hidden");
        this.resetDragTaskUi("sort_pencils");
        this.updateDragTaskProgress();
        break;
    }

    taskWindowPanel.classList.remove("hidden");
  }

  private closeWindowTaskPanel(): void {
    this.activeTaskId = undefined;
    this.activeTaskType = undefined;
    this.activeDragItem = undefined;
    this.cleanedSmudges.clear();
    this.hideTaskPanels();
    taskWindowPanel.classList.add("hidden");
  }

  private hideTaskPanels(): void {
    taskMiniWindow.classList.add("hidden");
    taskMiniWhiteboard.classList.add("hidden");
    taskMiniLab.classList.add("hidden");
    taskMiniHomework.classList.add("hidden");
    taskMiniPencils.classList.add("hidden");
  }

  private resetWindowTaskUi(): void {
    windowHandleOne.value = "0";
    windowHandleTwo.value = "0";
    windowHandleThree.value = "0";
  }

  private updateWindowTaskProgress(): void {
    if (!this.activeTaskId || this.activeTaskType !== "open_windows") {
      return;
    }

    const values = [
      Number(windowHandleOne.value),
      Number(windowHandleTwo.value),
      Number(windowHandleThree.value),
    ];
    const opened = values.filter((value) => value >= 95).length;

    taskWindowInfo.textContent = `Ziehe alle drei Griffe ganz nach rechts (${opened}/3 offen).`;

    if (opened < 3) {
      return;
    }

    const taskId = this.activeTaskId;
    this.room?.send<CompleteTaskRequest>("complete-task", { taskId });
    this.closeWindowTaskPanel();
  }

  private resetWhiteboardTaskUi(): void {
    this.cleanedSmudges.clear();

    for (const smudge of whiteboardSmudges) {
      smudge.disabled = false;
      smudge.classList.remove("cleaned");
    }
  }

  private handleWhiteboardSmudge(smudge: HTMLButtonElement): void {
    if (this.activeTaskType !== "clean_whiteboard" || !this.activeTaskId) {
      return;
    }

    const smudgeId = smudge.dataset.smudgeId;
    if (!smudgeId || this.cleanedSmudges.has(smudgeId)) {
      return;
    }

    this.cleanedSmudges.add(smudgeId);
    smudge.disabled = true;
    smudge.classList.add("cleaned");
    this.updateWhiteboardTaskProgress();
  }

  private updateWhiteboardTaskProgress(): void {
    if (this.activeTaskType !== "clean_whiteboard" || !this.activeTaskId) {
      return;
    }

    const total = whiteboardSmudges.length;
    const cleaned = this.cleanedSmudges.size;
    taskWindowInfo.textContent = `Entferne alle Flecken (${cleaned}/${total} sauber).`;

    if (cleaned < total) {
      return;
    }

    const taskId = this.activeTaskId;
    this.room?.send<CompleteTaskRequest>("complete-task", { taskId });
    this.closeWindowTaskPanel();
  }

  private handleTaskDragStart(event: DragEvent, item: HTMLElement): void {
    if (!this.activeTaskType || item.classList.contains("placed")) {
      event.preventDefault();
      return;
    }

    this.activeDragItem = item;
    event.dataTransfer?.setData("text/plain", item.dataset.item ?? "");
    event.dataTransfer?.setDragImage(item, item.clientWidth / 2, item.clientHeight / 2);
  }

  private handleTaskDrop(slot: HTMLElement): void {
    if (!this.activeTaskType || !this.activeTaskId) {
      return;
    }

    const item = this.activeDragItem;
    const expectedItem = slot.dataset.slot;
    const draggedItem = item?.dataset.item;

    if (!item || !expectedItem || !draggedItem) {
      return;
    }

    const isLabTask = this.activeTaskType === "organize_lab_equipment";
    const isPencilTask = this.activeTaskType === "sort_pencils";

    if (isLabTask && !labSlots.contains(slot)) {
      return;
    }

    if (isPencilTask && !pencilSlots.contains(slot)) {
      return;
    }

    if (!isLabTask && !isPencilTask) {
      return;
    }

    if (slot.dataset.filled || draggedItem !== expectedItem) {
      taskWindowInfo.textContent = "Das passt nicht. Lege jedes Teil in das richtige Fach.";
      return;
    }

    slot.dataset.filled = draggedItem;
    slot.classList.add("filled");

    item.classList.add("placed");
    item.draggable = false;
    slot.append(item);
    this.activeDragItem = undefined;

    this.updateDragTaskProgress();
  }

  private resetDragTaskUi(taskType: "organize_lab_equipment" | "sort_pencils"): void {
    const pool = taskType === "organize_lab_equipment" ? labPool : pencilPool;
    const slots = Array.from(
      (taskType === "organize_lab_equipment" ? labSlots : pencilSlots).querySelectorAll<
        HTMLElement
      >(".drop-slot"),
    );
    const items = Array.from(
      (taskType === "organize_lab_equipment" ? taskMiniLab : taskMiniPencils).querySelectorAll<
        HTMLElement
      >(".drag-item"),
    );

    for (const item of items) {
      item.classList.remove("placed");
      item.draggable = true;
      pool.append(item);
    }

    for (const slot of slots) {
      slot.dataset.filled = "";
      slot.classList.remove("filled");
      slot.textContent = slot.dataset.baseLabel ?? slot.textContent;
    }
  }

  private updateDragTaskProgress(): void {
    if (!this.activeTaskId || !this.activeTaskType) {
      return;
    }

    const slots =
      this.activeTaskType === "organize_lab_equipment"
        ? Array.from(labSlots.querySelectorAll<HTMLElement>(".drop-slot"))
        : this.activeTaskType === "sort_pencils"
          ? Array.from(pencilSlots.querySelectorAll<HTMLElement>(".drop-slot"))
          : [];

    if (slots.length === 0) {
      return;
    }

    const filled = slots.filter((slot) => Boolean(slot.dataset.filled)).length;
    taskWindowInfo.textContent = `Ordne alles korrekt ein (${filled}/${slots.length} einsortiert).`;

    if (filled < slots.length) {
      return;
    }

    const taskId = this.activeTaskId;
    this.room?.send<CompleteTaskRequest>("complete-task", { taskId });
    this.closeWindowTaskPanel();
  }

  private resetHomeworkTaskUi(): void {
    homeworkInput.value = "";
  }

  private updateHomeworkTaskHint(): void {
    taskWindowInfo.textContent = "Tippe den Satz exakt so ab und bestaetige ihn.";
  }

  private submitHomeworkTask(): void {
    if (this.activeTaskType !== "copy_homework" || !this.activeTaskId) {
      return;
    }

    const expected = homeworkTarget.textContent?.trim() ?? "";
    const typed = homeworkInput.value.trim();

    if (typed !== expected) {
      taskWindowInfo.textContent = "Noch nicht exakt. Achte auf Gross-/Kleinschreibung und Zeichen.";
      return;
    }

    const taskId = this.activeTaskId;
    this.room?.send<CompleteTaskRequest>("complete-task", { taskId });
    this.closeWindowTaskPanel();
  }

  private findNearestReportableEvidence(): EvidenceState | undefined {
    if (!this.sessionId) {
      return undefined;
    }

    const meAvatar = this.players.get(this.sessionId);
    const meState = this.playerStates.get(this.sessionId);
    if (!meAvatar || !meState?.alive) {
      return undefined;
    }

    let nearest: EvidenceState | undefined;
    let nearestDistance = Number.POSITIVE_INFINITY;

    for (const evidence of this.evidence.values()) {
      if (evidence.reported || evidence.levelId !== meAvatar.levelId) {
        continue;
      }

      const distance = Math.hypot(
        evidence.x - meAvatar.serverX,
        evidence.y - meAvatar.serverY,
      );
      if (distance <= EVIDENCE_REPORT_RADIUS && distance < nearestDistance) {
        nearestDistance = distance;
        nearest = evidence;
      }
    }

    return nearest;
  }

  private updateSpectatorCamera(): void {
    if (!this.sessionId) {
      return;
    }

    const meAvatar = this.players.get(this.sessionId);

    if (!meAvatar) {
      return;
    }

    this.cameras.main.startFollow(meAvatar.container, true, 0.12, 0.12);
  }

  private applyAvatarLifeState(avatar: AvatarParts, alive: boolean): void {
    const baseLabel = avatar.label.text.replace(/ \[(OUT|GEIST)\]$/, "");

    avatar.ghostAura.setVisible(!alive);
    avatar.container.setAlpha(alive ? 1 : 0.68);
    avatar.body.setAlpha(alive ? 1 : 0.78);
    avatar.backpack.setAlpha(alive ? 1 : 0.55);
    avatar.label.setColor(alive ? "#f5f7fa" : "#b8eeff");
    avatar.label.setText(alive ? baseLabel : `${baseLabel} [GEIST]`);
  }

  private evidenceLabel(itemType: string): string {
    return itemType === "phone" ? "Handy" : "Rucksack";
  }

  private taskShortLabel(taskType: string): string {
    switch (taskType) {
      case "clean_whiteboard":
        return "Tafel";
      case "open_windows":
        return "Fenster";
      case "organize_lab_equipment":
        return "Labor";
      case "copy_homework":
        return "Hausaufg.";
      case "sort_pencils":
      default:
        return "Stifte";
    }
  }

  private findNearestCatchTarget(): string | undefined {
    if (!this.sessionId) {
      return undefined;
    }

    const meAvatar = this.players.get(this.sessionId);
    if (!meAvatar) {
      return undefined;
    }

    let nearestTargetId: string | undefined;
    let nearestDistance = Number.POSITIVE_INFINITY;

    for (const [sessionId, avatar] of this.players.entries()) {
      if (sessionId === this.sessionId) {
        continue;
      }

      const state = this.playerStates.get(sessionId);
      if (!state?.alive || state.role === "teacher" || avatar.levelId !== meAvatar.levelId) {
        continue;
      }

      const distance = Math.hypot(
        avatar.serverX - meAvatar.serverX,
        avatar.serverY - meAvatar.serverY,
      );

      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearestTargetId = sessionId;
      }
    }

    return nearestTargetId;
  }

  private findFirstVoteTarget(): string | undefined {
    if (!this.sessionId) {
      return undefined;
    }

    for (const [sessionId, state] of this.playerStates.entries()) {
      if (sessionId !== this.sessionId && state.alive) {
        return sessionId;
      }
    }

    return undefined;
  }

  private roleToGerman(role: RoleType): string {
    switch (role) {
      case "teacher":
        return "Lehrer";
      case "student_with_key":
        return "Schueler mit Schluessel";
      case "student":
      default:
        return "Schueler";
    }
  }

  private roleBriefingText(role: RoleType): string {
    switch (role) {
      case "teacher":
        return "Du bist der Lehrer. Nutze den Aufzug und erwische Schueler in der Naehe.";
      case "student_with_key":
        return "Du bist Schueler mit Schluessel. Erledige Aufgaben und nutze den Aufzug.";
      case "student":
      default:
        return "Du bist Schueler. Erledige Aufgaben und finde Hinweise.";
    }
  }

  private meetingSourceToGerman(source: string): string {
    if (source === "evidence") {
      return "Hinweis";
    }

    if (source === "button") {
      return "Notfallknopf";
    }

    return "Unbekannt";
  }

  private phaseToGerman(phase: GamePhase): string {
    switch (phase) {
      case "lobby":
        return "Lobby";
      case "playing":
        return "Spiel";
      case "meeting":
        return "Besprechung";
      case "voting":
        return "Abstimmung";
      case "ended":
        return "Beendet";
      default:
        return "Unbekannt";
    }
  }
}

function createAvatar(scene: MainScene, config: AvatarConfig): AvatarParts {
  const shadow = scene.add.ellipse(0, 21, 32, 14, 0x081117, 0.28);
  const ghostAura = scene.add.ellipse(0, 2, 54, 64, 0x86eeff, 0.2);
  ghostAura.setVisible(false);

  const backpack = scene.add.ellipse(0, 0, 12, 20, 0x000000, 1);
  backpack.setPosition(-15, 5);

  const body = scene.add.ellipse(0, 0, 38, 44, 0xffffff, 1);
  body.setStrokeStyle(
    config.isLocal ? 4 : 2,
    config.isLocal ? 0xffffff : 0x081117,
    0.9,
  );

  const visor = scene.add.ellipse(9, -8, 18, 12, 0xdbf3ff, 1);
  visor.setStrokeStyle(2, 0x87a8bb, 0.8);

  const label = scene.add
    .text(0, -40, config.name, {
      fontFamily: "monospace",
      fontSize: "14px",
      color: "#f5f7fa",
      stroke: "#0f151a",
      strokeThickness: 4,
    })
    .setOrigin(0.5);

  const container = scene.add.container(0, 0, [
    shadow,
    ghostAura,
    backpack,
    body,
    visor,
    label,
  ]);

  applyAvatarColor({ body, backpack }, config.color);

  return {
    body,
    backpack,
    container,
    ghostAura,
    isAlive: true,
    label,
    levelId: DEFAULT_LEVEL_ID,
    ownerSessionId: "",
    serverX: 0,
    serverY: 0,
    unbind: [],
  };
}

function getLevelById(levelId: string) {
  const level = LEVELS_BY_ID.get(levelId);

  if (level) {
    return level;
  }

  const fallback = LEVELS[0];

  if (!fallback) {
    throw new Error("No levels are configured.");
  }

  return fallback;
}

function hexToNumber(hexColor: string): number {
  return Phaser.Display.Color.HexStringToColor(hexColor).color;
}

function applyAvatarColor(
  avatar: Pick<AvatarParts, "body" | "backpack">,
  color: string,
): void {
  const baseColor = Phaser.Display.Color.HexStringToColor(color).color;
  avatar.body.setFillStyle(baseColor, 1);
  avatar.backpack.setFillStyle(darken(baseColor, 0.35), 1);
}

function darken(color: number, amount: number): number {
  const rgb = Phaser.Display.Color.IntegerToColor(color);
  return Phaser.Display.Color.GetColor(
    Math.floor(rgb.red * (1 - amount)),
    Math.floor(rgb.green * (1 - amount)),
    Math.floor(rgb.blue * (1 - amount)),
  );
}

function lightenColor(color: number, amount: number): number {
  const rgb = Phaser.Display.Color.IntegerToColor(color);
  return Phaser.Display.Color.GetColor(
    Math.floor(rgb.red + (255 - rgb.red) * amount),
    Math.floor(rgb.green + (255 - rgb.green) * amount),
    Math.floor(rgb.blue + (255 - rgb.blue) * amount),
  );
}

function sameInput(a: MovementInput, b: MovementInput): boolean {
  return (
    a.left === b.left &&
    a.right === b.right &&
    a.up === b.up &&
    a.down === b.down
  );
}

function buildPlayerName(): string {
  return `Crew ${Math.floor(Math.random() * 900 + 100)}`;
}

function resolveLobbyCode(): string {
  const params = new URLSearchParams(window.location.search);
  const fromUrl = sanitizeLobbyCode(params.get("code"));

  if (fromUrl) {
    return fromUrl;
  }

  const generated = generateLobbyCode();
  setLobbyCodeInUrl(generated);
  return generated;
}

function sanitizeLobbyCode(rawCode: unknown): string {
  const normalized = String(rawCode ?? "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 8);

  if (normalized.length < 4) {
    return "";
  }

  return normalized;
}

function generateLobbyCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let result = "";

  for (let index = 0; index < 6; index += 1) {
    const charIndex = Math.floor(Math.random() * alphabet.length);
    result += alphabet[charIndex] ?? "A";
  }

  return result;
}

function setLobbyCodeInUrl(lobbyCode: string): void {
  const params = new URLSearchParams(window.location.search);
  params.set("code", lobbyCode);

  const query = params.toString();
  const nextUrl = query ? `${window.location.pathname}?${query}` : window.location.pathname;
  window.history.replaceState(null, "", nextUrl);
}

function resolveServerUrl(): string {
  const { origin, hostname, protocol, port } = window.location;

  if (port === "5173" || port === "4173") {
    return `${protocol}//${hostname}:2567`;
  }

  return origin;
}

function requireElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);

  if (!element) {
    throw new Error(`Missing required element: ${selector}`);
  }

  return element;
}

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

new Phaser.Game({
  type: Phaser.AUTO,
  parent: "game-root",
  backgroundColor: "#162028",
  width: VIEWPORT_WIDTH,
  height: VIEWPORT_HEIGHT,
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  scene: MainScene,
});
