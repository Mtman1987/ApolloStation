import { dshGuestLogin, type DshGuestProfileV1 } from "./guest-shoutouts.js";
import type { DshLiveMemberV1, DshLivePollResultV1, DshLiveRuntime, DshTwitchStreamV1 } from "./live-monitor.js";

export interface DshLiveMemberDirectoryV1 { listLiveTrackedMembers(tenantId: string): Promise<DshLiveMemberV1[]>; getPollSettings?(tenantId: string): { spotlightEnabled: boolean }; }
export type DshTwitchGrantResultV1 =
  | { status: "ready"; clientId: string; accessToken: string; expiresAt: string }
  | { status: "reauthorization-required"; reason: string }
  | { status: "unavailable"; reason: string };
export interface DshTwitchGrantSourceV1 { getGrant(tenantId: string): Promise<DshTwitchGrantResultV1>; }
export interface DshTwitchLiveClientV1 {
  getStreams(input: { clientId: string; accessToken: string; twitchLogins: string[] }): Promise<Array<{ id: string; user_login: string; user_name: string; title: string; game_name: string; viewer_count: number; thumbnail_url: string; profile_image_url?: string; started_at: string }>>;
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
    const spotlightEnabled = this.members.getPollSettings?.(tenantId).spotlightEnabled ?? true;
    const unique = validateMembers(tracked);
    const guests=this.runtime.guestTargets?.(tenantId)??[],logins=[...new Set([...unique.map(member=>member.twitchLogin.toLowerCase()),...guests.map(target=>target.twitchLogin)])];
    if (!logins.length) {
      const result = await this.runtime.reconcile({ schemaVersion: 1, tenantId, pollId, observedAt: new Date(observedAt).toISOString(), members: [], streams: [], spotlightEnabled });
      return { status: "completed", poll: { tenantId, pollId, observedAt: new Date(observedAt).toISOString(), memberCount: 0, liveCount: 0 }, result };
    }
    let grant: DshTwitchGrantResultV1;
    try { grant = await this.grants.getGrant(tenantId); }
    catch (error) { return { status: "unavailable", reason: redact(errorText(error)) }; }
    if (grant.status !== "ready") return { status: grant.status, reason: redact(grant.reason) };
    if (!grant.clientId || !grant.accessToken || !Number.isFinite(Date.parse(grant.expiresAt))) return { status: "reauthorization-required", reason: "Twitch grant is incomplete or expired" };

    const streams: DshTwitchStreamV1[] = [];
    try {
      for (const batch of chunks(logins, 100)) {
        const rows = await this.twitch.getStreams({ clientId: grant.clientId, accessToken: grant.accessToken, twitchLogins: batch });
        streams.push(...normalizeStreams(rows, new Set(batch)));
      }
    } catch (error) {
      if (error instanceof TwitchHelixError && error.status === 401) return { status: "reauthorization-required", reason: "Twitch rejected the current SPMT provider grant" };
      return { status: "unavailable", reason: redact(errorText(error)) };
    }
    const result = await this.runtime.reconcile({ schemaVersion: 1, tenantId, pollId, observedAt: new Date(observedAt).toISOString(), members: unique, streams, spotlightEnabled });
    return { status: "completed", poll: { tenantId, pollId, observedAt: new Date(observedAt).toISOString(), memberCount: unique.length, liveCount: streams.filter(stream=>unique.some(member=>member.twitchLogin.toLowerCase()===stream.twitchLogin)).length }, result };
  }
}

