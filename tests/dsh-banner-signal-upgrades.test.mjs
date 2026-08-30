import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { DSH_BANNER_DURATION_SECONDS, DSH_BANNER_FPS, DSH_BANNER_GIF_PALETTE, DSH_BANNER_VERSION, SqliteDshRoleAwareBannerService, SqliteDshSignalSeekerStore, buildDshBannerHtml, dshBannerFrameTimesMs, dshSignalDropPayload, resolveDshBannerVariant } from "../apps/discord-stream-hub/dist/index.js";

test("role-aware banners keep commander, crew, and mountaineer visually distinct", async () => {
  assert.equal(resolveDshBannerVariant({ twitchLogin: "mtman1987" }), "commander");
  assert.equal(resolveDshBannerVariant({ twitchLogin: "crew_member", group: "Crew" }), "crew");
  assert.equal(resolveDshBannerVariant({ twitchLogin: "guest", group: "Partners" }), "mountaineer");
  const html = buildDshBannerHtml("crew_member", "crew");
  assert.match(html, /animation:banner-scroll 20s linear infinite/);
  assert.match(html, /translate3d\(-50%,0,0\)/);
  assert.equal((html.match(/class="message"/g) ?? []).length, 2);
  assert.equal(dshBannerFrameTimesMs().length, DSH_BANNER_FPS * DSH_BANNER_DURATION_SECONDS);
  assert.deepEqual(DSH_BANNER_GIF_PALETTE, { maxColors: 96, statsMode: "diff", dither: "bayer", bayerScale: 5, diffMode: "rectangle" });
});

test("role and generator version gate durable banner reuse", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "apollo-banner-"));
  let renders = 0;
  const service = new SqliteDshRoleAwareBannerService(path.join(dir, "banner.sqlite"), { renderGif: async (request) => { renders += 1; assert.equal(request.frameTimesMs.length, 200); return Uint8Array.from(Buffer.from("GIF89a-rendered")); } }, () => "2026-08-29T12:00:00.000Z");
  try {
    const first = await service.generate("viewer", "mountaineer");
    const replay = await service.generate("viewer", "mountaineer");
    assert.equal(first.version, DSH_BANNER_VERSION);
    assert.equal(replay.variant, "mountaineer");
    assert.equal(renders, 1);
    assert.equal(service.get("viewer", "crew"), undefined);
  } finally { service.close(); rmSync(dir, { recursive: true, force: true }); }
});

test("Signal drops ping only opt-in role and accept exactly one identity-bound claim", () => {
  const payload = dshSignalDropPayload("12345", "https://spmt.live/signal/drop-1");
  assert.deepEqual(payload.allowed_mentions, { parse: [], roles: ["12345"] });
  const dir = mkdtempSync(path.join(os.tmpdir(), "apollo-signal-"));
  const store = new SqliteDshSignalSeekerStore(path.join(dir, "signal.sqlite"));
  try {
    store.setSeeking({ tenantId: "tenant-a", providerUserId: "discord-1", canonicalUserId: "user-1", enabled: true, at: "2026-08-29T12:00:00Z" });
    store.createDrop({ dropId: "drop-1", tenantId: "tenant-a", channelId: "12345", messageId: "67890", roleId: "12345", signalUrl: "https://spmt.live/signal/drop-1", now: "2026-08-29T12:00:00Z" });
    const first = store.claim({ dropId: "drop-1", tenantId: "tenant-a", providerUserId: "discord-1", canonicalUserId: "user-1", at: "2026-08-29T12:01:00Z" });
    const second = store.claim({ dropId: "drop-1", tenantId: "tenant-a", providerUserId: "discord-2", canonicalUserId: "user-2", at: "2026-08-29T12:02:00Z" });
    assert.equal(first.won, true);
    assert.match(first.reward, /!signal <message>/);
    assert.equal(second.won, false);
    assert.equal(second.reason, "claimed");
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
});
