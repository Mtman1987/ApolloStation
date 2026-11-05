#!/usr/bin/env node
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { resolve } from "node:path";
import { createAsyncJsonRecordStore } from "@spmt/async-json-store/factory";

const ACTIONS = "game-actions";
const CHANNELS = "arcade-activity-channels";
const MEMBERS = "arcade-activity-members";
const CHOICES = "arcade-activity-choices";
const INPUTS = "game-inputs";

export function readNebulaActionActivitySnapshot(db) {
  const integrity = db.prepare("PRAGMA integrity_check").all().map((row) => Object.values(row)[0]);
  if (integrity.length !== 1 || integrity[0] !== "ok") throw new Error("Source SQLite integrity_check failed");
  const tables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((row) => row.name));
  const read = (table, sql) => tables.has(table) ? db.prepare(sql).all() : [];
  const actions = read("nebula_game_actions", "SELECT tenant_id,action_id,channel,game_id,actor_id,username,display_name,action,args,message,occurred_at FROM nebula_game_actions ORDER BY tenant_id,occurred_at,action_id").map((row) => ({
    tenantId: String(row.tenant_id), key: String(row.action_id), value: {
      id: String(row.action_id), tenantId: String(row.tenant_id), channel: String(row.channel), gameId: String(row.game_id),
      actorId: String(row.actor_id), username: String(row.username), displayName: String(row.display_name), action: String(row.action),
      args: JSON.parse(String(row.args)), message: String(row.message), occurredAt: String(row.occurred_at),
    },
  }));
  const channels = read("nebula_arcade_channels", "SELECT tenant_id,channel_id,game_ids,last_spmt_at FROM nebula_arcade_channels ORDER BY tenant_id,channel_id").map((row) => ({
    tenantId: String(row.tenant_id), key: String(row.channel_id), value: { gameIds: JSON.parse(String(row.game_ids)), lastSpmtAt: row.last_spmt_at === null ? null : Number(row.last_spmt_at) },
  }));
  const members = read("nebula_arcade_members", "SELECT tenant_id,channel_id,actor_id,game_id,joined,last_seen_at FROM nebula_arcade_members ORDER BY tenant_id,channel_id,actor_id,game_id").map((row) => ({
    tenantId: String(row.tenant_id), key: [String(row.channel_id),String(row.actor_id),String(row.game_id)].map(encodeURIComponent).join("|"),
    value: { channelId: String(row.channel_id), actorId: String(row.actor_id), gameId: String(row.game_id), joined: Number(row.joined) === 1, lastSeenAt: Number(row.last_seen_at) },
  }));
  const choices = read("nebula_arcade_choices", "SELECT tenant_id,channel_id,actor_id,targets,expires_at FROM nebula_arcade_choices ORDER BY tenant_id,channel_id,actor_id").map((row) => ({
    tenantId: String(row.tenant_id), key: [String(row.channel_id),String(row.actor_id)].map(encodeURIComponent).join("|"),
    value: { targets: JSON.parse(String(row.targets)), expiresAt: Number(row.expires_at) },
  }));
  const inputs = read("nebula_game_inputs", "SELECT sequence,tenant_id,input_id,channel_id,body FROM nebula_game_inputs ORDER BY tenant_id,sequence").map((row) => ({ tenantId: String(row.tenant_id), key: String(row.input_id), value: { sequence: Number(row.sequence), input: JSON.parse(String(row.body)) } }));
  const snapshot = { actions, channels, members, choices, inputs };
  const digest = createHash("sha256").update(JSON.stringify(snapshot)).digest("hex");
  return { ...snapshot, counts: { actions: actions.length, channels: channels.length, members: members.length, choices: choices.length, inputs: inputs.length }, digest };
}

export async function importNebulaActionActivitySnapshot(store, snapshot) {
  const entries = [
    ...snapshot.actions.map((row) => [ACTIONS, row]),
    ...snapshot.channels.map((row) => [CHANNELS, row]),
    ...snapshot.members.map((row) => [MEMBERS, row]),
    ...snapshot.choices.map((row) => [CHOICES, row]),
    ...snapshot.inputs.map((row) => [INPUTS, row]),
  ];
  const tenants = [...new Set(entries.map(([, row]) => row.tenantId))];
  return store.transaction(async (tx) => {
    for (const tenantId of tenants) for (const namespace of [ACTIONS, CHANNELS, MEMBERS, CHOICES, INPUTS]) {
      if ((await tx.list(namespace, tenantId)).length) throw new Error(`Turso destination is not empty for ${namespace} / ${tenantId}`);
    }
    for (const [namespace, row] of entries) await tx.put(namespace, row.tenantId, row.key, row.value);
    const verified = {};
    for (const tenantId of tenants) for (const namespace of [ACTIONS, CHANNELS, MEMBERS, CHOICES]) {
      const expected = entries.filter(([name,row]) => name === namespace && row.tenantId === tenantId).length;
      const actual = (await tx.list(namespace, tenantId)).length;
      if (actual !== expected) throw new Error(`Turso import verification failed for ${namespace} / ${tenantId}: expected ${expected}, received ${actual}`);
      verified[`${namespace}:${tenantId}`] = actual;
    }
    return { imported: entries.length, verified, digest: snapshot.digest };
  });
}

function parseArgs(argv) {
  const result = { source: "", apply: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--source") result.source = argv[++i] ?? "";
    else if (argv[i] === "--apply") result.apply = true;
    else throw new Error(`Unknown argument: ${argv[i]}`);
  }
  if (!result.source) throw new Error("Use --source /absolute/path/to/nebula-arcade.sqlite");
  return result;
}

async function main() {
  const args = parseArgs(process.argv.slice(2)), source = resolve(args.source);
  const db = new DatabaseSync(source, { readOnly: true });
  let snapshot;
  try { snapshot = readNebulaActionActivitySnapshot(db); } finally { db.close(); }
  const report = { source, mode: args.apply ? "apply" : "dry-run", counts: snapshot.counts, digest: snapshot.digest };
  if (args.apply) {
    const url = process.env.NEBULA_ARCADE_GAME_RUNTIME_TURSO_DATABASE_URL;
    const authToken = process.env.NEBULA_ARCADE_GAME_RUNTIME_TURSO_AUTH_TOKEN;
    if (!url || !authToken) throw new Error("Apply requires NEBULA_ARCADE_GAME_RUNTIME_TURSO_DATABASE_URL and NEBULA_ARCADE_GAME_RUNTIME_TURSO_AUTH_TOKEN");
    const store = createAsyncJsonRecordStore({ service: "nebula-arcade", mode: "turso", url, authToken });
    try { await store.initialize(); report.result = await importNebulaActionActivitySnapshot(store, snapshot); } finally { await store.close(); }
  } else report.nextStep = "Review counts and digest; rerun with --apply only against the intended empty Nebula Turso database.";
  process.stdout.write(JSON.stringify(report, null, 2) + "\n");
}
if (process.argv[1] && import.meta.url === new URL(`file://${resolve(process.argv[1])}`).href) main().catch((error) => { process.stderr.write(`Nebula action/activity migration failed: ${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1; });
