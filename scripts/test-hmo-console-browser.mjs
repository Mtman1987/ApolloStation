import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { chromium } from 'playwright';
import { createHearMeOutWebServer } from '../apps/hearmeout/dist/web-server-v3.js';
import { SqliteHearMeOutRoomMediaRuntime } from '../apps/hearmeout/dist/room-media-core.js';

const directory = await mkdtemp(join(tmpdir(), 'hmo-console-browser-')), path = join(directory, 'room.sqlite');
const spmt = createServer((request, response) => { response.setHeader('content-type', 'application/json'); if (request.url === '/v1/session') response.end(JSON.stringify({ actorId: 'owner', displayName: 'Owner', tenantIds: ['tenant'], scopes: ['admin'] })); else { response.statusCode = 404; response.end('{}'); } });
await new Promise(resolve => spmt.listen(0, '127.0.0.1', resolve));
const host = createHearMeOutWebServer({ spmtOrigin: `http://127.0.0.1:${spmt.address().port}`, databasePath: path, port: 0 });
await host.listen();
const rooms = new SqliteHearMeOutRoomMediaRuntime(path), owner = { tenantId: 'tenant', userId: 'owner', displayName: 'Owner', roles: ['admin'] };
rooms.createRoom(owner, { roomId: 'old', name: 'Old room', privacy: 'public', operationId: 'create' });
const item = { itemId: 'song', type: 'music', title: 'Saved after the room is gone', source: 'user-url', playbackUrl: 'https://example.com/song.mp3' };
rooms.enqueue(owner, { roomId: 'old', lane: 'music', item, operationId: 'play' });
rooms.saveFavorite(owner, item); rooms.deleteRoom(owner, 'old', 'delete');
let browser;
try {
  browser = await chromium.launch({ executablePath: process.env.HMO_TEST_BROWSER_PATH || chromium.executablePath(), headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage(), errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${host.server.address().port}`);
  await page.getByRole('button', { name: 'Saved music', exact: true }).click();
  const dialog = page.getByRole('dialog'); await dialog.getByRole('button', { name: 'Remove', exact: true }).click();
  await page.getByRole('dialog').getByText('No favorites yet.', { exact: true }).waitFor();
  assert.equal(rooms.musicLibrary(owner).favorites.length, 0);
  assert.equal(rooms.listRooms(owner).length, 0);
  assert.deepEqual(errors, []);
  console.log('PASS: the actual HMO home page lists and removes saved music after its source room has been deleted.');
} finally { await browser?.close(); rooms.close(); await host.close(); await new Promise(resolve => spmt.close(resolve)); await rm(directory, { recursive: true, force: true }); }
