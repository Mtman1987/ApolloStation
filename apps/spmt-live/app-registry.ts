import crypto from 'crypto';
import {
  APP_REGISTRY_VERSION,
  type AppAccessStateV1,
  type AppRegistryEntryV1,
  type AppRegistryFiltersV1,
  type AppRegistrySourceRecord,
  type AppRegistryV1,
  type AppRuntimeStateV1,
} from './sdk/registry-contract.js';

export type { AppRegistryFiltersV1, AppRegistryV1 } from './sdk/registry-contract.js';

function normalized(value: unknown) {
  return String(value || '').trim().toLowerCase();
}

function runtimeState(status: unknown): AppRuntimeStateV1 {
  const value = normalized(status);
  if (['connected', 'bridge-ready', 'ready', 'live', 'online'].includes(value)) return 'ready';
  if (['available', 'cold', 'idle', 'sleeping'].includes(value)) return 'cold';
  if (['adapter-needed', 'degraded', 'warning'].includes(value)) return 'degraded';
  if (['planned', 'disabled', 'unavailable', 'offline'].includes(value)) return 'unavailable';
  return 'unknown';
}

function accessState(app: AppRegistrySourceRecord): AppAccessStateV1 {
  if (!app.installed) return 'available';
  return app.enabled === false ? 'disabled' : 'installed';
}

export function toAppRegistryEntry(app: AppRegistrySourceRecord): AppRegistryEntryV1 {
  const permissions = Array.isArray(app.permissions) ? app.permissions.map(String) : [];
  const surfaces = Array.isArray(app.surfaces) && app.surfaces.length
    ? app.surfaces.map(String)
    : ['spacemountain', 'shipyard'];
  return {
    ...app,
    schemaVersion: 1,
    catalogState: 'approved',
    runtimeState: runtimeState(app.status),
    accessState: accessState(app),
    parentAppId: app.parentAppId ? String(app.parentAppId) : null,
    surfaces,
    capabilities: permissions,
  };
}

export function filterAppRegistry(entries: AppRegistryEntryV1[], filters: AppRegistryFiltersV1 = {}) {
  const surface = normalized(filters.surface);
  const category = normalized(filters.category);
  const parentAppId = normalized(filters.parentAppId);
  const capability = normalized(filters.capability);
  return entries.filter((app) => {
    if (surface && !app.surfaces.some((item) => normalized(item) === surface)) return false;
    if (category && normalized(app.category) !== category) return false;
    if (parentAppId && normalized(app.parentAppId) !== parentAppId) return false;
    if (capability && !app.capabilities.some((item) => normalized(item) === capability)) return false;
    return true;
  });
}

export function buildAppRegistry(
  apps: AppRegistrySourceRecord[],
  filters: AppRegistryFiltersV1 = {},
  generatedAt = new Date().toISOString(),
): AppRegistryV1 {
  const normalizedFilters = Object.fromEntries(
    Object.entries(filters).filter(([, value]) => String(value || '').trim()),
  ) as AppRegistryFiltersV1;
  const allEntries = apps.map(toAppRegistryEntry);
  const entries = filterAppRegistry(allEntries, normalizedFilters);
  const revision = crypto
    .createHash('sha256')
    .update(JSON.stringify({ version: APP_REGISTRY_VERSION, apps: allEntries }))
    .digest('hex')
    .slice(0, 20);
  return {
    schemaVersion: 1,
    version: APP_REGISTRY_VERSION,
    revision,
    generatedAt,
    filters: normalizedFilters,
    apps: entries,
  };
}
