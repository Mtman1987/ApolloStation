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
  const paths = section.split(String.fromCharCode(10)).map(line => line.trim());
  for (const artifact of [
    'donor-inventory.json',
    'apollo-inventory.json',
    'parity-comparison.json',
    'donor-rea-analysis.json',
    'apollo-rea-analysis.json',
    'port-brief/port-brief.json',
    'port-brief/port-brief.md',
  ]) assert.ok(paths.includes(artifact), 'missing artifact path: ' + artifact);
  assert.equal(section.includes(String.fromCharCode(92) + 'n'), false, 'artifact paths must not be encoded as literal backslash-n text');
  assert.match(workflow, /persist-credentials: false/);
  assert.match(workflow, /donor code is never installed or run/);
  assert.ok(workflow.includes('node scripts/parity-rea.mjs donor-source > donor-rea-analysis.json'));
  assert.ok(workflow.includes('--app-path "$APOLLO_APP" --output apollo-inventory.json'));
  for (const artifact of ['donor-rea-analysis.json', 'apollo-rea-analysis.json']) {
    assert.ok(workflow.includes(`jq -e 'type == "object"' ${artifact} >/dev/null`), 'missing JSON validation: ' + artifact);
  }
});

test('nightly donor matrix also prepares and uploads the review-only port brief', () => {
  const workflow = read('.github/workflows/apollo-parity-nightly.yml');
  assert.ok(workflow.includes('Prepare reviewable Apollo port brief'));
  assert.ok(workflow.includes('node scripts/parity-prepare-port.mjs parity-comparison.json config/apollo-parity-capabilities.v1.json port-brief'));
  assert.ok(workflow.includes('port-brief/port-brief.json'));
  assert.ok(workflow.includes('port-brief/port-brief.md'));
  assert.ok(workflow.includes('node scripts/parity-rea.mjs donor-source > donor-rea-analysis.json'));
  assert.ok(workflow.includes('--app-path "$APOLLO_APP" --output apollo-inventory.json'));
  for (const artifact of ['donor-rea-analysis.json', 'apollo-rea-analysis.json']) {
    assert.ok(workflow.includes(`jq -e 'type == "object"' ${artifact} >/dev/null`), 'missing JSON validation: ' + artifact);
  }
  assert.ok(workflow.includes('Candidate comparison only; no parity claim'));
  assert.ok(workflow.includes('push:'));
  assert.ok(workflow.includes("'scripts/parity-*.mjs'"));
});

test('targeted REA analysis validates its streamed JSON artifact', () => {
  const workflow = read('.github/workflows/rea-static-analysis.yml');
  assert.ok(workflow.includes('node scripts/parity-rea.mjs "$TARGET_PATH/dist" > rea-analysis.json'));
  assert.ok(workflow.includes("jq -e 'type == " + String.fromCharCode(34) + "object" + String.fromCharCode(34) + "' rea-analysis.json"));
});

test('REA and port-brief generators retain static-analysis and human-review guardrails', () => {
  const rea = read('scripts/parity-rea.mjs');
  const brief = read('scripts/parity-prepare-port.mjs');
  assert.match(rea, /analyzed as data/);
  assert.match(rea, /does not launch the target application/);
  assert.match(brief, /candidate-only-not-proof/);
  assert.match(brief, /No task is auto-approved or auto-merged/);
});
