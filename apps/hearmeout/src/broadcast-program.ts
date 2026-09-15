import {DatabaseSync} from 'node:sqlite';
import {randomUUID,createHash} from 'node:crypto';
import type {HearMeOutMediaItemV1,HearMeOutMediaSessionV1,HearMeOutPrincipalV1,HearMeOutMediaLaneV1} from './room-media-core.js';
import type {HearMeOutSuiteMediaResolverV1} from './suite-action-executor.js';

export const HEARMEOUT_SINGLE_PROGRAM_ID='main-broadcast';
export interface HearMeOutPartyRoom {roomId:string;name:string;createdAt:string;sourceRoomId?:string;}
export interface HearMeOutPartyChannel {guildId:string;channelId:string;}
export interface HearMeOutProgramBinding {tenantId:string;executionUserId:string;}

/** One durable mixed music/movie queue and clock per watch party.
 * The original main program is retained. Viewers never own the clock or need
 * to join the hosting room's voice conversation. */
export class HearMeOutBroadcastProgram {
  private readonly db:DatabaseSync;
  constructor(path:string,readonly binding:HearMeOutProgramBinding){
    if(!binding.tenantId||!binding.executionUserId)throw Error('Broadcast execution binding is incomplete');
    this.db=new DatabaseSync(path,{timeout:5000});
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;');
    this.db.exec('CREATE TABLE IF NOT EXISTS hmo_program(id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,instance_id TEXT NOT NULL,created_at TEXT NOT NULL,body TEXT NOT NULL,lease_owner TEXT,lease_until TEXT) STRICT; CREATE TABLE IF NOT EXISTS hmo_program_requests(id TEXT PRIMARY KEY,intent TEXT NOT NULL,request_id TEXT NOT NULL) STRICT;');
    const now=new Date().toISOString();
    this.db.prepare('INSERT OR IGNORE INTO hmo_program(id,tenant_id,instance_id,created_at,body) VALUES(?,?,?,?,?)').run(HEARMEOUT_SINGLE_PROGRAM_ID,binding.tenantId,randomUUID(),now,JSON.stringify(this.empty(now,HEARMEOUT_SINGLE_PROGRAM_ID)));
    this.db.exec(`CREATE TABLE IF NOT EXISTS hmo_program_rooms(id TEXT PRIMARY KEY,name TEXT NOT NULL,created_at TEXT NOT NULL,source_room_id TEXT) STRICT;
      CREATE UNIQUE INDEX IF NOT EXISTS hmo_program_source_room ON hmo_program_rooms(source_room_id) WHERE source_room_id IS NOT NULL;
      CREATE TABLE IF NOT EXISTS hmo_program_channels(guild_id TEXT NOT NULL,channel_id TEXT NOT NULL,program_id TEXT NOT NULL,PRIMARY KEY(guild_id,channel_id)) STRICT;
      CREATE TABLE IF NOT EXISTS hmo_program_room_operations(id TEXT PRIMARY KEY,intent TEXT NOT NULL,program_id TEXT NOT NULL) STRICT;`);
    this.db.prepare('INSERT OR IGNORE INTO hmo_program_rooms(id,name,created_at) SELECT id,?,created_at FROM hmo_program WHERE id=?').run('Main watch party',HEARMEOUT_SINGLE_PROGRAM_ID);
    if(this.db.prepare('SELECT tenant_id FROM hmo_program WHERE id=?').get(HEARMEOUT_SINGLE_PROGRAM_ID)?.tenant_id!==binding.tenantId)throw Error('Stored broadcast belongs to a different deployment binding');
  }
  listRooms():HearMeOutPartyRoom[]{return this.db.prepare('SELECT * FROM hmo_program_rooms ORDER BY created_at,id').all().map(row=>this.roomFromRow(row));}
  getRoom(roomId:string):HearMeOutPartyRoom{const row=this.db.prepare('SELECT * FROM hmo_program_rooms WHERE id=?').get(roomId);if(!row)throw Object.assign(Error('Watch party not found'),{status:404});return this.roomFromRow(row);}
  private roomFromRow(row:Record<string,unknown>):HearMeOutPartyRoom{return {roomId:String(row.id),name:String(row.name),createdAt:String(row.created_at),...(row.source_room_id?{sourceRoomId:String(row.source_room_id)}:{})};}
  private insertRoom(roomId:string,name:string,sourceRoomId?:string){
    const now=new Date().toISOString();
    this.db.prepare('INSERT OR IGNORE INTO hmo_program(id,tenant_id,instance_id,created_at,body) VALUES(?,?,?,?,?)').run(roomId,this.binding.tenantId,randomUUID(),now,JSON.stringify(this.empty(now,roomId)));
    this.db.prepare('INSERT OR IGNORE INTO hmo_program_rooms(id,name,created_at,source_room_id) VALUES(?,?,?,?)').run(roomId,name,now,sourceRoomId??null);
    return this.getRoom(roomId);
  }
  ensureAppRoom(tenantId:string,roomId:string,name:string){
    if(tenantId!==this.binding.tenantId)throw Error('Watch party belongs to another deployment');
    const id='room-'+createHash('sha256').update(JSON.stringify([tenantId,roomId])).digest('hex');
    return this.transaction(()=>this.hostedRoom(roomId)??this.insertRoom(id,name,roomId));
  }
  hostedRoom(sourceRoomId:string){const row=this.db.prepare('SELECT * FROM hmo_program_rooms WHERE source_room_id=?').get(sourceRoomId);return row?this.roomFromRow(row):undefined;}
  channelRoom(channel:HearMeOutPartyChannel){
    validateChannel(channel);
    const row=this.db.prepare('SELECT program_id FROM hmo_program_channels WHERE guild_id=? AND channel_id=?').get(channel.guildId,channel.channelId);
    return row?this.getRoom(String(row.program_id)):undefined;
  }
  private bindChannel(roomId:string,channel:HearMeOutPartyChannel){
    validateChannel(channel);
    this.db.prepare('INSERT OR IGNORE INTO hmo_program_channels(guild_id,channel_id,program_id) VALUES(?,?,?)').run(channel.guildId,channel.channelId,roomId);
    return this.channelRoom(channel)!;
  }
  createRoom(input:{name:string;requesterId:string;operationId:string;channel?:HearMeOutPartyChannel;sourceRoomId?:string}){
    if(input.channel&&input.sourceRoomId)throw Error('Choose one hosting room');
    const name=input.name.trim();if(!name||name.length>120||/[\r\n\0]/.test(name))throw Error('Enter a party name up to 120 characters');
    if(!input.requesterId||!input.operationId||input.operationId.length>200)throw Error('Invalid room request key');
    const id=createHash('sha256').update(JSON.stringify([input.requesterId,input.operationId])).digest('hex'),intent=JSON.stringify([name,input.channel??null,input.sourceRoomId??null]);
    return this.transaction(()=>{
      const previous=this.db.prepare('SELECT intent,program_id FROM hmo_program_room_operations WHERE id=?').get(id);
      if(previous){if(previous.intent!==intent)throw Error('This request key already belongs to another party');return this.getRoom(String(previous.program_id));}
      const occupied=input.channel?this.channelRoom(input.channel):input.sourceRoomId?this.hostedRoom(input.sourceRoomId):undefined;
      const room=occupied??this.insertRoom('party-'+id,name,input.sourceRoomId);
      if(input.channel)this.bindChannel(room.roomId,input.channel);
      this.db.prepare('INSERT INTO hmo_program_room_operations(id,intent,program_id) VALUES(?,?,?)').run(id,intent,room.roomId);
      return room;
    });
  }
  // Watching never changes voice membership or a room's hosting assignment.
  joinRoom(roomId:string){return this.getRoom(roomId);}
  close(){this.db.close();}
  private empty(now:string,roomId:string):HearMeOutMediaSessionV1{return {schemaVersion:1,tenantId:this.binding.tenantId,roomId,sessionId:roomId,lane:'movie',current:null,queue:[],playback:{status:'idle',position:0,updatedAt:now,muted:false,volume:100},revision:0};}
  private transaction<T>(run:()=>T):T{this.db.exec('BEGIN IMMEDIATE');try{const result=run();this.db.exec('COMMIT');return result;}catch(error){this.db.exec('ROLLBACK');throw error;}}
  private read(roomId=HEARMEOUT_SINGLE_PROGRAM_ID):HearMeOutMediaSessionV1{const row=this.db.prepare('SELECT body FROM hmo_program WHERE id=? AND tenant_id=?').get(roomId,this.binding.tenantId);if(!row)throw Object.assign(Error('Watch party not found'),{status:404});return JSON.parse(String(row.body));}
  private write(session:HearMeOutMediaSessionV1){this.db.prepare('UPDATE hmo_program SET body=? WHERE id=?').run(JSON.stringify(session),session.roomId);}
  getSession(tenant=this.binding.tenantId,roomId=HEARMEOUT_SINGLE_PROGRAM_ID,_lane?:HearMeOutMediaLaneV1){if(tenant!==this.binding.tenantId)throw Error('Watch party belongs to another deployment');return this.read(roomId);}
  getBroadcastIdentity(tenant:string,scope:string){if(tenant!==this.binding.tenantId)return undefined;const row=this.db.prepare('SELECT instance_id,created_at FROM hmo_program WHERE id=?').get(scope);if(!row)return undefined;return {instanceId:String(row.instance_id),createdAt:String(row.created_at)};}
  broadcastSessions(){return this.sessions().filter(session=>session.current);}
  private sessions(){return this.db.prepare('SELECT body FROM hmo_program WHERE tenant_id=? ORDER BY created_at,id').all(this.binding.tenantId).map(row=>JSON.parse(String(row.body)) as HearMeOutMediaSessionV1);}
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
    const roomId=input.roomId??HEARMEOUT_SINGLE_PROGRAM_ID;this.read(roomId);
    const lane=input.lane??'movie';if(lane!=='music'&&lane!=='movie')throw Error('Choose music or movie');
    const query=input.query.trim();if(!query||query.length>300)throw Error('Enter a video link or title');
    const id=createHash('sha256').update(JSON.stringify(roomId===HEARMEOUT_SINGLE_PROGRAM_ID?[input.requesterId,input.operationId]:[roomId,input.requesterId,input.operationId])).digest('hex'),intent=JSON.stringify(input.selectedItemId?[input.requesterId,query,lane,input.selectedItemId]:lane==='movie'?[input.requesterId,query]:[input.requesterId,query,lane]);
    const replay=()=>{const prior=this.db.prepare('SELECT intent,request_id FROM hmo_program_requests WHERE id=?').get(id);if(prior&&prior.intent!==intent)throw Error('This request key already belongs to another video');return prior;};
    if(replay())return this.read(roomId);
    // Viewer attribution is separate from the existing operator execution account.
    const item=await media.resolve({tenantId:this.binding.tenantId,billedUserId:this.binding.executionUserId,requesterId:input.requesterId,query,lane,...(input.selectedItemId?{selectedItemId:input.selectedItemId}:{}),operationId:'broadcast:'+id});
    validateItem(item);
    return this.transaction(()=>{if(replay())return this.read(roomId);const session=this.read(roomId),at=new Date().toISOString(),entry={requestId:'broadcast-request:'+id,requestedBy:{userId:input.requesterId,displayName:input.displayName.slice(0,120)||'Viewer'},addedAt:at,item};
      if(session.current)session.queue.push(entry);else{session.current=entry;session.playback={...session.playback,status:'playing',position:0,updatedAt:at};}
      session.revision++;this.write(session);this.db.prepare('INSERT INTO hmo_program_requests(id,intent,request_id) VALUES(?,?,?)').run(id,intent,entry.requestId);return session;
    });
  }
  control(principal:HearMeOutPrincipalV1,input:{roomId?:string;action:string;position?:number;expectedRequestId?:string}){
    if(principal.tenantId!==this.binding.tenantId)throw Error('Broadcast belongs to another deployment');
    // Testing policy: every viewer may skip or clear upcoming requests.
    // No viewer, including the original requester, owns the broadcast clock.
    if(!['next','skip','clear'].includes(input.action))throw Error('Broadcasts support only skip and clear queue; playback cannot be paused or stopped');
    return this.transaction(()=>{const session=this.read(input.roomId);
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

function validateChannel(channel:HearMeOutPartyChannel){if(!/^\d{5,30}$/.test(channel.guildId)||!/^\d{5,30}$/.test(channel.channelId))throw Error("Invalid Discord channel");}
