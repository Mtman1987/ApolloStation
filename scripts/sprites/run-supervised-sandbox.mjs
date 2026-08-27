import { randomBytes } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { spawn } from "node:child_process";

const argumentsMap = parseArguments(process.argv.slice(2));
const app = argumentsMap.get("app") ?? "platform";
if (!["platform", "nebula-arcade"].includes(app)) throw new Error("--app must be platform or nebula-arcade");
const candidateApp = argumentsMap.get("candidate-app") ?? "none";
if (!["none", "nebula-arcade"].includes(candidateApp)) throw new Error("--candidate-app must be none or nebula-arcade");
const publicUrl = requireSandboxUrl(argumentsMap.get("public-url") ?? "http://localhost:8080");
const dataRoot = resolve(argumentsMap.get("data-root") ?? ".sandbox-data");
const buildSha = argumentsMap.get("build-sha") ?? "sprite-local";
const spmtPort = requirePort(argumentsMap.get("spmt-port") ?? "3000", "spmt-port");
const webPort = requirePort(argumentsMap.get("web-port") ?? "8080", "web-port");
const chatTagPort = requirePort(argumentsMap.get("chat-tag-port") ?? "3100", "chat-tag-port");
const ownerUsername = requireUsername(argumentsMap.get("owner-username") ?? "mtman1987");
const llmBinary = argumentsMap.get("llm-binary");
const llmCache = resolve(argumentsMap.get("llm-cache") ?? resolve(dataRoot, "models"));
const databasePath = resolve(dataRoot, "spmt-empty-catalog-sandbox.sqlite");
await mkdir(dataRoot, { recursive: true, mode: 0o700 });

const baseEnvironment = safeEnvironment(process.env);
const common = {
  ...baseEnvironment,
  SPMT_RUNTIME_MODE: "sandbox",
  SPMT_OUTBOUND_MODE: "disabled",
  SPMT_SANDBOX_ID: "spmt-ecosystem-sandbox",
  BUILD_SHA: buildSha,
};
let candidateManifest;
if (candidateApp === "nebula-arcade") {
  const module = await import("../../apps/nebula-arcade/dist/index.js");
  candidateManifest = module.nebulaArcadeCatalogRegistration(publicUrl);
}
const [{ commlinkCatalogRegistration }, { stellarCoreCatalogRegistration }, { missionControlCatalogRegistration }] = await Promise.all([
  import("../../apps/commlink/dist/index.js"),
  import("../../apps/stellar-core/dist/index.js"),
  import("../../apps/mission-control/dist/index.js"),
]);
const sandboxManifests = [
  commlinkCatalogRegistration(publicUrl),
  stellarCoreCatalogRegistration(publicUrl),
  missionControlCatalogRegistration(publicUrl),
  ...(candidateManifest ? [candidateManifest] : []),
];
const children = new Set();
let stopping = false;

