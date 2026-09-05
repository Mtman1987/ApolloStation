import { communityCalendarColor } from "@spmt/ui";
import { randomUUID } from "node:crypto";
import rrule from "rrule";
import { DatabaseSync } from "node:sqlite";

export type DshCalendarEventTypeV1 = "captains-log" | "event";
export interface DshCalendarMemberV1 { userId:string; username:string; avatarUrl?:string|null }
export interface DshCalendarEventV1 {
  schemaVersion:1; id:string; tenantId:string; serverId:string; eventName:string; eventDateTime:string; description:string;
  type:DshCalendarEventTypeV1; userId:string; username:string; userAvatar:string|null; dayKey:string; createdAt:string; updatedAt:string; source?:"discord";color?:string; endDateTime?:string|null; location?:string; status?:number; discordEventId?:string; discordGuildId?:string;discordEntityType?:number; recurrence?:Record<string,any>|null;
}
export interface DshCalendarMutationV1 { event:DshCalendarEventV1; points:{ eventType:"admin_captains_log"|"admin_calendar_event"; quantity:1; metadata:Record<string,string> }; refreshDiscordCalendar:true }

export class SqliteDshCalendarStore {
  private readonly db: DatabaseSync;
  constructor(path:string){
    if(!path)throw new Error("DSH calendar database path is required");
    this.db=new DatabaseSync(path,{timeout:5_000});
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
      CREATE TABLE IF NOT EXISTS dsh_calendar_events(
        tenant_id TEXT NOT NULL, server_id TEXT NOT NULL, event_id TEXT NOT NULL, type TEXT NOT NULL, day_key TEXT NOT NULL,
        event_at TEXT NOT NULL, user_id TEXT NOT NULL, body TEXT NOT NULL,
        PRIMARY KEY(tenant_id,server_id,event_id)
      ) STRICT;
      CREATE INDEX IF NOT EXISTS dsh_calendar_by_day ON dsh_calendar_events(tenant_id,server_id,day_key,event_at);
      CREATE UNIQUE INDEX IF NOT EXISTS dsh_calendar_captain_day ON dsh_calendar_events(tenant_id,server_id,day_key) WHERE type='captains-log';
      CREATE TABLE IF NOT EXISTS dsh_calendar_state(tenant TEXT NOT NULL,key TEXT NOT NULL,body TEXT NOT NULL,PRIMARY KEY(tenant,key)) STRICT;
      CREATE TABLE IF NOT EXISTS dsh_calendar_awards(tenant TEXT NOT NULL,id TEXT NOT NULL,body TEXT NOT NULL,PRIMARY KEY(tenant,id)) STRICT;
      CREATE TRIGGER IF NOT EXISTS dsh_calendar_award AFTER INSERT ON dsh_calendar_events WHEN NEW.user_id!='' AND coalesce(json_extract(NEW.body,'$.source'),'')!='discord' BEGIN INSERT OR IGNORE INTO dsh_calendar_awards VALUES(NEW.tenant_id,NEW.event_id,NEW.body); END;
      CREATE TABLE IF NOT EXISTS dsh_calendar_revision(tenant TEXT PRIMARY KEY,revision INTEGER NOT NULL) STRICT;
      CREATE TABLE IF NOT EXISTS dsh_calendar_leases(tenant TEXT NOT NULL,key TEXT NOT NULL,owner TEXT NOT NULL,expires INTEGER NOT NULL,PRIMARY KEY(tenant,key)) STRICT;
      CREATE TRIGGER IF NOT EXISTS dsh_calendar_insert AFTER INSERT ON dsh_calendar_events BEGIN INSERT INTO dsh_calendar_revision VALUES(NEW.tenant_id,1) ON CONFLICT(tenant) DO UPDATE SET revision=revision+1; END;
      CREATE TRIGGER IF NOT EXISTS dsh_calendar_update AFTER UPDATE ON dsh_calendar_events BEGIN INSERT INTO dsh_calendar_revision VALUES(NEW.tenant_id,1) ON CONFLICT(tenant) DO UPDATE SET revision=revision+1; END;
      CREATE TRIGGER IF NOT EXISTS dsh_calendar_delete AFTER DELETE ON dsh_calendar_events BEGIN INSERT INTO dsh_calendar_revision VALUES(OLD.tenant_id,1) ON CONFLICT(tenant) DO UPDATE SET revision=revision+1; END;`);
    for(const row of this.db.prepare("SELECT tenant_id,server_id,event_id,body FROM dsh_calendar_events WHERE type='event' AND json_extract(body,'$.color') IS NULL ORDER BY event_at,event_id").all() as {tenant_id:string;server_id:string;event_id:string;body:string}[]){const event=parse(row.body);event.color=this.nextColor(row.tenant_id);this.db.prepare("UPDATE dsh_calendar_events SET body=? WHERE tenant_id=? AND server_id=? AND event_id=?").run(JSON.stringify(event),row.tenant_id,row.server_id,row.event_id);}
  }
  close(){this.db.close();}
  pendingAwards(tenant:string){return (this.db.prepare("SELECT body FROM dsh_calendar_awards WHERE tenant=?").all(tenant) as {body:string}[]).map(row=>parse(row.body));}
  settleAward(tenant:string,id:string){this.db.prepare("DELETE FROM dsh_calendar_awards WHERE tenant=? AND id=?").run(tenant,id);}
  revision(tenant:string) { return Number((this.db.prepare("SELECT revision FROM dsh_calendar_revision WHERE tenant=?").get(tenant) as {revision:number}|undefined)?.revision ?? 0); }
  state<T>(tenant:string,key:string):T|undefined { const row=this.db.prepare("SELECT body FROM dsh_calendar_state WHERE tenant=? AND key=?").get(tenant,key) as {body:string}|undefined; return row?JSON.parse(row.body) as T:undefined; }
  setState(tenant:string,key:string,value:unknown) { this.db.prepare("INSERT INTO dsh_calendar_state VALUES(?,?,?) ON CONFLICT(tenant,key) DO UPDATE SET body=excluded.body").run(tenant,key,JSON.stringify(value)); }
  once<T>(tenant:string,key:string|undefined,action:()=>T):T { if(!key)return action();this.db.exec("BEGIN IMMEDIATE");try{const previous=this.state<T>(tenant,"request:"+key);if(previous!==undefined){this.db.exec("COMMIT");return previous;}const value=action();this.setState(tenant,"request:"+key,value);this.db.exec("COMMIT");return value;}catch(error){this.db.exec("ROLLBACK");throw error;} }
  acquire(tenant:string,key:string,owner:string,ms=120_000) { return Number(this.db.prepare("INSERT INTO dsh_calendar_leases VALUES(?,?,?,?) ON CONFLICT(tenant,key) DO UPDATE SET owner=excluded.owner,expires=excluded.expires WHERE expires<?").run(tenant,key,owner,Date.now()+ms,Date.now()).changes)>0; }
  renew(tenant:string,key:string,owner:string,ms=120000){if(!Number(this.db.prepare("UPDATE dsh_calendar_leases SET expires=? WHERE tenant=? AND key=? AND owner=? AND expires>?").run(Date.now()+ms,tenant,key,owner,Date.now()).changes))throw new Error("Calendar synchronization lease expired; retrying is safe");}
  release(tenant:string,key:string,owner:string) { this.db.prepare("DELETE FROM dsh_calendar_leases WHERE tenant=? AND key=? AND owner=?").run(tenant,key,owner); }
  importDiscordMission(tenantId:string,serverId:string,id:string,input:{name:string;description:string;start:string;end?:string|null;location?:string;status?:number;discordEventId:string;discordGuildId:string;entityType?:number;recurrence?:Record<string,any>|null},now=new Date().toISOString()) {
    const start=timestamp(input.start,"start"),existing=this.get(tenantId,serverId,id);
    const event:DshCalendarEventV1={schemaVersion:1,id:cleanId(id,"eventId"),tenantId:cleanId(tenantId,"tenantId"),serverId:cleanId(serverId,"serverId"),type:"event",color:existing?.color??this.nextColor(tenantId),source:existing?.source??"discord",eventName:cleanText(input.name,"name",100),description:input.description,eventDateTime:start,dayKey:start.slice(0,10),userId:existing?.userId??"",username:existing?.username??"Discord community",userAvatar:existing?.userAvatar??null,createdAt:existing?.createdAt??now,updatedAt:now,endDateTime:input.end??null,location:input.location??"",status:input.status??1,discordEventId:input.discordEventId,discordGuildId:input.discordGuildId,discordEntityType:input.entityType??3,recurrence:input.recurrence??null};
    this.db.prepare("INSERT INTO dsh_calendar_events(tenant_id,server_id,event_id,type,day_key,event_at,user_id,body) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(tenant_id,server_id,event_id) DO UPDATE SET day_key=excluded.day_key,event_at=excluded.event_at,body=excluded.body").run(tenantId,serverId,id,"event",event.dayKey,start,event.userId,JSON.stringify(event));return event;
  }
  all(tenant:string,scope:string){return (this.db.prepare("SELECT body FROM dsh_calendar_events WHERE tenant_id=? AND server_id=? ORDER BY event_at,event_id").all(tenant,scope) as {body:string}[]).map(row=>parse(row.body));}
  setAvatar(tenant:string,userId:string,url:string){for(const row of this.db.prepare("SELECT server_id,body FROM dsh_calendar_events WHERE tenant_id=? AND user_id=? AND type='captains-log'").all(tenant,userId) as {server_id:string;body:string}[]){const event=parse(row.body);if(event.userAvatar===url)continue;event.userAvatar=url;this.db.prepare("UPDATE dsh_calendar_events SET body=? WHERE tenant_id=? AND server_id=? AND event_id=?").run(JSON.stringify(event),tenant,row.server_id,event.id);}}
  month(tenant:string,guild:string,month:string) {
    if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))throw new Error("Choose a valid month");
    const events=["workspace",...(guild!=="workspace"?[guild]:[])].flatMap(scope=>this.all(tenant,scope));
    const from=new Date(month+"-01T00:00:00Z"),to=new Date(Date.UTC(from.getUTCFullYear(),from.getUTCMonth()+1,1));
    return events.flatMap(event=>{
      if(!event.recurrence||event.status===4)return event.dayKey.startsWith(month)?[event]:[];
      const r=event.recurrence,rule=new rrule.RRule({freq:Number(r.frequency),interval:Number(r.interval??1),dtstart:new Date(r.start??event.eventDateTime),...(r.end?{until:new Date(r.end)}:{}),...(r.by_weekday?{byweekday:r.by_weekday}:{}),...(r.by_n_weekday?{byweekday:r.by_n_weekday.map((x:{day:number;n:number})=>new rrule.Weekday(x.day,x.n))}:{}),...(r.by_month?{bymonth:r.by_month}:{}),...(r.by_month_day?{bymonthday:r.by_month_day}:{})});
      return rule.between(from,new Date(to.getTime()-1),true).map(at=>({...event,dayKey:at.toISOString().slice(0,10),eventDateTime:at.toISOString(),endDateTime:event.endDateTime?new Date(at.getTime()+Date.parse(event.endDateTime)-Date.parse(event.eventDateTime)).toISOString():null}));
    }).sort((a,b)=>a.eventDateTime.localeCompare(b.eventDateTime));
  }
  scheduleCaptainsLog(input:{tenantId:string;serverId:string;member:DshCalendarMemberV1;selectedDate:string;now?:string}):DshCalendarMutationV1{
    const tenantId=cleanId(input.tenantId,"tenantId"),serverId=cleanId(input.serverId,"serverId"),member=cleanMember(input.member),dayKey=cleanDay(input.selectedDate),now=timestamp(input.now??new Date().toISOString(),"now");
    const at=`${dayKey}T12:00:00.000Z`,event:DshCalendarEventV1={schemaVersion:1,id:randomUUID(),tenantId,serverId,eventName:`Captain's Log - ${formatMonthDay(dayKey)}`,eventDateTime:at,description:`${member.username} signed up for captain's log duty`,type:"captains-log",userId:member.userId,username:member.username,userAvatar:member.avatarUrl??null,dayKey,createdAt:now,updatedAt:now};
    try{this.insert(event);}catch(error){if(/UNIQUE constraint failed/i.test(String(error)))throw new Error("That day is already claimed.");throw error;}
    return{event,points:{eventType:"admin_captains_log",quantity:1,metadata:{username:member.username,date:dayKey}},refreshDiscordCalendar:true};
  }
  scheduleMission(input:{tenantId:string;serverId:string;member:DshCalendarMemberV1;missionName:string;missionDescription:string;missionDate:string;missionTime?:string;endDateTime?:string;location?:string;now?:string}):DshCalendarMutationV1{
    const tenantId=cleanId(input.tenantId,"tenantId"),serverId=cleanId(input.serverId,"serverId"),member=cleanMember(input.member),dayKey=cleanDay(input.missionDate),clock=cleanClock(input.missionTime),now=timestamp(input.now??new Date().toISOString(),"now"),eventAt=`${dayKey}T${clock}:00.000Z`,name=cleanText(input.missionName,"missionName",120),description=cleanText(input.missionDescription,"missionDescription",2000);
    const event:DshCalendarEventV1={endDateTime:missionEnd(input.endDateTime,eventAt),location:cleanText(input.location??"SPMT Community","location",100),status:1,schemaVersion:1,id:randomUUID(),tenantId,serverId,eventName:name,eventDateTime:eventAt,description,type:"event",userId:member.userId,username:member.username,userAvatar:member.avatarUrl??null,dayKey,createdAt:now,updatedAt:now};this.insert(event);
    return{event,points:{eventType:"admin_calendar_event",quantity:1,metadata:{username:member.username,missionName:name}},refreshDiscordCalendar:true};
  }
  updateEvent(tenantIdValue:string,serverIdValue:string,eventIdValue:string,patch:{eventName?:string;description?:string;eventDate?:string;eventTime?:string;endDateTime?:string;location?:string},now=new Date().toISOString()):DshCalendarEventV1{
    const tenantId=cleanId(tenantIdValue,"tenantId"),serverId=cleanId(serverIdValue,"serverId"),eventId=cleanId(eventIdValue,"eventId"),current=this.get(tenantId,serverId,eventId);if(!current)throw new Error("Calendar event not found");
    const dayKey=patch.eventDate?cleanDay(patch.eventDate):current.dayKey,clock=patch.eventTime?cleanClock(patch.eventTime):current.eventDateTime.slice(11,16),next:DshCalendarEventV1={...current,eventName:patch.eventName===undefined?(current.type==="captains-log"&&patch.eventDate?`Captain's Log - ${formatMonthDay(dayKey)}`:current.eventName):cleanText(patch.eventName,"eventName",120),description:patch.description===undefined?current.description:cleanText(patch.description,"description",2000),dayKey,eventDateTime:`${dayKey}T${clock}:00.000Z`,updatedAt:timestamp(now,"now")};
    if(current.type==="event"){const delta=Date.parse(next.eventDateTime)-Date.parse(current.eventDateTime);if((current.discordEntityType===1||current.discordEntityType===2)&&patch.location!==undefined&&patch.location!==current.location)throw new Error("Change the voice or stage channel in Discord; the linked calendar will follow.");next.endDateTime=current.endDateTime===null&&!patch.endDateTime?null:missionEnd(patch.endDateTime??(current.endDateTime?new Date(Date.parse(current.endDateTime)+delta).toISOString():undefined),next.eventDateTime);next.location=patch.location===undefined?(current.location??""):cleanText(patch.location,"location",100);if(next.recurrence&&delta)next.recurrence={...next.recurrence,start:next.eventDateTime};}
    try{this.db.prepare("UPDATE dsh_calendar_events SET type=?,day_key=?,event_at=?,user_id=?,body=? WHERE tenant_id=? AND server_id=? AND event_id=?").run(next.type,next.dayKey,next.eventDateTime,next.userId,JSON.stringify(next),tenantId,serverId,eventId);}catch(error){if(/UNIQUE constraint failed/i.test(String(error)))throw new Error("That day is already claimed.");throw error;}return structuredClone(next);
  }
  deleteEvent(tenantIdValue:string,serverIdValue:string,eventIdValue:string){const tenantId=cleanId(tenantIdValue,"tenantId"),serverId=cleanId(serverIdValue,"serverId"),eventId=cleanId(eventIdValue,"eventId");return Number(this.db.prepare("DELETE FROM dsh_calendar_events WHERE tenant_id=? AND server_id=? AND event_id=?").run(tenantId,serverId,eventId).changes)>0;}
  get(tenantIdValue:string,serverIdValue:string,eventIdValue:string){const row=this.db.prepare("SELECT body FROM dsh_calendar_events WHERE tenant_id=? AND server_id=? AND event_id=?").get(cleanId(tenantIdValue,"tenantId"),cleanId(serverIdValue,"serverId"),cleanId(eventIdValue,"eventId")) as {body:string}|undefined;return row?parse(row.body):undefined;}
  list(tenantIdValue:string,serverIdValue:string,input:{from?:string;to?:string;limit?:number}={}){
    const tenantId=cleanId(tenantIdValue,"tenantId"),serverId=cleanId(serverIdValue,"serverId"),from=input.from?cleanDay(input.from):"0000-01-01",to=input.to?cleanDay(input.to):"9999-12-31",limit=Math.max(1,Math.min(500,Math.trunc(input.limit??100)));const rows=this.db.prepare("SELECT body FROM dsh_calendar_events WHERE tenant_id=? AND server_id=? AND day_key>=? AND day_key<=? ORDER BY event_at,event_id LIMIT ?").all(tenantId,serverId,from,to,limit) as {body:string}[];return rows.map((row)=>parse(row.body));
  }
  private nextColor(tenant:string){const row=this.db.prepare("INSERT INTO dsh_calendar_state VALUES(?,'mission-color-count','1') ON CONFLICT(tenant,key) DO UPDATE SET body=CAST(CAST(body AS INTEGER)+1 AS TEXT) RETURNING body").get(tenant) as {body:string};return communityCalendarColor(Number(row.body)-1);}
  private insert(event:DshCalendarEventV1){if(event.type==="event"&&!event.color)event.color=this.nextColor(event.tenantId);this.db.prepare("INSERT INTO dsh_calendar_events(tenant_id,server_id,event_id,type,day_key,event_at,user_id,body) VALUES(?,?,?,?,?,?,?,?)").run(event.tenantId,event.serverId,event.id,event.type,event.dayKey,event.eventDateTime,event.userId,JSON.stringify(event));}
}

