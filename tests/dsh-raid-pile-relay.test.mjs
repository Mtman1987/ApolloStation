import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { DshRaidPileRelayStore } from '../apps/discord-stream-hub/dist/raid-pile-relay.js';

function member(userId, login) { return { userId, twitchLogin: login, displayName: login.toUpperCase(), pileId: 'pile-a', joinedAt: '2026-09-17T00:00:00.000Z', currentViewers: 5, isLive: true }; }

test('Raid Pile train fallback preserves physical audience until observed return handoff', t => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-pile-relay-')), path = join(dir, 'state.sqlite');
  let now = '2026-09-17T20:00:00.000Z';
  const store = new DshRaidPileRelayStore(path, () => now);
  t.after(() => { store.close(); rmSync(dir, { recursive: true, force: true }); });

  const own = { kind: 'raid-train', trainId: 'spmt-main', userId: 'train-host', twitchLogin: 'trainhost', displayName: 'Train Host', live: true };
  const partner = { kind: 'partner-train', trainId: 'partner-z', userId: 'partner-host', twitchLogin: 'partnerhost', displayName: 'Partner Host', live: true };
  assert.equal(store.chooseTrain([own], [partner]).userId, 'train-host', 'own active train is preferred over a partner train');

  const attached = store.attachTrain('tenant', 'pile-a', own);
  assert.equal(attached.mode, 'train');
  assert.equal(attached.physicalTargetUserId, 'train-host');

  const returning = member('pile-member', 'pilemember');
  now = '2026-09-17T20:05:00.000Z';
  const pending = store.requestReturn('tenant', 'pile-a', returning);
  assert.equal(pending.mode, 'train');
  assert.equal(pending.physicalTargetUserId, 'train-host', 'lurkers are still physically on train');
  assert.equal(pending.announcedTargetUserId, 'pile-member', 'surfaces may advertise next pile destination');
  assert.equal(pending.returnPending, true);

  assert.equal(store.observeRaid('tenant', 'pile-a', 'somebody-else', returning).mode, 'train', 'unrelated raid cannot move physical state');
  const returned = store.observeRaid('tenant', 'pile-a', 'train-host', returning);
  assert.equal(returned.mode, 'pile');
  assert.equal(returned.physicalTargetUserId, 'pile-member');
  assert.equal(returned.returnPending, false);
});

test('Raid Pile relay falls back to live partner train when own train is unavailable', t => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-pile-relay-')), path = join(dir, 'state.sqlite');
  const store = new DshRaidPileRelayStore(path);
  t.after(() => { store.close(); rmSync(dir, { recursive: true, force: true }); });
  const ownOffline = { kind: 'raid-train', trainId: 'spmt-main', userId: 'ours', twitchLogin: 'ours', displayName: 'Ours', live: false };
  const partner = { kind: 'partner-train', trainId: 'partner-a', userId: 'partner', twitchLogin: 'partner', displayName: 'Partner', live: true };
  assert.equal(store.chooseTrain([ownOffline], [partner]).userId, 'partner');
});
