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
    {type:2,style:1,label:"Raid Train",custom_id:`calendar:raid:${input.guildId}:${input.month}`},
    {type:2,style:2,label:"Next month",custom_id:`calendar:next:${input.guildId}:${input.month}`}
  ]}]};
}

export function buildDshRaidTrainMessage(events:readonly DshCalendarEventV1[],input:{date:string;guildId:string;today:string}) {
  const slots=events.filter(e=>e.type==="raid-train"&&e.dayKey===input.date).sort((a,b)=>a.eventDateTime.localeCompare(b.eventDateTime));
  const hours=new Set(slots.map(e=>Number(e.eventDateTime.slice(11,13))));
  const available=Array.from({length:24},(_,hour)=>hour).filter(hour=>!hours.has(hour));
  return {embeds:[{title:`Raid Train · ${input.date}`,description:slots.length?slots.map(e=>`${e.eventDateTime.slice(11,16)} UTC — ${e.username.replace(/[\r\n`*_~|\\]/g," ").slice(0,80)}`).join("\n"):"No hourly reservations yet.",color:0xfb923c,fields:[{name:"Available hours (UTC)",value:available.map(hour=>String(hour).padStart(2,"0")+":00").join(", ")||"All 24 hours are claimed"}],footer:{text:`${hours.size}/24 hours claimed · Signup closes on the day`}}],allowed_mentions:{parse:[]},components:[{type:1,components:[
    {type:2,style:1,label:"Sign up",custom_id:`raid_signup_${input.date}`,disabled:input.date<=input.today||!available.length},
    {type:2,style:2,label:"View schedule",custom_id:`raid_view_${input.date}`},
    {type:2,style:4,label:"Cancel slot",custom_id:`raid_cancel_${input.date}`},
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
export interface DshLeaderboardImageEntryV1 { rank:number; displayName?:string; userId:string; lifetimeXp:number; spendableXp:number; level:number; }
export function renderDshLeaderboardSvg(rows:readonly DshLeaderboardImageEntryV1[],options:{communityName?:string;updatedAt?:string}={}){
  const escape=(value:unknown)=>String(value??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&apos;").replace(/[\r\n]/g," ").slice(0,100);
  const community=escape(options.communityName||"Community"),updated=escape(new Date(options.updatedAt??new Date().toISOString()).toLocaleString("en-US",{timeZone:"UTC",dateStyle:"medium",timeStyle:"short"})+" UTC");
  const entries=rows.slice(0,10),cards=entries.map((row,index)=>{
    const y=310+index*96,rank=String(row.rank||index+1).padStart(2,"0"),name=escape(row.displayName||row.userId||"Unknown"),lifetime=Math.max(0,Math.trunc(Number(row.lifetimeXp)||0)).toLocaleString("en-US"),spendable=Math.max(0,Math.trunc(Number(row.spendableXp)||0)).toLocaleString("en-US"),level=Math.max(1,Math.trunc(Number(row.level)||1));
    const accent=index===0?"#f6c85f":index===1?"#c5d5e8":index===2?"#d79a69":"#63d5ed";
    return `<g><rect x="58" y="${y}" width="1084" height="82" rx="18" fill="#17243a" stroke="#2c4262" stroke-width="2"/><rect x="58" y="${y}" width="8" height="82" rx="4" fill="${accent}"/><circle cx="112" cy="${y+41}" r="25" fill="#233b5d" stroke="${accent}" stroke-width="2"/><text x="112" y="${y+49}" text-anchor="middle" font-family="DejaVu Sans" font-size="21" font-weight="700" fill="#ffffff">#${rank}</text><text x="160" y="${y+35}" font-family="DejaVu Sans" font-size="26" font-weight="700" fill="#ffffff">${name}</text><text x="160" y="${y+62}" font-family="DejaVu Sans" font-size="15" fill="#9fb3ce">LEVEL ${level}</text><text x="1080" y="${y+34}" text-anchor="end" font-family="DejaVu Sans" font-size="24" font-weight="700" fill="#f0f6ff">${lifetime} XP</text><text x="1080" y="${y+60}" text-anchor="end" font-family="DejaVu Sans" font-size="15" fill="#9fb3ce">${spendable} SPENDABLE</text></g>`;
  }).join("");
  const empty=entries.length?"":'<text x="600" y="470" text-anchor="middle" font-family="DejaVu Sans" font-size="30" fill="#d9e5f5">No XP activity yet. Start participating to appear here.</text>';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1400" viewBox="0 0 1200 1400"><defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0a1425"/><stop offset="1" stop-color="#152b48"/></linearGradient><linearGradient id="title" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#74e4ff"/><stop offset="1" stop-color="#b9a5ff"/></linearGradient></defs><rect width="1200" height="1400" fill="url(#bg)"/><circle cx="1060" cy="90" r="240" fill="#375a8a" opacity=".12"/><circle cx="100" cy="1320" r="280" fill="#5b4b9a" opacity=".10"/><text x="62" y="86" font-family="DejaVu Sans" font-size="22" letter-spacing="5" fill="#91a9c8">${community.toUpperCase()} · DISCORD STREAM HUB</text><text x="60" y="174" font-family="DejaVu Sans" font-size="64" font-weight="700" fill="url(#title)">COMMUNITY LEADERBOARD</text><text x="64" y="222" font-family="DejaVu Sans" font-size="23" letter-spacing="3" fill="#c5d7ee">TOP 10 · RANKED BY LIFETIME XP</text><rect x="58" y="254" width="1084" height="2" fill="#456487" opacity=".7"/>${cards}${empty}<text x="62" y="1328" font-family="DejaVu Sans" font-size="17" fill="#9fb3ce">Lifetime XP determines rank. Spending XP does not lower your rank.</text><text x="1140" y="1328" text-anchor="end" font-family="DejaVu Sans" font-size="15" fill="#7893b6">UPDATED ${updated}</text></svg>`;
}
export function renderDshLeaderboardPng(rows:readonly DshLeaderboardImageEntryV1[],options:{communityName?:string;updatedAt?:string}={}){
  const require=createRequire(import.meta.url),fontFiles=["DejaVuSans","DejaVuSans-Bold"].map(name=>require.resolve(`dejavu-fonts-ttf/ttf/${name}.ttf`));
  const png=new Resvg(renderDshLeaderboardSvg(rows,options),{font:{fontFiles,loadSystemFonts:false}}).render().asPng();
  if(png.byteLength>8_000_000)throw new Error("The leaderboard image exceeds Discord's attachment size");
  return png;
}

