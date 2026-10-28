import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp,rm,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname,join,resolve} from 'node:path';
import {createServer} from 'node:http';
import {SqliteHearMeOutRoomMediaRuntime} from '../apps/hearmeout/dist/room-media-core.js';
import {createHearMeOutWebServer} from '../apps/hearmeout/dist/web-server-v3.js';
import {createHearMeOutWatchRuntime,createHearMeOutWatchRuntimeFromEnvironment,watchStatePathFor,HEARMEOUT_WATCH_STATE_FILE} from '../apps/hearmeout/dist/watch-runtime.js';
import {HEARMEOUT_DONOR_DEFAULT_ORIGIN} from '../apps/hearmeout/dist/donor-origin.js';

// HMO-009 P08: route-level coverage through the real HTTP handler. The SPMT session
// service is mocked by cookie; the Xtream lookup and donor fetch are injected fakes,
// so no provider credential or network call is involved.

const TENANT='crew';
const donorOrigin=HEARMEOUT_DONOR_DEFAULT_ORIGIN;
const donorHost=new URL(donorOrigin).host;
const episode={
 id:'xtream-episode-7-abc',
 type:'movie',
 title:'Show S01E02',
 metadata:{kind:'series-episode',seriesId:'9',seriesTitle:'Show',seasonNumber:1,episodeNumber:2},
 playbackUrl:'/activity-provider/xtream/episode/7-abc',
};

function sessionServer(){
 const users={alice:{actorId:'user-alice',displayName:'Alice'},bob:{actorId:'user-bob',displayName:'Bob'}};
 return createServer((req,res)=>{
  const match=/sid=(alice|bob)/.exec(String(req.headers.cookie??''));
  if(req.url!=='/v1/session'||!match){res.writeHead(401,{'content-type':'application/json'});res.end('{}');return;}
  const user=users[match[1]];
  res.writeHead(200,{'content-type':'application/json'});
  res.end(JSON.stringify({actorId:user.actorId,displayName:user.displayName,tenantIds:[TENANT],scopes:[]}));
 });
}

async function fixture(){
 const dir=await mkdtemp(join(tmpdir(),'hmo-watch-routes-'));
 const path=join(dir,'rooms.sqlite');
 const auth=sessionServer();
 await new Promise(r=>auth.listen(0,'127.0.0.1',r));
 const donorFetches=[];
 const watch=createHearMeOutWatchRuntime({
  statePath:join(dir,'watch-state.sqlite'),
  donorOrigin,
  fetchImpl:async(url)=>{donorFetches.push(String(url));return new Response('#EXTM3U\n#EXTINF:6,\nseg.ts\n',{status:200,headers:{'content-type':'application/vnd.apple.mpegurl'}});},
  findSeriesEpisode:async query=>/show/i.test(query)?episode:null,
  getNextSeriesEpisode:async()=>null,
 });
 const host=createHearMeOutWebServer({spmtOrigin:'http://127.0.0.1:'+auth.address().port,databasePath:path,port:0,watch});
 const rooms=new SqliteHearMeOutRoomMediaRuntime(path);
 await host.listen();
 const base='http://127.0.0.1:'+host.server.address().port;
 return {dir,auth,host,rooms,base,donorFetches};
}

async function teardown(f){
 await f.host.close();
 f.rooms.close();
 await new Promise(r=>f.auth.close(r));
 await rm(f.dir,{recursive:true,force:true});
}

test('watch request and accept routes refuse callers without a session or room membership',async()=>{
 const f=await fixture();
 try{
  const alice={'content-type':'application/json',cookie:'sid=alice'};
  const bob={'content-type':'application/json',cookie:'sid=bob'};
  const created=await fetch(f.base+'/api/hearmeout/rooms',{method:'POST',headers:alice,body:JSON.stringify({name:'Watch Night',privacy:'public'})});
  assert.equal(created.status,201,await created.clone().text());
  const roomId=(await created.json()).roomId;
  const joined=await fetch(f.base+`/api/hearmeout/rooms/${roomId}/join`,{method:'POST',headers:alice,body:'{}'});
  await joined.text();
  assert.equal(joined.status,200);

  const post=(path,headers,body)=>fetch(f.base+`/api/hearmeout/rooms/${roomId}/watch/${path}`,{method:'POST',headers,body:JSON.stringify(body)});

  // No session: refused, nothing queued, nothing looked up.
  const anon=await post('request',{'content-type':'application/json'},{query:'Show'});
  assert.ok(anon.status>=400&&anon.status<500,'anonymous watch request must be refused, got '+anon.status);
  await anon.text();

  // Signed in but not a member of the room: refused, nothing queued.
  const outsider=await post('request',bob,{query:'Show'});
  assert.notEqual(outsider.status,201);
  await outsider.text();
  assert.equal(f.rooms.getSession(TENANT,roomId,'movie').queue.length,0,'non-member must not queue anything');
  assert.equal(f.donorFetches.length,0,'refused caller must not reach the donor');
 }finally{
  await teardown(f);
 }
});

