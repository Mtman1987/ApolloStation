import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { Worker } from 'node:worker_threads';
import { once } from 'node:events';
import test from 'node:test';
import { SqliteDshCalendarStore } from '../apps/discord-stream-hub/dist/calendar.js';
import { SqliteDshDiscordMessageStore } from '../apps/discord-stream-hub/dist/discord-live-publisher.js';
import { DshCalendarDelivery } from '../apps/discord-stream-hub/dist/calendar-delivery.js';
import { respondDshCalendarInteraction } from '../apps/discord-stream-hub/dist/calendar-interactions.js';
import { createDiscordStreamHubWebServer } from '../apps/discord-stream-hub/dist/web-server.js';
import { DshSuiteActionOperations } from '../apps/discord-stream-hub/dist/suite-action-operations.js';
import { DshBotActionAdapter } from '../apps/discord-stream-hub/dist/bot-action-adapter.js';
import { detectSpmtSuiteActionCommand } from '../packages/sdk/dist/suite-actions.js';
import { renderCommunityCalendarSvg } from '../packages/ui/dist/index.js';

const now='2026-09-13T12:00:00.000Z',date='2026-09-20',guild='123456789012345678',tenant='tenant-a';
const member={userId:'alice',username:'Alice'};
const reservation={tenantId:tenant,serverId:guild,date,hour:16,member,now};
function directory(t){const path=mkdtempSync(join(tmpdir(),'dsh-raid-'));t.after(()=>rmSync(path,{recursive:true,force:true}));return path;}

test('Raid Train atomically awards one hourly reservation across separate processes',async t=>{
  const path=join(directory(t),'calendar.sqlite'),store=new SqliteDshCalendarStore(path);store.close();
  const module=new URL('../apps/discord-stream-hub/dist/calendar.js',import.meta.url).href;
  const workers=['alice','bob'].map(userId=>new Worker(`const {parentPort,workerData}=require('node:worker_threads');(async()=>{const {SqliteDshCalendarStore}=await import(workerData.module);const store=new SqliteDshCalendarStore(workerData.path);parentPort.postMessage('ready');parentPort.once('message',()=>{try{parentPort.postMessage({saved:store.reserveRaidTrain(workerData.reservation).event.userId})}catch(error){parentPort.postMessage({error:error.message})}finally{store.close()}})})()`,{eval:true,workerData:{path,module,reservation:{...reservation,member:{userId,username:userId}}}}));
  await Promise.all(workers.map(worker=>once(worker,'message')));
  const pending=workers.map(worker=>once(worker,'message'));workers.forEach(worker=>worker.postMessage('claim'));
  const results=(await Promise.all(pending)).map(([result])=>result);
  assert.equal(results.filter(result=>result.saved).length,1);assert.match(results.find(result=>result.error).error,/already claimed/);
  await Promise.all(workers.map(worker=>worker.terminate()));
  const reopened=new SqliteDshCalendarStore(path);try{assert.equal(reopened.raidTrainSlots(tenant,guild,date).filter(slot=>slot.event).length,1);assert.equal(reopened.pendingAwards(tenant).length,0);}finally{reopened.close();}
});

test('Raid Train uses calendar scope and claimant identity, preserves duty and fences stale cancellations',t=>{
  const store=new SqliteDshCalendarStore(join(directory(t),'calendar.sqlite'));t.after(()=>store.close());
  assert.equal(store.raidTrainSlots(tenant,guild,date).length,24);
  const first=store.reserveRaidTrain(reservation).event;
  assert.equal(store.reserveRaidTrain(reservation).event.id,first.id);
  assert.throws(()=>store.cancelRaidTrain(tenant,guild,first.id,'bob'),/claimant/);
  assert.throws(()=>store.reserveRaidTrain({...reservation,date:now.slice(0,10),hour:0}),/same-day/);
  assert.throws(()=>store.reserveRaidTrain({...reservation,hour:24}),/hourly/);
  assert.throws(()=>store.updateEvent(tenant,guild,first.id,{eventTime:'17:00'}),/Cancel/);
  store.scheduleCaptainsLog({...reservation,selectedDate:date});
  assert.equal(store.pendingAwards(tenant).length,1,'train signup creates no invented XP award');
  store.reserveRaidTrain({...reservation,tenantId:'tenant-b'});store.reserveRaidTrain({...reservation,serverId:'other-guild'});
  assert.equal(store.cancelRaidTrain(tenant,guild,first.id,'alice').deleted,true);
  const replacement=store.reserveRaidTrain({...reservation,member:{userId:'bob',username:'Bob'}}).event;
  assert.equal(store.cancelRaidTrain(tenant,guild,first.id,'alice').deleted,false);
  assert.equal(store.get(tenant,guild,replacement.id).userId,'bob');
  assert.equal(store.cancelRaidTrain(tenant,guild,replacement.id,'owner',true).deleted,true);
  assert.equal(store.list(tenant,guild)[0].type,'captains-log');
});

