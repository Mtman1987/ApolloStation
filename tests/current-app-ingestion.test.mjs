import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer as createNetServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { commlinkCatalogRegistration } from "../apps/commlink/dist/index.js";
import { companionCatalogRegistration } from "../apps/companion/dist/index.js";
import { discordStreamHubCatalogRegistration } from "../apps/discord-stream-hub/dist/index.js";
import { hearMeOutCatalogRegistration } from "../apps/hearmeout/dist/index.js";
import { missionControlCatalogRegistration } from "../apps/mission-control/dist/index.js";
import { mountainViewCatalogRegistration } from "../apps/mountainview/dist/index.js";
import { nebulaArcadeCatalogRegistration } from "../apps/nebula-arcade/dist/index.js";
import { stellarCoreCatalogRegistration } from "../apps/stellar-core/dist/index.js";
import { streamweaverCatalogRegistration } from "../apps/streamweaver/dist/index.js";
import { createIntegratedSpaceMountainWebHost } from "../apps/spacemountain-web/dist/integrated-server.js";
import { FIRST_PARTY_APP_CSS, FIRST_PARTY_APP_SURFACES } from "../apps/spacemountain-web/dist/first-party-app-surfaces.js";
import { SpmtClient } from "../packages/sdk/dist/index.js";

const origin = "https://test-green.sprites.app";
const registrations = [
  commlinkCatalogRegistration(origin),
  stellarCoreCatalogRegistration(origin),
  missionControlCatalogRegistration(origin),
  discordStreamHubCatalogRegistration(origin),
  streamweaverCatalogRegistration(origin),
  hearMeOutCatalogRegistration(origin),
  mountainViewCatalogRegistration(origin),
  companionCatalogRegistration(origin),
  nebulaArcadeCatalogRegistration(origin),
];

const expectedIds = ["commlink", "companion", "discord-stream-hub", "hearmeout", "mission-control", "mountainview", "nebula-arcade", "stellar-core", "streamweaver"];

test("the current first-party catalog contains every app and gives Workspace a stable embed launch", () => {
  assert.deepEqual(registrations.map((item) => item.appId).sort(), expectedIds);
  for (const registration of registrations) {
    const url = new URL(registration.launchUrl);
    assert.equal(url.origin, origin);
    assert.equal(url.pathname, `/apps/${registration.appId}`);
    assert.equal(url.searchParams.get("surface"), "workspace");
    assert.equal(registration.surfaces.includes("shell"), true, `${registration.appId} must be launchable inside the SpaceMountain shell`);
  }
});

