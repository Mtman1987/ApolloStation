import {randomUUID} from "node:crypto";
import {DatabaseSync} from "node:sqlite";
import type {SpmtClient} from "@spmt/sdk";
import {listCommunityIdentities, type SpmtCommunityIdentityV1} from "@spmt/sdk/provider-identity";
import type {DshDiscordApi} from "./discord-live-publisher.js";
import type {DshLiveMemberV1} from "./live-monitor.js";
import type {DshLiveRuntimeConfigV1} from "./live-worker.js";
import type {DshTenantSettingsStore} from "./settings.js";
import {dshShoutoutGroupSlug} from "./shoutout-groups.js";
import type {DshTwitchGrantSourceV1, TwitchHelixLiveClient} from "./twitch-live-poller.js";

type GuildSnapshot = Awaited<ReturnType<DshDiscordApi["memberDirectory"]>>;
interface Snapshot {identities: SpmtCommunityIdentityV1[]; guilds: GuildSnapshot[]; twitch: Array<{id: string; login: string}>; identityCheckedAt?: string; checkedAt?: string; attemptedAt?: string; error?: string | undefined;}
export interface DshDirectoryRow {guildId: string; discordUserId: string; displayName: string; roleIds: string[]; group: DshLiveMemberV1["group"]; canonicalUserId?: string; twitchLogin?: string; shoutoutChannelId?: string; issue?: string; bannerUrl?: string; partnerDiscordUrl?: string;}
export type DshMemberSource = (tenant: string, guild?: string) => DshLiveMemberV1[];

