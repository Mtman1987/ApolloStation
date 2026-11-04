import assert from "node:assert/strict";
import test from "node:test";
import { createNebulaArcadeLiveHost } from "../apps/nebula-arcade/dist/nebula-arcade-live-server.js";

const base = {
  databasePath: "/tmp/nebula-live-origin-validation.sqlite",
  tenantId: "tenant-test",
  channelId: "channel-test",
  publicOrigin: "https://nebula.example.test",
  credential: "x".repeat(32),
};

test("Nebula production service rejects insecure or non-origin SPMT URLs before opening state", () => {
  assert.throws(() => createNebulaArcadeLiveHost({ ...base, spmtOrigin: "http://spmt.example.test" }), /credential-free HTTPS origin or loopback HTTP origin/);
  assert.throws(() => createNebulaArcadeLiveHost({ ...base, spmtOrigin: "https://user:password@spmt.example.test" }), /credential-free HTTPS origin or loopback HTTP origin/);
  assert.throws(() => createNebulaArcadeLiveHost({ ...base, spmtOrigin: "https://spmt.example.test/v1" }), /credential-free HTTPS origin or loopback HTTP origin/);
});
