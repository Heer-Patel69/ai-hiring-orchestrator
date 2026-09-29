import { createHash } from "node:crypto";

export async function claimTurn(pool, applicationId, turnId, messages) {
  const hash = createHash("sha256").update(JSON.stringify(messages)).digest("hex");
  const claimed = await pool.query(
    "INSERT INTO interview_turn_requests(application_id,turn_id,request_hash) VALUES($1,$2,$3) ON CONFLICT DO NOTHING RETURNING turn_id",
    [applicationId, turnId, hash],
  );
  if (claimed.rowCount) return { claimed: true };
  const existing = await pool.query("SELECT request_hash,status,response_sse FROM interview_turn_requests WHERE application_id=$1 AND turn_id=$2", [applicationId, turnId]);
  const row = existing.rows[0];
  if (row?.request_hash !== hash) throw Object.assign(new Error("This turn ID was already used for another answer"), { status: 409 });
  if (row.status === "complete") return { claimed: false, response: row.response_sse };
  throw Object.assign(new Error(row.status === "processing" ? "This answer is already being processed" : "This turn failed. Submit a new turn to retry"), { status: 409 });
}

export async function finishTurn(pool, applicationId, turnId, status, response = null) {
  await pool.query("UPDATE interview_turn_requests SET status=$3,response_sse=$4,completed_at=now() WHERE application_id=$1 AND turn_id=$2", [applicationId, turnId, status, response]);
}
