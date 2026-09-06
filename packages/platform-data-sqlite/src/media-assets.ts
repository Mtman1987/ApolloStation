import { createHash, randomBytes, randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { MEDIA_ASSET_MAX_BYTES, type MediaAssetV1, type MediaAssetUploadV1 } from "@spmt/contracts";

export class MediaAssetError extends Error { constructor(readonly status: number, message: string) { super(message); } }
interface Row { body: string; bytes: Uint8Array; public_id: string | null; }
export class SqliteMediaAssetStore {
  private readonly db: DatabaseSync;
  constructor(path: string, private readonly now = () => Date.now()) {
    this.db = new DatabaseSync(path, { timeout: 5000 });
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
      CREATE TABLE IF NOT EXISTS media_assets(id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, owner_user_id TEXT NOT NULL, created_at TEXT NOT NULL, expires_at TEXT, idempotency_key TEXT NOT NULL, signature TEXT NOT NULL, byte_length INTEGER NOT NULL, public_id TEXT UNIQUE, body TEXT NOT NULL, bytes BLOB NOT NULL, UNIQUE(tenant_id,owner_user_id,idempotency_key)) STRICT;
      CREATE INDEX IF NOT EXISTS media_assets_owner ON media_assets(tenant_id,owner_user_id,created_at DESC,id DESC);
      CREATE INDEX IF NOT EXISTS media_assets_expiry ON media_assets(expires_at);`);
  }
  close() { this.db.close(); }
  sweep() { return Number(this.db.prepare("DELETE FROM media_assets WHERE expires_at IS NOT NULL AND expires_at<=?").run(this.time()).changes); }
  usedBytes(tenantId: string) { return Number((this.db.prepare("SELECT COALESCE(SUM(byte_length),0) AS used FROM media_assets WHERE tenant_id=? AND (expires_at IS NULL OR expires_at>?)").get(tenantId, this.time()) as { used: number }).used); }
  upload(input: MediaAssetUploadV1 & { tenantId: string; ownerUserId: string; sourceAppId: string; jobId?: string; idempotencyKey: string; limitBytes: number }, bytes: Uint8Array): MediaAssetV1 {
    validateMedia(input, bytes);
    for (const value of [input.tenantId, input.ownerUserId, input.sourceAppId, input.idempotencyKey]) if (!value || value.length > 200 || value.trim() !== value) throw new MediaAssetError(400, "Media identity or idempotency key is invalid");
    if (!Number.isSafeInteger(input.limitBytes) || input.limitBytes < 0) throw new MediaAssetError(400, "Storage limit is invalid");
    const sha256 = hash(bytes), signature = hash(JSON.stringify([input.sourceAppId,input.jobId??null,input.name,input.contentType,input.purpose,input.expiresInSeconds??null,sha256]));
    return this.transaction(() => {
      this.sweep();
      const prior = this.db.prepare("SELECT body,signature FROM media_assets WHERE tenant_id=? AND owner_user_id=? AND idempotency_key=?").get(input.tenantId,input.ownerUserId,input.idempotencyKey) as { body: string; signature: string } | undefined;
      if (prior) { if (prior.signature !== signature) throw new MediaAssetError(409, "Media idempotency key was reused for different content"); return JSON.parse(prior.body) as MediaAssetV1; }
      if (Number((this.db.prepare("SELECT COUNT(*) AS count FROM media_assets WHERE tenant_id=?").get(input.tenantId) as {count:number}).count) >= 20000) throw new MediaAssetError(413,"This workspace has reached the 20,000 media file limit; delete unused files");
      if (this.usedBytes(input.tenantId) + bytes.byteLength > input.limitBytes) throw new MediaAssetError(413, "Your plan's shared media storage allowance is full; delete unused assets or change plan");
      const asset: MediaAssetV1 = { schemaVersion:1,id:randomUUID(),tenantId:input.tenantId,ownerUserId:input.ownerUserId,sourceAppId:input.sourceAppId,purpose:input.purpose,name:input.name,contentType:input.contentType,byteLength:bytes.byteLength,sha256,createdAt:this.time(),...(input.expiresInSeconds?{expiresAt:new Date(this.now()+input.expiresInSeconds*1000).toISOString()}:{}),...(input.jobId?{jobId:input.jobId}:{}) };
      this.db.prepare("INSERT INTO media_assets(id,tenant_id,owner_user_id,created_at,expires_at,idempotency_key,signature,byte_length,body,bytes) VALUES(?,?,?,?,?,?,?,?,?,?)").run(asset.id,asset.tenantId,asset.ownerUserId,asset.createdAt,asset.expiresAt??null,input.idempotencyKey,signature,asset.byteLength,JSON.stringify(asset),bytes);
      return asset;
    });
  }
  get(id: string): MediaAssetV1 | undefined { const row=this.db.prepare("SELECT body FROM media_assets WHERE id=? AND (expires_at IS NULL OR expires_at>?)").get(id,this.time()) as {body:string}|undefined;return row?JSON.parse(row.body) as MediaAssetV1:undefined; }
  content(id: string) { const row=this.db.prepare("SELECT body,bytes,public_id FROM media_assets WHERE id=? AND (expires_at IS NULL OR expires_at>?)").get(id,this.time()) as Row|undefined;return row?{asset:JSON.parse(row.body) as MediaAssetV1,bytes:row.bytes}:undefined; }
  publicContent(publicId: string) { const row=this.db.prepare("SELECT body,bytes,public_id FROM media_assets WHERE public_id=? AND (expires_at IS NULL OR expires_at>?)").get(publicId,this.time()) as Row|undefined;return row?{asset:JSON.parse(row.body) as MediaAssetV1,bytes:row.bytes}:undefined; }
  list(tenantId: string, ownerUserId: string, cursor?: string, limit=50) {
    let after: string[]|undefined;
    if(cursor){try{const parsed=JSON.parse(Buffer.from(cursor,"base64url").toString());if(!Array.isArray(parsed)||parsed.length!==2||parsed.some(v=>typeof v!=="string")||!Number.isFinite(Date.parse(parsed[0])))throw new Error();after=parsed;}catch{throw new MediaAssetError(400,"Media cursor is invalid");}}
    const rows=this.db.prepare(`SELECT body FROM media_assets WHERE tenant_id=? AND owner_user_id=? AND (expires_at IS NULL OR expires_at>?) ${after?"AND (created_at<? OR (created_at=? AND id<?))":""} ORDER BY created_at DESC,id DESC LIMIT ?`).all(tenantId,ownerUserId,this.time(),...(after?[after[0]!,after[0]!,after[1]!]:[]),limit+1) as Array<{body:string}>;
    const assets=rows.slice(0,limit).map(row=>JSON.parse(row.body) as MediaAssetV1),last=assets.at(-1);
    return {assets,...(rows.length>limit&&last?{nextCursor:Buffer.from(JSON.stringify([last.createdAt,last.id])).toString("base64url")}: {})};
  }
  publish(id: string, baseUrl: string) { return this.transaction(()=>{const asset=this.get(id);if(!asset)throw new MediaAssetError(404,"Media asset was not found");if(asset.publicUrl)return asset;const publicId=randomBytes(32).toString("base64url");asset.publicUrl=`${baseUrl.replace(/\/$/,"")}/v1/media/public/${publicId}`;this.db.prepare("UPDATE media_assets SET public_id=?,body=? WHERE id=?").run(publicId,JSON.stringify(asset),id);return asset;}); }
  revoke(id: string) { return this.transaction(()=>{const asset=this.get(id);if(!asset)throw new MediaAssetError(404,"Media asset was not found");delete asset.publicUrl;this.db.prepare("UPDATE media_assets SET public_id=NULL,body=? WHERE id=?").run(JSON.stringify(asset),id);return asset;}); }
  delete(id: string) { this.db.prepare("DELETE FROM media_assets WHERE id=?").run(id); }
  private time() { return new Date(this.now()).toISOString(); }
  private transaction<T>(work:()=>T):T { this.db.exec("BEGIN IMMEDIATE");try{const result=work();this.db.exec("COMMIT");return result;}catch(error){this.db.exec("ROLLBACK");throw error;} }
}
function hash(value: string|Uint8Array) { return createHash("sha256").update(value).digest("hex"); }
function validateMedia(input:MediaAssetUploadV1,bytes:Uint8Array) {
  if(!input.name||input.name.length>180||/[\x00-\x1f\x7f/\\]/.test(input.name))throw new MediaAssetError(400,"Use a media filename without paths or control characters");
  if(!["recording","speech","image","avatar","attachment","video"].includes(input.purpose))throw new MediaAssetError(400,"Media purpose is invalid");
  if(input.expiresInSeconds!==undefined&&(!Number.isSafeInteger(input.expiresInSeconds)||input.expiresInSeconds<60||input.expiresInSeconds>30*86400))throw new MediaAssetError(400,"Media lifetime must be between one minute and 30 days");
  if(!bytes.byteLength||bytes.byteLength>MEDIA_ASSET_MAX_BYTES)throw new MediaAssetError(413,"Media must contain between one byte and 8 MiB");
  const data=Buffer.from(bytes),text=(start:number,end:number)=>data.subarray(start,end).toString("ascii"),hex=(start:number,end:number)=>data.subarray(start,end).toString("hex");
  const supported:Record<string,boolean>={"image/png":hex(0,8)==="89504e470d0a1a0a","image/jpeg":hex(0,3)==="ffd8ff","image/gif":["GIF87a","GIF89a"].includes(text(0,6)),"image/webp":text(0,4)==="RIFF"&&text(8,12)==="WEBP","audio/wav":text(0,4)==="RIFF"&&text(8,12)==="WAVE","audio/mpeg":text(0,3)==="ID3"||(data[0]===255&&((data[1]??0)&224)===224),"audio/ogg":text(0,4)==="OggS","audio/webm":hex(0,4)==="1a45dfa3","video/webm":hex(0,4)==="1a45dfa3","video/mp4":text(4,8)==="ftyp"};
  if(!supported[input.contentType])throw new MediaAssetError(415,"Unsupported media type or file signature; use PNG, JPEG, GIF, WebP, MP3, WAV, Ogg, WebM or MP4");
  if(["avatar","image"].includes(input.purpose)&&!input.contentType.startsWith("image/"))throw new MediaAssetError(415,"An image is required for this asset");
  if(["recording","speech"].includes(input.purpose)&&!input.contentType.startsWith("audio/"))throw new MediaAssetError(415,"Audio is required for this asset");
  if(input.purpose==="video"&&!input.contentType.startsWith("video/"))throw new MediaAssetError(415,"Video is required for this asset");
}
