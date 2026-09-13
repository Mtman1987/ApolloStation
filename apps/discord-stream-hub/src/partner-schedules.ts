import { createHash, randomUUID } from "node:crypto";
import { resolveProviderIdentity } from "@spmt/sdk/provider-identity";
import type { SpmtClient } from "@spmt/sdk";
import type { DshLiveRuntimeConfigV1 } from "./live-worker.js";
import { SqliteDshCalendarStore, type DshCalendarEventV1 } from "./calendar.js";
import { buildDshCalendarMessage } from "./calendar-presentation.js";
import { DshDiscordError, SqliteDshDiscordMessageStore, type DshDiscordTransportV1 } from "./discord-live-publisher.js";

type Segment={id:string;start_time:string;end_time:string;title:string;canceled_until?:string|null;category?:{name:string}|null;is_recurring?:boolean};
type State={checkedAt?:string;error?:string;status?:"ready"|"empty"|"reauthorization-required"|"unavailable";broadcasterId?:string;vacation?:{start_time:string;end_time:string}|null;truncated?:boolean};
const digest=(text:string)=>createHash("sha256").update(text).digest("hex").slice(0,32);
export const dshPartnerCalendarScope=(guild:string,user:string)=>`partner-${digest(JSON.stringify([guild,user]))}`;

