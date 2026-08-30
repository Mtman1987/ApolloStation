import { assertAppModuleManifestV1, createAppCatalogRegistrationV1, type AppCatalogRegistrationV1, type AppModuleManifestV1 } from "@spmt/contracts";
import { SpmtClient } from "@spmt/sdk";
export * from "./nebula-tag.js";
export * from "./nebula-tag-runtime.js";
export * from "./nebula-tag-gateway.js";
export * from "./nebula-tag-overlay.js";
export * from "./nebula-tag-overlay-http.js";
export * from "./nebula-tag-migration.js";
export * from "./nebula-tag-experience.js";
export * from "./game-hub.js";
export * from "./game-runtime.js";
export * from "./game-runtime-store.js";
export * from "./game-actions.js";
export * from "./overlay-scenes.js";
export * from "./game-mixes.js";
export * from "./quackverse-state.js";
export * from "./quackverse-packs.js";
export * from "./quackverse-battle.js";
export * from "./bingo-game.js";
export * from "./provider-runtime.js";
export * from "./discord-dashboard.js";
export * from "./gameplay-showcase.js";
import { NEBULA_TAG_EVENT_TYPES } from "./nebula-tag.js";

export const NEBULA_ARCADE_ROUND_COMPLETED = "nebula.arcade.round.completed.v1";
export const manifest = assertAppModuleManifestV1({schemaVersion:1,manifestVersion:"spmt.app-manifest/v1",id:"nebula-arcade",name:"Nebula Arcade",description:"Cosmic Games Hub containing twenty equal community games and reusable multi-game overlays.",capabilities:["tag","quackverse","bingo","arena","game-overlays","overlay-scenes","gameplay-showcase-manifest"],surfaces:["shell","standalone","overlay","popout"],requiredScopes:["events:write","xp:write","overlay:widgets:write"],eventTypes:[NEBULA_ARCADE_ROUND_COMPLETED,...NEBULA_TAG_EVENT_TYPES],integration:{identity:"connected",events:"native",xp:"connected",workspace:"connected"},workers:[{id:"nebula-arcade-provider-ingress",role:"provider-command-ingress",execution:"leased",canonicalAuthority:false}]} satisfies AppModuleManifestV1);

export function nebulaArcadeCatalogRegistration(launchUrl: string): AppCatalogRegistrationV1 {
  return createAppCatalogRegistrationV1(manifest, {
    version: "0.1.0-green",
    launchUrl,
    allowedScopes: ["events:write", "xp:write", "overlay:widgets:write"],
    surfaces: ["shell", "standalone", "overlay"],
  });
}
export interface NebulaArcadeRoundResult { tenantId:string; channelId:string; roundId:string; winnerUserId:string; taggedUserId:string; completedAt:string; xpAward:number; }
export async function completeNebulaArcadeRound(client:SpmtClient,result:NebulaArcadeRoundResult){
  const key=`nebula-arcade-round:${result.roundId}`;
  await client.publishEvent(result.tenantId,NEBULA_ARCADE_ROUND_COMPLETED,{schemaVersion:1,channelId:result.channelId,roundId:result.roundId,winnerUserId:result.winnerUserId,taggedUserId:result.taggedUserId,completedAt:result.completedAt,xpAward:result.xpAward},key);
  return client.awardXp(result.tenantId,result.winnerUserId,result.xpAward,"nebula-arcade-round-win",key);
}
