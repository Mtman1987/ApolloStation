import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:http';
import {DatabaseSync} from 'node:sqlite';
import {HearMeOutBroadcastProgram} from '../apps/hearmeout/dist/broadcast-program.js';
import {createHearMeOutWebServer} from '../apps/hearmeout/dist/web-server-v3.js';
import {SqliteHearMeOutRoomMediaRuntime} from '../apps/hearmeout/dist/room-media-core.js';
import {createSpmtService} from '../apps/spmt-service/dist/index.js';
import {SpmtClient} from '../packages/sdk/dist/index.js';
import {HearMeOutExecutionWorker} from '../apps/hearmeout/dist/execution-worker.js';
import {HearMeOutWorkerMusicCatalog} from '../apps/hearmeout/dist/worker-music-catalog.js';
import {HearMeOutWorkerMediaCache} from '../apps/hearmeout/dist/worker-media-cache.js';
import {HearMeOutYoutubeResolverCoordinator} from '../apps/hearmeout/dist/youtube-resolver.js';
import {hearMeOutCatalogRegistration} from '../apps/hearmeout/dist/index.js';
const binding={tenantId:'tenant',executionUserId:'owner'};
const item={itemId:'video',title:'One video',type:'movie',source:'fixture',playbackUrl:'https://media.example/video.mp4',durationSeconds:210};
const media={async resolve(){return item;}};

test('one program survives zero rooms, owner departure, restart and retries',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'hmo-independent-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const path=join(dir,'state.sqlite');let program=new HearMeOutBroadcastProgram(path,binding);
 const rooms=new SqliteHearMeOutRoomMediaRuntime(path),owner={tenantId:'tenant',userId:'owner',displayName:'Owner',roles:['admin']};
 try{
  assert.equal(rooms.listRooms(owner).length,0);
  await program.request({requesterId:'guest:viewer',displayName:'Viewer',query:'A video',operationId:'request'},media);
  const first=program.getSession(),start=Date.parse(first.playback.updatedAt);
  rooms.createRoom(owner,{roomId:'a',name:'A',privacy:'public',operationId:'create-a'});
  rooms.createRoom(owner,{roomId:'b',name:'B',privacy:'private',operationId:'create-b'});
  rooms.deleteRoom(owner,'a','delete-a');rooms.deleteRoom(owner,'b','delete-b');
  assert.equal(rooms.listRooms(owner).length,0);
  program.close();program=new HearMeOutBroadcastProgram(path,binding);
  program.advance(new Date(start+180000).toISOString());
  const returned=program.getSession();assert.equal(returned.current.requestId,first.current.requestId);assert.equal(returned.playback.updatedAt,first.playback.updatedAt);
  assert.equal(210-(180+returned.playback.position),30);
  await program.request({requesterId:'guest:viewer',displayName:'Viewer',query:'A video',operationId:'request'}, {resolve(){throw Error('Replay must not resolve again');}});
  assert.equal(program.getSession().queue.length,0);
  program.advance(new Date(start+211000).toISOString());assert.equal(program.getSession().playback.status,'idle');
  assert.equal(program.broadcastSessions().length,0);
 }finally{program.close();rooms.close();}
});

