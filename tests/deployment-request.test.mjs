import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {deploymentRequest,isTransientDeploymentError} from '../scripts/sprites/deployment-request.mjs';

test('deployment reads retry both Node timeout error shapes with bounded backoff',async()=>{
 const failures=[Object.assign(new Error('timed out'),{name:'TimeoutError'}),Object.assign(new Error('aborted'),{name:'AbortError'})],delays=[];
 const response=await deploymentRequest('http://release.test','/health',{}, {sleep:async ms=>delays.push(ms),fetchImpl:async()=>{if(failures.length)throw failures.shift();return new Response('ready')}});
 assert.equal(await response.text(),'ready');assert.deepEqual(delays,[1000,2000]);
 assert.equal(isTransientDeploymentError(Object.assign(new Error(),{code:'ABORT_ERR'})),true);
});

test('deployment writes are never retried after an ambiguous transport failure',async()=>{
 let calls=0;
 await assert.rejects(()=>deploymentRequest('http://release.test','/request',{method:'POST'},{sleep:async()=>{},fetchImpl:async()=>{calls++;throw Object.assign(new Error('aborted'),{name:'AbortError'})}}),/aborted/);
 assert.equal(calls,1);
});

test('HLS browser verification activates auto-hiding viewer controls without pointer-action races',()=>{
 const source=readFileSync(new URL('../scripts/test-hmo-hls-browser.mjs',import.meta.url),'utf8');
 assert.match(source,/const activate=locator=>locator\.evaluate\(button=>button\.click\(\)\)/);
 assert.doesNotMatch(source,/getByRole\('button',\{name:'Enable sound',exact:true\}\)\.click\(\)/);
});
