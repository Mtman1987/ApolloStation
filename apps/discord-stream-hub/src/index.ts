import { assertAppModuleManifestV1, createAppCatalogRegistrationV1, type AppCatalogRegistrationV1, type AppModuleManifestV1 } from "@spmt/contracts";
import { SpmtClient } from "@spmt/sdk";
import { NEBULA_ARCADE_ROUND_COMPLETED, NEBULA_TAG_TAG_COMPLETED } from "@spmt/nebula-arcade";
export * from "./live-monitor.js";
export * from "./twitch-live-poller.js";
export * from "./discord-live-publisher.js";
export * from "./live-worker.js";
export * from "./signal-discovery.js";
export * from "./signal-seeker.js";
export * from "./banner-policy.js";
export * from "./banner-generation.js";
export * from "./bot-action-adapter.js";
export * from "./provider-identity.js";
export * from "./points-event-router.js";
export * from "./points.js";
export * from "./calendar.js";
export * from "./application-flow.js";
export * from "./shoutout-groups.js";
export * from "./clip-gif-library.js";
export * from "./nebula-gameplay.js";
export const DISCORD_ANNOUNCEMENT_REQUESTED="dsh.discord.announcement.requested.v1";
export const manifest=assertAppModuleManifestV1({schemaVersion:1,manifestVersion:"spmt.app-manifest/v1",id:"discord-stream-hub",name:"Discord Stream Hub",description:"Discord community, shoutout, calendar, moderation, forums, media, and canonical SPMT points workflows.",capabilities:["live-monitoring","shoutouts","shoutout-groups","spotlight","discord-live-delivery","calendar","participation-inquiries","moderation","forums","clips","ten-gif-sixty-second-rotation","nebula-gameplay-rotation","role-aware-banner-gif","signal-seeker","points","leaderboard","wallet-settlement","provider-identity","provider-points-ingress","tenant-balances"],surfaces:["shell","standalone","overlay"],requiredScopes:["events:read","events:write","identity:read","providers:grant","runtime:write","xp:read","xp:write"],eventTypes:[DISCORD_ANNOUNCEMENT_REQUESTED],integration:{identity:"connected",events:"native",commlink:"connected",workspace:"connected"},workers:[{id:"dsh-live-monitor",role:"provider-monitoring-and-discord-delivery",execution:"anchored",canonicalAuthority:false},{id:"dsh-clip-worker",role:"clip processing, 60-second gameplay capture, and deterministic role-aware GIF rendering",execution:"elastic",canonicalAuthority:false}]} satisfies AppModuleManifestV1);
export function discordStreamHubCatalogRegistration(launchUrl:string):AppCatalogRegistrationV1{const url=new URL(launchUrl);url.searchParams.delete("surface");return createAppCatalogRegistrationV1(manifest,{version:"0.1.0-green",launchUrl:url.toString(),surfaces:["shell","standalone","overlay"]});}
export async function requestNebulaArcadeAnnouncements(client:SpmtClient,tenantId:string){const events=await client.listEvents(tenantId,{type:NEBULA_ARCADE_ROUND_COMPLETED,sourceAppId:"nebula-arcade",limit:100});for(const event of events){const id=String(event.id??event.eventId??"");if(!id)continue;await client.publishEvent(tenantId,DISCORD_ANNOUNCEMENT_REQUESTED,{schemaVersion:1,sourceEventId:id,kind:"nebula-arcade-round",payload:event.payload??{}},`dsh-nebula-arcade:${id}`);}return{observed:events.length};}
export async function requestNebulaArcadeTagAnnouncements(client:SpmtClient,tenantId:string){const events=await client.listEvents(tenantId,{type:NEBULA_TAG_TAG_COMPLETED,sourceAppId:"nebula-arcade",limit:100});for(const event of events){const id=String(event.id??event.eventId??"");if(!id)continue;await client.publishEvent(tenantId,DISCORD_ANNOUNCEMENT_REQUESTED,{schemaVersion:1,sourceEventId:id,kind:"nebula-arcade-tag",payload:event.payload??{}},`dsh-nebula-arcade:${id}`);}return{observed:events.length};}
