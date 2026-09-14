import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';

// Read the existing release data in place. Never export credentials, queries,
// media URLs or user profiles, create jobs, enqueue video or change service state.
const root = '/home/sprite/data/release';
const config = JSON.parse(await readFile(root + '/hearmeout-cutover.json', 'utf8'));
const db = new DatabaseSync(root + '/spmt-empty-catalog-sandbox.sqlite', { readOnly: true });
try {
  const tenant = config.tenantId;
  const owner = config.broadcast?.executionUserId;
  const period = new Date().toISOString().slice(0, 7);
  const entitlements = db.prepare('SELECT body FROM entitlements WHERE tenant_id=?').all(tenant).map(row => JSON.parse(row.body));
  const planId = entitlements.find(item => ['billing.plan', 'billing-plan', 'plan', 'tier'].includes(item.key) && ['free', 'creator', 'pro', 'agency'].includes(item.value))?.value ?? 'free';
  const manifest = JSON.parse(await readFile('/home/sprite/apollo-release/current/config/billing-plans.v1.json', 'utf8'));
  const limit = manifest.plans.find(plan => plan.planId === planId)?.limits['hosted-worker-minutes'];
  const usage = db.prepare('SELECT resource, execution_target, SUM(delta) AS used FROM usage_events WHERE tenant_id=? AND user_id=? AND period=? GROUP BY resource, execution_target').all(tenant, owner, period);
  const recent = db.prepare("SELECT body FROM execution_jobs WHERE tenant_id=? AND owner_app_id='hearmeout' ORDER BY created_at DESC LIMIT 12").all(tenant).map(row => {
    const job = JSON.parse(row.body);
    return { capability: job.capabilityId, state: job.state, createdAt: job.createdAt, completedAt: job.completedAt, attempt: job.attempt, errorCode: job.error?.code, executionTarget: job.executionTarget, billedToBroadcastOwner: job.billedUserId === owner, lane: job.input?.lane, hasQuery: typeof job.input?.query === 'string' };
  });
  console.log(JSON.stringify({ period, planId, hostedWorkerMinuteLimit: limit, usage, recentJobs: recent }));
} finally { db.close(); }
for (const path of ['/health/hearmeout', '/api/watch/broadcast/state']) {
  const response = await fetch('http://127.0.0.1:8080' + path, { signal: AbortSignal.timeout(15000) });
  const data = await response.json();
  console.log(JSON.stringify(path.endsWith('/state') ? { path, status: response.status, playback: data.playback?.status, queuedRequests: data.queue?.length } : { path, status: response.status, buildSha: data.buildSha, broadcast: data.broadcast, mediaWorker: data.mediaWorker }));
}
