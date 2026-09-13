import type { DshCalendarInteractionOptions } from "./calendar-interactions.js";
import { buildDshRaidTrainMessage } from "./calendar-presentation.js";

/** Existing Discord controls and donor button aliases use the calendar's canonical reservations. */
export async function respondDshRaidTrainInteraction(options:DshCalendarInteractionOptions,interaction:Record<string,any>) {
  const id=String(interaction.data?.custom_id??"");
  if(!/^(calendar:raid|raid_(signup|view|cancel|day)_)/.test(id))return undefined;
  try {
    const guild=String(interaction.guild_id??""),tenant=options.config.tenants.find(t=>t.discordGuildIds?.includes(guild));
    if(!tenant||!/^\d{5,30}$/.test(guild))throw new Error("This Discord server is not connected to this workspace");
    if(interaction.type!==3)throw new Error("This Raid Train control is unavailable");
    const now=(options.now??(()=>new Date().toISOString()))(),native=/^calendar:(raid|raid-claim|raid-cancel):(\d{5,30}):(\d{4}-\d{2}(?:-\d{2})?)$/.exec(id),legacy=/^raid_(signup|view|cancel|day)_(\d{4}-\d{2}-\d{2})$/.exec(id);
    if(!native&&!legacy||native&&native[2]!==guild)throw new Error("This Raid Train control belongs to another server");
    const action=native?.[1]??legacy![1]!;
    let date=native?.[3]??legacy![2]!;
    if(action==="raid") {const tomorrow=new Date(Date.parse(now)+86_400_000).toISOString().slice(0,10);date=tomorrow.startsWith(date)?tomorrow:date+"-01";}
    const slots=options.calendar.raidTrainSlots(tenant.tenantId,guild,date);
    if(action==="raid"||action==="view"||action==="day")return {type:4,data:{flags:64,...buildDshRaidTrainMessage(slots.flatMap(slot=>slot.event?[slot.event]:[]),{date,guildId:guild,today:now.slice(0,10)})}};
    const user=interaction.member?.user??interaction.user??{},member=await options.resolve(tenant.tenantId,String(user.id??""));
    if(!member.role)throw new Error("Link your Discord account to this SPMT workspace before reserving an hour");
    if(action==="signup"||action==="cancel") {
      const choices=action==="signup"?slots.filter(slot=>!slot.event&&date>now.slice(0,10)).map(slot=>({label:`${String(slot.hour).padStart(2,"0")}:00 UTC`,value:String(slot.hour)})):
        slots.filter(slot=>slot.event&&(slot.event.userId===member.userId||member.role==="owner")).map(slot=>({label:`${String(slot.hour).padStart(2,"0")}:00 — ${slot.event!.username}`.slice(0,100),value:slot.event!.id}));
      if(!choices.length)throw new Error(action==="signup"?"No hours are available for signup on this date":"You have no reservations to cancel on this date");
      return {type:4,data:{flags:64,content:action==="signup"?`Choose your Raid Train hour on ${date}. All times UTC.`:"Choose the reservation to cancel.",allowed_mentions:{parse:[]},components:[{type:1,components:[{type:3,custom_id:`calendar:${action==="signup"?"raid-claim":"raid-cancel"}:${guild}:${date}`,options:choices,min_values:1,max_values:1}]}]}};
    }
    const receipt=String(interaction.id??""),value=interaction.data?.values?.[0];
    if(!receipt||typeof value!=="string"||interaction.data.values.length!==1)throw new Error("Choose one Raid Train hour");
    options.calendar.once(tenant.tenantId,`discord:${receipt}`,()=>{
      if(action==="raid-claim") {if(!/^(?:[0-9]|1[0-9]|2[0-3])$/.test(value))throw new Error("Choose a valid hour");return options.calendar.reserveRaidTrain({tenantId:tenant.tenantId,serverId:guild,member,date,hour:Number(value),now});}
      const event=options.calendar.get(tenant.tenantId,guild,value);
      if(event&&event.dayKey!==date)throw new Error("This reservation belongs to another date");
      return options.calendar.cancelRaidTrain(tenant.tenantId,guild,value,member.userId,member.role==="owner");
    });
    let pending=false;try{const effects=await options.changed?.(tenant.tenantId);pending=Boolean(effects&&typeof effects==="object"&&"pending" in effects&&effects.pending);}catch{pending=true;}
    return reply((action==="raid-claim"?"Your hour is reserved.":"Your reservation is canceled.")+(pending?" Discord publication is pending and will retry.":" The calendar is updating."));
  } catch(error) {return reply(error instanceof Error?error.message:"The Raid Train change could not be saved");}
}
function reply(content:string){return {type:4,data:{flags:64,content,allowed_mentions:{parse:[]}}};}
