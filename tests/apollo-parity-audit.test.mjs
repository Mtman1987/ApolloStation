import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

test('Apollo parity inventory validates and reports all five workstreams', () => {
  const output = execFileSync(process.execPath, ['scripts/parity-audit.mjs'], { encoding: 'utf8' });
  for (const product of ['HearMeOut', 'StreamWeaver', 'Nebula Arcade', 'Discord StreamHub', 'Apollo shared contracts']) {
    assert.match(output, new RegExp(product.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  assert.match(output, /inventory check, not a parity pass/);
});
