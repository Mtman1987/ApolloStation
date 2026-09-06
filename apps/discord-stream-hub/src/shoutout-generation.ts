import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import type {SpmtClient} from '@spmt/sdk';
import type {DshShoutoutView} from './shoutout-presentation.js';
type Client=Pick<SpmtClient,'invokeCommunityAssistant'|'getExecutionJob'>;
interface Generation {tenantId:string;requestId:string;actorId:string;login:string;eventId:string;prompt:string;jobId?:string;attempt:number;state:string;message?:string;error?:string;createdAt:string;}
const key=(value:string)=>createHash('sha256').update(value).digest('hex');
const comparable=(value:string)=>value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
export class DshShoutoutGenerationStore {
  private db:DatabaseSync;
  constructor(path:string,private now=()=>new Date().toISOString()) {this.db=new DatabaseSync(path,{timeout:5000});this.db.exec('PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS dsh_shoutout_generation(tenant_id TEXT NOT NULL,request_id TEXT NOT NULL,login TEXT NOT NULL,event_id TEXT NOT NULL,created_at TEXT NOT NULL,body TEXT NOT NULL,PRIMARY KEY(tenant_id,request_id)) STRICT; CREATE INDEX IF NOT EXISTS dsh_shoutout_generation_latest ON dsh_shoutout_generation(tenant_id,login,event_id,created_at); CREATE TABLE IF NOT EXISTS dsh_shoutout_copy(tenant_id TEXT NOT NULL,login TEXT NOT NULL,fingerprint TEXT NOT NULL,request_id TEXT NOT NULL,PRIMARY KEY(tenant_id,login,fingerprint)) STRICT;');}
  close(){this.db.close();}
  private save(row:Generation){this.db.prepare('INSERT INTO dsh_shoutout_generation VALUES(?,?,?,?,?,?) ON CONFLICT(tenant_id,request_id) DO UPDATE SET body=excluded.body').run(row.tenantId,row.requestId,row.login,row.eventId,row.createdAt,JSON.stringify(row));}
  private get(tenant:string,id:string):Generation|undefined{const row=this.db.prepare('SELECT body FROM dsh_shoutout_generation WHERE tenant_id=? AND request_id=?').get(tenant,id) as {body:string}|undefined;return row?JSON.parse(row.body):undefined;}
  private history(tenant:string,login:string){return(this.db.prepare('SELECT body FROM dsh_shoutout_generation WHERE tenant_id=? AND login=? ORDER BY created_at DESC,rowid DESC LIMIT 12').all(tenant,login) as {body:string}[]).map(row=>JSON.parse(row.body) as Generation);}
  private claimCopy(row:Generation,message:string){
    const fingerprint=key(comparable(message));
    this.db.prepare('INSERT INTO dsh_shoutout_copy VALUES(?,?,?,?) ON CONFLICT DO NOTHING').run(row.tenantId,row.login,fingerprint,row.requestId);
    return (this.db.prepare('SELECT request_id FROM dsh_shoutout_copy WHERE tenant_id=? AND login=? AND fingerprint=?').get(row.tenantId,row.login,fingerprint) as {request_id:string}).request_id===row.requestId;
  }
  async start(tenant:string,actorId:string,view:DshShoutoutView,requestId:string,client:Client){
    let row=this.get(tenant,requestId);
    if(row&&(row.login!==view.twitchLogin||row.eventId!==view.id))throw new Error('A shoutout request cannot be reused for another creator or event');
    if(!row){const previous=this.history(tenant,view.twitchLogin).flatMap(row=>row.message?[row.message]:[]).slice(0,5);
      row={tenantId:tenant,requestId,actorId,login:view.twitchLogin,eventId:view.id,attempt:0,state:'pending',createdAt:this.now(),prompt:`Write one new, personal shoutout for ${view.displayName} (@${view.twitchLogin}). Use only these public facts: ${JSON.stringify({group:view.group,title:view.title,game:view.gameName,viewers:view.viewerCount})}. Write 2 short, natural sentences directly to the community, with a specific invitation to this stream. Space Mountain is a space-exploration community. Vary the opening, phrasing and imagery. Do not invent biography, achievements, relationships or stream activity. Output only the message, no labels or analysis. Previous messages to avoid repeating: ${JSON.stringify(previous)}. Unique shoutout: ${requestId}.`};this.save(row);}
    if(!row.jobId)await this.invoke(row,client);
    return this.public(row);
  }
  private async invoke(row:Generation,client:Client){const result=await client.invokeCommunityAssistant(row.tenantId,{userId:row.actorId,message:row.prompt,surface:'app',remember:false,routingPreference:'automatic',presentation:{personaId:'dsh-shoutout-writer',displayName:'Shoutout writer',instructions:'Write factual, fresh creator shoutouts from the supplied public stream details. Return only the requested copy. Never use private conversation memory.',memoryPolicy:'off'}},`dsh-shoutout:${key(row.tenantId+':'+row.requestId)}:${row.attempt}`);if(result.status!=='accepted'){row.state='failed';row.error=result.reason;this.save(row);return;}row.jobId=result.jobId;row.state='pending';delete row.error;this.save(row);}
  async latest(tenant:string,view:DshShoutoutView,client?:Client){
    const result=this.db.prepare('SELECT body FROM dsh_shoutout_generation WHERE tenant_id=? AND login=? AND event_id=? ORDER BY created_at DESC,rowid DESC LIMIT 1').get(tenant,view.twitchLogin,view.id) as {body:string}|undefined;if(!result)return;
    const row=JSON.parse(result.body) as Generation;
    if(row.state==='pending'&&client){
      try{
        // Admission can succeed remotely before its response is lost. Recover the
        // persisted attempt with the same idempotency key, including after restart.
        if(!row.jobId){await this.invoke(row,client);return this.public(row);}
        const job=await client.getExecutionJob(tenant,row.jobId);if(job.billedUserId!==row.actorId||job.input.callerAppId!=='discord-stream-hub'){row.state='failed';row.error='The assistant returned a message for a different request.';this.save(row);return this.public(row);}
        if(job.state==='succeeded'){const message=String(job.result?.text??'').trim().slice(0,1000),repeated=Boolean(message)&&!this.claimCopy(row,message);
          if(!message){row.state='failed';row.error='The assistant returned no shoutout message. Generate again to retry.';this.save(row);return this.public(row);}
          if(repeated&&row.attempt<2){row.attempt++;delete row.jobId;row.prompt+=`\nDo not repeat this rejected copy: ${message}. Use a completely different opening and wording.`;this.save(row);await this.invoke(row,client);}
          else if(repeated){row.state='failed';row.error='The assistant repeated an earlier message. Generate again for fresh copy.';this.save(row);}
          else{row.state='ready';row.message=message;delete row.error;this.save(row);}
        }else if(['failed','dead-letter','cancelled'].includes(job.state)){row.state='failed';row.error='The message could not be generated. Try again.';this.save(row);}
      }catch(error){return{state:'pending',error:'Generation status is temporarily unavailable. Refresh to retry.'};}
    }
    return this.public(row);
  }
  private public(row:Generation){return{state:row.state,...(row.message?{message:row.message}:{}),...(row.error?{error:row.error}:{} )};}
}
