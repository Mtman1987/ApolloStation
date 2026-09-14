import assert from 'node:assert/strict';
import test from 'node:test';
import Hls from 'hls.js';
import { hearMeOutHlsRecoveryAction } from '../apps/hearmeout/dist/playback-source.js';

test('HearMeOut automatically retries a starting broadcast before declaring the song lost', () => {
  for (let attempt = 0; attempt < 6; attempt++) assert.equal(hearMeOutHlsRecoveryAction(Hls.ErrorTypes.NETWORK_ERROR, attempt), 'retry-network');
  assert.equal(hearMeOutHlsRecoveryAction(Hls.ErrorTypes.NETWORK_ERROR, 6), 'stop');
  for (let attempt = 0; attempt < 3; attempt++) assert.equal(hearMeOutHlsRecoveryAction(Hls.ErrorTypes.MEDIA_ERROR, attempt), 'recover-media');
  assert.equal(hearMeOutHlsRecoveryAction(Hls.ErrorTypes.MEDIA_ERROR, 3), 'stop');
  assert.equal(hearMeOutHlsRecoveryAction(Hls.ErrorTypes.OTHER_ERROR, 0), 'stop');
});