/** Public Twitch schedules consume the existing SPMT provider grant and identity owners. */
export class DshPartnerSchedules {
  constructor(private readonly calendar:SqliteDshCalendarStore,private readonly messages:SqliteDshDiscordMessageStore,private readonly client:SpmtClient,private readonly config:DshLiveRuntimeConfigV1,private readonly discord:DshDiscordTransportV1,private readonly fetchImpl:typeof fetch=fetch,private readonly now=()=>new Date().toISOString()) {}
  partners(tenant:string){return this.config.tenants.find(t=>t.tenantId===tenant)?.members.filter(m=>m.group==="Partners").map(m=>({userId:m.canonicalUserId,discordUserId:m.discordUserId,twitchLogin:m.twitchLogin}))??[];}
  private member(tenant:string,guild:string,user:string){const config=this.config.tenants.find(t=>t.tenantId===tenant);if(!config?.discordGuildIds?.includes(guild))throw Error("Choose a Discord server configured for this tenant");const member=config.members.find(m=>m.canonicalUserId===user&&m.group==="Partners");if(!member)throw Error("Choose a linked partner");return {config,member,scope:dshPartnerCalendarScope(guild,user)};}
  view(tenant:string,guild:string,user:string,month:string){const {member,scope}=this.member(tenant,guild,user);validMonth(month);return {userId:user,twitchLogin:member.twitchLogin,guildId:guild,month,...this.calendar.state<State>(tenant,`${scope}:${month}`),events:this.calendar.all(tenant,scope).filter(e=>e.dayKey.startsWith(month)),tracked:this.messages.get(tenant,"partner-calendar",scope)??null};}
  async sync(tenant:string,guild:string,user:string,month:string){
    const {config,member,scope}=this.member(tenant,guild,user);validMonth(month);const key=`${scope}:${month}`,owner=randomUUID();
    if(!this.calendar.acquire(tenant,key,owner))return this.view(tenant,guild,user,month);
    const previous=this.calendar.state<State>(tenant,key)??{};
    try {
      // Schedule reads require an app or user token, without a new OAuth scope.
      const grant=await this.client.issueProviderGrant(tenant,"twitch",config.twitchProviderUserId,"dsh-live-monitor",["streams:read"],300),clientId=grant.credential.metadata.clientId;
      if(!clientId)throw Object.assign(Error("Reconnect Twitch in SPMT Account"),{status:401});
      const headers={"client-id":clientId,authorization:`Bearer ${grant.credential.accessToken}`};
      const get=async(path:string,empty404=false)=>{this.calendar.renew(tenant,key,owner);const res=await this.fetchImpl(`https://api.twitch.tv/helix/${path}`,{headers,redirect:"error",signal:AbortSignal.timeout(15000)});if(empty404&&res.status===404)return null;if(!res.ok)throw Object.assign(Error(`Twitch schedule lookup failed (${res.status})`),{status:res.status});return res.json();};
      const profiles=await get(`users?login=${encodeURIComponent(member.twitchLogin)}`) as {data?:{id:string;login:string}[]},profile=profiles.data?.find(p=>p.login.toLowerCase()===member.twitchLogin.toLowerCase());
      if(!profile?.id)throw Error("The partner's Twitch account was not found. Check the existing SPMT link.");
      const identity=await resolveProviderIdentity(this.client,tenant,"twitch",profile.id);
      if(identity.userId!==user)throw Error("The Twitch account no longer matches this partner's SPMT identity");
      const body=await get(`schedule?broadcaster_id=${encodeURIComponent(profile.id)}&first=25&start_time=${month}-01T00:00:00Z`,true) as {data?:{broadcaster_id:string;segments:Segment[];vacation?:State["vacation"]};pagination?:{cursor?:string}}|null;
      if(body&&(!Array.isArray(body.data?.segments)||body.data?.broadcaster_id!==profile.id))throw Error("Twitch returned an invalid schedule");
      const at=this.now(),events:DshCalendarEventV1[]=[];
      for(const segment of body?.data?.segments??[]){
        if(!segment.id||!Number.isFinite(Date.parse(segment.start_time))||!Number.isFinite(Date.parse(segment.end_time))||Date.parse(segment.end_time)<=Date.parse(segment.start_time)||typeof segment.title!=="string")throw Error("Twitch returned an invalid schedule segment");
        const start=new Date(segment.start_time).toISOString(),end=new Date(segment.end_time).toISOString();if(!start.startsWith(month))continue;
        const vacation=body?.data?.vacation,canceled=Boolean(segment.canceled_until&&Date.parse(segment.canceled_until)>Date.parse(start)||vacation&&Date.parse(start)>=Date.parse(vacation.start_time)&&Date.parse(start)<Date.parse(vacation.end_time));
        events.push({schemaVersion:1,id:`twitch-${digest(segment.id)}`,tenantId:tenant,serverId:scope,type:"event",source:"twitch",color:"#9146ff",eventName:segment.title||"Twitch stream",eventDateTime:start,endDateTime:end,description:["Twitch stream",segment.category?.name,segment.is_recurring?"Recurring schedule":undefined,canceled?"Canceled / vacation":undefined].filter(Boolean).join(" · "),userId:user,username:member.twitchLogin,userAvatar:null,dayKey:start.slice(0,10),createdAt:at,updatedAt:at,location:`https://twitch.tv/${member.twitchLogin}`,status:canceled?4:1});
      }
      this.calendar.renew(tenant,key,owner);
      this.calendar.replaceTwitchMonth(tenant,scope,month,events);
      this.calendar.setState(tenant,key,{checkedAt:at,status:events.length?"ready":"empty",broadcasterId:profile.id,vacation:body?.data?.vacation??null,truncated:Boolean(body?.pagination?.cursor)} satisfies State);
    }catch(error){const status=Number((error as {status?:number})?.status),reauthorize=status===401||status===403;this.calendar.renew(tenant,key,owner);this.calendar.setState(tenant,key,{...previous,checkedAt:this.now(),status:reauthorize?"reauthorization-required":"unavailable",error:reauthorize?"Reconnect Twitch in SPMT Account; the last successful schedule is retained.":"Schedule refresh failed; the last successful schedule is retained. Check the linked partner account and try again."} satisfies State);}
    finally{this.calendar.release(tenant,key,owner);}
    return this.view(tenant,guild,user,month);
  }
  message(tenant:string,guild:string,user:string,month:string){const view=this.view(tenant,guild,user,month),base=buildDshCalendarMessage(view.events,{month,guildId:guild,today:this.now().slice(0,10)});return {...base,embeds:[{...base.embeds[0],title:`${view.twitchLogin} · ${month}`,description:view.error??(view.status==="empty"?"No Twitch streams scheduled.":view.truncated?"Showing the next 25 Twitch schedule entries.":"Twitch streams and personal events"),footer:{text:"All times UTC · Manage accounts in SPMT"}}],components:[{type:1,components:[{type:2,style:5,label:"Twitch schedule",url:`https://twitch.tv/${view.twitchLogin}/schedule`},{type:2,style:1,label:"Refresh",custom_id:`partner:refresh:${guild}:${this.partners(tenant).find(p=>p.userId===user)!.discordUserId}:${month}`},{type:2,style:1,label:"Add event",custom_id:`partner:add:${guild}:${this.partners(tenant).find(p=>p.userId===user)!.discordUserId}:${month}`}]}]};}
  async publish(tenant:string,guild:string,user:string,channel:string,month:string){
    const {scope}=this.member(tenant,guild,user),key=`partner-image:${scope}`,owner=randomUUID();
    if(!this.calendar.acquire(tenant,key,owner))throw Error("Partner calendar publication is in progress");
    try{
      const destination=await this.discord.listGuildChannels(tenant,guild);if(!destination.some(c=>c.id===channel))throw Error("Choose a channel belonging to this server");
      const previous=this.messages.get(tenant,"partner-calendar",scope),payload=this.message(tenant,guild,user,month);let id:string|undefined;
      if(previous&&previous.channelId===channel)try{await this.discord.editMessage(tenant,channel,previous.messageId,payload);id=previous.messageId;}catch(error){if(!(error instanceof DshDiscordError)||error.status!==404)throw error;}
      else if(previous)try{await this.discord.deleteMessage(tenant,previous.channelId,previous.messageId);}catch(error){if(!(error instanceof DshDiscordError)||error.status!==404)throw error;}
      this.calendar.renew(tenant,key,owner);id??=await this.discord.createMessage(tenant,channel,{...payload,nonce:digest(`${tenant}:${scope}:${month}:${previous?.messageId??"first"}`).slice(0,24),enforce_nonce:true});
      this.messages.put({tenantId:tenant,kind:"partner-calendar",key:scope,channelId:channel,messageId:id,updatedAt:this.now()});
      this.calendar.setState(tenant,`partner-target:${scope}`,{guild,user,month,revision:this.calendar.revision(tenant)});return {messageId:id,channelId:channel};
    }finally{this.calendar.release(tenant,key,owner);}
  }
  async flush(tenant:string){for(const tracked of this.messages.list(tenant,"partner-calendar")){const target=this.calendar.state<{guild:string;user:string;month:string;revision:number}>(tenant,`partner-target:${tracked.key}`);if(!target)continue;try{const state=this.view(tenant,target.guild,target.user,target.month);if(!state.checkedAt||Date.parse(this.now())-Date.parse(state.checkedAt)>=300000)await this.sync(tenant,target.guild,target.user,target.month);if(target.revision!==this.calendar.revision(tenant)||state.error||Date.parse(this.now())-Date.parse(tracked.updatedAt)>=300000)await this.publish(tenant,target.guild,target.user,tracked.channelId,target.month);}catch{/* Retain the destination for restart-safe retries; view exposes provider errors. */}}}
  add(tenant:string,guild:string,user:string,actor:string,owner:boolean,input:{name:string;date:string;time:string;description:string;requestId:string}){const {member,scope}=this.member(tenant,guild,user);if(actor!==user&&!owner)throw Error("Only the partner or workspace owner can change personal events");return this.calendar.once(tenant,`partner-add:${actor}:${input.requestId}`,()=>this.calendar.scheduleMission({tenantId:tenant,serverId:scope,member:{userId:user,username:member.twitchLogin},missionName:input.name,missionDescription:input.description||"Personal event",missionDate:input.date,missionTime:input.time,source:"partner",now:this.now()}));}
  remove(tenant:string,guild:string,user:string,actor:string,owner:boolean,id:string){const {scope}=this.member(tenant,guild,user);if(actor!==user&&!owner)throw Error("Only the partner or workspace owner can change personal events");const event=this.calendar.get(tenant,scope,id);if(event&&event.source!=="partner")throw Error("Edit Twitch streams on Twitch, then refresh");return {deleted:this.calendar.deleteEvent(tenant,scope,id)};}
}
function validMonth(month:string){if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))throw Error("Choose a valid calendar month");}
