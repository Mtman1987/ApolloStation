import assert from 'node:assert/strict';
import test from 'node:test';
import {handleXtreamHlsRequest} from '../apps/hearmeout/dist/xtream-hls-route.js';

function responseStub(){
 const response={headersSent:false,statusCode:0,headers:{},body:'',writeHead(status,headers={}){this.statusCode=status;this.headers=headers;return this;},end(body=''){this.body=String(body);this.ended=true;return this;},destroy(){this.destroyed=true;}};
 return response;
}

test('Xtream HLS fails closed when no room authorization callback is configured',async()=>{
 const response=responseStub();
 const handled=await handleXtreamHlsRequest({method:'GET',headers:{}},response,'/api/watch/xtream/hls/vod-42/index.m3u8');
 assert.equal(handled,true);
 assert.equal(response.statusCode,503);
 assert.deepEqual(JSON.parse(response.body),{error:'playback_authorization_unavailable'});
});

test('Xtream HLS rejects a requester who is not authorized for the active room',async()=>{
 const response=responseStub();
 let authorizedStream='';
 const handled=await handleXtreamHlsRequest({method:'GET',headers:{}},response,'/api/watch/xtream/hls/vod-42/index.m3u8',async(_request,streamId)=>{
  authorizedStream=streamId;
  throw Object.assign(new Error('membership required'),{status:403});
 });
 assert.equal(handled,true);
 assert.equal(authorizedStream,'vod-42');
 assert.equal(response.statusCode,403);
 assert.deepEqual(JSON.parse(response.body),{error:'playback_forbidden'});
});

test('Xtream HLS refuses a stream that is not active in any room',async()=>{
 const response=responseStub();
 const handled=await handleXtreamHlsRequest({method:'GET',headers:{}},response,'/api/watch/xtream/hls/vod-42/index.m3u8',async()=>{
  throw Object.assign(new Error('not active'),{status:404});
 });
 assert.equal(handled,true);
 assert.equal(response.statusCode,404);
 assert.deepEqual(JSON.parse(response.body),{error:'playback_not_active'});
});
