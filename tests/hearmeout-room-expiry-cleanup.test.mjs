import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {createServer} from 'node:http';
import {once} from 'node:events';
import WebSocket from 'ws';
import {SqliteHearMeOutRoomMediaRuntime} from '../apps/hearmeout/dist/room-media-core.js';
import {SqliteHearMeOutVoiceBridgeStore,HearMeOutVoiceBridgeController} from '../apps/hearmeout/dist/voice-bridge.js';
import {HearMeOutRoomAssistantJobs} from '../apps/hearmeout/dist/room-assistant-jobs.js';
import {createHearMeOutWebServer} from '../apps/hearmeout/dist/web-server-v3.js';

const owner={tenantId:'workspace',userId:'owner',displayName:'Owner',roles:['admin']};
const old='2026-01-01T00:00:00.000Z';
const other={...owner,tenantId:'other-workspace'};
function fixture(t){const dir=mkdtempSync(join(tmpdir(),'hmo-expiry-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));return join(dir,'rooms.sqlite')}
function create(rooms,who,id,now,systemRoom=false){return rooms.createRoom(who,{roomId:id,name:id,privacy:'public',operationId:'create-'+id,now,systemRoom})}
function bridge(store,who,id){store.put({schemaVersion:1,tenantId:who.tenantId,roomId:id,enabled:true,guildId:'1234567890',voiceChannelId:'2345678901',roomVoiceOutboundEnabled:true,audioProfile:'clean',discordReceiveGain:0.32})}
function worker(){return {calls:[],fail:false,async stop(input){this.calls.push(['stop',input]);if(this.fail)throw Error('Worker unavailable');return{running:false}},async status(){return{running:true}},async start(input){this.calls.push(['start',input]);return{running:true}},async setRoomOutbound(){return{}},async setAudioProfile(){return{}},async setDiscordReceiveGain(){return{}}}}
async function until(check){for(let i=0;i<150;i++){if(check())return;await new Promise(r=>setTimeout(r,10))}assert.fail('Room cleanup did not complete')}
function count(db,table){return db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n}

test('startup removes expired rooms and all content while preserving active rooms and system rooms',async t=>{
  const path=fixture(t),remote=worker();
  const host=createHearMeOutWebServer({spmtOrigin:'http://127.0.0.1:1',databasePath:path,port:0,voiceBridgeWorker:remote});
  t.after(()=>host.close());
  const rooms=new SqliteHearMeOutRoomMediaRuntime(path),voice=new SqliteHearMeOutVoiceBridgeStore(path),db=new DatabaseSync(path);
  t.after(()=>{db.close();voice.close();rooms.close()});
  rooms.createRoom(owner,{roomId:'expired',name:'Expired',privacy:'private',operationId:'create-expired',now:old});
  rooms.inviteToRoom(owner,{roomId:'expired',inviteeUserId:'guest',operationId:'invite',now:old});create(rooms,other,'expired');create(rooms,owner,'active');create(rooms,owner,'system',old,true);
  rooms.joinRoom({...owner,userId:'guest',roles:['member']},'expired','join',old);
  rooms.heartbeatPresence(owner,'expired','connection',old);
  rooms.moderateMember(owner,{roomId:'expired',targetUserId:'guest',action:'ban',operationId:'ban',now:old});
  rooms.enqueue(owner,{roomId:'expired',lane:'music',operationId:'enqueue',now:old,item:{itemId:'track',type:'music',title:'Old track',source:'test',playbackUrl:'https://example.com/track.mp3'}});
  db.prepare('INSERT INTO hmo_room_chat VALUES(?,?,?,?,?)').run(owner.tenantId,'expired','message',old,'{}');
  db.prepare('INSERT INTO hmo_room_personas VALUES(?,?,?,?)').run(owner.tenantId,'expired','persona','{}');
  db.prepare('INSERT INTO hmo_assistant_requests VALUES(?,?,?,?,?)').run(owner.tenantId,owner.userId,'expired','request','{}');
  bridge(voice,owner,'expired');
  await host.listen();
  assert.deepEqual(rooms.listRooms(owner).map(r=>r.roomId),['active','system']);
  assert.equal(rooms.getRoom(other.tenantId,'expired').roomId,'expired');
  assert.equal(count(db,'hmo_rooms'),3);
  for(const table of ['hmo_room_members','hmo_room_access','hmo_room_admissions','hmo_room_invitations','hmo_room_presence','hmo_room_restrictions','hmo_media_sessions','hmo_room_chat','hmo_room_personas','hmo_voice_bridge'])assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE tenant_id=? AND room_id=?`).get(owner.tenantId,'expired').n,0,table);
  assert.equal(count(db,'hmo_assistant_requests'),0);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM hmo_operations WHERE tenant_id=? AND room_id='expired'").get(owner.tenantId).n,0);
  assert.deepEqual(remote.calls,[['stop',{tenantId:owner.tenantId,roomId:'expired'}]]);
  assert.equal(db.prepare('PRAGMA quick_check').get().quick_check,'ok');
});

test('timer cleans a newly expired room without page visits and closes its RTC connection',async t=>{
  const path=fixture(t),spmt=createServer((req,res)=>{res.setHeader('content-type','application/json');res.end(JSON.stringify({actorId:owner.userId,tenantIds:[owner.tenantId],scopes:['admin'],displayName:'Owner'}))});
  spmt.listen(0,'127.0.0.1');await once(spmt,'listening');t.after(()=>new Promise(r=>spmt.close(r)));
  const host=createHearMeOutWebServer({spmtOrigin:`http://127.0.0.1:${spmt.address().port}`,databasePath:path,port:0,roomCleanupIntervalMs:25});
  await host.listen();t.after(()=>host.close());
  const rooms=new SqliteHearMeOutRoomMediaRuntime(path),db=new DatabaseSync(path);t.after(()=>{db.close();rooms.close()});
  create(rooms,owner,'timer-room');
  const origin=`http://127.0.0.1:${host.server.address().port}`;
  const socket=new WebSocket(origin.replace('http:','ws:')+'/api/hearmeout/rtc?roomId=timer-room',{headers:{origin,cookie:'user=owner'}});
  t.after(()=>socket.terminate());await once(socket,'open');const closed=once(socket,'close');
  db.prepare("UPDATE hmo_rooms SET body=json_set(body,'$.expiresAt',?) WHERE room_id='timer-room'").run(old);
  await until(()=>count(db,'hmo_rooms')===0);
  assert.equal((await closed)[0],4403);
  assert.equal(count(db,'hmo_room_members'),0);assert.equal(count(db,'hmo_operations'),0);
});

test('owner can delete an expired room while Discord is unavailable; restart retries only the disconnect',async t=>{
  const path=fixture(t),remote=worker();remote.fail=true;
  const spmt=createServer((req,res)=>{const guest=req.headers.cookie==='user=guest';res.setHeader('content-type','application/json');res.end(JSON.stringify({actorId:guest?'guest':owner.userId,tenantIds:[owner.tenantId],scopes:guest?[]:['admin'],displayName:'Viewer'}))});
  spmt.listen(0,'127.0.0.1');await once(spmt,'listening');t.after(()=>new Promise(r=>spmt.close(r)));
  const options={spmtOrigin:`http://127.0.0.1:${spmt.address().port}`,databasePath:path,port:0,voiceBridgeWorker:remote};
  let host=createHearMeOutWebServer(options);await host.listen();t.after(()=>host.close());
  const rooms=new SqliteHearMeOutRoomMediaRuntime(path),voice=new SqliteHearMeOutVoiceBridgeStore(path),db=new DatabaseSync(path);t.after(()=>{db.close();voice.close();rooms.close()});
  create(rooms,owner,'delete-expired',old);bridge(voice,owner,'delete-expired');
  const origin=`http://127.0.0.1:${host.server.address().port}`,url=origin+'/api/hearmeout/rooms/delete-expired';
  assert.equal((await fetch(url,{method:'DELETE',headers:{origin,cookie:'user=guest'}})).status,403);
  assert.equal(count(db,'hmo_rooms'),1);
  const deleted=await fetch(url,{method:'DELETE',headers:{origin,cookie:'user=owner'}});
  assert.equal(deleted.status,200);assert.deepEqual(await deleted.json(),{deleted:true,roomId:'delete-expired'});
  await host.cleanupExpiredRooms();
  assert.equal(count(db,'hmo_rooms'),0);assert.equal(voice.listEnabled().length,0);assert.equal(voice.listPendingCleanup().length,1);
  assert.equal((await (await fetch(origin+'/health/ready')).json()).roomCleanup.pendingVoiceStops,1);
  await host.close();remote.fail=false;host=createHearMeOutWebServer(options);await host.listen();
  assert.equal(count(db,'hmo_rooms'),0);assert.equal(count(db,'hmo_voice_bridge'),0);
  assert.equal(remote.calls.some(([kind])=>kind==='start'),false);
});

test('deletion during voice startup cannot recreate a room or leave a running bridge',async t=>{
  const path=fixture(t),rooms=new SqliteHearMeOutRoomMediaRuntime(path),store=new SqliteHearMeOutVoiceBridgeStore(path),db=new DatabaseSync(path);
  t.after(()=>{db.close();store.close();rooms.close()});
  create(rooms,owner,'starting');const remote=worker();let release;
  remote.start=()=>new Promise(resolve=>{release=resolve});
  const controller=new HearMeOutVoiceBridgeController(rooms,store,remote);
  const starting=controller.start(owner,{roomId:'starting',guildId:'1234567890',voiceChannelId:'2345678901'});
  const rejection=assert.rejects(starting,/room not found/);
  rooms.deleteRoom(owner,'starting','delete-starting');release({running:true});await rejection;
  assert.equal(count(db,'hmo_rooms'),0);assert.equal(count(db,'hmo_voice_bridge'),0);assert.equal(remote.calls.filter(([kind])=>kind==='stop').length,1);
});

test('a late assistant response cannot restore bindings after expiry cleanup',async t=>{
  const path=fixture(t),rooms=new SqliteHearMeOutRoomMediaRuntime(path),db=new DatabaseSync(path);
  const jobs=new HearMeOutRoomAssistantJobs(path,scope=>{if(!rooms.getRoom(scope.tenantId,scope.roomId))throw Error('Room no longer exists')});
  t.after(()=>{jobs.close();db.close();rooms.close()});create(rooms,owner,'assistant');
  let release;const pending=jobs.submit({...owner,roomId:'assistant'},{message:'Hello',personaId:'stella',displayName:'Stella',speak:false},'request',()=>new Promise(resolve=>{release=resolve}));
  const rejection=assert.rejects(pending,/no longer exists/);
  db.prepare("UPDATE hmo_rooms SET body=json_set(body,'$.expiresAt',?) WHERE room_id='assistant'").run(old);rooms.pruneExpiredRooms();
  release({jobId:'late-job'});await rejection;
  assert.equal(count(db,'hmo_assistant_requests'),0);assert.equal(count(db,'hmo_rooms'),0);
});
