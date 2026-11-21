import { spawnSync } from "node:child_process";
import { appendFileSync } from "node:fs";

const apiBase = "https://api.hostless.cloud/v1";
const appName = "apollo-devops-cockpit";
const repoName = process.env.GITHUB_REPOSITORY || "Mtman1987/ApolloStation";
const token = process.env.HOSTLESS_TOKEN || "";
const password = process.env.APOLLO_BROWSER_CONTROL_PASSWORD || process.env.APOLLO_PREVIEW_PASSWORD || "";
const workerToken = process.env.APOLLO_COCKPIT_WORKER_TOKEN || password;
const commit = process.env.GITHUB_SHA || "";
const secrets = [token, password, workerToken, process.env.TURSO_AUTH_TOKEN || ""].filter(Boolean);

function redact(value) {
  let result = String(value || "");
  for (const secret of secrets) result = result.split(secret).join("[redacted]");
  return result;
}
function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: "utf8", timeout: 8 * 60 * 1000, ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const detail = redact((result.stderr || result.stdout || "").trim()).slice(-1800);
    throw new Error(command + " failed (" + result.status + "): " + detail);
  }
  return result.stdout || "";
}
async function api(method, path, body) {
  const response = await fetch(apiBase + path, {
    method,
    headers: {
      authorization: token,
      accept: "application/json",
      ...(body ? { "content-type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const raw = await response.text();
  let value = {};
  try { value = raw ? JSON.parse(raw) : {}; } catch { value = { message: raw.slice(0, 500) }; }
  if (!response.ok) throw new Error("Hostless API " + method + " " + path + " returned " + response.status + ": " + redact(value.message || value.error || raw).slice(0, 500));
  return value;
}
function unwrap(value) {
  return value?.app || value?.data?.app || value?.data || value;
}
function listOf(value, key) {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.[key])) return value[key];
  if (Array.isArray(value?.data?.[key])) return value.data[key];
  if (Array.isArray(value?.data)) return value.data;
  return [];
}
function parseCliJson(output) {
  return output.split(/\r?\n/).filter(line => line.trim().startsWith("{")).flatMap(line => {
    try { return [JSON.parse(line)]; } catch { return []; }
  });
}
function appUrl(app, cliRecords = []) {
  const candidates = [
    app?.url, app?.publicUrl, app?.defaultUrl, app?.defaultDomain, app?.domain, app?.hostname,
    ...cliRecords.map(record => record.link),
    ...cliRecords.map(record => record.app?.url || record.app?.defaultDomain || record.app?.domain),
  ].filter(value => typeof value === "string" && value.trim());
  for (const candidate of candidates) {
    const value = candidate.startsWith("http") ? candidate : "https://" + candidate;
    try {
      const parsed = new URL(value);
      if (parsed.protocol === "https:") return parsed.origin;
    } catch {}
  }
  return "https://" + appName + ".hostless.app";
}
async function waitForHealth(url, timeoutMs = 180_000) {
  const until = Date.now() + timeoutMs;
  let last = "not checked";
  while (Date.now() < until) {
    try {
      const response = await fetch(url + "/health/ready", { signal: AbortSignal.timeout(8000), cache: "no-store" });
      const value = await response.json().catch(() => ({}));
      if (response.ok && value.ready === true && value.service === "apollo-devops-cockpit") return value;
      last = "HTTP " + response.status;
    } catch (error) { last = String(error.message || error).slice(0, 160); }
    await new Promise(resolve => setTimeout(resolve, 5000));
  }
  throw new Error("Cockpit health check did not pass within 3 minutes: " + last);
}

if (!token) throw new Error("HOSTLESS_NODE1_TOKEN is required");
if (!password) throw new Error("Set APOLLO_BROWSER_CONTROL_PASSWORD or APOLLO_PREVIEW_PASSWORD in GitHub Actions secrets");
if (!commit) throw new Error("GITHUB_SHA is required");

const node1Response = await api("GET", "/apps/apollo-node-1");
const node1 = unwrap(node1Response);
const projectId = node1.projectId || node1.project?.id || node1.project_id || process.env.HOSTLESS_NODE1_PROJECT_ID;
if (!projectId) throw new Error("Could not resolve the Hostless project that owns apollo-node-1");

let existing = null;
try { existing = unwrap(await api("GET", "/apps/" + appName)); }
catch (error) { if (!String(error.message).includes("returned 404")) throw error; }
let createRecords = [];
if (!existing) {
  console.log("[cockpit] Creating a separate Hostless app in the existing Node 1 project; Apollo Node 1 is not modified.");
  const output = run("hostless", ["create", "app", appName, "--project", String(projectId), "--yes", "--wait", "--json"]);
  createRecords = parseCliJson(output);
  if (!createRecords.some(record => record.type === "app" || record.app)) console.log(redact(output).slice(-3000));
} else {
  console.log("[cockpit] Standalone app already exists; Hostless Git integration handles this branch deployment.");
}
const cockpit = existing || unwrap(await api("GET", "/apps/" + appName));
const url = appUrl(cockpit, createRecords);

if (!existing) {
  const envArgs = [
    "env", "set",
    "APOLLO_BROWSER_CONTROL_PASSWORD=" + password,
    "APOLLO_COCKPIT_WORKER_TOKEN=" + workerToken,
    "APOLLO_COCKPIT_PUBLIC_URL=" + url,
    "HOSTLESS_TOKEN=" + token,
  ];
  if (process.env.TURSO_DATABASE_URL) envArgs.push("TURSO_DATABASE_URL=" + process.env.TURSO_DATABASE_URL);
  if (process.env.TURSO_AUTH_TOKEN) envArgs.push("TURSO_AUTH_TOKEN=" + process.env.TURSO_AUTH_TOKEN);
  envArgs.push("--write-only", "--app", appName, "--project", String(projectId), "--deploy");
  run("hostless", envArgs);
}

await waitForHealth(url);
console.log("[cockpit] Verified live URL: " + url);

if (process.env.GH_TOKEN) {
  run("gh", ["variable", "set", "APOLLO_COCKPIT_URL", "--body", url, "--repo", repoName], { env: { ...process.env, GH_TOKEN: process.env.GH_TOKEN } });
}
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, "cockpit_url=" + url + "\n");
if (process.env.GITHUB_STEP_SUMMARY) {
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, "## Apollo DevOps Cockpit\n\n<" + url + ">\n\n- Standalone Hostless app; separate from Apollo Node 1 and Node 2\n- Persistent Chromium worker and paused test-prompt cron are configured\n- Hostless app terminal includes GitHub CLI, Turso CLI, Hostless CLI, Git, Node and Python\n");
}
console.log("[cockpit] Deployment verification passed");
