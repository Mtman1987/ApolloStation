import { DatabaseSync } from "node:sqlite";
import { createHmac, timingSafeEqual } from "node:crypto";

export interface DshSignalControlPayloadV1 {
  schemaVersion: 1;
  tenantId: string;
  dropId: string;
  channelId: string;
  messageId: string;
  expiresAt: number;
  requesterUserId?:string;
  requesterDiscordUserId?:string;
}

export interface DshSignalRemovalPrincipalV1 {
  tenantId: string;
  role: "guest" | "member" | "moderator" | "admin" | "owner";
  userId?:string;
  discordUserId?:string;
}

export interface DshSignalRemovalPortV1 {
  deleteMessage(tenantId: string, channelId: string, messageId: string): Promise<void>;
  removeDrop(tenantId: string, dropId: string): boolean | Promise<boolean>;
}

const MAX_TTL_SECONDS = 90 * 24 * 60 * 60;

/** Signed, credential-free control carried by the inline Signal trash link. */
export class DshSignalControlSigner {
  constructor(private readonly key: Uint8Array, private readonly now: () => number = () => Date.now()) {
    if (key.byteLength < 32) throw new Error("Signal control signing key must contain at least 32 bytes");
  }

  issue(input: Omit<DshSignalControlPayloadV1, "schemaVersion" | "expiresAt"> & { ttlSeconds?: number }): string {
    const ttl = Math.max(60, Math.min(MAX_TTL_SECONDS, Math.trunc(input.ttlSeconds ?? MAX_TTL_SECONDS)));
    const payload: DshSignalControlPayloadV1 = {
      schemaVersion: 1,
      tenantId: clean(input.tenantId, "tenantId"),
      dropId: clean(input.dropId, "dropId"),
      channelId: snowflake(input.channelId, "channelId"),
      messageId: snowflake(input.messageId, "messageId"),
      expiresAt: Math.floor(this.now() / 1_000) + ttl,
      ...(input.requesterUserId?{requesterUserId:clean(input.requesterUserId,"requesterUserId")}:{ }),
      ...(input.requesterDiscordUserId?{requesterDiscordUserId:snowflake(input.requesterDiscordUserId,"requesterDiscordUserId")}:{ }),
    };
    const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
    return `${encoded}.${this.sign(encoded)}`;
  }

  verify(token: string): DshSignalControlPayloadV1 | undefined {
    const [encoded, signature, extra] = String(token ?? "").split(".");
    if (!encoded || !signature || extra || !this.same(signature, this.sign(encoded))) return undefined;
    try {
      const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as DshSignalControlPayloadV1;
      if (payload.schemaVersion !== 1 || payload.expiresAt < Math.floor(this.now() / 1_000) || payload.expiresAt > Math.floor(this.now() / 1_000) + MAX_TTL_SECONDS + 300) return undefined;
      return { ...payload, tenantId: clean(payload.tenantId, "tenantId"), dropId: clean(payload.dropId, "dropId"), channelId: snowflake(payload.channelId, "channelId"), messageId: snowflake(payload.messageId, "messageId"), ...(payload.requesterUserId?{requesterUserId:clean(payload.requesterUserId,"requesterUserId")}:{ }), ...(payload.requesterDiscordUserId?{requesterDiscordUserId:snowflake(payload.requesterDiscordUserId,"requesterDiscordUserId")}:{ }) };
    } catch { return undefined; }
  }

  private sign(value: string) { return createHmac("sha256", this.key).update(value).digest("base64url"); }
  private same(left: string, right: string) {
    const a = Buffer.from(left), b = Buffer.from(right);
    return a.byteLength === b.byteLength && timingSafeEqual(a, b);
  }
}

