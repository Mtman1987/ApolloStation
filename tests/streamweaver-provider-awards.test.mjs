import test from 'node:test';
import assert from 'node:assert/strict';
import {StreamWeaverCommunityStore} from '../apps/streamweaver/dist/community-store.js';
import {SqliteStreamWeaverEconomyStore} from '../apps/streamweaver/dist/economy.js';
import {awardStreamWeaverProviderEvent} from '../apps/streamweaver/dist/provider-event-awards.js';
test('provider point awards are atomic, tenant scoped and stable when event settings change before replay',()=>{
 const store=new StreamWeaverCommunityStore(':memory:'),economy=new SqliteStreamWeaverEconomyStore(':memory:');
 try{store.saveAward('a',{event:'twitch:cheer',points:2,perUnit:true,enabled:true});const input={tenantId:'a',sourceId:'event:one',event:'twitch:cheer',userId:'viewer',units:10};assert.equal(awardStreamWeaverProviderEvent(store,economy,input).awarded,20);store.saveAward('a',{event:'twitch:cheer',points:500,perUnit:true,enabled:true});assert.equal(awardStreamWeaverProviderEvent(store,economy,input).duplicate,true);assert.equal(economy.getWallet('a','viewer').balance,20);assert.equal(economy.getWallet('b','viewer').balance,0);assert.equal(awardStreamWeaverProviderEvent(store,economy,{...input,sourceId:'unlinked',userId:''}).awarded,0);assert.throws(()=>store.saveAward('a',{event:'youtube:superChatEvent',points:10,perUnit:true,enabled:true}),/Per-unit/);store.saveAward('a',{event:'twitch:cheer',points:1000000000000,perUnit:true,enabled:true});assert.throws(()=>awardStreamWeaverProviderEvent(store,economy,{...input,sourceId:'overflow'}),/range/);assert.equal(economy.getWallet('a','viewer').balance,20);}finally{store.close();economy.close()}
});
