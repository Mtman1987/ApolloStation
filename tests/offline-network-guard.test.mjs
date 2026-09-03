import assert from "node:assert/strict";
import { once } from "node:events";
import http from "node:http";
import https from "node:https";
import { spawnSync } from "node:child_process";
import test from "node:test";

await import("../scripts/offline-network-guard.mjs");

test("offline guard blocks external requests before a socket is opened", async () => {
  assert.throws(() => fetch("https://example.com/apollo-should-never-leave"), /OFFLINE_NETWORK_BLOCKED/);
  assert.throws(() => httpsRequest(), /OFFLINE_NETWORK_BLOCKED/);
});

test("offline guard permits loopback-only sandbox traffic", async () => {
  const server = http.createServer((_request, response) => response.end("local-only"));
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("loopback server did not bind");
    const response = await fetch(`http://127.0.0.1:${address.port}/health`);
    assert.equal(await response.text(), "local-only");
  } finally {
    server.close();
    await once(server, "close");
  }
});

test("offline guard permits only GET requests to the configured live-read origin", () => {
  const source = `globalThis.fetch=async()=>new Response('ok');await import(process.env.GUARD_URL);await fetch('https://spmt.live/api/apps',{method:'GET'});let blocked=0;for(const [url,init] of [['https://spmt.live/api/apps',{method:'POST'}],['https://example.com/data',{method:'GET'}]]){try{fetch(url,init)}catch(error){if(/OFFLINE_NETWORK_BLOCKED/.test(String(error)))blocked+=1}}if(blocked!==2)process.exit(1);`;
  const child = spawnSync(process.execPath, ["--input-type=module", "--eval", source], { encoding: "utf8", env: { ...process.env, GUARD_URL: new URL("../scripts/offline-network-guard.mjs", import.meta.url).href, SPMT_LIVE_READ_ORIGIN: "https://spmt.live" } });
  assert.equal(child.status, 0, child.stderr);
});

function httpsRequest() {
  return https.get("https://example.com/apollo-should-never-leave");
}
