import assert from 'node:assert/strict';
import test from 'node:test';
import {generateKeyPairSync,sign} from 'node:crypto';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:http';
import {createSpmtServiceWithProviderIdentity} from '../apps/spmt-service/dist/provider-identity-host.js';
import {SpmtClient} from '../packages/sdk/dist/index.js';
import {detectSpmtSuiteActionCommand} from '../packages/sdk/dist/suite-actions.js';
import {hearMeOutCatalogRegistration,SqliteHearMeOutRoomMediaRuntime,HearMeOutWebSuiteActionExecutor,HearMeOutDiscordHttp} from '../apps/hearmeout/dist/index.js';
import {createHearMeOutWebServer} from '../apps/hearmeout/dist/web-server-v3.js';
import {StreamWeaverBotActionConsumer,StreamWeaverSuiteActionJobExecutor} from '../apps/streamweaver/dist/bot-action-runtime.js';
const tenant='crew',guild='123456789012345678',clientId='234567890123456789',discordUser='345678901234567890',channel='456789012345678901',credential='hearmeout-discord-test-credential-123456789';
const binding={tenantId:tenant,clientId,guildIds:[guild]};
const media={async resolve({query,lane}){return {itemId:query.replace(/\W/g,'-'),type:lane==='movie'?'movie':'music',source:'fixture',title:query,playbackUrl:'https://media.example/'+encodeURIComponent(query)+'.mp4'};}};
function signer(){const {privateKey,publicKey}=generateKeyPairSync('ed25519');return {publicKeyHex:publicKey.export({format:'der',type:'spki'}).subarray(-32).toString('hex'),signed(body,timestamp=String(Math.floor(Date.now()/1000))){const rawBody=JSON.stringify(body);return {body:rawBody,headers:{'content-type':'application/json','x-signature-timestamp':timestamp,'x-signature-ed25519':sign(null,Buffer.from(timestamp+rawBody),privateKey).toString('hex')}};}};}
function interaction(data,id='567890123456789012',type=3){return {id,type,application_id:clientId,guild_id:guild,channel_id:channel,member:{permissions:'0',user:{id:discordUser,username:'Captain'}},token:'fixture-interaction-token',data};}
async function until(read,check){const deadline=Date.now()+5000;let value;do{value=await read();if(check(value))return value;await new Promise(r=>setTimeout(r,30));}while(Date.now()<deadline);assert.fail(JSON.stringify(value));}

