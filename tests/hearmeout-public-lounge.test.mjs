import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:http';
import {HearMeOutBroadcastProgram,HEARMEOUT_IDLE_PLAYER_TTL_MS} from '../apps/hearmeout/dist/broadcast-program.js';
import {SqliteHearMeOutRoomMediaRuntime} from '../apps/hearmeout/dist/room-media-core.js';
import {createHearMeOutWebServer} from '../apps/hearmeout/dist/web-server-v3.js';
import {ensurePublicLounge,PUBLIC_LOUNGE_ID,SPOTLIGHT_MEDIA_ID} from '../apps/hearmeout/dist/lounge-room.js';
const binding={tenantId:'crew',executionUserId:'owner'};
const owner={tenantId:'crew',userId:'owner',displayName:'Owner',roles:['admin']};
const media={async resolve({query,lane}){return {itemId:query,title:query,type:lane,source:'fixture',playbackUrl:'https://media.example/video.mp4',durationSeconds:600};}};

test('one public lounge and its normal room-owned player survive empty cleanup and restart',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'hmo-lounge-')),path=join(dir,'rooms.sqlite');
 let rooms=new SqliteHearMeOutRoomMediaRuntime(path),program=new HearMeOutBroadcastProgram(path,binding);
 try{
  const party=ensurePublicLounge(rooms,program);
  assert.equal(rooms.getRoom('crew',PUBLIC_LOUNGE_ID).systemRoom,true);
  assert.equal(party.sourceRoomId,PUBLIC_LOUNGE_ID);
  assert.deepEqual(ensurePublicLounge(rooms,program),party);
  const future=new Date(Date.now()+365*86400000).toISOString();
  assert.deepEqual(rooms.pruneExpiredRooms(future),[]);
  assert.deepEqual(program.pruneIdleRooms(HEARMEOUT_IDLE_PLAYER_TTL_MS,future),[]);
  await program.request({roomId:party.roomId,query:'One shared movie',requesterId:'owner',displayName:'Owner',operationId:'movie'},media);
  const before=program.getSession('crew',party.roomId),identity=program.getBroadcastIdentity('crew',party.roomId);
  program.close();rooms.close();rooms=new SqliteHearMeOutRoomMediaRuntime(path);program=new HearMeOutBroadcastProgram(path,binding);
  assert.equal(ensurePublicLounge(rooms,program).roomId,party.roomId);
  assert.deepEqual(program.getSession('crew',party.roomId),afterDirect);
  assert.deepEqual(program.getBroadcastIdentity('crew',party.roomId),identity);
  assert.equal(program.listRooms().length,1);
  assert.equal(rooms.listRooms(owner).length,1);
 }finally{program.close();rooms.close();await rm(dir,{recursive:true,force:true});}
});

