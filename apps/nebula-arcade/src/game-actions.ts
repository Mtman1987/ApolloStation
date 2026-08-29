import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { NEBULA_ARCADE_GAMES } from "./game-hub.js";
import { migrateLegacyNebulaArcadeStorage } from "./legacy-nebula-migration.js";

export interface NebulaGameActionV1 {
  id: string; tenantId: string; channel: string; gameId: string; actorId: string; username: string; displayName: string;
  action: string; args: string[]; message: string; occurredAt: string;
}
const GAME_IDS = new Set(NEBULA_ARCADE_GAMES.map((game) => game.id));

export class SqliteNebulaGameActionStore {
  private readonly db: DatabaseSync;
  constructor(path: string) {
    if (!path) throw new Error("Nebula game action database path is required");
    this.db = new DatabaseSync(path, { timeout: 5_000 });
    migrateLegacyNebulaArcadeStorage(this.db);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
      CREATE TABLE IF NOT EXISTS nebula_game_actions (
        tenant_id TEXT NOT NULL, action_id TEXT NOT NULL, channel TEXT NOT NULL, game_id TEXT NOT NULL,
        actor_id TEXT NOT NULL, username TEXT NOT NULL, display_name TEXT NOT NULL, action TEXT NOT NULL,
        args TEXT NOT NULL, message TEXT NOT NULL, occurred_at TEXT NOT NULL, PRIMARY KEY (tenant_id, action_id)
      ) STRICT;
      CREATE INDEX IF NOT EXISTS idx_nebula_game_actions_feed ON nebula_game_actions(tenant_id,channel,occurred_at);`);
  }
  close() { this.db.close(); }
  record(input: Omit<NebulaGameActionV1, "id"> & { id?: string }): NebulaGameActionV1 {
    const item: NebulaGameActionV1 = {
      id: cleanId(input.id ?? `game-action-${randomUUID()}`, "actionId"), tenantId: cleanId(input.tenantId, "tenantId"),
      channel: cleanChannel(input.channel), gameId: cleanGame(input.gameId), actorId: cleanText(input.actorId, 160),
      username: cleanText(input.username, 120).toLowerCase(), displayName: cleanText(input.displayName, 120),
      action: cleanText(input.action, 40).toLowerCase(), args: normalizeArgs(input.args),
      message: String(input.message ?? "").trim().slice(0, 500), occurredAt: cleanIso(input.occurredAt),
    };
    const existing = this.get(item.tenantId, item.id);
    if (existing) {
      if (JSON.stringify(existing) !== JSON.stringify(item)) throw new Error("Nebula action id was reused with different input");
      return existing;
    }
    this.db.prepare(`INSERT INTO nebula_game_actions(tenant_id,action_id,channel,game_id,actor_id,username,display_name,action,args,message,occurred_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)`)
      .run(item.tenantId,item.id,item.channel,item.gameId,item.actorId,item.username,item.displayName,item.action,JSON.stringify(item.args),item.message,item.occurredAt);
    this.db.prepare(`DELETE FROM nebula_game_actions WHERE tenant_id=? AND action_id NOT IN (SELECT action_id FROM nebula_game_actions WHERE tenant_id=? ORDER BY occurred_at DESC LIMIT 500)`)
      .run(item.tenantId,item.tenantId);
    return item;
  }
  get(tenantId: string, actionId: string): NebulaGameActionV1 | undefined {
    const row = this.db.prepare(`SELECT action_id,tenant_id,channel,game_id,actor_id,username,display_name,action,args,message,occurred_at FROM nebula_game_actions WHERE tenant_id=? AND action_id=?`).get(cleanId(tenantId,"tenantId"),cleanId(actionId,"actionId")) as ActionRow | undefined;
    return row ? fromRow(row) : undefined;
  }
  list(tenantId: string, input: { channel?: string; gameIds?: string[]; after?: string; limit?: number } = {}): NebulaGameActionV1[] {
    const tenant = cleanId(tenantId, "tenantId"), limit = Math.max(1, Math.min(250, Math.floor(Number(input.limit ?? 100))));
    const rows = this.db.prepare(`SELECT action_id,tenant_id,channel,game_id,actor_id,username,display_name,action,args,message,occurred_at FROM nebula_game_actions WHERE tenant_id=? ORDER BY occurred_at ASC`).all(tenant) as unknown as ActionRow[];
    const games = input.gameIds?.length ? new Set(input.gameIds.map(cleanGame)) : undefined, channel = input.channel ? cleanChannel(input.channel) : undefined;
    let items = rows.map(fromRow).filter((item) => (!channel || item.channel === channel) && (!games || games.has(item.gameId)));
    if (input.after) { const index = items.findIndex((item) => item.id === input.after); if (index >= 0) items = items.slice(index + 1); }
    return items.slice(-limit);
  }
}

export function validateNebulaGameAction(gameId: string, actionValue: string, argsValue: readonly string[] = []): { action: string; args: string[] } {
  const game = cleanGame(gameId), action = String(actionValue || "join").trim().toLowerCase(), args = normalizeArgs(argsValue), noArgs = args.length === 0;
  if (["join", "leave", "start", "stop"].includes(action) && noArgs) return { action, args };
  if (game === "tag" && ["tag", "pass", "score", "status"].includes(action)) return { action, args };
  if (game === "bingo" && action === "phrases" && noArgs) return { action, args };
  if (game === "bingo" && action === "claim" && args.length === 1 && /^([1-9]|1\d|2[0-5])$/.test(args[0]!)) return { action, args };
  if (game === "chaosmode" && ["explode", "glitch", "portal", "shake"].includes(action) && noArgs) return { action, args };
  if ((game === "chatwars" || game === "colorwars") && ["red", "blue", "green", "yellow"].includes(action) && noArgs) return { action, args };
  if (game === "dancingparade" && action === "dance" && noArgs) return { action, args };
  if (game === "emojitower" && action === "drop" && noArgs) return { action, args };
  if (game === "petrace" && ["dog", "cat", "rabbit", "turtle", "hamster"].includes(action) && noArgs) return { action, args };
  if (game === "pixelbattle" && action === "paint" && args.length === 3 && /^(red|blue|green|yellow|purple|orange|pink|white|black|cyan)$/.test(args[0]!) && /^\d{1,2}$/.test(args[1]!) && /^\d{1,2}$/.test(args[2]!)) return { action, args };
  if (game === "treasurehunt" && action === "dig" && args.length === 1 && /^[a-h][1-8]$/i.test(args[0]!)) return { action, args };
  throw new Error(`Unsupported ${game} action`);
}

interface ActionRow { action_id:string;tenant_id:string;channel:string;game_id:string;actor_id:string;username:string;display_name:string;action:string;args:string;message:string;occurred_at:string; }
function fromRow(row: ActionRow): NebulaGameActionV1 { return { id:row.action_id,tenantId:row.tenant_id,channel:row.channel,gameId:row.game_id,actorId:row.actor_id,username:row.username,displayName:row.display_name,action:row.action,args:normalizeArgs(JSON.parse(row.args) as string[]),message:row.message,occurredAt:row.occurred_at }; }
function cleanGame(value:string){const id=String(value??"").trim().toLowerCase();if(!GAME_IDS.has(id))throw new Error("Unknown Nebula game");return id;}
function cleanChannel(value:string){const result=String(value??"").trim().toLowerCase().replace(/^#/,"").slice(0,80);if(!result)throw new Error("Nebula channel is required");return result;}
function cleanId(value:string,name:string){const result=String(value??"").trim();if(!result||result.length>200||/[\r\n\0]/.test(result))throw new Error(`${name} is invalid`);return result;}
function cleanText(value:string,max:number){const result=String(value??"").trim().slice(0,max);if(!result||/[\r\n\0]/.test(result))throw new Error("Nebula action text is invalid");return result;}
function cleanIso(value:string){if(!Number.isFinite(Date.parse(value)))throw new Error("Nebula action timestamp is invalid");return value;}
function normalizeArgs(value:readonly string[]){if(!Array.isArray(value))return[];return value.map((item)=>String(item??"").trim().slice(0,80)).filter(Boolean).slice(0,8);}
