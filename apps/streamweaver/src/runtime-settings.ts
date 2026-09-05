import { DatabaseSync } from "node:sqlite";
import type { StreamWeaverTenantLinksV1 } from "./donor-command-services.js";

export const STREAMWEAVER_LINK_KEYS = ["discord","hover","instagram","merch","tiktok","twitter","webpage","youtube"] as const;
/** Public creator links only; provider identities and credentials stay in Account. */
export class StreamWeaverRuntimeSettingsStore {
  private readonly db: DatabaseSync;
  constructor(path: string) {
    this.db = new DatabaseSync(path,{timeout:5000});
    this.db.exec("PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS streamweaver_creator_links(tenant_id TEXT PRIMARY KEY, body TEXT NOT NULL) STRICT;");
    this.db.exec("CREATE TABLE IF NOT EXISTS streamweaver_voice_history(tenant_id TEXT NOT NULL,user_id TEXT NOT NULL,request_id TEXT NOT NULL,body TEXT NOT NULL,PRIMARY KEY(tenant_id,user_id,request_id)) STRICT;");
  }
  close() { this.db.close(); }
  voiceHistory(tenantId:string,userId:string) {
    return (this.db.prepare("SELECT body FROM streamweaver_voice_history WHERE tenant_id=? AND user_id=? ORDER BY rowid DESC LIMIT 50").all(tenantId,userId) as Array<{body:string}>).map(row=>JSON.parse(row.body) as Record<string,unknown>);
  }
  recordVoice(tenantId:string,userId:string,requestId:string,body:Record<string,unknown>) {
    this.db.prepare("INSERT INTO streamweaver_voice_history VALUES(?,?,?,?) ON CONFLICT(tenant_id,user_id,request_id) DO UPDATE SET body=excluded.body").run(tenantId,userId,requestId,JSON.stringify(body));
    this.db.prepare("DELETE FROM streamweaver_voice_history WHERE tenant_id=? AND user_id=? AND request_id NOT IN (SELECT request_id FROM streamweaver_voice_history WHERE tenant_id=? AND user_id=? ORDER BY rowid DESC LIMIT 50)").run(tenantId,userId,tenantId,userId);
  }
  clearVoice(tenantId:string,userId:string) { this.db.prepare("DELETE FROM streamweaver_voice_history WHERE tenant_id=? AND user_id=?").run(tenantId,userId); }
  getLinks(tenantId: string): StreamWeaverTenantLinksV1 {
    const row = this.db.prepare("SELECT body FROM streamweaver_creator_links WHERE tenant_id=?").get(tenantId) as {body:string}|undefined;
    return row ? JSON.parse(row.body) as StreamWeaverTenantLinksV1 : {};
  }
  saveLinks(tenantId: string, values: Record<string,unknown>) {
    const links: StreamWeaverTenantLinksV1 = {};
    for (const key of STREAMWEAVER_LINK_KEYS) {
      const value = String(values[key] ?? "").trim(); if(!value)continue;
      const url = new URL(value);
      if(url.protocol!=="https:"||url.username||url.password||value.length>2000)throw new Error(`${key} must be a public HTTPS link`);
      links[key]=url.href;
    }
    this.db.prepare("INSERT OR REPLACE INTO streamweaver_creator_links VALUES(?,?)").run(tenantId,JSON.stringify(links));
    return links;
  }
}
