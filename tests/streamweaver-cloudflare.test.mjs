import test from 'node:test';
import assert from 'node:assert/strict';
import {CloudflareStreamWeaverImageProvider} from '../apps/streamweaver/dist/cloudflare-image-provider.js';
import {StreamWeaverImageGenerationService} from '../apps/streamweaver/dist/image-generation.js';
import {StreamWeaverImageWorker} from '../apps/streamweaver/dist/image-worker.js';
import {StreamWeaverGenerationStore} from '../apps/streamweaver/dist/generation-settings.js';
import {decodeBinaryImage} from '../apps/streamweaver/dist/binary-image.js';
import {validateChatGatewayWorkerEnvironment} from '../apps/chat-gateway/dist/service.js';
import {streamWeaverGenerationBrowserJs} from '../apps/streamweaver/dist/generation-client.js';
const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=',account='a'.repeat(32),input={prompt:'A mountain',modelNo:'',modelVerNo:'',provider:'cloudflare',count:2,seed:41,providerParams:{steps:4}};
test('Cloudflare uses its fixed account endpoint, bounds supported settings and decodes returned image bytes',async()=>{
 const calls=[],provider=new CloudflareStreamWeaverImageProvider(account,'fixture-key',async(url,init)=>{calls.push({url,init});return Response.json({success:true,result:{image:png}})}),result=await new StreamWeaverImageGenerationService([provider]).image(input);assert.equal(result.binaryImages.length,2);assert.equal(result.resourceUrls.length,0);assert.equal(calls.length,2);assert.match(calls[0].url,/^https:\/\/api.cloudflare.com\/client\/v4\/accounts\/a{32}\/ai\/run\/@cf\//);assert.equal(calls[0].init.redirect,'error');assert.equal(calls[0].init.headers.authorization,'Bearer fixture-key');assert.equal(JSON.parse(calls[1].init.body).seed,42);assert.equal(decodeBinaryImage(result.binaryImages[0]).contentType,'image/png');await assert.rejects(()=>provider.generateImage({...input,providerParams:{lora:'unsupported'}}),/only the steps/);await assert.rejects(()=>provider.generateImage({...input,prompt:'x'.repeat(2049)}),/2048/);assert.equal(calls.length,2);new Function(streamWeaverGenerationBrowserJs());
});
test('binary image validation rejects forged types, malformed encoding and HTML provider output',async()=>{
 assert.throws(()=>decodeBinaryImage({base64:png,contentType:'image/jpeg'}),/format/);assert.throws(()=>decodeBinaryImage({base64:'not base64',contentType:'image/png'}),/encoding/);const provider=new CloudflareStreamWeaverImageProvider(account,'fixture-key',async()=>Response.json({result:{image:Buffer.from('<html>error</html>').toString('base64')}}));await assert.rejects(()=>provider.generateImage(input),/format/);
});
for(const visibility of ['private','public'])test(`Cloudflare worker stores ${visibility} bytes under the active job lease and reuses generation on retry`,async()=>{
 const settings=new StreamWeaverGenerationStore(':memory:'),uploads=[],publications=[],results=[],errors=[];let generated=0,claims=0,failOnce=true;settings.save('tenant',visibility==='private'?'private:viewer':'public',{provider:'cloudflare',enhance:false,contentModeration:false});const provider=new CloudflareStreamWeaverImageProvider(account,'fixture-key',async()=>{generated++;return Response.json({result:{image:png}})}),job={id:'job',tenantId:'tenant',billedUserId:'viewer',ownerAppId:'streamweaver',capabilityId:'streamweaver.image.generate.v1',leaseId:'lease',fencingEpoch:3,input:{prompt:'Mountain',mediaVisibility:visibility}};
 const client={reportExecutionWorker:async()=>{},claimAnyExecutionJob:async()=>++claims<=2?job:null,heartbeatExecutionJob:async()=>{},uploadMediaAsset:async(...args)=>{uploads.push(args);if(failOnce){failOnce=false;throw Error('temporary storage failure')}return {id:'asset'}},publishMediaAsset:async(...args)=>{publications.push(args);return {publicUrl:'https://spmt.example/v1/media/public/opaque'}},succeedExecutionJob:async(...args)=>results.push(args.at(-1)),failExecutionJob:async(...args)=>errors.push(args)},worker=new StreamWeaverImageWorker(client,new StreamWeaverImageGenerationService([provider]),{workerId:'worker',modelNo:'',modelVerNo:'',settings});
 try{await worker.runOnce();await worker.runOnce();assert.equal(generated,1);assert.equal(errors.length,1);assert.equal(results.length,1);assert.equal(uploads[0][3],uploads[1][3]);assert.deepEqual(uploads[1][4],{jobId:'job',leaseId:'lease',fencingEpoch:3});assert.equal(uploads[1][2].toString('base64'),png);assert.doesNotMatch(JSON.stringify(results),/iVBOR|binaryImages/);assert.deepEqual(results[0].mediaAssetIds,['asset']);assert.equal(publications.length,visibility==='public'?1:0);if(visibility==='private')assert.equal(results[0].resourceUrls,undefined);else assert.deepEqual(results[0].resourceUrls,['https://spmt.example/v1/media/public/opaque']);}finally{settings.close()}
});
test('Cloudflare configuration requires both credentials and rejects external generation in sandbox',()=>{
 const base={SPMT_RUNTIME_MODE:'production',SPMT_ORIGIN:'http://127.0.0.1:3000',CHAT_GATEWAY_DATABASE_PATH:'/tmp/chat-sandbox.sqlite',CHAT_GATEWAY_WORKER_CREDENTIAL:'x'.repeat(32),CHAT_GATEWAY_CONNECTIONS:'[]',STREAMWEAVER_PROVIDER_RUNTIME_ENABLED:'1',STREAMWEAVER_WORKER_CREDENTIAL:'y'.repeat(32),STREAMWEAVER_DATABASE_PATH:'/tmp/sw-sandbox.sqlite',STREAMWEAVER_CLOUDFLARE_ACCOUNT_ID:account,STREAMWEAVER_CLOUDFLARE_API_TOKEN:'fixture-key'};assert.equal(validateChatGatewayWorkerEnvironment(base).streamweaver.image.cloudflareAccountId,account);assert.throws(()=>validateChatGatewayWorkerEnvironment({...base,STREAMWEAVER_CLOUDFLARE_API_TOKEN:''}),/together/);assert.throws(()=>validateChatGatewayWorkerEnvironment({...base,SPMT_RUNTIME_MODE:'sandbox',SPMT_OUTBOUND_MODE:'disabled'}),/rejects external/);
});

test('refreshing one provider catalog retains the last successful entries of an unavailable provider',async()=>{
 const settings=new StreamWeaverGenerationStore(':memory:');try{settings.saveCatalog([{provider:'edenai',id:'image/generation/stabilityai',label:'Eden'}]);const service=new StreamWeaverImageGenerationService([new CloudflareStreamWeaverImageProvider(account,'fixture-key'),{id:'edenai',listModels:async()=>{throw Error('unavailable')},generateImage:async()=>assert.fail()}]);settings.saveCatalog(await service.catalog());assert.deepEqual(new Set(settings.catalog().models.map(m=>m.provider)),new Set(['cloudflare','edenai']));settings.saveCatalog([{provider:'edenai',id:'image/generation/openai/dall-e-3',label:'New Eden'}]);assert.equal(settings.catalog().models.filter(m=>m.provider==='edenai').length,1);assert.equal(settings.catalog().models.some(m=>m.provider==='cloudflare'),true);}finally{settings.close()}
});

for(const suffix of ['flux-2-klein-4b','flux-2-klein-9b'])test(`Cloudflare ${suffix} sends multipart dimensions and seeds with fixed steps`,async()=>{
 const calls=[],provider=new CloudflareStreamWeaverImageProvider(account,'fixture-key',async(url,init)=>{calls.push({url,init});return Response.json({result:{image:png}})});
 await provider.generateImage({...input,surface:'private',cloudflareModel:`@cf/black-forest-labs/${suffix}`,resolution:'768x1024',providerParams:{steps:4,guidance_scale:3}});
 assert.equal(calls.length,2);assert.ok(calls[0].init.body instanceof FormData);assert.equal(calls[0].init.headers['content-type'],undefined);assert.equal(calls[0].init.body.get('width'),'768');assert.equal(calls[0].init.body.get('height'),'1024');assert.equal(calls[1].init.body.get('seed'),'42');assert.equal(calls[0].init.body.get('guidance'),'3');assert.equal(calls[0].init.body.get('steps'),null);
 await assert.rejects(()=>provider.generateImage({...input,surface:'private',cloudflareModel:`@cf/black-forest-labs/${suffix}`,providerParams:{steps:5}}),/exactly 4/);assert.equal(calls.length,2);
});

test('Cloudflare Leonardo models use their own bounds and accept Phoenix binary output',async()=>{
 const calls=[],provider=new CloudflareStreamWeaverImageProvider(account,'fixture-key',async(url,init)=>{calls.push({url,body:JSON.parse(init.body)});return url.endsWith('phoenix-1.0')?new Response(Buffer.from(png,'base64'),{headers:{'content-type':'image/png'}}):Response.json({result:{image:png}})});
 const lucid=await provider.generateImage({...input,count:1,cloudflareModel:'@cf/leonardo/lucid-origin',resolution:'1024x768',providerParams:{steps:40,guidance_scale:0}});assert.equal(lucid.binaryImages.length,1);assert.equal(calls[0].body.num_steps,40);assert.equal(calls[0].body.guidance,0);assert.equal(calls[0].body.height,768);
 const phoenix=await provider.generateImage({...input,count:1,cloudflareModel:'@cf/leonardo/phoenix-1.0',providerParams:{steps:50,guidance_scale:2,negative_prompt:'blurry'}});assert.equal(phoenix.binaryImages[0].base64,png);assert.equal(calls[1].body.negative_prompt,'blurry');assert.equal(calls[1].body.num_steps,50);
 await assert.rejects(()=>provider.generateImage({...input,cloudflareModel:'@cf/leonardo/lucid-origin',providerParams:{steps:41}}),/1–40/);
 await assert.rejects(()=>provider.generateImage({...input,cloudflareModel:'@cf/leonardo/phoenix-1.0',providerParams:{guidance_scale:0}}),/guidance/);assert.equal(calls.length,2);
});

test('Klein 9B is rejected by public settings and the worker derives private scope from media visibility',async()=>{
 const model='@cf/black-forest-labs/flux-2-klein-9b',settings=new StreamWeaverGenerationStore(':memory:'),seen=[],results=[],failures=[];let claim=0;
 try{
  assert.throws(()=>settings.save('tenant','public',{cloudflareModel:model}),/private generation/);
  settings.save('tenant','private:viewer',{provider:'cloudflare',cloudflareModel:model,enhance:false,contentModeration:false});
  const provider=new CloudflareStreamWeaverImageProvider(account,'fixture-key',async(_url,init)=>{seen.push(init);return Response.json({result:{image:png}})});
  await assert.rejects(()=>provider.generateImage({...input,cloudflareModel:model}),/private generation/);
  const job={id:'private-job',tenantId:'tenant',billedUserId:'viewer',capabilityId:'streamweaver.image.generate.v1',leaseId:'lease',fencingEpoch:1,input:{prompt:'Mountain',mediaVisibility:'private'}};
  const client={reportExecutionWorker:async()=>{},claimAnyExecutionJob:async()=>++claim===1?job:null,heartbeatExecutionJob:async()=>{},uploadMediaAsset:async()=>({id:'asset'}),succeedExecutionJob:async(...args)=>results.push(args.at(-1)),failExecutionJob:async(...args)=>failures.push(args)};
  await new StreamWeaverImageWorker(client,new StreamWeaverImageGenerationService([provider]),{workerId:'worker',modelNo:'',modelVerNo:'',settings}).runOnce();
  assert.equal(failures.length,0);assert.equal(seen.length,1);assert.equal(results[0].resourceUrls,undefined);assert.deepEqual(results[0].mediaAssetIds,['asset']);
 }finally{settings.close();}
});
