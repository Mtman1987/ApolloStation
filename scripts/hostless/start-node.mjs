#!/usr/bin/env node
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";
import { mergeNebulaRuntimeConfig } from "./nebula-runtime-config.mjs";

// Keep Hostless runtime configuration bootstrap deterministic across the two-node release.
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
let nebulaConfigForServer;
let sharedBotChannelForServer;
let sharedBotTenantIdForServer;
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
  const sharedBotToken = process.env.TWITCH_BOT_TOKEN?.trim();
  const sharedBotChannel = (process.env.SPACEMOUNTAIN_TWITCH_CHANNEL || "mtman1987").trim().toLowerCase().replace(/^#/, "");
  const sharedBotUsername = (process.env.TWITCH_BOT_USERNAME || "spacemountainlive").trim().toLowerCase();
  sharedBotChannelForServer = sharedBotChannel;
  const existingChannel = nebulaConnections.find(connection => connection?.provider === "twitch" && String(connection.channelId || "").replace(/^#/, "").toLowerCase() === sharedBotChannel);
  sharedBotTenantIdForServer = existingChannel?.tenantId || "spacemountainlive";
  if (sharedBotToken && /^[a-z0-9_]{1,25}$/.test(sharedBotChannel)) {
    const existing = nebulaConnections.find(connection => connection?.provider === "twitch" && String(connection.channelId || "").replace(/^#/, "").toLowerCase() === sharedBotChannel && String(connection.providerAccountId || "").toLowerCase() === sharedBotUsername);
    if (!existing) {
      const sharedConnection = { schemaVersion: 1, tenantId: "spacemountainlive", provider: "twitch", connectionId: "apollo-shared-spacemountain-bot", channelId: sharedBotChannel, providerAccountId: sharedBotUsername, desired: true };
      nebulaConnections.push(sharedConnection);
      sharedBotTenantIdForServer = sharedConnection.tenantId;
    } else {
      existing.desired = true;
      sharedBotTenantIdForServer = existing.tenantId;
    }
    process.env.CHAT_GATEWAY_CONNECTIONS = JSON.stringify(nebulaConnections);
    console.info("[chat-gateway] Production Twitch watcher configured for #" + sharedBotChannel + " as " + sharedBotUsername + ".");
  }
  const supportedProviders = new Set(["twitch", "discord", "kick", "youtube"]);
  const tenantsById = new Map();
  for (const connection of nebulaConnections) {
    if (!connection || connection.schemaVersion !== 1 || connection.desired !== true ||
        !supportedProviders.has(connection.provider) ||
        typeof connection.tenantId !== "string" || !connection.tenantId.trim() ||
        typeof connection.connectionId !== "string" || !connection.connectionId.trim() ||
        typeof connection.channelId !== "string" || !connection.channelId.trim()) continue;
    let tenant = tenantsById.get(connection.tenantId);
    if (!tenant) {
      tenant = { tenantId: connection.tenantId, channels: [] };
      tenantsById.set(connection.tenantId, tenant);
    }
    tenant.channels.push({
      provider: connection.provider,
      connectionId: connection.connectionId,
      channelId: connection.channelId,
      stateChannelId: connection.stateChannelId || connection.channelId,
      enabledGameIds: ["tag","quackverse","bingo","chaosmode","chatgarden","chatwars","chickenroyale","colorsymphony","colorwars","dancingparade","emojirain","emojitower","memorylane","petrace","phraseguess","pixelbattle","rhythmpulse","treasurehunt","wordchain","wordstorm"],
    });
  }
  const autoConfig = {
    schemaVersion: 1,
    revision: "hostless-chat-gateway-connection-registry-v3",
    tenants: [...tenantsById.values()],
  };
  let suppliedConfig = autoConfig;
  if (process.env.NEBULA_ARCADE_RUNTIME_CONFIG_JSON) {
    try { suppliedConfig = JSON.parse(process.env.NEBULA_ARCADE_RUNTIME_CONFIG_JSON); }
    catch { throw new Error("NEBULA_ARCADE_RUNTIME_CONFIG_JSON must contain valid JSON."); }
  }
  // A saved runtime config may carry tenant-level settings but be stale or
  // channel-empty. Always merge the live Chat Gateway registry into it so the
  // Nebula ingress consumer is attached to the exact active provider channels.
  // Preserve saved tenant settings while always adding the active Chat Gateway channel registry.
  const mergedConfig = mergeNebulaRuntimeConfig(suppliedConfig, autoConfig);
  const nebulaConfig = writeVersionedRuntimeConfig({
    json: JSON.stringify(mergedConfig),
    path: process.env.NEBULA_ARCADE_RUNTIME_CONFIG_PATH,
    fallbackPath: "/tmp/apollo-nebula-runtime.json",
    label: "NEBULA_ARCADE",
    emptyConfig: autoConfig,
    allowEmpty: true,
  });
  process.env.NEBULA_ARCADE_RUNTIME_CONFIG_PATH = nebulaConfig.configPath;
  nebulaConfigForServer = nebulaConfig;
}
node2.push(
  ["apps/chat-gateway/dist/service-start.js", {}],
  ["apps/streamweaver/dist/web-server.js", { PORT: hostlessPort || "8000", HOST: "0.0.0.0" }],
);

// Derive the public Nebula game server from the same live Twitch connection
// used by Chat Gateway. The donor's existing system tenant is spacemountainlive;
// the Twitch channel itself is also the state channel, so no extra workspace,
// state-channel, or tenant provisioning is required.
if (nebulaConfigForServer && process.env.NEBULA_ARCADE_PROVIDER_RUNTIME_ENABLED === "1" &&
    process.env.NEBULA_ARCADE_WORKER_CREDENTIAL && process.env.NEBULA_ARCADE_DATABASE_PATH &&
    process.env.SPMT_ORIGIN) {
  const tenant = nebulaConfigForServer.config.tenants.find(item => item.tenantId === sharedBotTenantIdForServer) ??
    nebulaConfigForServer.config.tenants.find(item => item.channels.some(channel => channel.provider === "twitch" && channel.channelId === sharedBotChannelForServer));
  const twitchChannel = tenant?.channels.find(channel => channel.provider === "twitch" && channel.channelId === sharedBotChannelForServer) ??
    tenant?.channels.find(channel => channel.provider === "twitch");
  if (tenant && twitchChannel) {
    node2.push(["apps/nebula-arcade/dist/nebula-arcade-live-server.js", {
      PORT: process.env.NEBULA_ARCADE_PORT ?? "3100",
      NEBULA_ARCADE_TENANT_ID: tenant.tenantId,
      NEBULA_ARCADE_CHANNEL_ID: twitchChannel.channelId,
      NEBULA_ARCADE_PUBLIC_ORIGIN: process.env.NEBULA_ARCADE_PUBLIC_ORIGIN ?? "https://apollo-node-2.hostless.app",
      NEBULA_ARCADE_RUNTIME_CONFIG_PATH: nebulaConfigForServer.configPath,
    }]);
    console.info("[nebula-arcade] Public game server configured for " + tenant.tenantId + " / #" + twitchChannel.channelId + ".");
  }
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
