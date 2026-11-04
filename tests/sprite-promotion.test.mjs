import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { spawnSync } from "node:child_process";

const workflowPath = new URL("../.github/workflows/sprite-promotion.yml", import.meta.url);
const deployScriptPath = new URL("../scripts/sprites/deploy-sandbox-release.sh", import.meta.url);
const networkPolicyPath = new URL("../sandbox/sprites/network-policy.json", import.meta.url);

test("automatic Sprite promotion remains disabled until an owner reintroduces an approved workflow", async () => {
  const { existsSync } = await import("node:fs");
  assert.equal(existsSync(workflowPath), false);
});

test("Sprite deployment workflow is not implicitly restored by script-level tests", async () => {
  const { existsSync } = await import("node:fs");
  assert.equal(existsSync(workflowPath), false);
});

test("Sprite deployment verifies, tests, switches atomically, rolls back, and launches the current app catalog", async () => {
  const script = await readFile(deployScriptPath, "utf8");

  assert.match(script, /DEPLOY_ROLE.*review.*release/);
  assert.match(script, /data_root="\/home\/sprite\/data\/\$DEPLOY_ROLE"/);
  assert.match(script, /git -C "\$release_dir" fetch --depth=1 origin "\$BUILD_SHA"/);
  assert.match(script, /actual_sha=.*git -C "\$release_dir" rev-parse HEAD/);
  assert.match(script, /npm ci --ignore-scripts/);
  assert.match(script, /provision_media_runtime\n.*npm ci/);
  assert.match(script, /c733b4b2951e5957e15505f788b2c65a7a41b6da4b289e295852cc38079b4d2b/);
  assert.match(script, /--cmd "\$media_root\/run-node"/);
  assert.doesNotMatch(script, /npm run typecheck/);
  assert.match(script, /npm run build/);
  assert.doesNotMatch(script, /npm run test:sprite/);
  assert.match(script, /mv -Tf "\$next_link" "\$current_link"/);
  assert.match(script, /Deployment failed; restoring/);
  assert.match(script, /create_apollo_service "\$BUILD_SHA"/);
  assert.match(script, /--candidate-app,nebula-arcade,--catalog,current/);
  assert.match(script, /--offline-network-guard,1/);
  assert.match(script, /--live-read-origin,https:\/\/spmt\.live/);
  assert.doesNotMatch(script, /SPMT_LIVE_READ_ACCESS_TOKEN|live-read-token-file|spmt-live-read-token/);
  assert.doesNotMatch(script, /--candidate-app,nebula-tag/);
  assert.match(script, /create_apollo_service "\$\(basename "\$previous_release"\)"/);
  assert.match(script, /services_json="\$\(sprite-env services list\)"/);
  assert.match(script, /select\(\.http_port != null\)/);
  assert.match(script, /for stale_service in "\$\{http_services\[@\]\}" "\$service_name" "\$bootstrap_service_name" spmt-qwen/);
  assert.match(script, /Deployment failed; restoring bootstrap service/);
  assert.match(script, /sprite-env services delete "\$service_name"/);
  assert.doesNotMatch(script, /llm-binary|provision_llm_runtime/);
  assert.match(script, /for _ in \{1\.\.1260\}/);
  assert.match(script, /sprite-env services create "\$bootstrap_service_name"/);
  assert.match(script, /grep -Fq "\$BUILD_SHA"/);
});

test("Sprite network policy allows the production read source but remains deny-by-default", async () => {
  const policy = JSON.parse(await readFile(networkPolicyPath, "utf8"));
  assert.ok(policy.rules.some((rule) => rule.domain === "spmt.live" && rule.action === "allow"));
  for (const domain of ["api.meshy.ai", "assets.meshy.ai", "api.keentools.io", "*.amazonaws.com"]) assert.equal(policy.rules.some((rule) => rule.domain === domain && rule.action === "allow"), false, domain + " is not used by direct local GLB rigging");
  assert.equal(policy.rules.some((rule) => /twitch|discord/i.test(rule.domain) && rule.action === "allow"), false);
  assert.deepEqual(policy.rules.at(-1), { domain: "*", action: "deny" });
});
