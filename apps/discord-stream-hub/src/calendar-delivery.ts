import { randomUUID } from "node:crypto";
import type { SpmtClient } from "@spmt/sdk";
import { SqliteDshCalendarStore } from "./calendar.js";
import { buildDshCalendarMessage } from "./calendar-presentation.js";
import { DshDiscordError, SqliteDshDiscordMessageStore, type DshDiscordTransportV1 } from "./discord-live-publisher.js";
import { DshPointsService } from "./points.js";

/** Durable image refresh and canonical XP effects shared by all calendar entry points. */
export class DshCalendarDelivery {
  constructor(private readonly calendar:SqliteDshCalendarStore,private readonly messages:SqliteDshDiscordMessageStore,private readonly discord:DshDiscordTransportV1,private readonly now=()=>new Date().toISOString(),private readonly client?:SpmtClient,private readonly preview=false) {}
  async publish(tenant:string,guild:string,channel:string,month=this.now().slice(0,7)) {
    if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))throw new Error("Choose a valid calendar month");
    const owner=randomUUID();if(!this.calendar.acquire(tenant,`image:${guild}`,owner))throw new Error("The calendar image is being updated. Try again shortly.");
    try {
      this.calendar.setState(tenant,`month:${guild}`,month);
      const revision=this.calendar.revision(tenant),today=this.now().slice(0,10),events=this.calendar.month(tenant,guild,month);
      const payload=buildDshCalendarMessage(events,{month,guildId:guild,today}),tracked=this.messages.get(tenant,"calendar",guild);
      let messageId:string|undefined;
      if(tracked&&tracked.channelId===channel){try{await this.discord.editMessage(tenant,channel,tracked.messageId,payload);messageId=tracked.messageId;}catch(error){if(!(error instanceof DshDiscordError)||error.status!==404)throw error;}}
      else if(tracked){try{await this.discord.deleteMessage(tenant,tracked.channelId,tracked.messageId);}catch(error){if(!(error instanceof DshDiscordError)||error.status!==404)throw error;}}
      messageId??=await this.discord.createMessage(tenant,channel,payload);
      this.messages.put({tenantId:tenant,kind:"calendar",key:guild,channelId:channel,messageId,updatedAt:this.now()});
      this.calendar.setState(tenant,`delivered:${guild}`,{revision,month,today});
      this.calendar.setState(tenant,`image-error:${guild}`,null);
      return {messageId,channelId:channel,eventCount:events.filter(e=>e.type==="event").length};
    }catch(error){this.calendar.setState(tenant,`image-error:${guild}`,error instanceof Error?error.message:"Image refresh failed");throw error;}
    finally{this.calendar.release(tenant,`image:${guild}`,owner);}
  }
  async flush(tenant:string) {
    const failures:string[]=[];
    for(const tracked of this.messages.list(tenant,"calendar")) {
      const month=this.calendar.state<string>(tenant,`month:${tracked.key}`)??this.now().slice(0,7),last=this.calendar.state<{revision:number;month:string;today:string}>(tenant,`delivered:${tracked.key}`);
      if(last?.revision===this.calendar.revision(tenant)&&last.month===month&&last.today===this.now().slice(0,10))continue;
      try{await this.publish(tenant,tracked.key,tracked.channelId,month);}catch(error){failures.push(error instanceof Error?error.message:String(error));}
    }
    if(this.client)for(const award of this.calendar.pendingAwards(tenant)){
      try{if(!this.preview)await new DshPointsService(this.client,tenant).awardPoints({userId:award.userId,eventType:award.type==="captains-log"?"admin_captains_log":"admin_calendar_event",upstreamEventId:award.type==="captains-log"?`${award.userId}:${award.dayKey}`:award.id,source:"manual"});this.calendar.settleAward(tenant,award.id);}catch(error){failures.push(error instanceof Error?error.message:String(error));}
    }
    return {pending:failures.length>0,message:failures.join("; ")};
  }
}
