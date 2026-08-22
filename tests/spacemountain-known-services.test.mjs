import assert from "node:assert/strict";
import test from "node:test";
import { SpaceMountainShellController, buildAppFrameTarget } from "../apps/spacemountain/dist/index.js";

function fakeClient(overrides = {}) {
  const base = {
    getSession: async () => ({ actorType: "user", actorId: "user-1", tenantIds: ["tenant-a"] }),
    getWorkspaceProfile: async () => ({ tenantId: "tenant-a", revision: 4, appearance: { theme: "dark" }, dockSlots: ["streamweaver", null, "chat-tag"] }),
    getXpBalance: async () => ({ tenantId: "tenant-a", userId: "user-1", balance: 42 }),
    listApps: async () => [
      { appId: "streamweaver", name: "StreamWeaver", description: "Automation", version: "1", launchUrl: "https://streamweaver.example/dashboard", surfaces: ["shell", "standalone"], allowedScopes: ["chat:read"] },
      { appId: "chat-tag", name: "ChatTag", description: "Games", version: "1", launchUrl: "https://chat-tag.example/", surfaces: ["shell", "overlay"], allowedScopes: ["game:read"] },
    ],
    listInstalls: async () => [{ tenantId: "tenant-a", appId: "streamweaver", enabled: true, grantedScopes: ["chat:read"] }],
    listEntitlements: async () => [{ tenantId: "tenant-a", appId: "streamweaver", key: "tier", value: "standard" }],
    listConversations: async () => [{ id: "conv-1", tenantId: "tenant-a" }],
    listNotifications: async () => [{ id: "note-1", tenantId: "tenant-a", title: "Welcome" }],
    listAthenaContext: async () => [{ id: "ctx-1", text: "Creator context" }],
    listAthenaCommands: async () => [{ id: "help", availability: "available" }, { id: "voice", availability: "unavailable", unavailableReason: "runtime not connected" }],
    request: async (path) => path === "/v1/auth/setup-options" ? { options: [{ id: "spacemountain-invite", primary: true }, { id: "discord-dm-reset", primary: false }] } : {},
    installApp: async () => ({}), disableApp: async () => ({}), updateWorkspaceProfile: async () => ({}), markNotificationRead: async () => ({}),
  };
  return { ...base, ...overrides };
}

test("SpaceMountain loads canonical known services into one ready shell snapshot", async () => {
  const controller = new SpaceMountainShellController(fakeClient());
  const snapshot = await controller.load({ tenantId: "tenant-a", userId: "user-1" });
  assert.equal(snapshot.state, "ready");
  assert.equal(snapshot.xp.balance, 42);
  assert.equal(snapshot.apps.length, 2);
  assert.equal(snapshot.apps.find((app) => app.appId === "streamweaver")?.enabled, true);
  assert.equal(snapshot.apps.find((app) => app.appId === "chat-tag")?.installed, false);
  assert.equal(snapshot.conversations.length, 1);
  assert.equal(snapshot.notifications.length, 1);
  assert.equal(snapshot.athena.commands[1].unavailableReason, "runtime not connected");
  assert.equal(snapshot.setupOptions.length, 2);
  assert.ok(Object.values(snapshot.sources).every((entry) => entry.state === "ready"));
});

test("optional service failure degrades only the shell while session/workspace remain usable", async () => {
  const controller = new SpaceMountainShellController(fakeClient({ listAthenaCommands: async () => { throw new Error("Athena catalog unavailable"); } }));
  const snapshot = await controller.load({ tenantId: "tenant-a", userId: "user-1" });
  assert.equal(snapshot.state, "degraded");
  assert.equal(snapshot.sources.athena.state, "degraded");
  assert.match(snapshot.sources.athena.detail, /catalog unavailable/);
  assert.equal(snapshot.sources.workspace.state, "ready");
  assert.equal(snapshot.workspace.revision, 4);
});

test("session or workspace failure makes SpaceMountain honestly unavailable", async () => {
  const controller = new SpaceMountainShellController(fakeClient({ getWorkspaceProfile: async () => { throw new Error("authority offline"); } }));
  const snapshot = await controller.load({ tenantId: "tenant-a", userId: "user-1" });
  assert.equal(snapshot.state, "unavailable");
  assert.equal(snapshot.sources.workspace.state, "degraded");
  assert.match(snapshot.sources.workspace.detail, /authority offline/);
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
