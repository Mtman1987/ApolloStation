import type { DshPartnerSchedules } from "./partner-schedules.js";
import type { DshLiveRuntimeConfigV1 } from "./live-worker.js";
export async function respondDshPartnerSchedule(options:{schedules:DshPartnerSchedules;config:DshLiveRuntimeConfigV1;resolve:(tenant:string,discord:string)=>Promise<{userId:string;role:string|null}>;now:()=>string},interaction:Record<string,any>){
  const id=String(interaction.data?.custom_id??""),guild=String(interaction.guild_id??"");
  if(!/^(partner:|show_schedule_|partner_schedule_(refresh|add)_)/.test(id))return undefined;
  const reply=(content:string)=>({type:4,data:{flags:64,content,allowed_mentions:{parse:[]}}});
  try{
    const tenant=options.config.tenants.find(t=>t.discordGuildIds?.includes(guild));if(!tenant)throw Error("This server is not connected to DSH");
    let action:string,discordId:string,month:string;
    if(id.startsWith("partner:")){const [,a,g,d,m]=id.split(":");if(g!==guild)throw Error("This calendar belongs to another server");action=a!;discordId=d!;month=m!;}
    else if(id.startsWith("show_schedule_")){const match=/^show_schedule_(\d+)_([A-Za-z0-9_]+)$/.exec(id);if(!match||match[1]!==guild)throw Error("This calendar belongs to another server");const partner=options.schedules.partners(tenant.tenantId,guild).find(p=>p.twitchLogin.toLowerCase()===match[2]!.toLowerCase());if(!partner)throw Error("This creator is no longer a linked partner");action="refresh";discordId=partner.discordUserId;month=options.now().slice(0,7);}
    else {const match=/^partner_schedule_(refresh|add)_(\d+)_(\d+)$/.exec(id);if(!match||match[3]!==guild)throw Error("This calendar belongs to another server");action=match[1]!;discordId=match[2]!;month=options.now().slice(0,7);}
    const partner=options.schedules.partners(tenant.tenantId,guild).find(p=>p.discordUserId===discordId);if(!partner)throw Error("This creator is no longer a linked partner");
    if(action==="refresh"){await options.schedules.sync(tenant.tenantId,guild,partner.userId,month);return {type:4,data:{flags:64,...options.schedules.message(tenant.tenantId,guild,partner.userId,month)}};}
    if(action!=="add"&&action!=="submit")throw Error("This schedule action is unavailable");
    const actor=await options.resolve(tenant.tenantId,String(interaction.member?.user?.id??interaction.user?.id??""));if(actor.userId!==partner.userId&&actor.role!=="owner")throw Error("Only the partner or workspace owner can add events");
    if(action==="add"&&interaction.type===3)return {type:9,data:{title:"Add personal event",custom_id:`partner:submit:${guild}:${discordId}:${month}`,components:[['name','Event name',80],['date','Date (YYYY-MM-DD)',10],['time','Time (HH:MM UTC)',5]].map(([custom_id,label,max_length])=>({type:1,components:[{type:4,style:1,custom_id,label,max_length,required:true}]}))}};
    if(action==="submit"&&interaction.type===5){const fields:Record<string,string>={};for(const row of interaction.data?.components??[])for(const c of row.components??[])fields[c.custom_id]=String(c.value??"");options.schedules.add(tenant.tenantId,guild,partner.userId,actor.userId,actor.role==="owner",{name:fields.name??"",date:fields.date??"",time:fields.time??"",description:"Personal event",requestId:String(interaction.id)});await options.schedules.flush(tenant.tenantId);return reply("Personal event added to your calendar.");}
    throw Error("This schedule action is unavailable");
  }catch(error){return reply(error instanceof Error?error.message:"Schedule unavailable");}
}
