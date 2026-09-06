import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const deployScriptPath = new URL("../scripts/sprites/deploy-sandbox-release.sh", import.meta.url);

test("protected promotion rejects stale app-owned web processes and verifies rendered build identity", async () => {
  const script = await readFile(deployScriptPath, "utf8");

  assert.match(script, /stop_orphan_app_web_processes\(\)/);
  assert.match(script, /apps\/\(discord-stream-hub\|streamweaver\|hearmeout\|mountainview\|companion\)\/dist\/web-server/);
  assert.match(script, /for app in discord-stream-hub streamweaver hearmeout nebula-arcade stellar-core/);
  assert.match(script, /for app in companion mountainview/);
  assert.match(script, /location: \/downloads\/\$app/);
  assert.match(script, /assets\/spacemountain\/shell-ui-base\.js/);
  assert.match(script, /for theme in solar-flare nebula-purple oceanic-blue aurora-green/);
  assert.match(script, /http:\/\/127\.0\.0\.1:8080\/apps\/\$app/);
  assert.match(script, /grep -Fq "Build \$short_sha"/);
  assert.match(script, /grep -Fq "\$BUILD_SHA" <<<"\$health" && verify_app_web_cohort/);
  assert.match(script, /stop_orphan_app_web_processes\nfor _ in \{1\.\.30\}/);
});

test("Nebula's visible app response exposes the running build for release verification", async () => {
  const { mkdtemp, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { createNebulaArcadeSandboxHost } = await import("../apps/nebula-arcade/dist/nebula-arcade-sandbox-server.js");
  const directory = await mkdtemp(join(tmpdir(), "nebula-release-"));
  const sha = "a".repeat(40);
  const host = createNebulaArcadeSandboxHost({databasePath:join(directory,"db.sqlite"),tenantId:"test",channelId:"room",port:0,host:"127.0.0.1",buildSha:sha});
  try {
    await host.listen();
    const response = await fetch(`http://127.0.0.1:${host.server.address().port}/apps/nebula-arcade`);
    assert.equal(response.status,200);
    assert.equal(response.headers.get("x-spmt-build-sha"),sha);
    assert.match(await response.text(),/Nebula Arcade/);
  } finally { await host.close(); await rm(directory,{recursive:true,force:true}); }
});
