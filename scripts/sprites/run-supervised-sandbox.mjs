import { randomBytes } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { spawn } from "node:child_process";

const argumentsMap = parseArguments(process.argv.slice(2));
const app = argumentsMap.get("app") ?? "platform";
if (!["platform", "nebula-arcade"].includes(app)) throw new Error("--app must be platform or nebula-arcade");
const candidateApp = argumentsMap.get("candidate-app") ?? "none";
if (!["none", "nebula-arcade"].includes(candidateApp)) throw new Error("--candidate-app must be none or nebula-arcade");
const catalog = argumentsMap.get("catalog") ?? "core";
if (!["core", "current"].includes(catalog)) throw new Error("--catalog must be core or current");
const publicUrl = requireSandboxUrl(argumentsMap.get("public-url") ?? "http://localhost:8080");
const dataRoot = resolve(argumentsMap.get("data-root") ?? ".sandbox-data");
const buildSha = argumentsMap.get("build-sha") ?? "sprite-local";
const spmtPort = requirePort(argumentsMap.get("spmt-port") ?? "3000", "spmt-port");
const webPort = requirePort(argumentsMap.get("web-port") ?? "8080", "web-port");
const nebulaArcadePort = requirePort(argumentsMap.get("nebula-arcade-port") ?? "3100", "nebula-arcade-port");
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
const [
  { commlinkCatalogRegistration },
  { chatGatewayCatalogRegistration },
  { stellarCoreCatalogRegistration },
  { missionControlCatalogRegistration },
  { discordStreamHubCatalogRegistration },
  { streamweaverCatalogRegistration },
  { hearMeOutCatalogRegistration },
  { mountainViewCatalogRegistration },
  { companionCatalogRegistration },
] = await Promise.all([
  import("../../apps/commlink/dist/index.js"),
  import("../../apps/chat-gateway/dist/index.js"),
  import("../../apps/stellar-core/dist/index.js"),
  import("../../apps/mission-control/dist/index.js"),
  import("../../apps/discord-stream-hub/dist/index.js"),
  import("../../apps/streamweaver/dist/index.js"),
  import("../../apps/hearmeout/dist/index.js"),
  import("../../apps/mountainview/dist/index.js"),
  import("../../apps/companion/dist/index.js"),
]);
const coreManifests = [
  commlinkCatalogRegistration(publicUrl),
  chatGatewayCatalogRegistration(publicUrl),
  stellarCoreCatalogRegistration(publicUrl),
  missionControlCatalogRegistration(publicUrl),
];
const currentManifests = [
  discordStreamHubCatalogRegistration(publicUrl),
  streamweaverCatalogRegistration(publicUrl),
  hearMeOutCatalogRegistration(publicUrl),
  mountainViewCatalogRegistration(publicUrl),
  companionCatalogRegistration(publicUrl),
];
const sandboxManifests = [
  ...coreManifests,
  ...(catalog === "current" ? currentManifests : []),
  ...(candidateManifest ? [candidateManifest] : []),
];
const children = new Set();
let stopping = false;
const stellarWorkerCredential = llmBinary ? randomBytes(32).toString("base64url") : undefined;
const chatGatewayCredential = randomBytes(32).toString("base64url");
const streamweaverWorkerCredential = randomBytes(32).toString("base64url");