test('mounted Discord requests create canonical durable jobs and update the same public Activity without web login',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'hmo-discord-mounted-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const spmt=createSpmtServiceWithProviderIdentity({databasePath:join(dir,'spmt.sqlite'),webhookKey:Buffer.alloc(32,8),host:'127.0.0.1',port:0,hearMeOutWorkerCredential:credential});
 spmt.authority.ensureUser('owner');spmt.authority.linkProvider('owner','discord',discordUser);spmt.accounts.grandfatherProviderIdentity({sourceAppId:'hearmeout',provider:'discord',providerUserId:discordUser,username:'captain',displayName:'Captain'});spmt.control.registerTenant({tenantId:tenant,ownerUserId:'owner',displayName:'Crew'});spmt.authority.getOrCreateWorkspace(tenant);spmt.control.registerApp(hearMeOutCatalogRegistration('https://apollo.example/apps/hearmeout'));spmt.control.installApp(tenant,'hearmeout');await spmt.listen();
 const origin='http://127.0.0.1:'+spmt.server.address().port,crypto=signer(),host=createHearMeOutWebServer({spmtOrigin:origin,databasePath:join(dir,'hmo.sqlite'),port:0,credential,activity:binding,discordPublicKeyHex:crypto.publicKeyHex,suiteMediaResolver:media,operationMode:'active'});await host.listen();t.after(async()=>{await host.close();await spmt.close();});
 const base='http://127.0.0.1:'+host.server.address().port,request=body=>fetch(base+'/api/discord/interactions',{method:'POST',...crypto.signed(body)}),state=async lane=>(await fetch(base+'/api/watch/sessions/'+lane+'/state')).json();
 assert.equal((await state('music')).playback.status,'idle');
 assert.deepEqual(await (await request({type:1})).json(),{type:1});
 const modal=await (await request(interaction({custom_id:'request_song:discord-activity'}))).json();assert.equal(modal.type,9);
 const song=interaction({custom_id:modal.data.custom_id,components:[{components:[{custom_id:'song_request_input',value:'First song'}]}]},'567890123456789013',5);
 const accepted=await (await request(song)).json();assert.match(accepted.data.content,/request was queued/);
 const jobId=accepted.data.content.match(/\(([^)]+)\)/)[1];
 const client=new SpmtClient({baseUrl:origin,appId:'hearmeout',getAccessToken:()=>spmt.auth.issueServiceAccess('hearmeout',credential).accessToken});
 const job=await until(()=>client.getExecutionJob(tenant,jobId),j=>j.state==='succeeded');assert.equal(job.billedUserId,'owner');assert.equal(job.input.actor.userId,'owner');assert.equal(job.input.source.guildId,guild);assert.equal((await state('music')).current.item.title,'First song');
 await request(song);assert.equal((await state('music')).queue.length,0);
 // Canonical community owner can manage without a Discord administrator bit.
 const paused=await (await request(interaction({custom_id:'music_play_pause_btn'},'567890123456789014'))).json();assert.equal(paused.type,7);assert.equal((await state('music')).playback.status,'paused');
 const query=await (await request(interaction({name:'wr',options:[{name:'query',value:'First movie'}]},'567890123456789015',2))).json();assert.match(query.data.content,/watch request was queued/);await until(()=>state('movie'),s=>s.current?.item.title==='First movie');
 const db=new SqliteHearMeOutRoomMediaRuntime(join(dir,'hmo.sqlite'));try{const rows=db.listRooms({tenantId:tenant,userId:'owner',displayName:'Owner',roles:['admin']});assert.equal(rows.length,1);assert.equal(rows[0].systemRoom,true);}finally{db.close();}
 const foreign=await (await request({...interaction({custom_id:'music_skip_btn'},'567890123456789016'),guild_id:'999999999999999999'})).json();assert.match(foreign.data.content,/not connected/);assert.equal((await state('music')).current.item.title,'First song');
 const forged=crypto.signed(interaction({custom_id:'music_skip_btn'}));forged.body=forged.body.replace('music_skip_btn','music_play_pause_btn');assert.equal((await fetch(base+'/api/discord/interactions',{method:'POST',...forged})).status,401);
 const expired=crypto.signed(interaction({custom_id:'music_skip_btn'}),'1770000000');assert.equal((await fetch(base+'/api/discord/interactions',{method:'POST',...expired})).status,401);
});

test('slow identity calls defer while request modals open immediately and only reply to Discord',async t=>{
 const crypto=signer(),rooms=new SqliteHearMeOutRoomMediaRuntime(':memory:');let identityCalls=0,release;const held=new Promise(resolve=>release=resolve),replies=[];
 const client=new SpmtClient({baseUrl:'http://127.0.0.1:1',appId:'hearmeout',fetchImpl:async()=>{identityCalls++;await held;return Response.json({userId:'owner',profile:{displayName:'Captain'},tenantRole:'owner'});}});
 const route=new HearMeOutDiscordHttp({binding,publicKeyHex:crypto.publicKeyHex,rooms,client,deferAfterMs:20,fetchImpl:async(url,init)=>{replies.push({url,init});return Response.json({});}}),server=createServer((req,res)=>route.handle(req,res,new URL(req.url,'http://local')).catch(e=>res.destroy(e)));await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(async()=>{release();await route.close();await new Promise(r=>server.close(r));rooms.close();});
 const base='http://127.0.0.1:'+server.address().port,call=body=>fetch(base+'/api/discord/interactions',{method:'POST',...crypto.signed(body)});
 assert.equal((await (await call(interaction({custom_id:'request_song:discord-activity'}))).json()).type,9);assert.equal(identityCalls,0);
 const waiting=await (await call(interaction({custom_id:'hmo_watch_controls:music'},'567890123456789099'))).json();assert.equal(waiting.type,5);assert.equal(waiting.data.flags,64);release();await route.close();assert.equal(replies.length,1);assert.ok(replies[0].url.startsWith('https://discord.com/api/v10/webhooks/'+clientId+'/'));assert.equal(replies[0].init.redirect,'error');assert.deepEqual(JSON.parse(replies[0].init.body).allowed_mentions,{parse:[]});
});

