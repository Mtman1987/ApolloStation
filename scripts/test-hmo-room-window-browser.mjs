import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createServer,request as httpRequest} from 'node:http';
import {attachHearMeOutRtcProxy} from '../apps/spacemountain-web/dist/rtc-upgrade-proxy.js';
import {chromium} from 'playwright';
import {build} from 'esbuild';
import {mediaBinary} from './test-media-binaries.mjs';
import {createHearMeOutWebServer} from '../apps/hearmeout/dist/web-server-v3.js';
import {HearMeOutBroadcastProgram} from '../apps/hearmeout/dist/broadcast-program.js';
import {SqliteHearMeOutRoomMediaRuntime} from '../apps/hearmeout/dist/room-media-core.js';

const directory=await mkdtemp(join(tmpdir(),'hmo-window-browser-')),path=join(directory,'rooms.sqlite');
const owner={tenantId:'tenant',userId:'owner',displayName:'Owner',roles:['admin']};
const program=new HearMeOutBroadcastProgram(path,{tenantId:'tenant',executionUserId:'owner'}),rooms=new SqliteHearMeOutRoomMediaRuntime(path);
let host,spmt,shell,browser;let requestPosts=0;const requests=[],errors=[],requestKeys=[];
try{
 const videoFile=join(directory,'video.mp4');
 execFileSync(mediaBinary('ffmpeg'),['-hide_banner','-loglevel','error','-f','lavfi','-i','color=c=blue:s=160x90:r=25','-f','lavfi','-i','sine=frequency=440:sample_rate=44100','-t','180','-c:v','libx264','-preset','ultrafast','-g','50','-c:a','aac','-b:a','32k','-ac','1','-movflags','+faststart',videoFile],{timeout:30000});
 const fixture=await readFile(videoFile),mediaPath='/v1/media/public/'+'b'.repeat(43);
 spmt=createServer((req,res)=>{
  if(req.url===mediaPath){const range=/bytes=(\d+)-(\d*)/.exec(req.headers.range??''),start=Number(range?.[1]??0),end=range?.[2]?Number(range[2]):fixture.length-1;res.writeHead(range?206:200,{'content-type':'video/mp4','accept-ranges':'bytes','content-length':end-start+1,...(range?{'content-range':`bytes ${start}-${end}/${fixture.length}`}:{})});res.end(fixture.subarray(start,end+1));return;}
  res.setHeader('content-type','application/json');if(req.url==='/v1/session')res.end(JSON.stringify({actorId:'owner',displayName:'Owner',tenantIds:['tenant'],scopes:['admin']}));else{res.statusCode=404;res.end('{}');}
 });await new Promise(r=>spmt.listen(0,'127.0.0.1',r));const spmtOrigin='http://127.0.0.1:'+spmt.address().port;
 host=createHearMeOutWebServer({spmtOrigin,databasePath:path,port:0,singleBroadcast:{tenantId:'tenant',executionUserId:'owner'},broadcast:{ffmpegBinary:mediaBinary('ffmpeg'),ffprobeBinary:mediaBinary('ffprobe'),cachePath:join(directory,'broadcast')},suiteMediaResolver:{async resolve(input){requests.push(input);if(requests.length===1)throw Error('The fixture media worker is temporarily unavailable');return {itemId:'requested-video',title:input.query,type:input.lane,source:'fixture',playbackUrl:'https://media.example'+mediaPath,durationSeconds:180};}}});
 await host.listen();const origin='http://127.0.0.1:'+host.server.address().port;
 // The real AppFrame host sends launch snapshots on shell clock/usage updates.
 // Match the shell's remembered-page response to the app's surface manifest.
 const compiled=await build({stdin:{contents:`import {createAppFrameHost} from './packages/embed/src/index.ts';window.createAppFrameHost=createAppFrameHost;`,resolveDir:process.cwd()},bundle:true,write:false,format:'iife',platform:'browser'});
 shell=createServer((req,res)=>{if(req.url!=='/test-shell'){const upstream=httpRequest(origin+req.url,{method:req.method,headers:req.headers},response=>{res.writeHead(response.statusCode,response.headers);response.pipe(res)});upstream.on('error',()=>{res.writeHead(502);res.end()});req.pipe(upstream);return;}res.setHeader('content-type','text/html');res.end(`<!doctype html><style>html,body,iframe{margin:0;width:100%;height:100%;border:0}</style><iframe data-shell-app-frame src="/apps/hearmeout" allow="autoplay; microphone"></iframe><script>${compiled.outputFiles[0].text}</script><script>
 const frame=document.querySelector('iframe'),origin=location.origin;let page='home';
 window.addEventListener('message',e=>{if(e.origin!==origin||e.source!==frame.contentWindow)return;const m=e.data;if(m.protocol!=='spmt.surface')return;if(m.type==='page.changed')page=m.pageId;if(m.type==='surface.manifest')frame.contentWindow.postMessage({protocol:'spmt.surface',version:1,type:'page.open',appId:'hearmeout',pageId:page},origin)});
 const host=createAppFrameHost({frame,allowedOrigin:origin,launch:{schemaVersion:1,appId:'hearmeout',tenantId:'tenant',surfaceMode:'shell',launchId:'window-test',requestedScopes:[]},getState:()=>({authenticated:true,userId:'owner',tenantId:'tenant',grants:[],runtimeState:'ready',layout:{schemaVersion:1,availableWidth:390,availableHeight:844,headerHeight:0,safeTop:0,safeRight:0,safeBottom:0,safeLeft:0,measuredAt:new Date().toISOString()}})});host.start();setInterval(()=>host.sync(),1000);
 </script>`);});attachHearMeOutRtcProxy(shell,origin);await new Promise(r=>shell.listen(0,'127.0.0.1',r));
 browser=await chromium.launch({executablePath:process.env.HMO_TEST_BROWSER_PATH||chromium.executablePath(),headless:true,args:['--no-sandbox','--disable-dev-shm-usage','--autoplay-policy=no-user-gesture-required']});
 const segments=[];const page=await browser.newPage({viewport:{width:390,height:844}});page.on('request',r=>{const path=new URL(r.url()).pathname;if(r.method()==='POST'&&path==='/api/watch/broadcast/requests'){requestPosts++;requestKeys.push(r.headers()['idempotency-key']);}const match=path.match(/_video_(\d+)\.ts$/);if(match)segments.push(Number(match[1]));});page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
 await page.goto('http://127.0.0.1:'+shell.address().port+'/test-shell');
 const app=page.frameLocator('[data-shell-app-frame]');
 await app.getByRole('button',{name:'Browse Rooms',exact:true}).waitFor();
 assert.equal(await app.locator('a[href="/watch"]').count(),0);
 assert.equal(await app.locator('video,audio,[data-hmo-broadcast-frame]').count(),0);
 async function createRoom(name){await app.getByRole('button',{name:'Create Room',exact:true}).click();await app.locator('[name=name]').fill(name);await app.getByRole('button',{name:'Create & join',exact:true}).click();await app.getByRole('button',{name:'Music and movie window',exact:true}).waitFor();}
 await createRoom('First room');
 assert.equal(await app.locator('video,audio,[data-hmo-broadcast-frame]').count(),0);
 assert.equal(program.getSession().current,null);assert.equal(requests.length,0);
 await app.getByRole('button',{name:'Music and movie window',exact:true}).click();
 let window=app.frameLocator('[data-hmo-broadcast-frame]');
 await window.getByText('Nothing playing',{exact:true}).waitFor();
 assert.equal(await window.locator('video').evaluate(v=>v.currentSrc), '');
 await window.getByRole('button',{name:'Enable sound',exact:true}).click();
 await new Promise(r=>setTimeout(r,1800));
 assert.equal(await window.locator('#error').textContent(),'','Idle polling must not interrupt a pending play request');
 await window.getByRole('textbox',{name:'Music or movie request'}).fill('My requested movie');
 await window.getByRole('button',{name:'Request',exact:true}).click();
 await window.getByRole('alert').filter({hasText:'The fixture media worker is temporarily unavailable'}).waitFor();
 await window.locator('#request-form').evaluate(form=>{form.requestSubmit();form.requestSubmit();});
 await window.getByRole('heading',{name:'My requested movie',exact:true}).waitFor();
 assert.equal(requestPosts,2,'Retry sends once even with rapid repeated submissions');assert.notEqual(requestKeys[0],requestKeys[1],'A known failed request must be retried with a fresh operation key');
 async function playing(){await window.locator('video').evaluate(v=>new Promise((resolve,reject)=>{const limit=Date.now()+25000;const timer=setInterval(()=>{if(!v.paused&&v.currentTime>.1&&v.videoWidth>0){clearInterval(timer);resolve();}else if(Date.now()>limit){clearInterval(timer);reject(Error('Video not playing: '+v.readyState+' '+v.error?.message));}},100)}));}
 await playing();assert.equal(await window.locator('video').isVisible(),true);assert.equal(requests.length,2);assert.equal(requests[1].query,'My requested movie');assert.equal(requests[0].lane,'movie');
 assert.equal(await window.locator('#error').textContent(),'');
 assert.equal(await app.locator('video,audio').count(),0,'No legacy music or video player exists behind the iframe');
 assert.equal(await app.locator('[data-hmo-broadcast-frame]').count(),1);
 const original=program.getSession(),starts=(await(await fetch(origin+'/health/ready')).json()).broadcast.startedProcesses;
 const initialSequence=Number((await(await fetch(origin+'/api/watch/broadcast/stream_video.m3u8')).text()).match(/#EXT-X-MEDIA-SEQUENCE:(\d+)/)[1]);
 // Pass both reported disconnect boundaries with real heartbeat, real shell
 // snapshots, and real encoder time (not a mocked timer or transport).
 await new Promise(r=>setTimeout(r,100000));
 assert.equal(await app.locator('.hmo-console').isVisible(),true,'Shell updates must not eject the viewing room');
 assert.equal(await app.locator('[data-hmo-broadcast-frame]').count(),1);
 await playing();assert.equal(rooms.listMembers('tenant',rooms.listRooms(owner)[0].roomId).length,1);
 assert.equal((await(await fetch(origin+'/health/ready')).json()).broadcast.startedProcesses,starts);
 await app.getByRole('button',{name:'Close music and movie window',exact:true}).click();
 assert.equal(await app.locator('video,audio,[data-hmo-broadcast-frame]').count(),0);
 await app.getByRole('button',{name:'More',exact:true}).click();await app.getByRole('button',{name:'Delete room',exact:true}).click();
 await app.locator('.hmo-console').waitFor({state:'detached'});assert.equal(rooms.listRooms(owner).length,0);assert.equal(program.getSession().current.requestId,original.current.requestId);
 // Navigate through the actual shell's Home action, then make a fresh room.
 await page.evaluate(()=>{const f=document.querySelector('iframe');f.contentWindow.postMessage({protocol:'spmt.surface',version:1,type:'page.open',appId:'hearmeout',pageId:'home'},new URL(f.src).origin)});
 segments.length=0;await createRoom('Second room');assert.equal(await app.locator('video,audio,[data-hmo-broadcast-frame]').count(),0);
 await app.getByRole('button',{name:'Music and movie window',exact:true}).click();window=app.frameLocator('[data-hmo-broadcast-frame]');await playing();
 assert.equal(program.getSession().current.requestId,original.current.requestId);assert.equal((await(await fetch(origin+'/health/ready')).json()).broadcast.startedProcesses,starts);
 const liveSequence=Number((await(await fetch(origin+'/api/watch/broadcast/stream_video.m3u8')).text()).match(/#EXT-X-MEDIA-SEQUENCE:(\d+)/)[1]);
 assert.ok(liveSequence>initialSequence+40,'The broadcast advanced while the viewer stayed/left');assert.ok(segments.some(sequence=>sequence>=liveSequence),'The returned window reads current video segments rather than replaying old ones');
 // Going back to Browse Rooms must also remove the actual local media element.
 await page.evaluate(()=>{const f=document.querySelector('iframe');f.contentWindow.postMessage({protocol:'spmt.surface',version:1,type:'page.open',appId:'hearmeout',pageId:'rooms'},new URL(f.src).origin)});
 await app.locator('.hmo-console').waitFor({state:'detached'});assert.equal(await app.locator('video,audio,[data-hmo-broadcast-frame]').count(),0);
 assert.deepEqual(errors,[]);console.log('PASS: mobile HMO room starts silent, clapper opens one blank request window, a typed request plays real video, 100 seconds of shell updates retain the room, closing/deleting is silent, and a new room sees the advancing video only after opening its clapper.');
}finally{await browser?.close();if(shell)await new Promise(r=>shell.close(r));await host?.close();if(spmt)await new Promise(r=>spmt.close(r));rooms.close();program.close();await rm(directory,{recursive:true,force:true});}
