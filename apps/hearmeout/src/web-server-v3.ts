import {ensurePublicSystemMediaRooms} from './lounge-room.js';
import {HearMeOutRoomPersonaSpeech,type HearMeOutPersonaPublisher} from './room-persona-speech.js';
import {HearMeOutScreenBroadcast} from "./screen-broadcast.js";
import {HearMeOutBroadcastProgram,type HearMeOutProgramBinding} from "./broadcast-program.js";
import {handleHearMeOutBroadcastWindow} from "./broadcast-window.js";
import { preparedHearMeOutEnvironment } from './prepared-media.js';
import { HearMeOutRoomBroadcast, type HearMeOutRoomBroadcastOptions } from "./room-broadcast.js";
import { HearMeOutDiscordHttp } from "./discord-http.js";
import { ensureHearMeOutDiscordActivityRoom } from "./activity-room.js";
import { HEARMEOUT_ACTIVITY_ROOM_ID, HEARMEOUT_ACTIVITY_ROOM_NAME } from "./activity-contract.js";
import { HearMeOutAutoRadio, hearMeOutRadioRecommendation } from "./auto-radio.js";
import { handleHearMeOutActivityRequest, readHearMeOutActivityState, type HearMeOutActivityBinding } from "./activity-web.js";
import type {HearMeOutPublicPersonaV1} from "./persona-conversation.js";
import {proxyAppMedia} from "@spmt/app-foundation/media-proxy";
import {HearMeOutRoomAssistantJobs} from "./room-assistant-jobs.js";
import { readFile } from 'node:fs/promises';
import { HearMeOutRoomRtcGateway, type RoomRtcOptions } from './rtc-room-gateway.js';
import { createHash, randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { PRODUCT_UI_CSS } from "@spmt/ui";
import type { SpmtOperationModeV1 } from "@spmt/contracts";
import { SpmtClient } from "@spmt/sdk";
import { SqliteHearMeOutRoomMediaRuntime, type HearMeOutMediaLaneV1, type HearMeOutPrincipalV1, type HearMeOutRoomV1 } from "./room-media-core.js";
import { HEARMEOUT_SURFACE_BROWSER_JS } from "./surface-client.js";
import { HEARMEOUT_PERSONA_TALK_BROWSER_JS } from "./persona-talk-client.js";
import { HearMeOutPersonaConversationCoordinator } from "./persona-conversation.js";
import { createHearMeOutWorkerTokenProvider } from "./execution-worker.js";
import { HEARMEOUT_BOT_ACTIONS } from "./bot-action-adapter.js";
import { HearMeOutSuiteActionWorker } from "./suite-action-worker.js";
import { HearMeOutWebSuiteActionExecutor, SpmtHearMeOutSuiteMediaResolver, hearMeOutYoutubeId, type HearMeOutSuiteMediaResolverV1 } from "./suite-action-executor.js";
import { HearMeOutVoiceBridgeController, SqliteHearMeOutVoiceBridgeStore, type HearMeOutVoiceBridgeWorkerV1 } from "./voice-bridge.js";
import { HttpHearMeOutVoiceBridgeWorker,HttpHearMeOutPersonaPublisher } from "./legacy-worker-adapter.js";
import { ResilientHearMeOutVoiceBridgeWorker } from "./voice-bridge-resilience.js";
import { HearMeOutLiveLoungeBridge } from "./live-lounge-bridge.js";
import { HearMeOutLiveLoungeRuntime } from "./live-lounge-runtime.js";
import { HearMeOutSpotlightBridge } from "./spotlight-media-bridge.js";

const MAX_BODY_BYTES = 64 * 1024;
const MAX_CHAT_MESSAGES = 150;

export interface HearMeOutWebServerOptions {
  singleBroadcast?: HearMeOutProgramBinding;
  activity?: HearMeOutActivityBinding;
  discordPublicKeyHex?: string;
  broadcast?: Omit<HearMeOutRoomBroadcastOptions,"spmtOrigin">;
  spmtOrigin: string;
  databasePath: string;
  port?: number;
  host?: string;
  buildSha?: string;
  roomCleanupIntervalMs?: number;
  personaConversation?: HearMeOutPersonaConversationCoordinator;
  credential?: string;
  operationMode?: SpmtOperationModeV1;
  suiteMediaResolver?: HearMeOutSuiteMediaResolverV1;
  voiceBridgeWorker?: HearMeOutVoiceBridgeWorkerV1;
  personaPublisher?: HearMeOutPersonaPublisher;
  liveLoungeBridge?: HearMeOutLiveLoungeBridge;
  spotlightBridge?: HearMeOutSpotlightBridge;
  fetchImpl?: typeof fetch;
  rtc?: Pick<RoomRtcOptions, "livekit" | "iceServers" | "maxParticipants">;
}

type RoomChatMessage = { id:string; tenantId:string; roomId:string; userId:string; displayName:string; text:string; createdAt:string; kind:"human"|"persona"|"system" };
type RoomPersona = { voice?:string; personaId:string; targetTenantId:string; displayName:string; wakeNames:string[]; joinedByUserId:string; joinedAt:string; transportHealthy:boolean; avatarUrl?:string; idleAvatarUrl?:string; talkingAvatarUrl?:string };
type RoomMember = { userId:string; displayName:string; joinedAt:string };

class HearMeOutRoomConsoleStore {
  private readonly db:DatabaseSync;
  constructor(path:string){
    this.db=new DatabaseSync(path,{timeout:5_000});
    this.db.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON;");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS hmo_room_chat(
        tenant_id TEXT NOT NULL, room_id TEXT NOT NULL, message_id TEXT NOT NULL, created_at TEXT NOT NULL, body TEXT NOT NULL,
        PRIMARY KEY(tenant_id,room_id,message_id)
      ) STRICT;
      CREATE INDEX IF NOT EXISTS hmo_room_chat_order ON hmo_room_chat(tenant_id,room_id,created_at);
      CREATE TABLE IF NOT EXISTS hmo_room_personas(
        tenant_id TEXT NOT NULL, room_id TEXT NOT NULL, persona_id TEXT NOT NULL, body TEXT NOT NULL,
        PRIMARY KEY(tenant_id,room_id,persona_id)
      ) STRICT;
    `);
  }
  close(){this.db.close();}
  private requireRoom(tenantId:string,roomId:string){const row=this.db.prepare("SELECT body FROM hmo_rooms WHERE tenant_id=? AND room_id=?").get(tenantId,roomId);const room=row?JSON.parse(String(row.body)):undefined;if(!room||(!room.systemRoom&&room.expiresAt&&Date.parse(room.expiresAt)<=Date.now()))throw new Error("HearMeOut room not found or expired");}
  listChat(tenantId:string,roomId:string,limit=MAX_CHAT_MESSAGES):RoomChatMessage[]{return (this.db.prepare("SELECT body FROM hmo_room_chat WHERE tenant_id=? AND room_id=? ORDER BY created_at DESC LIMIT ?").all(tenantId,roomId,limit) as Array<{body:string}>).reverse().map(row=>JSON.parse(row.body) as RoomChatMessage);}
  appendChat(principal:HearMeOutPrincipalV1,roomId:string,text:string,kind:RoomChatMessage["kind"]="human",displayName=principal.displayName,messageId?:string):RoomChatMessage{this.requireRoom(principal.tenantId,roomId);const message:RoomChatMessage={id:messageId??`msg-${Date.now().toString(36)}-${randomBytes(5).toString("hex")}`,tenantId:principal.tenantId,roomId,userId:principal.userId,displayName:cleanLabel(displayName,"displayName",120),text:cleanMessage(text),createdAt:new Date().toISOString(),kind};this.db.prepare("INSERT INTO hmo_room_chat(tenant_id,room_id,message_id,created_at,body) VALUES(?,?,?,?,?) ON CONFLICT(tenant_id,room_id,message_id) DO NOTHING").run(message.tenantId,message.roomId,message.id,message.createdAt,JSON.stringify(message));return message;}
  appendPersona(tenantId:string,roomId:string,personaId:string,displayName:string,text:string,messageId?:string):RoomChatMessage{this.requireRoom(tenantId,roomId);const message:RoomChatMessage={id:messageId??`msg-${Date.now().toString(36)}-${randomBytes(5).toString("hex")}`,tenantId,roomId,userId:`persona:${personaId}`,displayName:cleanLabel(displayName,"displayName",120),text:cleanMessage(text),createdAt:new Date().toISOString(),kind:"persona"};this.db.prepare("INSERT INTO hmo_room_chat(tenant_id,room_id,message_id,created_at,body) VALUES(?,?,?,?,?) ON CONFLICT(tenant_id,room_id,message_id) DO NOTHING").run(message.tenantId,message.roomId,message.id,message.createdAt,JSON.stringify(message));return message;}
  personaRooms(){return this.db.prepare('SELECT DISTINCT tenant_id,room_id FROM hmo_room_personas').all().map(row=>({tenantId:String(row.tenant_id),roomId:String(row.room_id)}))}
  listPersonas(tenantId:string,roomId:string):RoomPersona[]{return (this.db.prepare("SELECT body FROM hmo_room_personas WHERE tenant_id=? AND room_id=? ORDER BY persona_id").all(tenantId,roomId) as Array<{body:string}>).map(row=>JSON.parse(row.body) as RoomPersona);}
  putPersona(principal:HearMeOutPrincipalV1,roomId:string,persona:{voice?:string;personaId:string;targetTenantId?:string;displayName:string;wakeNames?:string[];transportHealthy?:boolean;avatarUrl?:string;idleAvatarUrl?:string;talkingAvatarUrl?:string}):RoomPersona{this.requireRoom(principal.tenantId,roomId);const value:RoomPersona={personaId:cleanId(persona.personaId,"personaId"),targetTenantId:cleanId(persona.targetTenantId??persona.personaId,"targetTenantId"),displayName:cleanLabel(persona.displayName,"displayName",120),wakeNames:[...new Set((persona.wakeNames??[]).map(value=>cleanLabel(value,"wakeName",96)))].slice(0,50),joinedByUserId:principal.userId,joinedAt:new Date().toISOString(),transportHealthy:persona.transportHealthy===true,...(persona.voice?{voice:cleanLabel(persona.voice,"voice",200)}:{}),...personaAssets(persona)};this.db.prepare("INSERT INTO hmo_room_personas(tenant_id,room_id,persona_id,body) VALUES(?,?,?,?) ON CONFLICT(tenant_id,room_id,persona_id) DO UPDATE SET body=excluded.body").run(principal.tenantId,roomId,value.personaId,JSON.stringify(value));return value;}
  removePersona(tenantId:string,roomId:string,personaId:string){this.db.prepare("DELETE FROM hmo_room_personas WHERE tenant_id=? AND room_id=? AND persona_id=?").run(tenantId,roomId,cleanId(personaId,"personaId"));return{removed:true as const};}
}

export function createHearMeOutWebServer(options:HearMeOutWebServerOptions){
  const spmtOrigin=loopbackOrigin(options.spmtOrigin),databasePath=resolve(options.databasePath),rooms=new SqliteHearMeOutRoomMediaRuntime(databasePath),consoleStore=new HearMeOutRoomConsoleStore(databasePath),roomAssistant=new HearMeOutRoomAssistantJobs(databasePath,scope=>{if(!rooms.getRoom(scope.tenantId,scope.roomId))throw new Error("HearMeOut room not found or expired")}),voiceStore=new SqliteHearMeOutVoiceBridgeStore(databasePath),voiceBridge=options.voiceBridgeWorker?new HearMeOutVoiceBridgeController(rooms,voiceStore,options.voiceBridgeWorker):undefined,suiteController=new AbortController();
  const personaSpeech=new HearMeOutRoomPersonaSpeech(databasePath,{
    rooms:()=>consoleStore.personaRooms(),personas:scope=>consoleStore.listPersonas(scope.tenantId,scope.roomId),exists:scope=>Boolean(rooms.getRoom(scope.tenantId,scope.roomId)),
    bridgeEnabled:scope=>voiceStore.get(scope.tenantId,scope.roomId).enabled,
    bridgeStatus:async scope=>{const value=await options.voiceBridgeWorker?.status(scope);const state=value?.status as Record<string,unknown>|undefined;return (state??value)?.running===true},
    ...(options.personaPublisher?{publisher:options.personaPublisher}:{}),ffmpegBinary:options.broadcast?.ffmpegBinary??'ffmpeg',
  });
  const program=options.singleBroadcast?new HearMeOutBroadcastProgram(databasePath,options.singleBroadcast):undefined;
  if(program)ensurePublicSystemMediaRooms(rooms,program);
  const broadcast=options.broadcast?new HearMeOutRoomBroadcast(program??rooms,{...options.broadcast,spmtOrigin}):undefined;
  const liveLoungeRuntime=program&&options.broadcast&&options.liveLoungeBridge?new HearMeOutLiveLoungeRuntime(options.liveLoungeBridge,program.binding.tenantId):undefined;
  const liveLoungeBroadcast=liveLoungeRuntime&&options.broadcast?new HearMeOutRoomBroadcast(liveLoungeRuntime,{...options.broadcast,cachePath:join(options.broadcast.cachePath,'live-lounge'),spmtOrigin,startAtSessionClock:true}):undefined;
  const screenBroadcast=program&&options.broadcast?new HearMeOutScreenBroadcast({...options.broadcast,allowed:publisher=>{try{return Boolean(rooms.getRoom(publisher.tenantId,publisher.sourceRoomId))&&rooms.listMembers(publisher.tenantId,publisher.sourceRoomId).some(member=>member.userId===publisher.userId&&!member.serverMuted)}catch{return false}}}):undefined;
  let timelineTimer:ReturnType<typeof setInterval>|undefined;
  let discord: HearMeOutDiscordHttp | undefined;
  let mediaWorkerHealth: (() => Promise<{configured:boolean;ready:boolean;workers:number}>) | undefined;
  let suiteFailure="",suiteTask:Promise<void>|undefined,mediaResolver=options.suiteMediaResolver,radio:HearMeOutAutoRadio|undefined,radioTask:Promise<void>|undefined;
  let cleanupFailure=false,cleanupTask:Promise<void>|undefined,cleanupTimer:ReturnType<typeof setInterval>|undefined,closing=false;
  const cleanupExpiredRooms=()=>{
    if(closing)return Promise.resolve();
    try{for(const room of rooms.pruneExpiredRooms())rtc.closeRoom(room.tenantId,room.roomId);cleanupFailure=false}catch{cleanupFailure=true}
    if(!cleanupTask)cleanupTask=(async()=>{await voiceBridge?.cleanupDeletedRooms()})().catch(()=>{cleanupFailure=true}).finally(()=>{cleanupTask=undefined});
    return cleanupTask;
  };
  const roomDeleted=(tenantId:string,roomId:string)=>{rtc.closeRoom(tenantId,roomId);void cleanupExpiredRooms()};
  if(options.credential){const getAccessToken=createHearMeOutWorkerTokenProvider({spmtOrigin,credential:options.credential,...(options.fetchImpl?{fetchImpl:options.fetchImpl}:{})}),client=new SpmtClient({baseUrl:spmtOrigin,appId:"hearmeout",getAccessToken,...(options.fetchImpl?{fetchImpl:options.fetchImpl}:{})}),media=mediaResolver=options.suiteMediaResolver??new SpmtHearMeOutSuiteMediaResolver(client),actions=HEARMEOUT_BOT_ACTIONS.filter(action=>!action.startsWith("hmo.voice.")||options.operationMode==="read-only"||Boolean(voiceBridge)),executor=new HearMeOutWebSuiteActionExecutor(rooms,media,{...(program?{singleProgram:program}:{}),...(options.activity?{activity:options.activity}:{}),personaStore:consoleStore,personaDirectory:async tenantId=>{const [catalog,community]=await Promise.all([client.request<{personas:HearMeOutPublicPersonaV1[]}>("/v1/assistant/public-personas",{tenantId}),client.getCommunityAssistant(tenantId)]);const assistant=community as unknown as Record<string,unknown>;return [...catalog.personas,{personaId:String(assistant.personaId??assistant.id??"community-assistant"),targetTenantId:tenantId,displayName:String(assistant.displayName??assistant.name??"Assistant"),wakeNames:[],canInvite:true,transportHealthy:false}];},...(options.personaConversation?{personaConversation:options.personaConversation}:{}),...(voiceBridge?{voiceBridge}:{})}),worker=new HearMeOutSuiteActionWorker(client,executor,{workerId:`hearmeout-web-suite-${process.pid}`,actions,onHealth:failure=>{suiteFailure=failure}});if(options.discordPublicKeyHex){if(!options.activity)throw Error("Discord interactions require an Activity binding");discord=new HearMeOutDiscordHttp({binding:options.activity,publicKeyHex:options.discordPublicKeyHex,rooms,client,...(program?{singleProgram:program,media}:{}),readOnly:options.operationMode==="read-only"&&!program,...(options.fetchImpl?{fetchImpl:options.fetchImpl}:{})});}mediaWorkerHealth=async()=>{const workers=await client.listExecutionWorkers({executionOwner:"hearmeout",capabilityId:"hearmeout.youtube.resolve",...(options.activity?{tenantId:options.activity.tenantId}:{})});const ready=workers.filter(worker=>worker.state==="ready"&&worker.providerHealthy&&Date.parse(worker.leaseExpiresAt)>Date.now());return {configured:true,ready:ready.length>0,workers:ready.length};};radio=new HearMeOutAutoRadio(rooms,media,{recommend:input=>hearMeOutRadioRecommendation(client,input)});suiteTask=worker.run(suiteController.signal).catch(error=>{suiteFailure=safeError(error)});}
  if(options.discordPublicKeyHex&&!options.credential)throw Error("Discord interactions require the HearMeOut service credential");
  if(program){radio=undefined;const old=rooms.getRoom(program.binding.tenantId,HEARMEOUT_ACTIVITY_ROOM_ID);if(old?.systemRoom&&old.ownerUserId===HEARMEOUT_ACTIVITY_ROOM_ID)rooms.deleteRoom({tenantId:old.tenantId,userId:old.ownerUserId,displayName:old.name,roles:["admin"]},old.roomId,"remove-old-activity:"+old.instanceId);}
  if(options.activity&&!program)ensureHearMeOutDiscordActivityRoom(rooms,{tenantId:options.activity.tenantId,userId:HEARMEOUT_ACTIVITY_ROOM_ID,displayName:HEARMEOUT_ACTIVITY_ROOM_NAME,roles:["admin"]});
  if(!program&&!radio&&mediaResolver)radio=new HearMeOutAutoRadio(rooms,mediaResolver);
  const server=createServer(async(request,response)=>{try{if(request.method==="GET"&&request.url==="/api/hearmeout/youtube-browser.js")return send(response,200,await readFile(new URL("./youtube-browser-client.js",import.meta.url),"utf8"),"application/javascript; charset=utf-8");if(request.method==="GET"&&request.url==="/api/hearmeout/playback-source.js")return send(response,200,await readFile(new URL("./playback-source-client.js",import.meta.url),"utf8"),"application/javascript; charset=utf-8");if(request.method==="GET"&&request.url==="/api/hearmeout/media-client.js")return send(response,200,await readFile(new URL("./media-client.js",import.meta.url),"utf8"),"application/javascript; charset=utf-8");if(request.method==="GET"&&request.url==="/api/hearmeout/rtc-client.js")return send(response,200,await readFile(new URL("./rtc-client.js",import.meta.url),"utf8"),"application/javascript; charset=utf-8");const url=new URL(request.url??"/","http://hearmeout.green");if(discord&&await discord.handle(request,response,url))return;if(program&&await handleHearMeOutBroadcastWindow(request,response,url,program,broadcast,mediaResolver,options.activity?.clientId??"",false,{guildIds:options.activity?.guildIds??[],authorizeRoom:async(req,id)=>{const actor=await resolvePrincipal(req,spmtOrigin);if(actor.tenantId!==program.binding.tenantId)throw Error("Watch party belongs to another deployment");requireMembership(rooms,actor,id)},authorizeServiceRequest:async req=>{const authorization=String(req.headers.authorization??"");if(!authorization.startsWith("Bearer "))throw Object.assign(Error("Service authorization required"),{status:401});const response=await fetch(`${spmtOrigin}/v1/session`,{headers:{accept:"application/json","x-spmt-app":"hearmeout",authorization},redirect:"manual",signal:AbortSignal.timeout(5000)});if(!response.ok)throw Object.assign(Error("Service authorization failed"),{status:response.status===401||response.status===403?401:503});const value=await response.json() as Record<string,unknown>;if(value.actorType!=="service"||value.actorId!=="streamweaver")throw Object.assign(Error("Only StreamWeaver may use the Lounge service route"),{status:403});const tenants=Array.isArray(value.tenantIds)?value.tenantIds:[];if(!tenants.includes(program.binding.tenantId)&&value.tenantMode!=="any")throw Object.assign(Error("StreamWeaver is not authorized for this Lounge"),{status:403});return{userId:"streamweaver:twitch",displayName:"StreamWeaver Twitch request"}}},screenBroadcast,options.liveLoungeBridge,liveLoungeBroadcast,options.spotlightBridge))return;const activityFeed=url.pathname.match(/^\/api\/watch\/sessions\/([^/]+)\/broadcast\/([^/]+)$/);if(activityFeed){if(request.method!=="GET")return sendJson(response,405,{error:"method_not_allowed"});const state=readHearMeOutActivityState(rooms,options.activity,decodeURIComponent(activityFeed[1]!));if(!broadcast)return sendJson(response,503,{error:"The room broadcast worker is not configured yet"});return await broadcast.serve(options.activity!.tenantId,state.roomId,state.sessionId==="discord-music-room"?"music":"movie",activityFeed[2]!,response);}if(handleHearMeOutActivityRequest(request,response,url,rooms,options.activity,{configured:Boolean(broadcast)}))return;if(await proxyAppMedia({appId:"hearmeout",spmtOrigin,request,response,url,...(options.fetchImpl?{fetchImpl:options.fetchImpl}:{})}))return;if(request.method==="GET"&&(url.pathname==="/"||url.pathname==="/apps/hearmeout")){applyPageHeaders(response);return send(response,200,renderHearMeOutWebPage(options.buildSha??"dev",Boolean(program)),"text/html; charset=utf-8");}if(request.method==="GET"&&url.pathname==="/health/ready")return sendJson(response,suiteFailure||cleanupFailure?503:200,{state:suiteFailure||cleanupFailure?"degraded":"ready",appId:"hearmeout",buildSha:options.buildSha??"dev",activityClientId:options.activity?.clientId??null,discord:discord?.status()??{configured:false},broadcast:{...(broadcast?.status()??{configured:false}),singleProgram:Boolean(program)},mediaWorker:await mediaWorkerHealth?.().catch(()=>({configured:true,ready:false,workers:0}))??{configured:false,ready:false,workers:0},voiceBridge:{configured:Boolean(voiceBridge),enabledRooms:voiceStore.listEnabled().length},roomCleanup:{failed:cleanupFailure,pendingVoiceStops:voiceStore.listPendingCleanup().length},...(suiteFailure?{suiteActions:suiteFailure}:{})});if(url.pathname.startsWith("/api/hearmeout/"))return await handleApi(request,response,url,rooms,consoleStore,spmtOrigin,roomAssistant,options.personaConversation,voiceBridge,(tenantId,roomId)=>rtc.refreshRoom(tenantId,roomId),roomDeleted,(tenantId,roomId,userId,action,targetRoomId)=>rtc.moderateMember(tenantId,roomId,userId,action,targetRoomId),mediaResolver,broadcast,program,screenBroadcast,personaSpeech);return sendJson(response,404,{error:"not_found",message:"Unknown HearMeOut route"});}catch(error){if(!response.headersSent)return sendJson(response,500,{error:"hearmeout_web_failure",message:safeError(error)});response.destroy(error instanceof Error?error:undefined);}});
  const rtc=new HearMeOutRoomRtcGateway({resolvePrincipal:request=>resolvePrincipal(request,spmtOrigin),requireMembership:(principal,roomId)=>requireMembership(rooms,principal,roomId),...options.rtc,isServerMuted:(tenantId,roomId,userId)=>rooms.isServerMuted(tenantId,roomId,userId),hasVoiceBridge:(tenantId,roomId)=>voiceStore?.get(tenantId,roomId).enabled===true});
  rtc.attach(server);
  return{server,rtc,cleanupExpiredRooms,async listen(){if(!broadcast)program?.advance();rooms.advanceRoomTimelines();timelineTimer=setInterval(()=>{try{if(!broadcast)program?.advance();rooms.advanceRoomTimelines()}catch{cleanupFailure=true}},500);timelineTimer.unref();await broadcast?.listen();await liveLoungeRuntime?.listen();await liveLoungeBroadcast?.listen();await cleanupExpiredRooms();if(voiceBridge)await voiceBridge.reconcileEnabled();await listen(server,options.port??3200,options.host??"127.0.0.1");cleanupTimer=setInterval(()=>{void cleanupExpiredRooms()},options.roomCleanupIntervalMs??60_000);cleanupTimer.unref();radioTask=radio?.run(suiteController.signal).catch(error=>{suiteFailure=safeError(error)});},async close(){closing=true;if(timelineTimer)clearInterval(timelineTimer);if(cleanupTimer)clearInterval(cleanupTimer);rtc.close();suiteController.abort();if(server.listening)await close(server);await discord?.close();await screenBroadcast?.close();await personaSpeech.close();await liveLoungeBroadcast?.close();liveLoungeRuntime?.close();await broadcast?.close();await suiteTask;await radioTask;await cleanupTask;voiceStore.close();roomAssistant.close();consoleStore.close();program?.close();rooms.close();}};
}

export async function startHearMeOutWebServerFromEnvironment(environment:NodeJS.ProcessEnv=process.env){const spmtOrigin=environment.SPMT_ORIGIN??"",databasePath=environment.HEARMEOUT_ROOM_DATABASE_PATH??"",operationMode:SpmtOperationModeV1=environment.SPMT_OUTBOUND_MODE==="disabled"?"read-only":"active";if(!databasePath)throw new Error("HEARMEOUT_ROOM_DATABASE_PATH is required");const bridgeOrigin=environment.HEARMEOUT_VOICE_BRIDGE_ORIGIN,bridgeAuthorization=environment.HEARMEOUT_VOICE_BRIDGE_AUTHORIZATION;if(Boolean(bridgeOrigin)!==Boolean(bridgeAuthorization))throw new Error("HearMeOut voice bridge origin and authorization must be configured together");const voiceBridgeWorker=(operationMode==="active"||environment.HEARMEOUT_CONTROLLED_BRIDGE==="1")&&bridgeOrigin&&bridgeAuthorization?new ResilientHearMeOutVoiceBridgeWorker(new HttpHearMeOutVoiceBridgeWorker({workerOrigin:bridgeOrigin,getAuthorization:()=>bridgeAuthorization,...(environment.HEARMEOUT_VOICE_BRIDGE_TENANT_ID?{allowedTenantIds:[environment.HEARMEOUT_VOICE_BRIDGE_TENANT_ID]}:{})})):undefined;const preparedMedia=preparedHearMeOutEnvironment(environment);const liveLoungeBridge=environment.SPMT_RUNTIME_MODE!=="sandbox"&&environment.HEARMEOUT_SINGLE_BROADCAST==="1"&&bridgeAuthorization?new HearMeOutLiveLoungeBridge(bridgeAuthorization):undefined;const spotlightBridge=bridgeOrigin&&bridgeAuthorization?new HearMeOutSpotlightBridge(bridgeOrigin,bridgeAuthorization):undefined;const host=createHearMeOutWebServer({spmtOrigin,databasePath,operationMode,...(environment.HEARMEOUT_SINGLE_BROADCAST==="1"?{singleBroadcast:{tenantId:environment.HEARMEOUT_ACTIVITY_TENANT_ID??"",executionUserId:environment.HEARMEOUT_BROADCAST_EXECUTION_USER_ID??""}}:{}),...(environment.HEARMEOUT_ACTIVITY_TENANT_ID&&environment.DISCORD_CLIENT_ID?{activity:{tenantId:environment.HEARMEOUT_ACTIVITY_TENANT_ID,clientId:environment.DISCORD_CLIENT_ID,guildIds:(environment.HEARMEOUT_DISCORD_GUILD_IDS??"").split(",").map(value=>value.trim()).filter(Boolean)}}:{}),...(environment.DISCORD_PUBLIC_KEY?{discordPublicKeyHex:environment.DISCORD_PUBLIC_KEY}:{}),...(environment.HEARMEOUT_BROADCAST_CACHE_PATH?{broadcast:{cachePath:environment.HEARMEOUT_BROADCAST_CACHE_PATH,ffmpegBinary:environment.HEARMEOUT_FFMPEG_BINARY??"/usr/bin/ffmpeg",ffprobeBinary:environment.HEARMEOUT_FFPROBE_BINARY??"/usr/bin/ffprobe",...(preparedMedia?{preparedMedia}:{})}}:{}),port:Number(environment.PORT??3200),host:environment.HOST??"127.0.0.1",buildSha:environment.BUILD_SHA??"dev",...(environment.HEARMEOUT_WORKER_CREDENTIAL?{credential:environment.HEARMEOUT_WORKER_CREDENTIAL}:{}),...(liveLoungeBridge?{liveLoungeBridge}:{}),...(spotlightBridge?{spotlightBridge}:{}),...(voiceBridgeWorker?{voiceBridgeWorker,personaPublisher:new HttpHearMeOutPersonaPublisher({workerOrigin:bridgeOrigin!,getAuthorization:()=>bridgeAuthorization!,...(environment.HEARMEOUT_VOICE_BRIDGE_TENANT_ID?{allowedTenantIds:[environment.HEARMEOUT_VOICE_BRIDGE_TENANT_ID]}:{})})}: {}),rtc:{...(environment.HEARMEOUT_RTC_MAX_PARTICIPANTS?{maxParticipants:Number(environment.HEARMEOUT_RTC_MAX_PARTICIPANTS)}:{}),...(environment.LIVEKIT_URL&&environment.LIVEKIT_API_KEY&&environment.LIVEKIT_API_SECRET?{livekit:{url:environment.LIVEKIT_URL,apiKey:environment.LIVEKIT_API_KEY,apiSecret:environment.LIVEKIT_API_SECRET}}:{})}});await host.listen();return host;}

async function handleApi(request:IncomingMessage,response:ServerResponse,url:URL,rooms:SqliteHearMeOutRoomMediaRuntime,consoleStore:HearMeOutRoomConsoleStore,spmtOrigin:string,roomAssistant:HearMeOutRoomAssistantJobs,personaConversation?:HearMeOutPersonaConversationCoordinator,voiceBridge?:HearMeOutVoiceBridgeController,refreshBridge?:(tenantId:string,roomId:string)=>void,onRoomDeleted?:(tenantId:string,roomId:string)=>void,onModerated?:(tenantId:string,roomId:string,userId:string,action:string,targetRoomId?:string)=>Promise<{providerPending:boolean}>,mediaResolver?:HearMeOutSuiteMediaResolverV1,broadcast?:HearMeOutRoomBroadcast,program?:HearMeOutBroadcastProgram,screenBroadcast?:HearMeOutScreenBroadcast,personaSpeech?:HearMeOutRoomPersonaSpeech){
  try{
    const principal=await resolvePrincipal(request,spmtOrigin);
    const screenRoute=url.pathname.match(/^\/api\/hearmeout\/rooms\/([^/]+)\/screen(?:\/([a-f0-9-]{36}))?$/);
    if(screenRoute){
      requireSameOrigin(request);const sourceRoomId=decodeURIComponent(screenRoute[1]!);requireMembership(rooms,principal,sourceRoomId);
      if(!program||!screenBroadcast)return sendJson(response,503,{error:"Watch party screen sharing is unavailable"});
      const room=rooms.getRoom(principal.tenantId,sourceRoomId);if(!room)throw Error("Room not found");
      const party=program.ensureAppRoom(principal.tenantId,sourceRoomId,room.name),publisher={tenantId:principal.tenantId,sourceRoomId,userId:principal.userId};
      if(request.method==="POST"&&!screenRoute[2])return sendJson(response,201,await screenBroadcast.start(party.roomId,publisher,principal.displayName+"’s screen"));
      if(request.method==="DELETE"&&screenRoute[2]){screenBroadcast.end(party.roomId,screenRoute[2],publisher);return sendJson(response,200,{stopped:true})}
      if(request.method==="POST"&&screenRoute[2]){
        if(!String(request.headers["content-type"]??"").startsWith("video/webm"))return sendJson(response,400,{error:"Expected a WebM screen recording"});
        const chunks:Buffer[]=[];let size=0;for await(const chunk of request){size+=chunk.length;if(size>4*1024*1024)return sendJson(response,413,{error:"Screen chunk is too large"});chunks.push(Buffer.from(chunk))}
        return sendJson(response,200,await screenBroadcast.append(party.roomId,screenRoute[2],publisher,Number(url.searchParams.get("sequence")??-1),Buffer.concat(chunks)));
      }
      return sendJson(response,405,{error:"method_not_allowed"});
    }
    if(program){
      const scoped=url.pathname.match(/^\/api\/hearmeout\/rooms\/([^/]+)\/(?:media\/(music|movie)(\/control)?|broadcast\/(?:music|movie)\/([^/]+))$/);
      if(scoped){
        const sourceRoomId=decodeURIComponent(scoped[1]!);requireMembership(rooms,principal,sourceRoomId);
        const room=rooms.getRoom(principal.tenantId,sourceRoomId);if(!room)throw Error("Room not found");
        const party=program.ensureAppRoom(principal.tenantId,sourceRoomId,room.name);
        if(request.method==="POST"&&scoped[2]){requireSameOrigin(request);const body=await readJson(request);
          if(scoped[3])return sendJson(response,200,program.control(principal,{roomId:party.roomId,action:String(body.action??""),...(typeof body.expectedRequestId==="string"?{expectedRequestId:body.expectedRequestId}:{})}));
          if(!mediaResolver)throw Error("The media worker is unavailable");
          return sendJson(response,201,await program.request({roomId:party.roomId,requesterId:principal.userId,displayName:principal.displayName,query:String(body.query??body.playbackUrl??""),lane:scoped[2] as HearMeOutMediaLaneV1,operationId:mediaOperationId(request,principal,"broadcast")},mediaResolver));
        }
        if(request.method==="GET"&&scoped[4]){if(!broadcast)return sendJson(response,503,{error:"Broadcast unavailable"});return await broadcast.serve(program.binding.tenantId,party.roomId,"movie",scoped[4],response);}
        return sendJson(response,405,{error:"method_not_allowed"});
      }
    }

    const roomFeed=url.pathname.match(/^\/api\/hearmeout\/rooms\/([^/]+)\/broadcast\/(music|movie)\/([^/]+)$/);
    if(roomFeed){if(request.method!=="GET")return sendJson(response,405,{error:"method_not_allowed"});const roomId=decodeURIComponent(roomFeed[1]!);requireMembership(rooms,principal,roomId);if(!broadcast)return sendJson(response,503,{error:"The room broadcast worker is not configured yet"});return await broadcast.serve(principal.tenantId,roomId,roomFeed[2] as "music"|"movie",roomFeed[3]!,response);}
    if(request.method==="GET"&&url.pathname==="/api/hearmeout/rooms")return sendJson(response,200,{rooms:rooms.listRooms(principal).map(room=>roomSummary(rooms,principal,room))});
    if(request.method==="POST"&&url.pathname==="/api/hearmeout/rooms"){requireSameOrigin(request);const body=await readJson(request),name=requiredText(body.name,"name",120),privacy=body.privacy==="private"?"private":"public",password=privacy==="private"&&typeof body.password==="string"&&body.password?body.password:undefined;const room=rooms.createRoom(principal,{roomId:makeRoomId(name),name,privacy,...(password?{password}:{}),operationId:`web-create:${principal.userId}:${randomBytes(8).toString("hex")}`});return sendJson(response,201,room);}
    if(request.method==="GET"&&url.pathname==="/api/hearmeout/assistant")return sendJson(response,200,await spmtJson(request,spmtOrigin,principal.tenantId,"/v1/assistants/community"));
    const bridgeRoute=url.pathname.match(/^\/api\/hearmeout\/rooms\/([^/]+)\/bridge$/);
    if(bridgeRoute){
      if(!voiceBridge)return sendJson(response,503,{error:"bridge_unavailable",message:"Discord voice is not connected on this deployment yet"});
      const roomId=decodeURIComponent(bridgeRoute[1]!);
      if(request.method==="GET")return sendJson(response,200,await voiceBridge.status(principal,roomId));
      if(request.method==="POST"){
        requireSameOrigin(request);const body=await readJson(request);let result;
        switch(body.action){
          case "start":result=await voiceBridge.start(principal,{roomId,guildId:requiredText(body.guildId,"guildId",30),voiceChannelId:requiredText(body.voiceChannelId,"voiceChannelId",30)});break;
          case "stop":result=await voiceBridge.stop(principal,roomId);break;
          case "outbound":result=await voiceBridge.setRoomOutbound(principal,roomId,body.enabled as boolean);break;
          case "profile":result=await voiceBridge.setAudioProfile(principal,roomId,body.audioProfile as any);break;
          case "gain":if(typeof body.gain!=="number"||!Number.isFinite(body.gain))throw Error("Receive gain must be a finite number");result=await voiceBridge.setDiscordReceiveGain(principal,roomId,body.gain);break;
          default:throw Error("Unknown Discord bridge action");
        }
        if(body.action==="start"||body.action==="stop")refreshBridge?.(principal.tenantId,roomId);return sendJson(response,200,result);
      }
    }
    const detail=url.pathname.match(/^\/api\/hearmeout\/rooms\/([^/]+)$/);
    if(detail){
      const roomId=decodeURIComponent(detail[1]!);
      if(request.method==="DELETE"){requireSameOrigin(request);const result=rooms.deleteRoom(principal,roomId,`web-delete:${principal.userId}:${randomBytes(8).toString("hex")}`);onRoomDeleted?.(principal.tenantId,roomId);return sendJson(response,200,result);}
      if(request.method==="GET"){const room=rooms.getRoom(principal.tenantId,roomId);if(!room)return sendJson(response,404,{error:"room_not_found",message:"HearMeOut room not found or expired"});return sendJson(response,200,roomDetail(rooms,consoleStore,principal,room,Boolean(broadcast),program));}
    }
    const join=url.pathname.match(/^\/api\/hearmeout\/rooms\/([^/]+)\/join$/);
    if(request.method==="POST"&&join){requireSameOrigin(request);const body=await readJson(request);return sendJson(response,200,rooms.joinRoom(principal,decodeURIComponent(join[1]!),`web-join:${principal.userId}:${randomBytes(8).toString("hex")}`,undefined,typeof body.password==="string"&&body.password?{password:body.password}:{}));}
    const leave=url.pathname.match(/^\/api\/hearmeout\/rooms\/([^/]+)\/leave$/);
    if(request.method==="POST"&&leave){requireSameOrigin(request);return sendJson(response,200,rooms.leaveRoom(principal,decodeURIComponent(leave[1]!),`web-leave:${principal.userId}:${randomBytes(8).toString("hex")}`));}
    const waiting=url.pathname.match(/^\/api\/hearmeout\/rooms\/([^/]+)\/voice-queue$/);
    if(waiting){const roomId=decodeURIComponent(waiting[1]!);if(request.method==="GET")return sendJson(response,200,{entries:rooms.voiceQueue(principal,roomId),canManage:rooms.getRoom(principal.tenantId,roomId)?.ownerUserId===principal.userId||principal.roles.includes("admin")});if(request.method==="POST"){requireSameOrigin(request);const body=await readJson(request);if(body.action==="join")return sendJson(response,201,rooms.requestVoiceTurn(principal,roomId));if(body.action==="remove")return sendJson(response,200,rooms.removeVoiceTurn(principal,roomId,typeof body.userId==="string"?body.userId:principal.userId));if(body.action==="next"||body.action==="resend"){const entry=body.action==="next"?rooms.admitNextVoiceTurn(principal,roomId,mediaOperationId(request,principal,"voice-admit")):rooms.voiceQueue(principal,roomId).find(item=>item.userId===body.userId&&item.state==="invited");if(!entry)return sendJson(response,200,{entry:null});if(!entry.expiresAt||Date.parse(entry.expiresAt)<=Date.now())throw new Error("This invitation has expired; request a new turn");const roomUrl=new URL('/apps/hearmeout',String(request.headers.origin));roomUrl.searchParams.set('roomId',roomId);let delivered=false;try{await spmtJson(request,spmtOrigin,principal.tenantId,'/v1/commlink/mail',{method:'POST',headers:{'content-type':'application/json','idempotency-key':entry.invitationId!},body:JSON.stringify({recipientUserIds:[entry.userId],subject:'Your HearMeOut voice turn',text:'It is your turn to join '+rooms.getRoom(principal.tenantId,roomId)!.name+'. '+roomUrl.href+' Invitation valid until '+entry.expiresAt})});delivered=true;}catch{}return sendJson(response,200,{entry,roomUrl:roomUrl.href,delivery:delivered?'sent':'pending'});}throw new Error("Choose a voice queue action");}}
    const moderation=url.pathname.match(/^\/api\/hearmeout\/rooms\/([^/]+)\/moderation$/);
    if(request.method==="POST"&&moderation){requireSameOrigin(request);const body=await readJson(request),action=String(body.action??"");if(action!=="kick"&&action!=="timeout"&&action!=="ban"&&action!=="unban"&&action!=="mute"&&action!=="unmute"&&action!=="move")throw new Error("HearMeOut moderation action is invalid");const roomId=decodeURIComponent(moderation[1]!),result=rooms.moderateMember(principal,{roomId,targetUserId:requiredText(body.targetUserId,"targetUserId",160),action,durationSeconds:body.durationSeconds===undefined?undefined:Number(body.durationSeconds),targetRoomId:typeof body.targetRoomId==="string"?body.targetRoomId:undefined,operationId:mediaOperationId(request,principal,"moderate")});const transport=await onModerated?.(principal.tenantId,roomId,result.targetUserId,action,result.targetRoomId);return sendJson(response,200,{...result,...transport});}
    const presence=url.pathname.match(/^\/api\/hearmeout\/rooms\/([^/]+)\/presence$/);
    if(request.method==="POST"&&presence){requireSameOrigin(request);const body=await readJson(request);return sendJson(response,200,rooms.heartbeatPresence(principal,decodeURIComponent(presence[1]!),requiredText(body.connectionId,"connectionId",200)));}
    const chat=url.pathname.match(/^\/api\/hearmeout\/rooms\/([^/]+)\/chat$/);
    if(chat){const roomId=decodeURIComponent(chat[1]!);requireMembership(rooms,principal,roomId);if(request.method==="GET")return sendJson(response,200,{messages:consoleStore.listChat(principal.tenantId,roomId),surface:"commlink"});if(request.method==="POST"){requireSameOrigin(request);const body=await readJson(request);return sendJson(response,201,{message:consoleStore.appendChat(principal,roomId,requiredText(body.text,"text",2000)),surface:"legacy-room-chat"});}}
    if(url.pathname==="/api/hearmeout/music/library"&&request.method==="GET")return sendJson(response,200,rooms.musicLibrary(principal,Number(url.searchParams.get("offset")??0)));
    if(url.pathname==="/api/hearmeout/music/favorites"&&request.method==="POST"){requireSameOrigin(request);const body=await readJson(request),roomId=requiredText(body.roomId,"roomId",160);requireMembership(rooms,principal,roomId);const session=rooms.getSession(principal.tenantId,roomId,"music"),item=[session.current,...session.queue].find(entry=>entry?.requestId===body.requestId)?.item;if(!item)throw new Error("Track is no longer in the room queue");return sendJson(response,201,rooms.saveFavorite(principal,item));}
    const favorite=url.pathname.match(/^\/api\/hearmeout\/music\/favorites\/([a-f0-9]{64})$/);
    if(favorite&&request.method==="DELETE"){requireSameOrigin(request);return sendJson(response,200,rooms.removeFavorite(principal,favorite[1]!));}
    if(favorite&&request.method==="POST"){
      requireSameOrigin(request);const body=await readJson(request),roomId=requiredText(body.roomId,"roomId",160),itemId=favorite[1]!,operationId=mediaOperationId(request,principal,"favorite-queue");
      requireMembership(rooms,principal,roomId);
      return sendJson(response,201,await rooms.enqueueResolved(principal,{roomId,lane:"music",intent:`favorite:${itemId}`,operationId,resolve:async()=>{
        const item=rooms.favorite(principal,itemId),videoId=typeof item.metadata?.videoId==="string"?item.metadata.videoId:item.source==="youtube"?item.itemId:undefined;
        if(!videoId)return item;
        if(!mediaResolver)throw Error("HearMeOut media worker is not connected; your saved track is preserved");
        if(!/^[A-Za-z0-9_-]{11}$/.test(videoId))throw Error("Saved YouTube video id is invalid");
        return mediaResolver.resolve({tenantId:principal.tenantId,billedUserId:principal.userId,requesterId:principal.userId,query:`https://www.youtube.com/watch?v=${videoId}`,lane:"music",operationId});
      }}));
    }
    const radioRoute=url.pathname.match(/^\/api\/hearmeout\/rooms\/([^/]+)\/radio$/);
    if(radioRoute){const roomId=decodeURIComponent(radioRoute[1]!);requireMembership(rooms,principal,roomId);if(request.method==='GET'){const state=rooms.radio(principal.tenantId,roomId);return sendJson(response,200,{enabled:state?.enabled??false,seed:state?.seed??'',history:state?.history??[],error:state?.error});}if(request.method==='POST'){requireSameOrigin(request);const body=await readJson(request);if(typeof body.enabled!=='boolean')throw Error('Choose whether auto-radio is enabled');if(body.enabled&&!mediaResolver)throw Error('HearMeOut media worker is not connected');rooms.configureRadio(principal,roomId,body.enabled,typeof body.seed==='string'?body.seed:'');return sendJson(response,200,{updated:true});}}
    const media=url.pathname.match(/^\/api\/hearmeout\/rooms\/([^/]+)\/media\/(movie|music)$/);
    if(request.method==="POST"&&media){
      requireSameOrigin(request);const roomId=decodeURIComponent(media[1]!),lane=media[2] as HearMeOutMediaLaneV1;requireMembership(rooms,principal,roomId);
      const body=await readJson(request),operationId=mediaOperationId(request,principal,"enqueue");let item;
      if(typeof body.query==="string"){
        if(!mediaResolver)throw new Error("HearMeOut media search is not connected on this deployment");
        item=await mediaResolver.resolve({tenantId:principal.tenantId,query:requiredText(body.query,"query",300),lane,operationId});
      }else{
        const title=requiredText(body.title,"title",300),playbackUrl=playableUrl(body.playbackUrl),durationSeconds=optionalDuration(body.durationSeconds);
        item={itemId:createHash("sha256").update(playbackUrl).digest("hex"),type:lane==="movie"?"movie" as const:"music" as const,title,source:"user-url",playbackUrl,...(durationSeconds===undefined?{}:{durationSeconds})};
        if(hearMeOutYoutubeId(playbackUrl)){if(!mediaResolver)throw new Error("YouTube resolution is not connected on this deployment");item=await mediaResolver.resolve({tenantId:principal.tenantId,query:playbackUrl,lane,operationId});}
      }
      return sendJson(response,201,rooms.enqueue(principal,{roomId,lane,item,operationId}));
    }
    const control=url.pathname.match(/^\/api\/hearmeout\/rooms\/([^/]+)\/media\/(movie|music)\/control$/);
    if(request.method==="POST"&&control){requireSameOrigin(request);const body=await readJson(request),action=String(body.action??"");if(!["play","pause","seek","mute","unmute","volume","next","jump","clear"].includes(action))throw new Error("HearMeOut media action is invalid");const session=rooms.control(principal,{roomId:decodeURIComponent(control[1]!),lane:control[2] as HearMeOutMediaLaneV1,action:action as any,operationId:mediaOperationId(request,principal,"control"),...(typeof body.position==="number"?{position:body.position}:{}),...(typeof body.targetIndex==="number"?{targetIndex:body.targetIndex}:{}),...(typeof body.expectedRequestId==="string"?{expectedRequestId:body.expectedRequestId}:{})});return sendJson(response,200,session);}
    const personaAudio=url.pathname.match(/^\/api\/hearmeout\/rooms\/([^/]+)\/personas\/audio(?:\/([a-f0-9]{64}))?$/);
    if(request.method==='GET'&&personaAudio&&personaSpeech){const roomId=decodeURIComponent(personaAudio[1]!);requireMembership(rooms,principal,roomId);const scope={tenantId:principal.tenantId,roomId};if(!personaAudio[2])return sendJson(response,200,personaSpeech.state(scope));const audio=personaSpeech.audio(scope,personaAudio[2]);response.writeHead(200,{'content-type':'audio/wav','content-length':audio.length,'cache-control':'no-store','x-content-type-options':'nosniff'});response.end(audio);return;}
    const personas=url.pathname.match(/^\/api\/hearmeout\/rooms\/([^/]+)\/personas$/);
    if(personas){const roomId=decodeURIComponent(personas[1]!);requireMembership(rooms,principal,roomId);if(request.method==="GET"){const catalog=personaConversation?await personaConversation.gallery():((await spmtJson(request,spmtOrigin,principal.tenantId,"/v1/assistant/public-personas")) as {personas:HearMeOutPublicPersonaV1[]}).personas;return sendJson(response,200,{personas:consoleStore.listPersonas(principal.tenantId,roomId),catalog,...(!personaConversation?{assistant:await spmtJson(request,spmtOrigin,principal.tenantId,"/v1/assistants/community"),speech:await spmtJson(request,spmtOrigin,principal.tenantId,"/v1/assistant/speech/status").catch(()=>({synthesis:false,transcription:false}))}:{})});}if(request.method==="POST"){requireSameOrigin(request);const body=await readJson(request);if(personaConversation){const catalog=await personaConversation.gallery(),requested=typeof body.personaId==="string"?body.personaId:"",persona=catalog.find(item=>item.personaId===requested||item.targetTenantId===requested)??(catalog.length===1?catalog[0]:undefined);if(!persona?.canInvite)throw new Error("Select a public HearMeOut persona");return sendJson(response,201,{persona:consoleStore.putPersona(principal,roomId,{...persona,transportHealthy:false})});}if(typeof body.personaId==="string"&&body.personaId.startsWith("swpublic_")){const catalog=((await spmtJson(request,spmtOrigin,principal.tenantId,"/v1/assistant/public-personas")) as {personas:HearMeOutPublicPersonaV1[]}).personas,chosen=catalog.find(p=>p.personaId===body.personaId&&p.canInvite);if(!chosen)throw Error("This persona is no longer shared for room use");return sendJson(response,201,{persona:consoleStore.putPersona(principal,roomId,chosen)});}const assistant=await spmtJson(request,spmtOrigin,principal.tenantId,"/v1/assistants/community") as Record<string,unknown>,personaId=requiredText(assistant.personaId??assistant.id??"community-assistant","personaId",200),displayName=requiredText(assistant.displayName??assistant.name??"Assistant","displayName",120);return sendJson(response,201,{persona:consoleStore.putPersona(principal,roomId,{personaId,displayName,...personaAssets(assistant),...(typeof assistant.voice==="string"?{voice:assistant.voice}:{})})});}}
    const personaJob=url.pathname.match(/^\/api\/hearmeout\/rooms\/([^/]+)\/personas\/requests\/([a-f0-9]{64})$/);
    const assistantRequest=(path:string,body?:Record<string,unknown>,key?:string)=>spmtJson(request,spmtOrigin,principal.tenantId,path,body?{method:"POST",headers:{"content-type":"application/json",...(key?{"idempotency-key":key}:{})},body:JSON.stringify(body)}:{});
    if(request.method==="GET"&&personaJob){const roomId=decodeURIComponent(personaJob[1]!);requireMembership(rooms,principal,roomId);const result=await roomAssistant.read({...principal,roomId},personaJob[2]!,assistantRequest,(id,personaId,name,text)=>consoleStore.appendPersona(principal.tenantId,roomId,personaId,name,text.slice(0,2000),`assistant:${id}`));
      if('audioUrl' in result&&result.audioUrl&&'personaId' in result&&personaSpeech){try{await personaSpeech.publish({tenantId:principal.tenantId,roomId},result.requestId,String(result.personaId),()=>readPersonaAudio(request,spmtOrigin,principal.tenantId,result.audioUrl!));return sendJson(response,200,{...result,audioUrl:undefined,sharedRoomAudio:true})}catch{return sendJson(response,200,{...result,audioUrl:undefined,sharedRoomAudio:true,error:'The text reply is ready, but room speech could not be delivered.'})}}
      return sendJson(response,200,result);}
    const personaTranscribe=url.pathname.match(/^\/api\/hearmeout\/rooms\/([^/]+)\/personas\/transcribe$/);
    if(request.method==="POST"&&personaTranscribe){requireSameOrigin(request);const roomId=decodeURIComponent(personaTranscribe[1]!);requireMembership(rooms,principal,roomId);const body=await readJson(request,personaConversation?17*1024*1024:MAX_BODY_BYTES);if(personaConversation&&typeof body.base64Audio==="string")return sendJson(response,200,await personaConversation.transcribe(body.base64Audio));return sendJson(response,202,await roomAssistant.submit({...principal,roomId},{mediaAssetId:requiredText(body.mediaAssetId,"mediaAssetId",100)},mediaOperationId(request,principal,"transcribe"),assistantRequest));}
    const personaRemove=url.pathname.match(/^\/api\/hearmeout\/rooms\/([^/]+)\/personas\/([^/]+)$/);
    if(request.method==="DELETE"&&personaRemove){requireSameOrigin(request);const roomId=decodeURIComponent(personaRemove[1]!),personaId=decodeURIComponent(personaRemove[2]!);requireMembership(rooms,principal,roomId);return sendJson(response,200,consoleStore.removePersona(principal.tenantId,roomId,personaId));}
    const personaInvoke=url.pathname.match(/^\/api\/hearmeout\/rooms\/([^/]+)\/personas\/([^/]+)\/invoke$/);
    if(request.method==="POST"&&personaInvoke){requireSameOrigin(request);const roomId=decodeURIComponent(personaInvoke[1]!),personaId=decodeURIComponent(personaInvoke[2]!);requireMembership(rooms,principal,roomId);const persona=consoleStore.listPersonas(principal.tenantId,roomId).find(item=>item.personaId===personaId);if(!persona)throw new Error("Persona is not in this room");const body=await readJson(request),message=requiredText(body.message,"message",4000);if(personaConversation){consoleStore.appendChat(principal,roomId,message.slice(0,2000));const result=await personaConversation.command({roomId,targetTenantId:persona.targetTenantId||persona.personaId,command:message,actor:{userId:principal.userId,username:principal.displayName,displayName:principal.displayName},speak:body.speak!==false,transport:"shared-browser"});consoleStore.appendPersona(principal.tenantId,roomId,persona.personaId,result.botName,result.reply);const audio=result.payload.tts?.audioDataUri;if(body.speak!==false&&audio&&personaSpeech){if(!/^data:audio\/(?:mpeg|mp3|wav|ogg|webm);base64,[A-Za-z0-9+/]+={0,2}$/.test(audio)||audio.length>16000000)throw Error("Persona speech is invalid or too large");await personaSpeech.publish({tenantId:principal.tenantId,roomId},mediaOperationId(request,principal,"persona"),persona.personaId,async()=>Buffer.from(audio.slice(audio.indexOf(",")+1),"base64"));}return sendJson(response,200,{...result,payload:{...result.payload,tts:undefined},persona,sharedRoomAudio:true});}if(!persona.personaId.startsWith("swpublic_")){const current=await spmtJson(request,spmtOrigin,principal.tenantId,"/v1/assistants/community") as Record<string,unknown>;if(persona.personaId!==(current.personaId??current.id??"community-assistant"))throw Error("Remove this old persona and select an available room persona");}const accepted=await roomAssistant.submit({...principal,roomId},{message,personaId:persona.personaId,displayName:persona.displayName,speak:body.speak!==false},mediaOperationId(request,principal,"persona"),assistantRequest);consoleStore.appendChat(principal,roomId,message.slice(0,2000),"human",principal.displayName,`request:${accepted.requestId}`);return sendJson(response,202,{...accepted,persona});}
    return sendJson(response,404,{error:"not_found",message:"Unknown HearMeOut Green route"});