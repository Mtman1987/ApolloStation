import assert from "node:assert/strict";
import test from "node:test";
import {
  DefaultStreamWeaverDonorCommandServices,
  SqliteStreamWeaverBicStore,
  STREAMWEAVER_BIC_COUNTER_UPDATED,
  STREAMWEAVER_DONOR_ACTION_FIRED,
  STREAMWEAVER_DONOR_SOCIAL_ACTIONS,
  STREAMWEAVER_SOCIAL_INTERACTION,
  StreamWeaverBicCommandExecutor,
  StreamWeaverBicRuntime,
  StreamWeaverSocialActionExecutor,
  findBestStreamWeaverUsernameMatch,
  streamWeaverUsernameSimilarity,
} from "../apps/streamweaver/dist/index.js";

function clientFixture() {
  const published = [];
  return {
    published,
    client: {
      async publishEvent(tenantId, type, payload, idempotencyKey) {
        published.push({ tenantId, type, payload, idempotencyKey });
        return { id: `evt-${published.length}` };
      },
    },
  };
}

function invocation(trigger, overrides = {}) {
  return {
    tenantId: "tenant-1",
    deliveryId: `delivery-${trigger}`,
    command: { donorId: trigger.slice(1), trigger, family: trigger === "!bic" ? "community" : "social", cooldownSeconds: 0 },
    canonicalTrigger: trigger,
    args: [],
    rawText: trigger,
    actor: { userId: "user-owner", providerUserId: "tw-owner", username: "owner", displayName: "Owner", isModerator: true, isBroadcaster: true },
    provider: "twitch",
    connectionId: "connection-1",
    channelId: "channel-1",
    ...overrides,
  };
}

test("starter-social preserves all 12 frozen action identities including Bic voice and economy-side _roll", () => {
  assert.equal(STREAMWEAVER_DONOR_SOCIAL_ACTIONS.length, 12);
  assert.equal(new Set(STREAMWEAVER_DONOR_SOCIAL_ACTIONS.map((action) => action.id)).size, 12);
  assert.equal(STREAMWEAVER_DONOR_SOCIAL_ACTIONS.some((action) => action.id === "athena-bic"), true);
  assert.equal(STREAMWEAVER_DONOR_SOCIAL_ACTIONS.some((action) => action.id === "bic-lighter-action"), true);
  assert.equal(STREAMWEAVER_DONOR_SOCIAL_ACTIONS.some((action) => action.id === "4d8cf691-44d3-43eb-86fa-69d64578d2cb" && action.kind === "economy-side-effect"), true);
});

test("username matching preserves donor exact, prefix, contains, and fuzzy subsequence behavior", () => {
  const chatters = [
    { providerUserId: "1", userLogin: "spacecaptain", displayName: "Space Captain" },
    { providerUserId: "2", userLogin: "nightmare89", displayName: "Nightmare" },
  ];
  assert.equal(findBestStreamWeaverUsernameMatch("nightmare89", chatters).userLogin, "nightmare89");
  assert.equal(findBestStreamWeaverUsernameMatch("space", chatters).userLogin, "spacecaptain");
  assert.equal(findBestStreamWeaverUsernameMatch("captain", chatters).userLogin, "spacecaptain");
  assert.equal(findBestStreamWeaverUsernameMatch("ngtmr", chatters).userLogin, "nightmare89");
  assert.equal(streamWeaverUsernameSimilarity("ngtmr", "nightmare89") >= 0.6, true);
  assert.equal(findBestStreamWeaverUsernameMatch("zzzzzz", chatters), undefined);
});

test("Bic durable state is tenant isolated, replay safe, blacklist aware, and reversible", () => {
  const store = new SqliteStreamWeaverBicStore(":memory:");
  try {
    const first = store.steal("tenant-a", "Viewer", "Viewer", "delivery-1");
    const replay = store.steal("tenant-a", "Viewer", "Viewer", "delivery-1");
    const second = store.steal("tenant-a", "Viewer", "Viewer", "delivery-2");
    assert.deepEqual({ total: first.total, userCount: first.userCount, duplicate: first.duplicate }, { total: 1, userCount: 1, duplicate: false });
    assert.deepEqual({ total: replay.total, userCount: replay.userCount, duplicate: replay.duplicate }, { total: 1, userCount: 1, duplicate: true });
    assert.equal(second.total, 2);
    assert.equal(second.userCount, 2);
    assert.equal(store.snapshot("tenant-b").total, 0);
    assert.equal(store.addToBlacklist("tenant-a", "protected"), true);
    assert.throws(() => store.steal("tenant-a", "protected", "Protected", "delivery-3"), /protected/i);
    const removed = store.remove("tenant-a", "viewer", "Viewer", "remove-1");
    assert.equal(removed.total, 1);
    assert.equal(removed.userCount, 1);
  } finally { store.close(); }
});