export function renderDshCalendarDiscordSummary(events:readonly DshCalendarEventV1[],input:{from:string;to:string}){
  const from=cleanDay(input.from),to=cleanDay(input.to),title=`Community Calendar · ${from} → ${to}`;
  const ordered=events.filter(event=>event.dayKey>=from&&event.dayKey<=to).sort((a,b)=>a.eventDateTime.localeCompare(b.eventDateTime));
  const lines:string[]=[];let length=0;
  for(const event of ordered){const line=`${event.dayKey} ${event.eventDateTime.slice(11,16)} · ${event.eventName.replace(/\n/g," ")} — ${event.username.replace(/\n/g," ")}`;if(lines.length>=40||length+line.length+1>3900)break;lines.push(line);length+=line.length+1;}
  const remaining=ordered.length-lines.length;if(remaining)lines.push(`… ${remaining} more scheduled items. Open the community calendar for the full list.`);
  return{title,description:lines.length?lines.join("\n"):"No scheduled community events.",eventCount:ordered.length};
}
function parse(body:string){const value=JSON.parse(body) as DshCalendarEventV1;return structuredClone(value);}
function cleanMember(value:DshCalendarMemberV1){if(!value)throw new Error("Calendar member is required");return{userId:cleanId(value.userId,"userId"),username:cleanText(value.username,"username",80),avatarUrl:value.avatarUrl?String(value.avatarUrl).slice(0,500):null};}
function cleanId(value:string,name:string){const clean=String(value??"").trim();if(!clean||clean.length>180||/[\r\n\0]/.test(clean))throw new Error(`${name} is invalid`);return clean;}
function cleanText(value:unknown,name:string,max:number){const clean=String(value??"").trim().replace(/[\r\0]/g,"");if(!clean||clean.length>max)throw new Error(`${name} is invalid`);return clean;}
function cleanDay(value:string){const clean=String(value??"").trim();if(!/^\d{4}-\d{2}-\d{2}$/.test(clean))throw new Error("Invalid date format");const date=new Date(`${clean}T12:00:00.000Z`);if(!Number.isFinite(date.getTime())||date.toISOString().slice(0,10)!==clean)throw new Error("Invalid date format");return clean;}
function cleanClock(value?:string){const clean=String(value??"12:00").trim();if(!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(clean))throw new Error("Invalid time format");return clean;}
function timestamp(value:string,name:string){const time=Date.parse(value);if(!Number.isFinite(time))throw new Error(`${name} must be an ISO timestamp`);return new Date(time).toISOString();}
function formatMonthDay(day:string){return new Date(`${day}T12:00:00.000Z`).toLocaleDateString("en-US",{month:"short",day:"numeric",timeZone:"UTC"});}

function missionEnd(value:string|undefined,start:string){const end=value?timestamp(value,"End time"):new Date(Date.parse(start)+3600000).toISOString();if(end<=start)throw new Error("End time must be after the start time");return end;}
