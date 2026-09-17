import { DatabaseSync } from "node:sqlite";
import type { DshRaidPileMemberV1 } from "./raid-pile.js";

export type DshRaidPileRelayKindV1 = "raid-train" | "partner-train";
export interface DshRaidPileRelayTargetV1 {
  kind: DshRaidPileRelayKindV1;
  trainId: string;
  userId: string;
  twitchLogin: string;
  displayName: string;
  live: boolean;
}
export interface DshRaidPileRelayStateV1 {
  tenantId: string;
  pileId: string;
  mode: "pile" | "train";
  physicalTargetUserId?: string;
  physicalTargetLogin?: string;
  physicalTargetName?: string;
  relayKind?: DshRaidPileRelayKindV1;
  relayTrainId?: string;
  announcedTargetUserId?: string;
  announcedTargetLogin?: string;
  announcedTargetName?: string;
  returnPending: boolean;
  updatedAt: string;
}

/**
 * Tracks where the lurker audience physically is, separately from the target DSH is announcing next.
 * A train fallback is not complete until an observed raid proves the train handed the audience back
 * to a Raid Pile member. This prevents UI state from pretending stranded lurkers moved when they did not.
 */
export class DshRaidPileRelayStore {
  private readonly db: DatabaseSync;
  constructor(path: string, private readonly now: () => string = () => new Date().toISOString()) {
    if (!path) throw new Error("Raid Pile relay database path is required");
    this.db = new DatabaseSync(path, { timeout: 5_000 });
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
      CREATE TABLE IF NOT EXISTS raid_pile_relay(
        tenant_id TEXT NOT NULL,pile_id TEXT NOT NULL,body TEXT NOT NULL,
        PRIMARY KEY(tenant_id,pile_id)
      ) STRICT;`);
  }
  close() { this.db.close(); }

  view(tenantId: string, pileId: string): DshRaidPileRelayStateV1 {
    const row = this.db.prepare("SELECT body FROM raid_pile_relay WHERE tenant_id=? AND pile_id=?").get(tenantId, pileId) as { body: string } | undefined;
    return row ? JSON.parse(row.body) as DshRaidPileRelayStateV1 : { tenantId, pileId, mode: "pile", returnPending: false, updatedAt: this.now() };
  }

  /** Prefer our own train; approved partner trains are the second transport fallback. */
  chooseTrain(ownTrain: DshRaidPileRelayTargetV1[], partnerTrains: DshRaidPileRelayTargetV1[]) {
    const eligible = (values: DshRaidPileRelayTargetV1[], kind: DshRaidPileRelayKindV1) => values.filter(value => value.kind === kind && value.live).sort((a, b) => a.trainId.localeCompare(b.trainId) || a.userId.localeCompare(b.userId));
    return eligible(ownTrain, "raid-train")[0] ?? eligible(partnerTrains, "partner-train")[0];
  }

  attachTrain(tenantId: string, pileId: string, target: DshRaidPileRelayTargetV1) {
    if (!target.live) throw new Error("Raid Pile can only attach to a live train target");
    const state: DshRaidPileRelayStateV1 = {
      tenantId, pileId, mode: "train",
      physicalTargetUserId: target.userId, physicalTargetLogin: target.twitchLogin, physicalTargetName: target.displayName,
      relayKind: target.kind, relayTrainId: target.trainId,
      announcedTargetUserId: target.userId, announcedTargetLogin: target.twitchLogin, announcedTargetName: target.displayName,
      returnPending: false, updatedAt: this.now(),
    };
    this.put(state); return state;
  }

  /** A pile member is available again, but lurkers stay on the train until the real handoff is observed. */
  requestReturn(tenantId: string, pileId: string, member: DshRaidPileMemberV1) {
    const current = this.view(tenantId, pileId);
    if (current.mode !== "train") return this.setPile(tenantId, pileId, member);
    const state: DshRaidPileRelayStateV1 = {
      ...current,
      announcedTargetUserId: member.userId,
      announcedTargetLogin: member.twitchLogin,
      announcedTargetName: member.displayName,
      returnPending: true,
      updatedAt: this.now(),
    };
    this.put(state); return state;
  }

  /** Only an observed train -> member raid is allowed to move the physical audience state back to pile mode. */
  observeRaid(tenantId: string, pileId: string, fromUserId: string, to: DshRaidPileMemberV1) {
    const current = this.view(tenantId, pileId);
    if (current.mode !== "train" || !current.returnPending) return current;
    if (current.physicalTargetUserId !== fromUserId || current.announcedTargetUserId !== to.userId) return current;
    return this.setPile(tenantId, pileId, to);
  }

  setPile(tenantId: string, pileId: string, member: DshRaidPileMemberV1) {
    const state: DshRaidPileRelayStateV1 = {
      tenantId, pileId, mode: "pile",
      physicalTargetUserId: member.userId, physicalTargetLogin: member.twitchLogin, physicalTargetName: member.displayName,
      announcedTargetUserId: member.userId, announcedTargetLogin: member.twitchLogin, announcedTargetName: member.displayName,
      returnPending: false, updatedAt: this.now(),
    };
    this.put(state); return state;
  }

  private put(state: DshRaidPileRelayStateV1) {
    this.db.prepare("INSERT INTO raid_pile_relay(tenant_id,pile_id,body) VALUES(?,?,?) ON CONFLICT(tenant_id,pile_id) DO UPDATE SET body=excluded.body").run(state.tenantId, state.pileId, JSON.stringify(state));
  }
}
