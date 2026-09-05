import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { fetchAppPlatformSnapshot, productAppLiveReadFromEnvironment, productAppSnapshotSources, renderProductAppWebPage } from "../packages/app-foundation/dist/product-web.js";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("product app snapshot reads only canonical SPMT developer contracts and reports partial access", async (t) => {
  const requests = [];
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://fixture.invalid");
    requests.push({ path: `${url.pathname}${url.search}`, appId: request.headers["x-spmt-app"], tenantId: request.headers["x-spmt-tenant"] });
    if (url.pathname === "/v1/session") return json(response, 200, { actorId: "user-1", username: "creator", displayName: "Creator", tenantIds: ["tenant-1"] });
    if (url.pathname === "/v1/runtime/state") return json(response, 200, [{ appId: "streamweaver", state: "ready", updatedAt: "2026-09-02T00:00:00.000Z" }]);
    if (url.pathname === "/v1/events") return json(response, 200, [{ sourceAppId: "streamweaver", type: "command.executed", createdAt: "2026-09-02T00:00:00.000Z", payload: { command: "hello" } }]);
    if (url.pathname === "/v1/xp/ledger") return json(response, 200, [
      { sourceAppId: "streamweaver", delta: 5, reason: "command" },
      { sourceAppId: "discord-stream-hub", delta: 10, reason: "community" },
    ]);
    if (url.pathname === "/v1/operations/logs") return json(response, 403, { error: "unauthorized" });
    if (url.pathname === "/v1/xp/wallet") return json(response, 200, { spendableXp: 42, level: 3, rank: 7, lifetimeXp: 100 });
    return json(response, 200, []);
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  t.after(() => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));
  const address = server.address();
  assert.ok(address && typeof address === "object");

  const snapshot = await fetchAppPlatformSnapshot({
    appId: "streamweaver",
    spmtOrigin: `http://127.0.0.1:${address.port}`,
    request: { headers: { cookie: "spmt_session=fixture" } },
    sources: ["runtime", "events", "jobs", "workers", "operations", "devices", "stellarCapabilities", "providerLinks", "xpWallet", "xpLedger"],
  });

  assert.equal(snapshot.contract, "spmt.public-api.v1");
  assert.equal(snapshot.tenantId, "tenant-1");
  assert.equal(snapshot.runtime.length, 1);
  assert.equal(snapshot.events.length, 1);
  assert.equal(snapshot.xpLedger.length, 1);
  assert.equal(snapshot.xpLedger[0].sourceAppId, "streamweaver");
  assert.deepEqual(snapshot.availability.operations, { available: false, status: 403 });
  assert.equal(requests.every((request) => request.appId === "streamweaver"), true);
  assert.equal(requests.filter((request) => request.path !== "/v1/session").every((request) => request.tenantId === "tenant-1"), true);
  assert.equal(requests.some((request) => request.path === "/v1/devices"), true);
  assert.equal(requests.some((request) => request.path === "/v1/stellar/capabilities"), true);
  assert.equal(requests.some((request) => request.path === "/v1/identity/providers"), true);

  const liveRequests = [];
  const liveSnapshot = await fetchAppPlatformSnapshot({
    appId: "streamweaver",
    spmtOrigin: `http://127.0.0.1:${address.port}`,
    request: { headers: { cookie: "spmt_session=fixture" } },
    sources: ["runtime", "events"],
    liveRead: {
      origin: "https://production.example",
      fetchImpl: async (url, init) => {
        const headers = new Headers(init?.headers);
        liveRequests.push({ url: String(url), method: init?.method, authorization: headers.get("authorization"), tenantId: headers.get("x-spmt-tenant"), shadowRead: headers.get("x-spmt-shadow-read") });
        return Response.json(String(url).includes("/v1/runtime/state") ? [{ appId: "streamweaver", state: "ready", detail: "production" }] : [{ sourceAppId: "streamweaver", type: "live.event" }]);
      },
    },
  });
  assert.equal(liveSnapshot.dataMode, "live-read");
  assert.equal(liveSnapshot.operationMode, "read-only");
  assert.equal(liveSnapshot.runtime[0].detail, "production");
  assert.equal(liveRequests.every((request) => request.method === "GET" && request.authorization === null && request.tenantId === "tenant-1" && request.shadowRead === "1"), true);
});

