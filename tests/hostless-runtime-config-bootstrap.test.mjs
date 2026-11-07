import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const entry = new URL("../scripts/hostless/start-node.mjs", import.meta.url);

test("Hostless bootstrap starts Nebula with an empty connection registry before OAuth provisioning", () => {
  const directory = mkdtempSync(join(tmpdir(), "apollo-runtime-config-"));
  try {
    const dshPath = join(directory, "dsh", "runtime.json");
    const nebulaPath = join(directory, "nebula", "runtime.json");
    const result = spawnSync(process.execPath, [entry.pathname], {
      encoding: "utf8",
      env: {
        ...process.env,
        APOLLO_NODE_ROLE: "node2",
        DSH_RUNTIME_CONFIG_PATH: dshPath,
        SPMT_DSH_LIVE_RUNTIME_ENABLED: "1",
        NEBULA_ARCADE_RUNTIME_CONFIG_PATH: nebulaPath,
        NEBULA_ARCADE_PROVIDER_RUNTIME_ENABLED: "1",
      },
    });

    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.deepEqual(JSON.parse(readFileSync(nebulaPath, "utf8")), {
      schemaVersion: 1,
      revision: "hostless-chat-gateway-connection-registry-v2",
      tenants: [],
    });
    assert.deepEqual(JSON.parse(readFileSync(dshPath, "utf8")), {
      schemaVersion: 1,
      pollIntervalSeconds: 60,
      tenants: [],
    });
    assert.equal(statSync(dshPath).mode & 0o777, 0o600);
    assert.equal(statSync(nebulaPath).mode & 0o777, 0o600);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("Hostless bootstrap rejects malformed explicit runtime JSON instead of silently replacing it", () => {
  const directory = mkdtempSync(join(tmpdir(), "apollo-runtime-config-invalid-"));
  try {
    const dshPath = join(directory, "dsh.json");
    const result = spawnSync(process.execPath, [entry.pathname], {
      encoding: "utf8",
      env: {
        ...process.env,
        APOLLO_NODE_ROLE: "invalid-test-role",
        DSH_RUNTIME_CONFIG_PATH: dshPath,
        DSH_RUNTIME_CONFIG_JSON: "{not-json",
      },
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /DSH_RUNTIME_CONFIG_JSON must contain valid JSON/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("Hostless bootstrap derives Nebula config for every enabled tenant and provider connection", () => {
  const directory = mkdtempSync(join(tmpdir(), "apollo-runtime-config-multitenant-"));
  try {
    const nebulaPath = join(directory, "nebula", "runtime.json");
    const connections = [
      { schemaVersion: 1, tenantId: "tenant-a", provider: "twitch", connectionId: "twitch-a", channelId: "owner_a", desired: true },
      { schemaVersion: 1, tenantId: "tenant-a", provider: "discord", connectionId: "discord-a", channelId: "guild-a", desired: true },
      { schemaVersion: 1, tenantId: "tenant-b", provider: "twitch", connectionId: "twitch-b", channelId: "owner_b", desired: true },
      { schemaVersion: 1, tenantId: "tenant-c", provider: "kick", connectionId: "kick-c", channelId: "owner_c", desired: false },
    ];
    const result = spawnSync(process.execPath, [entry.pathname], {
      encoding: "utf8",
      env: {
        ...process.env,
        APOLLO_NODE_ROLE: "invalid-test-role",
        NEBULA_ARCADE_PROVIDER_RUNTIME_ENABLED: "1",
        NEBULA_ARCADE_RUNTIME_CONFIG_PATH: nebulaPath,
        CHAT_GATEWAY_CONNECTIONS: JSON.stringify(connections),
      },
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /APOLLO_NODE_ROLE must be node1 or node2/);
    const config = JSON.parse(readFileSync(nebulaPath, "utf8"));
    assert.equal(config.tenants.length, 2);
    assert.deepEqual(config.tenants.map(t => t.tenantId), ["tenant-a", "tenant-b"]);
    assert.deepEqual(config.tenants[0].channels.map(c => c.provider), ["twitch", "discord"]);
    assert.equal(config.tenants[0].channels[0].stateChannelId, "owner_a");
    assert.equal(config.tenants[1].channels[0].stateChannelId, "owner_b");
    assert.equal(statSync(nebulaPath).mode & 0o777, 0o600);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("Node 2 empty Nebula registry exports separate GitHub environment lines", () => {
  const workflow = readFileSync(new URL("../.github/workflows/hostless-node2-fast-deploy.yml", import.meta.url), "utf8");
  assert.match(workflow, /APOLLO_NODE2_NEBULA_ENABLED=1\\nNEBULA_ARCADE_RUNTIME_CONFIG_JSON=/);
  assert.doesNotMatch(workflow, /APOLLO_NODE2_NEBULA_ENABLED=1\\\\nNEBULA_ARCADE_RUNTIME_CONFIG_JSON=/);
});

test("Hostless Node 1 and Node 2 receive the same canonical Turso database URL", () => {
  const workflow = readFileSync(new URL("../.github/workflows/hostless-three-node-deploy.yml", import.meta.url), "utf8");
  assert.match(workflow, /SHARED_TURSO_DATABASE_URL: \$\{\{ secrets\.TURSO_DATABASE_URL \|\| vars\.TURSO_DATABASE_URL \}\}/);
  assert.match(workflow, /APOLLO_RUNTIME_NODE1_TURSO_DATABASE_URL: \$\{\{ secrets\.TURSO_DATABASE_URL \|\| vars\.TURSO_DATABASE_URL \}\}/);
  assert.match(workflow, /APOLLO_RUNTIME_NODE2_TURSO_DATABASE_URL: \$\{\{ secrets\.TURSO_DATABASE_URL \|\| vars\.TURSO_DATABASE_URL \}\}/);
  assert.doesNotMatch(workflow, /secrets\.NODE[12]_TURSO_DATABASE_URL/);
  assert.match(workflow, /APOLLO_RUNTIME_NODE2_NEBULA_ARCADE_TURSO_DATABASE_URL: \$\{\{ secrets\.TURSO_DATABASE_URL \|\| vars\.TURSO_DATABASE_URL \}\}/);
  assert.match(workflow, /APOLLO_RUNTIME_NODE2_NEBULA_ARCADE_GAME_RUNTIME_TURSO_DATABASE_URL: \$\{\{ secrets\.TURSO_DATABASE_URL \|\| vars\.TURSO_DATABASE_URL \}\}/);
  assert.match(workflow, /APOLLO_RUNTIME_NODE2_STREAMWEAVER_TURSO_DATABASE_URL: \$\{\{ secrets\.TURSO_DATABASE_URL \|\| vars\.TURSO_DATABASE_URL \}\}/);
  assert.match(workflow, /APOLLO_RUNTIME_NODE1_DSH_TURSO_DATABASE_URL: \$\{\{ secrets\.TURSO_DATABASE_URL \|\| vars\.TURSO_DATABASE_URL \}\}/);
  assert.match(workflow, /APOLLO_RUNTIME_NODE1_DSH_TURSO_AUTH_TOKEN: \$\{\{ secrets\.NODE1_TURSO_AUTH_TOKEN \}\}/);
});
