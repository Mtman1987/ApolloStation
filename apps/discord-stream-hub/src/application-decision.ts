import { createHash, randomUUID } from 'node:crypto';
import { buildDshApplicationDecisionMessage, dshTemplateKey } from './application-flow.js';
import { SqliteDshApplicationStore, type DshApplicationV1 } from './applications.js';
import type { DshDiscordTransportV1 } from './discord-live-publisher.js';

/** One DSH decision, agreement and delivery operation for web and suite actions. */
export class DshApplicationDecisionService {
  constructor(private readonly store: SqliteDshApplicationStore, private readonly options: { publicOrigin?: string | undefined; discord?: Pick<DshDiscordTransportV1, 'sendDirectMessage'> | undefined; preview?: boolean | undefined; now?: () => string }) {}
  async decide(input: { tenantId: string; applicationId: string; decision: 'approved' | 'rejected'; actorUserId: string; note?: string; operationId?: string; operationSignature?: string }) {
    if(this.options.preview){const application=this.required(input.tenantId,input.applicationId);const payload=this.payload({...application,status:input.decision,...(input.note?{decisionNote:input.note}:{})},input.decision==='approved'?this.agreementUrl(application.id,'simulation-preview'):undefined);await this.options.discord?.sendDirectMessage(input.tenantId,application.applicantDiscordId,payload);return{application,notification:'previewed' as const};}
    this.store.transaction(()=>{
      if(input.operationId)this.store.recordDecisionOperation(input.tenantId,input.operationId,input.applicationId,input.operationSignature??JSON.stringify([input.decision,input.actorUserId,input.note??'']));
      const existing=this.required(input.tenantId,input.applicationId);
      if(existing.status==='pending')this.store.decide(input.tenantId,input.applicationId,input.decision,input.actorUserId,input.note??'',this.now());
      else if(existing.status!==input.decision||(existing.decisionNote??'')!==(input.note??'').trim())throw Error('Application has already been decided with different values');
      this.prepare(input.tenantId,input.applicationId,input.actorUserId,false);
    });
    return this.deliver(input.tenantId,input.applicationId);
  }
  async notify(tenantId:string,applicationId:string,actorUserId:string,resend=false){
    if(this.options.preview)throw Error('Preview a decision instead of resending a live notification');
    this.store.transaction(()=>this.prepare(tenantId,applicationId,actorUserId,resend));
    return this.deliver(tenantId,applicationId);
  }
  private prepare(tenant:string,id:string,actor:string,resend:boolean){
    let application=this.required(tenant,id);if(application.status==='pending')throw Error('Application has no final decision');
    const existing=this.store.delivery(tenant,id);
    // A retry retains the original link, wording and Discord nonce.
    if(existing&&(!resend||application.notification?.status!=='delivered'))return;
    if(!resend&&application.notification?.status==='delivered')return;
    let agreementUrl:string|undefined;
    if(application.status==='approved'){
      const offer=this.store.createAgreementOffer(tenant,id,actor,this.now());
      if(!offer.rawToken)throw Error('Accepted agreements cannot be resent');
      application=offer.application;agreementUrl=this.agreementUrl(id,offer.rawToken);
    }
    const nonce=createHash('sha256').update(JSON.stringify([tenant,id,application.status,agreementUrl??randomUUID()])).digest('hex').slice(0,24);
    this.store.putDelivery(tenant,id,{...this.payload(application,agreementUrl),nonce,enforce_nonce:true});
    this.store.markNotificationPending(tenant,id,this.now());
  }
  async deliver(tenant:string,id:string){
    let application=this.required(tenant,id);
    if(application.notification?.status==='delivered')return{application,notification:'sent' as const};
    const owner=randomUUID();if(!this.store.claimDelivery(tenant,id,owner,this.now()))return{application,notification:'pending' as const};
    try{
      if(!this.options.discord)throw Error('Discord delivery is not connected');
      const payload=this.store.delivery(tenant,id);if(!payload)throw Error('Application notification is not prepared');
      const messageId=await this.options.discord.sendDirectMessage(tenant,application.applicantDiscordId,payload);
      application=this.store.finishDelivery(tenant,id,owner,{status:'delivered',messageId},this.now());
      return{application,notification:'sent' as const};
    }catch(error){application=this.store.finishDelivery(tenant,id,owner,{status:'failed',error:safe(error)},this.now());return{application,notification:'unavailable' as const};}
  }
  async flush(tenant:string){if(this.options.preview)return;for(const id of this.store.pendingDeliveries(tenant,this.now()))await this.deliver(tenant,id);}
  private payload(application:DshApplicationV1,agreementUrl?:string){const decision=application.status;if(decision==='pending')throw Error('Application has no final decision');const template=this.store.templates(application.tenantId)[dshTemplateKey(application.type,decision)];return buildDshApplicationDecisionMessage({type:application.type,decision,now:this.now(),...(template?{customMessage:template}:{}),...(application.decisionNote?{decisionNote:application.decisionNote}:{}),...(agreementUrl?{agreementUrl}:{})});}
  private agreementUrl(id:string,token:string){if(!this.options.publicOrigin)throw Error('Configure the public Apollo address before sending an application agreement');const origin=new URL(this.options.publicOrigin);if(!['http:','https:'].includes(origin.protocol)||origin.username||origin.password)throw Error('Public Apollo address is invalid');const url=new URL('/apps/discord-stream-hub',origin.origin);url.searchParams.set('agreement',id);url.searchParams.set('token',token);url.hash='applications';return url.href;}
  private required(tenant:string,id:string){const application=this.store.get(tenant,id);if(!application)throw Error('Application not found');return application;}
  private now(){return(this.options.now??(()=>new Date().toISOString()))();}
}
function safe(error:unknown){return(error instanceof Error?error.message:'Discord notification failed').replace(/((?:token|authorization|secret|password|cookie))\s*[:=]\s*\S+/gi,'$1=[redacted]').slice(0,900);}
