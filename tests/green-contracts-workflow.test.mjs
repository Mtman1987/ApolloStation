import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import test from 'node:test';

test('full validation runs locally and GitHub deploys main directly',()=>{
  assert.equal(existsSync(new URL('../.github/workflows/green-contracts.yml',import.meta.url)),false);
  const runner=readFileSync(new URL('../scripts/validate-local.mjs',import.meta.url),'utf8');
  assert.match(runner,/test:sprite/);
  assert.match(runner,/test-rtc-browser/);
  for(const name of ['hls','media','room-window','cached-audio','screen'])assert.ok(runner.includes(`'${name}'`));
  const workflow=readFileSync(new URL('../.github/workflows/sprite-promotion.yml',import.meta.url),'utf8');
  assert.match(workflow,/push:\s+branches: \[main\]/);
  assert.doesNotMatch(workflow,/workflow_run|npm run test/);
});
