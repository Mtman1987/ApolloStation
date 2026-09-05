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

test("new StreamWeaver tenants are blank while the original library contains independent mtman1987 flows", () => {
  const store = new StreamWeaverFlowPackageStore(":memory:", now);
  try {
    assert.deepEqual(store.listInstalls("tenant-a"), []);
    assert.deepEqual(store.listInstalledPackages("tenant-a"), []);
    const library = legacyCommunityPackages();
    assert.equal(library.length, 73);
    assert.equal(library.every((item) => item.installUnit === "flow" && item.author.id === "mtman1987"), true);
    assert.equal(library.every((item) => item.packageKind !== "command_flow" || item.commands.length === 1), true);
    assert.equal(new Set(library.map((item) => item.packageId)).size, library.length);
  } finally { store.close(); }
});

test("installing one library JSON enables only that one command flow", () => {
  const store = new StreamWeaverFlowPackageStore(":memory:", now);
  try {
    store.install("tenant-a", "mtman1987.coinflip");
    assert.deepEqual(store.listInstalls("tenant-a").map((item) => item.packageId), ["mtman1987.coinflip"]);
    assert.equal(store.donorEnabled("tenant-a", "coinflip"), true);
    assert.equal(store.donorEnabled("tenant-a", "boop"), false);
    const exported = store.exportPackage("tenant-a", "mtman1987.coinflip");
    assert.equal(exported.packageId, "mtman1987.coinflip");
    assert.equal(exported.commands.length, 1);
    const streamerBot = store.exportStreamerBot("tenant-a", "mtman1987.coinflip");
    assert.equal(streamerBot.commands.length, 1);
    assert.equal(store.listTenantPackages("tenant-a").filter((item) => item.visibility === "private").length, 0);
  } finally { store.close(); }
});

test("import, approval, publishing, and package IDs preserve the one-flow boundary", () => {
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

    assert.throws(() => normalizeFlowPackage({ ...customFlow("owner-a.bundle"), author, createdAt: now(), updatedAt: now(), commands: [customFlow().commands[0], { ...customFlow().commands[0], id: "command.second", trigger: "!second" }] }), /at most 1 item/);
    assert.throws(() => store.saveDraft("tenant-b", customFlow(), { id: "owner-b", displayName: "Owner B" }), /another tenant/);
  } finally { store.close(); }
});
