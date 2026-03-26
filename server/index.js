import server from "./app.config.js";

const port = Number(process.env.PORT ?? 2567);

server.listen(port);

console.log(`Colyseus server listening on http://localhost:${port}`);
