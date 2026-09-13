import { DSH_MEMBER_GROUPS, type DshMemberGroupV1 } from "./live-monitor.js";
import type { AppSettingsDefinitionV1, AppSettingsDocumentV1, AppSettingsPatchV1 } from "@spmt/contracts";
import { AppSettingsService, SqliteAppPrivateDatabase, type AppPrivateDatasetManifestV1 } from "@spmt/app-foundation";
import { dshEmbedTemplateOverrides, type DshEmbedTemplates } from './shoutout-presentation.js';

export const DSH_TENANT_SETTINGS_V1: AppSettingsDefinitionV1 = {
  schemaVersion: 1, appId: "discord-stream-hub", settingsVersion: 1, subject: "tenant",
  fields: [
    { key: "roleMappings", label: "Discord role groups", description: "Server and role IDs mapped to existing DSH member groups.", type: "string", sensitive: false, defaultValue: "{}" },
    { key: "captainMinimumDays", label: "Captain days per month", description: "Minimum selected duty days per crew member; zero shows counts only.", type: "number", sensitive: false, defaultValue: 0, minimum: 0, maximum: 31 },
    { key: "spotlightChannelId", label: "Spotlight channel", description: "Discord channel that receives community spotlight announcements.", type: "string", sensitive: false, defaultValue: "" },
    { key: "signalChannelId", label: "Signal channel", description: "Discord channel that receives Signal Seeker discoveries.", type: "string", sensitive: false, defaultValue: "" },
    { key: "gifStorageChannelId", label: "GIF storage channel", description: "Discord channel used for app-owned rendered GIF storage.", type: "string", sensitive: false, defaultValue: "" },
    { key: "groupChannels", label: "Group channels", description: "JSON object mapping canonical shoutout-group slugs to Discord channel IDs.", type: "string", sensitive: false, defaultValue: "{}" },
    { key: "embedTemplates", label: "Shoutout templates", description: "Crew, partner and community template overrides.", type: "string", sensitive: false, defaultValue: "{}" },
    { key: "pollIntervalSeconds", label: "Provider poll interval", description: "Interval for provider presence polling.", type: "number", sensitive: false, required: true, defaultValue: 60, minimum: 15, maximum: 3600 },
    { key: "spotlightEnabled", label: "Community spotlight", description: "Enables the scheduled community spotlight workflow.", type: "boolean", sensitive: false, required: true, defaultValue: true },
    { key: "signalSeekerEnabled", label: "Signal Seeker", description: "Enables external signal discovery and Discord delivery.", type: "boolean", sensitive: false, required: true, defaultValue: true },
  ],
};

export const DSH_TENANT_SETTINGS_DATASET_V1: AppPrivateDatasetManifestV1 = { schemaVersion: 1, appId: "discord-stream-hub", dataset: "tenant-settings", classification: "private-authority", owner: "discord-stream-hub", retention: "Until the tenant removes Discord Stream Hub or replaces its settings.", maximumBytes: 16 * 1_024 * 1_024, recovery: "Checkpoint the DSH private database and verify the settings revision and SQLite integrity after restore." };

export interface DshTenantSettingsV1 { schemaVersion: 1; tenantId: string; roleMappings: Record<string, Record<string, DshMemberGroupV1>>; captainMinimumDays: number; spotlightChannelId?: string; signalChannelId?: string; gifStorageChannelId?: string; groupChannels: Record<string, string>; embedTemplates?: DshEmbedTemplates; pollIntervalSeconds: number; spotlightEnabled: boolean; signalSeekerEnabled: boolean; revision: number; }

