import assert from "node:assert/strict";
import {mkdtempSync,readFileSync,rmSync,writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import test from "node:test";
import {StreamWeaverAvatarWorker,STREAMWEAVER_AVATAR_BUILD_CAPABILITY,StreamWeaverRuntimeSettingsStore} from "../apps/streamweaver/dist/index.js";
import {SqliteMediaAssetStore} from "../packages/platform-data-sqlite/dist/index.js";
import {validateChatGatewayWorkerEnvironment} from "../apps/chat-gateway/dist/service.js";

const glb=Buffer.concat([Buffer.from("glTF"),Buffer.alloc(32)]);
const outputGlb=Buffer.concat([Buffer.from("glTF"),Buffer.alloc(96)]);
const validation={headBone:"Head",jawBone:"Jaw",eyeBones:["LeftEye","RightEye"],jawWeightedVertices:42,existingAnimationCount:3,blendshapeCount:8,createdArmature:false,skinPreserved:true};
const rigScript=readFileSync(new URL("../apps/streamweaver/scripts/avatar_geometry.py",import.meta.url),"utf8");
const webControls=readFileSync(new URL("../apps/streamweaver/src/web-controls.ts",import.meta.url),"utf8");

test("avatar worker rigs the uploaded GLB directly and activates the output",async()=>{
  const directory=mkdtempSync(join(tmpdir(),"avatar-worker-")),sourcePath=join(directory,"source.glb");
  writeFileSync(sourcePath,glb);
  const calls=[],events=[],activated=[];let claimed=false,rigInput;
  const job={id:"job",tenantId:"tenant",billedUserId:"owner",capabilityId:STREAMWEAVER_AVATAR_BUILD_CAPABILITY,leaseId:"lease",fencingEpoch:1,input:{modelAssetId:"11111111-1111-1111-1111-111111111111"}};
  const client={
    claimAnyExecutionJob:async(...args)=>{calls.push(["claim",...args]);return claimed?null:(claimed=true,job)},
    heartbeatExecutionJob:async(...args)=>calls.push(["progress",...args]),
    succeedExecutionJob:async(...args)=>calls.push(["succeeded",...args]),
    failExecutionJob:async(...args)=>assert.fail(JSON.stringify(args)),
    reportExecutionWorker:async()=>{},
    getMediaAsset:async(tenant,id)=>({id,tenantId:tenant,ownerUserId:"owner",contentType:"model/gltf-binary",publicUrl:"https://media.test/source.glb"}),
    readMediaAsset:async(_tenant,id)=>{assert.equal(id,job.input.modelAssetId);return glb},
    uploadMediaAsset:async(_tenant,input,bytes)=>{assert.equal(input.contentType,"model/gltf-binary");assert.deepEqual(Buffer.from(bytes),outputGlb);return{id:"22222222-2222-2222-2222-222222222222"}},
    publishMediaAsset:async()=>({publicUrl:"https://media.test/rigged-avatar.glb"}),
    publishEvent:async(...args)=>events.push(args)
  };
  const geometry={rig:async bytes=>{rigInput=Buffer.from(bytes);return{glb:outputGlb,validation}}};
  try{
    const worker=new StreamWeaverAvatarWorker(client,geometry,{workerId:"avatar",activate:async(...args)=>activated.push(args)});
    await worker.runOnce();
    assert.deepEqual(rigInput,glb);
    assert.equal(calls.find(call=>call[0]==="claim")[2],"fly");
    assert.equal(calls.at(-1)[0],"succeeded");
    assert.equal(activated[0][1].modelUrl,"https://media.test/rigged-avatar.glb");
    assert.equal(events[0][1],"streamweaver.avatar.model.updated.v1");
    assert.equal(events[0][2].sourceModelAssetId,job.input.modelAssetId);
    assert.match(calls.find(call=>call[0]==="progress").at(-2).message,/GLB directly/i);
  }finally{rmSync(directory,{recursive:true,force:true})}
});

test("avatar worker rejects a portrait or another user's GLB instead of sending it to an external provider",async()=>{
  for (const sourceAsset of [
    {tenantId:"tenant",ownerUserId:"owner",contentType:"image/png"},
    {tenantId:"tenant",ownerUserId:"other",contentType:"model/gltf-binary"}
  ]) {
    let rigCalls=0,failed;
    const job={id:"job",tenantId:"tenant",billedUserId:"owner",capabilityId:STREAMWEAVER_AVATAR_BUILD_CAPABILITY,leaseId:"lease",fencingEpoch:1,input:{modelAssetId:"11111111-1111-1111-1111-111111111111"}};
    const client={claimAnyExecutionJob:async()=>job,heartbeatExecutionJob:async()=>{},succeedExecutionJob:async()=>assert.fail("invalid input succeeded"),failExecutionJob:async(...args)=>{failed=args},reportExecutionWorker:async()=>{},getMediaAsset:async()=>sourceAsset,readMediaAsset:async()=>glb,uploadMediaAsset:async()=>assert.fail("invalid input uploaded"),publishMediaAsset:async()=>assert.fail(),publishEvent:async()=>assert.fail()};
    const worker=new StreamWeaverAvatarWorker(client,{rig:async()=>{rigCalls++;return{glb:outputGlb,validation}}},{workerId:"avatar",activate:async()=>{}});
    await worker.runOnce();
    assert.equal(rigCalls,0);
    assert.ok(failed);
    assert.match(failed[2],/ownership|format/i);
    assert.equal(failed[3],false);
  }
});

test("appearance persists the active rig, 2D avatar choice, Audio2Face URL and morph intensity",()=>{
  const store=new StreamWeaverRuntimeSettingsStore(":memory:");try{
    assert.equal(store.appearance("tenant").morphIntensity,1);
    store.saveAppearance("tenant",{modelUrl:"https://media.test/avatar.glb",modelAssetId:"22222222-2222-2222-2222-222222222222"});
    const value=store.saveAppearance("tenant",{avatarUrl:"https://media.test/avatar.png",talkingUrl:"https://media.test/talking.gif",audio2FaceUrl:"ws://127.0.0.1:8011/avatar",morphIntensity:1.5});
    assert.equal(value.modelUrl,"https://media.test/avatar.glb");assert.equal(value.modelAssetId,"22222222-2222-2222-2222-222222222222");
    assert.equal(value.audio2FaceUrl,"ws://127.0.0.1:8011/avatar");assert.equal(value.morphIntensity,1.5);
    assert.throws(()=>store.saveAppearance("tenant",{morphIntensity:2.5}),/between 0 and 2/);
    assert.throws(()=>store.saveAppearance("tenant",{audio2FaceUrl:"javascript:alert(1)"}),/WebSocket URL/);
  }finally{store.close()}
});

test("Blender rigging consumes the existing GLB directly, bounds jaw weights to the head, and avoids image reconstruction",()=>{
  assert.match(rigScript,/def rig\(source_path, output_path, report_path\)/);
  assert.match(rigScript,/def add_face_bones\(/);
  assert.match(rigScript,/lower_jaw_z = pivot_world\.z - head_height \* 0\.38/);
  assert.match(rigScript,/unrigged full-body character/);assert.match(rigScript,/no recognizable Head bone/);assert.match(rigScript,/Refusing to assign the whole mesh to the head/);assert.doesNotMatch(rigScript,/head_group\.add\(\[v\.index for v in obj\.data\.vertices\], 1\.0, "REPLACE"\)/);
  assert.doesNotMatch(rigScript,/view-\{String\(index\)/);
  assert.match(webControls,/executionTarget:"fly",meteringTarget:"hosted",input:\{schemaVersion:1,modelAssetId\}/);
});

test("shared media accepts a bounded GLB avatar",()=>{const directory=mkdtempSync(join(tmpdir(),"avatar-media-")),store=new SqliteMediaAssetStore(join(directory,"media.sqlite"));try{const asset=store.upload({tenantId:"tenant",ownerUserId:"owner",sourceAppId:"streamweaver",idempotencyKey:"avatar",limitBytes:1024,name:"avatar.glb",contentType:"model/gltf-binary",purpose:"avatar"},glb);assert.equal(asset.contentType,"model/gltf-binary");}finally{store.close();rmSync(directory,{recursive:true,force:true})}});

test("avatar configuration enables direct GLB rigging without external provider keys and guards sandbox execution",()=>{
  const base={SPMT_RUNTIME_MODE:"production",SPMT_ORIGIN:"http://127.0.0.1:3000",CHAT_GATEWAY_DATABASE_PATH:"/tmp/chat.sqlite",CHAT_GATEWAY_WORKER_CREDENTIAL:"x".repeat(32),CHAT_GATEWAY_CONNECTIONS:"[]",STREAMWEAVER_PROVIDER_RUNTIME_ENABLED:"1",STREAMWEAVER_WORKER_CREDENTIAL:"y".repeat(32),STREAMWEAVER_DATABASE_PATH:"/tmp/streamweaver.sqlite",STREAMWEAVER_AVATAR_RIGGING_ENABLED:"1"};
  const avatar=validateChatGatewayWorkerEnvironment(base).streamweaver.avatar;
  assert.equal(avatar.outboundEnabled,true);
  assert.match(avatar.geometryScriptPath,/apps\/streamweaver\/scripts\/avatar_geometry\.py$/);
  assert.equal(avatar.blenderBinary,"blender");
  assert.equal(validateChatGatewayWorkerEnvironment({...base,STREAMWEAVER_AVATAR_RIGGING_ENABLED:"0"}).streamweaver.avatar,undefined);
  assert.throws(()=>validateChatGatewayWorkerEnvironment({...base,SPMT_RUNTIME_MODE:"sandbox",SPMT_OUTBOUND_MODE:"disabled",CHAT_GATEWAY_DATABASE_PATH:"/tmp/chat-sandbox.sqlite",STREAMWEAVER_DATABASE_PATH:"/tmp/streamweaver-sandbox.sqlite"}),/dedicated avatar AI exception/);
  const allowed=validateChatGatewayWorkerEnvironment({...base,SPMT_RUNTIME_MODE:"sandbox",SPMT_OUTBOUND_MODE:"disabled",SPMT_AVATAR_AI_OUTBOUND_MODE:"enabled",CHAT_GATEWAY_DATABASE_PATH:"/tmp/chat-sandbox.sqlite",STREAMWEAVER_DATABASE_PATH:"/tmp/streamweaver-sandbox.sqlite"});
  assert.equal(allowed.operationMode,"read-only");
  assert.equal(allowed.streamweaver.avatar.outboundEnabled,true);
});
