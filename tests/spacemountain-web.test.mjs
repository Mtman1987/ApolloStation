import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer as createNetServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createSpmtService, validateSandboxServiceEnvironment } from "../apps/spmt-service/dist/index.js";
import { createSpaceMountainWebHost, validateSandboxWebEnvironment } from "../apps/spacemountain-web/dist/server.js";
import { nebulaArcadeCatalogRegistration } from "../apps/nebula-arcade/dist/index.js";
import { SpmtClient } from "../packages/sdk/dist/index.js";

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
    sandboxOwnerUsername: "mtman1987",
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
    assert.match(page.headers.get("content-security-policy") ?? "", /frame-src 'self'/);
    assert.match(page.headers.get("content-security-policy") ?? "", /connect-src 'self'/);
    assert.match(page.headers.get("content-security-policy") ?? "", /img-src 'self' data: https:/);
    assert.equal(page.headers.get("x-frame-options"), "DENY");
    assert.equal(page.headers.get("cross-origin-resource-policy"), "same-origin");
    const html = await page.text();
    assert.match(html, /GREEN SPRITE SANDBOX/);
    assert.match(html, /Stellar Core provides persona-neutral shared AI/);
    assert.match(html, /Stella is the app-neutral Community Assistant/);
    assert.match(html, /Tenant personas remain in the separate apps/);
    assert.match(html, /Add developer app/);
    assert.match(html, /Developer docs/);
    assert.doesNotMatch(html, /Publish Nebula Arcade tag game through SDK/);
    assert.doesNotMatch(html, /localStorage|sessionStorage|accessToken|refreshToken/);

    const client = await fetch(`${base}/assets/web/client.js`);
    assert.equal(client.status, 200);
    assert.match(client.headers.get("content-type") ?? "", /text\/javascript/);
    const sessionResilience = await fetch(`${base}/assets/web/session-resilience.js`);
    assert.equal(sessionResilience.status, 200);
    assert.match(sessionResilience.headers.get("content-type") ?? "", /text\/javascript/);
    assert.match(await sessionResilience.text(), /classifySpaceMountainSessionFailure/);
    assert.equal((await fetch(`${base}/assets/ui/index.js`)).status, 200);
    assert.equal((await fetch(`${base}/assets/spacemountain/product-shell-css.js`)).status, 200);
    assert.equal((await fetch(`${base}/assets/spacemountain/themed-surface-css.js`)).status, 200);
    assert.equal((await fetch(`${base}/assets/spacemountain/shell-ui-base.js`)).status, 200);
    assert.equal((await fetch(`${base}/assets/spacemountain/overlay-bay-ui.js`)).status, 200);
    assert.equal((await fetch(`${base}/assets/spacemountain/overlay-scenes.js`)).status, 200);
    assert.match((await fetch(`${base}/assets/product/space-logo-main.png`)).headers.get("content-type") ?? "", /image\/png/);
    assert.match((await fetch(`${base}/assets/product/theme-solar-flare-background.webp`)).headers.get("content-type") ?? "", /image\/webp/);
    assert.match((await fetch(`${base}/assets/product/commlink-communications-background.webp`)).headers.get("content-type") ?? "", /image\/webp/);
    assert.match((await fetch(`${base}/assets/product/stellar-core-background.webp`)).headers.get("content-type") ?? "", /image\/webp/);
    assert.match((await fetch(`${base}/assets/product/mission-control-background.webp`)).headers.get("content-type") ?? "", /image\/webp/);
    assert.equal((await fetch(`${base}/assets/../../package.json`)).status, 404);
    assert.equal((await fetch(`${base}/sandbox/beacon`)).status, 200);

    const docs = await fetch(`${base}/docs/developers`);
    assert.equal(docs.status, 200);
    const docsHtml = await docs.text();
    assert.match(docsHtml, /Register through the human-facing UI/);
    assert.match(docsHtml, /SpmtClient\.registerApp/);
    assert.match(docsHtml, /Registration is not installation/);
    assert.match(docsHtml, /TROUBLESHOOTING/);
    assert.equal((await fetch(`${base}/assets/web/developer-docs.css`)).status, 200);
    const example = await (await fetch(`${base}/docs/examples/app-manifest.json`)).json();
    assert.equal(example.appId, "my-community-app");
  });
});

