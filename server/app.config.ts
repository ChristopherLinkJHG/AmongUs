import express from "express";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import cors from "cors";
import { defineRoom, defineServer } from "colyseus";
import { monitor } from "@colyseus/monitor";
import { WorldRoom } from "./rooms/WorldRoom.ts";
import { Encoder } from "@colyseus/schema";

Encoder.BUFFER_SIZE = 128 * 1024; // 128 KB

const serverDir = dirname(fileURLToPath(import.meta.url));
const distDir = resolve(serverDir, "../dist");
const distIndex = resolve(distDir, "index.html");

interface AppResponse {
  json(body: unknown): void;
  status(code: number): AppResponse;
  setHeader(name: string, value: string): void;
  send(body: string): void;
  sendFile(path: string): void;
}

type AppRequest = {
  headers?: Record<string, string | string[] | undefined>;
};

type Next = () => void;

const monitorUser = process.env.MONITOR_USER;
const monitorPass = process.env.MONITOR_PASS;

const requireMonitorAuth = (req: AppRequest, res: AppResponse, next: Next) => {
  if (!monitorUser || !monitorPass) {
    res.status(503).send("Monitor auth is not configured.");
    return;
  }

  const rawAuth = req.headers?.authorization;
  const authHeader = Array.isArray(rawAuth) ? rawAuth[0] : rawAuth;
  if (!authHeader || !authHeader.startsWith("Basic ")) {
    res.setHeader("WWW-Authenticate", "Basic realm=\"Colyseus Monitor\"");
    res.status(401).send("Authentication required.");
    return;
  }

  const encoded = authHeader.slice("Basic ".length).trim();
  const decoded = Buffer.from(encoded, "base64").toString("utf8");
  const [username, password] = decoded.split(":", 2);

  if (username !== monitorUser || password !== monitorPass) {
    res.status(403).send("Invalid credentials.");
    return;
  }

  next();
};

export const server = defineServer({
  rooms: {
    world: defineRoom(WorldRoom)
      .filterBy(["lobbyCode"])
      .sortBy({ clients: -1 }),
  },
  express: (app) => {
    app.use(cors());

    app.get("/health", (_req: unknown, res: AppResponse) => {
      res.json({ ok: true });
    });

    app.use("/colyseus", requireMonitorAuth, monitor());

    if (existsSync(distIndex)) {
      app.use(express.static(distDir));

      app.get(
        /^\/(?!matchmake(?:\/|$)|health(?:\/|$)|colyseus(?:\/|$)).*/,
        (_req: unknown, res: AppResponse) => {
          res.sendFile(distIndex);
        },
      );
    } else {
      app.get("/", (_req: unknown, res: AppResponse) => {
        res
          .status(503)
          .send("Frontend build not found. Run `npm run build` to generate dist/.");
      });
    }
  },
});

export default server;
