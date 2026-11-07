#!/usr/bin/env node
/**
 * Restore the donor's shared Chat Tag player/tag snapshot into Nebula's
 * canonical network tenant. Reads only the already-redacted legacy-global
 * documents staged in Turso; never reads or imports provider credentials.
 *
 * This is intentionally Tag-only: the separate Quackverse/Bingo/game shards
 * remain staged until their coupled runtime import is verified.
 */
import { createHash } from "node:crypto";
import { TursoHttpAdapter } from "./migrate-sqlite-to-turso.mjs";
import { prepareNebulaLiveImport } from "../apps/nebula-arcade/dist/live-migration.js";
import { AsyncNebulaTagRecordStore } from "../apps/nebula-arcade/dist/async-tag-record-store.js";

const TABLE = "apollo_recovered_json_stage_v1";
const SOURCE = "nebula-legacy-global";
const SOURCE_TENANT = "legacy-global";

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(name + " is required");
  return value;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function main() {
  const url = required("NEBULA_ARCADE_TURSO_DATABASE_URL");
  const authToken = required("NEBULA_ARCADE_TURSO_AUTH_TOKEN");
  const tenantId = required("NEBULA_ARCADE_TENANT_ID");
  const adapter = new TursoHttpAdapter({ url, authToken });
  const rows = await adapter.execute(
    `SELECT source_path, source_sha256, payload_json
       FROM ${TABLE}
      WHERE source=? AND tenant_key=?
      ORDER BY source_path`,
    [SOURCE, SOURCE_TENANT],
    true,
  );
  if (rows.rows.length !== 16) {
    throw new Error(`Expected all 16 staged Chat Tag source documents; found ${rows.rows.length}. No domain data was changed.`);
  }

  const source = {};
  const sourceHashes = [];
  let appStateFound = false;
  for (const row of rows.rows) {
    const path = String(row[0]);
    const sourceHash = String(row[1]);
    const payload = String(row[2]);
    sourceHashes.push([path, sourceHash]);
    const value = JSON.parse(payload);
    if (path === "data/app-state.json") {
      Object.assign(source, value);
      appStateFound = true;
    } else if (path.startsWith("data/app-state.") && path.endsWith(".json")) {
      const key = path.slice("data/app-state.".length, -".json".length);
      source[key] = value;
    } else if (path === "app/data/bot-muted-channels.json" && Array.isArray(value)) {
      source.botSettings ??= {};
      source.botSettings.mutedChannels = { channels: value };
    } else if (path === "app/data/bot-channels-blacklist.json" && Array.isArray(value)) {
      source.botSettings ??= {};
      source.botSettings.blacklistedChannels = { channels: value };
    }
  }
  if (!appStateFound || !source.tagPlayers || Object.keys(source.tagPlayers).length !== 155) {
    throw new Error("The staged donor snapshot is incomplete or does not contain the expected 155 Tag players. No domain data was changed.");
  }

  // Chat Tag's donor IDs are Twitch provider user IDs with a legacy user_ prefix.
  // Convert them to the same provider identity key used by Nebula's live ingress.
  const identityMap = {};
  for (const key of Object.keys(source.tagPlayers)) {
    if (!/^user_\d+$/.test(key)) throw new Error("Unexpected donor player identity format; refusing an ambiguous identity conversion.");
    identityMap[key] = "provider:twitch:" + key.slice("user_".length);
  }

  const sourceDigest = sha256(JSON.stringify(sourceHashes));
  const migrationId = "chat-tag-global-v1-" + sourceDigest.slice(0, 24);
  const prepared = prepareNebulaLiveImport(source, { tenantId, identityMap });
  if (Object.keys(prepared.tag.players).length !== 155) {
    throw new Error(`Expected 155 converted Tag players; prepared ${Object.keys(prepared.tag.players).length}. No domain data was changed.`);
  }
  if (prepared.tag.history.length === 0) {
    throw new Error("The recovered Tag history conversion returned no usable records.");
  }

  const store = new AsyncNebulaTagRecordStore({ mode: "turso", url, authToken });
  try {
    await store.initialize();
    const before = await store.getState(tenantId);
    const expectedDigest = sha256(JSON.stringify(prepared.tag));
    let after;
    if (before.revision === 0 && Object.keys(before.state.players).length === 0 && before.state.history.length === 0) {
      await store.importState(prepared.tag, migrationId);
      after = await store.getState(tenantId);
    } else if (before.revision > 0 && sha256(JSON.stringify(before.state)) === expectedDigest) {
      // A previous run completed the same import; accept only an exact read-back match.
      after = before;
    } else {
      throw new Error("Nebula Tag destination is not empty for the configured network tenant; refusing to overwrite live state.");
    }
    const actualDigest = sha256(JSON.stringify(after.state));
    if (after.revision !== 1 ||
        Object.keys(after.state.players).length !== 155 ||
        after.state.history.length !== prepared.tag.history.length ||
        actualDigest !== expectedDigest) {
      throw new Error("Turso read-back did not match the converted 155-player Tag snapshot.");
    }
    process.stdout.write(JSON.stringify({
      applied: true,
      verified: true,
      tenantId,
      migrationId,
      sourceDocuments: rows.rows.length,
      players: Object.keys(after.state.players).length,
      history: after.state.history.length,
      currentItRestored: Boolean(after.state.currentItUserId),
      sourceDigest,
      stateDigest: actualDigest,
      warnings: prepared.warnings.length,
    }, null, 2) + "\n");
  } finally {
    await store.close();
  }
}

main().catch((error) => {
  process.stderr.write("Nebula recovered Tag import failed: " + (error instanceof Error ? error.message : "unknown error") + "\n");
  process.exitCode = 1;
});
