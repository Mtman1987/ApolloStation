import assert from "node:assert/strict";
import test from "node:test";
import { manifest as streamweaverManifest, cueAnnouncementOverlays } from "../apps/streamweaver/dist/index.js";
import { manifest as dshManifest, requestChatTagAnnouncements } from "../apps/discord-stream-hub/dist/index.js";
import { manifest as nebulaManifest, completeChatTagRound } from "../apps/nebula-arcade/dist/index.js";
import { manifest as hearmeoutManifest } from "../apps/hearmeout/dist/index.js";
import { manifest as mountainviewManifest } from "../apps/mountainview/dist/index.js";
import { manifest as companionManifest } from "../apps/companion/dist/index.js";
import { manifest as chatGatewayManifest } from "../apps/chat-gateway/dist/index.js";
import { SpmtClient } from "../packages/sdk/dist/index.js";

test("every production product has a bounded Apollo module manifest",()=>{
  const manifests=[streamweaverManifest,dshManifest,nebulaManifest,hearmeoutManifest,mountainviewManifest,companionManifest,chatGatewayManifest];
  assert.deepEqual(manifests.map((item)=>item.id).sort(),["chat-gateway","companion","discord-stream-hub","hearmeout","mountainview","nebula-arcade","streamweaver"]);
  for(const manifest of manifests){assert.equal(manifest.manifestVersion,"spmt.app-manifest/v1");assert.ok(manifest.capabilities.length>0);assert.ok(manifest.requiredScopes.length>0);assert.ok(manifest.surfaces.length>0);assert.ok(manifest.workers.every((worker)=>worker.canonicalAuthority===false));}
});

test("Chat Tag outcome crosses Nebula, SPMT, DSH, and StreamWeaver only through public contracts",async()=>{
  const calls=[];
  let eventReads=0;
  const fetchImpl=async(url,init={})=>{
    calls.push({url:String(url),method:init.method??"GET",headers:Object.fromEntries(new Headers(init.headers)),body:init.body?JSON.parse(String(init.body)):undefined});
    if(String(url).includes("/v1/events?")&&eventReads++===0)return Response.json([{id:"event-round-7",payload:{roundId:"round-7"}}]);
    if(String(url).includes("/v1/events?"))return Response.json([{id:"event-announcement-7",payload:{kind:"chat-tag-round"}}]);
    return Response.json({ok:true});
  };
  const arcade=new SpmtClient({baseUrl:"https://spmt.example",appId:"nebula-arcade",fetchImpl});
  await completeChatTagRound(arcade,{tenantId:"tenant-a",channelId:"channel-a",roundId:"round-7",winnerUserId:"user-a",taggedUserId:"user-b",completedAt:"2026-08-23T00:00:00.000Z",xpAward:25});
  await requestChatTagAnnouncements(new SpmtClient({baseUrl:"https://spmt.example",appId:"discord-stream-hub",fetchImpl}),"tenant-a");
  await cueAnnouncementOverlays(new SpmtClient({baseUrl:"https://spmt.example",appId:"streamweaver",fetchImpl}),"tenant-a");
  assert.equal(calls.length,6);
  assert.deepEqual(calls.map((call)=>call.headers["x-spmt-app"]),["nebula-arcade","nebula-arcade","discord-stream-hub","discord-stream-hub","streamweaver","streamweaver"]);
  assert.ok(calls.every((call)=>call.headers["x-spmt-tenant"]==="tenant-a"));
  assert.equal(calls[0].headers["idempotency-key"],"chat-tag-round:round-7");
  assert.equal(calls[1].headers["idempotency-key"],"chat-tag-round:round-7");
  assert.equal(calls[3].headers["idempotency-key"],"dsh-chat-tag:event-round-7");
  assert.equal(calls[5].headers["idempotency-key"],"streamweaver-announcement:event-announcement-7");
  assert.ok(calls.every((call)=>new URL(call.url).origin==="https://spmt.example"));
});

test("tenant context cannot bleed between app clients",async()=>{
  const tenants=[];
  const fetchImpl=async(_url,init={})=>{tenants.push(new Headers(init.headers).get("x-spmt-tenant"));return Response.json([]);};
  const client=new SpmtClient({baseUrl:"https://spmt.example",appId:"discord-stream-hub",fetchImpl});
  await requestChatTagAnnouncements(client,"tenant-one");
  await requestChatTagAnnouncements(client,"tenant-two");
  assert.deepEqual(tenants,["tenant-one","tenant-two"]);
});
