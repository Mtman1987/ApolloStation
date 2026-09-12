import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createServer } from 'node:http';
import { once } from 'node:events';
import WebSocket from 'ws';
import { SqliteHearMeOutRoomMediaRuntime } from '../apps/hearmeout/dist/room-media-core.js';
import { SqliteHearMeOutVoiceBridgeStore } from '../apps/hearmeout/dist/voice-bridge.js';
import { migrateHearMeOutPersistentRoom } from '../apps/hearmeout/dist/persistent-migration.js';
import { createHearMeOutWebServer } from '../apps/hearmeout/dist/web-server-v3.js';
import { hearMeOutProviderRoomName } from '../apps/hearmeout/dist/room-identity.js';
import { verifyHearMeOutLiveKitToken } from '../apps/hearmeout/dist/livekit-signer.js';
import { HttpHearMeOutVoiceBridgeWorker } from '../apps/hearmeout/dist/legacy-worker-adapter.js';

const owner={tenantId:'owner-tenant',userId:'owner',displayName:'Owner',roles:['admin']};
const activityRoom={collectionPath:'rooms',documentId:'discord-activity',data:{id:'discord-activity',systemRoom:true,playlist:[{id:'track-1',title:'Migration track',url:'https://example.com/track.mp3',duration:120,addedAt:'2026-09-12T12:00:00.000Z'}],voiceBridge:{enabled:true,guildId:'123456789012345678',voiceChannelId:'234567890123456789'}}};

