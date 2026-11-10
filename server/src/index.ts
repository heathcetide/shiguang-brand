import { createApp } from "./app.js";

const port = process.env.PORT || 9090;
const host = process.env.HOST?.trim() || "0.0.0.0";
const app = await createApp();

const server = app.listen(Number(port), host, () => {
  const address = server.address();
  const listeningPort = typeof address === "object" && address ? address.port : port;
  console.log(`Server listening at http://${host}:${listeningPort}/`);
});

let stopping = false;
async function stop(signal: string) {
  if (stopping) return;
  stopping = true;
  console.log(`Received ${signal}; shutting down`);
  server.close(async () => {
    await app.locals.closeRuntime?.();
  });
}
process.on("SIGINT", () => void stop("SIGINT"));
process.on("SIGTERM", () => void stop("SIGTERM"));
