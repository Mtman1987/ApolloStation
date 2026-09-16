import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:http';
import {chromium} from 'playwright';
import {mediaBinary} from './test-media-binaries.mjs';
import {createHearMeOutWebServer} from '../apps/hearmeout/dist/web-server-v3.js';
import {HearMeOutBroadcastProgram} from '../apps/hearmeout/dist/broadcast-program.js';
import {SqliteHearMeOutRoomMediaRuntime} from '../apps/hearmeout/dist/room-media-core.js';

const directory=await mkdtemp(join(tmpdir(),'hmo-screen-browser-')),databasePath=join(directory,'rooms.sqlite');
const owner={tenantId:'tenant',userId:'owner',displayName:'Owner',roles:['admin']};
const rooms=new SqliteHearMeOutRoomMediaRuntime(databasePath),program=new HearMeOutBroadcastProgram(databasePath,{tenantId:'tenant',executionUserId:'owner'});
let auth,web,browser;const errors=[];
try{
 auth=createServer((req,res)=>{res.setHeader('content-type','application/json');if(req.url==='/v1/session')res.end(JSON.stringify({actorId:'owner',displayName:'Owner',tenantIds:['tenant'],scopes:['admin']}));else{res.statusCode=404;res.end('{}')}});
 await new Promise(resolve=>auth.listen(0,'127.0.0.1',resolve));
 web=createHearMeOutWebServer({spmtOrigin:'http://127.0.0.1:'+auth.address().port,databasePath,port:0,singleBroadcast:{tenantId:'tenant',executionUserId:'owner'},broadcast:{ffmpegBinary:mediaBinary('ffmpeg'),ffprobeBinary:mediaBinary('ffprobe'),cachePath:join(directory,'broadcast')}});
 await web.listen();const origin='http://127.0.0.1:'+web.server.address().port;
 browser=await chromium.launch({executablePath:process.env.HMO_TEST_BROWSER_PATH||chromium.executablePath(),headless:true,args:['--no-sandbox','--disable-dev-shm-usage','--autoplay-policy=no-user-gesture-required']});
 const page=await browser.newPage({viewport:{width:390,height:844},hasTouch:true,isMobile:true});page.on('pageerror',error=>errors.push(error.message));
 // Substitute only the desktop picker. The recorder, upload ordering, encoder,
 // HTTP feeds and both video decoders below are the actual application code.
 await page.addInitScript(()=>{navigator.mediaDevices.getDisplayMedia=async()=>{
  const canvas=document.createElement('canvas');canvas.width=1920;canvas.height=540;
  const context=canvas.getContext('2d');let frame=0;
  const timer=setInterval(()=>{context.fillStyle='#d53020';context.fillRect(0,0,1920,540);context.fillStyle='white';context.fillRect(frame++%1800,0,120,540)},40);
  const stream=canvas.captureStream(24),audio=new AudioContext(),tone=audio.createOscillator(),destination=audio.createMediaStreamDestination();tone.connect(destination);tone.start();await audio.resume();stream.addTrack(destination.stream.getAudioTracks()[0]);
  window.testCapture={stream,stop(){clearInterval(timer);tone.stop();void audio.close()}};return stream;
 }});
 await page.goto(origin+'/apps/hearmeout');await page.getByRole('button',{name:'Create Room',exact:true}).click();await page.locator('[name=name]').fill('Screen hosts');await page.getByRole('button',{name:'Create & join',exact:true}).click();await page.getByRole('button',{name:'Room controls',exact:true}).waitFor();
 await page.getByRole('button',{name:'User profile and settings',exact:true}).click();await page.getByRole('button',{name:'Share screen',exact:true}).click();
 const player=page.frameLocator('[data-hmo-broadcast-frame]');await player.locator('#output').waitFor({state:'attached'});assert.equal(await player.locator('#output').inputValue(),'screen');
 async function playing(video){await video.evaluate(v=>new Promise((resolve,reject)=>{const deadline=Date.now()+40000,timer=setInterval(()=>{if(!v.paused&&v.currentTime>.1&&v.videoWidth){clearInterval(timer);resolve()}else if(Date.now()>deadline){clearInterval(timer);reject(Error('Screen failed to play: '+v.readyState+' '+v.error?.message))}},100)}))}
 await playing(player.locator('video'));
 const room=rooms.listRooms(owner)[0],party=program.hostedRoom(room.roomId);assert.ok(party);
 assert.equal(await page.locator('video').count(),0,'The room uses its watch player, without an extra screen element');
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'An ultrawide shared screen cannot stretch the room viewport');
 assert.ok((await page.locator('[data-hmo-broadcast-frame]').boundingBox()).width<=390);
 assert.equal(await player.locator('video').evaluate(v=>v.videoWidth),1280);
 const viewer=await browser.newPage({viewport:{width:600,height:700},hasTouch:true});viewer.on('pageerror',error=>errors.push(error.message));await viewer.goto(origin+'/activity');
 await viewer.locator('.party-card').filter({hasText:'Screen hosts'}).getByRole('button',{name:'Watch party',exact:true}).click();
 const viewerControls=viewer.getByRole('button',{name:'Controls',exact:true});await viewerControls.waitFor({state:'visible'});if(await viewerControls.getAttribute('aria-pressed')!=='true')await viewerControls.evaluate(button=>button.click());
 await viewer.locator('#output').selectOption('screen');await playing(viewer.locator('video'));
 const pixel=await viewer.locator('video').evaluate(v=>{const canvas=document.createElement('canvas');canvas.width=1;canvas.height=1;const ctx=canvas.getContext('2d');ctx.drawImage(v,0,0,1,1);return [...ctx.getImageData(0,0,1,1).data]});assert.ok(pixel[0]>100&&pixel[1]<110,'Discord Activity decodes the actual shared-screen pixels');
 assert.equal(rooms.listMembers('tenant',room.roomId).length,1,'Viewing the share does not join its voice room');
 await viewer.evaluate(()=>{document.querySelector('main').requestFullscreen=()=>Promise.reject(Error('Host restricts fullscreen'))});await viewer.getByRole('button',{name:'Fullscreen',exact:true}).click();assert.equal(await viewer.locator('main').evaluate(node=>node.classList.contains('expanded')),true);await viewer.getByRole('button',{name:'Exit full view',exact:true}).click();
 await viewer.locator('#output').selectOption('program');await viewer.waitForFunction(()=>{const video=document.querySelector('video');return !video.hasAttribute('src')&&video.paused&&video.readyState===0});assert.equal((await(await fetch(origin+'/api/watch/broadcast/state?roomId='+party.roomId)).json()).screen.active,true,'A viewer switching output does not stop the share');
 await viewer.locator('#output').selectOption('screen');await playing(viewer.locator('video'));
 // Screen sharing belongs to the local user's participant-card menu.
 // Verify that stopping capture revokes the backend share and then reaches the viewer.
 await page.getByRole('button',{name:'User profile and settings',exact:true}).click();await page.getByRole('button',{name:'Stop sharing',exact:true}).click();await page.evaluate(()=>{testCapture.stop();if(testCapture.stream.getTracks().some(track=>track.readyState!=='ended'))throw Error('Capture tracks remained live')});
 let stopped=false;for(let attempt=0;attempt<30;attempt++){const state=await(await fetch(origin+'/api/watch/broadcast/state?roomId='+party.roomId)).json();if(state.screen?.active===false){stopped=true;break}await new Promise(resolve=>setTimeout(resolve,500))}assert.equal(stopped,true,'Stopping capture must revoke the shared-screen backend');
 await viewer.getByText('No screen is being shared.',{exact:true}).waitFor({timeout:15000});
 assert.deepEqual(errors,[]);console.log('PASS: real browser recording uploads an ultrawide screen with captured audio into the bounded room player and Discord Activity; viewers switch outputs without joining voice; fullscreen fallback and stopping capture work.');
}finally{await browser?.close();await web?.close();if(auth)await new Promise(resolve=>auth.close(resolve));rooms.close();program.close();await rm(directory,{recursive:true,force:true})}
