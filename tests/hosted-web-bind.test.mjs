import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("hosted StreamWeaver and Discord Stream Hub web entrypoints bind to the container interface", async () => {
  for (const path of [
    "apps/streamweaver/src/web-server.ts",
    "apps/discord-stream-hub/src/web-server.ts",
  ]) {
    const source = await readFile(new URL(`../${path}`, import.meta.url), "utf8");
    assert.match(source, /host:\s*process\.env\.HOST\s*\?\?\s*"0\.0\.0\.0"/, path);
  }
});