test("every newly ingested app owns a frameable shared-theme surface", async () => {
  const host = createIntegratedSpaceMountainWebHost({ spmtOrigin: "http://127.0.0.1:65534", host: "127.0.0.1", port: 0, buildSha: "app-ingestion-test" });
  try {
    await host.listen();
    const address = host.server.address();
    assert.ok(address && typeof address !== "string");
    const base = `http://127.0.0.1:${address.port}`;
    assert.equal((await fetch(`${base}/assets/web/first-party-apps.css`)).status, 200);
    assert.equal((await fetch(`${base}/assets/web/first-party-apps.js`)).status, 200);
    for (const [appId, descriptor] of Object.entries(FIRST_PARTY_APP_SURFACES)) {
      const response = await fetch(`${base}/apps/${appId}?surface=shell`);
      assert.equal(response.status, 200, appId);
      assert.equal(response.headers.get("x-frame-options"), "SAMEORIGIN");
      assert.match(response.headers.get("content-security-policy") ?? "", /frame-ancestors 'self'/);
      const html = await response.text();
      assert.match(html, new RegExp(`data-app="${appId}"`));
      assert.match(html, /data-surface="shell"/);
      assert.match(html, new RegExp(descriptor.shortName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    }
  } finally {
    await host.close();
  }
});

test("existing shell-rendered apps become real same-origin Workspace embeds instead of blocked frames", async () => {
  const host = createIntegratedSpaceMountainWebHost({ spmtOrigin: "http://127.0.0.1:65534", host: "127.0.0.1", port: 0, buildSha: "workspace-embed-test" });
  try {
    await host.listen();
    const address = host.server.address();
    assert.ok(address && typeof address !== "string");
    const base = `http://127.0.0.1:${address.port}`;
    for (const appId of ["commlink", "stellar-core", "mission-control"]) {
      const response = await fetch(`${base}/apps/${appId}?surface=workspace`);
      assert.equal(response.status, 200, appId);
      assert.equal(response.headers.get("x-frame-options"), "SAMEORIGIN");
      assert.match(response.headers.get("content-security-policy") ?? "", /frame-ancestors 'self'/);
      assert.match(await response.text(), /data-spmt-workspace-embed/);
    }
  } finally {
    await host.close();
  }
});

test("supervised current catalog appears in Shipyard and every Workspace launch renders", async () => {
  const directory = mkdtempSync(join(tmpdir(), "spmt-current-apps-"));
  const ports = new Set();
  while (ports.size < 3) ports.add(await freePort());
  const [spmtPort, webPort, nebulaPort] = [...ports];
  const base = `http://127.0.0.1:${webPort}`;
  const publicUrl = `http://localhost:${webPort}`;
  const child = spawn(process.execPath, [
    "scripts/sprites/run-supervised-sandbox.mjs",
    "--candidate-app", "nebula-arcade",
    "--catalog", "current",
    "--public-url", publicUrl,
    "--data-root", directory,
    "--build-sha", "current-app-runtime-test",
    "--spmt-port", String(spmtPort),
    "--web-port", String(webPort),
    "--chat-tag-port", String(nebulaPort),
  ], { cwd: new URL("..", import.meta.url), stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => { output += chunk; });
  child.stderr.on("data", (chunk) => { output += chunk; });
  try {
    await waitUntil(() => output.includes("Green sandbox is supervised and ready"), 25_000, () => `Runner output:\n${output}`);
    for (const name of ["Commlink", "Stellar Core", "Mission Control", "Discord Stream Hub", "StreamWeaver", "HearMeOut", "MountainView", "SpaceMountain Companion", "Nebula Arcade"]) assert.match(output, new RegExp(name));

    const page = await fetch(`${base}/`);
    assert.equal(page.status, 200);
    const browserHtml = await page.text();
    assert.match(browserHtml, /SPACEMOUNTAIN/);

    const requestOrigin = new URL(base).origin;
    const registration = await fetch(`${base}/sandbox/auth/register`, {
      method: "POST",
      headers: { origin: requestOrigin, "content-type": "application/json" },
      body: JSON.stringify({ displayName: "App Inventory Captain", username: "app-inventory-captain", password: "sandbox-only-password" }),
    });
    assert.equal(registration.status, 201);
    const cookie = (registration.headers.get("set-cookie") ?? "").split(";")[0];
    assert.ok(cookie);
    const tenantId = (await registration.json()).tenantId;
    assert.ok(tenantId);
    const client = new SpmtClient({
      baseUrl: base,
      appId: "spacemountain",
      fetchImpl: (input, init = {}) => {
        const headers = new Headers(init.headers);
        headers.set("cookie", cookie);
        if (init.method && init.method !== "GET" && init.method !== "HEAD") headers.set("origin", requestOrigin);
        return fetch(input, { ...init, headers });
      },
    });
    const apps = await client.listApps();
    const installs = await client.listInstalls(tenantId);
    assert.deepEqual(apps.map((item) => item.appId).sort(), expectedIds, "Shipyard registry must contain the complete current app pool");
    assert.deepEqual(installs.filter((item) => item.enabled).map((item) => item.appId).sort(), expectedIds, "new tenants must have every current first-party app installed and enabled");

    for (const app of apps) {
      const launch = new URL(app.launchUrl);
      launch.hostname = "127.0.0.1";
      const response = await fetch(launch);
      assert.equal(response.status, 200, `${app.appId} Workspace launch must render`);
      assert.notEqual(response.headers.get("x-frame-options"), "DENY", `${app.appId} must not be blocked from the same-origin Workspace iframe`);
      assert.match(response.headers.get("content-security-policy") ?? "", /frame-ancestors 'self'/, `${app.appId} must explicitly permit same-origin Workspace embedding`);
      assert.ok((await response.text()).length > 100, `${app.appId} Workspace response must contain a real surface`);
    }

    child.kill("SIGTERM");
    const exit = await new Promise((done) => child.once("exit", (code, signal) => done({ code, signal })));
    assert.deepEqual(exit, { code: 0, signal: null });
    await waitUntil(async () => !(await reachable(spmtPort)) && !(await reachable(webPort)) && !(await reachable(nebulaPort)), 5_000, () => "A supervised app-ingestion process remained reachable after shutdown");
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    rmSync(directory, { recursive: true, force: true });
  }
});

test("embedded app homes stay inside the shared viewport and release promotion selects the full current catalog", () => {
  assert.match(FIRST_PARTY_APP_CSS, /data-surface="shell"\],body\[data-surface="workspace"\]\{height:100dvh;min-height:0;overflow:hidden\}/);
  assert.match(FIRST_PARTY_APP_CSS, /data-surface="shell"\] main,[^}]*data-surface="workspace"\] main\{height:100%;min-height:0/);
  const deploy = readFileSync(new URL("../scripts/sprites/deploy-sandbox-release.sh", import.meta.url), "utf8");
  assert.match(deploy, /--candidate-app,nebula-arcade,--catalog,current/);
  const runner = readFileSync(new URL("../scripts/sprites/run-supervised-sandbox.mjs", import.meta.url), "utf8");
  for (const registration of ["discordStreamHubCatalogRegistration", "streamweaverCatalogRegistration", "hearMeOutCatalogRegistration", "mountainViewCatalogRegistration", "companionCatalogRegistration"]) assert.match(runner, new RegExp(registration));
  assert.match(runner, /apps\/spacemountain-web\/dist\/integrated-server\.js/);
});

async function freePort() {
  const server = createNetServer();
  await new Promise((done, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", done); });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  await new Promise((done, reject) => server.close((error) => error ? reject(error) : done()));
  return address.port;
}

async function reachable(port) {
  try { await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(300) }); return true; } catch { return false; }
}

async function waitUntil(check, timeout, failure) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((done) => setTimeout(done, 100));
  }
  throw new Error(failure());
}
