import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AuthorityService, MemoryAuthorityStore } from '../packages/authority-core/dist/index.js';
import { SpmtApiError } from '../packages/sdk/dist/index.js';
import { SqliteStreamWeaverEconomyStore, calculateStreamWeaverSupplyRate, StreamWeaverEconomy } from '../apps/streamweaver/dist/economy.js';
import { StreamWeaverRewardRuntime } from '../apps/streamweaver/dist/reward-runtime.js';
import { StreamWeaverCommunityStore } from '../apps/streamweaver/dist/community-store.js';
import { StreamWeaverCommunityRuntime } from '../apps/streamweaver/dist/community-runtime.js';
import { streamWeaverOperationsBrowserJs } from '../apps/streamweaver/dist/stream-operations-client.js';
import vm from 'node:vm';

function fixture(t) {
  const path=mkdtempSync(join(tmpdir(),'sw-reward-')),economy=new SqliteStreamWeaverEconomyStore(join(path,'state.db'));
  t.after(()=>{economy.close();rmSync(path,{recursive:true,force:true})});
  const authority=new AuthorityService({store:new MemoryAuthorityStore()});
  authority.awardXp({tenantId:'tenant',userId:'viewer',delta:100000,sourceAppId:'test',reason:'seed',idempotencyKey:'seed'});
  const calls=[];const client={getXpSupply:async()=>authority.getXpSupply(),spendXp:async(tenantId,userId,amount,eventType,idempotencyKey,metadata)=>{calls.push(amount);try{return authority.spendXp({tenantId,userId,amount,eventType,idempotencyKey,metadata,sourceAppId:'streamweaver'})}catch(e){throw new SpmtApiError(409,e.message)}}};
  const reward={id:'hydrate',title:'Hydrate',price:100,award:0,acceptance:'either',firstPerStream:false,text:'Hello {user}',mediaUrl:'',enabled:true,rewardId:'twitch-reward'};
  return {path,economy,authority,client,calls,reward,runtime:new StreamWeaverRewardRuntime(economy,client),request:{tenantId:'tenant',requestId:'request',userId:'viewer',reward,streamSession:'stream-1',currency:'spmt',maxSpmtCost:10}};
}

test('the requested supply ratios price a 100-point reward at 10 XP and 1 XP',()=>{
  assert.equal(calculateStreamWeaverSupplyRate(1000000,100000).localCostInSpmt(100),10);
  assert.equal(calculateStreamWeaverSupplyRate(10000000,100000).localCostInSpmt(100),1);
  assert.equal(calculateStreamWeaverSupplyRate(1000000000,100000).localCostInSpmt(5000),1);
  assert.throws(()=>calculateStreamWeaverSupplyRate(0,100000));
  assert.throws(()=>calculateStreamWeaverSupplyRate(1000000,0));
});

test('SPMT payment debits only XP and never converts local points or increases lifetime XP',async t=>{
  const f=fixture(t);f.economy.setBalance('tenant','viewer',1000000);
  const result=await f.runtime.redeem(f.request);
  assert.equal(result.cost,10);assert.equal(result.state,'complete');
  assert.equal(f.economy.getWallet('tenant','viewer').balance,1000000);
  assert.equal(f.authority.getXpWallet('tenant','viewer').spendableXp,99990);
  assert.equal(f.authority.getXpWallet('tenant','viewer').lifetimeXp,100000);
  await f.runtime.redeem(f.request);assert.deepEqual(f.calls,[10]);
});

test('streamer-only rewards reject SPMT and a Twitch request still pays streamer cost',async t=>{
  const f=fixture(t);f.economy.setBalance('tenant','viewer',99);
  const community=new StreamWeaverCommunityStore(join(f.path,'state.db'));t.after(()=>community.close());
  community.saveRedeem('tenant',{...f.reward,acceptance:'streamer'});
  const runtime=new StreamWeaverCommunityRuntime(community,f.economy,f.client,false);
  const request={tenantId:'tenant',requestId:'twitch-redemption-1',rewardId:'hydrate',userId:'viewer',displayName:'Viewer',currency:'streamer'};
  assert.equal((await runtime.redeemReward(request)).state,'rejected');
  let presentations=0;await community.flush(async()=>presentations++);assert.equal(presentations,0);
  f.economy.setBalance('tenant','viewer',200);
  assert.equal((await runtime.redeemReward({...request,requestId:'twitch-redemption-2'})).state,'complete');
  assert.equal(f.economy.getWallet('tenant','viewer').balance,100);
  await runtime.redeemReward({...request,requestId:'twitch-redemption-2'});
  await community.flush(async()=>presentations++);assert.equal(presentations,1);
  await assert.rejects(()=>runtime.redeemReward({...request,requestId:'twitch-redemption-3',currency:'spmt',maxSpmtCost:10}),/only the streamer's points/);
  assert.equal(f.calls.length,0);
});

test('first successful redemption awards 500 once across simultaneous callers and restarts',async t=>{
  const f=fixture(t);const reward={...f.reward,price:0,award:500,firstPerStream:true};
  const request={...f.request,reward,currency:'streamer'};
  const results=await Promise.all([f.runtime.redeem(request),f.runtime.redeem({...request,userId:'other',requestId:'other-request'})]);
  assert.deepEqual(results.map(r=>r.state),['complete','rejected']);
  assert.equal(f.economy.getWallet('tenant','viewer').balance,500);
  const reopened=new SqliteStreamWeaverEconomyStore(join(f.path,'state.db'));t.after(()=>reopened.close());
  await new StreamWeaverRewardRuntime(reopened,f.client).redeem(request);
  assert.equal(reopened.getWallet('tenant','viewer').balance,500);
  await f.runtime.redeem({...request,requestId:'next-stream',streamSession:'stream-2'});
  assert.equal(reopened.getWallet('tenant','viewer').balance,1000);
});

test('a changed price requires fresh viewer consent and an ambiguous spend retries its original quote',async t=>{
  const f=fixture(t);f.economy.setBalance('tenant','viewer',1000000);
  await assert.rejects(()=>f.runtime.redeem({...f.request,maxSpmtCost:9}),/Confirm an SPMT spending limit/);
  let fail=true;const runtime=new StreamWeaverRewardRuntime(f.economy,{...f.client,spendXp:async(...args)=>{const r=await f.client.spendXp(...args);if(fail){fail=false;throw new Error('response lost')}return r}});
  await assert.rejects(()=>runtime.redeem(f.request),/response lost/);
  f.economy.setBalance('tenant','viewer',10000000);
  const result=await runtime.redeem(f.request);assert.equal(result.cost,10);
  assert.equal(f.authority.getXpWallet('tenant','viewer').spendableXp,99990);
});

test('insufficient SPMT rejects without awarding streamer points',async t=>{
  const f=fixture(t);f.economy.setBalance('tenant','viewer',1000000);
  const result=await f.runtime.redeem({...f.request,userId:'empty',reward:{...f.reward,award:500}});
  assert.equal(result.state,'rejected');assert.equal(f.economy.getWallet('tenant','empty').balance,0);
});

test('old conversion settings cannot mint XP and the reward browser bundle parses',async t=>{
  const f=fixture(t),economy=new StreamWeaverEconomy({client:f.client,store:f.economy,tenantId:'tenant'});
  await assert.rejects(()=>economy.exchangeLocalForSpmt({userId:'viewer',localAmount:1000000,operationId:'old'}),/cannot be converted/);
  new vm.Script(streamWeaverOperationsBrowserJs());
});
