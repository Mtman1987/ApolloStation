import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workflowPath = new URL("../.github/workflows/sprite-promotion.yml", import.meta.url);
const deployScriptPath = new URL("../scripts/sprites/deploy-sandbox-release.sh", import.meta.url);

test("Sprite promotion keeps review and release targets isolated", async () => {
  const workflow = await readFile(workflowPath, "utf8");

  assert.match(workflow, /push:\s*\n\s*branches:\s*\n\s*- main/);
  assert.doesNotMatch(workflow, /work\/\*\*/);
  assert.match(workflow, /github\.event_name == 'workflow_dispatch' && inputs\.target == 'review'/);
  assert.match(workflow, /SPRITES_AUTODEPLOY_ENABLED == 'true'/);
  assert.match(workflow, /environment: sprite-review/);
  assert.match(workflow, /environment: sprite-release/);
  assert.match(workflow, /SPRITE_ORG: mtman-new/);
  assert.match(workflow, /EXPECTED_SPRITE_ID: sprite-2249fee2-ecf3-4b10-8bc1-314f4b9e5bcc/);
  assert.match(workflow, /SPRITE_PUBLIC_URL: https:\/\/web-terminal-bpp4n\.sprites\.app/);
  assert.match(workflow, /SPRITE_NAME: web-terminal/);
  assert.match(workflow, /EXPECTED_SPRITE_ID: sprite-fec8d6f2-49f0-4e28-bc6d-e8a7ae364280/);
  assert.match(workflow, /SPRITE_PUBLIC_URL: https:\/\/web-terminal-bvesa\.sprites\.app/);
  assert.match(workflow, /grep -Eiq 'auth\[\^\[:alnum:\]\]\+sprite\|sprite\[\^\[:alnum:\]\]\+auth'/);
  assert.match(workflow, /sprite exec --no-port-forward/);
  assert.match(workflow, /--file scripts\/sprites\/deploy-sandbox-release\.sh:\/tmp\/deploy-sandbox-release\.sh/);
  assert.doesNotMatch(workflow, /sprite exec --http-post/);
});

test("Sprite deployment verifies, tests, switches atomically, rolls back, and launches the current app catalog", async () => {
  const script = await readFile(deployScriptPath, "utf8");

  assert.match(script, /DEPLOY_ROLE.*review.*release/);
  assert.match(script, /data_root="\/home\/sprite\/data\/\$DEPLOY_ROLE"/);
  assert.match(script, /git -C "\$release_dir" fetch --depth=1 origin "\$BUILD_SHA"/);
  assert.match(script, /actual_sha=.*git -C "\$release_dir" rev-parse HEAD/);
  assert.match(script, /npm ci --ignore-scripts/);
  assert.match(script, /npm run typecheck/);
  assert.match(script, /timeout --signal=TERM --kill-after=15s 10m npm test/);
  assert.match(script, /mv -Tf "\$next_link" "\$current_link"/);
  assert.match(script, /Deployment failed; restoring/);
  assert.match(script, /create_apollo_service "\$BUILD_SHA"/);
  assert.match(script, /--candidate-app,nebula-arcade,--catalog,current/);
  assert.match(script, /--offline-network-guard,1/);
  assert.doesNotMatch(script, /--candidate-app,nebula-tag/);
  assert.match(script, /create_apollo_service "\$\(basename "\$previous_release"\)" 0/);
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
