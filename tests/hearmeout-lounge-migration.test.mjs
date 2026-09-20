import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {HearMeOutBroadcastProgram} from '../apps/hearmeout/dist/broadcast-program.js';
import {SqliteHearMeOutRoomMediaRuntime} from '../apps/hearmeout/dist/room-media-core.js';
import {HearMeOutWebSuiteActionExecutor} from '../apps/hearmeout/dist/suite-action-executor.js';
import {hearMeOutLoungeEnvironment} from '../apps/hearmeout/dist/web-server-v3.js';

const tenant='crew',owner={tenantId:tenant,userId:'owner',displayName:'Owner',roles:['admin']},binding={tenantId:tenant,executionUserId:'owner'};
const loungeChannel={guildId:'123456789012345678',channelId:'234567890123456789'},otherChannel={...loungeChannel,channelId:'345678901234567890'};
const media={async resolve({query,lane}){return{itemId:query,type:lane,title:query,source:'fixture',playbackUrl:'https://media.example/'+encodeURIComponent(query)+'.mp4',durationSeconds:60}}};

test('Lounge commands use only the hosting room or Discord channel while every location may still view it',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'hmo-lounge-migration-')),path=join(dir,'rooms.sqlite'),rooms=new SqliteHearMeOutRoomMediaRuntime(path),program=new HearMeOutBroadcastProgram(path,binding);t.after(()=>{program.close();rooms.close();return rm(dir,{recursive:true,force:true})});
  rooms.createRoom(owner,{roomId:'system-spacemountainlive-lounge',name:'24-Hour Lounge',privacy:'public',systemRoom:true,operationId:'create'});
  program.ensurePermanentRoom({roomId:'system-spacemountainlive-lounge',sourceRoomId:'system-spacemountainlive-lounge',name:'24-Hour Lounge',channel:loungeChannel});
  const executor=new HearMeOutWebSuiteActionExecutor(rooms,media,{singleProgram:program}),input=(channel,request='song')=>({schemaVersion:1,action:'hmo.media.request',args:{query:request,lane:'music'},actor:{userId:'listener',username:'Listener',role:'member'},source:{kind:'chat',provider:'discord',...channel,requestId:request}});
  const accepted=await executor.execute(input(loungeChannel),{tenantId:tenant,idempotencyKey:'inside'});assert.equal(accepted.roomId,'system-spacemountainlive-lounge');assert.equal(program.getSession(tenant,accepted.roomId).current.item.title,'song');
  await assert.rejects(()=>executor.execute(input(otherChannel,'outside'),{tenantId:tenant,idempotencyKey:'outside'}),/Join/);assert.equal(program.getSession(tenant,'system-spacemountainlive-lounge').queue.length,0);
  const roomInput={...input(otherChannel,'spoof'),args:{query:'spoof',lane:'music',roomId:'system-spacemountainlive-lounge'}};await assert.rejects(()=>executor.execute(roomInput,{tenantId:tenant,idempotencyKey:'spoof'}),/Join/);
  const native={tenantId:tenant,userId:'native-listener',displayName:'Native Listener',roles:['member']};rooms.joinRoom(native,'system-spacemountainlive-lounge','join-lounge');
  const nativeInput={...input(otherChannel,'native'),actor:{userId:native.userId,username:native.displayName,role:'member'},source:{kind:'room',roomId:'system-spacemountainlive-lounge',requestId:'native'}};
  const nativeAccepted=await executor.execute(nativeInput,{tenantId:tenant,idempotencyKey:'native'});assert.equal(nativeAccepted.roomId,'system-spacemountainlive-lounge');
});

test('Lounge environment uses the canonical permanent room and requires a complete optional Discord binding',()=>{
  assert.equal(hearMeOutLoungeEnvironment({}),undefined);
  assert.deepEqual(hearMeOutLoungeEnvironment({HEARMEOUT_LOUNGE_ENABLED:'1'}),{roomId:'system-spacemountainlive-lounge',name:'24-Hour Lounge',radioSeed:'A varied mix of music matching recent 24-Hour Lounge requests',twitchChannel:'mtman1987'});
  assert.throws(()=>hearMeOutLoungeEnvironment({HEARMEOUT_LOUNGE_ENABLED:'1',HEARMEOUT_LOUNGE_GUILD_ID:loungeChannel.guildId}),/configured together/);
  assert.deepEqual(hearMeOutLoungeEnvironment({HEARMEOUT_LOUNGE_ENABLED:'1',HEARMEOUT_LOUNGE_GUILD_ID:loungeChannel.guildId,HEARMEOUT_LOUNGE_CHANNEL_ID:loungeChannel.channelId}).channel,loungeChannel);
});
