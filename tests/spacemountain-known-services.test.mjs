import assert from "node:assert/strict";
import test from "node:test";
import { SpaceMountainShellController, buildAppFrameTarget } from "../apps/spacemountain/dist/index.js";

function fakeClient(overrides = {}) {
  const base = {
    getSession: async () => ({
      actorType: "user",
      actorId: "user-1",
      tenantIds: ["tenant-a"],
      scopes: ["operations:logs:read", "operations:coder:read", "operations:coder:invoke"],
    }),
    listProviderLinks: async () => [{ userId: "user-1", provider: "twitch", providerUserId: "twitch-1", linkedAt: "2026-08-23T00:00:00.000Z" }],
    getWorkspaceProfile: async () => ({ tenantId: "tenant-a", revision: 4, appearance: { theme: "dark" }, dockSlots: ["streamweaver", null, "chat-tag"] }),
    getXpBalance: async () => ({ tenantId: "tenant-a", userId: "user-1", balance: 42 }),
    listApps: async () => [
      { appId: "streamweaver", name: "StreamWeaver", description: "Automation", version: "1", launchUrl: "https://streamweaver.example/dashboard", surfaces: ["shell", "standalone"], allowedScopes: ["chat:read"] },
      { appId: "chat-tag", name: "ChatTag", description: "Games", version: "1", launchUrl: "https://chat-tag.example/", surfaces: ["shell", "overlay"], allowedScopes: ["game:read"] },
    ],
    listInstalls: async () => [{ tenantId: "tenant-a", appId: "streamweaver", enabled: true, grantedScopes: ["chat:read"] }],
    listEntitlements: async () => [{ tenantId: "tenant-a", appId: "streamweaver", key: "tier", value: "standard" }],
    listEvents: async () => [{ id: "evt-1", tenantId: "tenant-a", sourceAppId: "streamweaver", type: "stream.ready", payload: { ready: true } }],
    listConversations: async () => [{ id: "conv-1", tenantId: "tenant-a" }],
    listNotifications: async () => [{ id: "note-1", tenantId: "tenant-a", title: "Welcome" }],
    listStellarContext: async () => [{ id: "ctx-1", text: "Creator context" }],
    listStellarCapabilities: async () => [{ id: "help", availability: "available" }, { id: "voice", availability: "unavailable", unavailableReason: "runtime not connected" }],
    listOperationsLogs: async () => [{ schemaVersion: 1, id: "oplog-1", tenantId: "tenant-a", sourceAppId: "streamweaver", reporterId: "streamweaver", level: "warn", kind: "runtime.health", summary: "Worker is cold", labels: [], occurredAt: "2026-08-22T12:00:00.000Z", recordedAt: "2026-08-22T12:00:00.000Z" }],
    getCoderDescriptor: async () => ({ schemaVersion: 1, id: "spmt.operations.coder", executionOwner: "mtman-machine-rotator", availability: "unavailable", requiredScopes: ["operations:logs:read", "operations:coder:invoke"], unavailableReason: "worker not connected" }),
    listCoderJobs: async () => [],
    request: async (path) => path === "/v1/auth/setup-options" ? { options: [{ id: "spacemountain-invite", primary: true }, { id: "discord-dm-reset", primary: false }] } : {},
    installApp: async () => ({}), disableApp: async () => ({}), updateWorkspaceProfile: async () => ({}), markNotificationRead: async () => ({}), unlinkProvider: async () => ({}),
  };
  return { ...base, ...overrides };
}

test("SpaceMountain loads canonical known services into one ready shell snapshot", async () => {
  const controller = new SpaceMountainShellController(fakeClient());
  const snapshot = await controller.load({ tenantId: "tenant-a", userId: "user-1" });
  assert.equal(snapshot.state, "ready");
  assert.equal(snapshot.xp.balance, 42);
  assert.equal(snapshot.providerLinks[0].provider, "twitch");
  assert.equal(snapshot.apps.length, 2);
  assert.equal(snapshot.apps.find((app) => app.appId === "streamweaver")?.enabled, true);
    assert.equal(snapshot.apps.find((app) => app.appId === "chat-tag")?.installed, false);
    assert.equal(snapshot.events[0].type, "stream.ready");
    assert.equal(snapshot.conversations.length, 1);
    assert.equal(snapshot.notifications.length, 1);
    assert.equal(snapshot.stellar.capabilities[1].unavailableReason, "runtime not connected");
    assert.equal(snapshot.operations.logs[0].sourceAppId, "streamweaver");
    assert.equal(snapshot.operations.coder.availability, "unavailable");
  assert.equal(snapshot.setupOptions.length, 2);
  assert.ok(Object.values(snapshot.sources).every((entry) => entry.state === "ready"));
});

