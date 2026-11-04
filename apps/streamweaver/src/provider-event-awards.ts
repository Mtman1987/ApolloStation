import {createHash} from 'node:crypto';
import type {StreamWeaverEconomyStoreV1} from './economy.js';
import type {StreamWeaverCommunityStore} from './community-store.js';
/** Awards mutate only local creator currency and share its atomic ledger/receipt transaction. */
export function awardStreamWeaverProviderEvent(store:StreamWeaverCommunityStore,economy:StreamWeaverEconomyStoreV1,input:{tenantId:string;event:string;sourceId:string;userId:string;units?:number}){
 const key='provider-award:'+createHash('sha256').update(input.sourceId).digest('hex');
 return economy.transaction(()=>{
  const prior=economy.getReceipt(input.tenantId,key);if(prior)return {...prior.result,duplicate:true};
  const settings=store.awards(input.tenantId).find(s=>s.event===input.event),units=input.units??1;
  if(!Number.isSafeInteger(units)||units<1)throw Error('Provider event quantity is invalid');
  const amount=settings?.enabled&&input.userId?settings.points*(settings.perUnit?units:1):0;
  if(!Number.isSafeInteger(amount)||amount>1000000000000)throw Error('Provider award exceeds the supported local-currency range');
  const result={awarded:amount,userId:input.userId,event:input.event,...(amount?{balance:economy.adjustBalance(input.tenantId,input.userId,amount,true).balance}:{})};
  economy.putReceipt(input.tenantId,{operationId:key,kind:'provider-award',result,createdAt:new Date().toISOString()});return {...result,duplicate:false};
 },{reason:'provider-event-award',operationId:key,actorId:input.userId});
}
