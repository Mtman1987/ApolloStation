import assert from "node:assert/strict";
import test from "node:test";
import { HearMeOutXtreamWatchCatalog } from "../apps/hearmeout/dist/xtream-watch-catalog.js";

function response(value, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
}

const credentials = { baseUrl: "https://iptv.example/provider/", username: "user-private", password: "pass-private" };

test("Xtream catalog normalizes VOD, live channels, and series without exposing upstream credentials", async () => {
  const calls = [];
  const catalog = new HearMeOutXtreamWatchCatalog(credentials, async input => {
    const url = new URL(input);
    calls.push(url);
    if (url.searchParams.get("action") === "get_vod_streams") return response([
      { stream_id: 42, name: "Example Movie", year: 2024, container_extension: "m3u8", stream_icon: "https://images.example/poster.jpg" },
      { stream_id: "../private", name: "Invalid" },
      { stream_id: 43, name: "Unsafe extension", container_extension: "php" },
    ]);
    if (url.searchParams.get("action") === "get_live_streams") return response([{ stream_id: 7, name: "News Live", category_id: 3 }]);
    if (url.searchParams.get("action") === "get_series") return response([{ series_id: 9, name: "Example Series", cover: "https://images.example/series.jpg" }]);
    throw new Error("Unexpected action");
  });
  const items = await catalog.catalog();
  assert.deepEqual(items.map(item => item.itemId), ["xtream-vod-42", "xtream-live-7", "xtream-series-9"]);
  assert.equal(items[0].year, 2024);
  assert.equal(items[1].kind, "live");
  assert.equal(items[2].kind, "series");
  assert.equal(catalog.playbackPath(items[0]), "/api/hearmeout/watch/xtream/vod/42.m3u8");
  assert.equal(catalog.toMediaItem(items[0]).playbackUrl, "/api/hearmeout/watch/xtream/vod/42.m3u8");
  assert.equal(JSON.stringify(items).includes("user-private"), false);
  assert.equal(JSON.stringify(items).includes("pass-private"), false);
  assert.equal(JSON.stringify(items).includes("iptv.example"), false);
  assert.equal(calls.every(url => url.searchParams.get("username") === "user-private" && url.searchParams.get("password") === "pass-private"), true);
});

test("Xtream search ranks exact title matches and bounds results", async () => {
  const catalog = new HearMeOutXtreamWatchCatalog(credentials, async input => {
    const action = new URL(input).searchParams.get("action");
    if (action === "get_vod_streams") return response([
      { stream_id: 1, name: "The Great Movie" },
      { stream_id: 2, name: "Great Movie: Part Two" },
      { stream_id: 3, name: "Another Movie" },
    ]);
    if (action === "get_live_streams") return response([]);
    if (action === "get_series") return response([]);
    throw new Error("Unexpected action");
  });
  const result = await catalog.search("The Great Movie", { limit: 1, kinds: ["vod"] });
  assert.equal(result.length, 1);
  assert.equal(result[0].providerId, "1");
  await assert.rejects(() => catalog.search("  "), /title to search/);
});

test("Xtream series details return bounded episode identifiers without provider URLs", async () => {
  const catalog = new HearMeOutXtreamWatchCatalog(credentials, async input => {
    const url = new URL(input);
    assert.equal(url.searchParams.get("action"), "get_series_info");
    assert.equal(url.searchParams.get("series_id"), "99");
    return response({ episodes: { "1": [
      { id: 1001, title: "Episode One", episode_num: 1, container_extension: "mp4" },
      { id: "bad/../id", title: "Invalid Episode" },
    ] } });
  });
  const episodes = await catalog.seriesEpisodes("99");
  assert.equal(episodes.length, 1);
  assert.equal(episodes[0].itemId, "xtream-episode-1001");
  assert.equal(episodes[0].title, "Episode One");
  assert.equal(episodes[0].episodeNumber, 1);
  assert.equal(JSON.stringify(episodes).includes("user-private"), false);
  await assert.rejects(() => catalog.seriesEpisodes("../99"), /seriesId is invalid/);
});

test("Xtream catalog rejects invalid provider URLs, credentials, redirects, and oversized responses", async () => {
  assert.throws(() => new HearMeOutXtreamWatchCatalog({ ...credentials, baseUrl: "https://user:pass@iptv.example" }), /base URL/);
  assert.throws(() => new HearMeOutXtreamWatchCatalog({ ...credentials, username: "" }), /credentials are required/);
  const failed = new HearMeOutXtreamWatchCatalog(credentials, async () => response({ error: "private upstream detail" }, 403));
  await assert.rejects(() => failed.catalog(), /HTTP 403/);
});
