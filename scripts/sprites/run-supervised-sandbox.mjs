import { randomBytes } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { spawn } from "node:child_process";

const argumentsMap = parseArguments(process.argv.slice(2));
const publicUrl = requireSandboxUrl(argumentsMap.get("public-url") ?? "http://localhost:8080");
const dataRoot = resolve(argumentsMap.get("data-root") ?? ".sandbox-data");
const buildSha = argumentsMap.get("build-sha") ?? "sprite-local";
const spmtPort = requirePort(argumentsMap.get("spmt-port") ?? "3000", "spmt-port");
const webPort = requirePort(argumentsMap.get("web-port") ?? "8080", "web-port");
const databasePath = resolve(dataRoot, "spmt-green-sandbox.sqlite");
await mkdir(dataRoot, { recursive: true, mode: 0o700 });

const baseEnvironment = safeEnvironment(process.env);
const common = {
  ...baseEnvironment,
  SPMT_RUNTIME_MODE: "sandbox",
  SPMT_OUTBOUND_MODE: "disabled",
  SPMT_SANDBOX_ID: "spmt-ecosystem-sandbox",
  BUILD_SHA: buildSha,
};
const children = new Set();
let stopping = false;

const spmt = start("SPMT", "apps/spmt-service/dist/index.js", {
  ...common,
  DATABASE_PATH: databasePath,
  SPMT_WEBHOOK_KEY: randomBytes(32).toString("base64url"),
  SPMT_PUBLIC_URL: publicUrl,
  SPMT_HOST: "127.0.0.1",
  SPMT_SANDBOX_FIXTURES: "1",
  PORT: String(spmtPort),
});

await waitForUrl(spmt, `http://127.0.0.1:${spmtPort}/health/ready`, "SPMT");
const web = start("SpaceMountain web", "apps/spacemountain-web/dist/server.js", {
  ...common,
  SPMT_ORIGIN: `http://127.0.0.1:${spmtPort}`,
  HOST: "0.0.0.0",
  PORT: String(webPort),
});
spmt.once("exit", (code, signal) => { if (!stopping) void stop(signal === "SIGINT" || signal === "SIGTERM" ? 0 : code ?? (signal ? 1 : 0)); });
await waitForUrl(web, `http://127.0.0.1:${webPort}/sandbox/health`, "SpaceMountain web");

process.stdout.write(`\nGreen sandbox is supervised and ready at ${publicUrl}\n`);
process.stdout.write("Outbound provider actions are disabled. No Sprite service has been registered.\n");
process.stdout.write("Press Ctrl+C once to stop both processes.\n\n");

process.on("SIGINT", () => void stop(0));
process.on("SIGTERM", () => void stop(0));
await new Promise((done) => web.once("exit", (code, signal) => { if (!stopping) void stop(signal === "SIGINT" || signal === "SIGTERM" ? 0 : code ?? (signal ? 1 : 0)).then(done); else done(); }));

function start(label, script, environment) {
  const child = spawn(process.execPath, [script], { cwd: process.cwd(), env: environment, stdio: "inherit" });
  children.add(child);
  child.once("exit", () => children.delete(child));
  child.once("error", (error) => { process.stderr.write(`${label} failed to start: ${error.message}\n`); void stop(1); });
  return child;
}

async function waitForUrl(child, url, label) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`${label} exited before readiness with code ${child.exitCode}`);
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1000) });
      if (response.ok) return;
    } catch {}
    await new Promise((done) => setTimeout(done, 150));
  }
  await stop(1);
  throw new Error(`${label} did not become ready within 15 seconds`);
}

async function stop(code) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill("SIGTERM");
  await Promise.race([
    Promise.all([...children].map((child) => child.exitCode !== null ? Promise.resolve() : new Promise((done) => child.once("exit", done)))),
    new Promise((done) => setTimeout(done, 3000)),
  ]);
  for (const child of children) child.kill("SIGKILL");
  process.exitCode = code;
}

function safeEnvironment(source) {
  const safe = {};
  for (const name of ["HOME", "PATH", "LANG", "LC_ALL", "TZ", "TMPDIR", "TEMP", "TMP"]) if (source[name]) safe[name] = source[name];
  return safe;
}

function requireSandboxUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error("--public-url must be an absolute URL"); }
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if ((!local && url.protocol !== "https:") || (!local && !url.hostname.endsWith(".sprites.app"))) throw new Error("--public-url must be a private Sprite HTTPS URL or localhost");
  if (url.username || url.password || url.pathname !== "/" || url.search || url.hash) throw new Error("--public-url must be a credential-free origin");
  return url.origin;
}

function parseArguments(values) {
  const result = new Map();
  for (let index = 0; index < values.length; index += 2) {
    const flag = values[index];
    const value = values[index + 1];
    if (!flag?.startsWith("--") || !value) throw new Error("Arguments must be --name value pairs");
    result.set(flag.slice(2), value);
  }
  for (const name of result.keys()) if (!["public-url", "data-root", "build-sha", "spmt-port", "web-port"].includes(name)) throw new Error(`Unknown argument --${name}`);
  return result;
}

function requirePort(value, name) {
  const port = Number(value);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) throw new Error(`--${name} must be an integer from 1 to 65535`);
  return port;
}
