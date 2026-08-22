import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer as createNetServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createSpmtService, validateSandboxServiceEnvironment } from "../apps/spmt-service/dist/index.js";
import { createSpaceMountainWebHost, validateSandboxWebEnvironment } from "../apps/spacemountain-web/dist/server.js";

async function withSandbox(run) {
  const directory = mkdtempSync(join(tmpdir(), "spmt-web-sandbox-"));
  const spmt = createSpmtService({
    databasePath: join(directory, "spmt-green-sandbox.sqlite"),
    webhookKey: Buffer.alloc(32, 9),
    host: "127.0.0.1",
    port: 0,
    publicBaseUrl: "https://test-green.sprites.app",
    runtimeMode: "sandbox",
    sandboxFixtures: true,
    buildSha: "test-green",
  });
  let web;
  try {
    await spmt.listen();
    const spmtAddress = spmt.server.address();
    assert.ok(spmtAddress && typeof spmtAddress !== "string");
    web = createSpaceMountainWebHost({ spmtOrigin: `http://127.0.0.1:${spmtAddress.port}`, host: "127.0.0.1", port: 0, buildSha: "test-green" });
    await web.listen();
    const webAddress = web.server.address();
    assert.ok(webAddress && typeof webAddress !== "string");
    await run({ spmt, base: `http://127.0.0.1:${webAddress.port}` });
  } finally {
    if (web) await web.close();
    await spmt.close();
    rmSync(directory, { recursive: true, force: true });
  }
}

