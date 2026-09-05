import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createSpmtOutputGateway } from "../apps/spmt-service/dist/output-gateway.js";

function listen(server) { return new Promise((done, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", () => { server.off("error", reject); done(); }); }); }
function close(server) { return new Promise((done, reject) => server.close((error) => error ? reject(error) : done())); }
function origin(server) { const address = server.address(); assert.ok(address && typeof address !== "string"); return `http://127.0.0.1:${address.port}`; }

test("Overlay Bay registration derives every app and renderer URL from the configured environment", () => {
  const source = readFileSync(new URL("../apps/spmt-service/src/output-gateway.ts", import.meta.url), "utf8");
  assert.match(source, /publicBaseUrl/);
  assert.match(source, /new URL\("\/\?view=workspace",publicBaseUrl\)/);
  assert.match(source, /new URL\(`\/_internal\/overlay-scene/);
  assert.doesNotMatch(source, /launchUrl:"https:\/\/spmt\.live\/overlay-bay"|rendererUrl:`https:\/\/spmt\.live/);
});

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

test("SPMT exposes stable Public and signed-in Personal tenant overlay outputs", async () => {
  const inner = createServer((_request, response) => { response.writeHead(404); response.end(); });
  const workspace = {
    activePublicOverlaySceneId: "public-scene",
    activePersonalOverlaySceneId: "personal-scene",
    overlayScenes: [
      { schemaVersion: 1, id: "public-scene", name: "Public", sources: [{ id: "public-text", kind: "text", name: "Public title", visible: true, x: 0, y: 0, width: 100, height: 20, opacity: 1, zIndex: 1, config: { text: "PUBLIC OUTPUT" } }] },
      { schemaVersion: 1, id: "personal-scene", name: "Personal", sources: [{ id: "personal-text", kind: "text", name: "Private controls", visible: true, x: 0, y: 0, width: 100, height: 20, opacity: 1, zIndex: 1, config: { text: "PERSONAL OUTPUT" } }] },
    ],
  };
  const authorized = [];
  const service = {
    server: inner,
    control: {},
    authority: { getWorkspace(tenantId) { assert.equal(tenantId, "tenant-a"); return workspace; } },
    auth: { authorize(token, scope, tenantId) { authorized.push({ token, scope, tenantId }); if (token !== "owner-token") throw new Error("invalid token"); return { actorId: "owner-a" }; } },
    async close() { if (inner.listening) await close(inner); },
  };
  const gateway = createSpmtOutputGateway(service, { port: 0, host: "127.0.0.1", publicBaseUrl: "https://spmt.example" });
  try {
    await gateway.listen();
    const base = origin(gateway.server);
    const described = await fetch(`${base}/v1/overlay/tenant-outputs`, { headers: { authorization: "Bearer owner-token", "x-spmt-tenant": "tenant-a" } });
    assert.equal(described.status, 200);
    assert.deepEqual(await described.json(), {
      schemaVersion: 1,
      tenantId: "tenant-a",
      editorUrl: "https://spmt.example/?view=workspace",
      public: { name: "public", sceneId: "public-scene", url: "https://spmt.example/t/tenant-a/public" },
      personal: { name: "personal", sceneId: "personal-scene", url: "https://spmt.example/t/tenant-a/personal" },
    });
    const publicOutput = await fetch(`${base}/t/tenant-a/public`);
    assert.equal(publicOutput.status, 200);
    assert.match(await publicOutput.text(), /PUBLIC OUTPUT/);
    const anonymousPersonal = await fetch(`${base}/t/tenant-a/personal`);
    assert.equal(anonymousPersonal.status, 401);
    const personalOutput = await fetch(`${base}/t/tenant-a/personal`, { headers: { authorization: "Bearer owner-token" } });
    assert.equal(personalOutput.status, 200);
    assert.match(await personalOutput.text(), /PERSONAL OUTPUT/);
    assert.equal(authorized.every((item) => item.scope === "workspace:read" && item.tenantId === "tenant-a"), true);
  } finally { await gateway.close(); }
});
