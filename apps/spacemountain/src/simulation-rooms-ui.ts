import { SpmtClient } from "@spmt/sdk";
import type { SimulationRoomSummaryV1 } from "@spmt/contracts";

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

const CSS = `.simulation-content{display:grid;gap:12px}.simulation-toolbar,.simulation-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.simulation-toolbar{justify-content:space-between;position:sticky;top:0;z-index:1;background:#080d18;padding:12px;border-radius:14px}.simulation-toolbar h2,.simulation-content p{margin:0}.simulation-toolbar p,.simulation-content small{color:#a8afbf;font-size:12px}.simulation-content button,.simulation-content select,.simulation-content textarea{font:inherit;color:inherit;background:#141d30;border:1px solid #49516a;border-radius:10px;padding:9px;min-height:40px}.simulation-content button{cursor:pointer}.simulation-content button:disabled{cursor:wait;opacity:.5}.simulation-rooms-list{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,250px),1fr));gap:10px}.simulation-room-card,.simulation-message{padding:14px;border:1px solid #414b62;border-radius:14px;display:grid;gap:8px;background:#101827}.simulation-message[data-direction=ingress]{border-left:3px solid #60a5fa}.simulation-message[data-direction=egress]{border-left:3px solid #4ade80}.simulation-message p{white-space:pre-wrap;overflow-wrap:anywhere}.simulation-message header{display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap}.simulation-conversation{display:grid;gap:9px}.simulation-content form{display:grid;gap:8px}.simulation-content textarea{width:100%;box-sizing:border-box;resize:vertical;min-height:80px}.simulation-status{color:#bfc9db;white-space:pre-wrap}.simulation-room-card strong{overflow-wrap:anywhere}.simulation-room-card .simulation-actions{margin-top:6px}`;
const escapeHtml = (value: unknown) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
function record(value: unknown): Record<string, unknown> { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; }

export interface SimulationRoomsUiOptions {
  canDelete?: boolean;
  onPin?: (roomId: string, slot: number) => Promise<void>;
}

/** One shared room browser, used in the workspace tray and persistent embeds. */
export class SimulationRoomsUi {
  private rooms: SimulationRoomSummaryV1[] = [];
  private events: Array<Record<string, unknown>> = [];
  private selected = "";
  private active = false;
  private timer: number | undefined;
  private generation = 0;
  private loading = false;
  private busy = false;
  private status = "";
  private signature = "";
  private renderedRoom = "";
  private readonly click = (event: Event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>("button");
    if (!button || this.busy) return;
    if (button.hasAttribute("data-room-open")) this.open(button.dataset.roomOpen);
    else if (button.hasAttribute("data-room-back")) this.open("");
    else if (button.hasAttribute("data-room-refresh")) void this.refresh(true);
    else if (button.hasAttribute("data-room-delete")) void this.remove(button.dataset.roomDelete!);
    else if (button.hasAttribute("data-room-pin")) {
      const slot = Number(button.parentElement?.querySelector<HTMLSelectElement>("select")?.value ?? 0);
      void this.pin(button.dataset.roomPin!, slot);
    }
  };
  private readonly submit = (event: Event) => {
    const form = event.target as HTMLFormElement;
    if (!form.matches("[data-room-compose]")) return;
    event.preventDefault();
    const message = String(new FormData(form).get("message") ?? "").trim();
    if (message && !this.busy) void this.send(message);
  };

  constructor(private readonly root: HTMLElement, private readonly client: SpmtClient, private readonly tenantId: string, private readonly options: SimulationRoomsUiOptions = {}) {
    root.addEventListener("click", this.click);
    root.addEventListener("submit", this.submit);
    this.render();
  }
  open(roomId?: string) { this.selected = roomId ?? ""; this.events = []; this.signature = ""; this.status = "Loading rooms…"; this.render(); if (this.active) void this.refresh(true); }
  setVisible(visible: boolean) {
    if (visible === this.active) return;
    this.active = visible;
    if (this.timer !== undefined) window.clearInterval(this.timer);
    this.timer = undefined;
    if (visible) { void this.refresh(true); this.timer = window.setInterval(() => { if (!document.hidden && !this.busy) void this.refresh(); }, 4000); }
    else { this.generation++; this.loading = false; }
  }
  destroy() { this.setVisible(false); this.generation++; this.root.removeEventListener("click", this.click); this.root.removeEventListener("submit", this.submit); }