if (app === "nebula-arcade") {
  const nebulaArcade = start("Nebula Arcade", "apps/nebula-arcade/dist/nebula-arcade-sandbox-server.js", {
    ...common,
    NEBULA_ARCADE_DATABASE_PATH: resolve(dataRoot, "nebula-arcade-green-sandbox.sqlite"),
    NEBULA_ARCADE_TENANT_ID: argumentsMap.get("tenant-id") ?? "nebula-arcade-sandbox",
    NEBULA_ARCADE_CHANNEL_ID: argumentsMap.get("channel-id") ?? "sandbox-channel",
    HOST: "0.0.0.0",
    PORT: String(webPort),
  });
  await waitForUrl(nebulaArcade, `http://127.0.0.1:${webPort}/health/ready`, "Nebula Arcade");
  process.stdout.write(`\nNebula Arcade Green sandbox is ready at ${publicUrl}\n`);
  process.stdout.write("Gameplay, persistent state, support, overlay mode, and OBS output are enabled. Provider egress is disabled.\n");
  process.stdout.write("Press Ctrl+C once to stop the app.\n\n");
  process.on("SIGINT", () => void stop(0));
  process.on("SIGTERM", () => void stop(0));
  await new Promise((done) => nebulaArcade.once("exit", (code, signal) => { if (!stopping) void stop(signal === "SIGINT" || signal === "SIGTERM" ? 0 : code ?? (signal ? 1 : 0)).then(done); else done(); }));
} else {
let llm;
if (llmBinary) {
  llm = startCommand("Qwen", resolve(llmBinary), ["--host", "127.0.0.1", "--port", "8081", "-hf", "Qwen/Qwen3-8B-GGUF:Q4_K_M", "--ctx-size", "8192", "--threads", "8", "--parallel", "1", "--jinja", "--no-webui"], { ...common, LLAMA_CACHE: llmCache });
  llm.once("exit", (code, signal) => { if (!stopping) void stop(signal === "SIGINT" || signal === "SIGTERM" ? 0 : code ?? (signal ? 1 : 0)); });
}
const spmt = start("SPMT", "apps/spmt-service/dist/provider-identity-start.js", {
  ...common,
  DATABASE_PATH: databasePath,
  SPMT_WEBHOOK_KEY: randomBytes(32).toString("base64url"),
  SPMT_PUBLIC_URL: publicUrl,
  SPMT_HOST: "127.0.0.1",
  SPMT_SANDBOX_FIXTURES: "0",
  SPMT_SANDBOX_OWNER_USERNAME: ownerUsername,
  SPMT_SANDBOX_APPS: JSON.stringify(sandboxManifests),
  SPMT_CHAT_GATEWAY_ENABLED: "1",
  CHAT_GATEWAY_WORKER_CREDENTIAL: chatGatewayCredential,
  SPMT_STREAMWEAVER_PROVIDER_RUNTIME_ENABLED: "1",
  STREAMWEAVER_WORKER_CREDENTIAL: streamweaverWorkerCredential,
  ...(stellarWorkerCredential ? { SPMT_STELLAR_CHAT_ENABLED: "1", STELLAR_WORKER_CREDENTIAL: stellarWorkerCredential } : {}),
  PORT: String(spmtPort),
});

await waitForUrl(spmt, `http://127.0.0.1:${spmtPort}/health/ready`, "SPMT");
const chatGateway = start("Chat Gateway", "apps/chat-gateway/dist/service-start.js", {
  ...common,
  SPMT_ORIGIN: `http://127.0.0.1:${spmtPort}`,
  CHAT_GATEWAY_DATABASE_PATH: resolve(dataRoot, "chat-gateway-sandbox.sqlite"),
  CHAT_GATEWAY_WORKER_CREDENTIAL: chatGatewayCredential,
  CHAT_GATEWAY_CONNECTIONS: "[]",
  STREAMWEAVER_PROVIDER_RUNTIME_ENABLED: "1",
  STREAMWEAVER_WORKER_CREDENTIAL: streamweaverWorkerCredential,
  STREAMWEAVER_DATABASE_PATH: resolve(dataRoot, "streamweaver-provider-sandbox.sqlite"),
});
chatGateway.once("exit", (code, signal) => { if (!stopping) void stop(signal === "SIGINT" || signal === "SIGTERM" ? 0 : code ?? (signal ? 1 : 0)); });
if (stellarWorkerCredential) {
  const stellar = start("Stellar Core worker", "apps/stellar-core/dist/worker-start.js", {
    ...common,
    SPMT_ORIGIN: `http://127.0.0.1:${spmtPort}`,
    STELLAR_PROVIDER_ORIGIN: "http://127.0.0.1:8081",
    STELLAR_PROVIDER_MODEL: "Qwen/Qwen3-8B-GGUF:Q4_K_M",
    STELLAR_EXECUTION_TARGET: "sprite",
    STELLAR_WORKER_CREDENTIAL: stellarWorkerCredential,
    ...(llm?.pid ? { STELLAR_PROVIDER_PID: String(llm.pid) } : {}),
  });
  stellar.once("exit", (code, signal) => { if (!stopping) void stop(signal === "SIGINT" || signal === "SIGTERM" ? 0 : code ?? (signal ? 1 : 0)); });
  await waitForUrl(stellar, `http://127.0.0.1:${spmtPort}/health/stellar`, "Stellar Core hosted inference", 10 * 60_000);
}
let nebulaArcade;
if (candidateApp === "nebula-arcade") {
  nebulaArcade = start("Nebula Arcade candidate", "apps/nebula-arcade/dist/nebula-arcade-sandbox-server.js", {
    ...common,
    NEBULA_ARCADE_DATABASE_PATH: resolve(dataRoot, "nebula-arcade-green-sandbox.sqlite"),
    NEBULA_ARCADE_TENANT_ID: argumentsMap.get("tenant-id") ?? "nebula-arcade-sandbox",
    NEBULA_ARCADE_CHANNEL_ID: argumentsMap.get("channel-id") ?? "sandbox-channel",
    HOST: "127.0.0.1",
    PORT: String(nebulaArcadePort),
  });
  nebulaArcade.once("exit", (code, signal) => { if (!stopping) void stop(signal === "SIGINT" || signal === "SIGTERM" ? 0 : code ?? (signal ? 1 : 0)); });
  await waitForUrl(nebulaArcade, `http://127.0.0.1:${nebulaArcadePort}/health/ready`, "Nebula Arcade candidate");
}
const web = start("SpaceMountain web", "apps/spacemountain-web/dist/integrated-server.js", {
  ...common,
  SPMT_ORIGIN: `http://127.0.0.1:${spmtPort}`,
  HOST: "0.0.0.0",
  PORT: String(webPort),
  ...(candidateManifest ? { NEBULA_ARCADE_ORIGIN: `http://127.0.0.1:${nebulaArcadePort}`, SPMT_SANDBOX_CANDIDATE_MANIFEST: JSON.stringify(candidateManifest) } : {}),
});
spmt.once("exit", (code, signal) => { if (!stopping) void stop(signal === "SIGINT" || signal === "SIGTERM" ? 0 : code ?? (signal ? 1 : 0)); });
await waitForUrl(web, `http://127.0.0.1:${webPort}/sandbox/health`, "SpaceMountain web");

process.stdout.write(`\nGreen sandbox is supervised and ready at ${publicUrl}\n`);
process.stdout.write(`The canonical app pool contains ${sandboxManifests.map((item) => item.name).join(", ")}.\n`);
process.stdout.write("Outbound provider actions and production fleet credentials are disabled.\n");
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

async function waitForUrl(child, url, label, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`${label} exited before readiness with code ${child.exitCode}`);
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1000) });
      if (response.ok) return;
    } catch {}
    await new Promise((done) => setTimeout(done, 150));
  }
  await stop(1);
  throw new Error(`${label} did not become ready within ${Math.ceil(timeoutMs / 1000)} seconds`);
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
  for (const name of result.keys()) if (!["app", "candidate-app", "catalog", "public-url", "data-root", "build-sha", "spmt-port", "web-port", "nebula-arcade-port", "tenant-id", "channel-id", "owner-username", "llm-binary", "llm-cache"].includes(name)) throw new Error(`Unknown argument --${name}`);
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
