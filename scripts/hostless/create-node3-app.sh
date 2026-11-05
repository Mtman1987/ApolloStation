#!/usr/bin/env bash
set -euo pipefail
: "${HOSTLESS_TOKEN:?HOSTLESS_NODE3_TOKEN is required}"
# Fresh project explicitly authorized by owner. No deletion or billing writes.
node --input-type=module <<'NODE'
const base = 'https://api.hostless.cloud/v1';
const token = process.env.HOSTLESS_TOKEN;
const headers = { Authorization: token, Accept: 'application/json', 'Content-Type': 'application/json' };
async function request(path, body) {
  const res = await fetch(base + path, { headers, method: body ? 'POST' : 'GET', ...(body ? {body: JSON.stringify(body)} : {}), signal: AbortSignal.timeout(30000) });
  let data; try { data = await res.json(); } catch { data = {}; }
  if (!res.ok) {
    const message = String(data.message ?? data.error ?? res.statusText).replaceAll(token, '[redacted]').slice(0, 500);
    console.log(JSON.stringify({endpoint:path.split('?')[0],httpStatus:res.status,message}));
    throw new Error('Provider rejected operation. No billing changes or paid fallback attempted.');
  }
  return data;
}
function rows(value) {
  if (Array.isArray(value)) return value;
  for (const key of ['items','projects','apps','data']) if (Array.isArray(value?.[key])) return value[key];
  throw new Error('Unrecognized inventory; refusing to guess');
}
const name = 'apollo-node-3-fresh';
const projects = rows(await request('/projects'));
console.log(JSON.stringify({credentialType:token.startsWith('hlk_') ? 'API key' : 'non-hlk credential',accessibleProjects:projects.map(p=>({name:p.name,id:p.id ?? p._id}))}));
const matches = projects.filter(p=>p.name === name);
if (matches.length > 1) throw new Error('Ambiguous fresh project');
let project = matches[0];
if (!project) {
  console.log(JSON.stringify({creatingProject:name,route:'POST /projects',sameRouteAsNode1:true}));
  project = await request('/projects',{name});
}
const projectId = project.id ?? project._id;
if (!/^[a-f0-9]{24}$/.test(projectId ?? '')) throw new Error('Missing project ID');
console.log(JSON.stringify({freshProjectVerified:true,name:project.name,projectId}));
const apps = rows(await request('/apps?projectId=' + projectId));
if (apps.length) {
  console.log(JSON.stringify({existingApps:apps.map(a=>({name:a.name,tier:a.tier,status:a.status,url:a.url}))}));
  throw new Error('Project contains apps; refusing duplicate');
}
const body = {
  name:'apollo-node-3-fresh',projectId,gitPlatform:'Github',gitRepo:'Mtman1987/ApolloStation',
  gitBranch:'node3-bootstrap-free',gitCommitHash:'10c36e525d9dfde5bc564e24c18802abf4d90544',
  containerPort:8000,dockerFilePath:'Dockerfile',buildSystem:'auto',hostlessFilePath:'hostless.yaml',
  webProcess:{minCpu:0.01,maxCpu:0.1,minMemory:128,maxMemory:256,minReplicas:1,maxReplicas:1},
  autoDeployOnPush:false
};
console.log(JSON.stringify({creatingApp:body.name,maxCpu:0.1,maxMemory:256,replicas:1,storage:'none',paidFallback:false}));
const created = await request('/apps',body);
console.log(JSON.stringify({created:true,name:created.name,tier:created.tier,status:created.status,url:created.url}));
const app = await request('/apps/' + body.name + '?projectId=' + projectId);
console.log(JSON.stringify({verifiedApp:{name:app.name,tier:app.tier,status:app.status,url:app.url,webProcess:app.webProcess}}));
if (app.tier !== 'FREE') throw new Error('Unexpected tier; stop and inspect');
NODE
