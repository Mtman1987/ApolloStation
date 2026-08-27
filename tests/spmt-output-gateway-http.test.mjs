import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { createSpmtOutputGateway } from "../apps/spmt-service/dist/output-gateway.js";

function listen(server) { return new Promise((done, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", () => { server.off("error", reject); done(); }); }); }
function close(server) { return new Promise((done, reject) => server.close((error) => error ? reject(error) : done())); }
function origin(server) { const address = server.address(); assert.ok(address && typeof address !== "string"); return `http://127.0.0.1:${address.port}`; }

test("SPMT output gateway resolves opaque grants and injects verified renderer principal", async () => {
  let rendererHeaders = {};
  const renderer = createServer((request, response) => {
    rendererHeaders = request.headers;
    const body = Buffer.from("<main>overlay-rendered</main>");
    response.writeHead(200, { "content-type": "text/html; charset=utf-8", "content-length": body.length });
    response.end(body);
  });
  await listen(renderer);
  const inner = createServer((request, response) => { response.writeHead(200, { "content-type": "application/json" }); response.end(JSON.stringify({ path: request.url })); });
  const control = {
    resolveOverlayOutputToken(token) {
      assert.equal(token, "abcdefghijklmnop");
      return { schemaVersion: 1, principal: { schemaVersion: 1, grantId: "grant-a", tenantId: "tenant-a", appId: "nebula-arcade", widgetId: "game-mix:night", viewerUserId: "viewer-a" }, rendererUrl: `${origin(renderer)}/overlay` };
    },
  };
  const service = { server: inner, control, async close() { if (inner.listening) await close(inner); } };
  const gateway = createSpmtOutputGateway(service, { port: 0, host: "127.0.0.1" });
  try {
    await gateway.listen();
    const gatewayOrigin = origin(gateway.server);
    const api = await fetch(`${gatewayOrigin}/health/ready`);
    assert.equal(api.status, 200);
    assert.deepEqual(await api.json(), { path: "/health/ready" });
    const output = await fetch(`${gatewayOrigin}/o/abcdefghijklmnop`);
    assert.equal(output.status, 200);
    assert.match(await output.text(), /overlay-rendered/);
    assert.equal(rendererHeaders["x-spmt-overlay-grant"], "grant-a");
    assert.equal(rendererHeaders["x-spmt-overlay-tenant"], "tenant-a");
    assert.equal(rendererHeaders["x-spmt-overlay-app"], "nebula-arcade");
    assert.equal(rendererHeaders["x-spmt-overlay-widget"], "game-mix:night");
    assert.equal(rendererHeaders["x-spmt-overlay-viewer"], "viewer-a");
  } finally {
    await gateway.close();
    await close(renderer);
  }
});

test("SPMT output gateway returns an inert transparent 404 for invalid or revoked grants", async () => {
  const inner = createServer((_request, response) => { response.writeHead(404); response.end(); });
  const service = { server: inner, control: { resolveOverlayOutputToken() { throw new Error("revoked"); } }, async close() { if (inner.listening) await close(inner); } };
  const gateway = createSpmtOutputGateway(service, { port: 0, host: "127.0.0.1" });
  try {
    await gateway.listen();
    const response = await fetch(`${origin(gateway.server)}/o/abcdefghijklmnop`);
    assert.equal(response.status, 404);
    assert.match(await response.text(), /Overlay unavailable/);
  } finally { await gateway.close(); }
});
