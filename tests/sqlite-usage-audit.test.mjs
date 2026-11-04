import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildReport, classifyPath } from "../scripts/audit-sqlite-usage.mjs";

const head = "a".repeat(40);

test("SQLite audit separates runtime, tests, donor evidence and tooling", () => {
  for (const path of ["apps/spmt-service/src/server.ts", "packages/authority-sqlite/src/index.ts", "services/restream-control/src/server.js"]) assert.equal(classifyPath(path), "runtime");
  for (const path of ["tests/sqlite.test.mjs", "apps/demo/tests/server.cjs", "packages/example/src/example.spec.ts", "services/demo/fixtures/sql.js"]) assert.equal(classifyPath(path), "test");
  assert.equal(classifyPath("docs/archive/evidence/raw/spmt-live/src/db.ts"), "evidence");
  assert.equal(classifyPath("donors/demo/tests/db.js"), "evidence");
  assert.equal(classifyPath("scripts/audit-sqlite-usage.mjs"), "tooling");
});

test("runtime-only output excludes evidence but retains transparent scope totals", () => {
  const output = [
    `${head}:apps/demo/src/db.ts:7:import { DatabaseSync } from 'node:sqlite';`,
    `${head}:apps/demo/src/db.ts:8:const path = env.DATABASE_PATH;`,
    `${head}:tests/demo.test.mjs:9:DatabaseSync`,
    `${head}:docs/archive/evidence/raw/demo/db.js:4:DatabaseSync`,
    `${head}:scripts/example.mjs:2:DATABASE_PATH`,
  ].join("\n");
  const all = buildReport(head, output);
  const runtime = buildReport(head, output, true);
  assert.equal(all.totals.files, 4);
  assert.equal(runtime.schemaVersion, 1);
  assert.equal(runtime.source, "git-commit");
  assert.equal(runtime.selection, "runtime-only");
  assert.deepEqual(runtime.totals, { files: 1, databaseSyncReferences: 1, sqliteImportReferences: 1, databasePathReferences: 1 });
  assert.equal(runtime.files[0].lines[1].line, 8);
  assert.equal(runtime.scopeTotals.evidence.files, 1);
  assert.equal(runtime.scopeTotals.test.files, 1);
  assert.deepEqual(runtime.scopeTotals, all.scopeTotals);
});

test("audit provenance and malformed rows fail closed", () => {
  assert.throws(() => buildReport("HEAD", ""), /commit identity/);
  assert.throws(() => buildReport(head, "b".repeat(40) + ":apps/demo.ts:1:DatabaseSync"), /scanned commit/);
  assert.throws(() => buildReport(head, head + ":bad-row"), /Malformed/);
  assert.equal(buildReport(head, "", true).totals.files, 0);
});

test("audit CLI scans committed source rather than dirty or untracked files", async () => {
  const root = await mkdtemp(join(tmpdir(), "apollo-sqlite-audit-"));
  const script = fileURLToPath(new URL("../scripts/audit-sqlite-usage.mjs", import.meta.url));
  function git(...args) {
    const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  }
  try {
    git("init", "--quiet");
    await mkdir(join(root, "apps/demo/src"), { recursive: true });
    await writeFile(join(root, "apps/demo/src/db.ts"), "const db = new DatabaseSync('fixture');\n");
    git("add", ".");
    git("-c", "user.name=Apollo fixture", "-c", "user.email=fixture@example.invalid", "commit", "--quiet", "-m", "fixture");
    const committed = git("rev-parse", "HEAD");
    await writeFile(join(root, "apps/demo/src/db.ts"), "// dirty file has no persistence references\n");
    await writeFile(join(root, "apps/demo/src/untracked.ts"), "DatabaseSync DATABASE_PATH\n");
    const result = spawnSync(process.execPath, [script, "--runtime-only", "--json"], { cwd: root, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(result.stdout);
    assert.equal(report.gitHead, committed);
    assert.equal(report.totals.files, 1);
    assert.equal(report.files[0].lines[0].match, "const db = new DatabaseSync('fixture');");
    assert.equal(report.files[0].path, "apps/demo/src/db.ts");
    const nested = spawnSync(process.execPath, [script, "--json"], { cwd: join(root, "apps/demo"), encoding: "utf8" });
    assert.equal(nested.status, 1);
    assert.match(nested.stderr, /repository root/);
    const unknown = spawnSync(process.execPath, [script, "--typo"], { cwd: root, encoding: "utf8" });
    assert.equal(unknown.status, 1);
    assert.match(unknown.stderr, /Unknown audit option/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("audit CLI fails outside Git rather than publishing a false empty inventory", async () => {
  const root = await mkdtemp(join(tmpdir(), "apollo-no-git-"));
  try {
    const result = spawnSync(process.execPath, [fileURLToPath(new URL("../scripts/audit-sqlite-usage.mjs", import.meta.url)), "--json"], { cwd: root, encoding: "utf8" });
    assert.equal(result.status, 1);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /SQLite audit failed/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
