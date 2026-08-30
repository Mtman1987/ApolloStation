import assert from "node:assert/strict";
import { once } from "node:events";
import http from "node:http";
import https from "node:https";
import test from "node:test";

await import("../scripts/offline-network-guard.mjs");

test("offline guard blocks external requests before a socket is opened", async () => {
  assert.throws(() => fetch("https://example.com/apollo-should-never-leave"), /OFFLINE_NETWORK_BLOCKED/);
  assert.throws(() => httpsRequest(), /OFFLINE_NETWORK_BLOCKED/);
});

test("offline guard permits loopback-only sandbox traffic", async () => {
  const server = http.createServer((_request, response) => response.end("local-only"));
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("loopback server did not bind");
    const response = await fetch(`http://127.0.0.1:${address.port}/health`);
    assert.equal(await response.text(), "local-only");
  } finally {
    server.close();
    await once(server, "close");
  }
});

function httpsRequest() {
  return https.get("https://example.com/apollo-should-never-leave");
}
