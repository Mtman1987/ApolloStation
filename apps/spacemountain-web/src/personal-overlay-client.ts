// Device and browser overlay host: reload the scene only when its workspace changes.
const frame = document.querySelector<HTMLIFrameElement>("[data-overlay-frame]")!;
let busy = false;
let fingerprint = "";
async function refresh() {
  if (busy) return;
  busy = true;
  try {
    const sessionResponse = await fetch("/v1/session", { credentials: "same-origin", cache: "no-store" });
    if (!sessionResponse.ok) { frame.hidden = true; frame.removeAttribute("src"); return; }
    const session = await sessionResponse.json();
    const tenantId = session.tenantIds?.[0];
    if (typeof tenantId !== "string") { frame.hidden = true; return; }
    const response = await fetch("/v1/overlay/tenant-outputs", { credentials: "same-origin", cache: "no-store", headers: { "x-spmt-tenant": tenantId } });
    if (!response.ok) { frame.hidden = true; frame.removeAttribute("src"); return; }
    const outputs = await response.json();
    const next = `${tenantId}:${outputs.revision}:${outputs.personal?.sceneId}:${outputs.personal?.enabled}`;
    frame.hidden = outputs.personal?.enabled === false || !outputs.personal?.sceneId;
    if (next !== fingerprint || !frame.hasAttribute("src")) {
      if (!frame.hidden) frame.src = `/t/${encodeURIComponent(tenantId)}/personal`;
      else frame.removeAttribute("src");
      fingerprint = next;
    }
  } catch { /* A brief outage keeps the last rendered scene. */ }
  finally { busy = false; }
}
void refresh();
window.setInterval(() => void refresh(), 5_000);
window.addEventListener("focus", () => void refresh());
export {};
