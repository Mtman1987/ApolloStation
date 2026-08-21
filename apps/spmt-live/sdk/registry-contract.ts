export const APP_REGISTRY_VERSION = 'app-registry.v1' as const;

export type AppCatalogStateV1 = 'approved';
export type AppRuntimeStateV1 = 'ready' | 'cold' | 'degraded' | 'unavailable' | 'unknown';
export type AppAccessStateV1 = 'installed' | 'disabled' | 'available';

export type AppRegistryFiltersV1 = {
  surface?: string;
  category?: string;
  parentAppId?: string;
  capability?: string;
};

export type AppRegistrySourceRecord = {
  id: string;
  name: string;
  description: string;
  status?: string;
  category?: string;
  parentAppId?: string | null;
  surfaces?: string[];
  permissions?: string[];
  installed?: boolean;
  enabled?: boolean;
  [key: string]: unknown;
};

export type AppRegistryEntryV1 = AppRegistrySourceRecord & {
  schemaVersion: 1;
  catalogState: AppCatalogStateV1;
  runtimeState: AppRuntimeStateV1;
  accessState: AppAccessStateV1;
  parentAppId: string | null;
  surfaces: string[];
  capabilities: string[];
};

export type AppRegistryV1 = {
  schemaVersion: 1;
  version: typeof APP_REGISTRY_VERSION;
  revision: string;
  generatedAt: string;
  filters: AppRegistryFiltersV1;
  apps: AppRegistryEntryV1[];
};
