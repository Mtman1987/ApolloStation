import { assertAppModuleManifestV1, type AppCatalogRegistrationV1, type AppModuleManifestV1 } from "@spmt/contracts";
export * from "./config-store.js";
export * from "./device-relay.js";
export * from "./diagnostics.js";
export * from "./media-jobs.js";
export * from "./relay-client.js";
export * from "./runtime-handlers.js";
export * from "./spmt-surfaces.js";
export * from "./tenant-bootstrap.js";
export * from "./update-manager.js";
export * from "./workflow-jobs.js";
export * from "./workflow-store-sqlite.js";
export const manifest=assertAppModuleManifestV1({schemaVersion:1,manifestVersion:"spmt.app-manifest/v1",id:"companion",name:"SpaceMountain Companion",description:"Paired local relay for OBS, overlays, media, devices, approved workflows, diagnostics, and local compute.",capabilities:["device-relay","obs-control","companion-audio-control","universal-overlay","local-media","ffmpeg-jobs","reviewed-workflows","durable-workflow-jobs","local-job-claims","sanitized-diagnostics","local-ai"],surfaces:["shell","standalone","overlay","popout"],requiredScopes:["devices:pair","devices:command","events:write","jobs:claim"],eventTypes:["companion.device.state.v1","companion.job.completed.v1"],integration:{identity:"connected",events:"native",workspace:"connected",devices:"native"},workers:[{id:"companion-local-runtime",role:"device-and-local-compute",execution:"local",canonicalAuthority:false}]} satisfies AppModuleManifestV1);
export function companionCatalogRegistration(publicOrigin:string):AppCatalogRegistrationV1{const origin=catalogOrigin(publicOrigin,"SpaceMountain Companion");return{appId:manifest.id,name:manifest.name,description:manifest.description,version:"0.1.0-green",launchUrl:new URL("/apps/companion?surface=workspace",origin).toString(),allowedScopes:[...manifest.requiredScopes],surfaces:["shell","standalone","overlay","popout"],status:"active"};}
function catalogOrigin(value:string,name:string){const origin=new URL(value);if(origin.username||origin.password||origin.pathname!=="/"||origin.search||origin.hash)throw new Error(`${name} catalog origin must be a credential-free origin`);return origin;}
