import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const execFileAsync = promisify(execFile);
import { buildRecoveredJsonManifest, stageRecoveredJson } from "../scripts/stage-recovered-json-to-turso.mjs";

test("Chat Tag JSON remains one legacy-global source and secrets are redacted", async () => {
  const root = await mkdtemp(join(tmpdir(), "apollo-chat-tag-"));
  try {
    await mkdir(join(root, "data"), { recursive: true });
    await writeFile(join(root, "data", "app-state.json"), JSON.stringify({
      schemaVersion: 2,
      tagPlayers: { p1: { id: "p1" }, p2: { id: "p2" } },
      tagHistory: [{ id: "h1" }, { id: "h2" }],
      token: "do-not-store",
      nested: { clientSecret: "also-do-not-store" },
    }));
    await writeFile(join(root, "data", "revoked-accounts.json"), "[]");
    const records = await buildRecoveredJsonManifest({ legacyNebulaRoot: root });
    assert.equal(records.length, 2);
    assert.ok(records.every((record) => record.tenant === "legacy-global"));
    const state = records.find((record) => record.path.endsWith("app-state.json"));
    assert.ok(state.payload.includes("[REDACTED]"));
    assert.ok(!state.payload.includes("do-not-store"));
    assert.equal(state.schemaVersion, "2");
    assert.deepEqual(state.recordCounts, { tagPlayers: 2, tagHistory: 2, nested: 1 });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("StreamWeaver tenant directories are kept distinct and token path is skipped", async () => {
  const root = await mkdtemp(join(tmpdir(), "apollo-streamweaver-"));
  try {
    await mkdir(join(root, "data/runtime/tenants/tenant-a/config"), { recursive: true });
    await mkdir(join(root, "data/runtime/tenants/tenant-b/data"), { recursive: true });
    await mkdir(join(root, "data/runtime/tokens"), { recursive: true });
    await writeFile(join(root, "data/runtime/tenants/tenant-a/config/settings.json"), "{}");
    await writeFile(join(root, "data/runtime/tenants/tenant-b/data/state.json"), "{}");
    await writeFile(join(root, "data/runtime/tokens/provider.json"), '{"token":"secret"}');
    await writeFile(join(root, "data/runtime/global.json"), "{}");
    const records = await buildRecoveredJsonManifest({ streamWeaverRoot: root });
    assert.equal(records.length, 3);
    assert.equal(records.find((r) => r.path.includes("tenant-a")).tenant, "tenant-a");
    assert.equal(records.find((r) => r.path.includes("tenant-b")).tenant, "tenant-b");
    assert.equal(records.find((r) => r.path.endsWith("global.json")).tenant, "__global__");
    assert.ok(!records.some((r) => r.path.includes("/tokens/")));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("dry-run stages nothing and apply is idempotent but rejects changed source", async () => {
  const records = [{
    source: "nebula-legacy-global", tenant: "legacy-global", path: "data/app-state.json",
    sourceHash: "source-hash", payloadHash: "payload-hash", schemaVersion: "1", recordCounts: { players: 1 }, payload: '{"ok":true}',
  }];
  const rows = new Map();
  const calls = [];
  const adapter = {
    async pipeline(statements) {
      const results = [];
      for (const statement of statements) results.push(await this.execute(statement.sql, statement.args ?? [], statement.wantRows ?? false));
      return results;
    },
    async execute(sql, args = [], wantRows = false) {
      calls.push(sql);
      if (sql.startsWith("SELECT source, tenant_key, source_path")) {
        return {
          rows: [...rows.entries()].map(([key, row]) => [
            ...key.split("\\u0000"), row.sourceHash, row.payloadHash, row.schemaVersion, row.recordCountsJson,
          ]),
        };
      }
      if (sql.startsWith("SELECT tenant_key, source_path")) {
        const source = args[0];
        return {
          rows: [...rows.entries()].filter(([, row]) => row.source === source).map(([, row]) => [
            row.tenant, row.path, row.sourceHash, row.payloadHash, row.schemaVersion, row.recordCountsJson,
          ]),
        };
      }
      if (sql.startsWith("INSERT INTO")) {
        rows.set(args.slice(0, 3).join("\\u0000"), {
          source: args[0], tenant: args[1], path: args[2], sourceHash: args[3], payloadHash: args[4],
          schemaVersion: args[5], recordCountsJson: args[6],
        });
        return { rows: [], affectedRows: 1 };
      }
      return { rows: [], affectedRows: 0 };
    },
  };
  const dry = await stageRecoveredJson({ records, adapter });
  assert.equal(dry.applied, false);
  assert.equal(calls.length, 0);
  const first = await stageRecoveredJson({ records, adapter, apply: true });
  assert.equal(first.verified, true);
  assert.equal(rows.size, 1);
  const second = await stageRecoveredJson({ records, adapter, apply: true });
  assert.equal(rows.size, 1);
  assert.equal(second.destinationCounts["nebula-legacy-global"], 1);
  await assert.rejects(
    stageRecoveredJson({ records: [{ ...records[0], payloadHash: "different" }], adapter, apply: true }),
    /refusing overwrite/,
  );
});

test("redacts plural and camelCase credential containers in recovered Chat Tag state", async () => {
  const root = await mkdtemp(join(tmpdir(), "apollo-chat-tag-secrets-"));
  try {
    await mkdir(join(root, "data"), { recursive: true });
    const secrets = [
      "twitch-access-secret-value",
      "twitch-refresh-secret-value",
      "discord-webhook-secret-value",
    ];
    await writeFile(join(root, "data", "app-state.json"), JSON.stringify({
      botRuntime: { tokens: { TWITCH_BOT_TOKEN: secrets[0], TWITCH_BOT_REFRESH_TOKEN: secrets[1] } },
      discordWebhooks: { "channel-1": { id: "channel-1", token: secrets[2], channelId: "channel-1" } },
      nested: { clientSecret: "nested-client-secret-value", webhookUrl: "nested-webhook-url-value" },
    }));
    const records = await buildRecoveredJsonManifest({ legacyNebulaRoot: root });
    const payload = records[0].payload;
    for (const secret of [...secrets, "nested-client-secret-value", "nested-webhook-url-value"]) {
      assert.ok(!payload.includes(secret), "payload must not contain credential material");
    }
    assert.ok((payload.match(/\[REDACTED\]/g) ?? []).length >= 4);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("CLI dry-run needs no Turso credentials and accepts documented Chat Tag flag", async () => {
  const root = await mkdtemp(join(tmpdir(), "apollo-chat-tag-cli-"));
  try {
    await mkdir(join(root, "data"), { recursive: true });
    await writeFile(join(root, "data", "app-state.json"), JSON.stringify({ tagPlayers: [] }));
    const script = new URL("../scripts/stage-recovered-json-to-turso.mjs", import.meta.url);
    const { stdout } = await execFileAsync(process.execPath, [script.pathname, "--chat-tag-root", root], {
      env: { ...process.env, TURSO_DATABASE_URL: "", TURSO_AUTH_TOKEN: "" },
    });
    const result = JSON.parse(stdout);
    assert.equal(result.applied, false);
    assert.equal(result.files, 1);
    assert.equal(result.bySource["nebula-legacy-global"], 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("apply fails closed when a staged manifest row is missing from destination verification", async () => {
  const records = [{
    source: "nebula-legacy-global", tenant: "legacy-global", path: "data/app-state.json",
    sourceHash: "source-hash", payloadHash: "payload-hash", schemaVersion: "2",
    recordCounts: { tagPlayers: 1 }, payload: '{"tagPlayers":{"p1":{}}}',
  }];
  const adapter = {
    async execute(sql) {
      if (sql.startsWith("SELECT source, tenant_key, source_path")) return { rows: [] };
      if (sql.startsWith("SELECT tenant_key, source_path")) return { rows: [] };
      return { rows: [], affectedRows: 0 };
    },
    async pipeline() { return []; },
  };
  await assert.rejects(
    stageRecoveredJson({ records, adapter, apply: true }),
    /Destination verification failed/,
  );
});
