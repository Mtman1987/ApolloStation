import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export interface HearMeOutLiveKitGrantV1 {
  tenantId: string;
  roomId: string;
  roomName: string;
  participantIdentity: string;
  participantName?: string;
  ttlSeconds: number;
  canPublish: boolean;
  canSubscribe: boolean;
  canPublishData?: boolean;
  canUpdateOwnMetadata?: boolean;
  metadata?: Record<string, unknown>;
}

export interface HearMeOutLiveKitTokenV1 {
  token: string;
  expiresAt: string;
  roomName: string;
  participantIdentity: string;
}

/**
 * Turns the already-authorized Green room grant into a deployable LiveKit JWT.
 * The signer has no room-policy logic of its own: callers must obtain the grant
 * from HearMeOut room authorization first. API credentials never leave this
 * server-side boundary.
 */
export class HearMeOutLiveKitSigner {
  constructor(
    private readonly apiKey: string,
    private readonly apiSecret: string,
    private readonly nowSeconds: () => number = () => Math.floor(Date.now() / 1000),
    private readonly idFactory: () => string = () => randomBytes(16).toString("hex"),
  ) {
    if (!validCredential(apiKey) || !validCredential(apiSecret)) throw new Error("LiveKit API key and secret are required");
  }

  sign(grant: HearMeOutLiveKitGrantV1): HearMeOutLiveKitTokenV1 {
    validateGrant(grant);
    const now = this.nowSeconds();
    const exp = now + grant.ttlSeconds;
    const header = { alg: "HS256", typ: "JWT" };
    const payload = {
      iss: this.apiKey,
      sub: grant.participantIdentity,
      iat: now,
      nbf: now - 5,
      exp,
      jti: this.idFactory(),
      ...(grant.participantName ? { name: grant.participantName } : {}),
      metadata: JSON.stringify({
        schemaVersion: 1,
        tenantId: grant.tenantId,
        roomId: grant.roomId,
        ...(grant.metadata ?? {}),
      }),
      video: {
        roomJoin: true,
        room: grant.roomName,
        canPublish: grant.canPublish,
        canSubscribe: grant.canSubscribe,
        canPublishData: grant.canPublishData ?? grant.canPublish,
        canUpdateOwnMetadata: grant.canUpdateOwnMetadata ?? false,
      },
    };
    const encodedHeader = encodeJson(header);
    const encodedPayload = encodeJson(payload);
    const signingInput = `${encodedHeader}.${encodedPayload}`;
    const signature = base64url(createHmac("sha256", this.apiSecret).update(signingInput).digest());
    return {
      token: `${signingInput}.${signature}`,
      expiresAt: new Date(exp * 1000).toISOString(),
      roomName: grant.roomName,
      participantIdentity: grant.participantIdentity,
    };
  }
}

/** Test/diagnostic decoder. It verifies HS256 before returning claims. */
export function verifyHearMeOutLiveKitToken(token: string, apiSecret: string) {
  const [header, payload, signature, extra] = token.split(".");
  if (!header || !payload || !signature || extra !== undefined) throw new Error("Invalid LiveKit JWT");
  const expected = createHmac("sha256", apiSecret).update(`${header}.${payload}`).digest();
  const actual = Buffer.from(signature.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(signature.length / 4) * 4, "="), "base64");
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new Error("Invalid LiveKit JWT signature");
  return JSON.parse(Buffer.from(payload.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(payload.length / 4) * 4, "="), "base64").toString("utf8")) as Record<string, unknown>;
}

function validateGrant(grant: HearMeOutLiveKitGrantV1) {
  for (const [name, value] of [["tenantId", grant.tenantId], ["roomId", grant.roomId], ["roomName", grant.roomName], ["participantIdentity", grant.participantIdentity]] as const) {
    if (!value || value.trim() !== value || value.length > 200) throw new Error(`${name} is invalid`);
  }
  if (!Number.isSafeInteger(grant.ttlSeconds) || grant.ttlSeconds < 30 || grant.ttlSeconds > 900) throw new Error("LiveKit grant ttlSeconds must be between 30 and 900");
}
function validCredential(value: string) { return typeof value === "string" && value.trim() === value && value.length >= 8 && value.length <= 512; }
function encodeJson(value: unknown) { return base64url(Buffer.from(JSON.stringify(value), "utf8")); }
function base64url(value: Buffer) { return value.toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_"); }
