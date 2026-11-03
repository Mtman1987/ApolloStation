import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

test('port brief converts capability gaps and donor-only paths into review-only tasks', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'apollo-port-brief-'));
  try {
    const comparison = {provenance:{donor:{repository:'owner/donor',ref:'main',commit:'abc'},apollo:{commit:'def',appPath:'apps/hearmeout'}},summary:{donorFiles:2},donorOnlyPaths:['src/player.ts']};
    const caps = {products:[{id:'hearmeout',appPath:'apps/hearmeout',priority:'P0',status:'partial',knownGaps:['sync playback'],sourceDocs:['ledger.md'],evidence:['test.mjs']}]};
    fs.writeFileSync(path.join(dir,'comparison.json'),JSON.stringify(comparison));
    fs.writeFileSync(path.join(dir,'caps.json'),JSON.stringify(caps));
    const out=path.join(dir,'out');
    const run=spawnSync(process.execPath,['scripts/parity-prepare-port.mjs',path.join(dir,'comparison.json'),path.join(dir,'caps.json'),out],{encoding:'utf8'});
    assert.equal(run.status,0,run.stderr);
    const brief=JSON.parse(fs.readFileSync(path.join(out,'port-brief.json'),'utf8'));
    assert.equal(brief.portTasks[0].capability,'sync playback');
    assert.equal(brief.donorOnlyCandidates[0].reviewRequired,true);
    assert.match(brief.donorOnlyCandidates[0].sourceUrl,/blob\/abc\/src\/player.ts$/);
    assert.equal(brief.classification.reviewRequired,true);
    assert.match(fs.readFileSync(path.join(out,'port-brief.md'),'utf8'),/not proof of missing features/);
  } finally { fs.rmSync(dir,{recursive:true,force:true}); }
});
