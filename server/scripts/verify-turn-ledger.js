import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createApp, loadConfig } from "../src/app.js";
import { claimTurn, finishTurn } from "../src/turn-store.js";
const { pool } = createApp(loadConfig());
const turnId = randomUUID(); let applicationId;
try {
  const app = await pool.query("SELECT id FROM applications LIMIT 1");
  applicationId = app.rows[0]?.id;
  if (!applicationId) throw new Error("No application exists to satisfy the test row's foreign key");
  const messages = [{ role: "user", content: "Isolated turn-ledger integration test" }];
  const claims = await Promise.allSettled([claimTurn(pool, applicationId, turnId, messages), claimTurn(pool, applicationId, turnId, messages)]);
  assert.equal(claims.filter(c => c.status === "fulfilled").length, 1);
  assert.equal(claims.find(c => c.status === "rejected").reason.status, 409);
  await finishTurn(pool, applicationId, turnId, "complete", "data: stored integration test result\n\n");
  assert.deepEqual(await claimTurn(pool, applicationId, turnId, messages), { claimed: false, response: "data: stored integration test result\n\n" });
  await assert.rejects(claimTurn(pool, applicationId, turnId, [{ role: "user", content: "Changed test payload" }]), { status: 409 });
  console.log("PostgreSQL verified: one concurrent claim, exact replay, changed-payload rejection");
} finally {
  // Delete only the generated test claim; no application, transcript or candidate data is changed.
  if (applicationId) await pool.query("DELETE FROM interview_turn_requests WHERE application_id=$1 AND turn_id=$2", [applicationId, turnId]);
  await pool.end();
}
