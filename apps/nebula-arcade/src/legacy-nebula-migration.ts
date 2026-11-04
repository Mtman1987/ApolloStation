import type { DatabaseSync } from "node:sqlite";

const LEGACY_GAME_ID = ["chat", "tag"].join("-");
const LEGACY_TABLE_PREFIX = ["chat", "tag"].join("_");
const LEGACY_EVENT_PREFIX = ["nebula", "chat", "tag"].join(".");
const LEGACY_OUTBOX_PREFIX = ["chat", "tag", "outbox:"].join("-");
const LEGACY_DISPLAY_NAME = ["Chat", "Tag"].join(" ");

export function canonicalNebulaGameId(value: unknown): string {
  const normalized = String(value ?? "").trim().toLowerCase();
  return normalized === LEGACY_GAME_ID ? "tag" : normalized;
}

/**
 * One-way compatibility for databases created before Nebula Arcade became the
 * sole app owner. Legacy identifiers are accepted only while upgrading stored
 * data and are never returned by current APIs, manifests, workers, or routes.
 */
export function migrateLegacyNebulaArcadeStorage(db: DatabaseSync): void {
  const tables = [
    { suffix: "state", columns: "tenant_id,revision,updated_at,body" },
    { suffix: "commands", columns: "tenant_id,command_id,occurred_at,result" },
    { suffix: "outbox", columns: "id,tenant_id,command_id,created_at,attempts,last_error,result" },
    { suffix: "migrations", columns: "tenant_id,migration_id,imported_at" },
    { suffix: "channels", columns: "tenant_id,channel_id,overlay_mode,opted_out,updated_at" },
    { suffix: "support_tickets", columns: "ticket_id,tenant_id,channel_id,requester_user_id,requester_username,note,status,created_at,resolved_at" },
    { suffix: "overlay_messages", columns: "sequence,tenant_id,channel_id,code,text,created_at" },
  ] as const;

  db.exec("BEGIN IMMEDIATE");
  try {
    for (const table of tables) {
      const legacyName = `${LEGACY_TABLE_PREFIX}_${table.suffix}`;
      const canonicalName = `nebula_tag_${table.suffix}`;
      if (!tableExists(db, legacyName)) continue;
      if (!tableExists(db, canonicalName)) {
        db.exec(`ALTER TABLE ${quoteIdentifier(legacyName)} RENAME TO ${quoteIdentifier(canonicalName)}`);
      } else {
        db.exec(`INSERT OR IGNORE INTO ${quoteIdentifier(canonicalName)}(${table.columns}) SELECT ${table.columns} FROM ${quoteIdentifier(legacyName)}`);
        db.exec(`DROP TABLE ${quoteIdentifier(legacyName)}`);
      }
    }
    canonicalizeStoredPayloads(db);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function canonicalizeStoredPayloads(db: DatabaseSync): void {
  const replacements = [
    [`${LEGACY_EVENT_PREFIX}.`, "nebula.arcade.tag."],
    [`${LEGACY_GAME_ID}.`, "nebula-arcade."],
    [LEGACY_DISPLAY_NAME, "Nebula Arcade tag game"],
  ] as const;
  for (const [table, column] of [["nebula_tag_state", "body"], ["nebula_tag_commands", "result"], ["nebula_tag_outbox", "result"]] as const) {
    if (!tableExists(db, table)) continue;
    for (const [legacy, canonical] of replacements) {
      db.prepare(`UPDATE ${quoteIdentifier(table)} SET ${quoteIdentifier(column)}=replace(${quoteIdentifier(column)},?,?) WHERE instr(${quoteIdentifier(column)},?)>0`).run(legacy, canonical, legacy);
    }
  }
  if (tableExists(db, "nebula_tag_outbox")) {
    db.prepare("UPDATE nebula_tag_outbox SET id=replace(id,?,?) WHERE instr(id,?)=1").run(LEGACY_OUTBOX_PREFIX, "nebula-arcade:tag-outbox:", LEGACY_OUTBOX_PREFIX);
  }
  if (tableExists(db, "nebula_game_runtime")) {
    db.prepare("UPDATE nebula_game_runtime SET body=replace(body,?,?) WHERE instr(body,?)>0").run(`\"${LEGACY_GAME_ID}\"`, '"tag"', `\"${LEGACY_GAME_ID}\"`);
  }
  if (tableExists(db, "nebula_game_mixes")) {
    db.prepare("UPDATE nebula_game_mixes SET active_game_id=? WHERE active_game_id=?").run("tag", LEGACY_GAME_ID);
    db.prepare("UPDATE nebula_game_mixes SET layers=replace(layers,?,?) WHERE instr(layers,?)>0").run(`\"${LEGACY_GAME_ID}\"`, '"tag"', `\"${LEGACY_GAME_ID}\"`);
  }
  if (tableExists(db, "nebula_overlay_scenes")) {
    db.prepare("UPDATE nebula_overlay_scenes SET layers=replace(layers,?,?) WHERE instr(layers,?)>0").run(`\"${LEGACY_GAME_ID}\"`, '"tag"', `\"${LEGACY_GAME_ID}\"`);
  }
  if (tableExists(db, "nebula_game_actions")) {
    db.prepare("UPDATE nebula_game_actions SET game_id=? WHERE game_id=?").run("tag", LEGACY_GAME_ID);
  }
}

function tableExists(db: DatabaseSync, name: string): boolean {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name));
}

function quoteIdentifier(value: string): string {
  if (!/^[a-z0-9_]+$/.test(value)) throw new Error("Legacy Nebula Arcade table name is invalid");
  return `"${value}"`;
}
