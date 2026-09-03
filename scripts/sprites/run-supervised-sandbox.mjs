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
const liveReadOrigin = argumentsMap.has("live-read-origin") ? requireLiveReadOrigin(argumentsMap.get("live-read-origin")) : undefined;
if (liveReadOrigin) process.env.SPMT_LIVE_READ_ORIGIN = liveReadOrigin;
const buildSha = argumentsMap.get("build-sha") ?? "sprite-local";
const spmtPort = requirePort(argumentsMap.get("spmt-port") ?? "3000", "spmt-port");
const webPort = requirePort(argumentsMap.get("web-port") ?? "8080", "web-port");
const nebulaArcadePort = requirePort(argumentsMap.get("nebula-arcade-port") ?? "3100", "nebula-arcade-port");
const hearMeOutWebPort = requirePort(argumentsMap.get("hearmeout-web-port") ?? "3200", "hearmeout-web-port");
const dshWebPort = requirePort(argumentsMap.get("dsh-web-port") ?? "3201", "dsh-web-port");
const streamweaverWebPort = requirePort(argumentsMap.get("streamweaver-web-port") ?? "3202", "streamweaver-web-port");
const mountainViewWebPort = requirePort(argumentsMap.get("mountainview-web-port") ?? "3203", "mountainview-web-port");
const companionWebPort = requirePort(argumentsMap.get("companion-web-port") ?? "3204", "companion-web-port");
const ownerUsername = requireUsername(argumentsMap.get("owner-username") ?? "mtman1987");
const llmBinary = argumentsMap.get("llm-binary");
const llmCache = resolve(argumentsMap.get("llm-cache") ?? resolve(dataRoot, "models"));
const offlineNetworkGuard = requireBooleanFlag(argumentsMap.get("offline-network-guard") ?? "0", "offline-network-guard");
const offlineNetworkGuardPath = resolve("scripts/offline-network-guard.mjs");
if (offlineNetworkGuard) await import(offlineNetworkGuardPath);
const databasePath = resolve(dataRoot, "spmt-empty-catalog-sandbox.sqlite");
await mkdir(dataRoot, { recursive: true, mode: 0o700 });

const baseEnvironment = {
  ...safeEnvironment(process.env),
  ...(offlineNetworkGuard ? { NODE_OPTIONS: `--import=${offlineNetworkGuardPath}` } : {}),
};
const common = {
  ...baseEnvironment,
  SPMT_RUNTIME_MODE: "sandbox",
  SPMT_OUTBOUND_MODE: "disabled",
  SPMT_SANDBOX_ID: "spmt-ecosystem-sandbox",
  BUILD_SHA: buildSha,
};
const liveReadEnvironment = liveReadOrigin ? { SPMT_LIVE_READ_ORIGIN: liveReadOrigin, SPMT_LIVE_READ_PROTOCOL: "blue-v1" } : {};
let candidateManifest;
if (candidateApp === "nebula-arcade") {
  const module = await import("../../apps/nebula-arcade/dist/index.js");
  candidateManifest = module.nebulaArcadeCatalogRegistration(appLaunchUrl(publicUrl, "/apps/nebula-arcade"));
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
  commlinkCatalogRegistration(appLaunchUrl(publicUrl, "/apps/commlink")),
  chatGatewayCatalogRegistration(appLaunchUrl(publicUrl, "/apps/commlink?source=chat-gateway")),
  stellarCoreCatalogRegistration(appLaunchUrl(publicUrl, "/apps/stellar-core")),
  missionControlCatalogRegistration(appLaunchUrl(publicUrl, "/apps/mission-control")),
];
const currentManifests = [
  discordStreamHubCatalogRegistration(appLaunchUrl(publicUrl, "/apps/discord-stream-hub")),
  streamweaverCatalogRegistration(appLaunchUrl(publicUrl, "/apps/streamweaver")),
  hearMeOutCatalogRegistration(appLaunchUrl(publicUrl, "/apps/hearmeout")),
  mountainViewCatalogRegistration(appLaunchUrl(publicUrl, "/apps/mountainview")),
  companionCatalogRegistration(appLaunchUrl(publicUrl, "/apps/companion")),
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
const dshWorkerCredential = randomBytes(32).toString("base64url");
const nebulaArcadeWorkerCredential = randomBytes(32).toString("base64url");
const hearMeOutWorkerCredential = randomBytes(32).toString("base64url");

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
  SPMT_DSH_LIVE_RUNTIME_ENABLED: "1",
  DSH_WORKER_CREDENTIAL: dshWorkerCredential,
  SPMT_NEBULA_ARCADE_PROVIDER_RUNTIME_ENABLED: "1",
  NEBULA_ARCADE_WORKER_CREDENTIAL: nebulaArcadeWorkerCredential,
  SPMT_HEARMEOUT_RUNTIME_ENABLED: "1",
  HEARMEOUT_WORKER_CREDENTIAL: hearMeOutWorkerCredential,
  ...(stellarWorkerCredential ? { SPMT_STELLAR_CHAT_ENABLED: "1", STELLAR_WORKER_CREDENTIAL: stellarWorkerCredential } : {}),
  PORT: String(spmtPort),
});

