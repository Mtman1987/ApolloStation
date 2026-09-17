import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { DshRaidPileRelayStore } from '../apps/discord-stream-hub/dist/raid-pile-relay.js';

function member(userId, login) { return { userId, twitchLogin: login, displayName: login.toUpperCase(), pileId: 'pile-a', joinedAt: '2026-09-17T00:00:00.000Z', currentViewers: 5, isLive: true }; }

test('Raid Pile holding channel preserves lurkers until confirmed return handoff', t => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-pile-relay-')), path = join(dir, 'state.sqlite');
  let now = '2026-09-17T20:00:00.000Z';
  const store = new DshRaidPileRelayStore(path, () => now);
  t.after(() => { store.close(); rmSync(dir, { recursive: true, force: true }); });

  const holding = { providerUserId: '987654321', twitchLogin: 'spacemountainlive', displayName: 'SpaceMountainLive', live: true };
  const attached = store.attachHoldingChannel('tenant', 'pile-a', holding);
  assert.equal(attached.mode, 'holding');
  assert.equal(attached.physicalTargetUserId, holding.providerUserId);
  assert.equal(attached.holdingLogin, 'spacemountainlive');

  const returning = member('pile-member', 'pilemember');
  now = '2026-09-17T20:05:00.000Z';
  const pending = store.requestReturn('tenant', 'pile-a', returning);
  assert.equal(pending.mode, 'holding');
  assert.equal(pending.physicalTargetUserId, holding.providerUserId, 'lurkers remain physically on the controlled holding channel');
  assert.equal(pending.announcedTargetUserId, 'pile-member', 'surfaces may advertise the next pile destination');
  assert.equal(pending.returnPending, true);

  assert.equal(store.observeRaid('tenant', 'pile-a', 'some-other-channel', returning).mode, 'holding', 'an unrelated raid cannot move physical state');
  const returned = store.observeRaid('tenant', 'pile-a', holding.providerUserId, returning);
  assert.equal(returned.mode, 'pile');
  assert.equal(returned.physicalTargetUserId, 'pile-member');
  assert.equal(returned.returnPending, false);
});

test('Raid Pile refuses to park lurkers on an offline holding channel', t => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-pile-relay-')), path = join(dir, 'state.sqlite');
  const store = new DshRaidPileRelayStore(path);
  t.after(() => { store.close(); rmSync(dir, { recursive: true, force: true }); });
  assert.throws(() => store.attachHoldingChannel('tenant', 'pile-a', { providerUserId: '987654321', twitchLogin: 'spacemountainlive', displayName: 'SpaceMountainLive', live: false }), /must be live/);
});
