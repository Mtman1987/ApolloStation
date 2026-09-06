import {createHash,randomBytes,timingSafeEqual} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import type {CommlinkLiveChatRecordV1} from '@spmt/contracts';
const first=(...v:unknown[])=>v.find(x=>typeof x==='string'&&x.trim()||typeof x==='number')?.toString().trim()??'';
const hash=(v:string)=>createHash('sha256').update(v).digest('hex');
function plain(v:unknown,max=2000){return String(v??'').replace(/<img\b[^>]*\balt=["']([^"']*)["'][^>]*>/gi,'$1').replace(/<[^>]*>/g,'').replace(/&(?:amp|lt|gt|quot|apos|#39);/g,v=>({'&amp;':'&','&lt;':'<','&gt;':'>','&quot;':'"','&apos;':"'",'&#39;':"'"}[v]!)).replace(/\0/g,'').slice(0,max)}
function safeUrl(v:unknown){try{const u=new URL(String(v));return u.protocol==='https:'&&!u.username&&!u.password&&u.href.length<=2048?u.href:undefined}catch{return undefined}}
/** Mirrored display names never become verified identities, moderator roles or reply destinations. */
export function normalizeSocialStream(input:unknown,tenantId:string,now=Date.now()){
 if(!input||typeof input!=='object'||Array.isArray(input))throw Error('Social Stream input must be an object');const b=input as Record<string,any>;const visibility=b.private===true||b.isPrivate===true||['private','dm'].includes(String(b.visibility??b.scope??'').toLowerCase())?'private':'public';const meta=b.meta&&typeof b.meta==='object'?b.meta:{};
 const source=plain(first(b.platform,b.source,b.type,meta.source,'social-stream'),100),channelId=hash(first(b.channelId,b.roomId,b.videoId,b.channelName,b.channel,source)),upstream=first(b.id,b.mid,b.messageId,meta.id)||hash(JSON.stringify(b));
 const attachments:Array<{url:string;name:string}>=[];for(const item of [b.contentimg,b.image,b.media,...(Array.isArray(b.attachments)?b.attachments:[])].slice(0,12)){const url=safeUrl(typeof item==='object'&&item?item.url||item.src||item.contentimg:item);if(url)attachments.push({url,name:plain(item?.filename||item?.name||'Attachment',150)})}
 const rawEvent=first(b.event,b.eventType).toLowerCase(),operation=rawEvent.includes('delete')?'delete':rawEvent.includes('edit')?'edit':'message',donation=plain(first(b.hasDonation,b.donation?.display,b.donation?.text,b.donation?.amount,b.amount),100),membership=plain(first(b.membership,b.membershipTier),100),eventType=operation!=='message'?operation:donation?'donation':membership?'membership':'message';
 const text=plain(first(b.chatmessage,b.message,b.text,b.comment,b.event,b.hasDonation));if(!text&&!attachments.length&&!donation&&!membership&&operation==='message')throw Error('Social Stream message is empty');
 const rawTime=first(b.timestamp,b.time,b.createdAt,meta.timestamp),number=Number(rawTime),date=new Date(rawTime?(Number.isFinite(number)?number<1e10?number*1000:number:rawTime):now),occurredAt=Number.isFinite(date.getTime())?date.toISOString():new Date(now).toISOString();
 const username=plain(first(b.chatname,b.name,b.username,b.displayName,meta.username,'Social Stream user'),150);
 const record:CommlinkLiveChatRecordV1={schemaVersion:1,tenantId,provider:'social-stream',connectionId:'social-stream',channelId,messageId:hash(JSON.stringify([source,channelId,upstream])),occurredAt,text:text||donation||membership||'[Attachment]',providerUserId:hash(first(b.userid,b.userId,b.chatid,username)),username,displayName:username,isBot:false,roles:[],rich:{source,eventType,attachments,...(donation?{donation}:{}),...(membership?{membership}:{})}};
 return {record,visibility,operation:operation as 'message'|'edit'|'delete',receipt:hash(JSON.stringify(b))};
}
export class CommlinkSocialStreamStore {
 private readonly db:DatabaseSync;
 constructor(path:string){this.db=new DatabaseSync(path,{timeout:5000});this.db.exec('CREATE TABLE IF NOT EXISTS commlink_social_stream(tenant TEXT PRIMARY KEY,key_hash TEXT NOT NULL,enabled INTEGER NOT NULL,last_received TEXT,accepted INTEGER NOT NULL DEFAULT 0,failed INTEGER NOT NULL DEFAULT 0); CREATE TABLE IF NOT EXISTS commlink_social_receipts(tenant TEXT NOT NULL,id TEXT NOT NULL,created INTEGER NOT NULL,PRIMARY KEY(tenant,id)); CREATE TABLE IF NOT EXISTS commlink_social_private(tenant TEXT NOT NULL,id TEXT NOT NULL,body TEXT NOT NULL,created INTEGER NOT NULL,PRIMARY KEY(tenant,id));');}
 sweepPrivate(){this.db.prepare('DELETE FROM commlink_social_private WHERE created<?').run(Date.now()-7*86400000)}
 privateMessages(tenant:string){this.sweepPrivate();return this.db.prepare('SELECT body FROM commlink_social_private WHERE tenant=? ORDER BY created DESC LIMIT 100').all(tenant).map(r=>JSON.parse(String(r.body)) as CommlinkLiveChatRecordV1)}
 clearPrivate(tenant:string){this.db.prepare('DELETE FROM commlink_social_private WHERE tenant=?').run(tenant)}
 ingestPrivate(record:CommlinkLiveChatRecordV1,operation:'message'|'edit'|'delete'){
  const existing=this.db.prepare('SELECT body FROM commlink_social_private WHERE tenant=? AND id=?').get(record.tenantId,record.messageId);
  if(existing&&operation==='message')return {duplicate:true};
  const value=operation==='delete'?{...record,text:'[Message removed]',rich:{...record.rich,attachments:[],deleted:true}}:record;
  this.db.prepare('INSERT INTO commlink_social_private VALUES(?,?,?,?) ON CONFLICT(tenant,id) DO UPDATE SET body=excluded.body').run(record.tenantId,record.messageId,JSON.stringify(value),Date.now());
  this.db.prepare('DELETE FROM commlink_social_private WHERE tenant=? AND id NOT IN(SELECT id FROM commlink_social_private WHERE tenant=? ORDER BY created DESC LIMIT 100)').run(record.tenantId,record.tenantId);
  return {duplicate:false};
 }
 rotate(tenant:string){const token='ss_'+randomBytes(32).toString('base64url');this.db.prepare('INSERT INTO commlink_social_stream(tenant,key_hash,enabled) VALUES(?,?,1) ON CONFLICT(tenant) DO UPDATE SET key_hash=excluded.key_hash,enabled=1').run(tenant,hash(token));return token}
 disable(tenant:string){this.db.prepare('UPDATE commlink_social_stream SET enabled=0 WHERE tenant=?').run(tenant)}
 authorize(tenant:string,token:string){const row=this.db.prepare('SELECT key_hash,enabled FROM commlink_social_stream WHERE tenant=?').get(tenant);return Boolean(row&&row.enabled===1&&timingSafeEqual(Buffer.from(String(row.key_hash),'hex'),Buffer.from(hash(token),'hex')))}
 status(tenant:string){return this.db.prepare('SELECT enabled,last_received AS lastReceivedAt,accepted,failed FROM commlink_social_stream WHERE tenant=?').get(tenant)??{enabled:0,lastReceivedAt:null,accepted:0,failed:0}}
 hasReceipt(tenant:string,id:string){return Boolean(this.db.prepare('SELECT 1 FROM commlink_social_receipts WHERE tenant=? AND id=?').get(tenant,id))}
 received(tenant:string,id:string){const prior=this.db.prepare('SELECT 1 FROM commlink_social_receipts WHERE tenant=? AND id=?').get(tenant,id);if(prior)return false;this.db.prepare('INSERT INTO commlink_social_receipts VALUES(?,?,?)').run(tenant,id,Date.now());this.db.prepare('UPDATE commlink_social_stream SET last_received=?,accepted=accepted+1 WHERE tenant=?').run(new Date().toISOString(),tenant);this.db.prepare('DELETE FROM commlink_social_receipts WHERE tenant=? AND id NOT IN(SELECT id FROM commlink_social_receipts WHERE tenant=? ORDER BY created DESC LIMIT 10000)').run(tenant,tenant);return true}
 failed(tenant:string){this.db.prepare('UPDATE commlink_social_stream SET failed=failed+1 WHERE tenant=?').run(tenant)}
 close(){this.db.close()}
}
