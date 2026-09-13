import { randomUUID } from 'node:crypto';
import type { SpmtClient } from '@spmt/sdk';
import type { SqliteHearMeOutRoomMediaRuntime } from './room-media-core.js';
import type { HearMeOutSuiteMediaResolverV1 } from './suite-action-executor.js';

/** A room-owned policy over the existing queue; browser count never adds DJ loops. */
export class HearMeOutAutoRadio {
  constructor(private readonly rooms:SqliteHearMeOutRoomMediaRuntime,private readonly media:HearMeOutSuiteMediaResolverV1,private readonly options:{now?:()=>string;recommend?:(input:{tenantId:string;userId:string;seed:string;recent:string[]})=>Promise<string>}={}){}
  async tick(){
    for(const {tenantId,roomId,state} of this.rooms.radioRooms()){
      const now=this.now();if(!this.rooms.getRoom(tenantId,roomId,now))continue;
      let session=this.rooms.getSession(tenantId,roomId,'music',now);
      if(session.current&&session.playback.status==='playing'&&session.current.item.durationSeconds){
        const position=session.playback.position+Math.max(0,Date.parse(now)-Date.parse(session.playback.updatedAt))/1000;
        if(position>=session.current.item.durationSeconds)try{session=this.rooms.control(state.principal,{roomId,lane:'music',action:'next',expectedRequestId:session.current.requestId,operationId:'radio-ended:'+session.current.requestId,now});}catch{continue;}
      }
      if(session.queue.length||session.playback.status==='paused')continue;
      const owner=randomUUID();if(!this.rooms.claimRadio(tenantId,roomId,owner,now))continue;
      try{
        const recent=[...state.history.map(item=>item.title),...(session.current?[session.current.item.title]:[])];
        const query=this.options.recommend?await this.options.recommend({tenantId,userId:state.principal.userId,seed:state.seed,recent}):state.seed;
        const item=await this.media.resolve({tenantId,query,lane:'music',operationId:'radio:'+owner,excludeItemIds:[...state.history.map(item=>item.itemId),...(session.current?[session.current.item.itemId]:[])]});
        this.rooms.completeRadio(tenantId,roomId,owner,state.revision,session.revision,item,undefined,this.now());
      }catch(error){this.rooms.completeRadio(tenantId,roomId,owner,state.revision,session.revision,undefined,safe(error),this.now());}
    }
  }
  async run(signal:AbortSignal){while(!signal.aborted){await this.tick();await new Promise<void>(done=>{if(signal.aborted)return done();const finish=()=>{clearTimeout(timer);signal.removeEventListener('abort',finish);done();},timer=setTimeout(finish,5000);signal.addEventListener('abort',finish,{once:true});});}}
  private now(){return(this.options.now??(()=>new Date().toISOString()))();}
}
function safe(error:unknown){return(error instanceof Error?error.message:'Auto-radio could not select a track').replace(/((?:token|authorization|secret|password|cookie))\s*[:=]\s*\S+/gi,'$1=[redacted]').slice(0,500);}

export async function hearMeOutRadioRecommendation(client:Pick<SpmtClient,'invokeCommunityAssistant'|'getExecutionJob'>,input:{tenantId:string;userId:string;seed:string;recent:string[]}){
  const accepted=await client.invokeCommunityAssistant(input.tenantId,{userId:input.userId,message:'Choose one real music recording for this radio theme: '+input.seed+'. Avoid these recently selected tracks: '+JSON.stringify(input.recent.slice(-50))+'. Respond only with JSON {"query":"song title and artist"}.',surface:'app',remember:false,routingPreference:'automatic'},'hmo-radio-recommend:'+randomUUID());
  if(accepted.status!=='accepted'||!accepted.jobId)return input.seed;
  const deadline=Date.now()+30000;let job=await client.getExecutionJob(input.tenantId,accepted.jobId);
  while(!['succeeded','failed','cancelled','dead-letter'].includes(job.state)&&Date.now()<deadline){await new Promise(resolve=>setTimeout(resolve,300));job=await client.getExecutionJob(input.tenantId,accepted.jobId);}
  if(job.state!=='succeeded')return input.seed;
  const text=String(job.result?.text??'');let query:string|undefined;
  try{const fenced=text.trim().split('\n').filter(line=>!line.trim().startsWith(String.fromCharCode(96,96,96))).join('\n');const value=JSON.parse(fenced);if(typeof value.query==='string')query=value.query.trim();}catch{}
  return query&&query.length<=300&&!/[\r\n\0]/.test(query)?query:input.seed;
}
