import {DatabaseSync} from "node:sqlite";
import {mkdtempSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {createAsyncJsonRecordStore} from "@spmt/async-json-store/factory";
import type {AsyncJsonRecordStore} from "@spmt/async-json-store";
import {StreamWeaverRideStore,type StreamRideAttempt} from "./ride-store.js";
interface RideSnapshot {settings:Array<{tenant:string;body:string}>;attempts:Array<{tenant:string;id:string;body:string}>;frontSeats:Array<{tenant:string;body:string}>;}
const NAMESPACE="ride-state",TENANTS="ride-tenants";
export class AsyncStreamWeaverRideStore {
 private readonly records:AsyncJsonRecordStore;
 constructor(options:{databasePath?:string;mode?:"sqlite"|"turso";url?:string;authToken?:string}={}){
  this.records=createAsyncJsonRecordStore({service:"streamweaver",...(options.databasePath?{databasePath:options.databasePath}:{}),...(options.mode?{mode:options.mode}:{}),...(options.url?{url:options.url}:{}),...(options.authToken?{authToken:options.authToken}:{})});
 }
 initialize(){return this.records.initialize();}
 health(){return this.records.health();}
 close(){return this.records.close();}
 settings(tenant:string){return this.withTenant(tenant,store=>store.settings(tenant),false);}
 configure(tenant:string,input:{enabled:boolean;rewardId:string}){return this.withTenant(tenant,store=>store.configure(tenant,input),true);}
 attempt(tenant:string,id:string):Promise<StreamRideAttempt|undefined>{return this.withTenant(tenant,store=>store.attempt(tenant,id),false);}
 prepare(tenant:string,id:string,value:StreamRideAttempt){return this.withTenant(tenant,store=>store.prepare(tenant,id,value),true);}
 reserveFrontSeat(tenant:string,id:string,choose?:(size:number)=>number){return this.withTenant(tenant,store=>store.reserveFrontSeat(tenant,id,choose),true);}
 markNebulaBonus(tenant:string,id:string,amount:number){return this.withTenant(tenant,store=>store.markNebulaBonus(tenant,id,amount),true);}
 complete(tenant:string,id:string,result:NonNullable<StreamRideAttempt["result"]>){return this.withTenant(tenant,store=>store.complete(tenant,id,result),true);}
 private async withTenant<T>(tenant:string,work:(store:StreamWeaverRideStore)=>T,persist:boolean):Promise<T>{
  const id=String(tenant??"").trim();if(!id||id.length>180||/[\r\n\0]/.test(id))throw new Error("tenantId is invalid");
  await this.initialize();
  return this.records.transaction(async tx=>{
   const snapshot=await tx.get<RideSnapshot>(NAMESPACE,id,"current");
   const directory=mkdtempSync(join(tmpdir(),"streamweaver-ride-")),databasePath=join(directory,"ride.sqlite");
   let store:StreamWeaverRideStore|undefined,db:DatabaseSync|undefined;
   try{
    store=new StreamWeaverRideStore(databasePath);
    db=new DatabaseSync(databasePath,{timeout:5000});
    if(snapshot)hydrate(db,snapshot);
    const result=work(store);
    if(persist){await tx.put(TENANTS,"_index",id,{tenantId:id});await tx.put(NAMESPACE,id,"current",readSnapshot(db));}
    return result;
   }finally{try{db?.close();}catch{}try{store?.close();}catch{}rmSync(directory,{recursive:true,force:true});}
  });
 }
}
function hydrate(db:DatabaseSync,s:RideSnapshot){
 for(const row of s.settings)db.prepare("INSERT OR REPLACE INTO sw_ride_settings(tenant,body) VALUES(?,?)").run(row.tenant,row.body);
 for(const row of s.attempts)db.prepare("INSERT OR REPLACE INTO sw_ride_attempts(tenant,id,body) VALUES(?,?,?)").run(row.tenant,row.id,row.body);
 for(const row of s.frontSeats)db.prepare("INSERT OR REPLACE INTO sw_ride_front_seats(tenant,body) VALUES(?,?)").run(row.tenant,row.body);
}
function readSnapshot(db:DatabaseSync):RideSnapshot{
 return{
  settings:db.prepare("SELECT tenant,body FROM sw_ride_settings ORDER BY tenant").all() as RideSnapshot["settings"],
  attempts:db.prepare("SELECT tenant,id,body FROM sw_ride_attempts ORDER BY tenant,id").all() as RideSnapshot["attempts"],
  frontSeats:db.prepare("SELECT tenant,body FROM sw_ride_front_seats ORDER BY tenant").all() as RideSnapshot["frontSeats"],
 };
}
