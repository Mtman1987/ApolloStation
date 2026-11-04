import test from "node:test";
import assert from "node:assert/strict";
import {
  BINGO_CENTER_INDEX,
  BINGO_CENTER_PLACEHOLDER,
  bingoCardStats,
  claimPersonalBingoSquare,
  defaultBingoState,
  hasBingo,
  personalBingoView,
  resetPersonalBingoProgress,
  setPersonalBingoCenter,
} from "../apps/nebula-arcade/dist/index.js";

test("Bingo preserves 25-square card with personal center at index 12", () => {
  const state = defaultBingoState(Array.from({ length: 24 }, (_, index) => `Phrase ${index + 1}`));
  assert.equal(state.templatePhrases.length, 25);
  assert.equal(BINGO_CENTER_INDEX, 12);
  assert.equal(state.templatePhrases[12], BINGO_CENTER_PLACEHOLDER);
  assert.equal(bingoCardStats(state).sharedSquares, 24);
});

test("Bingo personal center must be set before the center can be claimed and locks after claim", () => {
  const state = defaultBingoState();
  assert.throws(() => claimPersonalBingoSquare(state, "User-A", 12), /personal Bingo phrase/);
  setPersonalBingoCenter(state, "User-A", "My catch phrase", new Date("2026-08-26T12:00:00Z"));
  claimPersonalBingoSquare(state, "User-A", 12, { actorUserId: "user-a" }, new Date("2026-08-26T12:01:00Z"));
  assert.throws(() => setPersonalBingoCenter(state, "User-A", "Changed"), /already claimed/);
  const view = personalBingoView(state, "User-A");
  assert.equal(view.centerPhrase, "My catch phrase");
  assert.ok(view.covered["12"]);
});

test("Bingo detects rows, columns and both diagonals", () => {
  const covered = (indexes) => Object.fromEntries(indexes.map((index) => [String(index), {}]));
  assert.equal(hasBingo(covered([0, 1, 2, 3, 4])), true);
  assert.equal(hasBingo(covered([1, 6, 11, 16, 21])), true);
  assert.equal(hasBingo(covered([0, 6, 12, 18, 24])), true);
  assert.equal(hasBingo(covered([4, 8, 12, 16, 20])), true);
  assert.equal(hasBingo(covered([0, 1, 2, 3])), false);
});

test("Bingo records a completed card once and reset clears claims without erasing personal center", () => {
  const state = defaultBingoState();
  setPersonalBingoCenter(state, "user-a", "Center");
  for (const square of [0, 1, 2, 3, 4]) claimPersonalBingoSquare(state, "user-a", square, {}, new Date(`2026-08-26T12:0${square}:00Z`));
  let stats = bingoCardStats(state);
  assert.equal(stats.players, 1);
  assert.equal(stats.claims, 5);
  assert.equal(stats.completedCards, 1);
  resetPersonalBingoProgress(state, new Date("2026-08-27T00:00:00Z"));
  stats = bingoCardStats(state);
  assert.equal(stats.claims, 0);
  assert.equal(stats.completedCards, 0);
  assert.equal(personalBingoView(state, "user-a").centerPhrase, "Center");
});
