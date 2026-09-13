import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { SqliteHearMeOutRoomMediaRuntime } from '../apps/hearmeout/dist/room-media-core.js';

const rooms = new SqliteHearMeOutRoomMediaRuntime(':memory:');
const principal = userId => ({ tenantId: 'media-browser-test', userId, displayName: userId, roles: ['member'] });
const owner = principal('alice'), guest = principal('bob');
rooms.createRoom(owner, { roomId: 'room', name: 'Playback', privacy: 'public', operationId: 'create' });
rooms.joinRoom(guest, 'room', 'join');
const bundle = await readFile(new URL('../apps/hearmeout/dist/media-client.js', import.meta.url));
const wav = Buffer.alloc(44 + 16000 * 2 * 60);
wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16);
wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(16000, 24); wav.writeUInt32LE(32000, 28);
wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(wav.length - 44, 40);
for (let index = 0; index < 16000 * 60; index++) wav.writeInt16LE(Math.round(Math.sin(index / 16000 * 2 * Math.PI * 440) * 3000), 44 + index * 2);
const view = viewer => ({ room: rooms.getRoom(viewer.tenantId, 'room'), member: rooms.listMembers(viewer.tenantId, 'room').some(member => member.userId === viewer.userId), viewer: { ...viewer, canManage: viewer.userId === owner.userId }, music: rooms.getSession(viewer.tenantId, 'room', 'music'), movie: rooms.getSession(viewer.tenantId, 'room', 'movie') });
let operation = 0;
const server = createServer(async (request, response) => {
  try {
    if (request.url === '/media-client.js') { response.setHeader('content-type', 'application/javascript'); response.end(bundle); return; }
    if (request.url?.startsWith('/v1/media/public/')) {
      const range = request.headers.range?.match(/bytes=(\d+)-(\d*)/);
      response.setHeader('content-type', 'audio/wav'); response.setHeader('accept-ranges', 'bytes');
      if (range) { const start = Number(range[1]), end = range[2] ? Number(range[2]) : wav.length - 1; response.writeHead(206, { 'content-range': `bytes ${start}-${end}/${wav.length}`, 'content-length': end - start + 1 }); response.end(wav.subarray(start, end + 1)); }
      else { response.setHeader('content-length', wav.length); response.end(wav); } return;
    }
    const viewer = principal(String(request.headers.cookie || '').includes('bob') ? 'bob' : 'alice');
    if (request.url?.startsWith('/api/')) {
      response.setHeader('content-type', 'application/json');
      if (request.method === 'POST') { let raw = ''; for await (const part of request) raw += part; const body = JSON.parse(raw); response.end(JSON.stringify(rooms.control(viewer, { ...body, roomId: 'room', lane: 'music', operationId: 'browser-' + operation++ }))); }
      else response.end(JSON.stringify(view(viewer)));
      return;
    }
    response.setHeader('content-type', 'text/html');
    response.end(`<div id="player"></div><div id="other"></div><script src="/media-client.js"></script><script>window.initial=${JSON.stringify(view(viewer))};HearMeOutMedia.mount(document.querySelector('#player'),initial,'music')</script>`);
  } catch (error) { response.statusCode = 400; response.end(JSON.stringify({ message: error.message })); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
for (const id of ['first', 'second']) rooms.enqueue(owner, { roomId: 'room', lane: 'music', operationId: id, item: { itemId: id, title: id, type: 'music', source: 'browser-test', playbackUrl: 'https://media.example/v1/media/public/' + 'a'.repeat(43), durationSeconds: 60 } });
rooms.control(owner, { roomId: 'room', lane: 'music', action: 'unmute', operationId: 'enable-shared-audio' });
let browser;
try {
  browser = await chromium.launch({ executablePath: process.env.HMO_TEST_BROWSER_PATH || chromium.executablePath(), headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required'] });
  const errors = [], pages = [];
  for (const userId of ['alice', 'bob']) {
    const context = await browser.newContext(); await context.addCookies([{ name: 'session', value: userId, url: origin }]);
    const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message)); await page.goto(origin); pages.push(page);
    await page.waitForFunction(() => { const audio = document.querySelector('audio'); return audio && !audio.paused && audio.currentTime > .2; });
    await page.evaluate(() => { window.audioContext = new AudioContext(); window.analyser = audioContext.createAnalyser(); audioContext.createMediaElementSource(document.querySelector('audio')).connect(analyser).connect(audioContext.destination); return audioContext.resume(); });
    await page.waitForFunction(() => { const samples = new Float32Array(analyser.fftSize); analyser.getFloatTimeDomainData(samples); return samples.some(value => Math.abs(value) > .005); });
  }
  const control = (action, args = {}) => rooms.control(owner, { roomId: 'room', lane: 'music', action, ...args, operationId: 'server-' + operation++ });
  control('pause');
  for (const page of pages) await page.waitForFunction(() => document.querySelector('audio').paused);
  control('seek', { position: 12 }); control('volume', { position: 40 });
  for (const page of pages) await page.waitForFunction(() => { const audio = document.querySelector('audio'); return Math.abs(audio.currentTime - 12) < .5 && Math.abs(audio.volume - .4) < .01; });
  await pages[0].evaluate(() => { window.audioBefore = document.querySelector('audio'); HearMeOutMedia.park(); HearMeOutMedia.mount(document.querySelector('#other'), initial, 'music'); });
  assert.equal(await pages[0].evaluate(() => document.querySelector('audio') === window.audioBefore && document.querySelector('audio').currentTime >= 12), true);
  await pages[0].getByRole('button', { name: 'Play', exact: true }).click();
  for (const page of pages) await page.waitForFunction(() => !document.querySelector('audio').paused && document.querySelector('audio').currentTime > 12);
  assert.equal(await pages[1].getByRole('button', { name: 'Play', exact: true }).isVisible(), false);
  control('mute'); for (const page of pages) await page.waitForFunction(() => document.querySelector('audio').muted);
  control('next', { expectedRequestId: 'hmo-request:first' });
  control('next', { expectedRequestId: 'hmo-request:first' });
  for (const page of pages) await page.waitForFunction(() => document.querySelector('[data-hmo-player="music"] strong').textContent === 'second' && document.querySelector('audio').currentTime < 6);
  rooms.moderateMember(owner, { roomId: 'room', targetUserId: 'bob', action: 'kick', operationId: 'kick' });
  await pages[1].waitForFunction(() => !document.querySelector('audio'));
  assert.equal(await pages[0].locator('audio').count(), 1);
  assert.deepEqual(errors, []);
  console.log('PASS: two browsers play actual audio; canonical pause, seek, volume, mute and next synchronize; stale drawers preserve playback; duplicate end events do not skip tracks; revoked membership stops playback.');
} finally { await browser?.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); rooms.close(); }
