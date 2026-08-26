import { assertAppModuleManifestV1, type AppCatalogRegistrationV1, type AppModuleManifestV1 } from "@spmt/contracts";
import { SpmtClient } from "@spmt/sdk";
import { DISCORD_ANNOUNCEMENT_REQUESTED } from "@spmt/discord-stream-hub";
import { STREAMWEAVER_PROVIDER_ACTIVITY, STREAMWEAVER_DONOR_ACTION_FIRED, STREAMWEAVER_DONOR_EFFECT_REQUESTED } from "./donor-event-actions.js";
import { STREAMWEAVER_REDEEM_EFFECT_REQUESTED, STREAMWEAVER_REDEEM_INVOKED } from "./donor-redeem-actions.js";
import { STREAMWEAVER_BIC_COUNTER_UPDATED, STREAMWEAVER_SOCIAL_INTERACTION } from "./donor-social-actions.js";
import { STREAMWEAVER_SHOUTOUT_AUDIT, STREAMWEAVER_SHOUTOUT_EFFECT_REQUESTED } from "./donor-shoutout-actions.js";
export * from "./bic-store.js";
export * from "./chat-gateway-consumer.js";
export * from "./provider-identity-resolver.js";
export * from "./economy.js";
export * from "./economy-admin.js";
export * from "./command-router.js";
export * from "./donor-command-catalog.js";
export * from "./donor-command-runtime.js";
export * from "./donor-command-services.js";
export * from "./donor-event-actions.js";
export * from "./donor-redeem-actions.js";
export * from "./donor-social-actions.js";
export * from "./donor-shoutout-actions.js";
export * from "./shoutout-matcher.js";
export * from "./shoutout-store.js";
export * from "./twitch-command-adapter.js";
export * from "./username-matcher.js";
export * from "./overlay-runtime.js";
export const STREAMWEAVER_OVERLAY_CUE="streamweaver.overlay.cue.requested.v1";
export const manifest=assertAppModuleManifestV1({schemaVersion:1,manifestVersion:"spmt.app-manifest/v1",id:"streamweaver",name:"StreamWeaver",description:"Tenant-configured personas, commands, automation, TTS, tenant-owned currency, optional supply-diluted SPMT exchange, normalized chat consumption, and stream outputs.",capabilities:["personas","commands","donor-command-compatibility","donor-event-compatibility","donor-redeem-compatibility","donor-social-compatibility","donor-shoutout-compatibility","bic-lighter-tracker","twitch-command-operations","actions","redeems","economy","tenant-currency","gamble","points-transfer","spmt-exchange","tts","chat-consumer","provider-identity","overlays","research"],surfaces:["shell","standalone","overlay","popout"],requiredScopes:["events:read","events:write","assistants:invoke","stellar:invoke","overlay:widgets:write","xp:write"],eventTypes:[STREAMWEAVER_OVERLAY_CUE,STREAMWEAVER_PROVIDER_ACTIVITY,STREAMWEAVER_DONOR_ACTION_FIRED,STREAMWEAVER_DONOR_EFFECT_REQUESTED,STREAMWEAVER_REDEEM_INVOKED,STREAMWEAVER_REDEEM_EFFECT_REQUESTED,STREAMWEAVER_SOCIAL_INTERACTION,STREAMWEAVER_BIC_COUNTER_UPDATED,STREAMWEAVER_SHOUTOUT_AUDIT,STREAMWEAVER_SHOUTOUT_EFFECT_REQUESTED],integration:{identity:"connected",events:"native",commlink:"connected",stellar:"connected",workspace:"connected"},workers:[]} satisfies AppModuleManifestV1);
export function streamweaverCatalogRegistration(publicOrigin:string):AppCatalogRegistrationV1{const origin=catalogOrigin(publicOrigin,"StreamWeaver");return{appId:manifest.id,name:manifest.name,description:manifest.description,version:"0.1.0-green",launchUrl:new URL("/apps/streamweaver?surface=workspace",origin).toString(),allowedScopes:[...manifest.requiredScopes],surfaces:["shell","standalone","overlay","popout"],status:"active"};}
export async function cueAnnouncementOverlays(client:SpmtClient,tenantId:string){const events=await client.listEvents(tenantId,{type:DISCORD_ANNOUNCEMENT_REQUESTED,sourceAppId:"discord-stream-hub",limit:100});for(const event of events){const id=String(event.id??event.eventId??"");if(!id)continue;await client.publishEvent(tenantId,STREAMWEAVER_OVERLAY_CUE,{schemaVersion:1,sourceEventId:id,renderer:"community-announcement",payload:event.payload??{}},`streamweaver-announcement:${id}`);}return{observed:events.length};}
function catalogOrigin(value:string,name:string){const origin=new URL(value);if(origin.username||origin.password||origin.pathname!=="/"||origin.search||origin.hash)throw new Error(`${name} catalog origin must be a credential-free origin`);return origin;}
