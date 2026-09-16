import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {HearMeOutBroadcastProgram,HEARMEOUT_SINGLE_PROGRAM_ID} from '../apps/hearmeout/dist/broadcast-program.js';

const binding={tenantId:'tenant',executionUserId:'owner'};
const media={async resolve({query,lane}){return {itemId:query,title:query,type:lane,source:'fixture',playbackUrl:'https://media.example/video.mp4',durationSeconds:10};}};
async function fixture(t){const dir=await mkdtemp(join(tmpdir(),'hmo-room-owned-'));t.after(()=>rm(dir,{recursive:true,force:true}));return join(dir,'state.sqlite');}

test('HearMeOut starts with no permanent player and refuses orphan media sessions',async t=>{
 const path=await fixture(t),program=new HearMeOutBroadcastProgram(path,binding);t.after(()=>program.close());
 assert.deepEqual(program.listRooms(),[]);
 assert.throws(()=>program.getSession(),/Choose a watch party/);
 assert.throws(()=>program.getSession('tenant',HEARMEOUT_SINGLE_PROGRAM_ID),/Choose a watch party/);
 assert.throws(()=>program.createRoom({name:'Orphan',requesterId:'viewer',operationId:'orphan'}),/Join a HearMeOut room or Discord voice channel/);
 await assert.rejects(()=>program.request({requesterId:'viewer',displayName:'Viewer',query:'video',operationId:'orphan'},media),/Choose a watch party/);
});

test('room-owned player survives restart and is destroyed with its hosting context',async t=>{
 const path=await fixture(t);let program=new HearMeOutBroadcastProgram(path,binding);t.after(()=>program.close());
 const room=program.createRoom({name:'Room movie',requesterId:'viewer',operationId:'create',sourceRoomId:'hmo-room'});
 await program.request({roomId:room.roomId,requesterId:'viewer',displayName:'Viewer',query:'video',operationId:'request'},media);
 const before=program.getSession('tenant',room.roomId);program.close();program=new HearMeOutBroadcastProgram(path,binding);
 assert.deepEqual(program.getSession('tenant',room.roomId),before);
 assert.equal(program.deleteHostedRoom('hmo-room'),true);
 assert.equal(program.hostedRoom('hmo-room'),undefined);
 assert.throws(()=>program.getSession('tenant',room.roomId),/not found/);
 assert.deepEqual(program.listRooms(),[]);
});

test('each Discord voice channel receives one deterministic hidden player and can be torn down independently',async t=>{
 const path=await fixture(t),program=new HearMeOutBroadcastProgram(path,binding);t.after(()=>program.close());
 const first={guildId:'123456789012345678',channelId:'234567890123456789'},second={guildId:first.guildId,channelId:'345678901234567890'};
 const a=program.createRoom({name:'VC one',requesterId:'viewer-a',operationId:'a',channel:first});
 const duplicate=program.createRoom({name:'VC one duplicate',requesterId:'viewer-b',operationId:'b',channel:first});
 const b=program.createRoom({name:'VC two',requesterId:'viewer-c',operationId:'c',channel:second});
 assert.equal(a.roomId,duplicate.roomId);assert.notEqual(a.roomId,b.roomId);assert.match(a.roomId,/^discord-/);
 assert.equal(program.deleteChannelRoom(first),true);assert.equal(program.channelRoom(first),undefined);assert.equal(program.channelRoom(second).roomId,b.roomId);
});
