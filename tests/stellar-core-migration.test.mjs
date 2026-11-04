import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { SqlitePlatformDataStore } from "../packages/platform-data-sqlite/dist/index.js";

test("Stellar Core preserves generic context and capabilities stored under the former subsystem name", () => {
  const root = mkdtempSync(join(tmpdir(), "spmt-stellar-migration-"));
  const path = join(root, "platform.sqlite");
  const legacy = new DatabaseSync(path);
  const context = {
    id: "ctx-1",
    tenantId: "tenant-a",
    userId: "user-a",
    sourceAppId: "streamweaver",
    kind: "summary",
    text: "Keep the established persona continuity.",
    tags: ["persona"],
    updatedAt: "2026-08-21T00:00:00.000Z",
  };
  const capability = {
    id: "persona.respond",
    sourceAppId: "streamweaver",
    title: "Persona response",
    description: "Generate a response through the shared inference layer.",
    requiredScopes: ["persona:respond"],
    availability: "unavailable",
    unavailableReason: "Green worker is not connected",
    updatedAt: "2026-08-21T00:00:00.000Z",
  };

  try {
    legacy.exec(`
      CREATE TABLE athena_context(id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,user_id TEXT,updated_at TEXT NOT NULL,body TEXT NOT NULL) STRICT;
      CREATE TABLE athena_commands(id TEXT PRIMARY KEY,body TEXT NOT NULL) STRICT;
    `);
    legacy.prepare("INSERT INTO athena_context(id,tenant_id,user_id,updated_at,body) VALUES(?,?,?,?,?)").run(context.id, context.tenantId, context.userId, context.updatedAt, JSON.stringify(context));
    legacy.prepare("INSERT INTO athena_commands(id,body) VALUES(?,?)").run(capability.id, JSON.stringify(capability));
    legacy.close();

    const store = new SqlitePlatformDataStore(path);
    try {
      assert.deepEqual(store.listStellarContext("tenant-a", "user-a"), [context]);
      assert.deepEqual(store.listStellarCapabilities(), [capability]);
    } finally {
      store.close();
    }
  } finally {
    try { legacy.close(); } catch {}
    rmSync(root, { recursive: true, force: true });
  }
});
