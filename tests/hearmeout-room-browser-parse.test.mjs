import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../apps/hearmeout/src/web-server-v3.ts", import.meta.url), "utf8");

test("HearMeOut v3 room browser bundle parses before deployment", () => {
  const marker = "export const HEARMEOUT_ROOM_BROWSER_JS=String.raw`";
  const start = source.indexOf(marker);
  assert.ok(start >= 0, "HearMeOut v3 room browser source must exist");
  const bodyStart = start + marker.length;
  const end = source.indexOf("`;\n\nasync function resolvePrincipal", bodyStart);
  assert.ok(end > bodyStart, "HearMeOut v3 room browser source must terminate before server helpers");
  const browserSource = source.slice(bodyStart, end);
  assert.doesNotThrow(() => new Function(browserSource));
  for (const pattern of [/Enter password/, /Open Commlink/, /Audio settings/, /Bots & personas/, /Leave room/, /Delete room/, /Timeout 10 minutes/, /Watch together/]) assert.match(browserSource, pattern);
});