test("Workspace room surfaces and room lifecycle APIs are reachable through browser ingress", async () => {
  await withSandbox(async ({base}) => {
    const surface = await fetch(`${base}/simulation-rooms?roomId=flow-preview`);
    assert.equal(surface.status,200);
    assert.equal(surface.headers.get("x-frame-options"),null);
    assert.match(surface.headers.get("content-security-policy"),/frame-ancestors 'self'/);
    assert.match(await surface.text(),/simulation-rooms-client.js/);
    const registration = await fetch(`${base}/sandbox/auth/register`,{method:"POST",headers:{origin:base,"content-type":"application/json"},body:JSON.stringify({username:"room-tester",displayName:"Room Tester",password:"test-only-room-password"})});
    const cookie=registration.headers.get("set-cookie").split(";")[0];
    const principal=await (await fetch(`${base}/v1/session`,{headers:{cookie}})).json();
    const headers={cookie,origin:base,"x-spmt-tenant":principal.tenantIds[0],"content-type":"application/json","idempotency-key":"room-preview"};
    assert.equal((await fetch(`${base}/v1/simulation-rooms/events`,{method:"POST",headers,body:JSON.stringify({schemaVersion:1,roomId:"preview",lane:"chat",direction:"ingress",title:"Input",body:"hello",occurredAt:new Date().toISOString()})})).status,200);
    assert.equal((await (await fetch(`${base}/v1/simulation-rooms`,{headers})).json()).length,1);
    assert.equal((await (await fetch(`${base}/v1/simulation-rooms/events?roomId=preview`,{headers})).json()).length,1);
    assert.equal((await fetch(`${base}/v1/simulation-rooms?roomId=preview`,{method:"DELETE",headers:{...headers,origin:"https://other.test"}})).status,403);
    assert.equal((await fetch(`${base}/v1/simulation-rooms?roomId=preview`,{method:"DELETE",headers:{...headers,"idempotency-key":"room-delete"}})).status,200);
    assert.deepEqual(await (await fetch(`${base}/v1/simulation-rooms`,{headers})).json(),[]);
  });
});