test('shared chat preserves the actual guild and auto-enters only the bound public Activity; private rooms and simulations stay fenced',async()=>{
 const rooms=new SqliteHearMeOutRoomMediaRuntime(':memory:'),executor=new HearMeOutWebSuiteActionExecutor(rooms,media,{activity:binding}),inputs=[];
 const client={async createSuiteActionJob(t,input,key){inputs.push(input);const result=await executor.execute(input,{tenantId:t,idempotencyKey:key});return {job:{id:key,state:'succeeded',result}};}};
 const replies=[],consumer=new StreamWeaverBotActionConsumer(new StreamWeaverSuiteActionJobExecutor(client),{async send(m){replies.push(m);return {providerMessageId:'reply'};}});
 const message={schemaVersion:1,tenantId:tenant,provider:'discord',connectionId:'connection',channelId:channel,guildId:guild,messageId:'message',occurredAt:new Date().toISOString(),text:'!wr A film',actor:{providerUserId:discordUser,canonicalUserId:'viewer',username:'Viewer',roles:['member'],isBot:false},mentions:[],attachments:[]};
 try{await consumer.deliver({deliveryId:'delivery-1',message});assert.equal(inputs[0].source.guildId,guild);assert.equal(rooms.getSession(tenant,'discord-activity','movie').current.item.title,'A film');assert.equal(replies.length,0,'media requests wait for the durable completion reply instead of sending a provisional chat acknowledgement');assert.equal(detectSpmtSuiteActionCommand('!sr A song').args.lane,'music');assert.equal(detectSpmtSuiteActionCommand('!srwhatever'),undefined);
 const input={...inputs[0],actor:{userId:'outsider',username:'Outsider',role:'member'},source:{...inputs[0].source,guildId:'999999999999999999'}};await assert.rejects(()=>executor.execute(input,{tenantId:tenant,idempotencyKey:'wrong-guild'}),/Choose/);
 const owner={tenantId:tenant,userId:'owner',displayName:'Owner',roles:['admin']};rooms.createRoom(owner,{roomId:'private',name:'Private',privacy:'private',password:'secret-password',operationId:'create-private'});await assert.rejects(()=>executor.execute({...input,args:{...input.args,roomId:'private'},source:inputs[0].source},{tenantId:tenant,idempotencyKey:'private-request'}),/Join/);assert.equal(rooms.getSession(tenant,'private','movie').current,null);
 const result=await executor.execute({...input,source:{...inputs[0].source,simulation:true}},{tenantId:tenant,idempotencyKey:'preview'});assert.equal(result.simulation,true);assert.equal(rooms.listMembers(tenant,'discord-activity').some(m=>m.userId==='outsider'),false);
 }finally{rooms.close();}
});


test('Twitch media chat routes unlinked viewers into the permanent public Lounge without service auth',async()=>{
 const inputs=[],sent=[];
 const client={async createSuiteActionJob(t,input,key){inputs.push({t,input,key});return {job:{id:key,state:'succeeded',result:{text:'queued'}}};},async getExecutionJob(){throw Error('not needed')}};
 const consumer=new StreamWeaverBotActionConsumer(new StreamWeaverSuiteActionJobExecutor(client),{async send(message){sent.push(message);return {providerMessageId:'sent'}}});
 const message={schemaVersion:1,tenantId:tenant,provider:'twitch',connectionId:'twitch-main',channelId:'spacemountainlive',messageId:'twitch-message',occurredAt:new Date().toISOString(),text:'!sr Space Oddity',actor:{providerUserId:'987654321',username:'Viewer',roles:['member'],isBot:false},mentions:[],attachments:[]};
 await consumer.deliver({deliveryId:'twitch-delivery',message});
 assert.equal(inputs.length,1);assert.equal(inputs[0].input.action,'hmo.media.request');assert.equal(inputs[0].input.args.roomId,'system-spacemountainlive-lounge');assert.equal(inputs[0].input.args.lane,'music');assert.equal(inputs[0].input.actor.userId,'twitch:spacemountainlive:viewer');assert.equal(inputs[0].input.source.provider,'twitch');assert.equal(sent.length,0,'media completion owns the Twitch reply, so the provisional chat acknowledgement stays suppressed');
});
