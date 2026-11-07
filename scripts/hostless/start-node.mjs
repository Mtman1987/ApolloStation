#!/usr/bin/env node
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";

const role = process.env.APOLLO_NODE_ROLE;
const root = process.cwd();
const common = { cwd: root, env: process.env, stdio: "inherit" };
const hostlessPort = process.env.PORT;

function writeVersionedRuntimeConfig({ json, path, fallbackPath, label, emptyConfig, allowEmpty = true }) {
  const configPath = path || fallbackPath;
  let config = emptyConfig;
  if (json) {
    try { config = JSON.parse(json); }
    catch { throw new Error(`${label}_RUNTIME_CONFIG_JSON must contain valid JSON.`); }
  }
  if (!config || config.schemaVersion !== 1 || !Array.isArray(config.tenants)) {
    throw new Error(`${label} runtime config must be a version 1 tenant configuration.`);
  }
  if (!allowEmpty && config.tenants.length === 0) {
    throw new Error(`${label} runtime config must contain at least one tenant.`);
  }
  mkdirSync(resolve(configPath, ".."), { recursive: true });
  writeFileSync(configPath, JSON.stringify(config), { mode: 0o600 });
  return { configPath, config };
}

const node1 = [
  ["apps/spmt-service/dist/provider-identity-start.js", { PORT: "3000", DATABASE_PATH: process.env.DATABASE_PATH ?? "/tmp/apollo-spmt.sqlite" }],
];

const dshConfigRequested = Boolean(process.env.DSH_RUNTIME_CONFIG_JSON || process.env.DSH_RUNTIME_CONFIG_PATH || process.env.SPMT_DSH_LIVE_RUNTIME_ENABLED === "1");
let dshConfig;
if (dshConfigRequested) {
  dshConfig = writeVersionedRuntimeConfig({
    json: process.env.DSH_RUNTIME_CONFIG_JSON,
    path: process.env.DSH_RUNTIME_CONFIG_PATH,
    fallbackPath: "/tmp/apollo-dsh-runtime.json",
    label: "DSH",
    emptyConfig: { schemaVersion: 1, pollIntervalSeconds: 60, tenants: [] },
  });
  process.env.DSH_RUNTIME_CONFIG_PATH = dshConfig.configPath;
  if (dshConfig.config.tenants.length === 0) {
    console.warn("DSH live worker deferred: valid owner-only runtime config has no provisioned tenants or provider connections.");
  } else {
    node1.push(["apps/discord-stream-hub/dist/live-worker-start.js", {
      SPMT_ORIGIN: process.env.SPMT_ORIGIN ?? "http://127.0.0.1:3000",
      DSH_DATABASE_PATH: process.env.DSH_DATABASE_PATH ?? "/tmp/apollo-dsh.sqlite",
      DSH_RUNTIME_CONFIG_PATH: dshConfig.configPath,
    }]);
  }
}
node1.push(
  ["apps/discord-stream-hub/dist/web-server.js", {
    PORT: process.env.DSH_WEB_PORT ?? "3201",
    SPMT_ORIGIN: process.env.SPMT_ORIGIN ?? "http://127.0.0.1:3000",
    DSH_DATABASE_PATH: process.env.DSH_DATABASE_PATH ?? "/tmp/apollo-dsh.sqlite",
    ...(dshConfig ? { DSH_RUNTIME_CONFIG_PATH: dshConfig.configPath } : {}),
  }],
  ["apps/spacemountain-web/dist/integrated-server.js", {
    PORT: process.env.PORT ?? "8080",
    SPMT_ORIGIN: process.env.SPMT_ORIGIN ?? "http://127.0.0.1:3000",
    DSH_WEB_ORIGIN: process.env.DSH_WEB_ORIGIN ?? "http://127.0.0.1:3201",
  }],
);

