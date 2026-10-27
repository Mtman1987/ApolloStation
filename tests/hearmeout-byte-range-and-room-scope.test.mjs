import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:http';
import {parseHearMeOutByteRange,HEARMEOUT_DIRECT_VOD_CHUNK_BYTES} from '../apps/hearmeout/dist/youtube-resolver.js';
import {SqliteHearMeOutRoomMediaRuntime} from '../apps/hearmeout/dist/room-media-core.js';
import {createHearMeOutWebServer} from '../apps/hearmeout/dist/web-server-v3.js';

// HMO-008: byte ranges. Direct media is served in bounded chunks; a malformed or
// unsatisfiable Range must be rejected, never widened to the whole file.
test('missing Range header serves the first bounded chunk as 206',()=>{
 const r=parseHearMeOutByteRange(undefined,1000);
 assert.deepEqual({start:r.start,end:r.end,length:r.length,status:r.status,contentRange:r.contentRange},{start:0,end:999,length:1000,status:206,contentRange:'bytes 0-999/1000'});
 const big=parseHearMeOutByteRange(undefined,HEARMEOUT_DIRECT_VOD_CHUNK_BYTES*4);
 assert.equal(big.length,HEARMEOUT_DIRECT_VOD_CHUNK_BYTES);
});

test('explicit ranges are honoured exactly and clipped to the file size',()=>{
 const mid=parseHearMeOutByteRange('bytes=10-19',1000);
 assert.equal(mid.start,10);assert.equal(mid.end,19);assert.equal(mid.length,10);
 assert.equal(mid.contentRange,'bytes 10-19/1000');
 const clipped=parseHearMeOutByteRange('bytes=0-99999',1000);
 assert.equal(clipped.end,999);assert.equal(clipped.length,1000);
 const single=parseHearMeOutByteRange('bytes=0-0',1000);
 assert.equal(single.length,1);
});

test('open-ended and suffix ranges resolve inside the file',()=>{
 const open=parseHearMeOutByteRange('bytes=500-',1000);
 assert.equal(open.start,500);assert.equal(open.end,999);
 const openChunk=parseHearMeOutByteRange('bytes=0-',10000,100);
 assert.equal(openChunk.end,99);assert.equal(openChunk.length,100);
 const suffix=parseHearMeOutByteRange('bytes=-100',1000);
 assert.equal(suffix.start,900);assert.equal(suffix.end,999);assert.equal(suffix.length,100);
 const oversizedSuffix=parseHearMeOutByteRange('bytes=-5000',1000);
 assert.equal(oversizedSuffix.start,0);assert.equal(oversizedSuffix.end,999);
});

test('malformed, reversed, and unsatisfiable ranges are rejected',()=>{
 assert.throws(()=>parseHearMeOutByteRange('bytes=abc',1000),/Invalid byte range/);
 assert.throws(()=>parseHearMeOutByteRange('items=0-9',1000),/Invalid byte range/);
 assert.throws(()=>parseHearMeOutByteRange('bytes=5-2',1000),/Unsatisfiable byte range/);
 assert.throws(()=>parseHearMeOutByteRange('bytes=1000-',1000),/Unsatisfiable byte range/);
 assert.throws(()=>parseHearMeOutByteRange('bytes=1000-1005',1000),/Unsatisfiable byte range/);
 assert.throws(()=>parseHearMeOutByteRange('bytes=0-9',0),/Media size is invalid/);
 assert.throws(()=>parseHearMeOutByteRange('bytes=0-9',-5),/Media size is invalid/);
});

// HMO-008: room scope. Member-only room routes must refuse callers who are not
// authenticated. Unauthenticated calls map to 401 via the session error path.
test('member-only room routes refuse unauthenticated callers',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'hmo-room-scope-')),path=join(dir,'rooms.sqlite');
 const auth=createServer((req,res)=>{res.setHeader('content-type','application/json');res.writeHead(401);res.end('{}');});
 await new Promise(r=>auth.listen(0,'127.0.0.1',r));
 const host=createHearMeOutWebServer({spmtOrigin:'http://127.0.0.1:'+auth.address().port,databasePath:path,port:0});
 const rooms=new SqliteHearMeOutRoomMediaRuntime(path);
 try{
  await host.listen();
  const base='http://127.0.0.1:'+host.server.address().port;
  const room='private-room-scope-check';
  const probes=[
   ['GET',`/api/hearmeout/rooms/${room}`],
   ['GET',`/api/hearmeout/rooms/${room}/chat`],
   ['POST',`/api/hearmeout/rooms/${room}/chat`,{text:'hi'}],
   ['POST',`/api/hearmeout/rooms/${room}/presence`,{connectionId:'x'}],
   ['POST',`/api/hearmeout/rooms/${room}/media/music`,{title:'t',playbackUrl:'https://media.example/a.mp3'}],
   ['POST',`/api/hearmeout/rooms/${room}/media/movie/control`,{action:'play'}],
   ['GET',`/api/hearmeout/rooms/${room}/broadcast/music/index.m3u8`],
  ];
  for(const [method,path,body] of probes){
   const response=await fetch(base+path,{method,headers:body?{'content-type':'application/json'}:{},body:body?JSON.stringify(body):undefined});
   await response.text();
   assert.ok(response.status>=400&&response.status<500,`${method} ${path} must be refused without a principal, got ${response.status}`);
  }
 }finally{
  await host.close();rooms.close();
  await new Promise(r=>auth.close(r));
  await rm(dir,{recursive:true,force:true});
 }
});
