import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("hosted web entrypoints bind to the container interface by default", async () => {
  const cases = [
    ["apps/streamweaver/src/web-server.ts", /host:\s*process\.env\.HOST\s*\?\?\s*"0\.0\.0\.0"/],
    ["apps/discord-stream-hub/src/web-server.ts", /host:\s*process\.env\.HOST\s*\?\?\s*"0\.0\.0\.0"/],
    ["apps/nebula-arcade/src/nebula-arcade-live-server.ts", /host:\s*env\.HOST\s*\|\|\s*'0\.0\.0\.0'/],
  ];
  for (const [path, pattern] of cases) {
    const source = await readFile(new URL(`../${path}`, import.meta.url), "utf8");
    assert.match(source, pattern, path);
  }
});
