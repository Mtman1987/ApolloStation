import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const script = path.resolve('scripts/parity-donor-inventory.mjs');

test('donor inventory records hashes and excludes secrets, dependencies, binaries and symlinks', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'apollo-donor-inventory-'));
  const output = path.join(root, 'report.json');
  const source = path.join(root, 'source');
  fs.mkdirSync(path.join(source, 'src'), { recursive: true });
  fs.mkdirSync(path.join(source, 'node_modules', 'pkg'), { recursive: true });
  fs.writeFileSync(path.join(source, 'src', 'index.js'), 'export const answer = 42;\n');
  fs.writeFileSync(path.join(source, '.env'), 'TOKEN=do-not-include');
  fs.writeFileSync(path.join(source, 'node_modules', 'pkg', 'index.js'), 'ignored');
  fs.writeFileSync(path.join(source, 'photo.png'), Buffer.from([0, 1, 2]));

  const run = spawnSync(process.execPath, [script, '--root', source, '--repository', 'owner/donor', '--ref', 'main', '--app-path', 'apps/hearmeout', '--output', output], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  const report = JSON.parse(fs.readFileSync(output, 'utf8'));
  assert.equal(report.provenance.repository, 'owner/donor');
  assert.equal(report.provenance.appPath, 'apps/hearmeout');
  assert.equal(report.provenance.donorCodeExecuted, false);
  assert.equal(report.summary.filesInventoried, 1);
  assert.equal(report.files[0].path, 'src/index.js');
  assert.match(report.files[0].sha256, /^[a-f0-9]{64}$/);
  assert.equal(report.summary.skipped.excluded >= 2, true);
  fs.rmSync(root, { recursive: true, force: true });
});

test('rejects invalid repository identifiers', () => {
  const run = spawnSync(process.execPath, [script, '--root', '.', '--repository', '../donor', '--ref', 'main', '--output', 'unused.json'], { encoding: 'utf8' });
  assert.equal(run.status, 2);
});
