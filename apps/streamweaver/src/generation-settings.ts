import { DatabaseSync } from "node:sqlite";
export interface StreamWeaverGenerationSettings {provider:"automatic"|"seaart-cli"|"edenai";edenModel?:string;publicAccess:"everyone"|"mods"|"off";modelNo:string;modelVerNo:string;resolution:string;count:number;seed:number;enhance:boolean;promptTemplate:string;providerParams:Record<string,string|number|boolean>;}
export const GENERATION_TEMPLATES={general:"Preserve the subject and intent. Add coherent composition, lighting and visual detail.",photo:"Preserve the subject and intent. Describe a photograph with lens, lighting, setting and color.",avatar:"Preserve the character. Compose a clear portrait with a simple background."};
const defaults=():StreamWeaverGenerationSettings=>({provider:"automatic",edenModel:"",publicAccess:"everyone",modelNo:"",modelVerNo:"",resolution:"1024x1024",count:1,seed:0,enhance:true,promptTemplate:GENERATION_TEMPLATES.general,providerParams:{}});
export class StreamWeaverGenerationStore {
  private readonly db:DatabaseSync;
  constructor(path:string){this.db=new DatabaseSync(path);this.db.exec("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS sw_generation_settings(tenant TEXT NOT NULL,surface TEXT NOT NULL,body TEXT NOT NULL,PRIMARY KEY(tenant,surface)); CREATE TABLE IF NOT EXISTS sw_generation_model_catalog(id INTEGER PRIMARY KEY CHECK(id=1),body TEXT NOT NULL); CREATE TABLE IF NOT EXISTS sw_generated_checkpoints(tenant TEXT NOT NULL,job TEXT NOT NULL,body TEXT NOT NULL,PRIMARY KEY(tenant,job))");}
  read(tenant:string,surface="public"):StreamWeaverGenerationSettings {const row=this.db.prepare("SELECT body FROM sw_generation_settings WHERE tenant=? AND surface=?").get(tenant,surface);return row?JSON.parse(String(row.body)):defaults();}
  save(tenant:string,surface:string,input:Partial<StreamWeaverGenerationSettings>){if(surface!=="public"&&!/^private:[A-Za-z0-9._:@/-]{1,200}$/.test(surface))throw new Error("Invalid generation settings scope");const value=normalizeGenerationSettings({...this.read(tenant,surface),...input});this.db.prepare("INSERT INTO sw_generation_settings VALUES(?,?,?) ON CONFLICT(tenant,surface) DO UPDATE SET body=excluded.body").run(tenant,surface,JSON.stringify(value));return value;}
  catalog():{models:Array<{provider:string;id:string;label:string}>;updatedAt:string|null}{const row=this.db.prepare("SELECT body FROM sw_generation_model_catalog WHERE id=1").get();return row?JSON.parse(String(row.body)):{models:[],updatedAt:null};}
  saveCatalog(models:Array<{provider:string;id:string;label:string}>){const value={models:models.slice(0,2000).map(m=>({provider:m.provider,id:m.id,label:m.label.slice(0,200)})),updatedAt:new Date().toISOString()};this.db.prepare("INSERT OR REPLACE INTO sw_generation_model_catalog VALUES(1,?)").run(JSON.stringify(value));return value;}
  close(){this.db.close();}
  generated<T>(tenant:string,job:string):T|undefined {const row=this.db.prepare("SELECT body FROM sw_generated_checkpoints WHERE tenant=? AND job=?").get(tenant,job);return row?JSON.parse(String(row.body)) as T:undefined;}
  saveGenerated(tenant:string,job:string,body:unknown){this.db.prepare("INSERT INTO sw_generated_checkpoints VALUES(?,?,?) ON CONFLICT(tenant,job) DO NOTHING").run(tenant,job,JSON.stringify(body));}
}
export function normalizeGenerationSettings(input:Partial<StreamWeaverGenerationSettings>):StreamWeaverGenerationSettings {
  const v={...defaults(),...input};
  if(!["automatic","seaart-cli","edenai"].includes(v.provider)||!["everyone","mods","off"].includes(v.publicAccess))throw new Error("Choose supported generation settings");
  if(v.edenModel!==undefined&&(typeof v.edenModel!=="string"||v.edenModel.length>220||(v.edenModel!==""&&!/^image\/generation\/[a-z0-9_-]+(?:\/[A-Za-z0-9._ -]{1,160})?$/.test(v.edenModel))))throw new Error("Eden image model is invalid");
  for(const name of ["modelNo","modelVerNo"] as const)if(typeof v[name]!=="string"||!/^$|^[A-Za-z0-9._:-]{1,160}$/.test(v[name]))throw new Error("Model identifier is invalid");
  if(!["512x512","768x768","1024x1024","1024x768","768x1024"].includes(v.resolution))throw new Error("Choose a supported resolution");
  if(!Number.isInteger(v.count)||v.count<1||v.count>4||!Number.isSafeInteger(v.seed)||v.seed<0||v.seed>2147483647)throw new Error("Image count or seed is invalid");
  if(typeof v.enhance!=="boolean"||typeof v.promptTemplate!=="string"||v.promptTemplate.length>1500)throw new Error("Prompt settings are invalid");
  if(!v.providerParams||typeof v.providerParams!=="object"||Array.isArray(v.providerParams)||Object.keys(v.providerParams).length>12)throw new Error("Provider settings are invalid");
  for(const [key,value] of Object.entries(v.providerParams))if(!/^(steps|num_inference_steps|cfg_scale|guidance_scale|lora|lora_strength|negative_prompt)$/.test(key)||!(typeof value==="string"&&value.length<=1500||typeof value==="number"&&Number.isFinite(value)||typeof value==="boolean"))throw new Error("Unsupported generation parameter");
  return v;
}
