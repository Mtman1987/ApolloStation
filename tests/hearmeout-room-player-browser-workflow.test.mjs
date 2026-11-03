import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const workflow = readFileSync(path.join(root, '.github/workflows/hearmeout-room-player-browser.yml'), 'utf8');

test('HearMeOut browser acceptance runs room sync and HLS in real Chromium without provider secrets', () => {
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /npx playwright install --with-deps chromium/);
  assert.match(workflow, /sudo apt-get install --yes ffmpeg/);
  assert.match(workflow, /node scripts\/test-hmo-media-browser\.mjs/);
  assert.match(workflow, /node scripts\/test-hmo-hls-browser\.mjs/);
  assert.match(workflow, /persist-credentials: false/);
  assert.doesNotMatch(workflow, /XTREAM_PASSWORD|TWITCH_CLIENT_SECRET|DISCORD_BOT_TOKEN/);
});
