import { DatabaseSync } from "node:sqlite";
import { NEBULA_ARCADE_GAMES, parseNebulaMessage, type NebulaCommandTargetV1 } from "./game-hub.js";
export const NEBULA_ACTIVITY_VISIBLE_MS = 30_000;
export const NEBULA_CHAT_ACTIVE_MS = 5 * 60_000;
export class SqliteNebulaArcadeActivityStore {
  private readonly db: DatabaseSync;
  constructor(path: string) {
    this.db = new DatabaseSync(path, { timeout: 5000 });
    this.db.exec(`CREATE TABLE IF NOT EXISTS nebula_arcade_channels(tenant_id TEXT NOT NULL,channel_id TEXT NOT NULL,game_ids TEXT NOT NULL,last_spmt_at INTEGER,PRIMARY KEY(tenant_id,channel_id));
      CREATE TABLE IF NOT EXISTS nebula_arcade_members(tenant_id TEXT NOT NULL,channel_id TEXT NOT NULL,actor_id TEXT NOT NULL,game_id TEXT NOT NULL,joined INTEGER NOT NULL,last_seen_at INTEGER NOT NULL,PRIMARY KEY(tenant_id,channel_id,actor_id,game_id));
      CREATE TABLE IF NOT EXISTS nebula_arcade_choices(tenant_id TEXT NOT NULL,channel_id TEXT NOT NULL,actor_id TEXT NOT NULL,targets TEXT NOT NULL,expires_at INTEGER NOT NULL,PRIMARY KEY(tenant_id,channel_id,actor_id));`);
  }
  close() { this.db.close(); }
  configure(tenantId: string, channelId: string, gameIds: string[]) { this.db.prepare("INSERT INTO nebula_arcade_channels VALUES(?,?,?,NULL) ON CONFLICT(tenant_id,channel_id) DO UPDATE SET game_ids=excluded.game_ids").run(tenantId,channelId,JSON.stringify(gameIds)); }
  configuredGames(tenantId: string, channelId: string): string[] { const row=this.db.prepare("SELECT game_ids FROM nebula_arcade_channels WHERE tenant_id=? AND channel_id=?").get(tenantId,channelId) as {game_ids:string}|undefined;return row?JSON.parse(row.game_ids):[]; }
  observe(tenantId: string, channelId: string, actorId: string, text: string, now: number) {
    this.db.prepare("UPDATE nebula_arcade_members SET last_seen_at=MAX(last_seen_at,?) WHERE tenant_id=? AND channel_id=? AND actor_id=?").run(now,tenantId,channelId,actorId);
    if (parseNebulaMessage(text)) this.db.prepare("INSERT INTO nebula_arcade_channels VALUES(?,?,'[]',?) ON CONFLICT(tenant_id,channel_id) DO UPDATE SET last_spmt_at=MAX(COALESCE(last_spmt_at,0),excluded.last_spmt_at)").run(tenantId,channelId,now);
  }
  membership(tenantId: string, channelId: string, actorId: string, gameId: string, joined: boolean, now: number) { this.db.prepare("INSERT INTO nebula_arcade_members VALUES(?,?,?,?,?,?) ON CONFLICT(tenant_id,channel_id,actor_id,game_id) DO UPDATE SET joined=excluded.joined,last_seen_at=MAX(last_seen_at,excluded.last_seen_at)").run(tenantId,channelId,actorId,gameId,joined?1:0,now); }
  joinedGames(tenantId: string, channelId: string, actorId: string): string[] { return (this.db.prepare("SELECT game_id FROM nebula_arcade_members WHERE tenant_id=? AND channel_id=? AND actor_id=? AND joined=1").all(tenantId,channelId,actorId) as {game_id:string}[]).map(row=>row.game_id); }
  choice(tenantId: string, channelId: string, actorId: string, now: number): NebulaCommandTargetV1[] | undefined {
    this.db.prepare("DELETE FROM nebula_arcade_choices WHERE expires_at<=?").run(now);
    const row=this.db.prepare("SELECT targets FROM nebula_arcade_choices WHERE tenant_id=? AND channel_id=? AND actor_id=?").get(tenantId,channelId,actorId) as {targets:string}|undefined;return row?JSON.parse(row.targets):undefined;
  }
  saveChoice(tenantId:string,channelId:string,actorId:string,targets:NebulaCommandTargetV1[],now:number){this.db.prepare("INSERT INTO nebula_arcade_choices VALUES(?,?,?,?,?) ON CONFLICT(tenant_id,channel_id,actor_id) DO UPDATE SET targets=excluded.targets,expires_at=excluded.expires_at").run(tenantId,channelId,actorId,JSON.stringify(targets),now+30_000);}
  clearChoice(tenantId:string,channelId:string,actorId:string){this.db.prepare("DELETE FROM nebula_arcade_choices WHERE tenant_id=? AND channel_id=? AND actor_id=?").run(tenantId,channelId,actorId);}
  snapshot(tenantId:string,channelId:string,overlayGameIds:string[],runningGameIds:string[],now=Date.now()) {
    const channel=this.db.prepare("SELECT last_spmt_at FROM nebula_arcade_channels WHERE tenant_id=? AND channel_id=?").get(tenantId,channelId) as {last_spmt_at:number|null}|undefined;
    const lastSpmtAt=channel?.last_spmt_at??null,visibleUntil=lastSpmtAt===null?0:lastSpmtAt+NEBULA_ACTIVITY_VISIBLE_MS;
    const counts=new Map((this.db.prepare("SELECT game_id,COUNT(*) AS players FROM nebula_arcade_members WHERE tenant_id=? AND channel_id=? AND joined=1 AND last_seen_at>=? AND last_seen_at<=? GROUP BY game_id").all(tenantId,channelId,now-NEBULA_CHAT_ACTIVE_MS,now) as {game_id:string;players:number}[]).map(row=>[row.game_id,row.players]));
    const games=[...new Set([...overlayGameIds,...runningGameIds])].flatMap(id=>{const game=NEBULA_ARCADE_GAMES.find(item=>item.id===id);if(!game)return[];const running=runningGameIds.includes(id),players=running?counts.get(id)??0:0;return[{id,name:game.name,onOverlay:overlayGameIds.includes(id),running,players,status:players>0?"active":"inactive"}];});
    return {channelId,lastSpmtAt,visibleUntil,visible:now<visibleUntil,remainingMs:Math.max(0,Math.min(NEBULA_ACTIVITY_VISIBLE_MS,visibleUntil-now)),activeWindowSeconds:NEBULA_CHAT_ACTIVE_MS/1000,games};
  }
}
export const NEBULA_ACTIVITY_CSS = `#nebula-activity{position:fixed;right:16px;top:16px;z-index:1000;min-width:240px;max-width:min(380px,90vw);max-height:85vh;overflow:auto;padding:16px;border:1px solid #a78bfa77;border-radius:16px;background:#10132bea;color:#f5f3ff;font:14px system-ui;box-shadow:0 12px 36px #0005}#nebula-activity[hidden]{display:none}#nebula-activity header{display:grid;gap:4px;margin-bottom:12px}#nebula-activity small{font-size:11px;color:#c4b5fd}#nebula-activity ul{list-style:none;margin:0;padding:0;display:grid;gap:10px}#nebula-activity li{display:flex;justify-content:space-between;gap:16px}#nebula-activity li[data-active=true] span{color:#6ee7b7}`;
export const NEBULA_ACTIVITY_HTML = `<aside id="nebula-activity" hidden aria-label="Nebula Arcade activity"><header><strong>Nebula Arcade</strong><small>Joined players chatting in the last 5 minutes</small></header><ul></ul></aside>`;
export const NEBULA_ACTIVITY_JS = `(()=>{const box=document.getElementById('nebula-activity');if(!box)return;let expires=0,timer;window.renderNebulaActivity=state=>{clearTimeout(timer);if(!state){box.hidden=true;return;}expires=Date.now()+Math.max(0,Math.min(30000,state.remainingMs||0));box.querySelector('ul').replaceChildren(...(state.games||[]).map(game=>{const row=document.createElement('li'),name=document.createElement('b'),status=document.createElement('span');name.textContent=game.name+(game.onOverlay?'':' · not on overlay');status.textContent=game.running?(game.players>0?'Active · '+game.players+' playing':'Inactive · 0 playing'):'Stopped · 0 playing';row.dataset.active=String(game.players>0);row.append(name,status);return row;}));box.hidden=Date.now()>=expires;timer=setTimeout(()=>{box.hidden=true;},Math.max(0,expires-Date.now()));};})();`;
