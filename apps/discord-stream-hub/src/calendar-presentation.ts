import { createRequire } from "node:module";
import { Resvg } from "@resvg/resvg-js";
import { renderCommunityCalendarSvg, type CommunityCalendarView } from "@spmt/ui";
import type { DshCalendarEventV1, DshCalendarMemberV1 } from "./calendar.js";

/** Count distinct duty dates, including roster members who have chosen no dates. */
export function dshCaptainParticipation(events: readonly DshCalendarEventV1[], members: readonly DshCalendarMemberV1[] = [], minimumDays = 0) {
  const rows = new Map(members.map(member => [member.userId, { ...member, dates: new Set<string>() }]));
  for (const event of events) {
    if (event.type !== "captains-log") continue;
    const row = rows.get(event.userId) ?? { userId: event.userId, username: event.username, avatarUrl: event.userAvatar, dates: new Set<string>() };
    row.dates.add(event.dayKey); rows.set(event.userId, row);
  }
  return [...rows.values()].map(row => ({ userId: row.userId, username: row.username, avatarUrl: row.avatarUrl, dates: [...row.dates].sort(), dayCount: row.dates.size, minimumDays, remainingDays: Math.max(0, minimumDays - row.dates.size) })).sort((a, b) => a.dayCount - b.dayCount || a.username.localeCompare(b.username));
}

export function buildDshCalendarMessage(events: readonly DshCalendarEventV1[], input: {month:string;guildId:string;today:string}) {
  const calendar:CommunityCalendarView={month:input.month,today:input.today,events:events.map(e=>({id:e.id,type:e.type,...(e.color?{color:e.color}:{}),dayKey:e.dayKey,eventDateTime:e.eventDateTime,eventName:e.eventName,description:e.description,username:e.username,userAvatar:e.userAvatar,...(e.source?{source:e.source}:{}),...(e.endDateTime?{endDateTime:e.endDateTime}:{}),...(e.location?{location:e.location}:{}),...(e.status?{status:e.status}:{})}))};
  return {calendar,embeds:[{title:`Community Calendar · ${input.month}`,image:{url:"attachment://community-calendar.png"},color:0x38bdf8,footer:{text:"Captain duty and missions · All times UTC"}}],attachments:[{id:0,filename:"community-calendar.png"}],allowed_mentions:{parse:[]},components:[{type:1,components:[
    {type:2,style:2,label:"Previous month",custom_id:`calendar:previous:${input.guildId}:${input.month}`},
    {type:2,style:1,label:"Claim Captain’s Log",custom_id:`calendar:captain:${input.guildId}:${input.month}`},
    {type:2,style:1,label:"Add mission",custom_id:`calendar:mission:${input.guildId}:${input.month}`},
    {type:2,style:2,label:"Next month",custom_id:`calendar:next:${input.guildId}:${input.month}`}
  ]}]};
}

export async function renderDshCalendarPng(events:readonly CommunityCalendarView["events"][number][],month:string,fetchImpl:typeof fetch=fetch,today=new Date().toISOString().slice(0,10)) {
  const avatars=new Map<string,string>();
  await Promise.all([...new Set(events.filter(e=>e.type==="captains-log"&&e.dayKey.startsWith(month)).map(e=>e.userAvatar).filter((x):x is string=>Boolean(x)))].slice(0,31).map(async value=>{
    try {
      const url=new URL(value);if(url.protocol!=="https:"||url.username||url.password||!["cdn.discordapp.com","media.discordapp.net","static-cdn.jtvnw.net"].includes(url.hostname))return;
      const response=await fetchImpl(url,{redirect:"error",signal:AbortSignal.timeout(3000)}),mime=(response.headers.get("content-type")??"").split(";")[0];
      if(!response.ok||!/^image\/(png|jpeg|webp)$/.test(mime??"")||Number(response.headers.get("content-length"))>512000){await response.body?.cancel();return;}
      const reader=response.body?.getReader();if(!reader)return;const chunks:Uint8Array[]=[];let size=0;
      try{while(true){const {value:chunk,done}=await reader.read();if(done)break;size+=chunk.byteLength;if(size>512000){await reader.cancel();return;}chunks.push(chunk);}}finally{reader.releaseLock();}
      avatars.set(value,`data:${mime};base64,${Buffer.concat(chunks).toString("base64")}`);
    } catch { /* A real member's initials remain visible if their provider avatar cannot load. */ }
  }));
  const svg=renderCommunityCalendarSvg({month,today,events:events.map(e=>({...e,userAvatar:e.userAvatar?avatars.get(e.userAvatar)??null:null}))});
  const require=createRequire(import.meta.url),fontFiles=["DejaVuSans","DejaVuSans-Bold","DejaVuSansMono","DejaVuSansMono-Bold"].map(name=>require.resolve(`dejavu-fonts-ttf/ttf/${name}.ttf`));
  const png=new Resvg(svg,{font:{fontFiles,loadSystemFonts:false}}).render().asPng();
  if(png.byteLength>8_000_000)throw new Error("The calendar image exceeds Discord's attachment size; shorten mission descriptions before publishing.");
  return png;
}
/** Keep binary images at the provider boundary; simulation events retain the shared view. */
export async function dshDiscordRequestBody(payload:Record<string,unknown>,fetchImpl:typeof fetch=fetch):Promise<{body:BodyInit;headers:Record<string,string>}> {
  if(!payload.calendar)return{body:JSON.stringify(payload),headers:{"content-type":"application/json"}};
  const {calendar:raw,...message}=payload,calendar=raw as CommunityCalendarView;
  const bytes=await renderDshCalendarPng(calendar.events,calendar.month,fetchImpl,calendar.today),form=new FormData();
  form.set("payload_json",JSON.stringify(message));form.set("files[0]",new Blob([new Uint8Array(bytes)],{type:"image/png"}),"community-calendar.png");
  return{body:form,headers:{}};
}
