import assert from "node:assert/strict";
import test from "node:test";
import { createApp } from "../src/app.js";

test("health endpoint returns a safe liveness response", async (t) => {
  const config = {
    appEnv: "test",
    port: 0,
    allowedOrigins: new Set(["http://localhost:5173"]),
    databaseUrl: "postgresql://test:test@127.0.0.1:1/test?sslmode=disable",
    dbPoolMax: 1,
    supabaseUrl: "https://example.supabase.co",
    supabasePublishableKey: "sb_publishable_test",
    supabaseSecretKey: "sb_secret_test",
    groqKeys: [],
    groqModel: "test-model",
    groqBaseUrl: "https://api.groq.com/openai/v1",
    bhashiniUserId: "",
    bhashiniApiKey: "",
    bhashiniPipelineId: "test",
  };
  const { app, pool } = createApp(config);
  const server = app.listen(0, "127.0.0.1");
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await pool.end();
  });
  await new Promise((resolve) => server.once("listening", resolve));
  const address = server.address();
  const response = await fetch(`http://127.0.0.1:${address.port}/health`);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.status, "ok");
  assert.equal(body.database, "configured");
  assert.equal("secret" in body, false);
});
