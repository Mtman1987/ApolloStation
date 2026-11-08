#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const nodeKey = process.argv[2];
const commit = process.argv[3] ?? process.env.GITHUB_SHA;
const token = process.env.HOSTLESS_TOKEN;
const secretBundle = process.env.APOLLO_GH_SECRETS_JSON;
const api = process.env.HOSTLESS_API_URL ?? "https://api.hostless.cloud/v1";

const nodes = {
  node1: { label: "Node 1 — SPMT authority / SpaceMountain / OverlayBay", app: "apollo-node-1" },
  node2: { label: "Node 2 — Chat Gateway / StreamWeaver / Nebula", app: "apollo-node-2" },
};

function fail(message) {
  console.error(`::error::${message}`);
  process.exit(1);
}

if (!nodes[nodeKey]) fail("Pass node1 or node2; this deployment uses two nodes.");
if (!token) fail("HOSTLESS_TOKEN is not set.");
if (!commit) fail("No commit SHA was supplied.");

// Never create a Hostless app from the monorepo root until that node has an
// explicit production entrypoint. The current root package intentionally has
// no generic start script; deploying it would create a healthy-looking but
// non-functional app or fail at runtime.
const packageJson = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8"));
const startScript = packageJson.scripts?.[`hostless:${nodeKey}`];
if (typeof startScript !== "string" || !startScript.trim()) {
  fail(`No package.json script hostless:${nodeKey} exists yet. This node's role-specific runtime entrypoint must be implemented and tested before Hostless can create or deploy its app. No Hostless resources were modified.`);
}

async function request(path) {
  const response = await fetch(`${api}${path}`, {
    headers: { Authorization: token, Accept: "application/json" },
  });
  const body = await response.text();
  let parsed;
  try { parsed = body ? JSON.parse(body) : {}; } catch { parsed = { raw: body.slice(0, 500) }; }
  if (!response.ok) {
    const detail = parsed?.message ?? parsed?.error ?? `HTTP ${response.status}`;
    fail(`Hostless API ${path} failed: ${detail}. Check this node token's scopes and project membership.`);
  }
  return parsed;
}

function rows(value, keys) {
  if (Array.isArray(value)) return value;
  for (const key of keys) {
    if (Array.isArray(value?.[key])) return value[key];
    if (Array.isArray(value?.data?.[key])) return value.data[key];
  }
  if (Array.isArray(value?.data)) return value.data;
  return null;
}

function idOf(value) {
  return value?.id ?? value?._id ?? value?.projectId ?? value?.appId ?? null;
}

function nameOf(value) {
  return value?.name ?? value?.projectName ?? value?.appName ?? value?.slug ?? "";
}

function normalize(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9]/g, "");
}

function selectProject(projects, key) {
  const canonical = nodes[key].app;
  const exact = projects.filter(p => normalize(nameOf(p)) === normalize(canonical));
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) fail(`More than one Hostless project matches ${canonical}; refusing to guess.`);
  if (projects.length === 1) return projects[0];
  if (projects.length === 0) {
    fail(`This Hostless account has no project yet. The API-key API supports project listing but does not expose project creation; create one project in this account's Hostless dashboard, then rerun. No resources were deleted or modified.`);
  }
  fail(`Found ${projects.length} projects but none uniquely matches ${canonical}. Rename the intended project to ${canonical} or leave only one project accessible to this token; refusing to target the wrong project.`);
}

