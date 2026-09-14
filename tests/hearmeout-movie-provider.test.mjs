import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {HearMeOutMovieProvider,hearMeOutMovieProviderUrl} from '../apps/hearmeout/dist/movie-provider.js';
import {createSpmtService} from '../apps/spmt-service/dist/index.js';
import {SpmtClient} from '../packages/sdk/dist/index.js';
import {HearMeOutExecutionWorker} from '../apps/hearmeout/dist/execution-worker.js';
import {HearMeOutWorkerMusicCatalog} from '../apps/hearmeout/dist/worker-music-catalog.js';
import {HearMeOutWorkerMediaCache} from '../apps/hearmeout/dist/worker-media-cache.js';
import {hearMeOutCatalogRegistration} from '../apps/hearmeout/dist/index.js';
import {createHearMeOutWebServer} from '../apps/hearmeout/dist/web-server-v3.js';

const providerOrigin='https://hearmeout-main.fly.dev';
const matches=[{id:'xtream-vod-1',title:'First matching movie',year:2001,overview:'First'},{id:'xtream-vod-42',title:'Chosen matching movie',year:2002,overview:'Second',quality:'1080p'}, {id:'youtube-trailer',title:'Unrelated fallback',playbackUrl:'https://private.example/secret'}];

test('IPTV searches and selected preparation use existing provider routes, without starting the first match',async()=>{
 const calls=[];
 const provider=new HearMeOutMovieProvider(providerOrigin,async(url,init)=>{calls.push(new URL(url).pathname);assert.equal(init.method,'GET');assert.equal(init.redirect,'manual');return new Response(new URL(url).pathname==='/api/watch/search'?JSON.stringify({results:matches}):'#EXTM3U\npart001.ts');});
 assert.deepEqual((await provider.search('A movie')).map(x=>x.itemId),['xtream-vod-1','xtream-vod-42']);
 assert.deepEqual(calls,['/api/watch/search']);
 const selected=await provider.resolve('A movie','xtream-vod-42');assert.equal(selected.title,'Chosen matching movie');assert.equal(selected.playbackUrl,providerOrigin+'/api/watch/xtream/hls/vod-42/index.m3u8');
 await assert.rejects(()=>provider.resolve('A movie','xtream-vod-999'),/no longer in the search results/);
 assert.equal(calls.filter(x=>x.includes('/hls/')).length,1);
 for(const url of [providerOrigin+'/api/watch/search?q=test',providerOrigin+'/api/watch/xtream/hls/vod-42/stream_video.m3u8?machine=abc123'])assert.ok(hearMeOutMovieProviderUrl(url));
 for(const path of ['/api/watch/search?q=test&token=secret','/api/watch/xtream/hls/vod-42/index.m3u8?source=https://other.example','/api/watch/sessions/create','/api/watch/xtream/hls/vod-42/../private.ts'])assert.equal(hearMeOutMovieProviderUrl(providerOrigin+path),undefined);
 const failed=new HearMeOutMovieProvider(providerOrigin,async()=>new Response('private provider credential',{status:403}));
 await assert.rejects(()=>failed.search('A movie'),error=>error.message==='The IPTV movie search returned HTTP 403');
});

test('guest movie search and explicit selection cross real SPMT jobs without creating a room or playing on search',{timeout:20000},async()=>{
 const dir=await mkdtemp(join(tmpdir(),'hmo-movie-jobs-')),credential='movie-broadcast-test-credential-123456789';
 const spmt=createSpmtService({runtimeMode:'sandbox',databasePath:join(dir,'spmt.sqlite'),webhookKey:Buffer.alloc(32,7),port:0,hearMeOutRuntimeEnabled:true,hearMeOutWorkerCredential:credential});
 const stop=new AbortController();let host,workerTask;const prepared=[];
 try{
  spmt.authority.ensureUser('owner');spmt.control.registerTenant({tenantId:'tenant',ownerUserId:'owner',displayName:'Test'});
  spmt.control.registerApp(hearMeOutCatalogRegistration('https://apollo.example/apps/hearmeout'));spmt.control.installApp('tenant','hearmeout');
  await spmt.listen();const spmtOrigin='http://127.0.0.1:'+spmt.server.address().port;
  const client=new SpmtClient({baseUrl:spmtOrigin,appId:'hearmeout',getAccessToken:()=>spmt.auth.issueServiceAccess('hearmeout',credential).accessToken});
  const provider=new HearMeOutMovieProvider(providerOrigin,async url=>{const path=new URL(url).pathname;if(path==='/api/watch/search')return Response.json({results:matches});prepared.push(path);return new Response('#EXTM3U\npart001.ts');});
  const worker=new HearMeOutExecutionWorker(client,{workerId:'movie-test',executionTarget:'sprite',tenantIds:['tenant'],capabilities:['hearmeout.movie.search','hearmeout.movie.resolve'],catalog:new HearMeOutWorkerMusicCatalog({catalogFile:join(dir,'catalog.json')}),cache:new HearMeOutWorkerMediaCache({cacheDir:join(dir,'cache')}),movieProvider:provider});
  await worker.report(new Date().toISOString());workerTask=worker.run(stop.signal,10);
  host=createHearMeOutWebServer({spmtOrigin,databasePath:join(dir,'rooms.sqlite'),port:0,credential,operationMode:'read-only',singleBroadcast:{tenantId:'tenant',executionUserId:'owner'}});await host.listen();
  const base='http://127.0.0.1:'+host.server.address().port;
  const search=await fetch(base+'/api/watch/broadcast/movies?q=A%20movie');assert.equal(search.status,200,await search.clone().text());const cookie=search.headers.get('set-cookie').split(';')[0];assert.equal((await search.json()).items.length,2);
  assert.equal((await(await fetch(base+'/api/watch/broadcast/state')).json()).current,null);assert.deepEqual(prepared,[]);
  const request=(selectedItemId,key='chosen')=>fetch(base+'/api/watch/broadcast/requests',{method:'POST',headers:{cookie,origin:base,'content-type':'application/json','idempotency-key':key},body:JSON.stringify({query:'A movie',lane:'movie',...(selectedItemId?{selectedItemId}:{})})});
  const noChoice=await request(undefined,'no-choice');assert.equal(noChoice.status,400);assert.match((await noChoice.json()).error,/choose a movie/);assert.deepEqual(prepared,[]);
  const response=await request('xtream-vod-42');assert.equal(response.status,201,await response.clone().text());const state=await response.json();assert.equal(state.current.item.itemId,'xtream-vod-42');assert.equal(state.current.item.title,'Chosen matching movie');assert.equal(state.queue.length,0);
  assert.equal((await request('xtream-vod-42')).status,201);assert.equal((await request('xtream-vod-1')).status,400);assert.deepEqual(prepared,['/api/watch/xtream/hls/vod-42/index.m3u8']);
  const jobs=await client.listExecutionJobs('tenant',{executionOwner:'hearmeout'});assert.equal(jobs.length,2);assert.ok(jobs.every(job=>job.billedUserId==='owner'&&job.state==='succeeded'));assert.deepEqual(new Set(jobs.map(job=>job.capabilityId)),new Set(['hearmeout.movie.search','hearmeout.movie.resolve']));
 }finally{stop.abort();await workerTask;await host?.close();await spmt.close();await rm(dir,{recursive:true,force:true});}
});
