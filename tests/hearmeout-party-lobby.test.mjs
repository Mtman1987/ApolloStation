import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Worker} from 'node:worker_threads';
import {generateKeyPairSync,sign} from 'node:crypto';
import {createServer} from 'node:http';
import {HearMeOutBroadcastProgram} from '../apps/hearmeout/dist/broadcast-program.js';
import {createHearMeOutWebServer} from '../apps/hearmeout/dist/web-server-v3.js';
import {SqliteHearMeOutRoomMediaRuntime} from '../apps/hearmeout/dist/room-media-core.js';
import {HearMeOutDiscordInteractionRouter} from '../apps/hearmeout/dist/discord-interactions.js';
const binding={tenantId:'crew',executionUserId:'owner'};
const owner={tenantId:'crew',userId:'owner',displayName:'Owner',roles:['admin']};
const channel={guildId:'123456789012345678',channelId:'234567890123456789'};
const media={async resolve({query,lane}){return {itemId:query,title:query,type:lane,source:'fixture',playbackUrl:'https://media.example/video.mp4',durationSeconds:600};}};
async function fixture(t){const dir=await mkdtemp(join(tmpdir(),'hmo-parties-'));t.after(()=>rm(dir,{recursive:true,force:true}));return join(dir,'rooms.sqlite');}
const create=(program,name,extra={})=>program.createRoom({name,requesterId:'viewer',operationId:name,...extra});
const request=(program,roomId,query,lane='movie',operationId=query)=>program.request({roomId,query,lane,operationId,requesterId:'viewer',displayName:'Viewer'},media);

test('parties isolate mixed queues, idempotency, clocks and encoder leases across room-owned players',async t=>{
 const path=await fixture(t);let program=new HearMeOutBroadcastProgram(path,binding);
 const other=new HearMeOutBroadcastProgram(path,binding);t.after(()=>{program.close();other.close();});
 assert.equal(program.listRooms().length,0);assert.throws(()=>create(program,'Orphan'),/Join a HearMeOut room or Discord voice channel/);assert.throws(()=>program.getSession(),/Choose a watch party/);
 const a=create(program,'Movie night',{sourceRoomId:'room-a'}),b=create(program,'Music night',{sourceRoomId:'room-b'});assert.notEqual(a.roomId,b.roomId);assert.deepEqual(create(other,'Movie night',{sourceRoomId:'room-a'}),a);
 await Promise.all([request(program,a.roomId,'Movie','movie','same-key'),request(other,a.roomId,'Movie','movie','same-key'),request(other,b.roomId,'Song','music','same-key')]);
 await request(program,a.roomId,'Next song','music');const before=program.getSession('crew',b.roomId);
 assert.equal(program.getSession('crew',a.roomId).queue.length,1);assert.equal(before.current.item.title,'Song');assert.notEqual(before.current.requestId,program.getSession('crew',a.roomId).current.requestId);
 assert.equal(program.broadcastSessions().length,2);assert.equal(program.claimBroadcast('crew',a.roomId,'movie','worker-a'),true);assert.equal(other.claimBroadcast('crew',a.roomId,'music','worker-b'),false);assert.equal(other.claimBroadcast('crew',b.roomId,'movie','worker-b'),true);
 assert.equal(other.claimBroadcast('foreign',b.roomId,'movie','worker-c'),false);assert.throws(()=>program.getSession('foreign',a.roomId),/another deployment/);assert.throws(()=>program.getSession('crew','missing'),/not found/);
 const first=program.getSession('crew',a.roomId).current.requestId;program.control(owner,{roomId:a.roomId,action:'skip',expectedRequestId:first});program.control(owner,{roomId:a.roomId,action:'skip',expectedRequestId:first});
 assert.equal(program.getSession('crew',a.roomId).current.item.title,'Next song');assert.deepEqual(program.getSession('crew',b.roomId),before);assert.equal(program.finishBroadcastRequest('crew',a.roomId,'movie',before.current.requestId),false);
 const aBefore=program.getSession('crew',a.roomId);program.close();program=new HearMeOutBroadcastProgram(path,binding);
 assert.deepEqual(program.getSession('crew',a.roomId),aBefore);assert.deepEqual(program.getSession('crew',b.roomId),before);await request(program,b.roomId,'Song','music','same-key');assert.deepEqual(program.getSession('crew',b.roomId),before);assert.throws(()=>program.getSession(),/Choose a watch party/);
});

