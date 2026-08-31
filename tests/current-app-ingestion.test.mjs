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

const launchUrls = {
  commlink: "https://commlink.spacemountain.live/",
  "stellar-core": "https://stellar.spacemountain.live/",
  "mission-control": "https://missioncontrol.spacemountain.live/",
  "discord-stream-hub": "https://discordstreamhub.spacemountain.live/",
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
const owned = ["discord-stream-hub", "streamweaver", "hearmeout", "mountainview", "companion"];
const source = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("SpaceMountain-owned apps use the same host-neutral catalog contract as developer apps", () => {
  assert.deepEqual(registrations.map((item) => item.appId).sort(), expectedIds);
  for (const registration of registrations) {
    assert.equal(registration.launchUrl, launchUrls[registration.appId]);
    assert.equal(registration.surfaces.includes("shell"), true, `${registration.appId} must be shell-launchable`);
    assert.doesNotMatch(registration.launchUrl, /(?:\?|&)surface=/, `${registration.appId} surface identity belongs in AppFrame, not launchUrl`);
  }
  assert.equal(new Set(registrations.map((item) => new URL(item.launchUrl).hostname)).size, registrations.length);
});

test("HearMeOut keeps the exact Green publisher URL while surface mode travels through AppFrame", () => {
  const launchUrl = "https://web-terminal-bvesa.sprites.app/apps/hearmeout";
  const registration = hearMeOutCatalogRegistration(launchUrl);
  assert.equal(registration.launchUrl, launchUrl);
  assert.equal(registration.surfaces.includes("shell"), true);
  assert.equal(registration.surfaces.includes("standalone"), true);
  assert.doesNotMatch(registration.launchUrl, /workspace|surface=/);
});

test("current Green app surfaces are owned by their app packages rather than SpaceMountain", () => {
  const base = source("apps/spacemountain-web/src/integrated-server-base.ts");
  assert.doesNotMatch(base, /first-party-app-surfaces|renderFirstPartyAppSurface|hearmeout-green-surface/);
  for (const appId of owned) {
    const web = source(`apps/${appId}/src/web-server.ts`);
    assert.match(web, /data-app|createProductAppWebServer|createHearMeOutWebServer/);
  }
});

test("common ingress routes current Green apps to their owning supervised processes", () => {
  const gateway = source("apps/spacemountain-web/src/integrated-server.ts");
  const runner = source("scripts/sprites/run-supervised-sandbox.mjs");
  for (const appId of owned) {
    assert.match(gateway, new RegExp(appId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.match(runner, new RegExp(`apps/${appId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/dist/web-server\\.js`));
    assert.match(runner, new RegExp(`/apps/${appId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
  }
  assert.doesNotMatch(runner, /surface=workspace/);
});

test("app-owned shell surfaces consume the public AppFrame/theme/layout contract", () => {
  const foundation = source("packages/app-foundation/src/product-web.ts");
  assert.match(foundation, /PRODUCT_UI_CSS/);
  assert.match(foundation, /spmt\.embed/);
  assert.match(foundation, /child\.ready/);
  assert.match(foundation, /host\.hello/);
  assert.match(foundation, /theme\.changed/);
  assert.match(foundation, /layout\.changed/);
  assert.match(foundation, /data-surface=|dataset\.surface/);
  const shell = source("apps/spacemountain/src/shell-ui.ts");
  assert.match(shell, /createAppFrameHost/);
  assert.match(shell, /buildAppFrameTarget/);
  assert.match(shell, /grantedScopes/);
});

test("embedded app homes remain bounded and release promotion selects the full current catalog", () => {
  const foundation = source("packages/app-foundation/src/product-web.ts");
  assert.match(foundation, /--spmt-shell-available-height/);
  assert.match(foundation, /overflow:hidden/);
  const themed = source("apps/spacemountain/src/themed-surface-css.ts");
  for (const appId of owned) assert.match(themed, new RegExp(`data-spmt-app=["']${appId}["']`));
  const deploy = source("scripts/sprites/deploy-sandbox-release.sh");
  assert.match(deploy, /--candidate-app,nebula-arcade,--catalog,current/);
  const runner = source("scripts/sprites/run-supervised-sandbox.mjs");
  for (const registration of ["discordStreamHubCatalogRegistration", "streamweaverCatalogRegistration", "hearMeOutCatalogRegistration", "mountainViewCatalogRegistration", "companionCatalogRegistration"]) assert.match(runner, new RegExp(registration));
  assert.match(runner, /apps\/spacemountain-web\/dist\/integrated-server\.js/);
});
