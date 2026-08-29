import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { CompanionExecutionWorker, SqliteCompanionDeviceRelay } from "../apps/companion/dist/index.js";
import { MountainViewPlatformClient } from "../apps/mountainview/dist/index.js";
import { SpmtClient } from "../packages/sdk/dist/index.js";
import { createSpmtService } from "../apps/spmt-service/dist/index.js";

test("one-time Companion bootstrap creates a tenant-scoped revocable worker and carries a MountainView command end to end", async () => {
  const dir=mkdtempSync(join(tmpdir(),"mountainview-companion-platform-")),databasePath=join(dir,"authority.sqlite");
  const service=createSpmtService({databasePath,webhookKey:Buffer.alloc(32,21),host:"127.0.0.1",port:0,runtimeMode:"sandbox"});
  service.authority.ensureUser("user-a");service.authority.ensureUser("user-b");
  service.control.registerTenant({tenantId:"tenant-a",ownerUserId:"user-a",displayName:"Tenant A"});
  for(const appId of ["mountainview","companion"]){service.control.registerApp({appId,name:appId,description:"Device fixture",version:"1.0.0",launchUrl:`https://${appId}.example.test/`,allowedScopes:["devices:read","devices:pair","devices:command","jobs:read","jobs:write"],surfaces:["standalone"],status:"active"});service.control.installApp("tenant-a",appId);}
  const userToken=service.auth.issueHumanSession({userId:"user-a",scopes:["devices:read","devices:pair","devices:command","jobs:read","jobs:write"],tenantIds:["tenant-a"]}).accessToken;
  await service.listen();const address=service.server.address();if(!address||typeof address==="string")throw new Error("SPMT did not bind");const origin=`http://127.0.0.1:${address.port}`;
  const userClient=new SpmtClient({baseUrl:origin,appId:"mountainview",getAccessToken:()=>userToken}),mountainview=new MountainViewPlatformClient(userClient,()=>"2026-08-29T04:00:00.000Z",(()=>{let i=0;return()=>`id-${++i}`;})());
  const localRelay=new SqliteCompanionDeviceRelay(join(dir,"companion.sqlite"));
  try{
    const bootstrap=await mountainview.bootstrapCompanion("tenant-a",{deviceId:"companion-pc-1",name:"Studio PC",capabilities:["obs.scene","media.playback"]});
    assert.match(bootstrap.bootstrapUrl,/^spmt-companion:\/\/pair\?code=/);assert.equal((await userClient.listDevices("tenant-a")).length,0,"a proposed device is not paired until local exchange");
    const exchanged=await new SpmtClient({baseUrl:origin,appId:"companion"}).exchangeDeviceBootstrap(bootstrap.code);
    assert.equal(exchanged.device.userId,"user-a");assert.equal(exchanged.serviceId,"companion:companion-pc-1");
    await assert.rejects(()=>new SpmtClient({baseUrl:origin,appId:"companion"}).exchangeDeviceBootstrap(bootstrap.code),/status 400/);
    localRelay.pairDevice({tenantId:"tenant-a",appId:"spmt",scopes:["devices:pair"]},{deviceId:"companion-pc-1",name:"Studio PC",capabilities:["obs.scene","media.playback"],pairedAt:exchanged.device.pairedAt});
    const routed=await mountainview.routeVoice("set obs scene to Gameplay",{schemaVersion:1,tenantId:"tenant-a",userId:"user-a",targetCompanionDeviceId:"companion-pc-1"},{idempotencyKey:"voice-command-1"});
    assert.equal(routed.status,"accepted");assert.equal(routed.job.executionTarget,"companion");assert.equal(routed.job.meteringTarget,"companion");
    const machineClient=new SpmtClient({baseUrl:origin,appId:"companion",getAccessToken:()=>exchanged.accessToken}),calls=[];
    const worker=new CompanionExecutionWorker(machineClient,localRelay,{execute:async(command)=>{calls.push(command);return{detail:`scene ${command.payload.sceneName} selected`};}},{workerId:"companion-pc-1",tenantId:"tenant-a",deviceId:"companion-pc-1"});
    assert.equal(await worker.runOnce(),routed.job.id);assert.equal(calls.length,1);assert.equal(calls[0].payload.sceneName,"Gameplay");
    assert.equal((await userClient.getExecutionJob("tenant-a",routed.job.id)).result.receipt.status,"completed");
    await userClient.revokeDevice("tenant-a","companion-pc-1");
    await assert.rejects(()=>machineClient.claimAnyExecutionJob("companion-pc-1","companion",{executionOwner:"companion",capabilityIds:["companion.device.command.v1"]}),/status 403/);
    const credentialClient=new SpmtClient({baseUrl:origin,appId:"companion",getAccessToken:async()=>{const response=await fetch(`${origin}/v1/auth/service-token`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({serviceId:exchanged.serviceId,credential:exchanged.credential})});if(!response.ok)throw new Error(`renewal ${response.status}`);return(await response.json()).accessToken;}});
    await assert.rejects(()=>credentialClient.listExecutionJobs("tenant-a"),/renewal 401/);
  }finally{localRelay.close();await service.close();rmSync(dir,{recursive:true,force:true});}
});

test("public device inventory is private to the authenticated user", async()=>{
  const dir=mkdtempSync(join(tmpdir(),"device-isolation-")),service=createSpmtService({databasePath:join(dir,"authority.sqlite"),webhookKey:Buffer.alloc(32,22),host:"127.0.0.1",port:0,runtimeMode:"sandbox"});
  service.authority.ensureUser("user-a");service.authority.ensureUser("user-b");service.control.registerTenant({tenantId:"tenant-a",ownerUserId:"user-a",displayName:"Tenant A"});
  const tokenA=service.auth.issueHumanSession({userId:"user-a",scopes:["devices:read","devices:pair"],tenantIds:["tenant-a"]}).accessToken,tokenB=service.auth.issueHumanSession({userId:"user-b",scopes:["devices:read","devices:pair"],tenantIds:["tenant-a"]}).accessToken;
  await service.listen();const address=service.server.address();if(!address||typeof address==="string")throw new Error("SPMT did not bind");const origin=`http://127.0.0.1:${address.port}`,client=(token)=>new SpmtClient({baseUrl:origin,appId:"mountainview",getAccessToken:()=>token});
  try{await client(tokenA).pairDevice("tenant-a",{deviceId:"phone-a",name:"A phone",kind:"phone",capabilities:["media.playback"]});assert.equal((await client(tokenA).listDevices("tenant-a")).length,1);assert.equal((await client(tokenB).listDevices("tenant-a")).length,0);await assert.rejects(()=>client(tokenB).revokeDevice("tenant-a","phone-a"),/status 400/);}
  finally{await service.close();rmSync(dir,{recursive:true,force:true});}
});
