import { assertAppModuleManifestV1, type AppCatalogRegistrationV1, type AppModuleManifestV1 } from "@spmt/contracts";
import { SpmtClient } from "@spmt/sdk";
import { CHAT_TAG_ROUND_COMPLETED, CHAT_TAG_TAG_COMPLETED } from "@spmt/nebula-arcade";
export * from "./live-monitor.js";
export * from "./twitch-live-poller.js";
export * from "./discord-live-publisher.js";
export * from "./signal-discovery.js";
export * from "./provider-identity.js";
export * from "./points-event-router.js";
export * from "./points.js";
export const DISCORD_ANNOUNCEMENT_REQUESTED="dsh.discord.announcement.requested.v1";
export const manifest=assertAppModuleManifestV1({schemaVersion:1,manifestVersion:"spmt.app-manifest/v1",id:"discord-stream-hub",name:"Discord Stream Hub",description:"Discord community, shoutout, calendar, moderation, forums, media, and canonical SPMT points workflows.",capabilities:["live-monitoring","shoutouts","spotlight","discord-live-delivery","calendar","moderation","forums","clips","points","leaderboard","wallet-settlement","provider-identity","provider-points-ingress","tenant-balances"],surfaces:["shell","standalone","overlay"],requiredScopes:["events:read","events:write","identity:read","xp:read","xp:write"],eventTypes:[DISCORD_ANNOUNCEMENT_REQUESTED],integration:{identity:"connected",events:"native",commlink:"connected",workspace:"connected"},workers:[{id:"dsh-clip-worker",role:"clip-processing",execution:"elastic",canonicalAuthority:false}]} satisfies AppModuleManifestV1);
export function discordStreamHubCatalogRegistration(publicOrigin:string):AppCatalogRegistrationV1{const origin=catalogOrigin(publicOrigin,"Discord Stream Hub");return{appId:manifest.id,name:manifest.name,description:manifest.description,version:"0.1.0-green",launchUrl:new URL("/apps/discord-stream-hub?surface=workspace",origin).toString(),allowedScopes:[...manifest.requiredScopes],surfaces:["shell","standalone","overlay"],status:"active"};}
export async function requestChatTagAnnouncements(client:SpmtClient,tenantId:string){const events=await client.listEvents(tenantId,{type:CHAT_TAG_ROUND_COMPLETED,sourceAppId:"nebula-arcade",limit:100});for(const event of events){const id=String(event.id??event.eventId??"");if(!id)continue;await client.publishEvent(tenantId,DISCORD_ANNOUNCEMENT_REQUESTED,{schemaVersion:1,sourceEventId:id,kind:"chat-tag-round",payload:event.payload??{}},`dsh-chat-tag:${id}`);}return{observed:events.length};}
export async function requestChatTagGameAnnouncements(client:SpmtClient,tenantId:string){const events=await client.listEvents(tenantId,{type:CHAT_TAG_TAG_COMPLETED,sourceAppId:"nebula-arcade",limit:100});for(const event of events){const id=String(event.id??event.eventId??"");if(!id)continue;await client.publishEvent(tenantId,DISCORD_ANNOUNCEMENT_REQUESTED,{schemaVersion:1,sourceEventId:id,kind:"chat-tag",payload:event.payload??{}},`dsh-chat-tag:${id}`);}return{observed:events.length};}
function catalogOrigin(value:string,name:string){const origin=new URL(value);if(origin.username||origin.password||origin.pathname!=="/"||origin.search||origin.hash)throw new Error(`${name} catalog origin must be a credential-free origin`);return origin;}
