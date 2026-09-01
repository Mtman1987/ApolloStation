import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import {
  SqliteNebulaGameRuntimeStore,
  SqliteNebulaGameMixStore,
  SqliteNebulaOverlaySceneStore,
  SqliteNebulaTagExperienceStore,
  SqliteNebulaTagStore,
  createNebulaTagState,
  manifest,
  routeNebulaCommand,
} from "../apps/nebula-arcade/dist/index.js";

const ROOT = new URL("..", import.meta.url);
const LEGACY_DASH_ID = ["chat", "tag"].join("-");
const LEGACY_TABLE_PREFIX = ["chat", "tag"].join("_");
const LEGACY_NEBULA_DEPLOYMENT_ORIGIN = "https://chat-tag-new.fly.dev";

test("every executable integration names Nebula Arcade as the sole current owner", () => {
  assert.equal(manifest.id, "nebula-arcade");
  assert.equal(manifest.workers[0].id, "nebula-arcade-provider-ingress");
  assert.ok(manifest.capabilities.includes("tag"));
  assert.equal(manifest.capabilities.includes(LEGACY_DASH_ID), false);
  assert.ok(manifest.eventTypes.every((type) => type.startsWith("nebula.arcade.")));

  const currentFiles = executableFiles(["apps", "packages", "scripts", "config", ".github"]);
  const forbidden = new RegExp(`${["chat", "tag"].join("[ _-]?")}|chattag`, "i");
  const leaks = currentFiles.flatMap((file) => {
    const source = readFileSync(file, "utf8").replaceAll(LEGACY_NEBULA_DEPLOYMENT_ORIGIN, "https://legacy-nebula-deployment.invalid");
    return forbidden.test(source) ? [relative(new URL("..", import.meta.url).pathname, file)] : [];
  });
  assert.deepEqual(leaks, [], `obsolete Games Hub identity leaked into executable files: ${leaks.join(", ")}`);

  const server = readFileSync(new URL("../apps/spacemountain-web/src/server.ts", import.meta.url), "utf8");
  assert.match(server, /NEBULA_ARCADE_ORIGIN/);
  assert.doesNotMatch(server, /\/apps\/nebula-tag|\/v1\/nebula-tag|NEBULA_TAG_(?:ORIGIN|DATABASE|TENANT|CHANNEL)/);
  const sdk = readFileSync(new URL("../packages/sdk/src/xp.ts", import.meta.url), "utf8");
  assert.match(sdk, /sourceApp: "nebula-arcade"/);
  assert.doesNotMatch(sdk, /sourceApp: "(?:tag|nebula-tag)"/);
  assert.deepEqual(routeNebulaCommand("!join", [LEGACY_DASH_ID]), []);
});