/** Provider observations only. Linking, unlinking and community membership stay in SPMT. */
export class DshMemberDirectoryStore {
  private readonly db: DatabaseSync;
  constructor(path: string, private readonly config: DshLiveRuntimeConfigV1, private readonly settings: DshTenantSettingsStore, private readonly clock = Date.now) {
    this.db = new DatabaseSync(path, {timeout: 5000});
    this.db.exec("PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS dsh_member_directory(tenant TEXT PRIMARY KEY,body TEXT,owner TEXT,expires INTEGER NOT NULL DEFAULT 0)");
  }
  close() { this.db.close(); }
  snapshot(tenant: string): Snapshot | undefined { const row = this.db.prepare("SELECT body FROM dsh_member_directory WHERE tenant=?").get(tenant) as {body: string | null} | undefined; return row?.body ? JSON.parse(row.body) : undefined; }
  acquire(tenant: string, owner: string) { return Boolean(this.db.prepare("INSERT INTO dsh_member_directory(tenant,owner,expires) VALUES(?,?,?) ON CONFLICT(tenant) DO UPDATE SET owner=excluded.owner,expires=excluded.expires WHERE expires<=?").run(tenant, owner, this.clock()+120000, this.clock()).changes); }
  renew(tenant: string, owner: string) { if (!this.db.prepare("UPDATE dsh_member_directory SET expires=? WHERE tenant=? AND owner=? AND expires>?").run(this.clock()+120000, tenant, owner, this.clock()).changes) throw Error("Member directory lease expired"); }
  save(tenant: string, owner: string, snapshot: Snapshot) { if (!this.db.prepare("UPDATE dsh_member_directory SET body=? WHERE tenant=? AND owner=? AND expires>?").run(JSON.stringify(snapshot), tenant, owner, this.clock()).changes) throw Error("Member directory lease expired"); }
  release(tenant: string, owner: string) { this.db.prepare("UPDATE dsh_member_directory SET owner=NULL,expires=0 WHERE tenant=? AND owner=?").run(tenant, owner); }
  view(tenant: string, guild?: string) {
    const snapshot = this.snapshot(tenant), config = this.config.tenants.find(t => t.tenantId === tenant), saved = this.settings.read(tenant);
    const identities = new Map<string, SpmtCommunityIdentityV1>();
    for (const person of snapshot?.identities ?? []) for (const provider of person.providers) if (provider.provider === "discord") identities.set(provider.providerUserId, person);
    const twitch = new Map(snapshot?.twitch.map(user => [user.id, user.login]) ?? []);
    const rows: DshDirectoryRow[] = [], seeds = new Map((config?.members ?? []).map(member => [`${member.canonicalUserId}:${member.discordUserId}`, member]));
    for (const server of snapshot?.guilds ?? []) {
      if (!config?.discordGuildIds?.includes(server.guildId)) continue;
      const mapping = saved.roleMappings[server.guildId], validRoles = new Set(server.roles.map(role => role.id)), channels = new Set(server.channelIds);
      for (const observed of server.members) {
        const person = identities.get(observed.discordUserId), seed = seeds.get(`${person?.userId}:${observed.discordUserId}`);
        // Until a server's donor mappings are imported, preserve its existing explicit group.
        const group = mapping ? observed.roleIds.map(role => validRoles.has(role) ? mapping[role] : undefined).find(Boolean) ?? "Everyone Else" : seed?.group ?? "Everyone Else";
        const links = person?.providers.filter(link => link.provider === "twitch") ?? [], logins = links.map(link => twitch.get(link.providerUserId)).filter((login): login is string => Boolean(login));
        const login = links.length === 1 ? logins[0] : seed && logins.includes(seed.twitchLogin) ? seed.twitchLogin : undefined;
        const slug = dshShoutoutGroupSlug(group) ?? "", route = saved.groupChannels[slug] ?? (seed?.group === group ? seed.shoutoutChannelId : undefined), channel = route && channels.has(route) ? route : undefined;
        const issue = !person ? "Link Discord and Twitch in Account and join this community." : links.length > 1 && !login ? "Choose the linked Twitch account used by this member." : !login ? "Link a current Twitch account in Account." : !channel ? "Choose this group's shoutout channel in this server." : undefined;
        rows.push({...observed, guildId: server.guildId, group, ...(person ? {canonicalUserId: person.userId} : {}), ...(login ? {twitchLogin: login} : {}), ...(channel ? {shoutoutChannelId: channel} : {}), ...(issue ? {issue} : {}), ...(seed?.bannerUrl ? {bannerUrl: seed.bannerUrl} : {}), ...(seed?.partnerDiscordUrl ? {partnerDiscordUrl: seed.partnerDiscordUrl} : {})});
      }
    }
    // A tenant's existing monitor has one destination per person. Conflicting routes
    // remain visible for correction instead of assigning a new cross-server priority.
    const byUser = new Map<string, DshDirectoryRow[]>();
    for (const row of rows) if (!row.issue && row.canonicalUserId) { const list = byUser.get(row.canonicalUserId) ?? []; list.push(row); byUser.set(row.canonicalUserId, list); }
    for (const matches of byUser.values()) if (matches.length > 1) for (const row of matches) row.issue = "Multiple server routes match; select one shoutout destination for this member's groups.";
    return {checkedAt: snapshot?.checkedAt ?? null, identityCheckedAt: snapshot?.identityCheckedAt ?? null, error: snapshot?.error ?? null, initialized: Boolean(snapshot?.checkedAt), roles: (snapshot?.guilds ?? []).filter(server => (!guild || server.guildId === guild) && config?.discordGuildIds?.includes(server.guildId)).map(server => ({guildId: server.guildId, roles: server.roles})), rows: guild ? rows.filter(row => row.guildId === guild) : rows};
  }
  members(tenant: string, guild?: string): DshLiveMemberV1[] {
    const view = this.view(tenant, guild);
    if (!view.initialized) {
      const snapshot = this.snapshot(tenant), seeds = structuredClone(this.config.tenants.find(t => t.tenantId === tenant)?.members ?? []);
      return snapshot?.identityCheckedAt ? seeds.filter(member => snapshot.identities.some(person => person.userId === member.canonicalUserId && person.providers.some(link => link.provider === "discord" && link.providerUserId === member.discordUserId) && person.providers.some(link => link.provider === "twitch"))) : seeds;
    }
    return view.rows.filter(row => row.canonicalUserId && row.twitchLogin).map(toMember);
  }
  trackedMembers(tenant: string) {
    const view = this.view(tenant);
    if (!view.initialized) return this.members(tenant);
    return view.rows.filter(row => !row.issue && row.canonicalUserId && row.twitchLogin).map(toMember);
  }
}

