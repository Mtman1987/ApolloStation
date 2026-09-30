import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('Apollo routes HearMeOut users to Live HMO and cannot wire the donor bridge', async () => {
  const supervisor = await readFile(new URL('../scripts/sprites/run-supervised-sandbox.mjs', import.meta.url), 'utf8');
  const server = await readFile(new URL('../apps/hearmeout/src/web-server-v3.ts', import.meta.url), 'utf8');
  const guard = await readFile(new URL('../scripts/offline-network-guard.mjs', import.meta.url), 'utf8');
  assert.match(supervisor, /hearMeOutCatalogRegistration\(["']https:\/\/hearmeout\.spacemountain\.live\/["']\)/);
  assert.doesNotMatch(supervisor, /hearMeOutCatalogRegistration\(appLaunchUrl\(publicUrl, ["']\/apps\/hearmeout["']\)\)/);
  assert.doesNotMatch(server, /const liveLoungeBridge=environment\.HEARMEOUT_SINGLE_BROADCAST/);
  assert.doesNotMatch(guard, /hearMeOutLoungeDonor/);
  assert.doesNotMatch(guard, /url\.pathname === ["']\/api\/internal\/lounge\/media["']/);
});
