import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const completion = JSON.parse(readFileSync(new URL("../docs/donor-audits/app-code-parity.v1.json", import.meta.url), "utf8"));

test("app-code parity completion remains evidence-backed while production cutover stays blocked", () => {
  assert.equal(completion.schemaVersion, 1);
  assert.equal(completion.appCodeParity, "complete");
  assert.equal(completion.productionCutover, "blocked");
  assert.ok(completion.cutoverOnlyGates.length >= 5);
  for (const [family, files] of Object.entries(completion.evidence)) {
    assert.ok(files.length > 0, `${family} must retain regression evidence`);
    for (const file of files) assert.equal(existsSync(new URL(`../${file}`, import.meta.url)), true, `${family} evidence missing: ${file}`);
  }
});

test("completion evidence covers every first-party parity family", () => {
  assert.deepEqual(Object.keys(completion.evidence).sort(), [
    "chatGateway",
    "cutoverRecovery",
    "discordStreamHub",
    "functionalFoundation",
    "hearmeout",
    "mountainviewCompanion",
    "nebulaArcade",
    "overlayAuthority",
    "spacemountainShell",
    "spmtIdentityAuthDeveloper",
    "spmtXpWalletIntegrity",
    "streamweaver",
  ]);
});