await waitForUrl(spmt, `http://127.0.0.1:${spmtPort}/health/ready`, "SPMT");
const spmtOrigin = `http://127.0.0.1:${spmtPort}`;

const dshWeb = start("Discord Stream Hub web", "apps/discord-stream-hub/dist/web-server.js", { ...common, ...liveReadEnvironment, SPMT_ORIGIN: spmtOrigin, DSH_DATABASE_PATH: resolve(dataRoot, "discord-stream-hub-live-sandbox.sqlite"), DSH_RUNTIME_CONFIG_PATH: resolve("config/discord-stream-hub-runtime.sandbox.v1.json"), DSH_WORKER_CREDENTIAL: dshWorkerCredential, HOST: "127.0.0.1", PORT: String(dshWebPort) });
const streamweaverWeb = start("StreamWeaver web", "apps/streamweaver/dist/web-server.js", { ...common, ...liveReadEnvironment, SPMT_ORIGIN: spmtOrigin, STREAMWEAVER_DATABASE_PATH: resolve(dataRoot, "streamweaver-provider-sandbox.sqlite"), STREAMWEAVER_WORKER_CREDENTIAL: streamweaverWorkerCredential, CHAT_GATEWAY_CONNECTIONS: "[]", HOST: "127.0.0.1", PORT: String(streamweaverWebPort) });
const hearMeOutWeb = start("HearMeOut web", "apps/hearmeout/dist/web-server.js", { ...common, ...liveReadEnvironment, SPMT_ORIGIN: spmtOrigin, HEARMEOUT_ROOM_DATABASE_PATH: resolve(dataRoot, "hearmeout-room-sandbox.sqlite"), HEARMEOUT_WORKER_CREDENTIAL: hearMeOutWorkerCredential, HOST: "127.0.0.1", PORT: String(hearMeOutWebPort) });
const mountainViewWeb = start("MountainView web", "apps/mountainview/dist/web-server.js", { ...common, ...liveReadEnvironment, SPMT_ORIGIN: spmtOrigin, MOUNTAINVIEW_DATABASE_PATH: resolve(dataRoot, "mountainview-green-sandbox.sqlite"), HOST: "127.0.0.1", PORT: String(mountainViewWebPort) });
const companionWeb = start("Companion web", "apps/companion/dist/web-server.js", { ...common, ...liveReadEnvironment, SPMT_ORIGIN: spmtOrigin, HOST: "127.0.0.1", PORT: String(companionWebPort) });
for (const child of [dshWeb, streamweaverWeb, hearMeOutWeb, mountainViewWeb, companionWeb]) child.once("exit", (code, signal) => { if (!stopping) void stop(signal === "SIGINT" || signal === "SIGTERM" ? 0 : code ?? (signal ? 1 : 0)); });
await Promise.all([
  waitForUrl(dshWeb, `http://127.0.0.1:${dshWebPort}/health/ready`, "Discord Stream Hub web"),
  waitForUrl(streamweaverWeb, `http://127.0.0.1:${streamweaverWebPort}/health/ready`, "StreamWeaver web"),
  waitForUrl(hearMeOutWeb, `http://127.0.0.1:${hearMeOutWebPort}/health/ready`, "HearMeOut web"),
  waitForUrl(mountainViewWeb, `http://127.0.0.1:${mountainViewWebPort}/health/ready`, "MountainView web"),
  waitForUrl(companionWeb, `http://127.0.0.1:${companionWebPort}/health/ready`, "Companion web"),
]);

