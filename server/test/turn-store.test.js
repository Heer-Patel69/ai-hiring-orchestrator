import assert from "node:assert/strict";
import test from "node:test";
import { claimTurn, finishTurn } from "../src/turn-store.js";

function database() {
  const rows = new Map();
  return { rows, async query(sql, params) {
    const key = `${params[0]}:${params[1]}`;
    if (sql.startsWith("INSERT")) {
      if (rows.has(key)) return { rowCount:0, rows:[] };
      rows.set(key, { request_hash: params[2], status:"processing", response_sse:null });
      return { rowCount:1, rows:[{ turn_id:params[1] }] };
    }
    if (sql.startsWith("SELECT")) return { rows:[rows.get(key)] };
    Object.assign(rows.get(key), { status: params[2], response_sse: params[3] }); return { rowCount:1 };
  } };
}
test("simultaneous requests claim one generation and later duplicates replay the saved response", async () => {
  const db=database(), messages=[{ role:"user", content:"Redis" }];
  const result=await Promise.allSettled([claimTurn(db,"app","turn",messages), claimTurn(db,"app","turn",messages)]);
  assert.equal(result.filter(r => r.status==="fulfilled").length,1);
  assert.equal(result.filter(r => r.status==="rejected")[0].reason.status,409);
  await finishTurn(db,"app","turn","complete","data: real saved response\n\n");
  assert.deepEqual(await claimTurn(db,"app","turn",messages), { claimed:false, response:"data: real saved response\n\n" });
});
test("a reused ID with changed content is rejected; failures never regenerate silently", async () => {
  const db=database(); await claimTurn(db,"app","turn",[{ role:"user", content:"first" }]);
  await assert.rejects(claimTurn(db,"app","turn",[{ role:"user", content:"changed" }]), { status:409 });
  await finishTurn(db,"app","turn","failed");
  await assert.rejects(claimTurn(db,"app","turn",[{ role:"user", content:"first" }]), { status:409 });
});
