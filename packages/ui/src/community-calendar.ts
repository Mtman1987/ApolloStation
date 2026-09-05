/** Shared, deterministic calendar artwork for the app, Discord PNG and simulation. */
export interface CommunityCalendarItem {
  id: string; type: string; dayKey: string; eventDateTime: string; eventName: string;
  description: string; username: string; userAvatar?: string | null; source?: string;
  color?:string; endDateTime?: string | null; location?: string; status?: number;
}
export interface CommunityCalendarView { month: string; today: string; events: readonly CommunityCalendarItem[] }
const palette = ["#4ade80", "#38bdf8", "#fb7185", "#c084fc", "#facc15", "#2dd4bf", "#fb923c", "#e879f9", "#a3e635", "#818cf8"];
export function communityCalendarColor(index:number){return palette[index]??`hsl(${Math.round(index*137.508)%360},75%,65%)`;}
export function communityCalendarMissions(view: CommunityCalendarView) {
  const indices=new Map<string,number>();
  return view.events.filter(e => e.type === "event" && e.dayKey.startsWith(view.month)).sort((a,b) => a.eventDateTime.localeCompare(b.eventDateTime) || a.id.localeCompare(b.id)).map(event => {if(!indices.has(event.id))indices.set(event.id,indices.size);const index=indices.get(event.id)!;return {...event,color:event.color&&/^(#[a-f0-9]{6}|hsl\(\d{1,3},75%,65%\))$/i.test(event.color)?event.color:communityCalendarColor(index),number:index+1};});
}
export function renderCommunityCalendarSvg(view: CommunityCalendarView) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(view.month)) throw new Error("Choose a valid month");
  const start = new Date(view.month + "-01T12:00:00Z"), days = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth()+1, 0)).getUTCDate();
  const missions = communityCalendarMissions(view), captains = view.events.filter(e => e.type === "captains-log");
  const maxDots = Math.max(0, ...Array.from({length:days},(_,i) => missions.filter(e => e.dayKey === `${view.month}-${String(i+1).padStart(2,"0")}`).length));
  const cellHeight = Math.max(112, 34 + Math.ceil(maxDots / 4) * 15 + 72), rows = Math.ceil((start.getUTCDay()+days)/7);
  let y = 126 + rows * cellHeight;
  const missionRows = missions.map(e => { const title = wrap(`${e.number}. ${e.eventName}${e.source === "discord" ? " · Discord event" : ""}`,80), detail = wrap(e.description,98), at=y; y += 44 + title.length*23 + detail.length*19; return {e,title,detail,at}; });
  const height = y + 32, today = captains.find(e => e.dayKey === view.today);
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="${height}" viewBox="0 0 1024 ${height}" role="img" aria-label="Community calendar ${view.month}"><rect width="1024" height="${height}" rx="20" fill="#0b172b"/><g fill="#eff6ff" font-family="DejaVu Sans"><text x="24" y="38" font-size="27" font-weight="bold">${xml(start.toLocaleDateString("en-US",{month:"long",year:"numeric",timeZone:"UTC"}))} · Community Calendar</text><text x="24" y="69" font-size="17" fill="#facc15">${view.month===view.today.slice(0,7)?`Captain for today: ${xml(today?.username ?? "Unclaimed")}`:"Captain duty · Avatars show each day’s captain"}</text>`;
  ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].forEach((day,i) => { svg += `<text x="${45+i*140}" y="103" font-size="15">${day}</text>`; });
  for (let day=1;day<=days;day++) {
    const date=`${view.month}-${String(day).padStart(2,"0")}`, offset=start.getUTCDay()+day-1, x=24+(offset%7)*140, top=116+Math.floor(offset/7)*cellHeight;
    const captain=captains.find(e => e.dayKey===date), items=missions.filter(e => e.dayKey===date);
    svg += `<rect x="${x}" y="${top}" width="134" height="${cellHeight-6}" rx="9" fill="#16243c" stroke="${date===view.today?"#facc15":"#2b3d58"}"/><text x="${x+9}" y="${top+23}" font-size="18">${day}</text>`;
    items.forEach((e,i)=>{svg+=`<circle cx="${x+121-(i%4)*17}" cy="${top+14+Math.floor(i/4)*15}" r="6" fill="${e.color}"/>`;});
    if(captain) {
      const cy=top+cellHeight-64, avatar=safeAvatar(captain.userAvatar);
      svg+=`<circle cx="${x+67}" cy="${cy+18}" r="23" fill="#294367"/>`;
      svg+=avatar?`<defs><clipPath id="avatar-${day}"><circle cx="${x+67}" cy="${cy+18}" r="23"/></clipPath></defs><image href="${xml(avatar)}" x="${x+44}" y="${cy-5}" width="46" height="46" clip-path="url(#avatar-${day})"/>`:`<text x="${x+67}" y="${cy+25}" text-anchor="middle" font-size="20">${xml(captain.username.slice(0,2).toUpperCase())}</text>`;
      svg+=`<text x="${x+67}" y="${top+cellHeight-14}" text-anchor="middle" font-size="11">${xml(captain.username.slice(0,19))}</text>`;
    }
  }
  if(!missions.length) svg+=`<text x="24" y="${y+8}" font-size="16">No missions this month.</text>`;
  for(const {e,title,detail,at} of missionRows) {
    svg+=`<circle cx="32" cy="${at+14}" r="7" fill="${e.color}"/><g font-family="DejaVu Sans Mono">`;
    title.forEach((line,i)=>{svg+=`<text x="50" y="${at+20+i*23}" font-size="18" font-weight="bold">${xml(line)}</text>`;});
    const below=at+title.length*23;
    svg+=`<text x="50" y="${below+20}" font-size="14" fill="#b4c5df">${xml(`${e.dayKey} · ${e.eventDateTime.slice(11,16)}${e.endDateTime ? "–"+e.endDateTime.slice(11,16) : ""} UTC${e.location ? " · "+e.location : ""}${e.status===4?" · Canceled":e.status===3?" · Completed":""}`)}</text>`;
    detail.forEach((line,i)=>{svg+=`<text x="50" y="${below+41+i*19}" font-size="15">${xml(line)}</text>`;});
    svg+="</g>";
  }
  return svg+"</g></svg>";
}
function safeAvatar(value?:string|null) { if(!value)return ""; if(/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(value))return value; try { const url=new URL(value); return url.protocol==="https:"&&!url.username&&!url.password?url.href:""; }catch{return "";} }
function xml(value:string) { return value.replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&apos;"})[c]!); }
function wrap(value:string,width:number) { return value.split(/\r?\n/).flatMap(line=>{const parts:string[]=[]; while(line.length>width){let end=line.lastIndexOf(" ",width);if(end<width/2)end=width;parts.push(line.slice(0,end));line=line.slice(end).trimStart();}parts.push(line);return parts;}); }
