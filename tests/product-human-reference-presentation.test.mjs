import test from "node:test";
import assert from "node:assert/strict";
import { applyHumanReferencesToOperations, collectOperationsHumanReferences } from "../packages/app-foundation/dist/product-web.js";

test("shared product snapshots discover only semantically identified provider references", () => {
  const logs = [{ summary: "accepted user 737589459347", detail: "server 837589459347 channel 1004895478763 message 303039283; total 999999999999" }];
  const refs = collectOperationsHumanReferences(logs);
  assert.equal(refs.some((ref) => ref.kind === "user" && ref.id === "737589459347"), true);
  assert.equal(refs.some((ref) => ref.kind === "guild" && ref.id === "837589459347"), true);
  assert.equal(refs.some((ref) => ref.kind === "channel" && ref.id === "1004895478763"), true);
  assert.equal(refs.some((ref) => ref.kind === "message" && ref.id === "303039283" && ref.channelId === "1004895478763"), true);
  assert.equal(refs.some((ref) => ref.id === "999999999999"), false);
});

test("shared product snapshots present names while leaving source records untouched", () => {
  const source = [{ summary: "accepted user 737589459347", detail: "channel 1004895478763 message 303039283" }];
  const refs = [
    { schemaVersion: 1, provider: "discord", kind: "user", id: "737589459347", label: "SaltyBear", resolved: true },
    { schemaVersion: 1, provider: "discord", kind: "channel", id: "1004895478763", label: "#general", secondary: "Space Mountain", resolved: true },
    { schemaVersion: 1, provider: "discord", kind: "message", id: "303039283", channelId: "1004895478763", label: "Message “hello there”", resolved: true },
  ];
  const presented = applyHumanReferencesToOperations(source, refs);
  assert.equal(source[0].summary, "accepted user 737589459347");
  assert.equal(source[0].detail, "channel 1004895478763 message 303039283");
  assert.equal(presented[0].summary, "accepted user SaltyBear");
  assert.equal(presented[0].detail, "channel #general (Space Mountain) message Message “hello there”");
  assert.equal(presented[0].presentation.summary, "accepted user SaltyBear");
});
