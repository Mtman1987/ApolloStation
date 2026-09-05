import type { AppSettingsDefinitionV1, AppSettingsDocumentV1, AppSettingsPatchV1 } from "@spmt/contracts";
import { AppSettingsService, SqliteAppPrivateDatabase, type AppPrivateDatasetManifestV1 } from "@spmt/app-foundation";

export const DSH_TENANT_SETTINGS_V1: AppSettingsDefinitionV1 = {
  schemaVersion: 1, appId: "discord-stream-hub", settingsVersion: 1, subject: "tenant",
  fields: [
    { key: "captainMinimumDays", label: "Captain days per month", description: "Minimum selected duty days per crew member; zero shows counts only.", type: "number", sensitive: false, defaultValue: 0, minimum: 0, maximum: 31 },
    { key: "spotlightChannelId", label: "Spotlight channel", description: "Discord channel that receives community spotlight announcements.", type: "string", sensitive: false, defaultValue: "" },
    { key: "signalChannelId", label: "Signal channel", description: "Discord channel that receives Signal Seeker discoveries.", type: "string", sensitive: false, defaultValue: "" },
    { key: "gifStorageChannelId", label: "GIF storage channel", description: "Discord channel used for app-owned rendered GIF storage.", type: "string", sensitive: false, defaultValue: "" },
    { key: "groupChannels", label: "Group channels", description: "JSON object mapping canonical shoutout-group slugs to Discord channel IDs.", type: "string", sensitive: false, defaultValue: "{}" },
    { key: "pollIntervalSeconds", label: "Provider poll interval", description: "Interval for provider presence polling.", type: "number", sensitive: false, required: true, defaultValue: 60, minimum: 15, maximum: 900 },
    { key: "spotlightEnabled", label: "Community spotlight", description: "Enables the scheduled community spotlight workflow.", type: "boolean", sensitive: false, required: true, defaultValue: true },
    { key: "signalSeekerEnabled", label: "Signal Seeker", description: "Enables external signal discovery and Discord delivery.", type: "boolean", sensitive: false, required: true, defaultValue: true },
  ],
};

export const DSH_TENANT_SETTINGS_DATASET_V1: AppPrivateDatasetManifestV1 = { schemaVersion: 1, appId: "discord-stream-hub", dataset: "tenant-settings", classification: "private-authority", owner: "discord-stream-hub", retention: "Until the tenant removes Discord Stream Hub or replaces its settings.", maximumBytes: 16 * 1_024 * 1_024, recovery: "Checkpoint the DSH private database and verify the settings revision and SQLite integrity after restore." };

export interface DshTenantSettingsV1 { schemaVersion: 1; tenantId: string; captainMinimumDays: number; spotlightChannelId?: string; signalChannelId?: string; gifStorageChannelId?: string; groupChannels: Record<string, string>; pollIntervalSeconds: number; spotlightEnabled: boolean; signalSeekerEnabled: boolean; revision: number; }

export class DshTenantSettingsStore {
  private readonly database: SqliteAppPrivateDatabase;
  private readonly settings: AppSettingsService;
  constructor(path: string, now: () => string = () => new Date().toISOString()) { this.database = new SqliteAppPrivateDatabase(path, DSH_TENANT_SETTINGS_DATASET_V1, [], now); this.settings = new AppSettingsService(DSH_TENANT_SETTINGS_V1, this.database, undefined, now); }
  close() { this.database.close(); }
  checkpoint() { return this.database.checkpoint(); }
  readDocument(tenantId: string): AppSettingsDocumentV1 { return this.settings.read(tenantId, tenantId); }
  patch(tenantId: string, patch: AppSettingsPatchV1): DshTenantSettingsV1 { if (patch.values?.groupChannels !== undefined && patch.values.groupChannels !== null) parseGroupChannels(patch.values.groupChannels); return this.value(tenantId, this.settings.patch(tenantId, tenantId, patch)); }
  read(tenantId: string): DshTenantSettingsV1 { return this.value(tenantId, this.readDocument(tenantId)); }
  private value(tenantId: string, document: AppSettingsDocumentV1): DshTenantSettingsV1 { const values = document.values; return { schemaVersion: 1, tenantId, captainMinimumDays: boundedInteger(values.captainMinimumDays, 0, 31, "captain minimum"), ...optionalChannel("spotlightChannelId", values.spotlightChannelId), ...optionalChannel("signalChannelId", values.signalChannelId), ...optionalChannel("gifStorageChannelId", values.gifStorageChannelId), groupChannels: parseGroupChannels(values.groupChannels), pollIntervalSeconds: boundedInteger(values.pollIntervalSeconds, 15, 900, "poll interval"), spotlightEnabled: booleanValue(values.spotlightEnabled, "spotlightEnabled"), signalSeekerEnabled: booleanValue(values.signalSeekerEnabled, "signalSeekerEnabled"), revision: document.revision }; }
}

function optionalChannel<K extends "spotlightChannelId" | "signalChannelId" | "gifStorageChannelId">(key: K, value: unknown): Partial<Pick<DshTenantSettingsV1, K>> { if (value === "" || value === undefined) return {}; if (typeof value !== "string" || !/^\d{5,30}$/.test(value)) throw new Error(`DSH ${key} is invalid`); return { [key]: value } as Partial<Pick<DshTenantSettingsV1, K>>; }
function parseGroupChannels(input: unknown): Record<string, string> { if (typeof input !== "string" || input.length > 4_000) throw new Error("DSH group channel settings are invalid"); let value: unknown; try { value = JSON.parse(input); } catch { throw new Error("DSH group channel settings must be valid JSON"); } if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("DSH group channel settings must be an object"); const output: Record<string, string> = {}; for (const [group, channelId] of Object.entries(value as Record<string, unknown>)) { if (!/^[a-z0-9-]{1,80}$/.test(group) || typeof channelId !== "string" || !/^\d{5,30}$/.test(channelId)) throw new Error("DSH group channel mapping is invalid"); output[group] = channelId; } return output; }
function boundedInteger(value: unknown, minimum: number, maximum: number, name: string) { if (typeof value !== "number" || !Number.isSafeInteger(value) || value < minimum || value > maximum) throw new Error(`DSH ${name} is invalid`); return value; }
function booleanValue(value: unknown, name: string) { if (typeof value !== "boolean") throw new Error(`DSH ${name} is invalid`); return value; }
