import assert from 'node:assert/strict';
import test from 'node:test';
import Hls from 'hls.js';
import { HearMeOutPlaybackSource, hearMeOutHlsRecoveryAction, hearMeOutLiveSyncTarget } from '../apps/hearmeout/dist/playback-source.js';

test('HearMeOut automatically retries a starting broadcast before declaring the song lost', () => {
  for (let attempt = 0; attempt < 6; attempt++) assert.equal(hearMeOutHlsRecoveryAction(Hls.ErrorTypes.NETWORK_ERROR, attempt), 'retry-network');
  assert.equal(hearMeOutHlsRecoveryAction(Hls.ErrorTypes.NETWORK_ERROR, 6), 'stop');
  for (let attempt = 0; attempt < 3; attempt++) assert.equal(hearMeOutHlsRecoveryAction(Hls.ErrorTypes.MEDIA_ERROR, attempt), 'recover-media');
  assert.equal(hearMeOutHlsRecoveryAction(Hls.ErrorTypes.MEDIA_ERROR, 3), 'stop');
  assert.equal(hearMeOutHlsRecoveryAction(Hls.ErrorTypes.OTHER_ERROR, 0), 'stop');
});

test('network and decoder recovery budgets remain independent in the player', async () => {
  const { readFile } = await import('node:fs/promises');
  const source = await readFile(new URL('../apps/hearmeout/src/playback-source.ts', import.meta.url), 'utf8');
  assert.match(source, /networkRecoveryAttempts/);
  assert.match(source, /mediaRecoveryAttempts/);
  assert.doesNotMatch(source, /private recoveryAttempts/);
  assert.match(source, /resetRecoveryAttempts\(\)/);
  assert.match(source, /initialLiveManifestSize: 4/);
  assert.match(source, /liveSyncDurationCount: 4/);
});

test('shared viewers correct meaningful live drift without continuously seeking', () => {
  assert.equal(hearMeOutLiveSyncTarget(10, 15, 4), 15);
  assert.equal(hearMeOutLiveSyncTarget(12, 15, 4), undefined);
  assert.equal(hearMeOutLiveSyncTarget(20, 15, 4), undefined);
  assert.equal(hearMeOutLiveSyncTarget(10, undefined, 4), undefined);
  assert.equal(hearMeOutLiveSyncTarget(10, 15, 0), undefined);
});


test('live correction preserves buffered playback during ordinary delays and never seeks backwards', () => {
  const media = {currentTime:20,readyState:4,seeking:false,paused:false,buffered:{length:1,start:()=>15,end:()=>35}};
  const player = new HearMeOutPlaybackSource(media, error => {throw error});
  player.broadcast = true;
  player.hls = {liveSyncPosition:15};
  assert.equal(player.syncLive(),false);assert.equal(media.currentTime,20);
  player.hls.liveSyncPosition=27;
  assert.equal(player.syncLive(),false);assert.equal(media.currentTime,20);
  player.hls.liveSyncPosition=40;
  assert.equal(player.syncLive(),false);assert.equal(media.currentTime,20);
  media.buffered.end=()=>45;media.seeking=true;
  assert.equal(player.syncLive(),false);media.seeking=false;
  assert.equal(player.syncLive(),true);assert.equal(media.currentTime,40);
  assert.equal(player.syncLive(),false);
});
