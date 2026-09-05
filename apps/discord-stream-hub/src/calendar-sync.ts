import { randomUUID } from "node:crypto";
import { SqliteDshCalendarStore, type DshCalendarEventV1 } from "./calendar.js";
export interface DshScheduledEventV1 {
  id:string; guild_id?:string; name:string; description?:string|null; scheduled_start_time:string;
  scheduled_end_time?:string|null; status?:number; creator_id?:string; entity_type?:number;
  channel_id?:string|null; entity_metadata?:{location?:string}|null; recurrence_rule?:Record<string,any>|null;
}
export interface DshCalendarTransportV1 {
  readonly preview?:boolean;
  listScheduledEvents(tenantId:string,guildId:string):Promise<DshScheduledEventV1[]>;
  getScheduledEvent(tenantId:string,guildId:string,eventId:string):Promise<DshScheduledEventV1>;
  createScheduledEvent(tenantId:string,guildId:string,payload:Record<string,unknown>):Promise<DshScheduledEventV1>;
  editScheduledEvent(tenantId:string,guildId:string,eventId:string,payload:Record<string,unknown>):Promise<DshScheduledEventV1>;
  deleteScheduledEvent(tenantId:string,guildId:string,eventId:string):Promise<void>;
}
interface Link { scope:string; localId:string; remoteId?:string; local?:string; remote?:string; phase:"linked"|"creating"|"gone"|"invalid"; previewCreated?:boolean; previewBase?:string; previewSnapshot?:DshScheduledEventV1; problem?:string; incoming?:DshScheduledEventV1|null }
interface SyncState { links:Link[]; checkedAt?:string; error?:string }
/** Reconciliation is independent of stream presence and shares the tenant's calendar. */
export class DshCalendarSync {
  constructor(_path:string,private readonly calendar:SqliteDshCalendarStore,private readonly api:DshCalendarTransportV1,private readonly now=()=>new Date().toISOString(),private readonly publicOrigin="https://spmt.live") {}
  close() {}
  private key(guild:string){return `native:${this.api.preview?"preview:":""}${guild}`;}
  state(tenant:string,guild:string):SyncState { return this.calendar.state<SyncState>(tenant,this.key(guild))??{links:[]}; }
  status(tenant:string,guild:string) { const state=this.state(tenant,guild);return {mode:this.api.preview?"simulation":"live",checkedAt:state.checkedAt??null,error:state.error??null,issues:state.links.filter(l=>l.problem).map(l=>({eventId:l.localId,scope:l.scope,message:l.problem,conflict:l.incoming!==undefined,discord:l.incoming,calendar:this.calendar.get(tenant,l.scope,l.localId)??null}))}; }
  async sync(tenant:string,guild:string) {
    const owner=randomUUID(),key=this.key(guild);if(!this.calendar.acquire(tenant,key,owner))return;
    const state=this.state(tenant,guild),save=()=>{this.calendar.renew(tenant,key,owner);this.calendar.setState(tenant,key,state)};
    try {
      const remote=await this.api.listScheduledEvents(tenant,guild),byId=new Map(remote.map(e=>[e.id,e]));
      for(const link of [...state.links]){
        this.calendar.renew(tenant,key,owner);
        if(link.phase==="gone")continue;
        const local=this.calendar.get(tenant,link.scope,link.localId);
        if(link.phase==="invalid") { if(!local||localValue(local)!==link.local){state.links=state.links.filter(l=>l!==link);save();}continue; }
        let native=link.remoteId?byId.get(link.remoteId):remote.find(e=>marker(e.description??"")===link.localId);
        if(link.phase==="creating"){
          if(native){link.remoteId=native.id;link.remote=remoteValue(native);link.phase="linked";delete link.problem;save();}
          else {link.problem="Discord has not confirmed this event creation. Refresh to check again; retry only after confirming it is absent in Discord.";save();continue;}
        }
        if(link.previewCreated)native=link.previewSnapshot;
        else if(!native&&link.remoteId){try{native=await this.api.getScheduledEvent(tenant,guild,link.remoteId);}catch(error){if(status(error)!==404)throw error;}}
        const real=native;
        if(link.previewSnapshot&&native&&link.previewBase===remoteValue(native))native=link.previewSnapshot;
        const localChanged=(local?localValue(local):"")!==(link.local??""),remoteChanged=(native?remoteValue(native):"")!==(link.remote??"");
        if(localChanged&&remoteChanged){link.problem="This event changed in both the calendar and Discord. Choose the version to keep.";link.incoming=native??null;save();continue;}
        if(link.incoming!==undefined)continue;
        try {
          if(!local){if(native)await this.api.deleteScheduledEvent(tenant,guild,native.id);link.phase="gone";delete link.problem;save();continue;}
          if(!native){this.calendar.deleteEvent(tenant,link.scope,local.id);link.phase="gone";delete link.problem;save();continue;}
          if(localChanged){
            if((native.status??1)>=3){link.problem="Discord has ended or canceled this event. Keep the Discord version, or create a new mission for a new date.";link.incoming=native;save();continue;}
            const updated=await this.api.editScheduledEvent(tenant,guild,native.id,nativePayload(local,this.publicOrigin,native));
            this.link(link,local,updated);if(this.api.preview){link.previewBase=real?remoteValue(real):"";link.previewSnapshot=updated;}save();
          }else if(remoteChanged){const updated=this.import(tenant,guild,link.scope,local.id,native);this.link(link,updated,native);delete link.previewSnapshot;delete link.previewBase;save();}
          else if(link.problem){delete link.problem;save();}
        } catch(error){link.problem=explain(error);save();}
      }
      const known=new Set(state.links.map(l=>l.remoteId));
      for(const native of remote){
        this.calendar.renew(tenant,key,owner);
        if(known.has(native.id)||state.links.some(l=>marker(native.description??"")===l.localId))continue;
        const local=this.import(tenant,guild,"workspace",`discord-${guild}-${native.id}`,native),link:Link={scope:local.serverId,localId:local.id,phase:"linked"};
        this.link(link,local,native);state.links.push(link);save();
      }
      for(const scope of ["workspace",guild])for(const local of this.calendar.all(tenant,scope)){
        if(local.type!=="event"||local.eventDateTime<=this.now()||(local.discordGuildId&&local.discordGuildId!==guild)||state.links.some(l=>l.localId===local.id))continue;
        this.calendar.renew(tenant,key,owner);const link:Link={scope,localId:local.id,phase:"creating",local:localValue(local)};
        let payload:Record<string,unknown>;
        try{payload=nativePayload(local,this.publicOrigin);}catch(error){link.phase="invalid";link.problem=explain(error);state.links.push(link);save();continue;}
        state.links.push(link);save(); // Persist the attempt before crossing the network boundary.
        try{const native=await this.api.createScheduledEvent(tenant,guild,payload);this.link(link,local,native);if(this.api.preview){link.previewCreated=true;link.previewSnapshot=native;}save();}
        catch(error){link.problem=explain(error);if(status(error)>=400&&status(error)<500&&status(error)!==429)link.phase="invalid";save();}
      }
      state.checkedAt=this.now();delete state.error;save();
    }catch(error){state.checkedAt=this.now();state.error=explain(error);save();throw error;}
    finally{this.calendar.release(tenant,key,owner);}
  }
  async resolve(tenant:string,guild:string,id:string,choice:"calendar"|"discord"|"retry") {
    const owner=randomUUID(),key=this.key(guild);if(!this.calendar.acquire(tenant,key,owner))throw new Error("Calendar synchronization is in progress. Try again shortly.");
    try{
      const state=this.state(tenant,guild),link=state.links.find(l=>l.localId===id);if(!link)throw new Error("This synchronization issue no longer exists");
      if(choice==="retry"){
        const remote=await this.api.listScheduledEvents(tenant,guild),found=remote.find(e=>e.id===link.remoteId||marker(e.description??"")===id),local=this.calendar.get(tenant,link.scope,id);
        if(found&&local)this.link(link,local,found);else if(!link.remoteId)state.links=state.links.filter(l=>l!==link);else throw new Error("Choose the calendar or Discord version for a linked event");
      }else{
        if(link.incoming===undefined)throw new Error("This event has no conflicting version");
        const native=link.previewCreated?link.previewSnapshot:link.remoteId?await this.api.getScheduledEvent(tenant,guild,link.remoteId).catch(error=>{if(status(error)===404)return undefined;throw error;}):undefined;
        if((native?remoteValue(native):null)!==(link.incoming?remoteValue(link.incoming):null))throw new Error("Discord changed again. Refresh before choosing a version.");
        if(choice==="discord"){
          if(native){const local=this.import(tenant,guild,link.scope,id,native);this.link(link,local,native);}else{this.calendar.deleteEvent(tenant,link.scope,id);link.phase="gone";}
        }else{
          const local=this.calendar.get(tenant,link.scope,id);
          if(native&&local){if((native.status??1)>=3)throw new Error("An ended Discord event cannot be restarted; create a new mission.");const updated=await this.api.editScheduledEvent(tenant,guild,native.id,nativePayload(local,this.publicOrigin,native));this.link(link,local,updated);if(this.api.preview){link.previewBase=remoteValue(native);link.previewSnapshot=updated;}}
          else if(native){await this.api.deleteScheduledEvent(tenant,guild,native.id);link.phase="gone";}
          else state.links=state.links.filter(l=>l!==link);
        }
      }
      delete link.problem;delete link.incoming;this.calendar.setState(tenant,key,state);
    }finally{this.calendar.release(tenant,key,owner);}
    await this.sync(tenant,guild);
  }
  private link(link:Link,local:DshCalendarEventV1,native:DshScheduledEventV1){Object.assign(link,{remoteId:native.id,phase:"linked",local:localValue(local),remote:remoteValue(native)});delete link.problem;delete link.incoming;}
  private import(tenant:string,guild:string,scope:string,id:string,native:DshScheduledEventV1){return this.calendar.importDiscordMission(tenant,scope,id,{name:native.name,description:withoutMarker(native.description??""),start:native.scheduled_start_time,end:native.scheduled_end_time??null,location:native.entity_metadata?.location??(native.channel_id?`Discord channel ${native.channel_id}`:""),status:native.status??1,discordEventId:native.id,discordGuildId:guild,entityType:native.entity_type??3,recurrence:native.recurrence_rule??null},this.now());}
}
export function nativePayload(event:DshCalendarEventV1,origin:string,native?:DshScheduledEventV1) {
  const url=new URL("/apps/discord-stream-hub",origin);url.searchParams.set("calendarEvent",event.id);url.searchParams.set("month",event.dayKey.slice(0,7));url.hash="calendar";
  const suffix=`\n\n[Calendar](${url.href})`,description=event.description+suffix;
  if(event.eventName.length>100)throw new Error("Discord event names allow 100 characters. Shorten the mission name to synchronize it.");
  const outboundDescription=native&&!marker(native.description??"")?event.description:description;
  if(outboundDescription.length>1000)throw new Error(`Shorten this description to ${1000-suffix.length} characters so Discord can show the same text and calendar link.`);
  const external=!native||native.entity_type===3;
  return {name:event.eventName,description:outboundDescription,scheduled_start_time:event.eventDateTime,...(event.endDateTime?{scheduled_end_time:event.endDateTime}:external?{scheduled_end_time:new Date(Date.parse(event.eventDateTime)+3600000).toISOString()}:{}),...(native?{}:{privacy_level:2,entity_type:3,channel_id:null}),...(external?{entity_metadata:{location:event.location||"SPMT Community"}}:{}),...(event.recurrence&&JSON.stringify(event.recurrence)!==JSON.stringify(native?.recurrence_rule)?{recurrence_rule:Object.fromEntries(Object.entries(event.recurrence).filter(([key,value])=>["start","frequency","interval","by_weekday","by_n_weekday","by_month","by_month_day"].includes(key)&&value!==null))}:{})};
}
function marker(value:string){const match=/\n\n\[Calendar\]\((https:\/\/[^\s)]+)\)$/.exec(value);if(!match)return undefined;try{return new URL(match[1]!).searchParams.get("calendarEvent")??undefined;}catch{return undefined;}}
function withoutMarker(value:string){return marker(value)?value.replace(/\n\n\[Calendar\]\(https:\/\/[^\s)]+\)$/,""):value;}
function localValue(e:DshCalendarEventV1){return JSON.stringify([e.eventName,e.description,e.eventDateTime,e.endDateTime??null,e.location??"",e.recurrence??null]);}
function remoteValue(e:DshScheduledEventV1){return JSON.stringify([e.name,e.description??"",e.scheduled_start_time,e.scheduled_end_time??null,e.entity_type??3,e.channel_id??null,e.entity_metadata?.location??"",e.status??1,e.recurrence_rule??null]);}
function status(error:unknown){return Number((error as {status?:number})?.status??0);}
function explain(error:unknown){return status(error)===403?"The Discord bot needs Manage Events permission for this server.":error instanceof Error?error.message:"Calendar synchronization failed";}