function runCli(args, description) {
  // Bound every CLI call so a stalled API/CLI cannot occupy a GitHub runner
  // indefinitely. Deploy itself has a 30-minute Hostless wait limit below.
  const result = spawnSync("hostless", args, {
    encoding: "utf8",
    env: process.env,
    maxBuffer: 20 * 1024 * 1024,
    timeout: 35 * 60 * 1000,
    killSignal: "SIGTERM",
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error) fail(`${description}: ${result.error.message}`);
  if (result.status !== 0) fail(`${description} failed with exit code ${result.status}.`);
}

async function resolveNode1Origin() {
  const node1Token = process.env.HOSTLESS_NODE1_TOKEN;
  if (!node1Token) fail("Node 2 needs HOSTLESS_NODE1_TOKEN to discover the already-deployed SPMT authority URL; no URL was guessed.");
  const response = await fetch(`${api}/apps/apollo-node-1`, {
    headers: { Authorization: node1Token, Accept: "application/json" },
  });
  const body = await response.text();
  let parsed;
  try { parsed = body ? JSON.parse(body) : {}; } catch { parsed = {}; }
  if (!response.ok) fail(`Could not discover Node 1's Hostless URL (HTTP ${response.status}); check HOSTLESS_NODE1_TOKEN has apps:read scope.`);

  const candidates = [];
  function visit(value) {
    if (!value || typeof value !== "object") return;
    for (const [key, item] of Object.entries(value)) {
      if (/^(url|appUrl|publicUrl|defaultDomain|primaryDomain|domain|hostname|domains)$/i.test(key)) {
        const values = Array.isArray(item) ? item : [item];
        for (const entry of values) {
          const raw = typeof entry === "string" ? entry : entry && typeof entry === "object"
            ? (entry.url ?? entry.domain ?? entry.hostname ?? entry.host)
            : null;
          if (typeof raw !== "string" || !raw.trim()) continue;
          try {
            const url = new URL(raw.includes("://") ? raw : `https://${raw}`);
            if (url.protocol === "https:" && !url.username && !url.password && url.pathname === "/" && !url.search && !url.hash) candidates.push(url.origin);
          } catch {}
        }
      }
      if (item && typeof item === "object") visit(item);
    }
  }
  visit(parsed);
  const unique = [...new Set(candidates)];
  if (unique.length !== 1) fail(`Hostless returned ${unique.length} unambiguous HTTPS app origins for apollo-node-1; refusing to guess SPMT_ORIGIN.`);
  const origin = unique[0];
  const health = await fetch(`${origin}/health/ready`, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(8000) });
  if (!health.ok) fail(`Node 1 URL was discovered but its readiness endpoint returned HTTP ${health.status}; Node 2 will not be pointed at an unhealthy authority.`);
  console.log("Resolved Node 2 SPMT_ORIGIN from the healthy Hostless Node 1 app.");
  return origin;
}

async function clearDeferredNebulaRuntime(appName) {
  // A previous deployment may have left write-only Nebula values on Hostless.
  // Clear stale values first; the current deployment bundle is applied immediately afterward.
  // Hostless documents this dedicated endpoint for listing variable names.
  // The app-details endpoint intentionally omits them, so do not infer from it.
  const variableResponse = await request(`/apps/${encodeURIComponent(appName)}/environment-variables`);
  const variables = rows(variableResponse, ["variables", "environmentVariables", "items"]);
  if (!variables) fail("Hostless environment-variable listing returned an unexpected response shape; refusing to deploy Node 2 with possibly stale Nebula settings.");
  const existing = new Set(variables.map((item) => item?.name ?? item?.key).filter((value) => typeof value === "string"));
  const deferredKeys = [
    "NEBULA_ARCADE_WORKER_CREDENTIAL",
    "NEBULA_ARCADE_DATABASE_PATH",
    "NEBULA_ARCADE_RUNTIME_CONFIG_PATH",
    "NEBULA_ARCADE_RUNTIME_CONFIG_JSON",
    "NEBULA_ARCADE_PROVIDER_RUNTIME_ENABLED",
    "NEBULA_ARCADE_TENANT_ID",
    "NEBULA_ARCADE_CHANNEL_ID",
    "NEBULA_ARCADE_PUBLIC_ORIGIN",
    "NEBULA_GAMEPLAY_PUBLIC_ORIGIN",
    "NEBULA_ARCADE_AVATAR_URL",
    "NEBULA_ARCADE_WEBHOOK_NAME",
  ];
  for (const key of deferredKeys) {
    if (!existing.has(key)) continue;
    runCli(["env", "unset", key, "--app", appName, "--project", String(idOf(project))], `Remove deferred Node 2 setting ${key}`);
  }
  console.log("Cleared stale Nebula runtime settings before applying the current Node 2 configuration.");
}

