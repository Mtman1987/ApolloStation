import { assertAppModuleManifestV1, type AppCatalogRegistrationV1, type AppModuleManifestV1 } from "@spmt/contracts";
import { SpmtClient } from "@spmt/sdk";
export * from "./chat-tag.js";
export * from "./chat-tag-runtime.js";
export * from "./chat-tag-gateway.js";
export * from "./chat-tag-overlay.js";
export * from "./chat-tag-overlay-http.js";
export * from "./chat-tag-migration.js";
export * from "./chat-tag-experience.js";
export * from "./game-hub.js";
import { CHAT_TAG_EVENT_TYPES } from "./chat-tag.js";

export const CHAT_TAG_ROUND_COMPLETED = "nebula.chat-tag.round.completed.v1";
export const manifest = assertAppModuleManifestV1({schemaVersion:1,manifestVersion:"spmt.app-manifest/v1",id:"nebula-arcade",name:"Nebula Arcade",description:"Bounded game modules including the original Chat Tag, Quackverse, Bingo, and Arena.",capabilities:["chat-tag","quackverse","bingo","arena","game-overlays"],surfaces:["shell","standalone","overlay","popout"],requiredScopes:["events:write","xp:write","overlay:widgets:write"],eventTypes:[CHAT_TAG_ROUND_COMPLETED,...CHAT_TAG_EVENT_TYPES],integration:{identity:"connected",events:"native",xp:"connected",workspace:"connected"},workers:[{id:"chat-tag-bot",role:"provider-command-ingress",execution:"leased",canonicalAuthority:false}]} satisfies AppModuleManifestV1);

export function chatTagCatalogRegistration(publicOrigin: string): AppCatalogRegistrationV1 {
  const origin = new URL(publicOrigin);
  if (origin.username || origin.password || origin.pathname !== "/" || origin.search || origin.hash) throw new Error("Chat Tag catalog origin must be a credential-free origin");
  return {
    appId: "chat-tag",
    name: "Chat Tag",
    description: "The original persistent community tag game with provider-neutral chat commands and OBS output.",
    version: "0.1.0-green",
    launchUrl: new URL("/apps/chat-tag", origin).toString(),
    allowedScopes: ["events:write", "xp:write", "overlay:widgets:write"],
    surfaces: ["shell", "standalone", "overlay"],
    status: "active",
  };
}

export interface ChatTagRoundResult { tenantId:string; channelId:string; roundId:string; winnerUserId:string; taggedUserId:string; completedAt:string; xpAward:number; }
export async function completeChatTagRound(client:SpmtClient,result:ChatTagRoundResult){
  const key=`chat-tag-round:${result.roundId}`;
  await client.publishEvent(result.tenantId,CHAT_TAG_ROUND_COMPLETED,{schemaVersion:1,channelId:result.channelId,roundId:result.roundId,winnerUserId:result.winnerUserId,taggedUserId:result.taggedUserId,completedAt:result.completedAt,xpAward:result.xpAward},key);
  return client.awardXp(result.tenantId,result.winnerUserId,result.xpAward,"chat-tag-round-win",key);
}
