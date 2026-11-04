import assert from "node:assert/strict";
import test from "node:test";
import { buildDshProposalMessage } from "../apps/discord-stream-hub/dist/proposal-controls.js";

test("DSH proposal embeds preserve voting labels audience and safe reference metadata", () => {
  const payload = buildDshProposalMessage({
    title: "Adopt the new community event format",
    description: "Vote on whether the community should use the proposed event format next month.",
    audience: "community",
    approveLabel: "Approve",
    denyLabel: "Keep current format",
    approveEmoji: "✅",
    denyEmoji: "❌",
    color: 0x5865F2,
    referenceUrl: "https://spmt.live/docs",
  });
  assert.equal(payload.embeds[0].title, "Adopt the new community event format");
  assert.match(payload.embeds[0].fields[0].value, /✅ Approve/);
  assert.match(payload.embeds[0].fields[0].value, /❌ Keep current format/);
  assert.equal(payload.embeds[0].fields[1].value, "Full community review");
  assert.match(payload.embeds[0].fields[2].value, /https:\/\/spmt\.live\/docs/);
  assert.match(payload.embeds[0].footer.text, /Final decision remains owner\/admin controlled/);
  assert.deepEqual(payload.allowed_mentions, { parse: [] });
});

test("DSH proposal audience labels distinguish private administrative review", () => {
  const base = { title: "Review", description: "Review this proposal", approveLabel: "Yes", denyLabel: "No", approveEmoji: "👍", denyEmoji: "👎", color: 0x5865F2 };
  assert.equal(buildDshProposalMessage({ ...base, audience: "admin" }).embeds[0].fields[1].value, "Admin-only review");
  assert.equal(buildDshProposalMessage({ ...base, audience: "targeted" }).embeds[0].fields[1].value, "Targeted community review");
});