const node2 = [];
const nebulaConfigRequested = Boolean(
  process.env.NEBULA_ARCADE_RUNTIME_CONFIG_JSON ||
  process.env.NEBULA_ARCADE_RUNTIME_CONFIG_PATH ||
  process.env.NEBULA_ARCADE_PROVIDER_RUNTIME_ENABLED === "1",
);
if (nebulaConfigRequested) {
  const nebulaConnections = (() => {
    try {
      const value = JSON.parse(process.env.CHAT_GATEWAY_CONNECTIONS || "[]");
      return Array.isArray(value) ? value : [];
    } catch {
      throw new Error("CHAT_GATEWAY_CONNECTIONS must be valid JSON before Nebula can attach its Twitch channel.");
    }
  })();
  const nebulaTenantId = process.env.NEBULA_ARCADE_TENANT_ID || "";
  const ownerTwitchConnections = nebulaConnections.filter(connection =>
    connection && connection.schemaVersion === 1 && connection.provider === "twitch" &&
    connection.desired === true && connection.tenantId === nebulaTenantId
  );
  const autoConfig = {
    schemaVersion: 1,
    revision: "hostless-chat-gateway-connection-registry-v1",
    tenants: nebulaTenantId && ownerTwitchConnections.length ? [{
      tenantId: nebulaTenantId,
      channels: ownerTwitchConnections.map(connection => ({
        provider: "twitch",
        connectionId: connection.connectionId,
        channelId: connection.channelId,
        stateChannelId: process.env.NEBULA_ARCADE_CHANNEL_ID || connection.channelId,
        enabledGameIds: ["tag","quackverse","bingo","chaosmode","chatgarden","chatwars","chickenroyale","colorsymphony","colorwars","dancingparade","emojirain","emojitower","memorylane","petrace","phraseguess","pixelbattle","rhythmpulse","treasurehunt","wordchain","wordstorm"],
      })),
    }] : [],
  };
  const nebulaConfig = writeVersionedRuntimeConfig({
    json: process.env.NEBULA_ARCADE_RUNTIME_CONFIG_JSON || JSON.stringify(autoConfig),
    path: process.env.NEBULA_ARCADE_RUNTIME_CONFIG_PATH,
    fallbackPath: "/tmp/apollo-nebula-runtime.json",
    label: "NEBULA_ARCADE",
    emptyConfig: autoConfig,
  });
  process.env.NEBULA_ARCADE_RUNTIME_CONFIG_PATH = nebulaConfig.configPath;
  if (nebulaConfig.config.tenants.length === 0) {
    console.warn("Nebula Arcade provider runtime has zero configured Twitch channels; no external accounts will be connected.");
  }
}
node2.push(
  ["apps/chat-gateway/dist/service-start.js", {}],
  ["apps/streamweaver/dist/web-server.js", { PORT: hostlessPort || "8000", HOST: "0.0.0.0" }],
);

// Nebula's separate public game server is enabled only after its workspace
// tenant, channel, and public origin are explicitly provisioned.
if (process.env.NEBULA_ARCADE_TENANT_ID && process.env.NEBULA_ARCADE_CHANNEL_ID && process.env.NEBULA_ARCADE_PUBLIC_ORIGIN) {
  node2.push(["apps/nebula-arcade/dist/nebula-arcade-live-server.js", { PORT: process.env.NEBULA_ARCADE_PORT ?? "3100" }]);
} else {
  console.warn("Nebula Arcade public game server deferred: workspace tenant, state channel, and public origin have not been provisioned yet.");
}

const services = ({ node1, node2 })[role];
if (!services) throw new Error("APOLLO_NODE_ROLE must be node1 or node2");
if (!process.env.PORT) process.env.PORT = "8080";
const children = [];
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) if (child.exitCode === null) child.kill("SIGTERM");
  const deadline = setTimeout(() => { for (const child of children) if (child.exitCode === null) child.kill("SIGKILL"); process.exit(code); }, 8000);
  deadline.unref();
}
process.once("SIGTERM", () => stop(0));
process.once("SIGINT", () => stop(0));
for (const [file, overrides] of services) {
  const child = spawn(process.execPath, [resolve(root, file)], { ...common, env: { ...process.env, ...overrides } });
  children.push(child);
  child.once("error", error => { console.error("Apollo service failed to start:", file, error.message); stop(1); });
  child.once("exit", code => { if (!stopping) { console.error("Apollo service exited; stopping this node:", file, code); stop(code || 1); } });
}
console.log(`ApolloStation ${role} started ${services.length} supervised production services.`);
