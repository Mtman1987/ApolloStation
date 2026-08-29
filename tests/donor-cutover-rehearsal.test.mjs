import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { auditChangedFiles, auditRepository, validateCutoverStructure } from "../scripts/audit-donor-cutover.mjs";

const root = new URL("..", import.meta.url).pathname;
const read = (relative) => JSON.parse(readFileSync(new URL(`../${relative}`, import.meta.url), "utf8"));

test("donor cutover rehearsal is structurally valid, non-mutating, and truthfully blocked", () => {
  const report = auditRepository(root);
  assert.equal(report.mode, "dry-run");
  assert.equal(report.ready, false);
  assert.deepEqual(report.structuralErrors, []);
  assert.equal(report.frozenDonors.length, 7);
  assert.ok(report.blockers.some((item) => /identity-provider-links/.test(item)));
  assert.ok(report.blockers.some((item) => /Fly/.test(item)));
  assert.ok(report.blockers.some((item) => /owner/.test(item)));
});

test("a dataset cannot claim verification without counts, checksums, isolation, restore and rollback proof", () => {
  const guard = read("docs/donor-audits/production-rebuild-guard.v1.json");
  const parity = read("docs/donor-audits/app-code-parity.v1.json");
  const wiring = read("config/capability-wiring.v1.json");
  const rehearsal = read("config/donor-cutover-rehearsal.v1.json");
  rehearsal.datasets[0] = { ...rehearsal.datasets[0], status: "verified", evidence: { sourceCount: 3, targetCount: 2 } };
  const errors = validateCutoverStructure({ root, guard, parity, wiring, rehearsal });
  for (const proof of ["sourceSnapshotSha256", "sourceCanonicalSha256", "targetCanonicalSha256", "twoTenantIsolation", "restartRestore", "rollbackCheckpoint"]) assert.ok(errors.some((item) => item.includes(proof)), proof);
  assert.ok(errors.some((item) => /counts do not match/.test(item)));
});

test("chunk intake maps affected apps and rejects the historical donor name as a current code identity", () => {
  const dir = mkdtempSync(join(tmpdir(), "chunk-intake-"));
  const relative = "apps/nebula-arcade/src/runtime.ts";
  const absolute = join(dir, relative);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, "export const serviceId = 'chat-tag';\n");
  try {
    const result = auditChangedFiles({ root: dir, changedFiles: [relative], knownOwners: new Set(["nebula-arcade"]) });
    assert.deepEqual(result.affectedOwners, ["nebula-arcade"]);
    assert.ok(result.errors.some((item) => /use Nebula Arcade/.test(item)));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
