import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import type {ExecutionJobV1} from '@spmt/contracts';

type Scope={tenantId:string;userId:string;roomId:string};
type Binding={id:string;kind:'reply'|'transcription';input:string;jobId?:string;personaId?:string;displayName?:string;speak?:boolean;speechJobId?:string};
export type RoomAssistantRequest=(path:string,body?:Record<string,unknown>,key?:string)=>Promise<any>;
/** Room admission is checked by the HTTP controller; job ownership is rechecked on every read. */
export class HearMeOutRoomAssistantJobs {
 private readonly db:DatabaseSync;
 constructor(path:string){this.db=new DatabaseSync(path,{timeout:5000});this.db.exec('CREATE TABLE IF NOT EXISTS hmo_assistant_requests(tenant TEXT NOT NULL,user_id TEXT NOT NULL,room TEXT NOT NULL,id TEXT NOT NULL,body TEXT NOT NULL,PRIMARY KEY(tenant,user_id,room,id)) STRICT');}
 close(){this.db.close()}
 deleteRoom(tenant:string,room:string){this.db.prepare('DELETE FROM hmo_assistant_requests WHERE tenant=? AND room=?').run(tenant,room)}
 async submit(scope:Scope,input:{message:string;personaId:string;displayName:string;speak:boolean}|{mediaAssetId:string},key:string,request:RoomAssistantRequest){
  if(!key||key.length>200)throw Error('A request identifier is required');
  const id=createHash('sha256').update(JSON.stringify([scope,key])).digest('hex'),serialized=createHash('sha256').update(JSON.stringify(input)).digest('hex'),prior=this.get(scope,id);
  if(prior&&prior.input!==serialized)throw Error('Request identifier was used for another room request');
  const binding:Binding=prior??{id,kind:'message' in input?'reply':'transcription',input:serialized,...('message' in input?{personaId:input.personaId,displayName:input.displayName,speak:input.speak}:{})};
  this.save(scope,binding);
  if(!binding.jobId){const accepted='message' in input?await request('/v1/assistants/community/invocations',{userId:scope.userId,message:input.message,surface:'app',conversationId:`hearmeout:${scope.roomId}`,routingPreference:'automatic',remember:false},`hmo-reply:${id}`):await request('/v1/assistant/speech/transcribe',{mediaAssetId:input.mediaAssetId},`hmo-transcribe:${id}`);
   binding.jobId=accepted.jobId??accepted.job?.id;if(!binding.jobId)throw Error(accepted.reason??'The assistant did not accept this request');this.save(scope,binding);
  }
  return {requestId:id,jobId:binding.jobId,kind:binding.kind};
 }
 async read(scope:Scope,id:string,request:RoomAssistantRequest,append:(id:string,personaId:string,name:string,text:string)=>void){
  const binding=this.get(scope,id);if(!binding?.jobId)throw Error('Room assistant request was not found');
  const job=await request('/v1/jobs/'+encodeURIComponent(binding.jobId)) as ExecutionJobV1;
  this.requireJob(scope,job,binding.kind==='reply');
  if(job.state!=='succeeded')return {requestId:id,state:job.state,...(['failed','cancelled','dead-letter'].includes(job.state)?{error:'The assistant request could not complete'}:{})};
  if(binding.kind==='transcription')return {requestId:id,state:'succeeded',transcription:String(job.result?.transcription??'')};
  const reply=String(job.result?.text??'');if(!reply.trim())throw Error('The assistant returned no reply');
  append(id,binding.personaId!,binding.displayName!,reply);
  if(!binding.speak)return {requestId:id,state:'succeeded',reply};
  try {
  if(!binding.speechJobId){const accepted=await request('/v1/assistant/speech/synthesize',{text:reply.slice(0,20000)},`hmo-speech:${id}`);binding.speechJobId=accepted.job?.id;if(!binding.speechJobId)throw Error('The speech request was not accepted');this.save(scope,binding)}
  } catch {return {requestId:id,state:'failed',reply,error:'The text reply is ready, but speech is unavailable. Retry this request to resume speech.'};}
  const speech=(await request('/v1/assistant/speech/jobs/'+encodeURIComponent(binding.speechJobId!))).job as ExecutionJobV1;this.requireJob(scope,speech);
  const mediaAssetId=speech.state==='succeeded'?String(speech.result?.mediaAssetId??''):undefined;
  return {requestId:id,state:speech.state,reply,...(mediaAssetId?{audioUrl:'/v1/media/assets/'+encodeURIComponent(mediaAssetId)+'/content?tenantId='+encodeURIComponent(scope.tenantId)}:{}),...(['failed','cancelled','dead-letter'].includes(speech.state)?{error:'The text reply is ready, but speech could not complete'}:{})};
 }
 private requireJob(scope:Scope,job:ExecutionJobV1,reply=false){if(!job||job.tenantId!==scope.tenantId||job.billedUserId!==scope.userId||(reply?(job.ownerAppId!=='stellar-core'||job.input.conversationId!==`hearmeout:${scope.roomId}`):job.ownerAppId!=='hearmeout'))throw Error('Room assistant job was not found')}
 private get(scope:Scope,id:string):Binding|undefined{const row=this.db.prepare('SELECT body FROM hmo_assistant_requests WHERE tenant=? AND user_id=? AND room=? AND id=?').get(scope.tenantId,scope.userId,scope.roomId,id);return row?JSON.parse(String(row.body)):undefined}
 private save(scope:Scope,binding:Binding){this.db.prepare('INSERT INTO hmo_assistant_requests VALUES(?,?,?,?,?) ON CONFLICT(tenant,user_id,room,id) DO UPDATE SET body=excluded.body').run(scope.tenantId,scope.userId,scope.roomId,binding.id,JSON.stringify(binding))}
}
