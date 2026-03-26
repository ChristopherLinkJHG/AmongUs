import server from "./app.config.js";

const host = process.env.HOST ?? "0.0.0.0";
const port = Number(process.env.PORT ?? 2567);

server.listen(port, host);

console.log(`Colyseus server listening on http://${host}:${port}`);
