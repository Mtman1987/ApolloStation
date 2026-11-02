import { DatabaseSync } from "node:sqlite";
import {
  DSH_BANNER_DURATION_SECONDS,
  DSH_BANNER_FPS,
  DSH_BANNER_GIF_PALETTE,
  DSH_BANNER_HEIGHT,
  DSH_BANNER_VERSION,
  DSH_BANNER_WIDTH,
  buildDshBannerHtml,
  dshBannerFrameTimesMs,
  dshBannerStorageKey,
  normalizeDshBannerVariant,
  resolveDshBannerVariant,
  type DshBannerVariantV1,
} from "./banner-policy.js";

export interface DshBannerRenderRequestV1 {
  schemaVersion: 1;
  twitchLogin: string;
  variant: DshBannerVariantV1;
  html: string;
  width: number;
  height: number;
  frameTimesMs: number[];
  fps: number;
  palette: typeof DSH_BANNER_GIF_PALETTE;
}
export interface DshBannerRendererV1 { renderGif(request: DshBannerRenderRequestV1): Promise<Uint8Array>; }
export interface DshStoredBannerV1 { twitchLogin: string; variant: DshBannerVariantV1; version: string; generatedAt: string; width: number; height: number; fps: number; durationSeconds: number; gif: Uint8Array; }

/**
 * App-private, renderer-neutral banner authority. A clip worker supplies the
 * Chromium/FFmpeg renderer, while DSH owns role selection, deterministic frame
 * time, optimized palette settings, current-version checks, and durable bytes.
 */
export class SqliteDshRoleAwareBannerService {
  private readonly db: DatabaseSync;
  constructor(path: string, private readonly renderer: DshBannerRendererV1, private readonly now: () => string = () => new Date().toISOString()) {
    if (!path) throw new Error("DSH banner database path is required");
    this.db = new DatabaseSync(path, { timeout: 5_000 });
    this.db.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;");
    this.db.exec("CREATE TABLE IF NOT EXISTS dsh_role_banners_v2(tenant_id TEXT NOT NULL,twitch_login TEXT NOT NULL,variant TEXT NOT NULL,version TEXT NOT NULL,generated_at TEXT NOT NULL,metadata TEXT NOT NULL,gif BLOB NOT NULL,PRIMARY KEY(tenant_id,twitch_login)) STRICT;");
  }
  close(): void { this.db.close(); }
  get(twitchLogin: string, expectedVariant?: DshBannerVariantV1): DshStoredBannerV1 | undefined { return this.getForTenant("default",twitchLogin,expectedVariant); }
  getForTenant(tenantId:string,twitchLogin:string,expectedVariant?:DshBannerVariantV1):DshStoredBannerV1|undefined {
    const key=dshBannerStorageKey(twitchLogin),tenant=String(tenantId??"").trim();
    if(!key||!tenant||tenant.length>180)return undefined;
    const row=this.db.prepare("SELECT variant,version,generated_at AS generatedAt,metadata,gif FROM dsh_role_banners_v2 WHERE tenant_id=? AND twitch_login=?").get(tenant,key) as {variant:string;version:string;generatedAt:string;metadata:string;gif:Uint8Array}|undefined;
    if(!row||row.version!==DSH_BANNER_VERSION)return undefined;
    const variant=normalizeDshBannerVariant(row.variant);if(expectedVariant&&variant!==expectedVariant)return undefined;
    const metadata=JSON.parse(row.metadata) as {width:number;height:number;fps:number;durationSeconds:number};
    return {twitchLogin:key,variant,version:row.version,generatedAt:row.generatedAt,...metadata,gif:new Uint8Array(row.gif)};
  }
  async generate(twitchLogin: string, requestedVariant: DshBannerVariantV1, tenantId="default"): Promise<DshStoredBannerV1> {
    const key = dshBannerStorageKey(twitchLogin),tenant=String(tenantId??"").trim();
    if (!key) throw new Error("A valid Twitch login is required to generate a banner");
    if(!tenant||tenant.length>180)throw new Error("A valid tenant ID is required to generate a banner");
    const variant = normalizeDshBannerVariant(requestedVariant);
    const existing = this.getForTenant(tenant,key,variant);
    if (existing) return existing;
    const gif = await this.renderer.renderGif({ schemaVersion: 1, twitchLogin:key, variant, html: buildDshBannerHtml(key, variant), width: DSH_BANNER_WIDTH, height: DSH_BANNER_HEIGHT, frameTimesMs: dshBannerFrameTimesMs(), fps: DSH_BANNER_FPS, palette: DSH_BANNER_GIF_PALETTE });
    if (gif.byteLength < 6 || String.fromCharCode(...gif.slice(0, 6)) !== "GIF89a") throw new Error("DSH banner renderer returned an invalid GIF");
    const generatedAt = new Date(this.now()).toISOString();
    const metadata = { width: DSH_BANNER_WIDTH, height: DSH_BANNER_HEIGHT, fps: DSH_BANNER_FPS, durationSeconds: DSH_BANNER_DURATION_SECONDS };
    this.db.prepare("INSERT INTO dsh_role_banners_v2(tenant_id,twitch_login,variant,version,generated_at,metadata,gif) VALUES(?,?,?,?,?,?,?) ON CONFLICT(tenant_id,twitch_login) DO UPDATE SET variant=excluded.variant,version=excluded.version,generated_at=excluded.generated_at,metadata=excluded.metadata,gif=excluded.gif")
      .run(tenant, key, variant, DSH_BANNER_VERSION, generatedAt, JSON.stringify(metadata), gif);
    return { twitchLogin: key, variant, version: DSH_BANNER_VERSION, generatedAt, ...metadata, gif: new Uint8Array(gif) };
  }

  /** One reusable red ticker used by Community Spotlight embeds. */
  communitySpotlight(tenantId="default"): Promise<DshStoredBannerV1> {
    return this.generate("community-spotlight", "spotlight",tenantId);
  }
}

export interface DshBannerMediaPublisherV1 { publishMedia(tenantId:string,mime:"image/gif",bytes:Uint8Array):string|undefined; }
export class DshRoleAwareBannerMediaSource {
  constructor(private readonly service:SqliteDshRoleAwareBannerService,private readonly publisher:DshBannerMediaPublisherV1){}
  async getBannerUrl(input:{tenantId:string;member:{twitchLogin:string;group:string}}):Promise<string|undefined>{
    const variant=resolveDshBannerVariant({twitchLogin:input.member.twitchLogin,group:input.member.group});
    const banner=await this.service.generate(input.member.twitchLogin,variant,input.tenantId);
    return this.publisher.publishMedia(input.tenantId,"image/gif",banner.gif);
  }
  close(){this.service.close();}
}
