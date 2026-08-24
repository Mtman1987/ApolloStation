import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { commlinkCatalogRegistration } from "../apps/commlink/dist/index.js";
import { companionCatalogRegistration } from "../apps/companion/dist/index.js";
import { discordStreamHubCatalogRegistration } from "../apps/discord-stream-hub/dist/index.js";
import { hearMeOutCatalogRegistration } from "../apps/hearmeout/dist/index.js";
import { missionControlCatalogRegistration } from "../apps/mission-control/dist/index.js";
import { mountainViewCatalogRegistration } from "../apps/mountainview/dist/index.js";
import { nebulaArcadeCatalogRegistration } from "../apps/nebula-arcade/dist/index.js";
import { stellarCoreCatalogRegistration } from "../apps/stellar-core/dist/index.js";
import { streamweaverCatalogRegistration } from "../apps/streamweaver/dist/index.js";
import { createIntegratedSpaceMountainWebHost } from "../apps/spacemountain-web/dist/integrated-server.js";
import { FIRST_PARTY_APP_CSS, FIRST_PARTY_APP_SURFACES } from "../apps/spacemountain-web/dist/first-party-app-surfaces.js";

const origin = "https://test-green.sprites.app";
const registrations = [
  commlinkCatalogRegistration(origin),
  stellarCoreCatalogRegistration(origin),
  missionControlCatalogRegistration(origin),
  discordStreamHubCatalogRegistration(origin),
  streamweaverCatalogRegistration(origin),
  hearMeOutCatalogRegistration(origin),
  mountainViewCatalogRegistration(origin),
  companionCatalogRegistration(origin),
  nebulaArcadeCatalogRegistration(origin),
];

const expectedIds = ["commlink", "companion", "discord-stream-hub", "hearmeout", "mission-control", "mountainview", "nebula-arcade", "stellar-core", "streamweaver"];

test("the current first-party catalog contains every app and gives Workspace a stable embed launch", () => {
  assert.deepEqual(registrations.map((item) => item.appId).sort(), expectedIds);
  for (const registration of registrations) {
    const url = new URL(registration.launchUrl);
    assert.equal(url.origin, origin);
    assert.equal(url.pathname, `/apps/${registration.appId}`);
    assert.equal(url.searchParams.get("surface"), "workspace");
    assert.equal(registration.surfaces.includes("shell"), true, `${registration.appId} must be launchable inside the SpaceMountain shell`);
  }
});

test("every newly ingested app owns a frameable shared-theme surface", async () => {
  const host = createIntegratedSpaceMountainWebHost({ spmtOrigin: "http://127.0.0.1:65534", host: "127.0.0.1", port: 0, buildSha: "app-ingestion-test" });
  try {
    await host.listen();
    const address = host.server.address();
    assert.ok(address && typeof address !== "string");
    const base = `http://127.0.0.1:${address.port}`;
    assert.equal((await fetch(`${base}/assets/web/first-party-apps.css`)).status, 200);
    assert.equal((await fetch(`${base}/assets/web/first-party-apps.js`)).status, 200);
    for (const [appId, descriptor] of Object.entries(FIRST_PARTY_APP_SURFACES)) {
      const response = await fetch(`${base}/apps/${appId}?surface=shell`);
      assert.equal(response.status, 200, appId);
      assert.equal(response.headers.get("x-frame-options"), "SAMEORIGIN");
      assert.match(response.headers.get("content-security-policy") ?? "", /frame-ancestors 'self'/);
      const html = await response.text();
      assert.match(html, new RegExp(`data-app="${appId}"`));
      assert.match(html, /data-surface="shell"/);
      assert.match(html, new RegExp(descriptor.shortName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    }
  } finally {
    await host.close();
  }
});

test("existing shell-rendered apps become real same-origin Workspace embeds instead of blocked frames", async () => {
  const host = createIntegratedSpaceMountainWebHost({ spmtOrigin: "http://127.0.0.1:65534", host: "127.0.0.1", port: 0, buildSha: "workspace-embed-test" });
  try {
    await host.listen();
    const address = host.server.address();
    assert.ok(address && typeof address !== "string");
    const base = `http://127.0.0.1:${address.port}`;
    for (const appId of ["commlink", "stellar-core", "mission-control"]) {
      const response = await fetch(`${base}/apps/${appId}?surface=workspace`);
      assert.equal(response.status, 200, appId);
      assert.equal(response.headers.get("x-frame-options"), "SAMEORIGIN");
      assert.match(response.headers.get("content-security-policy") ?? "", /frame-ancestors 'self'/);
      assert.match(await response.text(), /data-spmt-workspace-embed/);
    }
  } finally {
    await host.close();
  }
});

test("embedded app homes stay inside the shared viewport and release promotion selects the full current catalog", () => {
  assert.match(FIRST_PARTY_APP_CSS, /data-surface="shell"\],body\[data-surface="workspace"\]\{height:100dvh;min-height:0;overflow:hidden\}/);
  assert.match(FIRST_PARTY_APP_CSS, /data-surface="shell"\] main,[^}]*data-surface="workspace"\] main\{height:100%;min-height:0/);
  const deploy = readFileSync(new URL("../scripts/sprites/deploy-sandbox-release.sh", import.meta.url), "utf8");
  assert.match(deploy, /--candidate-app,nebula-arcade,--catalog,current/);
  const runner = readFileSync(new URL("../scripts/sprites/run-supervised-sandbox.mjs", import.meta.url), "utf8");
  for (const registration of ["discordStreamHubCatalogRegistration", "streamweaverCatalogRegistration", "hearMeOutCatalogRegistration", "mountainViewCatalogRegistration", "companionCatalogRegistration"]) assert.match(runner, new RegExp(registration));
  assert.match(runner, /apps\/spacemountain-web\/dist\/integrated-server\.js/);
});
