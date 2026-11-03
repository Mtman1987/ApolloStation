import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

test('Apollo parity inventory validates and reports all five workstreams', () => {
  const output = execFileSync(process.execPath, ['scripts/parity-audit.mjs'], { encoding: 'utf8' });
  for (const product of ['HearMeOut', 'StreamWeaver', 'Nebula Arcade', 'Discord StreamHub', 'Apollo shared contracts']) {
    assert.ok(output.includes(product), `missing product from report: ${product}`);
  }
  assert.match(output, /inventory check, not a parity pass/);
});

test('HearMeOut capability ledger reports P0 gaps and preserves unverified status', () => {
  const output = execFileSync(process.execPath, ['scripts/parity-audit.mjs'], { encoding: 'utf8' });
  assert.match(output, /HMO-008/);
  assert.match(output, /real provider-to-browser playback with an authorized provider account/);
  assert.match(output, /verify diagnostic endpoints redact credentials and raw URLs/);
  assert.match(output, /P01 two-browser synchronized playback acceptance/);
  assert.match(output, /ported-unverified/);
});
