import Phaser from "phaser";
import { Callbacks, Client, type Room } from "@colyseus/sdk";
import "./styles.css";
import {
  GRID_SIZE,
  ROOM_NAME,
  VIEWPORT_HEIGHT,
  VIEWPORT_WIDTH,
  WORLD_HEIGHT,
  WORLD_WIDTH,
} from "../shared/config.ts";
import type { JoinOptions, MovementInput } from "../shared/protocol.ts";
import type { BoxState, PlayerState, WorldState } from "../server/state.ts";

const SERVER_URL = resolveServerUrl();

const connectionState = requireElement<HTMLElement>("#connection-state");
const playerCount = requireElement<HTMLElement>("#player-count");

interface DirectionKeys {
  up: Phaser.Input.Keyboard.Key;
  left: Phaser.Input.Keyboard.Key;
  down: Phaser.Input.Keyboard.Key;
  right: Phaser.Input.Keyboard.Key;
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
  serverX: number;
  serverY: number;
  unbind: Array<() => void>;
}

function getRoomCallbacks(room: Room<any, WorldState>) {
  return Callbacks.get(room);
}

type RoomCallbacks = ReturnType<typeof getRoomCallbacks>;

class MainScene extends Phaser.Scene {
  private readonly players = new Map<string, AvatarParts>();
  private currentInput: MovementInput = {
    left: false,
    right: false,
    up: false,
    down: false,
  };
  private client?: Client;
  private room?: Room<any, WorldState>;
  private callbacks?: RoomCallbacks;
  private sessionId?: string;
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private wasd!: DirectionKeys;

  constructor() {
    super("main");
  }

  create(): void {
    this.cameras.main.setBackgroundColor("#162028");
    this.cameras.main.setBounds(0, 0, WORLD_WIDTH, WORLD_HEIGHT);

    this.drawBackdrop();
    this.setupKeyboard();
    this.setConnectionState(`Connecting to ${SERVER_URL}`);

    void this.connect();
  }

  private drawBackdrop(): void {
    const graphics = this.add.graphics();

    graphics.fillStyle(0x162028, 1);
    graphics.fillRect(0, 0, WORLD_WIDTH, WORLD_HEIGHT);

    graphics.lineStyle(1, 0x24343f, 0.55);
    for (let x = 0; x <= WORLD_WIDTH; x += GRID_SIZE) {
      graphics.lineBetween(x, 0, x, WORLD_HEIGHT);
    }

    for (let y = 0; y <= WORLD_HEIGHT; y += GRID_SIZE) {
      graphics.lineBetween(0, y, WORLD_WIDTH, y);
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

      this.setConnectionState(`Connected to room ${this.room.roomId}`);

      window.addEventListener(
        "beforeunload",
        () => {
          void this.room?.leave();
        },
        { once: true },
      );
    } catch (error: unknown) {
      this.setConnectionState(`Connection failed: ${formatError(error)}`);
    }
  }

  private registerRoomCallbacks(): void {
    if (!this.room) {
      return;
    }

    this.room.onLeave((code) => {
      this.setConnectionState(`Disconnected (${code})`);
    });

    this.room.onError((code, message) => {
      this.setConnectionState(`Error ${code}: ${message ?? "Unknown error"}`);
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
    const rectangle = this.add.rectangle(
      box.x + box.width / 2,
      box.y + box.height / 2,
      box.width,
      box.height,
      0x70808b,
      1,
    );

    rectangle.setStrokeStyle(3, 0xa9b6be, 0.8);
    rectangle.setDepth(rectangle.y - 1);
  }

  private addPlayer(player: PlayerState, sessionId: string): void {
    const callbacks = this.getCallbacks();
    const avatar = createAvatar(this, {
      color: player.color,
      isLocal: sessionId === this.sessionId,
      name: player.name,
    });

    avatar.container.setPosition(player.x, player.y);
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
    ];

    this.players.set(sessionId, avatar);
    this.updatePlayerCount();

    if (sessionId === this.sessionId) {
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
    this.updatePlayerCount();
  }

  update(): void {
    if (this.room) {
      this.pushInput();
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

  private setConnectionState(text: string): void {
    connectionState.textContent = text;
  }

  private updatePlayerCount(): void {
    playerCount.textContent = `${this.players.size} players`;
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
    serverX: 0,
    serverY: 0,
    unbind: [],
  };
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
