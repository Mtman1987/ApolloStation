import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  NEBULA_DISCORD_SHOWCASE_FRAME_COUNT,
  NEBULA_DISCORD_SHOWCASE_FRAME_DURATION_MS,
  NebulaArcadeProviderRuntime,
  SqliteNebulaDiscordDashboardStore,
  buildNebulaDiscordDashboard,
  createNebulaTagState,
  nebulaDiscordDashboardSignature,
  validateNebulaArcadeProviderConfig,
} from "../apps/nebula-arcade/dist/index.js";
import { renderNebulaArcadePage } from "../apps/nebula-arcade/dist/nebula-arcade-page.js";

const at = (minute) => new Date(Date.UTC(2026, 7, 29, 12, minute)).toISOString();

function dashboardState() {
  const state = createNebulaTagState("tenant-a");
  const player = (userId, username, score, tagsMade, timesTagged) => ({ userId, username, ...(userId === "beta" ? { avatarUrl: "https://cdn.discordapp.com/avatars/123/hash.webp?size=256" } : {}), joinedAt: at(0), lastActiveAt: at(4), score, tagsMade, timesTagged, passCount: 0, sleeping: false, offline: false, timedImmunityUntil: null, noTagbackFromUserId: null });
  state.players = { alpha: player("alpha", "Alpha", 400, 4, 2), beta: player("beta", "Beta", 300, 3, 3), gamma: player("gamma", "Gamma", 200, 2, 4) };
  state.currentItUserId = "beta";
  state.lastTagAt = at(4);
  state.history = [
    { id: "history-1", commandId: "command-1", kind: "tag", actorUserId: "beta", targetUserId: "gamma", channelId: "discord", occurredAt: at(2), doublePoints: false, scoreAwarded: 100 },
    { id: "history-2", commandId: "command-2", kind: "pass", actorUserId: "gamma", targetUserId: "alpha", channelId: "discord", occurredAt: at(3), doublePoints: true, scoreAwarded: 200 },
    { id: "history-3", commandId: "command-3", kind: "tag", actorUserId: "alpha", targetUserId: "beta", channelId: "discord", occurredAt: at(4), doublePoints: false, scoreAwarded: 100 },
  ];
  return state;
}

test("Nebula dashboard ports the compact two-row embed, 20-game link, and webhook identity", () => {
  const built = buildNebulaDiscordDashboard(dashboardState(), { publicOrigin: "https://apollo.example", generatedAt: at(5) });
  const embed = built.payload.embeds[0];
  assert.equal(built.webhookName, "Nebula Arcade");
  assert.equal(built.avatarUrl, "https://apollo.example/assets/nebula-arcade/icon.png");
  assert.equal(embed.title, "🎮 Nebula Arcade · Tag Live");
  assert.equal(embed.url, "https://apollo.example/apps/nebula-arcade?view=games");
  assert.equal(embed.image.url, "https://apollo.example/assets/nebula-arcade/games-showcase.gif?v=3");
  assert.equal(embed.thumbnail.url, "https://cdn.discordapp.com/avatars/123/hash.webp?size=256");
  assert.equal(embed.author.name, "Nebula Arcade · 20 Games");
  assert.deepEqual(embed.fields.slice(0, 3).map((field) => field.name), ["🎯 Current Tag", "📜 Recent Tags", "🏆 Top 3"]);
  assert.equal(embed.fields.length, 6);
  assert.equal(embed.fields.every((field) => field.inline), true);
  assert.equal(built.payload.components[0].components[0].label, "Open all 20 games");
  assert.deepEqual(built.payload.allowed_mentions, { parse: [] });
});

test("animated Discord showcase contains all 20 fallback frames at the improved doubled timing", () => {
  const data = readFileSync(new URL("../apps/nebula-arcade/assets/nebula-arcade-games-showcase.gif", import.meta.url));
  const delays = [];
  for (let index = 0; index < data.length - 7; index += 1) if (data[index] === 0x21 && data[index + 1] === 0xf9 && data[index + 2] === 0x04) delays.push(data.readUInt16LE(index + 4) * 10);
  assert.equal(NEBULA_DISCORD_SHOWCASE_FRAME_COUNT, 20);
  assert.equal(NEBULA_DISCORD_SHOWCASE_FRAME_DURATION_MS, 2_900);
  assert.equal(delays.length, 20);
  assert.deepEqual([...new Set(delays)], [2_900]);
  assert.equal(data.subarray(0, 6).toString("ascii"), "GIF89a");
  assert.equal(data.readUInt16LE(6), 800);
  assert.equal(data.readUInt16LE(8), 450);
});

