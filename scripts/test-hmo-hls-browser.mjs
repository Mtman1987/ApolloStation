import {mediaBinary} from './test-media-binaries.mjs';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createServer} from 'node:http';
import {chromium} from 'playwright';
import {SqliteHearMeOutRoomMediaRuntime} from '../apps/hearmeout/dist/room-media-core.js';
import {HearMeOutBroadcastProgram} from '../apps/hearmeout/dist/broadcast-program.js';
import {handleHearMeOutBroadcastWindow} from '../apps/hearmeout/dist/broadcast-window.js';
import {handleHearMeOutActivityRequest} from '../apps/hearmeout/dist/activity-web.js';
import {createIntegratedSpaceMountainWebHost} from '../apps/spacemountain-web/dist/integrated-server.js';
import {HearMeOutRoomBroadcast} from '../apps/hearmeout/dist/room-broadcast.js';
const dir=await mkdtemp(join(tmpdir(),'hmo-hls-browser-')),rooms=new SqliteHearMeOutRoomMediaRuntime(':memory:');
const principal={tenantId:'hls',userId:'owner',displayName:'Owner',roles:['admin']},binding={tenantId:'hls',clientId:'234567890123456789'};
const program=new HearMeOutBroadcastProgram(join(dir,'program.sqlite'),{tenantId:'hls',executionUserId:'owner'});
let browser,server,worker,timer,ingress;
try{
 const file=join(dir,'film.mp4');execFileSync(mediaBinary('ffmpeg'),['-hide_banner','-loglevel','error','-f','lavfi','-i','color=c=blue:s=96x64:r=25','-f','lavfi','-i','sine=frequency=440:sample_rate=44100','-f','lavfi','-i','sine=frequency=660:sample_rate=44100','-t','90','-map','0:v','-map','1:a','-map','2:a','-c:v','libx264','-preset','ultrafast','-g','50','-c:a','aac','-b:a','32k','-ac','1','-metadata:s:a:0','language=eng','-metadata:s:a:1','language=hin','-movflags','+faststart',file],{timeout:30000});const fixture=await readFile(file);
 rooms.createRoom(principal,{roomId:'view-room',name:'Viewing room',privacy:'public',operationId:'create'});
 const roomId='view-room',view=()=>({room:rooms.getRoom('hls',roomId),member:true,viewer:{userId:'owner',canManage:true},music:program.getSession(),movie:{...program.getSession(),broadcast:{configured:true,playbackUrl:'/api/watch/broadcast/index.m3u8'}}});
 const [bundle,source]=await Promise.all(['media-client.js','playback-source-client.js'].map(file=>readFile(new URL('../apps/hearmeout/dist/'+file,import.meta.url))));
 server=createServer(async(req,res)=>{try{const url=new URL(req.url,'http://local');
  if(url.pathname==='/v1/media/public/'+'a'.repeat(43)){const range=/bytes=(\d+)-(\d*)/.exec(req.headers.range??''),start=Number(range?.[1]??0),end=range?.[2]?Number(range[2]):fixture.length-1;res.writeHead(range?206:200,{'content-type':'video/mp4','accept-ranges':'bytes','content-length':end-start+1,...(range?{'content-range':`bytes ${start}-${end}/${fixture.length}`}:{})});res.end(fixture.subarray(start,end+1));return;}
  const feed=url.pathname.match(/^\/(?:api\/hearmeout\/rooms\/discord-activity\/broadcast\/movie|api\/watch\/sessions\/discord-watch-room\/broadcast)\/([^/]+)$/);if(feed){await worker.serve('hls',roomId,'movie',feed[1],res);return;}
  if(await handleHearMeOutBroadcastWindow(req,res,url,program,worker,undefined,binding.clientId))return;
  if(url.pathname==='/api/hearmeout/playback-source.js'||url.pathname==='/api/hearmeout/media-client.js'){res.setHeader('content-type','application/javascript');res.end(url.pathname==='/api/hearmeout/media-client.js'?bundle:source);return;}
  if(url.pathname==='/api/hearmeout/rooms/'+roomId){res.setHeader('content-type','application/json');res.end(JSON.stringify(view()));return;}
  res.setHeader('content-type','text/html');res.end(`<main id="player"></main><script src="/api/hearmeout/media-client.js"></script><script>HearMeOutMedia.mount(document.querySelector('#player'),${JSON.stringify(view())},'movie')</script>`);
 }catch(e){res.writeHead(500);res.end(String(e));}});await new Promise(r=>server.listen(0,'127.0.0.1',r));const appOrigin='http://127.0.0.1:'+server.address().port;
 await program.request({requesterId:'guest:test',displayName:'Viewer',query:'Film',operationId:'request'},{async resolve(){return {itemId:'hls-film',title:'Multilingual film',type:'movie',source:'fixture',playbackUrl:'https://media.example/v1/media/public/'+'a'.repeat(43),durationSeconds:90};}});
 worker=new HearMeOutRoomBroadcast(program,{ffmpegBinary:mediaBinary('ffmpeg'),ffprobeBinary:mediaBinary('ffprobe'),cachePath:join(dir,'broadcast'),spmtOrigin:appOrigin});await worker.listen();timer=setInterval(()=>program.advance(),500);
 ingress=createIntegratedSpaceMountainWebHost({spmtOrigin:appOrigin,greenAppOrigins:{hearmeout:appOrigin},port:0,host:'127.0.0.1'});await ingress.listen();const origin='http://127.0.0.1:'+ingress.server.address().port;
 browser=await chromium.launch({executablePath:process.env.HMO_TEST_BROWSER_PATH||chromium.executablePath(),headless:true,args:['--no-sandbox','--disable-dev-shm-usage','--autoplay-policy=no-user-gesture-required']});
 const errors=[],pages=[];async function open(path){const page=await browser.newPage(),network=[],messages=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>messages.push(m.text()));page.on('response',r=>{if(r.status()>=400)network.push({path:new URL(r.url()).pathname,status:r.status()})});page.on('requestfailed',r=>network.push({path:new URL(r.url()).pathname,error:r.failure()?.errorText}));await page.goto(origin+path);try{await page.waitForFunction(()=>{const v=document.querySelector('video');return v&&!v.paused&&v.currentTime>.1;});}catch(e){console.error(JSON.stringify({path,worker:worker.status(),errors,network:network.slice(-20),messages:messages.slice(-20),media:await page.evaluate(()=>{const v=document.querySelector('video');return {status:document.body.innerText,readyState:v?.readyState,networkState:v?.networkState,paused:v?.paused,time:v?.currentTime,error:v?.error?.message,nativeHls:v?.canPlayType('application/vnd.apple.mpegurl'),mse:Boolean(window.MediaSource),source:v?.currentSrc}})},null,2));throw e;}return page;}
 pages.push(await open('/apps/hearmeout'));pages.push(await open('/activity?sessionId=discord-watch-room'));
 await pages[1].getByRole('button',{name:'Enable sound',exact:true}).click();
 for(const page of pages){assert.equal(await page.evaluate(()=>document.querySelector('video').playbackRate),1);const select=page.getByRole('combobox',{name:'Audio language'});await select.waitFor({state:'visible'});assert.equal(await select.locator('option').count(),2);await select.selectOption('1');assert.equal(await select.inputValue(),'1');await page.waitForFunction(()=>{const v=document.querySelector('video');return !v.paused&&!v.error;});}
 const revision=program.getSession().revision;
 await pages[0].getByRole('slider',{name:'movie volume on this device'}).evaluate(el => { el.value = '37'; el.dispatchEvent(new Event('input', { bubbles: true })); });await pages[1].getByRole('slider',{name:'Volume on this device',exact:true}).evaluate(el => { el.value = '61'; el.dispatchEvent(new Event('input', { bubbles: true })); });
 assert.equal(await pages[0].evaluate(()=>document.querySelector('video').volume),.37);assert.equal(await pages[1].evaluate(()=>document.querySelector('video').volume),.61);
 for(let i=0;i<pages.length;i++){const page=pages[i],other=pages[1-i],otherVolume=await other.evaluate(()=>document.querySelector('video').volume),position=await page.evaluate(()=>document.querySelector('video').currentTime);await page.getByRole('button',{name:'Mute locally',exact:true}).click();await page.waitForFunction(t=>{const v=document.querySelector('video');return v.volume===0&&!v.muted&&!v.paused&&v.currentTime>t+.2;},position);assert.equal(await other.evaluate(()=>document.querySelector('video').volume),otherVolume);await page.getByRole('button',{name:i?'Enable sound':'Restore sound',exact:true}).click();}
 assert.equal(program.getSession().revision,revision);
 const position=await pages[0].evaluate(()=>document.querySelector('video').currentTime),starts=worker.status().startedProcesses;
 await Promise.all(pages.map(page=>page.close()));rooms.deleteRoom(principal,roomId,'delete-view-room');assert.equal(rooms.listRooms(principal).length,0);await new Promise(r=>setTimeout(r,5000));assert.equal(worker.status().active,1);assert.equal(worker.status().startedProcesses,starts);
 const returned=await open('/activity?sessionId=discord-watch-room');await returned.waitForFunction(previous=>document.querySelector('video').currentTime>previous+2,position);assert.equal(worker.status().startedProcesses,starts);
 assert.deepEqual(errors,[]);console.log('PASS: one independent encoder supplies native and Discord windows with two audio languages. Local volume/zero-volume silence never changes the room or pauses playback. The broadcast continues without windows or rooms and a returning viewer joins its current broadcast.');
}finally{if(timer)clearInterval(timer);await browser?.close();await ingress?.close();await worker?.close();if(server){server.closeAllConnections();await new Promise(r=>server.close(r));}program.close();rooms.close();await rm(dir,{recursive:true,force:true});}
