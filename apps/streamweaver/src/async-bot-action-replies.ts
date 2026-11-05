import { routeSpmtSuiteAction, type ExecutionJobV1, type OutboundChatMessageV1 } from "@spmt/contracts";
import type { SpmtClient } from "@spmt/sdk";
import type { StreamWeaverBotActionContextV1, StreamWeaverBotActionRequestV1 } from "./bot-action-runtime.js";
import { createAsyncJsonRecordStore } from "@spmt/async-json-store/factory";
import type { AsyncJsonRecordStore } from "@spmt/async-json-store";

export interface StreamWeaverBotActionReceiptV1 {
  action: StreamWeaverBotActionRequestV1["action"];
  context: StreamWeaverBotActionContextV1;
  message: OutboundChatMessageV1;
  jobId?: string;
  completionReply?: boolean;
}
interface StoredReceipt extends StreamWeaverBotActionReceiptV1 { acknowledged:boolean; done:boolean; nextAttempt:number; }
const RECORDS="bot-action-replies",TENANTS="bot-action-reply-tenants";

/** Async durable receipts; execution and billing happen once, retries only deliver the saved reply. */
export class AsyncStreamWeaverBotActionReplies {
  private readonly records:AsyncJsonRecordStore;
  private running=false;
  constructor(options:{databasePath?:string;mode?:"sqlite"|"turso";url?:string;authToken?:string;now?:()=>number}={}) {
    this.now=options.now??Date.now;
    this.records=createAsyncJsonRecordStore({service:"streamweaver",...(options.databasePath?{databasePath:options.databasePath}:{}),...(options.mode?{mode:options.mode}:{}),...(options.url?{url:options.url}:{}),...(options.authToken?{authToken:options.authToken}:{})});
  }
  private readonly now:()=>number;
  initialize(){return this.records.initialize();}
  health(){return this.records.health();}
  close(){return this.records.close();}
  async get(context:StreamWeaverBotActionContextV1):Promise<StreamWeaverBotActionReceiptV1|undefined>{
    await this.initialize();const row=await this.records.get<StoredReceipt>(RECORDS,context.tenantId,context.requestId);if(!row)return;
    if(JSON.stringify(row.context)!==JSON.stringify(context))throw new Error("Chat action receipt identity mismatch");
    return publicReceipt(row);
  }
  async remember(receipt:StreamWeaverBotActionReceiptV1):Promise<StreamWeaverBotActionReceiptV1>{
    await this.initialize();
    const value=await this.records.transaction(async tx=>{
      const old=await tx.get<StoredReceipt>(RECORDS,receipt.context.tenantId,receipt.context.requestId);
      if(old){if(JSON.stringify(old.context)!==JSON.stringify(receipt.context))throw new Error("Chat action receipt identity mismatch");return old;}
      const saved:StoredReceipt={...receipt,acknowledged:false,done:false,nextAttempt:0};
      await tx.put(TENANTS,"_index",receipt.context.tenantId,{tenantId:receipt.context.tenantId});
      await tx.put(RECORDS,receipt.context.tenantId,receipt.context.requestId,saved);return saved;
    });
    return publicReceipt(value);
  }
  async acknowledge(context:StreamWeaverBotActionContextV1):Promise<void>{
    await this.mutate(context,(row)=>({...row,acknowledged:true}));
  }
  async flush(client:Pick<SpmtClient,"getExecutionJob">,send:(message:OutboundChatMessageV1)=>Promise<unknown>,allowed:(message:OutboundChatMessageV1)=>boolean,limit=100,publish?:SpmtClient["publishEvent"]):Promise<number>{
    await this.initialize();if(this.running)return 0;this.running=true;let delivered=0;
    try{
      const tenants=await this.records.list<{tenantId:string}>(TENANTS,"_index"),rows:StoredReceipt[]=[];
      for(const tenant of tenants)for(const row of await this.records.list<StoredReceipt>(RECORDS,tenant.key))if(row.value.acknowledged&&!row.value.done&&row.value.nextAttempt<=this.now())rows.push(row.value);
      rows.sort((a,b)=>a.nextAttempt-b.nextAttempt||a.context.requestId.localeCompare(b.context.requestId));
      for(const receipt of rows.slice(0,Math.max(1,Math.min(1000,limit)))){
        const {context,message}=receipt;
        await this.mutate(context,row=>({...row,nextAttempt:this.now()+5000}));
        if(!allowed(message)||context.simulation)continue;
        try{
          const job=await client.getExecutionJob(context.tenantId,receipt.jobId!);
          if(!matches(job,receipt)){await this.finish(context);continue;}
          if(!["succeeded","failed","dead-letter","cancelled"].includes(job.state))continue;
          const text=job.state==="succeeded"?(typeof job.result?.text==="string"?job.result.text.trim().slice(0,8000):"")||`${receipt.action} completed.`:`${receipt.action} did not complete. Check activity for details.`;
          if(receipt.completionReply!==false)await send({...message,text,idempotencyKey:`${message.idempotencyKey}:completed`});
          if(publish&&receipt.action==="sw.image.generate"&&job.state==="succeeded"){
            const images=(Array.isArray(job.result?.resourceUrls)?job.result.resourceUrls:[]).slice(0,4).flatMap(value=>{
              if(typeof value!=="string"||value.length>4000)return[];
              try{const url=new URL(value);return url.protocol==="https:"&&!url.username&&!url.password?[url.href]:[];}catch{return[];}
            });
            if(images.length)await publish(context.tenantId,"streamweaver.image.generated.v1",{visibility:"public",images,actor:context.actor.username},`${message.idempotencyKey}:image-overlay`);
          }
          await this.finish(context);delivered++;
        }catch{/* Retain receipt for provider/API recovery with the same egress key. */}
      }
      return delivered;
    }finally{this.running=false;}
  }
  private async mutate(context:StreamWeaverBotActionContextV1,change:(row:StoredReceipt)=>StoredReceipt):Promise<void>{
    await this.initialize();await this.records.transaction(async tx=>{
      const row=await tx.get<StoredReceipt>(RECORDS,context.tenantId,context.requestId);if(!row)return;
      if(JSON.stringify(row.context)!==JSON.stringify(context))throw new Error("Chat action receipt identity mismatch");
      await tx.put(RECORDS,context.tenantId,context.requestId,change(row));
    });
  }
  private finish(context:StreamWeaverBotActionContextV1){return this.mutate(context,row=>({...row,done:true}));}
}
function publicReceipt(row:StoredReceipt):StreamWeaverBotActionReceiptV1{const {acknowledged:_,done:__,nextAttempt:___,...receipt}=row;return receipt;}
function matches(job:ExecutionJobV1,receipt:StreamWeaverBotActionReceiptV1):boolean{
 const {context,action}=receipt,route=routeSpmtSuiteAction(action),source=job.input.source as Record<string,unknown>|undefined,actor=job.input.actor as Record<string,unknown>|undefined;
 return job.id===receipt.jobId&&job.tenantId===context.tenantId&&job.ownerAppId==="streamweaver"&&job.executionOwner===route.executionOwner&&job.capabilityId===route.capabilityId&&job.billedUserId===context.actor.userId&&actor?.userId===context.actor.userId&&job.input.action===action&&source?.kind==="chat"&&source.requestId===context.requestId&&source.provider===context.source&&source.channelId===context.channelId&&source.connectionId===context.connectionId&&source.simulation!==true&&(action!=="sw.image.generate"||job.input.mediaVisibility==="public");
}
