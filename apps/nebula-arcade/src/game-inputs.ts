import { DatabaseSync } from "node:sqlite";
import type { NormalizedChatMessageV1 } from "@spmt/contracts";

export interface NebulaGameInputV1 { id: string; channelId: string; message: string; username: string; provider: string; roles: string[]; gameIds: string[]; occurredAt: string; }
/** Durable provider-neutral input feed shared by game widgets and room previews. */
export class SqliteNebulaGameInputStore {
  private readonly db: DatabaseSync;
  constructor(path: string) {
    this.db = new DatabaseSync(path, { timeout: 5000 });
    this.db.exec("CREATE TABLE IF NOT EXISTS nebula_game_inputs (sequence INTEGER PRIMARY KEY AUTOINCREMENT,tenant_id TEXT NOT NULL,input_id TEXT NOT NULL,channel_id TEXT NOT NULL,body TEXT NOT NULL,UNIQUE(tenant_id,input_id)); CREATE INDEX IF NOT EXISTS nebula_game_inputs_channel ON nebula_game_inputs(tenant_id,channel_id,sequence)");
  }
  append(message: NormalizedChatMessageV1, gameIds: string[]) {
    const input: NebulaGameInputV1 = { id: `${message.provider}:${message.connectionId}:${message.messageId}`, channelId: message.channelId, message: message.text, username: message.actor.displayName || message.actor.username, provider: message.provider, roles: message.actor.roles, gameIds, occurredAt: message.occurredAt };
    this.db.prepare("INSERT OR IGNORE INTO nebula_game_inputs(tenant_id,input_id,channel_id,body) VALUES(?,?,?,?)").run(message.tenantId, input.id, message.channelId, JSON.stringify(input));
    this.db.prepare("DELETE FROM nebula_game_inputs WHERE tenant_id=? AND channel_id=? AND sequence NOT IN(SELECT sequence FROM nebula_game_inputs WHERE tenant_id=? AND channel_id=? ORDER BY sequence DESC LIMIT 500)").run(message.tenantId,message.channelId,message.tenantId,message.channelId);
  }
  list(tenantId: string, channelId?: string): NebulaGameInputV1[] {
    const rows = channelId ? this.db.prepare("SELECT body FROM nebula_game_inputs WHERE tenant_id=? AND channel_id=? ORDER BY sequence DESC LIMIT 200").all(tenantId, channelId) : this.db.prepare("SELECT body FROM nebula_game_inputs WHERE tenant_id=? ORDER BY sequence DESC LIMIT 200").all(tenantId);
    return (rows as { body: string }[]).reverse().map(row => JSON.parse(row.body));
  }
  close() { this.db.close(); }
}
