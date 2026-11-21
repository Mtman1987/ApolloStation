const ALARM="apollo-bulletin-hourly";
const DEFAULTS={enabled:true,paused:false,maxCycles:3,cycles:0,cooldownMs:60000,queue:[],activity:[]};
const COMPLETION="\n\nWhen fully complete, output this exact task-specific marker on its own line: ";
const CONTINUE="Continue working on the task above from your saved checkpoint. Review what remains in the TODO/checklist, do the next concrete step, update the checkpoint, and do not claim completion unless all requirements are finished. If finished, output the task-specific completion marker on its own line: ";
async function getState(){const{state}=await chrome.storage.local.get("state");return{...DEFAULTS,...(state||{})}}
async function save(s,event){s.activity=[...(s.activity||[]),{at:Date.now(),event}].slice(-200);await chrome.storage.local.set({state:s});return s}
async function ensureAlarm(){const s=await getState();if(s.enabled&&!s.paused)chrome.alarms.create(ALARM,{periodInMinutes:60});else await chrome.alarms.clear(ALARM)}
async function activeTab(){return(await chrome.tabs.query({active:true,lastFocusedWindow:true}))[0]||null}
async function runOnce(manual=false){let s=await getState();if(!s.enabled||s.paused)return save(s,"tick-skipped-paused");const item=s.queue.find(q=>q.status==="active")||s.queue.find(q=>q.status==="pending");if(!item)return save(s,"tick-skipped-empty-queue");if(item.status==="attempted")return save(s,"tick-skipped-uncertain-send-no-retry");if((item.cycles||0)>=s.maxCycles)return save(s,"tick-skipped-task-cycle-cap");
const tab=await activeTab();if(!tab?.id||tab.url!==item.targetUrl)return save(s,"tick-skipped-target-tab-not-active");let snap;try{snap=await chrome.tabs.sendMessage(tab.id,{type:"APOLLO_SNAPSHOT"})}catch{return save(s,"tick-skipped-content-script-unavailable")}
if(!snap||snap.url!==item.targetUrl||snap.busy!==false||snap.composerReady!==true||snap.sendControlVisible!==true)return save(s,"tick-skipped-ambiguous-ui");
if(item.status==="active"&&snap.assistantText?.includes(item.completionToken)){s.queue=s.queue.map(q=>q.id===item.id?{...q,status:"completed",completedAt:Date.now(),completionDetected:true}:q);s.completed=s.queue.length>0&&s.queue.every(q=>q.status==="completed");return save(s,"task-completion-marker-detected")}
if(s.lastAttemptAt&&Date.now()-s.lastAttemptAt<s.cooldownMs)return save(s,"tick-skipped-cooldown");
const prompt=item.status==="active"?CONTINUE+item.completionToken:item.prompt+COMPLETION+item.completionToken;
s.queue=s.queue.map(q=>q.id===item.id?{...q,status:"attempted",attemptedAt:Date.now()}:q);s.lastAttemptAt=Date.now();s.lastAttemptId=item.id;s=await save(s,manual?"manual-send-intent":"scheduled-send-intent");
try{const result=await chrome.tabs.sendMessage(tab.id,{type:"APOLLO_SUBMIT",prompt,targetUrl:item.targetUrl});s=await getState();s.queue=s.queue.map(q=>q.id===item.id?{...q,status:result?.clicked===true?"active":"attempted",clickResult:result?.clicked===true?"click-issued":"unconfirmed",cycles:(q.cycles||0)+(result?.clicked===true?1:0),lastAttemptAt:Date.now()}:q);if(result?.clicked===true)s.cycles=(s.cycles||0)+1;return save(s,result?.clicked===true?"send-click-issued-task-active-not-delivery-confirmed":"send-unconfirmed-no-retry")}catch{return save(await getState(),"send-error-no-auto-retry")}}
chrome.runtime.onInstalled.addListener(async()=>{await chrome.storage.local.set({state:await getState()});await ensureAlarm()});
chrome.runtime.onStartup.addListener(()=>{void ensureAlarm()});
chrome.alarms.onAlarm.addListener(a=>{if(a.name===ALARM)void runOnce(false)});
chrome.runtime.onMessage.addListener((m,sender,respond)=>{(async()=>{if(m?.type==="APOLLO_GET_STATE")return getState();
if(m?.type==="APOLLO_ENQUEUE"){const s=await getState();if(typeof m.prompt!=="string"||!m.prompt.trim()||! /^https:\/\/chatgpt\.com\/c\/[A-Za-z0-9-]+$/.test(m.targetUrl||""))throw Error("Prompt and exact conversation URL required");const id=crypto.randomUUID(),token="APOLLO_TASK_COMPLETE:"+id;const item={id,prompt:m.prompt.trim(),targetUrl:m.targetUrl,completionToken:token,status:"pending",cycles:0,createdAt:Date.now()};return save({...s,completed:false,queue:[...s.queue,item]},"queue-item-added")}
if(m?.type==="APOLLO_PAUSE"){const s=await getState(),r=await save({...s,paused:true},"paused");await ensureAlarm();return r}
if(m?.type==="APOLLO_RESUME"){const s=await getState(),r=await save({...s,paused:false,enabled:true},"resumed");await ensureAlarm();return r}
if(m?.type==="APOLLO_STOP"){const s=await getState(),r=await save({...s,enabled:false,paused:true},"stopped");await ensureAlarm();return r}
if(m?.type==="APOLLO_SET_MAX_CYCLES"){const n=Number(m.maxCycles);if(!Number.isInteger(n)||n<1||n>100)throw Error("Max cycles must be 1–100");const s=await getState();return save({...s,maxCycles:n},"max-cycles-updated")}
if(m?.type==="APOLLO_RUN_NOW")return runOnce(true);
if(m?.type==="APOLLO_COMPLETE"){const s=await getState();s.queue=s.queue.map(q=>q.id===m.id?{...q,status:"completed",completedAt:Date.now(),completionDetected:false}:q);s.completed=s.queue.length>0&&s.queue.every(q=>q.status==="completed");return save(s,"queue-item-completed")}
})().then(respond).catch(e=>respond({error:e.message||"Action failed"}));return true});