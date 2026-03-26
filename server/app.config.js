import express from "express";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import cors from "cors";
import { defineRoom, defineServer } from "colyseus";
import { WorldRoom } from "./rooms/WorldRoom.js";

const serverDir = dirname(fileURLToPath(import.meta.url));
const distDir = resolve(serverDir, "../dist");
const distIndex = resolve(distDir, "index.html");

export const server = defineServer({
  rooms: {
    world: defineRoom(WorldRoom).sortBy({ clients: -1 }),
  },
  express: (app) => {
    app.use(cors());

    app.get("/health", (_req, res) => {
      res.json({ ok: true });
    });

    if (existsSync(distIndex)) {
      app.use(express.static(distDir));

      app.get(/^\/(?!matchmake(?:\/|$)|health(?:\/|$)).*/, (_req, res) => {
        res.sendFile(distIndex);
      });
    } else {
      app.get("/", (_req, res) => {
        res
          .status(503)
          .send("Frontend build not found. Run `npm run build` to generate dist/.");
      });
    }
  },
});

export default server;