test("dashboard uses the DSH gameplay rotation and refreshes at each ten-minute boundary", () => {
  const state = dashboardState();
  const first = buildNebulaDiscordDashboard(state, { publicOrigin: "https://apollo.example", gameplayOrigin: "https://dsh.example", generatedAt: at(5) });
  const second = buildNebulaDiscordDashboard(state, { publicOrigin: "https://apollo.example", gameplayOrigin: "https://dsh.example", generatedAt: at(15) });
  assert.match(first.payload.embeds[0].image.url, /^https:\/\/dsh\.example\/v1\/discord-stream-hub\/nebula-gameplay\/current\.gif\?slot=\d+$/);
  assert.notEqual(first.payload.embeds[0].image.url, second.payload.embeds[0].image.url);
  assert.notEqual(nebulaDiscordDashboardSignature(state, Date.parse(at(5))), nebulaDiscordDashboardSignature(state, Date.parse(at(15))));
});

test("games page advertises the animated large preview without changing the Apollo body", () => {
  const html = renderNebulaArcadePage({ nonce: "nonce", tenantId: "tenant-a", channelId: "channel", shellSurface: false, view: "games", publicOrigin: "https://apollo.example" });
  assert.match(html, /twitter:card" content="summary_large_image/);
  assert.match(html, /og:image" content="https:\/\/apollo\.example\/assets\/nebula-arcade\/games-showcase\.gif/);
  assert.equal((html.match(/data-game=/g) ?? []).length, 20);
  assert.match(html, /spmt-product-backdrop/);
});

test("dashboard message identity survives worker restart without storing webhook credentials", () => {
  const directory = mkdtempSync(join(tmpdir(), "nebula-dashboard-store-"));
  const path = join(directory, "nebula.sqlite");
  try {
    let store = new SqliteNebulaDiscordDashboardStore(path);
    store.put({ tenantId: "tenant-a", connectionId: "discord-main", channelId: "123456", messageId: "654321", transport: "webhook", updatedAt: at(5) });
    store.close();
    store = new SqliteNebulaDiscordDashboardStore(path);
    assert.deepEqual(store.get("tenant-a", "discord-main", "123456"), { tenantId: "tenant-a", connectionId: "discord-main", channelId: "123456", messageId: "654321", transport: "webhook", updatedAt: at(5) });
    store.close();
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("live Discord Tag mutations publish the durable Nebula dashboard through injected gateway egress", async () => {
  const directory = mkdtempSync(join(tmpdir(), "nebula-dashboard-runtime-"));
  const path = join(directory, "nebula.sqlite"), dashboards = [], replies = [];
  const config = validateNebulaArcadeProviderConfig({ schemaVersion: 1, revision: "dashboard", tenants: [{ tenantId: "tenant-a", pinUserId: "pin", channels: [{ provider: "discord", connectionId: "discord-main", channelId: "123456", stateChannelId: "apollo", enabledGameIds: ["tag"] }] }] });
  const runtime = new NebulaArcadeProviderRuntime({ databasePath: path, config, client: { publishEvent: async () => ({}), awardXp: async () => ({}) }, egress: { send: async (message) => { replies.push(message); return { providerMessageId: "777771" }; } }, discordDashboard: { publicOrigin: "https://apollo.example", gameplayOrigin: "https://dsh.example", egress: { upsertDiscordDashboard: async (message) => { dashboards.push(message); return { providerMessageId: "888881", transport: "webhook" }; } } }, now: () => at(5) });
  try {
    await runtime.consumers[0].deliver({ schemaVersion: 1, deliveryId: "delivery-1", consumerId: "nebula.arcade.provider-ingress", attempts: 1, message: { schemaVersion: 1, tenantId: "tenant-a", provider: "discord", connectionId: "discord-main", channelId: "123456", messageId: "444441", text: "spmt join", occurredAt: at(1), actor: { providerUserId: "user-1", canonicalUserId: "alpha", username: "alpha", displayName: "Alpha", avatarUrl: "https://cdn.discordapp.com/avatars/user-1/hash.webp?size=256", isBot: false, roles: ["member"] }, mentions: [] } });
    assert.equal(replies.length, 1);
    assert.equal(dashboards.length, 1);
    assert.equal(dashboards[0].webhookName, "Nebula Arcade");
    assert.equal(dashboards[0].payload.embeds[0].fields[0].name, "🎯 Current Tag");
    assert.equal(dashboards[0].payload.embeds[0].thumbnail.url, "https://cdn.discordapp.com/avatars/user-1/hash.webp?size=256");
  } finally { runtime.close(); rmSync(directory, { recursive: true, force: true }); }
});
