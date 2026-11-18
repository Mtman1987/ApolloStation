#!/usr/bin/env node
/**
 * Dispatch the canonical ApolloStation Hostless two-node release workflow.
 *
 * This script never reads, prints, or accepts Hostless credentials. The only
 * credential it uses is the short-lived GitHub Actions GITHUB_TOKEN supplied
 * by the wrapper workflow, with actions:write permission.
 */
const repo = process.env.GITHUB_REPOSITORY;
const ref = process.env.GITHUB_REF_NAME;
const token = process.env.GITHUB_TOKEN;

if (repo !== "Mtman1987/ApolloStation") {
  throw new Error(`Refusing to dispatch from unexpected repository: ${repo ?? "(missing)"}`);
}
if (ref !== "main") {
  throw new Error(`Refusing to dispatch from branch ${ref ?? "(missing)"}; main is required.`);
}
if (!token) {
  throw new Error("GITHUB_TOKEN is missing; no credentials were printed or requested.");
}

const workflow = "hostless-three-node-deploy.yml";
const endpoint = `https://api.github.com/repos/${repo}/actions/workflows/${workflow}/dispatches`;
const response = await fetch(endpoint, {
  method: "POST",
  headers: {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "X-GitHub-Api-Version": "2022-11-28",
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    ref: "main",
    inputs: { deploy: "true" },
  }),
});

if (response.status !== 204) {
  const detail = (await response.text()).slice(0, 1200);
  throw new Error(
    `GitHub rejected Hostless workflow dispatch (HTTP ${response.status}). ${detail}`
  );
}

console.log("GitHub accepted a fresh Hostless release dispatch.");
console.log(`Workflow: ${workflow}`);
console.log("Requested: full validation, then Node 1 and Node 2 Hostless deployment.");
console.log(`Monitor: https://github.com/${repo}/actions/workflows/${workflow}`);
