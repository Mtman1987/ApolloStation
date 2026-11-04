import assert from "node:assert/strict";
import test from "node:test";
import {
  QUACKVERSE_DAILY_PACK_LIMIT,
  QUACKVERSE_GRID_SIZE,
  QUACKVERSE_SQUAD_SIZE,
  QUACKVERSE_STAT_CAP,
  canOpenQuackversePack,
  claimQuackverseSeat,
  defaultQuackverseState,
  normalizeQuackverseState,
  recordQuackversePack,
} from "../apps/nebula-arcade/dist/index.js";

test("Quackverse keeps donor board, squad and stat limits", () => {
  const state = defaultQuackverseState(new Date("2026-08-26T00:00:00Z"));
  assert.equal(QUACKVERSE_GRID_SIZE, 7);
  assert.equal(QUACKVERSE_SQUAD_SIZE, 5);
  assert.equal(QUACKVERSE_STAT_CAP, 20);
  assert.equal(state.grid.length, 49);
  assert.equal(state.squadSize, 5);
});

test("Quackverse normalizes damaged pieces and preserves battle piles", () => {
  const value = normalizeQuackverseState({
    grid: [{ owner: "playerOne", cardId: 9, currentHp: 99, maxHp: 25, specialCurrent: 50 }, ...Array.from({ length: 48 }, () => null)],
    battlePiles: {
      playerOne: { drawPile: [{ instanceId: "a", cardId: 1 }], hand: [], discardPile: [] },
      playerTwo: { drawPile: [], hand: [{ instanceId: "b", cardId: 2 }], discardPile: [] },
    },
  }, new Date("2026-08-26T00:00:00Z"));
  assert.equal(value.grid[0].maxHp, 20);
  assert.equal(value.grid[0].currentHp, 20);
  assert.equal(value.grid[0].specialCurrent, 20);
  assert.equal(value.battlePiles.playerOne.drawPile[0].instanceId, "a");
  assert.equal(value.battlePiles.playerTwo.hand[0].cardId, 2);
});

test("Quackverse claims exactly two player seats", () => {
  let state = defaultQuackverseState();
  let result = claimQuackverseSeat(state, "user-a"); state = result.state; assert.equal(result.seat, "playerOne");
  result = claimQuackverseSeat(state, "user-b"); state = result.state; assert.equal(result.seat, "playerTwo");
  result = claimQuackverseSeat(state, "user-c"); assert.equal(result.seat, null);
  result = claimQuackverseSeat(state, "user-a"); assert.equal(result.seat, "playerOne");
});

test("Quackverse enforces four packs per UTC day and resets the next day", () => {
  let collection = {};
  const dayOne = new Date("2026-08-26T12:00:00Z");
  for (let i = 0; i < QUACKVERSE_DAILY_PACK_LIMIT; i += 1) collection = recordQuackversePack(collection, [i + 1], dayOne);
  assert.equal(canOpenQuackversePack(collection, dayOne).allowed, false);
  assert.throws(() => recordQuackversePack(collection, [99], dayOne), /daily pack limit/);
  const dayTwo = new Date("2026-08-27T00:00:01Z");
  assert.equal(canOpenQuackversePack(collection, dayTwo).allowed, true);
  assert.equal(canOpenQuackversePack(collection, dayTwo).remaining, 4);
});
