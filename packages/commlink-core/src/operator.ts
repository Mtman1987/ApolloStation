import { DatabaseSync } from "node:sqlite";

export interface CommlinkOperatorMessage {rich?:import("@spmt/contracts").CommlinkLiveChatRecordV1["rich"];id:string;text:string;username:string;provider:string;channelId:string;}
export interface CommlinkOperatorState { snapshots?:Record<string,CommlinkOperatorMessage>; revision: number; pinned: string[]; queue: string[]; featured: string | null; featuredAt: number | null; autoShow: boolean; autoAdvance: boolean; durationSeconds: number; style: "glass" | "solid" | "minimal"; }
export interface CommlinkSavedFilter { name: string; search: string; provider: string; channelId: string; }
const defaults = (): CommlinkOperatorState => ({revision:0,pinned:[],queue:[],featured:null,featuredAt:null,autoShow:false,autoAdvance:false,durationSeconds:15,style:"glass"});

/** Operator decisions are durable and versioned independently of immutable chat records. */
export class CommlinkOperatorStore {
  private readonly db: DatabaseSync;
  constructor(path: string, private readonly now: () => number = Date.now) {
    this.db=new DatabaseSync(path);this.db.exec("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000");
    this.db.exec(`CREATE TABLE IF NOT EXISTS commlink_operator(tenant TEXT PRIMARY KEY,body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS commlink_user_filters(tenant TEXT NOT NULL,user_id TEXT NOT NULL,body TEXT NOT NULL,PRIMARY KEY(tenant,user_id));
      CREATE TABLE IF NOT EXISTS commlink_ingestion_errors(id INTEGER PRIMARY KEY AUTOINCREMENT,tenant TEXT NOT NULL,message TEXT NOT NULL,created_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS commlink_ingestion_replays(id INTEGER PRIMARY KEY,tenant TEXT NOT NULL,payload TEXT NOT NULL,completed INTEGER NOT NULL DEFAULT 0);`);
  }
  read(tenant: string): CommlinkOperatorState { return this.transaction(()=>{const state=this.load(tenant);if(state.autoAdvance&&state.featuredAt!==null&&state.durationSeconds>0&&this.now()-state.featuredAt>=state.durationSeconds*1000){state.featured=state.queue.shift()??null;state.featuredAt=state.featured?this.now():null;state.revision++;this.save(tenant,state);}return state;}); }
  apply(tenant:string,input:{action:string;eventId?:string;revision:number;enabled?:boolean;durationSeconds?:number;style?:string;autoAdvance?:boolean},knownIds:readonly string[],messages:readonly CommlinkOperatorMessage[]=[]) {
    return this.transaction(()=>{
      const state=this.load(tenant);state.snapshots??={};if(input.revision!==state.revision)throw new Error("Chat desk changed. Refresh and try again.");
      const id=input.eventId;if(id&&!knownIds.includes(id)&&!state.snapshots[id])throw new Error("Message is outside the available chat history");
      if(["pin","unpin","queue","unqueue","feature"].includes(input.action)&&!id)throw new Error("Choose a message");
      if(input.action==="pin")state.pinned=[...new Set([...state.pinned,id!])].slice(-100);
      else if(input.action==="unpin")state.pinned=state.pinned.filter(x=>x!==id);
      else if(input.action==="queue") {state.queue=[...new Set([...state.queue,id!])].slice(-100);if(state.autoShow&&!state.featured){state.featured=state.queue.shift()!;state.featuredAt=this.now();}}
      else if(input.action==="unqueue")state.queue=state.queue.filter(x=>x!==id);
      else if(input.action==="feature"){state.featured=id!;state.featuredAt=this.now();state.queue=state.queue.filter(x=>x!==id);}
      else if(input.action==="next"){state.featured=state.queue.shift()??null;state.featuredAt=state.featured?this.now():null;}
      else if(input.action==="clear"){state.featured=null;state.featuredAt=null;}
      else if(input.action==="settings"){
        if(input.enabled!==undefined){if(typeof input.enabled!=="boolean")throw new Error("Auto-show must be true or false");state.autoShow=input.enabled;}
        if(input.autoAdvance!==undefined){if(typeof input.autoAdvance!=="boolean")throw new Error("Auto-advance must be true or false");state.autoAdvance=input.autoAdvance;}
        if(input.durationSeconds!==undefined){if(!Number.isInteger(input.durationSeconds)||input.durationSeconds<0||input.durationSeconds>300)throw new Error("Duration must be 0–300 seconds");state.durationSeconds=input.durationSeconds;}
        if(input.style!==undefined){if(!["glass","solid","minimal"].includes(input.style))throw new Error("Choose a supported style");state.style=input.style as CommlinkOperatorState["style"];}
      }else throw new Error("Unknown chat desk action");
      const retained=new Set([...state.pinned,...state.queue,...(state.featured?[state.featured]:[])]);
      for(const message of messages)if(retained.has(message.id))state.snapshots[message.id]={id:message.id,text:message.text.slice(0,8000),username:message.username.slice(0,200),provider:message.provider,channelId:message.channelId,...(message.rich?{rich:structuredClone(message.rich)}:{})};
      for(const key of Object.keys(state.snapshots))if(!retained.has(key))delete state.snapshots[key];
      state.revision++;this.save(tenant,state);return state;
    });
  }
  reviseMessage(tenant:string,message:CommlinkOperatorMessage,deleted=false){return this.transaction(()=>{const state=this.load(tenant),id=message.id;if(!state.snapshots?.[id]&&!state.pinned.includes(id)&&!state.queue.includes(id)&&state.featured!==id)return state;if(deleted){delete state.snapshots?.[id];state.pinned=state.pinned.filter(x=>x!==id);state.queue=state.queue.filter(x=>x!==id);if(state.featured===id){state.featured=null;state.featuredAt=null}}else{state.snapshots??={};state.snapshots[id]=structuredClone(message)}state.revision++;this.save(tenant,state);return state})}
  filters(tenant:string,user:string):CommlinkSavedFilter[] {const row=this.db.prepare("SELECT body FROM commlink_user_filters WHERE tenant=? AND user_id=?").get(tenant,user);return row?JSON.parse(String(row.body)):[];}
  saveFilters(tenant:string,user:string,input:unknown) {
    if(!Array.isArray(input)||input.length>20)throw new Error("Save at most 20 filters");
    const filters=input.map(value=>{if(!value||typeof value!=="object")throw new Error("Invalid filter");const result={} as CommlinkSavedFilter;for(const key of ["name","search","provider","channelId"] as const){const text=value[key]??"";if(typeof text!=="string"||text.length>200)throw new Error("Filter is too long");result[key]=text;}return result;});
    this.db.prepare("INSERT INTO commlink_user_filters VALUES(?,?,?) ON CONFLICT(tenant,user_id) DO UPDATE SET body=excluded.body").run(tenant,user,JSON.stringify(filters));return filters;
  }
  recordFailure(tenant:string,message:string,payload?:import("@spmt/contracts").NormalizedChatMessageV1) {const inserted=this.db.prepare("INSERT INTO commlink_ingestion_errors(tenant,message,created_at) VALUES(?,?,?)").run(tenant,message.replace(/(?:bearer|token|secret|password)\s*[:=]?\s*\S+/gi,"[redacted]").slice(0,500),this.now());if(payload)this.db.prepare("INSERT INTO commlink_ingestion_replays(id,tenant,payload) VALUES(?,?,?)").run(inserted.lastInsertRowid,tenant,JSON.stringify(payload));this.db.prepare("DELETE FROM commlink_ingestion_errors WHERE tenant=? AND id NOT IN (SELECT id FROM commlink_ingestion_errors WHERE tenant=? ORDER BY id DESC LIMIT 100)").run(tenant,tenant);this.db.prepare("DELETE FROM commlink_ingestion_replays WHERE id NOT IN(SELECT id FROM commlink_ingestion_errors)").run();}
  failures(tenant:string) {return this.db.prepare("SELECT e.id,e.message,e.created_at AS createdAt,CASE WHEN r.id IS NOT NULL AND r.completed=0 THEN 1 ELSE 0 END AS replayable,r.completed FROM commlink_ingestion_errors e LEFT JOIN commlink_ingestion_replays r ON e.id=r.id WHERE e.tenant=? ORDER BY e.id DESC LIMIT 100").all(tenant);}
  replay(tenant:string,id:number):import("@spmt/contracts").NormalizedChatMessageV1{if(!Number.isSafeInteger(id))throw Error("Invalid ingestion failure");const row=this.db.prepare("SELECT payload FROM commlink_ingestion_replays WHERE tenant=? AND id=?").get(tenant,id);if(!row)throw Error("This rejected input has no validated message to replay; correct it at its source");return JSON.parse(String(row.payload))}
  completeReplay(tenant:string,id:number){this.db.prepare("UPDATE commlink_ingestion_replays SET completed=1 WHERE tenant=? AND id=?").run(tenant,id)}
  close(){this.db.close();}
  private load(tenant:string):CommlinkOperatorState {const row=this.db.prepare("SELECT body FROM commlink_operator WHERE tenant=?").get(tenant);return row?JSON.parse(String(row.body)):defaults();}
  private save(tenant:string,state:CommlinkOperatorState){this.db.prepare("INSERT INTO commlink_operator VALUES(?,?) ON CONFLICT(tenant) DO UPDATE SET body=excluded.body").run(tenant,JSON.stringify(state));}
  private transaction<T>(fn:()=>T){this.db.exec("BEGIN IMMEDIATE");try{const result=fn();this.db.exec("COMMIT");return result;}catch(error){this.db.exec("ROLLBACK");throw error;}}
}
