import { DatabaseSync } from "node:sqlite";
import type { DshStellaAvatarGestureV1, DshStellaAvatarPersistentStateV1 } from "./lounge-avatar.js";

export interface DshLoungeHostStateV1 {
  schemaVersion: 1;
  tenantId: string;
  host: "stella";
  persistent: DshStellaAvatarPersistentStateV1;
  gesture?: DshStellaAvatarGestureV1;
  gestureNonce: number;
  speaking: boolean;
  currentTopic?: string;
  currentSpeech?: string;
  speechAudioUrl?: string;
  speechStartedAt?: string;
  updatedAt: string;
}

/** Shared host state consumed by the public Lounge overlay. TTS/AI surfaces update this; the overlay never invents host state. */
export class DshLoungeHostStore {
  private readonly db: DatabaseSync;
  constructor(path: string, private readonly now: () => string = () => new Date().toISOString()) {
    this.db = new DatabaseSync(path, { timeout: 5_000 });
    this.db.exec("PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS dsh_lounge_host(tenant_id TEXT PRIMARY KEY,body TEXT NOT NULL) STRICT;");
  }
  close() { this.db.close(); }
  view(tenantId: string): DshLoungeHostStateV1 {
    const tenant = clean(tenantId), row = this.db.prepare("SELECT body FROM dsh_lounge_host WHERE tenant_id=?").get(tenant) as { body: string } | undefined;
    return row ? JSON.parse(row.body) as DshLoungeHostStateV1 : { schemaVersion: 1, tenantId: tenant, host: "stella", persistent: "idle", gestureNonce: 0, speaking: false, updatedAt: this.now() };
  }
  setTalking(tenantId: string, input: { topic?: string; speech?: string; audioUrl?: string } = {}) {
    const current = this.view(tenantId), next: DshLoungeHostStateV1 = { ...current, persistent: "talking", speaking: true, gesture: undefined, currentTopic: bounded(input.topic, 180), currentSpeech: bounded(input.speech, 1200), speechAudioUrl: input.audioUrl ? https(input.audioUrl) : undefined, speechStartedAt: this.now(), updatedAt: this.now() };
    return this.put(next);
  }
  setIdle(tenantId: string) {
    const current = this.view(tenantId), next: DshLoungeHostStateV1 = { ...current, persistent: "idle", speaking: false, gesture: undefined, currentSpeech: undefined, speechAudioUrl: undefined, speechStartedAt: undefined, updatedAt: this.now() };
    return this.put(next);
  }
  gesture(tenantId: string, gesture: DshStellaAvatarGestureV1, topic?: string) {
    const current = this.view(tenantId), next: DshLoungeHostStateV1 = { ...current, gesture, gestureNonce: current.gestureNonce + 1, currentTopic: bounded(topic, 180) ?? current.currentTopic, updatedAt: this.now() };
    return this.put(next);
  }
  clearGesture(tenantId: string, nonce: number) {
    const current = this.view(tenantId); if (current.gestureNonce !== nonce) return current;
    return this.put({ ...current, gesture: undefined, updatedAt: this.now() });
  }
  private put(value: DshLoungeHostStateV1) { this.db.prepare("INSERT INTO dsh_lounge_host(tenant_id,body) VALUES(?,?) ON CONFLICT(tenant_id) DO UPDATE SET body=excluded.body").run(value.tenantId, JSON.stringify(value)); return structuredClone(value); }
}

function clean(value: string) { const result = String(value ?? "").trim(); if (!/^[A-Za-z0-9._:@/-]{1,200}$/.test(result)) throw new Error("Lounge host tenant is invalid"); return result; }
function bounded(value: unknown, maximum: number) { const result = String(value ?? "").trim(); return result ? result.slice(0, maximum) : undefined; }
function https(value: string) { const url = new URL(value); if (url.protocol !== "https:" || url.username || url.password || url.hash) throw new Error("Lounge host audio URL is invalid"); return url.toString(); }