test('guest HTTP requests cross real SPMT media jobs; all room and Activity windows see one source', {timeout:20000},async t=>{
 const dir=await mkdtemp(join(tmpdir(),'hmo-single-http-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const credential='single-broadcast-test-credential-123456789';
 const spmt=createSpmtService({databasePath:join(dir,'spmt.sqlite'),webhookKey:Buffer.alloc(32,7),port:0,hearMeOutRuntimeEnabled:true,hearMeOutWorkerCredential:credential});
 let host,rooms,workerTask;const stop=new AbortController();
 try{
  spmt.authority.ensureUser('owner');spmt.control.registerTenant({tenantId:'tenant',ownerUserId:'owner',displayName:'Test'});
  spmt.control.registerApp(hearMeOutCatalogRegistration('https://apollo.example/apps/hearmeout'));spmt.control.installApp('tenant','hearmeout');
  spmt.data.registerUser({userId:'owner',username:'owner',displayName:'Owner',password:'test-password-only',tenantIds:['tenant']});
  const ownerCookie='spmt_token='+spmt.auth.issueHumanSession({userId:'owner',tenantIds:['tenant'],scopes:['identity:read','jobs:read']}).accessToken;
  await spmt.listen();const spmtOrigin='http://127.0.0.1:'+spmt.server.address().port;
  const client=new SpmtClient({baseUrl:spmtOrigin,appId:'hearmeout',getAccessToken:()=>spmt.auth.issueServiceAccess('hearmeout',credential).accessToken});
  const worker=new HearMeOutExecutionWorker(client,{workerId:'single-test',executionTarget:'sprite',tenantIds:['tenant'],capabilities:['hearmeout.music.search','hearmeout.youtube.resolve'],catalog:new HearMeOutWorkerMusicCatalog({catalogFile:join(dir,'catalog.json')}),cache:new HearMeOutWorkerMediaCache({cacheDir:join(dir,'cache')}),search:async()=>[{id:'abcdefghijk',title:'Video',url:'https://youtu.be/abcdefghijk'}],resolver:new HearMeOutYoutubeResolverCoordinator({upstream:async videoId=>({videoId,videoUrl:'https://rr1.googlevideo.com/video',audioUrl:'https://rr1.googlevideo.com/audio',title:'Video',stage:'upstream',resolvedAt:new Date().toISOString()})})});
  await worker.report(new Date().toISOString());workerTask=worker.run(stop.signal,10);
  host=createHearMeOutWebServer({spmtOrigin,databasePath:join(dir,'rooms.sqlite'),port:0,credential,singleBroadcast:binding,activity:{tenantId:'tenant',clientId:'234567890123456789'}});
  await host.listen();const base='http://127.0.0.1:'+host.server.address().port;
  rooms=new SqliteHearMeOutRoomMediaRuntime(join(dir,'rooms.sqlite'));const owner={tenantId:'tenant',userId:'owner',displayName:'Owner',roles:['admin']};
  assert.equal(rooms.listRooms(owner).length,0,'Opening the service creates no room');
  for(const path of ['/watch','/activity?roomId=anything','/activity?sessionId=anything&tenantId=foreign'])assert.equal((await fetch(base+path)).status,200);
  const stateResponse=await fetch(base+'/api/watch/broadcast/state'),cookie=stateResponse.headers.get('set-cookie').split(';')[0];
  const add=()=>fetch(base+'/api/watch/broadcast/requests',{method:'POST',headers:{cookie,origin:base,'content-type':'application/json','idempotency-key':'one-video'},body:JSON.stringify({query:'https://youtu.be/abcdefghijk',userId:'owner',billedUserId:'attacker',roomId:'missing',tenantId:'foreign'})});
  const added=await add();assert.equal(added.status,201,await added.text());
  const current=await(await fetch(base+'/api/watch/broadcast/state')).json();assert.match(current.current.requestedBy.userId,/^guest:/);
  for(const alias of ['discord-watch-room','discord-music-room','watch-room-private-movie','anything']){
   const state=await(await fetch(base+'/api/watch/sessions/'+alias+'/state')).json();assert.deepEqual(state,current);
  }
  const jobs=await client.listExecutionJobs('tenant',{executionOwner:'hearmeout'});
  assert.equal(jobs.length,1);assert.equal(jobs[0].billedUserId,'owner');assert.equal(jobs[0].state,'succeeded');assert.equal(jobs[0].input.requesterId,current.current.requestedBy.userId);
  assert.equal((await add()).status,201);assert.equal((await client.listExecutionJobs('tenant',{executionOwner:'hearmeout'})).length,1);
  rooms.createRoom(owner,{roomId:'a',name:'A',privacy:'public',operationId:'a'});rooms.createRoom(owner,{roomId:'b',name:'B',privacy:'private',operationId:'b'});
  for(const id of ['a','b']){const view=await(await fetch(base+'/api/hearmeout/rooms/'+id,{headers:{cookie:ownerCookie}})).json();assert.equal(view.singleBroadcast,true);assert.equal(view.movie.current.requestId,current.current.requestId);}
  assert.equal((await fetch(base+'/api/hearmeout/rooms/b')).status,401);
  rooms.deleteRoom(owner,'a','delete-a');rooms.deleteRoom(owner,'b','delete-b');
  assert.deepEqual((await(await fetch(base+'/api/watch/broadcast/state')).json()).current,current.current);
  assert.equal(rooms.listRooms(owner).length,0);
 }finally{stop.abort();await workerTask;rooms?.close();await host?.close();await spmt.close();}
});
