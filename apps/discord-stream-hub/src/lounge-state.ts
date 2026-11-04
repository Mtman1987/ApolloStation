import { DatabaseSync } from "node:sqlite";

export type DshLoungeModeV1 = "lounge" | "raid-pile" | "raid-train" | "event" | "maintenance";

export interface DshLoungeFeatureV1 {
  kind: "community" | "creator" | "event" | "partner" | "nebula" | "message";
  id: string;
  title: string;
  detail?: string;
  url?: string;
}

export interface DshLoungeStateV1 {
  schemaVersion: 1;
  tenantId: string;
  twitchLogin: "spacemountainlive";
  mode: DshLoungeModeV1;
  headline: string;
  features: DshLoungeFeatureV1[];
  pileIds: string[];
  physicalAudienceHolder?: string;
  announcedTarget?: string;
  raidReturnPending: boolean;
  updatedAt: string;
}

type MutableLoungeKeyV1 = Exclude<keyof DshLoungeStateV1, "schemaVersion" | "tenantId" | "twitchLogin" | "updatedAt">;
type DshLoungeStatePatchV1 = { [K in MutableLoungeKeyV1]?: DshLoungeStateV1[K] | undefined };

/**
 * Durable presentation/context state for the SpaceMountainLive Lounge. The overlay
 * and Stella consume the same record so Stella can talk about what viewers are
 * actually seeing instead of maintaining a second, drifting interpretation.
 */
export class DshLoungeStateStore {
  private readonly db: DatabaseSync;
  constructor(path: string, private readonly now: () => string = () => new Date().toISOString()) {
    this.db = new DatabaseSync(path, { timeout: 5_000 });
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
      CREATE TABLE IF NOT EXISTS dsh_lounge_state(
        tenant_id TEXT PRIMARY KEY,
        body TEXT NOT NULL
      ) STRICT;`);
  }
  close() { this.db.close(); }

  view(tenantId: string): DshLoungeStateV1 {
    const row = this.db.prepare("SELECT body FROM dsh_lounge_state WHERE tenant_id=?").get(tenantId) as { body: string } | undefined;
    if (row) return JSON.parse(row.body) as DshLoungeStateV1;
    return {
      schemaVersion: 1,
      tenantId,
      twitchLogin: "spacemountainlive",
      mode: "lounge",
      headline: "SpaceMountainLive Lounge",
      features: [],
      pileIds: [],
      raidReturnPending: false,
      updatedAt: this.now(),
    };
  }

  update(tenantId: string, patch: DshLoungeStatePatchV1) {
    const current = this.view(tenantId);
    const next: DshLoungeStateV1 = {
      ...current,
      ...(patch.mode === undefined ? {} : { mode: patch.mode }),
      ...(patch.headline === undefined ? {} : { headline: patch.headline }),
      ...(patch.raidReturnPending === undefined ? {} : { raidReturnPending: patch.raidReturnPending }),
      schemaVersion: 1,
      tenantId,
      twitchLogin: "spacemountainlive",
      features: patch.features ? patch.features.map(feature => ({ ...feature })) : current.features,
      pileIds: patch.pileIds ? [...new Set(patch.pileIds)] : current.pileIds,
      updatedAt: this.now(),
    };
    if ("physicalAudienceHolder" in patch) {
      if (patch.physicalAudienceHolder === undefined) delete next.physicalAudienceHolder;
      else next.physicalAudienceHolder = patch.physicalAudienceHolder;
    }
    if ("announcedTarget" in patch) {
      if (patch.announcedTarget === undefined) delete next.announcedTarget;
      else next.announcedTarget = patch.announcedTarget;
    }
    validate(next);
    this.db.prepare("INSERT INTO dsh_lounge_state(tenant_id,body) VALUES(?,?) ON CONFLICT(tenant_id) DO UPDATE SET body=excluded.body").run(tenantId, JSON.stringify(next));
    return next;
  }

  setIdle(tenantId: string, features: DshLoungeFeatureV1[] = []) {
    return this.update(tenantId, {
      mode: "lounge",
      headline: "SpaceMountainLive Lounge",
      features,
      pileIds: [],
      raidReturnPending: false,
      physicalAudienceHolder: undefined,
      announcedTarget: undefined,
    });
  }

  setRaidPile(tenantId: string, input: { pileIds: string[]; physicalAudienceHolder: string; announcedTarget?: string; returnPending?: boolean; features?: DshLoungeFeatureV1[] }) {
    return this.update(tenantId, {
      mode: "raid-pile",
      headline: input.returnPending ? "Raid Pile handoff in progress" : "Raid Pile Lounge",
      pileIds: input.pileIds,
      physicalAudienceHolder: input.physicalAudienceHolder,
      raidReturnPending: Boolean(input.returnPending),
      ...(input.announcedTarget === undefined ? {} : { announcedTarget: input.announcedTarget }),
      ...(input.features ? { features: input.features } : {}),
    });
  }
}

function validate(state: DshLoungeStateV1) {
  if (!state.tenantId || state.tenantId.length > 300) throw new Error("Lounge tenant is invalid");
  if (!state.headline.trim() || state.headline.length > 180) throw new Error("Lounge headline is invalid");
  if (state.features.length > 100 || state.pileIds.length > 100) throw new Error("Lounge state is too large");
  for (const feature of state.features) {
    if (!feature.id || !feature.title || feature.id.length > 180 || feature.title.length > 180) throw new Error("Lounge feature is invalid");
    if (feature.url && !/^https:\/\//i.test(feature.url)) throw new Error("Lounge feature URL must use HTTPS");
  }
  return state;
}
