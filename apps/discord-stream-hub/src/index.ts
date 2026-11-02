import { assertAppModuleManifestV1, createAppCatalogRegistrationV1, type AppCatalogRegistrationV1, type AppModuleManifestV1 } from "@spmt/contracts";
import { SpmtClient } from "@spmt/sdk";
import { NEBULA_ARCADE_ROUND_COMPLETED, NEBULA_TAG_TAG_COMPLETED } from "@spmt/nebula-arcade";
export * from "./live-monitor.js";
export * from "./twitch-live-poller.js";
export * from "./discord-live-publisher.js";
export * from "./simulation-room.js";
export * from "./live-worker.js";
export * from "./signal-discovery.js";
export * from "./signal-seeker.js";
export * from "./banner-policy.js";
export * from "./banner-generation.js";
export * from "./bot-action-adapter.js";
export * from "./suite-action-worker.js";
export * from "./suite-action-operations.js";
export * from "./provider-identity.js";
export * from "./points-event-router.js";
export * from "./points.js";
export * from "./calendar.js";
export * from "./calendar-presentation.js";
export * from "./application-flow.js";
export * from "./applications.js";
export * from "./discord-application-interactions.js";
export * from "./shoutout-groups.js";
export * from "./clip-gif-library.js";
export * from "./nebula-gameplay.js";
export * from "./channel-moderation.js";
export * from "./signal-control.js";
export * from "./signal-presentation.js";
export * from "./card-pack-render.js";
export * from "./quackverse-art.js";
export * from "./quackverse-pack-publisher.js";
export * from "./settings.js";
export * from "./web-controls.js";
export * from "./raid-pile.js";
export * from "./raid-pile-relay.js";
export * from "./system-live-channels.js";
export * from "./lounge-state.js";
export * from "./lounge-avatar.js";
export * from "./lounge-host.js";
export * from "./lounge-program.js";
export * from "./lounge-overlay.js";
export const DISCORD_ANNOUNCEMENT_REQUESTED="dsh.discord.announcement.requested.v1";
export const DSH_FORUM_POST_FORWARDED="dsh.forum.post-forwarded.v1";
export interface DshForwardedForumPostV1 {
  sourceApp:string;sourceServerId:string;sourceChannelId:string;sourceChannelName:string;
  sourceMessageId:string;sourceMessageUrl?:string;authorId:string;authorName:string;
  title:string;content:string;category?:string;postedAt?:string;
  embeds?:Array<Record<string,unknown>>;attachments?:Array<Record<string,unknown>>;
  mentionedUsers?:Array<Record<string,unknown>>;
}
function forumText(value:unknown,max:number){const result=String(value??"").trim();if(!result||result.length>max||result.includes("\\0"))throw new Error("Forwarded forum post contains invalid text");return result;}
function forumList(value:unknown,max:number){if(value===undefined||value===null)return[];if(!Array.isArray(value)||value.length>max)throw new Error("Forwarded forum post contains too many rich items");return value.map(item=>{if(!item||typeof item!=="object"||Array.isArray(item))throw new Error("Forwarded forum rich item is invalid");const encoded=JSON.stringify(item);if(encoded.length>12000)throw new Error("Forwarded forum rich item is too large");return JSON.parse(encoded) as Record<string,unknown>;});}
export function normalizeDshForwardedForumPost(value:unknown):DshForwardedForumPostV1{
  if(!value||typeof value!=="object"||Array.isArray(value))throw new Error("Forwarded forum post is required");
  const item=value as Record<string,unknown>,postedAt=item.postedAt===undefined?undefined:forumText(item.postedAt,60);
  if(postedAt&& !Number.isFinite(Date.parse(postedAt)))throw new Error("Forwarded forum post time is invalid");
  const sourceMessageUrl=item.sourceMessageUrl===undefined?undefined:forumText(item.sourceMessageUrl,2048);
  if(sourceMessageUrl){const url=new URL(sourceMessageUrl);if(url.protocol!=="https:")throw new Error("Forwarded forum source URL must use HTTPS");}
  return {sourceApp:forumText(item.sourceApp,80),sourceServerId:forumText(item.sourceServerId,120),sourceChannelId:forumText(item.sourceChannelId,120),sourceChannelName:forumText(item.sourceChannelName,120),sourceMessageId:forumText(item.sourceMessageId,120),...(sourceMessageUrl?{sourceMessageUrl}:{}),authorId:forumText(item.authorId,120),authorName:forumText(item.authorName,120),title:forumText(item.title,300),content:forumText(item.content,12000),...(item.category===undefined?{}:{category:forumText(item.category,100)}),...(postedAt?{postedAt}:{}),embeds:forumList(item.embeds,10),attachments:forumList(item.attachments,20),mentionedUsers:forumList(item.mentionedUsers,50)};
}
export async function forwardDshForumPost(client:SpmtClient,tenantId:string,value:unknown){
  const post=normalizeDshForwardedForumPost(value),sourceKey=post.sourceMessageId;
  const result=await client.publishEvent(tenantId,DSH_FORUM_POST_FORWARDED,{schemaVersion:1,...post,forwardedAt:new Date().toISOString()},`dsh-forum:${post.sourceApp}:${post.sourceServerId}:${post.sourceChannelId}:${sourceKey}`);
  return {accepted:true,duplicate:result.duplicate,event:result.event};
}
export const manifest=assertAppModuleManifestV1({schemaVersion:1,manifestVersion:"spmt.app-manifest/v1",id:"discord-stream-hub",name:"Discord Stream Hub",description:"Discord community, shoutout, calendar, moderation, forums, media, and canonical SPMT points workflows.",capabilities:["live-monitoring","shoutouts","shoutout-groups","spotlight","community-spotlight-banner","discord-live-delivery","discord-message-edit","calendar","participation-inquiries","moderation","channel-nuke","forums","clips","ten-gif-sixty-second-rotation","nebula-gameplay-rotation","nebula-stale-capture-recovery","role-aware-banner-gif","quackverse-art-enhance","quackverse-hover-gif","quackverse-art-job-worker","card-pack-gif-rendering","card-pack-message-upgrade","signal-seeker","signal-presentation","signal-inline-removal","durable-tenant-settings","points","leaderboard","wallet-settlement","provider-identity","provider-points-ingress","tenant-balances","simulation-rooms","raid-pile-lifecycle","raid-pile-lounge","stella-lounge-host","stella-30fps-avatar","lounge-program-rotation","lounge-browser-overlay"],surfaces:["shell","standalone","overlay"],requiredScopes:["assistants:invoke","jobs:write","events:read","events:write","identity:read","identity:write","identity:onboard","providers:grant","runtime:write","jobs:claim","xp:read","xp:write"],eventTypes:[DISCORD_ANNOUNCEMENT_REQUESTED,DSH_FORUM_POST_FORWARDED],integration:{identity:"connected",events:"native",commlink:"connected",workspace:"connected"},workers:[{id:"dsh-live-monitor",role:"provider-monitoring-and-discord-delivery",execution:"anchored",canonicalAuthority:false},{id:"dsh-clip-worker",role:"clip processing, Lounge avatar rendering, 60-second gameplay capture, card-pack capture, Quackverse art enhancement, and deterministic GIF rendering",execution:"elastic",canonicalAuthority:false}]} satisfies AppModuleManifestV1);
export function discordStreamHubCatalogRegistration(launchUrl:string):AppCatalogRegistrationV1{const url=new URL(launchUrl);url.searchParams.delete("surface");return createAppCatalogRegistrationV1(manifest,{version:"0.1.0-green",launchUrl:url.toString(),surfaces:["shell","standalone","overlay"]});}
export async function requestNebulaArcadeAnnouncements(client:SpmtClient,tenantId:string){const events=await client.listEvents(tenantId,{type:NEBULA_ARCADE_ROUND_COMPLETED,sourceAppId:"nebula-arcade",limit:100});for(const event of events){const id=String(event.id??event.eventId??"");if(!id)continue;await client.publishEvent(tenantId,DISCORD_ANNOUNCEMENT_REQUESTED,{schemaVersion:1,sourceEventId:id,kind:"nebula-arcade-round",payload:event.payload??{}},`dsh-nebula-arcade:${id}`);}return{observed:events.length};}
export async function requestNebulaArcadeTagAnnouncements(client:SpmtClient,tenantId:string){const events=await client.listEvents(tenantId,{type:NEBULA_TAG_TAG_COMPLETED,sourceAppId:"nebula-arcade",limit:100});for(const event of events){const id=String(event.id??event.eventId??"");if(!id)continue;await client.publishEvent(tenantId,DISCORD_ANNOUNCEMENT_REQUESTED,{schemaVersion:1,sourceEventId:id,kind:"nebula-arcade-tag",payload:event.payload??{}},`dsh-nebula-arcade:${id}`);}return{observed:events.length};}

export * from "./calendar-delivery.js";
export * from "./calendar-interactions.js";
export * from "./calendar-sync.js";
