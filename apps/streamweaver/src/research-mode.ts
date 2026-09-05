import {DatabaseSync} from 'node:sqlite';
import type {AssistantResearchOptionsV1,AssistantResearchRequestV1} from '@spmt/contracts';
export function streamWeaverResearchIntent(message:string):{kind:'none'}|{kind:'arm'}|{kind:'query';query:string}{
 const question=message.trim().match(/^(?:i\s+(?:have|got)\s+(?:a\s+)?question|can\s+i\s+ask\s+(?:you\s+)?(?:a\s+)?question)\b[\s,:;.!?-]*(.*)$/i);if(question)return question[1]!.trim().length>=3?{kind:'query',query:question[1]!.trim()}:{kind:'arm'};
 const search=message.trim().match(/^(?:please\s+)?(?:research|look\s+up|search(?:\s+for)?|find\s+out\s+about)\b[\s,:;.!?-]*(.+)$/i);return search?{kind:'query',query:search[1]!.trim()}:{kind:'none'};
}
export class StreamWeaverResearchConversation {
 private readonly db:DatabaseSync;
 constructor(path:string,private readonly settings:(tenantId:string)=>AssistantResearchOptionsV1,private readonly now:()=>number=Date.now){this.db=new DatabaseSync(path,{timeout:5000});this.db.exec('CREATE TABLE IF NOT EXISTS streamweaver_research_pending(scope TEXT PRIMARY KEY,expires_at INTEGER NOT NULL) STRICT; CREATE TABLE IF NOT EXISTS streamweaver_research_receipts(scope TEXT NOT NULL,request_id TEXT NOT NULL,body TEXT NOT NULL,expires_at INTEGER NOT NULL,PRIMARY KEY(scope,request_id)) STRICT;');}
 close(){this.db.close();}
 private scope(tenantId:string,provider:string,channelId:string,userId:string){return JSON.stringify([tenantId,provider,channelId,userId]);}
 pending(tenantId:string,provider:string,channelId:string,userId:string){return this.settings(tenantId).enabled&&Boolean(this.db.prepare('SELECT 1 FROM streamweaver_research_pending WHERE scope=? AND expires_at>?').get(this.scope(tenantId,provider,channelId,userId),this.now()));}
 resumable(tenantId:string,provider:string,channelId:string,userId:string,requestId:string){const row=this.db.prepare('SELECT body FROM streamweaver_research_receipts WHERE scope=? AND request_id=? AND expires_at>?').get(this.scope(tenantId,provider,channelId,userId),requestId,this.now()) as {body:string}|undefined;return this.settings(tenantId).enabled&&Boolean(row&&JSON.parse(row.body).research);}
 prepare(input:{tenantId:string;provider:string;channelId:string;userId:string;message:string;idempotencyKey:string}):{reply?:string;research?:AssistantResearchRequestV1}{
  const settings=this.settings(input.tenantId);if(!settings.enabled)return {};const scope=this.scope(input.tenantId,input.provider,input.channelId,input.userId);
  this.db.exec('BEGIN IMMEDIATE');try{
   this.db.prepare('DELETE FROM streamweaver_research_pending WHERE expires_at<=?').run(this.now());this.db.prepare('DELETE FROM streamweaver_research_receipts WHERE expires_at<=?').run(this.now());
   const prior=this.db.prepare('SELECT body FROM streamweaver_research_receipts WHERE scope=? AND request_id=?').get(scope,input.idempotencyKey) as {body:string}|undefined;if(prior){this.db.exec('COMMIT');return JSON.parse(prior.body);}
   const intent=streamWeaverResearchIntent(input.message);let result:{reply?:string;research?:AssistantResearchRequestV1}={};
   if(intent.kind==='arm'){this.db.prepare('INSERT OR REPLACE INTO streamweaver_research_pending VALUES(?,?)').run(scope,this.now()+120000);result={reply:'What would you like me to research?'};}
   else if(intent.kind==='query'||this.pending(input.tenantId,input.provider,input.channelId,input.userId)){const query=intent.kind==='query'?intent.query:input.message.trim();if(query.length>2000)throw new Error('Research questions may contain up to 2000 characters');this.db.prepare('DELETE FROM streamweaver_research_pending WHERE scope=?').run(scope);result={research:{...settings,query}};}
   this.db.prepare('INSERT INTO streamweaver_research_receipts VALUES(?,?,?,?)').run(scope,input.idempotencyKey,JSON.stringify(result),this.now()+3600000);this.db.exec('COMMIT');return result;
  }catch(error){this.db.exec('ROLLBACK');throw error;}
 }
}