  private async refresh(force = false) {
    if (this.loading && !force) return;
    const generation = ++this.generation, roomId = this.selected;
    this.loading = true;
    try {
      const [rooms, events] = await Promise.all([
        this.client.listSimulationRooms(this.tenantId, 200),
        roomId ? this.client.listSimulationRoomEvents(this.tenantId, { roomId, limit: 200 }) : Promise.resolve([]),
      ]);
      if (generation !== this.generation) return;
      this.rooms = rooms;
      this.events = events;
      this.status = "";
      this.render();
    } catch (error) {
      if (generation !== this.generation) return;
      this.status = error instanceof Error ? error.message : String(error);
      this.render();
    } finally { if (generation === this.generation) this.loading = false; }
  }
  private command() {
    const ordered = [...this.events.filter((event) => record(event.payload).direction === "ingress"), ...this.events];
    for (const event of ordered) {
      const payload = record(event.payload), data = record(payload.data);
      if (event.sourceAppId === "streamweaver" && typeof data.packageId === "string" && typeof data.commandId === "string") return { packageId: data.packageId, commandId: data.commandId, input: payload.direction === "ingress" ? String(payload.body ?? "") : "" };
    }
    return undefined;
  }
  private async remove(roomId: string) {
    this.busy = true;
    this.render();
    try {
      await this.client.deleteSimulationRoom(this.tenantId, roomId, `simulation-delete:${crypto.randomUUID()}`);
      if (this.selected === roomId) { this.selected = ""; this.events = []; }
      await this.refresh(true);
    } catch (error) { this.status = error instanceof Error ? error.message : String(error); }
    finally { this.busy = false; this.render(); }
  }
  private async pin(roomId: string, slot: number) {
    this.busy = true;
    this.render();
    try { await this.options.onPin?.(roomId, slot); this.status = `Room saved in Workspace slot ${slot + 1}.`; }
    catch (error) { this.status = error instanceof Error ? error.message : String(error); }
    finally { this.busy = false; this.render(); }
  }
  private async send(message: string) {
    const command = this.command();
    this.busy = true;
    this.render();
    try {
      if (command) {
        const response = await fetch("/api/streamweaver/control/flows/preview", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...command, message }) });
        const value = await response.json();
        if (!response.ok) throw new Error(value.message || "Command preview failed");
        this.selected = value.roomId;
      } else {
        await this.client.publishSimulationRoomEvent(this.tenantId, { roomId: this.selected, lane: "chat", direction: "ingress", title: "Simulation note", body: message }, `simulation-note:${crypto.randomUUID()}`);
      }
      const textarea = this.root.querySelector<HTMLTextAreaElement>("textarea");
      if (textarea) textarea.value = "";
      await this.refresh(true);
    } catch (error) { this.status = error instanceof Error ? error.message : String(error); }
    finally { this.busy = false; this.render(); }
  }
  private actions(room: SimulationRoomSummaryV1, includeOpen: boolean) {
    const disabled = this.busy ? " disabled" : "";
    return `<div class="simulation-actions">${includeOpen ? `<button type="button" data-room-open="${escapeHtml(room.roomId)}"${disabled}>Open room</button>` : ""}${this.options.canDelete ? `<button type="button" data-room-delete="${escapeHtml(room.roomId)}"${disabled}>Delete room</button>` : ""}${this.options.onPin ? `<select aria-label="Workspace slot">${[0,1,2].map((slot) => `<option value="${slot}">Slot ${slot + 1}</option>`).join("")}</select><button type="button" data-room-pin="${escapeHtml(room.roomId)}"${disabled}>Pin to Workspace</button>` : ""}</div>`;
  }
  private render() {
    const signature = JSON.stringify([this.rooms, this.events, this.selected, this.status, this.busy]);
    if (signature === this.signature) return;
    this.signature = signature;
    const textarea = this.root.querySelector<HTMLTextAreaElement>("textarea"), draft = this.renderedRoom === this.selected ? textarea?.value : undefined, editing = document.activeElement === textarea;
    this.renderedRoom = this.selected;
    const scrollTop = this.root.scrollTop;
    const room = this.rooms.find((item) => item.roomId === this.selected), command = this.command();
    const history = [...this.events].reverse().map((event) => {
      const payload = record(event.payload), direction = String(payload.direction ?? "preview");
      const label = direction === "ingress" ? "Input" : direction === "egress" ? "Output" : "Preview";
      return `<article class="simulation-message" data-direction="${escapeHtml(direction)}"><header><strong>${label} · ${escapeHtml(payload.title)}</strong><small>${escapeHtml(payload.lane)} · ${escapeHtml(new Date(String(event.createdAt)).toLocaleTimeString())}</small></header><p>${escapeHtml(payload.body)}</p></article>`;
    }).join("");
    const content = this.selected
      ? room ? `${this.actions(room, false)}<div class="simulation-conversation" role="log" aria-label="Room conversation">${history}</div><form data-room-compose><label>${command ? "Test this command with another message" : "Add a simulation note"}<textarea name="message" maxlength="8000" required placeholder="${escapeHtml(command?.input || "Type a test message…")}"></textarea></label><button type="submit"${this.busy ? " disabled" : ""}>${command ? "Run preview" : "Add note"}</button></form>` : '<p>This room has no active conversation. Run a preview to start it again, or return to all rooms.</p>'
      : `<div class="simulation-rooms-list">${this.rooms.map((item) => `<article class="simulation-room-card"><strong>${escapeHtml(item.name)}</strong><small>${item.eventCount} message${item.eventCount === 1 ? "" : "s"} · ${escapeHtml(item.lanes.join(", "))}</small>${this.actions(item, true)}</article>`).join("") || '<p>No rooms yet. Preview a command, scene, or game to start a room.</p>'}</div>`;
    this.root.innerHTML = `<style>${CSS}</style><div class="simulation-content"><header class="simulation-toolbar"><div><h2>${escapeHtml(room?.name || "Simulation Rooms")}</h2><p>Tenant-scoped chat, overlay, game, and app previews. Rooms stay available across apps.</p></div><div class="simulation-actions">${this.selected ? '<button type="button" data-room-back>All rooms</button>' : ""}<button type="button" data-room-refresh>Refresh</button></div></header><p class="simulation-status" role="status">${escapeHtml(this.status)}</p>${content}</div>`;
    const next = this.root.querySelector<HTMLTextAreaElement>("textarea");
    if (next && draft !== undefined) { next.value = draft; if (editing) next.focus({ preventScroll: true }); }
    this.root.scrollTop = scrollTop;
  }
}
