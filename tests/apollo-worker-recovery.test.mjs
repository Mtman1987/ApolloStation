import assert from 'node:assert/strict';
import test from 'node:test';
import {getEventListeners} from 'node:events';
import {createServer} from 'node:http';
import {HearMeOutSuiteActionWorker} from '../apps/hearmeout/dist/suite-action-worker.js';
import {createIntegratedSpaceMountainWebHost} from '../apps/spacemountain-web/dist/integrated-server.js';

test('HearMeOut retries a failed heartbeat and claim, clears degraded health, and releases abort listeners', {timeout:5000}, async()=>{
  const controller=new AbortController(), health=[];
  let reports=0, claims=0;
  const worker=new HearMeOutSuiteActionWorker({
    async reportExecutionWorker(){if(++reports===1)throw new Error('heartbeat timeout');},
    async claimAnyExecutionJob(){if(++claims===1)throw new Error('claim timeout');if(claims===5)controller.abort();return null;},
  },{}, {workerId:'recovery-test',actions:[],onHealth:value=>health.push(value)});
  await worker.run(controller.signal,1);
  assert.equal(reports,2,'Failed heartbeat is retried immediately on the next cycle');
  assert.equal(claims,5,'Polling continues after the failed claim');
  assert.deepEqual(health.slice(0,3),['heartbeat timeout','claim timeout','']);
  assert.equal(health.at(-1),'');
  assert.equal(getEventListeners(controller.signal,'abort').length,0);
});

test('overall health reports a failed app and recovers without restarting ingress', {timeout:10000}, async()=>{
  let appReady=false;
  const upstream=createServer((req,res)=>{res.setHeader('content-type','application/json');res.statusCode=req.url==='/health/ready'?200:404;res.end(JSON.stringify({ready:true}));});
  const app=createServer((req,res)=>{res.statusCode=appReady?200:503;res.setHeader('content-type','application/json');res.end(JSON.stringify({state:appReady?'ready':'degraded'}));});
  await Promise.all([upstream,app].map(server=>new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))));
  const ingress=createIntegratedSpaceMountainWebHost({spmtOrigin:`http://127.0.0.1:${upstream.address().port}`,greenAppOrigins:{hearmeout:`http://127.0.0.1:${app.address().port}`},buildSha:'recovery-test',port:0,host:'127.0.0.1'});
  try{
    await ingress.listen();const url=`http://127.0.0.1:${ingress.server.address().port}/sandbox/health`;
    let response=await fetch(url);assert.equal(response.status,503);let body=await response.json();assert.equal(body.ready,false);assert.equal(body.apps.hearmeout.ready,false);assert.equal(body.web.buildSha,'recovery-test');
    appReady=true;response=await fetch(url);assert.equal(response.status,200);body=await response.json();assert.equal(body.ready,true);
  }finally{await ingress.close();await Promise.all([upstream,app].map(server=>new Promise(resolve=>server.close(resolve))));}
});