if (app === "nebula-arcade") {
  const chatTag = start("Nebula Arcade", "apps/nebula-arcade/dist/chat-tag-sandbox-server.js", {
    ...common,
    CHAT_TAG_DATABASE_PATH: resolve(dataRoot, "chat-tag-green-sandbox.sqlite"),
    CHAT_TAG_TENANT_ID: argumentsMap.get("tenant-id") ?? "chat-tag-sandbox",
    CHAT_TAG_CHANNEL_ID: argumentsMap.get("channel-id") ?? "sandbox-channel",
    HOST: "0.0.0.0",
    PORT: String(webPort),
  });
  await waitForUrl(chatTag, `http://127.0.0.1:${webPort}/health/ready`, "Nebula Arcade");
  process.stdout.write(`\nNebula Arcade Green sandbox is ready at ${publicUrl}\n`);
  process.stdout.write("Gameplay, persistent state, support, overlay mode, and OBS output are enabled. Provider egress is disabled.\n");
  process.stdout.write("Press Ctrl+C once to stop the app.\n\n");
  process.on("SIGINT", () => void stop(0));
  process.on("SIGTERM", () => void stop(0));
  await new Promise((done) => chatTag.once("exit", (code, signal) => { if (!stopping) void stop(signal === "SIGINT" || signal === "SIGTERM" ? 0 : code ?? (signal ? 1 : 0)).then(done); else done(); }));
} else {
if (llmBinary) {
  const llm = startCommand("Qwen", resolve(llmBinary), ["--host", "127.0.0.1", "--port", "8081", "-hf", "Qwen/Qwen3-8B-GGUF:Q4_K_M", "--ctx-size", "8192", "--threads", "8", "--parallel", "1", "--jinja", "--no-webui"], { ...common, LLAMA_CACHE: llmCache });
  llm.once("exit", (code, signal) => { if (!stopping) void stop(signal === "SIGINT" || signal === "SIGTERM" ? 0 : code ?? (signal ? 1 : 0)); });
}
const spmt = start("SPMT", "apps/spmt-service/dist/index.js", {
  ...common,
  DATABASE_PATH: databasePath,
  SPMT_WEBHOOK_KEY: randomBytes(32).toString("base64url"),
  SPMT_PUBLIC_URL: publicUrl,
  SPMT_HOST: "127.0.0.1",
  SPMT_SANDBOX_FIXTURES: "0",
  SPMT_SANDBOX_OWNER_USERNAME: ownerUsername,
  SPMT_SANDBOX_APPS: JSON.stringify(sandboxManifests),
  PORT: String(spmtPort),
});

await waitForUrl(spmt, `http://127.0.0.1:${spmtPort}/health/ready`, "SPMT");
let chatTag;
if (candidateApp === "nebula-arcade") {
  chatTag = start("Nebula Arcade candidate", "apps/nebula-arcade/dist/chat-tag-sandbox-server.js", {
    ...common,
    CHAT_TAG_DATABASE_PATH: resolve(dataRoot, "chat-tag-green-sandbox.sqlite"),
    CHAT_TAG_TENANT_ID: argumentsMap.get("tenant-id") ?? "chat-tag-sandbox",
    CHAT_TAG_CHANNEL_ID: argumentsMap.get("channel-id") ?? "sandbox-channel",
    HOST: "127.0.0.1",
    PORT: String(chatTagPort),
  });
  chatTag.once("exit", (code, signal) => { if (!stopping) void stop(signal === "SIGINT" || signal === "SIGTERM" ? 0 : code ?? (signal ? 1 : 0)); });
  await waitForUrl(chatTag, `http://127.0.0.1:${chatTagPort}/health/ready`, "Nebula Arcade candidate");
}
const web = start("SpaceMountain web", "apps/spacemountain-web/dist/server.js", {
  ...common,
  SPMT_ORIGIN: `http://127.0.0.1:${spmtPort}`,
  HOST: "0.0.0.0",
  PORT: String(webPort),
  ...(candidateManifest ? { CHAT_TAG_ORIGIN: `http://127.0.0.1:${chatTagPort}`, SPMT_SANDBOX_CANDIDATE_MANIFEST: JSON.stringify(candidateManifest) } : {}),
});
spmt.once("exit", (code, signal) => { if (!stopping) void stop(signal === "SIGINT" || signal === "SIGTERM" ? 0 : code ?? (signal ? 1 : 0)); });
await waitForUrl(web, `http://127.0.0.1:${webPort}/sandbox/health`, "SpaceMountain web");

process.stdout.write(`\nGreen sandbox is supervised and ready at ${publicUrl}\n`);
process.stdout.write(`The canonical app pool contains ${sandboxManifests.map((item) => item.name).join(", ")}.\n`);
process.stdout.write("Outbound provider actions are disabled. No Sprite service has been registered.\n");
process.stdout.write("Press Ctrl+C once to stop the supervised cohort.\n\n");

process.on("SIGINT", () => void stop(0));
process.on("SIGTERM", () => void stop(0));
await new Promise((done) => web.once("exit", (code, signal) => { if (!stopping) void stop(signal === "SIGINT" || signal === "SIGTERM" ? 0 : code ?? (signal ? 1 : 0)).then(done); else done(); }));
}

function start(label, script, environment) {
  return startCommand(label, process.execPath, [script], environment);
}

function startCommand(label, command, args, environment) {
  const child = spawn(command, args, { cwd: process.cwd(), env: environment, stdio: "inherit" });
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
  for (const name of result.keys()) if (!["app", "candidate-app", "public-url", "data-root", "build-sha", "spmt-port", "web-port", "chat-tag-port", "tenant-id", "channel-id", "owner-username", "llm-binary", "llm-cache"].includes(name)) throw new Error(`Unknown argument --${name}`);
  return result;
}

function requireUsername(value) {
  const username = value.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9._-]{2,79}$/.test(username)) throw new Error("--owner-username is invalid");
  return username;
}

function requirePort(value, name) {
  const port = Number(value);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) throw new Error(`--${name} must be an integer from 1 to 65535`);
  return port;
}