function syncRuntimeSecrets(projectId, appName) {
  let bundle = {};
  if (secretBundle) { try { bundle = JSON.parse(secretBundle); } catch { fail("APOLLO_GH_SECRETS_JSON is not valid JSON."); } }
  for (const [envKey, value] of Object.entries(process.env)) {
    if (envKey.startsWith("APOLLO_RUNTIME_") && typeof value === "string" && value.length > 0) {
      bundle[envKey.slice("APOLLO_RUNTIME_".length)] = value;
    }
  }
  if (Object.keys(bundle).length === 0) fail("No explicitly mapped GitHub Actions runtime secrets were supplied.");
  const excluded = new Set(["HOSTLESS_NODE1_TOKEN", "HOSTLESS_NODE2_TOKEN", "HOSTLESS_NODE3_TOKEN", "GITHUB_TOKEN"]);
  const nodePrefix = nodeKey.toUpperCase() + "_";
  const entries = Object.entries(bundle).filter(([key, value]) =>
    /^[A-Z][A-Z0-9_]{1,127}$/.test(key) && !excluded.has(key) &&
    !/^HOSTLESS_.*TOKEN$/.test(key) && key.startsWith(nodePrefix) &&
    typeof value === "string" && value.length > 0
  ).map(([key, value]) => [key.slice(nodePrefix.length), value]);
  if (nodeKey === "node1") {
    // Production Apollo must never inherit the obsolete sandbox preview gate or
    // sandbox account mode from a copied Actions secret. These values are
    // explicitly owned by the deployment target, not by the secret bundle.
    const production = new Map(entries);
    production.set("SPMT_RUNTIME_MODE", "production");
    production.set("SPMT_SANDBOX_FIXTURES", "0");
    for (const key of ["APOLLO_PRIVATE_PREVIEW", "APOLLO_PREVIEW_PASSWORD", "SPMT_SANDBOX_OWNER_USERNAME", "SPMT_SANDBOX_APPS_JSON"]) production.delete(key);
    entries.splice(0, entries.length, ...production.entries());
    const currentVariables = await request(`/apps/${encodeURIComponent(appName)}/environment-variables`);
    const variableRows = rows(currentVariables, ["variables", "environmentVariables", "items"]);
    if (!variableRows) fail("Hostless environment-variable listing returned an unexpected response shape; refusing to guess which sandbox settings exist.");
    const existingKeys = new Set(variableRows.map(item => item?.name ?? item?.key).filter(value => typeof value === "string"));
    for (const key of ["APOLLO_PRIVATE_PREVIEW", "APOLLO_PREVIEW_PASSWORD", "SPMT_SANDBOX_OWNER_USERNAME", "SPMT_SANDBOX_APPS_JSON"]) {
      if (existingKeys.has(key)) runCli(["env", "unset", key, "--app", appName, "--project", String(projectId)], `Remove obsolete sandbox setting ${key}`);
    }
    console.log("Node 1 deployment is pinned to production mode; obsolete private-preview and sandbox-auth settings are removed.");
  }
  if (entries.length === 0) fail("No runtime secrets were present in the GitHub Actions secret bundle.");
  console.log(`Synchronizing ${entries.length} GitHub Actions secrets to ${appName} (values are write-only and never logged).`);
  // Hostless accepts multiple KEY=value arguments in one env-set operation.
  // Applying the bundle atomically avoids dozens of serial API writes (and
  // repeated full-environment saves) on every deployment.
  const assignments = entries.map(([key, value]) => `${key}=${value}`);
  assignments.push(`APOLLO_NODE_ROLE=${nodeKey}`);
  runCli(["env", "set", ...assignments, "--write-only", "--app", appName, "--project", String(projectId)],
    `Synchronize runtime secrets for ${appName}`);
  console.log(`Synchronized ${entries.length} runtime secrets and node role to ${appName} in one Hostless operation.`);
}

const node = nodes[nodeKey];
const projectsResponse = await request("/projects");
const projects = rows(projectsResponse, ["projects", "data", "items"]);
if (!projects) fail("Hostless /projects returned an unexpected response shape; refusing to guess.");
const project = selectProject(projects, nodeKey);
const projectId = idOf(project);
if (!projectId) fail(`Hostless project ${nameOf(project) || "(unnamed)"} has no readable ID; refusing to continue.`);

console.log(`Resolved ${node.label} to Hostless project ${nameOf(project)} (${projectId}).`);

const appsResponse = await request(`/projects/${encodeURIComponent(projectId)}/apps`);
const apps = rows(appsResponse, ["apps", "data", "items"]);
if (!apps) fail("Hostless project apps endpoint returned an unexpected response shape; refusing to guess.");

const matching = apps.filter(app => normalize(nameOf(app)) === normalize(node.app));
if (matching.length > 1) fail(`Multiple apps named ${node.app} exist in project ${projectId}; refusing to guess.`);

if (matching.length === 0) {
  console.log(`App ${node.app} does not exist. Creating it; Hostless may start an initial deployment automatically.`);
  runCli(
    ["create", "app", node.app, "--project", String(projectId), "--branch", process.env.GITHUB_REF_NAME ?? "main", "--yes", "--wait", "--json"],
    `Create ${node.app}`,
  );
}
if (nodeKey === "node2") await clearDeferredNebulaRuntime(node.app);
if (nodeKey === "node2" && !process.env.SPMT_ORIGIN) {
  process.env.SPMT_ORIGIN = await resolveNode1Origin();
  process.env.APOLLO_RUNTIME_NODE2_SPMT_ORIGIN = process.env.SPMT_ORIGIN;
}
syncRuntimeSecrets(projectId, node.app);
console.log(`Deploying validated ApolloStation commit ${commit} to ${node.app}.`);
runCli(
  ["deploy", "--wait", "--timeout", "1800", "--app", node.app, "--project", String(projectId), "--commit", commit],
  `Deploy ${node.app}`,
);

console.log(`Hostless operation completed for ${nodeKey} (${node.app}).`);