test('simultaneous hosts create exactly one hidden program per Discord channel or HearMeOut room',async t=>{
 const path=await fixture(t),program=new HearMeOutBroadcastProgram(path,binding);t.after(()=>program.close());const moduleUrl=new URL('../apps/hearmeout/dist/broadcast-program.js',import.meta.url).href;
 for(const hosting of [{channel},{sourceRoomId:'private-conversation'}]){
  const workers=[0,1,2].map(i=>new Worker(`const {parentPort,workerData}=require('node:worker_threads');(async()=>{const {HearMeOutBroadcastProgram}=await import(workerData.moduleUrl);const p=new HearMeOutBroadcastProgram(workerData.path,workerData.binding);parentPort.postMessage('ready');parentPort.once('message',()=>{try{parentPort.postMessage(p.createRoom({...workerData.hosting,name:'Party '+workerData.i,requesterId:'viewer-'+workerData.i,operationId:'create-'+JSON.stringify(workerData.hosting)}));}finally{p.close();}});})()`,{eval:true,workerData:{moduleUrl,path,binding,hosting,i}}));
  t.after(()=>Promise.all(workers.map(worker=>worker.terminate())));await Promise.all(workers.map(worker=>new Promise((resolve,reject)=>{worker.once('message',resolve);worker.once('error',reject);})));const results=workers.map(worker=>new Promise((resolve,reject)=>{worker.once('message',resolve);worker.once('error',reject);}));workers.forEach(worker=>worker.postMessage('create'));const rooms=await Promise.all(results);assert.equal(new Set(rooms.map(room=>room.roomId)).size,1);
 }
 assert.equal(program.listRooms().length,2);const existing=program.channelRoom(channel),remote=create(program,'Elsewhere',{channel:{...channel,channelId:'345678901234567890'}});assert.notEqual(existing.roomId,remote.roomId);program.joinRoom(remote.roomId);assert.deepEqual(program.channelRoom(channel),existing);assert.equal(create(program,'Attempt second host',{channel}).roomId,existing.roomId);
 assert.equal(program.deleteChannelRoom(channel),true);assert.equal(program.channelRoom(channel),undefined);assert.equal(program.listRooms().some(room=>room.roomId===existing.roomId),false);
 assert.equal(program.deleteHostedRoom('private-conversation'),true);assert.equal(program.hostedRoom('private-conversation'),undefined);
});

test('public watch windows view any party without joining voice; hosting remains scoped to a room or Discord VC',async t=>{
 const path=await fixture(t),rooms=new SqliteHearMeOutRoomMediaRuntime(path);
 const auth=createServer((req,res)=>{res.setHeader('content-type','application/json');if(req.headers.cookie!=='session=owner'){res.writeHead(401);res.end('{}');return;}res.end(JSON.stringify({actorId:'owner',tenantIds:['crew'],scopes:['identity:read']}));});await new Promise(resolve=>auth.listen(0,'127.0.0.1',resolve));
 const host=createHearMeOutWebServer({spmtOrigin:'http://127.0.0.1:'+auth.address().port,databasePath:path,port:0,singleBroadcast:binding,suiteMediaResolver:media,activity:{tenantId:'crew',clientId:'456789012345678901',guildIds:[channel.guildId]}});await host.listen();t.after(async()=>{await host.close();rooms.close();await new Promise(resolve=>auth.close(resolve));});const base='http://127.0.0.1:'+host.server.address().port;
 rooms.createRoom(owner,{roomId:'private-chat',name:'Our private conversation',privacy:'private',operationId:'private'});rooms.createRoom(owner,{roomId:'other-chat',name:'Their conversation',privacy:'private',operationId:'other'});const before=rooms.listMembers('crew','private-chat');
 const initial=await fetch(base+'/api/watch/broadcast/rooms'),cookie=initial.headers.get('set-cookie').split(';')[0];
 const post=(path,body,key,headers={})=>fetch(base+path,{method:'POST',headers:{cookie,origin:base,'content-type':'application/json','idempotency-key':key,...headers},body:JSON.stringify(body)});
 assert.equal((await post('/api/watch/broadcast/rooms',{name:'Orphan party'},'orphan')).status,403);
 const aResponse=await post('/api/watch/broadcast/rooms?appRoomId=private-chat',{name:'Our movie'},'a',{cookie:'session=owner'});assert.equal(aResponse.status,201,await aResponse.clone().text());const a=await aResponse.json();
 const b=await(await post('/api/watch/broadcast/rooms?appRoomId=other-chat',{name:'Their movie'},'b',{cookie:'session=owner'})).json();assert.notEqual(a.roomId,b.roomId);
 const duplicate=await(await post('/api/watch/broadcast/rooms?appRoomId=private-chat',{name:'Second player'},'another',{cookie:'session=owner'})).json();assert.equal(duplicate.roomId,a.roomId);
 assert.equal((await post('/api/watch/broadcast/rooms?appRoomId=private-chat',{name:'Spoof'},'spoof')).status,401);assert.equal((await post('/api/hearmeout/rooms/missing/media/movie',{query:'No room'},'bad',{cookie:'session=owner'})).status,404);
 assert.equal((await post('/api/hearmeout/rooms/private-chat/media/movie',{query:'Movie A'},'movie-a',{cookie:'session=owner'})).status,201);assert.equal((await post('/api/hearmeout/rooms/other-chat/media/music',{query:'Song B'},'song-b',{cookie:'session=owner'})).status,201);
 const read=id=>fetch(base+'/api/watch/broadcast/state?roomId='+id).then(r=>r.json());const stateA=await read(a.roomId),stateB=await read(b.roomId);assert.equal(stateA.current.item.title,'Movie A');assert.equal(stateB.current.item.title,'Song B');assert.notEqual(stateA.broadcast.playbackUrl,stateB.broadcast.playbackUrl);assert.deepEqual(await(await fetch(base+'/api/watch/sessions/'+b.roomId+'/state')).json(),stateB);
 assert.deepEqual(rooms.listMembers('crew','private-chat'),before);assert.equal(rooms.listMembers('crew','other-chat').some(member=>member.userId==='viewer'),false);assert.equal((await fetch(base+'/api/hearmeout/rooms/other-chat')).status,401);
 assert.equal((await post('/api/watch/broadcast/control?roomId='+a.roomId,{action:'skip',expectedRequestId:stateA.current.requestId},'skip-viewer')).status,403);
 assert.equal((await post('/api/watch/broadcast/control?roomId='+a.roomId+'&appRoomId=private-chat',{action:'skip',expectedRequestId:stateA.current.requestId},'skip-owner',{cookie:'session=owner'})).status,200);
 assert.deepEqual(await read(b.roomId),stateB);assert.equal((await fetch(base+'/api/watch/broadcast/state?roomId=missing')).status,404);assert.equal((await fetch(base+'/api/watch/broadcast/state')).status,400);
 const directory=await(await fetch(base+'/api/watch/broadcast/rooms')).json();assert.equal(directory.rooms.find(room=>room.roomId===b.roomId).title,'Song B');assert.equal(directory.hostedRoomId,null);assert.equal(directory.canHost,false);assert.doesNotMatch(JSON.stringify(directory),/sourceRoomId|members|private-chat|other-chat|Main watch party|main-broadcast/);
 for(const path of ['/watch','/activity','/activity-lite']){const html=await(await fetch(base+path)).text();assert.match(html,/id="party-lobby"/);assert.match(html,/Browse and watch any active party/);}
});

