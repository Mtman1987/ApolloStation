import test from "node:test";
import assert from "node:assert/strict";
import { NEBULA_ARCADE_GAMES, routeNebulaCommand } from "../apps/nebula-arcade/dist/game-hub.js";

test("Nebula Arcade exposes twenty peer games with no featured ordering metadata", () => {
  assert.equal(NEBULA_ARCADE_GAMES.length, 20);
  assert.deepEqual(new Set(NEBULA_ARCADE_GAMES.map((game) => game.id)).size, 20);
  assert.ok(NEBULA_ARCADE_GAMES.every((game) => !("featured" in game) && !("priority" in game)));
});

test("generic commands fan out to every enabled compatible game", () => {
  const targets = routeNebulaCommand("!join", ["chat-tag", "bingo", "petrace", "wordstorm"]);
  assert.deepEqual(targets.map((target) => target.gameId), ["chat-tag", "bingo", "petrace", "wordstorm"]);
});

test("accept only reaches enabled games with a pending invitation", () => {
  const targets = routeNebulaCommand("!accept", ["quackverse", "bingo", "treasurehunt"], ["bingo", "treasurehunt"]);
  assert.deepEqual(targets.map((target) => target.gameId), ["bingo", "treasurehunt"]);
});
