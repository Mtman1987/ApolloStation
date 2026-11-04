import { readFile, realpath } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';

export async function hearMeOutCutoverEnvironment(dataRoot) {
  const root = resolve(dataRoot);
  let config;
  try { config = JSON.parse(await readFile(resolve(root, 'hearmeout-cutover.json'), 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return {}; throw new Error('HearMeOut cutover configuration cannot be read'); }
  if (config.schemaVersion !== 1 || config.workerOrigin !== 'https://hmo-dj-worker.fly.dev' || !/^Bearer [^\r\n]{16,}$/.test(config.workerAuthorization ?? '') || !/^[A-Za-z0-9._:-]{1,160}$/.test(config.tenantId ?? '') || !/^wss:\/\/[^/]+\/?$/.test(config.livekitUrl ?? '') || !config.livekitApiKey || !config.livekitApiSecret) throw new Error('HearMeOut cutover configuration is incomplete');
  if (config.discord && (!/^\d{5,30}$/.test(config.discord.clientId ?? '') || !/^[a-fA-F0-9]{64}$/.test(config.discord.publicKey ?? '') || !Array.isArray(config.discord.guildIds) || !config.discord.guildIds.length || config.discord.guildIds.some(id => !/^\d{5,30}$/.test(id)))) throw new Error('HearMeOut Discord cutover binding is incomplete');
  if (config.activity && !/^\d{5,30}$/.test(config.activity.clientId ?? '')) throw new Error('HearMeOut Activity client ID is invalid');
  if (config.broadcast && ![config.broadcast.ffmpegBinary, config.broadcast.ffprobeBinary].every(value => typeof value === 'string' && isAbsolute(value))) throw new Error('HearMeOut broadcast needs absolute paths to provisioned ffmpeg and ffprobe binaries');
  if (config.broadcast?.singleProgram && !/^[A-Za-z0-9._:-]{1,160}$/.test(config.broadcast.executionUserId ?? "")) throw new Error("Single broadcast execution binding is incomplete");
  if (config.mediaWorker && (!config.broadcast || !isAbsolute(config.mediaWorker.ytDlpBinary ?? ''))) throw new Error('HearMeOut media worker needs provisioned broadcast tools and yt-dlp');
  const database = await realpath(resolve(root, 'hearmeout-room-owner-canary.sqlite'));
  if (database !== resolve(root, 'hearmeout-room-owner-canary.sqlite')) throw new Error('HearMeOut cutover database must remain inside its data root');
  return {
    ...(config.broadcast?.singleProgram ? { HEARMEOUT_SINGLE_BROADCAST: "1", HEARMEOUT_BROADCAST_EXECUTION_USER_ID: config.broadcast.executionUserId } : {}),
    HEARMEOUT_CONTROLLED_BRIDGE: '1',
    ...(config.broadcast ? { HEARMEOUT_CONTROLLED_MEDIA: '1', HEARMEOUT_BROADCAST_CACHE_PATH: resolve(root, 'hearmeout-broadcast-cache'), HEARMEOUT_FFMPEG_BINARY: config.broadcast.ffmpegBinary, HEARMEOUT_FFPROBE_BINARY: config.broadcast.ffprobeBinary } : {}),
    ...(config.mediaWorker ? { HEARMEOUT_YT_DLP_BINARY: config.mediaWorker.ytDlpBinary, HEARMEOUT_MEDIA_TENANT_ID: config.tenantId, HEARMEOUT_PREPARED_MEDIA_ENABLED: '1', HEARMEOUT_MOVIE_PROVIDER_ORIGIN: 'https://hearmeout-main.fly.dev' } : {}),
    ...(config.activity ? { HEARMEOUT_ACTIVITY_TENANT_ID: config.tenantId, DISCORD_CLIENT_ID: config.activity.clientId } : {}),
    ...(config.discord ? { HEARMEOUT_ACTIVITY_TENANT_ID: config.tenantId, DISCORD_CLIENT_ID: config.discord.clientId, DISCORD_PUBLIC_KEY: config.discord.publicKey, HEARMEOUT_DISCORD_GUILD_IDS: config.discord.guildIds.join(',') } : {}),
    HEARMEOUT_ROOM_DATABASE_PATH: database,
    HEARMEOUT_VOICE_BRIDGE_ORIGIN: config.workerOrigin,
    HEARMEOUT_VOICE_BRIDGE_AUTHORIZATION: config.workerAuthorization,
    HEARMEOUT_VOICE_BRIDGE_TENANT_ID: config.tenantId,
    LIVEKIT_URL: config.livekitUrl,
    LIVEKIT_API_KEY: config.livekitApiKey,
    LIVEKIT_API_SECRET: config.livekitApiSecret,
  };
}
