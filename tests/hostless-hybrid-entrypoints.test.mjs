import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = path => readFile(new URL("../" + path, import.meta.url), "utf8");

test("Node 1 hybrid is pinned to the Node 1 supervised runtime", async () => {
  const [entry, config, pkg, launcher] = await Promise.all([
    read("scripts/hostless/start-node1.mjs"),
    read("hostless.yaml"),
    read("package.json"),
    read("scripts/hostless/start-node.mjs"),
  ]);
  assert.match(entry, /APOLLO_NODE_ROLE\s*=\s*"node1"/);
  assert.match(config, /start_command:\s*"node scripts\/hostless\/start-node1\.mjs"/);
  assert.match(pkg, /"hostless:node1":\s*"node scripts\/hostless\/start-node1\.mjs"/);
  for (const service of ["tools/apollo-bulletin/server.mjs", "apps/spmt-service/dist/provider-identity-start.js", "apps/discord-stream-hub/dist/web-server.js", "apps/spacemountain-web/dist/integrated-server.js"]) {
    assert.ok(launcher.includes(service), "Node 1 service missing: " + service);
  }
});

test("Node 1 shell points cross-node apps at the Node 2 origin", async () => {
  const launcher = await read("scripts/hostless/start-node.mjs");
  for (const name of ["NEBULA_ARCADE_ORIGIN", "STREAMWEAVER_WEB_ORIGIN", "HEARMEOUT_WEB_ORIGIN"]) {
    assert.ok(launcher.includes(name + ": process.env." + name + " || process.env.APOLLO_NODE2_ORIGIN"), name + " must resolve to Node 2");
  }
});
