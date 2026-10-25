import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const inputDir = process.argv[2] ?? "release-validation/logs";
const outputFile = process.argv[3] ?? "release-validation/REPORT.md";
let names = [];
try {
  names = (await readdir(inputDir)).filter((name) => /^shard-[1-4]\.tap$/.test(name)).sort();
} catch {}
const rows = [];
let missing = [];
for (let shard = 1; shard <= 4; shard++) {
  const name = `shard-${shard}.tap`;
  if (!names.includes(name)) { missing.push(shard); continue; }
  const content = await readFile(path.join(inputDir, name), "utf8");
  const read = (pattern) => Number(content.match(pattern)?.[1] ?? 0);
  const tests = read(/^# tests (\d+)$/m);
  const pass = read(/^# pass (\d+)$/m);
  const fail = read(/^# fail (\d+)$/m);
  const cancelled = read(/^# cancelled (\d+)$/m);
  const skipped = read(/^# skipped (\d+)$/m);
  const duration = content.match(/^# duration_ms ([\d.]+)$/m)?.[1] ?? "unknown";
  const hasFailureMarkers = /^(not ok \d+|# error:|Error:|OFFLINE_NETWORK_BLOCKED:)/m.test(content);
  const complete = tests > 0 && pass + fail + cancelled + skipped === tests;
  rows.push({ shard, tests, pass, fail, cancelled, skipped, duration, complete, hasFailureMarkers, content });
}
const total = (key) => rows.reduce((sum, row) => sum + row[key], 0);
const allPresent = missing.length === 0;
const passed = allPresent && rows.length === 4 && rows.every((r) => r.complete && r.fail === 0 && r.cancelled === 0 && !r.hasFailureMarkers);
const lines = [
  "# ApolloStation Oracle release validation",
  "",
  `Generated: ${new Date().toISOString()}`,
  "",
  `Overall result: ${passed ? "PASS" : "NO-GO"}`,
  "",
  "This report summarizes the four parallel offline-safe Node test shards. A pass means the repository build and all discovered test files completed without reported test failures; it does not by itself verify Oracle Cloud secrets, network policy, database connectivity, or production health.",
  "",
  "| Shard | Test cases | Pass | Fail | Cancelled | Skipped | Duration (ms) | Result |",
  "|---:|---:|---:|---:|---:|---:|---:|---|",
  ...rows.map((r) => `| ${r.shard} | ${r.tests} | ${r.pass} | ${r.fail} | ${r.cancelled} | ${r.skipped} | ${r.duration} | ${r.complete && r.fail === 0 && r.cancelled === 0 && !r.hasFailureMarkers ? "PASS" : "NO-GO"} |`),
  `| **Total** | **${total("tests")}** | **${total("pass")}** | **${total("fail")}** | **${total("cancelled")}** | **${total("skipped")}** | — | **${passed ? "PASS" : "NO-GO"}** |`,
  "",
  missing.length ? `Missing shard logs: ${missing.join(", ")}. A missing shard is a hard failure.` : "All four shard logs were found.",
  "",
  "## Failure triage",
  ""
];
if (!passed) {
  for (const r of rows.filter((x) => !x.complete || x.fail > 0 || x.cancelled > 0 || x.hasFailureMarkers)) {
    lines.push(`### Shard ${r.shard}`, "", `- Counts complete: ${r.complete}`, `- Test cases: ${r.tests}; pass: ${r.pass}; fail: ${r.fail}; cancelled: ${r.cancelled}; skipped: ${r.skipped}`, "", "Relevant failing output (last 120 lines):", "```text", ...r.content.split("\n").slice(-120), "```", "");
  }
  if (missing.length) lines.push("No log was produced for shard(s): " + missing.join(", ") + ". Check that job's Actions logs for dependency, build, cancellation, or timeout errors.", "");
  if (rows.length === 0) lines.push("No shard logs were available. Inspect the four test jobs directly.", "");
} else {
  lines.push("No test failures or cancelled tests were reported. Review skipped tests and the Oracle-specific deployment checks before authorizing cutover.", "");
}
await writeFile(outputFile, lines.join("\n") + "\n");
console.log(`Wrote ${outputFile}; result: ${passed ? "PASS" : "NO-GO"}`);