export class TwitchHelixLiveClient implements DshTwitchLiveClientV1 {
  private readonly avatars=new Map<string,{url:string;expires:number}>();
  constructor(private readonly fetchImpl: typeof fetch = fetch) {}
  async getGuest(input:{clientId:string;accessToken:string;twitchLogin:string}):Promise<DshGuestProfileV1>{
    const login=dshGuestLogin(input.twitchLogin),url=new URL("https://api.twitch.tv/helix/users");url.searchParams.set("login",login);
    const response=await this.fetchImpl(url,{headers:{"client-id":input.clientId,authorization:`Bearer ${input.accessToken}`},redirect:"error",signal:AbortSignal.timeout(15000)});
    if(!response.ok)throw new TwitchHelixError(response.status,`Twitch profile lookup failed (${response.status})`);
    const body=await response.json() as {data?:Array<{login?:string;display_name?:string;profile_image_url?:string}>},profile=body.data?.find(item=>item.login?.toLowerCase()===login);
    if(!profile)throw Error("That Twitch creator was not found");
    const rows=await this.getStreams({...input,twitchLogins:[login]}),stream=normalizeStreams(rows,new Set([login]))[0];
    return {twitchLogin:login,displayName:profile.display_name||login,...(profile.profile_image_url?{avatarUrl:profile.profile_image_url}:{}),...(stream?{stream}:{})};
  }
  async getStreams(input: { clientId: string; accessToken: string; twitchLogins: string[] }): Promise<Array<{ id: string; user_login: string; user_name: string; title: string; game_name: string; viewer_count: number; thumbnail_url: string; profile_image_url?: string; started_at: string }>> {
    if (!input.clientId || !input.accessToken || input.twitchLogins.length < 1 || input.twitchLogins.length > 100) throw new Error("Twitch live lookup input is invalid");
    const url = new URL("https://api.twitch.tv/helix/streams");
    for (const login of input.twitchLogins) url.searchParams.append("user_login", login);
    const response = await this.fetchImpl(url, { headers: { "client-id": input.clientId, authorization: `Bearer ${input.accessToken}` }, redirect:"error",signal:AbortSignal.timeout(15000) });
    if (!response.ok) throw new TwitchHelixError(response.status, response.status === 401 ? "Twitch provider authorization failed" : `Twitch live lookup failed (${response.status})`);
    const payload = await response.json() as { data?: unknown };
    if (!Array.isArray(payload.data)) throw new Error("Twitch live lookup returned an invalid response");
    const rows=payload.data as Awaited<ReturnType<DshTwitchLiveClientV1['getStreams']>>;
    const missing=rows.map(row=>row.user_login).filter(login=>typeof login==='string'&&(!this.avatars.has(login)||this.avatars.get(login)!.expires<Date.now()));
    if(missing.length)try{
      const users=new URL('https://api.twitch.tv/helix/users');for(const login of missing)users.searchParams.append('login',login);
      const profiles=await this.fetchImpl(users,{headers:{'client-id':input.clientId,authorization:`Bearer ${input.accessToken}`},signal:AbortSignal.timeout(5000)});
      if(profiles.ok){const body=await profiles.json() as {data?:Array<{login?:string;profile_image_url?:string}>};for(const profile of Array.isArray(body.data)?body.data:[])if(profile.login&&profile.profile_image_url?.startsWith('https://'))this.avatars.set(profile.login,{url:profile.profile_image_url,expires:Date.now()+1800000});}
    }catch{/* Avatar availability must not mark a live creator offline. */}
    return rows.map(row=>({...row,...(this.avatars.get(row.user_login)?{profile_image_url:this.avatars.get(row.user_login)!.url}:{})}));
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
    result.push({ twitchLogin: login, twitchStreamId: row.id, displayName: String(row.user_name || login), title: String(row.title || ""), gameName: String(row.game_name || ""), viewerCount: row.viewer_count, thumbnailUrl: String(row.thumbnail_url || ""), ...(row.profile_image_url?{avatarUrl:row.profile_image_url}:{}), startedAt: new Date(row.started_at).toISOString() });
  }
  return result;
}
function chunks<T>(values: T[], size: number): T[][] { const result: T[][] = []; for (let index = 0; index < values.length; index += size) result.push(values.slice(index, index + size)); return result; }
function requireId(value: string, name: string): void { if (!value || value.trim() !== value || value.length > 300 || !/^[A-Za-z0-9._:@/-]+$/.test(value)) throw new Error(`${name} is invalid`); }
function errorText(error: unknown): string { return error instanceof Error ? error.message : String(error); }
function redact(value: string): string { return value.replace(/\bBearer\s+\S+/gi, "Bearer [REDACTED]").replace(/((?:token|secret|password|authorization)\s*[:=]\s*)\S+/gi, "$1[REDACTED]").slice(0, 1_000); }
