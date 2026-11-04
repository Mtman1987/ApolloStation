import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

test('compares exact paths, hashes and donor-only candidates without claiming parity', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'apollo-parity-compare-'));
  const donor = path.join(root, 'donor.json');
  const apollo = path.join(root, 'apollo.json');
  const output = path.join(root, 'out.json');
  const inv = (files, repository) => ({ provenance: { repository, commit: 'abc' }, files });
  const file = (name, hash) => ({ path: name, extension: '.ts', sha256: hash, bytes: 10 });
  fs.writeFileSync(donor, JSON.stringify(inv([file('src/player.ts', 'same'), file('src/room.ts', 'donor')], 'donor/repo')));
  fs.writeFileSync(apollo, JSON.stringify(inv([file('apps/player.ts', 'same'), file('src/gateway.ts', 'apollo')], 'Mtman1987/ApolloStation')));
  const run = spawnSync(process.execPath, ['scripts/parity-compare-inventories.mjs', donor, apollo, output], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  const report = JSON.parse(fs.readFileSync(output, 'utf8'));
  assert.equal(report.summary.exactPathMatches, 1);
  assert.equal(report.summary.exactContentMatches, 1);
  assert.deepEqual(report.donorOnlyPaths, ['src/room.ts']);
  assert.match(report.interpretation, /not feature parity/);
  fs.rmSync(root, { recursive: true, force: true });
});
