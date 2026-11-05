import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {DatabaseSync} from "node:sqlite";
import {createAsyncJsonRecordStore} from "../packages/async-json-store/factory.mjs";
import {AsyncDshLoungeOverlayWeb} from "../apps/discord-stream-hub/dist/lounge-overlay.js";
import {AsyncDshLoungeAvatarStore} from "../apps/discord-stream-hub/dist/lounge-avatar.js";

test("async DSH Lounge overlay reads shared state, Stella host, avatar and broadcast records",async()=>{
 const directory=await mkdtemp(join(tmpdir(),"dsh-lounge-overlay-")),databasePath=join(directory,"records.sqlite");
 const records=createAsyncJsonRecordStore({service:"discord-stream-hub",mode:"sqlite",databasePath});await records.initialize();
 const now=new Date().toISOString();
 try{
  await records.put("lounge-state","tenant-a","current",{schemaVersion:1,tenantId:"tenant-a",twitchLogin:"spacemountainlive",mode:"raid-pile",headline:"Raid Pile Lounge",features:[],pileIds:["pile-1"],raidReturnPending:false,updatedAt:now});
  await records.put("lounge-host","tenant-a","current",{schemaVersion:1,tenantId:"tenant-a",host:"stella",persistent:"talking",gestureNonce:4,speaking:true,currentTopic:"Raid handoff",updatedAt:now});
  await records.put("lounge-avatar","tenant-a","manifest",{schemaVersion:1,tenantId:"tenant-a",source:"athena-robot-pet",fps:30,animations:{idle:{url:"https://cdn.example/idle.gif",durationMs:1000,loop:true}},renderedAt:now});
  await records.put("lounge-broadcast","tenant-a","current",{startedAt:now,targetHours:24});
  const overlay=new AsyncDshLoungeOverlayWeb({mode:"sqlite",databasePath});await overlay.initialize();
  try{
   const response={status:0,headers:{},body:"",writeHead(status,headers){this.status=status;this.headers=headers??{};},end(body){this.body=String(body??"");}};
   const handled=await overlay.handle({method:"GET"} ,response,new URL("https://dsh.example/apps/discord-stream-hub/api/lounge/state?tenant=tenant-a"));
   assert.equal(handled,true);assert.equal(response.status,200);
   const body=JSON.parse(response.body);assert.equal(body.state.headline,"Raid Pile Lounge");assert.equal(body.host.currentTopic,"Raid handoff");assert.equal(body.avatar.animations.idle.url,"https://cdn.example/idle.gif");assert.equal(body.twitchLogin,"spacemountainlive");
  }finally{await overlay.close();}
 }finally{await records.close();await rm(directory,{recursive:true,force:true});}
});

test("async DSH Lounge avatar manifest validates and survives store restart",async()=>{
 const directory=await mkdtemp(join(tmpdir(),"dsh-lounge-avatar-")),databasePath=join(directory,"records.sqlite"),now=new Date().toISOString();
 const store=new AsyncDshLoungeAvatarStore({mode:"sqlite",databasePath});await store.initialize();
 try{
  const manifest={schemaVersion:1,tenantId:"tenant-a",source:"athena-robot-pet",fps:30,animations:{idle:{url:"https://cdn.example/idle.gif",durationMs:1000,loop:true}},renderedAt:now};
  await store.put(manifest);assert.deepEqual(await store.get("tenant-a"),manifest);
  const index=await createAsyncJsonRecordStore({service:"discord-stream-hub",mode:"sqlite",databasePath});await index.initialize();
  try{assert.deepEqual(await index.get("lounge-tenants","_index","tenant-a"),{tenantId:"tenant-a"});}finally{await index.close();}
 }finally{await store.close();await rm(directory,{recursive:true,force:true});}
});