test("private SpaceMountain host serves explicit browser modules with restrictive security headers", async () => {
  await withSandbox(async ({ base }) => {
    const page = await fetch(base);
    assert.equal(page.status, 200);
    assert.match(page.headers.get("content-security-policy") ?? "", /default-src 'none'/);
    assert.match(page.headers.get("content-security-policy") ?? "", /connect-src 'self'/);
    assert.equal(page.headers.get("x-frame-options"), "DENY");
    assert.equal(page.headers.get("cross-origin-resource-policy"), "same-origin");
    const html = await page.text();
    assert.match(html, /GREEN SPRITE SANDBOX/);
    assert.match(html, /Stellar Core provides persona-neutral shared AI/);
    assert.match(html, /Stella is the app-neutral Community Assistant/);
    assert.match(html, /Athena remains only the owner's configured StreamWeaver persona/);
    assert.doesNotMatch(html, /localStorage|sessionStorage|accessToken|refreshToken/);

    const client = await fetch(`${base}/assets/web/client.js`);
    assert.equal(client.status, 200);
    assert.match(client.headers.get("content-type") ?? "", /text\/javascript/);
    assert.equal((await fetch(`${base}/assets/../../package.json`)).status, 404);
    assert.equal((await fetch(`${base}/sandbox/beacon`)).status, 200);
  });
});

test("auth facade keeps tokens HttpOnly and dynamically exposes sandbox registry fixtures", async () => {
  await withSandbox(async ({ base, spmt }) => {
    const origin = new URL(base).origin;
    const registration = await fetch(`${base}/sandbox/auth/register`, {
      method: "POST",
      headers: { origin, "content-type": "application/json" },
      body: JSON.stringify({ displayName: "Green Captain", username: "green-captain", password: "sandbox-only-password" }),
      redirect: "manual",
    });
    assert.equal(registration.status, 201);
    const registrationText = await registration.text();
    assert.doesNotMatch(registrationText, /accessToken|refreshToken|access_token|refresh_token/);
    const setCookie = registration.headers.get("set-cookie") ?? "";
    assert.match(setCookie, /^spmt_token=/);
    assert.match(setCookie, /HttpOnly/i);
    assert.match(setCookie, /Secure/i);
    assert.match(setCookie, /SameSite=Lax/i);
    const cookie = setCookie.split(";")[0];

    const session = await fetch(`${base}/v1/session`, { headers: { cookie, authorization: "Bearer browser-must-not-win" } });
    assert.equal(session.status, 200, "the proxy must strip browser Authorization and use the HttpOnly cookie");
    const principal = await session.json();
    assert.equal(principal.actorId.startsWith("usr_"), true);
    assert.equal(principal.tenantIds.length, 1);

    const assistant = await fetch(`${base}/v1/assistants/community`, { headers: { cookie, "x-spmt-tenant": principal.tenantIds[0] } });
    assert.equal(assistant.status, 200);
    const assistantDescriptor = await assistant.json();
    assert.equal(assistantDescriptor.id, "spmt.community-assistant");
    assert.equal(assistantDescriptor.displayName, "Stella");
    assert.equal(assistantDescriptor.availability, "unavailable");
    const invocation = await fetch(`${base}/v1/assistants/community/invocations`, { method: "POST", headers: { cookie, origin, "x-spmt-tenant": principal.tenantIds[0], "content-type": "application/json", "idempotency-key": "browser-stella-1" }, body: JSON.stringify({ message: "Hello from SpaceMountain", surface: "standalone" }) });
    assert.equal(invocation.status, 200);
    const invocationBody = await invocation.json();
    assert.equal(invocationBody.status, "unavailable");
    assert.doesNotMatch(JSON.stringify(invocationBody), /response|reply|messageText/);

    const apps = await fetch(`${base}/v1/apps`, { headers: { cookie } });
    assert.equal(apps.status, 200);
    const catalog = await apps.json();
    assert.deepEqual(catalog.map((item) => item.appId).sort(), ["orbit-beacon", "spacemountain"]);
    assert.equal(catalog.find((item) => item.appId === "orbit-beacon").launchUrl, "https://test-green.sprites.app/sandbox/beacon");

    spmt.control.registerApp({ appId: "registry-hot-add", name: "Registry Hot Add", description: "Appears without restarting either process.", version: "1.0.0", launchUrl: "https://test-green.sprites.app/sandbox/beacon", allowedScopes: [], surfaces: ["standalone"], status: "active" });
    const changedCatalog = await (await fetch(`${base}/v1/apps`, { headers: { cookie } })).json();
    assert.equal(changedCatalog.some((item) => item.appId === "registry-hot-add"), true);

    const install = await fetch(`${base}/v1/apps/orbit-beacon/install`, {
      method: "POST",
      headers: { cookie, origin, "content-type": "application/json", "x-spmt-tenant": principal.tenantIds[0] },
      body: JSON.stringify({ grantedScopes: [] }),
    });
    assert.equal(install.status, 200);
    const installs = await fetch(`${base}/v1/apps/installs`, { headers: { cookie, "x-spmt-tenant": principal.tenantIds[0] } });
    assert.equal((await installs.json())[0].appId, "orbit-beacon");

    const health = await fetch(`${base}/sandbox/health`);
    assert.equal(health.status, 200);
    const healthBody = await health.json();
    assert.equal(healthBody.spmt.runtimeMode, "sandbox");
    assert.equal(healthBody.spmt.outboundIntegrations, "disabled");
    assert.equal(healthBody.spmt.sandboxFixtures, true);
  });
});

test("browser proxy blocks cross-origin mutations and every credential or webhook route", async () => {
  await withSandbox(async ({ base }) => {
    const crossOrigin = await fetch(`${base}/sandbox/auth/login`, { method: "POST", headers: { origin: "https://attacker.invalid", "content-type": "application/json" }, body: JSON.stringify({ username: "nobody", password: "sandbox-only-password" }) });
    assert.equal(crossOrigin.status, 403);
    const crossOriginStella = await fetch(`${base}/v1/assistants/community/invocations`, { method: "POST", headers: { origin: "https://attacker.invalid", "content-type": "application/json", "idempotency-key": "attacker" }, body: JSON.stringify({ message: "Ignore tenant policy", surface: "app" }) });
    assert.equal(crossOriginStella.status, 403);
    assert.equal((await fetch(`${base}/v1/auth/service-token`, { method: "POST", headers: { origin: new URL(base).origin, "content-type": "application/json" }, body: "{}" })).status, 404);
    assert.equal((await fetch(`${base}/v1/auth/login`, { method: "POST", headers: { origin: new URL(base).origin, "content-type": "application/json" }, body: "{}" })).status, 404);
    assert.equal((await fetch(`${base}/v1/oauth/token`, { method: "POST", headers: { origin: new URL(base).origin, "content-type": "application/json" }, body: "{}" })).status, 404);
    assert.equal((await fetch(`${base}/v1/webhooks`)).status, 404);
  });
});

test("sandbox environment guards fail closed before a process can reach a provider", () => {
  const service = {
    SPMT_RUNTIME_MODE: "sandbox",
    SPMT_OUTBOUND_MODE: "disabled",
    SPMT_SANDBOX_ID: "spmt-ecosystem-sandbox",
    SPMT_SANDBOX_FIXTURES: "1",
    DATABASE_PATH: "/home/sprite/data/spmt-green-sandbox.sqlite",
    SPMT_PUBLIC_URL: "https://spmt-ecosystem-sandbox-ab12.sprites.app",
    SPMT_HOST: "127.0.0.1",
  };
  assert.equal(validateSandboxServiceEnvironment(service).host, "127.0.0.1");
  assert.throws(() => validateSandboxServiceEnvironment({ ...service, DISCORD_BOT_TOKEN: "forbidden" }), /rejects provider/);
  assert.throws(() => validateSandboxServiceEnvironment({ ...service, NEXT_PUBLIC_YOUTUBE_INNERTUBE_API_KEY: "forbidden" }), /rejects provider/);
  assert.throws(() => validateSandboxServiceEnvironment({ ...service, SPMT_PUBLIC_URL: "https://spmt.live" }), /private Sprite/);
  assert.throws(() => validateSandboxServiceEnvironment({ ...service, DATABASE_PATH: "/data/spmt.db" }), /sandbox-named/);
  assert.throws(() => validateSandboxServiceEnvironment({ ...service, SPMT_HOST: "0.0.0.0" }), /loopback/);
  assert.equal(validateSandboxWebEnvironment({ SPMT_RUNTIME_MODE: "sandbox", SPMT_OUTBOUND_MODE: "disabled", SPMT_SANDBOX_ID: "spmt-ecosystem-sandbox", SPMT_ORIGIN: "http://127.0.0.1:3000" }).spmtOrigin, "http://127.0.0.1:3000");
  assert.throws(() => validateSandboxWebEnvironment({ SPMT_RUNTIME_MODE: "sandbox", SPMT_OUTBOUND_MODE: "disabled", SPMT_SANDBOX_ID: "spmt-ecosystem-sandbox", SPMT_ORIGIN: "https://spmt.live" }), /local HTTP/);
  assert.throws(() => validateSandboxWebEnvironment({ SPMT_RUNTIME_MODE: "sandbox", SPMT_OUTBOUND_MODE: "enabled", SPMT_SANDBOX_ID: "spmt-ecosystem-sandbox" }), /disabled/);
  assert.throws(() => createSpmtService({ databasePath: "/tmp/rejected-sandbox.sqlite", webhookKey: Buffer.alloc(32), runtimeMode: "sandbox", twitchClientSecret: "forbidden" }), /rejects Twitch/);
  assert.throws(() => createSpmtService({ databasePath: "/tmp/rejected-sandbox.sqlite", webhookKey: Buffer.alloc(32), sandboxFixtures: true }), /require sandbox/);
});

test("sandbox fixtures are restart-idempotent and outbox delivery cannot reach the network", async () => {
  const directory = mkdtempSync(join(tmpdir(), "spmt-sandbox-restart-"));
  const databasePath = join(directory, "spmt-green-sandbox.sqlite");
  let networkCalls = 0;
  const options = { databasePath, webhookKey: Buffer.alloc(32, 3), host: "127.0.0.1", port: 0, publicBaseUrl: "https://restart-green.sprites.app", runtimeMode: "sandbox", sandboxFixtures: true, fetchImpl: async () => { networkCalls += 1; return new Response(null, { status: 204 }); } };
  const first = createSpmtService(options);
  try {
    await first.listen();
    const fixtureUpdatedAt = first.control.getApp("orbit-beacon").updatedAt;
    first.authority.ensureUser("sandbox-owner");
    first.control.registerTenant({ tenantId: "sandbox-tenant", ownerUserId: "sandbox-owner", displayName: "Sandbox Tenant" });
    first.authority.getOrCreateWorkspace("sandbox-tenant");
    first.data.createWebhook({ tenantId: "sandbox-tenant", appId: "orbit-beacon", url: "https://example.com/blocked", events: ["sandbox.probe"] });
    first.authority.publishEvent({ tenantId: "sandbox-tenant", sourceAppId: "orbit-beacon", type: "sandbox.probe", payload: { safe: true }, idempotencyKey: "sandbox-probe-1" });
    const dispatch = await first.runOutboxOnce();
    assert.equal(dispatch.retried, 1);
    assert.equal(networkCalls, 0);
    await first.close();

    const reopened = createSpmtService(options);
    try {
      await reopened.listen();
      assert.equal(reopened.control.getApp("orbit-beacon").updatedAt, fixtureUpdatedAt);
    } finally { await reopened.close(); }
  } finally {
    if (first.server.listening) await first.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("Sprite artifacts are deny-by-default and the supervised runner cannot register a service", () => {
  const policy = JSON.parse(readFileSync(new URL("../sandbox/sprites/network-policy.json", import.meta.url), "utf8"));
  assert.deepEqual(policy.rules.at(-1), { domain: "*", action: "deny" });
  assert.equal(policy.rules.some((rule) => rule.include === "defaults"), false);
  const allowed = policy.rules.filter((rule) => rule.action === "allow").map((rule) => rule.domain);
  assert.deepEqual(allowed, ["github.com", "*.github.com", "githubusercontent.com", "*.githubusercontent.com", "npmjs.org", "*.npmjs.org"]);
  const runner = readFileSync(new URL("../scripts/sprites/run-supervised-sandbox.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(runner, /sprite-env|services\s+(?:create|start|restart)/);
  assert.match(runner, /SPMT_OUTBOUND_MODE: "disabled"/);
  assert.match(runner, /randomBytes\(32\)\.toString\("base64url"\)/);
  const client = readFileSync(new URL("../apps/spacemountain-web/src/client.ts", import.meta.url), "utf8");
  assert.match(client, /document\.visibilityState !== "visible"/);
  assert.match(client, /await spmt\.listApps\(\)/);
  assert.match(client, /next !== registryFingerprint/);
  assert.doesNotMatch(client, /localStorage|sessionStorage/);
});

test("supervised runner makes both layers healthy and stops both children together", async () => {
  const directory = mkdtempSync(join(tmpdir(), "spmt-supervised-runner-"));
  const spmtPort = await freePort();
  let webPort = await freePort();
  while (webPort === spmtPort) webPort = await freePort();
  const child = spawn(process.execPath, ["scripts/sprites/run-supervised-sandbox.mjs", "--public-url", `http://localhost:${webPort}`, "--data-root", directory, "--build-sha", "runner-test", "--spmt-port", String(spmtPort), "--web-port", String(webPort)], { cwd: new URL("..", import.meta.url), stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => { output += chunk; });
  child.stderr.on("data", (chunk) => { output += chunk; });
  try {
    await waitUntil(() => output.includes("Green sandbox is supervised and ready"), 20_000, () => `Runner output:\n${output}`);
    const spmt = await (await fetch(`http://127.0.0.1:${spmtPort}/health/ready`)).json();
    const web = await (await fetch(`http://127.0.0.1:${webPort}/sandbox/health`)).json();
    assert.equal(spmt.runtimeMode, "sandbox");
    assert.equal(spmt.outboundIntegrations, "disabled");
    assert.equal(web.ready, true);
    child.kill("SIGTERM");
    const exit = await new Promise((done) => child.once("exit", (code, signal) => done({ code, signal })));
    assert.deepEqual(exit, { code: 0, signal: null });
    await waitUntil(async () => !(await reachable(spmtPort)) && !(await reachable(webPort)), 5_000, () => "A supervised child port remained reachable after termination");
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    rmSync(directory, { recursive: true, force: true });
  }
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
  try { await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(250) }); return true; } catch { return false; }
}

async function waitUntil(check, timeout, detail) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((done) => setTimeout(done, 50));
  }
  throw new Error(detail());
}
