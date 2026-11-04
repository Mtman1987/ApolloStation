import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {build} from 'esbuild';
import {chromium} from 'playwright';
import {HearMeOutRoomPersonaSpeech} from '../apps/hearmeout/dist/room-persona-speech.js';

const scope={tenantId:'browser-test',roomId:'room'},persona={personaId:'luna',displayName:'Luna',idleAvatarUrl:'https://assets.example/idle.png',talkingAvatarUrl:'https://assets.example/talking.png'};
const wav=Buffer.alloc(44+24000*2*30);wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(24000,24);wav.writeUInt32LE(48000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(wav.length-44,40);
for(let i=0;i<24000*30;i++)wav.writeInt16LE(Math.round(Math.sin(i/24000*2*Math.PI*440)*3000),44+i*2);
const shared=new HearMeOutRoomPersonaSpeech(':memory:',{rooms:()=>[scope],personas:()=>[persona],exists:()=>true,bridgeEnabled:()=>false,bridgeStatus:async()=>false});
const bundle=await build({entryPoints:['apps/hearmeout/src/room-persona-browser.ts'],bundle:true,platform:'browser',format:'iife',globalName:'PersonaAudio',write:false});
let native=false;
const server=createServer((request,response)=>{
 try{
  if(request.url==='/player.js'){response.setHeader('content-type','text/javascript');response.end(bundle.outputFiles[0].text);return}
  if(request.url?.startsWith('/api/')){
   const match=request.url.match(/^\/api\/hearmeout\/rooms\/room\/personas\/audio(?:\/([a-f0-9]{64}))?$/);
   if(!match){response.writeHead(403);response.end('{}');return}
   if(match[1]){const bytes=shared.audio(scope,match[1]);response.writeHead(200,{'content-type':'audio/wav','content-length':bytes.length});response.end(bytes)}
   else{const state=shared.state(scope);if(native&&state.playback)state.playback.route='livekit';response.setHeader('content-type','application/json');response.end(JSON.stringify(state))}return;
  }
  response.setHeader('content-type','text/html');response.end('<div class="hmo-console" data-room-id="room"><div class="hmo-person-list"></div></div><script src="/player.js"></script><script>window.native=false;window.volume=.7;window.player=new PersonaAudio.HearMeOutRoomPersonaPlayer({canHearNative:()=>window.native,volume:()=>window.volume});player.start("room");</script>');
 }catch(error){response.writeHead(500);response.end(error.message)}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;let browser;
try{
 browser=await chromium.launch({executablePath:process.env.HMO_TEST_BROWSER_PATH||chromium.executablePath(),headless:true,args:['--no-sandbox','--disable-dev-shm-usage','--autoplay-policy=no-user-gesture-required']});
 const pages=[],errors=[];
 for(let i=0;i<2;i++){const context=await browser.newContext();await context.route('https://assets.example/**',r=>r.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>'}));const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto(origin);pages.push(page)}
 await shared.publish(scope,'reply','luna',async()=>wav);
 for(const page of pages){
  await page.waitForFunction(()=>player.audio&&!player.audio.paused&&player.audio.currentTime>.2);
  await page.evaluate(async()=>{window.context=new AudioContext();window.analyser=context.createAnalyser();context.createMediaElementSource(player.audio).connect(analyser).connect(context.destination);await context.resume()});
  await page.waitForFunction(()=>{const samples=new Float32Array(analyser.fftSize);analyser.getFloatTimeDomainData(samples);return samples.some(v=>Math.abs(v)>.005)});
  assert.equal(await page.locator('[data-hmo-remote-identity="persona:luna"] img').getAttribute('src'),persona.talkingAvatarUrl);
 }
 const [a,b]=await Promise.all(pages.map(p=>p.evaluate(()=>player.audio.currentTime)));assert.ok(Math.abs(a-b)<1,'both browsers play the same room clip position');
 await pages[0].evaluate(()=>{window.volume=0;player.updateVolume()});assert.equal(await pages[0].evaluate(()=>player.audio.volume),0);assert.equal(await pages[1].evaluate(()=>player.audio.volume),.7);
 native=true;
 await pages[0].evaluate(()=>{window.native=true;player.setRemote([{identity:'persona:luna',name:'Luna',isSpeaking:true,metadata:JSON.stringify({type:'persona',displayName:'Luna',idleAvatar:'https://assets.example/idle.png',talkingAvatar:'https://assets.example/talking.png'})}])});
 await pages[0].waitForFunction(()=>player.audio===null);assert.equal(await pages[0].locator('[data-hmo-remote-identity="persona:luna"]').count(),1);
 assert.equal(await pages[0].locator('[data-hmo-remote-identity="persona:luna"] img').getAttribute('src'),persona.talkingAvatarUrl);
 assert.equal(await pages[1].evaluate(()=>!player.audio.paused),true,'browser without a subscribed native track still hears speech');
 const member=(userId,username)=>({userId,username,displayName:username});
 for(const speaker of ['Alice','Bob']){
  await pages[0].evaluate(({speaker,members})=>player.setRemote([{identity:'discord-mixed-room',name:'Discord VC',isSpeaking:true,metadata:JSON.stringify({source:'discord',displayName:speaker,photoURL:'https://assets.example/'+speaker+'.png',discordMembers:members,activeSpeakers:[speaker.toLowerCase()]})}]),{speaker,members:[member('alice','alice'),member('bob','bob')]});
  const card=pages[0].locator('[data-hmo-remote-identity="discord-mixed-room"]');assert.equal(await card.locator('strong').textContent(),speaker);assert.equal(await card.locator('img').getAttribute('src'),'https://assets.example/'+speaker+'.png');assert.match(await card.textContent(),/alice.*bob/);
 }
 native=false;await pages[0].evaluate(()=>{window.native=false;player.setRemote([])});await pages[0].waitForFunction(before=>player.audio&&!player.audio.paused&&player.audio.readyState>=2&&player.audio.currentTime>before,a);const continued=await pages[0].evaluate(()=>player.audio.currentTime);assert.ok(continued>a,'fallback resumes instead of repeating the sentence');
 for(const page of pages){await page.evaluate(()=>{window.previousAudio=player.audio;player.close()});assert.equal(await page.evaluate(()=>previousAudio.paused&&player.audio===null),true)}
 assert.deepEqual(errors,[]);console.log('PASS: two real browsers hear shared PCM, follow speaking avatars, avoid native duplicates, switch Discord speakers, and stop on leave.');
}finally{await browser?.close();await shared.close();await new Promise(r=>server.close(r))}
