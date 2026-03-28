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
import type {
  JoinOptions,
  LevelSwitchRequest,
  MovementInput,
} from "../../shared/protocol.ts";
import { BoxState, PlayerState, WorldState } from "../state.ts";

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

export class WorldRoom extends Room<{ state: WorldState }> {
  maxClients = MAX_CLIENTS;
  patchRate = 50;
  state = new WorldState();
  private readonly inputs = new Map<string, Readonly<MovementInput>>();
  private readonly portalCooldownUntil = new Map<string, number>();
  private readonly portalTouchLock = new Set<string>();

  onCreate(): void {
    this.state.width = MAX_LEVEL_WIDTH;
    this.state.height = MAX_LEVEL_HEIGHT;

    this.seedBoxes();

    this.onMessage("input", (client, payload) => {
      this.inputs.set(client.sessionId, sanitizeInput(payload));
    });

    this.onMessage("switch-level", (client, payload) => {
      this.switchPlayerLevel(client.sessionId, payload);
    });

    this.setSimulationInterval((deltaTime) => {
      this.updatePlayers(deltaTime);
    });
  }

  onJoin(client: Client, options: JoinOptions = {}): void {
    const player = new PlayerState();
    const spawn = this.findSpawnPoint(DEFAULT_LEVEL_ID);

    player.name = sanitizeName(options.name, this.state.players.size + 1);
    player.color = PLAYER_COLORS[this.state.players.size % PLAYER_COLORS.length];
    player.levelId = DEFAULT_LEVEL_ID;
    player.x = spawn.x;
    player.y = spawn.y;

    this.state.players.set(client.sessionId, player);
    this.inputs.set(client.sessionId, EMPTY_INPUT);
  }

  onLeave(client: Client): void {
    this.state.players.delete(client.sessionId);
    this.inputs.delete(client.sessionId);
    this.portalCooldownUntil.delete(client.sessionId);
    this.portalTouchLock.delete(client.sessionId);
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
      if (!this.overlapsAnyBox(nextX, player.y, level.id)) {
        player.x = nextX;
      }

      const nextY = clamp(
        player.y + dy,
        PLAYER_RADIUS,
        level.height - PLAYER_RADIUS,
      );
      if (!this.overlapsAnyBox(player.x, nextY, level.id)) {
        player.y = nextY;
      }

      this.tryUsePortal(player, sessionId);
    });
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

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
