import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createNode2Ingress, isNebulaPath } from '../scripts/hostless/node2-ingress.mjs';

test('Node 2 routes Nebula pages, assets and API to its actual runtime', async () => {
  const fake = app => createServer((req, res) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({app, url:req.url, cookie:req.headers.cookie, authorization:req.headers.authorization})); });
  const stream = fake('streamweaver'), nebula = fake('nebula');
  await Promise.all([new Promise(r=>stream.listen(0,'127.0.0.1',r)),new Promise(r=>nebula.listen(0,'127.0.0.1',r))]);
  const ingress = createNode2Ingress({streamweaverPort:stream.address().port,nebulaPort:nebula.address().port});
  await new Promise(r=>ingress.listen(0,'127.0.0.1',r));
  const origin=`http://127.0.0.1:${ingress.address().port}`;
  try {
    for (const path of ['/apps/nebula-arcade?surface=shell','/v1/nebula/game-actions','/v1/nebula-arcade/tag/message','/assets/nebula-arcade/mosaic-overlay.js','/mosaic','/overlay/game-mix/test']) {
      const result=await (await fetch(origin+path,{headers:{cookie:'session=test',authorization:'Bearer test'}})).json();
      assert.equal(result.app,'nebula');assert.equal(result.url,path);assert.equal(result.cookie,'session=test');assert.equal(result.authorization,'Bearer test');
    }
    assert.equal((await (await fetch(origin+'/health/nebula-arcade')).json()).url,'/health/ready');
    assert.equal((await (await fetch(origin+'/apps/streamweaver')).json()).app,'streamweaver');
    assert.equal(isNebulaPath('/v1/onboarding/twitch/callback'),false);
    await new Promise(r=>nebula.close(r));
    assert.equal((await fetch(origin+'/apps/nebula-arcade')).status,503);
  } finally {
    await Promise.all([new Promise(r=>ingress.close(r)),new Promise(r=>stream.close(r))]);
    if(nebula.listening)await new Promise(r=>nebula.close(r));
  }
});