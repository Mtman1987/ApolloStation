import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const inputDir = process.argv[2] ?? "release-validation/logs";
const outputFile = process.argv[3] ?? "release-validation/REPORT.md";
let names = [];
try {
  names = (await readdir(inputDir)).filter((name) => /^shard-[1-4]\.tap$/.test(name)).sort();
} catch {}
const rows = [];
const missing = [];
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
  const processCounts = content.match(/^Shard \d+ file processes: (\d+)\/(\d+);/m);
  const completedFiles = processCounts ? Number(processCounts[1]) : 0;
  const expectedFiles = processCounts ? Number(processCounts[2]) : 0;
  const executionError = /^# error:/m.test(content) || /\[TIMEOUT\]/.test(content);
  const countsComplete = tests > 0 && pass + fail + cancelled + skipped === tests;
  const complete = countsComplete && expectedFiles > 0 && completedFiles === expectedFiles
    && cancelled === 0 && !executionError;
  rows.push({ shard, tests, pass, fail, cancelled, skipped, duration, complete, completedFiles, expectedFiles, content });
}
const total = (key) => rows.reduce((sum, row) => sum + row[key], 0);
const allPresent = missing.length === 0;
const completed = allPresent && rows.length === 4 && rows.every((r) => r.complete);
const lines = [
  "# ApolloStation Oracle release validation",
  "",
  `Generated: ${new Date().toISOString()}`,
  "",
  `Overall result: ${completed ? "PASS" : "INCOMPLETE"}`,
  `Test findings: ${total("fail")} failing test cases; this is diagnostic information, not a shard-execution failure.`,
  "",
  "A PASS means all four shards ran every assigned test file, captured complete test summaries, and produced their logs. Assertion failures are reported below but do not make the diagnostic run itself fail. Missing shards, build/setup failures, timeouts, cancelled tests, incomplete TAP summaries, or missing file output produce INCOMPLETE.",
  "",
  "| Shard | Test cases | Pass | Fail | Cancelled | Skipped | Files completed | Duration (ms) | Execution |",
  "|---:|---:|---:|---:|---:|---:|---:|---:|---|",
  ...rows.map((r) => `| ${r.shard} | ${r.tests} | ${r.pass} | ${r.fail} | ${r.cancelled} | ${r.skipped} | ${r.completedFiles}/${r.expectedFiles} | ${r.duration} | ${r.complete ? "COMPLETE" : "INCOMPLETE"} |`),
  `| **Total** | **${total("tests")}** | **${total("pass")}** | **${total("fail")}** | **${total("cancelled")}** | **${total("skipped")}** | — | — | **${completed ? "PASS" : "INCOMPLETE"}** |`,
  "",
  missing.length ? `Missing shard logs: ${missing.join(", ")}. A missing shard is an incomplete diagnostic run.` : "All four shard logs were found.",
  "",
  "## Failure triage",
  ""
];
function failureDetails(content) {
  const lines = content.split("\n");
  const selected = new Set();
  for (let i = 0; i < lines.length; i++) {
    if (/not ok \d+|^# error:|^\[TIMEOUT\]|^\[FAIL\]/.test(lines[i])) {
      for (let j = Math.max(0, i - 3); j <= Math.min(lines.length - 1, i + 24); j++) selected.add(j);
    }
  }
  if (selected.size === 0) return lines.slice(-80);
  return [...selected].sort((a, b) => a - b).map((i) => lines[i]);
}
const triageRows = rows.filter((r) => !r.complete || r.fail > 0 || r.cancelled > 0);
if (triageRows.length) {
  for (const r of triageRows) {
    lines.push(
      `### Shard ${r.shard}`,
      "",
      `- Execution complete: ${r.complete}`,
      `- Test cases: ${r.tests}; pass: ${r.pass}; fail: ${r.fail}; cancelled: ${r.cancelled}; skipped: ${r.skipped}`,
      `- Files completed: ${r.completedFiles}/${r.expectedFiles}`,
      "",
      "Failure details (all matching failed-test blocks and execution errors):",
      "```text",
      ...failureDetails(r.content),
      "```",
      ""
    );
  }
} else if (completed) {
  lines.push("No assertion failures were reported by the shards.", "");
}
if (missing.length) lines.push("No log was produced for shard(s): " + missing.join(", ") + ". Inspect those Actions jobs for dependency, build, cancellation, or timeout errors.", "");
if (rows.length === 0) lines.push("No shard logs were available. Inspect the four test jobs directly.", "");
await writeFile(outputFile, lines.join("\n") + "\n");
console.log(`Wrote ${outputFile}; diagnostic execution: ${completed ? "PASS" : "INCOMPLETE"}; test failures: ${total("fail")}`);
