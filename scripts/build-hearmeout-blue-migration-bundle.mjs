#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const ACTIVITY_ROOM_ID = 'discord-activity';
const KNOWN_COLLECTIONS = new Set(['config', 'rooms', 'rooms/discord-activity/users', 'users']);

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function count(db, collectionPath) {
  return Number(db.prepare('SELECT COUNT(*) AS count FROM docs WHERE collection_path=?').get(collectionPath)?.count || 0);
}

export function buildHearMeOutBlueMigrationBundle(databasePath) {
  const source = resolve(String(databasePath || '').trim());
  if (!databasePath) throw new Error('A copied Blue HearMeOut SQLite path is required.');

  const db = new DatabaseSync(source, { readOnly: true });
  try {
    const integrityRows = db.prepare('PRAGMA quick_check;').all();
    const integrity = String(integrityRows?.[0]?.quick_check ?? Object.values(integrityRows?.[0] || {})[0] ?? 'unknown');
    if (integrity !== 'ok') throw new Error(`Blue HearMeOut database quick_check failed: ${integrity}`);

    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map((row) => String(row.name));
    if (!tables.includes('docs')) throw new Error('Blue HearMeOut database does not contain the expected docs table.');

    const collections = db.prepare('SELECT DISTINCT collection_path FROM docs ORDER BY collection_path').all().map((row) => String(row.collection_path));
    const unknown = collections.filter((value) => !KNOWN_COLLECTIONS.has(value));
    if (unknown.length) throw new Error(`Blue HearMeOut database contains unclassified collections: ${unknown.join(', ')}`);

    const roomRows = db.prepare('SELECT collection_path,doc_id,data FROM docs WHERE collection_path=? ORDER BY doc_id').all('rooms');
    if (roomRows.length !== 1 || String(roomRows[0]?.doc_id) !== ACTIVITY_ROOM_ID) {
      throw new Error('Blue HearMeOut room set is not the single canonical Discord Activity room observed during inventory.');
    }

    let roomData;
    try { roomData = JSON.parse(String(roomRows[0].data)); }
    catch { throw new Error('Blue Discord Activity room JSON is invalid.'); }

    const configRows = db.prepare('SELECT data FROM docs WHERE collection_path=? ORDER BY doc_id').all('config');
    const configDigests = configRows.map((row) => sha256(Buffer.from(String(row.data), 'utf8'))).sort();
    const totalDocuments = Number(db.prepare('SELECT COUNT(*) AS count FROM docs').get()?.count || 0);

    return {
      schemaVersion: 1,
      sourceKind: 'hearmeout-blue-doc-store',
      sourceDatabaseSha256: sha256(readFileSync(source)),
      integrity: 'ok',
      sourceDocuments: totalDocuments,
      activityRoom: {
        collectionPath: 'rooms',
        documentId: ACTIVITY_ROOM_ID,
        data: roomData,
      },
      reconciliation: {
        spmtUserDocuments: count(db, 'users'),
        rebuildPresenceDocuments: count(db, 'rooms/discord-activity/users'),
      },
      legacyConfig: {
        documents: configRows.length,
        sha256: configDigests,
        includedInActiveGreenState: false,
      },
      excludedFromBundle: ['users.data', 'rooms/discord-activity/users.data', 'config.data'],
    };
  } finally {
    db.close();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const source = process.argv[2];
  const output = process.argv[3];
  if (!source || !output) {
    process.stderr.write('Usage: node scripts/build-hearmeout-blue-migration-bundle.mjs <copied-app.db> <output.json>\n');
    process.exitCode = 1;
  } else {
    try {
      const bundle = buildHearMeOutBlueMigrationBundle(source);
      writeFileSync(resolve(output), `${JSON.stringify(bundle, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
      process.stdout.write(`${JSON.stringify({
        ok: true,
        output: resolve(output),
        sourceDocuments: bundle.sourceDocuments,
        spmtUserDocuments: bundle.reconciliation.spmtUserDocuments,
        rebuildPresenceDocuments: bundle.reconciliation.rebuildPresenceDocuments,
        legacyConfigDocuments: bundle.legacyConfig.documents,
        sourceDatabaseSha256: bundle.sourceDatabaseSha256,
      }, null, 2)}\n`);
    } catch (error) {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    }
  }
}
