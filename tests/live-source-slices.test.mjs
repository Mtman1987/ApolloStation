import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const slices = JSON.parse(readFileSync(new URL("../config/live-source-slices.v1.json", import.meta.url), "utf8"));
const expected = new Map([
  ["Mtman1987/spmt-live", "df18ae6bd7becd784fa5d614d9119d73b59e5b0e"],
  ["Mtman1987/spacemountain-live", "3dcb653cd99cc10d1f7d791c8584f869797577cf"],
  ["Mtman1987/streamweaver", "a29dd7e5260c673b7260bec7ad70de2040e077be"],
  ["Mtman1987/DiscordStreamHub", "d97af868a3929e44b02103c347bb5680abe4c465"],
  ["Mtman1987/hearmeout-main", "c12415b76bd51b7690fcb46ca67879f1becc17f6"],
  ["Mtman1987/chat-tag", "42cb6401b3adf87a8c008474787d05d1dcf757db"],
  ["Mtman1987/fly-machine-rotator", "01cc5d4f2276bfe575484a9c81a18636a6437c7d"],
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
