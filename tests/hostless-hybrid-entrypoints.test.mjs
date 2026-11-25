import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = path => readFile(new URL("../" + path, import.meta.url), "utf8");

test("Node 2 hybrid is pinned to the Node 2 supervised runtime", async () => {
  const [entry, config, pkg, launcher] = await Promise.all([
    read("scripts/hostless/start-node2.mjs"),
    read("hostless.yaml"),
    read("package.json"),
    read("scripts/hostless/start-node.mjs"),
  ]);
  assert.match(entry, /APOLLO_NODE_ROLE\s*=\s*"node2"/);
  assert.match(config, /start_command:\s*"node scripts\/hostless\/start-node2\.mjs"/);
  assert.match(pkg, /"hostless:node2":\s*"node scripts\/hostless\/start-node2\.mjs"/);
  for (const service of ["apps/chat-gateway/dist/service-start.js", "apps/streamweaver/dist/web-server.js", "scripts/hostless/node2-ingress.mjs"]) {
    assert.ok(launcher.includes(service), "Node 2 service missing: " + service);
  }
});

test("HearMeOut is built, conditionally launched only with explicit database and authority, and routed through Node 2 ingress", async () => {
  const [pkg, launcher, ingress] = await Promise.all([
    read("package.json"),
    read("scripts/hostless/start-node.mjs"),
    read("scripts/hostless/node2-ingress.mjs"),
  ]);
  assert.match(pkg, /build:hostless[^\n]*apps\/hearmeout/);
  assert.match(launcher, /const hearMeOutDatabasePath = process\.env\.HEARMEOUT_ROOM_DATABASE_PATH\?\.trim\(\)/);
  assert.match(launcher, /if \(hearMeOutDatabasePath && hearMeOutSpmtOrigin\)/);
  assert.match(launcher, /apps\/hearmeout\/dist\/web-server\.js/);
  assert.match(ingress, /isHearMeOutPath/);
  assert.match(ingress, /hearMeOutPort/);
  assert.match(ingress, /api\/hearmeout\/rtc/);
});
