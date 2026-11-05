#!/usr/bin/env node
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";

const required = ["SPMT_PUBLIC_URL", "APOLLO_PREVIEW_PASSWORD"];
for (const name of required) if (!process.env[name]) throw new Error(`${name} is required for the isolated Hostless preview`);
if (process.env.APOLLO_PREVIEW_PASSWORD.length < 8) throw new Error("APOLLO_PREVIEW_PASSWORD must contain at least 8 characters");

const publicUrl = new URL(process.env.SPMT_PUBLIC_URL);
if (publicUrl.protocol !== "https:" || !(publicUrl.hostname.endsWith(".hostless.app") || publicUrl.hostname.endsWith(".apps.hostless.cloud"))) {
  throw new Error("SPMT_PUBLIC_URL must be this app's HTTPS Hostless URL");
}

const root = process.cwd();
const baseEnv = {
  ...process.env,
  APOLLO_PRIVATE_PREVIEW: "1",
  SPMT_RUNTIME_MODE: "sandbox",
  SPMT_OUTBOUND_MODE: "disabled",
  SPMT_SANDBOX_ID: "apollo-hostless-private-preview",
  SPMT_SANDBOX_FIXTURES: "1",
  SPMT_SANDBOX_OWNER_USERNAME: "owner",
  SPMT_SANDBOX_APPS: JSON.stringify([{
    appId: "spacemountain",
    name: "SpaceMountain",
    description: "The Green command bridge for SPMT identity, Shipyard, Commlink, workspace, and Stellar Core surfaces.",
    version: "0.1.0-sandbox",
    launchUrl: publicUrl.origin,
    allowedScopes: ["workspace:read", "xp:read", "apps:read", "apps:install", "entitlements:read", "usage:read", "events:read", "commlink:read", "notifications:read", "assistants:read", "assistants:invoke", "stellar:context:read", "stellar:capabilities:read", "operations:logs:read", "operations:logs:write", "operations:coder:read", "operations:coder:invoke"],
    surfaces: ["shell", "standalone"],
    status: "active",
  }]),
  SPMT_PUBLIC_URL: publicUrl.origin,
  SPMT_HOST: "127.0.0.1",
  DATABASE_PATH: "/tmp/apollo-sandbox.sqlite",
  SPMT_WEBHOOK_KEY: process.env.SPMT_WEBHOOK_KEY || randomBytes(32).toString("base64url"),
  STELLAR_EXECUTION_TARGET: "hosted",
};
delete baseEnv.SPMT_DATABASE_PATH;

let spmt;
let web;
let shuttingDown = false;
function stop(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of [web, spmt]) if (child && child.exitCode === null) child.kill("SIGTERM");
  const force = setTimeout(() => {
    for (const child of [web, spmt]) if (child && child.exitCode === null) child.kill("SIGKILL");
  }, 8000);
  force.unref();
  process.exitCode = code;
}
for (const signal of ["SIGTERM", "SIGINT"]) process.once(signal, () => stop(0));

function launch(file, env) {
  const child = spawn(process.execPath, [file], { cwd: root, env, stdio: "inherit" });
  child.once("error", error => { console.error(`[apollo-preview] failed to start ${file}: ${error.message}`); stop(1); });
  child.once("exit", (code, signal) => {
    if (!shuttingDown) {
      console.error(`[apollo-preview] ${file} exited (${signal ?? code ?? "unknown"})`);
      stop(code && code !== 0 ? code : 1);
    }
  });
  return child;
}

spmt = launch("apps/spmt-service/dist/provider-identity-start.js", {
  ...baseEnv,
  PORT: "3000",
});
const deadline = Date.now() + 45_000;
let ready = false;
while (Date.now() < deadline && !shuttingDown) {
  try {
    const response = await fetch("http://127.0.0.1:3000/health/ready", { signal: AbortSignal.timeout(2000) });
    if (response.ok) { ready = true; break; }
  } catch {}
  await new Promise(resolve => setTimeout(resolve, 500));
}
if (!ready) {
  stop(1);
  throw new Error("SPMT sandbox did not become healthy within 45 seconds");
}

web = launch("apps/spacemountain-web/dist/integrated-server.js", {
  ...baseEnv,
  HOST: "0.0.0.0",
  PORT: process.env.PORT || "8080",
  SPMT_ORIGIN: "http://127.0.0.1:3000",
});
console.log("[apollo-preview] private, empty-data SPMT + SpaceMountain preview started; provider egress is disabled");
