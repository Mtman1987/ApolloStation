import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import vm from 'node:vm';
import { StellarSpeechProvider, splitSpeech } from '../apps/stellar-core/dist/speech-provider.js';
import { StellarAssistantStore } from '../apps/stellar-core/dist/assistant-store.js';
import { CommlinkOperatorStore } from '../packages/commlink-core/dist/operator.js';
import { StreamWeaverPokemonStore } from '../apps/streamweaver/dist/pokemon-store.js';
import { streamWeaverAssistantBrowserJs } from '../apps/streamweaver/dist/assistant-client.js';
import { streamWeaverChatDeskBrowserJs } from '../apps/streamweaver/dist/chat-desk-client.js';
import { streamWeaverPokemonBrowserJs } from '../apps/streamweaver/dist/pokemon-client.js';

test('Athena keeps the exact model through failure and independent cooldown, without forwarding credentials to downloads',async()=>{
  let now=1;const calls=[];
  const provider=new StellarSpeechProvider({deepgramKey:'deepgram-test',edenKey:'eden-test',now:()=>now,fetchImpl:async(url,init)=>{
    calls.push({url,init});
    if(url.includes('api.deepgram.com'))return new Response('',{status:429});
    if(url.includes('universal-ai')){assert.equal(JSON.parse(init.body).input.voice,'aura-2-athena-en');return Response.json({status:'success',provider:'deepgram',output:{audio_resource_url:'https://media.edenai.run/audio.mp3'}})}
    assert.equal(init.headers,undefined);return new Response(Buffer.from('ID3audio'),{headers:{'content-type':'audio/mpeg'}});
  }});
  assert.deepEqual((await provider.synthesize('Hello','deepgram:aura-2:athena','a')).providers,['edenai']);
  await provider.synthesize('Again','deepgram:aura-2:athena','a');assert.equal(calls.filter(c=>c.url.includes('api.deepgram')).length,1);
  now=31000;await provider.synthesize('Recovered','deepgram:aura-2:athena','a');assert.equal(calls.filter(c=>c.url.includes('api.deepgram')).length,2);
  await assert.rejects(provider.synthesize('Hello','unknown'),/supported voice/);
  assert.ok(splitSpeech('hello '.repeat(1500)).every(c=>c.length<=1900));
});
test('speech rejects simulation-disabled requests before network and does not accept HTML as audio',async()=>{
  const disabled=new StellarSpeechProvider({deepgramKey:'x',enabled:false,fetchImpl:()=>{throw Error('network should not run')}});
  await assert.rejects(disabled.synthesize('Hi'),/not configured/);
  const invalid=new StellarSpeechProvider({deepgramKey:'x',fetchImpl:async()=>new Response('<html>bad</html>',{headers:{'content-type':'text/html'}})});
  await assert.rejects(invalid.synthesize('Hi'),/unavailable/);
});
test('private preferences and notes survive restart and remain user/tenant scoped',()=>{
  const dir=mkdtempSync(join(tmpdir(),'assistant-port-')),path=join(dir,'state.sqlite');let store=new StellarAssistantStore(path);
  try{const note=store.saveNote('a','one',{title:'Preference',subject:'Captain',content:'Prefers Athena.'});store.savePreferences('a','one',{voice:'deepgram:aura-2:athena',ttsEnabled:true});store.close();store=new StellarAssistantStore(path);assert.equal(store.notes('a','one')[0].id,note.id);assert.equal(store.notes('a','two').length,0);assert.equal(store.notes('b','one').length,0);assert.equal(store.preferences('a','one').ttsEnabled,true);store.deleteForUser('a','one');assert.equal(store.notes('a','one').length,0);}finally{store.close();rmSync(dir,{recursive:true,force:true})}
});
test('chat desk rejects stale edits, advances once on elapsed duration and isolates filters',()=>{
  let now=0;const store=new CommlinkOperatorStore(':memory:',()=>now);
  try{let s=store.apply('a',{action:'settings',revision:0,enabled:true,autoAdvance:true,durationSeconds:10},['one','two']);s=store.apply('a',{action:'queue',revision:s.revision,eventId:'one'},['one','two']);s=store.apply('a',{action:'queue',revision:s.revision,eventId:'two'},['one','two']);assert.equal(s.featured,'one');assert.throws(()=>store.apply('a',{action:'clear',revision:0},[]),/changed/);now=11000;const advanced=store.read('a');assert.equal(advanced.featured,'two');assert.equal(store.read('a').revision,advanced.revision);assert.equal(store.read('b').featured,null);store.saveFilters('a','u',[{name:'Twitch',provider:'twitch'}]);assert.equal(store.filters('a','v').length,0);}finally{store.close()}
});
const owner={id:'owner',displayName:'Captain',owner:true},a={id:'trainer-a',displayName:'A',owner:false},b={id:'trainer-b',displayName:'B',owner:false};
const catalog={name:'Test set',cards:Array.from({length:20},(_,i)=>({name:'Card '+i,number:String(i),setCode:'test',rarity:'Common',imageUrl:`https://images.pokemontcg.io/test/${i}.png`,hp:'60',types:['Fire']}))};
test('packs are consumed exactly once, trade transfers commit atomically and restart preserves collections',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'pokemon-port-')),path=join(dir,'state.sqlite');let store=new StreamWeaverPokemonStore(path,()=>1000,()=>.4),seq=0;
  const act=(actor,action,input={})=>store.act('tenant',actor,{action,requestId:'request-'+(++seq),...input});
  try{act(owner,'catalog',{set:'test',catalog});act(a,'join');act(b,'join');assert.throws(()=>act(a,'grant',{set:'test',userId:a.id,count:1}),/owner/);for(const actor of [a,b])act(owner,'grant',{set:'test',userId:actor.id,count:1});const request={action:'open',requestId:'same-open',set:'test'};const first=store.act('tenant',a,request);assert.deepEqual(store.act('tenant',a,request),first);assert.equal(store.snapshot('tenant',a).trainer.collection.cards.length,9);assert.throws(()=>store.act('tenant',a,{...request,set:'other'}),/different/);act(b,'open',{set:'test'});const trade=act(a,'trade',{userId:b.id});const ca=store.snapshot('tenant',a).trainer.collection.cards[0],cb=store.snapshot('tenant',b).trainer.collection.cards[0];act(a,'offer',{tradeId:trade.tradeId,card:`${ca.setCode}-${ca.number}`});act(b,'offer',{tradeId:trade.tradeId,card:`${cb.setCode}-${cb.number}`});act(a,'accept',{tradeId:trade.tradeId});act(b,'accept',{tradeId:trade.tradeId});assert.equal(store.snapshot('tenant',a).trades.length,0);assert.equal(store.snapshot('tenant',a).trainer.collection.cards.length,9);store.close();store=new StreamWeaverPokemonStore(path);assert.equal(store.snapshot('tenant',b).trainer.collection.cards.length,9);assert.equal(store.snapshot('other',a).trainer.collection.cards.length,0);const events=[];await store.flush(async(...args)=>events.push(args));const count=events.length;await store.flush(async(...args)=>events.push(args));assert.equal(events.length,count);}finally{store.close();rmSync(dir,{recursive:true,force:true})}
});
test('new browser control bundles parse as executable JavaScript',()=>{for(const source of [streamWeaverAssistantBrowserJs(),streamWeaverChatDeskBrowserJs(),streamWeaverPokemonBrowserJs()])assert.doesNotThrow(()=>new vm.Script(source));});
