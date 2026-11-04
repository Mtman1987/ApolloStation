import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createSpmtService } from "../apps/spmt-service/dist/index.js";

test("SPMT service exposes lightweight live/readiness and rejects malformed JSON", async () => {
  const dir=mkdtempSync(join(tmpdir(),"spmt-service-")); const service=createSpmtService({ databasePath:join(dir,"spmt.db"), webhookKey:Buffer.alloc(32,7), port:0, host:"127.0.0.1", buildSha:"test-sha" });
  try { await service.listen(); const address=service.server.address(); assert.ok(address && typeof address!=="string"); const base=`http://127.0.0.1:${address.port}`; const live=await fetch(`${base}/health/live`); assert.equal(live.status,200); assert.equal((await live.json()).live,true); const ready=await fetch(`${base}/health/ready`); assert.equal(ready.status,200); const body=await ready.json(); assert.equal(body.storage.ready,true); assert.equal(body.storage.journalMode,"wal"); const bad=await fetch(`${base}/v1/events`,{method:"POST",headers:{"content-type":"application/json"},body:"{"}); assert.equal(bad.status,400); }
  finally { await service.close(); rmSync(dir,{recursive:true,force:true}); }
});

test("personal usage is derived from the signed-in user and cannot be queried for another member", async () => {
  const dir = mkdtempSync(join(tmpdir(), "spmt-usage-http-"));
  const service = createSpmtService({ databasePath: join(dir, "spmt.db"), webhookKey: Buffer.alloc(32, 8), port: 0, host: "127.0.0.1" });
  try {
    await service.listen();
    const address = service.server.address();
    assert.ok(address && typeof address !== "string");
    const base = `http://127.0.0.1:${address.port}`;
    const registered = await fetch(`${base}/v1/auth/register`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "usage-a", displayName: "Usage A", password: "correct-horse-battery-staple" }) });
    assert.equal(registered.status, 201);
    const account = await registered.json();
    const tenantId = account.tenantId, userA = account.profile.userId, userB = "usage-user-b";
    service.data.registerUser({ userId: userB, username: "usage-b", displayName: "Usage B", password: "correct-horse-battery-staple", tenantIds: [tenantId] });
    service.billing.consume({ tenantId, userId: userA, planId: "free", resource: "ai-chat-requests", quantity: 5, executionTarget: "hosted", idempotencyKey: "usage-a-chat" });
    service.billing.consume({ tenantId, userId: userB, planId: "free", resource: "ai-chat-requests", quantity: 12, executionTarget: "hosted", idempotencyKey: "usage-b-chat" });
    const login = await fetch(`${base}/v1/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "usage-a", password: "correct-horse-battery-staple" }) });
    const session = await login.json();
    const response = await fetch(`${base}/v1/usage/me?userId=${encodeURIComponent(userB)}`, { headers: { authorization: `Bearer ${session.tokens.accessToken}`, "x-spmt-tenant": tenantId } });
    assert.equal(response.status, 200);
    const summary = await response.json();
    assert.equal(summary.userId, userA);
    assert.equal(summary.resources.find((item) => item.resource === "ai-chat-requests").hosted, 5);
    assert.equal(summary.resources.find((item) => item.resource === "ai-chat-requests").percent, 20);
  } finally { await service.close(); rmSync(dir, { recursive: true, force: true }); }
});
