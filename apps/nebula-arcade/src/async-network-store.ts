import { createAsyncJsonRecordStore } from "@spmt/async-json-store/factory";
import type { AsyncJsonRecordStore } from "@spmt/async-json-store";
import { NEBULA_ARCADE_GAMES } from "./game-hub.js";

export interface AsyncNebulaNetworkOptions {
  databasePath?: string;
  mode?: "sqlite" | "turso";
  url?: string;
  authToken?: string;
}
export interface NebulaEnrollmentV1 { enrolled: boolean; excludedGames: string[]; updatedAt: string; }
export interface NebulaBlacklistEntryV1 { kind: "channel" | "player"; subject: string; reason: string; updatedAt: string; }
export interface NebulaPresenceV1 { liveUserIds: string[]; channelByUserId: Record<string,string>; observedAt: string; }
export interface NebulaNetworkJobV1 { kind: string; body: unknown; status: string; updatedAt: string; }

/**
 * Async record-store primitives for Nebula network state.
 *
 * This deliberately does not implement blacklist mutations: SQLite's current
 * blacklist transaction also mutates Tag state/channels, arcade memberships,
 * game-runtime memberships, and Quackverse seats. Those writes must move behind
 * one aggregate transaction before this adapter can be selected by a live host.
 * The same cutover restriction applies to enrollment side effects and the
 * shared media outbox while tabletop/network ownership is being unified.
 */
export class AsyncNebulaNetworkStore {
  private readonly records: AsyncJsonRecordStore;
  constructor(options: AsyncNebulaNetworkOptions = {}) {
    this.records = createAsyncJsonRecordStore({
      service: "nebula-arcade",
      ...(options.databasePath ? { databasePath: options.databasePath } : {}),
      ...(options.mode ? { mode: options.mode } : {}),
      ...(options.url ? { url: options.url } : {}),
      ...(options.authToken ? { authToken: options.authToken } : {}),
    });
  }
  initialize(): Promise<void> { return this.records.initialize(); }
  health(): Promise<{ready:boolean}> { return this.records.health(); }
  close(): Promise<void> { return Promise.resolve(this.records.close()); }

  async enrollment(actorId: string): Promise<{enrolled:boolean;excludedGames:string[]}> {
    const row = await this.records.get<NebulaEnrollmentV1>("network-enrollment", "global", clean(actorId,"actorId"));
    return { enrolled: row?.enrolled === true, excludedGames: [...(row?.excludedGames ?? [])] };
  }

  async saveEnrollment(actorId: string, enrolled: boolean, now = new Date().toISOString()): Promise<{enrolled:boolean;excludedGames:string[]}> {
    const actor = clean(actorId,"actorId"); validTime(now);
    return this.records.transaction(async tx => {
      const previous = await tx.get<NebulaEnrollmentV1>("network-enrollment","global",actor);
      const next: NebulaEnrollmentV1 = { enrolled, excludedGames: enrolled ? [...(previous?.excludedGames ?? [])] : [], updatedAt: now };
      await tx.put("network-enrollment","global",actor,next);
      return {enrolled:next.enrolled,excludedGames:[...next.excludedGames]};
    });
  }

  async excludeGame(actorId: string, gameId: string, exclude: boolean, now = new Date().toISOString()): Promise<void> {
    const actor=clean(actorId,"actorId"), game=clean(gameId,"gameId"); validTime(now);
    if (!NEBULA_ARCADE_GAMES.some(item=>item.id===game)) throw new Error("Unknown game");
    await this.records.transaction(async tx => {
      const previous=await tx.get<NebulaEnrollmentV1>("network-enrollment","global",actor);
      const games=new Set(previous?.excludedGames ?? []);
      if(exclude) games.add(game); else games.delete(game);
      await tx.put("network-enrollment","global",actor,{enrolled:previous?.enrolled===true,excludedGames:[...games].sort(),updatedAt:now});
    });
  }

  async listBlacklist(tenantId:string): Promise<NebulaBlacklistEntryV1[]> {
    const tenant=clean(tenantId,"tenantId");
    return (await this.records.list<NebulaBlacklistEntryV1>("network-blacklist",tenant))
      .map(row=>row.value).sort((a,b)=>a.kind.localeCompare(b.kind)||a.subject.localeCompare(b.subject));
  }