export class DshTenantSettingsStore {
  private readonly database: SqliteAppPrivateDatabase;
  private readonly settings: AppSettingsService;
  constructor(path: string, now: () => string = () => new Date().toISOString()) { this.database = new SqliteAppPrivateDatabase(path, DSH_TENANT_SETTINGS_DATASET_V1, [], now); this.settings = new AppSettingsService(DSH_TENANT_SETTINGS_V1, this.database, undefined, now); }
  close() { this.database.close(); }
  checkpoint() { return this.database.checkpoint(); }
  readDocument(tenantId: string): AppSettingsDocumentV1 { return this.settings.read(tenantId, tenantId); }
  patch(tenantId: string, patch: AppSettingsPatchV1): DshTenantSettingsV1 { return this.database.transaction(() => this.value(tenantId, this.settings.patch(tenantId, tenantId, patch))); }
  read(tenantId: string): DshTenantSettingsV1 { return this.value(tenantId, this.readDocument(tenantId)); }
  private value(tenantId: string, document: AppSettingsDocumentV1): DshTenantSettingsV1 { const values = document.values; const templates = parseTemplates(values.embedTemplates); return { schemaVersion: 1, tenantId, roleMappings: parseRoleMappings(values.roleMappings), captainMinimumDays: boundedInteger(values.captainMinimumDays, 0, 31, "captain minimum"), ...optionalChannel("spotlightChannelId", values.spotlightChannelId), ...optionalChannel("signalChannelId", values.signalChannelId), ...optionalChannel("gifStorageChannelId", values.gifStorageChannelId), groupChannels: parseGroupChannels(values.groupChannels), ...(templates ? { embedTemplates: templates } : {}), pollIntervalSeconds: boundedInteger(values.pollIntervalSeconds, 15, 3600, "poll interval"), spotlightEnabled: booleanValue(values.spotlightEnabled, "spotlightEnabled"), signalSeekerEnabled: booleanValue(values.signalSeekerEnabled, "signalSeekerEnabled"), revision: document.revision }; }
}

function parseTemplates(value: unknown) { if (value === undefined || value === '{}') return undefined; if (typeof value !== 'string') throw new Error('Shoutout templates must be JSON'); let parsed: unknown; try { parsed = JSON.parse(value); } catch { throw new Error('Shoutout templates must be valid JSON'); } return dshEmbedTemplateOverrides(parsed); }

function optionalChannel<K extends "spotlightChannelId" | "signalChannelId" | "gifStorageChannelId">(key: K, value: unknown): Partial<Pick<DshTenantSettingsV1, K>> { if (value === "" || value === undefined) return {}; if (typeof value !== "string" || !/^\d{5,30}$/.test(value)) throw new Error(`DSH ${key} is invalid`); return { [key]: value } as Partial<Pick<DshTenantSettingsV1, K>>; }
function parseGroupChannels(input: unknown): Record<string, string> { if (typeof input !== "string" || input.length > 4_000) throw new Error("DSH group channel settings are invalid"); let value: unknown; try { value = JSON.parse(input); } catch { throw new Error("DSH group channel settings must be valid JSON"); } if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("DSH group channel settings must be an object"); const output: Record<string, string> = {}; for (const [group, channelId] of Object.entries(value as Record<string, unknown>)) { if (!/^[a-z0-9-]{1,80}$/.test(group) || typeof channelId !== "string" || !/^\d{5,30}$/.test(channelId)) throw new Error("DSH group channel mapping is invalid"); output[group] = channelId; } return output; }
function boundedInteger(value: unknown, minimum: number, maximum: number, name: string) { if (typeof value !== "number" || !Number.isSafeInteger(value) || value < minimum || value > maximum) throw new Error(`DSH ${name} is invalid`); return value; }
function booleanValue(value: unknown, name: string) { if (typeof value !== "boolean") throw new Error(`DSH ${name} is invalid`); return value; }

function parseRoleMappings(input: unknown): Record<string, Record<string, DshMemberGroupV1>> {
  if (input === undefined) return {};
  if (typeof input !== "string" || input.length > 64000) throw Error("Invalid Discord role mappings");
  let value: unknown; try { value = JSON.parse(input); } catch { throw Error("Invalid Discord role mappings"); }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw Error("Invalid Discord role mappings");
  const result: Record<string, Record<string, DshMemberGroupV1>> = {};
  for (const [guild, roles] of Object.entries(value)) {
    if (!/^\d{5,30}$/.test(guild) || !roles || typeof roles !== "object" || Array.isArray(roles)) throw Error("Invalid Discord server role mappings");
    result[guild] = {};
    for (const [role, group] of Object.entries(roles)) {
      if (!/^\d{5,30}$/.test(role) || !DSH_MEMBER_GROUPS.includes(group as DshMemberGroupV1)) throw Error("Choose an existing DSH member group");
      result[guild][role] = group as DshMemberGroupV1;
    }
  }
  return result;
}
