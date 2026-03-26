import Phaser from "phaser";
import { Callbacks, Client } from "@colyseus/sdk";
import "./styles.css";
import {
  GRID_SIZE,
  ROOM_NAME,
  VIEWPORT_HEIGHT,
  VIEWPORT_WIDTH,
  WORLD_HEIGHT,
  WORLD_WIDTH,
} from "../shared/config.js";

const SERVER_URL = import.meta.env.VITE_SERVER_URL ?? "http://localhost:2567";

const connectionState = document.querySelector("#connection-state");
const playerCount = document.querySelector("#player-count");

class MainScene extends Phaser.Scene {
  constructor() {
    super("main");
    this.players = new Map();
    this.currentInput = {
      left: false,
      right: false,
      up: false,
      down: false,
    };
  }

  create() {
    this.cameras.main.setBackgroundColor("#162028");
    this.cameras.main.setBounds(0, 0, WORLD_WIDTH, WORLD_HEIGHT);

    this.drawBackdrop();
    this.setupKeyboard();
    this.setConnectionState(`Connecting to ${SERVER_URL}`);

    void this.connect();
  }

  drawBackdrop() {
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

  setupKeyboard() {
    this.cursors = this.input.keyboard.createCursorKeys();
    this.wasd = this.input.keyboard.addKeys({
      up: Phaser.Input.Keyboard.KeyCodes.W,
      left: Phaser.Input.Keyboard.KeyCodes.A,
      down: Phaser.Input.Keyboard.KeyCodes.S,
      right: Phaser.Input.Keyboard.KeyCodes.D,
    });
  }

  async connect() {
    try {
      this.client = new Client(SERVER_URL);
      this.room = await this.client.joinOrCreate(ROOM_NAME, {
        name: buildPlayerName(),
      });
      this.callbacks = Callbacks.get(this.room);
      this.sessionId = this.room.sessionId;

      this.registerStateCallbacks();
      this.registerRoomCallbacks();

      this.setConnectionState(`Connected to room ${this.room.roomId}`);

      window.addEventListener(
        "beforeunload",
        () => {
          this.room?.leave();
        },
        { once: true },
      );
    } catch (error) {
      this.setConnectionState(`Connection failed: ${error.message}`);
    }
  }

  registerRoomCallbacks() {
    this.room.onLeave((code) => {
      this.setConnectionState(`Disconnected (${code})`);
    });

    this.room.onError((code, message) => {
      this.setConnectionState(`Error ${code}: ${message}`);
    });
  }

  registerStateCallbacks() {
    this.callbacks.onAdd("boxes", (box) => {
      this.addBox(box);
    });

    this.callbacks.onAdd("players", (player, sessionId) => {
      this.addPlayer(player, sessionId);
    });

    this.callbacks.onRemove("players", (_player, sessionId) => {
      this.removePlayer(sessionId);
    });
  }

  addBox(box) {
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

  addPlayer(player, sessionId) {
    const avatar = createAvatar(this, {
      color: player.color,
      isLocal: sessionId === this.sessionId,
      name: player.name,
    });

    avatar.container.setPosition(player.x, player.y);
    avatar.serverX = player.x;
    avatar.serverY = player.y;
    avatar.unbind = [
      this.callbacks.listen(player, "x", (value) => {
        avatar.serverX = value;
      }),
      this.callbacks.listen(player, "y", (value) => {
        avatar.serverY = value;
      }),
      this.callbacks.listen(player, "name", (value) => {
        avatar.label.setText(value);
      }),
      this.callbacks.listen(player, "color", (value) => {
        applyAvatarColor(avatar, value);
      }),
    ];

    this.players.set(sessionId, avatar);
    this.updatePlayerCount();

    if (sessionId === this.sessionId) {
      this.cameras.main.startFollow(avatar.container, true, 0.12, 0.12);
    }
  }

  removePlayer(sessionId) {
    const avatar = this.players.get(sessionId);

    if (!avatar) {
      return;
    }

    avatar.unbind.forEach((unbind) => unbind?.());
    avatar.container.destroy(true);
    this.players.delete(sessionId);
    this.updatePlayerCount();
  }

  update() {
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

  pushInput() {
    const nextInput = {
      left: this.cursors.left.isDown || this.wasd.left.isDown,
      right: this.cursors.right.isDown || this.wasd.right.isDown,
      up: this.cursors.up.isDown || this.wasd.up.isDown,
      down: this.cursors.down.isDown || this.wasd.down.isDown,
    };

    if (sameInput(this.currentInput, nextInput)) {
      return;
    }

    this.currentInput = nextInput;
    this.room.send("input", nextInput);
  }

  setConnectionState(text) {
    connectionState.textContent = text;
  }

  updatePlayerCount() {
    playerCount.textContent = `${this.players.size} players`;
  }
}

function createAvatar(scene, config) {
  const shadow = scene.add.ellipse(0, 21, 32, 14, 0x081117, 0.28);
  const backpack = scene.add.ellipse(0, 0, 12, 20, 0x000000, 1);
  backpack.setPosition(-15, 5);

  const body = scene.add.ellipse(0, 0, 38, 44, 0xffffff, 1);
  body.setStrokeStyle(config.isLocal ? 4 : 2, config.isLocal ? 0xffffff : 0x081117, 0.9);

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

function applyAvatarColor(avatar, color) {
  const baseColor = Phaser.Display.Color.HexStringToColor(color).color;
  avatar.body.setFillStyle(baseColor, 1);
  avatar.backpack.setFillStyle(darken(baseColor, 0.35), 1);
}

function darken(color, amount) {
  const rgb = Phaser.Display.Color.IntegerToColor(color);
  return Phaser.Display.Color.GetColor(
    Math.floor(rgb.red * (1 - amount)),
    Math.floor(rgb.green * (1 - amount)),
    Math.floor(rgb.blue * (1 - amount)),
  );
}

function sameInput(a, b) {
  return (
    a.left === b.left &&
    a.right === b.right &&
    a.up === b.up &&
    a.down === b.down
  );
}

function buildPlayerName() {
  return `Crew ${Math.floor(Math.random() * 900 + 100)}`;
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