const chatGateway = start("Chat Gateway", "apps/chat-gateway/dist/service-start.js", {
  ...common,
  SPMT_ORIGIN: spmtOrigin,
  CHAT_GATEWAY_DATABASE_PATH: resolve(dataRoot, "chat-gateway-sandbox.sqlite"),
  CHAT_GATEWAY_WORKER_CREDENTIAL: chatGatewayCredential,
  CHAT_GATEWAY_CONNECTIONS: "[]",
  STREAMWEAVER_PROVIDER_RUNTIME_ENABLED: "1",
  STREAMWEAVER_WORKER_CREDENTIAL: streamweaverWorkerCredential,
  STREAMWEAVER_DATABASE_PATH: resolve(dataRoot, "streamweaver-provider-sandbox.sqlite"),
  NEBULA_ARCADE_PROVIDER_RUNTIME_ENABLED: "1",
  NEBULA_ARCADE_WORKER_CREDENTIAL: nebulaArcadeWorkerCredential,
  NEBULA_ARCADE_DATABASE_PATH: resolve(dataRoot, "nebula-arcade-provider-sandbox.sqlite"),
  NEBULA_ARCADE_RUNTIME_CONFIG_PATH: resolve("config/nebula-arcade-runtime.sandbox.v1.json"),
});
chatGateway.once("exit", (code, signal) => { if (!stopping) void stop(signal === "SIGINT" || signal === "SIGTERM" ? 0 : code ?? (signal ? 1 : 0)); });
const dsh = start("Discord Stream Hub live worker", "apps/discord-stream-hub/dist/live-worker-start.js", {
  ...common,
  SPMT_ORIGIN: spmtOrigin,
  DSH_DATABASE_PATH: resolve(dataRoot, "discord-stream-hub-live-sandbox.sqlite"),
  DSH_RUNTIME_CONFIG_PATH: resolve("config/discord-stream-hub-runtime.sandbox.v1.json"),
  DSH_WORKER_CREDENTIAL: dshWorkerCredential,
});
dsh.once("exit", (code, signal) => { if (!stopping) void stop(signal === "SIGINT" || signal === "SIGTERM" ? 0 : code ?? (signal ? 1 : 0)); });
const hearMeOut = start("HearMeOut media worker", "apps/hearmeout/dist/execution-worker-start.js", {
  ...common,
  SPMT_ORIGIN: spmtOrigin,
  HEARMEOUT_DATABASE_PATH: resolve(dataRoot, "hearmeout-runtime-sandbox.sqlite"),
  HEARMEOUT_CACHE_DIR: resolve(dataRoot, "hearmeout-cache-sandbox"),
  HEARMEOUT_RUNTIME_CONFIG_PATH: resolve("config/hearmeout-runtime.sandbox.v1.json"),
  HEARMEOUT_WORKER_CREDENTIAL: hearMeOutWorkerCredential,
  HEARMEOUT_EXECUTION_TARGET: "fly",
});
hearMeOut.once("exit", (code, signal) => { if (!stopping) void stop(signal === "SIGINT" || signal === "SIGTERM" ? 0 : code ?? (signal ? 1 : 0)); });
if (stellarWorkerCredential) {
  const stellar = start("Stellar Core worker", "apps/stellar-core/dist/worker-start.js", {
    ...common,
    SPMT_ORIGIN: spmtOrigin,
    STELLAR_PROVIDER_ORIGIN: "http://127.0.0.1:8081",
    STELLAR_PROVIDER_MODEL: "Qwen/Qwen3-8B-GGUF:Q4_K_M",
    STELLAR_EXECUTION_TARGET: "sprite",
    STELLAR_WORKER_CREDENTIAL: stellarWorkerCredential,
    ...(llm?.pid ? { STELLAR_PROVIDER_PID: String(llm.pid) } : {}),
  });
  stellar.once("exit", (code, signal) => { if (!stopping) void stop(signal === "SIGINT" || signal === "SIGTERM" ? 0 : code ?? (signal ? 1 : 0)); });
  await waitForUrl(stellar, `${spmtOrigin}/health/stellar`, "Stellar Core hosted inference", 10 * 60_000);
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
  SPMT_ORIGIN: spmtOrigin,
  DSH_WEB_ORIGIN: `http://127.0.0.1:${dshWebPort}`,
  STREAMWEAVER_WEB_ORIGIN: `http://127.0.0.1:${streamweaverWebPort}`,
  HEARMEOUT_WEB_ORIGIN: `http://127.0.0.1:${hearMeOutWebPort}`,
  MOUNTAINVIEW_WEB_ORIGIN: `http://127.0.0.1:${mountainViewWebPort}`,
  COMPANION_WEB_ORIGIN: `http://127.0.0.1:${companionWebPort}`,
  HOST: "0.0.0.0",
  PORT: String(webPort),
  ...(candidateManifest ? { NEBULA_ARCADE_ORIGIN: `http://127.0.0.1:${nebulaArcadePort}`, SPMT_SANDBOX_CANDIDATE_MANIFEST: JSON.stringify(candidateManifest) } : {}),
});
spmt.once("exit", (code, signal) => { if (!stopping) void stop(signal === "SIGINT" || signal === "SIGTERM" ? 0 : code ?? (signal ? 1 : 0)); });
await waitForUrl(web, `http://127.0.0.1:${webPort}/sandbox/health`, "SpaceMountain web");
for (const appId of ["discord-stream-hub", "streamweaver", "hearmeout", "mountainview", "companion"]) await waitForUrl(web, `http://127.0.0.1:${webPort}/health/${appId}`, `${appId} ingress`);

