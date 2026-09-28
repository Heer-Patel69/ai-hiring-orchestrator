import { createApp, loadConfig } from "./app.js";

const config = loadConfig();
const { app, pool } = createApp(config);
const server = app.listen(config.port, "0.0.0.0", () => {
  console.log(JSON.stringify({ timestamp: new Date().toISOString(), level: "info", event: "SERVER_STARTED", host: "0.0.0.0", port: config.port }));
});

async function shutdown(signal) {
  console.log(JSON.stringify({ timestamp: new Date().toISOString(), level: "info", event: "SERVER_STOPPING", signal }));
  server.close(async () => {
    await pool.end();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 25_000).unref();
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
