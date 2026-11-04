import { SqliteDshNebulaGameplayStore, DshNebulaGameplayCaptureService, type DshNebulaGameplayRendererV1, type NebulaGameplayManifestV1 } from "./nebula-gameplay.js";
const CYCLE_MS=10*60*1000;
export class DshNebulaGameplayCaptureWorker {
 private readonly store:SqliteDshNebulaGameplayStore;
 private readonly capture:DshNebulaGameplayCaptureService;
 private lastRun=0;
 private inFlight:Promise<unknown>|undefined;
 constructor(path:string,private readonly manifestUrl:string,renderer:DshNebulaGameplayRendererV1,private readonly fetchImpl:typeof fetch=fetch,private readonly now:()=>number=Date.now){
  const url=new URL(manifestUrl);if(url.protocol!=="https:"||url.username||url.password||url.search||url.hash)throw new Error("Nebula gameplay manifest URL must be credential-free HTTPS");
  this.store=new SqliteDshNebulaGameplayStore(path);this.capture=new DshNebulaGameplayCaptureService(this.store,renderer,()=>new Date(this.now()).toISOString());
 }
 async runOnce(){
  if(this.inFlight)return this.inFlight;
  if(this.now()-this.lastRun<CYCLE_MS)return {status:"skipped" as const};
  this.lastRun=this.now();
  this.inFlight=(async()=>{
   const response=await this.fetchImpl(this.manifestUrl,{redirect:"error",cache:"no-store",signal:AbortSignal.timeout(20000)});
   if(!response.ok)throw new Error(`Nebula gameplay manifest request failed (${response.status})`);
   const manifest=await response.json() as NebulaGameplayManifestV1;
   return this.capture.reconcile(manifest);
  })();
  try{return await this.inFlight;}finally{this.inFlight=undefined;}
 }
 async run(signal:AbortSignal){
  while(!signal.aborted){
   await this.runOnce().catch(()=>undefined);
   await new Promise<void>(resolve=>{if(signal.aborted)return resolve();const timer=setTimeout(done,15000);function done(){clearTimeout(timer);signal.removeEventListener("abort",done);resolve();}signal.addEventListener("abort",done,{once:true});});
  }
 }
 close(){this.store.close();}
}
