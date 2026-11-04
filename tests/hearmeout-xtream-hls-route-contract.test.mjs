import assert from 'node:assert/strict';
import test from 'node:test';
import {handleXtreamHlsRequest} from '../apps/hearmeout/dist/xtream-hls-route.js';

function responseStub(){
 const response={headersSent:false,statusCode:0,headers:{},body:'',writeHead(status,headers={}){this.statusCode=status;this.headers=headers;return this;},end(body=''){this.body=String(body);this.ended=true;return this;},destroy(){this.destroyed=true;}};
 return response;
}

test('Apollo Xtream HLS route handles preflight without starting media preparation',async()=>{
 const response=responseStub();
 const handled=await handleXtreamHlsRequest({method:'OPTIONS',headers:{}},response,'/api/watch/xtream/hls/episode-7-abc/index.m3u8');
 assert.equal(handled,true);
 assert.equal(response.statusCode,204);
 assert.equal(response.ended,true);
 assert.equal(response.headers['access-control-allow-methods'],'GET, OPTIONS');
 assert.equal(response.headers['access-control-allow-headers'],'content-type, range');
});

test('Apollo Xtream HLS route rejects non-GET media requests without touching the worker',async()=>{
 const response=responseStub();
 const handled=await handleXtreamHlsRequest({method:'POST',headers:{}},response,'/api/watch/xtream/hls/episode-7-abc/index.m3u8');
 assert.equal(handled,true);
 assert.equal(response.statusCode,405);
 assert.deepEqual(JSON.parse(response.body),{error:'method_not_allowed'});
 assert.equal(response.headers['access-control-allow-origin'],'*');
});

test('Apollo Xtream HLS handler declines unrelated paths',async()=>{
 const response=responseStub();
 const handled=await handleXtreamHlsRequest({method:'GET',headers:{}},response,'/api/watch/youtube/hls/abcdefghijk/index.m3u8');
 assert.equal(handled,false);
 assert.equal(response.statusCode,0);
 assert.equal(response.ended,undefined);
});
