import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AsyncNebulaTabletopRuntime } from "../apps/nebula-arcade/dist/async-tabletop-runtime.js";
import { AsyncNebulaGameRuntimeStore } from "../apps/nebula-arcade/dist/async-game-runtime-store.js";
import { createAsyncJsonRecordStore } from "../packages/async-json-store/factory.mjs";

function message({ tenantId = "tenant-a", channelId = "room-a", messageId, text, occurredAt = "2026-11-05T12:00:00.000Z", userId = "alice" }) {
  return {
    schemaVersion: 1, tenantId, provider: "twitch", connectionId: "connection-a",
    channelId, messageId, text, occurredAt,
    actor: { providerUserId: userId, canonicalUserId: userId, username: userId, displayName: userId, isBot: false, roles: [] },
    mentions: [],
  };
}

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "nebula-tabletop-async-"));
  const databasePath = join(directory, "records.sqlite");
  const runtime = new AsyncNebulaTabletopRuntime({ mode: "sqlite", databasePath });
  await runtime.initialize();
  return {
    directory, databasePath, runtime,
    async close() { await runtime.close(); await rm(directory, { recursive: true, force: true }); },
  };
}

test("async tabletop keeps Bingo claim, Game Points ledger, and receipt in one durable transaction", async () => {
  const t = await fixture();
  const games = new AsyncNebulaGameRuntimeStore({ mode: "sqlite", databasePath: t.databasePath });
  await games.initialize();
  try {
    const now = Date.parse("2026-11-05T12:00:00.000Z");
    await t.runtime.ingestBingoTranscript("tenant-a", "room-a", "hello chat", now);
    const input = message({ messageId: "bingo-claim-1", text: "spmt bingo shared A1", occurredAt: new Date(now + 1000).toISOString() });
    const first = await t.runtime.execute(input);
    assert.match(first, /claimed A1/i);
    assert.equal(await t.runtime.succeeded(input), true);
    const replay = await t.runtime.execute(input);
    assert.equal(replay, first);
    const gameState = await games.get("tenant-a");
    assert.equal(gameState.players["spmt:alice"].gamePointsBalance, 5);
    assert.equal(gameState.ledger.filter((entry) => entry.reason === "Bingo phrase claimed").length, 1);
    const board = await t.runtime.snapshot("tenant-a", "room-a");
    assert.equal(board.sharedBingo.chatSquares, 1);
  } finally {
    await games.close();
    await t.close();
  }
});

test("async tabletop preserves Quackverse trade idempotency and durable pack outbox across restart", async () => {
  const directory = await mkdtemp(join(tmpdir(), "nebula-tabletop-restart-"));
  const databasePath = join(directory, "records.sqlite");
  let runtime = new AsyncNebulaTabletopRuntime({ mode: "sqlite", databasePath });
  let records = createAsyncJsonRecordStore({ service: "nebula-arcade", mode: "sqlite", databasePath });
  await runtime.initialize(); await records.initialize();
  try {
    await runtime.importData("tenant-a", { collections: { alice: { cards: [1, 1] }, bob: { cards: [2, 2] } } });
    const input = { action: "offer", toId: "bob", giveCardId: 1, wantCardId: 2, requestId: "offer-once" };
    const first = await runtime.trade("tenant-a", "alice", "Alice", input);
    const replay = await runtime.trade("tenant-a", "alice", "Alice", input);
    assert.deepEqual(replay, first);
    assert.equal((await runtime.tradeSnapshot("tenant-a", "alice")).offers.length, 1);
    await assert.rejects(runtime.trade("tenant-a", "alice", "Alice", { ...input, requestId: "invalid-offer", giveCardId: 999 }));
    assert.equal((await runtime.tradeSnapshot("tenant-a", "alice")).offers.length, 1);

    const pack = message({ messageId: "pack-once", text: "spmt quackverse pack", userId: "carol" });
    const response = await runtime.execute(pack);
    assert.match(response, /opened:/i);
    assert.equal(await runtime.execute(pack), response);
    const outbox = await records.list("tabletop-media-outbox", "tenant-a");
    assert.equal(outbox.length, 1);
    assert.equal(outbox[0].key, "twitch:connection-a:pack-once");
    assert.equal(outbox[0].value.status, "pending");
  } finally {
    await records.close();
    await runtime.close();
  }

  runtime = new AsyncNebulaTabletopRuntime({ mode: "sqlite", databasePath });
  records = createAsyncJsonRecordStore({ service: "nebula-arcade", mode: "sqlite", databasePath });
  await runtime.initialize(); await records.initialize();
  try {
    const board = await runtime.snapshot("tenant-a", "room-a", "carol");
    assert.ok(board.collection.cards.length > 0);
    assert.equal((await records.list("tabletop-media-outbox", "tenant-a")).length, 1);
    assert.equal((await runtime.tradeSnapshot("tenant-a", "alice")).offers.length, 1);
  } finally {
    await records.close();
    await runtime.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("async tabletop serializes concurrent commands and retains command receipts", async () => {
  const t = await fixture();
  try {
    const one = message({ messageId: "pack-concurrent-1", text: "spmt quackverse pack", userId: "alice" });
    const two = message({ messageId: "pack-concurrent-2", text: "spmt quackverse pack", userId: "bob" });
    const results = await Promise.all([t.runtime.execute(one), t.runtime.execute(two)]);
    assert.ok(results.every((result) => typeof result === "string" && /opened:/i.test(result)));
    assert.equal(await t.runtime.succeeded(one), true);
    assert.equal(await t.runtime.succeeded(two), true);
    const outbox = createAsyncJsonRecordStore({ service: "nebula-arcade", mode: "sqlite", databasePath: t.databasePath });
    await outbox.initialize();
    try { assert.equal((await outbox.list("tabletop-media-outbox", "tenant-a")).length, 2); }
    finally { await outbox.close(); }
  } finally { await t.close(); }
});
