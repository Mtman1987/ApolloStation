import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {StreamWeaverSecureChoiceStore,assertStreamWeaverSecureChoiceConfig} from '../apps/streamweaver/dist/secure-choice.js';
import {legacyCommunityPackages,normalizeFlowPackage,assertStreamWeaverFlowRunnable} from '../apps/streamweaver/dist/flow-packages.js';

const rpsls={
  title:'Rock Paper Scissors Lizard Spock',target:'first-mention',expiresSeconds:180,
  options:[{id:'rock',label:'Rock'},{id:'paper',label:'Paper'},{id:'scissors',label:'Scissors'},{id:'lizard',label:'Lizard'},{id:'spock',label:'Spock'}],
  relations:[
    {winner:'scissors',loser:'paper',message:'Scissors cuts Paper'},
    {winner:'paper',loser:'rock',message:'Paper covers Rock'},
    {winner:'rock',loser:'lizard',message:'Rock crushes Lizard'},
    {winner:'lizard',loser:'spock',message:'Lizard poisons Spock'},
    {winner:'spock',loser:'scissors',message:'Spock smashes Scissors'},
    {winner:'scissors',loser:'lizard',message:'Scissors decapitates Lizard'},
    {winner:'lizard',loser:'paper',message:'Lizard eats Paper'},
    {winner:'paper',loser:'spock',message:'Paper disproves Spock'},
    {winner:'spock',loser:'rock',message:'Spock vaporizes Rock'},
    {winner:'rock',loser:'scissors',message:'Rock crushes Scissors'},
  ]
};
const delivery=(id='duel-1')=>({schemaVersion:1,deliveryId:id,consumerId:'streamweaver.installed-flows',attempts:1,message:{schemaVersion:1,tenantId:'tenant-a',provider:'twitch',connectionId:'main',channelId:'captain',messageId:id,text:'!duel @spockfan',occurredAt:'2026-09-06T12:00:00Z',actor:{providerUserId:'tw-a',canonicalUserId:'user-a',username:'rockfan',displayName:'RockFan',isBot:false,roles:['member']},mentions:[{token:'@spockfan',providerUserId:'tw-b',canonicalUserId:'user-b',username:'spockfan'}]}});

test('AI draft validation rejects incomplete secure game rules before installation',()=>{
  const draft=normalizeFlowPackage({schemaVersion:1,kind:'streamweaver.flow-package',packageId:'flow.rpsls',name:'RPSLS',commands:[{id:'rpsls',trigger:'!rpsls',actionIds:['game'],runtime:'flow'}],actions:[{id:'game',type:'run-native',config:{capability:'streamweaver.donor-command.v1',donorId:'secure-choice-session',...rpsls}}]}, {now:'2026-09-06T12:00:00Z',author:{id:'owner'},visibility:'private'});
  assert.doesNotThrow(()=>assertStreamWeaverFlowRunnable(draft));
  draft.actions[0].config.relations=rpsls.relations.slice(0,9);
  assert.throws(()=>assertStreamWeaverFlowRunnable(draft),/resolve every possible pair/i);
});

function fixture(){const dir=mkdtempSync(join(tmpdir(),'sw-choice-')),path=join(dir,'state.sqlite'),store=new StreamWeaverSecureChoiceStore(path,()=> '2026-09-06T12:00:00.000Z');return{dir,store,close(){store.close();rmSync(dir,{recursive:true,force:true})}};}

test('RPSLS rules are a complete secure-choice relation graph and the helper stays out of the human community catalog',()=>{
  const value=assertStreamWeaverSecureChoiceConfig(rpsls);
  assert.equal(value.options.length,5);assert.equal(value.relations.length,10);
  assert.equal(legacyCommunityPackages().some(pkg=>JSON.stringify(pkg).includes('secure-choice-session')),false);
  assert.throws(()=>assertStreamWeaverSecureChoiceConfig({...rpsls,relations:rpsls.relations.slice(0,9)}),/resolve every possible pair/i);
});

test('challenge acceptance creates two guaranteed-different identity seats and hides the first committed move',async()=>{
  const h=fixture();try{
    const started=h.store.start({delivery:delivery(),config:rpsls,requestKey:'duel-1:start',publicOrigin:'https://stream.example'}),pending=h.store.find(started.sessionId);
    assert.ok(pending);assert.match(started.text,/spockfan/);assert.match(started.text,/secure-choice/);
    assert.throws(()=>h.store.accept(started.sessionId,pending.challenger.token,'user-a','https://stream.example'),/no peeking/i);
    h.store.accept(started.sessionId,pending.challenged.token,'user-b','https://stream.example');
    let active=h.store.find(started.sessionId);assert.equal(active.state,'active');assert.equal(active.round,1);
    assert.equal(active.challenger.order.length,5);assert.equal(active.challenged.order.length,5);assert.notDeepEqual(active.challenger.order,active.challenged.order);
    const rockIndex=active.challenger.order.indexOf('rock')+1;
    h.store.choose(started.sessionId,active.challenger.token,'user-a',rockIndex,'https://stream.example');
    active=h.store.find(started.sessionId);assert.equal(active.state,'active');assert.equal(active.challenger.choiceId,'rock');assert.equal(active.challenged.choiceId,undefined);
    const scissorsIndex=active.challenged.order.indexOf('scissors')+1;
    h.store.choose(started.sessionId,active.challenged.token,'user-b',scissorsIndex,'https://stream.example');
    const resolved=h.store.find(started.sessionId);assert.equal(resolved.state,'resolved');assert.equal(resolved.result.winnerUserId,'user-a');assert.match(resolved.result.message,/Rock crushes Scissors/);
    const sent=[];await h.store.flushOutbox(async message=>{sent.push(message);});assert.equal(sent.length,2);assert.match(sent[0].text,/guaranteed different/i);assert.match(sent[1].text,/Rock crushes Scissors/);
  }finally{h.close();}
});

test('a tie reveals only after both commits and starts a fresh round with new distinct grids',()=>{
  const h=fixture();try{
    const started=h.store.start({delivery:delivery('duel-2'),config:rpsls,requestKey:'duel-2:start',publicOrigin:'https://stream.example'}),pending=h.store.find(started.sessionId);
    h.store.accept(started.sessionId,pending.challenged.token,'user-b','https://stream.example');let active=h.store.find(started.sessionId);
    const a=active.challenger.order.indexOf('paper')+1,b=active.challenged.order.indexOf('paper')+1;
    h.store.choose(started.sessionId,active.challenger.token,'user-a',a,'https://stream.example');h.store.choose(started.sessionId,active.challenged.token,'user-b',b,'https://stream.example');
    active=h.store.find(started.sessionId);assert.equal(active.state,'active');assert.equal(active.round,2);assert.equal(active.challenger.choiceId,undefined);assert.equal(active.challenged.choiceId,undefined);assert.notDeepEqual(active.challenger.order,active.challenged.order);
  }finally{h.close();}
});
