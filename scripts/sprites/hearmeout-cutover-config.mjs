import { readFile, realpath } from 'node:fs/promises';
import { resolve } from 'node:path';

export async function hearMeOutCutoverEnvironment(dataRoot) {
  const root = resolve(dataRoot);
  let config;
  try { config = JSON.parse(await readFile(resolve(root, 'hearmeout-cutover.json'), 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return {}; throw new Error('HearMeOut cutover configuration cannot be read'); }
  if (config.schemaVersion !== 1 || config.workerOrigin !== 'https://hmo-dj-worker.fly.dev' || !/^Bearer [^\r\n]{16,}$/.test(config.workerAuthorization ?? '') || !/^[A-Za-z0-9._:-]{1,160}$/.test(config.tenantId ?? '') || !/^wss:\/\/[^/]+\/?$/.test(config.livekitUrl ?? '') || !config.livekitApiKey || !config.livekitApiSecret) throw new Error('HearMeOut cutover configuration is incomplete');
  const database = await realpath(resolve(root, 'hearmeout-room-owner-canary.sqlite'));
  if (database !== resolve(root, 'hearmeout-room-owner-canary.sqlite')) throw new Error('HearMeOut cutover database must remain inside its data root');
  return {
    HEARMEOUT_CONTROLLED_BRIDGE: '1',
    HEARMEOUT_ROOM_DATABASE_PATH: database,
    HEARMEOUT_VOICE_BRIDGE_ORIGIN: config.workerOrigin,
    HEARMEOUT_VOICE_BRIDGE_AUTHORIZATION: config.workerAuthorization,
    HEARMEOUT_VOICE_BRIDGE_TENANT_ID: config.tenantId,
    LIVEKIT_URL: config.livekitUrl,
    LIVEKIT_API_KEY: config.livekitApiKey,
    LIVEKIT_API_SECRET: config.livekitApiSecret,
  };
}
