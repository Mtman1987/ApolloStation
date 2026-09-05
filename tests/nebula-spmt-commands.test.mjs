import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import vm from 'node:vm';
import {NebulaArcadeProviderRuntime,NEBULA_ARCADE_GAMES,parseNebulaMessage,nebulaGuideReplies,SqliteNebulaArcadeActivityStore,SqliteNebulaGameInputStore,SqliteNebulaGameRuntimeStore,SqliteNebulaTagExperienceStore,isNebulaChannelOptedOut,NEBULA_ACTIVITY_JS} from '../apps/nebula-arcade/dist/index.js';
import {NEBULA_WIDGET_STAGE_JS} from '../apps/nebula-arcade/dist/game-widgets.js';
import {createNebulaArcadeSandboxHost} from '../apps/nebula-arcade/dist/nebula-arcade-sandbox-server.js';
const epoch=Date.UTC(2026,8,5,12),ids=['tag','quackverse','bingo','chatgarden','wordchain','wordstorm'];
function setup(gameIds=ids){
 const dir=mkdtempSync(join(tmpdir(),'nebula-spmt-')),path=join(dir,'arcade.sqlite'),sent=[];
 const config={schemaVersion:1,revision:'test',tenants:[{tenantId:'tenant-a',pinUserId:'owner',channels:['chat-a','chat-b'].map(channelId=>({provider:'twitch',connectionId:'tw',channelId,stateChannelId:channelId,enabledGameIds:gameIds}))}]};
 const options={databasePath:path,config,publicOrigin:'https://spmt.example',client:{publishEvent:async()=>({}),awardXp:async()=>({})},egress:{send:async item=>{sent.push(item);return{providerMessageId:String(sent.length)}}}};
 let runtime=new NebulaArcadeProviderRuntime(options),serial=0;
 const activity=new SqliteNebulaArcadeActivityStore(path),feed=new SqliteNebulaGameInputStore(path),games=new SqliteNebulaGameRuntimeStore(path);
 return {path,sent,activity,feed,games,async send(text,{user='alice',channel='chat-a',at=epoch,roles=['member'],sourceChannelId,isBot=false}={}){const id=String(++serial);await runtime.consumers[0].deliver({schemaVersion:1,deliveryId:id,consumerId:'nebula.arcade.provider-ingress',attempt:1,message:{schemaVersion:1,tenantId:'tenant-a',provider:'twitch',connectionId:'tw',channelId:channel,messageId:id,text,occurredAt:new Date(at).toISOString(),...(sourceChannelId?{sourceChannelId}:{}),actor:{providerUserId:user,canonicalUserId:user,username:user,displayName:user,roles,isBot},mentions:[]}})},restart(){runtime.close();runtime=new NebulaArcadeProviderRuntime(options)},close(){runtime.close();activity.close();feed.close();games.close();rmSync(dir,{recursive:true,force:true})}};
}
test('only a complete leading spmt token enters Nebula; compact and spaced names share guides',()=>{
 for(const text of ['!join','!accept','!pack','orange is my favorite','spmtpack','@spmt join','!spmt join','try spmt help'])assert.equal(parseNebulaMessage(text),null,text);
 for(const game of NEBULA_ARCADE_GAMES)for(const name of [game.id,game.name,game.name.replaceAll(' ','-'),game.name.replaceAll(' ','_')])for(const command of ['help','rules','commands','join'])assert.equal(parseNebulaMessage(`SPMT ${name} ${command}`).gameId,game.id);
 for(const name of ['tag','chattag','chat tag','chat-tag'])assert.deepEqual(nebulaGuideReplies(`spmt ${name} rules`,[], 'https://spmt.example'),nebulaGuideReplies('spmt tag rules',[],'https://spmt.example'));
 assert.equal(parseNebulaMessage('spmt tag @alice').command,'tag');
});
test('global help and rules list active games and link the full guide',()=>{
 const help=nebulaGuideReplies('spmt help',['wordchain','quackverse'],'https://spmt.example');assert.equal(help.length,3);assert.match(help[0],/^Word Chain:/);assert.match(help.at(-1),/https:\/\/spmt.example\/apps\/nebula-arcade\?view=commands/);assert.deepEqual(help,nebulaGuideReplies('spmt commands',['wordchain','quackverse'],'https://spmt.example'));assert.doesNotMatch(help.join(' '),/Tag:/);
});
test('ordinary chat updates presence without playing or waking the box; prefixed joined answers play',async()=>{
 const s=setup();try{await s.send('spmt word chain join');const n=s.feed.list('tenant-a').length;
 for(const text of ['!pack','!join','!accept','orange is the new black'])await s.send(text,{at:epoch+31000});
 assert.equal(s.feed.list('tenant-a').length,n);assert.equal(s.activity.snapshot('tenant-a','chat-a',['wordchain'],ids,epoch+31000).visible,false);
 await s.send('spmt orange',{at:epoch+32000});assert.deepEqual(s.feed.list('tenant-a').at(-1).gameIds,['wordchain']);
 await s.send('spmt pack',{at:epoch+33000});assert.deepEqual(s.feed.list('tenant-a').at(-1).gameIds,['quackverse']);
 await s.send('spmt',{at:epoch+34000});assert.equal(s.activity.snapshot('tenant-a','chat-a',[],ids,epoch+63999).visible,true);assert.equal(s.activity.snapshot('tenant-a','chat-a',[],ids,epoch+64000).visible,false);
 await s.send('spmt',{at:epoch+70000,isBot:true});assert.equal(s.activity.snapshot('tenant-a','chat-a',[],ids,epoch+70000).visible,false);
 }finally{s.close()}
});
test('membership, counts and pending choices survive restart and remain channel scoped',async()=>{
 const s=setup();try{for(const user of ['alice','bob','carol'])await s.send('spmt wordchain join',{user});
 assert.equal(s.activity.snapshot('tenant-a','chat-a',['wordchain','chatgarden'],ids,epoch).games.find(g=>g.id==='wordchain').players,3);
 const n=s.feed.list('tenant-a').length;await s.send('spmt orange',{user:'stranger'});await s.send('spmt orange',{channel:'chat-b'});assert.equal(s.feed.list('tenant-a').length,n);
 await s.send('spmt leave');assert.match(s.sent.at(-1).text,/spmt 5/);s.restart();await s.send('5');assert.equal(s.activity.joinedGames('tenant-a','chat-a','spmt:alice').includes('wordchain'),true);await s.send('spmt 5');assert.equal(s.activity.joinedGames('tenant-a','chat-a','spmt:alice').includes('wordchain'),false);
 assert.equal(s.activity.snapshot('tenant-a','chat-a',['wordchain'],ids,epoch).games.find(g=>g.id==='wordchain').players,2);assert.equal(s.activity.snapshot('tenant-a','chat-b',['wordchain'],ids,epoch).games[0].players,0);assert.equal(s.activity.snapshot('tenant-a','chat-a',['wordchain'],ids,epoch+300001).games[0].players,0);
 }finally{s.close()}
});
test('global guides bypass Tag and stopped games are excluded without falling into another game',async()=>{
 const s=setup();try{await s.send('spmt help');assert.ok(s.sent.some(item=>/Word Chain:/.test(item.text)));assert.ok(s.sent.every(item=>item.text.length<=440));await s.send('spmt chat garden stop',{roles:['moderator']});s.sent.length=0;await s.send('spmt rules');assert.doesNotMatch(s.sent.map(item=>item.text).join(' '),/Chat Garden:/);const n=s.feed.list('tenant-a').length;await s.send('spmt grow');assert.match(s.sent.at(-1).text,/not active/);assert.equal(s.feed.list('tenant-a').length,n);
 }finally{s.close()}
});
test('channel opt-out blocks all twenty games, help and activity durably',async()=>{
 const all=NEBULA_ARCADE_GAMES.map(g=>g.id),s=setup(all);try{await s.send('spmt optout',{roles:['moderator']});assert.match(s.sent.at(-1).text,/opted out/i);s.restart();const n=s.sent.length;for(const id of all)await s.send(`spmt ${id} join`);for(const cmd of ['help','commands','rules','orange','pack'])await s.send(`spmt ${cmd}`);assert.equal(s.sent.length,n);assert.deepEqual(s.feed.list('tenant-a'),[]);assert.equal(s.activity.snapshot('tenant-a','chat-a',[],all,epoch).visible,false);await s.send('spmt wordchain join',{channel:'chat-b'});assert.equal(s.feed.list('tenant-a').length,1);
 }finally{s.close()}
});
test('opt-out works without Tag and shared-chat source opt-outs do not disable the destination',async()=>{
 const s=setup(['wordchain']);try{await s.send('spmt optout');assert.doesNotMatch(s.sent.at(-1).text,/channel has opted out/i);await s.send('spmt optout',{roles:['moderator'],sourceChannelId:'source-a'});const policy=new SqliteNebulaTagExperienceStore(s.path);try{assert.equal(isNebulaChannelOptedOut(policy,'tenant-a','source-a'),true);assert.equal(isNebulaChannelOptedOut(policy,'tenant-a','chat-a'),false);assert.equal(isNebulaChannelOptedOut(policy,'tenant-b','source-a'),false)}finally{policy.close()}
 await s.send('spmt wordchain join',{sourceChannelId:'source-a'});assert.equal(s.feed.list('tenant-a').length,0);await s.send('spmt wordchain join');assert.equal(s.feed.list('tenant-a').length,1);
 }finally{s.close()}
});
test('HTTP guides expose all games, optional activity mixes persist, and opted-out actions are blocked',async()=>{
 const s=setup();const host=createNebulaArcadeSandboxHost({databasePath:s.path,tenantId:'tenant-a',channelId:'chat-a',host:'127.0.0.1',port:0});try{await host.listen();const origin=`http://127.0.0.1:${host.server.address().port}`;for(const view of ['rules','commands']){const html=await(await fetch(`${origin}/apps/nebula-arcade?view=${view}`)).text();for(const game of NEBULA_ARCADE_GAMES)assert.match(html,new RegExp(`id="${game.id}"`))}
 for(const [id,activityBox]of [['public',true],['personal',false]]){const r=await fetch(`${origin}/v1/nebula/game-mixes`,{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({id,name:id,activityBox,gameIds:['wordchain','chatgarden']})});assert.equal(r.status,200);assert.equal((await r.json()).mix.activityBox,activityBox);const page=await(await fetch(`${origin}/overlay/game-mix/${id}`)).text();assert.equal(page.includes('<aside id="nebula-activity"'),activityBox)}
 await s.send('spmt wordchain join',{at:Date.now()});const state=await(await fetch(`${origin}/v1/nebula/game-mix-state?mix=public`)).json();assert.equal(state.activity.games.find(g=>g.id==='wordchain').players,1);new vm.Script(await(await fetch(`${origin}/assets/nebula-game-mix.js`)).text());
 await s.send('spmt optout',{roles:['moderator']});for(const game of NEBULA_ARCADE_GAMES){const r=await fetch(`${origin}/v1/nebula/game-actions`,{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({gameId:game.id,action:'join',username:'alice'})});assert.equal(r.status,403,game.id)}
 }finally{await host.close();s.close()}
});
test('activity box expires without another poll and restarts its timer on another spmt',()=>{
 let now=0,task;const box={hidden:true,querySelector:()=>({replaceChildren(){}})};const window={};vm.runInNewContext(NEBULA_ACTIVITY_JS,{window,document:{getElementById:()=>box},Date:{now:()=>now},clearTimeout(){task=undefined},setTimeout(fn,delay){task={fn,delay}}});window.renderNebulaActivity({remainingMs:30000,games:[]});assert.equal(box.hidden,false);now=25000;window.renderNebulaActivity({remainingMs:30000,games:[]});assert.equal(task.delay,30000);now=55000;task.fn();assert.equal(box.hidden,true);
});
test('widget bridge sends only prefixed answers, stripped for native word games',()=>{
 const delivered=[],listeners={},frame={dataset:{game:'wordchain'},contentWindow:{postMessage(value){delivered.push(value)}},hidden:true};const parent={postMessage(){}},selector={value:'auto',addEventListener(){}},output={dataset:{},textContent:''};vm.runInNewContext(NEBULA_WIDGET_STAGE_JS,{window:{parent,addEventListener(type,fn){listeners[type]=fn}},document:{body:{dataset:{simulation:'true'}},querySelectorAll:()=>[frame],getElementById:id=>id==='game-select'?selector:output},location:{origin:'https://spmt.example'},setTimeout(){},clearTimeout(){}});
 listeners.message({source:frame.contentWindow,data:{type:'spmt.nebula.ready'}});
 listeners.message({source:parent,origin:'https://spmt.example',data:{type:'spmt.simulation.arcade',inputs:['spmt orange','spmt word chain elephant','!pack','orange is my favorite'].map((message,index)=>({id:String(index),gameIds:['wordchain'],message}))}});assert.deepEqual(delivered.map(item=>item.input.message),['orange','elephant']);
});
