/** Shared, deterministic calendar artwork for the app, Discord PNG and simulation. */
export interface CommunityCalendarItem {
  id: string; type: string; dayKey: string; eventDateTime: string; eventName: string;
  description: string; username: string; userAvatar?: string | null; source?: string;
  color?:string; endDateTime?: string | null; location?: string; status?: number;
}
export interface CommunityCalendarView { month: string; today: string; events: readonly CommunityCalendarItem[] }
/** Bump when artwork changes so already-published Discord attachments refresh once. */
export const COMMUNITY_CALENDAR_ARTWORK_REVISION = 3;
const palette = ["#4ade80", "#38bdf8", "#fb7185", "#c084fc", "#facc15", "#2dd4bf", "#fb923c", "#e879f9", "#a3e635", "#818cf8"];
export function communityCalendarColor(index:number){return palette[index]??`hsl(${Math.round(index*137.508)%360},75%,65%)`;}
export function communityCalendarMissions(view: CommunityCalendarView) {
  const indices=new Map<string,number>();
  return view.events.filter(e => (e.type === "event" || e.type === "raid-train") && e.dayKey.startsWith(view.month)).sort((a,b) => a.eventDateTime.localeCompare(b.eventDateTime) || a.id.localeCompare(b.id)).map(event => {if(!indices.has(event.id))indices.set(event.id,indices.size);const index=indices.get(event.id)!;return {...event,color:event.color&&/^(#[a-f0-9]{6}|hsl\(\d{1,3},75%,65%\))$/i.test(event.color)?event.color:communityCalendarColor(index),number:index+1};});
}
export function renderCommunityCalendarSvg(view: CommunityCalendarView) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(view.month)) throw new Error("Choose a valid month");
  const start = new Date(view.month + "-01T12:00:00Z"), days = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth()+1, 0)).getUTCDate();
  const missions = communityCalendarMissions(view), captains = view.events.filter(e => e.type === "captains-log");
  const maxDots = Math.max(0, ...Array.from({length:days},(_,i) => missions.filter(e => e.dayKey === `${view.month}-${String(i+1).padStart(2,"0")}`).length));
  const cellWidth = 134, dotRadius = 9, dotSpacing = 23;
  const cellHeight = Math.max(140, 46 + Math.ceil(maxDots / 4) * dotSpacing), rows = Math.ceil((start.getUTCDay()+days)/7);
  let y = 126 + rows * cellHeight;
  // DejaVu Sans Mono has a fixed advance: reserve the date/time beside the title,
  // then wrap both columns and the full-width description before sizing the image.
  const titleSize = 22, detailSize = 17, monoAdvance = 0.603, textLeft = 54, textRight = 1000;
  const missionRows = missions.map(e => {
    const time = `${e.dayKey} · ${e.eventDateTime.slice(11,16)}${e.endDateTime ? "–"+e.endDateTime.slice(11,16) : ""} UTC`;
    const titleLimit = Math.floor((textRight-textLeft-24-Array.from(time).length*detailSize*monoAdvance)/(titleSize*monoAdvance));
    const title = wrap(`${e.number}. ${e.eventName}${e.source === "discord" ? " · Discord event" : ""}`, titleLimit);
    const metadataX = textLeft + Math.max(...title.map(line=>Array.from(line).length))*titleSize*monoAdvance + 24;
    const metadata = wrap(`${time}${e.location ? " · "+e.location : ""}${e.status===4?" · Canceled":e.status===3?" · Completed":""}`, Math.floor((textRight-metadataX)/(detailSize*monoAdvance)));
    const detail = wrap(e.description, Math.floor((textRight-textLeft)/(detailSize*monoAdvance)));
    const headerHeight = Math.max(title.length*29, metadata.length*25), at=y;
    y += headerHeight + detail.length*24 + 22;
    return {e,title,metadata,metadataX,detail,headerHeight,at};
  });
  const height = y + 32, today = captains.find(e => e.dayKey === view.today);
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="${height}" viewBox="0 0 1024 ${height}" role="img" aria-label="Community calendar ${view.month}"><rect width="1024" height="${height}" rx="20" fill="#0b172b"/><g fill="#eff6ff" font-family="DejaVu Sans"><text x="24" y="38" font-size="27" font-weight="bold">${xml(start.toLocaleDateString("en-US",{month:"long",year:"numeric",timeZone:"UTC"}))} · Community Calendar</text><text x="24" y="69" font-size="17" fill="#facc15">${view.month===view.today.slice(0,7)?`Captain for today: ${xml(today?.username ?? "Unclaimed")}`:"Captain duty · Avatars show each day’s captain"}</text>`;
  ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].forEach((day,i) => { svg += `<text x="${45+i*140}" y="103" font-size="15">${day}</text>`; });
  for (let day=1;day<=days;day++) {
    const date=`${view.month}-${String(day).padStart(2,"0")}`, offset=start.getUTCDay()+day-1, x=24+(offset%7)*140, top=116+Math.floor(offset/7)*cellHeight;
    const captain=captains.find(e => e.dayKey===date), items=missions.filter(e => e.dayKey===date);
    svg += `<g data-calendar-day="${date}"><rect x="${x}" y="${top}" width="${cellWidth}" height="${cellHeight-6}" rx="9" fill="#16243c"/>`;
    if(captain) {
      const avatar=safeAvatar(captain.userAvatar), avatarWidth=cellWidth-2, avatarHeight=cellHeight-8;
      svg+=`<defs><clipPath id="avatar-${day}"><rect x="${x+1}" y="${top+1}" width="${avatarWidth}" height="${avatarHeight}" rx="8"/></clipPath></defs><g clip-path="url(#avatar-${day})"><rect x="${x+1}" y="${top+1}" width="${avatarWidth}" height="${avatarHeight}" fill="#294367"/>`;
      svg+=avatar?`<image href="${xml(avatar)}" x="${x+1}" y="${top+1}" width="${avatarWidth}" height="${avatarHeight}" preserveAspectRatio="xMidYMid slice"/>`:`<text x="${x+cellWidth/2}" y="${top+avatarHeight/2+20}" text-anchor="middle" font-size="58" font-weight="bold">${xml(Array.from(captain.username.toUpperCase()).slice(0,2).join(""))}</text>`;
      const name=Array.from(captain.username), label=name.length>18?name.slice(0,17).join("")+"…":captain.username;
      svg+=`<rect x="${x+1}" y="${top+cellHeight-30}" width="${avatarWidth}" height="24" fill="#0b172b" fill-opacity="0.85"/><text x="${x+cellWidth/2}" y="${top+cellHeight-14}" text-anchor="middle" font-family="DejaVu Sans Mono" font-size="11" font-weight="bold">${xml(label)}</text></g>`;
    }
    // Draw the date and event markers last so they stay readable over any avatar.
    svg+=`<rect x="${x+4}" y="${top+4}" width="31" height="27" rx="6" fill="#0b172b" fill-opacity="0.85"/><text x="${x+9}" y="${top+24}" font-size="18" font-weight="bold">${day}</text>`;
    items.forEach((e,i)=>{svg+=`<circle cx="${x+118-(i%4)*dotSpacing}" cy="${top+15+Math.floor(i/4)*dotSpacing}" r="${dotRadius}" fill="${e.color}" stroke="#0b172b" stroke-width="2"/>`;});
    svg+=`<rect x="${x}" y="${top}" width="${cellWidth}" height="${cellHeight-6}" rx="9" fill="none" stroke="${date===view.today?"#facc15":"#2b3d58"}" stroke-width="${date===view.today?2:1}"/></g>`;
  }
  if(!missions.length) svg+=`<text x="24" y="${y+8}" font-size="16">No missions this month.</text>`;
  for(const {e,title,metadata,metadataX,detail,headerHeight,at} of missionRows) {
    svg+=`<g data-calendar-event="${xml(e.id)}" font-family="DejaVu Sans Mono"><circle cx="32" cy="${at+16}" r="9" fill="${e.color}"/>`;
    title.forEach((line,i)=>{svg+=`<text x="${textLeft}" y="${at+24+i*29}" font-size="${titleSize}" font-weight="bold" fill="${e.color}">${xml(line)}</text>`;});
    metadata.forEach((line,i)=>{svg+=`<text x="${metadataX}" y="${at+24+i*25}" font-size="${detailSize}" font-weight="bold" fill="#cbd8ec">${xml(line)}</text>`;});
    detail.forEach((line,i)=>{svg+=`<text x="${textLeft}" y="${at+headerHeight+23+i*24}" font-size="${detailSize}">${xml(line)}</text>`;});
    svg+="</g>";
  }
  return svg+"</g></svg>";
}
function safeAvatar(value?:string|null) { if(!value)return ""; if(/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(value))return value; try { const url=new URL(value); return url.protocol==="https:"&&!url.username&&!url.password?url.href:""; }catch{return "";} }
function xml(value:string) { return value.replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&apos;"})[c]!); }
function wrap(value:string,width:number) { return value.split(/\r?\n/).flatMap(line=>{const parts:string[]=[];let chars=Array.from(line);while(chars.length>width){let end=chars.lastIndexOf(" ",width);if(end<width/2)end=width;parts.push(chars.slice(0,end).join(""));chars=Array.from(chars.slice(end).join("").trimStart());}parts.push(chars.join(""));return parts;}); }