test("legacy game tables and saved game IDs migrate once into Nebula Arcade authority", () => {
  const directory = mkdtempSync(join(tmpdir(), "apollo-nebula-arcade-canonical-"));
  const path = join(directory, "nebula-arcade.sqlite");
  const legacyStateTable = `${LEGACY_TABLE_PREFIX}_state`;
  const legacyChannelTable = `${LEGACY_TABLE_PREFIX}_channels`;
  const state = createNebulaTagState("tenant-a");
  state.players.alpha = { userId: "alpha", username: "alpha", joinedAt: "2026-08-28T00:00:00.000Z", lastActiveAt: "2026-08-28T00:00:00.000Z", score: 0, tagsMade: 0, timesTagged: 0, passCount: 0, sleeping: false, offline: false, timedImmunityUntil: null, noTagbackFromUserId: null };

  const database = new DatabaseSync(path);
  database.exec(`
    CREATE TABLE ${legacyStateTable}(tenant_id TEXT PRIMARY KEY,revision INTEGER NOT NULL,updated_at TEXT NOT NULL,body TEXT NOT NULL) STRICT;
    CREATE TABLE ${legacyChannelTable}(tenant_id TEXT NOT NULL,channel_id TEXT NOT NULL,overlay_mode INTEGER NOT NULL DEFAULT 0,opted_out INTEGER NOT NULL DEFAULT 0,updated_at TEXT NOT NULL,PRIMARY KEY(tenant_id,channel_id)) STRICT;
    CREATE TABLE nebula_game_runtime(tenant_id TEXT NOT NULL,runtime_key TEXT NOT NULL,body TEXT NOT NULL,updated_at TEXT NOT NULL,PRIMARY KEY(tenant_id,runtime_key)) STRICT;
  `);
  database.prepare(`INSERT INTO ${legacyStateTable}(tenant_id,revision,updated_at,body) VALUES(?,?,?,?)`).run("tenant-a", 7, "2026-08-28T00:00:00.000Z", JSON.stringify(state));
  database.prepare(`INSERT INTO ${legacyChannelTable}(tenant_id,channel_id,overlay_mode,opted_out,updated_at) VALUES(?,?,?,?,?)`).run("tenant-a", "captain", 1, 0, "2026-08-28T00:00:00.000Z");
  database.prepare("INSERT INTO nebula_game_runtime(tenant_id,runtime_key,body,updated_at) VALUES(?,?,?,?)").run("tenant-a", "default", JSON.stringify({ channels: { captain: { extraGameIds: [LEGACY_DASH_ID], stoppedGameIds: [] } }, players: { alpha: { id: "alpha", username: "alpha", displayName: "Alpha", gamePointsBalance: 0, lifetimeEarned: 0, lifetimeSpent: 0, joinedGames: { [LEGACY_DASH_ID]: { joinedAt: "2026-08-28T00:00:00.000Z", active: true, score: 1, wins: 0, plays: 1 } } } }, ledger: [] }), "2026-08-28T00:00:00.000Z");
  database.close();

  const game = new SqliteNebulaTagStore(path);
  assert.equal(game.getState("tenant-a").revision, 7);
  game.close();
  const experience = new SqliteNebulaTagExperienceStore(path);
  assert.equal(experience.getChannelSettings("tenant-a", "captain").overlayMode, true);
  experience.close();
  const runtime = new SqliteNebulaGameRuntimeStore(path);
  const saved = runtime.get("tenant-a");
  assert.deepEqual(saved.channels.captain.extraGameIds, ["tag"]);
  assert.ok(saved.players.alpha.joinedGames.tag);
  assert.equal(saved.players.alpha.joinedGames[LEGACY_DASH_ID], undefined);
  runtime.close();
  const mixes = new SqliteNebulaGameMixStore(path);
  assert.throws(() => mixes.save("tenant-a", { id: "legacy", name: "Legacy", layers: [{ gameId: LEGACY_DASH_ID }] }), /invalid game layer/);
  mixes.close();
  const scenes = new SqliteNebulaOverlaySceneStore(path);
  assert.throws(() => scenes.save("tenant-a", { id: "legacy", name: "Legacy", layers: [{ gameId: LEGACY_DASH_ID, enabled: true, zIndex: 0 }] }), /invalid game layer/);
  scenes.close();

  const verified = new DatabaseSync(path);
  assert.equal(verified.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(legacyStateTable), undefined);
  assert.equal(verified.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(legacyChannelTable), undefined);
  assert.ok(verified.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='nebula_tag_state'").get());
  assert.ok(verified.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='nebula_tag_channels'").get());
  verified.close();

  // Reopening proves the migration is idempotent.
  const reopened = new SqliteNebulaTagStore(path);
  assert.equal(reopened.getState("tenant-a").revision, 7);
  reopened.close();
  rmSync(directory, { recursive: true, force: true });
});

function executableFiles(roots) {
  const files = [];
  for (const root of roots) walk(new URL(`../${root}`, import.meta.url).pathname, files);
  return files;
}

function walk(path, files) {
  if (!statSync(path).isDirectory()) return;
  for (const name of readdirSync(path)) {
    if (name === "dist" || name === "node_modules") continue;
    const child = join(path, name);
    if (statSync(child).isDirectory()) walk(child, files);
    else if (/\.(?:ts|mjs|js|json|ya?ml)$/.test(name)) files.push(child);
  }
}
