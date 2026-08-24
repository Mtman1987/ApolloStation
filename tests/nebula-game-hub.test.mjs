import test from "node:test";
import assert from "node:assert/strict";
import { NEBULA_ARCADE_GAMES, resolveNebulaCommand, routeNebulaCommand } from "../apps/nebula-arcade/dist/game-hub.js";

test("Nebula Arcade exposes twenty peer games with no featured ordering metadata", () => {
  assert.equal(NEBULA_ARCADE_GAMES.length, 20);
  assert.deepEqual(new Set(NEBULA_ARCADE_GAMES.map((game) => game.id)).size, 20);
  assert.ok(NEBULA_ARCADE_GAMES.every((game) => !("featured" in game) && !("priority" in game)));
  assert.ok(NEBULA_ARCADE_GAMES.every((game) => game.summary.length > 20 && game.commands.length > 0 && game.overlayWidgets.length > 0));
});

test("low-level generic command matching can identify every enabled compatible game", () => {
  const targets = routeNebulaCommand("!join", ["chat-tag", "bingo", "petrace", "wordstorm"]);
  assert.deepEqual(targets.map((target) => target.gameId), ["chat-tag", "bingo", "petrace", "wordstorm"]);
});

test("public generic command resolution asks the chatter to choose on collisions", () => {
  const result = resolveNebulaCommand("!join", ["chat-tag", "chatgarden"]);
  assert.equal(result.kind, "choose-game");
  assert.deepEqual(result.targets.map((target) => target.gameId), ["chat-tag", "chatgarden"]);
  assert.match(result.prompt, /1 for Chat Tag/);
  assert.match(result.prompt, /2 for Chat Garden/);
});

test("public generic command resolution executes directly when only one game matches", () => {
  const result = resolveNebulaCommand("!dance", ["chat-tag", "dancingparade"]);
  assert.equal(result.kind, "single");
  assert.equal(result.targets[0].gameId, "dancingparade");
});

test("accept only reaches enabled games with a pending invitation", () => {
  const targets = routeNebulaCommand("!accept", ["quackverse", "bingo", "treasurehunt"], ["bingo", "treasurehunt"]);
  assert.deepEqual(targets.map((target) => target.gameId), ["bingo", "treasurehunt"]);
});
