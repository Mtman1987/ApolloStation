#!/usr/bin/env node
import { spawnSync } from "node:child_process";

const nodeKey = process.argv[2];
const commit = process.argv[3] ?? process.env.GITHUB_SHA;
const token = process.env.HOSTLESS_TOKEN;
const api = process.env.HOSTLESS_API_URL ?? "https://api.hostless.cloud/v1";

const nodes = {
  node1: { label: "Node 1 — SPMT authority / SpaceMountain / OverlayBay", app: "apollo-node-1" },
  node2: { label: "Node 2 — Chat Gateway / StreamWeaver / Nebula", app: "apollo-node-2" },
  node3: { label: "Node 3 — Discord Stream Hub / Lounge", app: "apollo-node-3" },
};

function fail(message) {
  console.error(`::error::${message}`);
  process.exit(1);
}

if (!nodes[nodeKey]) fail("Pass node1, node2, or node3.");
if (!token) fail("HOSTLESS_TOKEN is not set.");
if (!commit) fail("No commit SHA was supplied.");

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
  const result = spawnSync("hostless", args, {
    encoding: "utf8",
    env: process.env,
    maxBuffer: 20 * 1024 * 1024,
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error) fail(`${description}: ${result.error.message}`);
  if (result.status !== 0) fail(`${description} failed with exit code ${result.status}.`);
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
  console.log(`App ${node.app} does not exist. Creating it from this checked-out ApolloStation commit; Hostless create-app also starts its first deployment.`);
  runCli(
    ["create", "app", node.app, "--project", String(projectId), "--yes", "--wait", "--json"],
    `Create and first deploy of ${node.app}`,
  );
} else {
  console.log(`Found existing app ${node.app}; deploying commit ${commit}.`);
  runCli(
    ["deploy", "--wait", "--timeout", "1800", "--app", node.app, "--project", String(projectId), "--commit", commit],
    `Deploy ${node.app}`,
  );
}

console.log(`Hostless operation completed for ${nodeKey} (${node.app}).`);
