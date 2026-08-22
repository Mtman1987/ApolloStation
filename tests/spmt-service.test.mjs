import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createSpmtService } from "../apps/spmt-service/dist/index.js";

test("SPMT service exposes lightweight live/readiness and rejects malformed JSON", async () => {
  const dir=mkdtempSync(join(tmpdir(),"spmt-service-")); const service=createSpmtService({ databasePath:join(dir,"spmt.db"), port:0, host:"127.0.0.1", buildSha:"test-sha" });
  try { await service.listen(); const address=service.server.address(); assert.ok(address && typeof address!=="string"); const base=`http://127.0.0.1:${address.port}`; const live=await fetch(`${base}/health/live`); assert.equal(live.status,200); assert.equal((await live.json()).live,true); const ready=await fetch(`${base}/health/ready`); assert.equal(ready.status,200); const body=await ready.json(); assert.equal(body.storage.ready,true); assert.equal(body.storage.journalMode,"wal"); const bad=await fetch(`${base}/v1/events`,{method:"POST",headers:{"content-type":"application/json"},body:"{"}); assert.equal(bad.status,400); }
  finally { await service.close(); rmSync(dir,{recursive:true,force:true}); }
});
