import { DshApplicationDecisionService } from "./application-decision.js";
import { createHash, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { fetchAppPlatformSnapshot, fetchAppSessionContext, readJsonBody, requireSameOrigin, safeError, sendJson } from "@spmt/app-foundation/product-web";
import type { SpmtOperationModeV1 } from "@spmt/contracts";
import { SpmtClient } from "@spmt/sdk";
import { type DshApplicationTemplateKeyV1 } from "./application-flow.js";
import { SqliteDshApplicationStore, type DshApplicationV1, type DshApplicationVoteValueV1 } from "./applications.js";
import { DshDiscordApi, type DshDiscordGrantSourceV1, type DshDiscordTransportV1 } from "./discord-live-publisher.js";
import { createDshWorkerTokenProvider, loadDshLiveRuntimeConfig, type DshLiveRuntimeConfigV1 } from "./live-worker.js";
import { DshSimulationRoomDiscordTransport } from "./simulation-room.js";

export interface DshApplicationControlOptionsV1 { spmtOrigin:string; publicOrigin?:string; databasePath:string; runtimeConfigPath:string; credential?:string; operationMode?:SpmtOperationModeV1; fetchImpl?:typeof fetch; now?:()=>string; }
type SessionContext=Awaited<ReturnType<typeof fetchAppSessionContext>>;

/** Complete private application workflow: review, blind advisory vote, owner decision, agreement and receipt. */
export class DshApplicationControls {
  private readonly store:SqliteDshApplicationStore;
  private readonly config:DshLiveRuntimeConfigV1;
  private readonly discord?:DshDiscordTransportV1;
  private readonly now:()=>string;
  constructor(private readonly options:DshApplicationControlOptionsV1){
    this.store=new SqliteDshApplicationStore(options.databasePath);this.config=loadDshLiveRuntimeConfig(options.runtimeConfigPath);this.now=options.now??(()=>new Date().toISOString());
    if(options.credential){
      const getAccessToken=createDshWorkerTokenProvider({spmtOrigin:options.spmtOrigin,credential:options.credential,...(options.fetchImpl?{fetchImpl:options.fetchImpl}:{})});
      const client=new SpmtClient({baseUrl:options.spmtOrigin,appId:"discord-stream-hub",getAccessToken,...(options.fetchImpl?{fetchImpl:options.fetchImpl}:{})});
      const grants:DshDiscordGrantSourceV1={getGrant:async({tenantId,capability})=>{const providerUserId=this.tenant(tenantId).discordProviderUserId;if(!providerUserId)throw new Error("Connect the tenant's Discord bot before using Discord delivery");const grant=await client.issueProviderGrant(tenantId,"discord",providerUserId,"dsh-application-control",[capability],300),scheme=grant.credential.metadata.authorizationScheme??"Bot";if(scheme!=="Bot"&&scheme!=="Bearer")throw new Error("Discord grant authorization scheme is invalid");return{authorization:`${scheme} ${grant.credential.accessToken}`,expiresAt:grant.expiresAt};}};
      const reads=new DshDiscordApi(grants,options.fetchImpl);this.discord=new DshSimulationRoomDiscordTransport(reads,client,{guildIds:tenantId=>this.tenant(tenantId).discordGuildIds??[],now:this.now,liveWrites:options.operationMode!=="read-only"});
    }
  }
  close(){this.store.close();}
  async handle(request:IncomingMessage,response:ServerResponse,url:URL):Promise<boolean>{
    if(!url.pathname.startsWith("/api/discord-stream-hub/control/applications/"))return false;
    const action = url.pathname.slice("/api/discord-stream-hub/control/applications/".length);
    if (!["reviews", "agreement", "vote", "decide", "notify", "templates"].includes(action)) return false;
    try{
      const context=await fetchAppSessionContext({appId:"discord-stream-hub",spmtOrigin:this.options.spmtOrigin,request}),path=url.pathname.slice("/api/discord-stream-hub/control/applications/".length);
      if(request.method==="GET"&&path==="reviews")return this.reviews(response,context);
      if(request.method==="GET"&&path==="agreement")return await this.agreementGet(request,response,url,context);
      if(request.method!=="POST")return sendJson(response,405,{error:"method_not_allowed"});
      requireSameOrigin(request);const body=await readJsonBody(request);
      if(path==="vote")return this.vote(response,context,body);
      if(path==="agreement")return await this.agreementAccept(request,response,context,body);
      this.requireOwner(context);
      if(path==="decide")return await this.decide(response,context,body);
      if(path==="notify")return await this.notify(response,context,body,true);
      if(path==="templates")return this.templates(response,context,body);
      return sendJson(response,404,{error:"not_found"});
    }catch(error){const message=safeError(error),status=/sign in|session/i.test(message)?401:/owner access|crew access|does not match/i.test(message)?403:/not found|invalid|closed|required|eligible|linked discord/i.test(message)?400:/discord|grant/i.test(message)?502:400;return sendJson(response,status,{error:"dsh_application_control_failed",message});}
  }
  private reviews(response:ServerResponse,context:SessionContext){const owner=this.isOwner(context),crew=this.canVote(context);if(!owner&&!crew)return sendJson(response,403,{error:"crew_access_required",message:"Recognized Crew access is required to review applications."});const applications=this.store.list(context.tenantId,undefined,100);if(owner)return sendJson(response,200,{schemaVersion:1,role:"owner",applications,templates:this.store.templates(context.tenantId)});const actor=String(context.session.actorId??"");return sendJson(response,200,{schemaVersion:1,role:"crew",applications:applications.filter(item=>item.status==="pending").map(item=>({...item,votes:undefined,myVote:item.votes.find(vote=>vote.voterUserId===actor)?.vote??null,decidedByUserId:undefined,decisionNote:undefined,notification:undefined,agreementOffer:undefined,agreementAcceptance:undefined})),templates:{}});}
  private vote(response:ServerResponse,context:SessionContext,body:Record<string,unknown>){if(!this.canVote(context))throw new Error("Recognized Crew access is required to vote on applications");const vote:DshApplicationVoteValueV1=body.vote==="approve"?"approve":body.vote==="reject"?"reject":invalidVote();const result=this.store.vote(context.tenantId,text(body.applicationId,"applicationId",300),{userId:String(context.session.actorId),username:String(context.session.displayName??context.session.username??context.session.actorId)},vote,this.now());return sendJson(response,200,{schemaVersion:1,action:result.action,myVote:result.application.votes.find(item=>item.voterUserId===String(context.session.actorId))?.vote??null});}
  private decisionService(){return new DshApplicationDecisionService(this.store,{publicOrigin:this.options.publicOrigin,discord:this.discord,preview:this.options.operationMode==="read-only",now:this.now});}
  private async decide(response:ServerResponse,context:SessionContext,body:Record<string,unknown>){const decision=body.decision==="approved"?"approved":body.decision==="rejected"?"rejected":undefined;if(!decision)throw new Error("Application decision is invalid");const delivered=await this.decisionService().decide({tenantId:context.tenantId,applicationId:text(body.applicationId,"applicationId",300),decision,actorUserId:String(context.session.actorId),note:optionalText(body.note,1000)});return sendJson(response,200,{schemaVersion:1,...delivered});}
  private async notify(response:ServerResponse,context:SessionContext,body:Record<string,unknown>,resend:boolean){const delivered=await this.decisionService().notify(context.tenantId,text(body.applicationId,"applicationId",300),String(context.session.actorId),resend);return sendJson(response,200,{schemaVersion:1,...delivered});}
  private templates(response:ServerResponse,context:SessionContext,body:Record<string,unknown>){const key=String(body.key??"") as DshApplicationTemplateKeyV1,value=this.store.saveTemplate(context.tenantId,key,String(body.value??""),this.now());return sendJson(response,200,{schemaVersion:1,key,value,templates:this.store.templates(context.tenantId)});}
  private async agreementGet(request:IncomingMessage,response:ServerResponse,url:URL,context:SessionContext){const applicationId=text(url.searchParams.get("applicationId"),"applicationId",300),token=text(url.searchParams.get("token"),"token",300),application=this.store.get(context.tenantId,applicationId);this.verifyOffer(application,token);const identity=await this.identity(request,context);if(url.searchParams.get("format")==="receipt"){if(!this.isOwner(context)&&identity.discordUserId!==application!.applicantDiscordId)throw new Error("The linked Discord account does not match this application");if(!application!.agreementAcceptance)return sendJson(response,404,{error:"receipt_not_found",message:"No acceptance receipt exists."});return jsonDownload(response,application!.agreementAcceptance,`spmt-acceptance-${application!.agreementAcceptance.acceptanceId}.json`);}const acceptance=application!.agreementAcceptance;return sendJson(response,200,{schemaVersion:1,applicationId,role:application!.type,applicantDiscordId:application!.applicantDiscordId,document:application!.agreementOffer!.document,acceptanceSchedule:application!.agreementOffer!.acceptanceSchedule,authenticated:true,account:identity,identityMatches:Boolean(identity.discordUserId&&identity.discordUserId===application!.applicantDiscordId),accepted:acceptance?{acceptanceId:acceptance.acceptanceId,acceptedAt:acceptance.acceptedAt,receiptUrl:this.agreementApiUrl(applicationId,token,"receipt")}:null});}
  private async agreementAccept(request:IncomingMessage,response:ServerResponse,context:SessionContext,body:Record<string,unknown>){const identity=await this.identity(request,context);if(!identity.discordUserId)throw new Error("Link the approved Discord account to SPMT before accepting");const result=this.store.acceptAgreement({tenantId:context.tenantId,applicationId:text(body.applicationId,"applicationId",300),token:text(body.token,"token",300),spmtUserId:String(context.session.actorId),discordUserId:identity.discordUserId,username:identity.displayName,reviewedTerms:body.reviewedTerms===true,electronicConsent:body.electronicConsent===true},this.now());return sendJson(response,200,{schemaVersion:1,alreadyAccepted:result.alreadyAccepted,acceptance:result.acceptance,receiptUrl:this.agreementApiUrl(result.application.id,String(body.token),"receipt")});}
  private async identity(request:IncomingMessage,context:SessionContext){const snapshot=await fetchAppPlatformSnapshot({appId:"discord-stream-hub",spmtOrigin:this.options.spmtOrigin,request,sources:["providerLinks"],liveRead:null}),providerLinks=snapshot.providerLinks,wrapped=record(providerLinks),links=(Array.isArray(providerLinks)?providerLinks:Array.isArray(wrapped?.providers)?wrapped.providers:Array.isArray(wrapped?.links)?wrapped.links:[]) as Array<Record<string,unknown>>,link=links.find(item=>item.provider==="discord"&&!item.revokedAt);return{spmtUserId:String(context.session.actorId),discordUserId:link?String(link.providerUserId??""):"",displayName:String(link?.displayName??link?.username??context.session.displayName??context.session.username??context.session.actorId)};}
  private verifyOffer(application:DshApplicationV1|undefined,token:string){if(!application||application.status!=="approved"||!application.agreementOffer||!safeEqual(application.agreementOffer.tokenHash,sha(token)))throw new Error("Agreement link is invalid or no longer eligible");}
  private agreementApiUrl(applicationId:string,token:string,format?:string){const url=new URL("/apps/discord-stream-hub/api/control/applications/agreement",cleanOrigin(this.options.publicOrigin??this.options.spmtOrigin));url.searchParams.set("applicationId",applicationId);url.searchParams.set("token",token);if(format)url.searchParams.set("format",format);return url.toString();}
  private tenant(tenantId:string){const tenant=this.config.tenants.find(item=>item.tenantId===tenantId);if(!tenant)throw new Error("DSH is not configured for this tenant");return tenant;}
  private isOwner(context:SessionContext){const roles=record(context.session.tenantRoles);return roles?.[context.tenantId]==="owner";}
  private canVote(context:SessionContext){if(this.isOwner(context))return true;const actor=String(context.session.actorId??"");return this.tenant(context.tenantId).members.some(member=>member.canonicalUserId===actor&&member.group==="Crew");}
  private requireOwner(context:SessionContext){if(!this.isOwner(context))throw new Error("Tenant owner access is required for this action");}
}
function invalidVote():never{throw new Error("Vote must be approve or reject");}
function sha(value:string){return createHash("sha256").update(value).digest("hex");}
function safeEqual(left:string,right:string){const a=Buffer.from(left),b=Buffer.from(right);return a.length===b.length&&timingSafeEqual(a,b);}
function record(value:unknown){return value&&typeof value==="object"&&!Array.isArray(value)?value as Record<string,unknown>:undefined;}
function text(value:unknown,name:string,max:number){const result=String(value??"").replace(/\0/g,"").trim();if(!result||result.length>max||/[\r\n]/.test(result))throw new Error(`${name} is required`);return result;}
function optionalText(value:unknown,max:number){const result=String(value??"").replace(/\0/g,"").trim();if(result.length>max)throw new Error("Value is too long");return result;}
function cleanOrigin(value:string){const url=new URL(value);if(!["https:","http:"].includes(url.protocol)||url.username||url.password)throw new Error("SPMT public origin is invalid");return url.origin;}
function jsonDownload(response:ServerResponse,value:unknown,fileName:string){const encoded=Buffer.from(JSON.stringify(value,null,2));response.writeHead(200,{"content-type":"application/json; charset=utf-8","content-disposition":`attachment; filename="${fileName}"`,"content-length":String(encoded.byteLength),"cache-control":"no-store"});response.end(encoded);return true;}
