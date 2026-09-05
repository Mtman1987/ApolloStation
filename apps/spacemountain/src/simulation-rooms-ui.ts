import { renderCommunityCalendarSvg, type CommunityCalendarView } from "@spmt/ui/community-calendar";
import { SpmtClient } from "@spmt/sdk";
import type { SimulationRoomSummaryV1, SimulationRoomInputV1 } from "@spmt/contracts";

export function simulationRoomPath(roomId?: string) { return `/simulation-rooms${roomId ? `?roomId=${encodeURIComponent(roomId)}` : ""}`; }
export function simulationRoomSlot(value: string | null | undefined): { roomId?: string } | undefined {
  if (!value || !value.startsWith("/simulation-rooms")) return undefined;
  try {
    const url = new URL(value, "https://workspace.invalid");
    if (url.origin !== "https://workspace.invalid" || url.pathname !== "/simulation-rooms" || url.hash || [...url.searchParams.keys()].some((key) => key !== "roomId")) return undefined;
    const roomId = url.searchParams.get("roomId");
    return roomId && roomId.length <= 200 ? { roomId } : roomId ? undefined : {};
  } catch { return undefined; }
}

const CSS = `
.simulation-content{display:grid;gap:12px;color:#eef2fa;background:#0c1220;padding:12px;border-radius:16px;min-width:0}.simulation-content *{box-sizing:border-box}.simulation-content [hidden]{display:none!important}.simulation-toolbar,.simulation-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.simulation-toolbar{justify-content:space-between}.simulation-toolbar h2,.simulation-content p{margin:0}.simulation-content small,.simulation-help{color:#aab7cd;font-size:12px}.simulation-content button,.simulation-content select,.simulation-content textarea,.simulation-content input{font:inherit;color:inherit;background:#19243a;border:1px solid #485b7c;border-radius:8px;padding:9px;min-height:38px}.simulation-content button{cursor:pointer}.simulation-content button[aria-selected=true]{background:#294a7e;border-color:#77b5ff}.simulation-content button:disabled{opacity:.5;cursor:default}.simulation-rooms-list{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,250px),1fr));gap:10px}.simulation-room-card{padding:14px;border:1px solid #3b4b65;border-radius:12px;display:grid;gap:8px;background:#121e30}.simulation-room-card strong{overflow-wrap:anywhere}.simulation-studio{display:grid;gap:12px;min-width:0}.simulation-stage{width:100%;aspect-ratio:16/9;position:relative;overflow:hidden;border:1px solid #435675;border-radius:12px;background:radial-gradient(ellipse at center,#263a56,#060c17)}.simulation-stage iframe{display:block;width:100%;height:100%;border:0;background:transparent}.simulation-stage-caption{position:absolute;top:12px;left:12px;color:#b6c5d9;font-size:12px;pointer-events:none}.simulation-chat-panel{width:100%;aspect-ratio:16/9;display:flex;flex-direction:column;min-height:0;overflow:hidden;border:1px solid #435675;border-radius:12px;background:#101929}.simulation-chat-panel[data-provider=discord]{background:#313338;aspect-ratio:auto;min-height:440px;max-height:75vh}.simulation-chat-title{padding:9px 12px;border-bottom:1px solid #46516a;font-weight:600}.simulation-conversation{flex:1;overflow:auto;min-height:0;padding:10px;display:flex;flex-direction:column;gap:10px}.simulation-message{padding:8px 10px;border-left:2px solid #7b95bb;background:#ffffff05;overflow-wrap:anywhere}.simulation-message[data-direction=ingress]{border-color:#78b7ff}.simulation-message[data-direction=egress]{border-color:#74d5ba}.simulation-message header{display:flex;gap:8px;align-items:baseline;flex-wrap:wrap;margin-bottom:4px}.simulation-message p{white-space:pre-wrap}.simulation-compose{display:flex;align-items:end;gap:8px;border-top:1px solid #46516a;padding:8px}.simulation-compose label{flex:1;min-width:0}.simulation-compose textarea{display:block;width:100%;resize:none;height:42px;min-height:42px}.simulation-status{color:#c5d9f7;white-space:pre-wrap}.simulation-embed{border-left:4px solid #5865f2;padding:12px;background:#2b2d31;border-radius:4px;max-width:520px;display:grid;gap:8px}.simulation-embed p{white-space:pre-wrap}.simulation-embed-fields{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}.simulation-embed-field{grid-column:1/-1}.simulation-embed-field[data-inline=true]{grid-column:auto}.simulation-embed img{max-width:100%;max-height:260px;object-fit:contain;border-radius:5px}.simulation-embed-thumbnail{float:right;width:72px}.simulation-components{display:flex;gap:6px;flex-wrap:wrap;margin-top:8px}.simulation-content a{color:#8fc8ff}.simulation-discord-form{padding:12px;background:#202226;display:grid;gap:10px;max-height:55vh;overflow:auto}.simulation-discord-form label{display:grid;gap:5px}.simulation-discord-form textarea{width:100%;min-height:70px}.simulation-log-empty{color:#aab7cd;padding:12px}.simulation-chat-panel[data-provider=discord] .simulation-conversation{flex:1;min-height:260px}@media(max-width:500px){.simulation-content{padding:8px}.simulation-compose{gap:4px;padding:5px}.simulation-compose button{padding:8px}.simulation-chat-title{padding:5px 8px}.simulation-message{font-size:12px;padding:5px}.simulation-help{font-size:11px}}
`;
const escapeHtml = (value: unknown) => String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
function record(value: unknown): Record<string, unknown> { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
const appName = (id: unknown) => ({ streamweaver: "StreamWeaver", "nebula-arcade": "Nebula Arcade", "discord-stream-hub": "Discord Stream Hub", hearmeout: "HearMeOut", "chat-gateway": "Room" }[String(id)] ?? String(id ?? "App"));
function safeUrl(value: unknown) { try { const url = new URL(String(value)); return url.protocol === "https:" && !url.username && !url.password && url.hostname !== "simulation.invalid" ? url.href : ""; } catch { return ""; } }
function richText(value: unknown) { return escapeHtml(value).replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>").replace(/`([^`\n]+)`/g, "<code>$1</code>"); }
function previewImage(value: unknown, className = "") { const url = safeUrl(record(value).url); return url ? `<img class="${className}" src="${escapeHtml(url)}" alt="Embed image" loading="lazy" referrerpolicy="no-referrer">` : ""; }
export function renderSimulationDiscordPayload(value: unknown) {
  const payload = record(value);
  const embeds = Array.isArray(payload.embeds) ? payload.embeds.map(record) : [];
  return `${payload.content ? `<p>${richText(payload.content)}</p>` : ""}${embeds.map(embed => {
    const color = Number.isInteger(embed.color) && Number(embed.color) >= 0 && Number(embed.color) <= 0xffffff ? Number(embed.color).toString(16).padStart(6, "0") : "5865f2";
    const fields = Array.isArray(embed.fields) ? embed.fields.map(record) : [];
    return `<section class="simulation-embed" style="border-left-color:#${color}">${record(embed.author).name ? `<small>${richText(record(embed.author).name)}</small>` : ""}${previewImage(embed.thumbnail, "simulation-embed-thumbnail")}${embed.title ? `<strong>${richText(embed.title)}</strong>` : ""}${embed.description ? `<p>${richText(embed.description)}</p>` : ""}${fields.length ? `<div class="simulation-embed-fields">${fields.map(field => `<div class="simulation-embed-field" data-inline="${field.inline === true}"><strong>${richText(field.name)}</strong><p>${richText(field.value)}</p></div>`).join("")}</div>` : ""}${payload.calendar ? `<div class="simulation-calendar" style="width:100%;overflow:auto">${calendarArtwork(payload.calendar)}</div>` : previewImage(embed.image)}${record(embed.footer).text ? `<small>${richText(record(embed.footer).text)}</small>` : ""}</section>`;
  }).join("")}${Array.isArray(payload.attachments) ? payload.attachments.map(item => { const attachment = record(item), url = safeUrl(attachment.url); return url ? `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(attachment.filename || "Attachment")}</a>` : ""; }).join("") : ""}${Array.isArray(payload.components) ? `<div class="simulation-components">${payload.components.flatMap(row => Array.isArray(record(row).components) ? record(row).components as unknown[] : []).map(record).map(component => { const label = `${escapeHtml(record(component.emoji).name)} ${escapeHtml(component.label || component.placeholder || "Select")}`, url = safeUrl(component.url), customId = String(component.custom_id || ""); return url ? `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${label}</a>` : `<button type="button" ${/^(?:application_(inquiry|start):(mod|partner|dev):\d{5,30}|calendar:(captain|mission|previous|next):\d{5,30}:\d{4}-(0[1-9]|1[0-2]))$/.test(customId) && component.disabled !== true ? `data-discord-action="${escapeHtml(customId)}"` : "disabled"}>${label}</button>`; }).join("")}</div>` : ""}`;
}

export interface SimulationRoomsUiOptions { canDelete?: boolean; onPin?: (roomId: string, slot: number) => Promise<void>; }

/** Persistent studio: polling updates history without replacing the stage or composer. */
export class SimulationRoomsUi {
  private rooms: SimulationRoomSummaryV1[] = [];
  private events: Array<Record<string, unknown>> = [];
  private selected = "";
  private provider: "twitch" | "discord" | "kick" = "twitch";
  private active = false;
  private timer: number | undefined;
  private generation = 0;
  private loading = false;
  private busy = false;
  private status = "";
  private pendingJob: string | undefined;
  private historySignature = "";
  private overlaySignature = "";
  private modalSignature = "";
  private readonly click = (event: Event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>("button");
    if (!button) return;
    if (button.hasAttribute("data-tab")) { this.provider = button.dataset.tab === "discord" ? "discord" : "twitch"; this.render(); return; }
    if (this.busy) return;
    if (button.hasAttribute("data-discord-action")) { void this.send(button.textContent?.trim() || "Discord action", { customId: button.dataset.discordAction! }); return; }
    if (button.hasAttribute("data-modal-close")) { this.query("[data-discord-modal]").hidden = true; return; }
    if (button.hasAttribute("data-room-create")) { this.query("[data-create-room]").hidden=false; this.query<HTMLInputElement>("[name=roomName]").focus(); }
    else if (button.hasAttribute("data-room-open")) this.open(button.dataset.roomOpen);
    else if (button.hasAttribute("data-room-back")) this.open("");
    else if (button.hasAttribute("data-room-refresh")) void this.refresh(true);
    else if (button.hasAttribute("data-room-delete")) void this.remove(button.dataset.roomDelete!);
    else if (button.hasAttribute("data-room-pin")) void this.pin(button.dataset.roomPin!, Number(button.parentElement?.querySelector<HTMLSelectElement>("select")?.value ?? 0));
  };
  private readonly submit = (event: Event) => {
    const form = event.target as HTMLFormElement;
    if(form.matches("[data-create-room]")){event.preventDefault(); const name=this.query<HTMLInputElement>("[name=roomName]").value.trim();if(name&&!this.busy)void this.create(name);return;}
    if (form.matches("[data-discord-form]")) {
      event.preventDefault();
      const values = Object.fromEntries([...form.querySelectorAll<HTMLTextAreaElement>("textarea[name]")].map(field => [field.name,field.value]));
      if (!this.busy) void this.send("Submit", { customId: form.dataset.discordForm!, values });
      return;
    }
    if (!form.matches("[data-room-compose]")) return;
    event.preventDefault();
    const message = this.query<HTMLTextAreaElement>("[data-room-compose] textarea").value.trim();
    if (message && !this.busy) void this.send(message);
  };
  private readonly change = (event: Event) => {
    const target = event.target as HTMLSelectElement;
    if (target.matches("[data-stage-source]")) { this.query("[data-arcade-frame]").hidden = target.value !== "arcade"; this.query("[data-tag-frame]").hidden = target.value !== "tag"; this.query("[data-public-frame]").hidden = target.value !== "public"; this.render(); }
    if (target.matches("[data-stream-provider]")) { this.provider = target.value === "kick" ? "kick" : "twitch"; this.render(); }
  };
  private readonly overlayReady = (event: MessageEvent) => { if (event.origin === window.location.origin && [this.query<HTMLIFrameElement>("[data-tag-frame]").contentWindow,this.query<HTMLIFrameElement>("[data-arcade-frame]").contentWindow].includes(event.source as Window) && ["spmt.simulation.tag.ready","spmt.simulation.arcade.ready"].includes(String(record(event.data).type))) this.updateOverlay(true); };
  constructor(private readonly root: HTMLElement, private readonly client: SpmtClient, private readonly tenantId: string, private readonly options: SimulationRoomsUiOptions = {}) {
    root.innerHTML = `<style>${CSS}</style><div class="simulation-content"><header class="simulation-toolbar"><div><h2>Preview Studio</h2><p class="simulation-help">One room across your apps. Test chat, commands and Discord actions.</p></div><div class="simulation-actions"><button type="button" data-room-create>Create room</button><button type="button" data-room-back>All rooms</button><button type="button" data-room-refresh>Refresh</button></div></header><form class="simulation-actions" data-create-room hidden><label>Room name <input name="roomName" maxlength="120" required placeholder="Live test"></label><button type="submit">Create and open</button></form><p class="simulation-status" role="status"></p><div data-room-actions></div><div class="simulation-rooms-list" data-room-list hidden></div><div class="simulation-studio" data-studio><div class="simulation-actions" role="tablist" aria-label="Preview channel"><button type="button" role="tab" data-tab="twitch">Stream</button><button type="button" role="tab" data-tab="discord">Discord</button></div><div data-stream-tools class="simulation-actions"><label>Overlay <select data-stage-source><option value="arcade">Arcade games · test state</option><option value="tag">Nebula Arcade Tag · test state</option><option value="public">Saved stream overlay · live view</option></select></label><label>Chat <select data-stream-provider><option value="twitch">Twitch</option><option value="kick">Kick</option></select></label></div><div class="simulation-stage" data-stage><iframe data-arcade-frame src="/simulation-rooms/arcade" title="Arcade simulation widgets"></iframe><iframe data-tag-frame hidden src="/simulation-rooms/tag" title="Nebula Arcade Tag simulation overlay"></iframe><iframe data-public-frame hidden title="Saved stream overlay"></iframe><span class="simulation-stage-caption" data-stage-caption>16:9 · waiting for test input</span></div><p class="simulation-help" data-stage-help>Nebula Arcade Tag uses its live renderer with test state. Choose a game inside the stage or let it follow chat activity.</p><section class="simulation-chat-panel"><div class="simulation-chat-title"></div><div class="simulation-conversation" role="log" aria-label="Room conversation" aria-live="polite"></div><div data-discord-modal hidden></div><form class="simulation-compose" data-room-compose><label><span class="simulation-help" data-compose-label>Message or !command</span><textarea name="message" rows="1" maxlength="5000" required placeholder="Type a message or !command…"></textarea></label><button type="submit">Send</button></form></section><p class="simulation-help">Uses installed app handlers with separate test state. Nothing posts to live channels. Discord application buttons and forms use the same handlers as Discord.</p></div></div>`;
    root.addEventListener("click", this.click); root.addEventListener("submit", this.submit); root.addEventListener("change", this.change); window.addEventListener("message", this.overlayReady);
    this.render();
  }
  private query<T extends HTMLElement = HTMLElement>(selector: string) { return this.root.querySelector<T>(selector)!; }
  open(roomId?: string) { const previous = this.selected; this.selected = roomId ?? ""; if (previous === this.selected) { if(this.active)void this.refresh(true); return; } if (previous !== this.selected) { this.query<HTMLIFrameElement>("[data-tag-frame]").src = "/simulation-rooms/tag"; this.query<HTMLIFrameElement>("[data-arcade-frame]").src = "/simulation-rooms/arcade"; } this.events = []; this.modalSignature = ""; this.query("[data-discord-modal]").hidden = true; this.historySignature = ""; this.overlaySignature = ""; this.status = ""; this.query<HTMLTextAreaElement>("[data-room-compose] textarea").value = ""; this.render(); if (this.active) void this.refresh(true); }
  setVisible(visible: boolean) {
    if (visible === this.active) return; this.active = visible;
    if (this.timer !== undefined) window.clearInterval(this.timer); this.timer = undefined;
    if (visible) { void this.refresh(true); this.timer = window.setInterval(() => { if (!document.hidden) void this.refresh(); }, 2000); }
    else { this.generation++; this.loading = false; }
  }
  destroy() { this.setVisible(false); this.generation++; this.root.removeEventListener("click", this.click); this.root.removeEventListener("submit", this.submit); this.root.removeEventListener("change", this.change); window.removeEventListener("message", this.overlayReady); }
  private async refresh(force = false) {
    if (this.loading && !force) return;
    const generation = ++this.generation, roomId = this.selected; this.loading = true;
    try {
      const [rooms, events, job] = await Promise.all([this.client.listSimulationRooms(this.tenantId, 200), roomId ? this.client.listSimulationRoomEvents(this.tenantId, { roomId, limit: 200 }) : Promise.resolve([]), this.pendingJob ? this.client.getExecutionJob(this.tenantId, this.pendingJob) : Promise.resolve(undefined)]);
      if (generation !== this.generation) return;
      this.rooms = rooms; this.events = events;
      if (job) {
        if (["succeeded", "failed", "dead-letter", "cancelled"].includes(job.state)) { this.pendingJob = undefined; this.busy = false; this.status = job.state === "succeeded" ? "" : job.error?.message || "Input did not complete."; }
        else this.status = job.state === "queued" ? "Waiting for the room worker…" : "Apps are processing your message…";
      } else if (!this.busy) this.status = "";
      this.render();
    } catch (error) { if (generation === this.generation) { this.status = error instanceof Error ? error.message : String(error); this.render(); } }
    finally { if (generation === this.generation) this.loading = false; }
  }
  private async create(name: string) {
    this.busy=true;this.status="Creating room…";this.render();
    try{const room=await this.client.createSimulationRoom(this.tenantId,name,`simulation-create:${crypto.randomUUID()}`);this.query("[data-create-room]").hidden=true;this.open(room.roomId);await this.refresh(true);}
    catch(error){this.status=error instanceof Error?error.message:String(error);}
    finally{this.busy=false;this.render();}
  }
  private async remove(roomId: string) {
    this.busy = true; this.render();
    try { await this.client.deleteSimulationRoom(this.tenantId, roomId, `simulation-delete:${crypto.randomUUID()}`); if (this.selected === roomId) this.open(""); await this.refresh(true); }
    catch (error) { this.status = error instanceof Error ? error.message : String(error); }
    finally { this.busy = false; this.render(); }
  }
  private async pin(roomId: string, slot: number) {
    this.busy = true; this.render();
    try { await this.options.onPin?.(roomId, slot); this.status = `Room saved in Workspace slot ${slot + 1}.`; }
    catch (error) { this.status = error instanceof Error ? error.message : String(error); }
    finally { this.busy = false; this.render(); }
  }
  private async send(message: string, interaction?: SimulationRoomInputV1["interaction"]) {
    this.busy = true; this.status = "Sending…"; this.render();
    try {
      const result = await this.client.sendSimulationRoomInput(this.tenantId, { roomId: this.selected, provider: interaction ? "discord" : this.provider, message, ...(interaction ? {interaction} : {}) }, `simulation-input:${crypto.randomUUID()}`);
      this.pendingJob = result.job.id; if (interaction?.values) this.query("[data-discord-modal]").hidden = true; const composer=this.query<HTMLTextAreaElement>("[data-room-compose] textarea"); if(!interaction && composer.value.trim()===message)composer.value=""; await this.refresh(true);
    } catch (error) { this.busy = false; this.status = error instanceof Error ? error.message : String(error); }
    this.render();
  }
  private actions(roomId: string, includeOpen: boolean) {
    return `<div class="simulation-actions">${includeOpen ? `<button type="button" data-room-open="${escapeHtml(roomId)}">Open room</button>` : ""}${this.options.canDelete && this.rooms.some(room => room.roomId === roomId) ? `<button type="button" data-room-delete="${escapeHtml(roomId)}">Delete room</button>` : ""}${this.options.onPin ? `<select aria-label="Workspace slot">${[0,1,2].map(slot => `<option value="${slot}">Slot ${slot + 1}</option>`).join("")}</select><button type="button" data-room-pin="${escapeHtml(roomId)}">Pin to Workspace</button>` : ""}</div>`;
  }
  private updateOverlay(force = false) {
    const tag = record(record(this.events.find(item => record(record(item.payload).data).renderer === "nebula-tag")?.payload).data);
    const arcade = record(record(this.events.find(item => record(record(item.payload).data).renderer === "nebula-arcade")?.payload).data);
    const signature = JSON.stringify([tag,arcade]);
    if (!force && signature === this.overlaySignature) return;
    this.overlaySignature = signature;
    if (tag.snapshot) this.query<HTMLIFrameElement>("[data-tag-frame]").contentWindow?.postMessage({ type: "spmt.simulation.tag", snapshot: tag.snapshot, messages: tag.messages ?? [] }, window.location.origin);
    if (arcade.inputs) this.query<HTMLIFrameElement>("[data-arcade-frame]").contentWindow?.postMessage({ type: "spmt.simulation.arcade", inputs: arcade.inputs, tabletop: arcade.tabletop, tag }, window.location.origin);
  }
  private history() {
    const messages = new Map<string, Record<string, unknown>>();
    for (const event of [...this.events].reverse()) {
      const payload = record(event.payload), data = record(payload.data);
      if (payload.lane === "overlay" || (payload.provider === "discord") !== (this.provider === "discord")) continue;
      if (this.provider !== "discord" && payload.provider && payload.provider !== this.provider) continue;
      const key = data.providerMessageId ? `${data.appId || event.sourceAppId}:${data.providerMessageId}` : String(event.id);
      if (data.operation === "delete" || data.operation === "delete-message") messages.delete(key); else messages.set(key, event);
    }
    return [...messages.values()].map(event => {
      const payload = record(event.payload), data = record(payload.data), ingress = payload.direction === "ingress";
      let content = record(data.payload);
      if (!Object.keys(content).length && typeof payload.body === "string" && payload.body.startsWith("{")) { try { content = record(JSON.parse(payload.body)); } catch {} }
      const rendered = this.provider === "discord" && (content.content || content.embeds || content.attachments || (content.components && data.interactionType !== 9)) ? renderSimulationDiscordPayload(content) : `<p>${richText(payload.body)}</p>`;
      if (!payload.body && !Object.keys(content).length) return "";
      return `<article class="simulation-message" data-direction="${escapeHtml(payload.direction)}"><header><strong>${escapeHtml(ingress ? record(data.actor).username || payload.title || "You" : appName(data.appId || event.sourceAppId))}</strong><small>${escapeHtml(new Date(String(event.createdAt)).toLocaleTimeString())}${data.operation === "dm" ? " · Direct message" : Number(content.flags) & 64 ? " · Private response" : ""}</small></header>${rendered}</article>`;
    }).join("") || '<p class="simulation-log-empty">Type a message or command to start. App responses will appear here.</p>';
  }
  private renderModal() {
    const event = this.events.find(item => record(record(item.payload).data).interactionType === 9);
    if (!event || String(event.id) === this.modalSignature) return;
    const payload = record(record(record(event.payload).data).payload);
    this.modalSignature = String(event.id);
    const components = (Array.isArray(payload.components) ? payload.components : []).flatMap(row => Array.isArray(record(row).components) ? record(row).components as unknown[] : []).map(record);
    const modal = this.query("[data-discord-modal]");
    modal.innerHTML = `<form class="simulation-discord-form" data-discord-form="${escapeHtml(payload.custom_id)}"><strong>${escapeHtml(payload.title)}</strong>${components.filter(field => field.type === 4).map(field => `<label>${escapeHtml(field.label)}<textarea name="${escapeHtml(field.custom_id)}" placeholder="${escapeHtml(field.placeholder)}" minlength="${Math.max(0, Number(field.min_length) || 0)}" maxlength="${Math.min(1000, Number(field.max_length) || 1000)}" ${field.required ? "required" : ""}></textarea></label>`).join("")}<div class="simulation-actions"><button type="submit">Submit</button><button type="button" data-modal-close>Cancel</button></div></form>`;
    modal.hidden = false;
  }
  private render() {
    const discord = this.provider === "discord", room = this.rooms.find(item => item.roomId === this.selected);
    this.query("h2").textContent = this.selected ? room?.name || "Preview Studio" : "Simulation Rooms";
    this.query(".simulation-status").textContent = this.status;
    this.query("[data-studio]").hidden = !this.selected; this.query("[data-room-list]").hidden = !!this.selected;
    this.query("[data-room-back]").hidden = !this.selected;
    const actions = this.selected ? this.actions(this.selected, false) : "";
    if (this.query("[data-room-actions]").innerHTML !== actions) this.query("[data-room-actions]").innerHTML = actions;
    if (!this.selected) this.query("[data-room-list]").innerHTML = this.rooms.map(item => `<article class="simulation-room-card"><strong>${escapeHtml(item.name)}</strong><small>${item.eventCount} messages · ${escapeHtml(item.lanes.join(", "))}</small>${this.actions(item.roomId, true)}</article>`).join("");
    this.root.querySelectorAll<HTMLButtonElement>("[data-tab]").forEach(button => button.setAttribute("aria-selected", String((button.dataset.tab === "discord") === discord)));
    this.query("[data-stage]").hidden = discord; this.query("[data-stream-tools]").hidden = discord; this.query("[data-stage-help]").hidden = discord;
    const publicView = this.query<HTMLSelectElement>("[data-stage-source]").value === "public";
    const publicFrame = this.query<HTMLIFrameElement>("[data-public-frame]");
    if (publicView && !publicFrame.getAttribute("src")) publicFrame.src = `/t/${encodeURIComponent(this.tenantId)}/public`;
    this.query("[data-stage-help]").textContent = publicView ? "Your saved stream composite. This view reads live state; room commands do not change it. Choose a game preview to see its test overlay respond." : "Uses the same game widgets as the stream overlay, driven by this room’s test input.";
    this.query("[data-stage-caption]").hidden = publicView || this.events.some(event => record(record(event.payload).data).renderer === "nebula-tag");
    this.query(".simulation-chat-panel").dataset.provider = this.provider;
    this.query(".simulation-chat-title").textContent = discord ? "# simulation-chat · Discord" : `${this.provider === "kick" ? "Kick" : "Twitch"} chat · 16:9`;
    this.query("[data-compose-label]").textContent = discord ? "Message, !command or action (e.g. deploy admin calendar)" : "Message or !command";
    this.renderModal();
    const history = this.history(), log = this.query(".simulation-conversation");
    if (history !== this.historySignature) { const bottom = log.scrollHeight - log.scrollTop - log.clientHeight < 70; log.innerHTML = history; this.historySignature = history; if (bottom) log.scrollTop = log.scrollHeight; }
    this.root.querySelectorAll<HTMLButtonElement>("[data-create-room] button,[data-room-create],[data-room-compose] button,[data-room-actions] button,[data-room-list] button,[data-discord-action],[data-discord-form] button").forEach(button => { button.disabled = this.busy; });
    this.updateOverlay();
  }
}


function calendarArtwork(value:unknown){try{return renderCommunityCalendarSvg(value as CommunityCalendarView).replace('<svg ','<svg style="width:100%;height:auto" ');}catch{return "<p>Calendar artwork could not be read.</p>";}}
