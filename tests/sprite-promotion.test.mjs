import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { spawnSync } from "node:child_process";

const workflowPath = new URL("../.github/workflows/sprite-promotion.yml", import.meta.url);
const deployScriptPath = new URL("../scripts/sprites/deploy-sandbox-release.sh", import.meta.url);
const networkPolicyPath = new URL("../sandbox/sprites/network-policy.json", import.meta.url);

test("public probing runs only after the completed promotion mutation", async () => {
  const workflow = await readFile(workflowPath, "utf8");
  const step = workflow.split("      - name: Open the Apollo test entry\n")[1].split("      - name:")[0];
  const script = step.split("        run: |\n")[1].split("\n").map(line => line.replace(/^          /, "")).join("\n");
  const result = spawnSync("bash", ["--noprofile", "--norc", "-c", 'sprite(){ printf "%s\\n" "$*"; }; node(){ echo "public probe must not run during promotion" >&2; return 1; };\n'+script], {encoding:"utf8",env:{...process.env,SPRITE_ORG:"testing-968",SPRITE_NAME:"web-terminal",SPRITE_PUBLIC_URL:"https://test.example",BUILD_SHA:"test-build"}});
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), "config update -o testing-968 -s web-terminal --url-auth public");
  assert.match(workflow, /- name: Verify promoted public entry\n        run: node scripts\/sprites\/verify-hearmeout-broadcast-test\.mjs/);
  assert.ok(workflow.indexOf("- name: Verify promoted public entry") > workflow.indexOf("- name: Promote and verify exact main commit"));
});

test("Sprite promotion has one protected release target", async () => {
  const workflow = await readFile(workflowPath, "utf8");

  assert.match(workflow, /^  workflow_run:\n    workflows: \["Green shared contracts"\]\n    types: \[completed\]\n    branches: \[main\]/m);
  assert.match(workflow, /github\.event\.workflow_run\.conclusion == 'success'/);
  assert.match(workflow, /github\.event\.workflow_run\.head_sha/);
  assert.doesNotMatch(workflow, /work\/\*\*/);
  assert.doesNotMatch(workflow, /sprite-review|DEPLOY_ROLE: review/);
  assert.match(workflow, /SPRITES_AUTODEPLOY_ENABLED == 'true'/);
  assert.match(workflow, /environment: sprite-release/);
  assert.match(workflow, /SPRITE_NAME: web-terminal/);
  assert.match(workflow, /EXPECTED_SPRITE_ID: sprite-fec8d6f2-49f0-4e28-bc6d-e8a7ae364280/);
  assert.match(workflow, /SPRITE_PUBLIC_URL: https:\/\/web-terminal-bvesa\.sprites\.app/);
  assert.match(workflow, /grep -Eiq 'auth.*\(sprite\|public\).*\|\(sprite\|public\).*auth'/);
  assert.match(workflow, /sprite exec --no-port-forward/);
  assert.match(workflow, /--file scripts\/sprites\/deploy-sandbox-release\.sh:\/tmp\/deploy-sandbox-release\.sh/);
  assert.match(workflow, /--file scripts\/sprites\/start-detached-release\.sh:\/tmp\/start-detached-release\.sh/);
  assert.match(workflow, /timeout-minutes: 25/);
  assert.match(workflow, /Remote release did not finish within 20 minutes/);
  assert.doesNotMatch(workflow, /SPMT_LIVE_READ_ACCESS_TOKEN|spmt-live-read-token/);
  assert.doesNotMatch(workflow, /sprite exec --http-post/);
  assert.match(workflow, /secrets\.STREAMWEAVER_MESHY_API_KEY/);
  assert.match(workflow, /secrets\.STREAMWEAVER_KEENTOOLS_API_KEY/);
  assert.match(workflow, /streamweaver-meshy-api-key/);
  assert.match(workflow, /streamweaver-keentools-api-key/);
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
  assert.match(script, /npm run typecheck/);
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
  assert.match(script, /create_apollo_service "\$\(basename "\$previous_release"\)" 1/);
  assert.match(script, /services_json="\$\(sprite-env services list\)"/);
  assert.match(script, /select\(\.http_port != null\)/);
  assert.match(script, /for stale_service in "\$\{http_services\[@\]\}" "\$service_name" "\$bootstrap_service_name" spmt-qwen/);
  assert.match(script, /Deployment failed; restoring bootstrap service/);
  assert.match(script, /sprite-env services delete "\$service_name"/);
  assert.match(script, /llama_ref="b6335"/);
  assert.match(script, /--llm-binary,\$llama_root\/build\/bin\/llama-server/);
  assert.match(script, /local enable_stellar="\$\{2:-1\}"/);
  assert.match(script, /for _ in \{1\.\.1260\}/);
  assert.match(script, /sprite-env services create "\$bootstrap_service_name"/);
  assert.match(script, /grep -Fq "\$BUILD_SHA"/);
});

test("Sprite network policy allows the production read source but remains deny-by-default", async () => {
  const policy = JSON.parse(await readFile(networkPolicyPath, "utf8"));
  assert.ok(policy.rules.some((rule) => rule.domain === "spmt.live" && rule.action === "allow"));
  for (const domain of ["api.meshy.ai", "assets.meshy.ai", "api.keentools.io", "*.amazonaws.com"]) assert.ok(policy.rules.some((rule) => rule.domain === domain && rule.action === "allow"));
  assert.equal(policy.rules.some((rule) => /twitch|discord/i.test(rule.domain) && rule.action === "allow"), false);
  assert.deepEqual(policy.rules.at(-1), { domain: "*", action: "deny" });
});
