import { assertAppModuleManifestV1, type AppCatalogRegistrationV1, type AppModuleManifestV1 } from "@spmt/contracts";
export * from "./room-media-core.js";
export * from "./activity-contract.js";
export * from "./activity-room.js";
export * from "./livekit-grants.js";
export { HearMeOutLiveKitSigner, verifyHearMeOutLiveKitToken, type HearMeOutLiveKitGrantV1 } from "./livekit-signer.js";
export * from "./discord-adapter.js";
export * from "./discord-interactions.js";
export * from "./discord-receive-audio.js";
export * from "./voice-bridge.js";
export * from "./voice-bridge-resilience.js";
export * from "./worker-media-cache.js";
export * from "./worker-music-catalog.js";
export * from "./watch-hls-policy.js";
export const manifest=assertAppModuleManifestV1({schemaVersion:1,manifestVersion:"spmt.app-manifest/v1",id:"hearmeout",name:"HearMeOut",description:"Voice rooms, synchronized watch and music sessions, Discord Activity, and OBS media outputs.",capabilities:["voice-rooms","livekit","watch-parties","music-queue","discord-activity","discord-guilds","discord-channels","discord-messages","discord-embeds","discord-invites","discord-interactions","discord-voice-bridge","obs-now-playing"],surfaces:["shell","standalone","overlay","popout"],requiredScopes:["events:write","identity:read","devices:read"],eventTypes:["hearmeout.room.changed.v1","hearmeout.media-session.changed.v1"],integration:{identity:"connected",events:"native",workspace:"connected",devices:"connected"},workers:[{id:"hmo-dj-worker",role:"media-resolution-cache-and-discord-voice",execution:"elastic",canonicalAuthority:false}]} satisfies AppModuleManifestV1);
export function hearMeOutCatalogRegistration(publicOrigin:string):AppCatalogRegistrationV1{const origin=catalogOrigin(publicOrigin,"HearMeOut");return{appId:manifest.id,name:manifest.name,description:manifest.description,version:"0.1.0-green",launchUrl:new URL("/apps/hearmeout?surface=workspace",origin).toString(),allowedScopes:[...manifest.requiredScopes],surfaces:["shell","standalone","overlay","popout"],status:"active"};}
function catalogOrigin(value:string,name:string){const origin=new URL(value);if(origin.username||origin.password||origin.pathname!=="/"||origin.search||origin.hash)throw new Error(`${name} catalog origin must be a credential-free origin`);return origin;}
