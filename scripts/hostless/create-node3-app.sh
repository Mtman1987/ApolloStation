#!/usr/bin/env bash
set -euo pipefail
: "${HOSTLESS_TOKEN:?HOSTLESS_NODE3_TOKEN is required}"
# One explicit FREE request. No billing writes, volume creation, or paid fallback.
node --input-type=module <<'NODE'
const projectId = '6aecd3d98f9b6b3471dff17a';
const base = 'https://api.hostless.cloud/v1';
const headers = { Authorization: process.env.HOSTLESS_TOKEN, Accept: 'application/json', 'Content-Type': 'application/json' };
async function request(path, body) {
  const res = await fetch(base + path, { headers, method: body ? 'POST' : 'GET', ...(body ? {body: JSON.stringify(body)} : {}), signal: AbortSignal.timeout(30000) });
  let data; try { data = await res.json(); } catch { data = {}; }
  if (!res.ok) {
    const message = String(data.message ?? data.error ?? res.statusText).replaceAll(process.env.HOSTLESS_TOKEN, '[redacted]').slice(0, 500);
    console.log(JSON.stringify({endpoint: path.split('?')[0], httpStatus: res.status, message}));
    throw new Error('Hostless request rejected; no billing changes or paid fallback attempted');
  }
  return data;
}
const project = await request('/projects/' + projectId);
console.log(JSON.stringify({projectId, projectName: project.name ?? project.project?.name, existingProjectVerified: true}));
const inventory = await request('/apps?projectId=' + projectId);
const items = Array.isArray(inventory) ? inventory : inventory.items;
if (!Array.isArray(items)) throw new Error('Unknown inventory response; refusing creation');
if (items.length) {
  console.log(JSON.stringify({existingApps: items.map(a => ({name:a.name,tier:a.tier,status:a.status,url:a.url}))}));
  throw new Error('Project is no longer empty; refusing duplicate creation');
}
const body = {
  name: 'node3', projectId, tier: 'FREE',
  gitPlatform: 'Github', gitRepo: 'Mtman1987/ApolloStation',
  gitBranch: 'node3-bootstrap-free', gitCommitHash: '10c36e525d9dfde5bc564e24c18802abf4d90544',
  containerPort: 8000, dockerFilePath: 'Dockerfile', buildSystem: 'auto', hostlessFilePath: 'hostless.yaml',
  webProcess: {minCpu:0.01,maxCpu:0.1,minMemory:128,maxMemory:256,minReplicas:1,maxReplicas:1},
  autoDeployOnPush: false
};
console.log(JSON.stringify({creating:body.name,projectId,tier:body.tier,maxCpu:0.1,maxMemory:256,replicas:1,storage:'none',paidFallback:false}));
const created = await request('/apps', body);
console.log(JSON.stringify({created:true,name:created.name,tier:created.tier,status:created.status,url:created.url,id:created.id ?? created._id}));
const app = await request('/apps/node3?projectId=' + projectId);
console.log(JSON.stringify({verifiedApp:{name:app.name,tier:app.tier,status:app.status,url:app.url,webProcess:app.webProcess}}));
if (app.tier !== 'FREE') throw new Error('Unexpected tier; stop and inspect provider result');
NODE
