import { readFile } from "node:fs/promises";
import { createApp, loadConfig } from "../src/app.js";
const { pool } = createApp(loadConfig());
try {
  const result = await pool.query("SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='interview_recordings'");
  const names = result.rows.map(row => row.column_name);
  console.log(JSON.stringify({ recordingColumns: names, metadataCompatible: ["candidate_id", "recording_url", "status"].every(name => names.includes(name)) }));
  const migration = await readFile(new URL("../../supabase/migrations/20260929000000_interview_turn_idempotency.sql", import.meta.url), "utf8");
  await pool.query(migration);
  console.log("Interview turn ledger migration applied");
} catch (error) {
  console.error(JSON.stringify({ event: "INTERVIEW_SCHEMA_CHECK_FAILED", code: error.code || error.name, message: error.message.replace(/postgres(?:ql)?:\/\/[^\s]+/g, "[redacted]") }));
  process.exitCode = 1;
} finally { await pool.end(); }
