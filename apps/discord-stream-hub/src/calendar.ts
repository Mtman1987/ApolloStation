import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

export type DshCalendarEventTypeV1 = "captains-log" | "event";
export interface DshCalendarMemberV1 { userId:string; username:string; avatarUrl?:string|null }
export interface DshCalendarEventV1 {
  schemaVersion:1; id:string; tenantId:string; serverId:string; eventName:string; eventDateTime:string; description:string;
  type:DshCalendarEventTypeV1; userId:string; username:string; userAvatar:string|null; dayKey:string; createdAt:string; updatedAt:string;
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
      CREATE UNIQUE INDEX IF NOT EXISTS dsh_calendar_captain_day ON dsh_calendar_events(tenant_id,server_id,day_key) WHERE type='captains-log';`);
  }
  close(){this.db.close();}
  scheduleCaptainsLog(input:{tenantId:string;serverId:string;member:DshCalendarMemberV1;selectedDate:string;now?:string}):DshCalendarMutationV1{
    const tenantId=cleanId(input.tenantId,"tenantId"),serverId=cleanId(input.serverId,"serverId"),member=cleanMember(input.member),dayKey=cleanDay(input.selectedDate),now=timestamp(input.now??new Date().toISOString(),"now");
    const at=`${dayKey}T12:00:00.000Z`,event:DshCalendarEventV1={schemaVersion:1,id:randomUUID(),tenantId,serverId,eventName:`Captain's Log - ${formatMonthDay(dayKey)}`,eventDateTime:at,description:`${member.username} signed up for captain's log duty`,type:"captains-log",userId:member.userId,username:member.username,userAvatar:member.avatarUrl??null,dayKey,createdAt:now,updatedAt:now};
    try{this.insert(event);}catch(error){if(/UNIQUE constraint failed/i.test(String(error)))throw new Error("That day is already claimed.");throw error;}
    return{event,points:{eventType:"admin_captains_log",quantity:1,metadata:{username:member.username,date:dayKey}},refreshDiscordCalendar:true};
  }
  scheduleMission(input:{tenantId:string;serverId:string;member:DshCalendarMemberV1;missionName:string;missionDescription:string;missionDate:string;missionTime?:string;now?:string}):DshCalendarMutationV1{
    const tenantId=cleanId(input.tenantId,"tenantId"),serverId=cleanId(input.serverId,"serverId"),member=cleanMember(input.member),dayKey=cleanDay(input.missionDate),clock=cleanClock(input.missionTime),now=timestamp(input.now??new Date().toISOString(),"now"),eventAt=`${dayKey}T${clock}:00.000Z`,name=cleanText(input.missionName,"missionName",120),description=cleanText(input.missionDescription,"missionDescription",2000);
    const event:DshCalendarEventV1={schemaVersion:1,id:randomUUID(),tenantId,serverId,eventName:name,eventDateTime:eventAt,description,type:"event",userId:member.userId,username:member.username,userAvatar:member.avatarUrl??null,dayKey,createdAt:now,updatedAt:now};this.insert(event);
    return{event,points:{eventType:"admin_calendar_event",quantity:1,metadata:{username:member.username,missionName:name}},refreshDiscordCalendar:true};
  }
  updateEvent(tenantIdValue:string,serverIdValue:string,eventIdValue:string,patch:{eventName?:string;description?:string;eventDate?:string;eventTime?:string},now=new Date().toISOString()):DshCalendarEventV1{
    const tenantId=cleanId(tenantIdValue,"tenantId"),serverId=cleanId(serverIdValue,"serverId"),eventId=cleanId(eventIdValue,"eventId"),current=this.get(tenantId,serverId,eventId);if(!current)throw new Error("Calendar event not found");
    const dayKey=patch.eventDate?cleanDay(patch.eventDate):current.dayKey,clock=patch.eventTime?cleanClock(patch.eventTime):current.eventDateTime.slice(11,16),next:DshCalendarEventV1={...current,eventName:patch.eventName===undefined?current.eventName:cleanText(patch.eventName,"eventName",120),description:patch.description===undefined?current.description:cleanText(patch.description,"description",2000),dayKey,eventDateTime:`${dayKey}T${clock}:00.000Z`,updatedAt:timestamp(now,"now")};
    try{this.db.prepare("UPDATE dsh_calendar_events SET type=?,day_key=?,event_at=?,user_id=?,body=? WHERE tenant_id=? AND server_id=? AND event_id=?").run(next.type,next.dayKey,next.eventDateTime,next.userId,JSON.stringify(next),tenantId,serverId,eventId);}catch(error){if(/UNIQUE constraint failed/i.test(String(error)))throw new Error("That day is already claimed.");throw error;}return structuredClone(next);
  }
  deleteEvent(tenantIdValue:string,serverIdValue:string,eventIdValue:string){const tenantId=cleanId(tenantIdValue,"tenantId"),serverId=cleanId(serverIdValue,"serverId"),eventId=cleanId(eventIdValue,"eventId");return Number(this.db.prepare("DELETE FROM dsh_calendar_events WHERE tenant_id=? AND server_id=? AND event_id=?").run(tenantId,serverId,eventId).changes)>0;}
  get(tenantIdValue:string,serverIdValue:string,eventIdValue:string){const row=this.db.prepare("SELECT body FROM dsh_calendar_events WHERE tenant_id=? AND server_id=? AND event_id=?").get(cleanId(tenantIdValue,"tenantId"),cleanId(serverIdValue,"serverId"),cleanId(eventIdValue,"eventId")) as {body:string}|undefined;return row?parse(row.body):undefined;}
  list(tenantIdValue:string,serverIdValue:string,input:{from?:string;to?:string;limit?:number}={}){
    const tenantId=cleanId(tenantIdValue,"tenantId"),serverId=cleanId(serverIdValue,"serverId"),from=input.from?cleanDay(input.from):"0000-01-01",to=input.to?cleanDay(input.to):"9999-12-31",limit=Math.max(1,Math.min(500,Math.trunc(input.limit??100)));const rows=this.db.prepare("SELECT body FROM dsh_calendar_events WHERE tenant_id=? AND server_id=? AND day_key>=? AND day_key<=? ORDER BY event_at,event_id LIMIT ?").all(tenantId,serverId,from,to,limit) as {body:string}[];return rows.map((row)=>parse(row.body));
  }
  private insert(event:DshCalendarEventV1){this.db.prepare("INSERT INTO dsh_calendar_events(tenant_id,server_id,event_id,type,day_key,event_at,user_id,body) VALUES(?,?,?,?,?,?,?,?)").run(event.tenantId,event.serverId,event.id,event.type,event.dayKey,event.eventDateTime,event.userId,JSON.stringify(event));}
}

export function renderDshCalendarDiscordSummary(events:readonly DshCalendarEventV1[],input:{from:string;to:string}){
  const title=`Community Calendar · ${cleanDay(input.from)} → ${cleanDay(input.to)}`;const lines=events.slice(0,40).map((event)=>`${event.dayKey} ${event.eventDateTime.slice(11,16)} · ${event.eventName} — ${event.username}`);return{title,description:lines.length?lines.join("\n"):"No scheduled community events.",eventCount:events.length};
}
function parse(body:string){const value=JSON.parse(body) as DshCalendarEventV1;return structuredClone(value);}
function cleanMember(value:DshCalendarMemberV1){if(!value)throw new Error("Calendar member is required");return{userId:cleanId(value.userId,"userId"),username:cleanText(value.username,"username",80),avatarUrl:value.avatarUrl?String(value.avatarUrl).slice(0,500):null};}
function cleanId(value:string,name:string){const clean=String(value??"").trim();if(!clean||clean.length>180||/[\r\n\0]/.test(clean))throw new Error(`${name} is invalid`);return clean;}
function cleanText(value:unknown,name:string,max:number){const clean=String(value??"").trim().replace(/[\r\0]/g,"");if(!clean||clean.length>max)throw new Error(`${name} is invalid`);return clean;}
function cleanDay(value:string){const clean=String(value??"").trim();if(!/^\d{4}-\d{2}-\d{2}$/.test(clean))throw new Error("Invalid date format");const date=new Date(`${clean}T12:00:00.000Z`);if(!Number.isFinite(date.getTime())||date.toISOString().slice(0,10)!==clean)throw new Error("Invalid date format");return clean;}
function cleanClock(value?:string){const clean=String(value??"12:00").trim();if(!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(clean))throw new Error("Invalid time format");return clean;}
function timestamp(value:string,name:string){const time=Date.parse(value);if(!Number.isFinite(time))throw new Error(`${name} must be an ISO timestamp`);return new Date(time).toISOString();}
function formatMonthDay(day:string){return new Date(`${day}T12:00:00.000Z`).toLocaleDateString("en-US",{month:"short",day:"numeric",timeZone:"UTC"});}
