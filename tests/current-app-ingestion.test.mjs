import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { commlinkCatalogRegistration } from "../apps/commlink/dist/index.js";
import { companionCatalogRegistration } from "../apps/companion/dist/index.js";
import { discordStreamHubCatalogRegistration } from "../apps/discord-stream-hub/dist/index.js";
import { hearMeOutCatalogRegistration, HEARMEOUT_LIVE_LAUNCH_URL } from "../apps/hearmeout/dist/index.js";
import { missionControlCatalogRegistration } from "../apps/mission-control/dist/index.js";
import { mountainViewCatalogRegistration } from "../apps/mountainview/dist/index.js";
import { nebulaArcadeCatalogRegistration } from "../apps/nebula-arcade/dist/index.js";
import { stellarCoreCatalogRegistration } from "../apps/stellar-core/dist/index.js";
import { streamweaverCatalogRegistration } from "../apps/streamweaver/dist/index.js";
import { createIntegratedSpaceMountainWebHost } from "../apps/spacemountain-web/dist/integrated-server.js";
import { FIRST_PARTY_APP_CSS, FIRST_PARTY_APP_SURFACES } from "../apps/spacemountain-web/dist/first-party-app-surfaces.js";

const launchUrls = {
  commlink: "https://commlink.spacemountain.live/",
  "stellar-core": "https://stellar.spacemountain.live/",
  "mission-control": "https://mission-control.spacemountain.live/",
  "discord-stream-hub": "https://dsh.spacemountain.live/",
  streamweaver: "https://streamweaver.spacemountain.live/",
  hearmeout: "https://hearmeout.spacemountain.live/",
  mountainview: "https://mountainview.spacemountain.live/",
  companion: "https://companion.spacemountain.live/",
  "nebula-arcade": "https://nebula.spacemountain.live/",
};
const registrations = [
  commlinkCatalogRegistration(launchUrls.commlink),
  stellarCoreCatalogRegistration(launchUrls["stellar-core"]),
  missionControlCatalogRegistration(launchUrls["mission-control"]),
  discordStreamHubCatalogRegistration(launchUrls["discord-stream-hub"]),
  streamweaverCatalogRegistration(launchUrls.streamweaver),
  hearMeOutCatalogRegistration(launchUrls.hearmeout),
  mountainViewCatalogRegistration(launchUrls.mountainview),
  companionCatalogRegistration(launchUrls.companion),
  nebulaArcadeCatalogRegistration(launchUrls["nebula-arcade"]),
];

const expectedIds = ["commlink", "companion", "discord-stream-hub", "hearmeout", "mission-control", "mountainview", "nebula-arcade", "stellar-core", "streamweaver"];

test("SpaceMountain-owned apps use the same host-neutral catalog contract as developer apps", () => {
  assert.deepEqual(registrations.map((item) => item.appId).sort(), expectedIds);
  for (const registration of registrations) {
    assert.equal(registration.launchUrl, launchUrls[registration.appId], `${registration.appId} must preserve a real publisher-supplied launch URL exactly`);
    if (registration.appId === "hearmeout") {
      assert.equal(registration.surfaces.includes("shell"), false, "HearMeOut must not be trapped in a shell iframe while the real voice-room app is cross-origin");
      assert.equal(registration.surfaces.includes("standalone"), true, "HearMeOut must launch as the real standalone room application");
    } else {
      assert.equal(registration.surfaces.includes("shell"), true, `${registration.appId} must be launchable inside the SpaceMountain shell`);
    }
  }
  assert.equal(new Set(registrations.map((item) => new URL(item.launchUrl).hostname)).size, registrations.length, "the catalog must not assume one shared first-party host");
});

test("Apollo placeholder HearMeOut launch URLs resolve to the current real app", () => {
  const registration = hearMeOutCatalogRegistration("https://web-terminal-bvesa.sprites.app/apps/hearmeout?surface=workspace");
  assert.equal(registration.launchUrl, HEARMEOUT_LIVE_LAUNCH_URL);
  assert.equal(registration.surfaces.includes("shell"), false);
  assert.equal(registration.surfaces.includes("standalone"), true);
});

test("every newly ingested generic app surface remains frameable for apps that still use it", async () => {
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

test("shell and workspace embeds do not paint a second boxed app scene", async () => {
  const host = createIntegratedSpaceMountainWebHost({ spmtOrigin: "http://127.0.0.1:65534", host: "127.0.0.1", port: 0, buildSha: "backdrop-owner-test" });
  try {
    await host.listen();
    const address = host.server.address();
    assert.ok(address && typeof address !== "string");
    const base = `http://127.0.0.1:${address.port}`;
    const css = await (await fetch(`${base}/assets/web/first-party-apps.css`)).text();
    assert.match(css, /body\[data-surface="shell"\] \.app-scene,body\[data-surface="workspace"\] \.app-scene\{display:none!important\}/);
    const js = await (await fetch(`${base}/assets/web/first-party-apps.js`)).text();
    assert.doesNotMatch(js, /spmt-product-backdrop-image/);
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
  const themed = readFileSync(new URL("../apps/spacemountain/dist/themed-surface-css.js", import.meta.url), "utf8");
  for (const appId of ["discord-stream-hub", "streamweaver", "hearmeout", "mountainview", "companion"]) {
    assert.match(themed, new RegExp(`data-spmt-app=["']${appId}["']`));
  }
  const deploy = readFileSync(new URL("../scripts/sprites/deploy-sandbox-release.sh", import.meta.url), "utf8");
  assert.match(deploy, /--candidate-app,nebula-arcade,--catalog,current/);
  const runner = readFileSync(new URL("../scripts/sprites/run-supervised-sandbox.mjs", import.meta.url), "utf8");
  for (const registration of ["discordStreamHubCatalogRegistration", "streamweaverCatalogRegistration", "hearMeOutCatalogRegistration", "mountainViewCatalogRegistration", "companionCatalogRegistration"]) assert.match(runner, new RegExp(registration));
  assert.match(runner, /apps\/spacemountain-web\/dist\/integrated-server\.js/);
});
