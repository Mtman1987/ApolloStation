import type { DshLiveMemberV1, DshLivePollResultV1, DshLiveRuntime, DshTwitchStreamV1 } from "./live-monitor.js";

export interface DshLiveMemberDirectoryV1 { listLiveTrackedMembers(tenantId: string): Promise<DshLiveMemberV1[]>; }
export type DshTwitchGrantResultV1 =
  | { status: "ready"; clientId: string; accessToken: string; expiresAt: string }
  | { status: "reauthorization-required"; reason: string }
  | { status: "unavailable"; reason: string };
export interface DshTwitchGrantSourceV1 { getGrant(tenantId: string): Promise<DshTwitchGrantResultV1>; }
export interface DshTwitchLiveClientV1 {
  getStreams(input: { clientId: string; accessToken: string; twitchLogins: string[] }): Promise<Array<{ id: string; user_login: string; user_name: string; title: string; game_name: string; viewer_count: number; thumbnail_url: string; started_at: string }>>;
}

export type DshLivePollExecutionV1 =
  | { status: "completed"; poll: { tenantId: string; pollId: string; observedAt: string; memberCount: number; liveCount: number }; result: DshLivePollResultV1 & { delivery: { attempted: number; delivered: number; failed: number } } }
  | { status: "reauthorization-required" | "unavailable"; reason: string };

export class DshTwitchLivePoller {
  constructor(private readonly members: DshLiveMemberDirectoryV1, private readonly grants: DshTwitchGrantSourceV1, private readonly twitch: DshTwitchLiveClientV1, private readonly runtime: DshLiveRuntime) {}

  async poll(tenantId: string, pollId: string, observedAt = new Date().toISOString()): Promise<DshLivePollExecutionV1> {
    requireId(tenantId, "tenantId"); requireId(pollId, "pollId");
    if (!Number.isFinite(Date.parse(observedAt))) throw new Error("DSH poll observedAt is invalid");
    const tracked = await this.members.listLiveTrackedMembers(tenantId);
    const unique = validateMembers(tracked);
    if (!unique.length) {
      const result = await this.runtime.reconcile({ schemaVersion: 1, tenantId, pollId, observedAt: new Date(observedAt).toISOString(), members: [], streams: [] });
      return { status: "completed", poll: { tenantId, pollId, observedAt: new Date(observedAt).toISOString(), memberCount: 0, liveCount: 0 }, result };
    }
    let grant: DshTwitchGrantResultV1;
    try { grant = await this.grants.getGrant(tenantId); }
    catch (error) { return { status: "unavailable", reason: redact(errorText(error)) }; }
    if (grant.status !== "ready") return { status: grant.status, reason: redact(grant.reason) };
    if (!grant.clientId || !grant.accessToken || !Number.isFinite(Date.parse(grant.expiresAt))) return { status: "reauthorization-required", reason: "Twitch grant is incomplete or expired" };

    const streams: DshTwitchStreamV1[] = [];
    try {
      for (const batch of chunks(unique.map((member) => member.twitchLogin.toLowerCase()), 100)) {
        const rows = await this.twitch.getStreams({ clientId: grant.clientId, accessToken: grant.accessToken, twitchLogins: batch });
        streams.push(...normalizeStreams(rows, new Set(batch)));
      }
    } catch (error) {
      if (error instanceof TwitchHelixError && error.status === 401) return { status: "reauthorization-required", reason: "Twitch rejected the current SPMT provider grant" };
      return { status: "unavailable", reason: redact(errorText(error)) };
    }
    const result = await this.runtime.reconcile({ schemaVersion: 1, tenantId, pollId, observedAt: new Date(observedAt).toISOString(), members: unique, streams });
    return { status: "completed", poll: { tenantId, pollId, observedAt: new Date(observedAt).toISOString(), memberCount: unique.length, liveCount: streams.length }, result };
  }
}

