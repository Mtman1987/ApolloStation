import { randomUUID } from "node:crypto";
import type { DeviceCommandCapabilityV1, PairedDeviceKindV1 } from "@spmt/contracts";
import type { SpmtClient } from "@spmt/sdk";
import { createCompanionDeviceCommand, planMountainViewVoiceCommand, type MountainViewVoiceContextV1 } from "./voice-router.js";

export class MountainViewPlatformClient {
  constructor(private readonly client:SpmtClient,private readonly now:()=>string=()=>new Date().toISOString(),private readonly id:()=>string=randomUUID){}
  pair(tenantId:string,input:{deviceId:string;name:string;kind:PairedDeviceKindV1;capabilities:DeviceCommandCapabilityV1[]}){return this.client.pairDevice(tenantId,input);}
  devices(tenantId:string,includeRevoked=false){return this.client.listDevices(tenantId,includeRevoked);}
  revoke(tenantId:string,deviceId:string){return this.client.revokeDevice(tenantId,deviceId);}
  bootstrapCompanion(tenantId:string,input:{deviceId:string;name:string;capabilities:DeviceCommandCapabilityV1[]}){return this.client.createDeviceBootstrap(tenantId,{...input,kind:"companion"});}
  async routeVoice(transcript:string,context:MountainViewVoiceContextV1,input:{confirmed?:boolean;idempotencyKey?:string}={}){const plan=planMountainViewVoiceCommand(transcript,context);if(plan.kind!=="route")return{status:"clarify" as const,plan};if(plan.targetAppId!=="companion")return{status:"routed" as const,plan};const idempotencyKey=input.idempotencyKey??`mountainview:${this.id()}`,command=createCompanionDeviceCommand({plan,context,commandId:this.id(),idempotencyKey,requestedAt:this.now(),...(input.confirmed===undefined?{}:{confirmed:input.confirmed})});const result=await this.client.createExecutionJob(context.tenantId,{ownerAppId:"mountainview",capabilityId:"companion.device.command.v1",executionOwner:"companion",meteredResource:"hosted-worker-minutes",usageQuantity:1,executionTarget:"companion",meteringTarget:"companion",input:{command}},idempotencyKey);return{status:"accepted" as const,plan,command,job:result.job,duplicate:result.duplicate};}
}
