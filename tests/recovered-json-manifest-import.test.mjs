import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  readRecoveredJsonManifest,
  validateRecoveredJsonManifestRecord,
} from "../scripts/import-recovered-json-manifest-to-turso.mjs";

const hash = (value) => createHash("sha256").update(value).digest("hex");
function record(source, tenant, path, value) {
  const payload = JSON.stringify(value);
  const recordCounts = {};
  for (const [key, child] of Object.entries(value)) {
    if (Array.isArray(child)) recordCounts[key] = child.length;
    else if (child && typeof child === "object") recordCounts[key] = Object.keys(child).length;
  }
  return {
    source, tenant, path,
    sourceHash: "a".repeat(64),
    payloadHash: hash(payload),
    schemaVersion: value.schemaVersion ?? value.version ?? null,
    recordCounts,
    payload,
  };
}
function withManifest(records, work) {
  const directory = mkdtempSync(join(tmpdir(), "apollo-recovery-manifest-"));
  const path = join(directory, "manifest.jsonl.gz");
  writeFileSync(path, gzipSync(Buffer.from(records.map((item) => JSON.stringify(item)).join("\n") + "\n")));
  try { return work(path); } finally { rmSync(directory, { recursive: true, force: true }); }
}

test("validates a canonical pre-redacted source record", () => {
  const item = record("nebula-legacy-global", "legacy-global", "app-state.json", {
    schemaVersion: "1", tokens: "[REDACTED]", players: [],
  });
  assert.deepEqual(validateRecoveredJsonManifestRecord(item), item);
});

test("rejects a payload with a bad payload hash", () => {
  const item = record("nebula-legacy-global", "legacy-global", "app-state.json", { players: [] });
  item.payloadHash = "b".repeat(64);
  assert.throws(() => validateRecoveredJsonManifestRecord(item), /payload hash mismatch/);
});

test("rejects unredacted credential-shaped payload fields", () => {
  const item = record("nebula-legacy-global", "legacy-global", "app-state.json", {
    tokens: { access: "must-not-be-imported" },
  });
  assert.throws(() => validateRecoveredJsonManifestRecord(item), /unredacted sensitive fields/);
});

test("rejects tenant/path mismatches and traversal paths", () => {
  const wrongTenant = record("streamweaver", "other", "data/runtime/tenants/123/state.json", {});
  assert.throws(() => validateRecoveredJsonManifestRecord(wrongTenant), /tenant scope/);
  const traversal = record("streamweaver", "123", "data/runtime/tenants/123/../secrets.json", {});
  assert.throws(() => validateRecoveredJsonManifestRecord(traversal), /unsafe source path/);
});

test("reads a compressed manifest and checks per-source counts", async () => {
  const records = [
    record("nebula-legacy-global", "legacy-global", "app-state.json", { players: [] }),
    record("streamweaver", "123", "data/runtime/tenants/123/state.json", { history: [] }),
  ];
  await withManifest(records, async (path) => {
    const result = await readRecoveredJsonManifest(path, {
      expectedBySource: { "nebula-legacy-global": 1, streamweaver: 1 },
    });
    assert.equal(result.records.length, 2);
    assert.deepEqual(result.bySource, { "nebula-legacy-global": 1, streamweaver: 1 });
    assert.equal(result.tenants, 1);
  });
});

test("rejects incomplete source counts and duplicate source paths", async () => {
  const item = record("nebula-legacy-global", "legacy-global", "app-state.json", { players: [] });
  await withManifest([item], async (path) => {
    await assert.rejects(readRecoveredJsonManifest(path), /source count mismatch/);
  });
  await withManifest([item, item], async (path) => {
    await assert.rejects(readRecoveredJsonManifest(path, {
      expectedBySource: { "nebula-legacy-global": 2 },
    }), /duplicate source path/);
  });
});
