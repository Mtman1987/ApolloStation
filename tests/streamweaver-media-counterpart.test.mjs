import test from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync,rmSync} from "node:fs";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {Script} from "node:vm";
import {createSpmtService} from "../apps/spmt-service/dist/index.js";
import {createIntegratedSpaceMountainWebHost} from "../apps/spacemountain-web/dist/integrated-server.js";
import {createHearMeOutWebServer} from "../apps/hearmeout/dist/web-server.js";
import {SqliteHearMeOutRoomMediaRuntime,HearMeOutWebSuiteActionExecutor,hearMeOutCatalogRegistration} from "../apps/hearmeout/dist/index.js";
import {CompanionExecutionWorker,SqliteCompanionDeviceRelay} from "../apps/companion/dist/index.js";
import {streamWeaverMediaBrowserJs} from "../apps/streamweaver/dist/media-client.js";

test("StreamWeaver's HearMeOut media endpoints share queues, reject conflicting retries, and keep private media admitted",async()=>{
  new Script(streamWeaverMediaBrowserJs());
  const dir=mkdtempSync(join(tmpdir(),"sw-media-counterpart-")),service=createSpmtService({databasePath:join(dir,"spmt.sqlite"),webhookKey:Buffer.alloc(32,8),host:"127.0.0.1",port:0,runtimeMode:"sandbox",sandboxOwnerUsername:"captain",sandboxApps:[hearMeOutCatalogRegistration("https://example.test/apps/hearmeout")]});let hmo,web;
  try{
    await service.listen();const spmtBase=`http://127.0.0.1:${service.server.address().port}`;
    await fetch(spmtBase+"/v1/auth/register",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({username:"captain",displayName:"Captain",password:"long-enough-password"})});
    const login=await fetch(spmtBase+"/v1/auth/login",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({username:"captain",password:"long-enough-password"})}),cookie=login.headers.get("set-cookie").split(";",1)[0];
    hmo=createHearMeOutWebServer({spmtOrigin:spmtBase,databasePath:join(dir,"hmo.sqlite"),host:"127.0.0.1",port:0});await hmo.listen();
    web=createIntegratedSpaceMountainWebHost({spmtOrigin:spmtBase,host:"127.0.0.1",port:0,greenAppOrigins:{hearmeout:`http://127.0.0.1:${hmo.server.address().port}`}});await web.listen();const origin=`http://127.0.0.1:${web.server.address().port}`;
    const request=(path,body,key)=>fetch(origin+"/api/hearmeout/rooms"+path,{method:body===undefined?"GET":"POST",headers:{cookie,origin,"content-type":"application/json",...(key?{"idempotency-key":key}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});
    const created=await request("",{name:"Studio",privacy:"private",password:"studio-pass"});assert.equal(created.status,201);const room=await created.json(),path="/"+room.roomId;
    const media={title:"First track",playbackUrl:"https://media.example.test/first.ogg"};
    assert.equal((await request(path+"/media/music",media,"add-1")).status,201);assert.equal((await request(path+"/media/music",media,"add-1")).status,201);
    const conflict=await request(path+"/media/music",{...media,title:"Different track"},"add-1");assert.equal(conflict.status,400);assert.match((await conflict.json()).message,/different values/);
    await request(path+"/media/music",{...media,title:"Second track"},"add-2");
    let state=await (await request(path)).json();assert.equal(state.music.current.item.title,"First track");assert.equal(state.music.queue.length,1);
    const next={action:"next",expectedRequestId:state.music.current.requestId};await request(path+"/media/music/control",next,"next-1");await request(path+"/media/music/control",next,"next-1");
    state=await (await request(path)).json();assert.equal(state.music.current.item.title,"Second track");assert.equal(state.music.queue.length,0);
    await request(path+"/media/music/control",{action:"volume",position:23},"volume-1");state=await (await request(path)).json();assert.equal(state.music.playback.volume,23);
    const crossOrigin=await fetch(origin+"/api/hearmeout/rooms"+path+"/media/music/control",{method:"POST",headers:{cookie,origin:"https://foreign.test","content-type":"application/json"},body:JSON.stringify({action:"clear"})});assert.equal(crossOrigin.status,403);
    const unauth=await fetch(origin+"/api/hearmeout/rooms"+path);assert.equal(unauth.status,401);
  }finally{if(web)await web.close();if(hmo)await hmo.close();await service.close();rmSync(dir,{recursive:true,force:true})}
});

test("suite media reads and receipt retries cannot reveal a room to someone who has not joined",async()=>{
  const dir=mkdtempSync(join(tmpdir(),"sw-private-media-")),runtime=new SqliteHearMeOutRoomMediaRuntime(join(dir,"hmo.sqlite")),owner={tenantId:"a",userId:"owner",displayName:"Owner",roles:["member"]};
  try{
    runtime.createRoom(owner,{roomId:"private",name:"Private",privacy:"private",operationId:"create"});
    const item={itemId:"one",type:"music",title:"Private song",source:"url",playbackUrl:"https://media.example.test/private.ogg"};runtime.enqueue(owner,{roomId:"private",lane:"music",item,operationId:"add"});
    const outsider={...owner,userId:"outsider"},executor=new HearMeOutWebSuiteActionExecutor(runtime,{resolve:async()=>item});
    await assert.rejects(()=>executor.execute({schemaVersion:1,action:"hmo.media.state.read",args:{roomId:"private"},actor:{userId:"outsider",username:"Outsider",role:"member"},source:{kind:"chat",requestId:"read"}},{tenantId:"a",idempotencyKey:"read"}),/Join this HearMeOut room/);
    assert.throws(()=>runtime.enqueue(outsider,{roomId:"private",lane:"music",item,operationId:"add"}),/membership/);
    assert.throws(()=>runtime.joinRoom(outsider,"private","join",undefined,{password:undefined}),/invitation|password|admission/);
  }finally{runtime.close();rmSync(dir,{recursive:true,force:true})}
});

test("Companion reports a rejected device command as failed without executing an adapter",async()=>{
  const dir=mkdtempSync(join(tmpdir(),"sw-rejected-device-")),relay=new SqliteCompanionDeviceRelay(join(dir,"device.sqlite")),failed=[],succeeded=[];
  const command={schemaVersion:1,commandId:"rejected",tenantId:"a",sourceAppId:"streamweaver",targetDeviceId:"pc",capability:"obs.scene",action:"obs.scene.set",payload:{sceneName:"Gameplay"},requestedByUserId:"owner",requestedAt:new Date().toISOString(),idempotencyKey:"rejected-1",requiresConfirmation:false,confirmed:false};
  const job={id:"job",tenantId:"a",ownerAppId:"streamweaver",capabilityId:"companion.device.command.v1",leaseId:"lease",fencingEpoch:1,input:{command}};
  const worker=new CompanionExecutionWorker({claimAnyExecutionJob:async()=>job,heartbeatExecutionJob:async()=>{},succeedExecutionJob:async(...args)=>succeeded.push(args),failExecutionJob:async(...args)=>failed.push(args)},relay,{execute:async()=>{throw new Error("Unpaired device must not execute")}},{workerId:"pc",tenantId:"a",deviceId:"pc"});
  try{await worker.runOnce();assert.equal(succeeded.length,0);assert.equal(failed.length,1);assert.equal(failed[0].at(-1),false);assert.match(failed[0].at(-2),/unpaired|revoked/i)}finally{relay.close();rmSync(dir,{recursive:true,force:true})}
});
