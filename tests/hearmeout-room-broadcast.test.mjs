import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createServer} from 'node:http';
import {SqliteHearMeOutRoomMediaRuntime} from '../apps/hearmeout/dist/room-media-core.js';
import {HearMeOutRoomBroadcast} from '../apps/hearmeout/dist/room-broadcast.js';
import {HearMeOutBroadcastEgress,isPublicBroadcastAddress} from '../apps/hearmeout/dist/broadcast-egress.js';
import {createHearMeOutWebServer} from '../apps/hearmeout/dist/web-server-v3.js';
const owner={tenantId:'room-clock',userId:'owner',displayName:'Owner',roles:['admin']},start='2026-09-13T12:00:00.000Z',at=seconds=>new Date(Date.parse(start)+seconds*1000).toISOString();
const item=(id,durationSeconds)=>({itemId:id,title:id,type:'music',source:'test',playbackUrl:'https://media.example/'+id+'.mp3',durationSeconds});

test('a 3.5 minute room song has 30 seconds left after everyone leaves for 3 minutes, then advances without viewers',()=>{
 const rooms=new SqliteHearMeOutRoomMediaRuntime(':memory:');try{
 rooms.createRoom(owner,{roomId:'room',name:'Room',privacy:'public',operationId:'create',now:start});rooms.enqueue(owner,{roomId:'room',lane:'music',item:item('one',210),operationId:'one',now:start});rooms.enqueue(owner,{roomId:'room',lane:'music',item:item('two',120),operationId:'two',now:start});rooms.enqueue(owner,{roomId:'room',lane:'music',item:item('three',180),operationId:'three',now:start});rooms.leaveRoom(owner,'room','leave',at(0));
 assert.equal(rooms.listMembers(owner.tenantId,'room',at(180)).length,0);rooms.advanceRoomTimelines(at(180));let session=rooms.getSession(owner.tenantId,'room','music',at(180));assert.equal(session.current.item.title,'one');assert.equal(session.current.item.durationSeconds-(session.playback.position+(Date.parse(at(180))-Date.parse(session.playback.updatedAt))/1000),30);
 rooms.advanceRoomTimelines(at(240));session=rooms.getSession(owner.tenantId,'room','music',at(240));assert.equal(session.current.item.title,'two');assert.equal(session.playback.position,30);assert.equal(session.playback.status,'playing');
 // A restart catches up across more than one queued item, exactly once.
 rooms.advanceRoomTimelines(at(370));session=rooms.getSession(owner.tenantId,'room','music',at(370));assert.equal(session.current.item.title,'three');assert.equal(session.playback.position,40);const revision=session.revision;rooms.advanceRoomTimelines(at(370));assert.equal(rooms.getSession(owner.tenantId,'room','music',at(370)).revision,revision);
 rooms.joinRoom(owner,'room','return',at(370));rooms.control(owner,{roomId:'room',lane:'music',action:'pause',operationId:'pause',now:at(370)});rooms.advanceRoomTimelines(at(480));assert.equal(rooms.getSession(owner.tenantId,'room','music',at(480)).playback.position,40);
 }finally{rooms.close();}
});

test('resolved media requests freeze intent, replay without a provider and fence a late result after deletion',async()=>{
 const rooms=new SqliteHearMeOutRoomMediaRuntime(':memory:');try{rooms.createRoom(owner,{roomId:'room',name:'Room',privacy:'public',operationId:'create'});let calls=0;const input={roomId:'room',lane:'music',intent:'saved-song',operationId:'once',resolve:async()=>{calls++;return item('song',210)}};const first=await rooms.enqueueResolved(owner,input);const replay=await rooms.enqueueResolved(owner,{...input,resolve:async()=>{throw Error('Offline')}});assert.deepEqual(replay,first);assert.equal(calls,1);await assert.rejects(()=>rooms.enqueueResolved(owner,{...input,intent:'different'}),/conflict|different|reused|mismatch/i);
 let resolve;const pending=rooms.enqueueResolved(owner,{...input,operationId:'late',resolve:()=>new Promise(r=>resolve=r)});rooms.deleteRoom(owner,'room','delete');resolve(item('late',60));await assert.rejects(()=>pending,/not found|expired/);
 }finally{rooms.close();}
});

async function waitFor(read,check,ms=15000){const end=Date.now()+ms;let result;do{result=await read();if(check(result))return result;await new Promise(r=>setTimeout(r,100));}while(Date.now()<end);assert.fail(JSON.stringify(result));}

