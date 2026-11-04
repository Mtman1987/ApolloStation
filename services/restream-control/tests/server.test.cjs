'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createServer } = require('node:http');
const { createRestreamService } = require('../src/server');

const credential = 'r'.repeat(48);

async function withServer(t, control, automationEnabled = false) {
  const app = createRestreamService({ control, credential, automationEnabled });
  const server = createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  return { origin: 'http://127.0.0.1:' + server.address().port, auth: { authorization: 'Bearer ' + credential } };
}

test('health check is minimal and does not start or inspect the browser', async t => {
  const control = { status: async () => { throw new Error('must not be called'); } };
  const { origin } = await withServer(t, control);
  const response = await fetch(origin + '/healthz');
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, service: 'restream-control' });
});

test('Restream routes reject missing and incorrect credentials', async t => {
  const control = { status: async () => ({ state: 'offline' }) };
  const { origin } = await withServer(t, control);
  for (const headers of [{}, { authorization: 'Bearer wrong' }]) {
    const response = await fetch(origin + '/restream/status', { headers });
    assert.equal(response.status, 401);
  }
});

test('status is sanitized and omits browser URL, title and profile path', async t => {
  const control = { status: async () => ({
    configured: true, state: 'login_required', profileDir: '/secret/profile',
    url: 'https://app.restream.io/channel?token=secret', title: 'private tab',
    recognized: { start: [], stop: [] }, error: null,
  }) };
  const { origin, auth } = await withServer(t, control);
  const response = await fetch(origin + '/restream/status', { headers: auth });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.deepEqual(body, {
    configured: true, automationEnabled: false, state: 'login_required',
    recognized: { start: [], stop: [] }, error: null,
  });
  assert.equal(JSON.stringify(body).includes('/secret/profile'), false);
  assert.equal(JSON.stringify(body).includes('token=secret'), false);
});

test('start remains locked unless automation is explicitly enabled', async t => {
  let calls = 0;
  const control = { controlledStart: async () => { calls++; return { ok: true, after: { state: 'live' } }; } };
  const { origin, auth } = await withServer(t, control, false);
  const response = await fetch(origin + '/restream/start', { method: 'POST', headers: auth });
  assert.equal(response.status, 423);
  assert.equal(calls, 0);
});

test('start acknowledges only a verified live transition', async t => {
  const control = { controlledStart: async () => ({ ok: true, after: { state: 'live' } }) };
  const { origin, auth } = await withServer(t, control, true);
  const response = await fetch(origin + '/restream/start', { method: 'POST', headers: auth });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, action: 'controlled-start', state: 'live' });
});

test('reset bounds hold time and acknowledges only a verified live transition', async t => {
  let received;
  const control = { controlledReset: async options => { received = options.holdMs; return { ok: true, after: { state: 'live' } }; } };
  const { origin, auth } = await withServer(t, control, true);
  const bad = await fetch(origin + '/restream/reset', { method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify({ holdMs: 999999 }) });
  assert.equal(bad.status, 400);
  const good = await fetch(origin + '/restream/reset', { method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify({ holdMs: 7000 }) });
  assert.equal(good.status, 200);
  assert.equal(received, 7000);
});

test('profile lock requires the mounted-volume marker and prevents duplicate owners', async t => {
  const { mkdtemp, writeFile, readFile, rm } = require('node:fs/promises');
  const { tmpdir } = require('node:os');
  const { join } = require('node:path');
  const { acquireProfileLock } = require('../src/server');
  const directory = await mkdtemp(join(tmpdir(), 'apollo-restream-profile-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await assert.rejects(acquireProfileLock(directory), /volume marker is missing/);
  await writeFile(join(directory, '.restream-profile-volume'), 'persistent-volume\n', { mode: 0o600 });
  const release = await acquireProfileLock(directory);
  await assert.rejects(acquireProfileLock(directory), /already owned/);
  const lock = JSON.parse(await readFile(join(directory, '.restream-control.lock'), 'utf8'));
  assert.equal(lock.pid, process.pid);
  await release();
  const nextRelease = await acquireProfileLock(directory);
  await nextRelease();
});
