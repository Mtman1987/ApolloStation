import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const entry = new URL("../scripts/hostless/start-node.mjs", import.meta.url);

test("Hostless bootstrap writes safe empty owner-only DSH and Nebula configs when JSON payloads are absent", () => {
  const directory = mkdtempSync(join(tmpdir(), "apollo-runtime-config-"));
  try {
    const dshPath = join(directory, "dsh", "runtime.json");
    const nebulaPath = join(directory, "nebula", "runtime.json");
    const result = spawnSync(process.execPath, [entry.pathname], {
      encoding: "utf8",
      env: {
        ...process.env,
        APOLLO_NODE_ROLE: "invalid-test-role",
        DSH_RUNTIME_CONFIG_PATH: dshPath,
        SPMT_DSH_LIVE_RUNTIME_ENABLED: "1",
        NEBULA_ARCADE_RUNTIME_CONFIG_PATH: nebulaPath,
        NEBULA_ARCADE_PROVIDER_RUNTIME_ENABLED: "1",
      },
    });

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /APOLLO_NODE_ROLE must be node1 or node2/);
    assert.deepEqual(JSON.parse(readFileSync(dshPath, "utf8")), {
      schemaVersion: 1,
      pollIntervalSeconds: 60,
      tenants: [],
    });
    assert.deepEqual(JSON.parse(readFileSync(nebulaPath, "utf8")), {
      schemaVersion: 1,
      revision: "hostless-chat-gateway-connection-registry-v1",
      tenants: [],
    });
    assert.equal(statSync(dshPath).mode & 0o777, 0o600);
    assert.equal(statSync(nebulaPath).mode & 0o777, 0o600);
    assert.match(result.stderr, /zero configured Twitch channels|zero tenants|zero provisioned tenants/i);
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