export class DshMemberDirectoryWorker {
  constructor(private readonly store: DshMemberDirectoryStore, private readonly client: SpmtClient, private readonly config: DshLiveRuntimeConfigV1, private readonly discord: Pick<DshDiscordApi, "memberDirectory">, private readonly grants: DshTwitchGrantSourceV1, private readonly twitch: Pick<TwitchHelixLiveClient, "getUsersById">, private readonly now = () => new Date().toISOString()) {}
  async sync(tenant: string, force = false) {
    const config = this.config.tenants.find(t => t.tenantId === tenant); if (!config) throw Error("DSH community is not configured");
    let current = this.store.snapshot(tenant);
    if (!force && current?.attemptedAt && Date.parse(this.now()) - Date.parse(current.attemptedAt) < 60000) return this.store.view(tenant);
    const owner = randomUUID(); if (!this.store.acquire(tenant, owner)) return this.store.view(tenant);
    current = this.store.snapshot(tenant);
    if (!force && current?.attemptedAt && Date.parse(this.now()) - Date.parse(current.attemptedAt) < 60000) { this.store.release(tenant, owner); return this.store.view(tenant); }
    let snapshot: Snapshot = {...(current ?? {identities: [], guilds: [], twitch: []}), attemptedAt: this.now()};
    const progress = () => this.store.renew(tenant, owner);
    try {
      const identities: SpmtCommunityIdentityV1[] = []; let after = "";
      for (let page = 0; ; page++) {
        progress(); const result = await listCommunityIdentities(this.client, tenant, after);
        if (result.tenantId !== tenant || !Array.isArray(result.members) || result.members.length > 200 || result.members.some(member => typeof member.userId !== "string" || member.userId <= after) || page > 50) throw Error("Community directory pagination is invalid or exceeds 10000 members");
        identities.push(...result.members); if (identities.length > 10000 || new Set(identities.map(person => person.userId)).size !== identities.length) throw Error("Community directory is incomplete");
        if (result.nextAfterUserId === null) break;
        if (result.nextAfterUserId !== result.members.at(-1)?.userId || result.nextAfterUserId <= after) throw Error("Community directory pagination did not advance"); after = result.nextAfterUserId;
      }
      // Apply known unlinks even if Discord or Twitch subsequently fails. Never
      // grandfather a revoked provider link merely to keep someone monitored.
      snapshot = {...snapshot, identities, identityCheckedAt: this.now()}; progress(); this.store.save(tenant, owner, snapshot);
      const guilds: GuildSnapshot[] = [];
      for (const guild of config.discordGuildIds ?? []) { progress(); guilds.push(await this.discord.memberDirectory(tenant, guild, progress)); }
      snapshot = {...snapshot, guilds}; progress(); this.store.save(tenant, owner, snapshot);
      const ids = [...new Set(identities.flatMap(person => person.providers.filter(link => link.provider === "twitch").map(link => link.providerUserId)))], users: Snapshot["twitch"] = [];
      if (ids.length) {
        progress(); const grant = await this.grants.getGrant(tenant); if (grant.status !== "ready") throw Error("Twitch member lookup needs a current provider grant");
        for (let offset = 0; offset < ids.length; offset += 100) { progress(); users.push(...await this.twitch.getUsersById({...grant, userIds: ids.slice(offset, offset+100)})); }
      }
      snapshot = {...snapshot, twitch: users, checkedAt: this.now(), error: undefined}; progress(); this.store.save(tenant, owner, snapshot);
    } catch {
      snapshot.error = "Member refresh is pending. Last successful provider observations remain visible; current account unlinks are applied.";
      this.store.save(tenant, owner, snapshot);
    } finally { this.store.release(tenant, owner); }
    return this.store.view(tenant);
  }
}

function toMember(row: DshDirectoryRow): DshLiveMemberV1 { return {canonicalUserId: row.canonicalUserId!, discordUserId: row.discordUserId, twitchLogin: row.twitchLogin!, group: row.group, shoutoutChannelId: row.shoutoutChannelId ?? "", ...(row.bannerUrl ? {bannerUrl: row.bannerUrl} : {}), ...(row.partnerDiscordUrl ? {partnerDiscordUrl: row.partnerDiscordUrl} : {})}; }
