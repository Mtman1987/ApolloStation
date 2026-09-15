import assert from 'node:assert/strict';
import test from 'node:test';
import Hls from 'hls.js';
import { hearMeOutHlsRecoveryAction, hearMeOutLiveSyncTarget } from '../apps/hearmeout/dist/playback-source.js';

test('HearMeOut automatically retries a starting broadcast before declaring the song lost', () => {
  for (let attempt = 0; attempt < 6; attempt++) assert.equal(hearMeOutHlsRecoveryAction(Hls.ErrorTypes.NETWORK_ERROR, attempt), 'retry-network');
  assert.equal(hearMeOutHlsRecoveryAction(Hls.ErrorTypes.NETWORK_ERROR, 6), 'stop');
  for (let attempt = 0; attempt < 3; attempt++) assert.equal(hearMeOutHlsRecoveryAction(Hls.ErrorTypes.MEDIA_ERROR, attempt), 'recover-media');
  assert.equal(hearMeOutHlsRecoveryAction(Hls.ErrorTypes.MEDIA_ERROR, 3), 'stop');
  assert.equal(hearMeOutHlsRecoveryAction(Hls.ErrorTypes.OTHER_ERROR, 0), 'stop');
});

test('shared viewers correct meaningful live drift without continuously seeking', () => {
  assert.equal(hearMeOutLiveSyncTarget(10, 15, 4), 15);
  assert.equal(hearMeOutLiveSyncTarget(12, 15, 4), undefined);
  assert.equal(hearMeOutLiveSyncTarget(20, 15, 4), 15);
  assert.equal(hearMeOutLiveSyncTarget(10, undefined, 4), undefined);
  assert.equal(hearMeOutLiveSyncTarget(10, 15, 0), undefined);
});
