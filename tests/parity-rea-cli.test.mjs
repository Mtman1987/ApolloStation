import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const script = path.join(root, 'scripts/parity-rea.mjs');

test('REA wrapper rejects a missing target without invoking npx', () => {
  const result = spawnSync(process.execPath, [script, '/definitely-not-an-apollo-target'], {
    cwd: root,
    encoding: 'utf8'
  });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /REA target does not exist/);
});