test('a member watch request queues the episode on the Apollo HLS route, never the donor URL',async()=>{
 const f=await fixture();
 try{
  const alice={'content-type':'application/json',cookie:'sid=alice'};
  const created=await fetch(f.base+'/api/hearmeout/rooms',{method:'POST',headers:alice,body:JSON.stringify({name:'Episode Night',privacy:'public'})});
  const roomId=(await created.json()).roomId;
  await (await fetch(f.base+`/api/hearmeout/rooms/${roomId}/join`,{method:'POST',headers:alice,body:'{}'})).text();

  // Unmatched title: 404 no-match, nothing queued.
  const miss=await fetch(f.base+`/api/hearmeout/rooms/${roomId}/watch/request`,{method:'POST',headers:alice,body:JSON.stringify({query:'Nothing like this'})});
  assert.equal(miss.status,404);
  assert.deepEqual(await miss.json(),{status:'no-match'});
  assert.equal(f.rooms.getSession(TENANT,roomId,'movie').queue.length,0);

  // Matched episode: 201 queued, playback is the Apollo HLS route.
  const hit=await fetch(f.base+`/api/hearmeout/rooms/${roomId}/watch/request`,{method:'POST',headers:alice,body:JSON.stringify({query:'Show S01E02'})});
  const text=await hit.text();
  assert.equal(hit.status,201,text);
  const body=JSON.parse(text);
  assert.equal(body.status,'queued');
  const queued=body.session.queue.at(-1);
  assert.equal(queued.item.itemId,'xtream-episode-7-abc');
  assert.equal(queued.item.playbackUrl,'/api/watch/xtream/hls/episode-7-abc/index.m3u8');
  assert.doesNotMatch(text,new RegExp(donorHost.replace(/\./g,'\\.')),'donor host must not appear in the client response');
  assert.doesNotMatch(text,/https?:\/\//,'queued playback must be a relative Apollo path');

  // The server validated the donor manifest once, server side.
  assert.ok(f.donorFetches.length>=1);
  assert.match(f.donorFetches[0],/\/api\/watch\/xtream\/hls\/episode-7-abc\/index\.m3u8$/);
  assert.ok(f.donorFetches[0].startsWith(donorOrigin+'/'));

  // Accepting with no pending recommendation returns none, never a playable item.
  const none=await fetch(f.base+`/api/hearmeout/rooms/${roomId}/watch/accept`,{method:'POST',headers:alice,body:JSON.stringify({sessionId:'session-1'})});
  assert.equal(none.status,404);
  assert.deepEqual(await none.json(),{status:'none'});
  assert.equal(f.rooms.getSession(TENANT,roomId,'movie').queue.length,1,'accept must not queue anything');
 }finally{
  await teardown(f);
 }
});

test('watch state path defaults beside the room database and honours HEARMEOUT_WATCH_STATE_PATH',async()=>{
 assert.equal(watchStatePathFor({},'/data/rooms.sqlite'),join('/data',HEARMEOUT_WATCH_STATE_FILE));
 assert.equal(watchStatePathFor({HEARMEOUT_WATCH_STATE_PATH:'   '},'/data/rooms.sqlite'),join('/data',HEARMEOUT_WATCH_STATE_FILE));
 assert.equal(watchStatePathFor({HEARMEOUT_WATCH_STATE_PATH:'  /srv/watch.sqlite '},'/data/rooms.sqlite'),resolve('/srv/watch.sqlite'));

 const dir=await mkdtemp(join(tmpdir(),'hmo-watch-path-'));
 try{
  const roomDb=join(dir,'rooms.sqlite');
  const defaultRuntime=createHearMeOutWatchRuntimeFromEnvironment({},roomDb);
  defaultRuntime.close();
  assert.ok((await stat(join(dirname(roomDb),HEARMEOUT_WATCH_STATE_FILE))).isFile(),'default state file sits beside the room database');

  const overridePath=join(dir,'custom-watch.sqlite');
  const overrideRuntime=createHearMeOutWatchRuntimeFromEnvironment({HEARMEOUT_WATCH_STATE_PATH:overridePath},roomDb);
  overrideRuntime.close();
  assert.ok((await stat(overridePath)).isFile(),'override path is used');
 }finally{
  await rm(dir,{recursive:true,force:true});
 }
});
