import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const deployScriptPath = new URL("../scripts/sprites/deploy-sandbox-release.sh", import.meta.url);

test("protected promotion rejects stale app-owned web processes and verifies rendered build identity", async () => {
  const script = await readFile(deployScriptPath, "utf8");

  assert.match(script, /stop_orphan_app_web_processes\(\)/);
  assert.match(script, /apps\/\(discord-stream-hub\|streamweaver\|hearmeout\|mountainview\|companion\)\/dist\/web-server/);
  assert.match(script, /for app in discord-stream-hub streamweaver hearmeout mountainview companion/);
  assert.match(script, /http:\/\/127\.0\.0\.1:8080\/apps\/\$app/);
  assert.match(script, /grep -Fq "Build \$short_sha"/);
  assert.match(script, /grep -Fq "\$BUILD_SHA" <<<"\$health" && verify_app_web_cohort/);
  assert.match(script, /stop_orphan_app_web_processes\nfor _ in \{1\.\.30\}/);
});
