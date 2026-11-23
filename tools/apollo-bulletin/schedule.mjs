const DEFAULT_TIME_ZONE = "America/Chicago";
function validTimeZone(value) { try { new Intl.DateTimeFormat("en-US", { timeZone: value }).format(0); return value; } catch { throw new Error("Schedule timezone must be a valid IANA timezone"); } }
function zonedParts(timestamp, timeZone) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, weekday:"short", year:"numeric", month:"2-digit", day:"2-digit", hour:"2-digit", minute:"2-digit", hourCycle:"h23" }).formatToParts(new Date(timestamp));
  const values = Object.fromEntries(parts.map(p => [p.type,p.value]));
  return { year:Number(values.year), month:Number(values.month), day:Number(values.day), hour:Number(values.hour), minute:Number(values.minute), weekday:["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].indexOf(values.weekday) };
}
function localDateTimeToUtc(year, month, day, hour, minute, timeZone) {
  const target=Date.UTC(year,month-1,day,hour,minute); let guess=target;
  for(let i=0;i<4;i++){const p=zonedParts(guess,timeZone),represented=Date.UTC(p.year,p.month-1,p.day,p.hour,p.minute),next=guess+(target-represented);if(next===guess)return guess;guess=next;}
  for(let i=0;i<=180;i++){const candidate=guess+i*60000,p=zonedParts(candidate,timeZone);if(Date.UTC(p.year,p.month-1,p.day,p.hour,p.minute)>=target)return candidate;}
  throw new Error("Unable to resolve schedule time in timezone");
}
function parseRunAt(value, timeZone) {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(value)) {
    const [date,time]=value.split("T"),[year,month,day]=date.split("-").map(Number),[hour,minute,second=0]=time.split(":").map(Number);
    const calendarDate=new Date(Date.UTC(year,month-1,day));
    if(calendarDate.getUTCFullYear()!==year||calendarDate.getUTCMonth()+1!==month||calendarDate.getUTCDate()!==day)throw new Error("One-time schedule date is invalid");
    return localDateTimeToUtc(year,month,day,hour,minute,timeZone)+second*1000;
  }
  return new Date(value).getTime();
}
export function normalizeSchedule(input = {}, now = Date.now()) {
  const type=["manual","once","interval","weekly","monthly"].includes(input.type)?input.type:"manual";
  if(type==="manual")return {type};
  if(type==="once"){const timeZone=validTimeZone(input.timeZone||DEFAULT_TIME_ZONE),at=parseRunAt(input.runAt,timeZone);if(!Number.isFinite(at)||at<=now)throw new Error("One-time schedule must be in the future");return {type,runAt:at,timeZone};}
  if(type==="interval"){const every=Number(input.every),unit=["seconds","minutes","hours","days"].includes(input.unit)?input.unit:"minutes";if(!Number.isInteger(every)||every<1||every>100000)throw new Error("Interval must be a positive whole number");return {type,every,unit};}
  const time=/^([01]\d|2[0-3]):([0-5]\d)$/.test(input.time||"")?input.time:"09:00",timeZone=validTimeZone(input.timeZone||DEFAULT_TIME_ZONE);
  if(type==="weekly"){const weekdays=Array.isArray(input.weekdays)?input.weekdays.map(Number).filter(n=>Number.isInteger(n)&&n>=0&&n<=6):[];if(!weekdays.length)throw new Error("Choose at least one weekday");return {type,weekdays:[...new Set(weekdays)].sort(),time,timeZone};}
  const day=Number(input.day);if(!Number.isInteger(day)||day<1||day>31)throw new Error("Monthly day must be between 1 and 31");return {type,day,time,timeZone};
}
const unitMs={seconds:1000,minutes:60000,hours:3600000,days:86400000};
export function nextScheduledAt(schedule,now=Date.now()){
  if(!schedule||schedule.type==="manual")return null;if(schedule.type==="once")return schedule.runAt;if(schedule.type==="interval")return now+schedule.every*unitMs[schedule.unit];
  const timeZone=validTimeZone(schedule.timeZone||DEFAULT_TIME_ZONE),current=zonedParts(now,timeZone),[hour,minute]=(schedule.time||"09:00").split(":").map(Number);
  if(schedule.type==="weekly"){for(let offset=0;offset<=7;offset++){const date=new Date(Date.UTC(current.year,current.month-1,current.day+offset));if(!schedule.weekdays.includes(date.getUTCDay()))continue;const candidate=localDateTimeToUtc(date.getUTCFullYear(),date.getUTCMonth()+1,date.getUTCDate(),hour,minute,timeZone);if(candidate>now)return candidate;}return null;}
  if(schedule.type==="monthly"){for(let offset=0;offset<=24;offset++){const monthDate=new Date(Date.UTC(current.year,current.month-1+offset,1)),year=monthDate.getUTCFullYear(),month=monthDate.getUTCMonth()+1,lastDay=new Date(Date.UTC(year,month,0)).getUTCDate();if(schedule.day>lastDay)continue;const candidate=localDateTimeToUtc(year,month,schedule.day,hour,minute,timeZone);if(candidate>now)return candidate;}return null;}return null;
}
export function scheduleLabel(schedule){if(!schedule||schedule.type==="manual")return "Manual";if(schedule.type==="once")return "Once"+(schedule.timeZone?" · "+schedule.timeZone:"");if(schedule.type==="interval")return "Every "+schedule.every+" "+schedule.unit;if(schedule.type==="weekly")return "Weekly · "+schedule.weekdays.map(d=>["Sun","Mon","Tue","Wed","Thu","Fri","Sat"][d]).join(", ")+" · "+schedule.time+" "+(schedule.timeZone||DEFAULT_TIME_ZONE);if(schedule.type==="monthly")return "Monthly · day "+schedule.day+" · "+schedule.time+" "+(schedule.timeZone||DEFAULT_TIME_ZONE);return schedule.type;}