test("developer console exposes an editable candidate but registers only through the SDK", async () => {
  const directory = mkdtempSync(join(tmpdir(), "spmt-empty-catalog-"));
  const spmt = createSpmtService({ databasePath: join(directory, "spmt-empty.sqlite"), webhookKey: Buffer.alloc(32, 8), host: "127.0.0.1", port: 0, publicBaseUrl: "https://test-green.sprites.app", runtimeMode: "sandbox", sandboxFixtures: false, sandboxOwnerUsername: "mtman1987" });
  let web;
  try {
    await spmt.listen(); const spmtAddress = spmt.server.address(); assert.ok(spmtAddress && typeof spmtAddress !== "string");
    const candidate = nebulaArcadeCatalogRegistration("https://test-green.sprites.app/apps/nebula-arcade?surface=workspace");
    web = createSpaceMountainWebHost({ spmtOrigin: `http://127.0.0.1:${spmtAddress.port}`, host: "127.0.0.1", port: 0, candidateManifest: candidate });
    await web.listen(); const webAddress = web.server.address(); assert.ok(webAddress && typeof webAddress !== "string"); const base = `http://127.0.0.1:${webAddress.port}`; const origin = new URL(base).origin;
    const ordinaryRegistration = await fetch(`${base}/sandbox/auth/register`, { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify({ displayName: "Empty Captain", username: "empty-captain", password: "sandbox-only-password" }) });
    const ordinaryCookie = (ordinaryRegistration.headers.get("set-cookie") ?? "").split(";")[0]; assert.ok(ordinaryCookie);
    const ordinaryImport = await fetch(`${base}/sandbox/developer/import-manifest`, { method: "POST", headers: { cookie: ordinaryCookie, origin, "content-type": "application/json" }, body: JSON.stringify({ manifestUrl: "/sandbox/candidate-app" }) });
    assert.equal(ordinaryImport.status, 403);
    const registration = await fetch(`${base}/sandbox/auth/register`, { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify({ displayName: "Mtman1987", username: "mtman1987", password: "sandbox-owner-password" }) });
    const cookie = (registration.headers.get("set-cookie") ?? "").split(";")[0]; assert.ok(cookie);
    const page = await (await fetch(base)).text();
    assert.match(page, /Add developer app/);
    assert.match(page, /Load Nebula Arcade example/);
    assert.doesNotMatch(page, /Publish Nebula Arcade through SDK/);
    const client = new SpmtClient({ baseUrl: base, appId: "spacemountain", fetchImpl: (input, init = {}) => { const headers = new Headers(init.headers); headers.set("cookie", cookie); if (init.method === "POST") headers.set("origin", origin); return fetch(input, { ...init, headers }); } });
    assert.deepEqual(await client.listApps(), []);
    assert.equal((await (await fetch(`${base}/sandbox/candidate-app`)).json()).appId, "nebula-arcade");
    const unauthenticatedImport = await fetch(`${base}/sandbox/developer/import-manifest`, { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify({ manifestUrl: "/sandbox/candidate-app" }) });
    assert.equal(unauthenticatedImport.status, 401);
    const crossOriginImport = await fetch(`${base}/sandbox/developer/import-manifest`, { method: "POST", headers: { cookie, origin: "https://attacker.invalid", "content-type": "application/json" }, body: JSON.stringify({ manifestUrl: "/sandbox/candidate-app" }) });
    assert.equal(crossOriginImport.status, 403);
    const imported = await fetch(`${base}/sandbox/developer/import-manifest`, { method: "POST", headers: { cookie, origin, "content-type": "application/json" }, body: JSON.stringify({ manifestUrl: "/sandbox/candidate-app" }) });
    assert.equal(imported.status, 200);
    assert.equal((await imported.json()).appId, "nebula-arcade");
    const blockedPrivateImport = await fetch(`${base}/sandbox/developer/import-manifest`, { method: "POST", headers: { cookie, origin, "content-type": "application/json" }, body: JSON.stringify({ manifestUrl: "https://127.0.0.1/app.json" }) });
    assert.equal(blockedPrivateImport.status, 400);
    const published = await client.registerApp(candidate);
    assert.equal(published.appId, "nebula-arcade");
    assert.deepEqual((await client.listApps()).map((app) => app.appId), ["nebula-arcade"]);
  } finally { if (web) await web.close(); await spmt.close(); rmSync(directory, { recursive: true, force: true }); }
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

    spmt.authority.linkProvider(principal.actorId, "twitch", "green-twitch-user");
    const providerLinks = await (await fetch(`${base}/v1/identity/providers`, { headers: { cookie } })).json();
    assert.equal(providerLinks[0].providerUserId, "green-twitch-user");
    const unlinkProvider = await fetch(`${base}/v1/identity/providers/twitch/green-twitch-user`, { method: "DELETE", headers: { cookie, origin } });
    assert.equal(unlinkProvider.status, 200);
    assert.deepEqual(await (await fetch(`${base}/v1/identity/providers`, { headers: { cookie } })).json(), []);

    const workspaceBefore = await (await fetch(`${base}/v1/workspace/profile`, { headers: { cookie, "x-spmt-tenant": principal.tenantIds[0] } })).json();
    const workspaceUpdate = await fetch(`${base}/v1/workspace/profile`, { method: "PATCH", headers: { cookie, origin, "x-spmt-tenant": principal.tenantIds[0], "content-type": "application/json" }, body: JSON.stringify({ expectedRevision: workspaceBefore.revision, patch: { appearance: { theme: "dark", accent: "#ff7a18", backgroundUrl: "https://images.example/station.jpg" }, dockSlots: ["spacemountain", null, null] } }) });
    assert.equal(workspaceUpdate.status, 200);
    const workspaceAfter = await workspaceUpdate.json();
    assert.equal(workspaceAfter.revision, workspaceBefore.revision + 1);
    assert.equal(workspaceAfter.appearance.backgroundUrl, "https://images.example/station.jpg");
    assert.deepEqual(workspaceAfter.dockSlots, ["spacemountain", null, null]);

    const overlayPreview = await fetch(`${base}/v1/simulation-rooms/events`, { method: "POST", headers: { cookie, origin, "x-spmt-tenant": principal.tenantIds[0], "content-type": "application/json", "idempotency-key": "overlay-preview-1" }, body: JSON.stringify({ schemaVersion: 1, roomId: "overlay:public:scene-1", lane: "overlay", direction: "preview", title: "Overlay Bay public scene preview", body: "Scene 1 · 2 visible sources", data: { sceneId: "scene-1" }, occurredAt: "2026-09-05T12:00:00.000Z" }) });
    assert.equal(overlayPreview.status, 200, "Overlay Bay can publish a validated preview through the signed-in session");
    const previewEvents = await (await fetch(`${base}/v1/events?type=spmt.simulation-room.event.v1`, { headers: { cookie, "x-spmt-tenant": principal.tenantIds[0] } })).json();
    assert.equal(previewEvents[0].payload.roomId, "overlay:public:scene-1");
    const arbitraryEvent = await fetch(`${base}/v1/events`, { method: "POST", headers: { cookie, origin, "x-spmt-tenant": principal.tenantIds[0], "content-type": "application/json", "idempotency-key": "arbitrary-event-1" }, body: JSON.stringify({ type: "workspace.changed", payload: { revision: 99 } }) });
    assert.equal(arbitraryEvent.status, 404, "the browser still cannot publish arbitrary app events");

    const conversation = spmt.data.createConversation({ tenantId: principal.tenantIds[0], participantUserIds: [principal.actorId, "user-recipient"], kind: "direct", title: "Green parity conversation" });
    const messageResponse = await fetch(`${base}/v1/commlink/messages`, { method: "POST", headers: { cookie, origin, "x-spmt-tenant": principal.tenantIds[0], "content-type": "application/json" }, body: JSON.stringify({ conversationId: conversation.id, recipientUserIds: ["user-recipient"], text: "canonical green reply" }) });
    assert.equal(messageResponse.status, 200);
    const message = await messageResponse.json();
    assert.equal(message.text, "canonical green reply");
    const searchResults = await (await fetch(`${base}/v1/commlink/search?q=green%20reply&userId=${encodeURIComponent(principal.actorId)}`, { headers: { cookie, "x-spmt-tenant": principal.tenantIds[0] } })).json();
    assert.equal(searchResults[0].id, message.id);

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
    const stellarDelete = await fetch(`${base}/v1/stellar/me`, { method: "DELETE", headers: { cookie, origin, "x-spmt-tenant": principal.tenantIds[0] } });
    assert.equal(stellarDelete.status, 200, "a signed-in user can invoke the private Stella deletion route through the browser gateway");
    assert.equal(typeof (await stellarDelete.json()).deletedJobs, "number");

    const ordinaryOperationsLogsResponse = await fetch(`${base}/v1/operations/logs`, { headers: { cookie, "x-spmt-tenant": principal.tenantIds[0] } });
    assert.equal(ordinaryOperationsLogsResponse.status, 403, "ordinary captains must not see owner operations evidence");

    const ownerRegistration = await fetch(`${base}/sandbox/auth/register`, { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify({ displayName: "Mtman1987", username: "mtman1987", password: "sandbox-owner-password" }) });
    assert.equal(ownerRegistration.status, 201);
    const ownerCookie = (ownerRegistration.headers.get("set-cookie") ?? "").split(";")[0];
    assert.ok(ownerCookie);
    const ownerPrincipal = await (await fetch(`${base}/v1/session`, { headers: { cookie: ownerCookie } })).json();
    const ownerTenantId = ownerPrincipal.tenantIds[0];
    assert.ok(ownerTenantId);

    const operationsLogsResponse = await fetch(`${base}/v1/operations/logs`, { headers: { cookie: ownerCookie, "x-spmt-tenant": ownerTenantId } });
    assert.equal(operationsLogsResponse.status, 200);
    const operationsLogs = await operationsLogsResponse.json();
    assert.equal(operationsLogs.length, 1);
    assert.equal(operationsLogs[0].kind, "sandbox.fixture");
    assert.match(operationsLogs[0].summary, /Synthetic sandbox fixture/);
    const coderDescriptor = await (await fetch(`${base}/v1/operations/coder`, { headers: { cookie: ownerCookie, "x-spmt-tenant": ownerTenantId } })).json();
    assert.equal(coderDescriptor.executionOwner, "mtman-machine-rotator");
    assert.equal(coderDescriptor.availability, "unavailable");
    const coderDraftResponse = await fetch(`${base}/v1/operations/coder/jobs`, { method: "POST", headers: { cookie: ownerCookie, origin, "x-spmt-tenant": ownerTenantId, "content-type": "application/json", "idempotency-key": "browser-coder-draft-1" }, body: JSON.stringify({ targetAppId: "spacemountain", prompt: "Inspect the synthetic operations path without changing code", evidenceLogIds: [operationsLogs[0].id] }) });
    assert.equal(coderDraftResponse.status, 200);
    const coderDraft = await coderDraftResponse.json();
    assert.equal(coderDraft.job.state, "draft");
    assert.match(coderDraft.job.unavailableReason, /not connected/);
    assert.doesNotMatch(JSON.stringify(coderDraft), /diff|patch|deployed/);
    const coderJobs = await (await fetch(`${base}/v1/operations/coder/jobs`, { headers: { cookie: ownerCookie, "x-spmt-tenant": ownerTenantId } })).json();
    assert.equal(coderJobs.length, 1);

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
    const crossOriginSimulation = await fetch(`${base}/v1/simulation-rooms/events`, { method: "POST", headers: { origin: "https://attacker.invalid", "content-type": "application/json", "idempotency-key": "attacker-simulation" }, body: JSON.stringify({ schemaVersion: 1, roomId: "overlay:public:fake", lane: "overlay", direction: "preview", title: "Fake", body: "Fake", occurredAt: "2026-09-05T12:00:00.000Z" }) });
    assert.equal(crossOriginSimulation.status, 403);
    const crossOriginUnlink = await fetch(`${base}/v1/identity/providers/twitch/attacker`, { method: "DELETE", headers: { origin: "https://attacker.invalid" } });
    assert.equal(crossOriginUnlink.status, 403);
    const crossOriginStellarDelete = await fetch(`${base}/v1/stellar/me`, { method: "DELETE", headers: { origin: "https://attacker.invalid" } });
    assert.equal(crossOriginStellarDelete.status, 403);
    assert.equal((await fetch(`${base}/v1/auth/service-token`, { method: "POST", headers: { origin: new URL(base).origin, "content-type": "application/json" }, body: "{}" })).status, 404);
    assert.equal((await fetch(`${base}/v1/auth/login`, { method: "POST", headers: { origin: new URL(base).origin, "content-type": "application/json" }, body: "{}" })).status, 404);
    assert.equal((await fetch(`${base}/v1/oauth/token`, { method: "POST", headers: { origin: new URL(base).origin, "content-type": "application/json" }, body: "{}" })).status, 404);
    assert.equal((await fetch(`${base}/v1/webhooks`)).status, 404);
    assert.equal((await fetch(`${base}/v1/commlink/live`)).status, 401, "the browser may read only its authenticated tenant projection");
    assert.equal((await fetch(`${base}/v1/commlink/live`, { method: "POST", headers: { origin: new URL(base).origin, "content-type": "application/json" }, body: "{}" })).status, 404, "the browser cannot impersonate Chat Gateway ingestion");
    assert.equal((await fetch(`${base}/v1/llm/health`)).status, 404);
    assert.equal((await fetch(`${base}/v1/llm/chat/completions`, { method: "POST", headers: { origin: new URL(base).origin, "content-type": "application/json" }, body: "{}" })).status, 404, "the browser cannot bypass durable Stellar jobs and usage metering");
    assert.equal((await fetch(`${base}/v1/operations/logs`, { method: "POST", headers: { origin: new URL(base).origin, "content-type": "application/json" }, body: "{}" })).status, 404, "browser users cannot impersonate app log publishers");
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
  assert.deepEqual(validateSandboxServiceEnvironment({ ...service, SPMT_SANDBOX_FIXTURES: "0" }), { databasePath: service.DATABASE_PATH, publicBaseUrl: service.SPMT_PUBLIC_URL, host: "127.0.0.1", sandboxApps: [] });
  assert.throws(() => validateSandboxServiceEnvironment({ ...service, SPMT_SANDBOX_FIXTURES: "yes" }), /must be 0 or 1/);
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

test("bundled review apps are installed into tenants that predate the deployment", async () => {
  const directory = mkdtempSync(join(tmpdir(), "spmt-sandbox-app-upgrade-"));
  const databasePath = join(directory, "spmt-green-sandbox.sqlite");
  const options = { databasePath, webhookKey: Buffer.alloc(32, 4), host: "127.0.0.1", port: 0, publicBaseUrl: "https://upgrade-green.sprites.app", runtimeMode: "sandbox" };
  const first = createSpmtService(options);
  try {
    await first.listen();
    first.authority.ensureUser("existing-owner");
    first.control.registerTenant({ tenantId: "existing-tenant", ownerUserId: "existing-owner", displayName: "Existing Captain" });
    first.authority.getOrCreateWorkspace("existing-tenant");
    await first.close();

    const manifest = nebulaArcadeCatalogRegistration("https://upgrade-green.sprites.app/apps/nebula-arcade?surface=workspace");
    const upgraded = createSpmtService({ ...options, sandboxApps: [manifest] });
    try {
      await upgraded.listen();
      assert.deepEqual(upgraded.control.listApps().map((app) => app.appId), ["nebula-arcade"]);
      assert.deepEqual(upgraded.control.listInstalls("existing-tenant").map((install) => ({ appId: install.appId, enabled: install.enabled })), [{ appId: "nebula-arcade", enabled: true }]);
    } finally { await upgraded.close(); }
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
  assert.deepEqual(allowed, ["github.com", "*.github.com", "githubusercontent.com", "*.githubusercontent.com", "npmjs.org", "*.npmjs.org", "huggingface.co", "*.huggingface.co", "hf.co", "*.hf.co", "spmt.live"]);
  const runner = readFileSync(new URL("../scripts/sprites/run-supervised-sandbox.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(runner, /sprite-env|services\s+(?:create|start|restart)/);
  assert.match(runner, /SPMT_OUTBOUND_MODE: "disabled"/);
  assert.match(runner, /offline-network-guard/);
  assert.match(runner, /NODE_OPTIONS: `--import=\$\{offlineNetworkGuardPath\}`/);
  assert.match(runner, /randomBytes\(32\)\.toString\("base64url"\)/);
  const client = readFileSync(new URL("../apps/spacemountain-web/src/client.ts", import.meta.url), "utf8");
  assert.match(client, /document\.visibilityState !== "visible"/);
  assert.match(client, /await spmt\.listApps\(\)/);
  assert.match(client, /next !== registryFingerprint/);
  assert.match(client, /await spmt\.registerApp\(manifest\)/);
  assert.match(client, /\/sandbox\/developer\/import-manifest/);
  assert.doesNotMatch(client, /function publishCandidate/);
  assert.doesNotMatch(client, /localStorage|sessionStorage/);
});

test("supervised runner makes both layers healthy and stops both children together", async () => {
  const directory = mkdtempSync(join(tmpdir(), "spmt-supervised-runner-"));
  const spmtPort = await freePort();
  let webPort = await freePort();
  while (webPort === spmtPort) webPort = await freePort();
  const child = spawn(process.execPath, ["scripts/sprites/run-supervised-sandbox.mjs", "--public-url", `http://localhost:${webPort}`, "--data-root", directory, "--build-sha", "runner-test", "--spmt-port", String(spmtPort), "--web-port", String(webPort), "--offline-network-guard", "1"], { cwd: new URL("..", import.meta.url), stdio: ["ignore", "pipe", "pipe"] });
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
    assert.equal(spmt.sandboxFixtures, false);
    assert.equal(web.ready, true);
    assert.match(await (await fetch(`http://127.0.0.1:${webPort}/`)).text(), /Add developer app/);
    child.kill("SIGTERM");
    const exit = await new Promise((done) => child.once("exit", (code, signal) => done({ code, signal })));
    assert.deepEqual(exit, { code: 0, signal: null });
    await waitUntil(async () => !(await reachable(spmtPort)) && !(await reachable(webPort)), 5_000, () => "A supervised child port remained reachable after termination");
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    rmSync(directory, { recursive: true, force: true });
  }
});

test("supervised runner seeds the canonical first-party app pool and launches Nebula Arcade", async () => {
  const directory = mkdtempSync(join(tmpdir(), "spmt-supervised-candidate-"));
  const ports = new Set();
  while (ports.size < 3) ports.add(await freePort());
  const [spmtPort, webPort, nebulaArcadePort] = ports;
  const base = `http://127.0.0.1:${webPort}`;
  const child = spawn(process.execPath, ["scripts/sprites/run-supervised-sandbox.mjs", "--candidate-app", "nebula-arcade", "--public-url", `http://localhost:${webPort}`, "--data-root", directory, "--build-sha", "candidate-test", "--spmt-port", String(spmtPort), "--web-port", String(webPort), "--nebula-arcade-port", String(nebulaArcadePort), "--offline-network-guard", "1"], { cwd: new URL("..", import.meta.url), stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => { output += chunk; });
  child.stderr.on("data", (chunk) => { output += chunk; });
  try {
    await waitUntil(() => output.includes("The canonical app pool contains Commlink, Chat Gateway, Stellar Core, Mission Control, Nebula Arcade."), 20_000, () => `Runner output:\n${output}`);
    const page = await (await fetch(`${base}/`)).text();
    assert.match(page, /Add developer app/);
    assert.match(page, /Load Nebula Arcade example/);
    assert.doesNotMatch(page, /Publish Nebula Arcade through SDK/);
    assert.equal((await fetch(`${base}/apps/nebula-arcade`)).status, 200);
    assert.equal((await fetch(`${base}/apps/commlink`)).status, 200);
    assert.equal((await fetch(`${base}/apps/stellar-core`)).status, 200);
    assert.equal((await fetch(`${base}/apps/mission-control`)).status, 200);
    const origin = new URL(base).origin;
    const registration = await fetch(`${base}/sandbox/auth/register`, { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify({ displayName: "Candidate Captain", username: "candidate-captain", password: "sandbox-only-password" }) });
    assert.equal(registration.status, 201);
    const cookie = (registration.headers.get("set-cookie") ?? "").split(";")[0];
    assert.ok(cookie);
    const client = new SpmtClient({ baseUrl: base, appId: "spacemountain", fetchImpl: (input, init = {}) => { const headers = new Headers(init.headers); headers.set("cookie", cookie); if (init.method === "POST") headers.set("origin", origin); return fetch(input, { ...init, headers }); } });
    assert.deepEqual((await client.listApps()).map((app) => app.appId).sort(), ["chat-gateway", "commlink", "mission-control", "nebula-arcade", "stellar-core"]);
    assert.deepEqual((await client.listInstalls((await registration.json()).tenantId)).map((install) => install.appId).sort(), ["chat-gateway", "commlink", "mission-control", "nebula-arcade", "stellar-core"]);
    const candidate = await (await fetch(`${base}/sandbox/candidate-app`)).json();
    await assert.rejects(() => client.registerApp(candidate), (error) => error?.status === 403);

    const ownerRegistration = await fetch(`${base}/sandbox/auth/register`, { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify({ displayName: "Mtman1987", username: "mtman1987", password: "sandbox-owner-password" }) });
    assert.equal(ownerRegistration.status, 201);
    const ownerCookie = (ownerRegistration.headers.get("set-cookie") ?? "").split(";")[0];
    assert.ok(ownerCookie);
    const ownerClient = new SpmtClient({ baseUrl: base, appId: "spacemountain", fetchImpl: (input, init = {}) => { const headers = new Headers(init.headers); headers.set("cookie", ownerCookie); if (init.method === "POST") headers.set("origin", origin); return fetch(input, { ...init, headers }); } });
    assert.deepEqual((await ownerClient.listApps()).map((app) => app.appId).sort(), ["chat-gateway", "commlink", "mission-control", "nebula-arcade", "stellar-core"]);
    child.kill("SIGTERM");
    const exit = await new Promise((done) => child.once("exit", (code, signal) => done({ code, signal })));
    assert.deepEqual(exit, { code: 0, signal: null });
    await waitUntil(async () => !(await reachable(spmtPort)) && !(await reachable(webPort)) && !(await reachable(nebulaArcadePort)), 5_000, () => "A supervised candidate port remained reachable after termination");
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


test("simulation stages and sandboxed Chicken Royale dependency are served through Apollo ingress", async () => withSandbox(async ({base}) => {
  for (const path of ["/simulation-rooms/arcade", "/simulation-rooms/tag", "/assets/nebula-arcade/widgets/chickenroyale.html"]) {
    const response=await fetch(base+path);assert.equal(response.status,200,path);assert.equal(response.headers.get("x-frame-options"),null);assert.match(response.headers.get("content-security-policy"),/frame-ancestors 'self'/);
  }
  const script=await fetch(base+"/assets/nebula-arcade/widgets/thirdparty/three.min.js");assert.equal(script.status,200);assert.equal(script.headers.get("cross-origin-resource-policy"),"cross-origin");assert.equal(script.headers.get("access-control-allow-origin"),"*");
}));

test("Commlink recipient discovery, mail and read controls work through the signed-in browser host", async () => {
  await withSandbox(async ({ spmt, base }) => {
    const registration = await fetch(`${base}/sandbox/auth/register`, { method: "POST", headers: { origin: base, "content-type": "application/json" }, body: JSON.stringify({ displayName: "Commlink sender", username: "mail-sender", password: "browser-mail-password" }) });
    assert.equal(registration.status, 201);
    const cookie = registration.headers.get("set-cookie").split(";")[0];
    const principal = await (await fetch(`${base}/v1/session`, { headers: { cookie } })).json();
    const tenantId = principal.tenantIds[0];
    spmt.authority.ensureUser("mail-recipient");
    spmt.data.registerUser({ userId: "mail-recipient", username: "mail-recipient", displayName: "Recipient", password: "recipient-password", tenantIds: [tenantId] });
    const client = new SpmtClient({ baseUrl: base, appId: "commlink", fetchImpl: (input, init) => { const headers = new Headers(init?.headers); headers.set("cookie", cookie); headers.set("origin", base); return fetch(input, { ...init, headers }); } });
    assert.deepEqual((await client.findCommlinkRecipients(tenantId, "recipient")).map((person) => person.userId), ["mail-recipient"]);
    const sent = await client.composeCommlinkMail(tenantId, ["mail-recipient"], "Browser-host message", "browser-mail-1", "Working controls");
    assert.equal(sent.message.text, "Browser-host message");
    assert.equal((await client.composeCommlinkMail(tenantId, ["mail-recipient"], "Browser-host message", "browser-mail-1", "Working controls")).duplicate, true);
    assert.equal((await client.listCommlinkMailbox(tenantId, "sent"))[0].id, sent.message.id);
    await client.markCommlinkConversationRead(tenantId, sent.conversation.id);
    assert.equal((await client.markAllCommlinkRead(tenantId)).updated, 1);
    const crossOrigin = await fetch(`${base}/v1/commlink/mail`, { method: "POST", headers: { cookie, origin: "https://outside.example", "content-type": "application/json", "x-spmt-tenant": tenantId }, body: "{}" });
    assert.equal(crossOrigin.status, 403, "mail mutations retain the browser origin boundary");
    assert.equal((await fetch(`${base}/v1/commlink/recipients`)).status, 403, "recipient discovery still requires sign-in");
  });
});
