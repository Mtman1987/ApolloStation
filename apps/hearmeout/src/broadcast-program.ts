import {DatabaseSync} from 'node:sqlite';
import {randomUUID,createHash} from 'node:crypto';
import type {HearMeOutMediaItemV1,HearMeOutMediaSessionV1,HearMeOutPrincipalV1,HearMeOutMediaLaneV1} from './room-media-core.js';
import type {HearMeOutSuiteMediaResolverV1} from './suite-action-executor.js';

export const HEARMEOUT_SINGLE_PROGRAM_ID='main-broadcast';
export interface HearMeOutProgramBinding {tenantId:string;executionUserId:string;}

/** One durable program. There are no room or membership records, foreign keys,
 * room expiry timers, or viewer leases here. The existing encoder consumes the
 * same media-session contract; its historical roomId field carries a program
 * reference, never a real or hidden room. */
export class HearMeOutBroadcastProgram {
  private readonly db:DatabaseSync;
  constructor(path:string,readonly binding:HearMeOutProgramBinding){
    if(!binding.tenantId||!binding.executionUserId)throw Error('Broadcast execution binding is incomplete');
    this.db=new DatabaseSync(path,{timeout:5000});
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;');
    this.db.exec('CREATE TABLE IF NOT EXISTS hmo_program(id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,instance_id TEXT NOT NULL,created_at TEXT NOT NULL,body TEXT NOT NULL,lease_owner TEXT,lease_until TEXT) STRICT; CREATE TABLE IF NOT EXISTS hmo_program_requests(id TEXT PRIMARY KEY,intent TEXT NOT NULL,request_id TEXT NOT NULL) STRICT;');
    const now=new Date().toISOString();
    this.db.prepare('INSERT OR IGNORE INTO hmo_program(id,tenant_id,instance_id,created_at,body) VALUES(?,?,?,?,?)').run(HEARMEOUT_SINGLE_PROGRAM_ID,binding.tenantId,randomUUID(),now,JSON.stringify(this.empty(now)));
    if(this.db.prepare('SELECT tenant_id FROM hmo_program WHERE id=?').get(HEARMEOUT_SINGLE_PROGRAM_ID)?.tenant_id!==binding.tenantId)throw Error('Stored broadcast belongs to a different deployment binding');
  }
  close(){this.db.close();}
  private empty(now:string):HearMeOutMediaSessionV1{return {schemaVersion:1,tenantId:this.binding.tenantId,roomId:HEARMEOUT_SINGLE_PROGRAM_ID,sessionId:HEARMEOUT_SINGLE_PROGRAM_ID,lane:'movie',current:null,queue:[],playback:{status:'idle',position:0,updatedAt:now,muted:false,volume:100},revision:0};}
  private transaction<T>(run:()=>T):T{this.db.exec('BEGIN IMMEDIATE');try{const result=run();this.db.exec('COMMIT');return result;}catch(error){this.db.exec('ROLLBACK');throw error;}}
  private read():HearMeOutMediaSessionV1{return JSON.parse(String(this.db.prepare('SELECT body FROM hmo_program WHERE id=?').get(HEARMEOUT_SINGLE_PROGRAM_ID)!.body));}
  private write(session:HearMeOutMediaSessionV1){this.db.prepare('UPDATE hmo_program SET body=? WHERE id=?').run(JSON.stringify(session),HEARMEOUT_SINGLE_PROGRAM_ID);}
  getSession(_tenant?:string,_scope?:string,_lane?:HearMeOutMediaLaneV1){return this.read();}
  getBroadcastIdentity(tenant:string,scope:string){if(tenant!==this.binding.tenantId||scope!==HEARMEOUT_SINGLE_PROGRAM_ID)return undefined;const row=this.db.prepare('SELECT instance_id,created_at FROM hmo_program WHERE id=?').get(scope)!;return {instanceId:String(row.instance_id),createdAt:String(row.created_at)};}
  broadcastSessions(){const session=this.read();return session.current?[session]:[];}
  claimBroadcast(tenant:string,scope:string,_lane:HearMeOutMediaLaneV1,owner:string,now=new Date().toISOString()){
    if(!this.getBroadcastIdentity(tenant,scope))return false;
    return this.db.prepare('UPDATE hmo_program SET lease_owner=?,lease_until=? WHERE id=? AND (lease_owner IS NULL OR lease_owner=? OR lease_until<=?)').run(owner,new Date(Date.parse(now)+30000).toISOString(),scope,owner,now).changes===1;
  }
  releaseBroadcast(_tenant:string,scope:string,_lane:HearMeOutMediaLaneV1,owner:string){this.db.prepare('UPDATE hmo_program SET lease_owner=NULL,lease_until=NULL WHERE id=? AND lease_owner=?').run(scope,owner);}
  advance(now=new Date().toISOString()){
    return this.transaction(()=>{const session=this.read();if(session.playback.status!=='playing')return false;
      let elapsed=session.playback.position+Math.max(0,(Date.parse(now)-Date.parse(session.playback.updatedAt))/1000),changed=false;
      while(session.current&&session.current.item.type!=='live'&&session.current.item.durationSeconds&&elapsed>=session.current.item.durationSeconds){elapsed-=session.current.item.durationSeconds;session.current=session.queue.shift()??null;changed=true;}
      if(changed){session.playback={...session.playback,status:session.current?'playing':'idle',position:session.current?elapsed:0,updatedAt:now};session.revision++;this.write(session);}return changed;
    });
  }
  finishBroadcastRequest(_tenant:string,_scope:string,_lane:HearMeOutMediaLaneV1,requestId:string){
    return this.transaction(()=>{const session=this.read();if(session.current?.requestId!==requestId||session.playback.status!=='playing')return false;this.next(session);this.write(session);return true;});
  }
  private next(session:HearMeOutMediaSessionV1){session.current=session.queue.shift()??null;session.playback={...session.playback,status:session.current?'playing':'idle',position:0,updatedAt:new Date().toISOString()};session.revision++;}
  async searchMovies(query:string,requesterId:string,media:HearMeOutSuiteMediaResolverV1){
    if(!media.searchMovies)throw Error('The IPTV movie search is unavailable');
    return media.searchMovies({tenantId:this.binding.tenantId,billedUserId:this.binding.executionUserId,requesterId,query});
  }
  async request(input:{requesterId:string;displayName:string;query:string;operationId:string;lane?:HearMeOutMediaLaneV1;selectedItemId?:string;browserPreparation?:boolean},media:HearMeOutSuiteMediaResolverV1){
    const lane=input.lane??'movie';if(lane!=='music'&&lane!=='movie')throw Error('Choose music or movie');
    const query=input.query.trim();if(!query||query.length>300)throw Error('Enter a video link or title');
    const id=createHash('sha256').update(JSON.stringify([input.requesterId,input.operationId])).digest('hex'),intent=JSON.stringify(input.selectedItemId?[input.requesterId,query,lane,input.selectedItemId]:lane==='movie'?[input.requesterId,query]:[input.requesterId,query,lane]);
    const replay=()=>{const prior=this.db.prepare('SELECT intent,request_id FROM hmo_program_requests WHERE id=?').get(id);if(prior&&prior.intent!==intent)throw Error('This request key already belongs to another video');return prior;};
    if(replay())return this.read();
    // Viewer attribution is separate from the existing operator execution account.
    const item=await media.resolve({tenantId:this.binding.tenantId,billedUserId:this.binding.executionUserId,requesterId:input.requesterId,query,lane,...(input.browserPreparation?{browserPreparation:true}:{}),...(input.selectedItemId?{selectedItemId:input.selectedItemId}:{}),operationId:'broadcast:'+id});
    validateItem(item);
    return this.transaction(()=>{if(replay())return this.read();const session=this.read(),at=new Date().toISOString(),entry={requestId:'broadcast-request:'+id,requestedBy:{userId:input.requesterId,displayName:input.displayName.slice(0,120)||'Viewer'},addedAt:at,item};
      if(session.current)session.queue.push(entry);else{session.current=entry;session.playback={...session.playback,status:'playing',position:0,updatedAt:at};}
      session.revision++;this.write(session);this.db.prepare('INSERT INTO hmo_program_requests(id,intent,request_id) VALUES(?,?,?)').run(id,intent,entry.requestId);return session;
    });
  }
  control(principal:HearMeOutPrincipalV1,input:{action:string;position?:number;expectedRequestId?:string}){
    if(principal.tenantId!==this.binding.tenantId)throw Error('Broadcast belongs to another deployment');
    // Testing policy: every viewer may skip or clear upcoming requests.
    // No viewer, including the original requester, owns the broadcast clock.
    if(!['next','skip','clear'].includes(input.action))throw Error('Broadcasts support only skip and clear queue; playback cannot be paused or stopped');
    return this.transaction(()=>{const session=this.read();
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
