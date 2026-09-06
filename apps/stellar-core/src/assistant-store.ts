import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { TTS_VOICE_OPTIONS, ATHENA_CANONICAL_TTS_VOICE } from "./speech-voices.js";

export interface AssistantPreferences { voice: string; ttsEnabled: boolean; gifEnabled: boolean; remember: boolean; }
export interface AssistantNote { id: string; subject: string; title: string; content: string; updatedAt: string; }
/** One ecosystem-owned private store, partitioned by both tenant and canonical user. */
export class StellarAssistantStore {
  private readonly db: DatabaseSync;
  constructor(path: string) {
    this.db = new DatabaseSync(path); this.db.exec("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000");
    this.db.exec(`CREATE TABLE IF NOT EXISTS stellar_preferences(tenant TEXT NOT NULL, user_id TEXT NOT NULL, body TEXT NOT NULL, PRIMARY KEY(tenant,user_id));
      CREATE TABLE IF NOT EXISTS stellar_notes(tenant TEXT NOT NULL,user_id TEXT NOT NULL,id TEXT NOT NULL,body TEXT NOT NULL,PRIMARY KEY(tenant,user_id,id));`);
  }
  preferences(tenant: string, user: string): AssistantPreferences {
    const row = this.db.prepare("SELECT body FROM stellar_preferences WHERE tenant=? AND user_id=?").get(tenant,user);
    return row ? JSON.parse(String(row.body)) : { voice: ATHENA_CANONICAL_TTS_VOICE, ttsEnabled: false, gifEnabled: true, remember: false };
  }
  savePreferences(tenant: string, user: string, input: Partial<AssistantPreferences>) {
    const next = this.preferences(tenant,user);
    if (input.voice !== undefined) { if (!TTS_VOICE_OPTIONS.some(v => v.id === input.voice)) throw new Error("Choose a supported voice"); next.voice = input.voice; }
    for (const key of ["ttsEnabled","gifEnabled","remember"] as const) if (input[key] !== undefined) { if (typeof input[key] !== "boolean") throw new Error("Preference must be true or false"); next[key] = input[key]; }
    this.db.prepare("INSERT INTO stellar_preferences VALUES(?,?,?) ON CONFLICT(tenant,user_id) DO UPDATE SET body=excluded.body").run(tenant,user,JSON.stringify(next)); return next;
  }
  notes(tenant: string, user: string) { return this.db.prepare("SELECT body FROM stellar_notes WHERE tenant=? AND user_id=? ORDER BY id LIMIT 500").all(tenant,user).map(r => JSON.parse(String(r.body)) as AssistantNote); }
  saveNote(tenant: string, user: string, input: Partial<AssistantNote>) {
    const note: AssistantNote = { id: input.id ? field(input.id,200) : randomUUID(), subject: field(input.subject ?? "memory",200), title: field(input.title,200), content: field(input.content,20_000), updatedAt: new Date().toISOString() };
    if (!this.notes(tenant,user).some(n => n.id === note.id) && this.notes(tenant,user).length >= 500) throw new Error("Remove a note before adding more");
    this.db.prepare("INSERT INTO stellar_notes VALUES(?,?,?,?) ON CONFLICT(tenant,user_id,id) DO UPDATE SET body=excluded.body").run(tenant,user,note.id,JSON.stringify(note)); return note;
  }
  deleteNote(tenant: string, user: string, id: string) { this.db.prepare("DELETE FROM stellar_notes WHERE tenant=? AND user_id=? AND id=?").run(tenant,user,id); }
  deleteForUser(tenant: string,user: string) { this.db.prepare("DELETE FROM stellar_notes WHERE tenant=? AND user_id=?").run(tenant,user); this.db.prepare("DELETE FROM stellar_preferences WHERE tenant=? AND user_id=?").run(tenant,user); }
  close() { this.db.close(); }
}
function field(value: unknown,max: number) { if (typeof value !== "string" || !value.trim() || value.length > max || value.includes("\0")) throw new Error("Note field is missing or too large"); return value.trim(); }