export class TwitchHelixLiveClient implements DshTwitchLiveClientV1 {
  constructor(private readonly fetchImpl: typeof fetch = fetch) {}
  async getStreams(input: { clientId: string; accessToken: string; twitchLogins: string[] }): Promise<Array<{ id: string; user_login: string; user_name: string; title: string; game_name: string; viewer_count: number; thumbnail_url: string; started_at: string }>> {
    if (!input.clientId || !input.accessToken || input.twitchLogins.length < 1 || input.twitchLogins.length > 100) throw new Error("Twitch live lookup input is invalid");
    const url = new URL("https://api.twitch.tv/helix/streams");
    for (const login of input.twitchLogins) url.searchParams.append("user_login", login);
    const response = await this.fetchImpl(url, { headers: { "client-id": input.clientId, authorization: `Bearer ${input.accessToken}` } });
    if (!response.ok) throw new TwitchHelixError(response.status, response.status === 401 ? "Twitch provider authorization failed" : `Twitch live lookup failed (${response.status})`);
    const payload = await response.json() as { data?: unknown };
    if (!Array.isArray(payload.data)) throw new Error("Twitch live lookup returned an invalid response");
    return payload.data as Array<{ id: string; user_login: string; user_name: string; title: string; game_name: string; viewer_count: number; thumbnail_url: string; started_at: string }>;
  }
}

export class TwitchHelixError extends Error { constructor(readonly status: number, message: string) { super(message); this.name = "TwitchHelixError"; } }

function validateMembers(members: DshLiveMemberV1[]): DshLiveMemberV1[] {
  const users = new Set<string>(); const logins = new Set<string>();
  return [...members].sort((a, b) => a.twitchLogin.localeCompare(b.twitchLogin)).map((member) => {
    requireId(member.canonicalUserId, "canonicalUserId"); requireId(member.discordUserId, "discordUserId"); requireId(member.twitchLogin, "twitchLogin"); requireId(member.shoutoutChannelId, "shoutoutChannelId");
    const login = member.twitchLogin.toLowerCase();
    if (users.has(member.canonicalUserId) || logins.has(login)) throw new Error("DSH tracked members must have unique canonical users and Twitch logins");
    users.add(member.canonicalUserId); logins.add(login);
    return { ...member, twitchLogin: login };
  });
}
function normalizeStreams(rows: Awaited<ReturnType<DshTwitchLiveClientV1["getStreams"]>>, requested: Set<string>): DshTwitchStreamV1[] {
  const seen = new Set<string>(); const result: DshTwitchStreamV1[] = [];
  for (const row of rows) {
    const login = String(row.user_login || "").toLowerCase();
    if (!requested.has(login) || seen.has(login)) continue;
    if (!row.id || !login || !Number.isSafeInteger(row.viewer_count) || row.viewer_count < 0 || !Number.isFinite(Date.parse(row.started_at))) throw new Error("Twitch returned an invalid stream snapshot");
    seen.add(login);
    result.push({ twitchLogin: login, twitchStreamId: row.id, displayName: String(row.user_name || login), title: String(row.title || ""), gameName: String(row.game_name || ""), viewerCount: row.viewer_count, thumbnailUrl: String(row.thumbnail_url || ""), startedAt: new Date(row.started_at).toISOString() });
  }
  return result;
}
function chunks<T>(values: T[], size: number): T[][] { const result: T[][] = []; for (let index = 0; index < values.length; index += size) result.push(values.slice(index, index + size)); return result; }
function requireId(value: string, name: string): void { if (!value || value.trim() !== value || value.length > 300 || !/^[A-Za-z0-9._:@/-]+$/.test(value)) throw new Error(`${name} is invalid`); }
function errorText(error: unknown): string { return error instanceof Error ? error.message : String(error); }
function redact(value: string): string { return value.replace(/\bBearer\s+\S+/gi, "Bearer [REDACTED]").replace(/((?:token|secret|password|authorization)\s*[:=]\s*)\S+/gi, "$1[REDACTED]").slice(0, 1_000); }
