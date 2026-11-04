#!/usr/bin/env node

import { DatabaseSync } from 'node:sqlite';
import { resolve } from 'node:path';

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}

function integer(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : 0;
}

export function inspectHearMeOutBlueDatabase(databasePath) {
  const source = resolve(String(databasePath || '').trim());
  if (!databasePath) throw new Error('A Blue HearMeOut SQLite path is required.');

  const db = new DatabaseSync(source, { readOnly: true });
  try {
    const integrityRows = db.prepare('PRAGMA quick_check;').all();
    const integrity = String(integrityRows?.[0]?.quick_check ?? Object.values(integrityRows?.[0] || {})[0] ?? 'unknown');
    if (integrity !== 'ok') throw new Error(`Blue HearMeOut database quick_check failed: ${integrity}`);

    const schema = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map((row) => String(row.name));
    if (!schema.includes('docs')) throw new Error('Blue HearMeOut database does not contain the expected docs table.');

    const totalDocuments = integer(db.prepare('SELECT COUNT(*) AS count FROM docs').get()?.count);
    const topLevelRows = db.prepare(`
      SELECT
        CASE
          WHEN instr(collection_path, '/') > 0 THEN substr(collection_path, 1, instr(collection_path, '/') - 1)
          ELSE collection_path
        END AS collection,
        COUNT(*) AS count,
        SUM(CASE WHEN instr(collection_path, '/') > 0 THEN 1 ELSE 0 END) AS nested_count
      FROM docs
      GROUP BY collection
      ORDER BY collection
    `).all();

    const collections = topLevelRows.map((row) => ({
      collection: String(row.collection || ''),
      documents: integer(row.count),
      nestedDocuments: integer(row.nested_count),
    })).filter((row) => row.collection);

    return {
      schemaVersion: 1,
      sourceKind: 'hearmeout-blue-doc-store',
      readOnly: true,
      integrity,
      tableCount: schema.length,
      tables: schema,
      totalDocuments,
      collections,
      containsDocumentBodies: false,
      migrationMode: 'inspect-only',
    };
  } finally {
    db.close();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const path = process.argv[2];
  if (!path) {
    fail('Usage: node scripts/inspect-hearmeout-blue-db.mjs <path-to-blue-app.db>');
  } else {
    try {
      process.stdout.write(`${JSON.stringify(inspectHearMeOutBlueDatabase(path), null, 2)}\n`);
    } catch (error) {
      fail(error instanceof Error ? error.message : String(error));
    }
  }
}
