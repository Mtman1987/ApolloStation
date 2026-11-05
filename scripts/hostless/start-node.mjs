#!/usr/bin/env node
import { spawn } from "node:child_process";
import { resolve } from "node:path";

const role = process.env.APOLLO_NODE_ROLE;
const root = process.cwd();
const common = { cwd: root, env: process.env, stdio: "inherit" };
// Preserve Hostless injected port before applying local fallbacks for other nodes. This Node 2 launcher is deployed independently.
const hostlessPort = process.env.PORT;
const node1 = [
  ["apps/spmt-service/dist/provider-identity-start.js", { PORT: "3000", DATABASE_PATH: process.env.DATABASE_PATH ?? "/tmp/apollo-spmt.sqlite" }],
  ["apps/discord-stream-hub/dist/web-server.js", { PORT: process.env.DSH_WEB_PORT ?? "3201", SPMT_ORIGIN: process.env.SPMT_ORIGIN ?? "http://127.0.0.1:3000", DSH_DATABASE_PATH: process.env.DSH_DATABASE_PATH ?? "/tmp/apollo-dsh.sqlite" }],
  ["apps/spacemountain-web/dist/integrated-server.js", { PORT: process.env.PORT ?? "8080", SPMT_ORIGIN: process.env.SPMT_ORIGIN ?? "http://127.0.0.1:3000", DSH_WEB_ORIGIN: process.env.DSH_WEB_ORIGIN ?? "http://127.0.0.1:3201" }],
];
const node2 = [
  ["apps/chat-gateway/dist/service-start.js", {}],
  ["apps/streamweaver/dist/web-server.js", { PORT: hostlessPort || "8000", HOST: "0.0.0.0" }],
];
// Nebula is tenant-scoped. Do not invent a tenant/channel before the owner has
// completed first-run workspace provisioning; keep the other Node 2 services up.
if (process.env.NEBULA_ARCADE_TENANT_ID && process.env.NEBULA_ARCADE_CHANNEL_ID && process.env.NEBULA_ARCADE_PUBLIC_ORIGIN) {
  node2.push(["apps/nebula-arcade/dist/nebula-arcade-live-server.js", { PORT: process.env.NEBULA_ARCADE_PORT ?? "3100" }]);
} else {
  console.warn("Nebula Arcade deferred: workspace tenant, state channel, and public origin have not been provisioned yet.");
}
const node3 = [
  ["apps/discord-stream-hub/dist/live-worker-start.js", {}],
  ["apps/discord-stream-hub/dist/web-server.js", { PORT: process.env.PORT ?? "8080" }],
];
const services = ({ node1, node2, node3 })[role];
if (!services) throw new Error("APOLLO_NODE_ROLE must be node1, node2, or node3");
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