/** Keep binary images at the provider boundary; simulation events retain the shared view. */
export async function dshDiscordRequestBody(payload:Record<string,unknown>,fetchImpl:typeof fetch=fetch):Promise<{body:BodyInit;headers:Record<string,string>}> {
  if(payload.leaderboardImage){const {leaderboardImage:raw,...message}=payload,bytes=Buffer.from(raw as Uint8Array);if(bytes.byteLength>8_000_000)throw new Error("The leaderboard image exceeds Discord's attachment size");const form=new FormData();form.set("payload_json",JSON.stringify({...message,attachments:[{id:0,filename:"community-leaderboard.png"}]}));form.set("files[0]",new Blob([new Uint8Array(bytes)],{type:"image/png"}),"community-leaderboard.png");return{body:form,headers:{}};}
  if(!payload.calendar)return{body:JSON.stringify(payload),headers:{"content-type":"application/json"}};
  const {calendar:raw,...message}=payload,calendar=raw as CommunityCalendarView;
  const bytes=await renderDshCalendarPng(calendar.events,calendar.month,fetchImpl,calendar.today),form=new FormData();
  form.set("payload_json",JSON.stringify(message));form.set("files[0]",new Blob([new Uint8Array(bytes)],{type:"image/png"}),"community-calendar.png");
  return{body:form,headers:{}};
}
