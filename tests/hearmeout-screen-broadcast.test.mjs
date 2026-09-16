import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,writeFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createServer} from 'node:http';
import {HearMeOutScreenBroadcast} from '../apps/hearmeout/dist/screen-broadcast.js';
import {createHearMeOutWebServer} from '../apps/hearmeout/dist/web-server-v3.js';
import {SqliteHearMeOutRoomMediaRuntime} from '../apps/hearmeout/dist/room-media-core.js';
const command=promisify(execFile),publisher={tenantId:'t',sourceRoomId:'voice',userId:'host'},host={tenantId:'t',userId:'host',displayName:'Host',roles:['admin']};
const available=existsSync('/usr/bin/ffmpeg')&&existsSync('/usr/bin/ffprobe');
async function fixture(){return mkdtemp(join(tmpdir(),'hmo-screen-'))}
async function recording(){return (await command('/usr/bin/ffmpeg',['-v','error','-f','lavfi','-i','testsrc2=size=320x180:rate=24','-f','lavfi','-i','sine=frequency=440:sample_rate=48000','-t','9','-c:v','libvpx','-deadline','realtime','-threads','1','-b:v','300k','-c:a','libopus','-f','webm','pipe:1'],{encoding:'buffer',maxBuffer:10*1024*1024})).stdout}
async function until(check){for(let i=0;i<100;i++){const result=await check();if(result)return result;await new Promise(r=>setTimeout(r,50))}throw Error('Screen output never became ready')}
test('screen encoder isolates parties, produces playable video/audio HLS, and revokes old output on stop or admission loss',{skip:!available,timeout:20000},async t=>{
 const dir=await fixture();let allowed=true,now=Date.now();const worker=new HearMeOutScreenBroadcast({ffmpegBinary:'/usr/bin/ffmpeg',cachePath:dir,allowed:()=>allowed,now:()=>now});t.after(async()=>{await worker.close();await rm(dir,{recursive:true,force:true,maxRetries:5,retryDelay:100})});
 const a=await worker.start('a',publisher,'Host screen'),other={...publisher,sourceRoomId:'other'};const b=await worker.start('b',other,'Other screen');
 await assert.rejects(()=>worker.start('a',publisher,'Duplicate'),/already sharing/);
 const bytes=await recording(),chunks=[bytes.subarray(0,10000),bytes.subarray(10000)];
 assert.deepEqual(await worker.append('a',a.id,publisher,0,chunks[0]),{sequence:0});assert.deepEqual(await worker.append('a',a.id,publisher,0,chunks[0]),{sequence:0});
 await assert.rejects(()=>worker.append('a',a.id,publisher,0,Buffer.from('different')),/in order/);
 await assert.rejects(()=>worker.append('a',a.id,other,1,chunks[1]),/not found/);await assert.rejects(()=>worker.append('a',a.id,publisher,3,chunks[1]),/in order/);
 await worker.append('a',a.id,publisher,1,chunks[1]);await until(()=>worker.state('a').ready);
 assert.equal(worker.state('b').ready,false);assert.notEqual(worker.state('a').playbackUrl,worker.state('b').playbackUrl);
 let body;const response={writeHead:(status,headers)=>{assert.equal(status,200);assert.equal(headers['cache-control'],'no-store')},end:value=>body=value};
 await worker.serve('a',a.id,'index.m3u8',response);assert.match(body.toString(),/#EXTM3U/);const file=body.toString().split(/\r?\n/).find(line=>line.endsWith('.ts'));await worker.serve('a',a.id,file,response);assert.equal(body[0],0x47);
 const segment=join(dir,'verified.ts');await writeFile(segment,body);const probe=JSON.parse((await command('/usr/bin/ffprobe',['-v','error','-show_streams','-of','json',segment])).stdout);assert.deepEqual(probe.streams.map(stream=>stream.codec_type).sort(),['audio','video']);
 await assert.rejects(()=>worker.serve('a',b.id,'index.m3u8',response),/not found/);await assert.rejects(()=>worker.serve('a',a.id,'../index.m3u8',response),/not found/);
 worker.end('a',a.id,publisher);assert.equal(worker.state('a').active,false);assert.equal(worker.state('b').active,true);await assert.rejects(()=>worker.serve('a',a.id,file,response),/not found/);
 allowed=false;assert.equal(worker.state('b').active,false);allowed=true;const c=await worker.start('c',publisher,'Again');now+=21000;assert.equal(worker.state('c').active,false);await assert.rejects(()=>worker.append('c',c.id,publisher,0,chunks[0]),/not found/);
});
test('authenticated screen uploads are visible through public watch output without joining the publisher voice room',{skip:!available,timeout:20000},async t=>{
 const dir=await fixture(),databasePath=join(dir,'rooms.sqlite'),rooms=new SqliteHearMeOutRoomMediaRuntime(databasePath);
 const auth=createServer((req,res)=>{res.setHeader('content-type','application/json');if(req.headers.cookie!=='session=host'){res.writeHead(401);res.end('{}');return}res.end(JSON.stringify({actorId:'host',tenantIds:['t'],scopes:['identity:read']}))});await new Promise(resolve=>auth.listen(0,'127.0.0.1',resolve));
 const web=createHearMeOutWebServer({spmtOrigin:'http://127.0.0.1:'+auth.address().port,databasePath,port:0,singleBroadcast:{tenantId:'t',executionUserId:'host'},broadcast:{cachePath:join(dir,'cache'),ffmpegBinary:'/usr/bin/ffmpeg',ffprobeBinary:'/usr/bin/ffprobe'}});await web.listen();t.after(async()=>{await web.close();rooms.close();await new Promise(resolve=>auth.close(resolve));await rm(dir,{recursive:true,force:true,maxRetries:5,retryDelay:100})});const base='http://127.0.0.1:'+web.server.address().port;
 rooms.createRoom(host,{roomId:'voice',name:'Private conversation',privacy:'private',operationId:'create'});const members=rooms.listMembers('t','voice'),post=(path,body,headers={})=>fetch(base+path,{method:'POST',headers:{cookie:'session=host',origin:base,...headers},...(body?{body}:{})});
 assert.equal((await post('/api/hearmeout/rooms/voice/screen',undefined,{cookie:''})).status,401);assert.equal((await post('/api/hearmeout/rooms/voice/screen',undefined,{origin:'https://foreign.example'})).status,400);
 const start=await post('/api/hearmeout/rooms/voice/screen');assert.equal(start.status,201,await start.clone().text());const accepted=await start.json();
 assert.equal((await post('/api/hearmeout/rooms/voice/screen')).status,409);const bytes=await recording();const upload=await post('/api/hearmeout/rooms/voice/screen/'+accepted.id+'?sequence=0',bytes,{'content-type':'video/webm'});assert.equal(upload.status,200,await upload.text());
 const state=await until(async()=>{const state=await(await fetch(base+'/api/watch/broadcast/state?roomId='+accepted.roomId)).json();return state.screen?.ready&&state});
 assert.equal(state.current,null);const feed=await fetch(base+state.screen.playbackUrl);assert.equal(feed.status,200);assert.match(await feed.text(),/#EXTM3U/);const directory=await(await fetch(base+'/api/watch/broadcast/rooms')).json();assert.equal(directory.rooms.find(room=>room.roomId===accepted.roomId).screen.active,true);assert.deepEqual(rooms.listMembers('t','voice'),members);
 rooms.leaveRoom(host,'voice','leave');const ended=await(await fetch(base+'/api/watch/broadcast/state?roomId='+accepted.roomId)).json();assert.equal(ended.screen.active,false);assert.equal((await fetch(base+state.screen.playbackUrl)).status,404);
});