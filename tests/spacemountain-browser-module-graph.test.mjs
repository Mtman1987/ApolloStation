import assert from "node:assert/strict";
import test from "node:test";
import { createSpaceMountainWebHost } from "../apps/spacemountain-web/dist/server.js";

test("SpaceMountain serves every runtime SDK module needed before browser boot", async () => {
  const web = createSpaceMountainWebHost({
    spmtOrigin: "http://127.0.0.1:3000",
    host: "127.0.0.1",
    port: 0,
    buildSha: "browser-module-graph-test",
  });
  try {
    await web.listen();
    const address = web.server.address();
    assert.ok(address && typeof address !== "string");
    const base = `http://127.0.0.1:${address.port}`;

    const client = await fetch(`${base}/assets/web/client.js`);
    assert.equal(client.status, 200);
    assert.match(await client.text(), /@spmt\/sdk/);

    const sdk = await fetch(`${base}/assets/sdk/index.js`);
    assert.equal(sdk.status, 200);
    const sdkSource = await sdk.text();
    assert.match(sdkSource, /\.\/xp\.js/);

    const xp = await fetch(`${base}/assets/sdk/xp.js`);
    assert.equal(xp.status, 200, "the SDK sibling imported by index.js must be browser-addressable");
    assert.match(xp.headers.get("content-type") ?? "", /text\/javascript/);
    assert.match(await xp.text(), /SPMT_XP_LEDGER_SCHEMA_VERSION/);
  } finally {
    await web.close();
  }
});
