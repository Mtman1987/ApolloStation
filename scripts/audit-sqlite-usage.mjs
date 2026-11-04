#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

export function classifyPath(path) {
  if (/^(docs\/archive\/|donors?\/|evidence\/)/.test(path)) return "evidence";
  if (/(^|\/)(__tests__|tests?|fixtures)(\/|$)/.test(path) || /\.(test|spec)\.[cm]?[jt]sx?$/.test(path)) return "test";
  if (/^(apps|packages|services)\//.test(path)) return "runtime";
  return "tooling";
}

function totals(files) {
  return {
    files: files.length,
    databaseSyncReferences: files.reduce((n, x) => n + x.databaseSync, 0),
    sqliteImportReferences: files.reduce((n, x) => n + x.sqliteImports, 0),
    databasePathReferences: files.reduce((n, x) => n + x.databasePathReferences, 0),
  };
}

export function buildReport(head, output, runtimeOnly = false) {
  if (!/^[a-f0-9]{40,64}$/.test(head)) throw new Error("Invalid Git commit identity");
  const byPath = new Map();
  for (const record of output.split("\n").filter(Boolean)) {
    if (!record.startsWith(head + ":")) throw new Error("Audit row does not match the scanned commit");
    const parsed = /^(.+?):([0-9]+):(.*)$/.exec(record.slice(head.length + 1));
    if (!parsed) throw new Error("Malformed git grep audit row");
    const [, path, line, match] = parsed;
    const rows = byPath.get(path) || [];
    rows.push({ path, line: Number(line), match: match.trim() });
    byPath.set(path, rows);
  }
  const allFiles = [...byPath.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([path, lines]) => ({
    path,
    scope: classifyPath(path),
    databaseSync: lines.filter(x => /DatabaseSync/.test(x.match)).length,
    sqliteImports: lines.filter(x => /node:sqlite/.test(x.match)).length,
    databasePathReferences: lines.filter(x => /DATABASE_PATH/.test(x.match)).length,
    lines,
  }));
  const files = runtimeOnly ? allFiles.filter(file => file.scope === "runtime") : allFiles;
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    gitHead: head,
    source: "git-commit",
    selection: runtimeOnly ? "runtime-only" : "all-tracked",
    totals: totals(files),
    scopeTotals: Object.fromEntries(["runtime", "test", "evidence", "tooling"].map(scope => [scope, totals(allFiles.filter(file => file.scope === scope))])),
    files,
  };
}

function git(args, allowNoMatches = false) {
  const result = spawnSync("git", args, { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  if (result.error || (result.status !== 0 && !(allowNoMatches && result.status === 1))) {
    throw new Error(result.error?.message || result.stderr || "git command failed");
  }
  return result.stdout || "";
}

export function main(args = process.argv.slice(2)) {
  if (args.some(arg => !["--json", "--runtime-only", "--help"].includes(arg))) throw new Error("Unknown audit option");
  if (args.includes("--help")) {
    process.stdout.write("Usage: node scripts/audit-sqlite-usage.mjs [--json] [--runtime-only]\nScans committed HEAD only; run from the repository root. Never opens a database.\n");
    return;
  }
  if (git(["rev-parse", "--show-prefix"]).trim()) throw new Error("Run the audit from the repository root");
  const head = git(["rev-parse", "HEAD"]).trim();
  const output = git(["grep", "--no-color", "-n", "-I", "-E", "DatabaseSync|node:sqlite|DATABASE_PATH", head, "--", "*.ts", "*.tsx", "*.js", "*.mjs", "*.cjs"], true);
  const report = buildReport(head, output, args.includes("--runtime-only"));
  if (args.includes("--json")) process.stdout.write(JSON.stringify(report, null, 2) + "\n");
  else {
    process.stdout.write(`ApolloStation SQLite usage audit (${report.selection}, ${head})\n`);
    process.stdout.write(JSON.stringify(report.totals, null, 2) + "\n");
    for (const file of report.files) process.stdout.write(`\n[${file.scope}] ${file.path} (DatabaseSync: ${file.databaseSync}, imports: ${file.sqliteImports}, path refs: ${file.databasePathReferences})\n`);
    process.stdout.write("\nCounts are source references, not database owners or runtime reachability. Use --runtime-only --json for the migration inventory.\n");
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { main(); } catch (error) {
    process.stderr.write("SQLite audit failed: " + error.message + "\n");
    process.exitCode = 1;
  }
}
