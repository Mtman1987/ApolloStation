import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { creditGreenTestXp } from '../scripts/sprites/credit-green-test-xp.mjs';
function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'green-xp-')); t.after(() => rmSync(dir, { recursive:true, force:true }));
  const path = join(dir,'spmt-empty-catalog-sandbox.sqlite'), db = new DatabaseSync(path); t.after(() => db.close());
  db.exec(`CREATE TABLE users(id TEXT PRIMARY KEY); CREATE TABLE user_profiles(user_id TEXT PRIMARY KEY,username TEXT UNIQUE,body TEXT); CREATE TABLE tenants(id TEXT PRIMARY KEY,owner_user_id TEXT,status TEXT); CREATE TABLE xp_events(id TEXT PRIMARY KEY,tenant_id TEXT,user_id TEXT,idempotency_key TEXT,delta INTEGER,body TEXT,UNIQUE(tenant_id,idempotency_key)); CREATE TABLE idempotency(namespace TEXT,tenant_id TEXT,idem_key TEXT,body TEXT,PRIMARY KEY(namespace,tenant_id,idem_key)); CREATE TABLE authority_meta(key TEXT PRIMARY KEY,value TEXT); INSERT INTO authority_meta VALUES('epoch','1'); CREATE TABLE authority_journal(sequence INTEGER PRIMARY KEY,epoch INTEGER,kind TEXT,tenant_id TEXT,record_id TEXT,body TEXT,created_at TEXT); INSERT INTO users VALUES('owner'); INSERT INTO tenants VALUES('green-owner','owner','active');`);
  db.prepare('INSERT INTO user_profiles VALUES(?,?,?)').run('owner','mtman1987',JSON.stringify({userId:'owner',username:'mtman1987',tenantIds:['green-owner']}));
  return {path,db};
}
test('credit adds 100 to the existing balance once and journals supply',t=>{
  const {path,db}=fixture(t);db.prepare('INSERT INTO xp_events VALUES(?,?,?,?,?,?)').run('prior','green-owner','owner','prior',23,'{}');
  assert.equal(creditGreenTestXp(path,'sandbox').balance,123);
  assert.deepEqual(creditGreenTestXp(path,'sandbox'),{username:'mtman1987',tenantId:'green-owner',duplicate:true,credited:0,balance:123});
  assert.equal(db.prepare('SELECT COUNT(*) n FROM authority_journal').get().n,1);
  assert.equal(JSON.parse(db.prepare('SELECT body FROM authority_journal').get().body).delta,100);
});
test('production, missing account and ambiguous tenant cannot credit',t=>{
  const {path,db}=fixture(t);assert.throws(()=>creditGreenTestXp(path,'production'),/sandbox runtime/);
  db.prepare('INSERT INTO tenants VALUES(?,?,?)').run('other','owner','active');
  db.prepare('UPDATE user_profiles SET body=?').run(JSON.stringify({userId:'owner',username:'mtman1987',tenantIds:['green-owner','other']}));
  assert.throws(()=>creditGreenTestXp(path,'sandbox'),/one active tenant/);
  db.exec('DELETE FROM user_profiles');assert.throws(()=>creditGreenTestXp(path,'sandbox'),/existing mtman1987/);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM xp_events').get().n,0);
});
test('journal failure rolls back wallet and duplicate marker together',t=>{
  const {path,db}=fixture(t);db.exec('DROP TABLE authority_journal');
  assert.throws(()=>creditGreenTestXp(path,'sandbox'),/authority_journal/);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM xp_events').get().n,0);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM idempotency').get().n,0);
});
