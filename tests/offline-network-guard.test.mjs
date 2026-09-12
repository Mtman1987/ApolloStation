import assert from "node:assert/strict";
import { once } from "node:events";
import http from "node:http";
import https from "node:https";
import { spawnSync } from "node:child_process";
import test from "node:test";

await import("../scripts/offline-network-guard.mjs");

test("offline guard blocks external requests before a socket is opened", async () => {
  assert.throws(() => fetch("https://example.com/apollo-should-never-leave"), /OFFLINE_NETWORK_BLOCKED/);
  assert.throws(() => httpsRequest(), /OFFLINE_NETWORK_BLOCKED/);
});

test("offline guard permits loopback-only sandbox traffic", async () => {
  const server = http.createServer((_request, response) => response.end("local-only"));
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("loopback server did not bind");
    const response = await fetch(`http://127.0.0.1:${address.port}/health`);
    assert.equal(await response.text(), "local-only");
  } finally {
    server.close();
    await once(server, "close");
  }
});

test("offline guard permits only GET requests to the configured live-read origin", () => {
  const source = `globalThis.fetch=async()=>new Response('ok');await import(process.env.GUARD_URL);await fetch('https://spmt.live/api/apps',{method:'GET'});let blocked=0;for(const [url,init] of [['https://spmt.live/api/apps',{method:'POST'}],['https://example.com/data',{method:'GET'}]]){try{fetch(url,init)}catch(error){if(/OFFLINE_NETWORK_BLOCKED/.test(String(error)))blocked+=1}}if(blocked!==2)process.exit(1);`;
  const child = spawnSync(process.execPath, ["--input-type=module", "--eval", source], { encoding: "utf8", env: { ...process.env, GUARD_URL: new URL("../scripts/offline-network-guard.mjs", import.meta.url).href, SPMT_LIVE_READ_ORIGIN: "https://spmt.live" } });
  assert.equal(child.status, 0, child.stderr);
});

function httpsRequest() {
  return https.get("https://example.com/apollo-should-never-leave");
}


test('private flow credential scope allows only OpenAI Responses POST',()=>{
 const source=`globalThis.fetch=async()=>new Response('ok');await import(process.env.GUARD_URL);await fetch('https://api.openai.com/v1/responses',{method:'POST'});let blocked=0;for(const [url,method] of [['https://api.openai.com/v1/responses','GET'],['https://api.openai.com/v1/files','POST'],['https://example.com/data','POST']]){try{fetch(url,{method})}catch(error){if(/OFFLINE_NETWORK_BLOCKED/.test(String(error)))blocked++}}if(blocked!==3)process.exit(1);`;
 const child=spawnSync(process.execPath,['--input-type=module','--eval',source],{encoding:'utf8',env:{...process.env,GUARD_URL:new URL('../scripts/offline-network-guard.mjs',import.meta.url).href,SPMT_PRIVATE_FLOW_OPENAI_ENABLED:'1'}});assert.equal(child.status,0,child.stderr);
});

test('avatar AI exception permits only Meshy, KeenTools, and signed S3 flow calls',()=>{
 const source=`globalThis.fetch=async()=>new Response('ok');await import(process.env.GUARD_URL);const signed='https://keen-bucket.s3.us-east-1.amazonaws.com/view.png?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=test&X-Amz-Signature=signed';await fetch('https://api.meshy.ai/openapi/v1/image-to-3d',{method:'POST'});await fetch('https://api.meshy.ai/openapi/v1/image-to-3d/task-1234');await fetch('https://assets.meshy.ai/task/model.glb');await fetch('https://api.keentools.io/v1/avatar/init',{method:'POST'});await fetch('https://api.keentools.io/v1/avatar/keen-1/process',{method:'POST'});await fetch('https://api.keentools.io/v1/avatar/keen-1/get-status');await fetch(signed,{method:'PUT'});let blocked=0;for(const [url,method] of [['https://api.meshy.ai/openapi/v1/text-to-3d','POST'],['https://api.keentools.io/v1/avatar/keen-1','DELETE'],['https://keen-bucket.s3.us-east-1.amazonaws.com/view.png','PUT'],['https://api.twitch.tv/helix/chat/messages','POST'],['https://discord.com/api/webhooks/1/2','POST']]){try{fetch(url,{method})}catch(error){if(/OFFLINE_NETWORK_BLOCKED/.test(String(error)))blocked++}}if(blocked!==5)process.exit(1);`;
 const child=spawnSync(process.execPath,['--input-type=module','--eval',source],{encoding:'utf8',env:{...process.env,GUARD_URL:new URL('../scripts/offline-network-guard.mjs',import.meta.url).href,SPMT_AVATAR_AI_OUTBOUND_MODE:'enabled'}});assert.equal(child.status,0,child.stderr);
});

test('controlled HearMeOut bridge permits only its bounded worker routes', () => {
 const source=`globalThis.fetch=async()=>new Response('ok');await import(process.env.GUARD_URL);await fetch('https://hmo-dj-worker.fly.dev/voice-bridge',{method:'POST'});await fetch('https://hmo-dj-worker.fly.dev/voice-bridge/receive-gain',{method:'POST'});let blocked=0;for(const [url,method] of [['https://hmo-dj-worker.fly.dev/dj','POST'],['https://hmo-dj-worker.fly.dev/voice-bridge','DELETE'],['https://other.fly.dev/voice-bridge','POST']]){try{fetch(url,{method})}catch(error){if(/OFFLINE_NETWORK_BLOCKED/.test(String(error)))blocked++}}if(blocked!==3)process.exit(1);`;
 const result=spawnSync(process.execPath,['--input-type=module','-e',source],{encoding:'utf8',env:{...process.env,GUARD_URL:new URL('../scripts/offline-network-guard.mjs',import.meta.url).href,HEARMEOUT_CONTROLLED_BRIDGE:'1',HEARMEOUT_VOICE_BRIDGE_ORIGIN:'https://hmo-dj-worker.fly.dev'}});
 assert.equal(result.status,0,result.stderr);
});
