import test from 'node:test';
import assert from 'node:assert/strict';
import {StreamWeaverProviderRuntime} from '../apps/streamweaver/dist/provider-runtime.js';
const event={id:'gift-one',tenantId:'tenant',type:'gift-bomb',units:5,userId:'12345',username:'gifter',displayName:'Gifter',input:'',occurredAt:new Date().toISOString()};
test('legacy gift-sub binding receives aggregate gifts without duplicating flow or point awards',async()=>{
 const deliveries=[],runtime=new StreamWeaverProviderRuntime({databasePath:':memory:',client:{request:async()=>({userId:'linked'})},egress:{send:async()=>({providerMessageId:'sent'})},allowAssistant:false,connections:[{tenantId:'tenant',provider:'twitch',connectionId:'twitch',channelId:'captain',desired:true}]});
 try{runtime.installedFlows.deliver=async d=>deliveries.push(d);runtime.community.saveBinding('tenant',{event:'gift-sub',command:'!gift {user} {count}',enabled:true});runtime.community.saveAward('tenant',{event:'twitch:gift-bomb',points:10,perUnit:true,enabled:true});await runtime.deliverProviderEvent(event);assert.equal(deliveries.length,1);assert.equal(deliveries[0].message.text,'!gift gifter 5');assert.equal(deliveries[0].message.actor.canonicalUserId,'linked');assert.equal(runtime.economy.getWallet('tenant','linked').balance,50);
 await runtime.deliverProviderEvent(event);assert.equal(deliveries[0].deliveryId,deliveries[1].deliveryId);assert.equal(runtime.economy.getWallet('tenant','linked').balance,50);
 runtime.community.saveBinding('tenant',{event:'gift-bomb',command:'!bulk {count}',enabled:true});await runtime.deliverProviderEvent({...event,id:'gift-two'});assert.equal(deliveries.length,3);assert.equal(deliveries[2].message.text,'!bulk 5');assert.equal(runtime.economy.getWallet('tenant','linked').balance,100);
 runtime.community.saveBinding('tenant',{event:'gift-bomb',command:'!bulk',enabled:false});await runtime.deliverProviderEvent({...event,id:'gift-three'});assert.equal(deliveries.at(-1).message.text,'!gift gifter 5');
 await assert.rejects(()=>runtime.deliverProviderEvent({...event,tenantId:'other'}),/destination/);
 }finally{runtime.close()}
});
