import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:http';
import {HearMeOutBroadcastProgram} from '../apps/hearmeout/dist/broadcast-program.js';
import {SqliteHearMeOutRoomMediaRuntime} from '../apps/hearmeout/dist/room-media-core.js';
import {createHearMeOutWebServer} from '../apps/hearmeout/dist/web-server-v3.js';
import {ensurePublicLounge,PUBLIC_LOUNGE_ID} from '../apps/hearmeout/dist/lounge-room.js';

const binding={tenantId:'crew',executionUserId:'owner'};
const scheduledEntries=session=>[session.current,...session.queue].filter(Boolean);

// End to end: HTTP search request -> resolver -> scheduled item visible in state.
test('a public search request resolves through the resolver and schedules media',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'hmo-search-queue-')),path=join(dir,'rooms.sqlite');
 const resolved=[];
 const media={async resolve(input){
  resolved.push(input);
  if(/unplayable/i.test(input.query))throw new Error('Could not resolve that title');
  return {itemId:'item-'+resolved.length,title:input.query,type:input.lane,source:'fixture',playbackUrl:'https://media.example/'+resolved.length+'.mp4',durationSeconds:240};
 }};
 const auth=createServer((req,res)=>{res.setHeader('content-type','application/json');res.writeHead(401);res.end('{}');});
 await new Promise(r=>auth.listen(0,'127.0.0.1',r));
 const host=createHearMeOutWebServer({spmtOrigin:'http://127.0.0.1:'+auth.address().port,databasePath:path,port:0,singleBroadcast:binding,suiteMediaResolver:media});
 const rooms=new SqliteHearMeOutRoomMediaRuntime(path),program=new HearMeOutBroadcastProgram(path,binding);
 try{
  ensurePublicLounge(rooms,program);
  await host.listen();
  const base='http://127.0.0.1:'+host.server.address().port;
  const url=base+'/api/watch/broadcast/requests?roomId='+PUBLIC_LOUNGE_ID;
  let viewerCookie='';
  const post=async(body,key)=>{
   const response=await fetch(url,{method:'POST',headers:{'content-type':'application/json','idempotency-key':key,...(viewerCookie?{cookie:viewerCookie}:{})},body:JSON.stringify(body)});
   viewerCookie=response.headers.get('set-cookie')?.split(';',1)[0]??viewerCookie;
   return response;
  };
  const stateOf=async()=>(await(await fetch(base+'/api/watch/broadcast/state?roomId='+PUBLIC_LOUNGE_ID)).json());

  // 1. Music search queues one item; the resolver sees the exact query and lane.
  const first=await post({query:'Thriller',lane:'music',displayName:'Listener'},'e2e-thriller');
  assert.equal(first.status,201,await first.clone().text());
  const firstState=await first.json();
  assert.equal(resolved.length,1);
  assert.equal(resolved[0].query,'Thriller');
  assert.equal(resolved[0].lane,'music');
  assert.match(viewerCookie,/^hmo_viewer=[a-f0-9]{64}$/,'public replay retains its viewer identity');
  assert.equal(scheduledEntries(firstState).at(-1)?.item.title,'Thriller');
  assert.equal(scheduledEntries(firstState).at(-1)?.item.type,'music');

  // 2. The active-or-queued item is visible through the public state endpoint.
  const state=await stateOf();
  assert.ok(scheduledEntries(state).some(entry=>entry.item.title==='Thriller'),'state includes the search result');

  // 3. Replaying the same idempotency key does not resolve or enqueue twice.
  const replay=await post({query:'Thriller',lane:'music',displayName:'Listener'},'e2e-thriller');
  assert.equal(replay.status,201);
  await replay.text();
  assert.equal(resolved.length,1,'idempotent replay must not call the resolver again');
  assert.equal(scheduledEntries(await stateOf()).filter(entry=>entry.item.title==='Thriller').length,1);

  // 4. A movie search uses the movie lane.
  const movie=await post({query:'Blade Runner',lane:'movie',displayName:'Listener'},'e2e-movie');
  assert.equal(movie.status,201,await movie.clone().text());
  assert.equal(resolved.at(-1).lane,'movie');
  assert.equal((await movie.json()).queue.at(-1)?.item.type,'movie');

  // 5. A resolver failure is reported and nothing new is queued.
  const before=(await stateOf()).queue.length;
  const failed=await post({query:'unplayable clip',lane:'movie',displayName:'Listener'},'e2e-fail');
  assert.ok(failed.status>=400&&failed.status<600,'resolver failure must not succeed');
  await failed.text();
  assert.equal((await stateOf()).queue.length,before,'a failed resolve must not add a queue entry');

  // 6. An empty search is rejected before the resolver runs.
  const callsBefore=resolved.length;
  const empty=await post({query:'',lane:'music',displayName:'Listener'},'e2e-empty');
  assert.equal(empty.status,400);
  await empty.text();
  assert.equal(resolved.length,callsBefore);
 }finally{
  await host.close();program.close();rooms.close();
  await new Promise(r=>auth.close(r));
  await rm(dir,{recursive:true,force:true});
 }
});
