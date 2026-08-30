import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { buildHearMeOutBlueMigrationBundle } from '../scripts/build-hearmeout-blue-migration-bundle.mjs';
import { transformBlueHearMeOutActivityRoom } from '../apps/hearmeout/dist/blue-import.js';

function seed(path) {
  const db = new DatabaseSync(path);
  db.exec(`
    CREATE TABLE docs (
      path TEXT PRIMARY KEY,
      collection_path TEXT NOT NULL,
      doc_id TEXT NOT NULL,
      data TEXT NOT NULL
    );
  `);
  const insert = db.prepare('INSERT INTO docs(path,collection_path,doc_id,data) VALUES(?,?,?,?)');
  insert.run('config/runtime', 'config', 'runtime', JSON.stringify({ privateLegacyConfig: 'must-not-leak' }));
  insert.run('rooms/discord-activity', 'rooms', 'discord-activity', JSON.stringify({
    id: 'discord-activity',
    name: 'Discord Activities',
    systemRoom: true,
    isPrivate: false,
    playlist: [],
  }));
  insert.run('rooms/discord-activity/users/secret-member', 'rooms/discord-activity/users', 'secret-member', JSON.stringify({ displayName: 'Must Not Leak Presence' }));
  for (let index = 0; index < 28; index += 1) {
    insert.run(`users/private-${index}`, 'users', `private-${index}`, JSON.stringify({ displayName: `Must Not Leak User ${index}`, token: `secret-${index}` }));
  }
  db.close();
}

test('bundle carries only the canonical room body and reconciliation counts from the observed Blue shape', () => {
  const root = mkdtempSync(join(tmpdir(), 'hmo-blue-bundle-'));
  const path = join(root, 'app.db');
  try {
    seed(path);
    const bundle = buildHearMeOutBlueMigrationBundle(path);
    assert.equal(bundle.schemaVersion, 1);
    assert.equal(bundle.integrity, 'ok');
    assert.equal(bundle.sourceDocuments, 31);
    assert.equal(bundle.activityRoom.documentId, 'discord-activity');
    assert.equal(bundle.reconciliation.spmtUserDocuments, 28);
    assert.equal(bundle.reconciliation.rebuildPresenceDocuments, 1);
    assert.equal(bundle.legacyConfig.documents, 1);
    assert.equal(bundle.legacyConfig.sha256.length, 1);
    assert.equal(bundle.legacyConfig.includedInActiveGreenState, false);
    assert.match(bundle.sourceDatabaseSha256, /^[0-9a-f]{64}$/);

    const serialized = JSON.stringify(bundle);
    assert.doesNotMatch(serialized, /Must Not Leak User/);
    assert.doesNotMatch(serialized, /Must Not Leak Presence/);
    assert.doesNotMatch(serialized, /must-not-leak/);
    assert.doesNotMatch(serialized, /secret-member/);
    assert.doesNotMatch(serialized, /private-0/);

    const transformed = transformBlueHearMeOutActivityRoom(bundle.activityRoom, 'tenant-a');
    assert.equal(transformed.roomId, 'discord-activity');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('bundle fails closed when a copied Blue database contains an unclassified collection', () => {
  const root = mkdtempSync(join(tmpdir(), 'hmo-blue-unknown-'));
  const path = join(root, 'app.db');
  try {
    seed(path);
    const db = new DatabaseSync(path);
    db.prepare('INSERT INTO docs(path,collection_path,doc_id,data) VALUES(?,?,?,?)').run('mystery/one', 'mystery', 'one', '{}');
    db.close();
    assert.throws(() => buildHearMeOutBlueMigrationBundle(path), /unclassified collections: mystery/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
