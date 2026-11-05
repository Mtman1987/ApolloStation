#!/usr/bin/env node
import { spawnSync } from "node:child_process";

const token = process.env.HOSTLESS_TOKEN;
const password = process.env.APOLLO_PREVIEW_PASSWORD;
const api = process.env.HOSTLESS_API_URL ?? "https://api.hostless.cloud/v1";
const appName = "apollo-node-1";
const publicUrl = process.env.APOLLO_PREVIEW_URL ?? `https://${appName}.hostless.app`;

function fail(message) { console.error(`::error::${message}`); process.exit(1); }
if (!token) fail("HOSTLESS_TOKEN is not set.");
if (!password || password.length < 8) fail("APOLLO_PREVIEW_PASSWORD secret is missing or too short; no Hostless resources were changed.");

async function request(path) {
  const response = await fetch(`${api}${path}`, { headers: { Authorization: token, Accept: "application/json" } });
  const body = await response.text();
  let parsed;
  try { parsed = body ? JSON.parse(body) : {}; } catch { parsed = {}; }
  if (!response.ok) fail(`Hostless API ${path} failed with HTTP ${response.status}; check token scopes and project access.`);
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
function idOf(value) { return value?.id ?? value?._id ?? value?.projectId ?? null; }
function nameOf(value) { return value?.name ?? value?.projectName ?? value?.slug ?? ""; }
function normalize(value) { return String(value).toLowerCase().replace(/[^a-z0-9]/g, ""); }
function run(args, label) {
  const result = spawnSync("hostless", args, { encoding: "utf8", env: process.env, maxBuffer: 20 * 1024 * 1024 });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error) fail(`${label}: ${result.error.message}`);
  if (result.status !== 0) fail(`${label} failed (exit ${result.status}).`);
}

async function resolveOrCreateProject() {
  let projectsResponse = await request("/projects");
  let projects = rows(projectsResponse, ["projects", "data", "items"]);
  if (!projects) fail("Hostless projects response was unexpected; refusing to guess.");
  let exact = projects.filter(project => normalize(nameOf(project)) === normalize(appName));
  if (exact.length > 1) fail("Multiple apollo-node-1 projects exist; refusing to choose.");
  if (exact.length === 0) {
    console.log("Creating the missing Hostless project apollo-node-1 and linking this GitHub-backed ApolloStation checkout.");
    run(["create", "project", appName, "--yes", "--json"], "Create Hostless ApolloStation project");
    projectsResponse = await request("/projects");
    projects = rows(projectsResponse, ["projects", "data", "items"]);
    if (!projects) fail("Hostless projects response was unexpected after project creation.");
    exact = projects.filter(project => normalize(nameOf(project)) === normalize(appName));
  }
  if (exact.length !== 1) fail("Hostless project creation did not produce one resolvable apollo-node-1 project.");
  const projectId = idOf(exact[0]);
  if (!projectId) fail("Resolved Hostless project has no ID.");
  return projectId;
}
const projectId = await resolveOrCreateProject();

const appsResponse = await request(`/projects/${encodeURIComponent(projectId)}/apps`);
const apps = rows(appsResponse, ["apps", "data", "items"]);
if (!apps) fail("Hostless project apps response was unexpected; refusing to guess.");
const matches = apps.filter(app => normalize(nameOf(app)) === normalize(appName));
if (matches.length > 1) fail("Multiple apollo-node-1 apps exist; refusing to choose.");
if (matches.length === 0) {
  console.log("Creating the isolated Node 1 preview app (no volume; scratch SQLite only).");
  run(["create", "app", appName, "--project", String(projectId), "--yes", "--json"], "Create Hostless preview app");
}

const parsedUrl = new URL(publicUrl);
if (parsedUrl.protocol !== "https:" || !(parsedUrl.hostname.endsWith(".hostless.app") || parsedUrl.hostname.endsWith(".apps.hostless.cloud"))) {
  fail("APOLLO_PREVIEW_URL must be an HTTPS Hostless app URL.");
}
run(["env", "set", `APOLLO_PREVIEW_PASSWORD=${password}`, "--write-only", "--app", appName, "--project", String(projectId)], "Set write-only preview password");
run(["env", "set", `SPMT_PUBLIC_URL=${parsedUrl.origin}`, "--app", appName, "--project", String(projectId)], "Set sandbox public URL");
run(["deploy", "--wait", "--timeout", "1800", "--app", appName, "--project", String(projectId)], "Deploy private owner preview");
console.log(`Private preview deployment completed for ${appName}; verify the generated HTTPS URL and /health/ready before sharing it.`);
