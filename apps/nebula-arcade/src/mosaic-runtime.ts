import { randomUUID } from "node:crypto";
import {
  clearMosaicQueue, claimNextMosaicRequest, failMosaicQueueRequest, installMosaicQueueTemplate,
  mosaicPublicSnapshot, paintMosaicBrush, parseMosaicBrushCommand,
  parseMosaicPaintCommand, parseMosaicPaletteCommand, parseMosaicRevealCommand, parseMosaicViewCommand,
  queueMosaicThemeRequest, removeMosaicQueueRequest, setMosaicPalette, setMosaicView, startMosaicReveal,
  validateMosaicTheme, type MosaicArtwork, type MosaicBrushDirection, type MosaicColorCode,
} from "./mosaic-core.js";
import { SqliteNebulaMosaicStore } from "./mosaic-store.js";

export type MosaicGenerationResult = { target: MosaicColorCode[]; provider?: string; sourceImageUrl?: string };
export type MosaicGenerator = (theme: string, context?: { tenantId: string; channel: string }) => Promise<MosaicGenerationResult>;
export type MosaicChatInput = { tenantId: string; channel: string; playerId: string; username: string; displayName?: string; text: string; moderator?: boolean; now?: number };
export type MosaicChatResult = { handled: boolean; reply?: string; generated?: boolean; state?: ReturnType<typeof mosaicPublicSnapshot> };

function mosaicBody(value: string): string | null {
  const original = String(value || "").trim();
  if (!/^(?:!?@?spmt\s+(?:mosaic|pixelbattle|reveal)\b|!?mosaic\b|!?pixelbattle\b)/i.test(original)) return null;
  return original.replace(/^!?@?spmt\s+/i, "").replace(/^!?mosaic\s*/i, "").replace(/^!?pixelbattle\s*/i, "").replace(/^!?reveal\s*/i, "").trim();
}

