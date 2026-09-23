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

test('controlled broadcast permits pinned public media sockets while keeping provider writes and private addresses blocked',()=>{
 const source=`import net from 'node:net';import http from 'node:http';let calls=0;net.createConnection=()=>{calls++;return {}};http.request=()=>{calls++;return {}};await import(process.env.GUARD_URL);net.createConnection({host:'8.8.8.8',port:443});http.request({host:'8.8.8.8',port:80,method:'GET'});let blocked=0;for(const f of [()=>net.createConnection({host:'10.0.0.1',port:443}),()=>net.createConnection({host:'8.8.8.8',port:22}),()=>http.request({host:'8.8.8.8',port:80,method:'POST'}),()=>fetch('https://discord.com/api/webhooks/1/2',{method:'POST'})]){try{f()}catch(e){if(/OFFLINE_NETWORK_BLOCKED/.test(String(e)))blocked++}}if(calls!==2||blocked!==4)process.exit(1);`;
 const child=spawnSync(process.execPath,['--input-type=module','--eval',source],{encoding:'utf8',env:{...process.env,GUARD_URL:new URL('../scripts/offline-network-guard.mjs',import.meta.url).href,HEARMEOUT_CONTROLLED_MEDIA:'1'}});
 assert.equal(child.status,0,child.stderr);
});


test('private flow credential scope allows only OpenAI Responses POST',()=>{
 const source=`globalThis.fetch=async()=>new Response('ok');await import(process.env.GUARD_URL);await fetch('https://api.openai.com/v1/responses',{method:'POST'});let blocked=0;for(const [url,method] of [['https://api.openai.com/v1/responses','GET'],['https://api.openai.com/v1/files','POST'],['https://example.com/data','POST']]){try{fetch(url,{method})}catch(error){if(/OFFLINE_NETWORK_BLOCKED/.test(String(error)))blocked++}}if(blocked!==3)process.exit(1);`;
 const child=spawnSync(process.execPath,['--input-type=module','--eval',source],{encoding:'utf8',env:{...process.env,GUARD_URL:new URL('../scripts/offline-network-guard.mjs',import.meta.url).href,SPMT_PRIVATE_FLOW_OPENAI_ENABLED:'1'}});assert.equal(child.status,0,child.stderr);
});

test('avatar AI exception permits only Meshy, KeenTools, and signed S3 flow calls',()=>{
 const source=`globalThis.fetch=async()=>new Response('ok');await import(process.env.GUARD_URL);const signed='https://keen-bucket.s3.us-east-1.amazonaws.com/view.png?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=test&X-Amz-Signature=signed';await fetch('https://api.meshy.ai/openapi/v1/image-to-3d',{method:'POST'});await fetch('https://api.meshy.ai/openapi/v1/image-to-3d/task-1234');await fetch('https://assets.meshy.ai/task/model.glb');await fetch('https://api.keentools.io/v1/avatar/init',{method:'POST'});await fetch('https://api.keentools.io/v1/avatar/keen-1/process',{method:'POST'});await fetch('https://api.keentools.io/v1/avatar/keen-1/get-status');await fetch(signed,{method:'PUT'});let blocked=0;for(const [url,method] of [['https://api.meshy.ai/openapi/v1/text-to-3d','POST'],['https://api.keentools.io/v1/avatar/keen-1','DELETE'],['https://keen-bucket.s3.us-east-1.amazonaws.com/view.png','PUT'],['https://api.twitch.tv/helix/chat/messages','POST'],['https://discord.com/api/webhooks/1/2','POST']]){try{fetch(url,{method})}catch(error){if(/OFFLINE_NETWORK_BLOCKED/.test(String(error)))blocked++}}if(blocked!==5)process.exit(1);`;
 const child=spawnSync(process.execPath,['--input-type=module','--eval',source],{encoding:'utf8',env:{...process.env,GUARD_URL:new URL('../scripts/offline-network-guard.mjs',import.meta.url).href,SPMT_AVATAR_AI_OUTBOUND_MODE:'enabled'}});assert.equal(child.status,0,child.stderr);
});