test('one actual ffmpeg room broadcast serves many windows, runs without viewers and has a fenced worker lease',{timeout:30000},async()=>{
 const dir=await mkdtemp(join(tmpdir(),'hmo-single-broadcast-'));let source,host,replica,rooms;try{
 const file=join(dir,'source.mp4');execFileSync('ffmpeg',['-hide_banner','-loglevel','error','-f','lavfi','-i','color=c=blue:s=96x64:r=25','-f','lavfi','-i','sine=frequency=440:sample_rate=44100','-t','30','-c:v','libx264','-preset','ultrafast','-g','50','-c:a','aac','-movflags','+faststart',file],{timeout:10000});const bytes=await readFile(file);let reads=0;
 source=createServer((req,res)=>{if(req.url==='/v1/media/public/'+'a'.repeat(43)){reads++;const range=/bytes=(\d+)-(\d*)/.exec(req.headers.range??''),start=Number(range?.[1]??0),end=range?.[2]?Number(range[2]):bytes.length-1;res.writeHead(range?206:200,{'content-type':'video/mp4','accept-ranges':'bytes','content-length':end-start+1,...(range?{'content-range':`bytes ${start}-${end}/${bytes.length}`}:{})});res.end(bytes.subarray(start,end+1));return;}res.setHeader('content-type','application/json');res.end(JSON.stringify({actorId:'owner',displayName:'Owner',tenantIds:[owner.tenantId],scopes:['admin']}));});await new Promise(r=>source.listen(0,'127.0.0.1',r));const spmtOrigin='http://127.0.0.1:'+source.address().port,databasePath=join(dir,'rooms.sqlite'),options={ffmpegBinary:'/usr/bin/ffmpeg',ffprobeBinary:'/usr/bin/ffprobe',cachePath:join(dir,'feed')};
 rooms=new SqliteHearMeOutRoomMediaRuntime(databasePath);rooms.createRoom(owner,{roomId:'room',name:'Broadcast',privacy:'public',operationId:'create'});rooms.enqueue(owner,{roomId:'room',lane:'movie',operationId:'movie',item:{...item('film',30),type:'movie',playbackUrl:'https://media.example/v1/media/public/'+'a'.repeat(43)}});
 host=createHearMeOutWebServer({spmtOrigin,databasePath,port:0,broadcast:options});await host.listen();const origin='http://127.0.0.1:'+host.server.address().port,health=async()=>(await fetch(origin+'/health/ready')).json();
 await waitFor(health,h=>h.broadcast.active===1);const feed=origin+'/api/hearmeout/rooms/room/broadcast/movie/index.m3u8';const manifest=await waitFor(async()=>{const r=await fetch(feed);return {status:r.status,body:await r.text()}},r=>r.status===200);assert.match(manifest.body,/#EXTM3U/);
 const before=(await health()).broadcast.startedProcesses;for(let i=0;i<6;i++)assert.equal((await fetch(feed)).status,200);assert.equal((await health()).broadcast.startedProcesses,before);assert.ok(reads>=2); // probe + one source reader, never one decoder per viewer
 replica=new HearMeOutRoomBroadcast(rooms,{...options,spmtOrigin});await replica.listen();assert.equal(replica.status().active,0);await replica.close();replica=undefined;
 const variants=manifest.body.split('\n').filter(line=>line&&!line.startsWith('#'));assert.ok(variants.length);const playlist=await (await fetch(new URL(variants[0],feed))).text();assert.match(playlist,/#EXT-X-MEDIA-SEQUENCE:/);assert.doesNotMatch(playlist,/#EXT-X-ENDLIST/);
 rooms.leaveRoom(owner,'room','leave');await new Promise(r=>setTimeout(r,2200));assert.equal((await health()).broadcast.active,1);assert.equal((await fetch(feed)).status,403); // membership still gates private/native feeds
 rooms.joinRoom(owner,'room','return');const after=await (await fetch(new URL(variants[0],feed))).text();assert.notEqual(after,playlist);assert.equal((await health()).broadcast.startedProcesses,before);
 rooms.deleteRoom(owner,'room','delete');await waitFor(health,h=>h.broadcast.active===0);
 rooms.createRoom(owner,{roomId:'room',name:'Fresh broadcast',privacy:'public',operationId:'recreate'});rooms.enqueue(owner,{roomId:'room',lane:'movie',operationId:'fresh-movie',item:{...item('fresh-film',30),type:'movie',playbackUrl:'https://media.example/v1/media/public/'+'a'.repeat(43)}});
 await waitFor(async()=>{const r=await fetch(feed);return {status:r.status,body:await r.text()}},r=>r.status===200);assert.equal((await health()).broadcast.active,1);rooms.deleteRoom(owner,'room','delete-fresh');
 }finally{await replica?.close();await host?.close();rooms?.close();if(source){source.closeAllConnections();await new Promise(r=>source.close(r));}await rm(dir,{recursive:true,force:true});}
});

test('broadcast source proxy blocks private network roots and nested references',async()=>{
 for(const ip of ['127.0.0.1','10.0.0.1','169.254.169.254','172.16.0.1','192.168.1.1','100.64.0.1','::1','::ffff:127.0.0.1','fd00::1'])assert.equal(isPublicBroadcastAddress(ip),false,ip);assert.equal(isPublicBroadcastAddress('8.8.8.8'),true);
 const proxy=new HearMeOutBroadcastEgress();try{const origin=await proxy.listen();const response=await new Promise((resolve,reject)=>{import('node:http').then(({request})=>{const req=request(origin,{path:'http://127.0.0.1:1/private'},res=>{res.resume();resolve(res.statusCode)});req.on('error',reject);req.end();});});assert.equal(response,403);}finally{await proxy.close();}
});