test("live-read configuration needs only an HTTPS production origin", () => {
  assert.equal(productAppLiveReadFromEnvironment({}), undefined);
  assert.deepEqual(productAppLiveReadFromEnvironment({ SPMT_LIVE_READ_ORIGIN: "https://production.example", SPMT_LIVE_READ_PROTOCOL: "blue-v1" }), { origin: "https://production.example", protocol: "blue-v1" });
  assert.throws(() => productAppLiveReadFromEnvironment({ SPMT_LIVE_READ_ORIGIN: "http://production.example" }), /HTTPS origin/);
});

test("shared app UI renders per-section signals and truthful contract notes with valid browser JavaScript", () => {
  const page = renderProductAppWebPage({
    appId: "fixture",
    name: "Fixture",
    kicker: "DEVELOPER SURFACE",
    tagline: "Canonical data only.",
    description: "Fixture app",
    sceneUrl: "/assets/fixture.webp",
    sections: [{
      id: "activity",
      label: "Activity",
      title: "Published Activity",
      body: "Only records published through SPMT appear here.",
      signals: [{ source: "events", label: "Activity events", keywords: ["activity"] }],
      catalogs: [{ label: "Existing capabilities", items: [{ title: "Read only", detail: "Derived from the app's existing catalog.", badge: "Available" }] }],
      contractNote: "Private app records are not inferred.",
    }],
  });
  assert.match(page, /SPMT developer surface/);
  assert.match(page, /Private app records are not inferred/);
  assert.match(page, /Existing capabilities/);
  assert.match(page, /Derived from the app's existing catalog/);
  assert.match(page, /spmt\.public-api\.v1|\/api\/.*snapshot/);
  const script = page.match(/<script>([\s\S]*)<\/script>/)?.[1];
  assert.ok(script);
  assert.doesNotThrow(() => new Function(script));
});

test("descriptor-declared snapshot sources keep baseline health, shared workspace outputs, and omit unrelated personal scopes", () => {
  const sources = productAppSnapshotSources({
    appId: "fixture",
    name: "Fixture",
    kicker: "FIXTURE",
    tagline: "Fixture",
    description: "Fixture",
    sceneUrl: "/fixture.webp",
    sections: [{ id: "logs", label: "Logs", title: "Logs", body: "Logs", signals: [{ source: "operations", label: "Operations" }] }],
  });
  assert.deepEqual(sources, ["runtime", "events", "jobs", "workers", "workspace", "tenantOutputs", "operations"]);
  assert.equal(sources.includes("devices"), false);
  assert.equal(sources.includes("providerLinks"), false);
  assert.equal(sources.includes("xpWallet"), false);
});

test("DSH, StreamWeaver and Companion declare app-specific public feeds without copying private authorities", async () => {
  const checks = [
    [["apps/discord-stream-hub/src/web-server.ts", "apps/discord-stream-hub/src/web-controls.ts", "apps/discord-stream-hub/src/shoutout-groups.ts"], ["providerLinks", "xpWallet", "DSH_SHOUTOUT_GROUPS", "DSH_APPLICATION_DEFINITIONS", "app-owned controls"]],
    [["apps/streamweaver/src/web-server.ts", "apps/streamweaver/src/web-controls.ts"], ["overlayWidgets", "stellarCapabilities", "STREAMWEAVER_DONOR_COMMANDS", "STREAMWEAVER_OVERLAYS", "tenant-local currency"]],
    [["apps/companion/src/web-server.ts"], ["devices", "operations", "COMPANION_WORKFLOWS", "COMPANION_MEDIA_PRESETS", "does not start an unreviewed workflow"]],
  ];
  for (const [paths, patterns] of checks) {
    const source = (await Promise.all(paths.map((path) => read(path)))).join("\n");
    for (const pattern of patterns) assert.match(source, new RegExp(pattern));
  }
});

test("MountainView uses its existing paired-device and capture routes for a functional local view", async () => {
  const source = await read("apps/mountainview/src/web-server.ts");
  assert.match(source, /data-pair-form/);
  assert.match(source, /data-revoke-device/);
  assert.match(source, /qr\.scanned/);
  assert.match(source, /camera\.captured/);
  assert.match(source, /\/api\/mountainview\/devices/);
  assert.doesNotMatch(source, /navigator\.mediaDevices|getUserMedia/);
});

function json(response, status, value) {
  const body = Buffer.from(JSON.stringify(value));
  response.writeHead(status, { "content-type": "application/json", "content-length": String(body.byteLength) });
  response.end(body);
}