test('signed Discord menus create one hidden channel party per VC and route songs locally',async t=>{
 const path=await fixture(t),program=new HearMeOutBroadcastProgram(path,binding),rooms=new SqliteHearMeOutRoomMediaRuntime(path);t.after(()=>{program.close();rooms.close();});const {privateKey,publicKey}=generateKeyPairSync('ed25519');
 const router=new HearMeOutDiscordInteractionRouter({publicKeyHex:publicKey.export({format:'der',type:'spki'}).subarray(-32).toString('hex'),singleProgram:program,rooms,tenants:{resolve:()=>binding.tenantId},principals:{resolve(){throw Error('Public viewing must not require account or room membership');}},requestMedia:async input=>{await request(program,input.roomId,input.query,input.lane,input.interactionId);return{jobId:input.roomId};}});
 let seq=0;const call=async(data,type=3,channelId=channel.channelId)=>{const rawBody=JSON.stringify({type,id:String(567890123456789000n+BigInt(++seq)),guild_id:channel.guildId,channel_id:channelId,application_id:'456789012345678901',member:{user:{id:'678901234567890123',username:'Viewer'}},data}),timestamp=String(Math.floor(Date.now()/1000));return router.handle({rawBody,timestamp,signature:sign(null,Buffer.from(timestamp+rawBody),privateKey).toString('hex')});};
 const menu=await call({name:'nowplaying'},2);assert.match(menu.body.data.content,/Watch parties/);assert.match(menu.body.data.content,/own voice chat/);assert.equal((await call({custom_id:'hmo_party_create'})).body.type,9);
 const data={custom_id:'hmo_party_create_modal',components:[{components:[{custom_id:'party_name',value:'Discord movie night'}]}]};await call(data,5);const first=program.channelRoom(channel);await call(data,5);assert.equal(program.channelRoom(channel).roomId,first.roomId);await call(data,5,'345678901234567890');const second=program.channelRoom({...channel,channelId:'345678901234567890'});assert.notEqual(first.roomId,second.roomId);
 await call({name:'sr',options:[{name:'query',value:'Song in first channel'}]},2);assert.equal(program.getSession('crew',first.roomId).current.item.type,'music');assert.equal(program.getSession('crew',second.roomId).current,null);assert.equal((await call({custom_id:'hmo_party_open'})).body.type,12);assert.equal(rooms.listRooms(owner).length,0);
});
