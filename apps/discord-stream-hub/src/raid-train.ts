import { DatabaseSync } from "node:sqlite";

/** Durable hourly Raid Train reservations, isolated by tenant and Discord guild. */
export interface DshRaidTrainSignupV1 { userId:string; username:string; displayName:string; avatarUrl?:string; twitchLogin?:string }
export class DshRaidTrainStore {
 private readonly db:DatabaseSync;
 constructor(path:string,private readonly now=()=>new Date().toISOString()){
  this.db=new DatabaseSync(path,{timeout:5000});
  this.db.exec(`PRAGMA journal_mode=WAL;
   CREATE TABLE IF NOT EXISTS dsh_raid_train_slots(tenant TEXT NOT NULL,guild TEXT NOT NULL,date TEXT NOT NULL,hour INTEGER NOT NULL,user TEXT NOT NULL,username TEXT NOT NULL,display_name TEXT NOT NULL,avatar TEXT,twitch TEXT,signup_at TEXT NOT NULL,points INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(tenant,guild,date,hour));
   CREATE INDEX IF NOT EXISTS dsh_raid_train_user ON dsh_raid_train_slots(tenant,guild,user,date);`);
 }
 close(){this.db.close();}
 schedule(tenant:string,guild:string,date:string){
  validDate(date);const rows=this.db.prepare("SELECT * FROM dsh_raid_train_slots WHERE tenant=? AND guild=? AND date=? ORDER BY hour").all(tenant,guild,date) as any[],byHour=new Map(rows.map(r=>[r.hour,r]));
  return Array.from({length:24},(_,hour)=>{const r=byHour.get(hour);return{id:`${date}-${String(hour).padStart(2,"0")}`,date,hour,claimed:Boolean(r),...(r?{userId:r.user,username:r.username,displayName:r.display_name,avatarUrl:r.avatar??undefined,twitchLogin:r.twitch??undefined,signupAt:r.signup_at,points:r.points}:{})};});
 }
 signup(tenant:string,guild:string,date:string,hour:number,input:DshRaidTrainSignupV1){
  validDate(date);validHour(hour);if(date<=this.now().slice(0,10))throw Error("Raid Train signups must be for a future day");
  if(!input.userId||!input.username||!input.displayName)throw Error("A linked member profile is required");
  try{this.db.prepare("INSERT INTO dsh_raid_train_slots(tenant,guild,date,hour,user,username,display_name,avatar,twitch,signup_at,points) VALUES(?,?,?,?,?,?,?,?,?,?,0)").run(tenant,guild,date,hour,input.userId,input.username,input.displayName,input.avatarUrl??null,input.twitchLogin??null,this.now());}
  catch(error){if(String(error).includes("UNIQUE")||String(error).includes("constraint"))return{claimed:false,slot:this.schedule(tenant,guild,date)[hour]};throw error;}
  return{claimed:true,slot:this.schedule(tenant,guild,date)[hour]};
 }
 cancel(tenant:string,guild:string,date:string,hour:number,actor:string,owner=false){
  validDate(date);validHour(hour);const result=this.db.prepare("DELETE FROM dsh_raid_train_slots WHERE tenant=? AND guild=? AND date=? AND hour=? AND (?=1 OR user=?)").run(tenant,guild,date,hour,owner?1:0,actor);
  return{cancelled:Number(result.changes)>0};
 }
 publishPayload(tenant:string,guild:string,date:string){
  const slots=this.schedule(tenant,guild,date),claimed=slots.filter(s=>s.claimed),available=slots.filter(s=>!s.claimed),fields:any[]=[];
  if(claimed.length)fields.push({name:"🚂 Claimed slots",value:claimed.map(s=>`${String(s.hour).padStart(2,"0")}:00 — ${s.displayName}`).join("\\n").slice(0,1024),inline:true});
  if(available.length)fields.push({name:"⏰ Available slots",value:available.slice(0,10).map(s=>`${String(s.hour).padStart(2,"0")}:00`).join(", ")+(available.length>10?` +${available.length-10} more`:""),inline:true});
  return{embeds:[{title:`🚂 Raid Train · ${date}`,description:"Reserve an hourly slot to lead the community raid train.",color:0xff4500,fields,footer:{text:`${claimed.length}/24 slots claimed · UTC · future dates only`},timestamp:this.now()}],components:[{type:1,components:[{type:2,style:1,label:"Sign up",custom_id:`raidtrain:signup:${guild}:${date}`},{type:2,style:2,label:"Refresh schedule",custom_id:`raidtrain:view:${guild}:${date}`},{type:2,style:4,label:"Cancel my slot",custom_id:`raidtrain:cancel:${guild}:${date}`}]}],allowed_mentions:{parse:[]}};
 }
}
function validDate(value:string){if(!/^\\d{4}-\\d{2}-\\d{2}$/.test(value)||new Date(value+"T00:00:00Z").toISOString().slice(0,10)!==value)throw Error("Choose a valid UTC date");}
function validHour(value:number){if(!Number.isInteger(value)||value<0||value>23)throw Error("Choose an hour from 00 through 23");}
