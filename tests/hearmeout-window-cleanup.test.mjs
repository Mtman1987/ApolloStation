import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {HearMeOutBroadcastProgram} from '../apps/hearmeout/dist/broadcast-program.js';
import {retireHearMeOutDeploymentSample} from '../scripts/sprites/retire-hearmeout-deployment-sample.mjs';
import {HEARMEOUT_TEST_SOURCE} from '../scripts/sprites/hearmeout-test-source.mjs';
const binding={tenantId:'test',executionUserId:'owner'},sampleKey='deployment-single-video:a1cbc44f0fa7e5b22c89deae8f42424f5eb5947e';
const resolver={async resolve(input){return {itemId:input.query,title:input.query,type:input.lane,playbackUrl:input.query,source:'test'};}};

test('sample cleanup removes only the deployment request, preserves user requests and is idempotent',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'hmo-sample-')),path=join(dir,'state.sqlite'),program=new HearMeOutBroadcastProgram(path,binding);
 try{
  await program.request({requesterId:'guest:deployment',displayName:'Viewer',query:HEARMEOUT_TEST_SOURCE,operationId:sampleKey},resolver);
  await program.request({requesterId:'guest:viewer',displayName:'Viewer',query:HEARMEOUT_TEST_SOURCE,operationId:'my-own-request'},resolver);
  const userRequest=program.getSession().queue[0];
  assert.deepEqual(retireHearMeOutDeploymentSample(path),{removed:1});
  assert.deepEqual(program.getSession().current,userRequest);assert.equal(program.getSession().playback.status,'playing');
  const after=program.getSession();assert.deepEqual(retireHearMeOutDeploymentSample(path),{removed:0});assert.deepEqual(program.getSession(),after);
 }finally{program.close();await rm(dir,{recursive:true,force:true});}
});

test('removing the only seeded sample leaves an idle blank program; music and movie use the same queue',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'hmo-blank-')),path=join(dir,'state.sqlite'),program=new HearMeOutBroadcastProgram(path,binding);
 try{
  await program.request({requesterId:'guest:deployment',displayName:'Viewer',query:HEARMEOUT_TEST_SOURCE,operationId:sampleKey},resolver);
  retireHearMeOutDeploymentSample(path);assert.equal(program.getSession().current,null);assert.equal(program.getSession().playback.status,'idle');assert.equal(program.broadcastSessions().length,0);
  const calls=[],media={async resolve(input){calls.push(input);return resolver.resolve(input);}};
  const request={requesterId:'guest:viewer',displayName:'Viewer',query:'https://example.com/audio.mp3',operationId:'music-request',lane:'music'};
  await program.request(request,media);await program.request(request,media);assert.equal(calls.length,1);assert.equal(calls[0].lane,'music');assert.equal(program.getSession().current.item.type,'music');
  await assert.rejects(program.request({...request,lane:'movie'},media),/already belongs/);
  await program.request({...request,query:'https://example.com/video.mp4',operationId:'movie-request',lane:'movie'},media);
  assert.equal(program.getSession().queue.length,1);assert.equal(program.getSession().queue[0].item.type,'movie');assert.equal(program.broadcastSessions().length,1);
 }finally{program.close();await rm(dir,{recursive:true,force:true});}
});
