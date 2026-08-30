import assert from 'node:assert/strict';
import test from 'node:test';
import { createSpmtRtcCanaryTicketV1 } from '../apps/hearmeout/dist/index.js';
import { createSpmtRtcGateway } from '../apps/hearmeout/rtc-gateway-server.mjs';

const secret='canary-secret-value-that-is-definitely-long-enough';
const tenantId='tenant-canary';
const roomId='rtc-empty-test-room';

function openClient(port,participantId,role,overrides={}){
  const expiresAt=Date.now()+60_000;
  const input={tenantId:overrides.tenantId??tenantId,roomId:overrides.roomId??roomId,participantId,role,expiresAt};
  const ticket=createSpmtRtcCanaryTicketV1(secret,input);
  const url=new URL(`ws://127.0.0.1:${port}/v1/hearmeout/rtc`);
  url.searchParams.set('tenantId',input.tenantId);url.searchParams.set('roomId',input.roomId);url.searchParams.set('participantId',participantId);url.searchParams.set('role',role);
  const socket=new WebSocket(url,['spmt-rtc-v1',ticket]);socket.binaryType='arraybuffer';return socket;
}
function opened(socket){return new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true});});}
function closed(socket){return new Promise(resolve=>socket.addEventListener('close',resolve,{once:true}));}
function message(socket){return new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('message timeout')),2000);socket.addEventListener('message',event=>{clearTimeout(timer);resolve(new Uint8Array(event.data));},{once:true});});}

test('fenced SPMT RTC gateway relays binary audio without sender echo',async()=>{
  const gateway=createSpmtRtcGateway({secret,tenantId,roomId,host:'127.0.0.1',port:0});
  const port=await gateway.listen();
  try{
    const a=openClient(port,'browser-a','browser'),b=openClient(port,'persona-a','persona');
    await Promise.all([opened(a),opened(b)]);
    const got=message(b);a.send(new Uint8Array([1,2,3,4,5]));
    assert.deepEqual([...await got],[1,2,3,4,5]);
    assert.equal(gateway.hub.snapshot()[0].participantCount,2);
    a.close();b.close();
  }finally{await gateway.close();}
});

test('fenced SPMT RTC gateway rejects another tenant before upgrade',async()=>{
  const gateway=createSpmtRtcGateway({secret,tenantId,roomId,host:'127.0.0.1',port:0});
  const port=await gateway.listen();
  try{
    const socket=openClient(port,'browser-b','browser',{tenantId:'other-tenant'});
    const event=await closed(socket);
    assert.equal(event.wasClean,false);
    assert.equal(gateway.hub.snapshot().length,0);
  }finally{await gateway.close();}
});

test('SPMT RTC canary tickets are scoped and expire',()=>{
  const expiresAt=Date.now()+60_000;
  const ticket=createSpmtRtcCanaryTicketV1(secret,{tenantId,roomId,participantId:'p1',role:'browser',expiresAt});
  assert.match(ticket,/^spmt-rtc-auth\./);
  assert.ok(!ticket.includes(secret));
});
