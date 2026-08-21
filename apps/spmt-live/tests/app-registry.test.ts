import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildAppRegistry } from '../app-registry.js';

const apps = [
  {
    id: 'shell',
    name: 'Shell',
    description: 'Always-on front door.',
    status: 'connected',
    category: 'hub',
    permissions: ['apps:read'],
    installed: true,
    enabled: true,
  },
  {
    id: 'game-child',
    name: 'Game Child',
    description: 'Nested game module.',
    status: 'available',
    category: 'game',
    parentAppId: 'games',
    surfaces: ['spacemountain', 'overlay-bay'],
    permissions: ['events:write'],
    installed: false,
    enabled: false,
  },
];

test('registry separates catalog, runtime, and access state', () => {
  const registry = buildAppRegistry(apps, {}, '2026-08-21T00:00:00.000Z');
  assert.equal(registry.version, 'app-registry.v1');
  assert.equal(registry.apps[0].catalogState, 'approved');
  assert.equal(registry.apps[0].runtimeState, 'ready');
  assert.equal(registry.apps[0].accessState, 'installed');
  assert.equal(registry.apps[1].runtimeState, 'cold');
  assert.equal(registry.apps[1].accessState, 'available');
});

test('registry supports shared-surface and nested-module discovery', () => {
  const all = buildAppRegistry(apps);
  const surface = buildAppRegistry(apps, { surface: 'overlay-bay' });
  assert.deepEqual(surface.apps.map((app) => app.id), ['game-child']);
  const children = buildAppRegistry(apps, { parentAppId: 'games', capability: 'events:write' });
  assert.deepEqual(children.apps.map((app) => app.id), ['game-child']);
  assert.equal(surface.revision, all.revision, 'filters must not create a competing registry revision');
  assert.equal(children.revision, all.revision, 'nested views share the global registry revision');
});

test('registry revisions are deterministic and change with catalog data', () => {
  const first = buildAppRegistry(apps, {}, '2026-08-21T00:00:00.000Z');
  const later = buildAppRegistry(apps, {}, '2026-08-22T00:00:00.000Z');
  assert.equal(first.revision, later.revision);
  const changed = buildAppRegistry([{ ...apps[0], name: 'Renamed Shell' }, apps[1]]);
  assert.notEqual(first.revision, changed.revision);
});

test('API, SDK, CLI, MCP, and registry-change event expose one apps.list contract', () => {
  const server = fs.readFileSync(new URL('../server.ts', import.meta.url), 'utf8');
  const sdk = fs.readFileSync(new URL('../sdk/index.ts', import.meta.url), 'utf8');
  const cli = fs.readFileSync(new URL('../sdk/cli.mjs', import.meta.url), 'utf8');
  const legacyCatalog = JSON.parse(fs.readFileSync(new URL('../public/app-catalog.json', import.meta.url), 'utf8'));
  assert.match(server, /app\.get\('\/api\/apps', sendAppRegistry\)/);
  assert.match(server, /name: 'spmt\.apps\.list'/);
  assert.match(server, /type: 'app\.registry\.changed'/);
  assert.match(sdk, /list: \(filters: AppRegistryFiltersV1/);
  assert.match(cli, /spmt apps list/);
  assert.equal(legacyCatalog.registryUrl, '/api/apps');
  assert.equal('apps' in legacyCatalog, false, 'the compatibility file must not remain a competing registry');
});