test('the public overlay views the room player without creating sessions, joining voice or controlling playback',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'hmo-lounge-http-')),path=join(dir,'rooms.sqlite');
 const auth=createServer((req,res)=>{res.setHeader('content-type','application/json');if(req.headers.authorization==='Bearer streamweaver-service')return res.end(JSON.stringify({actorType:'service',actorId:'streamweaver',tenantMode:'any',tenantIds:[],scopes:['jobs:read','jobs:write']}));if(req.headers.cookie!=='session=owner'){res.writeHead(401);res.end('{}');return;}res.end(JSON.stringify({actorType:'user',actorId:'owner',tenantIds:['crew'],scopes:['identity:read']}));});
 await new Promise(r=>auth.listen(0,'127.0.0.1',r));
 const host=createHearMeOutWebServer({spmtOrigin:'http://127.0.0.1:'+auth.address().port,databasePath:path,port:0,singleBroadcast:binding,suiteMediaResolver:media});
 const rooms=new SqliteHearMeOutRoomMediaRuntime(path),program=new HearMeOutBroadcastProgram(path,binding);
 try{
  await host.listen();const base='http://127.0.0.1:'+host.server.address().port;
  const control=await fetch(base+'/spotlight-media');assert.equal(control.status,200);const controlHtml=await control.text();assert.match(controlHtml,/own permanent Spotlight program/);assert.match(controlHtml,/\/spotlight-media\/player/);assert.doesNotMatch(controlHtml,/screen share|Share that player tab/i);
  const player=await fetch(base+'/spotlight-media/player');assert.equal(player.status,200);const playerHtml=await player.text();assert.match(playerHtml,/new Twitch\.Player/);assert.match(playerHtml,/\/api\/spotlight-media\/channels/);assert.doesNotMatch(playerHtml,/spotlight-lab\/player|<iframe/i);
  const directory=await(await fetch(base+'/api/watch/broadcast/rooms')).json();assert.equal(directory.rooms.length,2);assert.ok(directory.rooms.some(room=>room.name==='Spotlight Media'));
  const party=program.hostedRoom(PUBLIC_LOUNGE_ID),members=rooms.listMembers('crew',PUBLIC_LOUNGE_ID);
  const requested=await fetch(base+'/api/hearmeout/rooms/'+PUBLIC_LOUNGE_ID+'/media/movie',{method:'POST',headers:{cookie:'session=owner',origin:base,'content-type':'application/json','idempotency-key':'room-movie'},body:JSON.stringify({query:'Shared movie'})});assert.equal(requested.status,201,await requested.text());
  const before=program.getSession('crew',party.roomId),identity=program.getBroadcastIdentity('crew',party.roomId);
  const direct=await fetch(base+'/api/watch/broadcast/requests?roomId='+PUBLIC_LOUNGE_ID,{method:'POST',headers:{'content-type':'application/json','idempotency-key':'direct-thriller'},body:JSON.stringify({query:'Thriller',lane:'music',displayName:'SpaceMountainLive'})});
  assert.equal(direct.status,201,await direct.clone().text());const directBody=await direct.json();
  assert.equal(directBody.sessionId,party.roomId);
  assert.equal(directBody.queue.at(-1)?.item.title,'Thriller');const afterDirect=program.getSession('crew',party.roomId);
  const publicPath='/api/watch/broadcast/state?roomId='+PUBLIC_LOUNGE_ID;
  for(let i=0;i<3;i++){
   const view=await fetch(base+'/watch?roomId='+PUBLIC_LOUNGE_ID);assert.equal(view.status,200);assert.match(await view.text(),/<video/);
   const state=await fetch(base+publicPath);assert.equal(state.status,200);const value=await state.json();assert.equal(value.sessionId,party.roomId);assert.equal(value.current.requestId,before.current.requestId);assert.equal(value.canManage,false);assert.equal(value.broadcast.playbackUrl,'/api/watch/sessions/'+PUBLIC_LOUNGE_ID+'/broadcast/index.m3u8');
  }
  for(const room of directory.rooms){
   const response=await fetch(base+'/api/watch/broadcast/state?roomId='+encodeURIComponent(room.roomId));
   assert.equal(response.status,200);const state=await response.json();assert.equal(state.sessionId,room.roomId);
  }
  const session=await(await fetch(base+'/api/watch/sessions/'+PUBLIC_LOUNGE_ID+'/state')).json();assert.equal(session.current.requestId,before.current.requestId);
  const spotlight=await(await fetch(base+'/api/watch/broadcast/state?roomId='+SPOTLIGHT_MEDIA_ID)).json();assert.equal(spotlight.current,null);assert.match(spotlight.broadcast.playbackUrl,new RegExp('/api/watch/sessions/'+SPOTLIGHT_MEDIA_ID+'/broadcast/index\\.m3u8'));
  const denied=await fetch(base+'/api/watch/broadcast/control?roomId='+PUBLIC_LOUNGE_ID,{method:'POST',headers:{origin:base,'content-type':'application/json'},body:JSON.stringify({action:'skip'})});assert.equal(denied.status,403);await denied.text();
  assert.deepEqual(program.getSession('crew',party.roomId),before);
  assert.deepEqual(program.getBroadcastIdentity('crew',party.roomId),identity);
  assert.deepEqual(rooms.listMembers('crew',PUBLIC_LOUNGE_ID),members);
  assert.equal(program.listRooms().length,2);
 }finally{await host.close();program.close();rooms.close();await new Promise(r=>auth.close(r));await rm(dir,{recursive:true,force:true});}
});
