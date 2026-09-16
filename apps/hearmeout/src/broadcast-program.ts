import {DatabaseSync} from 'node:sqlite';
import {randomUUID,createHash} from 'node:crypto';
import type {HearMeOutMediaItemV1,HearMeOutMediaSessionV1,HearMeOutPrincipalV1,HearMeOutMediaLaneV1} from './room-media-core.js';
import type {HearMeOutSuiteMediaResolverV1} from './suite-action-executor.js';

/** Legacy identifier kept only so old URLs/data can be rejected and migrated away. */
export const HEARMEOUT_SINGLE_PROGRAM_ID='main-broadcast';
export const HEARMEOUT_IDLE_PLAYER_TTL_MS=10*60*1000;
export interface HearMeOutPartyRoom {roomId:string;name:string;createdAt:string;sourceRoomId?:string;}
export interface HearMeOutPartyChannel {guildId:string;channelId:string;}
export interface HearMeOutProgramBinding {tenantId:string;executionUserId:string;}

/** One durable mixed music/movie/share clock per hosting context.
 * A party must belong to either a HearMeOut room or a Discord voice channel.
 * Viewers may discover/watch parties without joining the hosting voice context. */
export class HearMeOutBroadcastProgram {
  private readonly db:DatabaseSync;
  private cleanupTimer:ReturnType<typeof setInterval>|undefined;
  constructor(path:string,readonly binding:HearMeOutProgramBinding){
    if(!binding.tenantId||!binding.executionUserId)throw Error('Broadcast execution binding is incomplete');
    this.db=new DatabaseSync(path,{timeout:5000});
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;');
    this.db.exec('CREATE TABLE IF NOT EXISTS hmo_program(id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,instance_id TEXT NOT NULL,created_at TEXT NOT NULL,body TEXT NOT NULL,lease_owner TEXT,lease_until TEXT) STRICT; CREATE TABLE IF NOT EXISTS hmo_program_requests(id TEXT PRIMARY KEY,intent TEXT NOT NULL,request_id TEXT NOT NULL) STRICT;');
    this.db.exec(`CREATE TABLE IF NOT EXISTS hmo_program_rooms(id TEXT PRIMARY KEY,name TEXT NOT NULL,created_at TEXT NOT NULL,source_room_id TEXT) STRICT;
      CREATE UNIQUE INDEX IF NOT EXISTS hmo_program_source_room ON hmo_program_rooms(source_room_id) WHERE source_room_id IS NOT NULL;
      CREATE TABLE IF NOT EXISTS hmo_program_channels(guild_id TEXT NOT NULL,channel_id TEXT NOT NULL,program_id TEXT NOT NULL,PRIMARY KEY(guild_id,channel_id)) STRICT;
      CREATE TABLE IF NOT EXISTS hmo_program_room_operations(id TEXT PRIMARY KEY,intent TEXT NOT NULL,program_id TEXT NOT NULL) STRICT;`);
    const columns=this.db.prepare('PRAGMA table_info(hmo_program_rooms)').all() as Array<{name?:string}>;
    if(!columns.some(column=>column.name==='last_active_at'))this.db.exec('ALTER TABLE hmo_program_rooms ADD COLUMN last_active_at TEXT');
    this.db.prepare('UPDATE hmo_program_rooms SET last_active_at=COALESCE(last_active_at,created_at)').run();
    this.installSourceRoomCleanupTrigger();
    // The old immortal fallback player is no longer a valid hosting context.
    this.db.prepare('DELETE FROM hmo_program_channels WHERE program_id=?').run(HEARMEOUT_SINGLE_PROGRAM_ID);
    this.db.prepare('DELETE FROM hmo_program_room_operations WHERE program_id=?').run(HEARMEOUT_SINGLE_PROGRAM_ID);
    this.db.prepare('DELETE FROM hmo_program_rooms WHERE id=?').run(HEARMEOUT_SINGLE_PROGRAM_ID);
    this.db.prepare('DELETE FROM hmo_program WHERE id=?').run(HEARMEOUT_SINGLE_PROGRAM_ID);
    const foreign=this.db.prepare('SELECT id FROM hmo_program WHERE tenant_id<>? LIMIT 1').get(binding.tenantId);
    if(foreign)throw Error('Stored broadcast belongs to a different deployment binding');
    // Player lifetime is automatic. Empty HMO and Discord players disappear after
    // ten idle minutes even if nobody opens the party directory again.
    this.cleanupTimer=setInterval(()=>{try{this.pruneIdleRooms()}catch{}},30_000);
    this.cleanupTimer.unref();
  }
  listRooms():HearMeOutPartyRoom[]{return this.db.prepare('SELECT * FROM hmo_program_rooms WHERE id<>? ORDER BY created_at,id').all(HEARMEOUT_SINGLE_PROGRAM_ID).map(row=>this.roomFromRow(row as Record<string,unknown>));}
  getRoom(roomId:string):HearMeOutPartyRoom{const id=requireRoomId(roomId);const row=this.db.prepare('SELECT * FROM hmo_program_rooms WHERE id=?').get(id);if(!row)throw Object.assign(Error('Watch party not found'),{status:404});return this.roomFromRow(row as Record<string,unknown>);}
  private roomFromRow(row:Record<string,unknown>):HearMeOutPartyRoom{return {roomId:String(row.id),name:String(row.name),createdAt:String(row.created_at),...(row.source_room_id?{sourceRoomId:String(row.source_room_id)}:{})};}
  private insertRoom(roomId:string,name:string,sourceRoomId?:string){
    const now=new Date().toISOString();
    this.db.prepare('INSERT OR IGNORE INTO hmo_program(id,tenant_id,instance_id,created_at,body) VALUES(?,?,?,?,?)').run(roomId,this.binding.tenantId,randomUUID(),now,JSON.stringify(this.empty(now,roomId)));
    this.db.prepare('INSERT OR IGNORE INTO hmo_program_rooms(id,name,created_at,source_room_id,last_active_at) VALUES(?,?,?,?,?)').run(roomId,name,now,sourceRoomId??null,now);
    return this.getRoom(roomId);
  }
  ensureAppRoom(tenantId:string,roomId:string,name:string){
    if(tenantId!==this.binding.tenantId)throw Error('Watch party belongs to another deployment');
    this.installSourceRoomCleanupTrigger();
    const source=requireRoomId(roomId),id='room-'+createHash('sha256').update(JSON.stringify([tenantId,source])).digest('hex');
    return this.transaction(()=>{const room=this.hostedRoom(source)??this.insertRoom(id,name,source);this.touch(room.roomId);return room;});
  }
  hostedRoom(sourceRoomId:string){const row=this.db.prepare('SELECT * FROM hmo_program_rooms WHERE source_room_id=?').get(requireRoomId(sourceRoomId));return row?this.roomFromRow(row as Record<string,unknown>):undefined;}
  channelRoom(channel:HearMeOutPartyChannel){
    validateChannel(channel);
    const row=this.db.prepare('SELECT program_id FROM hmo_program_channels WHERE guild_id=? AND channel_id=?').get(channel.guildId,channel.channelId);
    if(!row)return undefined;
    try{return this.getRoom(String(row.program_id));}catch(error){if((error as {status?:number}).status===404){this.db.prepare('DELETE FROM hmo_program_channels WHERE guild_id=? AND channel_id=?').run(channel.guildId,channel.channelId);return undefined;}throw error;}
  }
  private bindChannel(roomId:string,channel:HearMeOutPartyChannel){
    validateChannel(channel);
    this.db.prepare('INSERT INTO hmo_program_channels(guild_id,channel_id,program_id) VALUES(?,?,?) ON CONFLICT(guild_id,channel_id) DO UPDATE SET program_id=excluded.program_id').run(channel.guildId,channel.channelId,roomId);
    return this.channelRoom(channel)!;
  }
  createRoom(input:{name:string;requesterId:string;operationId:string;channel?:HearMeOutPartyChannel;sourceRoomId?:string}){
    if(input.channel&&input.sourceRoomId)throw Error('Choose one hosting room');
    if(!input.channel&&!input.sourceRoomId)throw Error('Join a HearMeOut room or Discord voice channel to host a watch party');
    if(input.sourceRoomId)this.installSourceRoomCleanupTrigger();
    const name=input.name.trim();if(!name||name.length>120||/[\r\n\0]/.test(name))throw Error('Enter a party name up to 120 characters');
    if(!input.requesterId||!input.operationId||input.operationId.length>200)throw Error('Invalid room request key');
    if(input.channel)validateChannel(input.channel);
    const operation=createHash('sha256').update(JSON.stringify([input.requesterId,input.operationId])).digest('hex'),intent=JSON.stringify([name,input.channel??null,input.sourceRoomId??null]);
    const deterministicRoomId=input.channel?'discord-'+createHash('sha256').update(JSON.stringify([input.channel.guildId,input.channel.channelId])).digest('hex'):'room-'+createHash('sha256').update(JSON.stringify([this.binding.tenantId,requireRoomId(input.sourceRoomId)])).digest('hex');
    return this.transaction(()=>{
      const previous=this.db.prepare('SELECT intent,program_id FROM hmo_program_room_operations WHERE id=?').get(operation) as {intent?:string;program_id?:string}|undefined;
      if(previous){
        if(previous.intent!==intent)throw Error('This request key already belongs to another party');
        try{return this.getRoom(String(previous.program_id));}catch(error){if((error as {status?:number}).status!==404)throw error;this.db.prepare('DELETE FROM hmo_program_room_operations WHERE id=?').run(operation);}
      }
      const occupied=input.channel?this.channelRoom(input.channel):this.hostedRoom(input.sourceRoomId!);
      const room=occupied??this.insertRoom(deterministicRoomId,name,input.sourceRoomId);
      if(input.channel)this.bindChannel(room.roomId,input.channel);
      this.touch(room.roomId);
      this.db.prepare('INSERT INTO hmo_program_room_operations(id,intent,program_id) VALUES(?,?,?)').run(operation,intent,room.roomId);
      return room;
    });
  }
  // Watching never changes voice membership or a room's hosting assignment.
  joinRoom(roomId:string){return this.getRoom(roomId);}
  touchRoom(roomId:string){this.touch(requireRoomId(roomId));}
  touchChannelRoom(channel:HearMeOutPartyChannel){const room=this.channelRoom(channel);if(room)this.touch(room.roomId);return room;}
  deleteHostedRoom(sourceRoomId:string){const room=this.hostedRoom(sourceRoomId);return room?this.deleteRoom(room.roomId):false;}
  deleteChannelRoom(channel:HearMeOutPartyChannel){const room=this.channelRoom(channel);return room?this.deleteRoom(room.roomId):false;}
  deleteRoom(roomId:string){
    const id=requireRoomId(roomId);
    return this.transaction(()=>{
      const exists=this.db.prepare('SELECT 1 ok FROM hmo_program_rooms WHERE id=?').get(id);if(!exists)return false;
      this.db.prepare('DELETE FROM hmo_program_channels WHERE program_id=?').run(id);
      this.db.prepare('DELETE FROM hmo_program_room_operations WHERE program_id=?').run(id);
      this.db.prepare('DELETE FROM hmo_program_rooms WHERE id=?').run(id);
      this.db.prepare('DELETE FROM hmo_program WHERE id=?').run(id);
      return true;
    });
  }
  /** Remove every empty player after ten continuous idle minutes.
   * Passive viewers do not keep an empty player alive; actual media requests,
   * controls and screen-share chunks update last_active_at. */
  pruneIdleRooms(maxIdleMs=HEARMEOUT_IDLE_PLAYER_TTL_MS,now=new Date().toISOString()){
    const cutoff=new Date(Date.parse(now)-Math.max(60_000,maxIdleMs)).toISOString();
    const rows=this.db.prepare('SELECT id FROM hmo_program_rooms WHERE id<>? AND COALESCE(last_active_at,created_at)<=?').all(HEARMEOUT_SINGLE_PROGRAM_ID,cutoff) as Array<{id:string}>;
    const removed:string[]=[];
    for(const row of rows){
      let session:HearMeOutMediaSessionV1;
      try{session=this.read(row.id);}catch(error){if((error as {status?:number}).status===404){if(this.deleteRoom(row.id))removed.push(row.id);continue;}throw error;}
      if(session.current||session.queue.length||session.playback.status==='playing')continue;
      if(this.deleteRoom(row.id))removed.push(row.id);
    }
    return removed;
  }
  /** Backward-compatible alias; idle cleanup now applies to both HMO and Discord players. */
  pruneExpiredDiscordRooms(maxIdleMs=HEARMEOUT_IDLE_PLAYER_TTL_MS,now=new Date().toISOString()){return this.pruneIdleRooms(maxIdleMs,now);}
  close(){if(this.cleanupTimer)clearInterval(this.cleanupTimer);this.db.close();}
  private installSourceRoomCleanupTrigger(){
    if(!this.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='hmo_rooms'").get())return;
    this.db.exec(`CREATE TRIGGER IF NOT EXISTS hmo_program_cleanup_after_room_delete AFTER DELETE ON hmo_rooms BEGIN
      DELETE FROM hmo_program_channels WHERE program_id IN (SELECT id FROM hmo_program_rooms WHERE source_room_id=OLD.room_id);
      DELETE FROM hmo_program_room_operations WHERE program_id IN (SELECT id FROM hmo_program_rooms WHERE source_room_id=OLD.room_id);
      DELETE FROM hmo_program WHERE id IN (SELECT id FROM hmo_program_rooms WHERE source_room_id=OLD.room_id);
      DELETE FROM hmo_program_rooms WHERE source_room_id=OLD.room_id;
    END;`);
  }
  private touch(roomId:string,at=new Date().toISOString()){this.db.prepare('UPDATE hmo_program_rooms SET last_active_at=? WHERE id=?').run(at,roomId);}
  private empty(now:string,roomId:string):HearMeOutMediaSessionV1{return {schemaVersion:1,tenantId:this.binding.tenantId,roomId,sessionId:roomId,lane:'movie',current:null,queue:[],playback:{status:'idle',position:0,updatedAt:now,muted:false,volume:100},revision:0};}
  private transaction<T>(run:()=>T):T{this.db.exec('BEGIN IMMEDIATE');try{const result=run();this.db.exec('COMMIT');return result;}catch(error){this.db.exec('ROLLBACK');throw error;}}
  private read(roomId?:string):HearMeOutMediaSessionV1{const id=requireRoomId(roomId);const row=this.db.prepare('SELECT body FROM hmo_program WHERE id=? AND tenant_id=?').get(id,this.binding.tenantId);if(!row)throw Object.assign(Error('Watch party not found'),{status:404});return JSON.parse(String((row as {body:string}).body));}
  private write(session:HearMeOutMediaSessionV1){this.db.prepare('UPDATE hmo_program SET body=? WHERE id=?').run(JSON.stringify(session),session.roomId);this.touch(session.roomId);}
  getSession(tenant=this.binding.tenantId,roomId?:string,_lane?:HearMeOutMediaLaneV1){if(tenant!==this.binding.tenantId)throw Error('Watch party belongs to another deployment');return this.read(roomId);}
  getBroadcastIdentity(tenant:string,scope:string){if(tenant!==this.binding.tenantId)return undefined;const row=this.db.prepare('SELECT instance_id,created_at FROM hmo_program WHERE id=?').get(scope) as {instance_id?:string;created_at?:string}|undefined;if(!row)return undefined;return {instanceId:String(row.instance_id),createdAt:String(row.created_at)};}
  broadcastSessions(){return this.sessions().filter(session=>session.current);}
  private sessions(){return this.db.prepare('SELECT body FROM hmo_program WHERE tenant_id=?').all(this.binding.tenantId).map(row=>JSON.parse(String((row as {body:string}).body)) as HearMeOutMediaSessionV1);}
  claimBroadcast(tenant:string,scope:string,_lane:HearMeOutMediaLaneV1,owner:string,now=new Date().toISOString()){
    if(!this.getBroadcastIdentity(tenant,scope))return false;
    return this.db.prepare('UPDATE hmo_program SET lease_owner=?,lease_until=? WHERE id=? AND (lease_owner IS NULL OR lease_owner=? OR lease_until<=?)').run(owner,new Date(Date.parse(now)+30000).toISOString(),scope,owner,now).changes===1;
  }
  releaseBroadcast(tenant:string,scope:string,_lane:HearMeOutMediaLaneV1,owner:string){if(tenant!==this.binding.tenantId)return;this.db.prepare('UPDATE hmo_program SET lease_owner=NULL,lease_until=NULL WHERE id=? AND lease_owner=?').run(scope,owner);}
  advance(now=new Date().toISOString()){return this.sessions().map(session=>this.advanceRoom(session.roomId,now)).some(Boolean);}
  private advanceRoom(roomId:string,now:string){
    return this.transaction(()=>{const session=this.read(roomId);if(session.playback.status!=='playing')return false;
      let elapsed=session.playback.position+Math.max(0,(Date.parse(now)-Date.parse(session.playback.updatedAt))/1000),changed=false;
      while(session.current&&session.current.item.type!=='live'&&session.current.item.durationSeconds&&elapsed>=session.current.item.durationSeconds){elapsed-=session.current.item.durationSeconds;session.current=session.queue.shift()??null;changed=true;}
      if(changed){session.playback={...session.playback,status:session.current?'playing':'idle',position:session.current?elapsed:0,updatedAt:now};session.revision++;this.write(session);}return changed;
    });
  }
  finishBroadcastRequest(tenant:string,scope:string,_lane:HearMeOutMediaLaneV1,requestId:string){
    if(!this.getBroadcastIdentity(tenant,scope))return false;
    return this.transaction(()=>{const session=this.read(scope);if(session.current?.requestId!==requestId||session.playback.status!=='playing')return false;this.next(session);this.write(session);return true;});
  }
  private next(session:HearMeOutMediaSessionV1){session.current=session.queue.shift()??null;session.playback={...session.playback,status:session.current?'playing':'idle',position:0,updatedAt:new Date().toISOString()};session.revision++;}
  async searchMovies(query:string,requesterId:string,media:HearMeOutSuiteMediaResolverV1){
    if(!media.searchMovies)throw Error('The IPTV movie search is unavailable');
    return media.searchMovies({tenantId:this.binding.tenantId,billedUserId:this.binding.executionUserId,requesterId,query});
  }
  async request(input:{roomId?:string;requesterId:string;displayName:string;query:string;operationId:string;lane?:HearMeOutMediaLaneV1;selectedItemId?:string;browserPreparation?:boolean},media:HearMeOutSuiteMediaResolverV1){
    const roomId=requireRoomId(input.roomId);this.read(roomId);this.touch(roomId);
    const lane=input.lane??'movie';if(lane!=='music'&&lane!=='movie')throw Error('Choose music or movie');
    const query=input.query.trim();if(!query||query.length>300)throw Error('Enter a video link or title');
    const id=createHash('sha256').update(JSON.stringify([roomId,input.requesterId,input.operationId])).digest('hex'),intent=JSON.stringify(input.selectedItemId?[input.requesterId,query,lane,input.selectedItemId]:lane==='movie'?[input.requesterId,query]:[input.requesterId,query,lane]);
    const replay=()=>{const prior=this.db.prepare('SELECT intent,request_id FROM hmo_program_requests WHERE id=?').get(id) as {intent?:string;request_id?:string}|undefined;if(prior&&prior.intent!==intent)throw Error('This request key already belongs to another video');return prior;};
    if(replay())return this.read(roomId);
    const item=await media.resolve({tenantId:this.binding.tenantId,billedUserId:this.binding.executionUserId,requesterId:input.requesterId,query,lane,...(input.selectedItemId?{selectedItemId:input.selectedItemId}:{}),operationId:'broadcast:'+id});
    validateItem(item);
    return this.transaction(()=>{if(replay())return this.read(roomId);const session=this.read(roomId),at=new Date().toISOString(),entry={requestId:'broadcast-request:'+id,requestedBy:{userId:input.requesterId,displayName:input.displayName.slice(0,120)||'Viewer'},addedAt:at,item};
      if(session.current)session.queue.push(entry);else{session.current=entry;session.playback={...session.playback,status:'playing',position:0,updatedAt:at};}
      session.revision++;this.write(session);this.db.prepare('INSERT INTO hmo_program_requests(id,intent,request_id) VALUES(?,?,?)').run(id,intent,entry.requestId);return session;
    });
  }
  control(principal:HearMeOutPrincipalV1,input:{roomId?:string;action:string;position?:number;expectedRequestId?:string}){
    if(principal.tenantId!==this.binding.tenantId)throw Error('Broadcast belongs to another deployment');
    if(!['next','skip','clear'].includes(input.action))throw Error('Broadcasts support only skip and clear queue; playback cannot be paused or stopped');
    const roomId=requireRoomId(input.roomId);this.touch(roomId);
    return this.transaction(()=>{const session=this.read(roomId);
      if(input.expectedRequestId&&session.current?.requestId!==input.expectedRequestId)return session;
      if(input.action==='next'||input.action==='skip'){
        if(!session.current)return session;
        this.next(session);
      }else{
        if(!session.queue.length)return session;
        session.queue=[];session.revision++;
      }
      this.write(session);return session;
    });
  }
}
function validateItem(item:HearMeOutMediaItemV1){const url=new URL(item.playbackUrl);if(!['https:','http:'].includes(url.protocol)||url.username||url.password||!item.itemId||!item.title)throw Error('The provider did not return playable media');if(item.durationSeconds!==undefined&&(!Number.isFinite(item.durationSeconds)||item.durationSeconds<0))throw Error('Invalid media duration');}
function requireRoomId(roomId?:string){if(!roomId||roomId===HEARMEOUT_SINGLE_PROGRAM_ID)throw Object.assign(Error('Choose a watch party hosted by a HearMeOut room or Discord voice channel'),{status:400});return roomId;}
function validateChannel(channel:HearMeOutPartyChannel){if(!/^\d{5,30}$/.test(channel.guildId)||!/^\d{5,30}$/.test(channel.channelId))throw Error('Invalid Discord channel');}
