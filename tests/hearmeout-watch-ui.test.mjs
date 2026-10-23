import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("HearMeOut Watch room UI exposes catalog type filters and scoped catalog/episode requests", async () => {
  const source = await readFile(new URL("../apps/hearmeout/src/web-server-v3.ts", import.meta.url), "utf8");
  assert.match(source, /function mountWatchCatalog\(/);
  assert.match(source, /\['vod,live,series','All media'\]/);
  assert.match(source, /\['vod','Movies'\]/);
  assert.match(source, /\['series','Series'\]/);
  assert.match(source, /\['live','Live TV'\]/);
  assert.match(source, /watch\/catalog\?q=/);
  assert.match(source, /&kind='\+encodeURIComponent\(kind\.value\)/);
  assert.match(source, /watch\/series\//);
  assert.match(source, /Season '\+String\(episode\.categoryId\)/);
  assert.match(source, /watch\\/play\\/\(vod\|live\|episode\)/);
  assert.match(source, /HLS proxying and shared queue acceptance remain next/);
  assert.match(source, /player\.play\(\)/);
});
