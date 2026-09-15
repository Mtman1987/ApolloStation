import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {HEARMEOUT_PERSONA_TALK_BROWSER_JS} from '../apps/hearmeout/dist/persona-talk-client.js';
import {HEARMEOUT_DISCORD_HANDSHAKE_JS} from '../apps/hearmeout/dist/discord-activity-handshake.js';
import {SpmtAssistantApi} from '../apps/spmt-service/dist/assistant-api.js';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function element(value=''){return{value,textContent:'',disabled:false,listeners:{},addEventListener(name,callback){this.listeners[name]=callback},async click(){if(!this.disabled)await this.listeners.click()},setAttribute(){}}}
function browser(fetch,extras={}){
 const timers=new Map();let serial=0;
 const window={...extras},context={window,fetch,AbortSignal,URLSearchParams,Blob,crypto:{randomUUID:()=>String(++serial)},navigator:{language:'en-US'},document:{documentElement:{lang:'en'}},setTimeout:(fn,ms)=>{const id=++serial;timers.set(id,{fn,ms});return id},clearTimeout:id=>timers.delete(id),...extras};
 vm.runInNewContext(HEARMEOUT_PERSONA_TALK_BROWSER_JS,context);
 return{api:window.HearMeOutPersonaTalk,timers};
}
const response=(data,ok=true)=>({ok,status:ok?200:503,json:async()=>data});
test('Send visibly starts, shows its text, and unlocks without waiting for autoplay or audio ending',async()=>{
 const calls=[],b=browser(async(url,init)=>{calls.push({url,init});return response({reply:'Hello! How are you?'})}),button=element(),input=element('Hi'),status=element();
 b.api.attachSend(button,input,status,{roomId:'room',personaId:'stella',displayName:'Stella',speech:{synthesis:false},onDone:()=>new Promise(()=>{})});
 const sent=button.click();assert.match(status.textContent,/Sending to Stella/);assert.equal(button.disabled,true);await sent;
 assert.equal(input.value,'');assert.equal(button.disabled,false);assert.match(status.textContent,/Stella: Hello!/);assert.equal(JSON.parse(calls[0].init.body).speak,false);
});
test('Send retains a retry key and draft after failure, and audio errors preserve the visible answer',async()=>{
 const keys=[];let fails=true;const b=browser(async(_,init)=>{keys.push(init.headers['idempotency-key']);if(fails)throw Error('Connection lost');return response({reply:'Hello'})});
 const button=element(),input=element('Hi'),status=element();b.api.attachSend(button,input,status,{roomId:'a',personaId:'stella',displayName:'Stella',onDone:()=>Promise.reject(Error('No audio'))});
 await button.click();assert.equal(input.value,'Hi');assert.match(status.textContent,/Connection lost/);fails=false;await button.click();await tick();assert.equal(keys[0],keys[1]);assert.match(status.textContent,/Stella: Hello/);assert.match(status.textContent,/Audio could not play/);
});
test('a ready text reply is shown while speech is still processing, and survives a later audio poll failure',async()=>{
 let calls=0;const b=browser(async()=>{if(++calls===1)return response({state:'running',reply:'Ready before speech'});throw Error('Audio connection failed')}),progress=[];
 const pending=b.api.waitReply('r',{requestId:'id'},value=>progress.push(value));await tick();assert.equal(progress[0].reply,'Ready before speech');[...b.timers.values()][0].fn();const result=await pending;assert.equal(result.reply,'Ready before speech');assert.match(result.error,/audio could not/);
});
test('Talk uses browser recognition when server speech is disabled, sends the transcript once, and releases the button',async()=>{
 let recognition;class Recognition{constructor(){recognition=this}start(){this.onstart()}stop(){this.onend()}abort(){}}
 const calls=[],b=browser(async(url,init)=>{calls.push({url,body:JSON.parse(init.body)});return response({reply:'I am doing well.'})},{webkitSpeechRecognition:Recognition});
 const button=element(),status=element();b.api.attach(button,status,{roomId:'private',tenantId:'t',personaId:'stella',displayName:'Stella',speech:{transcription:false,synthesis:false}});
 await button.click();assert.match(status.textContent,/Listening with browser/);recognition.onresult({results:[[{transcript:'Hello how are you'}]]});assert.match(status.textContent,/You said: Hello/);recognition.onend();recognition.onend();await tick();
 assert.equal(calls.length,1);assert.equal(calls[0].body.message,'Hello how are you');assert.equal(calls[0].body.speak,false);assert.match(status.textContent,/Stella: I am doing well/);assert.equal(button.disabled,false);assert.equal(b.timers.size,0);
});
test('denied microphone access reports the error and can be retried without sending an empty message',async()=>{
 let recognition;class Recognition{constructor(){recognition=this}start(){this.onstart()}abort(){this.onend()}}
 let calls=0;const b=browser(async()=>{calls++;return response({})},{SpeechRecognition:Recognition}),button=element(),status=element();b.api.attach(button,status,{roomId:'r',personaId:'stella',displayName:'Stella',speech:{transcription:false}});
 await button.click();recognition.onerror({error:'not-allowed'});assert.match(status.textContent,/Microphone access was denied/);assert.equal(button.disabled,false);assert.equal(calls,0);assert.equal(b.timers.size,0);
});
test('speech status reflects both environment restrictions and capability-specific worker readiness',async()=>{
 for(const enabled of [false,true]){
  const api=new SpmtAssistantApi({enabled,auth:{authorize:()=>({actorType:'user',actorId:'user'})},control:{getTenant:()=>({status:'active'})},jobs:{hasReadyWorker:({capabilityId})=>capabilityId.endsWith('transcribe.v1')},accessToken:()=> 'token'});
  let body,status;await api.handle({method:'GET',headers:{'x-spmt-tenant':'t'}},{writeHead:code=>status=code,end:text=>body=JSON.parse(text)},new URL('http://localhost/v1/assistant/speech/status'));
  assert.equal(status,200);assert.deepEqual(body,{synthesis:false,transcription:enabled});
 }
});
test('Discord native popout handshakes with the opener, accepts READY only from that host, and restores on pageshow',()=>{
 const listeners={},sent=[],opener={postMessage:(...args)=>sent.push(args)},parent={opener,postMessage:()=>assert.fail('The detached window is not the Discord RPC host')},intervals=new Map();let serial=0;
 const window={parent,addEventListener:(name,fn)=>listeners[name]=fn};
 vm.runInNewContext(HEARMEOUT_DISCORD_HANDSHAKE_JS,{window,URL,URLSearchParams,location:{search:'?frame_id=frame&platform=desktop'},document:{referrer:'https://discord.com/channels/1/2'},setInterval:fn=>{intervals.set(++serial,fn);return serial},clearInterval:id=>intervals.delete(id)});
 const statuses=[];window.connectHearMeOutDiscord('app',message=>statuses.push(message));assert.equal(sent[0][1],'https://discord.com');assert.equal(sent[0][0][1].frame_id,'frame');
 listeners.message({source:parent,origin:'https://discord.com',data:[1,{evt:'READY'}]});assert.equal(intervals.size,1);
 listeners.message({source:opener,origin:'https://discord.com',data:[1,{evt:'READY'}]});assert.equal(intervals.size,0);assert.equal(statuses.at(-1),'');
 listeners.pagehide();listeners.pageshow({persisted:true});assert.equal(sent.length,2);assert.equal(intervals.size,1);
});
