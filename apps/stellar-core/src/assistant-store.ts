import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { TTS_VOICE_OPTIONS, ATHENA_CANONICAL_TTS_VOICE } from "./speech-voices.js";

export interface AssistantPreferences { voice: string; ttsEnabled: boolean; gifEnabled: boolean; gifAssetId?: string; remember: boolean; }
export interface AssistantNote { id: string; subject: string; title: string; content: string; updatedAt: string; }
export interface AssistantTrainingReview { vote:"positive"|"negative"; weight:1|2|3; response:string; }
export interface AssistantTurn { id:string; jobId:string; message:string; answer?:string; state:string; createdAt:string; sequence?:number; gifVisible?:boolean; trainingReview?:AssistantTrainingReview; }
export interface AssistantThread { epoch:string; turns:AssistantTurn[]; summary:string; sequence?:number; summaryThrough?:string; condensation?:{jobId:string;through:string;title:string}; }
export interface PersonaTrainingExampleV1 {
  schemaVersion:1;
  tenantId:string;
  personaKey:string;
  source:"private"|"public";
  messageKey:string;
  prompt:string;
  originalResponse:string;
  response:string;
  vote:"positive"|"negative";
  weight:1|2|3;
  reviewerUserId:string;
  updatedAt:string;
  metadata?:Record<string,string>;
}
/** One ecosystem-owned private store, partitioned by both tenant and canonical user. */
export class StellarAssistantStore {
  private readonly db: DatabaseSync;
  constructor(path: string) {
    this.db = new DatabaseSync(path); this.db.exec("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000");
    this.db.exec(`CREATE TABLE IF NOT EXISTS stellar_preferences(tenant TEXT NOT NULL, user_id TEXT NOT NULL, body TEXT NOT NULL, PRIMARY KEY(tenant,user_id));
      CREATE TABLE IF NOT EXISTS stellar_notes(tenant TEXT NOT NULL,user_id TEXT NOT NULL,id TEXT NOT NULL,body TEXT NOT NULL,PRIMARY KEY(tenant,user_id,id));
      CREATE TABLE IF NOT EXISTS stellar_private_threads(tenant TEXT NOT NULL,user_id TEXT NOT NULL,body TEXT NOT NULL,PRIMARY KEY(tenant,user_id));
      CREATE TABLE IF NOT EXISTS persona_training_examples(tenant TEXT NOT NULL,persona_key TEXT NOT NULL,source TEXT NOT NULL CHECK(source IN ('private','public')),message_key TEXT NOT NULL,vote INTEGER NOT NULL CHECK(vote IN (-1,1)),weight INTEGER NOT NULL CHECK(weight BETWEEN 1 AND 3),updated_at TEXT NOT NULL,body TEXT NOT NULL,PRIMARY KEY(tenant,persona_key,source,message_key)) STRICT;`);
  }
  preferences(tenant: string, user: string): AssistantPreferences {
    const row = this.db.prepare("SELECT body FROM stellar_preferences WHERE tenant=? AND user_id=?").get(tenant,user);
    return row ? JSON.parse(String(row.body)) : { voice: ATHENA_CANONICAL_TTS_VOICE, ttsEnabled: false, gifEnabled: true, remember: false };
  }
  savePreferences(tenant: string, user: string, input: Partial<AssistantPreferences>) {
    const next = this.preferences(tenant,user);
    if (input.voice !== undefined) { if (!TTS_VOICE_OPTIONS.some(v => v.id === input.voice)) throw new Error("Choose a supported voice"); next.voice = input.voice; }
    for (const key of ["ttsEnabled","gifEnabled","remember"] as const) if (input[key] !== undefined) { if (typeof input[key] !== "boolean") throw new Error("Preference must be true or false"); next[key] = input[key]; }
    if(input.gifAssetId!==undefined){if(typeof input.gifAssetId!=="string"||(input.gifAssetId!==""&&!/^[a-f0-9-]{36}$/.test(input.gifAssetId)))throw new Error("Choose a valid private GIF");next.gifAssetId=input.gifAssetId;}
    this.db.prepare("INSERT INTO stellar_preferences VALUES(?,?,?) ON CONFLICT(tenant,user_id) DO UPDATE SET body=excluded.body").run(tenant,user,JSON.stringify(next)); return next;
  }
  notes(tenant: string, user: string) { return this.db.prepare("SELECT body FROM stellar_notes WHERE tenant=? AND user_id=? ORDER BY id LIMIT 500").all(tenant,user).map(r => JSON.parse(String(r.body)) as AssistantNote); }
  saveNote(tenant: string, user: string, input: Partial<AssistantNote>) {
    const note: AssistantNote = { id: input.id ? field(input.id,200) : randomUUID(), subject: field(input.subject ?? "memory",200), title: field(input.title,200), content: field(input.content,20_000), updatedAt: new Date().toISOString() };
    if (!this.notes(tenant,user).some(n => n.id === note.id) && this.notes(tenant,user).length >= 500) throw new Error("Remove a note before adding more");
    this.db.prepare("INSERT INTO stellar_notes VALUES(?,?,?,?) ON CONFLICT(tenant,user_id,id) DO UPDATE SET body=excluded.body").run(tenant,user,note.id,JSON.stringify(note)); return note;
  }
  deleteNote(tenant: string, user: string, id: string) { this.db.prepare("DELETE FROM stellar_notes WHERE tenant=? AND user_id=? AND id=?").run(tenant,user,id); }
  saveTrainingExample(input:Omit<PersonaTrainingExampleV1,"schemaVersion"|"updatedAt">):PersonaTrainingExampleV1 {
    const tenantId=trainingKey(input.tenantId,"tenant"),personaKey=trainingKey(input.personaKey,"persona"),messageKey=trainingKey(input.messageKey,"message");
    if(input.source!=="private"&&input.source!=="public")throw new Error("Training source is invalid");
    if(input.vote!=="positive"&&input.vote!=="negative")throw new Error("Choose a positive or negative training vote");
    if(![1,2,3].includes(input.weight))throw new Error("Training weight must be 1, 2, or 3");
    const row:PersonaTrainingExampleV1={schemaVersion:1,tenantId,personaKey,source:input.source,messageKey,prompt:trainingText(input.prompt,10_000,"prompt"),originalResponse:trainingText(input.originalResponse,20_000,"original response"),response:trainingText(input.response,20_000,"response"),vote:input.vote,weight:input.weight,reviewerUserId:trainingKey(input.reviewerUserId,"reviewer"),updatedAt:new Date().toISOString(),...(input.metadata?{metadata:trainingMetadata(input.metadata)}:{})};
    this.db.prepare("INSERT INTO persona_training_examples(tenant,persona_key,source,message_key,vote,weight,updated_at,body) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(tenant,persona_key,source,message_key) DO UPDATE SET vote=excluded.vote,weight=excluded.weight,updated_at=excluded.updated_at,body=excluded.body").run(row.tenantId,row.personaKey,row.source,row.messageKey,row.vote==="positive"?1:-1,row.weight,row.updatedAt,JSON.stringify(row));
    return row;
  }
  trainingExamples(tenantId:string,personaKey?:string):PersonaTrainingExampleV1[] {
    const tenant=trainingKey(tenantId,"tenant");
    const rows=personaKey?this.db.prepare("SELECT body FROM persona_training_examples WHERE tenant=? AND persona_key=? ORDER BY updated_at DESC").all(tenant,trainingKey(personaKey,"persona")):this.db.prepare("SELECT body FROM persona_training_examples WHERE tenant=? ORDER BY updated_at DESC").all(tenant);
    return rows.map(row=>JSON.parse(String(row.body)) as PersonaTrainingExampleV1);
  }
  thread(tenant:string,user:string):AssistantThread {
    const row=this.db.prepare("SELECT body FROM stellar_private_threads WHERE tenant=? AND user_id=?").get(tenant,user);
    if(!row){const empty={epoch:randomUUID(),turns:[],summary:""};this.saveThread(tenant,user,empty);return empty;}
    const thread=JSON.parse(String(row.body)) as AssistantThread;
    const cutoff=Date.now()-(this.preferences(tenant,user).remember?7*86400_000:3600_000);
    thread.turns=thread.turns.filter(t=>Date.parse(t.createdAt)>cutoff);return thread;
  }
  saveThread(tenant:string,user:string,thread:AssistantThread) {
    this.db.prepare("INSERT INTO stellar_private_threads VALUES(?,?,?) ON CONFLICT(tenant,user_id) DO UPDATE SET body=excluded.body").run(tenant,user,JSON.stringify({...thread,turns:thread.turns.slice(-100)}));
  }
  clearThread(tenant:string,user:string) {const thread={epoch:randomUUID(),turns:[],summary:""};this.saveThread(tenant,user,thread);return thread;}
  sweep(){for(const row of this.db.prepare("SELECT tenant,user_id FROM stellar_private_threads").all()){const tenant=String(row.tenant),user=String(row.user_id);this.saveThread(tenant,user,this.thread(tenant,user));}}
  deleteForUser(tenant: string,user: string) { this.db.prepare("DELETE FROM stellar_notes WHERE tenant=? AND user_id=?").run(tenant,user); this.db.prepare("DELETE FROM stellar_preferences WHERE tenant=? AND user_id=?").run(tenant,user); this.db.prepare("DELETE FROM stellar_private_threads WHERE tenant=? AND user_id=?").run(tenant,user); }
  close() { this.db.close(); }
}
function field(value: unknown,max: number) { if (typeof value !== "string" || !value.trim() || value.length > max || value.includes("\0")) throw new Error("Note field is missing or too large"); return value.trim(); }
function trainingKey(value:unknown,name:string){if(typeof value!=="string"||!value.trim()||value.length>500||value.includes("\0"))throw new Error(`Training ${name} is invalid`);return value.trim();}
function trainingText(value:unknown,max:number,name:string){if(typeof value!=="string"||!value.trim()||value.length>max||value.includes("\0"))throw new Error(`Training ${name} is missing or too large`);return value.trim();}
function trainingMetadata(input:Record<string,string>){const result:Record<string,string>={};for(const [key,value] of Object.entries(input)){if(!key||key.length>100||typeof value!=="string"||value.length>1000||key.includes("\0")||value.includes("\0"))throw new Error("Training metadata is invalid");result[key]=value;}return result;}
