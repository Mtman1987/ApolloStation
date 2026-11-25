import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = path => readFile(new URL("../" + path, import.meta.url), "utf8");

test("combined hybrid exposes separate, role-pinned Node 1 and Node 2 launchers", async () => {
  const [node1, node2, yaml, pkg, launcher] = await Promise.all([
    read("scripts/hostless/start-node1.mjs"),
    read("scripts/hostless/start-node2.mjs"),
    read("hostless.yaml"),
    read("package.json"),
    read("scripts/hostless/start-node.mjs"),
  ]);
  assert.match(node1, /APOLLO_NODE_ROLE\s*=\s*"node1"/);
  assert.match(node2, /APOLLO_NODE_ROLE\s*=\s*"node2"/);
  assert.match(yaml, /start_command:\s*"node scripts\/hostless\/start-node\.mjs"/);
  assert.match(pkg, /"hostless:node1":\s*"node scripts\/hostless\/start-node1\.mjs"/);
  assert.match(pkg, /"hostless:node2":\s*"node scripts\/hostless\/start-node2\.mjs"/);
  for (const service of ["tools/apollo-bulletin/server.mjs", "apps/spmt-service/dist/provider-identity-start.js", "apps/discord-stream-hub/dist/web-server.js", "apps/spacemountain-web/dist/integrated-server.js", "apps/chat-gateway/dist/service-start.js", "apps/streamweaver/dist/web-server.js", "scripts/hostless/node2-ingress.mjs"]) {
    assert.ok(launcher.includes(service), "Hybrid service missing: " + service);
  }
});

test("Node 1 shell routes Nebula, StreamWeaver, and HearMeOut to Node 2", async () => {
  const launcher = await read("scripts/hostless/start-node.mjs");
  for (const name of ["NEBULA_ARCADE_ORIGIN", "STREAMWEAVER_WEB_ORIGIN", "HEARMEOUT_WEB_ORIGIN"]) {
    assert.ok(launcher.includes(name + ": process.env." + name + " || process.env.APOLLO_NODE2_ORIGIN"), name + " must resolve to Node 2");
  }
});

test("HearMeOut is built and launched only with its explicit persistent database and Node 1 authority", async () => {
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

test("browser automation has one Playwright runtime and no Puppeteer package dependency", async () => {
  const [restream, worker, workerLock, rootLock] = await Promise.all([
    read("services/restream-control/package.json"),
    read("apps/hearmeout/legacy-worker/package.json"),
    read("apps/hearmeout/legacy-worker/package-lock.json"),
    read("package-lock.json"),
  ]);
  assert.ok(JSON.parse(restream).dependencies.playwright);
  assert.ok(JSON.parse(worker).dependencies.playwright);
  assert.equal(JSON.parse(restream).dependencies.puppeteer, undefined);
  assert.equal(JSON.parse(worker).dependencies.puppeteer, undefined);
  assert.equal(workerLock.includes('"node_modules/puppeteer"'), false);
  assert.equal(rootLock.includes('"node_modules/puppeteer"'), false);
});
