import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
const root=process.cwd(),dir=join(root,"tools/apollo-work-resumer/extension");
test("extension manifest is valid and only grants ChatGPT host access",async()=>{
 const m=JSON.parse(await readFile(join(dir,"manifest.json"),"utf8"));
 assert.equal(m.manifest_version,3);
 assert.deepEqual(m.host_permissions,["https://chatgpt.com/*"]);
 assert.ok(m.permissions.includes("storage")&&m.permissions.includes("alarms")&&m.permissions.includes("notifications"));
});
test("extension scripts parse",()=>{
 for(const file of ["background.js","content.js","popup.js"]){
  const r=spawnSync(process.execPath,["--check",join(dir,file)],{encoding:"utf8"});
  assert.equal(r.status,0, file+": "+r.stderr);
 }
});
