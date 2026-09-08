import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const DATABASE = '/home/sprite/data/release/spmt-empty-catalog-sandbox.sqlite';
const KEY = 'green:mtman1987:exchange-test:100xp:v1';

// One owner-approved data migration. No network calls, credentials, or balance resets.
export function creditGreenTestXp(databasePath, runtimeMode) {
  if (runtimeMode !== 'sandbox') throw Error('Test XP requires sandbox runtime');
  const actual = realpathSync(databasePath); // Never create an empty database by mistake.
  if (basename(actual) !== 'spmt-empty-catalog-sandbox.sqlite') throw Error('Test XP requires the Green sandbox database');
  const db = new DatabaseSync(actual, { timeout: 5000 });
  try {
    db.exec('BEGIN IMMEDIATE');
    const profiles = db.prepare('SELECT user_id, body FROM user_profiles WHERE username = ?').all('mtman1987');
    if (profiles.length !== 1) throw Error('Expected one existing mtman1987 profile');
    const profile = JSON.parse(profiles[0].body), userId = profiles[0].user_id;
    if (profile.userId !== userId || profile.username !== 'mtman1987' || !db.prepare('SELECT id FROM users WHERE id = ?').get(userId)) throw Error('Account identity does not match');
    const tenants = db.prepare("SELECT id FROM tenants WHERE owner_user_id = ? AND status = 'active'").all(userId).filter(t => profile.tenantIds?.includes(t.id));
    if (tenants.length !== 1) throw Error('Expected one active tenant owned by mtman1987');
    const tenantId = tenants[0].id;
    const prior = db.prepare('SELECT body FROM xp_events WHERE tenant_id = ? AND idempotency_key = ?').get(tenantId, KEY);
    const idem = db.prepare("SELECT body FROM idempotency WHERE namespace = 'xp' AND tenant_id = ? AND idem_key = ?").get(tenantId, KEY);
    const before = Number(db.prepare('SELECT COALESCE(SUM(delta),0) AS balance FROM xp_events WHERE tenant_id = ? AND user_id = ?').get(tenantId, userId).balance);
    if (prior || idem) {
      if (!prior || !idem || prior.body !== idem.body) throw Error('Incomplete prior XP credit; manual reconciliation required');
      const event = JSON.parse(prior.body);
      if (event.userId !== userId || event.delta !== 100 || event.idempotencyKey !== KEY) throw Error('XP credit idempotency conflict');
      db.exec('COMMIT');
      return { username: 'mtman1987', tenantId, duplicate: true, credited: 0, balance: before };
    }
    const epoch = Number(db.prepare("SELECT value FROM authority_meta WHERE key = 'epoch'").get()?.value);
    if (!Number.isSafeInteger(epoch) || epoch < 1) throw Error('Authority epoch is unavailable');
    const event = { id: `xp_${randomUUID()}`, tenantId, userId, delta: 100, sourceAppId: 'spacemountain', reason: 'Owner-approved Green exchange-rate test credit', idempotencyKey: KEY, createdAt: new Date().toISOString(), eventType: 'sandbox.exchange-test.credit', metadata: { sandboxOnly: true, requestedBy: 'mtman1987' } };
    const body = JSON.stringify(event);
    db.prepare('INSERT INTO xp_events(id,tenant_id,user_id,idempotency_key,delta,body) VALUES(?,?,?,?,?,?)').run(event.id, tenantId, userId, KEY, 100, body);
    db.prepare("INSERT INTO idempotency(namespace,tenant_id,idem_key,body) VALUES('xp',?,?,?)").run(tenantId, KEY, body);
    // Supply/exchange calculations consume the authority journal as well as the wallet ledger.
    db.prepare("INSERT INTO authority_journal(epoch,kind,tenant_id,record_id,body,created_at) VALUES(?,'xp',?,?,?,?)").run(epoch, tenantId, event.id, body, event.createdAt);
    const after = Number(db.prepare('SELECT COALESCE(SUM(delta),0) AS balance FROM xp_events WHERE tenant_id = ? AND user_id = ?').get(tenantId, userId).balance);
    if (after !== before + 100) throw Error('XP credit verification failed');
    db.exec('COMMIT');
    return { username: 'mtman1987', tenantId, duplicate: false, credited: 100, balance: after };
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch {}
    throw error;
  } finally { db.close(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (process.argv.length !== 2 || process.env.DEPLOY_ROLE !== 'release') throw Error('Run only from the Green release deployment');
  if (realpathSync(DATABASE) !== DATABASE) throw Error('Refusing a redirected Green database path');
  console.log(JSON.stringify(creditGreenTestXp(DATABASE, process.env.SPMT_RUNTIME_MODE)));
}
