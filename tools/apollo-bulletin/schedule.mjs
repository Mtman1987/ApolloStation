export function normalizeSchedule(input = {}, now = Date.now()) {
  const type = ["manual", "once", "interval", "weekly", "monthly"].includes(input.type) ? input.type : "manual";
  if (type === "manual") return { type };
  if (type === "once") { const at = new Date(input.runAt).getTime(); if (!Number.isFinite(at) || at <= now) throw new Error("One-time schedule must be in the future"); return { type, runAt: at }; }
  if (type === "interval") { const every = Number(input.every), unit = ["seconds","minutes","hours","days"].includes(input.unit) ? input.unit : "minutes"; if (!Number.isInteger(every) || every < 1 || every > 100000) throw new Error("Interval must be a positive whole number"); return { type, every, unit }; }
  const time = /^([01]\d|2[0-3]):([0-5]\d)$/.test(input.time || "") ? input.time : "09:00";
  if (type === "weekly") { const weekdays = Array.isArray(input.weekdays) ? input.weekdays.map(Number).filter(n => Number.isInteger(n) && n >= 0 && n <= 6) : []; if (!weekdays.length) throw new Error("Choose at least one weekday"); return { type, weekdays: [...new Set(weekdays)].sort(), time }; }
  const day = Number(input.day); if (!Number.isInteger(day) || day < 1 || day > 31) throw new Error("Monthly day must be between 1 and 31"); return { type, day, time };
}
const unitMs = { seconds:1000, minutes:60000, hours:3600000, days:86400000 };
export function nextScheduledAt(schedule, now = Date.now()) {
  if (!schedule || schedule.type === "manual") return null;
  if (schedule.type === "once") return schedule.runAt;
  if (schedule.type === "interval") return now + schedule.every * unitMs[schedule.unit];
  const date = new Date(now), [hour,minute] = (schedule.time || "09:00").split(":").map(Number);
  if (schedule.type === "weekly") { for(let offset=0;offset<=7;offset++){const candidate=new Date(date);candidate.setDate(date.getDate()+offset);candidate.setHours(hour,minute,0,0);if(schedule.weekdays.includes(candidate.getDay())&&candidate.getTime()>now)return candidate.getTime();}return null; }
  if (schedule.type === "monthly") { for(let offset=0;offset<=2;offset++){const candidate=new Date(date.getFullYear(),date.getMonth()+offset,schedule.day,hour,minute,0,0);if(candidate.getDate()===schedule.day&&candidate.getTime()>now)return candidate.getTime();}return null; }
  return null;
}
export function scheduleLabel(schedule) {
  if(!schedule||schedule.type==="manual")return "Manual";if(schedule.type==="once")return "Once";if(schedule.type==="interval")return "Every "+schedule.every+" "+schedule.unit;
  if(schedule.type==="weekly")return "Weekly · "+schedule.weekdays.map(d=>["Sun","Mon","Tue","Wed","Thu","Fri","Sat"][d]).join(", ")+" · "+schedule.time;
  if(schedule.type==="monthly")return "Monthly · day "+schedule.day+" · "+schedule.time;return schedule.type;
}