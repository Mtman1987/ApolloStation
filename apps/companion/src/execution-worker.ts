import type { DeviceRelayCommandV1, ExecutionJobV1 } from "@spmt/contracts";
import type { SpmtClient } from "@spmt/sdk";
import { SqliteCompanionDeviceRelay, type CompanionLocalAdapterV1 } from "./device-relay.js";

export const COMPANION_DEVICE_COMMAND_CAPABILITY_ID = "companion.device.command.v1";

export interface CompanionExecutionClientV1 {
  claimAnyExecutionJob(workerId:string,executionTarget:"companion",options:{executionOwner:string;capabilityIds:string[];leaseMs:number}):Promise<ExecutionJobV1|null>;
  heartbeatExecutionJob(tenantId:string,jobId:string,workerId:string,leaseId:string,fencingEpoch:number,progress:{percent:number;message:string},leaseMs:number):Promise<unknown>;
  succeedExecutionJob(tenantId:string,jobId:string,workerId:string,leaseId:string,fencingEpoch:number,result:Record<string,unknown>):Promise<unknown>;
  failExecutionJob(tenantId:string,jobId:string,workerId:string,leaseId:string,fencingEpoch:number,code:string,message:string,retryable:boolean):Promise<unknown>;
  reportExecutionWorker(input:Record<string,unknown>):Promise<unknown>;
}

export class CompanionExecutionWorker {
  private completedJobs=0;private failedJobs=0;
  constructor(private readonly client:CompanionExecutionClientV1,private readonly relay:SqliteCompanionDeviceRelay,private readonly adapter:CompanionLocalAdapterV1,private readonly options:{workerId:string;tenantId:string;deviceId:string}){}
  async runOnce(){const job=await this.client.claimAnyExecutionJob(this.options.workerId,"companion",{executionOwner:"companion",capabilityIds:[COMPANION_DEVICE_COMMAND_CAPABILITY_ID],leaseMs:120_000});if(!job)return undefined;await this.execute(job);return job.id;}
  async run(signal:AbortSignal,pollMs=750){while(!signal.aborted){if(!await this.runOnce())await pause(pollMs,signal);}}
  report(startedAt:string){return this.client.reportExecutionWorker({executionOwner:"companion",workerId:this.options.workerId,executionTarget:"companion",state:"ready",capabilityIds:[COMPANION_DEVICE_COMMAND_CAPABILITY_ID],tenantIds:[this.options.tenantId],providerHealthy:true,startedAt,metrics:{completedJobs:this.completedJobs,failedJobs:this.failedJobs,inputUnits:0,outputUnits:0},leaseMs:30_000});}
  private async execute(job:ExecutionJobV1){if(!job.leaseId)throw new Error("Claimed Companion job has no lease");const lease=[job.tenantId,job.id,this.options.workerId,job.leaseId,job.fencingEpoch] as const;try{if(job.tenantId!==this.options.tenantId)throw new Error("Companion job tenant mismatch");if(job.capabilityId!==COMPANION_DEVICE_COMMAND_CAPABILITY_ID)throw new Error("Companion job capability mismatch");const command=commandInput(job.input);if(command.sourceAppId!==job.ownerAppId)throw new Error("Companion command source does not match the job owner");if(command.targetDeviceId!==this.options.deviceId)throw new Error("Companion command targets another device");await this.client.heartbeatExecutionJob(...lease,{percent:25,message:"Dispatching to the paired local adapter"},120_000);const receipt=await this.relay.execute({tenantId:job.tenantId,appId:job.ownerAppId,scopes:["devices:command"]},command,this.adapter);if(receipt.status==="unavailable")throw new CompanionExecutionError(receipt.detail,true);await this.client.succeedExecutionJob(...lease,{kind:"companion.device.receipt.v1",receipt});this.completedJobs+=1;}catch(error){this.failedJobs+=1;await this.client.failExecutionJob(...lease,error instanceof CompanionExecutionError?"local-adapter-unavailable":"invalid-device-command",safe(error),error instanceof CompanionExecutionError&&error.retryable);}}
}

export function companionExecutionWorkerFromClient(client:SpmtClient,relay:SqliteCompanionDeviceRelay,adapter:CompanionLocalAdapterV1,options:{workerId:string;tenantId:string;deviceId:string}){return new CompanionExecutionWorker(client,relay,adapter,options);}
class CompanionExecutionError extends Error{constructor(message:string,readonly retryable:boolean){super(message);}}
function commandInput(input:Record<string,unknown>):DeviceRelayCommandV1{const value=input.command;if(!value||typeof value!=="object"||Array.isArray(value))throw new Error("Companion command input is missing");return value as DeviceRelayCommandV1;}
function safe(error:unknown){return(error instanceof Error?error.message:"Companion execution failed").replace(/(bearer|token|secret|password|authorization)\s*[:=]\s*\S+/gi,"$1=[redacted]").replace(/[\r\n]+/g," ").slice(0,900);}
function pause(ms:number,signal:AbortSignal){return new Promise<void>((done)=>{if(signal.aborted)return done();const timer=setTimeout(done,ms);signal.addEventListener("abort",()=>{clearTimeout(timer);done();},{once:true});});}
