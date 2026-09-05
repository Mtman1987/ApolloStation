import test from 'node:test';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';
import {CompanionObsWebSocket} from '../apps/companion/dist/obs-adapter.js';
class Socket extends EventTarget {
 readyState=1;messages=[];fail=false;
 constructor(){super();queueMicrotask(()=>this.emit({op:0,d:{rpcVersion:1,authentication:{salt:'salt',challenge:'challenge'}}}))}
 emit(value){this.dispatchEvent(new MessageEvent('message',{data:JSON.stringify(value)}))}
 send(raw){const message=JSON.parse(raw);this.messages.push(message);queueMicrotask(()=>this.emit(message.op===1?{op:2,d:{negotiatedRpcVersion:1}}:{op:7,d:{requestId:message.d.requestId,requestType:message.d.requestType,requestStatus:{result:!this.fail,code:this.fail?600:100,comment:this.fail?'Source not found':undefined},responseData:{obsVersion:'31'}}}))}
 close(){this.readyState=3;this.dispatchEvent(new Event('close'))}
}
test('local OBS adapter completes the v5 challenge and maps bounded scene/media operations',async()=>{
 let socket;const obs=new CompanionObsWebSocket({url:'ws://127.0.0.1:4455',password:'test-password',socketFactory:()=>socket=new Socket()});
 try{
  await obs.request('GetVersion');const sha=text=>createHash('sha256').update(text).digest('base64');assert.equal(socket.messages[0].d.authentication,sha(sha('test-passwordsalt')+'challenge'));assert.equal(socket.messages[0].d.eventSubscriptions,0);
  await obs.execute({action:'obs.scene.set',payload:{sceneName:'Gameplay'}});assert.deepEqual(socket.messages.at(-1).d.requestData,{sceneName:'Gameplay'});assert.equal(socket.messages.at(-1).d.requestType,'SetCurrentProgramScene');
  await obs.execute({action:'media.volume.set',payload:{inputName:'Music',volume:0.3}});assert.deepEqual(socket.messages.at(-1).d.requestData,{inputName:'Music',inputVolumeMul:0.3});
  await obs.execute({action:'media.seek',payload:{inputName:'Movie',positionMs:5000}});assert.deepEqual(socket.messages.at(-1).d.requestData,{inputName:'Movie',mediaCursor:5000});
  await assert.rejects(()=>obs.execute({action:'media.seek',payload:{inputName:'Movie',positionMs:-1}}),/nonnegative/);
  socket.fail=true;await assert.rejects(()=>obs.execute({action:'media.pause',payload:{inputName:'Missing'}}),/OBS rejected TriggerMediaInputAction.*Source not found/);
 }finally{obs.close()}
 assert.throws(()=>new CompanionObsWebSocket({url:'ws://remote.example:4455'}),/loopback/);
});
test('OBS authentication and protocol failures never produce a success receipt',async()=>{
 const obs=new CompanionObsWebSocket({url:'ws://localhost:4455',socketFactory:()=>new Socket()});try{await assert.rejects(()=>obs.connect(),/OBS_PASSWORD/)}finally{obs.close()}
});