test("optional service failure degrades only the shell while session/workspace remain usable", async () => {
  const controller = new SpaceMountainShellController(fakeClient({ listStellarCapabilities: async () => { throw new Error("Stellar Core catalog unavailable"); } }));
  const snapshot = await controller.load({ tenantId: "tenant-a", userId: "user-1" });
  assert.equal(snapshot.state, "degraded");
  assert.equal(snapshot.sources.stellar.state, "degraded");
  assert.match(snapshot.sources.stellar.detail, /catalog unavailable/);
  assert.equal(snapshot.sources.workspace.state, "ready");
  assert.equal(snapshot.workspace.revision, 4);
});

test("operations failure degrades only Mission Control and preserves the front door", async () => {
  const controller = new SpaceMountainShellController(fakeClient({ listOperationsLogs: async () => { throw new Error("Rotator projection unavailable"); } }));
  const snapshot = await controller.load({ tenantId: "tenant-a", userId: "user-1" });
  assert.equal(snapshot.state, "degraded");
  assert.equal(snapshot.sources.operations.state, "degraded");
  assert.match(snapshot.sources.operations.detail, /Rotator projection unavailable/);
  assert.equal(snapshot.sources.session.state, "ready");
});

test("ordinary sessions without operator grants never call or expose Mission Control", async () => {
  const denied = async () => { throw new Error("operations endpoint must not be called"); };
  const controller = new SpaceMountainShellController(fakeClient({
    getSession: async () => ({ actorType: "user", actorId: "user-1", tenantIds: ["tenant-a"], scopes: ["workspace:read"] }),
    listOperationsLogs: denied,
    getCoderDescriptor: denied,
    listCoderJobs: denied,
  }));
  const snapshot = await controller.load({ tenantId: "tenant-a", userId: "user-1" });
  assert.equal(snapshot.state, "ready");
  assert.equal(snapshot.sources.operations.state, "ready");
  assert.deepEqual(snapshot.operations, {
    canReadLogs: false,
    canReadCoder: false,
    canInvokeCoder: false,
    logs: [],
    coder: null,
    jobs: [],
  });
});

test("session or workspace failure makes SpaceMountain honestly unavailable", async () => {
  const controller = new SpaceMountainShellController(fakeClient({ getWorkspaceProfile: async () => { throw new Error("authority offline"); } }));
  const snapshot = await controller.load({ tenantId: "tenant-a", userId: "user-1" });
  assert.equal(snapshot.state, "unavailable");
  assert.equal(snapshot.sources.workspace.state, "degraded");
  assert.match(snapshot.sources.workspace.detail, /authority offline/);
});

test("SpaceMountain saves one revisioned canonical workspace through the public SDK", async () => {
  let received;
  const controller = new SpaceMountainShellController(fakeClient({ updateWorkspaceProfile: async (...args) => { received = args; return { revision: 5 }; } }));
  const patch = { appearance: { theme: "dark", accent: "#ff7a18", backgroundUrl: "https://images.example/station.jpg" }, dockSlots: ["streamweaver", null, "chat-tag"] };
  const result = await controller.saveWorkspace("tenant-a", 4, patch);
  assert.deepEqual(received, ["tenant-a", 4, patch]);
  assert.equal(result.revision, 5);
});

test("SpaceMountain reads, searches, and replies through one Commlink contract", async () => {
  const calls = [];
  const controller = new SpaceMountainShellController(fakeClient({
    listMessages: async (...args) => { calls.push(["list", ...args]); return [{ id: "msg-1", text: "hello" }]; },
    searchCommlink: async (...args) => { calls.push(["search", ...args]); return [{ id: "msg-1", text: "hello" }]; },
    sendCommlinkMessage: async (...args) => { calls.push(["send", ...args]); return { id: "msg-2" }; },
  }));
  assert.equal((await controller.loadConversationMessages("tenant-a", "conv-1"))[0].id, "msg-1");
  assert.equal((await controller.searchCommlink("tenant-a", "hello", "user-1"))[0].id, "msg-1");
  assert.equal((await controller.sendCommlinkMessage("tenant-a", "conv-1", ["user-2"], "reply" )).id, "msg-2");
  assert.deepEqual(calls, [["list", "tenant-a", "conv-1"], ["search", "tenant-a", "hello", "user-1"], ["send", "tenant-a", "conv-1", ["user-2"], "reply"]]);
});

test("AppFrame target carries identity and grants in the bridge launch, never the iframe URL", () => {
  const target = buildAppFrameTarget({
    appId: "streamweaver", name: "StreamWeaver", description: "", version: "1",
    launchUrl: "https://streamweaver.example/dashboard?view=home", surfaces: ["shell", "standalone"], allowedScopes: ["chat:read"],
    installed: true, enabled: true, grantedScopes: ["chat:read"],
  }, "tenant-a", "shell", "launch-1");
  assert.equal(target.allowedOrigin, "https://streamweaver.example");
  assert.equal(target.launch.tenantId, "tenant-a");
  assert.deepEqual(target.launch.requestedScopes, ["chat:read"]);
  assert.equal(new URL(target.url).searchParams.has("tenant"), false);
  assert.equal(new URL(target.url).searchParams.has("scopes"), false);
  assert.equal(new URL(target.url).searchParams.has("token"), false);
});
