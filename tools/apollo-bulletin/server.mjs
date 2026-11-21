import { createServer } from "node:http";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { createChatGPTBrowserAdapter, browserControlPage } from "./chatgpt-browser-adapter.mjs";

function workerHandoffText({ progressUrl, completeUrl, reviewUrl }) {
  return `APOLLO BULLETIN WORKER HANDOFF:
You own execution and progress tracking; the scheduler only wakes you and delivers this prompt. At the start, open this progress URL to read the latest handoff: ${progressUrl}
Maintain your own concise TODO list, completed steps, current progress, validation/evidence, next action, and blockers. After each meaningful work cycle, update the handoff by opening the progress URL with URL-encoded query parameters: ?summary=<current progress>&todo=<JSON array of remaining items>&completed=<JSON array of finished items>&next=<next action>&blocker=<current blocker or blank>. The app does not infer progress from your replies.
When the goal is genuinely complete and verified, open this completion URL: ${completeUrl}
If the same blocker repeats and you have no useful next action, open this review URL exactly once and stop; it pauses future wake-ups until the owner reviews it: ${reviewUrl}
Never claim completion without using the completion URL. Do not ask the owner to type continue; rely on the scheduled wake-up for unfinished work.`;
}

const BULLETIN_WIDGET_TITLES = { tasks:"Task Queue", active:"Active Task", reviews:"Review Requests", activity:"Activity Log", scheduler:"Scheduler", history:"Task History" };
function bulletinWidgetHtml(kind) {
  const title=BULLETIN_WIDGET_TITLES[kind];
  const form=kind==="tasks" ? '<p><a href="/bulletin/browser" target="_blank" rel="noopener">Open ChatGPT browser · sign in / choose conversation</a></p><form id="create"><input name="name" placeholder="Task name" required><textarea name="prompt" placeholder="Prompt to send to ChatGPT" required></textarea><input name="conversationUrl" placeholder="Optional: use the conversation open in the ChatGPT browser"><div class="schedule"><select name="schedule"><option value="manual">Manual</option><option value="hourly">Hourly</option><option value="daily">Daily</option></select><input name="runAt" type="datetime-local"></div><button>Create task</button></form>' : "";
  const script=[
    '<script>',
    'const kind='+JSON.stringify(kind)+',api="/bulletin/api/tasks";',
    'const esc=v=>String(v??"").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll(String.fromCharCode(34),"&quot;").replaceAll(String.fromCharCode(39),"&#39;");',
    'async function request(path,options){const response=await fetch(path,{cache:"no-store",headers:{"content-type":"application/json"},...options});const data=await response.json();if(!response.ok)throw Error(data.error||response.statusText);return data;}',
    'function card(t){return "<article><b>"+esc(t.name)+"</b> · <span class=\\"status\\">"+esc(t.status)+"</span><p>"+esc(t.schedule)+" · next: "+(t.nextRunAt?esc(new Date(t.nextRunAt).toLocaleString()):"manual")+"</p><p>"+esc(t.lastEvent||"No activity yet")+"</p>"+(t.handoff?.summary?"<p>Progress: "+esc(t.handoff.summary)+"</p>":"")+(t.handoff?.next?"<p>Next: "+esc(t.handoff.next)+"</p>":"")+(t.handoff?.blocker?"<p>Blocked: "+esc(t.handoff.blocker)+"</p>":"")+(Array.isArray(t.handoff?.completed)&&t.handoff.completed.length?"<p>Done: "+esc(t.handoff.completed.join(" · "))+"</p>":"")+(Array.isArray(t.handoff?.todo)&&t.handoff.todo.length?"<p>TODO: "+esc(t.handoff.todo.join(" · "))+"</p>":"")+"<div class=\\"actions\\"><button data-action=\\"run\\" data-id=\\""+esc(t.id)+"\\">Run once</button><button data-action=\\"pause\\" data-id=\\""+esc(t.id)+"\\">Pause</button><button data-action=\\"resume\\" data-id=\\""+esc(t.id)+"\\">Resume</button><button data-action=\\"complete\\" data-id=\\""+esc(t.id)+"\\">Complete</button></div>"+(t.reviewUrl?"<p><a target=\\"_blank\\" rel=\\"noopener\\" href=\\""+esc(t.reviewUrl)+"\\">Open review URL</a></p>":"")+"</article>";}',
    'async function refresh(){try{const data=await request(api),tasks=data.tasks||[],activity=data.activity||[];let selected=tasks;if(kind==="active")selected=tasks.filter(t=>["dispatching","dispatched","awaiting_review"].includes(t.status));if(kind==="reviews")selected=tasks.filter(t=>t.status==="awaiting_review");if(kind==="scheduler")selected=tasks.filter(t=>t.status==="scheduled").sort((a,b)=>(a.nextRunAt||0)-(b.nextRunAt||0));if(kind==="history")selected=tasks.filter(t=>["completed","dispatch-uncertain","failed"].includes(t.status)).sort((a,b)=>b.createdAt-a.createdAt);let html="";if(kind==="activity")html=activity.map(item=>"<article><b>"+esc(item.event)+"</b><p>"+esc(new Date(item.at).toLocaleString())+" · "+esc(item.taskId||"")+"</p></article>").join("");else html=selected.map(card).join("");document.querySelector("#content").innerHTML=html||"<div class=\\"empty\\">No items yet.</div>";document.querySelector("#updated").textContent="Updated "+new Date().toLocaleTimeString();}catch(error){document.querySelector("#content").textContent=error.message;}}',
    'document.querySelector("#content").addEventListener("click",async event=>{const button=event.target.closest("button[data-action]");if(!button)return;button.disabled=true;try{await request(api+"/"+encodeURIComponent(button.dataset.id)+"/"+button.dataset.action,{method:"POST",body:"{}"});await refresh();}catch(error){alert(error.message);button.disabled=false;}});',
    'const create=document.querySelector("#create");if(create)create.addEventListener("submit",async event=>{event.preventDefault();const data=Object.fromEntries(new FormData(create));try{await request(api,{method:"POST",body:JSON.stringify(data)});create.reset();await refresh();}catch(error){alert(error.message);}});refresh();setInterval(refresh,5000);',
    '</script>'
  ].join("");
  return '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'+title+'</title><style>*{box-sizing:border-box}html,body{margin:0;width:100%;height:100%;background:#0b1220;color:#edf3ff;font:13px system-ui}body{padding:12px;overflow:auto}header{display:flex;justify-content:space-between;align-items:center;gap:8px}h1{font-size:15px;margin:0 0 8px}small{color:#9eacc8}article,form{border:1px solid #293956;background:#111b30;border-radius:10px;padding:10px;margin:8px 0}article p{margin:5px 0;color:#aebbd2;overflow-wrap:anywhere}button,input,textarea,select{font:inherit;color:inherit;background:#0a1325;border:1px solid #405577;border-radius:7px;padding:7px;max-width:100%}button{cursor:pointer;background:#234879;margin:3px 4px 3px 0}input,textarea,select{width:100%;margin:4px 0}textarea{min-height:76px;resize:vertical}.schedule{display:grid;grid-template-columns:1fr 1fr;gap:8px}.status{color:#8ee6b6}.actions{display:flex;flex-wrap:wrap}.empty{padding:18px;border:1px dashed #405577;border-radius:10px;color:#9eacc8}a{color:#8bd}@media(max-width:420px){body{padding:8px}.schedule{grid-template-columns:1fr}}</style></head><body><header><h1>'+title+'</h1><small id="updated">Loading…</small></header>'+form+'<main id="content"><div class="empty">Loading Bulletin data…</div></main>'+script+'</body></html>';
}

