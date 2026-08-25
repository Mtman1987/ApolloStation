import { assertAppModuleManifestV1, type AppCatalogRegistrationV1, type AppModuleManifestV1 } from "@spmt/contracts";
import { SpmtClient } from "@spmt/sdk";
import { DISCORD_ANNOUNCEMENT_REQUESTED } from "@spmt/discord-stream-hub";
export * from "./chat-gateway-consumer.js";
export * from "./provider-identity-resolver.js";
export * from "./economy.js";
export * from "./economy-admin.js";
export * from "./command-router.js";
export * from "./donor-command-catalog.js";
export * from "./donor-command-runtime.js";
export * from "./donor-command-services.js";
export * from "./donor-event-actions.js";
export * from "./twitch-command-adapter.js";
export const STREAMWEAVER_OVERLAY_CUE="streamweaver.overlay.cue.requested.v1";
export const manifest=assertAppModuleManifestV1({schemaVersion:1,manifestVersion:"spmt.app-manifest/v1",id:"streamweaver",name:"StreamWeaver",description:"Tenant-configured personas, commands, automation, TTS, normalized chat consumption, canonical economy, and stream outputs.",capabilities:["personas","commands","donor-command-compatibility","donor-event-compatibility","twitch-command-operations","actions","redeems","economy","gamble","points-transfer","tts","chat-consumer","provider-identity","overlays","research"],surfaces:["shell","standalone","overlay","popout"],requiredScopes:["events:read","events:write","assistants:invoke","stellar:invoke","overlay:widgets:write","xp:read","xp:write"],eventTypes:[STREAMWEAVER_OVERLAY_CUE],integration:{identity:"connected",events:"native",commlink:"connected",stellar:"connected",workspace:"connected"},workers:[]} satisfies AppModuleManifestV1);
export function streamweaverCatalogRegistration(publicOrigin:string):AppCatalogRegistrationV1{const origin=catalogOrigin(publicOrigin,"StreamWeaver");return{appId:manifest.id,name:manifest.name,description:manifest.description,version:"0.1.0-green",launchUrl:new URL("/apps/streamweaver?surface=workspace",origin).toString(),allowedScopes:[...manifest.requiredScopes],surfaces:["shell","standalone","overlay","popout"],status:"active"};}
export async function cueAnnouncementOverlays(client:SpmtClient,tenantId:string){const events=await client.listEvents(tenantId,{type:DISCORD_ANNOUNCEMENT_REQUESTED,sourceAppId:"discord-stream-hub",limit:100});for(const event of events){const id=String(event.id??event.eventId??"");if(!id)continue;await client.publishEvent(tenantId,STREAMWEAVER_OVERLAY_CUE,{schemaVersion:1,sourceEventId:id,renderer:"community-announcement",payload:event.payload??{}},`streamweaver-announcement:${id}`);}return{observed:events.length};}
function catalogOrigin(value:string,name:string){const origin=new URL(value);if(origin.username||origin.password||origin.pathname!=="/"||origin.search||origin.hash)throw new Error(`${name} catalog origin must be a credential-free origin`);return origin;}
