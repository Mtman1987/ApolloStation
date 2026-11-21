import { createServer } from "node:http";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";

const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Apollo Bulletin</title><style>
:root{color-scheme:dark;font:15px system-ui;background:#080d1c;color:#edf3ff}body{max-width:980px;margin:0 auto;padding:24px}h1{margin-bottom:4px}.muted{color:#9eacc8}.panel,article{background:#111b30;border:1px solid #293956;border-radius:16px;padding:16px;margin:14px 0}input,textarea,select,button{font:inherit;color:inherit;background:#0a1325;border:1px solid #405577;border-radius:9px;padding:10px;width:100%;box-sizing:border-box;margin:5px 0}textarea{min-height:130px}button{background:#264d83;cursor:pointer;width:auto;padding:9px 14px}.grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}.status{color:#8ee6b6}@media(max-width:650px){.grid{grid-template-columns:1fr}body{padding:14px}}</style></head><body><h1>Apollo Bulletin</h1><div class="muted">Cloud task dispatch · one send per scheduled run · explicit owner review</div>
<section class="panel"><h2>New scheduled task</h2><form id="create"><input name="name" placeholder="Task name" required><textarea name="prompt" placeholder="Prompt to send to ChatGPT" required></textarea><input name="conversationUrl" placeholder="https://chatgpt.com/ (or conversation URL)"><div class="grid"><label>Schedule<select name="schedule"><option value="hourly">Hourly</option><option value="daily">Daily</option><option value="manual">Manual only</option></select></label><label>First run<input name="runAt" type="datetime-local"></label></div><button>Create task</button></form></section>
<section><h2>Tasks & history</h2><div id="tasks" class="muted">Loading…</div></section><section class="panel"><h2>Activity log</h2><pre id="log" style="white-space:pre-wrap;overflow-wrap:anywhere"></pre></section>
<script>
async function api(path,options){const r=await fetch(path,{headers:{'content-type':'application/json'},...options});const d=await r.json();if(!r.ok)throw Error(d.error||r.statusText);return d}
async function refresh(){const d=await api('/api/tasks');document.querySelector('#tasks').innerHTML=d.tasks.map(t=>'<article><b>'+esc(t.name)+'</b> · <span class="status">'+esc(t.status)+'</span><p>'+esc(t.schedule)+' · next: '+(t.nextRunAt?new Date(t.nextRunAt).toLocaleString():'manual')+'</p><p>'+esc(t.lastEvent||'No activity yet')+'</p><button onclick="act(\''+t.id+'\',\'run\')">Run once</button> <button onclick="act(\''+t.id+'\',\'pause\')">Pause</button> <button onclick="act(\''+t.id+'\',\'resume\')">Resume</button> <button onclick="act(\''+t.id+'\',\'complete\')">Mark complete</button><p><a href="'+esc(t.reviewUrl)+'">Open task review URL</a></p></article>').join('')||'No tasks yet';document.querySelector('#log').textContent=d.activity.map(x=>new Date(x.at).toLocaleString()+' — '+x.event+' '+(x.taskId||'')).join('\\n')}
function esc(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
async function act(id,action){try{await api('/api/tasks/'+id+'/'+action,{method:'POST',body:'{}'});await refresh()}catch(e){alert(e.message)}}
document.querySelector('#create').onsubmit=async e=>{e.preventDefault();const f=new FormData(e.target);try{await api('/api/tasks',{method:'POST',body:JSON.stringify(Object.fromEntries(f))});e.target.reset();await refresh()}catch(x){alert(x.message)}};
refresh();setInterval(refresh,10000);
</script></body></html>`;


const BULLETIN_WIDGET_TITLES = { tasks:"Task Queue", active:"Active Task", reviews:"Review Requests", activity:"Activity Log", scheduler:"Scheduler", history:"Task History" };
function bulletinWidgetHtml(kind) {
  const title=BULLETIN_WIDGET_TITLES[kind];
  const form=kind==="tasks" ? '<form id="create"><input name="name" placeholder="Task name" required><textarea name="prompt" placeholder="Prompt to send to ChatGPT" required></textarea><input name="conversationUrl" placeholder="https://chatgpt.com/"><div class="schedule"><select name="schedule"><option value="manual">Manual</option><option value="hourly">Hourly</option><option value="daily">Daily</option></select><input name="runAt" type="datetime-local"></div><button>Create task</button></form>' : "";
  const script=[
    '<script>',
    'const kind='+JSON.stringify(kind)+',api="/bulletin/api/tasks";',
    'const esc=v=>String(v??"").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll(String.fromCharCode(34),"&quot;").replaceAll(String.fromCharCode(39),"&#39;");',
    'async function request(path,options){const response=await fetch(path,{cache:"no-store",headers:{"content-type":"application/json"},...options});const data=await response.json();if(!response.ok)throw Error(data.error||response.statusText);return data;}',
    'function card(t){return "<article><b>"+esc(t.name)+"</b> · <span class=\\"status\\">"+esc(t.status)+"</span><p>"+esc(t.schedule)+" · next: "+(t.nextRunAt?esc(new Date(t.nextRunAt).toLocaleString()):"manual")+"</p><p>"+esc(t.lastEvent||"No activity yet")+"</p><div class=\\"actions\\"><button data-action=\\"run\\" data-id=\\""+esc(t.id)+"\\">Run once</button><button data-action=\\"pause\\" data-id=\\""+esc(t.id)+"\\">Pause</button><button data-action=\\"resume\\" data-id=\\""+esc(t.id)+"\\">Resume</button><button data-action=\\"complete\\" data-id=\\""+esc(t.id)+"\\">Complete</button></div>"+(t.reviewUrl?"<p><a target=\\"_blank\\" rel=\\"noopener\\" href=\\""+esc(t.reviewUrl)+"\\">Open review URL</a></p>":"")+"</article>";}',
    'async function refresh(){try{const data=await request(api),tasks=data.tasks||[],activity=data.activity||[];let selected=tasks;if(kind==="active")selected=tasks.filter(t=>["dispatching","dispatched","awaiting_review"].includes(t.status));if(kind==="reviews")selected=tasks.filter(t=>t.status==="awaiting_review");if(kind==="scheduler")selected=tasks.filter(t=>t.status==="scheduled").sort((a,b)=>(a.nextRunAt||0)-(b.nextRunAt||0));if(kind==="history")selected=tasks.filter(t=>["completed","dispatch-uncertain","failed"].includes(t.status)).sort((a,b)=>b.createdAt-a.createdAt);let html="";if(kind==="activity")html=activity.map(item=>"<article><b>"+esc(item.event)+"</b><p>"+esc(new Date(item.at).toLocaleString())+" · "+esc(item.taskId||"")+"</p></article>").join("");else html=selected.map(card).join("");document.querySelector("#content").innerHTML=html||"<div class=\\"empty\\">No items yet.</div>";document.querySelector("#updated").textContent="Updated "+new Date().toLocaleTimeString();}catch(error){document.querySelector("#content").textContent=error.message;}}',
    'document.querySelector("#content").addEventListener("click",async event=>{const button=event.target.closest("button[data-action]");if(!button)return;button.disabled=true;try{await request(api+"/"+encodeURIComponent(button.dataset.id)+"/"+button.dataset.action,{method:"POST",body:"{}"});await refresh();}catch(error){alert(error.message);button.disabled=false;}});',
    'const create=document.querySelector("#create");if(create)create.addEventListener("submit",async event=>{event.preventDefault();const data=Object.fromEntries(new FormData(create));try{await request(api,{method:"POST",body:JSON.stringify(data)});create.reset();await refresh();}catch(error){alert(error.message);}});refresh();setInterval(refresh,5000);',
    '</script>'
  ].join("");
  return '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'+title+'</title><style>*{box-sizing:border-box}html,body{margin:0;width:100%;height:100%;background:#0b1220;color:#edf3ff;font:13px system-ui}body{padding:12px;overflow:auto}header{display:flex;justify-content:space-between;align-items:center;gap:8px}h1{font-size:15px;margin:0 0 8px}small{color:#9eacc8}article,form{border:1px solid #293956;background:#111b30;border-radius:10px;padding:10px;margin:8px 0}article p{margin:5px 0;color:#aebbd2;overflow-wrap:anywhere}button,input,textarea,select{font:inherit;color:inherit;background:#0a1325;border:1px solid #405577;border-radius:7px;padding:7px;max-width:100%}button{cursor:pointer;background:#234879;margin:3px 4px 3px 0}input,textarea,select{width:100%;margin:4px 0}textarea{min-height:76px;resize:vertical}.schedule{display:grid;grid-template-columns:1fr 1fr;gap:8px}.status{color:#8ee6b6}.actions{display:flex;flex-wrap:wrap}.empty{padding:18px;border:1px dashed #405577;border-radius:10px;color:#9eacc8}a{color:#8bd}@media(max-width:420px){body{padding:8px}.schedule{grid-template-columns:1fr}}</style></head><body><header><h1>'+title+'</h1><small id="updated">Loading…</small></header>'+form+'<main id="content"><div class="empty">Loading Bulletin data…</div></main>'+script+'</body></html>';
}

export function createBulletinServer({ statePath = process.env.APOLLO_BULLETIN_STATE_PATH || "/tmp/apollo-bulletin/state.json", port = Number(process.env.APOLLO_BULLETIN_PORT || 3210), dispatch = async () => ({ submitted: false, reason: "browser-adapter-not-connected" }), now = () => Date.now() } = {}) {
  let state;
  let busy = false;
  async function save() {
    await mkdir(dirname(statePath), { recursive: true });
    const temp = join(dirname(statePath), ".bulletin-state.tmp");
    await writeFile(temp, JSON.stringify(state, null, 2), { mode: 0o600 });
    await rename(temp, statePath);
  }
  async function load() {
    try { state = JSON.parse(await readFile(statePath, "utf8")); }
    catch (e) { if (e.code !== "ENOENT") throw e; state = { tasks: [], activity: [] }; }
    state.tasks ||= []; state.activity ||= [];
  }
  function log(event, taskId) { state.activity.push({ at: now(), event, taskId }); state.activity = state.activity.slice(-300); }
  async function tick() {
    if (busy) return; busy = true;
    try {
      for (const task of state.tasks) {
        if (task.status !== "scheduled" || !task.nextRunAt || task.nextRunAt > now()) continue;
        // Claim and persist before touching the browser. An uncertain send is never retried.
        task.status = "dispatching"; task.lastDispatchAt = now(); task.nextRunAt = null; log("dispatch-intent-persisted", task.id); await save();
        try {
          const result = await dispatch(task);
          task.status = result?.submitted ? "dispatched" : "dispatch-uncertain";
          task.lastEvent = result?.reason || (result?.submitted ? "Prompt sent once" : "Send not confirmed; manual review required");
          log(task.status, task.id);
        } catch (e) { task.status = "dispatch-uncertain"; task.lastEvent = String(e.message || e); log("dispatch-error-no-retry", task.id); }
        await save();
      }
    } finally { busy = false; }
  }
  const server = createServer(async (req, res) => {
    const url = new URL(req.url || "/", "http://bulletin.local");
    const send = (status, value, type = "application/json; charset=utf-8") => { const body = type.startsWith("text/html") ? value : JSON.stringify(value); res.writeHead(status, { "content-type": type, "cache-control": "no-store" }); res.end(body); };
    const body = async () => { let raw=""; for await (const chunk of req) raw += chunk; return raw ? JSON.parse(raw) : {}; };
    try {
      if (req.method === "GET" && url.pathname === "/") return send(200, '<!doctype html><meta name="viewport" content="width=device-width"><title>Apollo Bulletin</title><body style="font:16px system-ui;background:#080d1c;color:#edf3ff;padding:28px"><h1>Apollo Bulletin</h1><p>Bulletin lives inside Workspace → Overlay Bay. Open Overlay Bay and choose Personal Bulletin to add the task components to your Personal overlay.</p><a style="color:#8bd" href="/?view=workspace">Open Apollo Workspace</a></body>', "text/html; charset=utf-8");
      const widgetRoute = req.method === "GET" && url.pathname.match(/^\/widgets\/(tasks|active|reviews|activity|scheduler|history)$/);
      if (widgetRoute) return send(200, bulletinWidgetHtml(widgetRoute[1]), "text/html; charset=utf-8");
      if (req.method === "GET" && url.pathname === "/api/tasks") return send(200, { tasks: state.tasks.map(t => ({ ...t, prompt: undefined })), activity: state.activity.slice(-100).reverse() });
      if (req.method === "POST" && url.pathname === "/api/tasks") {
        const input = await body(); if (!input.name?.trim() || !input.prompt?.trim()) return send(400, { error: "Task name and prompt are required" });
        const schedule = ["hourly","daily","manual"].includes(input.schedule) ? input.schedule : "manual";
        const runAt = input.runAt ? new Date(input.runAt).getTime() : now() + 60_000;
        const id = randomUUID(); const reviewKey = randomUUID(); const reviewUrl = (process.env.APOLLO_BULLETIN_PUBLIC_URL || "https://apollo-node-1.hostless.app") + "/bulletin/review/" + reviewKey;\n        const prompt = input.prompt.trim() + "\\n\\nAPOLLO BULLETIN HANDOFF: Keep the task documentation, TODO/checkpoint, and handoff current. Report completed work, remaining work, validation evidence, and blockers. Do not claim completion without updating the handoff. If owner review is needed, open this task review URL once and stop; do not continue or resend: " + reviewUrl;\n        const task = { id, name: input.name.trim(), prompt, conversationUrl: input.conversationUrl || "https://chatgpt.com/", schedule, status: schedule === "manual" ? "paused" : "scheduled", nextRunAt: schedule === "manual" ? null : (Number.isFinite(runAt) ? runAt : now()+60_000), createdAt: now(), reviewUrl, lastEvent: "Created" };
        task.reviewKey = reviewKey; state.tasks.push(task); log("task-created", task.id); await save(); return send(201, { task: { ...task, prompt: undefined } });
      }
      const action = url.pathname.match(/^\/api\/tasks\/([^/]+)\/(run|pause|resume|complete)$/);
      if (req.method === "POST" && action) {
        const task = state.tasks.find(t => t.id === action[1]); if (!task) return send(404, { error: "Task not found" });
        const verb = action[2];
        if (verb === "run") { if (["dispatching","dispatched","awaiting_review","completed"].includes(task.status)) return send(409,{error:"This task has already been dispatched or resolved; create a new task to send again"}); task.status="scheduled";task.nextRunAt=now(); }
        if (verb === "pause") { task.status="paused";task.nextRunAt=null; }
        if (verb === "resume") { if (task.status==="awaiting_review") return send(409,{error:"Review the task first"});task.status="scheduled";task.nextRunAt=now()+1000; }
        if (verb === "complete") { task.status="completed";task.nextRunAt=null; }
        task.lastEvent=verb;log("task-"+verb,task.id);await save();return send(200,{task:{...task,prompt:undefined}});
      }
      if (req.method === "GET" && url.pathname.startsWith("/review/")) {
        const key = url.pathname.slice("/review/".length); const task = state.tasks.find(t => t.reviewKey === key); if (!task) return send(404,"Review link not found","text/plain");
        if (task.status !== "awaiting_review") { task.status="awaiting_review";task.nextRunAt=null;task.lastEvent="AI requested owner review";log("awaiting-review",task.id);await save(); }
        return send(200, `<!doctype html><meta name="viewport" content="width=device-width"><title>Review requested</title><body style="font:16px system-ui;background:#0b1220;color:#eef;padding:28px"><h1>Owner review requested</h1><p>${task.name.replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]))}</p><p>This task is paused. Open Apollo Bulletin to inspect its handoff and logs, then explicitly resume or mark complete.</p><a style="color:#8bd" href="/">Return to Bulletin</a></body>`, "text/html; charset=utf-8");
      }
      if (req.method === "GET" && url.pathname === "/health/ready") return send(200,{ready:true,tasks:state.tasks.length});
      send(404,{error:"not_found"});
    } catch (error) { send(500,{error:error.message || String(error)}); }
  });
  return { server, async listen() { await load(); await new Promise((resolve,reject)=>{server.once("error",reject);server.listen(port,"127.0.0.1",()=>{server.off("error",reject);resolve();});}); const timer=setInterval(()=>void tick(),1000);timer.unref(); return server.address(); }, async close(){ if(server.listening) await new Promise((resolve,reject)=>server.close(e=>e?reject(e):resolve())); } };
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const app = createBulletinServer(); await app.listen(); console.log("Apollo Bulletin prototype listening on loopback.");
}
