import test from "node:test";
import assert from "node:assert/strict";
import { NEBULA_ARCADE_GAMES, nebulaGameCommandHelp, resolveNebulaCommand, routeNebulaCommand } from "../apps/nebula-arcade/dist/game-hub.js";

test("Nebula Arcade exposes twenty peer games with no featured ordering metadata", () => {
  assert.equal(NEBULA_ARCADE_GAMES.length, 20);
  assert.deepEqual(new Set(NEBULA_ARCADE_GAMES.map((game) => game.id)).size, 20);
  assert.ok(NEBULA_ARCADE_GAMES.every((game) => !("featured" in game) && !("priority" in game)));
  assert.ok(NEBULA_ARCADE_GAMES.every((game) => game.summary.length > 20 && game.commands.length > 0 && game.overlayWidgets.length > 0));
});

test("Nebula Arcade tag game keeps its simple commands while other games use distinct public verbs", () => {
  assert.deepEqual(routeNebulaCommand("spmt join", ["tag", "bingo", "petrace", "wordstorm"]), [{ gameId: "tag", command: "join", args: [] }]);
  assert.equal(resolveNebulaCommand("spmt card", ["tag", "bingo"]).targets[0].gameId, "bingo");
  assert.equal(resolveNebulaCommand("spmt pet dog", ["petrace"]).targets[0].gameId, "petrace");
  assert.equal(resolveNebulaCommand("spmt storm", ["wordstorm"]).targets[0].gameId, "wordstorm");
});

test("shared commands ask the chatter to choose when they cannot safely fan out", () => {
  const result = resolveNebulaCommand("spmt leave", ["tag", "chatgarden"]);
  assert.equal(result.kind, "choose-game");
  assert.deepEqual(result.targets.map((target) => target.gameId), ["tag", "chatgarden"]);
  assert.match(result.prompt, /1 for Tag/);
  assert.match(result.prompt, /2 for Chat Garden/);
});

test("safe team-color conflicts broadcast to both compatible active games", () => {
  const result = resolveNebulaCommand("spmt red", ["chatwars", "colorwars"]);
  assert.equal(result.kind, "broadcast");
  assert.deepEqual(result.targets.map((target) => target.gameId), ["chatwars", "colorwars"]);
});

test("game-specific public verbs route directly", () => {
  assert.equal(resolveNebulaCommand("spmt dance", ["tag", "dancingparade"]).targets[0].gameId, "dancingparade");
  assert.equal(resolveNebulaCommand("spmt explode", ["chaosmode"]).targets[0].command, "explode");
  assert.deepEqual(resolveNebulaCommand("spmt paint red 10 5", ["pixelbattle"]).targets[0].args, ["red", "10", "5"]);
  assert.deepEqual(resolveNebulaCommand("spmt dig B5", ["treasurehunt"]).targets[0].args, ["B5"]);
});

test("accept only reaches enabled games with a pending invitation", () => {
  const targets = routeNebulaCommand("spmt accept", ["quackverse", "treasurehunt"], ["treasurehunt"]);
  assert.deepEqual(targets.map((target) => target.gameId), ["treasurehunt"]);
});

test("help exposes actual public commands without requiring a game-name prefix", () => {
  assert.ok(nebulaGameCommandHelp("bingo").includes("spmt bingo claim"));
  assert.ok(nebulaGameCommandHelp("chickenroyale").includes("spmt chickenroyale launch"));
  assert.ok(nebulaGameCommandHelp("quackverse").includes("spmt quackverse pack"));
  assert.equal(nebulaGameCommandHelp("missing").length, 0);
});