process.stdout.write(`\nGreen sandbox is supervised and ready at ${publicUrl}\n`);
process.stdout.write(`The canonical app pool contains ${sandboxManifests.map((item) => item.name).join(", ")}.\n`);
process.stdout.write("App-owned Green frontends are isolated behind the common catalog/AppFrame ingress.\n");
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

function requireLiveReadOrigin(value) {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash) throw new Error("--live-read-origin must be a credential-free HTTPS origin");
  return url.origin;
}

function appLaunchUrl(origin, path) { return new URL(path, origin).toString(); }

function parseArguments(values) {
  const result = new Map();
  for (let index = 0; index < values.length; index += 2) {
    const flag = values[index];
    const value = values[index + 1];
    if (!flag?.startsWith("--") || !value) throw new Error("Arguments must be --name value pairs");
    result.set(flag.slice(2), value);
  }
  const allowed = ["app", "candidate-app", "catalog", "public-url", "data-root", "build-sha", "spmt-port", "web-port", "nebula-arcade-port", "hearmeout-web-port", "dsh-web-port", "streamweaver-web-port", "mountainview-web-port", "companion-web-port", "tenant-id", "channel-id", "owner-username", "llm-binary", "llm-cache", "offline-network-guard", "live-read-origin"];
  for (const name of result.keys()) if (!allowed.includes(name)) throw new Error(`Unknown argument --${name}`);
  return result;
}

function requireBooleanFlag(value, name) {
  if (value === "1") return true;
  if (value === "0") return false;
  throw new Error(`--${name} must be 0 or 1`);
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
