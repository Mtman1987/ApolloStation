import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {HEARMEOUT_ROOM_BROWSER_JS,HEARMEOUT_WEB_CSS} from '../apps/hearmeout/dist/web-server-v3.js';

test('the permanent Lounge owns one autoplaying Twitch player in its main panel',async()=>{
  assert.match(HEARMEOUT_ROOM_BROWSER_JS,/room\.roomId==='system-spacemountainlive-lounge'/);
  assert.match(HEARMEOUT_ROOM_BROWSER_JS,/channel','spacemountainlive'/);
  assert.match(HEARMEOUT_ROOM_BROWSER_JS,/autoplay','true'/);
  assert.match(HEARMEOUT_ROOM_BROWSER_JS,/muted','true'/);
  assert.match(HEARMEOUT_ROOM_BROWSER_JS,/frame\.allow='autoplay; fullscreen; picture-in-picture'/);
  assert.match(HEARMEOUT_WEB_CSS,/\.hmo-lounge-twitch-frame/);
  const source=await readFile(new URL('../apps/hearmeout/src/web-server-v3.ts',import.meta.url),'utf8');
  assert.match(source,/frame-src 'self' https:\/\/player\.twitch\.tv/);
});