export class NebulaMosaicRuntime {
  private readonly store: SqliteNebulaMosaicStore;
  private readonly generate: MosaicGenerator | undefined;
  constructor(databasePath: string, generate?: MosaicGenerator) {
    this.store = new SqliteNebulaMosaicStore(databasePath);
    this.generate = generate;
  }
  close() { this.store.close(); }
  snapshot(tenantId: string, channel: string, now = Date.now()) {
    return mosaicPublicSnapshot(this.store.get(tenantId, channel), now);
  }
  async processNext(tenantId: string, channel: string, now = Date.now()): Promise<{ started: boolean; error?: string }> {
    if (!this.generate) return { started: false, error: "Mosaic image generation is not configured." };
    const claim = this.store.update(tenantId, channel, (state) => claimNextMosaicRequest(state, now), now);
    const request = claim.result;
    if (!request) return { started: false };
    try {
      const generated = await this.generate(request.theme, { tenantId: String(tenantId), channel: String(channel) });
      this.store.update(tenantId, channel, (state) => {
        installMosaicQueueTemplate(state, request.id, generated.target, {
          ...(generated.provider ? { provider: generated.provider } : {}),
          ...(generated.sourceImageUrl ? { sourceImageUrl: generated.sourceImageUrl } : {}),
        }, Date.now());
        return true;
      });
      return { started: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Mosaic generation failed.";
      this.store.update(tenantId, channel, (state) => failMosaicQueueRequest(state, request.id, message, Date.now()), Date.now());
      return { started: true, error: message.slice(0, 180) };
    }
  }
  async handle(input: MosaicChatInput): Promise<MosaicChatResult> {
    const body = mosaicBody(input.text);
    if (body === null) return { handled: false };
    const now = Math.max(0, Math.floor(Number(input.now ?? Date.now())));
    const playerId = String(input.playerId || "").trim();
    if (!playerId) return { handled: true, reply: "I couldn't identify the player for that Mosaic command." };
    const result = this.store.update(input.tenantId, input.channel, (state) => {
      const current = state.current;
      const paint = parseMosaicPaintCommand(input.text);
      if (paint) {
        if (!current) return { reply: "No Mosaic is active yet. Request one with !mosaic <theme>.", queued: false };
        const brush = Math.max(1, Math.min(5, Math.floor(Number(current.brushByPlayer?.[playerId] || 1))));
        const direction = current.brushDirectionByPlayer?.[playerId] || "right";
        const painted = paintMosaicBrush(current, paint, playerId, { size: brush, direction, now });
        state.current = painted.artwork;
        if (painted.outcome === "wrong") return { reply: `${paint.coordinate} needs ${painted.expected}; no cells were painted.`, queued: false };
        if (painted.outcome === "already-painted") return { reply: `${paint.coordinate} is already painted.`, queued: false };
        const milestoneText = painted.milestones.length ? ` Milestones: ${painted.milestones.map((item) => item.id).join(", ")}.` : "";
        return { reply: `${painted.paintedCount} cell(s) painted from ${paint.coordinate}.${painted.stoppedAt ? ` Brush stopped at ${painted.stoppedAt} because the next cell differs.` : ""}${milestoneText}`, queued: false };
      }
      const brushCommand = parseMosaicBrushCommand(input.text);
      if (brushCommand !== null) {
        if (!current || current.status !== "active") return { reply: "No unfinished Mosaic is ready for brush settings.", queued: false };
        current.brushByPlayer ||= {}; current.brushDirectionByPlayer ||= {};
        let size = Math.max(1, Math.min(5, Math.floor(Number(current.brushByPlayer[playerId] || 1))));
        let direction: MosaicBrushDirection = current.brushDirectionByPlayer[playerId] || "right";
        if (brushCommand === "status") return { reply: `Mosaic brush: size ${size}, direction ${direction}.`, queued: false };
        if (typeof brushCommand === "number") size = brushCommand;
        else if (typeof brushCommand === "string") direction = brushCommand;
        else { size = brushCommand.size; direction = brushCommand.direction; }
        current.brushByPlayer[playerId] = size; current.brushDirectionByPlayer[playerId] = direction;
        current.updatedAt = current.lastInteractionAt = new Date(now).toISOString();
        return { reply: `Mosaic brush set to size ${size}, direction ${direction}.`, queued: false };
      }
      const view = parseMosaicViewCommand(input.text);
      if (view !== null) {
        if (!current) return { reply: "No saved Nebula Mosaic is ready yet.", queued: false };
        state.current = setMosaicView(current, view, now);
        return { reply: view === "all" ? "Showing the full Mosaic overview for 15 seconds." : `Showing Mosaic board ${view}.`, queued: false };
      }
      const palette = parseMosaicPaletteCommand(input.text);
      if (palette) {
        if (!current) return { reply: "No saved Nebula Mosaic is ready yet.", queued: false };
        state.current = setMosaicPalette(current, palette, now);
        return { reply: `Mosaic palette changed to ${palette}.`, queued: false };
      }
      if (parseMosaicRevealCommand(input.text)) {
        if (!current || current.status !== "active") return { reply: "No active Mosaic is ready for a reveal.", queued: false };
        const reveal = startMosaicReveal(current, now);
        state.current = reveal.artwork;
        return { reply: reveal.alreadyActive ? `Mosaic reveal is already active until ${reveal.until}.` : `Mosaic target reveal started for 15 seconds, until ${reveal.until}.`, queued: false };
      }
      const command = body.toLowerCase();
      if (!command || command === "help") return { reply: "Mosaic: !mosaic <theme>, !mosaic status, !mosaic queue, !mosaic paint A1 red, !mosaic brush 3 right, !mosaic view 1|2|3|4|all, !mosaic palette classic|neon|pastel|mono|ocean. Use !spmt reveal for a temporary target reveal.", queued: false };
      if (/^(?:paint|play)\b/i.test(command)) return { reply: "Use !mosaic paint A1 red with a valid A1–AN50 coordinate and supported color.", queued: false };
      if (/^brush\b/i.test(command)) return { reply: "Brush options: !mosaic brush, !mosaic brush 1–5, or !mosaic brush 3 right|left|up|down.", queued: false };
      if (/^(?:view|show)\b/i.test(command)) return { reply: "Choose !mosaic view 1, 2, 3, 4, or all.", queued: false };
      if (/^palette\b/i.test(command)) return { reply: "Choose a Mosaic palette: classic, neon, pastel, mono, or ocean.", queued: false };
      if (command === "reveal") return { reply: "Use !spmt reveal or !spmt mosaic reveal for the 15-second target reveal.", queued: false };
      if (command === "status" || command === "queue") {
        const snapshot = mosaicPublicSnapshot(state, now);
        const currentLine = snapshot.artwork ? `Current: ${snapshot.artwork.theme} (${snapshot.artwork.progressPercent}% complete).` : "No active artwork.";
        const queueLine = snapshot.queue.length ? snapshot.queue.map((item) => `${item.position}. ${item.theme} — ${item.status}`).join("; ") : "Queue empty.";
        return { reply: `${currentLine} ${queueLine}`, queued: false };
      }
      if (/^(?:clear|remove)\b/i.test(command)) {
        if (!input.moderator) return { reply: "Only a broadcaster or moderator can change the Mosaic queue.", queued: false };
        if (/^clear$/i.test(command)) return { reply: `Removed ${clearMosaicQueue(state)} queued Mosaic request(s).`, queued: false };
        const selector = command.replace(/^remove\s+/i, "").trim();
        if (!selector) return { reply: "Choose a queue position or theme: !mosaic remove 1.", queued: false };
        try { const item = removeMosaicQueueRequest(state, /^\d+$/.test(selector) ? Number(selector) : selector); return { reply: `Removed Mosaic request “${item.theme}”.`, queued: false }; }
        catch (error) { return { reply: error instanceof Error ? error.message : "That Mosaic queue item was not found.", queued: false }; }
      }
      let theme: string;
      try { theme = validateMosaicTheme(command.replace(/^request\s+/i, "")); }
      catch (error) { return { reply: error instanceof Error ? error.message : "That Mosaic theme is invalid.", queued: false }; }
      try {
        const queued = queueMosaicThemeRequest(state, { id: randomUUID(), theme, playerId, username: input.username, displayName: input.displayName || input.username, now });
        return { reply: `Mosaic “${theme}” queued at position ${queued.position}.`, queued: true };
      } catch (error) { return { reply: error instanceof Error ? error.message : "That Mosaic request could not be queued.", queued: false }; }
    }, now);
    let reply = result.result.reply;
    let generated = false;
    if (result.result.queued && this.generate) {
      const started = await this.processNext(input.tenantId, input.channel, now);
      generated = started.started && !started.error;
      if (started.error) reply += ` Generation attempt failed and was recorded for retry: ${started.error}`;
      else if (generated) reply += " Artwork generated and installed.";
      else reply += " The request remains queued; an existing artwork or another generation attempt currently blocks it.";
    } else if (result.result.queued) {
      reply += " The request is saved, but the image-generation runner is not configured yet.";
    }
    return { handled: true, reply, generated, state: this.snapshot(input.tenantId, input.channel, now) };
  }
}
