import { DatabaseSync } from "node:sqlite";
import { assertDeviceRelayCommandV1, type DeviceCommandCapabilityV1, type DeviceRelayCommandV1, type DeviceRelayReceiptV1 } from "@spmt/contracts";

export interface CompanionAuthorityPrincipalV1 { tenantId: string; appId: string; scopes: string[]; }
export interface CompanionDeviceV1 { schemaVersion: 1; tenantId: string; deviceId: string; name: string; capabilities: DeviceCommandCapabilityV1[]; pairedAt: string; revokedAt?: string; }
export interface CompanionLocalAdapterV1 { execute(command: DeviceRelayCommandV1): Promise<{ detail: string }>; }

const ACTION_CAPABILITY: Record<string, DeviceCommandCapabilityV1> = {
  "obs.scene.set": "obs.scene",
  "obs.stream.start": "obs.stream",
  "obs.stream.stop": "obs.stream",
  "overlay.window.open": "overlay.window",
  "overlay.window.close": "overlay.window",
  "media.play": "media.playback",
  "media.pause": "media.playback",
  "media.seek": "media.playback",
  "media.volume.set": "media.playback",
  "media.mute.set": "media.playback",
  "local.transcode.submit": "local.transcode",
};

export class SqliteCompanionDeviceRelay {
  private readonly db: DatabaseSync;
  constructor(path: string) {
    if (!path) throw new Error("Companion relay database path is required");
    this.db = new DatabaseSync(path, { timeout: 5_000 });
    this.db.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS companion_devices(tenant_id TEXT NOT NULL,device_id TEXT NOT NULL,body TEXT NOT NULL,PRIMARY KEY(tenant_id,device_id)) STRICT;
      CREATE TABLE IF NOT EXISTS companion_receipts(tenant_id TEXT NOT NULL,idempotency_key TEXT NOT NULL,body TEXT NOT NULL,PRIMARY KEY(tenant_id,idempotency_key)) STRICT;
      CREATE TABLE IF NOT EXISTS companion_attempts(tenant_id TEXT NOT NULL,idempotency_key TEXT NOT NULL,attempts INTEGER NOT NULL,last_error TEXT,updated_at TEXT NOT NULL,PRIMARY KEY(tenant_id,idempotency_key)) STRICT;
    `);
  }
  close(): void { this.db.close(); }

  pairDevice(principal: CompanionAuthorityPrincipalV1, input: { deviceId: string; name: string; capabilities: DeviceCommandCapabilityV1[]; pairedAt: string }): CompanionDeviceV1 {
    assertAuthority(principal, "devices:pair", "spmt");
    if (!input.deviceId || !input.name || !input.capabilities.length || !Number.isFinite(Date.parse(input.pairedAt))) throw new Error("Companion device registration is invalid");
    const device: CompanionDeviceV1 = { schemaVersion: 1, tenantId: principal.tenantId, deviceId: input.deviceId, name: input.name, capabilities: [...new Set(input.capabilities)], pairedAt: new Date(input.pairedAt).toISOString() };
    if (device.capabilities.some((value) => !Object.values(ACTION_CAPABILITY).includes(value))) throw new Error("Companion device capability is invalid");
    this.db.prepare("INSERT INTO companion_devices(tenant_id,device_id,body) VALUES(?,?,?) ON CONFLICT(tenant_id,device_id) DO UPDATE SET body=excluded.body").run(device.tenantId, device.deviceId, JSON.stringify(device));
    return device;
  }

  revokeDevice(principal: CompanionAuthorityPrincipalV1, deviceId: string, revokedAt: string): CompanionDeviceV1 {
    assertAuthority(principal, "devices:pair", "spmt");
    const device = this.getDevice(principal.tenantId, deviceId);
    if (!device) throw new Error("Companion device not found");
    const revoked = { ...device, revokedAt: new Date(revokedAt).toISOString() };
    this.db.prepare("UPDATE companion_devices SET body=? WHERE tenant_id=? AND device_id=?").run(JSON.stringify(revoked), principal.tenantId, deviceId);
    return revoked;
  }

  getDevice(tenantId: string, deviceId: string): CompanionDeviceV1 | undefined {
    const row = this.db.prepare("SELECT body FROM companion_devices WHERE tenant_id=? AND device_id=?").get(tenantId, deviceId) as { body: string } | undefined;
    return row ? JSON.parse(row.body) : undefined;
  }

  async execute(principal: CompanionAuthorityPrincipalV1, command: DeviceRelayCommandV1, adapter: CompanionLocalAdapterV1, now = new Date().toISOString()): Promise<DeviceRelayReceiptV1> {
    assertDeviceRelayCommandV1(command);
    assertAuthority(principal, "devices:command", command.sourceAppId);
    if (principal.tenantId !== command.tenantId) throw new Error("Companion command tenant mismatch");
    const replay = this.db.prepare("SELECT body FROM companion_receipts WHERE tenant_id=? AND idempotency_key=?").get(command.tenantId, command.idempotencyKey) as { body: string } | undefined;
    if (replay) return JSON.parse(replay.body);
    const device = this.getDevice(command.tenantId, command.targetDeviceId);
    const capability = ACTION_CAPABILITY[command.action];
    if (!device || device.revokedAt || !capability || capability !== command.capability || !device.capabilities.includes(command.capability)) return this.remember(command, "rejected", "Device is unpaired, revoked, or not granted this capability", now);
    validatePayload(command);
    try {
      const result = await adapter.execute(structuredClone(command));
      const receipt = this.remember(command, "completed", cleanDetail(result.detail), now);
      this.db.prepare("DELETE FROM companion_attempts WHERE tenant_id=? AND idempotency_key=?").run(command.tenantId, command.idempotencyKey);
      return receipt;
    } catch (error) {
      const detail = redactError(error);
      this.db.prepare("INSERT INTO companion_attempts(tenant_id,idempotency_key,attempts,last_error,updated_at) VALUES(?,?,1,?,?) ON CONFLICT(tenant_id,idempotency_key) DO UPDATE SET attempts=attempts+1,last_error=excluded.last_error,updated_at=excluded.updated_at").run(command.tenantId, command.idempotencyKey, detail, new Date(now).toISOString());
      return { schemaVersion: 1, tenantId: command.tenantId, commandId: command.commandId, targetDeviceId: command.targetDeviceId, status: "unavailable", detail, completedAt: new Date(now).toISOString() };
    }
  }

  attempts(tenantId: string, idempotencyKey: string): { attempts: number; lastError?: string } | undefined {
    return this.db.prepare("SELECT attempts,last_error AS lastError FROM companion_attempts WHERE tenant_id=? AND idempotency_key=?").get(tenantId, idempotencyKey) as { attempts: number; lastError?: string } | undefined;
  }

  private remember(command: DeviceRelayCommandV1, status: "completed" | "rejected", detail: string, now: string): DeviceRelayReceiptV1 {
    const receipt: DeviceRelayReceiptV1 = { schemaVersion: 1, tenantId: command.tenantId, commandId: command.commandId, targetDeviceId: command.targetDeviceId, status, detail, completedAt: new Date(now).toISOString() };
    this.db.prepare("INSERT INTO companion_receipts(tenant_id,idempotency_key,body) VALUES(?,?,?)").run(command.tenantId, command.idempotencyKey, JSON.stringify(receipt));
    return receipt;
  }
}

function validatePayload(command: DeviceRelayCommandV1): void {
  if (command.action === "media.volume.set") {
    const volume = Number(command.payload.volume);
    if (!Number.isFinite(volume) || volume < 0 || volume > 1) throw new Error("Companion volume must be from 0 through 1");
  }
  if (command.action === "media.mute.set" && typeof command.payload.muted !== "boolean") throw new Error("Companion muted must be boolean");
  if (command.action === "obs.scene.set" && (!String(command.payload.sceneName ?? "").trim() || String(command.payload.sceneName).length > 200)) throw new Error("Companion OBS scene name is invalid");
}
function assertAuthority(principal: CompanionAuthorityPrincipalV1, scope: string, appId: string): void { if (!principal.tenantId || principal.appId !== appId || !principal.scopes.includes(scope)) throw new Error("Companion device authority denied"); }
function cleanDetail(value: string): string { const result = String(value || "completed").replace(/(bearer|token|secret|password|authorization)\s*[:=]\s*\S+/gi, "$1=[redacted]"); return result.slice(0, 500); }
function redactError(error: unknown): string { return cleanDetail(error instanceof Error ? error.message : String(error)); }
