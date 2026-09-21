import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';

const workflow=readFileSync(new URL('../.github/workflows/green-contracts.yml',import.meta.url),'utf8');

test('Green contracts serialize timing-sensitive tests and cancel only obsolete PR runs',()=>{
  assert.match(workflow,/^  pull_request:/m);
  assert.doesNotMatch(workflow,/^  push:/m);
  assert.match(workflow,/group: green-contracts-\$\{\{ github\.event\.pull_request\.number \|\| github\.ref \}\}/);
  assert.match(workflow,/cancel-in-progress: \$\{\{ github\.event_name == 'pull_request' \}\}/);
  assert.match(workflow,/name: Run deterministic shared contracts\s+run: npm run test:sprite/);
  assert.doesNotMatch(workflow,/run: npm test(?:\s|$)/);
});