export function createBulletinServer({ statePath = process.env.APOLLO_BULLETIN_STATE_PATH || "/tmp/apollo-bulletin/state.json", port = Number(process.env.APOLLO_BULLETIN_PORT || 3210), dispatch = null, browserAdapter = null, now = () => Date.now() } = {}) {
  const chatBrowser = browserAdapter || (dispatch ? null : createChatGPTBrowserAdapter());
  const deliverPrompt = dispatch || chatBrowser.dispatch;
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
    let migrated = false;
    const publicBase = process.env.APOLLO_BULLETIN_PUBLIC_URL || "https://apollo-node-1.hostless.app";
    for (const task of state.tasks) {
      const reviewKey = task.reviewKey || String(task.reviewUrl || "").split("/").filter(Boolean).pop() || randomUUID();
      if (task.reviewKey !== reviewKey) { task.reviewKey = reviewKey; migrated = true; }
      if (!task.reviewUrl) { task.reviewUrl = publicBase + "/bulletin/review/" + reviewKey; migrated = true; }
      if (!task.progressUrl) { task.progressUrl = publicBase + "/bulletin/progress/" + reviewKey; migrated = true; }
      if (!task.completeUrl) { task.completeUrl = publicBase + "/bulletin/complete/" + reviewKey; migrated = true; }
      if (!task.handoff) { task.handoff = { status: task.status === "completed" ? "completed" : "not_started", summary: "", todo: [], completed: [], next: "", blocker: "", updatedAt: null }; migrated = true; }
      if (task.conversationUrl === "https://chatgpt.com/" || task.conversationUrl === "https://chatgpt.com") { task.conversationUrl = null; migrated = true; }
      if (typeof task.prompt === "string" && !task.prompt.includes("APOLLO BULLETIN WORKER HANDOFF")) {
        task.prompt += "\n\n" + workerHandoffText({ progressUrl: task.progressUrl, completeUrl: task.completeUrl, reviewUrl: task.reviewUrl });
        migrated = true;
      }
    }
    if (migrated) { log("legacy-tasks-migrated-for-browser-handoff"); await save(); }
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
          const result = await deliverPrompt(task);
          task.status = result?.submitted ? "dispatched" : "dispatch-uncertain";
          if (result?.conversationUrl) task.conversationUrl = result.conversationUrl;
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
      if (req.method === "GET" && url.pathname === "/browser") return send(200, browserControlPage(), "text/html; charset=utf-8");
      if (req.method === "GET" && url.pathname === "/browser/status") return send(200, chatBrowser ? await chatBrowser.status() : { connected: false, error: "Browser adapter was injected by the test harness" });
      if (req.method === "GET" && url.pathname === "/browser/screenshot") {
        if (!chatBrowser) return send(503, { error: "Browser screenshot unavailable" });
        const screenshot = await chatBrowser.screenshot();
        res.writeHead(200, { "content-type": "image/png", "cache-control": "no-store", "x-content-type-options": "nosniff" });
        return res.end(screenshot);
      }
      if (req.method === "POST" && url.pathname === "/browser/input") {
        if (!chatBrowser) return send(503, { error: "Browser input unavailable" });
        return send(200, await chatBrowser.input(await body()));
      }
      if (req.method === "GET" && url.pathname === "/api/tasks") return send(200, { tasks: state.tasks.map(t => ({ ...t, prompt: undefined })), activity: state.activity.slice(-100).reverse() });
      if (req.method === "POST" && url.pathname === "/api/tasks") {
        const input = await body(); if (!input.name?.trim() || !input.prompt?.trim()) return send(400, { error: "Task name and prompt are required" });
        const schedule = ["hourly","daily","manual"].includes(input.schedule) ? input.schedule : "manual";
        const runAt = input.runAt ? new Date(input.runAt).getTime() : now() + 60_000;
        const id = randomUUID(); const reviewKey = randomUUID(); const publicBase = process.env.APOLLO_BULLETIN_PUBLIC_URL || "https://apollo-node-1.hostless.app";
        const reviewUrl = publicBase + "/bulletin/review/" + reviewKey;
        const progressUrl = publicBase + "/bulletin/progress/" + reviewKey;
        const completeUrl = publicBase + "/bulletin/complete/" + reviewKey;
        const prompt = input.prompt.trim() + "\n\nAPOLLO BULLETIN WORKER HANDOFF:\nYou own execution and progress tracking; the scheduler only wakes you and delivers this prompt. At the start, open this progress URL to read the latest handoff: " + progressUrl + "\nMaintain your own concise TODO list, completed steps, current progress, validation/evidence, next action, and blockers. After each meaningful work cycle, update the handoff by opening the progress URL with URL-encoded query parameters: ?summary=<current progress>&todo=<JSON array of remaining items>&completed=<JSON array of finished items>&next=<next action>&blocker=<current blocker or blank>. The app does not infer progress from your replies. When the goal is genuinely complete and verified, open this completion URL: " + completeUrl + "\nIf the same blocker repeats and you have no useful next action, open this review URL exactly once and stop; it pauses future wake-ups until the owner reviews it: " + reviewUrl + "\nNever claim completion without using the completion URL. Do not ask the owner to type continue; rely on the scheduled wake-up for unfinished work.";
        const task = { id, name: input.name.trim(), prompt, conversationUrl: input.conversationUrl?.trim() || null, schedule, status: schedule === "manual" ? "paused" : "scheduled", nextRunAt: schedule === "manual" ? null : (Number.isFinite(runAt) ? runAt : now()+60_000), createdAt: now(), reviewUrl, progressUrl, completeUrl, handoff: { status: "not_started", summary: "", todo: [], completed: [], next: "", blocker: "", updatedAt: null }, lastEvent: "Created" };
        task.reviewKey = reviewKey; state.tasks.push(task); log("task-created", task.id); await save(); return send(201, { task: { ...task, prompt: undefined } });
      }
      const action = url.pathname.match(/^\/api\/tasks\/([^/]+)\/(run|pause|resume|complete)$/);
      if (req.method === "POST" && action) {
        const task = state.tasks.find(t => t.id === action[1]); if (!task) return send(404, { error: "Task not found" });
        const verb = action[2];
        if (verb === "run") { if (["dispatching","dispatched","awaiting_review","completed"].includes(task.status)) return send(409,{error:"This task has already been dispatched or resolved; create a new task to send again"}); task.status="scheduled";task.nextRunAt=now(); }
        if (verb === "pause") { task.status="paused";task.nextRunAt=null; }
        if (verb === "resume") { if (task.status==="awaiting_review") return send(409,{error:"Review the task first"});task.status="scheduled";task.nextRunAt=now()+1000; }
        if (verb === "complete") { task.status="completed";task.nextRunAt=null;task.completedAt=now();task.handoff={...(task.handoff||{}),status:"completed",blocker:"",updatedAt:now()}; }
        task.lastEvent=verb;log("task-"+verb,task.id);await save();return send(200,{task:{...task,prompt:undefined}});
      }
      if (req.method === "GET" && url.pathname.startsWith("/progress/")) {
        const key = url.pathname.slice("/progress/".length); const task = state.tasks.find(t => t.reviewKey === key); if (!task) return send(404, { error: "Task not found" });
        const params = url.searchParams;
        const parseList = name => {
          const raw = params.get(name); if (raw === null) return undefined;
          if (raw.length > 6000) throw new Error(name + " handoff list is too large");
          const value = JSON.parse(raw);
          if (!Array.isArray(value) || value.length > 40 || value.some(item => typeof item !== "string" || item.length > 300)) throw new Error(name + " must be a JSON array of short strings");
          return value;
        };
        const hasUpdate = ["summary","todo","completed","next","blocker"].some(name => params.has(name));
        if (hasUpdate) {
          const handoff = { ...(task.handoff || {}), updatedAt: now() };
          if (params.has("summary")) handoff.summary = String(params.get("summary") || "").slice(0, 2000);
          if (params.has("todo")) handoff.todo = parseList("todo");
          if (params.has("completed")) handoff.completed = parseList("completed");
          if (params.has("next")) handoff.next = String(params.get("next") || "").slice(0, 500);
          if (params.has("blocker")) handoff.blocker = String(params.get("blocker") || "").slice(0, 1000);
          handoff.status = handoff.blocker ? "blocked" : "in_progress";
          task.handoff = handoff; task.lastEvent = "Progress updated"; log("handoff-updated", task.id); await save();
        }
        return send(200, { ok: true, task: { id: task.id, name: task.name, status: task.status, handoff: task.handoff } });
      }
      if (req.method === "GET" && url.pathname.startsWith("/complete/")) {
        const key = url.pathname.slice("/complete/".length); const task = state.tasks.find(t => t.reviewKey === key); if (!task) return send(404, { error: "Task not found" });
        task.status = "completed"; task.nextRunAt = null; task.completedAt = now();
        task.handoff = { ...(task.handoff || {}), status: "completed", blocker: "", updatedAt: now() };
        task.lastEvent = "Completed by worker"; log("task-completed-by-worker", task.id); await save();
        return send(200, { ok: true, task: { id: task.id, name: task.name, status: task.status, handoff: task.handoff } });
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
  return { server, async listen() { await load(); await new Promise((resolve,reject)=>{server.once("error",reject);server.listen(port,"127.0.0.1",()=>{server.off("error",reject);resolve();});}); const timer=setInterval(()=>void tick(),1000);timer.unref(); return server.address(); }, async close(){ if(server.listening) await new Promise((resolve,reject)=>server.close(e=>e?reject(e):resolve())); await chatBrowser?.close?.(); } };
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const app = createBulletinServer(); await app.listen(); console.log("Apollo Bulletin prototype listening on loopback.");
}
