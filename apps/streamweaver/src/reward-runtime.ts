import { SpmtApiError, type SpmtClient } from "@spmt/sdk";
import { calculateStreamWeaverSupplyRate, type StreamWeaverEconomyStoreV1 } from "./economy.js";
import type { StreamRedeem } from "./community-store.js";

export interface StreamRewardRequest {
  tenantId:string; requestId:string; userId:string; reward:StreamRedeem; streamSession:string;
  currency:"streamer"|"spmt"; maxSpmtCost?:number;
}
export interface StreamRewardResult {
  userId:string; rewardId:string; currency:"streamer"|"spmt"; cost:number; localAward:number;
  state:"pending"|"complete"|"rejected"; message:string; claimKey?:string;
  presentation:{title:string;text:string;mediaUrl:string};
}
export class StreamRewardRequestError extends Error {}

/** The local receipt, first-claim lock and local wallet mutation share one transaction. */
export class StreamWeaverRewardRuntime {
  constructor(private readonly economy:StreamWeaverEconomyStoreV1,private readonly client:Pick<SpmtClient,"getXpSupply"|"spendXp">) {}
  async redeem(input:StreamRewardRequest):Promise<StreamRewardResult> {
    const {tenantId,userId,reward,currency}=input, key=`reward:${input.requestId}`;
    if(!input.requestId||input.requestId.length>200||!userId||userId.startsWith("creator-reserve:"))throw new StreamRewardRequestError("A linked user and stable redemption identifier are required");
    let record=this.economy.getReceipt(tenantId,key)?.result as unknown as StreamRewardResult|undefined;
    if(record&&(record.userId!==userId||record.rewardId!==reward.id||record.currency!==currency))throw new Error("Redemption identifier was used for a different request");
    if(!record){
      if(!reward.enabled)throw new StreamRewardRequestError("This reward is paused");
      const acceptance=reward.acceptance??"streamer";
      if(acceptance!=="either"&&acceptance!==currency)throw new StreamRewardRequestError(acceptance==="streamer"?"This reward accepts only the streamer's points":"This reward accepts only SPMT XP");
      let cost=reward.price;
      if(currency==="spmt"&&cost){
        const status=await this.client.getXpSupply(tenantId);
        cost=calculateStreamWeaverSupplyRate(this.economy.getCirculatingSupply(tenantId),status.spendableSupply).localCostInSpmt(cost);
        if(!Number.isSafeInteger(input.maxSpmtCost)||Number(input.maxSpmtCost)<cost)throw new StreamRewardRequestError(`Confirm an SPMT spending limit of at least ${cost} XP before redeeming`);
        if(cost>1_000_000)throw new StreamRewardRequestError("This reward exceeds the SPMT settlement limit");
      }
      record=this.economy.transaction(()=>{
        const prior=this.economy.getReceipt(tenantId,key);
        if(prior)return prior.result as unknown as StreamRewardResult;
        const claimKey=reward.firstPerStream?`reward-first:${JSON.stringify([reward.id,input.streamSession])}`:undefined;
        const next:StreamRewardResult={userId,rewardId:reward.id,currency,cost,localAward:reward.award??0,state:"pending",message:"",...(claimKey?{claimKey}:{}),presentation:{title:reward.title,text:reward.text,mediaUrl:reward.mediaUrl}};
        const claim=claimKey?this.economy.getReceipt(tenantId,claimKey):undefined;
        if(claim&&claim.result.requestId!==input.requestId&&claim.result.active!==false){next.state="rejected";next.message="This stream's first redemption has already been claimed";}
        else if(currency==="streamer"&&this.economy.getWallet(tenantId,userId).balance<cost){next.state="rejected";next.message=`Insufficient streamer points: this reward costs ${cost}`;}
        else {
          if(claimKey)this.economy.putReceipt(tenantId,{operationId:claimKey,kind:"redeem-claim",result:{requestId:input.requestId,active:true},createdAt:new Date().toISOString()});
          if(currency==="streamer"){
            if(cost)this.economy.adjustBalance(tenantId,userId,-cost,false);
            if(next.localAward)this.economy.adjustBalance(tenantId,userId,next.localAward,true);
            next.state="complete";
          }
        }
        this.save(tenantId,key,next);return next;
      },{reason:"reward",operationId:input.requestId,actorId:userId});
    }
    if(record.userId!==userId||record.rewardId!==reward.id||record.currency!==currency)throw new Error("Redemption identifier conflicts with another request");
    if(record.state!=="pending")return record;
    try {
      if(record.cost)await this.client.spendXp(tenantId,userId,record.cost,"streamweaver-reward",key,{rewardId:record.rewardId,lifetimeEligible:false});
    } catch(error) {
      // A definitive insufficient-funds rejection is terminal. Ambiguous transport failures
      // retain the claim and exact quote so retries cannot double charge or award.
      if(error instanceof SpmtApiError&&error.status===409&&/Insufficient spendable XP/.test(JSON.stringify(error.responseBody))){
        return this.economy.transaction(()=>{
          const current=this.economy.getReceipt(tenantId,key)!.result as unknown as StreamRewardResult;
          if(current.state!=="pending")return current;
          const next={...current,state:"rejected" as const,message:"Insufficient SPMT XP"};
          if(current.claimKey)this.economy.putReceipt(tenantId,{operationId:current.claimKey,kind:"redeem-claim",result:{requestId:input.requestId,active:false},createdAt:new Date().toISOString()});
          this.save(tenantId,key,next);return next;
        });
      }
      throw error;
    }
    return this.economy.transaction(()=>{
      const current=this.economy.getReceipt(tenantId,key)!.result as unknown as StreamRewardResult;
      if(current.state!=="pending")return current;
      if(current.localAward)this.economy.adjustBalance(tenantId,userId,current.localAward,true);
      const next={...current,state:"complete" as const};this.save(tenantId,key,next);return next;
    },{reason:"reward-award",operationId:input.requestId,actorId:userId});
  }
  private save(tenant:string,key:string,result:StreamRewardResult){this.economy.putReceipt(tenant,{operationId:key,kind:"redeem",result:result as unknown as Record<string,unknown>,createdAt:new Date().toISOString()});}
}
