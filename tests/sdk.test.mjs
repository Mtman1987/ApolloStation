import test from "node:test";
import assert from "node:assert/strict";
import { SpmtClient } from "../packages/sdk/dist/index.js";

test("SDK uses documented app/tenant/correlation headers and bearer auth", async () => {
  const seen = [];
  const fetchImpl = async (url, init) => {
    seen.push({ url, init });
    return new Response(JSON.stringify({ eventId: "evt-1" }), { status: 200, headers: { "content-type": "application/json" } });
  };
  const client = new SpmtClient({
    baseUrl: "https://green.spmt.test/",
    appId: "reference-app",
    fetchImpl,
    getAccessToken: () => "test-token",
  });

  const result = await client.publishEvent("tenant-1", "reference.ready", { ready: true }, "idem-1");
  assert.equal(result.eventId, "evt-1");
  assert.equal(seen.length, 1);
  const call = seen[0];
  assert.equal(call.url, "https://green.spmt.test/v1/events");
  const headers = new Headers(call.init.headers);
  assert.equal(headers.get("x-spmt-app"), "reference-app");
  assert.equal(headers.get("x-spmt-tenant"), "tenant-1");
  assert.equal(headers.get("authorization"), "Bearer test-token");
  assert.equal(headers.get("idempotency-key"), "idem-1");
});
