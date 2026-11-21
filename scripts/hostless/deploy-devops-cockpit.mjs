import { spawnSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { isHostlessDeploymentFailure, isHostlessDeploymentSuccessful, normalizeHostlessDeploymentStatus } from "./deployment-status.mjs";

const base = process.env.HOSTLESS_API_URL || "https://api.hostless.cloud/v1";
const token = process.env.HOSTLESS_TOKEN;
const password = process.env.APOLLO_BROWSER_CONTROL_PASSWORD || process.env.APOLLO_PREVIEW_PASSWORD;
const appName = "apollo-devops-cockpit";
const branch = process.env.GITHUB_REF_NAME || "feat/standalone-devops-cockpit";
const commit = process.env.GITHUB_SHA;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function fail(message) { console.error("::error::" + message); process.exit(1); }
function rows(value, key) { return Array.isArray(value) ? value : value?.[key] || value?.data?.[key] || value?.data || null; }
function idOf(value) { return value?.id ?? value?._id ?? value?.projectId ?? null; }
function norm(value) { return String(value || "").toLowerCase().replace(/[^a-z0-9]/g, ""); }
function cli(args, timeout = 180000) {
  const r = spawnSync("hostless", args, { encoding: "utf8", env: process.env, timeout, maxBuffer: 10 * 1024 * 1024 });
  if (r.error || r.status !== 0) fail("Hostless CLI failed: " + String(r.stderr || r.error?.message || r.status).slice(-1000));
  return r.stdout || "";
}
async function get(path) {
  const r = await fetch(base + path, { headers: { Authorization: token, Accept: "application/json" }, signal: AbortSignal.timeout(15000) });
  const raw = await r.text(); let v = {};
  try { v = raw ? JSON.parse(raw) : {}; } catch {}
  if (!r.ok) throw new Error("Hostless API " + path + " returned HTTP " + r.status);
  return v;
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

if (!token || !password || !commit) fail("HOSTLESS_TOKEN, APOLLO_PREVIEW_PASSWORD (or APOLLO_BROWSER_CONTROL_PASSWORD), and GITHUB_SHA are required.");

const projects = rows(await get("/projects"), "projects");
if (!projects) fail("Unexpected Hostless project-list response.");
const matches = projects.filter(p => norm(p.name || p.projectName) === norm("apollo-node-1"));
if (matches.length > 1 || (!matches.length && projects.length !== 1)) fail("Could not uniquely resolve the existing Node 1 Hostless project.");
const project = matches[0] || projects[0];
const projectId = idOf(project);
if (!projectId) fail("The Node 1 Hostless project has no readable ID.");

const apps = rows(await get("/projects/" + encodeURIComponent(projectId) + "/apps"), "apps");
if (!apps) fail("Unexpected Hostless project-apps response.");
const existing = apps.filter(a => norm(a.name || a.appName) === norm(appName));
if (existing.length > 1) fail("More than one cockpit app exists; refusing to guess.");
if (!existing.length) cli(["create", "app", appName, "--project", String(projectId), "--branch", branch, "--yes", "--wait", "--json"], 7 * 60 * 1000);

const secretArgs = ["env", "set", "APOLLO_BROWSER_CONTROL_PASSWORD=" + password, "APOLLO_COCKPIT_WORKER_TOKEN=" + (process.env.APOLLO_COCKPIT_WORKER_TOKEN || password), "--write-only", "--app", appName, "--project", String(projectId)];
cli(secretArgs);
const urlArgs = ["env", "set", "APOLLO_COCKPIT_PUBLIC_URL=https://" + appName + ".hostless.app", "--app", appName, "--project", String(projectId)];
cli(urlArgs);

const trigger = spawnSync("hostless", ["deploy", "--json", "--yes", "--app", appName, "--project", String(projectId), "--commit", commit], { encoding: "utf8", env: process.env, timeout: 180000 });
if (trigger.status !== 0 || trigger.error) fail("Could not trigger cockpit deployment: " + String(trigger.stderr || trigger.error?.message || trigger.status).slice(-800));
let deployment;
try { deployment = JSON.parse(trigger.stdout || "{}"); } catch { fail("Hostless deploy returned invalid JSON."); }
const deploymentId = deployment.id || deployment.deployment?.id || deployment.deploymentId;
if (!deploymentId) fail("Hostless deploy returned no deployment ID.");

const deadline = Date.now() + 9 * 60 * 1000;
let state = "unknown";
while (Date.now() < deadline) {
  await sleep(12000);
  const poll = spawnSync("hostless", ["deploy", "status", String(deploymentId), "--json", "--app", appName, "--project", String(projectId)], { encoding: "utf8", env: process.env, timeout: 60000 });
  if (poll.status !== 0) continue;
  let result; try { result = JSON.parse(poll.stdout || "{}"); } catch { continue; }
  state = normalizeHostlessDeploymentStatus(result.status || result.deployment?.status);
  if (isHostlessDeploymentSuccessful(state)) break;
  if (isHostlessDeploymentFailure(state)) fail("Cockpit deployment failed with status " + state);
}
if (!isHostlessDeploymentSuccessful(state)) fail("Cockpit deployment did not become ready within 9 minutes.");

const detail = await get("/apps/" + appName);
const url = originOf(detail);
const health = await fetch(url + "/health/ready", { signal: AbortSignal.timeout(10000) });
const healthBody = await health.json().catch(() => ({}));
if (!health.ok || healthBody.ready !== true || healthBody.service !== "apollo-devops-cockpit") fail("The live cockpit URL failed its readiness check.");

if (process.env.GH_TOKEN) {
  const r = spawnSync("gh", ["variable", "set", "APOLLO_COCKPIT_URL", "--body", url, "--repo", process.env.GITHUB_REPOSITORY || "Mtman1987/ApolloStation"], { encoding: "utf8", env: process.env, timeout: 30000 });
  if (r.status !== 0) fail("Could not save the verified cockpit URL to GitHub Actions variables.");
}
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, "cockpit_url=" + url + "\n");
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, "## Apollo DevOps Cockpit\n\n<" + url + ">\n\nStandalone Hostless browser app, worker and paused prompt cron.\n");
console.log("Verified live cockpit URL: " + url);
