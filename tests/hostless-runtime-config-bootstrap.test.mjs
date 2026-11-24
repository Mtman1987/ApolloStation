import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { resolveNebulaServerTarget } from "../scripts/hostless/nebula-runtime-config.mjs";
import { optionalWorkerEnabled } from "../scripts/hostless/worker-flags.mjs";

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
      revision: "hostless-chat-gateway-connection-registry-v3",
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
  assert.match(workflow, /APOLLO_NODE2_NEBULA_ENABLED=1\\n/);
  assert.match(workflow, /NEBULA_ARCADE_RUNTIME_CONFIG_JSON=\\$\\{JSON\\.stringify\\(config\\)\\}\\nNEBULA_ARCADE_RUNTIME_CONFIG_PATH=/);
  assert.doesNotMatch(workflow, /APOLLO_NODE2_NEBULA_ENABLED=1\\\\nNEBULA_ARCADE_RUNTIME_CONFIG_JSON=/);
});

test("Hostless Node 2 discovers provider connections from SPMT instead of an Actions registry secret", () => {
  const release = readFileSync(new URL("../.github/workflows/hostless-three-node-deploy.yml", import.meta.url), "utf8");
  assert.match(release, /SPMT_ORIGIN: "https:\/\/apollo-node-1\.hostless\.app"/);
  assert.match(release, /CHAT_GATEWAY_WORKER_CREDENTIAL: \$\{\{ secrets\.CHAT_GATEWAY_WORKER_CREDENTIAL \}\}/);
  for (const path of ["../.github/workflows/hostless-three-node-deploy.yml", "../.github/workflows/hostless-node2-fast-deploy.yml"]) {
    const workflow = readFileSync(new URL(path, import.meta.url), "utf8");
    assert.doesNotMatch(workflow, /secrets\.CHAT_GATEWAY_CONNECTIONS/);
    assert.doesNotMatch(workflow, /APOLLO_RUNTIME_NODE2_CHAT_GATEWAY_CONNECTIONS:/);
  }
});
test("Hostless release refuses deployment until every recovered JSON source document is staged", () => {
  const workflow = readFileSync(new URL("../.github/workflows/hostless-three-node-deploy.yml", import.meta.url), "utf8");
  assert.match(workflow, /Recovered-data staging table is missing/);
  assert.match(workflow, /expectedBySource = \{ "nebula-legacy-global": 16, streamweaver: 5732 \}/);
  assert.match(workflow, /stagedDocuments !== 5748/);
  assert.match(workflow, /bySource\.streamweaver !== expectedBySource\.streamweaver/);
});
test("Hostless Node 1 and Node 2 verify the same canonical Turso database URL", () => {
  const workflow = readFileSync(new URL("../.github/workflows/hostless-three-node-deploy.yml", import.meta.url), "utf8");
  assert.match(workflow, /SHARED_TURSO_DATABASE_URL: \$\{\{ secrets\.TURSO_DATABASE_URL \|\| vars\.TURSO_DATABASE_URL/);
  assert.match(workflow, /\["node1", process\.env\.SHARED_TURSO_DATABASE_URL, process\.env\.NODE1_TURSO_AUTH_TOKEN\]/);
  assert.match(workflow, /\["node2", process\.env\.SHARED_TURSO_DATABASE_URL, process\.env\.NODE2_TURSO_AUTH_TOKEN\]/);
  assert.match(workflow, /normalizeTursoUrl\(pairs\[0\]\[1\]\) !== normalizeTursoUrl\(pairs\[1\]\[1\]\)/);
  assert.doesNotMatch(workflow, /secrets\.NODE[12]_TURSO_DATABASE_URL/);
  // Runtime database values remain Hostless-authoritative; this workflow only
  // validates the shared endpoint and does not overwrite node environment values.
  assert.doesNotMatch(workflow, /APOLLO_RUNTIME_NODE[12]_TURSO_DATABASE_URL:/);
});


test("production app launch defaults to SpaceMountain while the SPMT bridge stays on its identity origin", () => {
  const launcher = readFileSync(new URL("../apps/spmt-service/src/provider-identity-start.ts", import.meta.url), "utf8");
  const service = readFileSync(new URL("../apps/spmt-service/src/index.ts", import.meta.url), "utf8");
  const browser = readFileSync(new URL("../apps/spacemountain-web/src/client.ts", import.meta.url), "utf8");
  assert.ok(launcher.includes('SPMT_APP_LAUNCH_BASE_URL ?? "https://spacemountain.live"'));
  assert.ok(service.includes('SPMT_APP_LAUNCH_BASE_URL ?? "https://spacemountain.live"'));
  assert.ok(browser.includes('"/v1/auth/session/bridge-login"'));
  assert.ok(!browser.includes('"/v1/auth/session/claim"'));
  assert.ok(!browser.includes("api/oauth/authorize"));
  assert.ok(!browser.includes("beginSpmtSso"));
  assert.ok(!browser.includes("canonicalOAuthRedirectUri"));
  assert.ok(browser.includes('window.open("https://spmt.live/api/session/bridge"'));
  assert.ok(browser.includes('"/v1/auth/session/bridge-login"'));
  assert.ok(!launcher.includes("apollo-node-1.hostless.app"));
});

test("Node 1 always pins the OAuth callback base to its stable Hostless origin", () => {
  const script = readFileSync(new URL("../scripts/hostless/ensure-node-app.mjs", import.meta.url), "utf8");
  assert.match(script, /nodeKey === "node1"[\s\S]*?SPMT_PUBLIC_URL=https:\/\/apollo-node-1\.hostless\.app/);
  assert.match(script, /custom domain is an additional alias, not the callback origin/);
});

test("Hostless recovery release keeps a twenty-minute wait, serializes nodes, and probes the live recovery routes safely", () => {
  const script = readFileSync(new URL("../scripts/hostless/ensure-node-app.mjs", import.meta.url), "utf8");
  const release = readFileSync(new URL("../.github/workflows/hostless-three-node-deploy.yml", import.meta.url), "utf8");
  const diagnostics = readFileSync(new URL("../.github/workflows/hostless-runtime-log-diagnostics.yml", import.meta.url), "utf8");

  assert.ok(script.includes('"deploy", "status", String(deploymentId), "--json", "--wait", "--timeout", "1200"'));
  assert.ok(script.includes("timeout: 1230 * 1000,"));
  assert.ok(script.includes('event?.type === "deployment"'));
  assert.ok(script.includes("isHostlessDeploymentSuccessful(finalStatus)"));
  assert.ok(!script.includes("const deadline = Date.now() + 10 * 60 * 1000;"));
  assert.ok(release.includes("timeout-minutes: 22"));
  assert.ok(release.includes("max-parallel: 1"));
  assert.ok(release.includes("fail-fast: true"));
  assert.ok(diagnostics.includes("apollo-recovery-start"));
  assert.ok(diagnostics.includes("/v1/auth/linked-provider-recovery/start?provider=$provider"));
  assert.ok(diagnostics.includes("callbackHost="));
  assert.ok(diagnostics.includes("cookieNames="));
  assert.ok(diagnostics.includes("Recovery password endpoint without ticket"));
});

test("Hostless deploy uses a focused Node 1 and Node 2 build graph", () => {
  const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  const hostless = readFileSync(new URL("../hostless.yaml", import.meta.url), "utf8");
  const build = packageJson.scripts["build:hostless"];
  assert.match(build, /^tsc -b /);
  for (const app of ["apps/spmt-service", "apps/spacemountain-web", "apps/chat-gateway", "apps/streamweaver", "apps/discord-stream-hub", "apps/nebula-arcade"]) {
    assert.ok(build.includes(app), "Hostless build must include " + app);
  }
  assert.match(build, /scripts\/build-rtc-browser\.mjs$/);
  assert.match(hostless, /npm ci --prefer-offline --no-audit --no-fund && npm run build:hostless/);
  const workflow = readFileSync(new URL("../.github/workflows/hostless-three-node-deploy.yml", import.meta.url), "utf8");
  assert.match(workflow, /Build focused Node 1 and Node 2 Hostless runtime[\s\S]*?run: npm run build:hostless/);
  assert.match(workflow, /\[node1-only\]/);
  assert.match(workflow, /Node 1-only deployment requested/);
});

test("Hostless deployment orchestrator passes Node syntax validation", () => {
  const script = new URL("../scripts/hostless/ensure-node-app.mjs", import.meta.url);
  const result = spawnSync(process.execPath, ["--check", script.pathname], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});


test("Node 2 fast deploy copies the canonical Discord bot token into the Chat Gateway runtime", () => {
  const workflow = readFileSync(new URL("../.github/workflows/hostless-node2-fast-deploy.yml", import.meta.url), "utf8");
  assert.match(workflow, /APOLLO_RUNTIME_NODE2_DISCORD_BOT_TOKEN: \$\{\{ secrets\.DISCORD_BOT_TOKEN \}\}/);
});


test("Node 2 fast deploy persists the mapped Discord bot token to Hostless", () => {
  const workflow = readFileSync(new URL("../.github/workflows/hostless-node2-fast-deploy.yml", import.meta.url), "utf8");
  assert.match(workflow, /APOLLO_RUNTIME_NODE2_DISCORD_BOT_TOKEN:.*secrets\.DISCORD_BOT_TOKEN/);
  assert.match(workflow, /APOLLO_SYNC_RUNTIME_SECRETS: "1"/);
});


test("Nebula public front door starts on the existing system tenant/channel before OAuth discovery", () => {
  assert.deepEqual(
    resolveNebulaServerTarget({ schemaVersion: 1, tenants: [] }, "spacemountainlive", "mtman1987"),
    { tenantId: "spacemountainlive", channelId: "mtman1987" },
  );
});

test("Nebula public front door prefers the discovered tenant and Twitch channel", () => {
  assert.deepEqual(
    resolveNebulaServerTarget({
      schemaVersion: 1,
      tenants: [
        { tenantId: "spacemountainlive", channels: [
          { provider: "twitch", connectionId: "twitch-live", channelId: "mtman1987" },
        ] },
      ],
    }, "spacemountainlive", "mtman1987"),
    { tenantId: "spacemountainlive", channelId: "mtman1987" },
  );
});

test("Nebula public front door does not guess when no tenant or channel fallback exists", () => {
  assert.equal(resolveNebulaServerTarget({ schemaVersion: 1, tenants: [] }, "", ""), undefined);
});


test("Node 1 disables optional Stellar Chat when its existing worker credential is absent", () => {
  assert.equal(optionalWorkerEnabled("1", undefined), false);
  assert.equal(optionalWorkerEnabled("1", "   "), false);
  assert.equal(optionalWorkerEnabled("1", "existing-worker-credential"), true);
  assert.equal(optionalWorkerEnabled("", "existing-worker-credential"), false);

  const startNode = readFileSync(new URL("../scripts/hostless/start-node.mjs", import.meta.url), "utf8");
  assert.match(startNode, /SPMT_STELLAR_CHAT_ENABLED:\s*stellarChatEnabled\s*\?\s*"1"\s*:\s*""/);
  assert.match(startNode, /Optional Stellar Chat disabled because STELLAR_WORKER_CREDENTIAL is not configured/);

  const release = readFileSync(new URL("../.github/workflows/hostless-three-node-deploy.yml", import.meta.url), "utf8");
  assert.match(release, /APOLLO_RUNTIME_NODE1_SPMT_STELLAR_CHAT_ENABLED: \$\{\{ matrix\.node == 'node1' && secrets\.STELLAR_WORKER_CREDENTIAL && '1' \|\| '' \}\}/);
});
