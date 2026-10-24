// Ported from hearmeout-main fd3d0e6/ad2c5d5: safe Xtream direct-playback probe.
// Reads at most the first response chunk of a VOD stream with a byte-range request.
// Never returns the provider URL or credentials, and never transcodes.
export interface HearMeOutXtreamConfigV1 { baseUrl: string; username: string; password: string }

export function hearMeOutXtreamConfig(env: NodeJS.ProcessEnv = process.env): HearMeOutXtreamConfigV1 | undefined {
  const baseUrl = env.XTREAM_BASE_URL?.replace(/\/$/, ""), username = env.XTREAM_USERNAME, password = env.XTREAM_PASSWORD;
  return baseUrl && username && password ? { baseUrl, username, password } : undefined;
}

export function hearMeOutXtreamVodUrl(config: HearMeOutXtreamConfigV1, streamId: string, extension = "mp4"): URL {
  const id = String(streamId).replace(/[^0-9]/g, ""), ext = /^[a-z0-9]{1,8}$/i.test(extension) ? extension : "mp4";
  if (!id) throw Error("Invalid Xtream stream id");
  return new URL(`/movie/${encodeURIComponent(config.username)}/${encodeURIComponent(config.password)}/${id}.${ext}`, config.baseUrl);
}

export interface HearMeOutXtreamProbeResultV1 { status: number; body: Record<string, unknown> }

export async function probeHearMeOutXtreamDirect(streamId: string, options: { resolve?: (id: string) => Promise<URL> | URL; fetchImpl?: typeof fetch; timeoutMs?: number; extension?: string } = {}): Promise<HearMeOutXtreamProbeResultV1> {
  const id = String(streamId || "").replace(/[^0-9]/g, "");
  if (!id || id.length > 20) return { status: 400, body: { ok: false, error: "Provide a numeric VOD stream ID." } };
  const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 8_000);
  let response: Response | undefined;
  try {
    const resolve = options.resolve ?? ((value: string) => { const config = hearMeOutXtreamConfig(); if (!config) throw Error("Xtream provider is not configured"); return hearMeOutXtreamVodUrl(config, value, options.extension); });
    const source = await resolve(id);
    response = await (options.fetchImpl ?? fetch)(source, { method: "GET", headers: { Range: "bytes=0-63", "User-Agent": "HearMeOut-Direct-Playback-Probe/1.0" }, redirect: "follow", signal: controller.signal });
    const contentType = String(response.headers.get("content-type") || "unknown").split(";")[0]!.trim().slice(0, 100);
    const contentRange = response.headers.get("content-range"), reader = response.body?.getReader();
    let firstBytes = 0, signature = "unavailable";
    if (reader) { try { const chunk = await reader.read(); if (!chunk.done && chunk.value) { firstBytes = Math.min(chunk.value.byteLength, 64); signature = Array.from(chunk.value.slice(0, 16)).map((b) => b.toString(16).padStart(2, "0")).join(""); } } finally { await reader.cancel().catch(() => {}); } }
    const streamReturned = response.ok && firstBytes > 0, looksLikePlaylist = contentType.includes("mpegurl") || contentType.includes("vnd.apple"), looksLikeVideo = contentType.startsWith("video/") || contentType === "application/octet-stream";
    return { status: 200, body: { ok: streamReturned, streamId: id, upstreamStatus: response.status, contentType, contentLength: response.headers.get("content-length"), acceptRanges: response.headers.get("accept-ranges"), contentRange, rangeHonored: response.status === 206 && Boolean(contentRange), firstBytesRead: firstBytes, firstBytesHex: signature, formatHint: looksLikePlaylist ? "playlist/HLS" : looksLikeVideo ? "video-or-binary" : "unknown-content-type", directPlaybackSignal: streamReturned && !looksLikePlaylist && looksLikeVideo, notes: ["Provider URL and credentials are deliberately not returned.", "This probe reads at most the first response chunk and cancels the stream.", "A successful range probe does not prove browser CORS or codec compatibility."] } };
  } catch (error) {
    return { status: 502, body: { ok: false, streamId: id, error: controller.signal.aborted ? "Provider probe timed out." : "Provider probe failed; check provider configuration and stream ID.", detail: error instanceof Error ? error.name : "UnknownError", notes: ["No provider URL or credentials are returned."] } };
  } finally { clearTimeout(timeout); if (response?.body && !response.body.locked) await response.body.cancel().catch(() => {}); }
}
