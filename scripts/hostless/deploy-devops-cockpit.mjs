import { spawnSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { isHostlessDeploymentFailure, isHostlessDeploymentSuccessful, normalizeHostlessDeploymentStatus } from "./deployment-status.mjs";

const base = process.env.HOSTLESS_API_URL || "https://api.hostless.cloud/v1";
const token = process.env.HOSTLESS_TOKEN || "";
const appName = "apollo-devops-cockpit";
const branch = process.env.GITHUB_REF_NAME || "feat/standalone-devops-cockpit";
const commit = process.env.GITHUB_SHA || "";
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function fail(message) { console.error("::error::" + message); process.exit(1); }
function rows(value, key) { return Array.isArray(value) ? value : value?.[key] || value?.data?.[key] || value?.data || null; }
function idOf(value) { return value?.id ?? value?._id ?? value?.projectId ?? null; }
function norm(value) { return String(value || "").toLowerCase().replace(/[^a-z0-9]/g, ""); }
function cli(args, timeout = 180000, quiet = false) {
  const r = spawnSync("hostless", args, { encoding: "utf8", env: process.env, timeout, maxBuffer: 10 * 1024 * 1024 });
  if (r.error || r.status !== 0) fail("Hostless CLI failed: " + String(r.stderr || r.error?.message || r.status).slice(-1000));
  if (!quiet && r.stdout) process.stdout.write(r.stdout);
  return r.stdout || "";
}
async function api(method, path, body) {
  const r = await fetch(base + path, {
    method,
    headers: { Authorization: token, Accept: "application/json", ...(body ? { "content-type": "application/json" } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(20000),
  });
  const raw = await r.text(); let value = {};
  try { value = raw ? JSON.parse(raw) : {}; } catch {}
  if (!r.ok) throw new Error("Hostless API " + method + " " + path + " returned HTTP " + r.status);
  return value;
}
function originOf(value) {
  const found = [];
  function walk(v) {
    if (!v || typeof v !== "object") return;
    for (const [k, x] of Object.entries(v)) {
      if (/^(url|appUrl|publicUrl|defaultDomain|primaryDomain|domain|hostname)$/i.test(k)) {
        for (const item of Array.isArray(x) ? x : [x]) {
          const raw = typeof item === "string" ? item : item?.url || item?.domain || item?.hostname;
          if (!raw) continue;
          try { const u = new URL(raw.includes("://") ? raw : "https://" + raw); if (u.protocol === "https:" && u.pathname === "/" && !u.search && !u.hash) found.push(u.origin); } catch {}
        }
      }
      if (x && typeof x === "object") walk(x);
    }
  }
  walk(value);
  const unique = [...new Set(found)];
  if (unique.length !== 1) fail("Hostless did not return exactly one public cockpit origin; refusing to guess the sign-in URL.");
  return unique[0];
}
function appIdOf(value) {
  return value?.id || value?.app?.id || value?.data?.id || value?.data?.app?.id || value?._id || "";
}
function parseJson(output) { try { return JSON.parse(output || "{}"); } catch { return {}; } }

if (!token || !commit) fail("HOSTLESS_NODE1_TOKEN and GITHUB_SHA are required.");

const projects = rows(await api("GET", "/projects"), "projects");
if (!projects) fail("Unexpected Hostless project-list response.");
const matches = projects.filter(p => norm(p.name || p.projectName) === norm("apollo-node-1"));
if (matches.length > 1 || (!matches.length && projects.length !== 1)) fail("Could not uniquely resolve the existing Node 1 Hostless project.");
const project = matches[0] || projects[0];
const projectId = idOf(project);
if (!projectId) fail("The Node 1 Hostless project has no readable ID.");

const apps = rows(await api("GET", "/projects/" + encodeURIComponent(projectId) + "/apps"), "apps");
if (!apps) fail("Unexpected Hostless project-apps response.");
const existing = apps.some(a => norm(a.name || a.appName) === norm(appName));
if (!existing) {
  console.log("[cockpit] Creating a separate Hostless app from branch " + branch + "; Apollo apps are untouched.");
  cli(["create", "app", appName, "--project", String(projectId), "--branch", branch, "--yes", "--wait", "--json"], 7 * 60 * 1000);
}

const detail = await api("GET", "/apps/" + appName);
const url = originOf(detail);
const appId = appIdOf(detail);
if (!appId) fail("Hostless app detail did not include the app ID needed to verify owner sign-in.");

await api("PUT", "/apps/" + appName + "/access", { requireSignIn: true, publicPaths: ["/health/ready"] });

const envList = cli(["env", "list", "--app", appName, "--project", String(projectId)], 60000, true);
if (!envList.includes("APOLLO_COCKPIT_WORKER_TOKEN")) {
  const created = await api("POST", "/apps/" + appName + "/access/bypass-tokens", { name: "Apollo DevOps Cockpit browser worker" });
  const workerToken = created.token || created.data?.token || created.bypassToken?.token || created.data?.bypassToken?.token;
  if (!workerToken) fail("Hostless created no readable one-time worker bypass token.");
  const secretArgs = ["env", "set", "APOLLO_COCKPIT_WORKER_TOKEN=" + workerToken, "HOSTLESS_TOKEN=" + token];
  if (process.env.HOSTLESS_NODE2_TOKEN) secretArgs.push("HOSTLESS_NODE2_TOKEN=" + process.env.HOSTLESS_NODE2_TOKEN);
  if (process.env.NODE1_TURSO_AUTH_TOKEN) secretArgs.push("TURSO_AUTH_TOKEN_NODE1=" + process.env.NODE1_TURSO_AUTH_TOKEN);
  if (process.env.NODE2_TURSO_AUTH_TOKEN) secretArgs.push("TURSO_AUTH_TOKEN_NODE2=" + process.env.NODE2_TURSO_AUTH_TOKEN);
  if (process.env.TURSO_API_TOKEN) secretArgs.push("TURSO_API_TOKEN=" + process.env.TURSO_API_TOKEN);
  secretArgs.push("--write-only", "--app", appName, "--project", String(projectId));
  cli(secretArgs, 60000, true);
}

const publicArgs = ["env", "set", "APOLLO_COCKPIT_PUBLIC_URL=" + url, "HOSTLESS_APP_ID=" + appId];
if (process.env.TURSO_DATABASE_URL) publicArgs.push("TURSO_DATABASE_URL=" + process.env.TURSO_DATABASE_URL);
publicArgs.push("--app", appName, "--project", String(projectId));
cli(publicArgs, 60000, true);

const trigger = spawnSync("hostless", ["deploy", "--json", "--yes", "--app", appName, "--project", String(projectId), "--commit", commit], { encoding: "utf8", env: process.env, timeout: 180000 });
if (trigger.status !== 0 || trigger.error) fail("Could not trigger cockpit deployment: " + String(trigger.stderr || trigger.error?.message || trigger.status).slice(-800));
const deployment = parseJson(trigger.stdout);
const deploymentId = deployment.id || deployment.deployment?.id || deployment.deploymentId;
if (!deploymentId) fail("Hostless deploy returned no deployment ID.");

const deadline = Date.now() + 9 * 60 * 1000;
let state = "unknown";
while (Date.now() < deadline) {
  await sleep(12000);
  const poll = spawnSync("hostless", ["deploy", "status", String(deploymentId), "--json", "--app", appName, "--project", String(projectId)], { encoding: "utf8", env: process.env, timeout: 60000 });
  if (poll.status !== 0) continue;
  const result = parseJson(poll.stdout);
  state = normalizeHostlessDeploymentStatus(result.status || result.deployment?.status);
  if (isHostlessDeploymentSuccessful(state)) break;
  if (isHostlessDeploymentFailure(state)) fail("Cockpit deployment failed with status " + state);
}
if (!isHostlessDeploymentSuccessful(state)) fail("Cockpit deployment did not become ready within 9 minutes.");

const health = await fetch(url + "/health/ready", { signal: AbortSignal.timeout(10000) });
const healthBody = await health.json().catch(() => ({}));
if (!health.ok || healthBody.ready !== true || healthBody.service !== "apollo-devops-cockpit") fail("The live cockpit URL failed its readiness check.");

if (process.env.GH_TOKEN) {
  const r = spawnSync("gh", ["variable", "set", "APOLLO_COCKPIT_URL", "--body", url, "--repo", process.env.GITHUB_REPOSITORY || "Mtman1987/ApolloStation"], { encoding: "utf8", env: process.env, timeout: 30000 });
  if (r.status !== 0) fail("Could not save the verified cockpit URL to GitHub Actions variables.");
}
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, "cockpit_url=" + url + "\n");
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, "## Apollo DevOps Cockpit\n\n<" + url + ">\n\n- Hostless owner sign-in is enforced by the platform\n- Persistent Chromium worker and paused prompt cron are separate from Apollo\n- Hostless terminal image includes GitHub CLI, Turso CLI, Hostless CLI, Git, Node and Python\n");
console.log("Verified live cockpit URL: " + url);
