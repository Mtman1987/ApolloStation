import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { StellarAssistantStore, StellarPrivateAssistant } from '../apps/stellar-core/dist/index.js';
import { streamWeaverPrivateAssistantBrowserJs } from '../apps/streamweaver/dist/private-assistant-client.js';
import { streamWeaverAssistantBrowserJs } from '../apps/streamweaver/dist/assistant-client.js';

function fixture(){
  const store=new StellarAssistantStore(':memory:'),records=new Map(),requests=[];
  const jobs={get:(tenant,id)=>{const j=records.get(id);return j?.tenantId===tenant?j:undefined},cancel:(_,id)=>{records.get(id).state='cancelled'},delete:(_,id)=>records.delete(id)};
  const runtime=new StellarPrivateAssistant(store,jobs,{status:()=>({availability:'available'}),accept:r=>{requests.push(r);const jobId='job-'+requests.length;records.set(jobId,{id:jobId,tenantId:r.tenantId,billedUserId:r.userId,state:'queued',input:r});return {jobId}}});
  const complete=(id,text)=>Object.assign(records.get(id),{state:'succeeded',result:{text}});
  return {store,records,requests,runtime,complete};
}
test('private conversation is user scoped, uses opt-in notes, and retries without duplicate jobs',()=>{
  const f=fixture();try{
    f.store.saveNote('a','one',{title:'Name',content:'My bird is Pip.'});
    let r=f.runtime.send('a','one','Hello','first','streamweaver');assert.equal(f.requests[0].remember,false);assert.doesNotMatch(f.requests[0].message,/Pip/);
    assert.equal(f.runtime.send('a','one','Hello','first','streamweaver').jobId,r.jobId);assert.equal(f.requests.length,1);assert.throws(()=>f.runtime.send('a','one','Changed','first','streamweaver'),/another/);
    f.complete(r.jobId,'Hello there');assert.equal(f.runtime.read('a','one').turns[0].answer,'Hello there');assert.equal(f.runtime.read('a','two').turns.length,0);assert.equal(f.runtime.read('b','one').turns.length,0);
    f.store.savePreferences('a','one',{remember:true});f.runtime.send('a','one','What is my bird called?','second','streamweaver');assert.match(f.requests.at(-1).message,/Pip/);
  }finally{f.store.close()}
});
test('manual and automatic condensation persist named memories, clearing removes pending jobs',()=>{
  const f=fixture();try{
    const first=f.runtime.send('a','one','Remember our plan','first','streamweaver');f.complete(first.jobId,'We will ship on Friday.');
    const summary=f.runtime.summarize('a','one','Release plan');f.complete(summary.jobId,'Release on Friday.');f.runtime.read('a','one');assert.equal(f.store.notes('a','one')[0].title,'Release plan');assert.equal(f.store.notes('a','two').length,0);
    f.store.savePreferences('a','one',{remember:true});for(let i=0;i<20;i++){const r=f.runtime.send('a','one','Turn '+i,'turn-'+i,'streamweaver');f.complete(r.jobId,'Answer '+i);}
    const thread=f.runtime.read('a','one');assert.ok(thread.condensation);const pending=thread.condensation.jobId,epoch=thread.epoch;
    f.runtime.clear('a','one');assert.equal(f.records.has(pending),false);assert.notEqual(f.runtime.read('a','one').epoch,epoch);assert.equal(f.runtime.read('a','one').turns.length,0);assert.equal(f.store.notes('a','one').length,1);
    f.store.deleteForUser('a','one');assert.equal(f.store.notes('a','one').length,0);
  }finally{f.store.close()}
});
test('assistant optimizer returns a draft without modifying persona or private memory',()=>{
  const f=fixture();try{f.runtime.optimize('a','one','A patient librarian','optimize','streamweaver');assert.match(f.requests[0].message,/patient librarian/);assert.equal(f.store.notes('a','one').length,0);assert.equal(f.runtime.read('a','one').turns.length,0);}finally{f.store.close()}
});
test('assistant browser bundles parse',()=>{for(const js of [streamWeaverPrivateAssistantBrowserJs(),streamWeaverAssistantBrowserJs()])assert.doesNotThrow(()=>new vm.Script(js));});

test('spoken replay cursors advance once per completed turn and reset after clearing',()=>{
 const f=fixture();try{
 const a=f.runtime.send('a','one','First','first','streamweaver'),b=f.runtime.send('a','one','Second','second','streamweaver');
 f.complete(b.jobId,'Second reply');let feed=f.runtime.feed('a','one',0);assert.equal(feed.cursor,1);assert.equal(feed.turns[0].jobId,b.jobId);const epoch=feed.epoch;
 f.complete(a.jobId,'First reply');feed=f.runtime.feed('a','one',1,epoch);assert.equal(feed.cursor,2);assert.deepEqual(feed.turns.map(t=>t.jobId),[a.jobId]);assert.equal(f.runtime.feed('a','one',2,epoch).turns.length,0);
 assert.equal(f.runtime.feed('a','two',0).turns.length,0);assert.throws(()=>f.runtime.feed('a','one',-1),/cursor/);
 f.runtime.clear('a','one');feed=f.runtime.feed('a','one',2,epoch);assert.equal(feed.reset,true);assert.equal(feed.cursor,0);assert.equal(feed.turns.length,0);
 }finally{f.store.close()}
});