test('calendar publication refreshes train reservations after restart and retries provider failures',async t=>{
  const path=join(directory(t),'calendar.sqlite');let store=new SqliteDshCalendarStore(path),messages=new SqliteDshDiscordMessageStore(path),payloads=[],fail=false;
  const discord={async createMessage(_tenant,_channel,payload){payloads.push(payload);return '345678901234567890';},async editMessage(_tenant,_channel,_id,payload){if(fail)throw Error('provider offline');payloads.push(payload);}};
  let delivery=new DshCalendarDelivery(store,messages,discord,()=>now);
  await delivery.publish(tenant,guild,'234567890123456789','2026-09');
  const first=store.reserveRaidTrain(reservation).event;
  fail=true;assert.equal((await delivery.flush(tenant)).pending,true);
  store.close();messages.close();store=new SqliteDshCalendarStore(path);messages=new SqliteDshDiscordMessageStore(path);
  t.after(()=>{store.close();messages.close();});delivery=new DshCalendarDelivery(store,messages,discord,()=>now);
  fail=false;assert.equal((await delivery.flush(tenant)).pending,false);
  const payload=payloads.at(-1);assert.ok(payload.calendar.events.some(event=>event.id===first.id));
  assert.match(renderCommunityCalendarSvg(payload.calendar),/Raid Train/);
  assert.ok(payload.components[0].components.some(button=>button.label==='Raid Train'));
  store.cancelRaidTrain(tenant,guild,first.id,member.userId);await delivery.flush(tenant);
  assert.equal(payloads.at(-1).calendar.events.length,0);
});

test('existing Discord Raid Train buttons resolve SPMT identity, reserve once, and cancel only the selected booking',async t=>{
  const store=new SqliteDshCalendarStore(join(directory(t),'calendar.sqlite'));t.after(()=>store.close());
  const options={calendar:store,config:{tenants:[{tenantId:tenant,discordGuildIds:[guild]}]},now:()=>now,resolve:async(_tenant,id)=>({userId:id,username:id,role:id==='unlinked'?null:'member'}),changed:async()=>({pending:true})};
  const input=(id,custom_id,values,userId='alice')=>({id,type:3,guild_id:guild,member:{user:{id:userId}},data:{custom_id,...(values?{values}:{})}});
  const panel=await respondDshCalendarInteraction(options,input('view',`calendar:raid:${guild}:2026-09`));assert.match(panel.data.embeds[0].title,/Raid Train/);
  const signup=await respondDshCalendarInteraction(options,input('open',`raid_signup_${date}`));assert.equal(signup.data.components[0].components[0].options.length,24);
  const id=`calendar:raid-claim:${guild}:${date}`,request=input('claim-1',id,['16']);
  assert.match((await respondDshCalendarInteraction(options,request)).data.content,/reserved.*pending/);
  const first=store.raidTrainSlots(tenant,guild,date)[16].event;
  await respondDshCalendarInteraction(options,request);assert.equal(store.list(tenant,guild).length,1);
  assert.match((await respondDshCalendarInteraction(options,input('claim-2',id,['16'],'bob'))).data.content,/already claimed/);
  assert.match((await respondDshCalendarInteraction(options,input('claim-3',id,['17'],'unlinked'))).data.content,/Link your Discord/);
  assert.match((await respondDshCalendarInteraction(options,input('cancel-1',`calendar:raid-cancel:${guild}:${date}`,[first.id],'bob'))).data.content,/claimant/);
  const cancel=input('cancel-2',`calendar:raid-cancel:${guild}:${date}`,[first.id]);await respondDshCalendarInteraction(options,cancel);
  const replacement=store.reserveRaidTrain({...reservation,member:{userId:'bob',username:'Bob'}}).event;
  await respondDshCalendarInteraction(options,cancel);assert.equal(store.get(tenant,guild,replacement.id).userId,'bob');
  assert.match((await respondDshCalendarInteraction(options,{...request,guild_id:'999999999999999999'})).data.content,/not connected/);
});

