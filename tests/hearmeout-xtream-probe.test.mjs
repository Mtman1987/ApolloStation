import test from "node:test";
import assert from "node:assert/strict";
import * as h from "../apps/hearmeout/dist/index.js";

test("Xtream direct probe reads a byte range and never returns the source URL", async () => {
  let seen;
  const r = await h.probeHearMeOutXtreamDirect("123", { resolve: (id) => new URL(`http://p.example/movie/u/secret/${id}.mp4`), fetchImpl: async (url, init) => { seen = init.headers.Range; return new Response(new Uint8Array(100), { status: 206, headers: { "content-type": "video/mp4", "content-range": "bytes 0-63/1000" } }); } });
  assert.equal(seen, "bytes=0-63"); assert.equal(r.status, 200); assert.equal(r.body.rangeHonored, true); assert.equal(r.body.directPlaybackSignal, true);
  assert.doesNotMatch(JSON.stringify(r.body), /secret|p\.example/);
  assert.equal((await h.probeHearMeOutXtreamDirect("abc")).status, 400);
  assert.equal((await h.probeHearMeOutXtreamDirect("5", { resolve: () => { throw Error("x"); } })).status, 502);
});
