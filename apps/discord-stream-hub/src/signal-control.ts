import { createHmac, timingSafeEqual } from "node:crypto";

export interface DshSignalControlPayloadV1 {
  schemaVersion: 1;
  tenantId: string;
  dropId: string;
  channelId: string;
  messageId: string;
  expiresAt: number;
}

export interface DshSignalRemovalPrincipalV1 {
  tenantId: string;
  role: "guest" | "member" | "moderator" | "admin" | "owner";
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
      return { ...payload, tenantId: clean(payload.tenantId, "tenantId"), dropId: clean(payload.dropId, "dropId"), channelId: snowflake(payload.channelId, "channelId"), messageId: snowflake(payload.messageId, "messageId") };
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
  if (principal.role !== "admin" && principal.role !== "owner") throw new Error("Only a DSH admin or owner can remove a Signal shoutout");
  await port.deleteMessage(payload.tenantId, payload.channelId, payload.messageId);
  const removed = await port.removeDrop(payload.tenantId, payload.dropId);
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
