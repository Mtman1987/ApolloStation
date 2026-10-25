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
const bins = Array.from({ length: shardCount }, () => ({ files: [], weight: 0 }));
for (const item of files) {
  bins.sort((a, b) => a.weight - b.weight);
  bins[0].files.push(item.file);
  bins[0].weight += item.size;
}
const selected = bins[shard - 1].files.sort();
if (selected.length === 0) {
  console.error(`Shard ${shard} received no test files; refusing to pass silently.`);
  process.exit(2);
}
console.log(`Release validation shard ${shard}/${shardCount}: ${selected.length} of ${names.length} test files`);
for (const file of selected) console.log(`  ${file}`);
console.log("Running with the repository's offline-network guard enabled.");

const result = spawnSync(process.execPath, [
  "--import", "./scripts/offline-network-guard.mjs",
  "--test", ...selected
], { stdio: "inherit", env: process.env });
if (result.error) {
  console.error(result.error);
  process.exit(1);
}
process.exit(result.status ?? 1);
