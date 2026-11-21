const $ = id => document.getElementById(id);
const send = (type, extra = {}) => chrome.runtime.sendMessage({ type, ...extra });

async function refresh() {
  const state = await send("APOLLO_GET_STATE");
  $("maxCycles").value = state.maxCycles || 3;
  $("status").textContent = JSON.stringify({
    enabled: state.enabled,
    paused: state.paused,
    cycles: state.cycles,
    maxCycles: state.maxCycles,
    activity: state.activity?.slice(-8)
  }, null, 2);

  const list = $("queue");
  list.replaceChildren();
  for (const item of state.queue || []) {
    const card = document.createElement("div");
    card.className = "item";
    const title = document.createElement("div");
    title.textContent = item.status + " — " + item.prompt.slice(0, 140);
    card.append(title);
    const url = document.createElement("small");
    url.textContent = item.targetUrl;
    card.append(url);

    if (["attempted", "active", "limit-reached"].includes(item.status)) {
      const complete = document.createElement("button");
      complete.textContent = "Mark complete";
      complete.onclick = async () => {
        await send("APOLLO_COMPLETE", { id: item.id });
        await refresh();
      };
      card.append(complete);
    }

    if (item.status === "limit-reached") {
      const resume = document.createElement("button");
      resume.textContent = "Resume task (fresh cycle budget)";
      resume.onclick = async () => {
        await send("APOLLO_REQUEUE", { id: item.id });
        await refresh();
      };
      card.append(resume);
    }

    if (item.status === "attempted") {
      const retry = document.createElement("button");
      retry.textContent = "Retry (check first)";
      retry.onclick = async () => {
        if (confirm("Inspect the conversation first. This may duplicate work if the previous send succeeded. Retry anyway?")) {
          await send("APOLLO_REQUEUE", { id: item.id });
          await refresh();
        }
      };
      card.append(retry);
    }
    list.append(card);
  }
}

$("maxCycles").onchange = async () => {
  const result = await send("APOLLO_SET_MAX_CYCLES", { maxCycles: Number($("maxCycles").value) });
  if (result.error) alert(result.error);
  await refresh();
};
$("add").onclick = async () => {
  const result = await send("APOLLO_ENQUEUE", {
    prompt: $("prompt").value,
    targetUrl: $("url").value.trim()
  });
  if (result.error) alert(result.error);
  else {
    $("prompt").value = "";
    await refresh();
  }
};
$("run").onclick = async () => { await send("APOLLO_RUN_NOW"); await refresh(); };
$("pause").onclick = async () => { await send("APOLLO_PAUSE"); await refresh(); };
$("resume").onclick = async () => { await send("APOLLO_RESUME"); await refresh(); };
$("stop").onclick = async () => { await send("APOLLO_STOP"); await refresh(); };
void refresh();
