import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  defaultQuackverseCollection,
  offerQuackverseTrade,
  resolveQuackverseTrade,
  spareQuackverseCopies,
  SqliteNebulaTabletopRuntime,
} from "../apps/nebula-arcade/dist/index.js";

const collection = (cards, deck = [], savedDecks = []) => ({
  ...defaultQuackverseCollection(), cards, deck, savedDecks,
});
const offer = (overrides = {}) => ({
  id: "trade-1", fromId: "alice", toId: "bob", fromName: "Alice", toName: "Bob",
  giveCardId: 1, wantCardId: 2, status: "pending", createdAt: "2026-10-24T00:00:00.000Z",
  expiresAt: "2026-10-26T00:00:00.000Z", ...overrides,
});

test("Quackverse trade spare-copy calculation protects active and saved decks", () => {
  const alice = collection([1, 1, 1, 2], [1, 2], [{ id: "saved", name: "Saved", cardIds: [1, 1], wins: 0, losses: 0, createdAt: "", updatedAt: "" }]);
  assert.equal(spareQuackverseCopies(alice, 1), 1);
  assert.equal(spareQuackverseCopies(alice, 2), 0);
});

test("Quackverse trade acceptance atomically swaps spare copies and resolves the offer", () => {
  const collections = { alice: collection([1, 1], [1]), bob: collection([2, 2], [2]) };
  offerQuackverseTrade(collections, offer(), Date.parse("2026-10-24T01:00:00.000Z"));
  const resolved = resolveQuackverseTrade(collections, "trade-1", "bob", "accept", Date.parse("2026-10-24T02:00:00.000Z"));
  assert.equal(resolved.status, "accepted");
  assert.deepEqual(collections.alice.cards.sort(), [1, 2]);
  assert.deepEqual(collections.bob.cards.sort(), [1, 2]);
  assert.ok(resolved.resolvedAt);
  assert.throws(() => resolveQuackverseTrade(collections, "trade-1", "bob", "accept"), /already been resolved/);
});

test("Quackverse trade actions enforce participants, deck protection and expiry", () => {
  const collections = { alice: collection([1], [1]), bob: collection([2], [2]) };
  assert.throws(() => offerQuackverseTrade(collections, offer(), Date.parse("2026-10-24T01:00:00.000Z")), /spare copy/);
  collections.alice = collection([1, 1], [1]);
  collections.bob = collection([2, 2], [2]);
  offerQuackverseTrade(collections, offer(), Date.parse("2026-10-24T01:00:00.000Z"));
  assert.throws(() => resolveQuackverseTrade(collections, "trade-1", "alice", "accept"), /other player/);
  assert.throws(() => resolveQuackverseTrade(collections, "trade-1", "bob", "accept", Date.parse("2026-10-27T00:00:00.000Z")), /expired/);
});


test("Quackverse trade desk persists offers and swaps collections only after recipient acceptance", () => {
  const directory = mkdtempSync(join(tmpdir(), "nebula-quackverse-trade-runtime-"));
  const databasePath = join(directory, "nebula.sqlite");
  let runtime = new SqliteNebulaTabletopRuntime(databasePath);
  const alice = collection([1, 1, 3], [1]);
  const bob = collection([2, 2, 4], [2]);
  runtime.importData("tenant", { collections: { alice, bob } });
  const players = { "spmt:alice": { username: "Alice" }, "spmt:bob": { username: "Bob" } };
  try {
    const initial = runtime.tradeSnapshot("tenant", "alice", players);
    assert.equal(initial.candidates[0].username, "Bob");
    assert.deepEqual(initial.spareCards.map(card => card.cardId), [1, 3]);
    const created = runtime.trade("tenant", "alice", "Alice", { action: "offer", toId: "bob", giveCardId: 3, wantCardId: 4 }, players, Date.parse("2026-11-03T20:00:00.000Z"));
    assert.equal(created.status, "pending");
    assert.deepEqual(runtime.snapshot("tenant", "room", "alice").collection.cards, [1, 1, 3]);
    assert.equal(runtime.tradeSnapshot("tenant", "bob", players).offers[0].fromName, "Alice");
    assert.throws(() => runtime.trade("tenant", "alice", "Alice", { action: "accept", offerId: created.id }, players), /other player/);
    runtime.close();
    runtime = new SqliteNebulaTabletopRuntime(databasePath);
    const accepted = runtime.trade("tenant", "bob", "Bob", { action: "accept", offerId: created.id }, players, Date.parse("2026-11-03T20:01:00.000Z"));
    assert.equal(accepted.status, "accepted");
    assert.deepEqual(runtime.snapshot("tenant", "room", "alice").collection.cards.sort(), [1, 1, 4]);
    assert.deepEqual(runtime.snapshot("tenant", "room", "bob").collection.cards.sort(), [2, 2, 3]);
    assert.equal(runtime.tradeSnapshot("tenant", "alice", players).offers[0].status, "accepted");
    assert.throws(() => runtime.trade("tenant", "bob", "Bob", { action: "accept", offerId: created.id }, players), /already been resolved/);
  } finally {
    runtime.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
