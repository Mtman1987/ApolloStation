import { assertAppModuleManifestV1, type AppModuleManifestV1 } from "@spmt/contracts";
import { SpmtClient } from "@spmt/sdk";
export * from "./chat-tag.js";
import { CHAT_TAG_EVENT_TYPES } from "./chat-tag.js";

export const CHAT_TAG_ROUND_COMPLETED = "nebula.chat-tag.round.completed.v1";
export const manifest = assertAppModuleManifestV1({schemaVersion:1,manifestVersion:"spmt.app-manifest/v1",id:"nebula-arcade",name:"Nebula Arcade",description:"Bounded game modules including the original Chat Tag, Quackverse, Bingo, and Arena.",capabilities:["chat-tag","quackverse","bingo","arena","game-overlays"],surfaces:["shell","standalone","overlay","popout"],requiredScopes:["events:write","xp:award","overlay:widgets:write"],eventTypes:[CHAT_TAG_ROUND_COMPLETED,...CHAT_TAG_EVENT_TYPES],integration:{identity:"connected",events:"native",xp:"connected",workspace:"connected"},workers:[{id:"chat-tag-bot",role:"provider-command-ingress",execution:"leased",canonicalAuthority:false}]} satisfies AppModuleManifestV1);

export interface ChatTagRoundResult { tenantId:string; channelId:string; roundId:string; winnerUserId:string; taggedUserId:string; completedAt:string; xpAward:number; }
export async function completeChatTagRound(client:SpmtClient,result:ChatTagRoundResult){
  const key=`chat-tag-round:${result.roundId}`;
  await client.publishEvent(result.tenantId,CHAT_TAG_ROUND_COMPLETED,{schemaVersion:1,channelId:result.channelId,roundId:result.roundId,winnerUserId:result.winnerUserId,taggedUserId:result.taggedUserId,completedAt:result.completedAt,xpAward:result.xpAward},key);
  return client.awardXp(result.tenantId,result.winnerUserId,result.xpAward,"chat-tag-round-win",key);
}
