import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { AsyncNebulaGameInputStore } from "../apps/nebula-arcade/dist/index.js";

const message=(id,text="spmt bingo claim 1",channelId="room")=>({schemaVersion:1,tenantId:"tenant-a",provider:"twitch",connectionId:"conn",channelId,messageId:id,text,occurredAt:"2026-11-05T10:00:00.000Z",actor:{providerUserId:"alice",canonicalUserId:"alice",username:"alice",displayName:"Alice",isBot:false,roles:["member"]},mentions:[]});

test("async Nebula game input feed is idempotent, ordered and restart durable",async()=>{
 const dir=await mkdtemp(join(tmpdir(),"nebula-input-feed-")),path=join(dir,"inputs.sqlite"),store=new AsyncNebulaGameInputStore({databasePath:path});
 try{
  await store.initialize();
  await store.append(message("one"),["bingo"]);
  await store.append(message("one"),["bingo"]);
  await store.append(message("two","spmt wordstorm join","room-b"),["wordstorm"],"room-b");
  await store.append({...message("bot"),actor:{...message("bot").actor,isBot:true}},["bingo"]);
  assert.deepEqual((await store.list("tenant-a","room")).map(item=>item.id),["twitch:conn:one"]);
  assert.deepEqual((await store.list("tenant-a")).map(item=>item.id),["twitch:conn:one","twitch:conn:two"]);
  await store.close();
  const restarted=new AsyncNebulaGameInputStore({databasePath:path});
  try{await restarted.initialize();assert.equal((await restarted.list("tenant-a")).length,2);}finally{await restarted.close();}
 }finally{await rm(dir,{recursive:true,force:true});}
});
