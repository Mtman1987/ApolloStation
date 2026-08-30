import { createHmac, timingSafeEqual } from "node:crypto";
import type { SpmtRtcRelayParticipantRoleV1 } from "./spmt-rtc-relay.js";

export interface SpmtRtcCanaryTicketInputV1 {
  tenantId: string;
  roomId: string;
  participantId: string;
  role: SpmtRtcRelayParticipantRoleV1;
  expiresAt: number;
}

/** Short-lived proof for the fenced pre-production RTC canary only. */
export function createSpmtRtcCanaryTicketV1(secret: string, input: SpmtRtcCanaryTicketInputV1) {
  const normalized = normalize(secret, input);
  const signature = sign(secret, normalized);
  return `spmt-rtc-auth.${normalized.expiresAt}.${signature}`;
}

export function verifySpmtRtcCanaryTicketV1(secret: string, input: SpmtRtcCanaryTicketInputV1, ticket: string, now = Date.now()) {
  const normalized = normalize(secret, input);
  if (!Number.isFinite(now)) return false;
  const match = /^spmt-rtc-auth\.(\d{10,16})\.([A-Za-z0-9_-]{32,128})$/.exec(String(ticket ?? ""));
  if (!match || Number(match[1]) !== normalized.expiresAt) return false;
  if (normalized.expiresAt < now - 5_000 || normalized.expiresAt > now + 120_000) return false;
  const expected = Buffer.from(sign(secret, normalized));
  const supplied = Buffer.from(match[2]);
  return expected.byteLength === supplied.byteLength && timingSafeEqual(expected, supplied);
}

function sign(secret: string, input: SpmtRtcCanaryTicketInputV1) {
  return createHmac("sha256", secret).update([input.tenantId, input.roomId, input.participantId, input.role, String(input.expiresAt)].join("\n")).digest("base64url");
}
function normalize(secret: string, input: SpmtRtcCanaryTicketInputV1): SpmtRtcCanaryTicketInputV1 {
  if (typeof secret !== "string" || secret.length < 32 || /[\r\n\0]/.test(secret)) throw new Error("SPMT RTC canary secret must be 32+ characters");
  const tenantId = clean(input?.tenantId, "tenantId"), roomId = clean(input?.roomId, "roomId"), participantId = clean(input?.participantId, "participantId");
  const role = input?.role;
  if (role !== "browser" && role !== "discord-bridge" && role !== "persona" && role !== "music") throw new Error("SPMT RTC canary role is invalid");
  const expiresAt = Math.trunc(Number(input?.expiresAt));
  if (!Number.isSafeInteger(expiresAt) || expiresAt < 1_000_000_000_000) throw new Error("SPMT RTC canary expiry is invalid");
  return { tenantId, roomId, participantId, role, expiresAt };
}
function clean(value: unknown, name: string) { const text = String(value ?? "").trim(); if (!text || text.length > 160 || /[\r\n\0]/.test(text)) throw new Error(`${name} is invalid`); return text; }