  async blocked(tenantId:string,userId:string,username:string,channel?:string): Promise<boolean> {
    const tenant=clean(tenantId,"tenantId");
    const keys=new Set([userId,username.replace(/^[@#]/,"").toLowerCase(),channel?.replace(/^#/,"").toLowerCase()].filter(Boolean));
    const rows=await this.records.list<NebulaBlacklistEntryV1>("network-blacklist",tenant);
    return rows.some(row=>keys.has(row.value.subject));
  }

  async settings(tenantId:string,channelId:string,gameId:string): Promise<Record<string,unknown>> {
    const [tenant,channel,game]=[clean(tenantId,"tenantId"),clean(channelId,"channelId"),clean(gameId,"gameId")];
    const value=await this.records.get<Record<string,unknown>>("network-settings",tenant,pair(channel,game));
    return value ?? {};
  }

  async saveSettings(tenantId:string,channelId:string,gameId:string,settings:Record<string,unknown>): Promise<Record<string,unknown>> {
    const [tenant,channel,game]=[clean(tenantId,"tenantId"),clean(channelId,"channelId"),clean(gameId,"gameId")];
    if(!NEBULA_ARCADE_GAMES.some(item=>item.id===game)) throw new Error("Unknown game");
    const body=JSON.stringify(settings); if(body.length>32000) throw new Error("Game settings are too large");
    await this.records.put("network-settings",tenant,pair(channel,game),settings);
    return structuredClone(settings);
  }

  async presence(tenantId:string,now=Date.now()): Promise<NebulaPresenceV1|undefined> {
    const tenant=clean(tenantId,"tenantId");
    const row=await this.records.get<NebulaPresenceV1>("network-presence",tenant,"current");
    if(!row || now-Date.parse(row.observedAt)>120000 || Date.parse(row.observedAt)>now+5000) return undefined;
    return structuredClone(row);
  }

  async recordPresence(tenantId:string,input:NebulaPresenceV1): Promise<void> {
    const tenant=clean(tenantId,"tenantId"); validTime(input.observedAt);
    await this.records.transaction(async tx=>{
      const current=await tx.get<NebulaPresenceV1>("network-presence",tenant,"current");
      if(!current || input.observedAt>=current.observedAt) await tx.put("network-presence",tenant,"current",input);
    });
  }

  async enqueue(tenantId:string,id:string,kind:string,body:unknown,now=new Date().toISOString()): Promise<void> {
    const tenant=clean(tenantId,"tenantId"), key=clean(id,"jobId"); validTime(now);
    await this.records.transaction(async tx=>{
      const current=await tx.get<NebulaNetworkJobV1>("network-media-outbox",tenant,key);
      if(!current) await tx.put("network-media-outbox",tenant,key,{kind:clean(kind,"kind"),body,status:"pending",updatedAt:now});
    });
  }

  async jobs(tenantId:string): Promise<Array<{id:string;kind:string;body:unknown;status:string;updated_at:string}>> {
    const tenant=clean(tenantId,"tenantId");
    return (await this.records.list<NebulaNetworkJobV1>("network-media-outbox",tenant))
      .map(row=>({id:row.key,...row.value,updated_at:row.value.updatedAt}))
      .sort((a,b)=>b.updated_at.localeCompare(a.updated_at)).slice(0,100);
  }

  async pending(tenantId:string,kind?:string): Promise<Array<{id:string;kind:string;body:unknown;status:string;updated_at:string}>> {
    return (await this.jobs(tenantId))
      .filter(row=>!["done","failed","cancelled"].includes(row.status))
      .filter(row=>kind ? row.kind===kind : row.kind!=="announcement")
      .sort((a,b)=>a.updated_at.localeCompare(b.updated_at)||a.id.localeCompare(b.id)).slice(0,50);
  }

  async updateJob(tenantId:string,id:string,status:string,body:unknown,now=new Date().toISOString()): Promise<void> {
    const tenant=clean(tenantId,"tenantId"), key=clean(id,"jobId"); validTime(now);
    await this.records.transaction(async tx=>{
      const current=await tx.get<NebulaNetworkJobV1>("network-media-outbox",tenant,key);
      if(current) await tx.put("network-media-outbox",tenant,key,{...current,status:clean(status,"status"),body,updatedAt:now});
    });
  }
}

function clean(value:string,name:string):string {
  const result=String(value??"").trim();
  if(!result || result.length>300 || /[\r\n\0]/.test(result)) throw new Error(name+" is invalid");
  return result;
}
function validTime(value:string):void { if(!Number.isFinite(Date.parse(value))) throw new Error("Invalid timestamp"); }
function pair(a:string,b:string):string { return encodeURIComponent(a)+":"+encodeURIComponent(b); }
