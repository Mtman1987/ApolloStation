'use strict';

const express = require('express');
const { timingSafeEqual } = require('node:crypto');
const { mkdir, open, readFile, stat, unlink } = require('node:fs/promises');
const { isAbsolute, join } = require('node:path');
const puppeteer = require('puppeteer');
const { createRestreamControl } = require('./restream-control');

function secretsMatch(actual, expected) {
  const left = Buffer.from(String(actual || ''));
  const right = Buffer.from(String(expected || ''));
  return left.length === right.length && timingSafeEqual(left, right);
}

function createRestreamService({ control, credential, automationEnabled = false }) {
  if (typeof credential !== 'string' || credential.length < 32) {
    throw new Error('RESTREAM_CONTROL_CREDENTIAL must contain at least 32 characters');
  }
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '2kb', strict: true }));
  app.get('/healthz', (_req, res) => res.json({ ok: true, service: 'restream-control' }));

  app.use('/restream', (req, res, next) => {
    const header = String(req.get('authorization') || '');
    const supplied = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (!secretsMatch(supplied, credential)) return res.status(401).json({ error: 'Unauthorized' });
    return next();
  });

  app.get('/restream/status', async (_req, res) => {
    try {
      const result = await control.status();
      return res.json({
        configured: result.configured === true,
        automationEnabled: automationEnabled === true,
        state: ['offline', 'live', 'login_required', 'unknown', 'ambiguous', 'error'].includes(result.state) ? result.state : 'unknown',
        recognized: {
          start: Array.isArray(result.recognized?.start) ? result.recognized.start.slice(0, 4) : [],
          stop: Array.isArray(result.recognized?.stop) ? result.recognized.stop.slice(0, 4) : [],
        },
        error: result.error ? 'Restream browser status is unavailable' : null,
      });
    } catch {
      return res.status(502).json({ error: 'Restream status unavailable' });
    }
  });

  app.post('/restream/start', async (_req, res) => {
    if (!automationEnabled) return res.status(423).json({ ok: false, error: 'Restream automation is disabled' });
    try {
      const result = await control.controlledStart();
      if (result?.ok !== true || result?.after?.state !== 'live') return res.status(409).json({ ok: false, error: 'Restream did not verify live state' });
      return res.json({ ok: true, action: 'controlled-start', state: 'live' });
    } catch {
      return res.status(409).json({ ok: false, error: 'Restream start failed; inspect authenticated status' });
    }
  });

  app.post('/restream/reset', async (req, res) => {
    if (!automationEnabled) return res.status(423).json({ ok: false, error: 'Restream automation is disabled' });
    const holdMs = req.body?.holdMs === undefined ? 15000 : Number(req.body.holdMs);
    if (!Number.isInteger(holdMs) || holdMs < 5000 || holdMs > 30000) {
      return res.status(400).json({ ok: false, error: 'holdMs must be an integer from 5000 to 30000' });
    }
    try {
      const result = await control.controlledReset({ holdMs });
      if (result?.ok !== true || result?.after?.state !== 'live') return res.status(409).json({ ok: false, error: 'Restream reset did not verify live state' });
      return res.json({ ok: true, action: 'controlled-reset', state: 'live' });
    } catch {
      return res.status(409).json({ ok: false, error: 'Restream reset failed; inspect authenticated status' });
    }
  });

  app.use((error, _req, res, _next) => {
    if (error?.type === 'entity.too.large') return res.status(413).json({ error: 'Request body too large' });
    return res.status(400).json({ error: 'Invalid request' });
  });
  return app;
}

async function acquireProfileLock(profileDir) {
  await mkdir(profileDir, { recursive: true, mode: 0o700 });
  const marker = process.env.RESTREAM_PROFILE_VOLUME_MARKER || join(profileDir, '.restream-profile-volume');
  try {
    await stat(marker);
  } catch {
    throw new Error('Persistent Restream profile volume marker is missing');
  }
  const lockPath = join(profileDir, '.restream-control.lock');
  const handle = await open(lockPath, 'wx', 0o600).catch(error => {
    if (error?.code === 'EEXIST') throw new Error('Restream profile is already owned by another controller');
    throw error;
  });
  await handle.writeFile(JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
  await handle.sync();
  return async () => {
    await handle.close().catch(() => {});
    const lock = await readFile(lockPath, 'utf8').catch(() => '');
    if (lock.includes('"pid":' + process.pid)) await unlink(lockPath).catch(() => {});
  };
}

async function start() {
  const credential = String(process.env.RESTREAM_CONTROL_CREDENTIAL || '');
  if (credential.length < 32) throw new Error('RESTREAM_CONTROL_CREDENTIAL must be at least 32 characters');
  const profileDir = String(process.env.RESTREAM_PROFILE_DIR || '');
  if (!isAbsolute(profileDir)) throw new Error('RESTREAM_PROFILE_DIR must be an absolute mounted-volume path');
  const releaseLock = await acquireProfileLock(profileDir);
  const control = createRestreamControl({
    chromiumPath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium',
    puppeteer,
    profileDir,
  });
  const app = createRestreamService({
    control, credential,
    automationEnabled: process.env.RESTREAM_AUTOMATION_ENABLED === 'true',
  });
  const server = app.listen(Number(process.env.PORT || 3018), process.env.HOST || '0.0.0.0');
  let closing = false;
  const shutdown = async () => {
    if (closing) return;
    closing = true;
    server.close();
    await control.close().catch(() => {});
    await releaseLock();
  };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
  server.on('error', async error => { await shutdown(); throw error; });
}

if (require.main === module) {
  start().catch(error => {
    process.stderr.write('[restream-control] startup failed: ' + (error?.message || 'unknown error') + '\n');
    process.exitCode = 1;
  });
}

module.exports = { createRestreamService, secretsMatch, acquireProfileLock };
