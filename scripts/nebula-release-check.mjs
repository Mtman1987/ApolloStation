import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { validateChatGatewayWorkerEnvironment } from '../apps/chat-gateway/dist/service.js';
import { NEBULA_ARCADE_GAMES } from '../apps/nebula-arcade/dist/game-hub.js';
import { quackverseCards } from '../apps/nebula-arcade/dist/quackverse-data.js';
const root = new URL('../', import.meta.url);
const checks = [];
function check(name, run) {
  try { run(); checks.push({ name, passed: true }); }
  catch (error) { checks.push({ name, passed: false, reason: error.message }); }
}
check('Node runtime', () => { if (Number(process.versions.node.split('.')[0]) < 22) throw new Error('Node 22.16+ is required for SQLite'); });
check('Media renderer', () => { if (spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status !== 0) throw new Error('Install ffmpeg'); });
check('Game catalog', () => { if (NEBULA_ARCADE_GAMES.length !== 20 || quackverseCards.length !== 101) throw new Error('Unexpected game or card inventory'); });
check('Packaged artwork', () => { if (!existsSync(new URL('apps/nebula-arcade/assets/quackverse-art/imported/card-1-light-ranger-armor-4.jpg', root))) throw new Error('Packaged artwork is missing'); });
check('Sprite release remains owner-controlled', () => {
  const workflow = readFileSync(new URL('.github/workflows/sprite-promotion.yml', root), 'utf8');
  if (!workflow.includes("vars.SPRITES_AUTODEPLOY_ENABLED == 'true'") || !workflow.includes("github.ref == 'refs/heads/main'") || !workflow.includes('environment: sprite-release')) throw new Error('Preserve the owner opt-in, main branch restriction and protected Sprite environment');
  const slices = JSON.parse(readFileSync(new URL('config/live-source-slices.v1.json', root), 'utf8'));
  if (slices.productionCutover.liveMutationAllowed !== false || slices.productionCutover.liveRetirementAllowed !== false) throw new Error('Live Fly cutover requires separate verified authorization');
});
if (process.argv.includes('--production')) {
  check('Production provider configuration', () => {
    const config = validateChatGatewayWorkerEnvironment(process.env);
    if (config.runtimeMode !== 'production' || config.operationMode !== 'active' || !config.nebulaArcade?.config.tenants.length) throw new Error('Configure the production Nebula tenant and active provider connections');
    const tenant = config.nebulaArcade.config.tenants.find(item => item.tenantId === process.env.NEBULA_ARCADE_TENANT_ID);
    if (!tenant?.channels.some(channel => channel.stateChannelId === process.env.NEBULA_ARCADE_CHANNEL_ID)) throw new Error('Browser room must match a configured provider stateChannelId');
    for (const item of tenant.channels) if (!config.connections.some(connection => connection.desired && connection.tenantId === tenant.tenantId && connection.provider === item.provider && connection.connectionId === item.connectionId && connection.channelId === item.channelId)) throw new Error(`Provider connection missing for ${item.connectionId}`);
    if (!config.nebulaArcade.publicOrigin) throw new Error('NEBULA_ARCADE_PUBLIC_ORIGIN is required');
  });
  check('Imported database', () => {
    const path = process.env.NEBULA_ARCADE_DATABASE_PATH;
    if (!path || !existsSync(path)) throw new Error('Import the live export into the configured database first');
    const db = new DatabaseSync(path, { readOnly: true });
    try { if (db.prepare('PRAGMA quick_check').get().quick_check !== 'ok') throw new Error('SQLite integrity check failed'); }
    finally { db.close(); }
  });
}
console.log(JSON.stringify({ root: fileURLToPath(root), passed: checks.every(check => check.passed), checks, liveProviderRehearsal: 'not performed', deployment: 'not performed' }, null, 2));
if (checks.some(check => !check.passed)) process.exitCode = 1;
