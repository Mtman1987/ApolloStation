import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createServer} from 'node:http';
import {chromium} from 'playwright';
import {mediaBinary} from './test-media-binaries.mjs';
import {HearMeOutBroadcastProgram} from '../apps/hearmeout/dist/broadcast-program.js';
import {HearMeOutRoomBroadcast} from '../apps/hearmeout/dist/room-broadcast.js';
import {HearMeOutPreparedMedia} from '../apps/hearmeout/dist/prepared-media.js';
import {handleHearMeOutBroadcastWindow} from '../apps/hearmeout/dist/broadcast-window.js';

const dir=await mkdtemp(join(tmpdir(),'hmo-cached-audio-')),videoId='abcdefghijk';
const program=new HearMeOutBroadcastProgram(join(dir,'program.sqlite'),{tenantId:'tenant',executionUserId:'owner'});
let provider,server,worker,browser;
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
try{
 execFileSync(mediaBinary('ffmpeg'),['-hide_banner','-loglevel','error','-f','lavfi','-i','sine=frequency=440:sample_rate=44100','-t','90','-vn','-c:a','aac','-b:a','160k','-ac','2','-f','hls','-hls_time','6','-hls_list_size','0','-hls_segment_filename',join(dir,'seg_%05d.ts'),join(dir,'index.m3u8')],{timeout:10000});
 provider=createServer(async(req,res)=>{try{assert.equal(req.headers.authorization,'Bearer test-cached-audio-worker');const path=new URL(req.url,'http://fixture').pathname;if(path===`/watch/youtube/browser/${videoId}`){res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({audio:true,video:false,hls:true}));return;}assert.ok(path.startsWith(`/watch/youtube/hls/${videoId}/`));const name=path.split('/').at(-1);assert.match(name,/^(?:index\.m3u8|seg_\d+\.ts)$/);const bytes=await readFile(join(dir,name));res.writeHead(200,{'content-type':name.endsWith('.ts')?'video/mp2t':'application/vnd.apple.mpegurl'});res.end(bytes);}catch(error){res.writeHead(500);res.end(String(error));}});
 await new Promise(resolve=>provider.listen(0,'127.0.0.1',resolve));
 const preparedMedia={origin:'http://127.0.0.1:'+provider.address().port,authorization:'Bearer test-cached-audio-worker',tenantId:'tenant'};
 const resolved=await new HearMeOutPreparedMedia(preparedMedia).upstream(videoId);
 const [bundle,youtube]=await Promise.all(['playback-source-client.js','youtube-browser-client.js'].map(name=>readFile(new URL('../apps/hearmeout/dist/'+name,import.meta.url))));
 server=createServer(async(req,res)=>{const url=new URL(req.url,'http://fixture');if(url.pathname==='/api/hearmeout/youtube-browser.js'){res.writeHead(200,{'content-type':'application/javascript'});res.end(youtube);return;}if(url.pathname==='/api/hearmeout/playback-source.js'){res.writeHead(200,{'content-type':'application/javascript'});res.end(bundle);return;}if(await handleHearMeOutBroadcastWindow(req,res,url,program,worker,undefined))return;res.writeHead(404);res.end();});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+server.address().port;
 await program.request({requesterId:'guest:test',displayName:'Viewer',query:'Cached song',lane:'music',operationId:'cached-song'},{async resolve(){return {itemId:videoId,title:'Cached song',type:'music',source:'fixture',playbackUrl:resolved.audioUrl};}});
 worker=new HearMeOutRoomBroadcast(program,{ffmpegBinary:mediaBinary('ffmpeg'),ffprobeBinary:mediaBinary('ffprobe'),cachePath:join(dir,'broadcast'),spmtOrigin:origin,preparedMedia});await worker.listen();
 browser=await chromium.launch({executablePath:process.env.HMO_TEST_BROWSER_PATH||chromium.executablePath(),headless:true,args:['--no-sandbox','--disable-dev-shm-usage','--autoplay-policy=no-user-gesture-required']});
 const page=await browser.newPage({hasTouch:true});await page.goto(origin+'/watch');await page.getByRole('heading',{name:'Watch parties',exact:true}).waitFor();await page.getByRole('button',{name:'Watch party',exact:true}).click();await page.waitForFunction(()=>{const v=document.querySelector('video');return v&&!v.paused&&v.currentTime>.1;});
 assert.equal(await page.locator('video').evaluate(v=>v.videoWidth),0,'The cached fixture has audio only');
 await page.getByRole('button',{name:'Enable sound',exact:true}).click();await delay(2500);
 await page.evaluate(()=>{const v=document.querySelector('video');window.audioMetrics={waiting:0,seeks:0,rates:[],started:v.currentTime};v.addEventListener('waiting',()=>window.audioMetrics.waiting++);v.addEventListener('seeking',()=>window.audioMetrics.seeks++);v.addEventListener('ratechange',()=>window.audioMetrics.rates.push(v.playbackRate));});
 // Repeated readiness events must not jump back to the moving live position.
 await page.evaluate(()=>{const v=document.querySelector('video');for(let i=0;i<3;i++)v.dispatchEvent(new Event('canplay'));});
 let delayed=0;await page.route('**/*.ts',async route=>{if(!delayed++){await delay(5000);}await route.continue().catch(()=>{});});
 await delay(15000);
 const metrics=await page.evaluate(()=>{const v=document.querySelector('video');return {...window.audioMetrics,time:v.currentTime,rate:v.playbackRate,error:v.error?.message??null,buffer:v.buffered.length?v.buffered.end(v.buffered.length-1)-v.currentTime:0};});
 assert.ok(delayed>0);assert.equal(metrics.error,null);assert.equal(metrics.rate,1);assert.ok(metrics.rates.every(rate=>rate===1));assert.equal(worker.status().startedProcesses,1);assert.equal(metrics.waiting,0,JSON.stringify(metrics));assert.equal(metrics.seeks,0,JSON.stringify(metrics));assert.ok(metrics.time-metrics.started>=14,JSON.stringify(metrics));
 // A restarted encoder replaces the timeline even when the queued request is unchanged.
 await page.evaluate(()=>{window.reloaded=0;document.querySelector('video').addEventListener('loadstart',()=>window.reloaded++);});
 const previousEpoch=(await(await fetch(origin+'/api/watch/broadcast/state')).json()).broadcast.epoch;
 await worker.close();
 worker=new HearMeOutRoomBroadcast(program,{ffmpegBinary:mediaBinary('ffmpeg'),ffprobeBinary:mediaBinary('ffprobe'),cachePath:join(dir,'broadcast'),spmtOrigin:origin,preparedMedia});await worker.listen();
 await page.waitForFunction(()=>window.reloaded>0&&!document.querySelector('video').paused&&document.querySelector('video').currentTime>1);
 const restarted=(await(await fetch(origin+'/api/watch/broadcast/state')).json()).broadcast.epoch;
 assert.ok(restarted);assert.notEqual(restarted,previousEpoch);assert.equal(worker.status().startedProcesses,1);
 console.log('PASS: cached audio crosses the existing prepared-media adapter and one real broadcaster; a five-second segment delay causes no rebuffering, seeks or playback-rate change, and an encoder restart recovers automatically.');
}finally{await browser?.close();await worker?.close();for(const host of [server,provider])if(host){host.closeAllConnections();await new Promise(resolve=>host.close(resolve));}program.close();await rm(dir,{recursive:true,force:true});}
