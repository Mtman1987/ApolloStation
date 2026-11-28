import { createServer } from "node:http";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { normalizeSchedule, nextScheduledAt, scheduleLabel } from "./schedule.mjs";
import { simulatedAiReply } from "./test-simulator.mjs";
import { createApolloChatGptBrowserWorkerFromEnvironment, normalizeChatGptConversationUrl } from "./browser-worker.mjs";
import { createTursoBulletinStoreFromEnvironment } from "./turso-store.mjs";
import { readinessStatus } from "./readiness.mjs";
import { resolveBrowserControlPassword, resolveCronToken } from "./cron-auth.mjs";

const BULLETIN_WIDGET_TITLES = { tasks:"Task Queue", active:"Active Task", reviews:"Review Requests", activity:"Activity Log", scheduler:"Scheduler", history:"Task History" };
function bulletinWidgetHtml(kind) {
  const title=BULLETIN_WIDGET_TITLES[kind];
  const form=kind==="tasks" ? '<form id="create"><label>Task name<input name="name" placeholder="Task name" required></label><label>Task prompt<textarea name="prompt" placeholder="Prompt to send to ChatGPT" required></textarea></label><label>Exact ChatGPT conversation URL<input name="conversationUrl" placeholder="https://chatgpt.com/c/..." autocomplete="url"></label><label>Destination<select name="destination"><option value="chatgpt">ChatGPT (Apollo hosted browser)</option><option value="test-simulator">Test Simulator (safe, no external AI)</option></select></label><label>Schedule type<select name="scheduleType"><option value="manual">Manual</option><option value="once">Once at a date/time</option><option value="interval">Repeat every interval</option><option value="weekly">Selected weekdays</option><option value="monthly">Monthly date</option></select></label><label>Run once at (local wall-clock time)<input name="runAt" type="datetime-local"></label><label>Schedule timezone (IANA)<input name="timeZone" value="America/Chicago" placeholder="America/Chicago" autocomplete="off"></label><label>Maximum continuation cycles<input name="maxCycles" type="number" min="1" max="100" value="8"></label><div class="schedule"><label>Repeat every<input name="every" type="number" min="1" value="5" placeholder="Interval"></label><label>Interval unit<select name="unit"><option value="minutes" selected>Minutes</option><option value="hours">Hours</option><option value="days">Days</option></select></label></div><label>Weekly days<select name="weekdays" multiple><option value="0">Sunday</option><option value="1">Monday</option><option value="2">Tuesday</option><option value="3">Wednesday</option><option value="4">Thursday</option><option value="5">Friday</option><option value="6">Saturday</option></select></label><div class="schedule"><label>Weekly/monthly local time<input name="time" type="time" value="09:00"></label><label>Day of month<input name="day" type="number" min="1" max="31" value="1"></label></div><button>Create task</button></form>' : "";
  const script=[
    '<script>',
    'const kind='+JSON.stringify(kind)+',api="/bulletin/api/tasks";',
    'const esc=v=>String(v??"").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll(String.fromCharCode(34),"&quot;").replaceAll(String.fromCharCode(39),"&#39;");',
    'function nextRun(t){if(!t.nextRunAt)return "manual";const schedule=t.schedule&&typeof t.schedule==="object"?t.schedule:{};const zone=["once","weekly","monthly"].includes(schedule.type)?(schedule.timeZone||"America/Chicago"):undefined;try{return new Intl.DateTimeFormat(undefined,{year:"numeric",month:"short",day:"numeric",hour:"numeric",minute:"2-digit",...(zone?{timeZone:zone,timeZoneName:"short"}:{})}).format(new Date(t.nextRunAt));}catch{return new Date(t.nextRunAt).toLocaleString();}}',
    'async function request(path,options){const response=await fetch(path,{cache:"no-store",headers:{"content-type":"application/json"},...options});const data=await response.json();if(!response.ok)throw Error(data.error||response.statusText);return data;}',
    'function card(t){return "<article><b>"+esc(t.name)+"</b> · <span class=\\"status\\">"+esc(t.status)+"</span><p>"+esc(t.scheduleLabel||((typeof t.schedule==="string")?t.schedule:"Scheduled"))+" · next: "+(t.nextRunAt?esc(nextRun(t)):"manual")+"</p><p>"+esc(t.pendingControl ? (t.pendingControl + " requested; applying after the current cycle or next tick") : (t.lastEvent||"No activity yet"))+"</p><div class=\\"actions\\"><button data-action=\\"run\\" data-id=\\""+esc(t.id)+"\\">Run once</button><button data-action=\\"pause\\" data-id=\\""+esc(t.id)+"\\">Pause</button><button data-action=\\"resume\\" data-id=\\""+esc(t.id)+"\\">Resume</button><button data-action=\\"stop\\" data-id=\\""+esc(t.id)+"\\">Stop</button><button data-action=\\"complete\\" data-id=\\""+esc(t.id)+"\\">Complete</button></div>"+(t.reviewUrl?"<p><a target=\\"_blank\\" rel=\\"noopener\\" href=\\""+esc(t.reviewUrl)+"\\">Open review URL</a></p>":"")+"</article>";}',
    'async function refresh(){try{const data=await request(api),tasks=data.tasks||[],activity=data.activity||[];let selected=tasks;if(kind==="active")selected=tasks.filter(t=>["dispatching","dispatched","awaiting_review"].includes(t.status));if(kind==="reviews")selected=tasks.filter(t=>t.status==="awaiting_review");if(kind==="scheduler")selected=tasks.filter(t=>t.status==="scheduled").sort((a,b)=>(a.nextRunAt||0)-(b.nextRunAt||0));if(kind==="history")selected=tasks.filter(t=>["completed","dispatch-uncertain","failed","stopped"].includes(t.status)).sort((a,b)=>b.createdAt-a.createdAt);let html="";if(kind==="activity")html=activity.map(item=>"<article><b>"+esc(item.event)+"</b><p>"+esc(new Date(item.at).toLocaleString())+" · "+esc(item.taskId||"")+"</p></article>").join("");else html=selected.map(card).join("");document.querySelector("#content").innerHTML=html||"<div class=\\"empty\\">No items yet.</div>";document.querySelector("#updated").textContent="Updated "+new Date().toLocaleTimeString();}catch(error){document.querySelector("#content").textContent=error.message;}}',
    'document.querySelector("#content").addEventListener("click",async event=>{const button=event.target.closest("button[data-action]");if(!button)return;button.disabled=true;try{await request(api+"/"+encodeURIComponent(button.dataset.id)+"/"+button.dataset.action,{method:"POST",body:"{}"});await refresh();}catch(error){alert(error.message);button.disabled=false;}});',
    'const create=document.querySelector("#create");if(create)create.addEventListener("submit",async event=>{event.preventDefault();const formData=new FormData(create),data=Object.fromEntries(formData);data.weekdays=formData.getAll("weekdays");try{await request(api,{method:"POST",body:JSON.stringify(data)});create.reset();await refresh();}catch(error){alert(error.message);}});refresh();setInterval(refresh,5000);',
    '</script>'
  ].join("");
  return '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'+title+'</title><style>*{box-sizing:border-box}html,body{margin:0;width:100%;height:100%;background:#0b1220;color:#edf3ff;font:13px system-ui}body{padding:12px;overflow:auto}header{display:flex;justify-content:space-between;align-items:center;gap:8px}h1{font-size:15px;margin:0 0 8px}small{color:#9eacc8}article,form{border:1px solid #293956;background:#111b30;border-radius:10px;padding:10px;margin:8px 0}article p{margin:5px 0;color:#aebbd2;overflow-wrap:anywhere}button,input,textarea,select{font:inherit;min-height:40px;color:inherit;background:#0a1325;border:1px solid #405577;border-radius:7px;padding:7px;max-width:100%}button{cursor:pointer;background:#234879;margin:3px 4px 3px 0}input,textarea,select{width:100%;margin:4px 0}textarea{min-height:76px;resize:vertical}.schedule{display:grid;grid-template-columns:1fr 1fr;gap:8px}.status{color:#8ee6b6}.actions{display:flex;flex-wrap:wrap}.empty{padding:18px;border:1px dashed #405577;border-radius:10px;color:#9eacc8}a{color:#8bd}@media(max-width:420px){body{padding:8px}.schedule{grid-template-columns:1fr}}</style></head><body><header><h1>'+title+'</h1><small id="updated" aria-live="polite">Loading…</small></header>'+form+'<main id="content" aria-live="polite"><div class="empty">Loading Bulletin data…</div></main>'+script+'</body></html>';
}