export async function removeDshSignal(
  signer: DshSignalControlSigner,
  port: DshSignalRemovalPortV1,
  principal: DshSignalRemovalPrincipalV1,
  token: string,
) {
  const payload = signer.verify(token);
  if (!payload) throw new Error("Signal removal control is invalid or expired");
  if (principal.tenantId !== payload.tenantId) throw new Error("Signal removal control belongs to another tenant");
  const requester=Boolean((payload.requesterUserId&&principal.userId===payload.requesterUserId)||(payload.requesterDiscordUserId&&principal.discordUserId===payload.requesterDiscordUserId));
  if (principal.role !== "admin" && principal.role !== "owner" && !requester) throw new Error("Only the Signal requester or a DSH owner can remove this Signal");
  const removed = await port.removeDrop(payload.tenantId, payload.dropId);
  await port.deleteMessage(payload.tenantId, payload.channelId, payload.messageId);
  return { schemaVersion: 1 as const, removed, dropId: payload.dropId, messageId: payload.messageId };
}

export function dshSignalRemovalUrl(publicOrigin: string, token: string) {
  const origin = new URL(publicOrigin);
  if (origin.protocol !== "https:" || origin.username || origin.password || origin.pathname !== "/" || origin.search || origin.hash) throw new Error("DSH public origin must be a credential-free HTTPS origin");
  const url = new URL("/signal/remove", origin);
  url.searchParams.set("control", token);
  return url.toString();
}

function clean(value: string, name: string) { const result = String(value ?? "").trim(); if (!result || result.length > 300 || /[\r\n\0]/.test(result)) throw new Error(`Signal ${name} is invalid`); return result; }
function snowflake(value: string, name: string) { const result = String(value ?? "").trim(); if (!/^\d{5,30}$/.test(result)) throw new Error(`Signal ${name} is invalid`); return result; }

export interface DshSignalControlRecordV1 {
  schemaVersion:1;tenantId:string;dropId:string;guildId:string;channelId:string;messageId:string;
  requesterName:string;targetName:string;requesterUserId?:string;requesterDiscordUserId?:string;
  createdAt:string;suppressedAt?:string;
}
export class SqliteDshSignalControlStore {
  private readonly db:DatabaseSync;
  constructor(path:string){if(!path)throw new Error("Signal control database path is required");this.db=new DatabaseSync(path,{timeout:5000});this.db.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS dsh_signal_controls(tenant_id TEXT NOT NULL,drop_id TEXT NOT NULL,message_id TEXT NOT NULL,body TEXT NOT NULL,PRIMARY KEY(tenant_id,drop_id)) STRICT; CREATE INDEX IF NOT EXISTS dsh_signal_controls_message ON dsh_signal_controls(tenant_id,message_id);");}
  close(){this.db.close();}
  put(value:DshSignalControlRecordV1){const tenant=clean(value.tenantId,"tenantId"),drop=clean(value.dropId,"dropId"),guild=snowflake(value.guildId,"guildId"),channel=snowflake(value.channelId,"channelId"),message=snowflake(value.messageId,"messageId");const checked={...value,tenantId:tenant,dropId:drop,guildId:guild,channelId:channel,messageId:message,requesterName:clean(value.requesterName,"requesterName"),targetName:clean(value.targetName,"targetName"),createdAt:timestamp(value.createdAt)};this.db.prepare("INSERT INTO dsh_signal_controls(tenant_id,drop_id,message_id,body) VALUES(?,?,?,?) ON CONFLICT(tenant_id,drop_id) DO UPDATE SET message_id=excluded.message_id,body=excluded.body").run(tenant,drop,message,JSON.stringify(checked));return checked;}
  get(tenantId:string,dropId:string):DshSignalControlRecordV1|undefined{const row=this.db.prepare("SELECT body FROM dsh_signal_controls WHERE tenant_id=? AND drop_id=?").get(clean(tenantId,"tenantId"),clean(dropId,"dropId")) as {body:string}|undefined;return row?JSON.parse(row.body):undefined;}
  suppress(tenantId:string,dropId:string,at=new Date().toISOString()){const value=this.get(tenantId,dropId);if(!value)return false;if(value.suppressedAt)return false;const next={...value,suppressedAt:timestamp(at)};this.db.prepare("UPDATE dsh_signal_controls SET body=? WHERE tenant_id=? AND drop_id=?").run(JSON.stringify(next),tenantId,dropId);return true;}
}
function timestamp(value:string){const at=String(value??"");if(!Number.isFinite(Date.parse(at)))throw new Error("Signal timestamp is invalid");return new Date(Date.parse(at)).toISOString();}
