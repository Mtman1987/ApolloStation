import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {SqliteHearMeOutRoomMediaRuntime} from '../apps/hearmeout/dist/room-media-core.js';
import {HearMeOutBroadcastProgram} from '../apps/hearmeout/dist/broadcast-program.js';

const principal={tenantId:'tenant',userId:'owner',displayName:'Owner',roles:['admin']};
const binding={tenantId:'tenant',executionUserId:'owner'};
const media={async resolve({query,lane}){return {itemId:query,title:query,type:lane,source:'fixture',playbackUrl:'https://media.example/video.mp4',durationSeconds:600};}};

async function fixture(t){
 const dir=await mkdtemp(join(tmpdir(),'hmo-player-cleanup-'));
 t.after(()=>rm(dir,{recursive:true,force:true}));
 return join(dir,'state.sqlite');
}

test('closing a watch player preserves its HearMeOut room',async t=>{
 const path=await fixture(t),rooms=new SqliteHearMeOutRoomMediaRuntime(path),program=new HearMeOutBroadcastProgram(path,binding);
 t.after(()=>{program.close();rooms.close();});
 const room=rooms.createRoom(principal,{roomId:'voice-only-room',name:'Voice only room',privacy:'public',operationId:'create-room'});
 const party=program.createRoom({name:'Temporary watch party',requesterId:'owner',operationId:'create-party',sourceRoomId:room.roomId});
 assert.equal(program.hostedRoom(room.roomId).roomId,party.roomId);
 assert.equal(program.deleteHostedRoom(room.roomId),true);
 assert.equal(program.hostedRoom(room.roomId),undefined);
 assert.throws(()=>program.getSession('tenant',party.roomId),/not found/);
 assert.equal(rooms.getRoom('tenant',room.roomId).roomId,room.roomId);
 assert.equal(rooms.listMembers('tenant',room.roomId).some(member=>member.userId==='owner'),true);
 const replacement=program.createRoom({name:'New watch party',requesterId:'owner',operationId:'create-replacement',sourceRoomId:room.roomId});
 assert.notEqual(replacement.roomId,'');
 assert.equal(program.hostedRoom(room.roomId).roomId,replacement.roomId);
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

test('idle Discord hidden players can be garbage-collected without touching an active VC',async t=>{
 const path=await fixture(t),program=new HearMeOutBroadcastProgram(path,binding);t.after(()=>program.close());
 const old={guildId:'123456789012345678',channelId:'234567890123456789'},active={guildId:old.guildId,channelId:'345678901234567890'};
 const first=program.createRoom({name:'Old VC',requesterId:'one',operationId:'one',channel:old});
 const second=program.createRoom({name:'Active VC',requesterId:'two',operationId:'two',channel:active});
 await program.request({roomId:second.roomId,requesterId:'two',displayName:'Two',query:'movie',operationId:'active-media',lane:'movie'},media);
 const future=new Date(Date.now()+31*60*1000).toISOString();
 const removed=program.pruneExpiredDiscordRooms(30*60*1000,future);
 assert.ok(removed.includes(first.roomId));
 assert.equal(program.channelRoom(old),undefined);
 assert.equal(program.channelRoom(active).roomId,second.roomId);
});
