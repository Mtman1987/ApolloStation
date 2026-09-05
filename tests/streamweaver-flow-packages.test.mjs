import assert from "node:assert/strict";
import test from "node:test";
import { StreamWeaverFlowPackageStore, legacyCommunityPackages, normalizeFlowPackage } from "../apps/streamweaver/dist/index.js";

const now = () => "2026-09-05T12:00:00.000Z";
const author = { id: "owner-a", displayName: "Owner A" };

function customFlow(packageId = "owner-a.welcome") {
  return {
    schemaVersion: 1,
    kind: "streamweaver.flow-package",
    packageId,
    packageKind: "command_flow",
    installUnit: "flow",
    name: "Welcome",
    description: "Welcome one chatter.",
    visibility: "private",
    collection: "My flows",
    tags: ["welcome"],
    commands: [{ id: "command.welcome", trigger: "!welcome", aliases: [], family: "custom", cooldownSeconds: 0, matcher: "command", runtime: "flow", enabled: false }],
    actions: [{ id: "action.welcome", type: "send-chat", enabled: false, config: { text: "Welcome %userName%!" } }],
  };
}

test("new StreamWeaver tenants are blank while the curated library contains complete mtman1987 flow bundles", () => {
  const store = new StreamWeaverFlowPackageStore(":memory:", now);
  try {
    assert.deepEqual(store.listInstalls("tenant-a"), []);
    assert.deepEqual(store.listInstalledPackages("tenant-a"), []);
    const library = legacyCommunityPackages();
    assert.equal(library.length, 50);
    assert.equal(library.every((item) => item.installUnit === "flow" && item.author.id === "mtman1987"), true);
    assert.equal(library.every((item) => item.actions.length > 0), true);
    assert.equal(library.every((item) => item.commands.filter((command) => command.role === "primary").length === 1), true);
    assert.equal(library.every((item) => item.commands.every((command) => command.actionIds.length > 0 && command.actionIds.every((actionId) => item.actions.some((action) => action.id === actionId)))), true);
    assert.equal(library.some((item) => item.tags.includes("economy") || item.tags.includes("persona") || item.commands.some((command) => command.trigger.toLowerCase() === "!commands")), false);
    assert.deepEqual(library.find((item) => item.packageId === "mtman1987.lurk-chat").commands.map((command) => command.trigger), ["!lurk", "!unlurk"]);
    assert.deepEqual(library.find((item) => item.packageId === "mtman1987.accept").commands.map((command) => command.trigger), ["!accept", "!no", "!yes"]);
    assert.equal(new Set(library.map((item) => item.packageId)).size, library.length);
  } finally { store.close(); }
});

test("installing one library JSON atomically installs its commands, actions, and wiring", () => {
  const store = new StreamWeaverFlowPackageStore(":memory:", now);
  try {
    store.install("tenant-a", "mtman1987.lurk-chat");
    assert.deepEqual(store.listInstalls("tenant-a").map((item) => item.packageId), ["mtman1987.lurk-chat"]);
    assert.equal(store.commandEnabled("tenant-a", "!lurk"), true);
    assert.equal(store.commandEnabled("tenant-a", "!unlurk"), true);
    assert.equal(store.commandEnabled("tenant-a", "!boop"), false);
    const exported = store.exportPackage("tenant-a", "mtman1987.lurk-chat");
    assert.equal(exported.packageId, "mtman1987.lurk-chat");
    assert.equal(exported.commands.length, 2);
    assert.equal(exported.actions.length, 2);
    const streamerBot = store.exportStreamerBot("tenant-a", "mtman1987.lurk-chat");
    assert.equal(streamerBot.commands.length, 2);
    assert.deepEqual(streamerBot.commands.map((command) => command.actionId), ["action.lurk-chat", "action.unlurk"]);
    assert.equal(store.listTenantPackages("tenant-a").filter((item) => item.visibility === "private").length, 0);
  } finally { store.close(); }
});

test("import, approval, publishing, and collision remapping preserve one portable flow boundary", () => {
  const store = new StreamWeaverFlowPackageStore(":memory:", now);
  try {
    const importedLibrary = store.importPackage("tenant-a", store.exportPackage("tenant-a", "mtman1987.coinflip"), author);
    assert.equal(importedLibrary.package.author.id, "mtman1987");
    assert.deepEqual(store.listInstalls("tenant-a").map((item) => item.packageId), ["mtman1987.coinflip"]);

    const imported = store.importPackage("tenant-a", customFlow(), author);
    assert.equal(imported.package.commands[0].enabled, false);
    assert.equal(imported.package.actions[0].enabled, false);
    const approved = store.approveAndInstall("tenant-a", imported.package.packageId);
    assert.equal(approved.package.commands[0].enabled, true);
    assert.equal(approved.package.actions[0].enabled, true);
    assert.equal(store.publish("tenant-a", imported.package.packageId, author).visibility, "community");

    const bundle = normalizeFlowPackage({ ...customFlow("owner-a.bundle"), author, createdAt: now(), updatedAt: now(), commands: [
      { ...customFlow().commands[0], role: "primary", required: true, actionIds: ["action.welcome"] },
      { ...customFlow().commands[0], id: "command.second", trigger: "!second", role: "addon", required: false, actionIds: ["action.second"] },
    ], actions: [customFlow().actions[0], { id: "action.second", type: "send-chat", enabled: false, config: { text: "Second" } }] });
    assert.equal(bundle.commands.length, 2);
    assert.throws(() => normalizeFlowPackage({ ...bundle, commands: bundle.commands.map((command) => ({ ...command, actionIds: ["action.missing"] })) }), /missing action/);

    const privateCollision = store.saveDraft("tenant-a", customFlow("owner-a.direct-share"), author);
    const copied = store.importPackage("tenant-b", privateCollision, { id: "owner-b", displayName: "Owner B" });
    assert.match(copied.package.packageId, /^owner-a\.direct-share\.import-/);
    assert.notEqual(copied.package.commands[0].id, privateCollision.commands[0].id);
    assert.equal(copied.package.commands[0].actionIds[0], copied.package.actions[0].id);
  } finally { store.close(); }
});
