import {createAsyncJsonRecordStore} from "@spmt/async-json-store/factory";
import type {AsyncJsonRecordStore} from "@spmt/async-json-store";
import {CLOUDFLARE_IMAGE_MODELS,CLOUDFLARE_PRIVATE_IMAGE_MODEL} from "./cloudflare-image-provider.js";
import {GENERATION_TEMPLATES,normalizeGenerationSettings,type StreamWeaverGenerationSettings} from "./generation-settings.js";
const SETTINGS="generation-settings",CATALOG="generation-model-catalog",CHECKPOINTS="generated-checkpoints",TENANTS="generation-tenants";
export class AsyncStreamWeaverGenerationStore {
 private readonly records:AsyncJsonRecordStore;
 constructor(options:{databasePath?:string;mode?:"sqlite"|"turso";url?:string;authToken?:string}={}){this.records=createAsyncJsonRecordStore({service:"streamweaver",...(options.databasePath?{databasePath:options.databasePath}:{}),...(options.mode?{mode:options.mode}:{}),...(options.url?{url:options.url}:{}),...(options.authToken?{authToken:options.authToken}:{})});}
 initialize(){return this.records.initialize();}
 health(){return this.records.health();}
 close(){return this.records.close();}
 async read(tenant:string,surface="public"):Promise<StreamWeaverGenerationSettings>{await this.initialize();const saved=await this.records.get<Partial<StreamWeaverGenerationSettings>>(SETTINGS,tenant,surface);return normalizeGenerationSettings({contentModeration:surface==="public",...(saved??{})});}
 async save(tenant:string,surface:string,input:Partial<StreamWeaverGenerationSettings>){if(surface!=="public"&&!/^private:[A-Za-z0-9._:@/-]{1,200}$/.test(surface))throw new Error("Invalid generation settings scope");const value=normalizeGenerationSettings({...await this.read(tenant,surface),...input});if(surface==="public"&&value.cloudflareModel===CLOUDFLARE_PRIVATE_IMAGE_MODEL)throw Error("Klein 9B is restricted to private generation");await this.records.transaction(async tx=>{await tx.put(TENANTS,"_index",tenant,{tenantId:tenant});await tx.put(SETTINGS,tenant,surface,value);});return value;}
 async catalog():Promise<{models:Array<{provider:string;id:string;label:string}>;updatedAt:string|null}>{await this.initialize();return await this.records.get(CATALOG,"_global","current")??{models:[],updatedAt:null};}
 async saveCatalog(models:Array<{provider:string;id:string;label:string}>){await this.initialize();const value=await this.records.transaction(async tx=>{const old=await tx.get<{models:Array<{provider:string;id:string;label:string}>;updatedAt:string|null}>(CATALOG,"_global","current")??{models:[],updatedAt:null};const refreshed=new Set(models.map(m=>m.provider)),merged=[...models,...old.models.filter(m=>!refreshed.has(m.provider))];const next={models:merged.slice(0,2000).map(m=>({provider:m.provider,id:m.id,label:m.label.slice(0,200)})),updatedAt:new Date().toISOString()};await tx.put(CATALOG,"_global","current",next);return next;});return value;}
 async generated<T>(tenant:string,job:string):Promise<T|undefined>{await this.initialize();return await this.records.get<T>(CHECKPOINTS,tenant,job);}
 async saveGenerated(tenant:string,job:string,body:unknown){await this.initialize();return this.records.transaction(async tx=>{const prior=await tx.get(CHECKPOINTS,tenant,job);if(prior!==undefined)return prior;await tx.put(TENANTS,"_index",tenant,{tenantId:tenant});await tx.put(CHECKPOINTS,tenant,job,body);return body;});}
}