export function createBulletinServer({ statePath = process.env.APOLLO_BULLETIN_STATE_PATH || "/tmp/apollo-bulletin/state.json", port = Number(process.env.APOLLO_BULLETIN_PORT || 3210), dispatch, store, now = () => Date.now() } = {}) {
  let state;
  let busy = false;
  let activeTick = false;
  let tickInProgress = false;
  let browserWorker;
  let timer;
  let saveTail = Promise.resolve();
  let stateReloading = false;
  let activeTickDone = Promise.resolve();
  let mutationTail = Promise.resolve();
  let resolveActiveTickDone = null;
  const persistence = store ?? createTursoBulletinStoreFromEnvironment();
  if (process.env.APOLLO_BULLETIN_REQUIRE_TURSO === "1" && !persistence) throw new Error("Apollo Bulletin requires TURSO_DATABASE_URL or SHARED_TURSO_DATABASE_URL and TURSO_AUTH_TOKEN or NODE1_TURSO_AUTH_TOKEN");
  async function deliver(task) {
    if (task.destination === "test-simulator") return { submitted: true, receipt: simulatedAiReply(task, (task.simulatedRunCount || 0) + 1), reason: "Task simulator receipt recorded" };
    if (!browserWorker) return { submitted: false, reason: "dedicated-chromium-browser-not-ready" };
    return browserWorker.sendTask(task);
  }
  function save() {
    const operation = saveTail.then(async () => {
      if (persistence) { await persistence.saveQueue(state); return; }
      await mkdir(dirname(statePath), { recursive: true });
      const temp = join(dirname(statePath), ".bulletin-state-" + randomUUID() + ".tmp");
      try { await writeFile(temp, JSON.stringify(state, null, 2), { mode: 0o600 }); await rename(temp, statePath); }
      finally { await unlink(temp).catch(() => {}); }
    });
    saveTail = operation.catch(() => {});
    return operation;
  }
  async function load({ recoverInterrupted = true } = {}) {
    if (persistence) state = await persistence.loadQueue() ?? { tasks: [], activity: [] };
    else {
      try { state = JSON.parse(await readFile(statePath, "utf8")); }
      catch (e) { if (e.code !== "ENOENT") throw e; state = { tasks: [], activity: [] }; }
    }
    state.tasks ||= []; state.activity ||= []; state.browserMessages ||= [];
    if (!state.cron || typeof state.cron !== "object" || Array.isArray(state.cron)) state.cron = {};
    state.cron.status ||= "never";
    state.cron.inFlight = Boolean(state.cron.inFlight);
    state.cron.completedTicks = Number.isFinite(Number(state.cron.completedTicks)) ? Number(state.cron.completedTicks) : 0;
    state.cron.failedTicks = Number.isFinite(Number(state.cron.failedTicks)) ? Number(state.cron.failedTicks) : 0;
    state.cron.lastTickStartedAt ??= null;
    state.cron.lastTickCompletedAt ??= null;
    state.cron.lastTickFailedAt ??= null;
    state.cron.lastTickProcessed ??= null;
    let recoveredCron = false;
    if (recoverInterrupted && state.cron.inFlight) {
      state.cron.inFlight = false;
      state.cron.status = "interrupted";
      state.cron.lastTickFailedAt = now();
      state.cron.failedTicks += 1;
      log("hostless-cron-tick-interrupted", null);
      recoveredCron = true;
    }
    let recovered = 0;
    if (recoverInterrupted) for (const task of state.tasks) {
      if (task.status !== "dispatching") continue;
      task.status = "dispatch-uncertain";
      task.nextRunAt = null;
      task.pauseRequested = false;
      task.stopRequested = false;
      task.lastEvent = "Process restarted during dispatch; delivery outcome is unknown. Manual review required; no automatic retry.";
      log("dispatch-interrupted-restart-no-retry", task.id, task.lastEvent);
      recovered += 1;
    }
    if (recovered || recoveredCron) await save();
  }
  async function loadForStartup() {
    const leaseRequired = typeof persistence?.acquireLease === "function" && typeof persistence?.releaseLease === "function";
    if (!leaseRequired) return load();
    const leaseOwnerId = randomUUID();
    const acquired = await persistence.acquireLease("apollo-bulletin-dispatch", leaseOwnerId, now(), 600_000);
    if (!acquired) return load({ recoverInterrupted: false });
    try {
      await load();
    } finally {
      try {
        const released = await persistence.releaseLease("apollo-bulletin-dispatch", leaseOwnerId, now());
        if (!released) console.warn("[apollo-bulletin] Startup recovery lease was not released by its owner");
      } catch (error) {
        console.warn("[apollo-bulletin] Startup recovery lease release failed:", String(error?.message || error));
      }
    }
  }
  function publicTask(task) { const { prompt, basePrompt, completionMarker, reviewKey, reviewRequested, ...visible } = task; return visible; }
  function continuationPromptFor(task) { return "Continue the existing task in this exact conversation. Read the prior work, current TODO/checkpoint, and handoff. Resume from the first unfinished step; do not repeat completed work. Keep the handoff current and validate changes. If genuinely complete, include this exact marker alone on its own line: " + task.completionMarker + ". If blocked or owner review is needed, explain the blocker and stop without claiming completion."; }
  function log(event, taskId, detail) { state.activity.push({ at: now(), event, taskId, ...(detail ? { detail } : {}) }); state.activity = state.activity.slice(-300); }
  async function withQueueMutation(mutator) {
    let releaseMutation;
    const previousMutation = mutationTail;
    mutationTail = new Promise(resolve => { releaseMutation = resolve; });
    await previousMutation;
    // A local poll can already own the in-process queue when the first UI request arrives.
    // Wait for that tick to finish, then reload the persisted queue under the normal mutation lock.
    while (busy && tickInProgress) {
      const pendingTick = activeTickDone;
      await pendingTick;
    }
    let ownsBusy = false;
    let leaseOwnerId = null;
    let leaseAcquired = false;
    const leaseRequired = typeof persistence?.acquireLease === "function" && typeof persistence?.releaseLease === "function";
    try {
      if (busy) return { busy: true };
      busy = true;
      ownsBusy = true;
      if (leaseRequired) {
        leaseOwnerId = randomUUID();
        leaseAcquired = await persistence.acquireLease("apollo-bulletin-dispatch", leaseOwnerId, now(), 600_000);
        if (!leaseAcquired) return { busy: true };
      }
      stateReloading = true;
      await saveTail;
      await load();
      const result = await mutator();
      await save();
      return { busy: false, result };
    } finally {
      stateReloading = false;
      if (leaseRequired && leaseAcquired && leaseOwnerId) {
        try {
          const released = await persistence.releaseLease("apollo-bulletin-dispatch", leaseOwnerId, now());
          if (!released) console.warn("[apollo-bulletin] Queue mutation lease was not released by its owner");
        } catch (releaseError) {
          console.error("[apollo-bulletin] Queue mutation lease release failed:", String(releaseError?.message || releaseError));
        }
      }
      if (ownsBusy) busy = false;
      releaseMutation?.();
    }
  }
  async function refreshPersistedStateForRead() {
    if (!persistence || busy || stateReloading) return true;
    try {
      const persisted = await persistence.loadQueue();
      // A local tick or mutation may have started while the read was in flight.
      // Never replace its newer in-memory state with the earlier snapshot.
      if (!busy && !stateReloading && persisted && typeof persisted === "object") state = persisted;
      return true;
    } catch (error) {
      console.warn("[apollo-bulletin] Persisted queue read failed:", String(error?.message || error));
      return false;
    }
  }
  async function recordStartupEvent(event, detail) {
    try {
      const mutation = await withQueueMutation(() => { log(event, null, detail); return true; });
      if (mutation.busy) console.warn("[apollo-bulletin] Startup event was not persisted because another dispatcher owns the queue");
    } catch (error) {
      console.error("[apollo-bulletin] Startup event persistence failed:", String(error?.message || error));
    }
  }
  async function tick(source = "local-poll") {
    if (busy) return { processed: 0, busy: true };
    busy = true;
    tickInProgress = true;
    activeTickDone = new Promise(resolve => { resolveActiveTickDone = resolve; });
    let processed = 0;
    let tickFailure;
    const leaseRequired = typeof persistence?.acquireLease === "function" && typeof persistence?.releaseLease === "function";
    let leaseAcquired = !leaseRequired;
    const leaseOwnerId = leaseRequired ? randomUUID() : null;
    let leaseHeartbeatTimer = null;
    let leaseHeartbeatInFlight = Promise.resolve();
    let leaseClosing = false;
    let leaseLost = false;
    try {
      if (leaseRequired) {
        leaseAcquired = await persistence.acquireLease("apollo-bulletin-dispatch", leaseOwnerId, now(), 600_000);
        if (!leaseAcquired) {
          log("dispatch-lease-busy", null, source);
          return { processed: 0, busy: true, leaseBusy: true };
        }
        leaseHeartbeatTimer = setInterval(() => {
          leaseHeartbeatInFlight = leaseHeartbeatInFlight.then(async () => {
            if (leaseClosing) return;
            const renewed = await persistence.acquireLease("apollo-bulletin-dispatch", leaseOwnerId, now(), 600_000);
            if (!renewed) {
              leaseLost = true;
              if (leaseHeartbeatTimer) clearInterval(leaseHeartbeatTimer);
              log("dispatch-lease-lost", null, source);
            }
          }).catch(error => console.warn("[apollo-bulletin] Dispatcher lease renewal failed:", String(error?.message || error)));
        }, 60_000);
        leaseHeartbeatTimer.unref?.();
      }
      activeTick = true;
      stateReloading = true;
      try {
        await saveTail;
        await load();
        if (typeof persistence?.loadTaskControls === "function") {
          const pendingControls = await persistence.loadTaskControls();
          let controlsChanged = false;
          for (const task of state.tasks) {
            const control = pendingControls[task.id];
            if (!control) continue;
            if (control.action === "pause" && !["dispatch-uncertain","dispatched","awaiting_review","completed","stopped"].includes(task.status)) {
              if (task.status === "dispatching") { task.pauseRequested = true; task.lastEvent = "Pause requested; current cycle will finish first"; }
              else { task.status = "paused"; task.nextRunAt = null; task.lastEvent = "pause"; }
            } else if (control.action === "stop" && !["dispatch-uncertain","dispatched","awaiting_review","completed"].includes(task.status)) {
              if (task.status === "dispatching") { task.stopRequested = true; task.lastEvent = "Stop requested; current cycle will finish first"; }
              else { task.status = "stopped"; task.nextRunAt = null; task.lastEvent = "stop"; }
            }
            await persistence.consumeTaskControl(task.id);
            log("task-control-applied", task.id, control.action);
            controlsChanged = true;
          }
          if (controlsChanged) await save();
        }
      } finally {
        stateReloading = false;
      }
      if (leaseLost) throw new Error("Dispatcher lease was lost before task dispatch");
      if (source === "hostless-cron") {
        state.cron.inFlight = true;
        state.cron.status = "running";
        state.cron.lastTickStartedAt = now();
        state.cron.lastTickProcessed = null;
        log("hostless-cron-tick-started", null);
        await save();
      }
      for (const task of state.tasks) {
        if (task.status !== "scheduled" || !task.nextRunAt || task.nextRunAt > now()) continue;
        // Claim and persist before touching the browser. An uncertain send is never retried.
        task.status = "dispatching"; task.lastDispatchAt = now(); task.nextRunAt = null; log("dispatch-intent-persisted", task.id);
        try { await save(); } catch (error) { task.status = "paused"; task.nextRunAt = null; task.lastEvent = "Dispatch was not attempted because the intent claim could not be persisted: " + String(error?.message || error).slice(0, 300); log("dispatch-claim-persistence-failed", task.id); try { await save(); } catch (retryError) { console.error("[apollo-bulletin] Could not persist paused task after claim failure:", String(retryError?.message || retryError)); } processed += 1; break; }
        try {
          log("browser-task-start", task.id, task.destination + " · " + (task.conversationUrl || "default target"));
          const result = await (dispatch ?? deliver)(task);
          if (typeof persistence?.consumeTaskControl === "function") {
            try {
              const control = await persistence.consumeTaskControl(task.id);
              if (control?.action === "pause") { task.pauseRequested = true; task.lastEvent = "Pause requested; current cycle will finish first"; log("task-control-applied", task.id, "pause"); }
              if (control?.action === "stop") { task.stopRequested = true; task.lastEvent = "Stop requested; current cycle will finish first"; log("task-control-applied", task.id, "stop"); }
            } catch (controlError) {
              console.warn("[apollo-bulletin] Could not consume task control:", String(controlError?.message || controlError));
            }
          }
          log("browser-task-result", task.id, result?.reason || (result?.submitted ? "reply received" : "no reply confirmed"));
          if (result?.submitted && (!result.receipt || typeof result.receipt.reply !== "string" || !result.receipt.reply.trim())) { task.status = "dispatch-uncertain"; task.nextRunAt = null; task.lastEvent = "Dispatch was reported submitted without a verified reply receipt; manual review required"; log("dispatch-receipt-missing-no-retry", task.id); } else {
          if (result?.submitted && result.receipt) { task.simulatedRunCount = result.receipt.runNumber; task.receiptHistory ||= []; task.receiptHistory.push(result.receipt); task.receiptHistory = task.receiptHistory.slice(-100); }
          if (result?.submitted && task.destination === "chatgpt") { task.cycles = (task.cycles || 0) + 1; const reply = String(result.receipt?.reply || ""); const complete = result.receipt?.completionMarkerObserved === true || reply.split(/\r?\n/).some(line => line.trim() === task.completionMarker); let persistedReviewRequest = false; if (typeof persistence?.consumeReviewRequest === "function") { try { persistedReviewRequest = Boolean(await persistence.consumeReviewRequest(task.id)); } catch (reviewError) { console.warn("[apollo-bulletin] Could not consume review-link signal:", String(reviewError?.message || reviewError)); } } const localReviewRequest = Boolean(task.reviewRequested); task.reviewRequested = false; const reviewRequested = persistedReviewRequest || localReviewRequest || reply.includes(task.reviewUrl) || /owner review required|blocked pending owner/i.test(reply); const continuationPrompt = continuationPromptFor(task); if (complete) { const occurrenceCycles = task.cycles; if (["interval","weekly","monthly"].includes(task.schedule?.type)) { const priorMarker = task.completionMarker, nextMarker = "APOLLO_BULLETIN_COMPLETE_" + randomUUID().replaceAll("-", "").slice(0, 16); task.completionMarker = nextMarker; task.basePrompt = String(task.basePrompt || task.prompt || "").replace(priorMarker, nextMarker); task.prompt = task.basePrompt; task.totalCycles = (task.totalCycles || 0) + occurrenceCycles; task.cycles = 0; task.nextRunAt = nextScheduledAt(task.schedule, now()); if (task.nextRunAt) { task.status = "scheduled"; task.lastEvent = "Occurrence completed after " + occurrenceCycles + " cycle(s); next recurrence scheduled"; log("recurrence-rearmed", task.id); } else { task.status = "completed"; task.lastEvent = "Occurrence completed; no next recurrence could be calculated"; log("task-completion-marker-observed", task.id); } } else { task.totalCycles = (task.totalCycles || 0) + task.cycles; task.status = "completed"; task.nextRunAt = null; task.lastEvent = "Completion marker observed after " + task.cycles + " cycle(s)"; log("task-completion-marker-observed", task.id); } } else if (task.stopRequested) { task.status = "stopped"; task.nextRunAt = null; task.lastEvent = "Stopped after the current cycle"; log("task-stopped", task.id); } else if (task.pauseRequested) { task.prompt = continuationPrompt; task.status = "paused"; task.nextRunAt = null; task.lastEvent = "Paused after the current cycle"; log("task-paused", task.id); } else if (reviewRequested || task.cycles >= task.maxCycles) { task.prompt = continuationPrompt; task.status = "awaiting_review"; task.nextRunAt = null; task.lastEvent = reviewRequested ? "ChatGPT requested owner review" : "Cycle limit reached without completion marker; owner review required"; log(reviewRequested ? "owner-review-requested" : "cycle-limit-owner-review", task.id); } else { task.prompt = continuationPrompt; task.status = "scheduled"; task.nextRunAt = now() + 60_000; task.lastEvent = "Cycle " + task.cycles + "/" + task.maxCycles + " returned without completion marker; continuation queued"; log("continuation-queued", task.id); } } else if (result?.submitted && task.stopRequested) { task.status = "stopped"; task.nextRunAt = null; task.lastEvent = "Stopped after the current cycle"; log("task-stopped", task.id); } else if (result?.submitted && task.pauseRequested) { task.status = "paused"; task.nextRunAt = null; task.lastEvent = "Paused after the current cycle"; log("task-paused", task.id); } else if (result?.submitted && ["interval","weekly","monthly"].includes(task.schedule?.type)) { task.status = "scheduled"; task.nextRunAt = nextScheduledAt(task.schedule, now()); task.lastEvent = result?.reason || "Simulator receipt recorded; next occurrence scheduled"; log("recurrence-rearmed", task.id); } else if (result?.submitted) { task.status = "dispatched"; task.lastEvent = result?.reason || "Simulator receipt recorded"; } else if (String(result?.reason || "").startsWith("browser-dispatch-blocked:") || result?.reason === "dedicated-chromium-browser-not-ready") { task.status = "paused"; task.nextRunAt = null; task.lastEvent = result?.reason || "Dispatch blocked before sending; owner can correct the issue and resume"; log("dispatch-blocked-before-send", task.id, task.lastEvent); } else { task.status = "dispatch-uncertain"; task.lastEvent = result?.reason || "Send not confirmed; manual review required"; log(task.status, task.id); }
        }
        } catch (e) { task.status = "dispatch-uncertain"; task.lastEvent = String(e.message || e); log("dispatch-error-no-retry", task.id); }
        await save();
        processed += 1;
        break; // One bounded task per Hostless cron tick.
      }
    } catch (error) {
      tickFailure = error;
      throw error;
    } finally {
      try {
        if (source === "hostless-cron" && (leaseAcquired || !leaseRequired)) {
          state.cron.inFlight = false;
          state.cron.lastTickProcessed = processed;
          const previousCron = {
            lastTickCompletedAt: state.cron.lastTickCompletedAt,
            completedTicks: state.cron.completedTicks,
            failedTicks: state.cron.failedTicks,
          };
          if (tickFailure) {
            state.cron.status = "failed";
            state.cron.lastTickFailedAt = now();
            state.cron.failedTicks += 1;
            log("hostless-cron-tick-failed", null, String(processed));
          } else {
            state.cron.status = "completed";
            state.cron.lastTickCompletedAt = now();
            state.cron.completedTicks += 1;
            log("hostless-cron-tick-completed", null, String(processed));
          }
          try { await save(); }
          catch (persistError) {
            state.cron.status = "failed";
            state.cron.inFlight = false;
            state.cron.lastTickCompletedAt = previousCron.lastTickCompletedAt ?? null;
            state.cron.completedTicks = previousCron.completedTicks;
            state.cron.lastTickFailedAt = now();
            state.cron.failedTicks = previousCron.failedTicks + 1;
            log("hostless-cron-tick-result-persistence-failed", null);
            console.error("[apollo-bulletin] Could not persist cron tick result:", String(persistError?.message || persistError));
            if (!tickFailure) throw persistError;
          }
        }
      } finally {
        leaseClosing = true;
        if (leaseHeartbeatTimer) clearInterval(leaseHeartbeatTimer);
        await leaseHeartbeatInFlight;
        if (leaseAcquired && leaseOwnerId) {
          try {
            const released = await persistence.releaseLease("apollo-bulletin-dispatch", leaseOwnerId, now());
            if (!released) console.warn("[apollo-bulletin] Dispatcher lease was not released by its owner");
          } catch (releaseError) {
            console.error("[apollo-bulletin] Dispatcher lease release failed:", String(releaseError?.message || releaseError));
          }
        }
        activeTick = false;
        tickInProgress = false;
        busy = false;
        resolveActiveTickDone?.();
        resolveActiveTickDone = null;
      }
    }
    return { processed, busy: false };
  }
  const server = createServer(async (req, res) => {
    const url = new URL(req.url || "/", "http://bulletin.local");
    const send = (status, value, type = "application/json; charset=utf-8") => { const body = type.startsWith("text/") ? value : JSON.stringify(value); res.writeHead(status, { "content-type": type, "cache-control": "no-store" }); res.end(body); };
    const browserControlRoute = url.pathname === "/browser" || url.pathname.startsWith("/api/browser/");
    if (browserControlRoute) {
      const password = resolveBrowserControlPassword(process.env);
      if (!password) { res.writeHead(503, { "cache-control": "no-store" }); res.end("Browser control is locked: configure APOLLO_BROWSER_CONTROL_PASSWORD or APOLLO_PREVIEW_PASSWORD."); return; }
      const authorization = req.headers.authorization || "";
      const supplied = authorization.startsWith("Basic ") ? Buffer.from(authorization.slice(6), "base64") : Buffer.alloc(0);
      const expected = Buffer.from("owner:" + password);
      if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
        res.writeHead(401, { "www-authenticate": 'Basic realm="Apollo dedicated browser", charset="UTF-8"', "cache-control": "no-store" });
        res.end("Owner authentication required.");
        return;
      }
    }
    const body = async () => { let raw="", size=0; for await (const chunk of req) { size += Buffer.byteLength(chunk); if (size > 32*1024) throw Object.assign(new Error("Request body exceeds 32 KB"), { statusCode: 413 }); raw += chunk; } if (!raw) return {}; try { return JSON.parse(raw); } catch { throw Object.assign(new Error("Request body must be valid JSON"), { statusCode: 400 }); } };
    try {
      if (req.method === "POST" && url.pathname === "/api/cron/tick") {
        const expected = resolveCronToken(process.env);
        if (!expected) return send(503, { error: "Bulletin cron authentication is not configured" });
        const authorization = req.headers.authorization || "";
        const supplied = Buffer.from(authorization.startsWith("Bearer ") ? authorization.slice(7) : "");
        const expectedBytes = Buffer.from(expected);
        if (supplied.length !== expectedBytes.length || !timingSafeEqual(supplied, expectedBytes)) return send(401, { error: "Cron authentication required" });
        if (busy) return send(202, { accepted: false, busy: true });
        void tick("hostless-cron").catch(error => console.error("[apollo-bulletin] Hostless cron tick failed:", String(error?.message || error)));
        return send(202, { accepted: true });
      }
      if (req.method === "GET" && url.pathname === "/") return send(200, '<!doctype html><meta name="viewport" content="width=device-width"><title>Apollo Bulletin</title><body style="font:16px system-ui;background:#080d1c;color:#edf3ff;padding:28px"><h1>Apollo Bulletin</h1><p>Bulletin lives inside Workspace → Overlay Bay. Open Overlay Bay and choose Personal Bulletin to add the task components to your Personal overlay.</p><a style="color:#8bd" href="/?view=workspace">Open Apollo Workspace</a></body>', "text/html; charset=utf-8");
      const widgetRoute = req.method === "GET" && url.pathname.match(/^\/widgets\/(tasks|active|reviews|activity|scheduler|history)$/);
      if (req.method === "GET" && url.pathname === "/widgets/proof") return send(200, `<!doctype html><meta name=\"viewport\" content=\"width=device-width\"><title>Apollo Scheduler Proof</title><body style=\"font:15px system-ui;background:#0b1220;color:#edf3ff;padding:18px;max-width:760px;margin:auto\"><h1>Scheduler delivery proof</h1><p>Isolated simulated receiver. This does not log into ChatGPT, send to a real AI, or launch a GitHub workflow.</p><label>Task name<input id=\"name\" value=\"5-minute scheduler proof\" style=\"display:block;width:100%;padding:8px;margin:8px 0\"></label><label>Prompt<textarea id=\"prompt\" style=\"display:block;width:100%;min-height:100px;padding:8px;margin:8px 0\">APOLLO SCHEDULE TEST: Respond with a receipt and summarize this prompt.</textarea></label><label>Repeat every <input id=\"every\" type=\"number\" min=\"1\" value=\"5\" style=\"width:90px;padding:8px\"> minutes</label><button id=\"create\" style=\"padding:10px;margin:12px 0\">Create scheduled test</button><p id=\"status\"></p><pre id=\"history\" style=\"white-space:pre-wrap;background:#111b30;padding:12px;border-radius:8px\"></pre><script>const status=document.querySelector(\"#status\"),history=document.querySelector(\"#history\");async function refresh(){const r=await fetch(\"/bulletin/api/tasks\",{cache:\"no-store\"}),d=await r.json();const t=d.tasks.filter(x=>x.destination===\"test-simulator\");history.textContent=t.map(x=>x.name+" — "+x.status+"\\nSchedule: "+(x.scheduleLabel||"")+"; next: "+(x.nextRunAt?new Date(x.nextRunAt).toLocaleString():"—")+"\\nLast result: "+(x.lastEvent||"—")+"\\nReceipts:\\n"+(x.receiptHistory||[]).map(q=>"Run #"+q.runNumber+" · "+new Date(q.receivedAt).toLocaleString()+"\\n"+q.reply).join("\\n\\n")).join("\\n\\n")||"No simulator tasks yet."; }document.querySelector(\"#create\").onclick=async()=>{const r=await fetch(\"/bulletin/api/tasks\",{method:\"POST\",headers:{\"content-type\":\"application/json\"},body:JSON.stringify({name:document.querySelector(\"#name\").value,prompt:document.querySelector(\"#prompt\").value,scheduleType:\"interval\",every:document.querySelector(\"#every\").value,unit:\"minutes\",destination:\"test-simulator\"})});const d=await r.json();status.textContent=r.ok?\"Scheduled. It will deliver automatically; pause or complete it from Task Queue.\":(d.error||\"Failed\");refresh();};refresh();setInterval(refresh,3000);</script></body>`, "text/html; charset=utf-8");
      if (widgetRoute) return send(200, bulletinWidgetHtml(widgetRoute[1]), "text/html; charset=utf-8");
      if (req.method === "GET" && url.pathname === "/api/tasks") { if (stateReloading) return send(503, { error: "Bulletin state is refreshing; retry shortly" }); if (!(await refreshPersistedStateForRead())) return send(503, { error: "Bulletin task state is temporarily unavailable" }); if (stateReloading) return send(503, { error: "Bulletin state is refreshing; retry shortly" }); let pendingControls = {}; if (typeof persistence?.loadTaskControls === "function") { try { pendingControls = await persistence.loadTaskControls(); } catch { return send(503, { error: "Bulletin task controls are temporarily unavailable" }); } } return send(200, { tasks: state.tasks.map(task => publicTask({ ...task, pendingControl: pendingControls[task.id]?.action || null })), activity: state.activity.slice(-100).reverse() }); }
      if (req.method === "POST" && url.pathname === "/api/tasks") {
        const input = await body(); if (typeof input.name !== "string" || !input.name.trim() || input.name.length > 200 || typeof input.prompt !== "string" || !input.prompt.trim()) return send(400, { error: "Task name (1–200 characters) and prompt are required" }); if (input.prompt.length > 20000) return send(400, { error: "Task prompt must be 20,000 characters or fewer" });
        const destination = input.destination === undefined ? "chatgpt" : input.destination; if (!["chatgpt","test-simulator"].includes(destination)) return send(400, { error: "Destination must be chatgpt or test-simulator" });
        let conversationUrl = input.conversationUrl || "";
        if (destination === "chatgpt") { try { conversationUrl = normalizeChatGptConversationUrl(conversationUrl); } catch (error) { return send(400, { error: error.message }); } }
        let schedule; try { schedule = normalizeSchedule({ type: input.scheduleType || input.schedule || "manual", runAt: input.runAt, every: input.every, unit: input.unit, weekdays: input.weekdays, time: input.time, timeZone: input.timeZone, day: input.day }, now()); } catch (error) { return send(400, { error: error.message }); }
        if (process.env.APOLLO_BULLETIN_USE_HOSTLESS_CRON === "1" && schedule.type === "interval" && schedule.unit === "seconds") return send(400, { error: "Hostless cron runs once per minute; use a minimum interval of one minute." });
        const runAt = nextScheduledAt(schedule, now());
        const id = randomUUID(); const reviewKey = randomUUID(); const reviewUrl = (process.env.APOLLO_BULLETIN_PUBLIC_URL || "https://apollo-node-1.hostless.app") + "/bulletin/review/" + reviewKey;
        const maxCycles = Number(input.maxCycles ?? 8); if (!Number.isInteger(maxCycles) || maxCycles < 1 || maxCycles > 100) return send(400, { error: "Max cycles must be a whole number from 1 to 100" });
        const completionMarker = "APOLLO_BULLETIN_COMPLETE_" + randomUUID().replaceAll("-", "").slice(0, 16);
        const basePrompt = input.prompt.trim() + "\n\nAPOLLO BULLETIN HANDOFF: Keep the task documentation, TODO/checkpoint, and handoff current. Report completed work, remaining work, validation evidence, and blockers. Do not claim completion without updating the handoff. If owner review is needed, open this task review URL once and stop; do not continue or resend: " + reviewUrl + "\n\nWhen (and only when) the requested work is genuinely complete, include this exact marker alone on its own line: " + completionMarker;
        const publicOrigin = process.env.APOLLO_BULLETIN_PUBLIC_URL || "https://apollo-node-1.hostless.app"; const task = { id, name: input.name.trim(), basePrompt, completionMarker, maxCycles, cycles: 0, prompt: basePrompt, conversationUrl: destination === "test-simulator" ? publicOrigin + "/bulletin/fake-chatgpt" : conversationUrl, schedule, scheduleLabel: scheduleLabel(schedule), destination, status: schedule.type === "manual" ? "paused" : "scheduled", nextRunAt: runAt, createdAt: now(), reviewUrl, lastEvent: "Created" };
        task.reviewKey = reviewKey; const mutation = await withQueueMutation(() => { state.tasks.push(task); log("task-created", task.id); return { status: 201, body: { task: publicTask(task) } }; }); if (mutation.busy) return send(503, { error: "Bulletin queue is busy; retry shortly" }); return send(mutation.result.status, mutation.result.body);
      }
      const action = url.pathname.match(/^\/api\/tasks\/([^/]+)\/(run|pause|resume|complete|stop)$/);
      if (req.method === "POST" && action) {
        const verb = action[2];
        if ((verb === "pause" || verb === "stop") && typeof persistence?.requestTaskControl === "function") {
          let queue = state;
          try { queue = await persistence.loadQueue() ?? state; }
          catch (error) { console.error("[apollo-bulletin] Could not read task state for control request:", String(error?.message || error)); return send(503, { error: "Bulletin task state is temporarily unavailable" }); }
          const task = queue.tasks?.find(t => t.id === action[1]);
          if (!task) return send(404, { error: "Task not found" });
          if (verb === "pause" && ["dispatch-uncertain","dispatched","awaiting_review","completed","stopped"].includes(task.status)) return send(409, { error: "This task has an unresolved send or is already resolved; inspect it before changing its state." });
          if (verb === "stop" && ["dispatch-uncertain","dispatched","awaiting_review","completed"].includes(task.status)) return send(409, { error: "This task has an unresolved send or is already resolved; use manual completion only after inspection." });
          try { await persistence.requestTaskControl(task.id, verb, now()); }
          catch (error) { console.error("[apollo-bulletin] Could not persist task control:", String(error?.message || error)); return send(503, { error: "Task control could not be persisted; retry shortly" }); }
          const lastEvent = task.status === "dispatching" ? (verb === "pause" ? "Pause requested; current cycle will finish first" : "Stop requested; current cycle will finish first") : (verb + " requested; waiting for the next tick");
          return send(202, { task: publicTask({ ...task, pendingControl: verb, lastEvent }), controlRequested: verb });
        }
        if (busy && activeTick && !stateReloading && (verb === "pause" || verb === "stop")) {
          const task = state.tasks.find(t => t.id === action[1]);
          if (!task) return send(404, { error: "Task not found" });
          if (verb === "pause") {
            if (["dispatch-uncertain","dispatched","awaiting_review","completed","stopped"].includes(task.status)) return send(409, { error: "This task has an unresolved send or is already resolved; inspect it before changing its state." });
            if (task.status === "dispatching") { task.pauseRequested = true; task.lastEvent = "Pause requested; current cycle will finish first"; }
            else { task.status = "paused"; task.nextRunAt = null; }
          } else {
            if (["dispatch-uncertain","dispatched","awaiting_review","completed"].includes(task.status)) return send(409, { error: "This task has an unresolved send or is already resolved; use manual completion only after inspection." });
            if (task.status === "dispatching") { task.stopRequested = true; task.lastEvent = "Stop requested; current cycle will finish first"; }
            else { task.status = "stopped"; task.nextRunAt = null; }
          }
          log("task-" + verb, task.id);
          await save();
          return send(200, { task: publicTask(task) });
        }
        const mutation = await withQueueMutation(async () => {
          const task = state.tasks.find(t => t.id === action[1]);
          if (!task) return { status: 404, body: { error: "Task not found" } };
          const resumedFromReview = verb === "resume" && task.status === "awaiting_review";
          if (verb === "run") { if (["dispatching","dispatched","awaiting_review","completed","dispatch-uncertain","stopped"].includes(task.status)) return { status: 409, body: { error: "This task has already been dispatched or is uncertain; do not resend automatically. Resolve it manually or create a new task." } }; if (typeof persistence?.consumeTaskControl === "function") await persistence.consumeTaskControl(task.id); task.pauseRequested = false; task.status = "scheduled"; task.nextRunAt = now(); }
          if (verb === "pause") { if (["dispatch-uncertain","dispatched","awaiting_review","completed","stopped"].includes(task.status)) return { status: 409, body: { error: "This task has an unresolved send or is already resolved; inspect it before changing its state." } }; if (task.status === "dispatching") { task.pauseRequested = true; task.lastEvent = "Pause requested; current cycle will finish first"; } else { task.status = "paused"; task.nextRunAt = null; } }
          if (verb === "resume") { if (["dispatching","dispatch-uncertain","dispatched","completed","stopped"].includes(task.status)) return { status: 409, body: { error: "This task has an unresolved send or is already resolved; inspect it before resuming." } }; if (typeof persistence?.consumeTaskControl === "function") await persistence.consumeTaskControl(task.id); if (resumedFromReview) { if (!String(task.prompt || "").startsWith("Continue the existing task in this exact conversation.")) task.prompt = continuationPromptFor(task); task.totalCycles = (task.totalCycles || 0) + (task.cycles || 0); task.cycles = 0; } task.pauseRequested = false; task.status = "scheduled"; task.nextRunAt = now(); }
          if (verb === "complete") { if (task.status === "dispatching") return { status: 409, body: { error: "The current cycle is still running; review its result before marking complete." } }; if (typeof persistence?.consumeTaskControl === "function") await persistence.consumeTaskControl(task.id); task.status = "completed"; task.nextRunAt = null; }
          if (verb === "stop") { if (["dispatch-uncertain","dispatched","awaiting_review","completed"].includes(task.status)) return { status: 409, body: { error: "This task has an unresolved send or is already resolved; use manual completion only after inspection." } }; if (task.status === "dispatching") { task.stopRequested = true; task.lastEvent = "Stop requested; current cycle will finish first"; } else { task.status = "stopped"; task.nextRunAt = null; } }
          if (!["pause","stop"].includes(verb) || task.status !== "dispatching") task.lastEvent = resumedFromReview ? "Resumed after owner review" : verb;
          log("task-" + verb, task.id);
          return { status: 200, body: { task: publicTask(task) }, runNow: verb === "run" || verb === "resume" };
        });
        if (mutation.busy) return send(503, { error: "Bulletin queue is busy; retry shortly" });
        if (mutation.result.runNow) void tick();
        return send(mutation.result.status, mutation.result.body);
      }
      if (req.method === "GET" && url.pathname.startsWith("/review/")) {
        const key = url.pathname.slice("/review/".length);
        let reviewQueue = state;
        if (persistence) {
          try { reviewQueue = await persistence.loadQueue() ?? state; }
          catch (error) { console.error("[apollo-bulletin] Review link queue read failed:", String(error?.message || error)); return send(503, { error: "Review state is temporarily unavailable" }); }
        }
        const task = reviewQueue.tasks?.find(t => t.reviewKey === key);
        if (!task) return send(404, "Review link not found", "text/plain; charset=utf-8");
        if (!["awaiting_review","completed","stopped","dispatch-uncertain","dispatched"].includes(task.status)) {
          if (typeof persistence?.requestReview === "function") {
            try { await persistence.requestReview(task.id, now()); }
            catch (error) { console.error("[apollo-bulletin] Review-link signal could not be persisted:", String(error?.message || error)); return send(503, { error: "Review request could not be recorded; inspect the task in Apollo Bulletin" }); }
          } else if (!persistence) {
            const localTask = state.tasks.find(t => t.id === task.id);
            if (localTask) { localTask.reviewRequested = true; await save(); }
          } else {
            return send(503, { error: "Review signal storage is unavailable" });
          }
        }
        const safeName = String(task.name || "Apollo task").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
        const html = `<!doctype html><meta name="viewport" content="width=device-width"><title>Review requested</title><body style="font:16px system-ui;background:#0b1220;color:#eef;padding:28px"><h1>Owner review requested</h1><p>${safeName}</p><p>The task will pause after its current cycle. Open Apollo Bulletin to inspect the handoff and logs, then explicitly resume or mark complete.</p><a style="color:#8bd" href="/bulletin/">Return to Bulletin</a></body>`;
        return send(200, html, "text/html; charset=utf-8");
      }
      if (req.method === "GET" && url.pathname === "/fake-chatgpt") return send(200, "<!doctype html><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>ChatGPT · Apollo Simulation</title><body style=\"margin:0;background:#212121;color:#eee;font:16px system-ui\"><header style=\"padding:15px;border-bottom:1px solid #555\">ChatGPT · APOLLO SIMULATION</header><main id=\"messages\" style=\"max-width:760px;margin:auto;padding:24px 16px 100px\"><div data-message-author-role=\"assistant\" style=\"background:#303030;padding:14px;border-radius:12px\">Hello! This is the simulated ChatGPT page. Apollo uses a real Chromium browser to interact with this page; only the AI reply is simulated.</div></main><form id=\"form\" style=\"position:fixed;bottom:0;left:0;right:0;padding:12px;background:#222;display:flex;gap:8px\"><textarea id=\"prompt-textarea\" placeholder=\"Message ChatGPT\" style=\"flex:1;min-height:48px;background:#333;color:white;border:0;padding:10px\"></textarea><button aria-label=\"Send message\">Send</button></form><script>const f=document.querySelector(\"#form\"),p=document.querySelector(\"#prompt-textarea\"),m=document.querySelector(\"#messages\");f.onsubmit=e=>{e.preventDefault();const v=p.value.trim();if(!v)return;const u=document.createElement(\"div\");u.dataset.messageAuthorRole=\"user\";u.textContent=v;u.style.cssText=\"background:#444;padding:14px;margin:12px 0;border-radius:12px\";m.append(u);p.value=\"\";setTimeout(()=>{const a=document.createElement(\"div\");a.dataset.messageAuthorRole=\"assistant\";a.textContent=\"SIMULATED CHATGPT REPLY: I received your prompt through Apollo Chromium: \"+v;a.style.cssText=\"background:#303030;padding:14px;margin:12px 0;border-radius:12px\";m.append(a)},300)};</script>", "text/html; charset=utf-8");
      if (req.method === "GET" && url.pathname === "/browser") return send(200, `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>Apollo dedicated ChatGPT browser</title><style>body{margin:0;padding:12px;background:#09111f;color:#edf3ff;font:14px system-ui}input,button,textarea{font:inherit;padding:10px;border-radius:8px;border:1px solid #405577;background:#101c31;color:#fff}button{background:#234879}input{width:100%;box-sizing:border-box}#screen{width:100%;max-height:72vh;object-fit:contain;background:#111;touch-action:none;border:1px solid #405577;border-radius:8px}#screen:focus-visible{outline:3px solid #8bd;outline-offset:3px}form{display:flex;gap:8px;margin:8px 0}form input{flex:1;min-width:0}#status{color:#9fd7b4}small{color:#9eacc8}</style><h2>Dedicated ChatGPT browser</h2><p>Sign in to ChatGPT in this isolated Apollo browser. Its session is separate from Lounge and other apps.</p><p id="status" aria-live="polite">Connecting…</p><form id="nav"><input id="url" value="https://chatgpt.com/" aria-label="Browser URL"><button>Go</button></form><img id="screen" alt="Live browser screen; focus and press Enter or Space to click the center" role="button" tabindex="0"><form id="type"><input id="text" placeholder="Type into the focused browser field" aria-label="Text to type into the focused browser field" autocomplete="off"><button>Type</button><button type="button" id="enter">Enter</button></form><small>Tap the browser image to click at that position. Or focus it and press Enter or Space to click the center. Use the text field to type into the focused page.</small><pre id="log"></pre><script>const screen=document.querySelector("#screen"),status=document.querySelector("#status");async function api(path,data){const r=await fetch("/bulletin/api/browser/"+path,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(data||{})});const d=await r.json();if(!r.ok)throw Error(d.error||r.statusText);return d}async function refresh(){try{const s=await fetch("/bulletin/api/browser/status",{cache:"no-store"}).then(r=>r.json());status.textContent="Browser: "+(s.healthy?"READY":"NOT READY")+" · "+(s.loginRequired?"Sign in required":(s.healthy?"Session available":"No active session"))+" · "+(s.title||s.reason||s.url||"");screen.src="/bulletin/api/browser/screenshot?t="+Date.now();}catch(e){status.textContent=e.message}}document.querySelector("#nav").onsubmit=async e=>{e.preventDefault();try{await api("navigate",{url:document.querySelector("#url").value});await refresh()}catch(x){status.textContent=x.message}};screen.onclick=async e=>{const r=screen.getBoundingClientRect();try{await api("click",{x:(e.clientX-r.left)/r.width*1440,y:(e.clientY-r.top)/r.height*1000});await refresh()}catch(x){status.textContent=x.message}};screen.addEventListener("keydown",async e=>{if(e.key!=="Enter"&&e.key!==" ")return;e.preventDefault();try{await api("click",{x:720,y:500});await refresh()}catch(x){status.textContent=x.message}});document.querySelector("#type").onsubmit=async e=>{e.preventDefault();const t=document.querySelector("#text");try{await api("type",{text:t.value});t.value="";await refresh()}catch(x){status.textContent=x.message}};document.querySelector("#enter").onclick=async()=>{try{await api("press",{key:"Enter"});await refresh()}catch(x){status.textContent=x.message}};refresh();setInterval(refresh,1800);</script>`, "text/html; charset=utf-8");
      if (req.method === "POST" && url.pathname === "/api/browser/navigate") { if (!browserWorker) return send(503,{error:"browser-not-started"}); const input=await body(); if(typeof input.url!=="string") return send(400,{error:"url is required"}); return send(200,await browserWorker.navigate(input.url)); }
      if (req.method === "POST" && url.pathname === "/api/browser/click") { if (!browserWorker) return send(503,{error:"browser-not-started"}); const input=await body(); return send(200,await browserWorker.click(Number(input.x),Number(input.y))); }
      if (req.method === "POST" && url.pathname === "/api/browser/type") { if (!browserWorker) return send(503,{error:"browser-not-started"}); const input=await body(); if(typeof input.text!=="string") return send(400,{error:"text is required"}); return send(200,await browserWorker.type(input.text)); }
      if (req.method === "POST" && url.pathname === "/api/browser/press") { if (!browserWorker) return send(503,{error:"browser-not-started"}); const input=await body(); return send(200,await browserWorker.press(input.key)); }
      if (req.method === "GET" && url.pathname === "/api/browser/status") return browserWorker ? send(200,{...(await browserWorker.status()),mode:"chromium",externalService:false}) : send(503,{connected:false,mode:"chromium",reason:"browser-not-started"});
      if (req.method === "GET" && url.pathname === "/api/browser/screenshot") { if (!browserWorker) return send(503,{error:"browser-not-started"}); const shot=await browserWorker.screenshot(); res.writeHead(200,{"content-type":"image/png","cache-control":"no-store"}); res.end(shot); return; }
      if (req.method === "GET" && url.pathname === "/api/browser/view") return send(200, '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;background:#212121;color:#eee;font:15px system-ui}.top{padding:13px;border-bottom:1px solid #444}.wrap{max-width:720px;margin:auto;padding:18px 14px 85px}.msg{padding:13px;border-radius:12px;margin:12px 0;white-space:pre-wrap;line-height:1.5}.user{background:#303030;margin-left:12%}.assistant{background:#292929;margin-right:12%}.bar{position:fixed;bottom:0;left:0;right:0;padding:12px;background:#212121}.form{max-width:720px;margin:auto;display:flex;gap:8px;background:#303030;padding:8px;border-radius:16px}textarea{flex:1;min-height:42px;resize:vertical;background:transparent;color:white;border:0;font:inherit}button{border:0;border-radius:12px;padding:0 16px}</style><div class="top">ChatGPT <b style="color:#8ee6b6">· SIMULATION</b></div><main class="wrap" id="messages"><div class="msg assistant">Hello! This is Apollo’s simulated ChatGPT browser. Send a message to test the flow. Nothing leaves Apollo.</div></main><div class="bar"><form class="form" id="send"><textarea id="prompt" placeholder="Message ChatGPT (simulated)"></textarea><button>Send</button></form></div><script>const box=document.querySelector("#messages"),input=document.querySelector("#prompt");function add(role,text){const d=document.createElement("div");d.className="msg "+role;d.textContent=text;box.append(d)}document.querySelector("#send").onsubmit=async e=>{e.preventDefault();const prompt=input.value.trim();if(!prompt)return;input.value="";add("user",prompt);const r=await fetch("/bulletin/api/browser/send",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({prompt})});const d=await r.json();add("assistant",d.reply||d.error||"No reply")};</script>', "text/html; charset=utf-8");
      if (req.method === "POST" && url.pathname === "/api/browser/send") { const input=await body(); if(typeof input.prompt!=="string"||!input.prompt.trim()) return send(400,{error:"Enter a message first"}); const prompt=input.prompt.trim().slice(0,4000); const mutation=await withQueueMutation(()=>{const id="browser-"+randomUUID();const reply="SIMULATED CHATGPT REPLY: Apollo received your message in the browser proof of concept: "+prompt.slice(0,1000);state.browserMessages.push({id,at:now(),prompt,reply});state.browserMessages=state.browserMessages.slice(-100);log("browser-message-sent",id,prompt.slice(0,240));log("browser-simulated-reply",id,reply.slice(0,240));return {id,reply,simulated:true};});if(mutation.busy)return send(503,{error:"Bulletin queue is busy; retry shortly"});return send(200,mutation.result); }
      if (req.method === "GET" && url.pathname === "/api/browser/log") { if (stateReloading) return send(503,{error:"Bulletin state is refreshing; retry shortly"}); if (!(await refreshPersistedStateForRead())) return send(503,{error:"Bulletin activity is temporarily unavailable"}); if (stateReloading) return send(503,{error:"Bulletin state is refreshing; retry shortly"}); return send(200,{activity:state.activity.slice(-100).reverse()}); }
      if (req.method === "GET" && url.pathname === "/health/ready") {
        const browserRequired = process.env.APOLLO_BULLETIN_ENABLE_BROWSER === "1";
        const persistenceRequired = process.env.APOLLO_BULLETIN_REQUIRE_TURSO === "1";
        const cronRequired = process.env.APOLLO_BULLETIN_USE_HOSTLESS_CRON === "1";
        const cronAuthConfigured = Boolean(resolveCronToken(process.env));
        const dispatcherLeaseConfigured = typeof persistence?.acquireLease === "function" && typeof persistence?.releaseLease === "function";
        const browserStatus = browserWorker ? await browserWorker.status().catch(() => null) : null;
        const browserHealthy = Boolean(browserStatus?.healthy);
        const browserSessionPersisted = Boolean(browserStatus?.sessionPersistenceReady);
        const browserInfrastructureReady = browserHealthy && browserSessionPersisted;
        const browserSessionReady = Boolean(browserInfrastructureReady && !browserStatus?.loginRequired);
        let persistenceAvailable = Boolean(persistence);
        let persistedQueue = null;
        if (persistence) {
          try {
            if (typeof persistence.ping === "function") await persistence.ping();
            persistedQueue = await persistence.loadQueue();
          } catch {
            persistenceAvailable = false;
          }
        }
        const cronState = persistedQueue?.cron && typeof persistedQueue.cron === "object" ? persistedQueue.cron : state.cron || {};
        const lastTickCompletedAt = Number(cronState.lastTickCompletedAt);
        const completedTickFresh = cronState.status === "completed" && Number.isFinite(lastTickCompletedAt) &&
          lastTickCompletedAt > 0 && lastTickCompletedAt <= now() && now() - lastTickCompletedAt <= 180_000;
        const cronExecutionConfirmed = completedTickFresh;
        let taskControlPersistenceReady = !cronRequired;
        if (cronRequired && persistenceAvailable && typeof persistence?.checkSignalPersistence === "function") {
          try { taskControlPersistenceReady = await persistence.checkSignalPersistence() === true; }
          catch { taskControlPersistenceReady = false; }
        }
        const readiness = readinessStatus({
          browserRequired, browserStarted: browserInfrastructureReady, persistenceRequired, persistenceAvailable,
          cronRequired, cronAuthConfigured, cronExecutionConfirmed,
          dispatcherLeaseRequired: cronRequired, dispatcherLeaseAvailable: dispatcherLeaseConfigured && persistenceAvailable,
          taskControlPersistenceRequired: cronRequired, taskControlPersistenceReady,
        });
        const cron = {
          configured: cronAuthConfigured, hostlessMode: cronRequired, lastTickStatus: cronState.status || "never",
          lastTickStartedAt: cronState.lastTickStartedAt ?? null, lastTickCompletedAt: cronState.lastTickCompletedAt ?? null,
          lastTickFailedAt: cronState.lastTickFailedAt ?? null, lastTickProcessed: cronState.lastTickProcessed ?? null,
          completedTicks: cronState.completedTicks || 0, failedTicks: cronState.failedTicks || 0, inFlight: Boolean(cronState.inFlight),
        };
        return send(readiness.statusCode, {
          ready: readiness.ready, browser: browserWorker ? (browserSessionReady ? "chromium-session-ready" : browserInfrastructureReady && browserStatus?.loginRequired ? "chromium-login-required" : browserHealthy && !browserSessionPersisted ? "chromium-session-persistence-not-ready" : "browser-not-ready") : "browser-not-started",
          browserRequired, browserHealthy, browserSessionPersisted, browserSessionPersistedAt: browserStatus?.lastSessionPersistedAt ?? null,
          browserSessionReady, browserLoginRequired: browserStatus?.loginRequired ?? null,
          persistence: persistenceAvailable ? "turso" : persistenceRequired ? "unavailable" : "local-fallback", persistenceRequired, persistenceReachable: persistenceAvailable, persistenceCredentialSource: persistence?.credentialSource || (persistence ? "injected" : null),
          ownerAuthorizationPolicy: "platform-owner-session", ownerActorPinConfigured: Boolean(process.env.APOLLO_BULLETIN_OWNER_ACTOR_ID?.trim()),
          dispatcherLeaseConfigured, taskControlPersistenceRequired: cronRequired, taskControlPersistenceReady,
          cronRequired, cronAuthConfigured, cronExecutionConfirmed, cron,
        });
      }
      send(404,{error:"not_found"});
    } catch (error) { send(error.statusCode || 500,{error:error.message || String(error)}); }
  });
  return { server, async listen() { await loadForStartup(); await new Promise((resolve,reject)=>{server.once("error",reject);server.listen(port,"127.0.0.1",()=>{server.off("error",reject);resolve();});}); if (process.env.APOLLO_BULLETIN_ENABLE_BROWSER === "1") { try { const browser=await createApolloChatGptBrowserWorkerFromEnvironment(process.env,{sessionStore:persistence}); browserWorker=browser.worker; await browserWorker.openLogin(); await recordStartupEvent("browser-started","Dedicated Chromium opened ChatGPT sign-in"); } catch(error) { console.error("[apollo-bulletin] Chromium startup failed:",String(error?.message||error)); await recordStartupEvent("browser-start-failed",String(error?.message||error).slice(0,300)); } } if (process.env.APOLLO_BULLETIN_USE_HOSTLESS_CRON !== "1") { timer=setInterval(()=>void tick(),1000); timer.unref(); void tick(); } return server.address(); }, async close(){ if(timer) clearInterval(timer); if(server.listening) await new Promise((resolve,reject)=>server.close(e=>e?reject(e):resolve())); await activeTickDone; if(browserWorker) await browserWorker.close(); await saveTail; } };
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const app = createBulletinServer(); await app.listen(); console.log("Apollo Bulletin prototype listening on loopback.");
}

// Hosted dispatch uses only the dedicated visible ChatGPT UI and fails closed on ambiguous state.
