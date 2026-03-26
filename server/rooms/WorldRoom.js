import { Room } from "colyseus";
import {
  BOX_COUNT,
  BOX_MAX_SIZE,
  BOX_MIN_SIZE,
  BOX_PADDING,
  MAX_CLIENTS,
  PLAYER_COLORS,
  PLAYER_RADIUS,
  PLAYER_SPEED,
  WORLD_HEIGHT,
  WORLD_WIDTH,
} from "../../shared/config.js";
import { BoxState, PlayerState, WorldState } from "../state.js";

const EMPTY_INPUT = Object.freeze({
  left: false,
  right: false,
  up: false,
  down: false,
});

export class WorldRoom extends Room {
  maxClients = MAX_CLIENTS;
  patchRate = 50;
  state = new WorldState();
  inputs = new Map();

  onCreate() {
    this.state.width = WORLD_WIDTH;
    this.state.height = WORLD_HEIGHT;

    this.generateBoxes();

    this.onMessage("input", (client, payload) => {
      this.inputs.set(client.sessionId, sanitizeInput(payload));
    });

    this.setSimulationInterval((deltaTime) => {
      this.updatePlayers(deltaTime);
    });
  }

  onJoin(client, options = {}) {
    const player = new PlayerState();
    const spawn = this.findSpawnPoint();

    player.name = sanitizeName(options.name, this.state.players.size + 1);
    player.color = PLAYER_COLORS[this.state.players.size % PLAYER_COLORS.length];
    player.x = spawn.x;
    player.y = spawn.y;

    this.state.players.set(client.sessionId, player);
    this.inputs.set(client.sessionId, EMPTY_INPUT);
  }

  onLeave(client) {
    this.state.players.delete(client.sessionId);
    this.inputs.delete(client.sessionId);
  }

  generateBoxes() {
    for (let index = 0; index < BOX_COUNT; index += 1) {
      const box = this.findBoxPlacement();

      if (!box) {
        continue;
      }

      const entity = new BoxState();
      entity.x = box.x;
      entity.y = box.y;
      entity.width = box.width;
      entity.height = box.height;

      this.state.boxes.push(entity);
    }
  }

  findBoxPlacement() {
    for (let attempt = 0; attempt < 80; attempt += 1) {
      const width = randomInt(BOX_MIN_SIZE, BOX_MAX_SIZE);
      const height = randomInt(BOX_MIN_SIZE, BOX_MAX_SIZE);
      const x = randomInt(120, WORLD_WIDTH - width - 120);
      const y = randomInt(120, WORLD_HEIGHT - height - 120);

      const overlapsSpawnLane =
        x < 280 && y < 280;

      if (overlapsSpawnLane) {
        continue;
      }

      const overlapsExisting = this.state.boxes.some((box) =>
        rectsOverlapWithPadding(
          x,
          y,
          width,
          height,
          box.x,
          box.y,
          box.width,
          box.height,
          BOX_PADDING,
        ),
      );

      if (!overlapsExisting) {
        return { x, y, width, height };
      }
    }
  }

  findSpawnPoint() {
    for (let attempt = 0; attempt < 120; attempt += 1) {
      const x = randomInt(PLAYER_RADIUS + 48, WORLD_WIDTH - PLAYER_RADIUS - 48);
      const y = randomInt(PLAYER_RADIUS + 48, WORLD_HEIGHT - PLAYER_RADIUS - 48);

      if (this.overlapsAnyBox(x, y)) {
        continue;
      }

      const overlapsPlayer = Array.from(this.state.players.values()).some(
        (player) => Math.hypot(player.x - x, player.y - y) < PLAYER_RADIUS * 3,
      );

      if (!overlapsPlayer) {
        return { x, y };
      }
    }

    return { x: 160, y: 160 };
  }

  updatePlayers(deltaTime) {
    const distance = PLAYER_SPEED * (deltaTime / 1000);

    this.state.players.forEach((player, sessionId) => {
      const input = this.inputs.get(sessionId) ?? EMPTY_INPUT;
      let dx = Number(input.right) - Number(input.left);
      let dy = Number(input.down) - Number(input.up);

      if (dx !== 0 || dy !== 0) {
        const length = Math.hypot(dx, dy);
        dx = (dx / length) * distance;
        dy = (dy / length) * distance;
      }

      const nextX = clamp(player.x + dx, PLAYER_RADIUS, WORLD_WIDTH - PLAYER_RADIUS);
      if (!this.overlapsAnyBox(nextX, player.y)) {
        player.x = nextX;
      }

      const nextY = clamp(player.y + dy, PLAYER_RADIUS, WORLD_HEIGHT - PLAYER_RADIUS);
      if (!this.overlapsAnyBox(player.x, nextY)) {
        player.y = nextY;
      }
    });
  }

  overlapsAnyBox(x, y) {
    const left = x - PLAYER_RADIUS;
    const right = x + PLAYER_RADIUS;
    const top = y - PLAYER_RADIUS;
    const bottom = y + PLAYER_RADIUS;

    return this.state.boxes.some((box) => {
      return (
        right > box.x &&
        left < box.x + box.width &&
        bottom > box.y &&
        top < box.y + box.height
      );
    });
  }
}

function sanitizeInput(payload) {
  return {
    left: Boolean(payload?.left),
    right: Boolean(payload?.right),
    up: Boolean(payload?.up),
    down: Boolean(payload?.down),
  };
}

function sanitizeName(rawName, playerNumber) {
  const trimmed = String(rawName ?? "").trim().slice(0, 14);
  return trimmed || `Player ${playerNumber}`;
}

function rectsOverlapWithPadding(ax, ay, aw, ah, bx, by, bw, bh, padding) {
  return (
    ax - padding < bx + bw &&
    ax + aw + padding > bx &&
    ay - padding < by + bh &&
    ay + ah + padding > by
  );
}

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}
