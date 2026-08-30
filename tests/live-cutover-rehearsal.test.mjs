import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { auditChangedFiles, auditRepository, validateLiveSliceStructure } from "../scripts/audit-live-slices.mjs";

const root = new URL("..", import.meta.url).pathname;
const read = (relative) => JSON.parse(readFileSync(new URL(`../${relative}`, import.meta.url), "utf8"));

test("live-slice rehearsal is structurally valid, mirror-free, non-mutating, and truthfully blocked", () => {
  const report = auditRepository(root);
  assert.equal(report.mode, "dry-run");
  assert.equal(report.sourceMode, "remote-main-and-running-live-slice");
  assert.equal(report.ready, false);
  assert.deepEqual(report.structuralErrors, []);
  assert.equal(report.liveSources.length, 7);
  assert.ok(report.blockers.some((item) => /reconciliation/.test(item)));
  assert.ok(report.blockers.some((item) => /runtime inventory/.test(item)));
  assert.ok(report.blockers.some((item) => /owner/.test(item)));
});

test("live replacement cannot claim readiness while production blockers remain", () => {
  const slices = read("config/live-source-slices.v1.json");
  const parity = read("docs/donor-audits/app-code-parity.v1.json");
  const wiring = read("config/capability-wiring.v1.json");
  slices.productionCutover.ready = true;
  const errors = validateLiveSliceStructure({ root, slices, parity, wiring });
  assert.ok(errors.some((item) => /remain blocked/.test(item)));
});

test("changed-source intake maps Apollo owners and rejects the retired repository name as runtime identity", () => {
  const directory = mkdtempSync(join(tmpdir(), "live-slice-intake-"));
  const relative = "apps/nebula-arcade/src/runtime.ts";
  const absolute = join(directory, relative);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, "export const serviceId = 'chat-tag';\n");
  try {
    const result = auditChangedFiles({ root: directory, changedFiles: [relative], knownOwners: new Set(["nebula-arcade"]) });
    assert.deepEqual(result.affectedOwners, ["nebula-arcade"]);
    assert.ok(result.errors.some((item) => /use Nebula Arcade/.test(item)));
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
