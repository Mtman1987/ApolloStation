import { createHash } from "node:crypto";

/** The browser transport and execution worker share one tenant-scoped room. */
export function hearMeOutProviderRoomName(tenantId: string, roomId: string): string {
  for (const value of [tenantId, roomId]) {
    if (!value || value.trim() !== value || value.length > 160 || /[\r\n\0]/.test(value)) throw new Error("HearMeOut room identity is invalid");
  }
  return `hmo_${createHash("sha256").update(JSON.stringify([tenantId, roomId])).digest("hex")}`;
}
