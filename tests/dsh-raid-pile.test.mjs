import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { DshRaidPileStore } from '../apps/discord-stream-hub/dist/raid-pile.js';

function fixture(t, settings = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-raid-pile-')), path = join(dir, 'state.sqlite');
  let now = '2026-09-01T00:00:00.000Z';
  const store = new DshRaidPileStore(path, () => ({ maxSize: 40, minSize: 10, pointsReward: 25, handoffHours: 4, monthlyStrikeLimit: 3, ...settings }), () => now);
  t.after(() => { store.close(); rmSync(dir, { recursive: true, force: true }); });
  return { store, setNow(value) { now = value; } };
}

function joinLive(store, tenant, id, viewers) {
  store.join(tenant, { userId: id, twitchLogin: id, displayName: id.toUpperCase() });
  store.updatePresence(tenant, id, viewers, true);
}

test('Raid Pile target uses 60 percent low-viewer and 40 percent longest-wait weighting', t => {
  const { store, setNow } = fixture(t); const tenant = 'tenant';
  joinLive(store, tenant, 'a', 2); joinLive(store, tenant, 'b', 12); joinLive(store, tenant, 'c', 15);
  const pile = store.piles(tenant)[0];
  const first = store.advance(tenant, pile.id, 'initial');
  assert.equal(first.userId, 'a');
  setNow('2026-09-01T00:01:00.000Z');
  const second = store.advance(tenant, pile.id, 'manual');
  assert.notEqual(second.userId, 'a', 'last-raided time must stop the same smallest creator monopolizing the pile');
});

test('Raid Pile splits at 41 and merges from two piles only after total membership drops below 10', t => {
  const { store } = fixture(t); const tenant = 'tenant';
  for (let i = 0; i < 41; i++) store.join(tenant, { userId: `u${i}`, twitchLogin: `u${i}`, displayName: `User ${i}` });
  let piles = store.piles(tenant);
  assert.equal(piles.length, 2);
  assert.deepEqual(piles.map(p => p.members.length).sort((a,b)=>a-b), [20,21]);
  for (let i = 0; i < 31; i++) store.leave(tenant, `u${i}`);
  assert.equal(store.piles(tenant).length, 2, '10 members still keeps two piles');
  store.leave(tenant, 'u31');
  assert.equal(store.piles(tenant).length, 1, '9 members merges back to one pile');
});

test('four-hour hold changes announced target without pretending the physical pile moved', t => {
  const { store, setNow } = fixture(t); const tenant = 'tenant';
  joinLive(store, tenant, 'a', 5); joinLive(store, tenant, 'b', 8);
  const pile = store.piles(tenant)[0]; const first = store.advance(tenant, pile.id, 'initial');
  setNow('2026-09-01T04:01:00.000Z');
  const handoffs = store.dueHandoffs(tenant);
  assert.equal(handoffs.length, 1);
  assert.equal(handoffs[0].priorTarget.userId, first.userId);
  assert.notEqual(handoffs[0].nextTarget.userId, first.userId);
  assert.match(handoffs[0].message, /physical pile remains/i);
  assert.equal(store.member(tenant, first.userId).isLive, true, 'handoff never forces the old holder offline');
});

test('three off-pile raids in one month automatically remove the member and duplicate events do not double-strike', t => {
  const { store } = fixture(t); const tenant = 'tenant';
  joinLive(store, tenant, 'a', 5); joinLive(store, tenant, 'b', 8); joinLive(store, tenant, 'c', 9);
  const pile = store.piles(tenant)[0]; store.advance(tenant, pile.id, 'initial');
  const canonical = store.piles(tenant)[0].target.userId;
  const raider = ['a','b','c'].find(id => id !== canonical);
  let result = store.recordRaidOut(tenant, raider, 'outsider', 'event-1');
  assert.equal(result.strikes, 1); assert.equal(result.removed, false);
  result = store.recordRaidOut(tenant, raider, 'outsider', 'event-1');
  assert.equal(result.strikes, 1, 'replayed provider event is idempotent');
  result = store.recordRaidOut(tenant, raider, 'outsider', 'event-2');
  assert.equal(result.strikes, 2); assert.equal(result.removed, false);
  result = store.recordRaidOut(tenant, raider, 'outsider', 'event-3');
  assert.equal(result.strikes, 3); assert.equal(result.removed, true);
  assert.equal(store.member(tenant, raider), undefined);
});

test('quick leave and rejoin preserve fairness history instead of resetting it', t => {
  const { store, setNow } = fixture(t); const tenant = 'tenant';
  joinLive(store, tenant, 'a', 1); joinLive(store, tenant, 'b', 20);
  const pile = store.piles(tenant)[0];
  const first = store.advance(tenant, pile.id, 'initial');
  assert.equal(first.userId, 'a');
  const lastRaidedAt = store.member(tenant, 'a').lastRaidedAt;
  store.leave(tenant, 'a', 'quick-out');
  setNow('2026-09-01T00:10:00.000Z');
  store.join(tenant, { userId: 'a', twitchLogin: 'a', displayName: 'A' });
  assert.equal(store.member(tenant, 'a').lastRaidedAt, lastRaidedAt);
});

test('no canonical target means an off-platform raid cannot create a strike', t => {
  const { store } = fixture(t); const tenant = 'tenant';
  store.join(tenant, { userId: 'a', twitchLogin: 'a', displayName: 'A' });
  const result = store.recordRaidOut(tenant, 'a', 'outsider', 'no-target-event');
  assert.equal(result.compliant, true);
  assert.equal(result.strikes, 0);
  assert.equal(result.removed, false);
});

test('SpaceMountainLive is reserved as the system Lounge and cannot join the pile', t => {
  const { store } = fixture(t);
  assert.throws(() => store.join('tenant', { userId: 'lounge', twitchLogin: 'SpaceMountainLive', displayName: 'SpaceMountainLive' }), /system-owned lounge/i);
});
