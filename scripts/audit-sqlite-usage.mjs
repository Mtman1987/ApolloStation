#!/usr/bin/env node
import { spawnSync } from "node:child_process";

const patterns = ["DatabaseSync", "node:sqlite", "DATABASE_PATH"];
const result = spawnSync("git", ["grep", "-n", "-I", "-E", patterns.join("|"), "--", "*.ts", "*.tsx", "*.js", "*.mjs", "*.cjs"], {
  encoding: "utf8",
  maxBuffer: 32 * 1024 * 1024,
});
if (result.status !== 0 && result.status !== 1) {
  process.stderr.write(result.stderr || "git grep failed\n");
  process.exit(result.status ?? 1);
}
const rows = (result.stdout || "").split("\n").filter(Boolean).map((line) => {
  const first = line.indexOf(":");
  const second = line.indexOf(":", first + 1);
  return { path: line.slice(0, first), line: Number(line.slice(first + 1, second)), match: line.slice(second + 1).trim() };
});
const byPath = new Map();
for (const row of rows) {
  const current = byPath.get(row.path) || [];
  current.push(row);
  byPath.set(row.path, current);
}
const files = [...byPath.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([path, matches]) => ({
  path,
  databaseSync: matches.filter((x) => /DatabaseSync/.test(x.match)).length,
  sqliteImports: matches.filter((x) => /node:sqlite/.test(x.match)).length,
  databasePathReferences: matches.filter((x) => /DATABASE_PATH/.test(x.match)).length,
  lines: matches,
}));
const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  gitHead: spawnSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).stdout.trim(),
  totals: {
    files: files.length,
    databaseSyncReferences: files.reduce((n, x) => n + x.databaseSync, 0),
    sqliteImportReferences: files.reduce((n, x) => n + x.sqliteImports, 0),
    databasePathReferences: files.reduce((n, x) => n + x.databasePathReferences, 0),
  },
  files,
};
const json = JSON.stringify(report, null, 2);
if (process.argv.includes("--json")) process.stdout.write(json + "\n");
else {
  process.stdout.write("ApolloStation SQLite usage audit\n");
  process.stdout.write(JSON.stringify(report.totals, null, 2) + "\n");
  for (const file of files) process.stdout.write(`\n${file.path} (DatabaseSync: ${file.databaseSync}, imports: ${file.sqliteImports}, path refs: ${file.databasePathReferences})\n`);
  process.stdout.write("\nUse --json for line-level machine-readable output. Run from the repository root.\n");
}
