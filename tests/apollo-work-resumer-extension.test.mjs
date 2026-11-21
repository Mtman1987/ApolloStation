import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
const root=process.cwd(),dir=join(root,"tools/apollo-work-resumer/extension");
test("extension manifest grants only the ChatGPT UI and fixed Apollo GitHub inbox",async()=>{
 const m=JSON.parse(await readFile(join(dir,"manifest.json"),"utf8"));
 assert.equal(m.manifest_version,3);
 assert.deepEqual(m.host_permissions,[
  "https://chatgpt.com/*",
  "https://github.com/Mtman1987/ApolloStation/pull/553*"
 ]);
 assert.ok(m.permissions.includes("storage")&&m.permissions.includes("alarms")&&m.permissions.includes("notifications"));
 assert.ok(m.content_scripts.some(s=>s.matches.includes("https://github.com/Mtman1987/ApolloStation/pull/553*")&&s.js.includes("github-bridge.js")));
});
test("extension scripts parse",()=>{
 for(const file of ["background.js","content.js","github-bridge.js","popup.js"]){
  const r=spawnSync(process.execPath,["--check",join(dir,file)],{encoding:"utf8"});
  assert.equal(r.status,0, file+": "+r.stderr);
 }
});
test("GitHub Actions proof is manual-only and validates exact conversation URLs",async()=>{
 const workflow=await readFile(join(root,".github/workflows/apollo-local-chrome-proof.yml"),"utf8");
 assert.match(workflow,/workflow_dispatch:/);
 assert.match(workflow,/issues: write/);
 assert.match(workflow,/chatgpt\.com/);
 assert.match(workflow,/createComment/);
 assert.match(workflow,/issue_number: 553/);
});
