import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createSpmtService } from "../dist/index.js";

test("production login never calls the retired SPMT identity service", async () => {
  const directory = mkdtempSync(join(tmpdir(), "apollo-local-login-only-"));
  let outboundCalls = 0;
  const service = createSpmtService({
    databasePath: join(directory, "spmt.sqlite"),
    webhookKey: Buffer.alloc(32, 41),
    host: "127.0.0.1",
    port: 0,
    runtimeMode: "production",
    fetchImpl: async () => {
      outboundCalls += 1;
      throw new Error("production Apollo login must not call a donor identity service");
    },
  });

  try {
    await service.listen();
    const address = service.server.address();
    assert.ok(address && typeof address === "object");
    const response = await fetch(`http://127.0.0.1:${address.port}/v1/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "mtman1987", password: "not-a-valid-local-password" }),
    });
    const body = await response.json();
    assert.equal(response.status, 401, JSON.stringify(body));
    assert.equal(body.error, "invalid_credentials");
    assert.equal(outboundCalls, 0, "no request may be sent to retired SPMT/Fly auth");
  } finally {
    await service.close().catch(() => undefined);
    rmSync(directory, { recursive: true, force: true });
  }
});
