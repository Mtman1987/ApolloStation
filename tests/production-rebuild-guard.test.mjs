import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const guard = JSON.parse(readFileSync(new URL("../docs/donor-audits/production-rebuild-guard.v1.json", import.meta.url), "utf8"));
const donors = new Map(guard.donors.map((item) => [item.repository, item]));
const requiredDonors = new Map([
  ["Mtman1987/spmt-live", "bbd335ce8083b540ba9c7f8468edbfbfa46fc5d5"],
  ["Mtman1987/spacemountain-live", "1dc2c1f02a7eb7bb9ddade3460c43ffa87858f43"],
  ["Mtman1987/streamweaver", "387acf70552f9a6a557a83e8804c328245932961"],
  ["Mtman1987/DiscordStreamHub", "e35a1b06479adf73565da9b3a7eff4dc27ebe38b"],
  ["Mtman1987/hearmeout-main", "686d237fbb5bfa56f2356dba9dfdb7c023d5ac23"],
  ["Mtman1987/chat-tag", "8170c51b04598774cbaa67981888e30b0c51f2fd"],
  ["Mtman1987/fly-machine-rotator", "66e66b8b8502a6cf1dd94aee0163c443459a6d08"],
]);

const currentApps = ["commlink", "companion", "discord-stream-hub", "hearmeout", "mission-control", "mountainview", "nebula-arcade", "stellar-core", "streamweaver"];
const requiredFamilies = [
  "discord",
  "twitch",
  "xp-points-wallet",
  "identity-provider-links",
  "commands-actions-redeems",
  "events-websockets-chat-gateway",
  "overlays-obs",
  "workers-schedulers-processes",
  "durable-state-cache-outbox-migrations",
  "auth-recovery-oauth",
  "tenant-isolation-replay-restart",
  "health-readiness-drain-rollback",
];

test("production rebuild remains blocked behind explicit donor evidence", () => {
  assert.equal(guard.schemaVersion, 1);
  assert.equal(guard.status, "CUTOVER_BLOCKED");
  assert.equal(guard.policy.unclassifiedDisposition, "VERIFY");
  assert.equal(guard.policy.manifestIsNotParity, true);
  assert.equal(guard.policy.catalogIngestionIsNotPortCompletion, true);
  assert.equal(guard.policy.donorRetirementRequiresOwnerApproval, true);
  assert.deepEqual(guard.policy.sharedOperationClients, ["sdk", "api", "cli", "mcp"]);
  assert.deepEqual([...guard.policy.requiredCapabilityFamilies].sort(), [...requiredFamilies].sort());
  assert.ok(guard.policy.retirementGate.some((item) => /owner/i.test(item)));
  assert.ok(guard.policy.retirementGate.some((item) => /migration/i.test(item)));
  assert.ok(guard.policy.retirementGate.some((item) => /two-tenant/i.test(item)));
});

test("all frozen production donor heads remain pinned until parity is proven", () => {
  assert.equal(donors.size, requiredDonors.size);
  for (const [repository, sha] of requiredDonors) {
    const donor = donors.get(repository);
    assert.ok(donor, `missing donor ${repository}`);
    assert.equal(donor.frozenHead, sha, `${repository} frozen production head changed`);
    assert.match(donor.currentMain, /^[0-9a-f]{40}$/);
    assert.equal(donor.disposition, "VERIFY");
  }
  assert.deepEqual([...guard.firstPartyApps].sort(), currentApps);
});

test("Chat Tag drift after the production freeze cannot be silently discarded", () => {
  const donor = donors.get("Mtman1987/chat-tag");
  assert.equal(donor.frozenHead, "8170c51b04598774cbaa67981888e30b0c51f2fd");
  assert.equal(donor.currentMain, "c4b99179eff47e41e920603f96f6342b04390eee");
  assert.equal(donor.currentAheadBy, 10);
  assert.equal(donor.preserveUnion, true);
  assert.notEqual(donor.currentMain, donor.frozenHead);
});

test("large donor behavior inventories stay visible to future rebuild work", () => {
  const streamweaver = guard.knownProductionEvidence.streamweaver;
  assert.equal(streamweaver.commands, 71);
  assert.equal(streamweaver.actions, 176);
  assert.equal(streamweaver.totalBehaviors, 247);
  assert.equal(streamweaver.commands + streamweaver.actions, streamweaver.totalBehaviors);
  assert.equal(Object.values(streamweaver.moduleCounts).reduce((sum, value) => sum + value, 0), 247);
  for (const module of ["economy", "redeem-pack", "starter-social", "core-utility", "event-hooks", "chat-bridge", "discord", "kick"]) assert.ok(streamweaver.moduleCounts[module] > 0, module);

  const points = guard.knownProductionEvidence.discordStreamHub.pointsOperations;
  for (const operation of ["balance", "add", "set", "update", "user-rank", "leaderboard", "gamble-settle", "tenant-balances", "spmt-xp-bridge"]) assert.ok(points.includes(operation), operation);
  const twitch = guard.knownProductionEvidence.discordStreamHub.twitchFamilies;
  for (const family of ["api-service", "oauth", "account-linking", "bot-linking", "chat", "polling", "live-status", "ban-blacklist"]) assert.ok(twitch.includes(family), family);

  const hearmeout = guard.knownProductionEvidence.hearmeout;
  for (const family of ["oauth", "activity", "guilds", "channels", "messages", "chat", "embeds", "invites", "interactions", "voice-bridge", "pcm-jitter"]) assert.ok(hearmeout.discordFamilies.includes(family), family);
  assert.ok(hearmeout.livekit.includes("token"));
  assert.ok(hearmeout.livekit.includes("health"));
});

test("SPMT parity gap and unresolved deployment discovery remain explicit", () => {
  const spmt = guard.knownProductionEvidence.spmt;
  assert.equal(spmt.donorUniqueMethodPathPairs, 190);
  assert.equal(spmt.greenMethodPathShapesAtAudit, 60);
  for (const missing of ["spend", "transfer", "gamble-settlement", "leaderboard-projection", "migration-reconciliation"]) assert.ok(spmt.xpStillRequired.includes(missing), missing);
  assert.equal(guard.knownProductionEvidence.fly.inventoryComplete, false);
  const discoveryCount = guard.discoveryQueue.workerOrAssetCandidates.length
    + guard.discoveryQueue.productOrReleaseCandidates.length
    + guard.discoveryQueue.predecessorOrExperimentCandidates.length
    + guard.discoveryQueue.archived.length;
  assert.equal(guard.discoveryQueue.expectedRepositoryCount, 23);
  assert.equal(discoveryCount, 23);
});
