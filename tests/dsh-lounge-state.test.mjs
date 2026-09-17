import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { DshLoungeStateStore } from '../apps/discord-stream-hub/dist/lounge-state.js';
import { DSH_SYSTEM_LIVE_CHANNELS, isDshSystemOwnedTwitchLogin } from '../apps/discord-stream-hub/dist/system-live-channels.js';

test('SpaceMountainLive is a spotlight-eligible system Lounge but never a Raid Pile target', () => {
  const lounge = DSH_SYSTEM_LIVE_CHANNELS.find(channel => channel.twitchLogin === 'spacemountainlive');
  assert.ok(lounge);
  assert.equal(lounge.spotlightEligible, true);
  assert.equal(lounge.raidPileTargetEligible, false);
  assert.equal(lounge.raidTrainFallbackEligible, true);
  assert.equal(lounge.virtualHost, 'stella');
  assert.equal(isDshSystemOwnedTwitchLogin('SpaceMountainLive'), true);
});

test('Lounge and Stella can share one durable presentation state', t => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-lounge-'));
  const path = join(dir, 'state.sqlite');
  let now = '2026-09-17T20:00:00.000Z';
  const store = new DshLoungeStateStore(path, () => now);
  t.after(() => { store.close(); rmSync(dir, { recursive: true, force: true }); });

  assert.equal(store.view('tenant').mode, 'lounge');
  now = '2026-09-17T20:01:00.000Z';
  const state = store.setRaidPile('tenant', {
    pileIds: ['pile-1'],
    physicalAudienceHolder: 'spacemountainlive',
    announcedTarget: 'creator1',
    returnPending: true,
    features: [{ kind: 'message', id: 'handoff', title: 'Raid Pile handoff' }],
  });
  assert.equal(state.mode, 'raid-pile');
  assert.equal(state.physicalAudienceHolder, 'spacemountainlive');
  assert.equal(state.announcedTarget, 'creator1');
  assert.equal(state.raidReturnPending, true);
  assert.deepEqual(store.view('tenant'), state);
});
