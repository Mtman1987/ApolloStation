import test from 'node:test';
import assert from 'node:assert/strict';
import { StellarAssistantStore, StellarPrivateAssistant } from '../apps/stellar-core/dist/index.js';
import { CommlinkOperatorStore } from '../packages/commlink-core/dist/index.js';

function privateFixture(){
  const store=new StellarAssistantStore(':memory:'),records=new Map(),requests=[];
  const jobs={get:(tenant,id)=>{const job=records.get(id);return job?.tenantId===tenant?job:undefined},cancel:(_,id)=>{records.get(id).state='cancelled'},delete:(_,id)=>records.delete(id)};
  const runtime=new StellarPrivateAssistant(store,jobs,{status:()=>({availability:'available'}),accept:input=>{requests.push(input);const id='job-'+requests.length;records.set(id,{id,tenantId:input.tenantId,billedUserId:input.userId,state:'queued'});return {jobId:id}}});
  return {store,records,runtime};
}

test('private reply review reuses the tenant-gated turn control and upserts weighted material',()=>{
  const f=privateFixture();
  try{
    const result=f.runtime.send('tenant-a','owner','hello','turn-1','streamweaver');
    Object.assign(f.records.get(result.jobId),{state:'succeeded',result:{text:'helo captain'}});
    f.runtime.read('tenant-a','owner');
    let thread=f.runtime.controlTurn('tenant-a','owner','turn-1','review',{vote:'positive',weight:3,prompt:'hello',response:'hello captain'});
    assert.deepEqual(thread.turns[0].trainingReview,{vote:'positive',weight:3,response:'hello captain'});
    let rows=f.store.trainingExamples('tenant-a','stellar:private:owner');
    assert.equal(rows.length,1);assert.equal(rows[0].originalResponse,'helo captain');assert.equal(rows[0].response,'hello captain');assert.equal(rows[0].weight,3);
    f.runtime.controlTurn('tenant-a','owner','turn-1','review',{vote:'negative',weight:1,prompt:'hello',response:'hello captain'});
    rows=f.store.trainingExamples('tenant-a','stellar:private:owner');assert.equal(rows.length,1);assert.equal(rows[0].vote,'negative');assert.equal(rows[0].weight,1);
    assert.throws(()=>f.runtime.controlTurn('tenant-b','owner','turn-1','review',{vote:'positive',weight:1,response:'x'}),/not found/);
  }finally{f.store.close()}
});

test('public training material is isolated by tenant and bot persona key',()=>{
  const store=new CommlinkOperatorStore(':memory:');
  try{
    store.saveTrainingExample({tenantId:'tenant-a',personaKey:'public:twitch:bot-1',messageKey:'m1',prompt:'hi',originalResponse:'hey',response:'hey captain',vote:'positive',weight:2,reviewerUserId:'owner-a',metadata:{provider:'twitch'}});
    store.saveTrainingExample({tenantId:'tenant-b',personaKey:'public:twitch:bot-1',messageKey:'m1',prompt:'hi',originalResponse:'different',response:'different',vote:'negative',weight:1,reviewerUserId:'owner-b',metadata:{provider:'twitch'}});
    assert.equal(store.trainingExamples('tenant-a').length,1);assert.equal(store.trainingExamples('tenant-b').length,1);
    assert.equal(store.trainingExamples('tenant-a')[0].response,'hey captain');
    store.saveTrainingExample({tenantId:'tenant-a',personaKey:'public:twitch:bot-1',messageKey:'m1',prompt:'hi',originalResponse:'hey',response:'hey there captain',vote:'positive',weight:3,reviewerUserId:'owner-a',metadata:{provider:'twitch'}});
    const rows=store.trainingExamples('tenant-a','public:twitch:bot-1');assert.equal(rows.length,1);assert.equal(rows[0].weight,3);assert.equal(rows[0].response,'hey there captain');
  }finally{store.close()}
});
