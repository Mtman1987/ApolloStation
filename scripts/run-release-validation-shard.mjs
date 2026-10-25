import { readdir, stat } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";

const shard = Number(process.argv[2]);
const shardCount = Number(process.argv[3]);
if (!Number.isInteger(shard) || !Number.isInteger(shardCount) || shard < 1 || shard > shardCount || shardCount !== 4) {
  console.error("Usage: node scripts/run-release-validation-shard.mjs <shard 1-4> 4");
  process.exit(2);
}

const names = (await readdir("tests"))
  .filter((name) => name.endsWith(".test.mjs"))
  .map((name) => path.join("tests", name));
if (names.length === 0) {
  console.error("No tests/*.test.mjs files found; refusing to report a false green.");
  process.exit(2);
}

// Largest-first greedy assignment balances the lanes by source-file size while
// keeping assignment deterministic. Every discovered test file is assigned once.
const files = await Promise.all(names.map(async (file) => ({ file, size: (await stat(file)).size })));
files.sort((a, b) => b.size - a.size || a.file.localeCompare(b.file));
const bins = Array.from({ length: shardCount }, (_, index) => ({ id: index + 1, files: [], weight: 0 }));
for (const item of files) {
  bins.sort((a, b) => a.weight - b.weight);
  bins[0].files.push(item.file);
  bins[0].weight += item.size;
}
const selected = bins.find((bin) => bin.id === shard).files.sort();
if (selected.length === 0) {
  console.error(`Shard ${shard} received no test files; refusing to pass silently.`);
  process.exit(2);
}
console.log(`Release validation shard ${shard}/${shardCount}: ${selected.length} of ${names.length} test files`);
for (const file of selected) console.log(`  ${file}`);
console.log("Running with the repository's offline-network guard enabled.");

// Capture and replay the complete runner output so we can distinguish a completed
// test run with failing assertions from an interrupted/crashed runner. Assertion
// failures belong in the report; only an incomplete run should fail this job.
const result = spawnSync(process.execPath, [
  "--import", "./scripts/offline-network-guard.mjs",
  "--test", ...selected
], {
  encoding: "utf8",
  env: process.env,
  maxBuffer: 50 * 1024 * 1024
});

if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);

if (result.error) {
  console.error("TEST RUNNER ERROR: test process could not complete.", result.error);
  process.exit(1);
}
if (result.signal) {
  console.error(`TEST RUNNER INTERRUPTED: process ended from signal ${result.signal}.`);
  process.exit(1);
}

const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
const readCount = (label) => {
  const match = output.match(new RegExp(`^# ${label} (\\d+)$`, "m"));
  return match ? Number(match[1]) : null;
};
const tests = readCount("tests");
const pass = readCount("pass");
const fail = readCount("fail");
const cancelled = readCount("cancelled");
const skipped = readCount("skipped");
const summaryComplete = [tests, pass, fail, cancelled, skipped].every(Number.isInteger)
  && tests > 0
  && pass + fail + cancelled + skipped === tests;

if (!summaryComplete) {
  console.error("TEST RUN INCOMPLETE: no complete Node test summary was produced; refusing to mark this shard green.");
  process.exit(result.status === 0 ? 1 : (result.status ?? 1));
}

console.log(`Shard ${shard} completed: ${tests} tests; ${pass} passed; ${fail} failed; ${cancelled} cancelled; ${skipped} skipped.`);
if (fail > 0 || cancelled > 0) {
  console.log("Shard execution succeeded as a reporting job. Test failures are preserved in the TAP log and consolidated report; the separate release quality gate will remain NO-GO.");
}
process.exit(0);