test('persistent migration preserves existing rooms, imports paused, and restores the original independently',async t=>{
  const root=mkdtempSync(join(tmpdir(),'hmo-persistent-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
  const sourcePath=join(root,'current.sqlite'),targetPath=join(root,'migrated.sqlite'),recoveryPath=join(root,'recovery.sqlite');
  const prior=new SqliteHearMeOutRoomMediaRuntime(sourcePath);
  prior.createRoom(owner,{roomId:'saved-room',name:'Existing saved room',privacy:'private',operationId:'create-saved'});
  prior.close();
  const input={sourcePath,targetPath,recoveryPath,sourceDatabaseSha256:'a'.repeat(64),activityRoom,principal:owner};
  const receipt=await migrateHearMeOutPersistentRoom(input);
  assert.equal(receipt.beforeRooms,1);assert.equal(receipt.afterRooms,2);assert.equal(receipt.importedQueueItems,1);
  const rooms=new SqliteHearMeOutRoomMediaRuntime(targetPath),voice=new SqliteHearMeOutVoiceBridgeStore(targetPath);
  assert.equal(rooms.getRoom(owner.tenantId,'saved-room').name,'Existing saved room');
  assert.equal(rooms.getSession(owner.tenantId,'discord-activity','music').playback.status,'paused');
  assert.equal(voice.get(owner.tenantId,'discord-activity').enabled,false);
  voice.close();rooms.close();
  for(const file of [sourcePath,recoveryPath]){const db=new DatabaseSync(file,{readOnly:true});assert.equal(db.prepare('PRAGMA quick_check').get().quick_check,'ok');assert.equal(db.prepare('SELECT COUNT(*) AS n FROM hmo_rooms').get().n,1);db.close();}
  await assert.rejects(migrateHearMeOutPersistentRoom(input),/target already exists/);
});

test('invalid import leaves the running source intact and never activates a target',async t=>{
  const root=mkdtempSync(join(tmpdir(),'hmo-invalid-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
  const sourcePath=join(root,'current.sqlite'),targetPath=join(root,'new.sqlite'),recoveryPath=join(root,'backup.sqlite');
  const rooms=new SqliteHearMeOutRoomMediaRuntime(sourcePath);rooms.close();
  await assert.rejects(migrateHearMeOutPersistentRoom({sourcePath,targetPath,recoveryPath,sourceDatabaseSha256:'b'.repeat(64),activityRoom:{...activityRoom,documentId:'unknown-room'},principal:owner}),/canonical/);
  assert.equal(existsSync(targetPath),false);assert.equal(existsSync(targetPath+'.next'),false);assert.equal(existsSync(recoveryPath),true);
});

test('web bridge controls persist and connect a solo owner to the same tenant-scoped RTC room',async t=>{
  const root=mkdtempSync(join(tmpdir(),'hmo-web-bridge-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
  const spmt=createServer((req,res)=>{res.setHeader('content-type','application/json');const outsider=req.headers.cookie==='user=outsider';res.end(JSON.stringify({actorId:outsider?'outsider':'owner',tenantIds:[owner.tenantId],scopes:outsider?[]:['admin'],displayName:outsider?'Outsider':'Owner'}));});
  spmt.listen(0,'127.0.0.1');await once(spmt,'listening');t.after(()=>new Promise(resolve=>spmt.close(resolve)));
  const calls=[];let live={running:false};
  const worker={status:async()=>live,start:async input=>{calls.push(input);live={running:true,...input};return{success:true,status:live}},stop:async()=>{live={running:false};return{success:true}},setRoomOutbound:async input=>{Object.assign(live,input);return{success:true,status:live}},setAudioProfile:async input=>{Object.assign(live,input);return{success:true,status:live}},setDiscordReceiveGain:async input=>{Object.assign(live,input);return{success:true,status:live}}};
  const options={spmtOrigin:`http://127.0.0.1:${spmt.address().port}`,databasePath:join(root,'rooms.sqlite'),port:0,voiceBridgeWorker:worker,rtc:{livekit:{url:'wss://fixture.invalid',apiKey:'fixture-api-key-long',apiSecret:'fixture-api-secret-long-enough'}}};
  let host=createHearMeOutWebServer(options);await host.listen();t.after(()=>host.close());
  let origin=`http://127.0.0.1:${host.server.address().port}`;
  const call=async(path,body,cookie='user=owner')=>{const r=await fetch(origin+path,{method:body?'POST':'GET',headers:{cookie,origin,'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});return{status:r.status,body:await r.json()}};
  const created=await call('/api/hearmeout/rooms',{name:'Owner test room',privacy:'private'});assert.equal(created.status,201);
  const roomId=created.body.roomId,endpoint='/api/hearmeout/rooms/'+encodeURIComponent(roomId)+'/bridge';
  assert.notEqual((await call(endpoint,{action:'start',guildId:'123456789012345678',voiceChannelId:'234567890123456789'},'user=outsider')).status,200);assert.equal(calls.length,0);
  assert.equal((await call(endpoint,{action:'gain',gain:0.6})).status,200);
  const socket=new WebSocket(origin.replace('http:','ws:')+'/api/hearmeout/rtc?roomId='+encodeURIComponent(roomId),{headers:{origin,cookie:'user=owner'}});t.after(()=>socket.terminate());
  const messages=[];socket.on('message',bytes=>messages.push(JSON.parse(bytes)));await once(socket,'open');
  const next=async predicate=>{for(let i=0;i<100;i++){const found=messages.find(predicate);if(found)return found;await new Promise(r=>setTimeout(r,10));}throw Error('RTC transition missing')};
  await next(x=>x.mode==='waiting');
  assert.equal((await call(endpoint,{action:'start',guildId:'123456789012345678',voiceChannelId:'234567890123456789'})).status,200);
  assert.equal(calls[0].discordReceiveGain,0.6);
  const cloud=await next(x=>x.mode==='livekit-cloud');
  const claims=verifyHearMeOutLiveKitToken(cloud.livekit.token,'fixture-api-secret-long-enough');
  assert.equal(claims.video.room,hearMeOutProviderRoomName(owner.tenantId,roomId));
  socket.terminate();await host.close();host=createHearMeOutWebServer(options);await host.listen();origin=`http://127.0.0.1:${host.server.address().port}`;
  const reopened=await call(endpoint);assert.equal(reopened.body.config.discordReceiveGain,0.6);assert.equal(reopened.body.config.enabled,true);assert.equal(calls.length,1);
  assert.equal((await call(endpoint,{action:'stop'})).body.config.enabled,false);
});

test('same room labels in different workspaces never share a provider bridge',async()=>{
  assert.notEqual(hearMeOutProviderRoomName('tenant-a','room'),hearMeOutProviderRoomName('tenant-b','room'));
  let called=false;
  const worker=new HttpHearMeOutVoiceBridgeWorker({workerOrigin:'https://worker.example',allowedTenantIds:['owner-tenant'],getAuthorization:()=> 'Bearer fixture-secret-value',fetchImpl:async()=>{called=true;return Response.json({})}});
  assert.throws(()=>worker.status({tenantId:'another-tenant',roomId:'room'}),/not enabled for this workspace/);
  assert.equal(called,false);
});
