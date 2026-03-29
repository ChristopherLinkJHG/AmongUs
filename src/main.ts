import Phaser from "phaser";
import { Callbacks, Client, type Room } from "@colyseus/sdk";
import "./styles.css";
import {
  GRID_SIZE,
  ROOM_NAME,
  VIEWPORT_HEIGHT,
  VIEWPORT_WIDTH,
} from "../shared/config.ts";
import {
  DEFAULT_LEVEL_ID,
  LEVELS,
  LEVELS_BY_ID,
  type LevelPortal,
} from "../shared/levels.ts";
import type {
  JoinOptions,
  LevelSwitchRequest,
  MovementInput,
} from "../shared/protocol.ts";
import type { BoxState, PlayerState, WorldState } from "../server/state.ts";

const SERVER_URL = resolveServerUrl();

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

interface AvatarConfig {
  color: string;
  isLocal: boolean;
  name: string;
}

interface AvatarParts {
  body: Phaser.GameObjects.Ellipse;
  backpack: Phaser.GameObjects.Ellipse;
  container: Phaser.GameObjects.Container;
  label: Phaser.GameObjects.Text;
  levelId: string;
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

function getRoomCallbacks(room: Room<any, WorldState>) {
  return Callbacks.get(room);
}

type RoomCallbacks = ReturnType<typeof getRoomCallbacks>;

class MainScene extends Phaser.Scene {
  private readonly players = new Map<string, AvatarParts>();
  private readonly boxes: BoxParts[] = [];
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

  constructor() {
    super("main");
  }

  create(): void {
    const initialLevel = getLevelById(this.localLevelId);

    this.cameras.main.setBackgroundColor(initialLevel.backgroundColor);
    this.cameras.main.setBounds(0, 0, initialLevel.width, initialLevel.height);

    this.drawBackdrops();
    this.drawPortals();
    this.setupKeyboard();

    void this.connect();
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
  }

  private async connect(): Promise<void> {
    try {
      this.client = new Client(SERVER_URL);
      this.room = await this.client.joinOrCreate<WorldState>(ROOM_NAME, {
        name: buildPlayerName(),
      } satisfies JoinOptions);
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
    } catch (error: unknown) {
      console.error(`Connection failed: ${formatError(error)}`);
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

    callbacks.onAdd("boxes", (box) => {
      this.addBox(box);
    });

    callbacks.onAdd("players", (player, sessionId) => {
      this.addPlayer(player, sessionId);
    });

    callbacks.onRemove("players", (_player, sessionId) => {
      this.removePlayer(sessionId);
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
      }),
      callbacks.listen(player, "color", (value) => {
        applyAvatarColor(avatar, value);
      }),
      callbacks.listen(player, "levelId", (value) => {
        avatar.levelId = value;
        this.updateAvatarVisibility(avatar);

        if (sessionId === this.sessionId) {
          this.applyLocalLevel(value);
        }
      }),
    ];

    this.updateAvatarVisibility(avatar);
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

    if (Phaser.Input.Keyboard.JustDown(this.levelSwitchKeys.previous)) {
      this.room.send<LevelSwitchRequest>("switch-level", { direction: -1 });
    }

    if (Phaser.Input.Keyboard.JustDown(this.levelSwitchKeys.next)) {
      this.room.send<LevelSwitchRequest>("switch-level", { direction: 1 });
    }
  }

  private updateAvatarVisibility(avatar: AvatarParts): void {
    avatar.container.setVisible(avatar.levelId === this.localLevelId);
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

    for (const avatar of this.players.values()) {
      this.updateAvatarVisibility(avatar);
    }
  }

  private pushInput(): void {
    if (!this.room) {
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
}

function createAvatar(scene: MainScene, config: AvatarConfig): AvatarParts {
  const shadow = scene.add.ellipse(0, 21, 32, 14, 0x081117, 0.28);
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
    label,
    levelId: DEFAULT_LEVEL_ID,
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

function resolveServerUrl(): string {
  const { origin, hostname, protocol, port } = window.location;

  if (port === "5173" || port === "4173") {
    return `${protocol}//${hostname}:2567`;
  }

  return origin;
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
