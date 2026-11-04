import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inspectHearMeOutBlueDatabase } from '../scripts/inspect-hearmeout-blue-db.mjs';

test('HearMeOut Blue inspector reports only collection-level migration metadata', () => {
  const root = mkdtempSync(join(tmpdir(), 'hmo-blue-inspect-'));
  const path = join(root, 'app.db');
  try {
    const db = new DatabaseSync(path);
    db.exec(`
      CREATE TABLE docs (
        path TEXT PRIMARY KEY,
        collection_path TEXT NOT NULL,
        doc_id TEXT NOT NULL,
        data TEXT NOT NULL
      );
      CREATE INDEX idx_collection ON docs(collection_path);
    `);
    const insert = db.prepare('INSERT INTO docs(path,collection_path,doc_id,data) VALUES(?,?,?,?)');
    insert.run('rooms/private-room-id', 'rooms', 'private-room-id', JSON.stringify({ name: 'Do Not Expose Room Name', ownerId: 'secret-user' }));
    insert.run('rooms/private-room-id/users/private-user', 'rooms/private-room-id/users', 'private-user', JSON.stringify({ displayName: 'Do Not Expose User' }));
    insert.run('users/private-user', 'users', 'private-user', JSON.stringify({ token: 'do-not-expose-token' }));
    db.close();

    const report = inspectHearMeOutBlueDatabase(path);
    assert.equal(report.readOnly, true);
    assert.equal(report.integrity, 'ok');
    assert.equal(report.totalDocuments, 3);
    assert.deepEqual(report.collections, [
      { collection: 'rooms', documents: 2, nestedDocuments: 1 },
      { collection: 'users', documents: 1, nestedDocuments: 0 },
    ]);
    assert.equal(report.containsDocumentBodies, false);

    const serialized = JSON.stringify(report);
    assert.doesNotMatch(serialized, /private-room-id/);
    assert.doesNotMatch(serialized, /private-user/);
    assert.doesNotMatch(serialized, /Do Not Expose/);
    assert.doesNotMatch(serialized, /do-not-expose-token/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
