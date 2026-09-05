import type { DshLiveRuntimeConfigV1 } from "./live-worker.js";
import type { DshCalendarMemberV1, SqliteDshCalendarStore } from "./calendar.js";
import { buildDshCalendarMessage } from "./calendar-presentation.js";
export interface DshCalendarInteractionOptions {
  config:DshLiveRuntimeConfigV1; calendar:SqliteDshCalendarStore;
  resolve:(tenant:string,discordUserId:string)=>Promise<DshCalendarMemberV1&{role:"owner"|"member"|null}>;
  changed?:(tenant:string)=>Promise<unknown>; now?:()=>string;
}
export async function respondDshCalendarInteraction(options:DshCalendarInteractionOptions,interaction:Record<string,any>):Promise<{type:number;data?:Record<string,any>}|undefined> {
  const id=String(interaction.data?.custom_id??"");if(!id.startsWith("calendar:"))return undefined;
  const match=/^calendar:(captain|mission|previous|next|captain-submit|mission-submit):(\d{5,30}):(\d{4}-(?:0[1-9]|1[0-2]))$/.exec(id);
  if(!match||match[2]!==String(interaction.guild_id??""))return ephemeral("This calendar action belongs to a different server.");
  const [,action,guild,month]=match,tenant=options.config.tenants.find(t=>t.discordGuildIds?.includes(guild!));
  if(!tenant)return ephemeral("This Discord server is not connected to this workspace.");
  const now=(options.now??(()=>new Date().toISOString()))();
  if(interaction.type===3&&(action==="captain"||action==="mission")){
    const fields=action==="captain"?[field("date","Date (YYYY-MM-DD)",10)]:[field("name","Mission name",100),field("start","Start UTC (YYYY-MM-DD HH:MM)",16),field("end","End UTC (YYYY-MM-DD HH:MM)",16),field("location","Location or meeting link",100),field("description","Description",750,2)];
    return {type:9,data:{custom_id:`calendar:${action}-submit:${guild}:${month}`,title:action==="captain"?"Claim Captain’s Log":"Add community mission",components:fields}};
  }
  if(interaction.type===3&&(action==="previous"||action==="next")){
    const date=new Date(month+"-01T12:00:00Z");date.setUTCMonth(date.getUTCMonth()+(action==="next"?1:-1));const selected=date.toISOString().slice(0,7);
    options.calendar.setState(tenant.tenantId,`month:${guild}`,selected);
    return {type:7,data:buildDshCalendarMessage(options.calendar.month(tenant.tenantId,guild!,selected),{month:selected,guildId:guild!,today:now.slice(0,10)})};
  }
  if(interaction.type!==5||!action?.endsWith("-submit"))return ephemeral("This calendar action is unavailable.");
  try {
    const user=interaction.member?.user??interaction.user??{},member=await options.resolve(tenant.tenantId,String(user.id??""));
    if(!member.role)return ephemeral("Link your Discord account to this SPMT workspace before choosing a date.");
    if(action==="mission-submit"&&member.role!=="owner")return ephemeral("The workspace owner can add missions. Members can claim Captain’s Log dates.");
    if(/^[a-f0-9_]+$/i.test(String(user.avatar??""))&&/^\d{5,30}$/.test(String(user.id??"")))member.avatarUrl=`https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=128`;
    const fields:Record<string,string>={};for(const row of interaction.data?.components??[])for(const field of row.components??[])fields[String(field.custom_id)]=String(field.value??"");
    const receipt=String(interaction.id??"");if(!receipt)throw new Error("Discord did not provide an interaction receipt");
    options.calendar.once(tenant.tenantId,`discord:${receipt}`,()=>{
      if(action==="captain-submit")return options.calendar.scheduleCaptainsLog({tenantId:tenant.tenantId,serverId:"workspace",member,selectedDate:fields.date??"",now});
      const start=parseTime(fields.start),end=parseTime(fields.end);
      return options.calendar.scheduleMission({tenantId:tenant.tenantId,serverId:"workspace",member,missionName:fields.name??"",missionDescription:fields.description??"",missionDate:start.slice(0,10),missionTime:start.slice(11,16),endDateTime:end,location:fields.location??"",now});
    });
    await options.changed?.(tenant.tenantId);
    return ephemeral(action==="captain-submit"?"Your captain date is saved. The app and calendar image are updating.":"Mission saved. The app, calendar image and Discord event are updating.");
  }catch(error){return ephemeral(error instanceof Error?error.message:"The calendar could not save this change.");}
}
function field(id:string,label:string,max:number,style=1){return {type:1,components:[{type:4,custom_id:id,label,style,max_length:max,required:true}]};}
function parseTime(value?:string){if(!/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}$/.test(value??""))throw new Error("Use YYYY-MM-DD HH:MM for the start and end times, in UTC.");const date=new Date(value!.replace(" ","T")+":00Z");if(!Number.isFinite(date.getTime())||date.toISOString().slice(0,16)!==value!.replace(" ","T"))throw new Error("Enter a valid date and time");return date.toISOString();}
function ephemeral(content:string){return {type:4,data:{flags:64,content,allowed_mentions:{parse:[]}}};}
