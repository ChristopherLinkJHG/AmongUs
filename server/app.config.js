import cors from "cors";
import { defineRoom, defineServer } from "colyseus";
import { WorldRoom } from "./rooms/WorldRoom.js";

export const server = defineServer({
  rooms: {
    world: defineRoom(WorldRoom).sortBy({ clients: -1 }),
  },
  express: (app) => {
    app.use(cors());

    app.get("/health", (_req, res) => {
      res.json({ ok: true });
    });
  },
});

export default server;
