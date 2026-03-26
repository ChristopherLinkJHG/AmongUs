import server from "./app.config.ts";

const host = process.env.HOST ?? "0.0.0.0";
const port = Number(process.env.PORT ?? 2567);

server
  .listen(port, host)
  .then(() => {
    console.log(`Colyseus server listening on http://${host}:${port}`);
  })
  .catch((error: unknown) => {
    console.error("Failed to start Colyseus server", error);
    process.exit(1);
  });
