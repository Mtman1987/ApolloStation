import {DatabaseSync} from "node:sqlite";
import {mkdtempSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {createAsyncJsonRecordStore} from "@spmt/async-json-store/factory";
import type {AsyncJsonRecordStore} from "@spmt/async-json-store";
import {DshRaidPileStore,DEFAULT_DSH_RAID_PILE_SETTINGS,type DshRaidPileSettingsV1,type DshRaidPileMemberV1,type DshRaidPileViewV1,type DshRaidPileHandoffV1} from "./raid-pile.js";
interface RaidPileSnapshot {piles:unknown[];profiles:unknown[];members:unknown[];targets:unknown[];events:unknown[];}
const NAMESPACE="raid-pile-state";
export class AsyncDshRaidPileStore {
 private readonly records:AsyncJsonRecordStore;
 constructor(options:{databasePath?:string;mode?:"sqlite"|"turso";url?:string;authToken?:string;settings?:(tenantId:string)=>DshRaidPileSettingsV1;now?:()=>string}={}){
  this.settings=options.settings??(()=>DEFAULT_DSH_RAID_PILE_SETTINGS);this.now=options.now??(()=>new Date().toISOString());
  this.records=createAsyncJsonRecordStore({service:"discord-stream-hub",...(options.databasePath?{databasePath:options.databasePath}:{}),...(options.mode?{mode:options.mode}:{}),...(options.url?{url:options.url}:{}),...(options.authToken?{authToken:options.authToken}:{})});
 }
 private readonly settings:(tenantId:string)=>DshRaidPileSettingsV1;private readonly now:()=>string;
 initialize(){return this.records.initialize();}
 health(){return this.records.health();}
 close(){return this.records.close();}
 join(tenant:string,input:{userId:string;twitchLogin:string;displayName:string}){return this.withTenant(tenant,store=>store.join(tenant,input),true);}
 leave(tenant:string,userId:string,reason="left"){return this.withTenant(tenant,store=>store.leave(tenant,userId,reason),true);}
 updatePresence(tenant:string,userId:string,viewers:number,isLive:boolean){return this.withTenant(tenant,store=>store.updatePresence(tenant,userId,viewers,isLive),true);}
 next(tenant:string,pileId:string,excludeUserId?:string):Promise<DshRaidPileMemberV1|undefined>{return this.withTenant(tenant,store=>store.next(tenant,pileId,excludeUserId),false);}
 advance(tenant:string,pileId:string,reason:"manual"|"handoff"|"initial"="manual"){return this.withTenant(tenant,store=>store.advance(tenant,pileId,reason),true);}
 ensureTargets(tenant:string):Promise<DshRaidPileViewV1[]>{return this.withTenant(tenant,store=>store.ensureTargets(tenant),true);}
 dueHandoffs(tenant:string):Promise<DshRaidPileHandoffV1[]>{return this.withTenant(tenant,store=>store.dueHandoffs(tenant),true);}
 recordRaidOut(tenant:string,raiderUserId:string,targetUserId:string,eventId:string){return this.withTenant(tenant,store=>store.recordRaidOut(tenant,raiderUserId,targetUserId,eventId),true);}
 settingsForTenant(tenant:string):Promise<DshRaidPileSettingsV1>{return this.withTenant(tenant,store=>store.settingsForTenant(tenant),false);}
 piles(tenant:string):Promise<DshRaidPileViewV1[]>{return this.withTenant(tenant,store=>store.piles(tenant),false);}
 member(tenant:string,userId:string):Promise<DshRaidPileMemberV1|undefined>{return this.withTenant(tenant,store=>store.member(tenant,userId),false);}
 private async withTenant<T>(tenant:string,work:(store:DshRaidPileStore)=>T,persist:boolean):Promise<T>{
  const id=String(tenant??"").trim();if(!id||id.length>180||/[\r\n\0]/.test(id))throw new Error("tenantId is invalid");
  await this.initialize();
  return this.records.transaction(async tx=>{
   const snapshot=await tx.get<RaidPileSnapshot>(NAMESPACE,id,"current");
   const directory=mkdtempSync(join(tmpdir(),"dsh-raid-pile-")),databasePath=join(directory,"state.sqlite");
   let store:DshRaidPileStore|undefined,db:DatabaseSync|undefined;
   try{
    store=new DshRaidPileStore(databasePath,this.settings,this.now);
    db=new DatabaseSync(databasePath,{timeout:5000});db.exec("PRAGMA foreign_keys=ON;");
    if(snapshot)hydrate(db,snapshot);
    const result=work(store);
    if(persist)await tx.put(NAMESPACE,id,"current",readSnapshot(db));
    return result;
   }finally{try{db?.close();}catch{}try{store?.close();}catch{}rmSync(directory,{recursive:true,force:true});}
  });
 }
}
function hydrate(db:DatabaseSync,s: RaidPileSnapshot){
 const insert=(table:string,rows:unknown[])=>{for(const row of rows){const value=row as Record<string,unknown>,keys=Object.keys(value);if(!keys.length)continue;const columns=keys.map(key=>'"'+key+'"').join(","),placeholders=keys.map(()=>"?").join(",");db.prepare(`INSERT OR REPLACE INTO ${table}(${columns}) VALUES(${placeholders})`).run(...keys.map(key=>value[key]??null));}};
 insert("raid_piles",s.piles);insert("raid_pile_profiles",s.profiles);insert("raid_pile_members",s.members);insert("raid_pile_targets",s.targets);insert("raid_pile_events",s.events);
}
function readSnapshot(db:DatabaseSync):RaidPileSnapshot{
 const rows=(table:string)=>db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all() as unknown[];
 return{piles:rows("raid_piles"),profiles:rows("raid_pile_profiles"),members:rows("raid_pile_members"),targets:rows("raid_pile_targets"),events:rows("raid_pile_events")};
}
