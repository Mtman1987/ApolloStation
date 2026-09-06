import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {StreamWeaverFlowTestRoom} from '../apps/streamweaver/dist/flow-test-room.js';
import {flowAuthorTools} from '../apps/streamweaver/dist/flow-author-worker.js';
import {normalizeFlowPackage} from '../apps/streamweaver/dist/flow-packages.js';
import {OpenAiToolAuthor} from '../apps/stellar-core/dist/openai-tool-author.js';
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

const actor={id:'owner',displayName:'Owner'};
function candidate(){return normalizeFlowPackage({schemaVersion:1,kind:'streamweaver.flow-package',packageId:'flow.rpsls',name:'RPSLS',commands:[{id:'rpsls',trigger:'!rpsls',actionIds:['game'],runtime:'flow'}],actions:[{id:'game',type:'run-native',config:{capability:'streamweaver.donor-command.v1',donorId:'secure-choice-session',...rpsls}}],guide:{summary:'Private RPSLS game',invariants:['No early reveal'],sections:[{id:'configuration',title:'Setup',content:'Link both accounts.'},{id:'troubleshooting',title:'Expiry',content:'Challenges expire after 180 seconds.'},{id:'tests',title:'Tests',content:'Exercise all ten pairs, ties, decline and expiry.'}]}},{now:new Date().toISOString(),author:actor,visibility:'private'});}
test('shadow room executes actual RPSLS handlers and captures all output without live services',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'flow-shadow-')),events=[];
 try{const rooms=new StreamWeaverFlowTestRoom(dir,{publishSimulationRoomEvent:async(tenant,event,key)=>{events.push({tenant,event,key});}});
 const report=await rooms.test('tenant-a','owner',candidate());assert.equal(report.passed,true,JSON.stringify(report));assert.equal(report.checks.length,15);assert.ok(events.some(e=>e.event.body.includes('Rock crushes Scissors')));
 const run=await rooms.start('tenant-a','owner',candidate());assert.equal(run.state,'pending');assert.throws(()=>rooms.view('tenant-b','owner',run.id,'a'));assert.throws(()=>rooms.view('tenant-a','other-owner',run.id,'a'));assert.equal(JSON.stringify(run).includes('token'),false);
 const wrong=candidate();[wrong.actions[0].config.relations[0].winner,wrong.actions[0].config.relations[0].loser]=[wrong.actions[0].config.relations[0].loser,wrong.actions[0].config.relations[0].winner];const failed=await rooms.test('tenant-a','owner',wrong);assert.equal(failed.passed,false);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('author retrieves scoped docs and must retest executable changes before submission',async()=>{
 const source=candidate();let accepted;const list=flowAuthorTools(source,actor,p=>{accepted=p},async()=>({passed:true}));const tool=name=>list.find(t=>t.name===name);
 assert.equal(tool('read_flow').run({}).guide,undefined);assert.equal(tool('search_flow_docs').run({query:'expire'}).length,1);assert.equal(tool('read_flow_doc').run({sectionId:'configuration'}).content,'Link both accounts.');
 const arg={packageJson:JSON.stringify(source)};assert.throws(()=>tool('submit_flow').run(arg),/shadow tests/);await tool('run_shadow_tests').run(arg);assert.deepEqual(tool('submit_flow').run(arg),{accepted:true});assert.equal(accepted.guide.summary,source.guide.summary);
 source.commands[0].trigger='!duel';assert.throws(()=>tool('submit_flow').run({packageJson:JSON.stringify(source)}),/shadow tests/);
});
test('OpenAI adapter sends tool results with reasoning history and bounded model selection',async()=>{
 const requests=[];const author=new OpenAiToolAuthor({apiKey:'test-secret',fetchImpl:async(url,init)=>{assert.equal(url,'https://api.openai.com/v1/responses');const body=JSON.parse(init.body);assert.equal(init.redirect,'error');assert.equal(init.headers.authorization,'Bearer test-secret');requests.push(body);return Response.json({status:'completed',usage:{input_tokens:10,output_tokens:5},output:requests.length===1?[{type:'reasoning',id:'r1',summary:[]},{type:'function_call',name:'read_flow_doc',call_id:'call-1',arguments:'{"sectionId":"configuration"}'}]:[{type:'function_call',name:'submit_flow',call_id:'call-2',arguments:'{}'}]});}});
 const result=await author.run({model:'gpt-5.6-luna',instructions:'Test',request:'Change title',signal:new AbortController().signal,tools:[{name:'read_flow_doc',description:'Read',parameters:{},run:()=>({content:'Setup guide'})},{name:'submit_flow',description:'Submit',parameters:{},run:()=>({accepted:true})}]});assert.deepEqual(result,{inputTokens:20,outputTokens:10,requests:2});assert.equal(requests[0].model,'gpt-5.6-luna');assert.equal(requests[0].store,false);assert.ok(requests[1].input.some(i=>i.type==='reasoning'));assert.ok(requests[1].input.some(i=>i.type==='function_call_output'&&i.call_id==='call-1'));assert.equal(JSON.stringify(requests).includes('test-secret'),false);
});