test('web reservations, cancellation and chat actions share one authenticated calendar',async t=>{
  const path=join(directory(t),'calendar.sqlite');
  const spmt=createServer((req,res)=>{res.setHeader('content-type','application/json');if(req.url==='/v1/session')res.end(JSON.stringify({actorId:req.headers.cookie||'alice',displayName:req.headers.cookie||'Alice',tenantIds:[tenant],tenantRoles:{[tenant]:'member'}}));else{res.statusCode=404;res.end('{}');}});
  await new Promise(resolve=>spmt.listen(0,'127.0.0.1',resolve));
  const host=createDiscordStreamHubWebServer({spmtOrigin:`http://127.0.0.1:${spmt.address().port}`,databasePath:path,host:'127.0.0.1',port:0});await host.listen();
  const origin=`http://127.0.0.1:${host.server.address().port}`,api=origin+'/apps/discord-stream-hub/api/control',future='2099-09-20';
  const store=new SqliteDshCalendarStore(path);t.after(async()=>{store.close();await host.close();await new Promise(resolve=>spmt.close(resolve));});
  const post=(action,body,user='alice')=>fetch(api+'/calendar/raid-train/'+action,{method:'POST',headers:{origin,cookie:user,'content-type':'application/json'},body:JSON.stringify(body)});
  const body={serverId:'workspace',date:future,hour:16,requestId:'reserve1',userId:'forged'};
  const saved=await post('reserve',body);assert.equal(saved.status,200,await saved.clone().text());const first=(await saved.json()).event;assert.equal(first.userId,'alice');
  assert.equal((await post('reserve',{...body,requestId:'reserve2'},'bob')).status,400);
  assert.equal((await post('cancel',{serverId:'workspace',eventId:first.id,requestId:'cancel1'},'bob')).status,400);
  const rows=await(await fetch(api+`/calendar/raid-train?date=${future}`,{headers:{cookie:'alice'}})).json();assert.equal(rows.slots[16].event.id,first.id);
  assert.equal((await post('reserve',{...body,serverId:'999999999999999999',requestId:'other-guild'})).status,400);
  const operations=new DshSuiteActionOperations({calendar:store,config:{tenants:[]},now:()=>now}),adapter=new DshBotActionAdapter(operations);
  const read=await adapter.execute({action:'dsh.calendar.raid.read',tenantId:tenant,actorRole:'member',actorUserId:'alice',args:{date:future},idempotencyKey:'read'});assert.equal(read.slots[16].event.id,first.id);
  const command=detectSpmtSuiteActionCommand('reserve Raid Train on 2099-09-20 at 17:00 UTC',new Date(now));assert.equal(command.action,'dsh.calendar.raid.reserve');
  await adapter.execute({...command,tenantId:tenant,actorRole:'member',actorUserId:'bob',idempotencyKey:'bot-reserve'});
  assert.equal(store.raidTrainSlots(tenant,'workspace',future)[17].event.userId,'bob');
  await adapter.execute({...command,args:{...command.args,hour:'18'},tenantId:tenant,actorRole:'member',actorUserId:'bob',idempotencyKey:'preview',simulation:true});
  assert.equal(store.raidTrainSlots(tenant,'workspace',future)[18].event,undefined);
  const html=await(await fetch(origin+'/',{headers:{cookie:'alice'}})).text();assert.match(html,/data-raid-hour/);
  assert.equal((await post('cancel',{serverId:'workspace',eventId:first.id,requestId:'cancel2'})).status,200);
});
