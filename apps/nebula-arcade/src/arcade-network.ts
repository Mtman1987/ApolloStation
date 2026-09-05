import { DatabaseSync } from 'node:sqlite';
import { NEBULA_ARCADE_GAMES } from './game-hub.js';

/** Consent is identity-wide; gameplay data and moderation stay within their owning network. */
export class SqliteNebulaNetwork {
  private readonly db: DatabaseSync;
  constructor(path:string) {
    this.db=new DatabaseSync(path,{timeout:5000});
    this.db.exec(`CREATE TABLE IF NOT EXISTS nebula_arcade_enrollment(actor_id TEXT PRIMARY KEY,enrolled INTEGER NOT NULL,excluded_games TEXT NOT NULL,updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS nebula_arcade_blacklist(tenant_id TEXT NOT NULL,kind TEXT NOT NULL,subject TEXT NOT NULL,reason TEXT NOT NULL,updated_at TEXT NOT NULL,PRIMARY KEY(tenant_id,kind,subject));
      CREATE TABLE IF NOT EXISTS nebula_arcade_settings(tenant_id TEXT NOT NULL,channel_id TEXT NOT NULL,game_id TEXT NOT NULL,body TEXT NOT NULL,PRIMARY KEY(tenant_id,channel_id,game_id));
      CREATE TABLE IF NOT EXISTS nebula_arcade_presence(tenant_id TEXT PRIMARY KEY,body TEXT NOT NULL,observed_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS nebula_media_outbox(tenant_id TEXT NOT NULL,id TEXT NOT NULL,kind TEXT NOT NULL,body TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'pending',updated_at TEXT NOT NULL,PRIMARY KEY(tenant_id,id));`);
  }
  close(){this.db.close();}
  enrollment(actor:string){const row=this.db.prepare('SELECT enrolled,excluded_games FROM nebula_arcade_enrollment WHERE actor_id=?').get(actor) as {enrolled:number;excluded_games:string}|undefined;return{enrolled:Boolean(row?.enrolled),excludedGames:row?JSON.parse(row.excluded_games) as string[]:[]};}
  enroll(actor:string,enrolled:boolean,now=new Date().toISOString()){
    this.db.prepare("INSERT INTO nebula_arcade_enrollment VALUES(?,?,'[]',?) ON CONFLICT(actor_id) DO UPDATE SET enrolled=excluded.enrolled,excluded_games='[]',updated_at=excluded.updated_at").run(actor,Number(enrolled),now);
    if(!enrolled && this.table('nebula_arcade_members'))this.db.prepare('UPDATE nebula_arcade_members SET joined=0 WHERE actor_id=?').run(actor);
    if(this.table('nebula_tag_state')){const user=actor.replace(/^spmt:/,'');for(const row of this.db.prepare('SELECT tenant_id,body FROM nebula_tag_state').all() as {tenant_id:string;body:string}[]){const state=JSON.parse(row.body),player=state.players?.[user];if(!player)continue;player.eligible=enrolled&&!this.blocked(row.tenant_id,user,player.username);if(!player.eligible&&state.currentItUserId===user)state.currentItUserId=null;this.db.prepare('UPDATE nebula_tag_state SET body=?,revision=revision+1,updated_at=? WHERE tenant_id=?').run(JSON.stringify(state),now,row.tenant_id);}}
    return this.enrollment(actor);
  }
  excludeGame(actor:string,game:string,exclude:boolean,now=new Date().toISOString()){const enrollment=this.enrollment(actor),games=new Set(enrollment.excludedGames);exclude?games.add(game):games.delete(game);this.db.prepare('INSERT INTO nebula_arcade_enrollment VALUES(?,?,?,?) ON CONFLICT(actor_id) DO UPDATE SET excluded_games=excluded.excluded_games,updated_at=excluded.updated_at').run(actor,Number(enrollment.enrolled),JSON.stringify([...games]),now);}
  listBlacklist(tenant:string){return this.db.prepare('SELECT kind,subject,reason,updated_at AS updatedAt FROM nebula_arcade_blacklist WHERE tenant_id=? ORDER BY kind,subject').all(tenant);}
  blocked(tenant:string,userId:string,username:string,channel?:string){const keys=[userId,username.replace(/^[@#]/,'').toLowerCase(),channel?.replace(/^#/,'').toLowerCase()].filter(Boolean);return keys.some(key=>Boolean(this.db.prepare('SELECT 1 FROM nebula_arcade_blacklist WHERE tenant_id=? AND subject=?').get(tenant,key!)));}
  blacklist(tenant:string,kind:'channel'|'player',subjectValue:string,blocked:boolean,reason='',now=new Date().toISOString()){
    const subject=subjectValue.trim().replace(/^[@#]/,'').toLowerCase();if(!subject||subject.length>200||/[\r\n\0]/.test(subject))throw new Error('A valid channel or player is required.');
    this.db.exec('BEGIN IMMEDIATE');
    try{
      if(blocked)this.db.prepare('INSERT INTO nebula_arcade_blacklist VALUES(?,?,?,?,?) ON CONFLICT(tenant_id,kind,subject) DO UPDATE SET reason=excluded.reason,updated_at=excluded.updated_at').run(tenant,kind,subject,reason.slice(0,300),now);
      else this.db.prepare('DELETE FROM nebula_arcade_blacklist WHERE tenant_id=? AND kind=? AND subject=?').run(tenant,kind,subject);
      if(kind==='channel'&&this.table('nebula_tag_channels'))this.db.prepare('INSERT INTO nebula_tag_channels VALUES(?,?,0,?,?) ON CONFLICT(tenant_id,channel_id) DO UPDATE SET opted_out=excluded.opted_out,updated_at=excluded.updated_at').run(tenant,subject,Number(blocked),now);
      if(this.table('nebula_tag_state')){
        const row=this.db.prepare('SELECT body FROM nebula_tag_state WHERE tenant_id=?').get(tenant) as {body:string}|undefined;
        if(row){const state=JSON.parse(row.body),ids:string[]=[];for(const player of Object.values(state.players) as any[]){if([player.userId?.toLowerCase(),player.username?.toLowerCase()].includes(subject)){player.eligible=!this.blocked(tenant,player.userId,player.username);ids.push(player.userId);if(blocked){player.offline=true;player.sleeping=false;if(state.currentItUserId===player.userId){state.currentItUserId=null;state.lastTagAt=now;}}}}this.db.prepare('UPDATE nebula_tag_state SET body=?,revision=revision+1,updated_at=? WHERE tenant_id=?').run(JSON.stringify(state),now,tenant);
        if(blocked&&this.table('nebula_arcade_members'))for(const id of ids)this.db.prepare('UPDATE nebula_arcade_members SET joined=0 WHERE tenant_id=? AND actor_id IN (?,?)').run(tenant,id,`spmt:${id}`);}
      }
      if(blocked&&this.table('nebula_game_runtime')){
        const rows=this.db.prepare('SELECT runtime_key,body FROM nebula_game_runtime WHERE tenant_id=?').all(tenant) as {runtime_key:string;body:string}[];
        for(const row of rows){const state=JSON.parse(row.body);for(const player of Object.values(state.players) as any[])if([player.id?.toLowerCase(),player.username?.toLowerCase(),player.id?.replace(/^spmt:/,'').toLowerCase()].includes(subject))for(const membership of Object.values(player.joinedGames) as any[])membership.active=false;this.db.prepare('UPDATE nebula_game_runtime SET body=?,updated_at=? WHERE tenant_id=? AND runtime_key=?').run(JSON.stringify(state),now,tenant,row.runtime_key);}
      }
      if(blocked&&this.table('nebula_tabletop')){
        const known=new Set([subject]);if(this.table('nebula_tag_state')){const row=this.db.prepare('SELECT body FROM nebula_tag_state WHERE tenant_id=?').get(tenant) as {body:string}|undefined;for(const player of Object.values(row?JSON.parse(row.body).players:{}) as any[])if(player.username?.toLowerCase()===subject)known.add(player.userId);}
        for(const row of this.db.prepare("SELECT channel_id,body FROM nebula_tabletop WHERE tenant_id=? AND game_id='quackverse'").all(tenant) as {channel_id:string;body:string}[]){const state=JSON.parse(row.body);let changed=false;for(const seat of ['playerOne','playerTwo'])if(known.has(state.claimedPlayers?.[seat])){state.claimedPlayers[seat]='';changed=true;}if(changed)this.db.prepare("UPDATE nebula_tabletop SET body=? WHERE tenant_id=? AND channel_id=? AND game_id='quackverse'").run(JSON.stringify(state),tenant,row.channel_id);}
      }
      this.db.exec('COMMIT');return this.listBlacklist(tenant);
    }catch(error){this.db.exec('ROLLBACK');throw error;}
  }
  settings(tenant:string,channel:string,game:string):Record<string,unknown>{const row=this.db.prepare('SELECT body FROM nebula_arcade_settings WHERE tenant_id=? AND channel_id=? AND game_id=?').get(tenant,channel,game) as {body:string}|undefined;return row?JSON.parse(row.body):{};}
  saveSettings(tenant:string,channel:string,game:string,settings:Record<string,unknown>){if(!NEBULA_ARCADE_GAMES.some(item=>item.id===game))throw new Error('Unknown game');const body=JSON.stringify(settings);if(body.length>32000)throw new Error('Game settings are too large');this.db.prepare('INSERT INTO nebula_arcade_settings VALUES(?,?,?,?) ON CONFLICT(tenant_id,channel_id,game_id) DO UPDATE SET body=excluded.body').run(tenant,channel,game,body);return settings;}
  presence(tenant:string,now=Date.now()):{liveUserIds:string[];channelByUserId:Record<string,string>;observedAt:string}|undefined {const row=this.db.prepare('SELECT body,observed_at FROM nebula_arcade_presence WHERE tenant_id=?').get(tenant) as {body:string;observed_at:string}|undefined;if(!row||now-Date.parse(row.observed_at)>120000||Date.parse(row.observed_at)>now+5000)return;return{...JSON.parse(row.body),observedAt:row.observed_at};}
  recordPresence(tenant:string,input:{liveUserIds:string[];channelByUserId:Record<string,string>;observedAt:string}){if(!Number.isFinite(Date.parse(input.observedAt)))throw new Error('Invalid presence time');this.db.prepare('INSERT INTO nebula_arcade_presence VALUES(?,?,?) ON CONFLICT(tenant_id) DO UPDATE SET body=excluded.body,observed_at=excluded.observed_at WHERE excluded.observed_at>=observed_at').run(tenant,JSON.stringify(input),input.observedAt);}
  enqueue(tenant:string,id:string,kind:string,body:unknown,now=new Date().toISOString()){this.db.prepare("INSERT OR IGNORE INTO nebula_media_outbox VALUES(?,?,?,?,'pending',?)").run(tenant,id,kind,JSON.stringify(body),now);}
  jobs(tenant:string){return(this.db.prepare("SELECT id,kind,body,status,updated_at FROM nebula_media_outbox WHERE tenant_id=? ORDER BY updated_at DESC LIMIT 100").all(tenant) as {id:string;kind:string;body:string;status:string;updated_at:string}[]).map(row=>({...row,body:JSON.parse(row.body)}));}
  pending(tenant:string,kind?:string){const rows=this.db.prepare("SELECT id,kind,body,status,updated_at FROM nebula_media_outbox WHERE tenant_id=? AND status NOT IN ('done','failed','cancelled')"+(kind?" AND kind=?":" AND kind!='announcement'")+" ORDER BY updated_at,id LIMIT 50").all(...(kind?[tenant,kind]:[tenant])) as {id:string;kind:string;body:string;status:string;updated_at:string}[];return rows.map(row=>({...row,body:JSON.parse(row.body)}));}
  updateJob(tenant:string,id:string,status:string,body:unknown,now=new Date().toISOString()){this.db.prepare('UPDATE nebula_media_outbox SET status=?,body=?,updated_at=? WHERE tenant_id=? AND id=?').run(status,JSON.stringify(body),now,tenant,id);}
  private table(name:string){return Boolean(this.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name));}
}