test('controlled HearMeOut bridge permits only its bounded worker routes', () => {
 const source=`globalThis.fetch=async()=>new Response('ok');await import(process.env.GUARD_URL);await fetch('https://hmo-dj-worker.fly.dev/voice-bridge',{method:'POST'});await fetch('https://hmo-dj-worker.fly.dev/voice-bridge/receive-gain',{method:'POST'});await fetch('https://hmo-dj-worker.fly.dev/spotlight/status');await fetch('https://hmo-dj-worker.fly.dev/spotlight/start',{method:'POST'});await fetch('https://hmo-dj-worker.fly.dev/spotlight/hls/index.m3u8');await fetch('https://hmo-dj-worker.fly.dev/spotlight/hls/spotlight_000001.ts');let blocked=0;for(const [url,method] of [['https://hmo-dj-worker.fly.dev/dj','POST'],['https://hmo-dj-worker.fly.dev/voice-bridge','DELETE'],['https://other.fly.dev/voice-bridge','POST'],['https://hmo-dj-worker.fly.dev/spotlight/start','GET'],['https://hmo-dj-worker.fly.dev/spotlight/status','POST'],['https://hmo-dj-worker.fly.dev/spotlight/hls/not-a-segment.ts','GET'],['https://hmo-dj-worker.fly.dev/spotlight/hls/index.m3u8','POST']]){try{fetch(url,{method})}catch(error){if(/OFFLINE_NETWORK_BLOCKED/.test(String(error)))blocked++}}if(blocked!==7)process.exit(1);`;
 const result=spawnSync(process.execPath,['--input-type=module','-e',source],{encoding:'utf8',env:{...process.env,GUARD_URL:new URL('../scripts/offline-network-guard.mjs',import.meta.url).href,HEARMEOUT_CONTROLLED_BRIDGE:'1',HEARMEOUT_VOICE_BRIDGE_ORIGIN:'https://hmo-dj-worker.fly.dev'}});
 assert.equal(result.status,0,result.stderr);
});

test('prepared HearMeOut media permits bounded reads without enabling live DJ or cache controls',()=>{
 const source=`globalThis.fetch=async()=>new Response('ok');await import(process.env.GUARD_URL);await fetch('https://hmo-dj-worker.fly.dev/watch/youtube/hls/aqz-KE-bpKQ/index.m3u8');await fetch('https://hmo-dj-worker.fly.dev/watch/youtube/hls/aqz-KE-bpKQ/part001.ts?machine=abc123');let blocked=0;for(const [path,method] of [['/voice-bridge','POST'],['/dj','POST'],['/watch/cache/control','POST'],['/watch/youtube/hls/aqz-KE-bpKQ/index.m3u8','POST'],['/watch/youtube/hls/aqz-KE-bpKQ/index.m3u8?source=https://example.com','GET'],['/offline-music/catalog','GET']]){try{fetch('https://hmo-dj-worker.fly.dev'+path,{method})}catch(error){if(/OFFLINE_NETWORK_BLOCKED/.test(String(error)))blocked++}}if(blocked!==6)process.exit(1);`;
 const result=spawnSync(process.execPath,['--input-type=module','-e',source],{encoding:'utf8',env:{...process.env,GUARD_URL:new URL('../scripts/offline-network-guard.mjs',import.meta.url).href,HEARMEOUT_CONTROLLED_BRIDGE:'0',HEARMEOUT_VOICE_BRIDGE_ORIGIN:'https://hmo-dj-worker.fly.dev',HEARMEOUT_PREPARED_MEDIA_ENABLED:'1'}});
 assert.equal(result.status,0,result.stderr);
});

test('the configured IPTV adapter reaches existing read routes without opening live room controls',()=>{
 const source=`globalThis.fetch=async()=>new Response('ok');await import(process.env.GUARD_URL);await fetch('https://hearmeout-main.fly.dev/api/watch/search?q=Movie');await fetch('https://hearmeout-main.fly.dev/api/watch/xtream/hls/vod-42/index.m3u8');let blocked=0;for(const [path,method] of [['/api/watch/search?q=Movie','POST'],['/api/watch/sessions','POST'],['/api/watch/xtream/hls/vod-42/index.m3u8?source=https://other.example','GET']]){try{fetch('https://hearmeout-main.fly.dev'+path,{method})}catch(error){if(/OFFLINE_NETWORK_BLOCKED/.test(String(error)))blocked++}}if(blocked!==3)process.exit(1);`;
 const result=spawnSync(process.execPath,['--input-type=module','-e',source],{encoding:'utf8',env:{...process.env,GUARD_URL:new URL('../scripts/offline-network-guard.mjs',import.meta.url).href,HEARMEOUT_MOVIE_PROVIDER_ORIGIN:'https://hearmeout-main.fly.dev'}});
 assert.equal(result.status,0,result.stderr);
});