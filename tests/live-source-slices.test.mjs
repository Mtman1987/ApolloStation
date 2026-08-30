import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const slices = JSON.parse(readFileSync(new URL("../config/live-source-slices.v1.json", import.meta.url), "utf8"));
const expected = new Map([
  ["Mtman1987/spmt-live", "e8241ad1682cadafa7c867e560fdb27360f99a06"],
  ["Mtman1987/spacemountain-live", "1dc2c1f02a7eb7bb9ddade3460c43ffa87858f43"],
  ["Mtman1987/streamweaver", "2079862f73e2d3938e2743e635f19609ab7791af"],
  ["Mtman1987/DiscordStreamHub", "36cb164af1bfcd069c0cf5e92066eddd8cc28f3b"],
  ["Mtman1987/hearmeout-main", "37b6ef3c2b4aabd6bf6624da8a4e38f74d5afbe4"],
  ["Mtman1987/chat-tag", "0dd1dd844f24a0c9bc0192a95af35c617d7ba728"],
  ["Mtman1987/fly-machine-rotator", "9f92c0deafc68b80145303a821625378679fdf7b"],
]);

test("live comparisons use current remote main and running slices without retained mirrors", () => {
  assert.equal(slices.schemaVersion, 1);
  assert.equal(slices.comparisonPolicy.sourceOfComparison, "remote-main-and-running-live-slice");
  assert.equal(slices.comparisonPolicy.retainLocalMirrors, false);
  assert.equal(slices.comparisonPolicy.mutateLiveFlyApps, false);
  assert.equal(slices.sources.length, expected.size);
  for (const source of slices.sources) {
    assert.equal(source.currentMain, expected.get(source.repository), source.repository);
    assert.equal(source.localMirrorRetained, false);
    assert.equal(source.lastTwoCommits.length, 2);
    assert.equal(source.lastTwoCommits[0].sha, source.currentMain);
    assert.ok(source.evidence.length > 0);
  }
});

test("the two advanced live repositories record Apollo port evidence", () => {
  const dsh = slices.sources.find((source) => source.repository === "Mtman1987/DiscordStreamHub");
  const nebula = slices.sources.find((source) => source.repository === "Mtman1987/chat-tag");
  assert.equal(dsh.disposition, "ported");
  assert.equal(nebula.disposition, "ported");
  assert.ok(dsh.evidence.includes("tests/dsh-nebula-gameplay-rotation.test.mjs"));
  assert.ok(nebula.evidence.includes("tests/nebula-discord-dashboard.test.mjs"));
});
