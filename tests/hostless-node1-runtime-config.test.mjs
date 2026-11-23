import test from "node:test";
import assert from "node:assert/strict";
import { resolveNode1StellarChatConfig } from "../scripts/hostless/node1-runtime-config.mjs";

test("Node 1 disables Stellar Chat when no existing worker credential is available", () => {
  assert.deepEqual(resolveNode1StellarChatConfig("", ""), { enabled: "0", credential: "" });
  assert.deepEqual(resolveNode1StellarChatConfig(undefined, "   "), { enabled: "0", credential: "" });
});
test("Node 1 enables Stellar Chat only when a node-specific or shared credential exists", () => {
  assert.deepEqual(resolveNode1StellarChatConfig(" node-credential ", "shared-credential"), { enabled: "1", credential: "node-credential" });
  assert.deepEqual(resolveNode1StellarChatConfig("", " shared-credential "), { enabled: "1", credential: "shared-credential" });
});
