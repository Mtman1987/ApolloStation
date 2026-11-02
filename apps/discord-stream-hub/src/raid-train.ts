import { DatabaseSync } from "node:sqlite";

export interface DshRaidTrainSlotV1 {
  id: string;
  tenantId: string;
  guildId: string;
  date: string;
  hour: number;
  userId?: string;
  twitchUserId?: string;
  username?: string;
  displayName?: string;
  avatarUrl?: string;
  twitchUsername?: string;
  signupTime?: string;
}

export class DshRaidTrainStore {
  private readonly db: DatabaseSync;
  constructor(path: string, private readonly now: () => string = () => new Date().toISOString()) {
    this.db = new DatabaseSync(path, { timeout: 5_000 });
    this.db.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS dsh_raid_train_slots(tenant_id TEXT NOT NULL,guild_id TEXT NOT NULL,slot_date TEXT NOT NULL,hour INTEGER NOT NULL CHECK(hour BETWEEN 0 AND 23),user_id TEXT NOT NULL,twitch_user_id TEXT,username TEXT NOT NULL,display_name TEXT NOT NULL,avatar_url TEXT,twitch_username TEXT,signup_time TEXT NOT NULL,PRIMARY KEY(tenant_id,guild_id,slot_date,hour)) STRICT; CREATE INDEX IF NOT EXISTS dsh_raid_train_user ON dsh_raid_train_slots(tenant_id,guild_id,user_id,slot_date);");
  }
  close() { this.db.close(); }
  schedule(tenantId: string, guildId: string, date: string): DshRaidTrainSlotV1[] {
    validateDate(date);
    const rows = this.db.prepare("SELECT * FROM dsh_raid_train_slots WHERE tenant_id=? AND guild_id=? AND slot_date=? ORDER BY hour").all(tenantId,guildId,date) as Array<Record<string,unknown>>;
    const byHour = new Map(rows.map(row => [Number(row.hour),row]));
    return Array.from({length:24},(_,hour)=>slotFromRow(tenantId,guildId,date,hour,byHour.get(hour)));
  }
  signup(input:{tenantId:string;guildId:string;date:string;hour:number;userId:string;twitchUserId?:string;username:string;displayName:string;avatarUrl?:string;twitchUsername?:string}) {
    validateDate(input.date);
    if(!Number.isSafeInteger(input.hour)||input.hour<0||input.hour>23)throw new Error("Raid Train hour must be between 0 and 23");
    if(input.date<=this.now().slice(0,10))return {success:false,reason:"same-day"};
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const existing=this.db.prepare("SELECT user_id AS userId FROM dsh_raid_train_slots WHERE tenant_id=? AND guild_id=? AND slot_date=? AND hour=?").get(input.tenantId,input.guildId,input.date,input.hour) as {userId:string}|undefined;
      if(existing){this.db.exec("COMMIT");return {success:false,reason:"taken"};}
      this.db.prepare("INSERT INTO dsh_raid_train_slots(tenant_id,guild_id,slot_date,hour,user_id,twitch_user_id,username,display_name,avatar_url,twitch_username,signup_time) VALUES(?,?,?,?,?,?,?,?,?,?,?)")
        .run(input.tenantId,input.guildId,input.date,input.hour,input.userId,input.twitchUserId??null,input.username,input.displayName,input.avatarUrl??null,input.twitchUsername??null,this.now());
      this.db.exec("COMMIT");
      return {success:true,slot:this.schedule(input.tenantId,input.guildId,input.date)[input.hour]};
    } catch(error){this.db.exec("ROLLBACK");throw error;}
  }
  cancel(input:{tenantId:string;guildId:string;date:string;hour:number;userId:string}) {
    validateDate(input.date);
    if(!Number.isSafeInteger(input.hour)||input.hour<0||input.hour>23)throw new Error("Raid Train hour must be between 0 and 23");
    const changed=this.db.prepare("DELETE FROM dsh_raid_train_slots WHERE tenant_id=? AND guild_id=? AND slot_date=? AND hour=? AND user_id=?").run(input.tenantId,input.guildId,input.date,input.hour,input.userId).changes;
    return {success:Number(changed)===1,reason:Number(changed)===1?undefined:"not-owner-or-empty"};
  }
}

export function dshRaidTrainPayload(slots:DshRaidTrainSlotV1[],date:string,serverName="Space Mountain") {
  validateDate(date);
  const filled=slots.filter(slot=>slot.userId),available=slots.filter(slot=>!slot.userId);
  const claimed=filled.map(slot=>`${String(slot.hour).padStart(2,"0")}:00 — ${slot.displayName}`).join("\n").slice(0,1024)||"No slots claimed yet";
  const open=available.slice(0,10).map(slot=>`${String(slot.hour).padStart(2,"0")}:00`).join(", ")||"No open slots";
  const tomorrow=shiftDate(date,1),dayAfter=shiftDate(date,2);
  return {embeds:[{title:`🚂 ${serverName} Raid Train — ${date}`,description:"All aboard the cosmic express! Sign up for a time slot to lead the raid train through the galaxy.",color:0xff4500,fields:[{name:`🚂 Claimed Slots (${filled.length}/24)`,value:claimed,inline:true},{name:`⏰ Available Slots (${available.length})`,value:open+(available.length>10?` +${available.length-10} more`:""),inline:true}],footer:{text:"Cannot sign up for today • All times UTC"},timestamp:new Date().toISOString()}],components:[{type:1,components:[{type:2,style:1,label:"Sign Up",custom_id:`raid_signup_${date}`},{type:2,style:2,label:"View Schedule",custom_id:`raid_view_${date}`},{type:2,style:4,label:"Cancel Slot",custom_id:`raid_cancel_${date}`}]},{type:1,components:[{type:2,style:2,label:tomorrow,custom_id:`raid_day_${tomorrow}`},{type:2,style:2,label:dayAfter,custom_id:`raid_day_${dayAfter}`}]}],allowed_mentions:{parse:[]}};
}
function slotFromRow(tenantId:string,guildId:string,date:string,hour:number,row?:Record<string,unknown>):DshRaidTrainSlotV1 {
  return {id:`${date}-${String(hour).padStart(2,"0")}`,tenantId,guildId,date,hour,...(row?{userId:String(row.user_id),...(row.twitch_user_id?{twitchUserId:String(row.twitch_user_id)}:{}),username:String(row.username),displayName:String(row.display_name),...(row.avatar_url?{avatarUrl:String(row.avatar_url)}:{}),...(row.twitch_username?{twitchUsername:String(row.twitch_username)}:{}),signupTime:String(row.signup_time)}:{})};
}
function validateDate(value:string){if(!/^\d{4}-\d{2}-\d{2}$/.test(value)||new Date(`${value}T00:00:00.000Z`).toISOString().slice(0,10)!==value)throw new Error("Raid Train date must be YYYY-MM-DD");}
function shiftDate(value:string,days:number){const date=new Date(`${value}T00:00:00.000Z`);date.setUTCDate(date.getUTCDate()+days);return date.toISOString().slice(0,10);}
