import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { HearMeOutAutoRadio, hearMeOutRadioRecommendation } from '../apps/hearmeout/dist/auto-radio.js';
import { SqliteHearMeOutRoomMediaRuntime } from '../apps/hearmeout/dist/room-media-core.js';

const owner={tenantId:'tenant',userId:'owner',displayName:'Owner',roles:['member']};
const track=id=>({itemId:id,type:'music',title:id,source:'catalog',playbackUrl:'https://media.example/'+id+'.mp3',durationSeconds:60});
function fixture(){const dir=mkdtempSync(join(tmpdir(),'hmo-radio-')),path=join(dir,'rooms.sqlite'),rooms=new SqliteHearMeOutRoomMediaRuntime(path);let clock=Date.now();const now=()=>new Date(clock).toISOString();rooms.createRoom(owner,{roomId:'radio',name:'Radio',privacy:'public',operationId:'create',now:now()});rooms.configureRadio(owner,'radio',true,'Soul music',now());return{rooms,path,now,advance(ms){clock+=ms},close(){rooms.close();rmSync(dir,{recursive:true,force:true})}};}

test('radio queues one recommendation ahead, prioritizes manual requests and retains history after restart',async()=>{
  const f=fixture();let calls=0;const worker=new HearMeOutAutoRadio(f.rooms,{resolve:async input=>{calls++;assert.equal(input.lane,'music');return track('auto-'+calls)}},{now:f.now});
  try{
    await worker.tick();assert.equal(f.rooms.getSession('tenant','radio','music',f.now()).current.item.itemId,'auto-1');
    f.advance(5000);await worker.tick();assert.equal(f.rooms.getSession('tenant','radio','music',f.now()).queue.length,1);await worker.tick();assert.equal(calls,2);
    f.rooms.enqueue(owner,{roomId:'radio',lane:'music',item:track('manual'),operationId:'manual',now:f.now()});assert.deepEqual(f.rooms.getSession('tenant','radio','music',f.now()).queue.map(item=>item.item.itemId),['manual','auto-2']);
    f.advance(60000);await worker.tick();assert.equal(f.rooms.getSession('tenant','radio','music',f.now()).current.item.itemId,'manual');
    const reopened=new SqliteHearMeOutRoomMediaRuntime(f.path);try{assert.equal(reopened.radio('tenant','radio').enabled,true);assert.deepEqual(reopened.radio('tenant','radio').history.map(item=>item.itemId),['auto-1','auto-2']);}finally{reopened.close();}
    assert.throws(()=>f.rooms.configureRadio({...owner,userId:'outsider'},'radio',true,'Theme',f.now()),/membership/);
  }finally{f.close();}
});

test('a second host does not duplicate selection; manual input wins while recommendation is pending',async()=>{
  const f=fixture(),second=new SqliteHearMeOutRoomMediaRuntime(f.path);let started,release,calls=0;const entered=new Promise(resolve=>started=resolve),gate=new Promise(resolve=>release=resolve);const media={resolve:async()=>{calls++;started();await gate;return track('late')}};
  try{const first=new HearMeOutAutoRadio(f.rooms,media,{now:f.now}),other=new HearMeOutAutoRadio(second,media,{now:f.now});const pending=first.tick();await entered;await other.tick();assert.equal(calls,1);f.rooms.enqueue(owner,{roomId:'radio',lane:'music',item:track('manual'),operationId:'manual',now:f.now()});release();await pending;const session=f.rooms.getSession('tenant','radio','music',f.now());assert.equal(session.current.item.itemId,'manual');assert.equal(session.queue.length,0);assert.equal(f.rooms.radio('tenant','radio').history.length,0);}finally{release?.();second.close();f.close();}
});

test('turning radio off or deleting the room fences late results and cannot recreate state',async()=>{
  for(const remove of [false,true]){const f=fixture();let release,started;const gate=new Promise(resolve=>release=resolve),entered=new Promise(resolve=>started=resolve);try{const worker=new HearMeOutAutoRadio(f.rooms,{resolve:async()=>{started();await gate;return track('late')}},{now:f.now});const pending=worker.tick();await entered;if(remove)f.rooms.deleteRoom(owner,'radio','delete',f.now());else f.rooms.configureRadio(owner,'radio',false,'',f.now());release();await pending;if(remove){assert.equal(f.rooms.getRoom('tenant','radio',f.now()),undefined);assert.equal(f.rooms.radio('tenant','radio'),undefined);}else{assert.equal(f.rooms.radio('tenant','radio').enabled,false);assert.equal(f.rooms.getSession('tenant','radio','music',f.now()).current,null);}}finally{release?.();f.close();}}
});

test('radio recommendations use the existing assistant without personal memory and fall back to the theme',async()=>{
  const calls=[],client={async invokeCommunityAssistant(t,input,key){calls.push(input);return{status:'accepted',jobId:'recommendation'}},async getExecutionJob(){return{state:'succeeded',result:{text:'{"query":"New song by Artist"}'}}}};
  const input={tenantId:'tenant',userId:'owner',seed:'Soul music',recent:['Yesterday']};assert.equal(await hearMeOutRadioRecommendation(client,input),'New song by Artist');assert.equal(calls[0].remember,false);assert.equal(calls[0].userId,'owner');assert.match(calls[0].message,/Yesterday/);
  assert.equal(await hearMeOutRadioRecommendation({...client,invokeCommunityAssistant:async()=>({status:'unavailable'})},input),'Soul music');
});
