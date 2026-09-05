import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { createSpaceMountainWebHost } from "../apps/spacemountain-web/dist/server.js";
import { createIntegratedSpaceMountainWebHost } from "../apps/spacemountain-web/dist/integrated-server.js";
import { createSpmtOutputGateway } from "../apps/spmt-service/dist/output-gateway.js";

function origin(server) { return `http://127.0.0.1:${server.address().port}`; }
async function withOverlayHost(run) {
  const inner = createServer((_request, response) => { response.writeHead(404); response.end(); });
  const workspace = {
    activePublicOverlaySceneId: "scene-a", activePersonalOverlaySceneId: "scene-a",
    overlayScenes: [{ id: "scene-a", name: "Test overlay", sources: [
      { id: "title", kind: "text", visible: true, config: { text: "OVERLAY CONTENT" } },
      { id: "widget", kind: "widget", visible: true, config: { rendererUrl: "https://renderer.example/overlay" } },
    ] }],
  };
  const service = {
    server: inner,
    auth: { authorize(token, scope, tenantId) {
      assert.equal(token, "fixture-session"); assert.equal(scope, "workspace:read"); assert.equal(tenantId, "tenant-a");
      return { actorId: "viewer-a" };
    } },
    authority: { getWorkspace(tenantId) { assert.equal(tenantId, "tenant-a"); return workspace; } },
    control: { resolveOverlayOutputToken(token) {
      if (token !== "abcdefghijklmnop") throw new Error("revoked");
      return { principal: { grantId: "grant-a", tenantId: "tenant-a", appId: "overlay-bay", widgetId: "scene:scene-a" } };
    } },
    async close() { await new Promise((done) => inner.close(done)); },
  };
  const gateway = createSpmtOutputGateway(service, {
    host: "127.0.0.1", port: 0,
    fetchImpl: async () => new Response("<!doctype html><title>Widget</title><p>WIDGET CONTENT</p>", {
      headers: { "content-type": "text/html", "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'self'" },
    }),
  });
  let web;
  try {
    await gateway.listen();
    web = createIntegratedSpaceMountainWebHost({ spmtOrigin: origin(gateway.server), host: "127.0.0.1", port: 0 });
    await web.listen();
    await run(origin(web.server));
  } finally { if (web) await web.close(); await gateway.close(); }
}

test("browser host serves tenant and opaque overlay documents and child sources with renderer CSP", async () => {
  await withOverlayHost(async (base) => {
    for (const root of ["/t/tenant-a/public", "/t/tenant-a/personal", "/o/abcdefghijklmnop"]) {
      for (const suffix of ["", "/source/widget"]) {
        for (const method of ["GET", "HEAD"]) {
          const response = await fetch(`${base}${root}${suffix}`, { method, headers: { cookie: "spmt_token=fixture-session" } });
          assert.equal(response.status, 200, `${method} ${root}${suffix}`);
          assert.equal(response.headers.get("x-frame-options"), null);
          assert.match(response.headers.get("content-security-policy"), /frame-ancestors (?:\*|'self')/);
          assert.match(response.headers.get("content-security-policy"), /style-src 'unsafe-inline'/);
          assert.equal(response.headers.get("cache-control"), "no-store");
          const body = await response.text();
          if (method === "GET") assert.match(body, suffix ? /WIDGET CONTENT/ : /OVERLAY CONTENT/);
          else assert.equal(body, "");
        }
      }
    }
    const shell = await fetch(base);
    assert.equal(shell.headers.get("x-frame-options"), "DENY");
    assert.match(shell.headers.get("content-security-policy"), /frame-ancestors 'none'/);
  });
});

test("failed personal and revoked overlay requests remain transparent without granting access", async () => {
  await withOverlayHost(async (base) => {
    for (const [path, status] of [["/t/tenant-a/personal", 401], ["/o/revokedtoken1234x", 404]]) {
      const response = await fetch(`${base}${path}`);
      assert.equal(response.status, status);
      assert.match(response.headers.get("content-type"), /text\/html/);
      assert.equal(response.headers.get("x-frame-options"), null);
      assert.match(response.headers.get("content-security-policy"), /frame-ancestors 'self'/);
      const body = await response.text();
      assert.match(body, /background:transparent/);
      assert.doesNotMatch(body, /OVERLAY CONTENT|WIDGET CONTENT/);
    }
    for (const path of ["/t/tenant-a/settings", "/t/tenant-a/personal/other", "/o/short"]) {
      assert.equal((await fetch(`${base}${path}`)).status, 404);
    }
    assert.equal((await fetch(`${base}/t/tenant-a/public`, { method: "POST" })).status, 404);
  });
});

test("unavailable overlay service returns a transparent 503", async () => {
  const web = createSpaceMountainWebHost({ spmtOrigin: "http://127.0.0.1:1", host: "127.0.0.1", port: 0, fetchImpl: async () => { throw new Error("offline"); } });
  try {
    await web.listen();
    const response = await fetch(`${origin(web.server)}/t/tenant-a/personal`);
    assert.equal(response.status, 503);
    assert.equal(response.headers.get("x-frame-options"), null);
    assert.match(await response.text(), /background:transparent/);
  } finally { await web.close(); }
});
