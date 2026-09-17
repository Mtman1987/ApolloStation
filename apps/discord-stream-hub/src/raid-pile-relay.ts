import { DatabaseSync } from "node:sqlite";
import type { DshRaidPileMemberV1 } from "./raid-pile.js";

export interface DshRaidPileHoldingChannelV1 {
  providerUserId: string;
  twitchLogin: string;
  displayName: string;
  live: boolean;
}

export interface DshRaidPileRelayStateV1 {
  tenantId: string;
  pileId: string;
  mode: "pile" | "holding";
  physicalTargetUserId?: string;
  physicalTargetLogin?: string;
  physicalTargetName?: string;
  holdingProviderUserId?: string;
  holdingLogin?: string;
  announcedTargetUserId?: string;
  announcedTargetLogin?: string;
  announcedTargetName?: string;
  returnPending: boolean;
  updatedAt: string;
}

/**
 * Tracks where the lurker audience physically is separately from the next announced pile target.
 * When no pile member is live, the controlled Twitch holding channel becomes the actual holder.
 * The system never claims the audience returned to a member until Twitch reports the holding
 * channel raided that member. This keeps passive lurkers physically inside the pile chain.
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

  attachHoldingChannel(tenantId: string, pileId: string, holding: DshRaidPileHoldingChannelV1) {
    if (!holding.live) throw new Error("Raid Pile holding channel must be live before receiving the pile");
    requireId(holding.providerUserId, "holding provider user id");
    const state: DshRaidPileRelayStateV1 = {
      tenantId, pileId, mode: "holding",
      physicalTargetUserId: holding.providerUserId,
      physicalTargetLogin: holding.twitchLogin,
      physicalTargetName: holding.displayName,
      holdingProviderUserId: holding.providerUserId,
      holdingLogin: holding.twitchLogin,
      announcedTargetUserId: holding.providerUserId,
      announcedTargetLogin: holding.twitchLogin,
      announcedTargetName: holding.displayName,
      returnPending: false,
      updatedAt: this.now(),
    };
    this.put(state); return state;
  }

  /** A pile member is available again. Announce them, but physical audience stays on holding until Twitch confirms the raid. */
  requestReturn(tenantId: string, pileId: string, member: DshRaidPileMemberV1) {
    const current = this.view(tenantId, pileId);
    if (current.mode !== "holding") return this.setPile(tenantId, pileId, member);
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

  /** Only a confirmed holding-channel -> pile-member raid may move the physical audience state back to pile mode. */
  observeRaid(tenantId: string, pileId: string, fromProviderUserId: string, to: DshRaidPileMemberV1) {
    const current = this.view(tenantId, pileId);
    if (current.mode !== "holding" || !current.returnPending) return current;
    if (current.holdingProviderUserId !== fromProviderUserId || current.announcedTargetUserId !== to.userId) return current;
    return this.setPile(tenantId, pileId, to);
  }

  setPile(tenantId: string, pileId: string, member: DshRaidPileMemberV1) {
    const state: DshRaidPileRelayStateV1 = {
      tenantId, pileId, mode: "pile",
      physicalTargetUserId: member.userId,
      physicalTargetLogin: member.twitchLogin,
      physicalTargetName: member.displayName,
      announcedTargetUserId: member.userId,
      announcedTargetLogin: member.twitchLogin,
      announcedTargetName: member.displayName,
      returnPending: false,
      updatedAt: this.now(),
    };
    this.put(state); return state;
  }

  private put(state: DshRaidPileRelayStateV1) {
    this.db.prepare("INSERT INTO raid_pile_relay(tenant_id,pile_id,body) VALUES(?,?,?) ON CONFLICT(tenant_id,pile_id) DO UPDATE SET body=excluded.body").run(state.tenantId, state.pileId, JSON.stringify(state));
  }
}

function requireId(value: string, name: string) { if (!value || value.length > 180 || /[\r\n\0]/.test(value)) throw new Error(`${name} is invalid`); }
