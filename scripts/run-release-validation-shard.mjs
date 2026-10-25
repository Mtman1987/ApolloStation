import { readdir, stat } from "node:fs/promises";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import path from "node:path";

const shard = Number(process.argv[2]);
const shardCount = Number(process.argv[3]);
if (!Number.isInteger(shard) || !Number.isInteger(shardCount) || shard < 1 || shard > shardCount || shardCount !== 4) {
  console.error("Usage: node scripts/run-release-validation-shard.mjs <shard 1-4> 4");
  process.exit(2);
}

const names = (await readdir("tests"))
  .filter((name) => name.endsWith(".test.mjs"))
  .map((name) => path.join("tests", name))
  .sort();
if (names.length === 0) {
  console.error("No tests/*.test.mjs files found; refusing to report a false green.");
  process.exit(2);
}

// Deterministic largest-first assignment balances estimated work. Actual runtime
// is measured below, and each file is isolated so a single open handle cannot
// keep an entire shard alive indefinitely.
const files = await Promise.all(names.map(async (file) => ({ file, size: (await stat(file)).size, weight: (await stat(file)).size })));
files.sort((a, b) => b.weight - a.weight || a.file.localeCompare(b.file));
const bins = Array.from({ length: shardCount }, (_, index) => ({ id: index + 1, files: [], weight: 0 }));
for (const item of files) {
  bins.sort((a, b) => a.weight - b.weight || a.id - b.id);
  bins[0].files.push(item);
  bins[0].weight += item.weight;
}
const selected = bins.find((bin) => bin.id === shard).files.sort((a, b) => a.file.localeCompare(b.file));
if (selected.length === 0) {
  console.error(`Shard ${shard} received no test files; refusing to pass silently.`);
  process.exit(2);
}

const concurrency = Math.max(1, Math.min(4, Number(process.env.RELEASE_TEST_CONCURRENCY) || 4));
const timeoutMs = Math.max(10000, Number(process.env.RELEASE_TEST_FILE_TIMEOUT_MS) || 30000);
const shardStarted = Date.now();
console.log(`Release validation shard ${shard}/${shardCount}: ${selected.length} of ${names.length} test files; ${concurrency} workers; per-file timeout ${timeoutMs}ms`);
console.log("Each test file runs in its own process; progress and per-test output stream live.");
for (const { file } of selected) console.log(`  ${file}`);

const timingHistory = {};
const results = [];
let cursor = 0;
let stopped = false;
const active = new Map();
function terminateGroup(child, signal) {
  if (!child?.pid) return;
  try { process.kill(-child.pid, signal); }
  catch { try { child.kill(signal); } catch {} }
}

function runFile(file) {
  return new Promise((resolve) => {
    const started = Date.now();
    let output = "";
    let timedOut = false;
    let spawnError = null;
    console.log(`[START] ${file}`);
    const child = spawn(process.execPath, [
      "--import", "./scripts/offline-network-guard.mjs",
      "--test", "--test-reporter=tap", file
    ], { stdio: ["ignore", "pipe", "pipe"], env: process.env, detached: process.platform !== "win32" });
    active.set(file, child);
    const consume = (stream, label) => {
      const lines = createInterface({ input: stream, crlfDelay: Infinity });
      lines.on("line", (line) => {
        output += line + "\n";
        console.log(`[${path.basename(file)} ${label}] ${line}`);
      });
    };
    consume(child.stdout, "out");
    consume(child.stderr, "err");
    const timer = setTimeout(() => {
      timedOut = true;
      console.error(`[TIMEOUT] ${file} exceeded ${timeoutMs}ms; terminating this shard's test processes`);
      stopped = true;
      for (const running of active.values()) terminateGroup(running, "SIGTERM");
      const killTimer = setTimeout(() => { for (const running of active.values()) terminateGroup(running, "SIGKILL"); }, 1500);
      killTimer.unref();
    }, timeoutMs);
    child.on("error", (error) => { spawnError = error; });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      active.delete(file);
      const durationMs = Date.now() - started;
      const summary = (label) => Number(output.match(new RegExp(`^# ${label} (\\d+)$`, "m"))?.[1] ?? NaN);
      const tests = summary("tests"), pass = summary("pass"), fail = summary("fail");
      const cancelled = summary("cancelled"), skipped = summary("skipped");
      const complete = [tests, pass, fail, cancelled, skipped].every(Number.isInteger)
        && tests > 0 && pass + fail + cancelled + skipped === tests;
      const ok = !timedOut && !spawnError && code === 0 && complete;
      const result = { file, durationMs, tests: Number.isInteger(tests) ? tests : 0,
        pass: Number.isInteger(pass) ? pass : 0, fail: Number.isInteger(fail) ? fail : 0,
        cancelled: Number.isInteger(cancelled) ? cancelled : 0,
        skipped: Number.isInteger(skipped) ? skipped : 0, complete, ok,
        timedOut, code, signal, spawnError: spawnError?.message };
      timingHistory[file] = durationMs;
      console.log(`[${ok ? "DONE" : "FAIL"}] ${file}: ${durationMs}ms; tests=${result.tests}, pass=${result.pass}, fail=${result.fail}, cancelled=${result.cancelled}, skipped=${result.skipped}${timedOut ? "; TIMED OUT" : ""}`);
      if (spawnError) console.error(spawnError);
      resolve({ ...result, output });
    });
  });
}

async function worker() {
  while (!stopped) {
    const item = selected[cursor++];
    if (!item) return;
    const result = await runFile(item.file);
    results.push(result);
    if (result.timedOut) stopped = true;
  }
}
await Promise.all(Array.from({ length: concurrency }, () => worker()));

const ordered = results.sort((a, b) => a.file.localeCompare(b.file));
const tests = ordered.reduce((n, r) => n + r.tests, 0);
const pass = ordered.reduce((n, r) => n + r.pass, 0);
const fail = ordered.reduce((n, r) => n + r.fail, 0);
const cancelled = ordered.reduce((n, r) => n + r.cancelled, 0);
const skipped = ordered.reduce((n, r) => n + r.skipped, 0);
const incomplete = ordered.filter((r) => !r.complete);
const timedOut = ordered.filter((r) => r.timedOut);
const failedFiles = ordered.filter((r) => !r.ok);
const wallMs = Date.now() - shardStarted;
console.log(`Shard ${shard} completed: ${tests} tests; ${pass} passed; ${fail} failed; ${cancelled} cancelled; ${skipped} skipped.`);
console.log(`Shard ${shard} file processes: ${ordered.length}/${selected.length}; wall upper bound ${wallMs}ms; failed files ${failedFiles.length}.`);
console.log("# tests " + tests);
console.log("# pass " + pass);
console.log("# fail " + fail);
console.log("# cancelled " + cancelled);
console.log("# skipped " + skipped);
console.log("# duration_ms " + wallMs);
if (timedOut.length) console.error("# error: timed out test file(s): " + timedOut.map((r) => r.file).join(", "));
if (incomplete.length) console.error("# error: incomplete test file output: " + incomplete.map((r) => r.file).join(", "));
if (failedFiles.length) console.error("# error: failed test file(s): " + failedFiles.map((r) => r.file).join(", "));
// Per-file timings are printed as each subprocess completes. The workflow log is
// the durable timing record; no generated history file is assumed to persist.
if (stopped || failedFiles.length || incomplete.length || fail > 0 || cancelled > 0) process.exit(1);
