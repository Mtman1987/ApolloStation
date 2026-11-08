import test from "node:test";
import assert from "node:assert/strict";
import { mergeNebulaRuntimeConfig } from "../scripts/hostless/nebula-runtime-config.mjs";

test("Nebula runtime config retains saved tenant settings and merges active Chat Gateway channels", () => {
  const saved = { schemaVersion: 1, revision: "saved", tenants: [
    { tenantId: "spacemountainlive", pinUserId: "provider:twitch:123", channels: [] },
  ] };
  const discovered = { schemaVersion: 1, revision: "discovered", tenants: [
    { tenantId: "spacemountainlive", channels: [
      { provider: "twitch", connectionId: "twitch-bot-a", channelId: "spacemountainlive", stateChannelId: "spacemountainlive", enabledGameIds: ["tag"] },
    ] },
    { tenantId: "another-workspace", channels: [
      { provider: "twitch", connectionId: "twitch-bot-b", channelId: "other", stateChannelId: "other", enabledGameIds: ["tag"] },
    ] },
  ] };
  const merged = mergeNebulaRuntimeConfig(saved, discovered);
  assert.equal(merged.tenants.length, 2);
  assert.equal(merged.tenants[0].pinUserId, "provider:twitch:123");
  assert.equal(merged.tenants[0].channels.length, 1);
  assert.equal(merged.tenants[1].channels[0].channelId, "other");
});

test("Nebula runtime config does not duplicate a channel already saved", () => {
  const channel = { provider: "twitch", connectionId: "bot", channelId: "spacemountainlive", stateChannelId: "spacemountainlive", enabledGameIds: ["tag"] };
  const merged = mergeNebulaRuntimeConfig(
    { schemaVersion: 1, revision: "saved", tenants: [{ tenantId: "spacemountainlive", channels: [channel] }] },
    { schemaVersion: 1, revision: "discovered", tenants: [{ tenantId: "spacemountainlive", channels: [channel] }] },
  );
  assert.equal(merged.tenants[0].channels.length, 1);
});
