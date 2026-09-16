import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {HearMeOutBroadcastProgram} from '../apps/hearmeout/dist/broadcast-program.js';
import {retireHearMeOutDeploymentSample} from '../scripts/sprites/retire-hearmeout-deployment-sample.mjs';
import {HEARMEOUT_TEST_SOURCE} from '../scripts/sprites/hearmeout-test-source.mjs';
const binding={tenantId:'test',executionUserId:'owner'};
const resolver={async resolve(input){return {itemId:input.query,title:input.query,type:input.lane,playbackUrl:input.query,source:'test'};}};

function createParty(program,sourceRoomId='room-one'){
 return program.createRoom({name:'Room watch party',requesterId:'guest:viewer',operationId:'create-'+sourceRoomId,sourceRoomId});
}

test('legacy deployment cleanup is a no-op for room-owned players and preserves user requests',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'hmo-sample-')),path=join(dir,'state.sqlite'),program=new HearMeOutBroadcastProgram(path,binding);
 try{
  const party=createParty(program);
  await program.request({roomId:party.roomId,requesterId:'guest:viewer',displayName:'Viewer',query:HEARMEOUT_TEST_SOURCE,operationId:'my-own-request'},resolver);
  const before=program.getSession('test',party.roomId);
  assert.deepEqual(retireHearMeOutDeploymentSample(path),{removed:0});
  assert.deepEqual(program.getSession('test',party.roomId),before);
  assert.deepEqual(retireHearMeOutDeploymentSample(path),{removed:0});
  assert.deepEqual(program.getSession('test',party.roomId),before);
 }finally{program.close();await rm(dir,{recursive:true,force:true});}
});

test('room-owned music and movie requests use the same party queue without a global player',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'hmo-blank-')),path=join(dir,'state.sqlite'),program=new HearMeOutBroadcastProgram(path,binding);
 try{
  const party=createParty(program,'mixed-room');
  assert.throws(()=>program.getSession(),/Choose a watch party/);
  const calls=[],media={async resolve(input){calls.push(input);return resolver.resolve(input);}};
  const request={roomId:party.roomId,requesterId:'guest:viewer',displayName:'Viewer',query:'https://example.com/audio.mp3',operationId:'music-request',lane:'music'};
  await program.request(request,media);await program.request(request,media);assert.equal(calls.length,1);assert.equal(calls[0].lane,'music');assert.equal(program.getSession('test',party.roomId).current.item.type,'music');
  await assert.rejects(program.request({...request,lane:'movie'},media),/already belongs/);
  await program.request({...request,query:'https://example.com/video.mp4',operationId:'movie-request',lane:'movie'},media);
  const state=program.getSession('test',party.roomId);assert.equal(state.queue.length,1);assert.equal(state.queue[0].item.type,'movie');assert.equal(program.broadcastSessions().length,1);
 }finally{program.close();await rm(dir,{recursive:true,force:true});}
});
