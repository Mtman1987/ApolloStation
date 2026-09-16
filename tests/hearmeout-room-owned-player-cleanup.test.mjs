import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {SqliteHearMeOutRoomMediaRuntime} from '../apps/hearmeout/dist/room-media-core.js';
import {HearMeOutBroadcastProgram} from '../apps/hearmeout/dist/broadcast-program.js';

const principal={tenantId:'tenant',userId:'owner',displayName:'Owner',roles:['admin']};
const binding={tenantId:'tenant',executionUserId:'owner'};

async function fixture(t){
 const dir=await mkdtemp(join(tmpdir(),'hmo-player-cleanup-'));
 t.after(()=>rm(dir,{recursive:true,force:true}));
 return join(dir,'state.sqlite');
}

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

test('idle Discord hidden players can be garbage-collected without touching another VC',async t=>{
 const path=await fixture(t),program=new HearMeOutBroadcastProgram(path,binding);t.after(()=>program.close());
 const old={guildId:'123456789012345678',channelId:'234567890123456789'},active={guildId:old.guildId,channelId:'345678901234567890'};
 const first=program.createRoom({name:'Old VC',requesterId:'one',operationId:'one',channel:old});
 const second=program.createRoom({name:'Active VC',requesterId:'two',operationId:'two',channel:active});
 const future=new Date(Date.now()+31*60*1000).toISOString();
 program.touchRoom(second.roomId);
 const removed=program.pruneExpiredDiscordRooms(30*60*1000,future);
 assert.ok(removed.includes(first.roomId));
 assert.equal(program.channelRoom(old),undefined);
 assert.equal(program.channelRoom(active).roomId,second.roomId);
});