test("Bic legacy migration preserves existing Green victims, merges missing donor counts and blacklist, and is idempotent", () => {
  const store = new SqliteStreamWeaverBicStore(":memory:");
  try {
    store.steal("tenant-1", "existing", "Existing", "green-1");
    const first = store.importLegacy("tenant-1", { total: 20, victims: { existing: 9, legacy: 4 }, blacklist: ["safeuser"] }, "donor-387acf");
    assert.equal(first.imported, 4);
    assert.equal(first.snapshot.total, 20);
    assert.equal(first.snapshot.victims.find((victim) => victim.name === "existing").count, 1);
    assert.equal(first.snapshot.victims.find((victim) => victim.name === "legacy").count, 4);
    assert.deepEqual(first.snapshot.blacklist, ["safeuser"]);
    const replay = store.importLegacy("tenant-1", { total: 999, victims: { another: 50 } }, "donor-387acf");
    assert.equal(replay.duplicate, true);
    assert.equal(replay.snapshot.total, 20);
  } finally { store.close(); }
});

test("!bic uses the durable store and emits donor identity, counter event, and canonical overlay cue", async () => {
  const store = new SqliteStreamWeaverBicStore(":memory:");
  const fx = clientFixture();
  try {
    const bic = new StreamWeaverBicRuntime({ store, client: fx.client, resolveThiefDisplayName: () => "fatkid4ev4" });
    const text = await bic.fromCommand(invocation("!bic", { args: ["@Victim"], rawText: "!bic @Victim" }));
    assert.equal(text, "fatkid4ev4 has stolen 1 lighters, of those 1 have been victim's");
    assert.equal(fx.published[0].type, STREAMWEAVER_DONOR_ACTION_FIRED);
    assert.equal(fx.published[0].payload.donorActionId, "bic-lighter-action");
    assert.equal(fx.published[1].type, STREAMWEAVER_BIC_COUNTER_UPDATED);
    assert.equal(fx.published[2].type, "streamweaver.overlay.cue.requested.v1");
    assert.deepEqual(fx.published[2].payload.payload, { total: 1, lastUser: "victim", lastUserCount: 1 });
  } finally { store.close(); }
});

test("Athena Bic voice uses donor chatter matching and records the Athena action identity", async () => {
  const store = new SqliteStreamWeaverBicStore(":memory:");
  const fx = clientFixture();
  try {
    const bic = new StreamWeaverBicRuntime({
      store,
      client: fx.client,
      resolveThiefDisplayName: () => "fatkid4ev4",
      chatters: { list: () => [{ userLogin: "nightmare89", displayName: "Nightmare" }, { userLogin: "spacecaptain", displayName: "Space Captain" }] },
    });
    const result = await bic.fromVoice({ tenantId: "tenant-1", invocationId: "voice-1", partialName: "ngtmr", provider: "twitch", channelId: "channel-1" });
    assert.equal(result.matched, "nightmare89");
    assert.match(result.text, /nightmare89's$/);
    assert.equal(fx.published[0].payload.donorActionId, "athena-bic");
  } finally { store.close(); }
});

test("Default donor services route !bic through its dedicated executor and leave generic social copy intact", async () => {
  const store = new SqliteStreamWeaverBicStore(":memory:");
  const fx = clientFixture();
  try {
    const bic = new StreamWeaverBicRuntime({ store, client: fx.client, resolveThiefDisplayName: () => "Streamer" });
    const services = new DefaultStreamWeaverDonorCommandServices({ bic: new StreamWeaverBicCommandExecutor(bic), socialEffects: new StreamWeaverSocialActionExecutor(fx.client) });
    const bicResult = await services.execute(invocation("!bic", { args: ["victim"], rawText: "!bic victim" }));
    assert.equal(bicResult.text, "Streamer has stolen 1 lighters, of those 1 have been victim's");
    const socialResult = await services.execute(invocation("!boop", { target: { userId: "user-2", providerUserId: "tw-2", username: "friend" } }));
    assert.equal(socialResult.handled, true);
    assert.equal(socialResult.text, undefined);
    assert.equal(fx.published.some((entry) => entry.type === STREAMWEAVER_SOCIAL_INTERACTION && entry.payload.donorActionName === "_boop"), true);
  } finally { store.close(); }
});
