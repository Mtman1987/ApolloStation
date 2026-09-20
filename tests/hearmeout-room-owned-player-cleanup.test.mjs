import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {SqliteHearMeOutRoomMediaRuntime} from '../apps/hearmeout/dist/room-media-core.js';
import {HEARMEOUT_IDLE_PLAYER_TTL_MS,HearMeOutBroadcastProgram} from '../apps/hearmeout/dist/broadcast-program.js';

const principal={tenantId:'tenant',userId:'owner',displayName:'Owner',roles:['admin']};
const binding={tenantId:'tenant',executionUserId:'owner'};
const media={async resolve({query,lane}){return {itemId:query,title:query,type:lane,source:'fixture',playbackUrl:'https://media.example/video.mp4',durationSeconds:600};}};

async function fixture(t){
 const dir=await mkdtemp(join(tmpdir(),'hmo-player-cleanup-'));
 t.after(()=>rm(dir,{recursive:true,force:true}));
 return join(dir,'state.sqlite');
}

test('an empty HMO player expires after ten idle minutes without deleting its voice room',async t=>{
 const path=await fixture(t),rooms=new SqliteHearMeOutRoomMediaRuntime(path),program=new HearMeOutBroadcastProgram(path,binding);
 t.after(()=>{program.close();rooms.close();});
 const room=rooms.createRoom(principal,{roomId:'voice-only-room',name:'Voice only room',privacy:'public',operationId:'create-room'});
 const party=program.createRoom({name:'Temporary watch party',requesterId:'owner',operationId:'create-party',sourceRoomId:room.roomId});
 const before=new Date(Date.now()+HEARMEOUT_IDLE_PLAYER_TTL_MS-1000).toISOString();
 assert.deepEqual(program.pruneIdleRooms(HEARMEOUT_IDLE_PLAYER_TTL_MS,before),[]);
 const after=new Date(Date.now()+HEARMEOUT_IDLE_PLAYER_TTL_MS+1000).toISOString();
 assert.ok(program.pruneIdleRooms(HEARMEOUT_IDLE_PLAYER_TTL_MS,after).includes(party.roomId));
 assert.equal(program.hostedRoom(room.roomId),undefined);
 assert.throws(()=>program.getSession('tenant',party.roomId),/not found/);
 assert.equal(rooms.getRoom('tenant',room.roomId).roomId,room.roomId);
 assert.equal(rooms.listMembers('tenant',room.roomId).some(member=>member.userId==='owner'),true);
 const replacement=program.createRoom({name:'New watch party',requesterId:'owner',operationId:'create-replacement',sourceRoomId:room.roomId});
 assert.equal(program.hostedRoom(room.roomId).roomId,replacement.roomId);
});

test('active media prevents automatic cleanup until playback becomes empty',async t=>{
 const path=await fixture(t),program=new HearMeOutBroadcastProgram(path,binding);t.after(()=>program.close());
 const channel={guildId:'123456789012345678',channelId:'234567890123456789'};
 const party=program.createRoom({name:'Active VC',requesterId:'two',operationId:'two',channel});
 await program.request({roomId:party.roomId,requesterId:'two',displayName:'Two',query:'movie',operationId:'active-media',lane:'movie'},media);
 const future=new Date(Date.now()+HEARMEOUT_IDLE_PLAYER_TTL_MS+60_000).toISOString();
 assert.deepEqual(program.pruneIdleRooms(HEARMEOUT_IDLE_PLAYER_TTL_MS,future),[]);
 assert.equal(program.channelRoom(channel).roomId,party.roomId);
 program.control({tenantId:'tenant',userId:'two',displayName:'Two',roles:[]},{roomId:party.roomId,action:'skip'});
 const later=new Date(Date.now()+HEARMEOUT_IDLE_PLAYER_TTL_MS+120_000).toISOString();
 assert.ok(program.pruneIdleRooms(HEARMEOUT_IDLE_PLAYER_TTL_MS,later).includes(party.roomId));
 assert.equal(program.channelRoom(channel),undefined);
});

test('deleting a HearMeOut room atomically removes its watch player',async t=>{
 const path=await fixture(t),rooms=new SqliteHearMeOutRoomMediaRuntime(path),program=new HearMeOutBroadcastProgram(path,binding);
 t.after(()=>{program.close();rooms.close();});
 rooms.createRoom(principal,{roomId:'movie-room',name:'Movie room',privacy:'public',operationId:'create-room'});
 const party=program.createRoom({name:'Movie room party',requesterId:'owner',operationId:'create-party',sourceRoomId:'movie-room'});
 assert.equal(program.hostedRoom('movie-room').roomId,party.roomId);
 rooms.deleteRoom(principal,'movie-room','delete-room');
 assert.equal(program.hostedRoom('movie-room'),undefined);
 assert.throws(()=>program.getSession('tenant',party.roomId),/not found/);
 assert.equal(program.listRooms().some(room=>room.roomId===party.roomId),false);
});

test('the 24-Hour Lounge player is permanent, discoverable and bound to only its configured channel',async t=>{
 const path=await fixture(t),program=new HearMeOutBroadcastProgram(path,binding);t.after(()=>program.close());
 const loungeChannel={guildId:'123456789012345678',channelId:'234567890123456789'},elsewhere={...loungeChannel,channelId:'345678901234567890'};
 const lounge=program.ensurePermanentRoom({roomId:'system-spacemountainlive-lounge',sourceRoomId:'system-spacemountainlive-lounge',name:'24-Hour Lounge',channel:loungeChannel});
 assert.equal(lounge.permanent,true);assert.equal(program.channelRoom(loungeChannel).roomId,lounge.roomId);assert.equal(program.channelRoom(elsewhere),undefined);
 const future=new Date(Date.now()+HEARMEOUT_IDLE_PLAYER_TTL_MS*20).toISOString();assert.deepEqual(program.pruneIdleRooms(HEARMEOUT_IDLE_PLAYER_TTL_MS,future),[]);
 assert.equal(program.deleteRoom(lounge.roomId),false);assert.equal(program.getRoom(lounge.roomId).name,'24-Hour Lounge');
});
