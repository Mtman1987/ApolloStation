import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = file => readFileSync(path.join(root, file), 'utf8');

test('manual donor inventory uploads every REA and generated port-brief artifact as a separate path', () => {
  const workflow = read('.github/workflows/apollo-donor-inventory.yml');
  const section = workflow.slice(workflow.indexOf('- name: Upload complete parity evidence bundle'));
  for (const artifact of [
    'donor-inventory.json',
    'apollo-inventory.json',
    'parity-comparison.json',
    'donor-rea-analysis.json',
    'apollo-rea-analysis.json',
    'port-brief/port-brief.json',
    'port-brief/port-brief.md',
  ]) assert.match(section, new RegExp('^\\s+' + artifact.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&') + '$', 'm'), artifact);
  assert.doesNotMatch(section, /\\\\n/, 'artifact paths must not be encoded as literal backslash-n text');
  assert.match(workflow, /persist-credentials: false/);
  assert.match(workflow, /donor code is never installed or run/);
});

test('nightly donor matrix also prepares and uploads the review-only port brief', () => {
  const workflow = read('.github/workflows/apollo-parity-nightly.yml');
  assert.match(workflow, /Prepare reviewable Apollo port brief/);
  assert.match(workflow, /node scripts\\/parity-prepare-port\\.mjs parity-comparison\\.json config\\/apollo-parity-capabilities\\.v1\\.json port-brief/);
  assert.match(workflow, /port-brief\\/port-brief\\.json/);
  assert.match(workflow, /port-brief\\/port-brief\\.md/);
  assert.match(workflow, /donor code execution: disabled|Candidate comparison only; no parity claim/);
});

test('REA and port-brief generators retain static-analysis and human-review guardrails', () => {
  const rea = read('scripts/parity-rea.mjs');
  const brief = read('scripts/parity-prepare-port.mjs');
  assert.match(rea, /analyzed as data/);
  assert.match(rea, /does not launch the target application/);
  assert.match(brief, /candidate-only-not-proof/);
  assert.match(brief, /No task is auto-approved or auto-merged/);
});
